import {createHash,randomBytes} from 'node:crypto';
import BN from 'bn.js';
import {PublicKey,SystemProgram,ComputeBudgetProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,unpackMint,unpackAccount,getTransferFeeConfig,calculateEpochFee,getExtensionTypes,ExtensionType,getAccountLenForMint,getAccountLen,getAccountTypeOfMintType,getAssociatedTokenAddressSync,createAssociatedTokenAccountIdempotentInstruction,createInitializeAccount3Instruction,createCloseAccountInstruction,ACCOUNT_SIZE} from '@solana/spl-token';
import {CpmmPoolInfoLayout,CpmmConfigInfoLayout,CurveCalculator,makeSwapCpmmBaseInInstruction,getPdaPoolAuthority} from '@raydium-io/raydium-sdk-v2';
import {SOL} from './jupiter.mjs';

export const CPMM_PROGRAM='CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';
const program=new PublicKey(CPMM_PROGRAM),bn=n=>new BN(n.toString());
const disc=name=>createHash('sha256').update('account:'+name).digest().subarray(0,8);
const account=raw=>raw?{...raw,owner:new PublicKey(raw.owner),data:Buffer.from(raw.data[0],'base64')}:null;
const transient=message=>Object.assign(Error(message),{retryable:true});
function decode(raw,layout,name){const a=account(raw);if(!a)throw transient('CPMM 账户暂未就绪');if(a.owner.toBase58()!==CPMM_PROGRAM||a.data.length<layout.span||!a.data.subarray(0,8).equals(disc(name)))throw Error('CPMM 池或配置账户不匹配');return layout.decode(a.data);}
function mint(raw,address,owner){
 if(![TOKEN_PROGRAM_ID.toBase58(),TOKEN_2022_PROGRAM_ID.toBase58()].includes(owner.toBase58()))throw Error('CPMM 代币程序不支持');
 const m=unpackMint(address,account(raw),owner);
 // Hooks require extra accounts not present in the standard CPMM swap instruction.
 if(getExtensionTypes(m.tlvData).some(t=>t===ExtensionType.TransferHook||t===ExtensionType.NonTransferable))throw Error('CPMM 代币需要额外转账指令');
 return m;
}
export function cpmmAmounts({pool,config,vaultA,vaultB,inputMint,amount,slippageBps,feeIn=()=>0n,feeOut=()=>0n}){
 if(!Number.isInteger(slippageBps)||slippageBps<1||slippageBps>1500)throw Error('CPMM 滑点无效');
 const a=pool.mintA.toBase58()===inputMint;if(!a&&pool.mintB.toBase58()!==inputMint)throw Error('CPMM 输入币不在池内');
 if(![0,1,2].includes(pool.feeOn))throw Error('CPMM 手续费模式未知');
 const reserve=(balance,suffix)=>bn(balance).sub(pool['protocolFeesMint'+suffix]).sub(pool['fundFeesMint'+suffix]).sub(pool['creatorFeesMint'+suffix]);
 const ra=reserve(vaultA,'A'),rb=reserve(vaultB,'B');if(ra.lten(0)||rb.lten(0))throw transient('CPMM 可用储备不足');
 const input=BigInt(amount),net=input-feeIn(input);if(net<=0n)throw Error('CPMM 税后输入为零');
 const result=CurveCalculator.swapBaseInput(bn(net),a?ra:rb,a?rb:ra,config.tradeFeeRate,pool.enableCreatorFee?config.creatorFeeRate:bn(0),config.protocolFeeRate,config.fundFeeRate,pool.feeOn===0||pool.feeOn===(a?1:2));
 const gross=BigInt(result.outputAmount.toString()),out=gross-feeOut(gross),minimum=out*BigInt(10000-slippageBps)/10000n;
 if(minimum<=0n)throw Error('CPMM 最小到账为零');return {outAmount:out.toString(),otherAmountThreshold:minimum.toString(),baseIn:a};
}

