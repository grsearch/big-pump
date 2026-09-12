import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {LiveWallet} from '../backend/live-wallet.mjs';
import {SOL} from '../backend/jupiter.mjs';
const TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',T22='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
function setup(){const keypair=Keypair.generate(),mint=Keypair.generate().publicKey.toBase58();
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:keypair.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[]}).compileToV0Message());
 return {wallet:{keypair,address:keypair.publicKey.toBase58()},q:{inputMint:SOL,outputMint:mint,inAmount:'100000000',signatureFeeLamports:5000,prioritizationFeeLamports:300000,rentFeeLamports:0,receivedAt:Date.now(),transaction:Buffer.from(tx.serialize()).toString('base64')}};
}
test('one batched snapshot selects the correct legacy or Token2022 ATA',async()=>{
 for(const program of [TOKEN,T22]){const {wallet,q}=setup();let count=0,held=false;
  wallet.rpc=async(method,args)=>{count++;assert.equal(method,'getMultipleAccounts');assert.equal(args[0].length,4);assert.equal(args[0][1],q.outputMint);assert.notEqual(args[0][2],args[0][3]);const data=Buffer.alloc(165);data.writeBigUInt64LE(held?123n:0n,64);const values=[{lamports:1e9},{owner:program},null,null];values[program===TOKEN?2:3]={data:[data.toString('base64'),'base64']};return {value:values};};
  const r=await LiveWallet.prototype.prepare.call(wallet,q,'buy',5000000);assert.equal(count,1);assert(r.signature);assert(r.prepareTiming.rpcMs>=0);
  held=true;await assert.rejects(()=>LiveWallet.prototype.prepare.call(wallet,q,'buy',5000000),/已持有/);
 }
});
test('expiry during RPC is retryable before signing, with preparation timing',async t=>{
 const {wallet,q}=setup();let at=q.receivedAt;t.mock.method(Date,'now',()=>at);
 wallet.rpc=async()=>{at+=10001;return {value:[{lamports:1e9},{owner:TOKEN},null,null]};};
 await assert.rejects(()=>LiveWallet.prototype.prepare.call(wallet,q,'buy',5000000),e=>e.retryable===true&&e.diagnostic.kind==='quote-expired'&&e.diagnostic.quoteAgeMs===10001);
});
test('transport failures retry but unsupported mint programs do not',async()=>{
 const {wallet,q}=setup();wallet.rpc=async()=>{throw Error('network');};
 await assert.rejects(()=>LiveWallet.prototype.prepare.call(wallet,q,'buy',5000000),e=>e.retryable===true&&e.diagnostic.phase==='prepare-rpc');
 wallet.rpc=async()=>({value:[{lamports:1e9},{owner:'wrong'},null,null]});
 await assert.rejects(()=>LiveWallet.prototype.prepare.call(wallet,q,'buy',5000000),e=>!e.retryable);
});
