import {jsonFetch} from './providers.mjs';
import {decodeStonkMigration} from './stonk.mjs';

export const HISTORY_MIN_FDV=1_000_000;
const key='stonk-history', address=x=>typeof x==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x);
export function historyCandidate(t,now=Date.now()){
 const at=Date.parse(t?.graduatedAt);
 if(t?.launchpad!=='launchlab'||t.status!=='graduated'||!address(t.mint)||!address(t.pool)||!Number.isFinite(at)||at>now||!(t.market?.fdvUsd>=HISTORY_MIN_FDV))return null;
 return {ca:t.mint,symbol:t.symbol,reportedGraduatedAt:at,pool:t.pool,fdvUsd:t.market.fdvUsd,marketAt:now,phase:'verify',pages:0};
}
// Research records never enter the observation/live-trading token table.
export class StonkHistory {
 constructor(worker,fetchJson=jsonFetch){this.w=worker;this.s=worker.s;this.fetch=fetchJson;this.busy=false;this.nextAt=0;}
 snapshot(){const job=this.s.get('config',key);return {job,tokens:this.s.all('history-token').filter(t=>t.runId===job?.id).sort((a,b)=>b.fdvUsd-a.fdvUsd),buyers:this.s.all('history-buyer').filter(t=>t.runId===job?.id).length};}
 control(action){
  if(this.busy)throw Error('正在保存扫描页，请稍后操作');
  let j=this.s.get('config',key);
  if(action==='start'){
   if(j?.status==='running')return this.snapshot();
   if(!this.w.rpc)throw Error('请先配置 Helius');
   j={id:Date.now(),status:'running',stage:'list',page:1,minFdvUsd:HISTORY_MIN_FDV,startedAt:Date.now(),seen:0};
  }else if(action==='pause'&&j)j={...j,status:'paused'};
  else if(action==='resume'&&j){
   if(!this.w.rpc)throw Error('请先配置 Helius');
   for(const t of this.s.all('history-token').filter(t=>t.runId===j.id&&t.phase==='capped'))this.s.put('history-token',t.ca,{...t,phase:t.resumePhase,pages:0});
   j={...j,status:'running',error:null};
  }else throw Error('历史扫描操作无效');
  this.s.put('config',key,j);this.nextAt=0;return this.snapshot();
 }
 async tick(){
  if(this.busy||Date.now()<this.nextAt)return;
  const j=this.s.get('config',key);if(j?.status!=='running'||!this.w.rpc)return;
  this.busy=true;this.nextAt=Date.now()+10000;let current=null;
  try{
   if(j.stage==='list')await this.list(j);
   else {const rows=this.s.all('history-token').filter(t=>t.runId===j.id);const t=rows.filter(t=>['verify','pool','curve'].includes(t.phase)).sort((a,b)=>(a.checkedAt??0)-(b.checkedAt??0))[0];
    if(t){current=t;await this.coin(t);}else this.s.put('config',key,{...j,status:rows.some(t=>t.phase==='capped')?'capped':'complete',finishedAt:Date.now()});
   }
   const latest=this.s.get('config',key);this.s.put('config',key,{...latest,error:null});
  }catch{if(current)this.s.put('history-token',current.ca,{...this.s.get('history-token',current.ca),checkedAt:Date.now()});this.s.put('config',key,{...this.s.get('config',key),error:'历史数据请求失败，30 秒后重试；进度已保留'});this.nextAt=Date.now()+30000;}
  finally{this.busy=false;}
 }
 async list(j){
  const r=await this.fetch('https://www.stonkfun.xyz/api/public/v1/tokens?status=graduated&sort=newest&pageSize=100&page='+j.page);
  const p=r.data?.pagination,rows=r.data?.tokens;
  if(!Array.isArray(rows)||!Number.isInteger(p?.totalPages)||p.totalPages<1||p.totalPages>1000)throw Error('分页无效');
  for(const row of rows){const c=historyCandidate(row);if(!c)continue;const old=this.s.get('history-token',c.ca);if(old?.runId!==j.id)this.s.put('history-token',c.ca,{...c,runId:j.id});}
  this.s.put('config',key,{...j,page:j.page+1,totalPages:p.totalPages,reportedTotal:p.total,seen:j.seen+rows.length,stage:j.page>=p.totalPages?'coins':'list'});
 }
 async signatures(t,account,start,end){
  const r=await this.w.rpc('getTransactionsForAddress',[account,{transactionDetails:'signatures',sortOrder:'asc',limit:20,commitment:'finalized',...(t.cursor?{paginationToken:t.cursor}:{}),filters:{status:'succeeded',blockTime:{gte:Math.floor(start/1000),lte:Math.ceil(end/1000)}}}]);
  if(!Array.isArray(r?.data)||r.data.some(x=>typeof x.signature!=='string'))throw Error('历史签名无效');
  if(r.paginationToken&&r.paginationToken===t.cursor)throw Error('游标未推进');
  return r;
 }
 async coin(t){
  if(t.phase==='verify'){
   // Persist a page before examining its transactions, one transaction per tick.
   if(!t.pending?.length){const r=await this.signatures(t,t.pool,t.reportedGraduatedAt-300000,t.reportedGraduatedAt+300000);t={...t,pending:r.data.map(x=>x.signature),nextCursor:r.paginationToken??null};}
   if(t.pending.length){const signature=t.pending[0],tx=await this.w.rpc('getTransaction',[signature,{encoding:'json',maxSupportedTransactionVersion:0,commitment:'finalized'}]);if(!tx)throw Error('交易暂不可用');
    const found=decodeStonkMigration(tx,Date.now(),Infinity);
    if(found&&found.ca===t.ca&&found.pool===t.pool){this.s.put('history-reference',t.ca,{...found,symbol:t.symbol});this.s.put('history-token',t.ca,{...t,...found,phase:'pool',pages:0,cursor:null,pending:[],checkedAt:Date.now()});return;}
    t={...t,pending:t.pending.slice(1)};
   }
   if(t.pending.length){this.s.put('history-token',t.ca,{...t,checkedAt:Date.now()});return;}
   this.advance(t,t.nextCursor,'unverified');return;
  }
  const curve=t.phase==='curve',r=await this.signatures(t,curve?t.curvePool:t.pool,curve?t.graduatedAt-600000:t.graduatedAt,curve?t.graduatedAt:t.graduatedAt+600000);
  if(r.data.length){
   const signatures=r.data.map(x=>x.signature);
   const txs=await this.fetch('https://api.helius.xyz/v0/transactions/?api-key='+encodeURIComponent(this.w.env.HELIUS_API_KEY),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({transactions:signatures})});
   if(!Array.isArray(txs)||signatures.some(sig=>!txs.some(tx=>tx.signature===sig)))throw Error('交易解析不完整');
   const grads=new Map(this.s.researchTokens().map(x=>[x.ca,x.graduatedAt]));
   for(const tx of txs){for(const tr of this.w.parseTrades(tx,grads)){
    if(tr.ca!==t.ca||tr.side!=='buy'||tr.at<t.graduatedAt-600000||tr.at>t.graduatedAt+600000)continue;
    this.w.saveTrade(tr);this.s.put('history-buyer',t.ca+':'+tr.wallet,{runId:t.runId,ca:t.ca,address:tr.wallet,at:tr.at,signature:tr.id});this.w.assess(tr.wallet);
   }}
  }
  this.advance(t,r.paginationToken,curve?'done':'curve');
 }
 advance(t,cursor,donePhase){const pages=t.pages+1;this.s.put('history-token',t.ca,{...t,checkedAt:Date.now(),pending:[],nextCursor:null,cursor:cursor??null,pages:cursor?pages:0,phase:cursor?(pages>=50?'capped':t.phase):donePhase,resumePhase:t.phase});}
}