export class Cpmm {
 constructor(rpc,env={},clock=Date.now){this.rpc=rpc;this.clock=clock;this.priority=Number(env.LIVE_PRIORITY_FEE_LAMPORTS??300000);this.keys=new Map();this.rents=new Map();if(!Number.isSafeInteger(this.priority)||this.priority<0)throw Error('优先费配置无效');}
 async rent(size){if(!this.rents.has(size))this.rents.set(size,await this.rpc('getMinimumBalanceForRentExemption',[size]));return this.rents.get(size);}
 async order(t,inputMint,outputMint,amount,taker,slippageBps){
  if(!t?.pool||t.source!=='stonk'||!t.migrationVerified)throw Error('缺少已核验的 Stonk 迁移池');
  if(t.quoteMint!==SOL)throw Error('非 SOL 计价池需要多跳兑换');
  if(!/^[0-9]+$/.test(amount)||BigInt(amount)<=0n||BigInt(amount)>18446744073709551615n)throw Error('CPMM 输入金额无效');
  let keys=this.keys.get(t.pool);
  if(!keys){keys=decode((await this.rpc('getAccountInfo',[t.pool,{encoding:'base64',commitment:'confirmed'}]))?.value,CpmmPoolInfoLayout,'PoolState');this.keys.set(t.pool,keys);}
  const addresses=[t.pool,keys.configId,keys.vaultA,keys.vaultB,keys.mintA,keys.mintB].map(String);
  const [data,epoch]=await Promise.all([this.rpc('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'confirmed'}]),this.rpc('getEpochInfo',[{commitment:'confirmed'}])]);
  const raws=data?.value??[],pool=decode(raws[0],CpmmPoolInfoLayout,'PoolState'),config=decode(raws[1],CpmmConfigInfoLayout,'AmmConfig');
  for(const key of ['configId','vaultA','vaultB','mintA','mintB','mintProgramA','mintProgramB','observationId'])if(!keys[key].equals(pool[key])){this.keys.delete(t.pool);throw Error('CPMM 池账户已变化，等待重新读取');}
  if(pool.status&4||Number(pool.openTime.toString())*1000>this.clock())throw transient('CPMM 池尚未开放交易');
  const mints=[pool.mintA.toBase58(),pool.mintB.toBase58()];if(!mints.includes(t.ca)||!mints.includes(SOL)||inputMint===outputMint||!mints.includes(inputMint)||!mints.includes(outputMint))throw Error('CPMM 池币种不匹配');
  const ma=mint(raws[4],pool.mintA,pool.mintProgramA),mb=mint(raws[5],pool.mintB,pool.mintProgramB);
  const authority=getPdaPoolAuthority(program).publicKey,va=unpackAccount(pool.vaultA,account(raws[2]),pool.mintProgramA),vb=unpackAccount(pool.vaultB,account(raws[3]),pool.mintProgramB);
  if(!va.mint.equals(pool.mintA)||!vb.mint.equals(pool.mintB)||!va.owner.equals(authority)||!vb.owner.equals(authority))throw Error('CPMM vault 校验失败');
  const a=inputMint===mints[0],mi=a?ma:mb,mo=a?mb:ma;
  const fee=m=>{const f=getTransferFeeConfig(m);return n=>f?calculateEpochFee(f,BigInt(epoch.epoch),n):0n;};
  const amounts=cpmmAmounts({pool,config,vaultA:va.amount,vaultB:vb.amount,inputMint,amount,slippageBps,feeIn:fee(mi),feeOut:fee(mo)});
  const q={...amounts,inputMint,outputMint,inAmount:amount,swapMode:'ExactIn',slippageBps,signatureFeeLamports:5000,prioritizationFeeLamports:this.priority,rentFeeLamports:0,receivedAt:this.clock(),transport:'cpmm',pool:t.pool,quoteMint:SOL};
  if(!taker)return q;
  const owner=new PublicKey(taker),base=new PublicKey(t.ca),baseProgram=pool.mintA.equals(base)?pool.mintProgramA:pool.mintProgramB,baseMint=pool.mintA.equals(base)?ma:mb;
  const ata=getAssociatedTokenAddressSync(base,owner,false,baseProgram);
  const [ataRaw,blockhash,tempRent,ataRent]=await Promise.all([this.rpc('getAccountInfo',[ata.toBase58(),{encoding:'base64',commitment:'confirmed'}]),this.rpc('getLatestBlockhash',[{commitment:'confirmed'}]),this.rent(ACCOUNT_SIZE),this.rent(baseProgram.equals(TOKEN_2022_PROGRAM_ID)?getAccountLen([...getExtensionTypes(baseMint.tlvData).map(getAccountTypeOfMintType),ExtensionType.ImmutableOwner]):getAccountLenForMint(baseMint))]);
  if(ataRaw.value){const existing=unpackAccount(ata,account(ataRaw.value),baseProgram);if(!existing.owner.equals(owner)||!existing.mint.equals(base))throw Error('CPMM 钱包代币账户不匹配');}
  const buying=inputMint===SOL;if(!buying&&!ataRaw.value)throw Error('CPMM 卖出代币账户不存在');
  const seed=randomBytes(16).toString('hex'),temp=await PublicKey.createWithSeed(owner,seed,TOKEN_PROGRAM_ID),cu=300000;
  const micro=(BigInt(this.priority)*1000000n+BigInt(cu)-1n)/BigInt(cu);
  const actualPriority=Number((micro*BigInt(cu)+999999n)/1000000n);
  const funding=BigInt(tempRent)+(buying?BigInt(amount):0n);if(funding>BigInt(Number.MAX_SAFE_INTEGER))throw Error('CPMM SOL 金额超出范围');
  const instructions=[ComputeBudgetProgram.setComputeUnitLimit({units:cu}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:micro}),SystemProgram.createAccountWithSeed({fromPubkey:owner,basePubkey:owner,newAccountPubkey:temp,seed,space:ACCOUNT_SIZE,lamports:Number(funding),programId:TOKEN_PROGRAM_ID}),createInitializeAccount3Instruction(temp,new PublicKey(SOL),owner)];
  if(buying)instructions.push(createAssociatedTokenAccountIdempotentInstruction(owner,ata,owner,base,baseProgram));
  instructions.push(makeSwapCpmmBaseInInstruction(program,owner,authority,pool.configId,new PublicKey(t.pool),buying?temp:ata,buying?ata:temp,a?pool.vaultA:pool.vaultB,a?pool.vaultB:pool.vaultA,a?pool.mintProgramA:pool.mintProgramB,a?pool.mintProgramB:pool.mintProgramA,new PublicKey(inputMint),new PublicKey(outputMint),pool.observationId,bn(amount),bn(amounts.otherAmountThreshold)),createCloseAccountInstruction(temp,owner,owner));
  const message=new TransactionMessage({payerKey:owner,recentBlockhash:blockhash.value.blockhash,instructions}).compileToV0Message();
  const tx=new VersionedTransaction(message),serialized=tx.serialize();if(serialized.length>1232)throw Error('CPMM 交易长度超限');
  const feeResult=await this.rpc('getFeeForMessage',[Buffer.from(message.serialize()).toString('base64'),{commitment:'confirmed'}]);
  if(!Number.isSafeInteger(feeResult?.value)||feeResult.value<actualPriority)throw transient('CPMM 网络费用暂不可用');
  return {...q,taker,transaction:Buffer.from(serialized).toString('base64'),lastValidBlockHeight:blockhash.value.lastValidBlockHeight,signatureFeeLamports:feeResult.value-actualPriority,prioritizationFeeLamports:actualPriority,rentFeeLamports:buying&&!ataRaw.value?ataRent:0,temporaryRentLamports:tempRent};
 }
}
