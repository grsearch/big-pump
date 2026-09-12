import test from 'node:test';import assert from 'node:assert/strict';
import {Store} from '../backend/store.mjs';import {Worker} from '../backend/worker.mjs';import {newToken} from '../lib/engine.ts';import {xSchedule} from '../lib/x-schedule.ts';
import {LiveTrading,LIVE_C} from '../backend/live-trading.mjs';
test('minimum research window survives low FDV, data gaps and budget sleep; X never overspends',async()=>{
 const s=new Store(':memory:'),now=Date.now(),t={...newToken('coin','pool',now-900000,now-600000),fdv:1,marketError:'missing',status:'sleeping',cost:.5};const w=new Worker(s,{ENABLE_X:'true',X_BEARER_TOKEN:'test'});w.running=true;s.put('token',t.ca,t);
 try{assert.equal(w.transitionToken(t,s.rules(),now,0).status,'observing');assert.equal(xSchedule([t],now,10000).length,1);await w.xPoll();assert.equal(s.cost(),0);assert.equal(w.transitionToken(t,s.rules(),now+1800000,0).status,'sleeping');}finally{s.close();}
});
test('observation audit preserves earlier market and posts beyond deletion, never signing payload',()=>{
 const s=new Store(':memory:'),now=Date.now(),t=newToken('coin','pool',now,now);try{s.put('token','coin',{...t,marketCheckedAt:now,fdv:100});s.put('token','coin',{...t,marketCheckedAt:now+1,fdv:1});s.post({id:'p',ca:'coin',at:now,text:'evidence'});s.put('live-order','o',{ca:'coin',signedTransaction:'private-payload',diagnostic:{apiKey:'sensitive'},status:'confirming'});const rows=s.db.prepare('SELECT * FROM audit').all();assert.equal(rows.filter(r=>r.kind==='market').length,2);assert(rows.some(r=>r.kind==='post'));assert(!JSON.stringify(rows).includes('private-payload'));assert(!JSON.stringify(rows).includes('sensitive'));}finally{s.close();}
});
test('exit lane operates while entry is busy and overlapping timers do not duplicate sells',async()=>{
 const s=new Store(':memory:'),now=1800000000000;let release,calls=0;
 const e=new LiveTrading(s,{ENABLE_LIVE_TRADING:'true'},null,{clock:()=>now,wallet:{address:'mock'},jupiter:{order:async()=>{calls++;await new Promise(r=>release=r);return {outAmount:'110',signatureFeeLamports:0,prioritizationFeeLamports:0,rentFeeLamports:0};}}});
 s.put('live-position','coin',{ca:'coin',status:'open',strategy:LIVE_C,openedAt:now-10000,costLamports:100,quantity:'1'});e.busy=true;
 try{const run=e.exitTick();await e.exitTick();await e.checkExit(s.get('live-position','coin'));assert.equal(calls,1);release();await run;assert.equal(s.get('live-position','coin').markLamports,110);}finally{s.close();}
});
test('Holders batch covers three due coins without requiring one minute per coin',async()=>{
 const s=new Store(':memory:'),w=new Worker(s,{}),now=Date.now();w.running=true;let calls=0;w.rpc=async()=>{calls++;return {token_accounts:[{owner:'holder',amount:'1'}]};};for(let i=0;i<4;i++)s.put('token','c'+i,newToken('c'+i,'pool',now,now));
 try{await w.detailsTick();assert.equal(calls,3);assert.equal(s.all('token').filter(t=>t.holders===1).length,3);await w.detailsTick();assert.equal(calls,4);}finally{s.close();}
});

test('execute response arriving after reconciliation cannot regress a finalized order',async()=>{
 const s=new Store(':memory:');let release;
 const e=new LiveTrading(s,{ENABLE_LIVE_TRADING:'true'},null,{wallet:{address:'mock',prepare:async()=>({signature:'mock',signedTransaction:'never-broadcast'}),execute:async()=>new Promise(r=>release=r)},jupiter:{}});
 try{const pending=e.submit({id:'sell',ca:'coin',side:'sell',reason:'exit'},{requestId:'mock',receivedAt:Date.now()});await new Promise(r=>setImmediate(r));const current=s.get('live-order','sell');s.put('live-order','sell',{...current,status:'confirmed',receipt:{solDelta:123}});release({message:'submitted'});await pending;assert.equal(s.get('live-order','sell').status,'confirmed');assert.equal(s.get('live-order','sell').receipt.solDelta,123);}finally{s.close();}
});

test('a budget-exhausted protected coin cannot starve other X candidates',async t=>{
 const s=new Store(':memory:'),now=Date.now(),w=new Worker(s,{ENABLE_X:'true',X_BEARER_TOKEN:'test'});w.running=true;
 for(const [ca,cost] of [['a',.5],['b',0]])s.put('token',ca,{...newToken(ca,'pool',now-60000,now-60000),cost,fdv:1});
 let url;t.mock.method(globalThis,'fetch',async u=>{url=new URL(u);return Response.json({data:[]});});try{await w.xPoll();assert(url.searchParams.get('query').includes('b'));assert.equal(s.get('token','a').lastXAt,null);assert(s.get('token','b').lastXAt);}finally{s.close();}
});
