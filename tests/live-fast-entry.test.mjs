import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../backend/store.mjs';
import {LiveTrading,liveCEntry} from '../backend/live-trading.mjs';
import {ENTRY_POLICY} from '../backend/live-entry.mjs';
const now=1800000000000;
function setup(){
 const s=new Store(':memory:');let at=now,sends=0;
 const wallet={address:'wallet',prepare:async()=>({signature:'fake',signedTransaction:'fake'}),execute:async()=>{sends++;return {message:'mock'};},receipt:async()=>null};
 const jupiter={status:()=>({}),order:async()=>({otherAmountThreshold:'1000',outAmount:'1100',receivedAt:at,requestId:'mock'})};
 const e=new LiveTrading(s,{ENABLE_LIVE_TRADING:'true'},null,{wallet,jupiter,clock:()=>at});e.control('start');
 const t={ca:'coin',source:'stonk',migrationVerified:true,creationVerified:true,createdAt:now-60000,graduatedAt:now,verifiedAt:now,status:'observing',priceUsd:100,marketAt:now,history:[{at:now,priceUsd:1}]};s.put('live-signal',t.ca,t);
 return {s,e,t,wallet,jupiter,set:n=>at=n,sends:()=>sends};
}
test('20 second deadline uses migration, not detection, with no price-rise cap',async()=>{
 const f=setup();try{assert(liveCEntry(f.t,f.e.state(),now+20000));assert(!liveCEntry({...f.t,verifiedAt:now+19000},f.e.state(),now+20001));assert.equal(ENTRY_POLICY.maxRisePct,undefined);await f.e.tick(true);assert.equal(f.sends(),1);}finally{f.s.close();}
});
test('fast retry intervals and six-attempt limit remain bounded',async()=>{
 const f=setup();try{
  f.jupiter.order=async()=>{throw Object.assign(Error('timeout'),{retryable:true});};let at=now;
  for(let n=1;n<=6;n++){f.set(at);await f.e.tick(true);const o=f.s.all('live-order')[0];assert.equal(o.attempts,n);
   if(n<6){assert.equal(o.status,'retrying');assert.equal(o.nextAttemptAt-at,[300,600,1000][Math.min(n-1,2)]);at=o.nextAttemptAt;}else assert.equal(o.status,'skipped');}
  assert.equal(f.sends(),0);
 }finally{f.s.close();}
});
test('server Retry-After beyond deadline stops chasing',async()=>{
 const f=setup();try{f.jupiter.order=async()=>{throw Object.assign(Error('rate'),{retryable:true,retryAt:now+21000});};await f.e.tick(true);assert.equal(f.s.all('live-order')[0].status,'skipped');}finally{f.s.close();}
});
test('deadline crossed during preparation prevents broadcast',async()=>{
 const f=setup();try{f.wallet.prepare=async()=>{f.set(now+20001);return {signature:'mock',signedTransaction:'mock'};};await f.e.tick(true);assert.equal(f.sends(),0);assert.equal(f.s.all('live-order')[0].status,'skipped');}finally{f.s.close();}
});
