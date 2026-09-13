'use client';
const money=(v:number|null)=>v==null?'—':'$'+v.toLocaleString('en-US',{maximumFractionDigits:2});
export default function TokenFlow({token}:any){
 const f=token?.flow;
 return <section className="detail-box"><h2>成交资金与持有人 · 1 分钟</h2>
 <p className="muted">成交账户新增持仓按本笔涉及账户余额从零变正核验（不代表钱包其他账户没有持仓）；首次观察买家不等于新增持有人；以下为可解析样本，未覆盖全市场。大额卖出定义：单笔 ≥ $500。</p>
 {!f?<p>等待成交样本。</p>:<><p>{f.sampleCount} 笔样本 · {f.coverage?.before?'正在补齐历史页':f.coverage?.caughtUpAt?'已完成一轮扫描':'等待扫描'} · 未解析交换 {f.coverage?.unsupported??0} 笔{f.coverage?.error?' · '+f.coverage.error:''}</p>
 <div style={{overflowX:'auto',maxHeight:420}}><table><thead><tr><th>分钟</th><th>成交账户新增持仓</th><th>首次观察买家 / 买入额</th><th>买入 / 卖出</th><th>净买入</th><th>大额卖出</th><th>Holders</th><th>价格变化</th></tr></thead><tbody>{f.bars.slice().reverse().map((b:any)=><tr key={b.at}><td>{new Date(b.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</td><td>{b.newHolderBuys} 笔 / {money(b.newHolderBuyUsd)}<small> · {b.holderUnknown} 笔余额待核验</small></td><td>{b.firstObservedBuyers} / {money(b.firstObservedBuyerUsd)}</td><td>{money(b.buyUsd)} / {money(b.sellUsd)}{b.unpriced>0&&<small> · {b.unpriced} 笔缺汇率，金额不完整</small>}</td><td>{money(b.netUsd)}</td><td>{b.largeSells} 笔 / {money(b.largeSellUsd)}</td><td>{b.holders??'—'}</td><td>{b.priceStart&&b.priceEnd?((b.priceEnd/b.priceStart-1)*100).toFixed(1)+'%':'—'}</td></tr>)}</tbody></table></div>
 {!f.bars.length&&<p>尚无可解析成交；不能视为没有交易。</p>}<p className="muted">{f.note} 价格变化为本分钟首末采样价，不是收益率。没有成交样本的分钟不填零；后补历史可能修正首次观察买家。</p></>}
 </section>;
}
