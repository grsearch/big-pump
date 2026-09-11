import {PUMP,decodeMigration} from './providers.mjs';
const KEY='pump-backfill';
// Separate persisted anchor: live migrations must not move an unfinished scan.
export class PumpBackfill {
 constructor(worker){this.w=worker;this.busy=false;}
 begin(){
  const s=this.w.s,old=s.get('config',KEY);
  if(old&&!old.done){this.describe(old);return;}
  const anchor=s.get('config','migrationCursor')?.signature;
  if(!anchor){this.w.status.pumpBackfill='无历史游标 · 从现在开始';return;}
  const job={anchor,startedAt:Date.now(),cutoffAt:Date.now()-86400000,pages:0,processed:0,pending:[],nextAt:0,failures:0,done:false};
  s.put('config',KEY,job);this.describe(job);
 }
 describe(j){this.w.status.pumpBackfill=j.capped?'补漏达到本轮页数上限 · 仍有缺口':j.done?(j.expired?'已补查至 24 小时边界':'本轮补漏完成'):j.failures?`补漏失败 · ${Math.max(0,Math.ceil((j.nextAt-Date.now())/1000))} 秒后重试 · 已处理 ${j.processed} 笔`:`补漏中 · ${j.pages} 页 / ${j.processed} 笔`;}
 resume(){const j=this.w.s.get('config',KEY);if(!j||j.done){this.begin();return;}j.capped=false;j.nextAt=0;j.failures=0;j.pageLimit=j.pages+50;this.w.s.put('config',KEY,j);this.describe(j);}
 async tick(){
  const w=this.w,s=w.s,j=s.get('config',KEY);
  if(this.busy||!w.running||!w.rpc||!j||j.done||j.capped)return;
  this.describe(j);if(Date.now()<j.nextAt)return;
  this.busy=true;
  try{
   if(!j.pending.length){
    if(j.pages>=(j.pageLimit??50)){j.capped=true;s.put('config',KEY,j);this.describe(j);return;}
    const rows=await w.rpc('getSignaturesForAddress',[PUMP,{until:j.anchor,...(j.before?{before:j.before}:{}),limit:100,commitment:'confirmed'}]);
    if(!w.running)return;
    if(!Array.isArray(rows)||rows.some(r=>typeof r.signature!=='string'))throw Error('无效签名列表');
    j.head??=rows[0]?.signature;j.pages++;j.before=rows.at(-1)?.signature;
    const boundary=rows.findIndex(r=>r.signature===j.anchor||(Number.isFinite(r.blockTime)&&r.blockTime*1000<j.cutoffAt));
    j.expired=boundary>=0&&rows[boundary].signature!==j.anchor;
    j.pending=(boundary>=0?rows.slice(0,boundary):rows).filter(r=>!r.err);
    j.lastPage=rows.length<100||boundary>=0;
    // Persist fetched page before any transaction RPC. Null/error retries same item.
    s.put('config',KEY,j);
   }
   for(let count=0;count<5&&j.pending.length;count++){
    const item=j.pending[0];
    const tx=await w.rpc('getTransaction',[item.signature,{encoding:'json',maxSupportedTransactionVersion:0,commitment:'confirmed'}]);
    if(!w.running)return;
    if(!tx?.meta)throw Error('交易暂不可用');
    if(!tx.meta.err){const found=decodeMigration(tx.meta.logMessages);if(found)w.enroll(found);}
    j.pending.shift();j.processed++;s.put('config',KEY,j);
   }
   j.failures=0;j.nextAt=Date.now()+5000;
   if(!j.pending.length&&j.lastPage){
    j.done=true;j.completedAt=Date.now();
    const cursor=s.get('config','migrationCursor');
    // Only advance if no newer live event has moved the anchor meanwhile.
    if(j.head&&cursor?.signature===j.anchor)s.put('config','migrationCursor',{signature:j.head,at:Date.now()});
   }
   s.put('config',KEY,j);this.describe(j);
  }catch(e){
   if(!w.running)return;
   j.failures=(j.failures??0)+1;j.nextAt=Date.now()+Math.max(Math.min(300000,15000*2**Math.min(j.failures-1,5)),Number.isFinite(e.retryAfter)?Math.max(0,e.retryAfter*1000):0);
   // Do not retain provider URLs, payloads, keys or unsanitized exception text.
   j.error=e.status?`HTTP ${Number(e.status)}`:'RPC 请求或交易数据暂不可用';
   s.put('config',KEY,j);this.describe(j);if(j.failures===1)s.event('gap','Pump 补漏暂时失败，已保存进度并安排自动重试');
  }finally{this.busy=false;}
 }
}
