'use client';
import TradeRoute from './trade-route';
import {strategyName,strategyBucket,attributedOrder,tradeSymbol} from '../lib/live-records';
import {useEffect,useState} from 'react';
import {livePositionView,livePortfolio} from '../lib/live-view';
const sol = (n:any) => Number.isFinite(n) ? (n / 1e9).toFixed(5) + ' SOL' : '—';
const stamp=(n:any)=>Number.isFinite(n)?new Date(n).toLocaleString():'—';
const signed=(n:any)=>Number.isFinite(n)?(n>0?'+':'')+sol(n):'—';
const tone=(n:any)=>!Number.isFinite(n)||n===0?'':n>0?'live-gain':'live-loss';
const tx = (signature?:string) => signature?<a href={'https://solscan.io/tx/'+signature} target="_blank" rel="noreferrer">链上交易 ↗</a>:null;
export default function LivePanel({data,demo,online,busy,act}:any) {
  const [confirm,setConfirm]=useState(false);
  const [strategy,setStrategy]=useState('c');
  const [now,setNow]=useState(Date.now),[history,setHistory]=useState<'closed'|'orders'>('closed'),[page,setPage]=useState(1);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer);},[]);
  const live=data?.liveTrading, positions=live?.positions??[], orders=(live?.orders??[]).map((o:any)=>attributedOrder(o,positions));
  const symbol=(r:any)=>r.displaySymbol||tradeSymbol(r,data?.tokens??[])||'Symbol 待获取';
  const open=positions.filter((p:any)=>p.status==='open'), closed=positions.filter((p:any)=>p.status==='closed'&&(strategy==='all'||strategyBucket(p.strategy)===strategy));
  const historyOrders=orders.filter((o:any)=>strategy==='all'||strategyBucket(o.strategy)===strategy);
  const failedFees=historyOrders.filter((o:any)=>o.status==='failed'&&o.side==='buy').reduce((sum:number,o:any)=>sum+(o.receipt?.feeLamports??0),0);
  const portfolio=livePortfolio(positions,now,online);
  const records=(history==='closed'?closed:historyOrders).slice().sort((a:any,b:any)=>(history==='closed'?b.closedAt-a.closedAt:(b.confirmedAt??b.at)-(a.confirmedAt??a.at)));
  const pages=Math.max(1,Math.ceil(records.length/20)),currentPage=Math.min(page,pages),rows=records.slice((currentPage-1)*20,currentPage*20);
  const labels:Record<string,string>={retrying:'等待快速重试',preparing:'核验报价',confirming:'等待链上核对',confirmed:'已确认',failed:'链上失败',skipped:'已跳过'};
  return <><div className="section-intro"><h2>C · Stonk 毕业即买 · 实盘</h2><p>每次 0.1 SOL，Stonk 使用 Jupiter 路由。使用 Jupiter 即时报价，取消本程序额外的链上模拟；不要求 X 热度或 FDV 门槛，不继承 Shadow 持仓或历史信号。旧 A 记录保留，旧持仓仍按原规则管理。</p></div>
    <div className="notice">{live?.acceptEntries?'新开仓已启用':'新开仓关闭'} · {live?.enabled?'服务器允许实盘':'服务器实盘开关关闭'} · {live?.configured?'钱包已配置':'钱包未就绪'}<br/>+40% 激活移动止盈，回撤 10% 全仓退出；无固定止盈止损，最长持仓 30 分钟。阈值依据扣费后的卖出报价，成交金额可能不同。</div>
    <details className="panel live-settings"><summary className="panel-head"><h2>运行设置与控制</h2><span>Jupiter {live?.jupiter?.plan??'Developer'} · {live?.jupiter?.usedThisSecond??0} / {live?.jupiter?.requestsPerSecond??10} 次 / 秒 · {live?.jupiter?.used??0} / {live?.jupiter?.limit??600} 次 / 分钟</span></summary><div className="detail-box">
      <p>钱包：{live?.wallet?<a href={'https://gmgn.ai/sol/address/'+live.wallet} target="_blank" rel="noreferrer">{live.wallet} ↗</a>:'尚未配置'}</p>
      <p>单笔滑点上限 {(live?.slippageBps??1500)/100}% · 固定优先费 {sol(live?.jupiter?.priorityFeeLamports??300000)} · 网络费用和租金上限 {sol(live?.maxFeeLamports??5000000)}（不含 0.1 SOL 买入本金）</p>
      <p>持仓卖出报价优先，目标每 5 秒检查；共享额度不足或接口限流时会延迟。无报价、未确认交易和未平仓收益不会计成已实现盈利。</p>
      {(live?.error||live?.lastError)&&<p className="notice">{live.error||live.lastError}</p>}
      {live?.acceptEntries?<button className="button" disabled={busy||demo||!online} onClick={()=>act('/live/control',{action:'pause'})}>暂停新买入，继续管理持仓</button>:<><label><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/> 我确认启用真实交易，每笔买入 0.1 SOL</label><p><button className="button" disabled={!confirm||!live?.configured||!live?.enabled||busy||demo||!online} onClick={async()=>{if(await act('/live/control',{action:'start',confirmation:'LIVE_C_0.1_SOL'}))setConfirm(false);}}>启用实盘 C</button></p></>}
      <p className="muted">停止采集会停止产生新买入；已有实盘持仓仍继续管理。关闭后端进程会中断自动卖出。</p>
    </div></details>
    <section className="panel live-holdings">
      <div className="panel-head"><h2>当前持仓 <span className="muted">{open.length}</span></h2><span>{online?'自动刷新 · 报价目标每 5 秒更新':'连接中断 · 估值暂停'}</span></div>
      <div className="live-summary">
        <div><span>持仓投入</span><strong>{sol(portfolio.cost)}</strong></div>
        <div><span>预计卖出净回收</span><strong>{sol(portfolio.value)}</strong></div>
        <div><span>当前浮动收益</span><strong className={tone(portfolio.pnl)}>{signed(portfolio.pnl)}</strong><small>{portfolio.priced} / {portfolio.count} 个持仓报价有效</small></div>
      </div>
      <div className="table-scroll"><table><thead><tr><th>币种 / CA</th><th>持仓时间</th><th>实际投入</th><th>预计净回收</th><th>浮动收益 / 收益率</th><th>退出状态</th></tr></thead><tbody>
      {open.slice().sort((a:any,b:any)=>b.openedAt-a.openedAt).map((p:any)=>{
        const v=livePositionView(p,now,online),elapsed=Number.isFinite(p.openedAt)?Math.max(0,now-p.openedAt):null;
        const selling=orders.some((o:any)=>o.ca===p.ca&&o.side==='sell'&&o.status==='confirming');
        return <tr key={p.ca}>
          <td><a href={'https://gmgn.ai/sol/token/'+p.ca} target="_blank" rel="noreferrer">{symbol(p)} ↗</a><small>{p.ca.slice(0,6)}…{p.ca.slice(-6)}</small><small>{strategyName(p.strategy)}</small></td>
          <td>{elapsed===null?'—':`${Math.floor(elapsed/60000)}分${Math.floor(elapsed/1000)%60}秒`}<small>{elapsed===null?'':elapsed>=1800000?'已到最长持仓时间':`距到期 ${Math.ceil((1800000-elapsed)/60000)} 分钟`}</small></td>
          <td>{sol(v.cost)}</td>
          <td>{v.fresh?sol(v.mark):'待更新'}<small>{p.quoteAt?`报价 ${new Date(p.quoteAt).toLocaleTimeString()}`:'尚无卖出报价'}</small>{!v.fresh&&v.mark!==null&&<small>上次净回收 {sol(v.mark)}</small>}</td>
          <td className={tone(v.pnl)}><strong>{signed(v.pnl)}</strong><small>{v.percent===null?'—':`${v.percent>0?'+':''}${v.percent.toFixed(2)}%`}</small>{!v.fresh&&<small className="live-stale">{!online?'连接中断':p.quoteError?'报价失败':'报价过期或尚未获取'}</small>}</td>
          <td className="live-reason">{selling?'卖出已提交，等待链上确认':p.exitReason|| (p.trailingActive?'移动止盈已激活':'持仓中，等待退出条件')}<small>{tx(p.buySignature)}</small>{p.quoteError&&<details><summary>报价错误</summary>{p.quoteError}</details>}</td>
        </tr>;
      })}</tbody></table></div>
      {!open.length&&<div className="empty-note">当前没有持仓。买入经链上确认后会显示在这里。</div>}
      <p className="live-footnote">浮动收益 = 最新卖出报价扣除预计网络费用 − 实际投入；不含 X / AI 研究费用。超过 30 秒、请求失败或断线的报价不计为当前收益。实际成交可能不同。</p>
    </section>
    <section className="panel live-history">
      <div className="panel-head"><h2>交易记录</h2><span>净已实现（含失败买入费用） <b className={tone(closed.reduce((n:number,p:any)=>n+(p.realizedLamports??0),0)-failedFees)}>{signed(closed.reduce((n:number,p:any)=>n+(p.realizedLamports??0),0)-failedFees)}</b></span></div>
      <div className="toolbar"><div className="tabs"><button className={history==='closed'?'active':''} aria-pressed={history==='closed'} onClick={()=>{setHistory('closed');setPage(1);}}>已平仓 {closed.length}</button><button className={history==='orders'?'active':''} aria-pressed={history==='orders'} onClick={()=>{setHistory('orders');setPage(1);}}>订单明细 {historyOrders.length}</button></div><select aria-label="交易策略筛选" value={strategy} onChange={e=>{setStrategy(e.target.value);setPage(1);}}><option value="c">实盘 C</option><option value="a">旧实盘 A</option><option value="unknown">策略未知</option><option value="all">全部策略</option></select><span className="muted">收益按当前筛选统计 · 未成交尝试列在订单明细</span></div>
      <div className="table-scroll"><table>
      {history==='closed'?<><thead><tr><th>平仓时间 / 买入时间</th><th>策略目标币</th><th>投入</th><th>实际回收</th><th>已实现收益 / 收益率</th><th>退出原因 / 成交</th></tr></thead><tbody>{rows.map((p:any)=><tr key={p.ca}>
        <td>{stamp(p.closedAt)}<small>买入 {stamp(p.openedAt)}</small></td><td><a href={'https://gmgn.ai/sol/token/'+p.ca} target="_blank" rel="noreferrer">{symbol(p)} ↗</a><small>{p.ca.slice(0,6)}…{p.ca.slice(-6)}</small><small>{strategyName(p.strategy)}</small></td><td>{sol(p.costLamports)}</td><td>{sol(p.proceedsLamports)}</td><td className={tone(p.realizedLamports)}>{signed(p.realizedLamports)}<small>{Number.isFinite(p.realizedLamports)&&p.costLamports>0?`${(p.realizedLamports/p.costLamports*100).toFixed(2)}%`:'—'}</small></td><td className="live-reason">{p.exitReason||'—'}<small>{tx(p.sellSignature)}</small><small>{p.buySignature&&<a href={'https://solscan.io/tx/'+p.buySignature} target="_blank" rel="noreferrer">买入成交 ↗</a>}</small><TradeRoute record={p}/></td>
      </tr>)}</tbody></>:<><thead><tr><th>最近时间</th><th>策略目标币</th><th>操作</th><th>状态</th><th>实际金额</th><th>原因 / 详情</th></tr></thead><tbody>{rows.map((o:any)=><tr key={o.id}>
        <td>{stamp(o.confirmedAt??o.at)}</td><td><a href={'https://gmgn.ai/sol/token/'+o.ca} target="_blank" rel="noreferrer">{symbol(o)} ↗</a><small>{o.ca.slice(0,6)}…{o.ca.slice(-6)}</small><small>{strategyName(o.strategy)}</small></td><td>{o.side==='buy'?'买入':'卖出'}</td><td>{labels[o.status]||o.status}</td><td>{o.receipt?.failed?sol(o.receipt.feeLamports):Number.isFinite(o.receipt?.solDelta)?sol(Math.abs(o.receipt.solDelta)):'—'}<small>{o.receipt?.failed?'链上失败手续费':o.status==='confirmed'?'链上实际金额':'尚未确认成交'}</small></td><td className="live-reason">{o.reason||'—'}{o.attempts&&<small>尝试 {o.attempts} 次{o.status==='retrying'&&o.nextAttemptAt?` · 下次 ${new Date(o.nextAttemptAt).toLocaleTimeString()}`:''}</small>}{o.signature&&<small>{tx(o.signature)}</small>}<TradeRoute record={o}/>{o.diagnostic&&<details><summary>错误详情</summary><pre>{JSON.stringify(o.diagnostic,null,2)}</pre></details>}</td>
      </tr>)}</tbody></>}
      </table></div>
      {!records.length&&<div className="empty-note">{history==='closed'?'暂无已平仓记录。':'暂无订单记录。'}</div>}
      <div className="pagination"><span>共 {records.length} 条 · 第 {currentPage} / {pages} 页 · 每页 20 条</span><button className="button" disabled={currentPage===1} onClick={()=>setPage(1)}>首页</button><button className="button" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>上一页</button><button className="button" disabled={currentPage===pages} onClick={()=>setPage(currentPage+1)}>下一页</button></div>
    </section>
  </>;
}
