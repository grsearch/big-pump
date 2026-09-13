import {SOL_MINT,parseStonkSwap} from './valuation.mjs';
import {jsonFetch} from './providers.mjs';
import {inResearchWindow} from '../lib/monitor-window.ts';

// Top-level swap endpoints describe the trader's exchange, not intermediary hops.
export function flowTrade(tx,token,price,receivedAt=Date.now()) {
 if(tx.transactionError||tx.type!=='SWAP'||!tx.signature)return null;
 const at=Number(tx.timestamp)*1000;
 if(!Number.isFinite(at)||at<token.graduatedAt||at>receivedAt)return null;
 const swap=tx.events?.swap;
 const endpoints=(items,native)=>[...(items??[]).map(x=>({mint:x.mint,wallet:x.userAccount,amount:Number(x.rawTokenAmount?.tokenAmount)/10**Number(x.rawTokenAmount?.decimals)})),...(native?[{mint:SOL_MINT,wallet:native.account,amount:Number(native.amount)/1e9}]:[])];
 const ins=endpoints(swap?.tokenInputs,swap?.nativeInput),outs=endpoints(swap?.tokenOutputs,swap?.nativeOutput);
 let value;
 if(ins.length===1&&outs.length===1&&ins[0].wallet&&ins[0].wallet===outs[0].wallet&&ins[0].mint!==outs[0].mint&&[ins[0].mint,outs[0].mint].includes(token.ca)&&[...ins,...outs].every(x=>Number.isFinite(x.amount)&&x.amount>0)){
  const buy=outs[0].mint===token.ca,base=buy?outs[0]:ins[0],quote=buy?ins[0]:outs[0];
  value={wallet:base.wallet,side:buy?'buy':'sell',quantity:base.amount,quoteMint:quote.mint,quoteAmount:quote.amount,basis:'swap-endpoints'};
 } else if(!swap) {
  const parsed=parseStonkSwap(tx,[token],price)[0];
  if(parsed)value={wallet:parsed.wallet,side:parsed.side,quantity:parsed.quantity,quoteMint:parsed.quoteMint,quoteAmount:parsed.quoteAmount,basis:'wallet-net-deltas'};
 }
 if(!value)return null;
 const fx=price(value.quoteMint,at);
 return {id:tx.signature,ca:token.ca,at,receivedAt,...value,newHolder:null,quoteUsd:Number.isFinite(fx)&&fx>0?fx:null,usd:Number.isFinite(fx)&&fx>0?value.quoteAmount*fx:null};
}

// Exact zero -> positive balance evidence, independent of our observation start.
export function newHolderEvidence(tx,event){
 if(!tx?.meta||tx.meta.err||!Array.isArray(tx.meta.preTokenBalances)||!Array.isArray(tx.meta.postTokenBalances))return null;
 const pre=tx.meta.preTokenBalances.filter(x=>x.mint===event.ca),post=tx.meta.postTokenBalances.filter(x=>x.mint===event.ca);
 if([...pre,...post].some(x=>!x.owner||!/^\d+$/.test(x.uiTokenAmount?.amount??'')))return null;
 const sum=rows=>rows.filter(x=>x.owner===event.wallet).reduce((s,x)=>s+BigInt(x.uiTokenAmount.amount),0n);
 if(sum(post)<=sum(pre))return null;
 return sum(pre)===0n&&sum(post)>0n;
}

