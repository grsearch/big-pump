import test from 'node:test';
import assert from 'node:assert/strict';
import {newDiffusionRun,diffusionDefaults,diffusionStep,diffusionExit,validateDiffusionRules} from '../lib/diffusion-shadow.ts';
import {shadowStep,newShadowRun,shadowDefaults} from '../lib/shadow.ts';
import {xObservation,xSchedule} from '../lib/x-schedule.ts';
import {Worker} from '../backend/worker.mjs';
import {Store} from '../backend/store.mjs';
import {newToken} from '../lib/engine.ts';
const now=1800000000000;
const obs=(at=now,extra={})=>({at,complete:true,firstBatch:true,newAuthors:2,authors:2,clean:2,priorAuthors:0,newcomers:2,postTimes:[at-1000,at-2000],postIds:['a','b'],...extra});
const token=(extra={})=>({ca:'c',symbol:'C',status:'observing',source:'pump',graduatedAt:now-120000,enrolledAt:now-120000,marketAt:now,priceUsd:1,fdv:30000,lp:30000,history:[],xObservations:[obs()],...extra});
test('early observation produces immediate signal, never a same-snapshot fill; legacy stays legacy',()=>{
  const t=token(),run=newDiffusionRun(now-1000);
  let s=shadowStep(run,[t],new Map(),new Map(),now);
  assert.equal(s.arms[0].positions[0].status,'pending');assert.equal(s.arms[0].positions[0].signalAt,now);
  assert.equal(s.arms[0].positions[0].evidence.type,'首次发现');
  s=diffusionStep(s,[t],now+16000);assert.equal(s.arms[0].positions[0].status,'pending');
  s=diffusionStep(s,[{...t,marketAt:now+16000}],now+16000);assert.equal(s.arms[0].positions[0].status,'open');
  assert.equal(s.arms[0].cash,950);
  const old=newShadowRun(now);const before=structuredClone(old.rules);
  assert.equal(shadowStep(old,[],new Map(),new Map(),now).version,'shadow-v3');assert.deepEqual(old.rules,before);
});
test('experiments ignore past and future batches, expired signals and weak market data',()=>{
  for(const t of [token({xObservations:[obs(now-2000)]}),token({xObservations:[obs(now+1)]}),token({lp:5000}),token({marketError:'missing'})])assert.equal(diffusionStep(newDiffusionRun(now-1000),[t],now).arms[0].positions.length,0);
  const s=diffusionStep(newDiffusionRun(now-1000),[token()],now);
  assert.equal(diffusionStep(s,[token({marketAt:now+121000})],now+121000).arms[0].positions[0].status,'cancelled');
});
test('rolling-window exits do not create new authors and stale backlog cannot trigger early entry',()=>{
  const before=[{id:'old',author:'a',text:'I read the launch details and have questions',at:now-360000,receivedAt:now-360000,association:'exact'}];
  const posts=[...before,{id:'again',author:'a',text:'Token ownership needs another look',at:now-1000,receivedAt:now,association:'exact'},
    {id:'backlog',author:'b',text:'Launch economics are described clearly',at:now-180000,receivedAt:now,association:'exact'},
    {id:'fresh',author:'c',text:'The community answers technical questions',at:now-1000,receivedAt:now,association:'exact'}];
  const o=xObservation(before,posts,now,true,false);assert.equal(o.newAuthors,1);assert.deepEqual(o.postIds,['fresh']);
  assert.equal(xObservation(posts,posts,now+1000,true,false).newAuthors,0);
});
test('breakout needs two actual observations, then a later modest price breakout',()=>{
  const growing={authors:9,clean:12,priorAuthors:4,newcomers:5,newAuthors:0};
  const history=Array.from({length:13},(_,i)=>({at:now-360000+i*30000,fdv:30000}));
  const t=token({graduatedAt:now-700000,history,xObservations:[obs(now-60000,growing),obs(now,growing)]});
  let s=diffusionStep(newDiffusionRun(now-120000),[t],now);
  assert(s.arms[1].candidates.c);assert.equal(s.arms[1].positions.length,0);
  const risen={...t,fdv:30300,priceUsd:1.01,marketAt:now+30000,history:[...history,{at:now+30000,fdv:30300}]};
  s=diffusionStep(s,[risen],now+30000);assert.equal(s.arms[1].positions[0].status,'pending');
  assert.equal(diffusionStep(newDiffusionRun(now-120000),[{...t,xObservations:[obs(now,growing)]}],now).arms[1].candidates.c,undefined);
  assert.equal(diffusionStep(newDiffusionRun(now-120000),[{...t,xObservations:[obs(now-60000,{...growing,complete:false}),obs(now,growing)]}],now).arms[1].candidates.c,undefined);
});
test('net liquidation activates at +20%, trails high by 5%, fixed TP and SL exit all',()=>{
  const r={...diffusionDefaults,slippage:0,fee:0,fixedCostUsd:0},t=token({lp:1e20});
  const p={openedAt:now,cost:100,quantity:100,highValue:0};
  assert.equal(diffusionExit(p,{...t,priceUsd:1.21},r,now),null);assert.equal(p.trailingActive,true);
  diffusionExit(p,{...t,priceUsd:1.3},r,now);
  assert.equal(diffusionExit(p,{...t,priceUsd:1.23},r,now).reason,'移动止盈');
  assert.equal(diffusionExit({...p},{...t,priceUsd:1.51},r,now).reason,'固定止盈');
  assert.equal(diffusionExit({...p},{...t,priceUsd:.84},r,now).reason,'固定止损');
  assert.equal(diffusionExit({openedAt:now,cost:100,quantity:100},{...t,priceUsd:1.1},r,now),null);
});
test('30-minute timer queues exit without market; fill waits for fresh delayed quote',()=>{
  const t=token();let s=diffusionStep(newDiffusionRun(now-1000),[t],now);
  s=diffusionStep(s,[{...t,marketAt:now+15000}],now+15000);
  const at=now+15000+1800000;
  s=diffusionStep(s,[t],at);assert(s.arms[0].positions[0].pendingExit);assert.equal(s.arms[0].positions[0].unpriced,true);
  s=diffusionStep(s,[{...t,priceUsd:.5,marketAt:at+15000}],at+15000);assert.equal(s.arms[0].positions[0].status,'closed');assert(s.arms[0].positions[0].realized<0);
});
test('scheduler caps boost pool, expires boost and respects absence of tradable market',()=>{
  const many=Array.from({length:8},(_,i)=>token({ca:String(i),xBoostUntil:now+180000,xNewAuthorAt:now-i}));
  assert.equal(xSchedule(many,now,10000).filter(x=>x.interval===15000).length,5);
  assert.equal(xSchedule([token({enrolledAt:now-600000,xObservations:[obs(now,{authors:0})]})],now,10000)[0].interval,120000);
  assert.equal(xSchedule([token({enrolledAt:now-600000})],now,10000)[0].interval,60000);
  assert.equal(xSchedule([token({fdv:9999})],now,10000).length,0);
});
test('X is serialized and transient reserved budget does not prematurely sleep a token',async t=>{
  const s=new Store(':memory:'),w=new Worker(s,{X_BEARER_TOKEN:'test',ENABLE_X:'true'}),at=Date.now();w.running=true;
  const coin={...newToken('11111111111111111111111111111111','p',at-60000,at-60000),fdv:30000,lp:30000,marketAt:at};s.put('token',coin.ca,coin);
  let release,calls=0;const response=new Promise(resolve=>{release=resolve;});t.mock.method(globalThis,'fetch',async()=>{calls++;return response;});
  const first=w.xPoll();await w.xPoll();assert.equal(calls,1);
  const reserved=s.get('token',coin.ca);assert.equal(reserved.cost,.5);assert.equal(w.transitionToken(reserved,s.rules(),Date.now(),0).status,'observing');
  release(Response.json({data:[]}));await first;assert.equal(s.get('token',coin.ca).xReservedCost,0);assert.equal(s.cost(),0);s.close();
});
test('new rule validation and defaults match requested exits',()=>{
  assert.equal(validateDiffusionRules(diffusionDefaults).maxHoldHours,.5);
  assert.throws(()=>validateDiffusionRules({...diffusionDefaults,takeProfit:.1}));
  assert.equal(shadowDefaults.maxHoldHours,6);
});
test('real X ingestion timestamps drive new Shadow signals without waiting for main worker tick',async t=>{
  const s=new Store(':memory:'),w=new Worker(s,{X_BEARER_TOKEN:'test',ENABLE_X:'true'}),at=Date.now();w.running=true;
  const ca='11111111111111111111111111111111';s.put('token',ca,{...newToken(ca,'p',at-60000,at-60000),fdv:30000,lp:30000,priceUsd:1,marketAt:at});
  const run=newDiffusionRun(at-1000);s.put('shadow-run',run.id,run);s.put('config','shadow-active',{id:run.id});
  t.mock.method(globalThis,'fetch',async()=>Response.json({data:[
    {id:'one',author_id:'alice',text:ca+' I reviewed how the community manages the project',created_at:new Date(at-1000).toISOString()},
    {id:'two',author_id:'bob',text:ca+' Questions remain about liquidity ownership and governance',created_at:new Date(at-1000).toISOString()}
  ],meta:{newest_id:'two'}}));
  await w.xPoll();const coin=s.get('token',ca);assert.equal(coin.xObservations.at(-1).newAuthors,2);assert.equal(coin.xBoostUntil-coin.xBoostStartedAt,180000);
  const signal=s.get('shadow-run',run.id).arms[0].positions[0];assert.equal(signal.status,'pending');assert(signal.signalAt>=coin.lastXAt);assert.equal(signal.fills.length,0);s.close();
});
