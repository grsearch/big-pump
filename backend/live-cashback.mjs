import {PublicKey} from '@solana/web3.js';
import {SOL} from './jupiter.mjs';

const AMM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
// Pump's public pump_amm IDL: claim_cashback [37,58,35,126,190,53,228,197].
// https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump_amm.json
const CLAIM = '7E9g4XZrCjE';
const ata = owner => PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(),new PublicKey(TOKEN).toBuffer(),new PublicKey(SOL).toBuffer()],ASSOCIATED)[0].toBase58();

// Only separate a proven cashback transfer that was unwrapped into this wallet.
// Unknown inflows must not be treated as cashback merely to make a cost positive.
export function nativeCashback(tx,wallet) {
  const flat=[];
  for(const [index,ix] of (tx.transaction.message.instructions??[]).entries()) {
    flat.push({...ix,stackHeight:1,location:String(index)});
    for(const [inner,jx] of (tx.meta.innerInstructions?.find(g=>g.index===index)?.instructions??[]).entries())
      flat.push({...jx,location:index+':'+inner});
  }
  const evidence=[];
  for(let i=0;i<flat.length;i++) {
    const ix=flat[i];
    if(ix.programId!==AMM||ix.data!==CLAIM||ix.accounts?.[0]!==wallet)continue;
    const fail=()=>{throw Error('PumpSwap 返现资金流未完整核实，等待账务核对');};
    const a=ix.accounts, accumulator=PublicKey.findProgramAddressSync([Buffer.from('user_volume_accumulator'),new PublicKey(wallet).toBuffer()],new PublicKey(AMM))[0].toBase58();
    if(a[1]!==accumulator||a[2]!==SOL||a[3]!==TOKEN||a[4]!==ata(accumulator)||a[5]!==ata(wallet)||!Number.isInteger(ix.stackHeight))fail();
    let end=i+1;
    while(end<flat.length&&flat[end].stackHeight>ix.stackHeight)end++;
    const transfers=flat.slice(i+1,end).filter(x=>x.programId===TOKEN&&x.parsed?.type==='transferChecked');
    if(transfers.length!==1)fail();
    const transfer=transfers[0],info=transfer.parsed.info;
    if(transfer.stackHeight!==ix.stackHeight+1||info.source!==a[4]||info.destination!==a[5]||info.authority!==a[1]||info.mint!==SOL||info.tokenAmount?.decimals!==9||!/^\d+$/.test(info.tokenAmount?.amount??''))fail();
    const lamports=Number(info.tokenAmount.amount);
    if(!Number.isSafeInteger(lamports)||lamports<0)fail();
    const close=flat.slice(end).some(x=>x.programId===TOKEN&&x.parsed?.type==='closeAccount'&&x.parsed.info.account===a[5]&&x.parsed.info.destination===wallet&&x.parsed.info.owner===wallet);
    const keys=tx.transaction.message.accountKeys.map(k=>typeof k==='string'?k:k.pubkey);
    const balance=list=>(list??[]).filter(b=>keys[b.accountIndex]===a[5]).reduce((n,b)=>n+BigInt(b.uiTokenAmount.amount),0n);
    // Existing/remaining WSOL needs a separate inventory cost basis; don't guess it.
    if(!close||balance(tx.meta.preTokenBalances)!==0n||balance(tx.meta.postTokenBalances)!==0n)fail();
    evidence.push({program:AMM,instruction:'claim_cashback',location:ix.location,source:a[4],destination:a[5],lamports});
  }
  const cashbackLamports=evidence.reduce((n,e)=>n+e.lamports,0);
  if(!Number.isSafeInteger(cashbackLamports))throw Error('返现金额超出安全整数范围');
  return {cashbackLamports,cashbackEvidence:evidence};
}
