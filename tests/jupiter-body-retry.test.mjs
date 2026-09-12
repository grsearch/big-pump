import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../backend/store.mjs';
import {Jupiter,SOL,BUY_LAMPORTS} from '../backend/jupiter.mjs';
import {LiveTrading} from '../backend/live-trading.mjs';
const now=1800000000000;
const request=j=>j.order(SOL,'coin',BUY_LAMPORTS,'buy','wallet');
const good=url=>{const p=new URL(url).searchParams;return {inputMint:p.get('inputMint'),outputMint:p.get('outputMint'),inAmount:p.get('amount'),outAmount:'1000',otherAmountThreshold:'990',swapMode:'ExactIn',slippageBps:100,signatureFeeLamports:5000,prioritizationFeeLamports:300000,rentFeeLamports:0,taker:'wallet',transaction:'mock',requestId:'mock'};};
test('buy has a shared 3s header/body deadline, sell keeps 10s, timings are reported',async t=>{
 const budgets=[];t.mock.method(AbortSignal,'timeout',ms=>{budgets.push(ms);return new AbortController().signal;});
 const s=new Store(':memory:');let at=now;try{
  const j=new Jupiter(s,{JUPITER_API_KEY:'test'},async url=>{at+=7;return {ok:true,status:200,json:async()=>{at+=9;return good(url);}};},()=>at);
  for(const side of ['buy','sell']){const q=await j.order(SOL,'coin',BUY_LAMPORTS,side,'wallet');assert.deepEqual(q.timing,{headersMs:7,bodyMs:9,totalMs:16,timeoutMs:side==='buy'?3000:10000});}
  assert.deepEqual(budgets,[3000,10000]);
 }finally{s.close();}
});
test('body timeout, aborted stream, reset and invalid JSON are retryable and consume one reservation',async()=>{
 for(const error of [new DOMException('timeout','TimeoutError'),new DOMException('aborted','AbortError'),new TypeError('terminated'),new SyntaxError('bad JSON')]){
  const s=new Store(':memory:');try{
   const j=new Jupiter(s,{JUPITER_API_KEY:'test'},async()=>({ok:true,status:200,json:async()=>{throw error;}}),()=>now);
   await assert.rejects(()=>request(j),e=>e.retryable===true&&e.diagnostic.phase==='body');assert.equal(j.status().used,1);
  }finally{s.close();}
 }
});
test('HTTP authorization failures and unsafe quotes remain permanent failures',async()=>{
 const s=new Store(':memory:');try{
  for(const status of [400,401,403]){
   const j=new Jupiter(s,{JUPITER_API_KEY:'test'},async()=>({ok:false,status,json:()=>assert.fail('do not read HTTP error body')}),()=>now);
   await assert.rejects(()=>request(j),e=>!e.retryable);
  }
  const j=new Jupiter(s,{JUPITER_API_KEY:'test'},async url=>Response.json({...good(url),outputMint:'wrong-mint'}),()=>now);
  await assert.rejects(()=>request(j),e=>!e.retryable);
 }finally{s.close();}
});
test('headers timeout then body timeout recover on third attempt, same order and one broadcast',async()=>{
 const s=new Store(':memory:');let at=now,calls=0,sends=0;try{
  const j=new Jupiter(s,{JUPITER_API_KEY:'test'},async url=>{
   calls++;if(calls===1)throw new DOMException('timeout','TimeoutError');
   if(calls===2)return {ok:true,status:200,json:async()=>{throw new DOMException('timeout','TimeoutError');}};
   return Response.json(good(url));
  },()=>at);
  const wallet={address:'wallet',prepare:async()=>({signature:'mock',signedTransaction:'mock'}),execute:async()=>{sends++;return {message:'mock'};},receipt:async()=>null};
  const env={ENABLE_LIVE_TRADING:'true'};
  let e=new LiveTrading(s,env,null,{wallet,jupiter:j,clock:()=>at});e.control('start');
  s.put('live-signal','coin',{ca:'coin',source:'stonk',migrationVerified:true,creationVerified:true,createdAt:now-60000,graduatedAt:now,verifiedAt:now,status:'observing'});
  await e.tick(true);let o=s.all('live-order')[0];assert.equal(o.status,'retrying');assert.equal(o.diagnostic.phase,'headers');
  at=o.nextAttemptAt;e=new LiveTrading(s,env,null,{wallet,jupiter:j,clock:()=>at});await e.tick(true);
  o=s.all('live-order')[0];assert.equal(o.status,'retrying');assert.equal(o.attempts,2);assert.equal(o.diagnostic.phase,'body');
  at=o.nextAttemptAt;await e.tick(true);await e.tick(true);
  assert.equal(s.all('live-order').length,1);assert.equal(s.all('live-order')[0].status,'confirming');assert.equal(s.all('live-order')[0].attempts,3);assert.equal(sends,1);
 }finally{s.close();}
});
