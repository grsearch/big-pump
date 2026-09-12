import {setImmediate as yieldTurn} from 'node:timers/promises';
import {heat} from '../lib/engine.ts';

// A shared short-lived serialized snapshot coalesces tabs/clients. Building it
// yields between tokens so migration callbacks can run; no cleanup writes here.
export class Dashboard {
 constructor(store,worker,live,env){this.s=store;this.w=worker;this.live=live;this.env=env;this.heatCache=new Map();}
 async json(){
  if(this.pending)return this.pending;
  if(this.cached&&Date.now()-this.cachedAt<5000)return this.cached;
  this.pending=this.build().then(data=>{this.cached=JSON.stringify(data);this.cachedAt=Date.now();return this.cached;}).finally(()=>{this.pending=null;});
  return this.pending;
 }
 async build(){
  const s=this.s,w=this.w,now=Date.now(),tokens=s.summaries('token').filter(t=>!t.hidden);
  const present=new Set(tokens.map(t=>t.ca));for(const ca of this.heatCache.keys())if(!present.has(ca))this.heatCache.delete(ca);
  for(const t of tokens){
   let entry=this.heatCache.get(t.ca);
   if(!entry||entry.lastXAt!==t.lastXAt||now-entry.at>=15000){entry={lastXAt:t.lastXAt,at:now,value:heat(s.allPosts(t.ca),t.ca,now)};this.heatCache.set(t.ca,entry);}
   t.heat=entry.value;t.heatAt=entry.at;
   await yieldTurn();
  }
  const wallets=s.summaries('wallet'),coverage=s.summaries('coverage');
  const stonkPending=s.db.prepare("SELECT count(*) AS n FROM records c WHERE c.kind='stonk-candidate' AND json_extract(c.data,'$.reportedGraduatedAt')>? AND NOT EXISTS(SELECT 1 FROM records t WHERE t.kind='token' AND t.id=c.id)").get(now-86400000).n;
  return {mode:'live',now,running:w.running,status:w.status,discoveryProcess:w.discoveryStatus??null,rules:s.rules(),dayCost:s.cost(),tokens,wallets,
   stonkHistory:w.history.snapshot(),events:s.recentEvents(),stonkEnabled:w.stonk.enabled(),stonkPending,
   xEnabled:this.env.ENABLE_X==='true',xBlocked:!!s.get('config','x-block'),researchEnabled:this.env.ENABLE_WALLET_RESEARCH==='true',
   analysisStatus:w.analysis.status(),assessments:s.all('ai-latest'),liveTrading:this.live.snapshot(),
   walletDiagnostics:{total:wallets.length,verified:wallets.filter(w=>w.status==='verified').length,queued:coverage.filter(c=>c.queued).length,capped:coverage.filter(c=>c.capped).length,unsupported:coverage.filter(c=>c.unsupported).length}};
 }
 invalidate(){this.cachedAt=0;}
}
