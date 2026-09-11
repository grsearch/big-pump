import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../backend/store.mjs';
import {Worker} from '../backend/worker.mjs';
import {removePumpObservations} from '../backend/stonk-only.mjs';
test('Stonk-only cleanup removes Pump observations without destroying position accounting',()=>{
  const s=new Store(':memory:');
  for(const [ca,source] of [['p','pump'],['s','stonk'],['held','pump']])s.put('token',ca,{ca,source});
  s.post({id:'post',ca:'p',at:1});s.put('ai-latest','p',{ca:'p'});
  s.put('shadow-run','r',{id:'r',arms:[{positions:[{ca:'p',status:'pending'},{ca:'held',status:'open'}]}]});
  s.put('live-position','p',{ca:'p',status:'open'});
  removePumpObservations(s);
  assert.equal(s.get('token','p'),null);assert.equal(s.posts('p').length,0);assert.equal(s.get('ai-latest','p'),null);
  assert(s.get('token','s'));assert.equal(s.get('token','held').hidden,true);assert.equal(s.get('token','held').status,'archived');
  assert.equal(s.get('shadow-run','r').arms[0].positions[0].status,'cancelled');assert.equal(s.get('live-position','p').status,'open');
  s.put('token','p',{ca:'p'});assert.equal(s.get('token','p'),null);s.close();
});
test('production Stonk scope rejects Pump enrollment and backfill',async()=>{
  const s=new Store(':memory:'),w=new Worker(s,{MONITOR_SOURCE:'stonk',ENABLE_STONK:'true'});
  w.enroll({ca:'p',source:'pump',graduatedAt:Date.now()},'signature');assert.equal(s.get('token','p'),null);
  w.pumpBackfill.begin=()=>{throw Error('must not run');};await w.backfill();
  await assert.rejects(w.addSignature('anything'),/已停止 Pump/);s.close();
});
test('Stonk-only websocket subscribes only to Stonk and never starts Pump recovery',()=>{
  const original=globalThis.WebSocket,s=new Store(':memory:'),sent=[];
  globalThis.WebSocket=class{send(message){sent.push(JSON.parse(message));}};
  try {
    const w=new Worker(s,{MONITOR_SOURCE:'stonk',ENABLE_STONK:'true'});w.rpc=async()=>{};w.running=true;
    w.pumpBackfill.begin=()=>{throw Error('Pump must stay off');};w.connect();w.socket.onopen();
    assert(sent.length>0);assert(sent.every(request=>request.id>=10));
  } finally{globalThis.WebSocket=original;s.close();}
});
