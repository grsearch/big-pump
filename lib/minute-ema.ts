export type MinuteBar={at:number;open:number|null;high:number|null;low:number|null;close:number|null;samples:number;ema9:number|null;ema20:number|null};
// UTC minute boundaries; indicators use completed sampled candles only. A missing
// minute breaks the EMA seed instead of inventing an unchanged close.
export function minuteEma(history:any[]=[],now=Date.now(),enrolledAt?:number){
 const metric=history.some(p=>Number.isFinite(p.priceUsd)&&p.priceUsd>0)?'priceUsd':'fdv';
 const rows=history.filter(p=>Number.isFinite(p.marketAt??p.at)&&(p.marketAt??p.at)<=now&&Number.isFinite(p[metric])&&p[metric]>0)
  .slice().sort((a,b)=>(a.marketAt??a.at)-(b.marketAt??b.at));
 const buckets=new Map<number,number[]>(),seen=new Set<number>();
 const start=Number.isFinite(enrolledAt)?Math.ceil(enrolledAt!/60000)*60000:-Infinity;
 for(const p of rows){const at=p.marketAt??p.at,minute=Math.floor(at/60000)*60000;
  if(seen.has(at)||minute<start||minute+60000>now)continue;
  seen.add(at);const values=buckets.get(minute)??[];values.push(p[metric]);buckets.set(minute,values);
 }
 const bars:MinuteBar[]=[],minutes=[...buckets.keys()];
 if(!minutes.length)return {metric,bars};
 // Retain at most 24 hours so malformed timestamps cannot produce an unbounded chart.
 const last=Math.min(Math.floor(now/60000)*60000-60000,Math.max(...minutes)+60000);
 const first=Math.max(Math.min(...minutes),last-1439*60000);
 let closes:number[]=[],ema9:number|null=null,ema20:number|null=null;
 for(let at=first;at<=last;at+=60000){const values=buckets.get(at)??[],close=values.at(-1)??null;
  if(close===null){closes=[];ema9=null;ema20=null;}
  else {closes.push(close);if(closes.length>20)closes.shift();
   ema9=ema9===null?(closes.length>=9?closes.slice(-9).reduce((a,b)=>a+b,0)/9:null):ema9+(close-ema9)*2/10;
   ema20=ema20===null?(closes.length>=20?closes.reduce((a,b)=>a+b,0)/20:null):ema20+(close-ema20)*2/21;
  }
  bars.push({at,open:values[0]??null,high:values.length?Math.max(...values):null,low:values.length?Math.min(...values):null,close,samples:values.length,ema9,ema20});
 }
 return {metric,bars};
}
