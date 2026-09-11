import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {decodeStonkCreation,decodeStonkMigration,stonkCandidate,fastGraduation,STONK_CONFIGS,LAUNCHLAB,CPMM} from '../backend/stonk.mjs';
import {base58} from '../backend/providers.mjs';
import {Store} from '../backend/store.mjs';
import {Worker} from '../backend/worker.mjs';
import {entryGate,shadowDefaults} from '../lib/shadow.ts';
const now=Date.now(),ca=base58(Buffer.alloc(32,1)),pool=base58(Buffer.alloc(32,2)),quote=base58(Buffer.alloc(32,3));
const data=base58(createHash('sha256').update('global:migrate_to_cpswap').digest().subarray(0,8));
function fixture(){const keys=Array.from({length:18},(_,i)=>base58(Buffer.alloc(32,i+4)));keys[1]=ca;keys[2]=quote;keys[3]=STONK_CONFIGS[0];keys[4]=CPMM;keys[5]=pool;keys.push(LAUNCHLAB);return {blockTime:Math.floor(now/1000)-60,meta:{err:null},transaction:{message:{accountKeys:keys,instructions:[{programIdIndex:18,accounts:Array.from({length:18},(_,i)=>i),data}]}}};}
function row(){return {mint:ca,pool,name:'Example',symbol:'EX',status:'graduated',launchpad:'launchlab',createdAt:new Date(now-120000).toISOString(),graduatedAt:new Date(now-60000).toISOString(),quote:{mint:quote,symbol:'SPYx'},mode:'reward',transferFee:{bps:300}};}
function initFixture(at=now-120000){const tx=fixture(),keys=tx.transaction.message.accountKeys;keys[5]=keys[17];keys[6]=ca;keys[7]=quote;tx.blockTime=Math.floor(at/1000);tx.transaction.message.instructions[0].data=base58(createHash('sha256').update('global:initialize_with_token_2022').digest().subarray(0,8));return tx;}
const rpcFixture=async(method,args)=>method==='getTransactionsForAddress'?{data:[{signature:'init'}]}:args[0]==='init'?initFixture():fixture();

