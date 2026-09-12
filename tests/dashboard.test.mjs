import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../backend/store.mjs';
import {Dashboard} from '../backend/dashboard.mjs';
import {serialPoll} from '../lib/serial-poll.ts';

const worker={running:true,status:{},history:{snapshot:()=>({tokens:[]})},stonk:{enabled:()=>true},analysis:{status:()=>({})}};
test('dashboard projects histories before JS parsing, preserves detail and coalesces simultaneous clients',async t=>{
 const s=new Store(':memory:');t.after(()=>s.close());
 const now=Date.now(),history=Array.from({length:2880},(_,i)=>({at:now-i*5000,priceUsd:1,fdv:10000,authors:3}));
 const row={ca:'mint',symbol:'TEST',name:'Test',history,xObservations:[{at:now}],execution:{baseFee:{bps:100}},graduatedAt:now,lastXAt:now};
 // Representative history-heavy database without writing a large test audit.
 const insert=s.db.prepare('INSERT INTO records VALUES (?,?,?)');
 for(let i=0;i<100;i++)insert.run('token','mint'+i,JSON.stringify({...row,ca:'mint'+i}));
 s.post({id:'p',ca:'mint0',text:'Independent discussion',author:'alice',at:now-10,association:'exact'});
 let reads=0;const read=s.allPosts.bind(s);s.allPosts=ca=>{reads++;return read(ca);};
 s.purgeExpired=()=>{throw Error('read endpoint must not purge/write');};
 const d=new Dashboard(s,worker,{snapshot:()=>({})},{});
 const [a,b]=await Promise.all([d.json(),d.json()]);assert.equal(a,b);assert.equal(reads,100);
 const parsed=JSON.parse(a);assert.equal(parsed.tokens.length,100);
 assert.equal(parsed.tokens[0].history,undefined);assert.equal(parsed.tokens[0].execution,undefined);assert.equal(parsed.tokens[0].xObservations,undefined);
 assert.equal(parsed.tokens[0].heat.totalAuthors,1);
 assert.equal(s.get('token','mint0').history.length,2880);assert.equal(s.get('token','mint0').execution.baseFee.bps,100);
 const rawBytes=Buffer.byteLength(JSON.stringify(s.all('token'))),bytes=Buffer.byteLength(a);
 assert(bytes<rawBytes/20);assert(bytes<150000);
 assert.equal(await d.json(),a);assert.equal(reads,100);
 // New successful collection invalidates that token's heat even within TTL.
 s.put('token','mint0',{...s.get('token','mint0'),lastXAt:now+1});d.invalidate();await d.json();assert.equal(reads,101);
 t.diagnostic(`100 tokens / 2880 samples: raw=${rawBytes} bytes, dashboard=${bytes} bytes`);
});

test('serial polling never overlaps a slow request, backs off, and stops after cancellation',async()=>{
 let resolve,calls=0;const timers=[];
 const stop=serialPoll(()=>{calls++;return new Promise(r=>{resolve=r;});},(fn,ms)=>{timers.push({fn,ms});return timers.length;},()=>{});
 assert.equal(calls,1);assert.equal(timers.length,0);
 resolve(false);await new Promise(setImmediate);assert.equal(timers[0].ms,10000);
 timers.shift().fn();assert.equal(calls,2);resolve(false);await new Promise(setImmediate);assert.equal(timers[0].ms,20000);
 timers.shift().fn();resolve(true);await new Promise(setImmediate);assert.equal(timers[0].ms,5000);
 timers.shift().fn();stop();resolve(true);await new Promise(setImmediate);assert.equal(timers.length,0);
});
