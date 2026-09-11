import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../backend/store.mjs';
import {Worker} from '../backend/worker.mjs';
import {PUMP} from '../backend/providers.mjs';
const setup=()=>{const s=new Store(':memory:'),w=new Worker(s,{});w.running=true;s.put('config','migrationCursor',{signature:'anchor',at:1});return {s,w};};
const due=s=>{const j=s.get('config','pump-backfill');s.put('config','pump-backfill',{...j,nextAt:0});};
test('failed RPC retries independently and keeps anchor despite new live cursor and restart',async()=>{
  const {s,w}=setup();w.status.helius='已连接';w.rpc=async()=>{throw Error('secret provider URL must not leak');};w.pumpBackfill.begin();await w.pumpBackfill.tick();
  assert.equal(w.status.helius,'已连接');assert.match(w.status.pumpBackfill,/重试/);assert(!JSON.stringify(s.all('config')).includes('secret'));
  const retry=s.get('config','pump-backfill');assert(retry.nextAt>Date.now());
  s.put('config','migrationCursor',{signature:'live-new',at:Date.now()});
  const resumed=new Worker(s,{});resumed.running=true;resumed.rpc=async(method,args)=>{assert.equal(args[1].until,'anchor');return [];};due(s);resumed.pumpBackfill.begin();await resumed.pumpBackfill.tick();
  assert.equal(s.get('config','pump-backfill').done,true);assert.equal(s.get('config','migrationCursor').signature,'live-new');assert.match(resumed.status.pumpBackfill,/完成/);s.close();
});
test('null transaction remains pending; retry enrolls without overwriting newer live cursor',async()=>{
  const {s,w}=setup();let missing=true;
  const b=Buffer.alloc(200);Buffer.from([189,233,93,185,92,148,234,148]).copy(b);b.fill(1,40,72);b.fill(2,136,168);b.writeBigInt64LE(BigInt(Math.floor(Date.now()/1000)),128);
  w.rpc=async method=>method==='getSignaturesForAddress'?[{signature:'migration',blockTime:Math.floor(Date.now()/1000)}]:missing?null:{meta:{err:null,logMessages:[`Program ${PUMP} invoke [1]`,'Program data: '+b.toString('base64')]}};
  w.pumpBackfill.begin();await w.pumpBackfill.tick();assert.equal(s.get('config','pump-backfill').pending.length,1);assert.equal(s.all('token').length,0);
  missing=false;due(s);s.put('config','migrationCursor',{signature:'newer-live'});await w.pumpBackfill.tick();assert.equal(s.all('token').length,1);assert.equal(s.get('config','pump-backfill').done,true);assert.equal(s.get('config','migrationCursor').signature,'newer-live');s.close();
});
test('full signature pages advance before cursor and completion advances only untouched anchor',async()=>{
  const {s,w}=setup();let pages=0;
  w.rpc=async(method,args)=>{if(method==='getTransaction')return {meta:{err:null,logMessages:[]}};pages++;if(pages===1)return Array.from({length:100},(_,i)=>({signature:'s'+i,err:i>=5?'failed':null}));assert.equal(args[1].before,'s99');return [];};
  w.pumpBackfill.begin();await w.pumpBackfill.tick();assert.equal(s.get('config','pump-backfill').done,false);assert.equal(s.get('config','migrationCursor').signature,'anchor');
  due(s);await w.pumpBackfill.tick();assert.equal(s.get('config','pump-backfill').done,true);assert.equal(s.get('config','migrationCursor').signature,'s0');s.close();
});
test('page cap stays explicit and manual continuation preserves original anchor',async()=>{
  const {s,w}=setup();w.pumpBackfill.begin();s.put('config','pump-backfill',{...s.get('config','pump-backfill'),pages:50});w.rpc=async()=>{throw Error('must not call');};await w.pumpBackfill.tick();assert(s.get('config','pump-backfill').capped);assert.match(w.status.pumpBackfill,/缺口/);
  w.pumpBackfill.resume();assert.equal(s.get('config','pump-backfill').anchor,'anchor');assert.equal(s.get('config','pump-backfill').pageLimit,100);assert.equal(s.get('config','pump-backfill').capped,false);s.close();
});
test('bulk wallet reassessment loads trade and wallet tables a bounded number of times',()=>{
  const s=new Store(':memory:'),at=Date.now();
  for(let i=0;i<40;i++){s.put('wallet','w'+i,{address:'w'+i,status:'verified',verifiedAt:1});s.put('token','c'+i,{ca:'c'+i,status:'observing',graduatedAt:at,smartBought:3,smartHolding:3,smartNew:3});s.put('trade','t'+i,{id:'t'+i,wallet:'w'+i,ca:'c'+i,at:at-60000,side:'buy',quantity:1,sol:1,graduatedAt:at-60000});}
  const counts={},original=s.all.bind(s);s.all=kind=>{counts[kind]=(counts[kind]??0)+1;return original(kind);};new Worker(s,{});
  assert.equal(counts.trade,1);assert(counts.wallet<=2);assert(counts.token<=5);assert(s.all('wallet').every(w=>w.status==='watch'));assert(s.all('token').every(t=>t.smartBought===0));s.close();
});
