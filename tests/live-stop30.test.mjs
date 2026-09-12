import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../backend/store.mjs';
import {LiveTrading,LIVE_C,exitReason,C_EXIT_POLICY} from '../backend/live-trading.mjs';
test('C stops at exactly 30 percent net loss without requiring trailing activation; A unchanged',()=>{
 const p={strategy:LIVE_C,costLamports:100000000,openedAt:1000};
 assert.equal(exitReason({...p},70000001,2000),null);
 assert.equal(exitReason({...p},70000000,2000),'固定止损 -30%');
 assert.equal(exitReason({...p},50000000,2000),'固定止损 -30%');
 assert.equal(exitReason({...p,strategy:'legacy-a'},50000000,2000),null);
});
test('stop intent and first trigger evidence survive failure and rebound, without additional signing',async()=>{
 const s=new Store(':memory:');let at=1800000000000,out='70000000',fail=true,attempts=0;
 const p={ca:'coin',strategy:LIVE_C,status:'open',costLamports:100000000,openedAt:at-10000,quantity:'100'};s.put('live-position',p.ca,p);
 const engine=new LiveTrading(s,{},null,{clock:()=>at,wallet:{address:'mock'},jupiter:{order:async()=>({outAmount:out,signatureFeeLamports:10000,prioritizationFeeLamports:0,rentFeeLamports:0,receivedAt:at})}});
 engine.submit=async(intent)=>{attempts++;assert.equal(intent.reason,'固定止损 -30%');assert.equal(intent.exitPolicy.version,C_EXIT_POLICY.version);if(fail)throw Error('temporary failure');};
 try{
 await engine.checkExit(p);const first=s.get('live-position',p.ca);
 assert.equal(first.exitReason,'固定止损 -30%');assert.equal(first.exitTriggerEvidence.netLamports,69990000);
 fail=false;out='95000000';at+=5000;await engine.checkExit(first);
 const second=s.get('live-position',p.ca);assert.equal(attempts,2);assert.equal(second.exitTriggeredAt,first.exitTriggeredAt);assert.deepEqual(second.exitTriggerEvidence,first.exitTriggerEvidence);
 }finally{s.close();}
});
