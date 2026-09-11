import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Store} from '../backend/store.mjs';
import {Worker} from '../backend/worker.mjs';
import {decodeStonkCreation,decodeStonkMigration,fastGraduation,stonkCandidate} from '../backend/stonk.mjs';
const fixture=name=>JSON.parse(readFileSync(new URL('./fixtures/'+name+'.json',import.meta.url),'utf8'));
for(const [name,seconds] of [['bob',109],['divi',72]]){
 test(name+' real chain creation and separate standard migration pass 20m despite bad API time',async()=>{
  const init=fixture(name+'-creation'),migration=fixture(name+'-migration'),clock=migration.blockTime*1000+1000;
  const c=decodeStonkCreation(init,clock),m=decodeStonkMigration(migration,clock);
  assert(c);assert(m);assert.equal(m.curvePool,c.curvePool);assert.equal((m.graduatedAt-c.createdAt)/1000,seconds);assert(fastGraduation(c.createdAt,m.graduatedAt));assert.equal(decodeStonkMigration(init,clock),null);
  const shift=Math.floor(Date.now()/1000)-migration.blockTime-30;init.blockTime+=shift;migration.blockTime+=shift;
  const s=new Store(':memory:'),w=new Worker(s,{});
  try{
   const candidate=stonkCandidate({mint:m.ca,pool:c.curvePool,quote:{mint:c.quoteMint},status:'graduated',launchpad:'launchlab',createdAt:new Date(migration.blockTime*1000+79000).toISOString(),graduatedAt:new Date(migration.blockTime*1000).toISOString()});assert(candidate);s.put('stonk-candidate',m.ca,candidate);
   w.rpc=async(method,args)=>method==='getTransactionsForAddress'?{data:[{signature:'init'}]}:args[0]==='init'?init:migration;
   await w.stonk.confirm('migration');const t=s.get('token',m.ca);assert(t);assert.equal(t.pool,m.pool);assert.equal(t.createdAt,init.blockTime*1000);assert.equal(t.creationVerified,true);
  }finally{s.close();}
 });
}
test('creation alone caches evidence but never enrolls or implies graduation',async()=>{
 const tx=fixture('divi-creation');tx.blockTime=Math.floor(Date.now()/1000)-10;const s=new Store(':memory:'),w=new Worker(s,{});w.rpc=async()=>tx;
 try{await w.stonk.confirm('init');assert.equal(s.all('stonk-creation').length,1);assert.equal(s.all('token').length,0);}finally{s.close();}
});
test('candidate verifier drains every signature before advancing the page',async()=>{
 const s=new Store(':memory:'),w=new Worker(s,{ENABLE_STONK:'true'});const at=Date.now()-1000;
 s.put('stonk-candidate','ca',{ca:'ca',pool:'pool',reportedGraduatedAt:at});let pages=0;const seen=[];
 w.rpc=async()=>{pages++;return Array.from({length:8},(_,i)=>({signature:'s'+i,blockTime:Math.floor(at/1000)}));};w.stonk.confirm=async sig=>{seen.push(sig);return true;};w.stonk.nextPoll=Infinity;
 try{for(let i=0;i<3;i++){w.stonk.nextVerify=0;const c=s.get('stonk-candidate','ca');s.put('stonk-candidate','ca',{...c,checkedAt:0});await w.stonk.run();}
 assert.deepEqual(seen,['s0','s1','s2','s3','s4','s5','s6','s7']);assert.equal(pages,1);assert.equal(s.get('stonk-candidate','ca').pending.length,0);
 }finally{s.close();}
});