export class TokenFlow {
 constructor(worker){this.w=worker;this.s=worker.s;this.busy=false;}
 async tick(){
  if(this.busy||!this.w.running||!this.w.rpc||this.w.env.ENABLE_TOKEN_FLOW==='false')return;
  this.busy=true;
  try{
   const now=Date.now(),tokens=this.s.summaries('token').filter(t=>t.source==='stonk'&&t.pool&&inResearchWindow(t,now));
   const t=tokens.sort((a,b)=>(this.s.get('flow-scan',a.ca)?.checkedAt??0)-(this.s.get('flow-scan',b.ca)?.checkedAt??0))[0];
   if(!t)return;
   const state=this.s.get('flow-scan',t.ca)??{ca:t.ca,startedAt:now,pages:0,unsupported:0};
   this.s.put('flow-scan',t.ca,{...state,checkedAt:now});
   try{
    // One bounded page per tick; persistent cursor catches up without blocking live execution.
    const sigs=await this.w.rpc('getSignaturesForAddress',[t.pool,{limit:20,commitment:'confirmed',...(state.before?{before:state.before}:{}),...(state.head?{until:state.head}:{})}]);
    if(!Array.isArray(sigs))throw Error('invalid signatures');
    const eligible=sigs.filter(x=>!x.err&&(x.blockTime==null||x.blockTime*1000>=t.graduatedAt));
    const parsed=eligible.length?await jsonFetch(`https://api.helius.xyz/v0/transactions/?api-key=${encodeURIComponent(this.w.env.HELIUS_API_KEY)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({transactions:eligible.map(x=>x.signature)})}):[];
    if(!Array.isArray(parsed)||eligible.some(s=>!parsed.some(x=>x.signature===s.signature)))throw Error('incomplete parsed response');
    let unsupported=state.unsupported??0;
    for(const tx of parsed){
     const event=flowTrade(tx,t,(mint,at)=>this.w.valuation.price(mint,at));
     if(event){const id=t.ca+':'+event.id;if(!this.s.has('flow-trade',id)){this.s.put('flow-trade',id,event);this.s.audit('flow-trade',t.ca,event);}}
     else if(tx.type==='SWAP')unsupported++;
     await new Promise(resolve=>setImmediate(resolve));
    }
    const done=sigs.length<20||sigs.some(x=>x.blockTime!=null&&x.blockTime*1000<t.graduatedAt);
    const next={...state,checkedAt:Date.now(),pages:state.pages+1,unsupported,error:null,pendingHead:state.pendingHead??sigs[0]?.signature,before:done?null:sigs.at(-1)?.signature};
    if(done){next.head=next.pendingHead??state.head;next.pendingHead=null;next.caughtUpAt=Date.now();}
    this.s.put('flow-scan',t.ca,next);
    this.s.audit('flow-coverage',t.ca,next);
    // Bounded enrichment; unknown stays unknown if RPC/owner evidence is missing.
    const pending=this.s.db.prepare("SELECT id,data FROM records WHERE kind='flow-trade' AND json_extract(data,'$.ca')=? AND json_extract(data,'$.side')='buy' AND json_extract(data,'$.holderCheckedAt') IS NULL LIMIT 2").all(t.ca);
    for(const row of pending){const event=JSON.parse(row.data);try{const chain=await this.w.rpc('getTransaction',[event.id,{encoding:'json',maxSupportedTransactionVersion:0,commitment:'confirmed'}]);const checked={...event,newHolder:newHolderEvidence(chain,event),holderCheckedAt:Date.now()};this.s.put('flow-trade',row.id,checked);this.s.audit('flow-holder',t.ca,checked);}catch{break;}}
   }catch{this.s.put('flow-scan',t.ca,{...this.s.get('flow-scan',t.ca),error:'成交采集失败，将沿游标重试',checkedAt:Date.now()});}
  }finally{this.busy=false;}
 }
}

export function flowSummary(store,token,largeSellUsd=500,now=Date.now()){
 const trades=store.db.prepare("SELECT data FROM records WHERE kind='flow-trade' AND json_extract(data,'$.ca')=? ORDER BY json_extract(data,'$.at')").all(token.ca).map(x=>JSON.parse(x.data));
 const first=new Set(),minutes=new Map();
 for(const tr of trades){
  const at=Math.floor(tr.at/60000)*60000;
  const m=minutes.get(at)??{at,buys:0,sells:0,buyUsd:0,sellUsd:0,newHolderBuys:0,newHolderBuyUsd:0,holderUnknown:0,firstObservedBuyerUsd:0,firstObservedBuyers:0,largeSells:0,largeSellUsd:0,unpriced:0};
  if(tr.side==='buy'){if(tr.newHolder===true){m.newHolderBuys++;if(tr.usd!==null)m.newHolderBuyUsd+=tr.usd;}else if(tr.newHolder==null)m.holderUnknown++;}
  const fresh=tr.side==='buy'&&!first.has(tr.wallet);
  first.add(tr.wallet);
  if(fresh)m.firstObservedBuyers++;
  if(tr.side==='buy')m.buys++;else m.sells++;
  if(tr.usd===null)m.unpriced++;else {if(tr.side==='buy')m.buyUsd+=tr.usd;else m.sellUsd+=tr.usd;if(fresh)m.firstObservedBuyerUsd+=tr.usd;if(tr.side==='sell'&&tr.usd>=largeSellUsd){m.largeSells++;m.largeSellUsd+=tr.usd;}}
  minutes.set(at,m);
 }
 const history=token.history??[];
 const bars=[...minutes.values()].map(m=>{
  const end=m.at+60000,points=history.filter(p=>p.at>=m.at&&p.at<end&&p.priceUsd>0&&p.marketAt<=p.at&&p.at-p.marketAt<=60000);
  const holder=history.filter(p=>p.at<end&&p.holders!=null&&p.holdersAt<=p.at&&end-p.holdersAt<=120000).at(-1);
  return {...m,holders:holder?.holders??null,netUsd:m.unpriced?null:m.buyUsd-m.sellUsd,priceStart:points[0]?.priceUsd??null,priceEnd:points.at(-1)?.priceUsd??null};
 });
 return {at:now,largeSellUsd,coverage:store.get('flow-scan',token.ca),sampleCount:trades.length,bars:bars.slice(-65),note:'仅已解析成交样本；首次观察买家不等于新增持有人。缺失汇率不计为零，金额不含网络费；多跳按交易两端计一次。'};
}
