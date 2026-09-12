import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Store} from '../backend/store.mjs';
import {LiveProcess} from '../backend/live-process.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acquireLiveLock} from '../backend/live-lock.mjs';
test('only one executor can hold the live ledger lock',()=>{
 const dir=mkdtempSync(join(tmpdir(),'live-lock-')),path=join(dir,'test.db');
 try{const release=acquireLiveLock(path);assert.throws(()=>acquireLiveLock(path),/执行锁/);release();const next=acquireLiveLock(path);release();assert.throws(()=>acquireLiveLock(path),/执行锁/);next();}finally{rmSync(dir,{recursive:true,force:true});}
});
test('supervisor forwards controls, reports child failure and never creates a signer',async t=>{
 const timers=[];t.mock.method(globalThis,'setTimeout',(fn,ms)=>{const timer={fn,ms,unref(){}};timers.push(timer);return timer;});t.mock.method(globalThis,'clearTimeout',()=>{});
 const s=new Store(':memory:'),children=[];
 const spawn=()=>{const c=new EventEmitter();c.connected=true;c.pid=100+children.length;c.messages=[];c.send=(m,cb)=>{c.messages.push(m);cb?.();};c.kill=()=>c.emit('exit',0);children.push(c);return c;};
 const p=new LiveProcess(s,{ENABLE_LIVE_TRADING:'true'},'test.db',spawn);
 try{
  p.notify(true);p.start();p.start();assert.equal(children.length,1);const c=children[0];
  c.emit('message',{type:'ready',status:{configured:false,error:'no key'}});assert.deepEqual(c.messages[0],{type:'collector',running:true});
  const result=p.control('pause');const m=c.messages.at(-1);assert.equal(m.action,'pause');c.emit('message',{type:'result',id:m.id,result:{ok:true}});assert.deepEqual(await result,{ok:true});
  assert.equal(p.snapshot().executionProcess.isolated,true);assert.equal(p.snapshot().acceptEntries,false);
  c.emit('exit',1);assert.equal(p.ready,false);timers.find(x=>x.ms===1000).fn();assert.equal(children.length,2);
  children[1].emit('message',{type:'ready',status:{configured:false}});assert.equal(children[1].messages.some(m=>m.type==='control'),false);
  p.dispose();assert.equal(p.child,null);
 }finally{p.dispose();s.close();}
});
test('SQLite readers see committed data during another connection write; lock waits are bounded',()=>{
 const dir=mkdtempSync(join(tmpdir(),'live-db-'));const a=new Store(join(dir,'test.db')),b=new Store(join(dir,'test.db'));
 try{
  a.put('live-order','one',{id:'one',status:'confirming'});a.put('live-order','old',{status:'confirmed'});
  a.put('token','fresh',{graduatedAt:100,history:[{large:'ignored'}],xObservations:[1],ca:'fresh'});a.put('token','old',{graduatedAt:1,ca:'old'});
  a.db.exec('BEGIN IMMEDIATE');assert.equal(b.statusRows('live-order','confirming').length,1);assert.equal(b.entryTokens(90,110)[0].history,undefined);
  assert.deepEqual(b.entryTokens(90,110).map(t=>t.ca),['fresh']);
  assert.throws(()=>b.put('config','lock-test',{}),e=>e.errcode===5);a.db.exec('ROLLBACK');b.put('config','lock-test',{ok:true});assert(a.get('config','lock-test').ok);
 }finally{a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});
