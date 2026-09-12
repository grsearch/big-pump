export function strategyName(strategy?:string){return strategy==='stonk-graduation-c-v1'?'实盘 C':strategy==='legacy-a'?'旧实盘 A':'策略未知';}
export function strategyBucket(strategy?:string){return strategy==='stonk-graduation-c-v1'?'c':strategy==='legacy-a'?'a':'unknown';}
export function tradeSymbol(record:any,metadata:any[]=[]){
 const valid=(s:any)=>typeof s==='string'&&s.trim()&&!['未知','UNKNOWN',record.ca,record.ca?.slice(0,5),record.ca?.slice(0,8)].includes(s.trim());
 const current=metadata.find(t=>t.ca===record.ca&&valid(t.symbol));
 return current?.symbol?.trim()??(valid(record.symbol)?record.symbol.trim():null);
}
// Only an exact, unique signature match can repair historical attribution.
export function attributedOrder(order:any,positions:any[]){
 if(order.strategy||!['buy','sell'].includes(order.side))return order;
 const matches=positions.filter(p=>order.signature&&p.ca===order.ca&&order.signature===(order.side==='buy'?p.buySignature:p.sellSignature));
 if(matches.length!==1||!matches[0].strategy)return order;
 return {...order,strategy:matches[0].strategy,strategyEvidence:'对应持仓的成交签名匹配'};
}
const mint=(v:any)=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)?v:null;
export function quotedRoute(q:any){
 const legs=(Array.isArray(q.routePlan)?q.routePlan:[]).slice(0,50).flatMap((r:any)=>{
  const x=r.swapInfo;if(!mint(x?.inputMint)||!mint(x?.outputMint))return [];
  return [{inputMint:x.inputMint,outputMint:x.outputMint,label:typeof x.label==='string'?x.label.slice(0,80):null,percent:Number.isFinite(r.percent)?r.percent:null}];
 });
 return {source:'Jupiter 报价（未逐跳核验链上成交）',at:q.receivedAt??null,inputMint:mint(q.inputMint),outputMint:mint(q.outputMint),legs,
 intermediates:[...new Set<string>(legs.flatMap((l:any)=>[l.inputMint,l.outputMint]).filter((m:string)=>m!==q.inputMint&&m!==q.outputMint))]};
}
