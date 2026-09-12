'use client';
import {useState} from 'react';

export default function WalletResearch({data,now,busy,disabled,onScan,onCopy,onHistory}:{data:any;now:number;busy:boolean;disabled:boolean;onScan:(address:string)=>Promise<boolean>;onCopy:(address:string)=>Promise<void>;onHistory:(action:string)=>Promise<boolean>}) {
  const [address,setAddress]=useState(''),[filter,setFilter]=useState('verified');
  const wallets=data.wallets??[],rules=data.rules,history=data.stonkHistory,job=history?.job;
  const verified=wallets.filter((w:any)=>w.status==='verified');
  const rows=filter==='verified'?verified:wallets.filter((w:any)=>w.status!=='verified');
  const profit=(n:any)=>typeof n==='number'&&Number.isFinite(n)?`${n>0?'+':''}${n.toFixed(3)} SOL`:'待核验';
  return <>
    <div className="section-intro"><h2>寻找早买、长持、有大赢单的盈利钱包</h2><p>AGE &gt; {rules.minWalletAgeDays} 天；近 7 天已实现净收益 &gt; {rules.minSevenDayProfitSol} SOL。至少一笔早买大赢单兑现 ≥{rules.bigWinMultiple} 倍。原有最低样本要求继续适用。</p></div>
    <div className="panel spaced"><div className="panel-head"><h2>历史 Stonk 毕业币 · FDV ≥ $1M</h2><span>按扫描时的当前 FDV 筛选</span></div>
      <div className="wallet-form"><button className="button" disabled={disabled||busy||job?.status==='running'} onClick={()=>onHistory('start')}>重新扫描全部毕业币</button>{job&&<button className="button" disabled={disabled||busy} onClick={()=>onHistory(job.status==='running'?'pause':'resume')}>{job.status==='running'?'暂停历史扫描':'继续历史扫描'}</button>}</div>
      <p className="form-note">{!job?'尚未扫描':({running:'扫描中',paused:'已暂停',capped:'达到单币分页上限，可继续',complete:'本轮扫描结束'} as Record<string,string>)[job.status]}{job&&` · 列表 ${Math.min(job.page-1,job.totalPages??0)} / ${job.totalPages??'—'} 页 · ${history.tokens.length} 个候选币 · ${history.buyers} 条买家线索`}{data.running===false&&job?.status==='running'?' · 等待启动采集器':''}</p>
      {job?.error&&<p className="form-note amber">{job.error}</p>}
      <p className="form-note">核验链上迁移后，扫描毕业前后各 10 分钟的买家。每个阶段单轮最多 50 页，失败及重启可续跑。仅用于钱包研究，不加入观察列表、不采集 X、不触发买卖。发现买家后可在下方“待核验”分析钱包；开启钱包自动发现时也会自动核验。历史汇率、成本不完整仍记为待核验。</p>
      {!!history?.tokens?.length&&<details className="form-note"><summary>查看候选币与扫描覆盖</summary><div className="table-scroll"><table><thead><tr><th>代币</th><th>扫描时 FDV</th><th>进度</th></tr></thead><tbody>{history.tokens.map((t:any)=><tr key={t.ca}><td><a href={'https://gmgn.ai/sol/token/'+t.ca} target="_blank" rel="noopener noreferrer">{t.symbol??t.ca.slice(0,8)}</a></td><td>${Math.round(t.fdvUsd).toLocaleString()}</td><td>{({verify:'核验迁移',pool:'扫描毕业后买家',curve:'扫描毕业前买家',done:'窗口扫描完成',unverified:'查询窗口内未匹配迁移',capped:'已达分页上限'} as Record<string,string>)[t.phase]} · 累计 {t.totalPages??t.pages} 页 / 已核验 {t.checkedTransactions??0} 笔</td></tr>)}</tbody></table></div></details>}
    </div>
    {data.walletDiagnostics&&<p className="notice">自动核验：{data.researchEnabled?'已开启':'未开启'} · 排队 {data.walletDiagnostics.queued} · 达分页上限 {data.walletDiagnostics.capped} · 含未支持交易 {data.walletDiagnostics.unsupported}。未达标与数据不足分别列出，不将未知认作亏损。</p>}<div className="panel"><div className="panel-head"><h2>钱包研究库</h2><span>只有全部门槛通过才计入聪明钱包</span></div>
      <form className="wallet-form" onSubmit={async e=>{e.preventDefault();if(await onScan(address))setAddress('');}}><input placeholder="输入 Solana 钱包地址，核验历史与收益" aria-label="钱包地址" value={address} onChange={e=>setAddress(e.target.value)} required/><button className="button" disabled={disabled||busy}>分析钱包</button></form>
      <p className="form-note">扫描使用 Helius 额度，目标每 5 秒推进一页，单轮最多 50 页；到达上限后可手动继续。自动发现启用时，待核验地址也会进入扫描队列。</p>
      <div className="wallet-form"><button className="button" aria-pressed={filter==='verified'} onClick={()=>setFilter('verified')}>已验证 {verified.length}</button><button className="button" aria-pressed={filter==='pending'} onClick={()=>setFilter('pending')}>待核验 / 未达标 {wallets.length-verified.length}</button></div>
      <div className="table-scroll"><table><thead><tr>{['钱包','核验结果','链上 AGE','近 1 天净收益','近 7 天净收益','7 天大赢单','样本 / 长持合格','历史覆盖'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map((w:any)=><tr key={w.address}>
        <td><a href={'https://gmgn.ai/sol/address/'+encodeURIComponent(w.address)} target="_blank" rel="noopener noreferrer" title={w.address}>{w.address.slice(0,6)}…{w.address.slice(-5)}</a><button className="copy" aria-label="复制钱包地址" onClick={()=>onCopy(w.address)}>复制</button><small><button className="button subtle" disabled={disabled||busy||w.scanQueued} onClick={()=>onScan(w.address)}>{w.scanQueued?'扫描中':'重新核验 / 继续'}</button></small></td>
        <td className="wrap"><span className="badge">{w.status==='verified'?'已验证':w.periodComplete?'未达标':'待核验'}</span><small>{w.qualificationReason??w.ageReason}</small></td>
        <td>{w.firstActivityAt?`≥ ${Math.max(0,(now-w.firstActivityAt)/86400000).toFixed(2)} 天`:'待扫描'}<small>{w.firstActivityAt?'最早已知链上活动':'尚无有效链上时间'}</small></td>
        <td className={w.oneDayProfitSol==null?'':w.oneDayProfitSol>=0?'green':'negative'}>{profit(w.oneDayProfitSol)}</td>
        <td className={w.sevenDayProfitSol==null?'':w.sevenDayProfitSol>rules.minSevenDayProfitSol?'green':'negative'}>{profit(w.sevenDayProfitSol)}</td>
        <td>{w.bigWins?.length??0}<details><summary>查看兑现证据</summary>{(w.bigWins??[]).map((p:any)=><div key={p.ca}><a href={'https://gmgn.ai/sol/token/'+encodeURIComponent(p.ca)} target="_blank" rel="noopener noreferrer">{p.ca.slice(0,6)}…{p.ca.slice(-5)}</a><small>{p.multiple.toFixed(2)} 倍 · {profit(p.profit)}</small></div>)}{!w.bigWins?.length&&<small>尚无符合门槛的卖出证据</small>}</details></td>
        <td>{w.samples} / {w.wins}</td><td className="wrap">{w.coverageNote}{w.scanError&&<small className="amber">{w.scanError}</small>}{w.unknownPositions>0&&<small className="amber">{w.unknownPositions} 个币成本或汇率不完整</small>}</td>
      </tr>)}</tbody></table></div>{!rows.length&&<div className="empty-note">{filter==='verified'?'尚无通过全部门槛的钱包。可在“待核验 / 未达标”查看进度与原因。':'暂无待核验钱包。'}</div>}
    </div><div className="notice spaced">AGE 是最早已知链上活动证明的年龄下限。收益按卖出时间归入滚动 1 天 / 7 天，使用窗口前买入成本；不计未实现浮盈。历史、成本或 SOL 口径不完整则不验证。标签不会回填到过去的信号。</div>
  </>;
}
