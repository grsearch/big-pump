import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveTrading} from '../backend/live-trading.mjs';
import {Worker} from '../backend/worker.mjs';
import {Store} from '../backend/store.mjs';
import {newToken} from '../lib/engine.ts';
test('retry wake uses one earliest timer, rearms after firing and disposes cleanly',async t=>{
 const timers=[];t.mock.method(globalThis,'setTimeout',(fn,delay)=>{const h={fn,delay,unref(){}};timers.push(h);return h;});
 const cleared=[];t.mock.method(globalThis,'clearTimeout',h=>cleared.push(h));
 let at=1000,calls=0;
 const e={clock:()=>at,collectorRunning:true,tick:async()=>{calls++;},scheduleRetry:LiveTrading.prototype.scheduleRetry};
 e.scheduleRetry(1300);e.scheduleRetry(1600);assert.equal(timers.length,1);assert.equal(timers[0].delay,300);
 at=1300;timers[0].fn();assert.equal(calls,1);
 e.scheduleRetry(1900);assert.equal(timers.length,2);assert.equal(timers[1].delay,600);
 e.busy=true;timers[1].fn();assert.equal(calls,1);assert.equal(e.wakePending,true);
 e.scheduleRetry(2300);LiveTrading.prototype.dispose.call(e);timers[2].fn();assert.equal(calls,1);assert(cleared.includes(timers[2]));
 e.scheduleRetry(2400);assert.equal(timers.length,3);
});
test('observation sweep yields, rereads updates and skips unchanged token writes',async()=>{
 const s=new Store(':memory:');try{
  const w=new Worker(s,{});for(const ca of ['a','b'])s.put('token',ca,newToken(ca,'pool',Date.now()));
  w.running=true;w.lastResearch=Date.now();w.transitionToken=t=>({...t});
  w.history.tick=w.valuation.tick=w.stonk.tick=w.marketTick=w.detailsTick=w.xPoll=w.analysis.tick=async()=>{};
  w.analysis.shadowTick=()=>{};
  const put=s.put.bind(s);let writes=0,observed;
  s.put=(kind,id,data)=>{if(kind==='token')writes++;return put(kind,id,data);};
  w.transitionToken=t=>{if(t.ca==='b')observed=t.name;return {...t};};
  setImmediate(()=>put('token','b',{...s.get('token','b'),name:'fresh while yielding'}));
  await w.tick();assert.equal(observed,'fresh while yielding');assert.equal(writes,0);
 }finally{s.close();}
});
