import {attributedOrder,quotedRoute,tradeSymbol} from '../lib/live-records.ts';
import {redact} from './audit.mjs';
import {Jupiter, SOL, BUY_LAMPORTS, netQuoteLamports} from './jupiter.mjs';
import {LiveWallet} from './live-wallet.mjs';
import {fastGraduation} from './stonk.mjs';
import {ENTRY_POLICY} from './live-entry.mjs';
export const LIVE_C='stonk-graduation-c-v1';
export const C_EXIT_POLICY={version:'c-no-stop-trail40-10-time30-v2',stopLossPct:null,trailingActivationPct:40,trailingDrawdownPct:10,maxHoldMinutes:30};
export function liveCEntry(t,state,now){return Number.isFinite(state.startedAt)&&t?.source==='stonk'&&t.migrationVerified===true&&t.creationVerified===true&&fastGraduation(t.createdAt,t.graduatedAt)&&t.graduatedAt>=state.startedAt&&t.graduatedAt<=now&&now-t.graduatedAt<=ENTRY_POLICY.windowMs;}

export function migrateLiveExit(position) {
  if(position.strategy===LIVE_C){
    if(position.status==='closed')return;
    // Already broadcast exits are reconciled before this path, never cancelled.
    if(position.exitReason==='固定止损 -30%'){
      position.supersededExit={reason:position.exitReason,at:position.exitTriggeredAt,evidence:position.exitTriggerEvidence,policy:position.exitPolicy};
      position.exitReason=null;position.exitTriggeredAt=null;position.exitTriggerEvidence=null;
    }
    position.exitPolicy={...C_EXIT_POLICY};return;
  }
  if(position.exitVersion==='trailing-100-20-v1'||position.status==='closed')return;
  position.trailingActive=(position.highLamports??0)>=position.costLamports*2;
  if(['固定止损 -15%','固定止盈 +50%','移动止盈（高点回撤 5%）'].includes(position.exitReason))position.exitReason=null;
  position.exitVersion='trailing-100-20-v1';
}
export function exitReason(position, value, now) {
  migrateLiveExit(position);
  position.highLamports = Math.max(position.highLamports ?? 0, value);
  if (value >= position.costLamports * (position.strategy===LIVE_C?1.4:2)) position.trailingActive = true;
  if (now - position.openedAt >= 1800000) return '最大持仓时间 30 分钟';
  if (position.trailingActive && value <= position.highLamports * (position.strategy===LIVE_C ? .9 : .8)) return position.strategy===LIVE_C?'移动止盈（高点回撤 10%）':'移动止盈（高点回撤 20%）';
  return null;
}

