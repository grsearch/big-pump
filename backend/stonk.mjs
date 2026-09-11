import {createHash} from 'node:crypto';
import {jsonFetch} from './providers.mjs';

export const LAUNCHLAB='LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj';
export const CPMM='CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';
export const STONK_CONFIGS=['6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt','4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7'];
const discriminator=createHash('sha256').update('global:migrate_to_cpswap').digest().subarray(0,8);
const address=x=>typeof x==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x);
export const MAX_GRADUATION_DELAY_MS=20*60000;
export function fastGraduation(createdAt,graduatedAt){return Number.isFinite(createdAt)&&Number.isFinite(graduatedAt)&&createdAt>0&&graduatedAt>=createdAt&&graduatedAt-createdAt<=MAX_GRADUATION_DELAY_MS;}
// Raydium SDK initialize / initializeV2 / initializeWithToken2022 account order.
const initializers=['initialize','initialize_v2','initialize_with_token_2022'].map(name=>createHash('sha256').update('global:'+name).digest().subarray(0,8));
export function decodeStonkCreation(tx,now=Date.now()){
 if(!tx?.meta||tx.meta.err||!Number.isFinite(tx.blockTime)||tx.blockTime<=0||tx.blockTime*1000>now)return null;
 const m=tx.transaction?.message;if(!m)return null;
 const keys=[...(m.accountKeys??[]).map(x=>typeof x==='string'?x:x.pubkey),...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];
 for(const ix of [...(m.instructions??[]),...(tx.meta.innerInstructions??[]).flatMap(x=>x.instructions??[])]){
  if((ix.programId??keys[ix.programIdIndex])!==LAUNCHLAB)continue;
  const data=decode58(ix.data);if(!data||!initializers.some(d=>data.subarray(0,8).equals(d)))continue;
  const a=(ix.accounts??[]).map(x=>typeof x==='number'?keys[x]:x);
  if(a.length<15||!STONK_CONFIGS.includes(a[3])||![a[5],a[6],a[7]].every(address))continue;
  return {ca:a[6],curvePool:a[5],quoteMint:a[7],platformConfig:a[3],createdAt:tx.blockTime*1000,creationVerified:true};
 }return null;
}
function decode58(s){if(typeof s!=='string'||s.length>4096)return null;let n=0n;for(const c of s){const i='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'.indexOf(c);if(i<0)return null;n=n*58n+BigInt(i);}let h=n.toString(16);if(h.length%2)h='0'+h;return Buffer.concat([Buffer.alloc(s.match(/^1*/)[0].length),n?Buffer.from(h,'hex'):Buffer.alloc(0)]);}
// Decode only a successful, confirmed transaction; include v0 lookup-table accounts.
export function decodeStonkMigration(tx,now=Date.now(),maxAgeMs=86400000){
 if(!tx||!tx.meta||tx.meta.err||!Number.isFinite(tx.blockTime))return null;
 const at=tx.blockTime*1000;if(at>now||now-at>=maxAgeMs)return null;
 const message=tx.transaction?.message;if(!message)return null;
 const keys=[...(message.accountKeys??[]).map(x=>typeof x==='string'?x:x.pubkey),...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];
 const instructions=[...(message.instructions??[]),...(tx.meta.innerInstructions??[]).flatMap(x=>x.instructions??[])];
 for(const ix of instructions){const program=ix.programId??keys[ix.programIdIndex];if(program!==LAUNCHLAB)continue;const data=decode58(ix.data);if(!data||!data.subarray(0,8).equals(discriminator))continue;
  const a=(ix.accounts??[]).map(x=>typeof x==='number'?keys[x]:x);if(a.length<18||!STONK_CONFIGS.includes(a[3])||a[4]!==CPMM||![a[1],a[2],a[5],a[17]].every(address))continue;
  return {ca:a[1],quoteMint:a[2],pool:a[5],curvePool:a[17],platformConfig:a[3],graduatedAt:at,source:'stonk',migrationVerified:true};
 }return null;
}
export function stonkCandidate(t,now=Date.now()){
 const at=Date.parse(t?.graduatedAt);if(t?.launchpad!=='launchlab'||t.status!=='graduated'||!address(t.mint)||!address(t.pool)||!Number.isFinite(at)||at>now||now-at>=86400000)return null;
 const createdAt=Date.parse(t.createdAt);
 const bps=t.transferFee?.bps;
 return {ca:t.mint,pool:t.pool,createdAt,reportedGraduatedAt:at,symbol:t.symbol,name:t.name,quoteMint:t.quote?.mint,quoteSymbol:t.quote?.symbol??'未知',transferFeeBps:Number.isInteger(bps)&&bps>=0&&bps<=10000?bps:t.mode==='standard'?0:null,mode:t.mode??'unknown',links:t.links??{},market:t.market??{}};
}
export class StonkDiscovery{
 constructor(worker){this.w=worker;this.s=worker.s;this.nextPoll=0;this.nextVerify=0;this.status='等待启动';
  if(!this.s.get('config','stonk-chain-time-v1')){
   this.s.db.prepare("DELETE FROM records WHERE kind='stonk-exclusion'").run();
   for(const c of this.s.all('stonk-candidate'))if(!this.s.get('token',c.ca))this.s.put('stonk-candidate',c.ca,{...c,before:null,checkedAt:0,exhaustedAt:null,pending:[]});
   for(const x of this.s.all('stonk-signature'))if(Date.now()-x.at<86400000)this.s.put('stonk-signature',x.signature,{...x,done:false,tries:0,checkedAt:0});
   this.s.put('config','stonk-chain-time-v1',{at:Date.now()});
  }
 }
 enabled(){return this.w.env.ENABLE_STONK==='true';}
 async marketPair(t){
  if(!this.enabled()||t.source!=='stonk'||!t.migrationVerified)return null;
  const j=await jsonFetch('https://www.stonkfun.xyz/api/public/v1/tokens/'+encodeURIComponent(t.ca));
  const row=j.data?.token??j.data;const at=Date.parse(j.meta?.generatedAt),now=Date.now();
  if(!row||row.mint!==t.ca||(row.pool!==t.pool&&row.pool!==t.curvePool)||row.status!=='graduated'||!Number.isFinite(at)||at>now||now-at>60000)return null;
  const m=row.market;if(!m||!Number.isFinite(m.fdvUsd)||!Number.isFinite(m.liquidityUsd)||!(m.priceUsd>0))return null;
  return {chainId:'solana',pairAddress:t.pool,baseToken:{address:t.ca,symbol:row.symbol,name:row.name},fdv:m.fdvUsd,liquidity:{usd:m.liquidityUsd},priceUsd:m.priceUsd,_source:'Stonk 官方 USD 行情',_at:at};
 }
 enqueue(signature){if(!this.enabled()||!signature||this.s.get('stonk-signature',signature))return;this.s.put('stonk-signature',signature,{signature,at:Date.now(),tries:0});}
 async confirm(signature){
  const tx=await this.w.rpc('getTransaction',[signature,{encoding:'json',maxSupportedTransactionVersion:0,commitment:'confirmed'}]);if(!tx)return false;
  const creation=decodeStonkCreation(tx);if(creation)this.s.put('stonk-creation',creation.ca,{...creation,signature});
  const found=decodeStonkMigration(tx);if(!found||this.s.get('token',found.ca)||this.s.get('stonk-exclusion',found.ca))return true;
  this.s.put('stonk-verified-migration',found.ca,{...found,signature});
  if(!this.s.get('stonk-candidate',found.ca))this.s.put('stonk-candidate',found.ca,{ca:found.ca,pool:found.curvePool,quoteMint:found.quoteMint,reportedGraduatedAt:found.graduatedAt,creationCheck:'等待链上创建时间'});
  let c=this.s.get('stonk-creation',found.ca);
  if(!c||c.curvePool!==found.curvePool||c.quoteMint!==found.quoteMint||c.platformConfig!==found.platformConfig){
   const r=await this.w.rpc('getTransactionsForAddress',[found.curvePool,{transactionDetails:'signatures',sortOrder:'asc',limit:10,commitment:'confirmed',filters:{status:'succeeded'}}]);
   if(!Array.isArray(r?.data))throw Error('链上创建时间查询失败');
   c=null;for(const x of r.data){const init=await this.w.rpc('getTransaction',[x.signature,{encoding:'json',maxSupportedTransactionVersion:0,commitment:'confirmed'}]);if(!init)throw Error('创建交易暂不可用');const decoded=decodeStonkCreation(init);if(decoded?.ca===found.ca&&decoded.curvePool===found.curvePool&&decoded.quoteMint===found.quoteMint&&decoded.platformConfig===found.platformConfig){c={...decoded,signature:x.signature};this.s.put('stonk-creation',found.ca,c);break;}}
  }
  if(!c){this.s.event('filter','暂未入监控：迁移已验证，链上创建时间待核验',found.ca);return false;}
  const createdAt=c.createdAt;
  if(!fastGraduation(createdAt,found.graduatedAt)){
   this.s.put('stonk-exclusion',found.ca,{ca:found.ca,createdAt,graduatedAt:found.graduatedAt,reason:'创建至毕业超过 20 分钟，或时间无效'});
   this.s.event('filter','未入监控：创建至毕业超过 20 分钟，或时间无效',found.ca);return true;
  }
  this.enroll({...found,createdAt,creationVerified:true,creationSignature:c.signature,creationTimeSource:'链上 LaunchLab 初始化'},signature);return true;
 }
 enroll(found,signature){if(!found.creationVerified||!fastGraduation(found.createdAt,found.graduatedAt)||this.s.get('token',found.ca))return;const c=this.s.get('stonk-candidate',found.ca);this.w.enroll(found,null);const t=this.s.get('token',found.ca);if(!t)return;this.s.put('token',found.ca,{...t,...found,migrationSignature:signature,...(c?this.metadata(c):{}),smartCoverage:'按实际余额变化统计；缺少历史汇率的样本不验证',shadowBlocked:'等待链上税费与计价资产行情'});this.s.event('migration','Stonk 链上迁移已验证 · 创建后 20 分钟内毕业',found.ca);this.w.analysis.shadowTick();}
 metadata(c){const x=c.links?.twitter?.match(/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/)?.[1];return {symbol:c.symbol??c.ca.slice(0,5),name:c.name??'Stonk',quoteMint:c.quoteMint,quoteSymbol:c.quoteSymbol,transferFeeBps:c.transferFeeBps,launchMode:c.mode,xAccount:x??null};}
 async pollPage(page){const j=await jsonFetch('https://www.stonkfun.xyz/api/public/v1/tokens?status=graduated&sort=newest&pageSize=100&page='+page);if(!Array.isArray(j.data?.tokens))throw Error('Stonk 响应格式无效');for(const row of j.data.tokens){const c=stonkCandidate(row);if(!c)continue;const old=this.s.get('stonk-candidate',c.ca);if(!old&&!fastGraduation(c.createdAt,c.reportedGraduatedAt))this.s.event('filter','官方创建时间异常或超时，保留候选等待链上复核',c.ca);this.s.put('stonk-candidate',c.ca,{...old,...c,seenAt:Date.now()});const t=this.s.get('token',c.ca);if(t?.source==='stonk'){this.s.put('token',c.ca,{...t,...this.metadata(c),xAccount:t.xAccount??this.metadata(c).xAccount});}}
 return Math.max(1,Number(j.data?.pagination?.totalPages)||1);}
 async tick(){if(this.busy)return;this.busy=true;try{await this.run();}finally{this.busy=false;}}
 async run(){if(!this.enabled()){this.status='未开启';return;}if(!this.w.rpc){this.status='需要 Helius 核验迁移';return;}const now=Date.now();
  if(now>=this.nextPoll){this.nextPoll=now+60000;try{const pages=await this.pollPage(1);const cursor=this.s.get('config','stonk-pages')?.page??2;if(pages>1)await this.pollPage(Math.min(cursor,pages));this.s.put('config','stonk-pages',{page:cursor>=pages?2:cursor+1});this.status='已连接 · 毕业候选等待链上核验';}catch(e){this.nextPoll=now+Math.max(60000,(e.retryAfter??60)*1000);this.status='Stonk 列表请求失败，稍后重试';}}
  if(now<this.nextVerify)return;this.nextVerify=now+5000;
  const sig=this.s.all('stonk-signature').find(x=>!x.done&&x.tries<5&&now-x.at<86400000&&now-(x.checkedAt??0)>30000);
  if(sig){try{const done=await this.confirm(sig.signature);this.s.put('stonk-signature',sig.signature,{...sig,done,tries:sig.tries+1,checkedAt:now});}catch{this.s.put('stonk-signature',sig.signature,{...sig,tries:sig.tries+1,checkedAt:now});}return;}
  const c=this.s.all('stonk-candidate').filter(x=>!this.s.get('token',x.ca)&&!this.s.get('stonk-exclusion',x.ca)&&now-x.reportedGraduatedAt<86400000&&now-(x.checkedAt??0)>(x.pending?.length?5000:60000)&&(!x.exhaustedAt||now-x.exhaustedAt>300000)).sort((a,b)=>(a.checkedAt??0)-(b.checkedAt??0))[0];if(!c)return;
  // Bounded historical verification, persisted pagination: no inferred graduation timestamp.
  try{
   const known=this.s.get('stonk-verified-migration',c.ca);if(known){await this.confirm(known.signature);this.s.put('stonk-candidate',c.ca,{...this.s.get('stonk-candidate',c.ca),checkedAt:now});return;}
   let state=c;
   if(!state.pending?.length){const opts={limit:100,commitment:'confirmed',...(c.before?{before:c.before}:{})};const sigs=await this.w.rpc('getSignaturesForAddress',[c.pool,opts]);
    const pending=sigs.filter(x=>!x.err&&x.blockTime&&Math.abs(x.blockTime*1000-c.reportedGraduatedAt)<300000).map(x=>x.signature);
    const end=sigs.length<100||sigs.at(-1)?.blockTime*1000<c.reportedGraduatedAt-300000;
    state={...state,pending,nextBefore:end?null:sigs.at(-1)?.signature,pageEnd:end};this.s.put('stonk-candidate',c.ca,state);
   }
   for(const signature of state.pending.slice(0,3)){if(!await this.confirm(signature))break;state={...state,pending:state.pending.slice(1)};this.s.put('stonk-candidate',c.ca,state);if(this.s.get('token',c.ca)||this.s.get('stonk-exclusion',c.ca))break;}
   this.s.put('stonk-candidate',c.ca,{...state,checkedAt:now,...(!state.pending.length?{before:state.nextBefore,exhaustedAt:state.pageEnd?now:null}:{})});
  }catch{this.s.put('stonk-candidate',c.ca,{...this.s.get('stonk-candidate',c.ca),checkedAt:now});this.status='迁移或创建时间核验暂不可用，将重试';}
 }
}