test('20 minute graduation gate is inclusive and fails closed for missing or reversed times',()=>{
 assert(fastGraduation(now-1200000,now));assert(!fastGraduation(now-1200001,now));
 for(const created of [undefined,null,NaN,0,now+1])assert(!fastGraduation(created,now));
 assert(stonkCandidate({...row(),createdAt:undefined},now));
 assert(stonkCandidate({...row(),createdAt:new Date(now+10000).toISOString()},now));
});
test('WebSocket migration uses chain creation and blocks slow or unknown creation before enrollment',async()=>{
 const s=new Store(':memory:'),w=new Worker(s,{ENABLE_STONK:'true'});let init=null;w.rpc=async(method,args)=>method==='getTransactionsForAddress'?{data:init?[{signature:'init'}]:[]}:args[0]==='init'?init:fixture();
 try{
  assert.equal(await w.stonk.confirm('missing'),false);assert.equal(s.get('token',ca),null);
  init=initFixture(now-3600000);assert.equal(await w.stonk.confirm('slow'),true);assert.equal(s.get('token',ca),null);assert(s.get('stonk-exclusion',ca));
  s.db.prepare('DELETE FROM records WHERE kind IN (?,?)').run('stonk-exclusion','stonk-creation');init=initFixture();assert.equal(await w.stonk.confirm('fast'),true);assert.equal(s.get('token',ca).createdAt,init.blockTime*1000);
 }finally{s.close();}
});
test('low-level Stonk enrollment cannot bypass creation filter',()=>{
 const s=new Store(':memory:'),w=new Worker(s,{MONITOR_SOURCE:'stonk'});try{const found=decodeStonkMigration(fixture());w.enroll(found);assert.equal(s.get('token',ca),null);w.stonk.enroll({...found,createdAt:now-3600000});assert.equal(s.get('token',ca),null);}finally{s.close();}
});
test('Stonk migration verifies program, platform, target program and chain block time',()=>{const tx=fixture(),m=decodeStonkMigration(tx,now);assert.equal(m.ca,ca);assert.equal(m.pool,pool);assert.equal(m.quoteMint,quote);assert.equal(m.graduatedAt,tx.blockTime*1000);for(const index of [3,4,18]){const bad=fixture();bad.transaction.message.accountKeys[index]=ca;assert.equal(decodeStonkMigration(bad,now),null);}const bad=fixture();bad.meta.err={InstructionError:[0,'error']};assert.equal(decodeStonkMigration(bad,now),null);assert.equal(decodeStonkMigration({...fixture(),blockTime:now/1000+10},now),null);assert.equal(decodeStonkMigration({...fixture(),blockTime:now/1000-86400},now),null);});
test('Stonk parses v0 lookup addresses and nested instructions',()=>{const tx=fixture(),msg=tx.transaction.message,ix=msg.instructions[0];tx.meta.loadedAddresses={writable:msg.accountKeys.splice(5),readonly:[]};msg.instructions=[];tx.meta.innerInstructions=[{index:0,instructions:[ix]}];assert.equal(decodeStonkMigration(tx,now).pool,pool);});
test('official graduation is only a candidate; legacy pools and future dates rejected',()=>{assert.equal(stonkCandidate(row(),now).transferFeeBps,300);assert.equal(stonkCandidate({...row(),launchpad:'clmm'},now),null);assert.equal(stonkCandidate({...row(),status:'new'},now),null);assert.equal(stonkCandidate({...row(),graduatedAt:new Date(now+1000).toISOString()},now),null);assert.equal(stonkCandidate({...row(),transferFee:{bps:'300'}},now).transferFeeBps,null);});
test('disabled Stonk requires no network request',async()=>{const s=new Store(':memory:');const w=new Worker(s,{});await w.stonk.tick();assert.equal(w.stonk.status,'未开启');assert.equal(s.all('token').length,0);s.close();});
test('official candidate is enrolled only after Helius verifies migration, without resetting Pump cursor',async()=>{const s=new Store(':memory:');const w=new Worker(s,{ENABLE_STONK:'true'});s.put('config','migrationCursor',{signature:'pump-cursor'});s.put('stonk-candidate',ca,stonkCandidate(row(),now));w.rpc=rpcFixture;try{assert.equal(s.get('token',ca),null);assert(await w.stonk.confirm('migration-signature'));const t=s.get('token',ca);assert.equal(t.source,'stonk');assert.equal(t.pool,pool);assert.equal(t.transferFeeBps,300);assert.equal(t.migrationSignature,'migration-signature');assert(t.shadowBlocked);assert.equal(s.get('config','migrationCursor').signature,'pump-cursor');const age=t.graduatedAt;await w.stonk.confirm('duplicate');assert.equal(s.all('token').length,1);assert.equal(s.get('token',ca).graduatedAt,age);}finally{s.close();}});
test('Stonk candidate polling handles first page plus persistent backfill page without trusting API status',async()=>{const old=globalThis.fetch,s=new Store(':memory:'),w=new Worker(s,{ENABLE_STONK:'true'});w.rpc=async()=>[];const pages=[];globalThis.fetch=async u=>{pages.push(new URL(u).searchParams.get('page'));return new Response(JSON.stringify({data:{tokens:[row()],pagination:{totalPages:4}}}));};try{await w.stonk.tick();assert.deepEqual(pages,['1','2']);assert.equal(s.all('token').length,0);assert.equal(s.all('stonk-candidate').length,1);assert.equal(s.get('config','stonk-pages').page,3);}finally{globalThis.fetch=old;s.close();}});
test('unadapted taxes and quote assets cannot silently enter Shadow',()=>{const t={status:'observing',priceUsd:1,fdv:100000,lp:20000,marketAt:now,graduatedAt:now-60000,shadowBlocked:'tax model pending'};assert.equal(entryGate(t,{authors:10,clean:20},null,'baseline',shadowDefaults,now),false);});
test('official USD market fallback requires exact verified pool and a fresh source timestamp',async()=>{const old=globalThis.fetch,s=new Store(':memory:'),w=new Worker(s,{ENABLE_STONK:'true'});const t={ca,pool,source:'stonk',migrationVerified:true};let value={...row(),market:{fdvUsd:30000,liquidityUsd:15000,priceUsd:.00003}},time=new Date().toISOString();globalThis.fetch=async()=>new Response(JSON.stringify({data:{token:value},meta:{generatedAt:time}}));try{assert.equal((await w.stonk.marketPair(t)).fdv,30000);value={...value,pool:ca};assert.equal(await w.stonk.marketPair(t),null);value={...value,pool};time=new Date(Date.now()-120000).toISOString();assert.equal(await w.stonk.marketPair(t),null);assert.equal(await w.stonk.marketPair({...t,migrationVerified:false}),null);}finally{globalThis.fetch=old;s.close();}});
