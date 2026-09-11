'use client';
import {useState} from 'react';
import {diffusionDefaults,DIFFUSION_VERSION} from '../lib/diffusion-shadow';
const armName=(id:string)=>({early:'A · 新增作者即买',breakout:'B · 扩散后突破',baseline:'旧 A · 基础社交',ai:'旧 B · AI 筛选'}[id]??id);
export default function ShadowPanel({data,demo,online,busy,act}:any) {
  const [rules,setRules]=useState({...diffusionDefaults});
  const run=[...(data?.shadowRuns??[])].sort((a:any,b:any)=>b.startedAt-a.startedAt)[0];
  const modern=run?.version===DIFFUSION_VERSION;
  return <>
    <div className="section-intro"><h2>Shadow：新增即买 vs 扩散后突破</h2><p>两组独立模拟资金，不设持仓数量上限。每币每组实际买入最多一次，不补仓；AI 与聪明钱包不作为这两组的入场门槛。</p></div>
    <div className="notice">X 按 15 / 30 / 60 / 120 秒分级；15 秒池最多 5 币，每币最多加速 3 分钟。持仓行情目标每 5 秒查询，受请求耗时、限流和行情源更新速度约束。买卖仍有延迟、滑点、手续费及税费；缺行情不伪造成交。</div>
    {!run||run.status==='finished'?<form className="panel settings-panel" onSubmit={e=>{e.preventDefault();act('/shadow/start',{rules});}}>
      <h2>开始新实验</h2><div className="settings-grid">{([
        ['positionUsd','单笔投入 / USD'],['initialCash','每组资金 / USD'],['minLp','最低 LP / USD'],['minNewAuthors','即时组最低新作者'],
        ['trailingActivation','移动止盈激活 / 0–1'],['trailingDrop','高点回撤 / 0–1'],['takeProfit','固定止盈 / 0–1'],['stopLoss','固定止损 / 0–1'],['maxHoldHours','最长持仓 / 小时'],['slippage','额外滑点 / 0–1']
      ] as const).map(([key,label])=><label className="setting" key={key}><span>{label}</span><input type="number" min="0" step="any" value={rules[key]} onChange={e=>setRules({...rules,[key]:Number(e.target.value)})}/></label>)}</div>
      <p className="muted">共同门槛：FDV $20K–$500K、LP 达标、AGE ≤3h。A：本批至少 2 位首次出现的有效作者，帖子延迟 ≤2 分钟，立即记录信号。B：AGE ≥10 分钟，5 分钟内 ≥8 位作者 / 10 帖，较前窗口 ≥1.8 倍、4 位新人；两次真实采集确认，价格未过热后等待突破。</p>
      <button className="button primary" disabled={busy||demo||!online}>开始新策略实验</button>
    </form>:<div className="panel settings-panel"><h2>{modern?'扩散策略实验':'旧策略实验（参数保留）'}</h2><p>{run.version} · {new Date(run.startedAt).toLocaleString('zh-CN')}</p>
      <div className="header-actions"><button className="button" disabled={busy||demo} onClick={()=>act('/shadow/control',{action:run.acceptEntries===false?'resume':'pause'})}>{run.acceptEntries===false?'恢复开仓':'暂停开仓，继续管理持仓'}</button><button className="button subtle" disabled={busy||demo} onClick={()=>act('/shadow/control',{action:'finish'})}>结束实验（须已清仓）</button></div>
      {!modern&&<p className="muted">启用新策略需先暂停旧实验、等待清仓并结束，再创建新实验；不会改动旧仓位的退出规则。</p>}
    </div>}
    {run&&<><div className="bottom-grid">{run.arms.map((a:any)=>{
      const closed=a.positions.filter((p:any)=>p.status==='closed'),wins=closed.filter((p:any)=>p.realized>0).length;
      return <div className="panel settings-panel" key={a.id}><h2>{armName(a.id)}</h2><div className="mini-stats"><div>估算权益<strong>{a.equity==null?'无法估值':'$'+a.equity.toFixed(2)}</strong></div><div>已实现<strong>${a.positions.reduce((s:number,p:any)=>s+(p.realized??0),0).toFixed(2)}</strong></div><div>最大回撤<strong>{(a.maxDrawdown*100).toFixed(1)}%</strong></div></div>
        <p className="muted">已平仓 {closed.length} · 胜率 {closed.length?(wins/closed.length*100).toFixed(1)+'%':'—'} · 可用现金 ${a.cash.toFixed(2)}</p>
        {a.id==='early'&&['首次发现','后续新增'].map(type=>{const rows=closed.filter((p:any)=>p.evidence?.type===type);return <p className="muted" key={type}>{type}：{rows.length} 笔 · 净收益 ${rows.reduce((s:number,p:any)=>s+p.realized,0).toFixed(2)}</p>;})}
        {a.candidates&&<p className="muted">等待突破：{Object.keys(a.candidates).length} 个</p>}
      </div>;
    })}</div>
    <div className="panel spaced"><div className="panel-head"><h2>信号与模拟持仓</h2><span>X / AI 研究费用另行核算</span></div><div className="table-scroll"><table><thead><tr>{['组别','Token','状态','已实现','退出 / 等待原因','证据与成交'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{run.arms.flatMap((a:any)=>a.positions.map((p:any)=><tr key={p.id}>
      <td>{armName(a.id)}</td><td><a href={'https://gmgn.ai/sol/token/'+encodeURIComponent(p.ca)} target="_blank" rel="noreferrer">{p.symbol}</a><small>{p.evidence?.type}</small></td><td>{p.status}{p.unpriced?' · 无法估值':''}{p.trailingActive?' · 移动止盈已激活':''}</td><td>${(p.realized??0).toFixed(2)}</td><td>{p.pendingExit?.reason??p.reason}</td>
      <td><details><summary>{p.fills.length} 次估算</summary><p className="muted">信号：{new Date(p.signalAt).toLocaleTimeString()} · FDV {p.evidence?.fdv??'—'} · 新作者 {p.evidence?.observation?.newAuthors??'—'}</p>
        {p.evidence?.observation&&<p className="muted">收到：{new Date(p.evidence.observation.at).toLocaleTimeString()} · 帖子到达延迟：{(p.evidence.observation.postTimes??[]).map((at:number)=>((p.evidence.observation.at-at)/1000).toFixed(0)+'s').join(' / ')||'—'}</p>}
        {p.fills.map((f:any,i:number)=><p className="muted" key={i}>{new Date(f.at).toLocaleTimeString()} {f.side} · {f.reason??'入场'} · 冲击 {(f.impact*100).toFixed(2)}% {f.signalDelayMs!=null?' · 信号到成交 '+(f.signalDelayMs/1000).toFixed(0)+'s':''}</p>)}</details></td>
    </tr>))}</tbody></table></div>{!run.arms.some((a:any)=>a.positions.length)&&<div className="empty-note">等待实时信号。首次开始不会用实验开始前的帖子批次补造买入。</div>}</div>
    <p className="muted">{modern?`按扣除预计卖出费用后的可回收金额：+${run.rules.trailingActivation*100}% 激活移动止盈、回撤 ${run.rules.trailingDrop*100}% 全卖；固定止盈 +${run.rules.takeProfit*100}%、止损 −${run.rules.stopLoss*100}%，最长 ${run.rules.maxHoldHours*60} 分钟。`:`旧实验按冻结参数执行：价格止损 ${run.rules.stopLoss*100}%、${run.rules.partialTake} 倍分批止盈、回撤 ${run.rules.trailingDrop*100}%、最长 ${run.rules.maxHoldHours} 小时。`} 触发后等待新行情，实际模拟卖价可能更差。</p></>}
  </>;
}
