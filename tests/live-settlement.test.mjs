import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../backend/store.mjs';
import {LiveTrading,LIVE_C} from '../backend/live-trading.mjs';
import {LiveWallet} from '../backend/live-wallet.mjs';
const now=1800000000000;
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=()=>new Promise(r=>setImmediate(r));
const signal={ca:'coin',source:'stonk',migrationVerified:true,creationVerified:true,createdAt:now-10000,graduatedAt:now,verifiedAt:now};
const transaction={blockTime:now/1000,transaction:{message:{accountKeys:['wallet']}},meta:{err:null,fee:5000,preBalances:[1000000000],postBalances:[899995000],preTokenBalances:[],postTokenBalances:[{owner:'wallet',mint:'coin',uiTokenAmount:{amount:'1000'}}]}};
const quote={outAmount:'100000000',signatureFeeLamports:5000,prioritizationFeeLamports:0,rentFeeLamports:0,receivedAt:now};
test('receipt uses confirmed chain data, does not wait for finality or infer success from submission',async()=>{
 let available=false;
 const wallet={address:'wallet',rpc:async(method,args)=>{assert.equal(method,'getTransaction');assert.equal(args[1].commitment,'confirmed');return available?transaction:null;}};
 const order={ca:'coin',signature:'mock',side:'buy'};
 assert.equal(await LiveWallet.prototype.receipt.call(wallet,order),null);
 available=true;const r=await LiveWallet.prototype.receipt.call(wallet,order);
 assert.equal(r.commitment,'confirmed');assert.equal(r.solDelta,-100005000);assert.equal(r.quantity,'1000');
});
test('slow execute response does not delay management, late response cannot overwrite receipt',async()=>{
 const s=new Store(':memory:'),response=defer();let at=now,quoted=0;
 const wallet={address:'wallet',prepare:async()=>({signature:'mock',signedTransaction:'mock-only'}),execute:()=>response.promise,
 receipt:async()=>({failed:false,quantity:'1000',solDelta:-100005000,at:now,commitment:'confirmed'})};
 const engine=new LiveTrading(s,{ENABLE_LIVE_TRADING:'true'},null,{wallet,clock:()=>at,jupiter:{status:()=>({}),order:async()=>{quoted++;return quote;}}});
 try{
 engine.control('start');s.put('live-signal','coin',signal);
 const submit=engine.submit({id:'buy:coin',ca:'coin',side:'buy',at:now,strategy:LIVE_C},quote);
 await flush();assert.equal(s.get('live-order','buy:coin').status,'confirming');
 engine.busy=true;at+=1000;await engine.settlementTick();
 assert.equal(quoted,1);const p=s.get('live-position','coin');assert.equal(p.managementStartedAt,at);assert.equal(p.firstValidQuoteAt,at);assert.equal(p.receiptCommitment,'confirmed');
 response.resolve({message:'late response'});await submit;
 assert.equal(s.get('live-order','buy:coin').status,'confirmed');assert.equal(s.get('live-order','buy:coin').receipt.quantity,'1000');assert.equal(s.all('live-position').length,1);
 }finally{engine.dispose();s.close();}
});
test('concurrent receipt polls are single flight and recent null receipts retry after one second',async()=>{
 const s=new Store(':memory:'),pending=defer();let at=now,calls=0;
 const engine=new LiveTrading(s,{},null,{clock:()=>at,wallet:{address:'wallet',receipt:async()=>{calls++;return calls===1?pending.promise:null;}}});
 try{
 s.put('live-order','buy',{id:'buy',ca:'coin',side:'buy',status:'confirming',at:now});
 const a=engine.reconcile();await engine.reconcile();assert.equal(calls,1);pending.resolve(null);await a;
 at+=999;await engine.reconcile();assert.equal(calls,1);at++;await engine.reconcile();assert.equal(calls,2);assert.equal(s.all('live-position').length,0);
 }finally{engine.dispose();s.close();}
});
test('unquoted position takes precedence over another entry',async()=>{
 const s=new Store(':memory:');let checks=0;
 const engine=new LiveTrading(s,{ENABLE_LIVE_TRADING:'true'},null,{clock:()=>now,wallet:{address:'wallet'},jupiter:{status:()=>({})}});
 try{
 engine.control('start');s.put('live-signal','coin',signal);
 s.put('live-position','older',{ca:'older',status:'open',openedAt:now-1000});
 engine.checkExit=async p=>{assert.equal(p.ca,'older');checks++;};
 engine.buy=async()=>assert.fail('new entry must wait for initial position quote');
 await engine.tick(true);assert.equal(checks,1);
 }finally{engine.dispose();s.close();}
});
test('sell reason persists before response and failed sell fee is applied only once',async()=>{
 const s=new Store(':memory:'),response=defer();let at=now;
 const wallet={address:'wallet',prepare:async()=>({signature:'mock',signedTransaction:'mock-only'}),execute:()=>response.promise,receipt:async()=>({failed:true,feeLamports:5000,commitment:'confirmed'})};
 const engine=new LiveTrading(s,{},null,{wallet,clock:()=>at});
 try{
 s.put('live-position','coin',{ca:'coin',status:'open',costLamports:100000000});
 const submit=engine.submit({id:'sell:coin',ca:'coin',side:'sell',at:now,reason:'移动止盈'},quote);await flush();
 assert.equal(s.get('live-order','sell:coin').exitReason,'移动止盈');
 await engine.reconcile();await engine.reconcile();assert.equal(s.get('live-position','coin').costLamports,100005000);
 response.resolve({message:'late'});await submit;assert.equal(s.get('live-order','sell:coin').status,'failed');assert.equal(s.get('live-order','sell:coin').exitReason,'移动止盈');
 }finally{engine.dispose();s.close();}
});
