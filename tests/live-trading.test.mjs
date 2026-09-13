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
test('Jupiter requests fixed 0.0003 SOL priority fee for buy and sell, without added Jito tip',async()=>{
 const s=new Store(':memory:'),urls=[];
 const j=new Jupiter(s,{JUPITER_API_KEY:'test'},async url=>{const p=new URL(url).searchParams;urls.push(p);if(p.has('jitoTipLamports')&&Number(p.get('jitoTipLamports'))<1000)return Response.json({error:'tip must be at least 1000'},{status:400});return Response.json(quote({inputMint:p.get('inputMint'),outputMint:p.get('outputMint'),inAmount:p.get('amount'),prioritizationFeeLamports:300000}));},()=>now);
 for(const side of ['buy','sell'])await j.order(side==='buy'?SOL:'coin',side==='buy'?'coin':SOL,BUY_LAMPORTS,side,'wallet');
 assert.equal(j.status().priorityFeeLamports,300000);for(const p of urls){assert.equal(p.get('priorityFeeLamports'),'300000');assert.equal(p.get('broadcastFeeType'),'exactFee');assert.equal(p.has('jitoTipLamports'),false);}
 assert.equal(new Jupiter(s,{LIVE_PRIORITY_FEE_LAMPORTS:'200000'}).priorityFeeLamports,200000);
 assert.throws(()=>new Jupiter(s,{LIVE_PRIORITY_FEE_LAMPORTS:'-1'}));s.close();
});
test('live defaults to 15 percent, propagates it to quotes, respects overrides and rejects larger limits',async()=>{
 const f=setup();assert.equal(f.engine.slippageBps,1500);f.engine.control('start');f.s.put('live-signal','coin',token());
 const original=f.jupiter.order,limits=[];f.jupiter.order=async(...args)=>{limits.push(args[5]);return original(...args);};await f.engine.tick(true);assert.deepEqual(limits,[1500,1500]);
 const smaller=new LiveTrading(f.s,{...f.env,LIVE_SLIPPAGE_BPS:'100'},null,{wallet:f.wallet,jupiter:f.jupiter});assert.equal(smaller.slippageBps,100);
 const invalid=new LiveTrading(f.s,{...f.env,LIVE_SLIPPAGE_BPS:'1501'},null,{wallet:f.wallet,jupiter:f.jupiter});assert(invalid.error);f.s.close();
 const expected={inputMint:SOL,outputMint:'coin',amount:BUY_LAMPORTS,taker:'wallet',slippageBps:1500};
 assert(validateOrder(quote({slippageBps:1500,otherAmountThreshold:'850'}),expected));assert.throws(()=>validateOrder(quote({slippageBps:1500,otherAmountThreshold:'849'}),expected));
});

