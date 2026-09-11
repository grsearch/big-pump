'use client';
import {useState} from 'react';
import {ResponsiveContainer,ComposedChart,Line,Scatter,XAxis,YAxis,Tooltip,ReferenceLine} from 'recharts';
import {stonkReviewMetrics} from '../lib/stonk-review';
const names:Record<string,string>={observed:'观察到扩散',absent:'未观察到扩散',unknown:'采集覆盖不足'};
export default function StonkReview({arm}:any) {
  const [loss,setLoss]=useState(30);
  const rows=(arm?.positions??[]).filter((p:any)=>p.openedAt).map((p:any)=>({p,m:stonkReviewMetrics(p)}));
  const closed=rows.filter(({p}:any)=>p.status==='closed'),losers=closed.filter(({m}:any)=>m.roi<=-loss/100);
  return <div className="panel settings-panel spaced"><h2>C 复盘：买入后 X 扩散与 FDV</h2>
    <p className="muted">沿用现有 X 采集，不增加请求。扩散观察门槛：某次完整采集的近 5 分钟有效作者 ≥3，且该批新增作者 ≥2。仅统计买入后收到、卖出前收到的样本；不用于修改买卖条件。</p>
    <label>大亏定义：净亏损至少 <input type="number" min="1" max="100" value={loss} onChange={e=>setLoss(Math.max(1,Math.min(100,Number(e.target.value)||30)))}/> %</label>
    <div className="mini-stats"><div>已平仓<strong>{closed.length}</strong></div><div>大亏交易<strong>{losers.length}</strong></div><div>大亏中未观察到扩散<strong>{losers.filter(({m}:any)=>m.classification==='absent').length}</strong></div></div>
    <p>大亏中观察到扩散：{losers.filter(({m}:any)=>m.classification==='observed').length}；采集覆盖不足：{losers.filter(({m}:any)=>m.classification==='unknown').length}。这些是关联对比，不能据此认定亏损由缺乏讨论造成。</p>
    <div className="table-scroll"><table><thead><tr><th>买后扩散情况</th><th>已平仓</th><th>大亏</th><th>平均净收益率</th></tr></thead><tbody>{Object.entries(names).map(([key,label])=>{const group=closed.filter(({m}:any)=>m.classification===key);return <tr key={key}><td>{label}</td><td>{group.length}</td><td>{group.filter(({m}:any)=>m.roi<=-loss/100).length}</td><td>{group.length?(100*group.reduce((s:number,{m}:any)=>s+m.roi,0)/group.length).toFixed(1)+'%':'—'}</td></tr>;})}</tbody></table></div>
    <p className="muted">“未观察到扩散”要求至少两次完整采集，买入至首批、批次之间、末批至卖出的间隔均不超过 3 分钟。X 关闭、预算耗尽、休眠等导致的缺口不会记成零热度。窗口为近 5 分钟，可能包含买入前的讨论。</p>
    {rows.slice().sort((a:any,b:any)=>(a.m.roi??1)-(b.m.roi??1)).map(({p,m}:any)=>{
      const start=p.review?.graduatedAt??p.signalAt;
      const fdv=(p.review?.fdv??[]).map((r:any)=>({minute:(r.at-start)/60000,fdv:r.fdv}));
      const authors=(p.review?.x??[]).filter((r:any)=>r.complete).map((r:any)=>({minute:(r.at-start)/60000,authors:r.authors}));
      return <details className="ai-detail" key={p.id}><summary>{p.symbol} · {p.status==='closed'?(m.roi*100).toFixed(1)+'%':'持仓中'} · {names[m.classification]}</summary>
        <p>退出：{p.pendingExit?.reason??p.reason} · 买后完整采集 {m.samples} 次 · 有效作者峰值 {m.peakAuthors??'未知'} · 首次观察到扩散 {m.firstExpansionAt?((m.firstExpansionAt-p.openedAt)/60000).toFixed(1)+' 分钟后':'未观察到'}</p>
        <p className="muted">横轴：毕业后分钟；左轴 FDV / USD，右轴近 5 分钟有效作者。蓝点是实际采集快照，不代表两次采集之间的热度。</p>
        {!fdv.length&&!authors.length?<p>该交易没有可用的复盘快照，不能判断扩散与走势关系。</p>:<div style={{height:260,width:'100%'}}><ResponsiveContainer><ComposedChart><XAxis type="number" dataKey="minute" domain={[0,Math.max(1,((p.closedAt??p.review?.through??p.openedAt)-start)/60000)]}/><YAxis yAxisId="fdv"/><YAxis yAxisId="x" orientation="right" allowDecimals={false}/><Tooltip/><Line data={fdv} yAxisId="fdv" dataKey="fdv" name="FDV / USD" stroke="#77e6b2" dot={false} isAnimationActive={false}/><Scatter data={authors} yAxisId="x" dataKey="authors" name="有效作者 / 5m" fill="#8db9ed" isAnimationActive={false}/><ReferenceLine yAxisId="fdv" x={(p.openedAt-start)/60000} stroke="#e7bb73" label="买入"/>{p.closedAt&&<ReferenceLine yAxisId="fdv" x={(p.closedAt-start)/60000} stroke="#ef8888" label="卖出"/>}</ComposedChart></ResponsiveContainer></div>}
      </details>;
    })}{!rows.length&&<p>尚无 C 买入记录，成交后会自动积累复盘数据。</p>}
  </div>;
}
