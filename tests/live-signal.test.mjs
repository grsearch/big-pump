import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../backend/store.mjs';
import {StonkDiscovery} from '../backend/stonk.mjs';
import {LiveTrading} from '../backend/live-trading.mjs';

test('verified signal quotes before observation exists, survives observation failure and restart without duplicate send',async()=>{
 const s=new Store(':memory:'),now=Date.now();let sends=0,quotes=0,buy;
 const env={ENABLE_LIVE_TRADING:'true',ENABLE_STONK:'true'};
 const wallet={address:'mock',prepare:async()=>({signature:'mock',signedTransaction:'mock'}),execute:async()=>{sends++;return {message:'mock'};},receipt:async()=>null};
 const jupiter={status:()=>({}),order:async()=>{quotes++;assert.equal(s.get('token','coin'),null);return {outAmount:'100',otherAmountThreshold:'90',receivedAt:now};}};
 const engine=new LiveTrading(s,env,null,{clock:()=>now,wallet,jupiter});engine.control('start');
 const w={s,env,onGraduation:()=>{assert.equal(s.get('token','coin'),null);assert(s.get('live-signal','coin'));buy=engine.onGraduation(true);}};
 const d=new StonkDiscovery(w),found={ca:'coin',pool:'pool',quoteMint:'quote',source:'stonk',migrationVerified:true,creationVerified:true,createdAt:now-60000,graduatedAt:now};
 const materialize=d.materializeObservation;d.materializeObservation=()=>{throw Error('observation unavailable');};
 try{
  await assert.rejects(d.enroll(found,'migration-signature'),/observation unavailable/);await buy;
  assert.equal(quotes,2);assert.equal(sends,1);assert.equal(s.get('token','coin'),null);
  assert.equal(s.get('live-signal','coin').observationPending,true);
  engine.dispose();const restarted=new LiveTrading(s,env,null,{clock:()=>now+1000,wallet,jupiter});await restarted.tick(true);restarted.dispose();assert.equal(sends,1);
  d.materializeObservation=materialize;d.recoverObservation();assert.equal(s.get('token','coin').migrationVerified,true);assert.equal(s.get('live-signal','coin').observationPending,false);
  await d.enroll(found,'duplicate');assert.equal(sends,1);assert.equal(s.all('live-signal').length,1);
 }finally{engine.dispose();s.close();}
});

test('observation records alone cannot open trades; signal restart recovery needs no IPC',async()=>{
 const s=new Store(':memory:'),now=Date.now();let sends=0;
 const env={ENABLE_LIVE_TRADING:'true'},wallet={address:'mock',prepare:async()=>({signature:'mock',signedTransaction:'mock'}),execute:async()=>{sends++;return {};},receipt:async()=>null};
 const jupiter={status:()=>({}),order:async()=>({outAmount:'100',otherAmountThreshold:'90',receivedAt:now})};
 const engine=new LiveTrading(s,env,null,{clock:()=>now,wallet,jupiter});engine.control('start');
 const signal={ca:'coin',source:'stonk',migrationVerified:true,creationVerified:true,createdAt:now-60000,graduatedAt:now,verifiedAt:now};
 try{s.put('token','coin',signal);await engine.tick(true);assert.equal(sends,0);s.put('live-signal','coin',signal);await engine.tick(true);assert.equal(sends,1);}finally{engine.dispose();s.close();}
});
