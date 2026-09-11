import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Store} from '../backend/store.mjs';
import {Worker} from '../backend/worker.mjs';
import {StonkHistory,historyCandidate} from '../backend/stonk-history.mjs';
import {base58} from '../backend/providers.mjs';
import {decodeStonkMigration,STONK_CONFIGS,LAUNCHLAB,CPMM} from '../backend/stonk.mjs';
const ca=base58(Buffer.alloc(32,1)),pool=base58(Buffer.alloc(32,2)),at=Date.now()-40*86400000;
const row={mint:ca,pool,launchpad:'launchlab',status:'graduated',graduatedAt:new Date(at).toISOString(),market:{fdvUsd:1000000}};
function setup(fetch){const s=new Store(':memory:'),w=new Worker(s,{});w.rpc=async()=>({data:[]});const h=new StonkHistory(w,fetch);return {s,w,h};}
test('historical screening uses current 1M FDV, supports old graduations and rejects ATH-only hits',()=>{
 assert(historyCandidate(row));assert.equal(historyCandidate({...row,market:{fdvUsd:999999,peakMarketCapUsd:9000000}}),null);
 assert.equal(historyCandidate({...row,graduatedAt:new Date(Date.now()+60000).toISOString()}),null);
 assert.equal(historyCandidate({...row,status:'new'}),null);
});
test('list pagination persists and deduplicates without observation/X enrollment',async()=>{
 const {s,w,h}=setup(async()=>({data:{tokens:[row,row],pagination:{totalPages:2,total:2}}}));
 try{h.control('start');await h.tick();assert.equal(s.get('config','stonk-history').page,2);assert.equal(h.snapshot().tokens.length,1);
 const resumed=new StonkHistory(w,h.fetch);await resumed.tick();assert.equal(resumed.snapshot().job.stage,'coins');assert.equal(s.all('token').length,0);assert.equal(s.researchTokens().length,0);
 h.control('pause');h.nextAt=0;await h.tick();assert.equal(h.snapshot().job.status,'paused');
 }finally{s.close();}
});
test('failed history requests retain cursor and show retry, cap resumes same phase',async()=>{
 const {s,h}=setup(async()=>{throw Error('secret endpoint');});try{h.control('start');await h.tick();assert.equal(h.snapshot().job.page,1);assert(!h.snapshot().job.error.includes('secret'));
 const t={...historyCandidate(row),runId:h.snapshot().job.id,pages:49};h.advance(t,'next','unverified');assert.equal(h.snapshot().tokens[0].phase,'capped');h.control('resume');assert.equal(h.snapshot().tokens[0].cursor,'next');assert.equal(h.snapshot().tokens[0].phase,'verify');
 }finally{s.close();}
});
test('historical migration verifies platform without weakening live 24h limit',async()=>{
 const keys=Array.from({length:18},(_,i)=>base58(Buffer.alloc(32,i+4)));keys[1]=ca;keys[3]=STONK_CONFIGS[0];keys[4]=CPMM;keys[5]=pool;
 const tx={blockTime:Math.floor(at/1000),meta:{err:null},transaction:{message:{accountKeys:keys,instructions:[{programId:LAUNCHLAB,accounts:keys,data:base58(createHash('sha256').update('global:migrate_to_cpswap').digest().subarray(0,8))}]}}};
 assert.equal(decodeStonkMigration(tx),null);assert(decodeStonkMigration(tx,Date.now(),Infinity));
 const {s,w,h}=setup();try{w.rpc=async method=>method==='getTransaction'?tx:{data:[{signature:'migration'}]};h.control('start');await h.coin({...historyCandidate(row),runId:h.snapshot().job.id});assert.equal(s.researchTokens()[0].migrationVerified,true);assert.equal(s.all('token').length,0);assert.equal(h.snapshot().tokens[0].phase,'pool');}finally{s.close();}
});
test('early buyer discovery preserves incomplete valuations as candidates and moves to curve window',async()=>{
 const {s,w,h}=setup(async()=>[{signature:'swap'}]);try{h.control('start');const t={...historyCandidate(row),phase:'pool',source:'stonk',graduatedAt:at,runId:h.snapshot().job.id};
 w.rpc=async(method,args)=>{assert.equal(args[1].sortOrder,'asc');assert.equal(args[1].filters.blockTime.gte,Math.floor(at/1000));return {data:[{signature:'swap'}]};};
 w.parseTrades=()=>[{id:'swap',wallet:pool,ca,at:at+1000,side:'buy',quantity:1,sol:0,complete:false}];
 await h.coin(t);assert.equal(s.all('history-buyer').length,1);assert.equal(s.get('wallet',pool).status,'watch');assert.equal(s.get('history-token',ca).phase,'curve');assert.equal(s.all('token').length,0);
 }finally{s.close();}
});
test('missing parsed transactions never advance a historical page',async()=>{
 const {s,w,h}=setup(async()=>[]);try{w.rpc=async()=>({data:[{signature:'missing'}],paginationToken:'next'});const t={...historyCandidate(row),phase:'pool',graduatedAt:at};s.put('history-token',ca,t);await assert.rejects(()=>h.coin(t));assert.equal(s.get('history-token',ca).cursor,undefined);}finally{s.close();}
});
