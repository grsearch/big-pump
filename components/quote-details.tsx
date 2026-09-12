const mode=(t:any)=>t.launchMode==='reward'?'Reward 奖励模式':t.launchMode==='standard'?'Standard 普通模式':'模式待获取';
const tax=(n:any)=>Number.isFinite(n)?`${n/100}%`:'待获取';
export function QuoteSummary({token:t}:any){return <small>Quote {t.quoteSymbol??'待获取'} · {mode(t)} · 税 {tax(t.transferFeeBps)}（平台）</small>;}
export default function QuoteDetails({token:t}:any){return <div className="detail-box">
 <h2>配对资产与奖励</h2>
 <p>Quote：{t.quoteSymbol??'名称待获取'} {t.quoteName&&t.quoteName!==t.quoteSymbol?`· ${t.quoteName}`:''} · {t.quoteCategoryLabel??t.quoteCategory??'分类待获取'}（平台分类）</p>
 <p className="full-ca">{t.quoteMint?<a href={'https://gmgn.ai/sol/token/'+encodeURIComponent(t.quoteMint)} target="_blank" rel="noopener noreferrer">{t.quoteMint} ↗</a>:'Quote CA 待核验'}</p>
 {t.quoteMetadataMismatch&&<p className="amber">平台 Quote 与链上不一致，已隐藏平台配对标签。</p>}
 <p>{mode(t)} · 平台转账税 {tax(t.transferFeeBps)}</p>
 <p>链上代币税 {tax(t.execution?.baseFee?.bps)} · 链上 Quote 税 {tax(t.execution?.quoteFee?.bps)}{t.execution?.at?` · 核验于 ${new Date(t.execution.at).toLocaleString('zh-CN')}`:''}</p>
 <p>仅收 Quote 侧费用：{t.quoteOnlyFees==null?'待获取':t.quoteOnlyFees?'是':'否'}（平台标志）</p>
 <p>奖励资产 / 分发地址 / 已发金额 / 接收人数：待核验</p>
 <p className="muted">Reward 表示平台奖励模式，不代表已经发奖。尚未接入分发历史核验；未知不会记为零。转账税不等于奖励比例或交易总费用。</p>
 {t.metadataAt&&<small>平台资料更新：{new Date(t.metadataAt).toLocaleString('zh-CN')}</small>}
 </div>;}
