import {buyFill,sellFill} from './shadow.ts';
import {executionReady} from './execution.ts';

export const DIFFUSION_VERSION='shadow-diffusion-v1';
export const diffusionDefaults={positionUsd:50,initialCash:1000,minFdv:20000,maxFdv:500000,minLp:15000,maxAgeHours:3,
  minNewAuthors:2,minAuthors:8,minPosts:10,minPriorAuthors:3,authorGrowth:1.8,minNewcomers:4,
  maxPreRise:.15,breakoutOvershoot:.03,authorRetention:.8,stopLoss:.15,trailingActivation:.2,trailingDrop:.05,
  takeProfit:.5,maxHoldHours:.5,latencyMs:15000,slippage:.01,fee:.0125,fixedCostUsd:.05};
export function validateDiffusionRules(v:any) {
  for(const k of Object.keys(diffusionDefaults))if(!Number.isFinite(v?.[k])||v[k]<0)throw Error('Shadow 参数无效：'+k);
  if(v.positionUsd<=0||v.initialCash<v.positionUsd||v.minFdv>=v.maxFdv||v.minLp<=0||v.maxAgeHours<=0||v.maxAgeHours>24||v.stopLoss<=0||v.stopLoss>=1||v.trailingDrop<=0||v.trailingDrop>=1||v.trailingActivation<=0||v.takeProfit<=v.trailingActivation||v.maxHoldHours<=0||v.maxHoldHours>24||v.slippage>=.5||v.fee>=.2||v.latencyMs<1000||v.minNewAuthors<1||v.authorGrowth<=1||v.authorRetention<=0||v.authorRetention>1)throw Error('Shadow 参数范围无效');
  return Object.fromEntries(Object.keys(diffusionDefaults).map(k=>[k,v[k]])) as typeof diffusionDefaults;
}
export function newDiffusionRun(now:number,r=diffusionDefaults) {
  return {id:String(now),version:DIFFUSION_VERSION,startedAt:now,status:'running',acceptEntries:true,rules:{...r},
    arms:['early','breakout'].map(id=>({id,cash:r.initialCash,equity:r.initialCash,peak:r.initialCash,maxDrawdown:0,positions:[],candidates:{},seen:{}}))};
}
const fresh=(t:any,now:number)=>executionReady(t,now)&&!t.shadowBlocked&&!t.marketError&&t.priceUsd>0&&t.lp>0&&t.marketAt<=now&&now-t.marketAt<=60000;
export function diffusionBase(t:any,r:any,now:number) {
  return fresh(t,now)&&['observing','priority'].includes(t.status)&&t.lp>=r.minLp&&t.fdv>=r.minFdv&&t.fdv<=r.maxFdv&&t.graduatedAt<=now&&now-t.graduatedAt<=r.maxAgeHours*3600000;
}
export function historyBefore(t:any,at:number) {
  const rows=(t.history??[]).filter((p:any)=>p.at<at&&p.at>=at-360000&&p.fdv>0).sort((a:any,b:any)=>a.at-b.at);
  const start=rows.filter((p:any)=>p.at<=at-300000).at(-1);
  if(!start)return null;
  const span=rows.filter((p:any)=>p.at>=start.at);
  if(at-span.at(-1).at>90000||span.some((p:any,i:number)=>i>0&&p.at-span[i-1].at>90000))return null;
  return {base:start.fdv,high:Math.max(...span.map((p:any)=>p.fdv))};
}
export function expanding(o:any,r:any) {return o?.complete&&o.authors>=r.minAuthors&&o.clean>=r.minPosts&&o.priorAuthors>=r.minPriorAuthors&&o.authors>=o.priorAuthors*r.authorGrowth&&o.newcomers>=r.minNewcomers;}
export function diffusionExit(p:any,t:any,r:any,now:number) {
  if(now-p.openedAt>=r.maxHoldHours*3600000)return {fraction:1,reason:'最大持仓时间'};
  if(now>=t.graduatedAt+86400000||['sleeping','archived'].includes(t.status))return {fraction:1,reason:'监控退出'};
  if(!fresh(t,now))return null;
  const value=sellFill(t.priceUsd,t.lp,p.quantity,r,t).proceeds;
  p.markValue=value;p.highValue=Math.max(p.highValue??0,value);
  if(value>=p.cost*(1+r.trailingActivation))p.trailingActive=true;
  if(value<=p.cost*(1-r.stopLoss))return {fraction:1,reason:'固定止损'};
  if(value>=p.cost*(1+r.takeProfit))return {fraction:1,reason:'固定止盈'};
  if(p.trailingActive&&value<=p.highValue*(1-r.trailingDrop))return {fraction:1,reason:'移动止盈'};
  return null;
}
export function diffusionStep(state:any,tokens:any[],now:number) {
  const n=structuredClone(state),r=n.rules;
  for(const arm of n.arms) {
    arm.candidates??={};arm.seen??={};
    for(const p of arm.positions) {
      if(!['open','pending'].includes(p.status))continue;
      const t=tokens.find(t=>t.ca===p.ca);
      if(!t){if(p.status==='pending'){p.status='cancelled';p.reason='代币不可用';}else p.unpriced=true;continue;}
      if(p.status==='pending') {
        if(n.acceptEntries===false||now-p.signalAt>120000){p.status='cancelled';p.reason='入场暂停或超时';continue;}
        if(!fresh(t,now)||t.marketAt<p.signalAt+r.latencyMs)continue;
        const o=t.xObservations?.at(-1),stillValid=arm.id==='early'?now-p.evidence.observation.at<=120000:
          o&&now-o.at<=120000&&o.authors>=Math.max(r.minAuthors,p.evidence.candidate.authors*r.authorRetention)&&t.fdv>p.evidence.breakoutHigh&&t.fdv<=p.evidence.breakoutHigh*(1+r.breakoutOvershoot);
        if(!diffusionBase(t,r,now)||!stillValid){p.status='cancelled';p.reason='成交前条件失效';continue;}
        const fill=buyFill(t.priceUsd,t.lp,r.positionUsd,r,t);
        if(!fill||!Number.isFinite(fill.quantity)||fill.quantity<=0||arm.cash<r.positionUsd){p.status='cancelled';p.reason='资金或成交估算无效';continue;}
        Object.assign(p,{status:'open',quantity:fill.quantity,initialQuantity:fill.quantity,cost:r.positionUsd,openedAt:now,received:0,realized:0,highValue:0,trailingActive:false,
          fills:[{side:'buy',at:now,quoteAt:t.marketAt,signalDelayMs:now-p.signalAt,...fill}]});arm.cash-=r.positionUsd;
      }
      if(p.status!=='open')continue;
      if(p.pendingExit&&fresh(t,now)&&t.marketAt>=p.pendingExit.at+r.latencyMs) {
        const fill=sellFill(t.priceUsd,t.lp,p.quantity,r,t);
        if(Number.isFinite(fill.proceeds)){p.received=fill.proceeds;p.realized=fill.proceeds-p.cost;arm.cash+=fill.proceeds;
          p.fills.push({side:'sell',at:now,quoteAt:t.marketAt,quantity:p.quantity,reason:p.pendingExit.reason,...fill});
          p.reason=p.pendingExit.reason;p.pendingExit=null;p.quantity=0;p.status='closed';p.closedAt=now;p.unpriced=false;continue;}
      }
      if(!p.pendingExit){const exit=diffusionExit(p,t,r,now);if(exit)p.pendingExit={...exit,at:now};}
      p.unpriced=!fresh(t,now);if(!p.unpriced)p.markValue=sellFill(t.priceUsd,t.lp,p.quantity,r,t).proceeds;
    }
    for(const [ca,c] of Object.entries(arm.candidates) as [string,any][])if(now-c.at>300000)delete arm.candidates[ca];
    let free=arm.cash-arm.positions.filter((p:any)=>p.status==='pending').length*r.positionUsd;
    for(const t of tokens) {
      if(n.acceptEntries===false)break;
      if(arm.positions.some((p:any)=>p.ca===t.ca&&p.status!=='cancelled'))continue;
      const observations=(t.xObservations??[]).filter((o:any)=>o.at>=n.startedAt&&o.at<=now),o=observations.at(-1);
      if(!o||now-o.at>120000||!diffusionBase(t,r,now))continue;
      let evidence:any=null;
      if(arm.id==='early') {
        if(o.at>(arm.seen[t.ca]??0)){arm.seen[t.ca]=o.at;if(o.newAuthors>=r.minNewAuthors)evidence={observation:o,type:o.firstBatch?'首次发现':'后续新增'};}
      } else {
        if(now-t.graduatedAt<600000)continue;
        if(!arm.candidates[t.ca]&&o.at>(arm.seen[t.ca]??0)) {
          arm.seen[t.ca]=o.at;
          const prev=observations.filter((p:any)=>p.at<=o.at-60000&&p.at>=o.at-180000&&expanding(p,r)).at(-1),h=historyBefore(t,o.at);
          if(expanding(o,r)&&prev&&h&&t.fdv>=h.base&&t.fdv<=h.base*(1+r.maxPreRise))arm.candidates[t.ca]={at:now,authors:o.authors,observation:o,previous:prev};
        }
        const c=arm.candidates[t.ca],h=historyBefore(t,t.marketAt);
        if(c&&now>c.at&&h&&o.authors>=Math.max(r.minAuthors,c.authors*r.authorRetention)&&t.fdv>h.high&&t.fdv<=h.high*(1+r.breakoutOvershoot))evidence={observation:o,candidate:c,breakoutHigh:h.high,type:'扩散后突破'};
      }
      if(evidence&&free>=r.positionUsd){arm.positions.push({id:`${arm.id}:${t.ca}:${now}`,ca:t.ca,symbol:t.symbol,status:'pending',signalAt:now,reason:'新增 / 扩散信号，等待延迟行情',evidence:structuredClone({...evidence,fdv:t.fdv,lp:t.lp,marketAt:t.marketAt}),fills:[]});free-=r.positionUsd;delete arm.candidates[t.ca];}
    }
    arm.equity=arm.positions.some((p:any)=>p.status==='open'&&p.unpriced)?null:arm.cash+arm.positions.filter((p:any)=>p.status==='open').reduce((sum:number,p:any)=>sum+(p.markValue??0),0);
    if(arm.equity!==null){arm.peak=Math.max(arm.peak,arm.equity);arm.maxDrawdown=Math.max(arm.maxDrawdown,1-arm.equity/arm.peak);}
    arm.updatedAt=now;
  }
  return n;
}
