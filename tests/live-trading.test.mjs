import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../backend/store.mjs';
import {Jupiter, SOL, BUY_LAMPORTS, validateOrder} from '../backend/jupiter.mjs';
import {LiveTrading, exitReason, migrateLiveExit, LIVE_C} from '../backend/live-trading.mjs';
import {LiveWallet} from '../backend/live-wallet.mjs';
import {Keypair,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
const now=1800000000000;
const quote=(extra={})=>({inputMint:SOL,outputMint:'coin',inAmount:BUY_LAMPORTS,outAmount:'1000',otherAmountThreshold:'990',swapMode:'ExactIn',slippageBps:100,
  signatureFeeLamports:5000,prioritizationFeeLamports:10000,rentFeeLamports:2000000,taker:'wallet',transaction:'test-only',requestId:'req',receivedAt:now,...extra});
const token=(extra={})=>({ca:'coin',symbol:'C',source:'stonk',migrationVerified:true,creationVerified:true,createdAt:now-60000,status:'observing',graduatedAt:now,marketAt:now,priceUsd:1,fdv:30000,lp:30000,xObservations:[{at:now,newAuthors:2,firstBatch:true}],...extra});
function setup() {
  const s=new Store(':memory:');let at=now,submitted=0,receipt=null,calls=[];
  const wallet={address:'wallet',prepare:async()=>({signature:'test-signature',signedTransaction:'never-broadcast'}),execute:async()=>{submitted++;assert.equal(s.all('live-order').at(-1).status,'confirming');return {message:'等待确认'};},receipt:async()=>receipt};
  const jupiter={status:()=>({limit:60,used:0}),order:async(inputMint,outputMint,amount,side)=>{calls.push(side);return quote({inputMint,outputMint,inAmount:amount});}};
  const env={ENABLE_LIVE_TRADING:'true'};
  const engine=new LiveTrading(s,env,null,{wallet,jupiter,clock:()=>at});
  return {s,engine,wallet,jupiter,env,calls,clock:n=>{at=n;},receipt:r=>{receipt=r;},submitted:()=>submitted};
}

test('graduation event starts a quote immediately without a timer',async()=>{
 const f=setup();f.engine.control('start');f.s.put('token','coin',token());
 await f.engine.onGraduation(true);assert.equal(f.submitted(),1);f.s.close();
});
test('transient quote failure retries the same intent after restart, never duplicates a submission',async()=>{
 const f=setup();f.engine.control('start');f.s.put('token','coin',token());const order=f.jupiter.order;let first=true;
 f.jupiter.order=async(...args)=>{if(first){first=false;throw Object.assign(Error('route pending'),{retryable:true});}return order(...args);};
 await f.engine.tick(true);assert.equal(f.s.all('live-order')[0].status,'retrying');
 const restarted=new LiveTrading(f.s,f.env,null,{wallet:f.wallet,jupiter:f.jupiter,clock:()=>now+1000});
 await restarted.tick(true);await restarted.tick(true);assert.equal(f.submitted(),1);assert.equal(f.s.all('live-order').length,1);assert.equal(f.s.all('live-order')[0].attempts,2);f.s.close();
});
test('retry backoff, maximum attempts, pause and graduation deadline are enforced',async()=>{
 for(const mode of ['limit','pause','deadline']){
 const f=setup();f.engine.control('start');f.s.put('token','coin',token());f.jupiter.order=async()=>{throw Object.assign(Error('offline'),{retryable:true});};
 await f.engine.tick(true);await f.engine.tick(true);assert.equal(f.s.all('live-order')[0].attempts,1);
 if(mode==='pause')f.engine.control('pause');
 if(mode==='deadline')f.clock(now+120001);
 if(mode==='limit')for(const delay of [1000,3000,7000,15000,23000]){f.clock(now+delay);await f.engine.tick(true);}
 else await f.engine.tick(true);
 assert.equal(f.s.all('live-order')[0].status,'skipped');assert.equal(f.submitted(),0);f.s.close();
 }
});
test('collector stop during quote prevents submission',async()=>{
 const f=setup();f.engine.control('start');f.s.put('token','coin',token());const order=f.jupiter.order;
 f.jupiter.order=async(...args)=>{await f.engine.tick(false);return order(...args);};
 await f.engine.onGraduation(true);assert.equal(f.submitted(),0);f.s.close();
});
test('routine exits alternate with new entries but triggered exits take priority',async()=>{
 for(const urgent of [false,true]){
 const f=setup();f.engine.control('start');f.s.put('token','coin',token());f.s.put('live-position','older',{ca:'older',status:'open',openedAt:now-10000,checkedAt:0,...(urgent?{exitReason:'exit'}:{})});
 let checks=0;f.engine.checkExit=async()=>{checks++;};await f.engine.tick(true);
 assert.equal(f.submitted(),urgent?0:1);if(!urgent)await f.engine.tick(true);assert.equal(checks,1);f.s.close();
 }
});
test('free tier persists sliding reservations and reserves 12 slots for exits',()=>{
  const s=new Store(':memory:');let at=now;
  let j=new Jupiter(s,{JUPITER_API_KEY:'test'},null,()=>at);
  for(let i=0;i<48;i++)j.reserve('buy');assert.throws(()=>j.reserve('buy'),/卖出优先/);
  j=new Jupiter(s,{JUPITER_API_KEY:'test'},null,()=>at);
  for(let i=0;i<12;i++)j.reserve('sell');assert.throws(()=>j.reserve('sell'));
  at+=60000;assert.equal(j.status().used,0);j.reserve('buy');s.close();
});
test('429 blocks all quotes and consumes reservation; never exposes response secrets',async()=>{
  const s=new Store(':memory:');let calls=0;
  const j=new Jupiter(s,{JUPITER_API_KEY:'test'},async()=>{calls++;return new Response('private',{status:429,headers:{'retry-after':'90'}});},()=>now);
  await assert.rejects(j.order(SOL,'coin',BUY_LAMPORTS,'buy'),/HTTP 429/);
  await assert.rejects(j.order(SOL,'coin',BUY_LAMPORTS,'sell'),/额度/);
  assert.equal(calls,1);assert.equal(j.status().blockedUntil,now+90000);s.close();
});
test('quote validates exact input, mint, minimum output, fees and signer',()=>{
  const expected={inputMint:SOL,outputMint:'coin',amount:BUY_LAMPORTS,taker:'wallet',slippageBps:100};
  assert.equal(validateOrder(quote(),expected).outAmount,'1000');
  for(const patch of [{inputMint:'wrong'},{outAmount:'0'},{otherAmountThreshold:'0'},{otherAmountThreshold:'980'},{inAmount:'1'},{slippageBps:200},{signatureFeeLamports:undefined},{taker:'other'},{transaction:''}])assert.throws(()=>validateOrder(quote(patch),expected));
});
test('default off cannot be armed or place orders even with injected wallet',async()=>{
  const f=setup();f.engine.env={};f.s.put('token','coin',token());
  assert.throws(()=>f.engine.control('start'));await f.engine.tick(true);assert.equal(f.submitted(),0);f.s.close();
});
test('wallet changes cannot silently take over an existing ledger',()=>{
  const f=setup();f.engine.control('start');
  const another=new LiveTrading(f.s,f.env,null,{wallet:{...f.wallet,address:'different'},jupiter:f.jupiter});
  assert.throws(()=>another.control('start'),/账本不一致/);f.s.close();
});
test('C uses 0.1 SOL, probes reverse route, persists intent before send, never assumes a fill',async()=>{
  const f=setup();f.engine.control('start');f.s.put('token','coin',token());
  await f.engine.tick(true);assert.equal(f.submitted(),1);assert.deepEqual(f.calls,['buy','buy']);
  assert.equal(f.s.all('live-order')[0].inputAmount,'100000000');assert.equal(f.s.all('live-position').length,0);
  assert(!JSON.stringify(f.engine.snapshot()).includes('never-broadcast'));
  await f.engine.tick(true);assert.equal(f.submitted(),1);f.s.close();
});
test('C rejects old/future graduations, unverified migration and failed program admission',async()=>{
 for(const patch of [{graduatedAt:now-1},{graduatedAt:now+1},{source:'pump'},{migrationVerified:false},{creationVerified:false},{createdAt:now-1200001}]){
 const f=setup();f.engine.control('start');f.s.put('token','coin',token(patch));await f.engine.tick(true);assert.equal(f.submitted(),0);f.s.close();
 }
});
test('C does not require X, FDV or Shadow models when Jupiter validates the real route',async()=>{
 const f=setup();f.engine.control('start');f.s.put('token','coin',token({xObservations:[],fdv:null,lp:null,shadowBlocked:'UI model unavailable'}));await f.engine.tick(true);assert.equal(f.submitted(),1);assert.equal(f.s.all('live-order')[0].strategy,LIVE_C);f.s.close();
});
test('C exits at 40 percent activation, 10 percent drawdown and 30 minutes',()=>{
 const p={strategy:LIVE_C,costLamports:100,openedAt:now,highLamports:0};assert.equal(exitReason(p,139,now),null);assert(!p.trailingActive);assert.equal(exitReason(p,140,now),null);assert(p.trailingActive);assert.equal(exitReason(p,127,now),null);assert.match(exitReason(p,126,now),/10%/);
 assert.equal(exitReason({strategy:LIVE_C,costLamports:100,openedAt:now},20,now+1799999),null);assert.match(exitReason({strategy:LIVE_C,costLamports:100,openedAt:now},20,now+1800000),/30 分钟/);
});
test('upgrading enabled A pauses new entries without deleting positions or pending orders',()=>{
 const f=setup();f.s.put('config','live-trading',{acceptEntries:true,wallet:'wallet',startedAt:now});f.s.put('live-position','old',{ca:'old',status:'open'});f.s.put('live-order','old-order',{id:'old-order',status:'confirming'});
 const engine=new LiveTrading(f.s,f.env,null,{wallet:f.wallet,jupiter:f.jupiter,clock:()=>now});assert.equal(engine.state().acceptEntries,false);assert.equal(f.s.all('live-position').length,1);assert.equal(f.s.all('live-order').length,1);f.s.close();
});
test('reverse route failure skips buy and never signs',async()=>{
  const f=setup();f.engine.control('start');f.s.put('token','coin',token());
  f.jupiter.order=async(input)=>{if(input!==SOL)throw Error('无卖出路由');return quote();};
  await f.engine.tick(true);assert.equal(f.submitted(),0);assert.match(f.s.all('live-order')[0].reason,/无卖出路由/);f.s.close();
});
test('pause while quote is in flight cancels entry',async()=>{
  const f=setup();f.engine.control('start');f.s.put('token','coin',token());
  f.jupiter.order=async()=>{f.engine.control('pause');return quote();};await f.engine.tick(true);
  assert.equal(f.submitted(),0);f.s.close();
});
test('uncertain submission survives restart without duplicate buy; receipt is applied once',async()=>{
  const f=setup();f.engine.control('start');f.s.put('token','coin',token());await f.engine.tick(true);
  const restarted=new LiveTrading(f.s,f.env,null,{wallet:f.wallet,jupiter:f.jupiter,clock:()=>now+10000});
  await restarted.tick(true);assert.equal(f.submitted(),1);assert.throws(()=>restarted.control('start'),/确认/);
  f.receipt({quantity:'997',solDelta:-102000000,at:now,failed:false});
  f.s.put('live-order',f.s.all('live-order')[0].id,{...f.s.all('live-order')[0],reconciledAt:0});
  await restarted.reconcile();await restarted.reconcile();assert.equal(f.s.all('live-position').length,1);assert.equal(f.s.get('live-position','coin').quantity,'997');assert.equal(f.s.get('live-position','coin').costLamports,102000000);f.s.close();
});
test('sell checks run while entries and collector are stopped',async()=>{
  const f=setup();f.s.put('live-position','coin',{ca:'coin',status:'open',quantity:'1000',costLamports:100000000,openedAt:now-1800001});
  await f.engine.tick(false);assert.equal(f.submitted(),1);assert.equal(f.s.all('live-order')[0].side,'sell');assert.deepEqual(f.calls,['sell']);f.s.close();
});
test('no five-position cap: all due positions are checked fairly',async()=>{
  const f=setup();for(let i=0;i<8;i++)f.s.put('live-position','c'+i,{ca:'c'+i,status:'open',quantity:'1000',costLamports:1,openedAt:now});
  f.jupiter.order=async()=>{throw Error('temporary');};
  for(let i=0;i<8;i++)await f.engine.tick(false);
  assert(f.s.all('live-position').every(p=>p.checkedAt===now));f.s.close();
});
test('net-SOL exits: arm100%, drawdown20%, no fixed TP/SL, time30m',()=>{
  const p={costLamports:100000000,openedAt:now};
  assert.equal(exitReason(p,119000000,now),null);assert(!p.trailingActive);
  assert.equal(exitReason(p,150000000,now),null);assert(!p.trailingActive);
  assert.equal(exitReason({...p},10000000,now),null);
  assert.equal(exitReason(p,199999999,now),null);assert(!p.trailingActive);
  assert.equal(exitReason(p,200000000,now),null);assert(p.trailingActive);
  assert.equal(exitReason(p,160000001,now),null);
  assert.match(exitReason(p,160000000,now),/20%/);
  assert.match(exitReason({...p},100000000,now+1800000),/30 分钟/);
});
test('old unsubmitted exits migrate, premature activation resets, closed trades are preserved',()=>{
  const p={costLamports:100,highLamports:150,trailingActive:true,exitReason:'固定止损 -15%',status:'open'};
  migrateLiveExit(p);assert.equal(p.trailingActive,false);assert.equal(p.exitReason,null);
  const peak={costLamports:100,highLamports:250,trailingActive:true,status:'open'};migrateLiveExit(peak);assert.equal(peak.trailingActive,true);
  const closed={...p,exitVersion:undefined,status:'closed',exitReason:'固定止损 -15%'};migrateLiveExit(closed);assert.equal(closed.exitReason,'固定止损 -15%');
});
test('chain receipts measure actual wallet delta, including fees and Token2022 net quantity',async()=>{
  const tx={blockTime:now/1000,transaction:{message:{accountKeys:['wallet']}},meta:{err:null,fee:5000,preBalances:[1000000000],postBalances:[898000000],preTokenBalances:[],postTokenBalances:[{owner:'wallet',mint:'coin',uiTokenAmount:{amount:'995'}}]}};
  const r=await LiveWallet.prototype.receipt.call({address:'wallet',rpc:async()=>tx},{ca:'coin',side:'buy',signature:'mock'});
  assert.equal(r.quantity,'995');assert.equal(r.solDelta,-102000000);
});

test('local signer checks payer, fee cap, simulation error and minimum net output before signing',async()=>{
  const keypair=Keypair.generate(),mint=Keypair.generate().publicKey.toBase58();
  const tx=new VersionedTransaction(new TransactionMessage({payerKey:keypair.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[]}).compileToV0Message());
  let output=1000n,simulationError=null,spent=102015000;
  const rpc=async method=>{
    if(method==='getAccountInfo')return {value:{owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'}};
    if(method==='getMultipleAccounts')return {value:[{lamports:1000000000},null]};
    if(method==='simulateTransaction'){const bytes=Buffer.alloc(165);bytes.writeBigUInt64LE(output,64);return {value:{err:simulationError,accounts:[{lamports:1000000000-spent},{data:[bytes.toString('base64'),'base64']}]}};}
    throw Error('Unexpected RPC');
  };
  const wallet={address:keypair.publicKey.toBase58(),keypair,rpc};
  const q=quote({outputMint:mint,taker:wallet.address,receivedAt:Date.now(),transaction:Buffer.from(tx.serialize()).toString('base64')});
  await assert.rejects(LiveWallet.prototype.prepare.call(wallet,q,'buy',1000),/费用/);
  simulationError={InstructionError:[0,'Custom']};await assert.rejects(LiveWallet.prototype.prepare.call(wallet,q,'buy',5000000),/模拟失败/);
  simulationError=null;output=980n;await assert.rejects(LiveWallet.prototype.prepare.call(wallet,q,'buy',5000000),/到账数量/);
  output=1000n;spent=200000000;await assert.rejects(LiveWallet.prototype.prepare.call(wallet,q,'buy',5000000),/买入金额/);
  spent=102015000;wallet.address=Keypair.generate().publicKey.toBase58();await assert.rejects(LiveWallet.prototype.prepare.call(wallet,q,'buy',5000000),/付款路由/);
});