test('graduation event starts a quote immediately without a timer',async()=>{
 const f=setup();f.engine.control('start');f.s.put('live-signal','coin',token());
 await f.engine.onGraduation(true);assert.equal(f.submitted(),1);f.s.close();
});
test('transient quote failure retries the same intent after restart, never duplicates a submission',async()=>{
 const f=setup();f.engine.control('start');f.s.put('live-signal','coin',token());const order=f.jupiter.order;let first=true;
 f.jupiter.order=async(...args)=>{if(first){first=false;throw Object.assign(Error('route pending'),{retryable:true});}return order(...args);};
 await f.engine.tick(true);assert.equal(f.s.all('live-order')[0].status,'retrying');
 const restarted=new LiveTrading(f.s,f.env,null,{wallet:f.wallet,jupiter:f.jupiter,clock:()=>now+1000});
 await restarted.tick(true);await restarted.tick(true);assert.equal(f.submitted(),1);assert.equal(f.s.all('live-order').length,1);assert.equal(f.s.all('live-order')[0].attempts,2);f.s.close();
});
test('retry backoff, maximum attempts, pause and graduation deadline are enforced',async()=>{
 for(const mode of ['limit','pause','deadline']){
 const f=setup();f.engine.control('start');f.s.put('live-signal','coin',token());f.jupiter.order=async()=>{throw Object.assign(Error('offline'),{retryable:true});};
 await f.engine.tick(true);await f.engine.tick(true);assert.equal(f.s.all('live-order')[0].attempts,1);
 if(mode==='pause')f.engine.control('pause');
 if(mode==='deadline')f.clock(now+120001);
 if(mode==='limit')for(const delay of [1000,3000,7000,15000,23000]){f.clock(now+delay);await f.engine.tick(true);}
 else await f.engine.tick(true);
 assert.equal(f.s.all('live-order')[0].status,'skipped');assert.equal(f.submitted(),0);f.s.close();
 }
});
test('collector stop during quote prevents submission',async()=>{
 const f=setup();f.engine.control('start');f.s.put('live-signal','coin',token());const order=f.jupiter.order;
 f.jupiter.order=async(...args)=>{await f.engine.tick(false);return order(...args);};
 await f.engine.onGraduation(true);assert.equal(f.submitted(),0);f.s.close();
});
test('routine exits alternate with new entries but triggered exits take priority',async()=>{
 for(const urgent of [false,true]){
 const f=setup();f.engine.control('start');f.s.put('live-signal','coin',token());f.s.put('live-position','older',{ca:'older',status:'open',openedAt:now-10000,quoteAt:now-6000,checkedAt:0,...(urgent?{exitReason:'exit'}:{})});
 let checks=0;f.engine.checkExit=async()=>{checks++;};await f.engine.tick(true);
 assert.equal(f.submitted(),urgent?0:1);if(!urgent)await f.engine.tick(true);assert.equal(checks,1);f.s.close();
 }
});
test('Developer persists per-second reservations and leaves two slots for exits',()=>{
 const s=new Store(':memory:');let at=now;let j=new Jupiter(s,{},null,()=>at);
 try{assert.equal(j.status().plan,'Developer');assert.equal(j.limit,600);assert.equal(j.rps,10);
 for(let i=0;i<8;i++)j.reserve('buy');assert.throws(()=>j.reserve('buy'),e=>e.retryAt===now+1000);
 j=new Jupiter(s,{},null,()=>at);j.reserve('sell');j.reserve('sell');assert.throws(()=>j.reserve('sell'));
 at+=1000;j.reserve('buy');assert.equal(j.status().usedThisSecond,1);
 }finally{s.close();}
});
test('legacy Free env upgrades once by interpretation while explicit shared allocation is respected',()=>{
 const s=new Store(':memory:');try{const j=new Jupiter(s,{JUPITER_REQUESTS_PER_MINUTE:'60'});assert.equal(j.limit,600);assert(j.status().migratedLegacyLimit);
 const custom=new Jupiter(s,{JUPITER_REQUESTS_PER_MINUTE:'60',JUPITER_REQUESTS_PER_SECOND:'2'});assert.equal(custom.limit,60);assert.equal(custom.rps,2);assert(!custom.status().migratedLegacyLimit);assert.throws(()=>new Jupiter(s,{JUPITER_REQUESTS_PER_SECOND:'11'}));}finally{s.close();}
});
test('Developer minute guard survives restart and blocked retry does not add an extra minute',()=>{
 const s=new Store(':memory:');try{s.put('config','jupiter-rate',{calls:Array.from({length:588},(_,i)=>now-59000+i*95)});const j=new Jupiter(s,{},null,()=>now);assert.throws(()=>j.reserve('buy'),e=>e.retryAt===now+1000);j.reserve('sell');
 s.put('config','jupiter-rate',{calls:[now],blockedUntil:now+2000});assert.throws(()=>j.reserve('sell'),e=>e.retryAt===now+2000);}finally{s.close();}
});
test('short server Retry-After is honored for Developer instead of forced 60s sleep',async()=>{
 const s=new Store(':memory:');try{const j=new Jupiter(s,{JUPITER_API_KEY:'test'},async()=>new Response('',{status:429,headers:{'retry-after':'2'}}),()=>now);await assert.rejects(j.order(SOL,'coin',BUY_LAMPORTS,'buy'));assert.equal(j.status().blockedUntil,now+2000);}finally{s.close();}
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
  const f=setup();f.engine.env={};f.s.put('live-signal','coin',token());
  assert.throws(()=>f.engine.control('start'));await f.engine.tick(true);assert.equal(f.submitted(),0);f.s.close();
});
test('wallet changes cannot silently take over an existing ledger',()=>{
  const f=setup();f.engine.control('start');
  const another=new LiveTrading(f.s,f.env,null,{wallet:{...f.wallet,address:'different'},jupiter:f.jupiter});
  assert.throws(()=>another.control('start'),/账本不一致/);f.s.close();
});
test('C uses 0.1 SOL, probes reverse route, persists intent before send, never assumes a fill',async()=>{
  const f=setup();f.engine.control('start');f.s.put('live-signal','coin',token());
  await f.engine.tick(true);assert.equal(f.submitted(),1);assert.deepEqual(f.calls,['buy','buy']);
  assert.equal(f.s.all('live-order')[0].inputAmount,'100000000');assert.equal(f.s.all('live-position').length,0);
  assert(!JSON.stringify(f.engine.snapshot()).includes('never-broadcast'));
  await f.engine.tick(true);assert.equal(f.submitted(),1);f.s.close();
});
test('C rejects old/future graduations, unverified migration and failed program admission',async()=>{
 for(const patch of [{graduatedAt:now-1},{graduatedAt:now+1},{source:'pump'},{migrationVerified:false},{creationVerified:false},{createdAt:now-1200001}]){
 const f=setup();f.engine.control('start');f.s.put('live-signal','coin',token(patch));await f.engine.tick(true);assert.equal(f.submitted(),0);f.s.close();
 }
});
test('C does not require X, FDV or Shadow models when Jupiter validates the real route',async()=>{
 const f=setup();f.engine.control('start');f.s.put('live-signal','coin',token({xObservations:[],fdv:null,lp:null,shadowBlocked:'UI model unavailable'}));await f.engine.tick(true);assert.equal(f.submitted(),1);assert.equal(f.s.all('live-order')[0].strategy,LIVE_C);f.s.close();
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
  const f=setup();f.engine.control('start');f.s.put('live-signal','coin',token());
  f.jupiter.order=async(input)=>{if(input!==SOL)throw Error('无卖出路由');return quote();};
  await f.engine.tick(true);assert.equal(f.submitted(),0);assert.match(f.s.all('live-order')[0].reason,/无卖出路由/);f.s.close();
});
test('pause while quote is in flight cancels entry',async()=>{
  const f=setup();f.engine.control('start');f.s.put('live-signal','coin',token());
  f.jupiter.order=async()=>{f.engine.control('pause');return quote();};await f.engine.tick(true);
  assert.equal(f.submitted(),0);f.s.close();
});
test('uncertain submission survives restart without duplicate buy; receipt is applied once',async()=>{
  const f=setup();f.engine.control('start');f.s.put('live-signal','coin',token());await f.engine.tick(true);
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

test('local signer skips simulation and retains payer, fee and balance checks',async()=>{
  const keypair=Keypair.generate(),mint=Keypair.generate().publicKey.toBase58();
  const tx=new VersionedTransaction(new TransactionMessage({payerKey:keypair.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[]}).compileToV0Message());
  let balance=1000000000;const calls=[];
  const rpc=async method=>{calls.push(method);
    if(method==='getAccountInfo')return {value:{owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'}};
    if(method==='getMultipleAccounts')return {value:[{lamports:balance},{owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'},null,null]};
    throw Error('Unexpected RPC');
  };
  const wallet={address:keypair.publicKey.toBase58(),keypair,rpc};
  const q=quote({outputMint:mint,taker:wallet.address,receivedAt:Date.now(),transaction:Buffer.from(tx.serialize()).toString('base64')});
  await assert.rejects(LiveWallet.prototype.prepare.call(wallet,q,'buy',1000),/费用/);
  const signed=await LiveWallet.prototype.prepare.call(wallet,q,'buy',5000000);assert(signed.signature);assert.deepEqual(calls,['getMultipleAccounts']);
  balance=0;await assert.rejects(LiveWallet.prototype.prepare.call(wallet,q,'buy',5000000),/余额不足/);
  balance=1000000000;wallet.address=Keypair.generate().publicKey.toBase58();await assert.rejects(LiveWallet.prototype.prepare.call(wallet,q,'buy',5000000),/付款路由/);
});
