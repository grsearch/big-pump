import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LiveWallet} from '../backend/live-wallet.mjs';
import {LiveTrading,LIVE_C} from '../backend/live-trading.mjs';
import {Store} from '../backend/store.mjs';
// Public finalized transaction 24ghA5wZ...XpgWcwv3, captured via getTransaction/jsonParsed.
const original=JSON.parse(readFileSync(new URL('./fixtures/bercd-cashback.json',import.meta.url),'utf8'));
const wallet=original.transaction.message.accountKeys[0].pubkey;
const ca='BercdsTA8vDhD23R6e12iFqoNtQGwaNFmXwya4ECF58M';
const order={id:'buy:'+ca,ca,side:'buy',strategy:LIVE_C,status:'confirming',signature:original.transaction.signatures[0]};
const receipt=(tx,side='buy')=>LiveWallet.prototype.receipt.call({address:wallet,rpc:async(method,args)=>{assert.equal(args[1].encoding,'jsonParsed');return tx;}},{...order,side});
const inner=t=>t.meta.innerInstructions.find(g=>g.instructions.some(i=>i.data==='7E9g4XZrCjE')).instructions;
const claim=t=>inner(t).find(i=>i.data==='7E9g4XZrCjE');
const transfer=t=>inner(t)[inner(t).indexOf(claim(t))+1];

test('actual Bercd cashback is separate from principal, ATA rent and network fee',async()=>{
 const r=await receipt(original);
 assert.equal(r.walletSolDelta,19556250);assert.equal(r.cashbackLamports,121436050);
 assert.equal(r.solDelta,-101879800);assert.equal(-r.solDelta,100000000+1574800+305000);
 assert.equal(r.quantity,'317736835826');assert.equal(r.cashbackEvidence.length,1);
 assert.equal(r.walletSolDelta,r.solDelta+r.cashbackLamports);
});
test('cashback is separated even when native buy delta remains negative',async()=>{
 const t=structuredClone(original);transfer(t).parsed.info.tokenAmount.amount='1000000';
 t.meta.postBalances[0]=t.meta.preBalances[0]-100879800;
 const r=await receipt(t);assert.equal(r.solDelta,-101879800);assert.equal(r.cashbackLamports,1000000);
});
test('sell proceeds exclude accrued cashback too',async()=>{
 const t=structuredClone(original);[t.meta.preTokenBalances,t.meta.postTokenBalances]=[t.meta.postTokenBalances,t.meta.preTokenBalances];
 t.meta.postBalances[0]=t.meta.preBalances[0]+200000000+121436050;
 const r=await receipt(t,'sell');assert.equal(r.solDelta,200000000);assert.equal(r.quantity,'317736835826');
});
test('unproven cashback never bypasses accounting review',async()=>{
 for(const change of [
  t=>claim(t).accounts[1]=wallet,
  t=>transfer(t).parsed.info.destination=wallet,
  t=>transfer(t).parsed.info.mint=ca,
  t=>transfer(t).stackHeight=2,
  t=>delete transfer(t).parsed,
  t=>t.transaction.message.instructions.pop(),
  t=>claim(t).programId=wallet,
 ]) {const t=structuredClone(original);change(t);await assert.rejects(()=>receipt(t));}
});
test('existing WSOL inventory is not mistaken for fresh SOL payment',async()=>{
 const t=structuredClone(original),index=t.transaction.message.accountKeys.findIndex(k=>k.pubkey===claim(t).accounts[5]);
 t.meta.preTokenBalances.push({accountIndex:index,owner:wallet,mint:claim(t).accounts[2],uiTokenAmount:{amount:'10000000',decimals:9}});
 await assert.rejects(()=>receipt(t),/返现资金流/);
});
test('stuck finalized order recovers once, preserves actual entry time and credits separately',async()=>{
 const s=new Store(':memory:');try{
  s.put('live-order',order.id,{...order,reconcileRequired:true,at:original.blockTime*1000,signedTransaction:'must-not-rebroadcast'});
  const e=new LiveTrading(s,{},null,{clock:()=>original.blockTime*1000+3600000,wallet:{address:wallet,receipt:()=>receipt(original),execute:()=>assert.fail('no rebroadcast')}});
  await e.reconcile();await e.reconcile();
  const p=s.get('live-position',ca);assert.equal(s.all('live-position').length,1);
  assert.equal(p.costLamports,101879800);assert.equal(p.buyCashbackLamports,121436050);assert.equal(p.openedAt,original.blockTime*1000);
  assert.equal(s.get('live-order',order.id).status,'confirmed');assert.equal(s.get('live-order',order.id).reconcileRequired,false);
 }finally{s.close();}
});
