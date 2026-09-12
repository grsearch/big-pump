'use client';
import {minuteEma} from '../lib/minute-ema';
const fmt=(v:number|null)=>v===null?'—':'$'+v.toLocaleString('en-US',{maximumSignificantDigits:6});
export default function MinuteEma({token,now=Date.now()}:any){
 const {metric,bars}=minuteEma(token?.history??[],now,token?.enrolledAt);
 const values=bars.flatMap(b=>[b.low,b.high,b.ema9,b.ema20].filter((v):v is number=>v!==null));
 const min=values.length?Math.min(...values):0,max=values.length?Math.max(...values):1,range=max-min||max*.01||1;
 const x=(i:number)=>76+i*520/Math.max(1,bars.length-1),y=(v:number)=>185-(v-min)*150/range;
 const latest=bars.at(-1),width=Math.max(1,Math.min(8,350/Math.max(1,bars.length)));
 const line=(key:'ema9'|'ema20')=>{let gap=true;return bars.map((b,i)=>{const v=b[key];if(v===null){gap=true;return '';}const p=(gap?'M':'L')+x(i)+','+y(v);gap=false;return p;}).join(' ');};
 return <section className="detail-box"><h2>1 分钟 K 线 · EMA9 / EMA20</h2><p className="muted">{metric==='priceUsd'?'USD 价格':'历史仅有 FDV，当前按 FDV 计算（非代币价格）'} · 仅已收盘分钟</p>
 <p><span style={{color:'#f8c667'}}>EMA9 {fmt(latest?.ema9??null)}</span> · <span style={{color:'#90b7ee'}}>EMA20 {fmt(latest?.ema20??null)}</span></p>
 {!bars.some(b=>b.close!==null)?<p>{token?'等待完整分钟的行情样本。':'当前快照没有该币行情历史，无法计算 EMA。'}</p>:<svg viewBox="0 0 630 235" role="img" aria-label="一分钟采样K线及EMA9、EMA20" style={{width:'100%'}}>
 {[0,.5,1].map(r=><g key={r}><line x1="70" x2="610" y1={y(min+range*r)} y2={y(min+range*r)} stroke="#263039"/><text x="2" y={y(min+range*r)} fill="#8da5b8" fontSize="10">{fmt(min+range*r)}</text></g>)}
 {bars.map((b,i)=>b.close!==null&&b.open!==null&&b.high!==null&&b.low!==null?<g key={b.at} stroke={b.close>=b.open?'#77e6b2':'#fa7894'} fill={b.close>=b.open?'#77e6b2':'#fa7894'}><title>{new Date(b.at).toLocaleString()} 开 {fmt(b.open)} 高 {fmt(b.high)} 低 {fmt(b.low)} 收 {fmt(b.close)} · {b.samples} 个行情样本 · EMA9 {fmt(b.ema9)} EMA20 {fmt(b.ema20)}</title><line x1={x(i)} x2={x(i)} y1={y(b.high)} y2={y(b.low)}/><rect x={x(i)-width/2} y={Math.min(y(b.open),y(b.close))} width={width} height={Math.max(1,Math.abs(y(b.open)-y(b.close)))}/></g>:null)}
 <path d={line('ema9')} fill="none" stroke="#f8c667" strokeWidth="1.5"/><path d={line('ema20')} fill="none" stroke="#90b7ee" strokeWidth="1.5"/>
 {[0,Math.floor((bars.length-1)/2),bars.length-1].filter((n,i,a)=>a.indexOf(n)===i).map(i=><text key={i} x={x(i)} y="218" textAnchor="middle" fontSize="10" fill="#8da5b8">{new Date(bars[i].at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</text>)}
 </svg>}
 <p className="muted">按采集行情合成 OHLC，不是逐笔成交 K 线，可能遗漏分钟内极值。EMA9 / EMA20 分别需连续 9 / 20 根收盘 K 线；缺失分钟断线并重新累计，未完成周期显示 —。仅供研究，不改变实盘规则。</p></section>;
}
