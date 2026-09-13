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
 state(t){
  const old=this.s.get('flow-scan',t.ca)??{ca:t.ca,startedAt:Date.now(),pages:0,unsupported:0};
  if(old.version===2)return old;
  const next={...old,version:2,head:old.pendingHead??old.head,jobs:old.before?[{id:'legacy',before:old.before,until:old.head}]:[],before:null,pendingHead:null};
  this.s.put('flow-scan',t.ca,next);return next;
 }
 update(t,patch){const state={...this.state(t),...patch};this.s.put('flow-scan',t.ca,state);return state;}
 async page(t,options){
  const sigs=await this.w.rpc('getSignaturesForAddress',[t.pool,{limit:20,commitment:'confirmed',...options}]);
  if(!Array.isArray(sigs))throw Error('invalid signatures');
  const eligible=sigs.filter(x=>!x.err&&(x.blockTime==null||x.blockTime*1000>=t.graduatedAt));
  const parsed=eligible.length?await jsonFetch(`https://api.helius.xyz/v0/transactions/?api-key=${encodeURIComponent(this.w.env.HELIUS_API_KEY)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({transactions:eligible.map(x=>x.signature)})}):[];
  if(!Array.isArray(parsed)||eligible.some(s=>!parsed.some(x=>x.signature===s.signature)))throw Error('incomplete parsed response');
  let unsupported=0;
  for(const tx of parsed){
   const event=flowTrade(tx,t,(mint,at)=>this.w.valuation.price(mint,at)),id=t.ca+':'+tx.signature;
   if(event){if(!this.s.has('flow-trade',id)){this.s.put('flow-trade',id,event);this.s.audit('flow-trade',t.ca,event);}}
   else if(tx.type==='SWAP'&&!this.s.has('flow-rejected',id)){this.s.put('flow-rejected',id,{ca:t.ca,id:tx.signature,at:tx.timestamp*1000});unsupported++;}
   await new Promise(resolve=>setImmediate(resolve));
  }
  return {sigs,unsupported,done:sigs.length<20||sigs.some(x=>x.blockTime!=null&&x.blockTime*1000<t.graduatedAt)};
 }
 async tick(){
  if(this.busy||!this.w.running||!this.w.rpc||this.w.env.ENABLE_TOKEN_FLOW==='false')return;
  this.busy=true;
  try{
   const now=Date.now(),tokens=this.s.summaries('token').filter(t=>t.source==='stonk'&&t.pool&&inResearchWindow(t,now));
   for(const t of tokens)this.state(t);
   const t=tokens.sort((a,b)=>(this.state(a).checkedAt??0)-(this.state(b).checkedAt??0))[0];
   if(!t)return;
   const state=this.state(t);this.update(t,{checkedAt:now});
   try{
    // Always start at the newest signature. Old cursors never gate this lane.
    const {sigs,unsupported,done}=await this.page(t,state.head?{until:state.head}:{});
    const current=this.state(t),jobs=[...current.jobs];
    if(!done&&sigs.length)jobs.push({id:sigs[0].signature,before:sigs.at(-1).signature,until:state.head});
    const next=this.update(t,{jobs,head:sigs[0]?.signature??state.head,pages:current.pages+1,unsupported:current.unsupported+unsupported,error:null,latestCheckedAt:Date.now(),...(jobs.length?{caughtUpAt:null}:{caughtUpAt:Date.now()})});
    this.s.audit('flow-coverage',t.ca,next);
   }catch{this.update(t,{error:'最新成交采集失败，下轮重试'});}
   if(!this.historyPromise){this.historyPromise=this.history(tokens).catch(()=>{}).finally(()=>{this.historyPromise=null;});}
   if(!this.holderPromise){this.holderPromise=this.enrich(t).catch(()=>{}).finally(()=>{this.holderPromise=null;});}
  }finally{this.busy=false;}
 }
 async history(tokens){
  const t=tokens.filter(t=>this.state(t).jobs.length).sort((a,b)=>(this.state(a).historyCheckedAt??0)-(this.state(b).historyCheckedAt??0))[0];
  if(!t)return;
  const job=this.state(t).jobs[0];this.update(t,{historyCheckedAt:Date.now()});
  try{
   const {sigs,unsupported,done}=await this.page(t,{before:job.before,...(job.until?{until:job.until}:{})});
   // Reload after awaits: a concurrent latest scan may have appended gap jobs.
   const current=this.state(t),jobs=current.jobs.flatMap(j=>j.id!==job.id?[j]:done?[]:[{...j,before:sigs.at(-1).signature}]);
   const next=this.update(t,{jobs,historyError:null,historyPages:(current.historyPages??0)+1,unsupported:current.unsupported+unsupported,...(!jobs.length&&!current.error?{caughtUpAt:Date.now()}:{} )});
   this.s.audit('flow-coverage',t.ca,next);
  }catch{this.update(t,{historyError:'历史补扫失败，保留游标重试'});}
 }
 async enrich(t){
  const pending=this.s.db.prepare("SELECT id,data FROM records WHERE kind='flow-trade' AND json_extract(data,'$.ca')=? AND json_extract(data,'$.side')='buy' AND json_extract(data,'$.holderCheckedAt') IS NULL ORDER BY json_extract(data,'$.at') DESC LIMIT 2").all(t.ca);
  for(const row of pending){const event=JSON.parse(row.data);try{const chain=await this.w.rpc('getTransaction',[event.id,{encoding:'json',maxSupportedTransactionVersion:0,commitment:'confirmed'}]);const checked={...event,newHolder:newHolderEvidence(chain,event),holderCheckedAt:Date.now()};this.s.put('flow-trade',row.id,checked);this.s.audit('flow-holder',t.ca,checked);}catch{break;}}
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
