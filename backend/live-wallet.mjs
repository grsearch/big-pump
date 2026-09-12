import {readFileSync} from 'node:fs';
import {Keypair, PublicKey, VersionedTransaction} from '@solana/web3.js';
import {SOL} from './jupiter.mjs';

const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ASSOCIATED = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
function base58(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt('0x' + Buffer.from(bytes).toString('hex')), result = '';
  while (n) {result = alphabet[Number(n % 58n)] + result; n /= 58n;}
  for (const b of bytes) {if (b !== 0) break; result = '1' + result;}
  return result;
}

// Only constructed after the server owner explicitly enables and configures live trading.
export class LiveWallet {
  constructor(env, rpc, fetcher = fetch) {
    if (env.ENABLE_LIVE_TRADING !== 'true' || !env.LIVE_WALLET_KEYPAIR_FILE) throw Error('实盘未启用或未配置本地密钥文件');
    let bytes;
    try {bytes = JSON.parse(readFileSync(env.LIVE_WALLET_KEYPAIR_FILE, 'utf8'));}
    catch {throw Error('无法读取本地钱包文件');}
    if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some(n => !Number.isInteger(n) || n < 0 || n > 255)) throw Error('钱包文件须为 Solana CLI 的 64 字节数组');
    this.keypair = Keypair.fromSecretKey(Uint8Array.from(bytes));
    this.address = this.keypair.publicKey.toBase58();
    if (this.address !== env.LIVE_WALLET_ADDRESS) throw Error('钱包地址与本地密钥不匹配');
    this.rpc = rpc; this.env = env; this.fetch = fetcher;
  }
  async prepare(q, side, maxFeeLamports) {
    if (Date.now() - q.receivedAt > 10000) throw Error('报价已过期');
    if (q.expireAt && Date.parse(q.expireAt) <= Date.now() + 2000) throw Error('路由即将过期');
    const fees = q.signatureFeeLamports + q.prioritizationFeeLamports + q.rentFeeLamports;
    if (fees > maxFeeLamports) throw Error('网络费用及租金超过上限');
    const tx = VersionedTransaction.deserialize(Buffer.from(q.transaction, 'base64'));
    if (tx.message.staticAccountKeys[0].toBase58() !== this.address || tx.message.header.numRequiredSignatures !== 1) throw Error('首版只支持本钱包单签付款路由');
    const mint = side === 'buy' ? q.outputMint : q.inputMint;
    if ((side === 'buy' ? q.inputMint : q.outputMint) !== SOL) throw Error('交易必须以 SOL 结算');
    const mintInfo = await this.rpc('getAccountInfo', [mint, {encoding:'base64', commitment:'confirmed'}]);
    const program = mintInfo?.value?.owner;
    if (![TOKEN, TOKEN_2022].includes(program)) throw Error('不支持的代币程序');
    const ata = PublicKey.findProgramAddressSync([this.keypair.publicKey.toBuffer(), new PublicKey(program).toBuffer(), new PublicKey(mint).toBuffer()], ASSOCIATED)[0].toBase58();
    const before = await this.rpc('getMultipleAccounts', [[this.address, ata], {encoding:'base64', commitment:'confirmed'}]);
    const balance = before?.value?.[0]?.lamports;
    const tokenAmount = a => a ? Buffer.from(a.data[0], 'base64').readBigUInt64LE(64) : 0n;
    const prior = tokenAmount(before?.value?.[1]);
    if (!Number.isSafeInteger(balance)) throw Error('钱包余额不可用');
    if (side === 'buy' && prior > 0n) throw Error('钱包已持有该币，避免混入历史仓位');
    if (side === 'sell' && prior < BigInt(q.inAmount)) throw Error('链上代币余额不足');
    if (balance < fees + (side === 'buy' ? Number(q.inAmount) + maxFeeLamports : 0) + 1000000) throw Error('SOL 余额不足（保留卖出费用）');
    if (Date.now() - q.receivedAt > 10000) throw Error('核验完成时报价已过期');
    tx.sign([this.keypair]);
    return {signature:base58(tx.signatures[0]), signedTransaction:Buffer.from(tx.serialize()).toString('base64')};
  }
  async execute(order) {
    // A timeout or a Failed response is not proof of non-inclusion; always reconcile the signature.
    try {
      const response = await this.fetch('https://api.jup.ag/swap/v2/execute', {method:'POST', headers:{'content-type':'application/json','x-api-key':this.env.JUPITER_API_KEY},
        body:JSON.stringify({signedTransaction:order.signedTransaction, requestId:order.requestId, ...(order.lastValidBlockHeight ? {lastValidBlockHeight:order.lastValidBlockHeight} : {})}), signal:AbortSignal.timeout(15000)});
      if (!response.ok) return {message:'提交结果不明，等待链上核对'};
      const body = await response.json();
      return {message:body.status === 'Success' ? '已提交，等待链上确认' : '提交未确认，等待链上核对'};
    } catch {return {message:'提交结果不明，等待链上核对'};}
  }
  async receipt(order) {
    const tx = await this.rpc('getTransaction', [order.signature, {encoding:'json', commitment:'finalized', maxSupportedTransactionVersion:0}]);
    if (!tx?.meta) return null;
    if (tx.meta.err) return {failed:true, feeLamports:tx.meta.fee};
    const keys = [...tx.transaction.message.accountKeys.map(k => typeof k === 'string' ? k : k.pubkey),...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];
    const index = keys.indexOf(this.address);
    if (index < 0) throw Error('成交回执不包含交易钱包');
    const total = list => (list ?? []).filter(t => t.owner === this.address && t.mint === order.ca).reduce((sum,t) => sum + BigInt(t.uiTokenAmount.amount), 0n);
    const delta = total(tx.meta.postTokenBalances) - total(tx.meta.preTokenBalances);
    const solDelta = tx.meta.postBalances[index] - tx.meta.preBalances[index];
    if (!Number.isSafeInteger(solDelta) || (order.side === 'buy' ? delta <= 0n || solDelta >= 0 : delta >= 0n)) {
      // Finalized success is different from a pending or failed transaction. Do not
      // replace its cost with the requested input or rebroadcast it after expiry.
      const owned=list=>(list??[]).filter(t=>t.owner===this.address).map(t=>({accountIndex:t.accountIndex,mint:t.mint,amount:t.uiTokenAmount?.amount,decimals:t.uiTokenAmount?.decimals}));
      throw Object.assign(new Error('链上已成功，钱包资产变化无法直接计为交易成本，需要核对资金来源'),{
        code:'RECEIPT_ACCOUNTING_REVIEW',diagnostic:{chainStatus:'finalized',chainSuccess:true,signature:order.signature,
          at:Number.isFinite(tx.blockTime)?tx.blockTime*1000:null,solDelta:Number.isSafeInteger(solDelta)?solDelta:null,
          targetMint:order.ca,targetDelta:delta.toString(),feeLamports:tx.meta.fee,
          preTokenBalances:owned(tx.meta.preTokenBalances),postTokenBalances:owned(tx.meta.postTokenBalances)}});
    }
    return {failed:false, quantity:(delta < 0n ? -delta : delta).toString(), solDelta, at:tx.blockTime * 1000, feeLamports:tx.meta.fee};
  }
}
