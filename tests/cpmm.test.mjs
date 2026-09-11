import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import BN from 'bn.js';
import {PublicKey,Keypair,VersionedTransaction} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,MintLayout,AccountLayout,TransferFeeConfigLayout,ExtensionType} from '@solana/spl-token';
import {CpmmPoolInfoLayout,CpmmConfigInfoLayout,getPdaPoolAuthority} from '@raydium-io/raydium-sdk-v2';
import {Cpmm,CPMM_PROGRAM,cpmmAmounts} from '../backend/cpmm.mjs';
import {SwapRouter} from '../backend/swap-router.mjs';
import {LiveWallet} from '../backend/live-wallet.mjs';
import {Store} from '../backend/store.mjs';
import {SOL} from '../backend/jupiter.mjs';
const key=()=>Keypair.generate().publicKey,bn=n=>new BN(n),program=new PublicKey(CPMM_PROGRAM);
function fixture(){
 const poolId=key(),ca=key(),owner=key(),authority=getPdaPoolAuthority(program).publicKey;
 const p={...CpmmPoolInfoLayout.decode(Buffer.alloc(CpmmPoolInfoLayout.span)),configId:key(),vaultA:key(),vaultB:key(),mintA:new PublicKey(SOL),mintB:ca,mintProgramA:TOKEN_PROGRAM_ID,mintProgramB:TOKEN_PROGRAM_ID,observationId:key(),openTime:bn(1)};
 const c={...CpmmConfigInfoLayout.decode(Buffer.alloc(CpmmConfigInfoLayout.span)),tradeFeeRate:bn(2500),creatorFeeRate:bn(1000),protocolFeeRate:bn(120000),fundFeeRate:bn(40000)};
 const record=(data,owner=program)=>({data:[data.toString('base64'),'base64'],owner:owner.toBase58(),lamports:3000000,executable:false,rentEpoch:0});
 const encode=(layout,data,name)=>{const b=Buffer.alloc(layout.span);layout.encode(data,b);if(name)createHash('sha256').update('account:'+name).digest().copy(b,0,0,8);return b;};
 const mintData=()=>record(encode(MintLayout,{...MintLayout.decode(Buffer.alloc(82)),isInitialized:true,decimals:9,supply:1000000000000n}),TOKEN_PROGRAM_ID);
 const vault=(mint,amount)=>record(encode(AccountLayout,{...AccountLayout.decode(Buffer.alloc(165)),mint,owner:authority,amount,state:1}),TOKEN_PROGRAM_ID);
 const records=new Map([[String(poolId),record(encode(CpmmPoolInfoLayout,p,'PoolState'))],[String(p.configId),record(encode(CpmmConfigInfoLayout,c,'AmmConfig'))],[String(p.vaultA),vault(p.mintA,100000000000n)],[String(p.vaultB),vault(ca,1000000000000n)],[SOL,mintData()],[String(ca),mintData()]]);
 const calls=[];let tokenAccount=null;
 const rpc=async(method,args)=>{calls.push(method);switch(method){
 case 'getAccountInfo':return {value:records.get(args[0])??tokenAccount};
 case 'getMultipleAccounts':return {value:args[0].map(a=>records.get(a)??null)};
 case 'getEpochInfo':return {epoch:20};
 case 'getLatestBlockhash':return {value:{blockhash:String(key()),lastValidBlockHeight:100}};
 case 'getMinimumBalanceForRentExemption':return 2039280;
 case 'getFeeForMessage':return {value:305000};
 default:throw Error('Unexpected RPC '+method);
 }};
 return {p,c,ca:String(ca),owner:String(owner),poolId:String(poolId),records,calls,rpc,record,encode,tokenAccount:()=>{tokenAccount=record(encode(AccountLayout,{...AccountLayout.decode(Buffer.alloc(165)),mint:ca,owner,amount:10000000n,state:1}),TOKEN_PROGRAM_ID);},t:{ca:String(ca),pool:String(poolId),quoteMint:SOL,source:'stonk',migrationVerified:true}};
}
test('SDK builds a SOL CPMM swap entirely from RPC, with local min output and temporary WSOL cleanup',async()=>{
 const f=fixture(),cpmm=new Cpmm(f.rpc),q=await cpmm.order(f.t,SOL,f.ca,'100000000',f.owner,1500);
 assert.equal(q.transport,'cpmm');assert.equal(q.prioritizationFeeLamports,300000);assert.equal(q.signatureFeeLamports,5000);assert.equal(q.rentFeeLamports,2039280);assert.equal(q.temporaryRentLamports,2039280);
 const tx=VersionedTransaction.deserialize(Buffer.from(q.transaction,'base64'));
 const swap=tx.message.compiledInstructions.find(i=>tx.message.staticAccountKeys[i.programIdIndex].toBase58()===CPMM_PROGRAM);assert(swap);assert.equal(Buffer.from(swap.data).readBigUInt64LE(8),100000000n);assert.equal(Buffer.from(swap.data).readBigUInt64LE(16),BigInt(q.otherAmountThreshold));
 assert.equal(tx.message.header.numRequiredSignatures,1);assert.equal(tx.message.compiledInstructions.at(-1).data[0],9);assert(!f.calls.includes('simulateTransaction'));assert(!f.calls.includes('sendTransaction'));
 f.tokenAccount();const sell=await cpmm.order(f.t,f.ca,SOL,'1000000',f.owner,1500);assert.equal(sell.rentFeeLamports,0);assert.equal(sell.outputMint,SOL);
});
test('SDK rejects spoofed pool, wrong mints, closed pools and uses current reserves',async()=>{
 for(const kind of ['owner','mint','closed']){const f=fixture(),cpmm=new Cpmm(f.rpc);
 if(kind==='owner')f.records.get(f.poolId).owner=String(key());
 if(kind==='mint')f.t.ca=String(key());
 if(kind==='closed'){f.p.status=4;f.records.set(f.poolId,f.record(f.encode(CpmmPoolInfoLayout,f.p,'PoolState')));}
 await assert.rejects(cpmm.order(f.t,SOL,f.t.ca,'10000',undefined,1500));}
 const f=fixture(),cpmm=new Cpmm(f.rpc);const one=await cpmm.order(f.t,SOL,f.ca,'10000000',undefined,1500);
 const raw=f.records.get(String(f.p.vaultB)),bytes=Buffer.from(raw.data[0],'base64');bytes.writeBigUInt64LE(500000000000n,64);raw.data[0]=bytes.toString('base64');
 const two=await cpmm.order(f.t,SOL,f.ca,'10000000',undefined,1500);assert(BigInt(two.outAmount)<BigInt(one.outAmount));
});
test('Token-2022 output uses current epoch transfer fee and net minimum, including fee cap',async()=>{
 const f=fixture();const before=await new Cpmm(f.rpc).order(f.t,SOL,f.ca,'100000000',undefined,1500);
 const raw=f.records.get(f.ca),mintBytes=Buffer.alloc(278);Buffer.from(raw.data[0],'base64').copy(mintBytes);mintBytes[165]=1;mintBytes.writeUInt16LE(ExtensionType.TransferFeeConfig,166);mintBytes.writeUInt16LE(108,168);
 const zero=TransferFeeConfigLayout.decode(Buffer.alloc(108));TransferFeeConfigLayout.encode({...zero,olderTransferFee:{epoch:0n,maximumFee:100000000n,transferFeeBasisPoints:100},newerTransferFee:{epoch:20n,maximumFee:100000000n,transferFeeBasisPoints:500}},mintBytes.subarray(170));
 raw.owner=TOKEN_2022_PROGRAM_ID.toBase58();raw.data[0]=mintBytes.toString('base64');f.p.mintProgramB=TOKEN_2022_PROGRAM_ID;f.records.set(f.poolId,f.record(f.encode(CpmmPoolInfoLayout,f.p,'PoolState')));f.records.get(String(f.p.vaultB)).owner=raw.owner;
 const taxed=await new Cpmm(f.rpc).order(f.t,SOL,f.ca,'100000000',f.owner,1500);const gross=BigInt(before.outAmount),fee=(gross*500n+9999n)/10000n;
 assert.equal(BigInt(taxed.outAmount),gross-(fee>100000000n?100000000n:fee));assert.equal(BigInt(taxed.otherAmountThreshold),BigInt(taxed.outAmount)*85n/100n);assert.equal(taxed.transport,'cpmm');
});
test('fee calculation subtracts transfer taxes and uses creator fee direction for each input mint',()=>{
 const f=fixture();f.p.enableCreatorFee=true;f.p.feeOn=1;
 const args={pool:f.p,config:f.c,vaultA:100000000000n,vaultB:100000000000n,inputMint:SOL,amount:'100000000',slippageBps:1500};
 const plain=cpmmAmounts(args),taxed=cpmmAmounts({...args,feeIn:n=>(n+99n)/100n,feeOut:n=>(n+99n)/100n});assert(BigInt(taxed.outAmount)<BigInt(plain.outAmount));assert.equal(BigInt(taxed.otherAmountThreshold),BigInt(taxed.outAmount)*85n/100n);
 f.p.feeOn=2;const other=cpmmAmounts(args);assert.notEqual(other.outAmount,plain.outAmount);
});
test('router uses CPMM without Jupiter key and retains explicit fallback and saved pool proof',async()=>{
 const s=new Store(':memory:');s.put('stonk-verified-migration','coin',{source:'stonk',migrationVerified:true,pool:'saved',quoteMint:SOL});let seen, fallback=0;
 const cpmm={order:async(t,inputMint,outputMint,amount)=>{seen=t;return {transport:'cpmm',inputMint,outputMint,inAmount:amount,outAmount:'100',otherAmountThreshold:'85',swapMode:'ExactIn',slippageBps:1500,signatureFeeLamports:5000,prioritizationFeeLamports:300000,rentFeeLamports:0};}};
 const jupiter={status:()=>({}),order:async()=>{fallback++;return {};}};
 const r=new SwapRouter(s,{},null,{cpmm,jupiter});assert.equal((await r.order(SOL,'coin','100','buy',undefined,1500)).transport,'cpmm');assert.equal(seen.pool,'saved');assert.equal(fallback,0);
 cpmm.order=async()=>{throw Error('non SOL quote');};await assert.rejects(r.order(SOL,'coin','100','buy',undefined,1500));
 const fallbackRouter=new SwapRouter(s,{JUPITER_API_KEY:'test'},null,{cpmm,jupiter});assert.equal((await fallbackRouter.order(SOL,'coin','100','buy',undefined,1500)).fallbackReason,'non SOL quote');assert.equal(fallback,1);s.close();
});
test('CPMM submission uses RPC without simulation and uncertain sends do not trigger a second send',async()=>{
 let count=0;const wallet={rpc:async(method,args)=>{count++;assert.equal(method,'sendTransaction');assert.equal(args[1].skipPreflight,true);assert.equal(args[1].maxRetries,0);throw Error('timeout');}};
 const result=await LiveWallet.prototype.execute.call(wallet,{transport:'cpmm',signedTransaction:'mock',signature:'mock'});assert.match(result.message,/结果不明/);assert.equal(count,1);
});