export class LiveTrading {
  constructor(store, env, rpc, dependencies = {}) {
    this.s = store; this.env = env; this.clock = dependencies.clock ?? Date.now;
    const previous=store.get('config','live-trading');
    if(previous?.strategy!==LIVE_C)store.put('config','live-trading',{...previous,strategy:LIVE_C,acceptEntries:false,startedAt:null,seen:{},lastError:null});
    this.jup = dependencies.jupiter ?? new Jupiter(store, env);
    this.wallet = dependencies.wallet ?? null; this.error = ''; this.busy = false;
    this.slippageBps = Number(env.LIVE_SLIPPAGE_BPS ?? 1500);
    this.maxFeeLamports = Number(env.LIVE_MAX_FEE_LAMPORTS ?? 5000000);
    if (!Number.isInteger(this.slippageBps) || this.slippageBps < 1 || this.slippageBps > 1500 || !Number.isSafeInteger(this.maxFeeLamports) || this.maxFeeLamports <= 0) this.error = '实盘滑点或费用配置无效';
    if (!this.error && env.ENABLE_LIVE_TRADING === 'true' && !this.wallet) {
      try {if (!rpc || !env.JUPITER_API_KEY) throw Error('请配置 Helius 和 Jupiter'); this.wallet = new LiveWallet(env, rpc);}
      catch (e) {this.error = e.message;}
    }
    const positions=store.all('live-position');
    for(const order of store.all('live-order')){const enriched=attributedOrder(order,positions);if(enriched!==order)store.put('live-order',order.id,enriched);}
    const boundWallet = this.state().wallet;
    if (this.wallet && boundWallet && boundWallet !== this.wallet.address) this.error = '钱包与持久化实盘账本不一致，不能接管原钱包持仓';
  }
  state() {return this.s.get('config', 'live-trading') ?? {acceptEntries:false, startedAt:null, seen:{}};}
  scheduleRetry(at){
    if(this.disposed||(Number.isFinite(this.retryWakeAt)&&this.retryWakeAt<=at))return;
    clearTimeout(this.retryTimer);this.retryWakeAt=at;
    this.retryTimer=setTimeout(()=>{this.retryWakeAt=null;this.retryTimer=null;if(this.disposed)return;
      if(this.busy){this.wakePending=this.collectorRunning;return;}
      void this.tick(this.collectorRunning).catch(()=>{});
    },Math.max(0,at-this.clock()));this.retryTimer.unref?.();
  }
  dispose(){this.disposed=true;clearTimeout(this.retryTimer);}
  onGraduation(collectorRunning){this.wakePending=collectorRunning;return this.tick(collectorRunning);}
  snapshot() {
    const state = this.state();
    const identities=['token','stonk-candidate','token-reference','history-reference'].flatMap(kind=>this.s.identities(kind));
    const metadata=new Map();for(const t of identities)if(!metadata.has(t.ca)&&tradeSymbol(t))metadata.set(t.ca,t);
    const display=r=>({...r,displaySymbol:tradeSymbol(r,metadata.has(r.ca)?[metadata.get(r.ca)]:[])});
    return {...state, acceptEntries:state.acceptEntries && this.env.ENABLE_LIVE_TRADING === 'true' && !!this.wallet && !this.error,
      enabled:this.env.ENABLE_LIVE_TRADING === 'true', configured:!!this.wallet && !this.error,
      wallet:this.wallet?.address ?? this.env.LIVE_WALLET_ADDRESS ?? null, error:this.error, jupiter:this.jup.status(),
      buySol:.1, slippageBps:this.slippageBps, maxFeeLamports:this.maxFeeLamports,exitPolicy:C_EXIT_POLICY,entryPolicy:ENTRY_POLICY,
      positions:this.s.all('live-position').map(display), orders:this.s.all('live-order').map(({signedTransaction, ...publicOrder}) => display(publicOrder))};
  }
  control(action) {
    const state = this.state();
    if (action === 'pause') state.acceptEntries = false;
    else if (action === 'start') {
      if (this.env.ENABLE_LIVE_TRADING !== 'true' || !this.wallet || this.error) throw Error(this.error || '需由服务器所有者配置并启用实盘');
      if (this.s.all('live-order').some(o => o.status === 'confirming')) throw Error('仍有订单等待链上确认');
      state.acceptEntries = true; state.startedAt = this.clock(); state.seen = {}; state.wallet = this.wallet.address;
    } else throw Error('操作无效');
    this.s.put('config', 'live-trading', state);
    this.s.event('live', action === 'pause' ? '实盘暂停开仓，继续管理持仓' : '实盘 C 已由操作人启用，每笔 0.1 SOL');
    return {ok:true};
  }
  async tick(collectorRunning) {
    this.collectorRunning=collectorRunning;
    if (this.busy || !this.wallet || this.error || this.env.ENABLE_LIVE_TRADING !== 'true') return;
    this.busy = true;
    this.wakePending=false;
    try {
      await this.reconcile();
      const now = this.clock();
      const positions = this.s.statusRows('live-position','open');
      const pending = this.s.statusRows('live-order','confirming');
      const due = positions.filter(p => !pending.some(o => o.ca === p.ca) && now - (p.checkedAt ?? 0) >= 5000).sort((a,b) => (a.checkedAt ?? 0) - (b.checkedAt ?? 0));
      const state = this.state();
      for(const o of this.s.statusRows('live-order','retrying'))if(!collectorRunning||!state.acceptEntries||!liveCEntry(this.s.get('live-signal',o.ca),state,now))this.s.put('live-order',o.id,{...o,status:'skipped',reason:'已暂停或毕业买入窗口超过 20 秒'});
      const candidates=collectorRunning&&state.acceptEntries&&!pending.length?this.s.entrySignals(now-ENTRY_POLICY.windowMs,now).filter(t=>{
        if (this.s.get('live-position', t.ca)) return false;
        if(!liveCEntry(t,state,now))return false;
        const order=this.s.get('live-order','buy:'+t.ca+':'+t.graduatedAt);
        return !order||(['retrying','preparing'].includes(order.status)&&now>=(order.nextAttemptAt??0));
      }).sort((a,b)=>b.graduatedAt-a.graduatedAt):[];
      const urgent=due.find(p=>p.exitReason||!p.quoteAt||now-p.openedAt>=1800000);
      if(urgent||due.length&&(!candidates.length||this.lastAction==='buy')){await this.checkExit(urgent??due[0]);this.lastAction='sell';return;}
      for (const t of candidates) {
        const o = {at:t.graduatedAt};
        state.seen[t.ca] = o.at; this.s.put('config', 'live-trading', state);
        await this.buy(t, o);this.lastAction='buy';break;
      }
    } catch (e) {this.s.put('config', 'live-trading', {...this.state(), lastError:e.message, checkedAt:this.clock()});}
    finally {this.busy = false;if(this.wakePending){this.wakePending=false;queueMicrotask(()=>{void this.tick(this.collectorRunning);});}}
  }
  async buy(t, observation) {
    const id = 'buy:' + t.ca + ':' + observation.at;
    const previous=this.s.get('live-order',id),attempts=(previous?.attempts??0)+1;
    const intent = {id, ca:t.ca, symbol:t.symbol, source:t.source, strategy:LIVE_C, exitPolicy:{...C_EXIT_POLICY}, quoteMint:t.quoteMint??null, quoteSymbol:t.quoteSymbol??null, side:'buy', at:this.clock(), signalAt:observation.at,
      detectedAt:t.verifiedAt,verifiedAt:t.verifiedAt,signalReceivedAt:this.clock(),entryPolicy:ENTRY_POLICY,entryTiming:{discoveryDelayMs:t.verifiedAt-t.graduatedAt,remainingMs:Math.max(0,t.graduatedAt+ENTRY_POLICY.windowMs-this.clock())},attempts,firstAttemptAt:previous?.firstAttemptAt??this.clock(),status:'preparing', inputAmount:BUY_LAMPORTS, evidence:{type:'Stonk 毕业',graduatedAt:t.graduatedAt,fdv:t.fdv,lp:t.lp}};
    this.s.put('live-order', id, intent);
    try {
      const q = await this.jup.order(SOL, t.ca, BUY_LAMPORTS, 'buy', this.wallet.address, this.slippageBps);
      intent.buyQuoteAt=this.clock();intent.buyQuoteTiming=q.timing;
      // Probe the reverse route before signing, not a guarantee of future liquidity.
      const reverse=await this.jup.order(t.ca, SOL, q.otherAmountThreshold, 'buy', undefined, this.slippageBps);
      intent.reverseQuoteAt=this.clock();intent.reverseQuoteTiming=reverse.timing;
      const current = this.s.get('live-signal', t.ca);
      if (this.collectorRunning===false || !this.state().acceptEntries || !liveCEntry(current,this.state(),this.clock())) throw Error('签名前入场条件失效');
      await this.submit(intent, q);
    } catch (e) {if (!['confirming','confirmed','failed'].includes(this.s.get('live-order', id)?.status)){
      const nextAttemptAt=Math.max(this.clock()+[300,600,1000][Math.min(2,attempts-1)],e.retryAt??0);
      const retry=(e.retryable===true||[5,6].includes(e.errcode))&&attempts<ENTRY_POLICY.maxAttempts&&this.collectorRunning!==false&&this.state().acceptEntries&&nextAttemptAt<=observation.at+ENTRY_POLICY.windowMs;
      this.s.put('live-order', id, {...intent,status:retry?'retrying':'skipped',nextAttemptAt:retry?nextAttemptAt:null,reason:e.message,diagnostic:e.diagnostic??null});
      if(retry)this.scheduleRetry(nextAttemptAt);
    }}
  }
  async exitTick(){
    if(this.exitLaneBusy||!this.wallet||this.error||this.env.ENABLE_LIVE_TRADING!=='true')return;
    this.exitLaneBusy=true;try{const pending=this.s.statusRows('live-order','confirming');const now=this.clock();const due=this.s.statusRows('live-position','open').filter(p=>!pending.some(o=>o.ca===p.ca)&&now-(p.checkedAt??0)>=5000).sort((a,b)=>Number(!!b.exitReason)-Number(!!a.exitReason)||(a.checkedAt??0)-(b.checkedAt??0));if(due[0])await this.checkExit(due[0]);}finally{this.exitLaneBusy=false;}
  }
  // Independent of the entry/execute request: its HTTP response may arrive
  // after the chain receipt. Never resend a transaction from this lane.
  async settlementTick(){
    if(this.disposed||this.settlementBusy||!this.wallet||this.error||this.env.ENABLE_LIVE_TRADING!=='true')return;
    this.settlementBusy=true;
    try{await this.reconcile();await this.exitTick();}finally{this.settlementBusy=false;}
  }
  async checkExit(position) {
    this.exitLocks??=new Set();if(this.exitLocks.has(position.ca))return;
    if(this.s.statusRows('live-order','confirming').some(o=>o.ca===position.ca))return;
    const fresh=this.s.get('live-position',position.ca);if(fresh&&fresh.status!=='open')return;
    this.exitLocks.add(position.ca);try{return await this.checkExitInner(fresh??position);}finally{this.exitLocks.delete(position.ca);}
  }
  async checkExitInner(position) {
    if(position.strategy===LIVE_C&&position.exitReason==='固定止损 -30%'){
      for(const order of this.s.statusRows('live-order','preparing'))if(order.ca===position.ca&&order.side==='sell'&&order.reason==='固定止损 -30%')this.s.put('live-order',order.id,{...order,status:'cancelled',reason:'策略更新：取消尚未发送的固定止损卖单'});
    }
    migrateLiveExit(position);
    if (this.clock() - position.openedAt >= 1800000) position.exitReason ??= '最大持仓时间 30 分钟';
    position.checkedAt = this.clock(); position.firstQuoteRequestedAt??=position.checkedAt; this.s.put('live-position', position.ca, position);
    try {
      const q = await this.jup.order(position.ca, SOL, position.quantity, 'sell', this.wallet.address, this.slippageBps);
      const value = Number(netQuoteLamports(q));
      if (!Number.isSafeInteger(value)) throw Error('卖出报价金额超出范围');
      const reason = position.exitReason ?? exitReason(position, value, this.clock());
      if(reason&&!position.exitTriggeredAt){position.exitTriggeredAt=this.clock();position.exitTriggerEvidence={netLamports:value,costLamports:position.costLamports,highLamports:position.highLamports,quoteAt:q.receivedAt??this.clock(),reason,policy:position.exitPolicy??null};}
      Object.assign(position, {markLamports:value, quoteAt:this.clock(), firstValidQuoteAt:position.firstValidQuoteAt??this.clock(), quoteError:null, exitReason:reason});
      this.s.put('live-position', position.ca, position);
      if (!reason) return;
      const intent = {id:'sell:' + position.ca + ':' + this.clock(), ca:position.ca, symbol:position.symbol, strategy:position.strategy??null, exitPolicy:position.exitPolicy??null, exitTriggerEvidence:position.exitTriggerEvidence??null, source:position.source, quoteMint:position.quoteMint??null, quoteSymbol:position.quoteSymbol??null, side:'sell', at:this.clock(), status:'preparing', inputAmount:position.quantity, reason};
      this.s.put('live-order', intent.id, intent);
      try {await this.submit(intent, q);}
      catch (e) {if (!['confirming','confirmed','failed'].includes(this.s.get('live-order', intent.id)?.status)) this.s.put('live-order', intent.id, {...intent, status:'skipped', reason:e.message,diagnostic:e.diagnostic??null}); throw e;}
    } catch (e) {const current=this.s.get('live-position',position.ca);if(current?.status==='open')this.s.put('live-position', position.ca, {...current, quoteError:e.message});}
  }
  async submit(intent, quote) {
    intent.route=quotedRoute(quote);
    intent.prepareStartedAt=this.clock();
    const signed = await this.wallet.prepare(quote, intent.side, this.maxFeeLamports);
    if (intent.side === 'buy' && (this.collectorRunning===false || !this.state().acceptEntries || !liveCEntry(this.s.get('live-signal',intent.ca),this.state(),this.clock()))) throw Error('签名后入场已暂停或过期');
    const order = {...intent, exitReason:intent.exitReason??intent.reason, preparedAt:this.clock(), ...signed, requestId:quote.requestId, lastValidBlockHeight:quote.lastValidBlockHeight, status:'confirming', quoteAt:quote.receivedAt, quotedOut:quote.outAmount, minimumOut:quote.otherAmountThreshold};
    // Persist before any broadcast. A crash from here never causes automatic resubmission.
    this.s.put('live-order', order.id, order);
    order.broadcastAt=this.clock();this.s.put('live-order',order.id,order);
    const result = await this.wallet.execute(order);
    const latest=this.s.get('live-order',order.id)??order;
    this.s.put('live-order', order.id, {...latest,executeReturnedAt:this.clock(),...(latest.status==='confirming'?{reason:result.message,exitReason:intent.reason}:{})});
  }
  async reconcile() {
    if(this.reconcileBusy||this.disposed)return;
    this.reconcileBusy=true;
    try{
    for (const order of this.s.statusRows('live-order','confirming')) {
      const interval=this.clock()-(order.broadcastAt??order.at??0)<30000?1000:5000;
      if (order.reconciledAt!=null&&this.clock() - order.reconciledAt < interval) continue;
      order.reconciledAt = this.clock(); this.s.put('live-order', order.id, order);
      let receipt;
      try {receipt = await this.wallet.receipt(order);} catch(e) {this.reconcileError(order,e);continue;}
      if (!receipt) continue;
      // execute() may have completed while receipt RPC was in flight.
      const latest=this.s.get('live-order',order.id);
      if(latest?.status!=='confirming')continue;
      const {signedTransaction, ...publicOrder} = latest;
      this.s.db.exec('BEGIN');
      try {
        this.s.put('live-order', order.id, {...publicOrder, status:receipt.failed ? 'failed' : 'confirmed', reconcileError:null,reconcileRequired:false,...(publicOrder.reconcileRequired?{reason:receipt.failed?'链上交易失败':'链上与账务核对完成'}:{}), receipt, confirmedAt:this.clock()});
        if (!receipt.failed) {
          if (order.side === 'buy') this.s.put('live-position', order.ca, {ca:order.ca, symbol:order.symbol, source:order.source, strategy:order.strategy??null, exitPolicy:order.exitPolicy??null, quoteMint:order.quoteMint??null, quoteSymbol:order.quoteSymbol??null, buyRoute:order.route??null, status:'open', quantity:receipt.quantity,
            costLamports:-receipt.solDelta, buyCashbackLamports:receipt.cashbackLamports??0, openedAt:receipt.at, managementStartedAt:this.clock(),receiptCommitment:receipt.commitment??null, buySignature:order.signature, highLamports:0, trailingActive:false});
          else {
            const p = this.s.get('live-position', order.ca);
            if (!p || receipt.quantity !== p.quantity) throw Error('卖出回执数量不一致');
            this.s.put('live-position', order.ca, {...p, status:'closed', closedAt:receipt.at, proceedsLamports:receipt.solDelta,
              realizedLamports:receipt.solDelta-p.costLamports, sellCashbackLamports:receipt.cashbackLamports??0, sellSignature:order.signature, sellRoute:order.route??null, exitReason:order.exitReason});
          }
        } else if (order.side === 'sell') {
          const p = this.s.get('live-position', order.ca);
          if (p) this.s.put('live-position', order.ca, {...p, costLamports:p.costLamports + receipt.feeLamports});
        }
        this.s.db.exec('COMMIT');
      } catch (e) {this.s.db.exec('ROLLBACK');this.reconcileError(order,e);}
    }
    }finally{this.reconcileBusy=false;}
  }
  reconcileError(order,error){
    const current=this.s.get('live-order',order.id)??order;
    if(current.status!=='confirming')return;
    const message=String(redact(error?.message??'对账失败')).slice(0,500);
    const evidence=error?.code==='RECEIPT_ACCOUNTING_REVIEW'?redact(error.diagnostic):current.reconciliationEvidence??null;
    this.s.put('live-order',order.id,{...current,reconcileError:message,reconcileRequired:true,
      reconcileErrorAt:this.clock(),reconcileFailures:(current.reconcileFailures??0)+1,
      reconciliationEvidence:evidence,reason:evidence?.chainSuccess?'链上已成功，账务待核对':'对账异常，等待重试'});
    if(current.reconcileError!==message)this.s.event('live','实盘对账异常：'+message,order.ca);
  }
}
