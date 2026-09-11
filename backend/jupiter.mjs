export const SOL = 'So11111111111111111111111111111111111111112';
export const BUY_LAMPORTS = '100000000';
const integer = value => typeof value === 'string' && /^[0-9]+$/.test(value);
const retryError=(message,retryAt=0)=>Object.assign(new Error(message),{retryable:true,retryAt});

// Persist reservations before dispatch: a timeout still consumed an API request.
export class Jupiter {
  constructor(store, env = process.env, fetcher = fetch, clock = Date.now) {
    this.s = store; this.env = env; this.fetch = fetcher; this.clock = clock;
    this.limit = Number(env.JUPITER_REQUESTS_PER_MINUTE ?? 60);
    this.priorityFeeLamports = Number(env.LIVE_PRIORITY_FEE_LAMPORTS ?? 300000);
    if(!Number.isSafeInteger(this.priorityFeeLamports)||this.priorityFeeLamports<0)throw Error('优先费配置无效');
    if (!Number.isInteger(this.limit) || this.limit < 12 || this.limit > 9000) throw Error('Jupiter 请求额度无效');
  }
  status() {
    const now = this.clock(), saved = this.s.get('config', 'jupiter-rate') ?? {};
    return {configured: !!this.env.JUPITER_API_KEY, limit: this.limit, priorityFeeLamports:this.priorityFeeLamports,
      used: (saved.calls ?? []).filter(at => now - at < 60000).length,
      blockedUntil: saved.blockedUntil ?? 0};
  }
  reserve(side) {
    const now = this.clock(), saved = this.s.get('config', 'jupiter-rate') ?? {};
    const calls = (saved.calls ?? []).filter(at => now - at < 60000);
    if (now < (saved.blockedUntil ?? 0) || calls.length >= this.limit - (side === 'buy' ? 12 : 0)) throw retryError('Jupiter 额度等待：卖出优先',Math.max(saved.blockedUntil??0,(calls[0]??now)+60000));
    this.s.put('config', 'jupiter-rate', {...saved, calls: [...calls, now]});
  }
  async order(inputMint, outputMint, amount, side, taker, slippageBps = 1500) {
    if (!this.env.JUPITER_API_KEY) throw Error('未配置 Jupiter API Key');
    if (!integer(amount) || BigInt(amount) <= 0n) throw Error('报价数量无效');
    this.reserve(side);
    const params = new URLSearchParams({inputMint, outputMint, amount, slippageBps: String(slippageBps), excludeRouters:'jupiterz'});
    params.set('priorityFeeLamports',String(this.priorityFeeLamports));
    params.set('broadcastFeeType','exactFee');
    // Optional tip must be omitted when unused: explicit zero is rejected by Jupiter.
    if (taker) params.set('taker', taker);
    let response;
    try {response = await this.fetch('https://api.jup.ag/swap/v2/order?' + params, {
      headers: {'x-api-key': this.env.JUPITER_API_KEY}, signal: AbortSignal.timeout(10000)});
    } catch {throw retryError('Jupiter 报价网络失败');}
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after'));
      const wait = Number.isFinite(seconds) && seconds > 0 ? Math.max(60, seconds) : 60;
      this.s.put('config', 'jupiter-rate', {...this.s.get('config', 'jupiter-rate'), blockedUntil: this.clock() + wait * 1000});
    }
    if (!response.ok) {if(response.status===429||response.status>=500)throw retryError('Jupiter 报价 HTTP '+response.status,this.status().blockedUntil);throw Error('Jupiter 报价 HTTP ' + response.status);}
    const q = await response.json();
    if(q?.error||q?.errorCode||q?.outAmount==='0')throw retryError('Jupiter 暂未返回可用路由');
    validateOrder(q, {inputMint, outputMint, amount, taker, slippageBps});
    return {...q, receivedAt: this.clock()};
  }
}

export function validateOrder(q, expected) {
  if (!q || q.error || q.errorCode || q.inputMint !== expected.inputMint || q.outputMint !== expected.outputMint ||
      q.inAmount !== expected.amount || !integer(q.outAmount) || BigInt(q.outAmount) <= 0n ||
      !integer(q.otherAmountThreshold) || BigInt(q.otherAmountThreshold) <= 0n ||
      BigInt(q.otherAmountThreshold) > BigInt(q.outAmount) || q.swapMode !== 'ExactIn') throw Error('Jupiter 报价无效或无路由');
  if (!Number.isInteger(q.slippageBps) || q.slippageBps < 0 || q.slippageBps > expected.slippageBps ||
      BigInt(q.otherAmountThreshold) < BigInt(q.outAmount) * BigInt(10000 - expected.slippageBps) / 10000n) throw Error('报价滑点超过限制');
  if (expected.taker && (q.taker !== expected.taker || !q.transaction || !q.requestId)) throw Error('Jupiter 未构建可签名交易');
  for (const key of ['signatureFeeLamports', 'prioritizationFeeLamports', 'rentFeeLamports']) {
    if (!Number.isSafeInteger(q[key]) || q[key] < 0) throw Error('报价费用缺失');
  }
  return q;
}

export function netQuoteLamports(q) {
  return BigInt(q.outAmount) - BigInt(q.signatureFeeLamports + q.prioritizationFeeLamports + q.rentFeeLamports);
}
