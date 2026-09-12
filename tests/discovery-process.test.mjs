import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {DiscoveryProcess} from '../backend/discovery-process.mjs';
import {StonkDiscovery} from '../backend/stonk.mjs';
import {Store} from '../backend/store.mjs';
import {Worker} from '../backend/worker.mjs';

test('external discovery mode never starts a duplicate main-process socket or verifier',async()=>{
 const s=new Store(':memory:'),w=new Worker(s,{ENABLE_STONK:'true',MONITOR_SOURCE:'stonk'}),states=[];
 w.externalDiscovery=true;w.rpc=async()=>{};w.connect=()=>assert.fail('duplicate WebSocket');w.stonk.drainSignatures=()=>assert.fail('duplicate verifier');w.tick=async()=>{};w.onDiscoveryControl=running=>states.push(running);
 try{await w.start();assert.deepEqual(states,[true]);assert.equal(w.stonkQueueTimer,undefined);w.stop();assert.deepEqual(states,[true,false]);}finally{w.stop();s.close();}
});

test('discovery supervisor preserves pause/start across restart and ignores stale child messages',t=>{
 const timers=[];t.mock.method(globalThis,'setTimeout',(fn,ms)=>{const timer={fn,ms,unref(){}};timers.push(timer);return timer;});t.mock.method(globalThis,'clearTimeout',()=>{});
 const children=[];let signals=0;
 const spawn=()=>{const c=new EventEmitter();c.connected=true;c.pid=children.length+1;c.messages=[];c.send=m=>c.messages.push(m);c.kill=()=>c.emit('exit',0);children.push(c);return c;};
 const p=new DiscoveryProcess({ENABLE_STONK:'true'},'test.db',()=>{},()=>signals++,spawn);
 try{p.notify(true);p.start();p.start();assert.equal(children.length,1);children[0].emit('message',{type:'ready',at:10,status:{}});assert.equal(children[0].messages.at(-1).running,true);children[0].emit('message',{type:'signal'});assert.equal(signals,1);
 p.notify(false);children[0].emit('exit',1);assert.equal(p.snapshot().ready,false);timers[0].fn();children[1].emit('message',{type:'ready',at:20,status:{}});assert.equal(children[1].messages.at(-1).running,false);children[0].emit('message',{type:'signal'});assert.equal(signals,1);assert.equal(p.snapshot().pid,2);
 }finally{p.dispose();}
});

test('a slow creation query does not hold the next arriving migration behind its batch',async()=>{
 const s=new Store(':memory:'),w={s,env:{ENABLE_STONK:'true'},rpc:()=>{},running:false};const d=new StonkDiscovery(w),seen=[];let finish;
 try{d.enqueue('slow','creation');d.confirm=async sig=>{seen.push(sig);if(sig==='slow')return new Promise(r=>finish=r);return true;};const background=d.drainSignatures();assert.deepEqual(seen,['slow']);d.enqueue('fresh','migration');await d.drainSignatures();assert.deepEqual(seen,['slow','fresh']);assert.equal(s.get('stonk-signature','fresh').done,true);finish(true);await background;}finally{s.close();}
});

test('discovery-only enrollment persists the signal without creating observation data',async()=>{
 const s=new Store(':memory:'),now=Date.now();let notified=0;
 const d=new StonkDiscovery({s,env:{ENABLE_STONK:'true'},discoveryOnly:true,onGraduation:()=>notified++});
 try{d.materializeObservation=()=>assert.fail('not in discovery process');await d.enroll({ca:'coin',source:'stonk',createdAt:now-60000,graduatedAt:now,creationVerified:true,migrationVerified:true},'sig');assert.equal(notified,1);assert.equal(s.get('live-signal','coin').observationPending,true);assert.equal(s.get('token','coin'),null);}finally{s.close();}
});

test('creation proof warming favors recent events but gives old backlog a reserved turn',async()=>{
 const s=new Store(':memory:'),w={s,env:{ENABLE_STONK:'true'},rpc:()=>{},running:false},d=new StonkDiscovery(w),seen=[],now=Date.now();
 try{for(let i=0;i<8;i++)d.enqueue('c'+i,'creation',now-1000+i);d.confirm=async sig=>{seen.push(sig);return true;};for(let i=0;i<4;i++)await d.drainSignatures();assert.deepEqual(seen,['c7','c6','c5','c0']);}finally{s.close();}
});
