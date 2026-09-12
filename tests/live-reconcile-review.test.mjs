import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveWallet} from '../backend/live-wallet.mjs';
import {LiveTrading,LIVE_C} from '../backend/live-trading.mjs';
import {Store} from '../backend/store.mjs';
const now=1800000000000;
const order={id:'buy:coin',ca:'coin',side:'buy',strategy:LIVE_C,status:'confirming',signature:'sig',at:now-1500000,signedTransaction:'never-broadcast'};
const transaction={blockTime:(now-1500000)/1000,transaction:{message:{accountKeys:['wallet']}},meta:{err:null,fee:5000,preBalances:[1000000000],postBalances:[1019600000],preTokenBalances:[],postTokenBalances:[{accountIndex:1,owner:'wallet',mint:'coin',uiTokenAmount:{amount:'317736000000',decimals:6}},{accountIndex:2,owner:'pool',mint:'coin',uiTokenAmount:{amount:'999999999999',decimals:6}}]}};
test('positive SOL with target tokens is finalized accounting review, not pending inclusion or invented cost',async()=>{
 await assert.rejects(()=>LiveWallet.prototype.receipt.call({address:'wallet',rpc:async()=>transaction},order),e=>{
 assert.equal(e.code,'RECEIPT_ACCOUNTING_REVIEW');assert.equal(e.diagnostic.chainSuccess,true);
 assert.equal(e.diagnostic.solDelta,19600000);assert.equal(e.diagnostic.targetDelta,'317736000000');
 assert.equal(e.diagnostic.postTokenBalances.length,1);return true;
 });
});
test('reconciliation error stays visible across restart and can recover once without rebroadcast',async()=>{
 const s=new Store(':memory:');let at=now,valid=false;
 const wallet={address:'wallet',receipt:async()=>valid?{failed:false,quantity:'317736000000',solDelta:-101000000,feeLamports:5000,at:now-1500000}:LiveWallet.prototype.receipt.call({address:'wallet',rpc:async()=>transaction},order)};
 try{
 s.put('live-order',order.id,order);const e=new LiveTrading(s,{},null,{wallet,clock:()=>at});
 await e.reconcile();let saved=s.get('live-order',order.id);
 assert.equal(saved.status,'confirming');assert.equal(saved.reconcileRequired,true);assert.equal(saved.reconciliationEvidence.chainSuccess,true);assert.equal(s.get('live-position','coin'),null);
 assert.equal(e.snapshot().orders[0].signedTransaction,undefined);
 const restarted=new LiveTrading(s,{},null,{wallet,clock:()=>at});at+=5000;await restarted.reconcile();
 assert.equal(s.get('live-order',order.id).reconcileFailures,2);assert.equal(s.all('event').filter(x=>x.type==='live').length,1);
 valid=true;at+=5000;await restarted.reconcile();await restarted.reconcile();
 saved=s.get('live-order',order.id);assert.equal(saved.status,'confirmed');assert.equal(saved.reconcileRequired,false);assert.equal(saved.reconcileError,null);
 assert.equal(s.get('live-position','coin').costLamports,101000000);assert.equal(s.get('live-position','coin').openedAt,now-1500000);assert.equal(s.all('live-position').length,1);
 }finally{s.close();}
});
test('RPC errors are recorded, do not invent finalized success, and do not block other receipts',async()=>{
 const s=new Store(':memory:');try{
 s.put('live-order',order.id,order);s.put('live-order','second',{...order,id:'second',ca:'second'});
 const e=new LiveTrading(s,{},null,{clock:()=>now,wallet:{address:'wallet',receipt:async o=>{if(o.ca==='coin')throw Error('RPC temporary failure');return {failed:true,feeLamports:5000};}}});
 await e.reconcile();assert.equal(s.get('live-order',order.id).reconcileRequired,true);assert.equal(s.get('live-order',order.id).reconciliationEvidence,null);
 assert.equal(s.get('live-order','second').status,'failed');
 }finally{s.close();}
});
