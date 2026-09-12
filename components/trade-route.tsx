import {strategyName} from '../lib/live-records';
const short=(s:string)=>s.slice(0,6)+'…'+s.slice(-5);
const asset=(s?:string)=>s?<a href={'https://gmgn.ai/sol/token/'+encodeURIComponent(s)} target="_blank" rel="noreferrer">{s==='So11111111111111111111111111111111111111112'?'SOL':short(s)} ↗</a>:'未记录';
export default function TradeRoute({record:r}:any){const routes=r.route?[r.route]:[r.buyRoute,r.sellRoute].filter(Boolean);return <details><summary>策略与路由详情</summary>
 <p>{strategyName(r.strategy)}{r.strategyEvidence?' · '+r.strategyEvidence:''}</p>
 <p>策略目标币：{asset(r.ca)}</p><p>市场 Quote：{r.quoteSymbol?r.quoteSymbol+' · ':''}{asset(r.quoteMint)}（配对资产，不等于实际路由）</p>
 {!routes.length&&<p>历史订单未保存报价路由，不能推断中间资产。</p>}
 {routes.map((route:any,i:number)=><div key={i}><p>报价方向：{asset(route.inputMint)} → {asset(route.outputMint)}</p>
 <p>报价中间资产：{route.intermediates?.length?route.intermediates.map((m:string)=><span key={m}>{asset(m)} </span>):route.legs?.length?'未发现中间资产':'未返回分段信息'}</p>
 {route.legs?.map((l:any,j:number)=><small key={j}>{l.label??'交换步骤'}：{asset(l.inputMint)} → {asset(l.outputMint)}{l.percent!=null?` · ${l.percent}%`:''}<br/></small>)}
 <small>{route.source}</small></div>)}
 <p className="muted">中间资产不是独立开仓。实际经过的资产和剩余余额需查看链上交易；不能仅凭报价断言余额为零。</p>
 </details>;}
