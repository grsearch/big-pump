import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../backend/store.mjs';
import {LiveTrading,LIVE_C,exitReason,C_EXIT_POLICY,migrateLiveExit} from '../backend/live-trading.mjs';
test('C has no fixed stop, retains trailing and 30 minute timeout',()=>{
 const p={strategy:LIVE_C,costLamports:100,openedAt:1000};
 for(const value of [70,50,1])assert.equal(exitReason({...p},value,2000),null);
 assert.equal(C_EXIT_POLICY.stopLossPct,null);
 assert.equal(exitReason(p,140,2000),null);assert.match(exitReason(p,126,3000),/10%/);
 assert.match(exitReason({...p,trailingActive:false},1,1801000),/30 分钟/);
});
test('old unbroadcast stop intent is superseded without selling, evidence retained',async()=>{
 const s=new Store(':memory:');const at=1800000000000;
 const p={ca:'coin',strategy:LIVE_C,status:'open',costLamports:100000000,openedAt:at-10000,quantity:'100',exitReason:'固定止损 -30%',exitTriggeredAt:at-5000,exitTriggerEvidence:{netLamports:60000000},exitPolicy:{version:'old'}};
 s.put('live-position',p.ca,p);
 s.put('live-order','old-stop',{id:'old-stop',ca:p.ca,side:'sell',status:'preparing',reason:'固定止损 -30%'});
 const engine=new LiveTrading(s,{},null,{clock:()=>at,wallet:{address:'mock'},jupiter:{order:async()=>({outAmount:'10000000',signatureFeeLamports:0,prioritizationFeeLamports:0,rentFeeLamports:0})}});
 engine.submit=()=>assert.fail('no fixed stop sell');
 try{await engine.checkExit(p);const saved=s.get('live-position',p.ca);assert.equal(saved.exitReason,null);assert.equal(saved.exitPolicy.version,C_EXIT_POLICY.version);assert.equal(saved.supersededExit.evidence.netLamports,60000000);assert.equal(saved.exitTriggerEvidence,null);assert.equal(s.get('live-order','old-stop').status,'cancelled');}
 finally{s.close();}
});
test('broadcast stop orders and closed historical positions are not rewritten',async()=>{
 const s=new Store(':memory:'),p={ca:'coin',strategy:LIVE_C,status:'open',exitReason:'固定止损 -30%'};
 s.put('live-position','coin',p);s.put('live-order','sell',{id:'sell',ca:'coin',side:'sell',status:'confirming',signature:'already-sent'});
 const engine=new LiveTrading(s,{},null,{wallet:{address:'mock'},jupiter:{order:()=>assert.fail('must reconcile broadcast exit')}});
 try{await engine.checkExit(p);assert.equal(s.get('live-position','coin').exitReason,'固定止损 -30%');assert.equal(s.get('live-order','sell').status,'confirming');const closed={...p,status:'closed'};migrateLiveExit(closed);assert.equal(closed.exitReason,'固定止损 -30%');}finally{s.close();}
});
