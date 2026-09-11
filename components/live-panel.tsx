'use client';
import {useState} from 'react';
const sol = (n:any) => Number.isFinite(n) ? (n / 1e9).toFixed(5) + ' SOL' : '—';
const tx = (signature:string) => <a href={'https://solscan.io/tx/'+signature} target="_blank" rel="noreferrer">链上成交 ↗</a>;
export default function LivePanel({data,demo,online,busy,act}:any) {
  const [confirm,setConfirm]=useState(false);
  const live=data?.liveTrading, positions=live?.positions??[], orders=live?.orders??[];
  const open=positions.filter((p:any)=>p.status==='open'), closed=positions.filter((p:any)=>p.status==='closed');
  const failedFees=orders.filter((o:any)=>o.status==='failed'&&o.side==='buy').reduce((sum:number,o:any)=>sum+(o.receipt?.feeLamports??0),0);
  const labels:Record<string,string>={retrying:'等待快速重试',preparing:'核验报价',confirming:'等待链上核对',confirmed:'已确认',failed:'链上失败',skipped:'已跳过'};
  return <><div className="section-intro"><h2>C · Stonk 毕业即买 · 实盘</h2><p>每次 0.1 SOL，Stonk 使用 Jupiter 路由。使用 Jupiter 即时报价，取消本程序额外的链上模拟；不要求 X 热度或 FDV 门槛，不继承 Shadow 持仓或历史信号。旧 A 记录保留，旧持仓仍按原规则管理。</p></div>
    <div className="notice">{live?.acceptEntries?'新开仓已启用':'新开仓关闭'} · {live?.enabled?'服务器允许实盘':'服务器实盘开关关闭'} · {live?.configured?'钱包已配置':'钱包未就绪'}<br/>+40% 激活移动止盈，回撤 10% 全仓退出；无固定止盈止损，最长持仓 30 分钟。阈值依据扣费后的卖出报价，成交金额可能不同。</div>
    <div className="panel"><div className="panel-head"><h2>运行状态</h2><span>Jupiter {live?.jupiter?.used??0} / {live?.jupiter?.limit??60} 次 / 分钟</span></div><div className="detail-box">
      <p>钱包：{live?.wallet?<a href={'https://gmgn.ai/sol/address/'+live.wallet} target="_blank" rel="noreferrer">{live.wallet} ↗</a>:'尚未配置'}</p>
      <p>单笔滑点上限 {(live?.slippageBps??1500)/100}% · 固定优先费 {sol(live?.jupiter?.priorityFeeLamports??300000)} · 网络费用和租金上限 {sol(live?.maxFeeLamports??5000000)}（不含 0.1 SOL 买入本金）</p>
      <p>持仓卖出报价优先，目标每 5 秒检查；免费额度不足时会延迟。无报价、未确认交易和未平仓收益不会计成已实现盈利。</p>
      {(live?.error||live?.lastError)&&<p className="notice">{live.error||live.lastError}</p>}
      {live?.acceptEntries?<button className="button" disabled={busy||demo||!online} onClick={()=>act('/live/control',{action:'pause'})}>暂停新买入，继续管理持仓</button>:<><label><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/> 我确认启用真实交易，每笔买入 0.1 SOL</label><p><button className="button" disabled={!confirm||!live?.configured||!live?.enabled||busy||demo||!online} onClick={async()=>{if(await act('/live/control',{action:'start',confirmation:'LIVE_C_0.1_SOL'}))setConfirm(false);}}>启用实盘 C</button></p></>}
      <p className="muted">停止采集会停止产生新买入；已有实盘持仓仍继续管理。关闭后端进程会中断自动卖出。</p>
    </div></div>
    <div className="mini-stats"><div><span>持仓</span><strong>{open.length}</strong></div><div><span>已平仓</span><strong>{closed.length}</strong></div><div><span>净已实现（含失败买入费用）</span><strong>{sol(closed.reduce((n:number,p:any)=>n+p.realizedLamports,0)-failedFees)}</strong></div></div>
    <div className="panel"><div className="panel-head"><h2>实盘持仓与收益</h2></div><div className="table-scroll"><table><thead><tr><th>Token / CA</th><th>状态</th><th>投入</th><th>卖出报价 / 已回收</th><th>已实现</th><th>退出条件 / 成交</th></tr></thead><tbody>{positions.map((p:any)=><tr key={p.ca}><td><a href={'https://gmgn.ai/sol/token/'+p.ca} target="_blank" rel="noreferrer">{p.symbol||p.ca.slice(0,8)} ↗</a></td><td>{p.status==='open'?'持仓中':'已平仓'}<small>{p.strategy==='stonk-graduation-c-v1'?'策略 C':'旧策略 A'}</small></td><td>{sol(p.costLamports)}</td><td>{sol(p.status==='closed'?p.proceedsLamports:p.markLamports)}<small>{p.quoteError|| (p.quoteAt?new Date(p.quoteAt).toLocaleTimeString():'')}</small></td><td>{sol(p.realizedLamports)}</td><td>{p.exitReason||'等待退出条件'}<small>{tx(p.sellSignature||p.buySignature)}</small></td></tr>)}</tbody></table></div>{!positions.length&&<div className="empty-note">尚无链上确认的实盘持仓。配置并手动启用后，只处理新的实时信号。</div>}</div>
    <div className="panel"><div className="panel-head"><h2>订单与跳过原因</h2><span>最近 100 条</span></div>{orders.slice().reverse().slice(0,100).map((o:any)=><div className="detail-box" key={o.id}><b>{o.side==='buy'?'买入':'卖出'} · {o.symbol||o.ca.slice(0,8)} · {labels[o.status]||o.status}</b><p>{o.reason}{o.attempts ? ` · 已尝试 ${o.attempts} 次` : null}{o.status==='retrying' && o.nextAttemptAt ? ` · 下次 ${new Date(o.nextAttemptAt).toLocaleTimeString()}` : null}</p>{o.diagnostic&&<details><summary>模拟错误详情</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(o.diagnostic,null,2)}</pre></details>}<small>{new Date(o.at).toLocaleString()} {o.signature&&tx(o.signature)}</small></div>)}{!orders.length&&<div className="empty-note">等待启用后的 Stonk 毕业信号。</div>}</div>
  </>;
}
