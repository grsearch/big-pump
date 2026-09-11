'use client';
import {useState,useEffect} from 'react';
import StonkReview from './stonk-review';
import {diffusionDefaults,DIFFUSION_VERSION} from '../lib/diffusion-shadow';
import {shadowDiagnostics} from '../lib/shadow-diagnostics';
const armName=(id:string)=>({early:'A · 新增作者即买',breakout:'B · 扩散后突破',graduation:'C · Stonk 毕业即买',baseline:'旧 A · 基础社交',ai:'旧 B · AI 筛选'}[id]??id);
export default function ShadowPanel({data,demo,online,busy,act}:any) {
  const [rules,setRules]=useState({...diffusionDefaults});
  const runs=[...(data?.shadowRuns??[])].sort((a:any,b:any)=>b.startedAt-a.startedAt);
  const run=runs.find((r:any)=>r.status==='running')??runs[0];
  const modern=run?.version===DIFFUSION_VERSION;
  const [tradePage,setTradePage]=useState(1),[tradePageSize,setTradePageSize]=useState(20);
  const latestAt=(p:any)=>Math.max(p.signalAt??0,p.openedAt??0,p.closedAt??0,...(p.fills??[]).map((f:any)=>f.at??0));
  const tradeRows=(run?.arms??[]).flatMap((a:any)=>a.positions.map((p:any)=>({a,p,at:latestAt(p)}))).sort((a:any,b:any)=>b.at-a.at||String(a.p.id).localeCompare(String(b.p.id)));
  const tradePages=Math.max(1,Math.ceil(tradeRows.length/tradePageSize)),currentTradePage=Math.min(tradePage,tradePages);
  const visibleTrades=tradeRows.slice((currentTradePage-1)*tradePageSize,currentTradePage*tradePageSize);
  useEffect(()=>setTradePage(1),[run?.id]);
  useEffect(()=>{if(tradePage>tradePages)setTradePage(tradePages);},[tradePage,tradePages]);
  const now=data?.now??Date.now(),lastCheck=run?Math.min(...run.arms.map((a:any)=>a.updatedAt??0)):0;
  const state=!run?'尚未启动':run.status==='finished'?'实验已结束':!online?'连接已断开，显示上次结果':!data.running?'采集器已停止':run.acceptEntries===false?'已暂停新开仓，继续管理持仓':!lastCheck?'已创建，等待首次策略检查':now-lastCheck>30000?'策略检查已超过 30 秒未更新':'策略正在运行';
  return <>
    <div className="section-intro"><h2>Shadow：新增即买 / 扩散突破 / Stonk 毕业</h2><p>三组独立模拟资金，不设持仓数量上限。每币每组实际买入最多一次，不补仓；AI 与聪明钱包不作为A/B 的入场门槛。</p></div>
    <div className="panel settings-panel" role="status"><h2>{state}</h2><p className="muted">{lastCheck?'最近策略检查：'+new Date(lastCheck).toLocaleTimeString('zh-CN'):'尚无策略检查记录'}{run?' · 已运行 '+Math.max(0,Math.floor((now-run.startedAt)/60000))+' 分钟':''}</p>{run&&!run.arms.some((a:any)=>a.positions.length)&&<p>尚未产生买入信号，因此资金未变化，暂时不能评价策略收益。下方可查看当前未入场原因。</p>}{data?.xBlocked&&<p className="amber">X 已暂停请求，新增作者信号暂时无法更新。</p>}{data?.xEnabled===false&&<p className="amber">X 付费采集尚未开启，无法获得新的真实讨论信号。</p>}</div>
    <div className="notice">C：Stonk 毕业即记录买入信号，不依赖 X；+40% 激活移动止盈、回撤 10% 退出，FDV 跌破 $10,000 或持仓满 15 分钟卖出。C 不使用 A/B 的固定止盈止损；单笔金额和模拟费用沿用实验设置。首次启用不追买旧币。<br/>X 按 15 / 30 / 60 / 120 秒分级；15 秒池最多 5 币，每币最多加速 3 分钟。持仓行情目标每 5 秒查询，受请求耗时、限流和行情源更新速度约束。买卖仍有延迟、滑点、手续费及税费；缺行情不伪造成交。</div>
    {!run||run.status==='finished'?<form className="panel settings-panel" onSubmit={e=>{e.preventDefault();act('/shadow/start',{rules});}}>
      <h2>开始新实验</h2><button className="button primary" disabled={busy||demo||!online}>开始新策略实验</button><details><summary>查看或调整参数（默认：单笔 $50、每组 $1,000）</summary><div className="settings-grid">{([
        ['positionUsd','单笔投入 / USD'],['initialCash','每组资金 / USD'],['minLp','最低 LP / USD'],['minNewAuthors','即时组最低新作者'],
        ['trailingActivation','移动止盈激活 / 0–1'],['trailingDrop','高点回撤 / 0–1'],['takeProfit','固定止盈 / 0–1'],['stopLoss','固定止损 / 0–1'],['maxHoldHours','最长持仓 / 小时'],['slippage','额外滑点 / 0–1']
      ] as const).map(([key,label])=><label className="setting" key={key}><span>{label}</span><input type="number" min="0" step="any" value={rules[key]} onChange={e=>setRules({...rules,[key]:Number(e.target.value)})}/></label>)}</div></details>
      <p className="muted">A/B 门槛：FDV $20K–$500K、LP 达标、AGE ≤3h。A：本批至少 2 位首次出现的有效作者，帖子延迟 ≤2 分钟，立即记录信号。B：AGE ≥10 分钟，5 分钟内 ≥8 位作者 / 10 帖，较前窗口 ≥1.8 倍、4 位新人；两次真实采集确认，价格未过热后等待突破。</p>
    </form>:<div className="panel settings-panel"><h2>{modern?'扩散策略实验':'旧策略实验（参数保留）'}</h2><p>{run.version} · {new Date(run.startedAt).toLocaleString('zh-CN')}</p>
      <div className="header-actions"><button className="button" disabled={busy||demo} onClick={()=>act('/shadow/control',{action:run.acceptEntries===false?'resume':'pause'})}>{run.acceptEntries===false?'恢复开仓':'暂停开仓，继续管理持仓'}</button><button className="button subtle" disabled={busy||demo} onClick={()=>act('/shadow/control',{action:'finish'})}>结束实验（须已清仓）</button></div>
      {!modern&&<p className="muted">启用新策略需先暂停旧实验、等待清仓并结束，再创建新实验；不会改动旧仓位的退出规则。</p>}
    </div>}
    {run&&<><div className="bottom-grid">{run.arms.map((a:any)=>{
      const closed=a.positions.filter((p:any)=>p.status==='closed'),wins=closed.filter((p:any)=>p.realized>0).length;
      const open=a.positions.filter((p:any)=>p.status==='open'),pending=a.positions.filter((p:any)=>p.status==='pending'),cancelled=a.positions.filter((p:any)=>p.status==='cancelled');
      const floating=open.some((p:any)=>p.unpriced||!Number.isFinite(p.markValue))?null:open.reduce((sum:number,p:any)=>sum+p.markValue-p.cost*p.quantity/p.initialQuantity,0);
      return <div className="panel settings-panel" key={a.id}><h2>{armName(a.id)}</h2><div className="mini-stats"><div>估算权益<strong>{a.equity==null?'无法估值':'$'+a.equity.toFixed(2)}</strong></div><div>已实现<strong>${a.positions.reduce((s:number,p:any)=>s+(p.realized??0),0).toFixed(2)}</strong></div><div>最大回撤<strong>{(a.maxDrawdown*100).toFixed(1)}%</strong></div></div>
        <p className="muted">已平仓 {closed.length} · 胜率 {closed.length?(wins/closed.length*100).toFixed(1)+'%':'—'} · 可用现金 ${a.cash.toFixed(2)}</p>
        <p>待买入 {pending.length} · 持仓 {open.length} · 已取消 {cancelled.length}</p><p className="muted">持仓浮动收益：{floating===null?'无法估值':'$'+floating.toFixed(2)} · 已实现收益只在卖出后变化</p>
        {a.id==='early'&&['首次发现','后续新增'].map(type=>{const rows=closed.filter((p:any)=>p.evidence?.type===type);return <p className="muted" key={type}>{type}：{rows.length} 笔 · 净收益 ${rows.reduce((s:number,p:any)=>s+p.realized,0).toFixed(2)}</p>;})}
        {a.id==='breakout'&&a.candidates&&<p className="muted">等待突破：{Object.keys(a.candidates).length} 个</p>}
      </div>;
    })}</div>
    {modern&&run.status==='running'&&<div className="panel settings-panel spaced"><h2>为什么还没买入？</h2><p className="muted">按当前服务端快照逐币解释，每币显示首先未满足的条件；这是当前原因分布，不是历史漏单统计。采集器停止或 X 暂停时，应先恢复数据更新。</p><div className="bottom-grid">{run.arms.filter((a:any)=>a.id!=='graduation').map((a:any)=>{const d=shadowDiagnostics(data.tokens??[],a,run,now);return <div key={a.id}><h3>{armName(a.id)}</h3>{d.counts.map(([reason,count])=><p key={reason}>{reason}：<b>{count}</b> 个币</p>)}{!d.rows.length&&<p>暂无代币可检查。</p>}<details><summary>查看代币明细（前 20 个）</summary>{d.rows.slice(0,20).map(row=><p key={row.ca}><a href={'https://gmgn.ai/sol/token/'+encodeURIComponent(row.ca)} target="_blank" rel="noreferrer">{row.symbol??row.ca.slice(0,6)}</a> · {row.reason} · 本批新作者 {row.newAuthors??'未采集'}</p>)}</details></div>;})}</div></div>}
    {run.arms.some((a:any)=>a.id==='graduation')&&<StonkReview arm={run.arms.find((a:any)=>a.id==='graduation')}/>}
    <div className="panel spaced"><div className="panel-head"><h2>信号与模拟持仓</h2><span>X / AI 研究费用另行核算</span></div><div className="table-scroll"><table><thead><tr>{['组别','Token','最近交易 / 信号时间','状态','已实现','退出 / 等待原因','证据与成交'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{visibleTrades.map(({a,p,at}:any)=><tr key={p.id}>
      <td>{armName(a.id)}</td><td><a href={'https://gmgn.ai/sol/token/'+encodeURIComponent(p.ca)} target="_blank" rel="noreferrer">{p.symbol}</a><small>{p.evidence?.type}</small></td><td>{at?new Date(at).toLocaleString('zh-CN'):'—'}</td><td>{p.status}{p.unpriced?' · 无法估值':''}{p.trailingActive?' · 移动止盈已激活':''}</td><td>${(p.realized??0).toFixed(2)}</td><td>{p.pendingExit?.reason??p.reason}</td>
      <td><details><summary>{p.fills.length} 次估算</summary><p className="muted">信号：{new Date(p.signalAt).toLocaleTimeString()} · FDV {p.evidence?.fdv??'—'} · 新作者 {p.evidence?.observation?.newAuthors??'—'}</p>
        {p.evidence?.observation&&<p className="muted">收到：{new Date(p.evidence.observation.at).toLocaleTimeString()} · 帖子到达延迟：{(p.evidence.observation.postTimes??[]).map((at:number)=>((p.evidence.observation.at-at)/1000).toFixed(0)+'s').join(' / ')||'—'}</p>}
        {p.fills.map((f:any,i:number)=><p className="muted" key={i}>{new Date(f.at).toLocaleTimeString()} {f.side} · {f.reason??'入场'} · 冲击 {(f.impact*100).toFixed(2)}% {f.signalDelayMs!=null?' · 信号到成交 '+(f.signalDelayMs/1000).toFixed(0)+'s':''}</p>)}</details></td>
    </tr>)}</tbody></table></div><div className="pagination"><span>共 {tradeRows.length} 条 · 第 {currentTradePage} / {tradePages} 页 · 最新交易优先</span><select aria-label="交易记录每页数量" value={tradePageSize} onChange={e=>{setTradePageSize(Number(e.target.value));setTradePage(1);}}>{[10,20,50].map(n=><option key={n} value={n}>每页 {n} 条</option>)}</select><button className="button subtle" disabled={currentTradePage<=1} onClick={()=>setTradePage(1)}>首页</button><button className="button" disabled={currentTradePage<=1} onClick={()=>setTradePage(currentTradePage-1)}>上一页</button><button className="button" disabled={currentTradePage>=tradePages} onClick={()=>setTradePage(currentTradePage+1)}>下一页</button><button className="button subtle" disabled={currentTradePage>=tradePages} onClick={()=>setTradePage(tradePages)}>末页</button></div>{!run.arms.some((a:any)=>a.positions.length)&&<div className="empty-note">等待实时信号。首次开始不会用实验开始前的帖子批次补造买入。</div>}</div>
    <p className="muted">{modern?`A/B 按扣除预计卖出费用后的可回收金额：+${run.rules.trailingActivation*100}% 激活移动止盈、回撤 ${run.rules.trailingDrop*100}% 全卖；固定止盈 +${run.rules.takeProfit*100}%、止损 −${run.rules.stopLoss*100}%，最长 ${run.rules.maxHoldHours*60} 分钟。`:`旧实验按冻结参数执行：价格止损 ${run.rules.stopLoss*100}%、${run.rules.partialTake} 倍分批止盈、回撤 ${run.rules.trailingDrop*100}%、最长 ${run.rules.maxHoldHours} 小时。`} 触发后等待新行情，实际模拟卖价可能更差。</p></>}
  </>;
}
