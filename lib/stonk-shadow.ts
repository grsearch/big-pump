import {buyFill,sellFill} from './shadow.ts';
import {executionReady} from './execution.ts';
import {captureStonkReview} from './stonk-review.ts';

export const newStonkArm=(now:number,cash:number)=>({id:'graduation',startedAt:now,cash,equity:cash,peak:cash,maxDrawdown:0,positions:[],seen:{},candidates:{}});
const ready=(t:any,now:number)=>t&&executionReady(t,now)&&!t.marketError&&!t.shadowBlocked&&t.priceUsd>0&&t.lp>0&&t.marketAt<=now&&now-t.marketAt<=60000;
export function stonkWaitReason(t:any,now:number) {
  if(!t)return '代币记录不可用';
  if(t.shadowBlocked)return '执行模型未通过：'+t.shadowBlocked;
  if(!executionReady(t,now))return '税费模型或计价资产汇率缺失/过期';
  if(t.marketError)return '行情异常：'+t.marketError;
  if(!ready(t,now))return '价格、流动性缺失或行情过期';
  return '等待毕业信号时或之后的首个有效行情';
}
export function stonkExit(p:any,t:any,r:any,now:number) {
  if(now-p.openedAt>=900000)return '持仓满 15 分钟';
  if(!ready(t,now))return null;
  const value=sellFill(t.priceUsd,t.lp,p.quantity,r,t).proceeds;
  p.highValue=Math.max(p.highValue??0,value);
  if(value>=p.cost*1.4)p.trailingActive=true;
  if(p.trailingActive&&value<=p.highValue*.9)return '移动止盈（高点回撤 10%）';
  return null;
}
export function stonkStep(arm:any,tokens:any[],run:any,now:number) {
  const r=run.rules;
  let free=arm.cash-arm.positions.filter((p:any)=>p.status==='pending').length*r.positionUsd;
  for(const t of tokens) {
    if(!run.acceptEntries)break;
    if(t.source!=='stonk'||t.graduatedAt<arm.startedAt||t.graduatedAt>now||now-t.graduatedAt>120000||arm.seen[t.ca])continue;
    if(free<r.positionUsd)continue;
    arm.seen[t.ca]=true;
    arm.positions.push({id:`graduation:${t.ca}:${now}`,ca:t.ca,symbol:t.symbol,status:'pending',signalAt:now,reason:'Stonk 毕业，首个有效行情即买',
      evidence:{type:'Stonk 毕业',graduatedAt:t.graduatedAt,fdv:t.fdv,lp:t.lp},fills:[]});free-=r.positionUsd;
  }

  for(const p of arm.positions) {
    const t=tokens.find(t=>t.ca===p.ca);
    captureStonkReview(p,t,now);
    if(p.status==='pending') {
      if(!run.acceptEntries){p.status='cancelled';p.reason='已暂停新开仓';continue;}
      if(now-p.signalAt>120000){p.status='cancelled';p.reason='等待超过 2 分钟：'+stonkWaitReason(t,now);continue;}
      if(!ready(t,now)||t.marketAt<p.signalAt){p.reason=stonkWaitReason(t,now);continue;}
      const fill=buyFill(t.priceUsd,t.lp,r.positionUsd,r,t);
      if(!fill||!Number.isFinite(fill.quantity)||fill.quantity<=0||arm.cash<r.positionUsd)continue;
      Object.assign(p,{status:'open',openedAt:now,quantity:fill.quantity,initialQuantity:fill.quantity,cost:r.positionUsd,highValue:0,trailingActive:false,realized:0});
      p.fills.push({side:'buy',at:now,quoteAt:t.marketAt,signalDelayMs:now-p.signalAt,...fill});arm.cash-=r.positionUsd;
      captureStonkReview(p,t,now);
    }
    if(p.status!=='open')continue;
    // Retire an unfilled exit queued by the old C rule; completed trades stay unchanged.
    if(p.pendingExit?.reason==='FDV 跌破 $10,000')p.pendingExit=null;
    if(p.pendingExit&&ready(t,now)&&t.marketAt>=p.pendingExit.at+r.latencyMs) {
      const fill=sellFill(t.priceUsd,t.lp,p.quantity,r,t);
      if(Number.isFinite(fill.proceeds)){
        Object.assign(p,{status:'closed',closedAt:now,received:fill.proceeds,realized:fill.proceeds-p.cost,reason:p.pendingExit.reason,quantity:0,unpriced:false});
        p.fills.push({side:'sell',at:now,quoteAt:t.marketAt,reason:p.reason,...fill});p.pendingExit=null;arm.cash+=fill.proceeds;captureStonkReview(p,t,now);continue;
      }
    }
    if(!p.pendingExit){const reason=stonkExit(p,t,r,now);if(reason)p.pendingExit={at:now,reason};}
    p.unpriced=!ready(t,now);if(!p.unpriced)p.markValue=sellFill(t.priceUsd,t.lp,p.quantity,r,t).proceeds;
  }
  arm.equity=arm.positions.some((p:any)=>p.status==='open'&&p.unpriced)?null:arm.cash+arm.positions.filter((p:any)=>p.status==='open').reduce((sum:number,p:any)=>sum+p.markValue,0);
  if(arm.equity!==null){arm.peak=Math.max(arm.peak,arm.equity);arm.maxDrawdown=Math.max(arm.maxDrawdown,1-arm.equity/arm.peak);}
  arm.updatedAt=now;
}
