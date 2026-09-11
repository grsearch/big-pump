import {diffusionBase,historyBefore,expanding} from './diffusion-shadow.ts';
import {executionReady} from './execution.ts';

// Read-only explanation of the current snapshot; never relaxes an entry gate.
export function shadowReason(t:any,arm:any,run:any,now:number):string {
  const r=run.rules,p=arm.positions.find((p:any)=>p.ca===t.ca&&p.status!=='cancelled');
  if(p)return p.status==='pending'?'已发信号，等待成交':p.status==='open'?'已持仓':'已交易，本组不重复买入';
  if(run.status!=='running')return '实验已结束';
  if(run.acceptEntries===false)return '已暂停开仓';
  if(!['observing','priority'].includes(t.status))return '代币已休眠 / 归档';
  if(!(t.graduatedAt<=now&&now-t.graduatedAt<=r.maxAgeHours*3600000))return '毕业 AGE 不在范围内';
  if(t.marketError||!(t.priceUsd>0)||!(t.marketAt<=now&&now-t.marketAt<=60000))return '行情缺失或超过 60 秒';
  if(t.shadowBlocked||!executionReady(t,now))return '税费或执行估值未就绪';
  if(!(t.fdv>=r.minFdv&&t.fdv<=r.maxFdv))return 'FDV 不在入场范围';
  if(!(t.lp>=r.minLp))return 'LP 不足';
  if(!diffusionBase(t,r,now))return '基础行情条件未满足';
  const observations=(t.xObservations??[]).filter((o:any)=>o.at>=run.startedAt&&o.at<=now),o=observations.at(-1);
  if(!o)return '实验启动后尚无 X 采集批次';
  if(now-o.at>120000)return 'X 批次超过 2 分钟';
  const free=arm.cash-arm.positions.filter((p:any)=>p.status==='pending').length*r.positionUsd;
  if(free<r.positionUsd)return '可用模拟资金不足';
  if(arm.id==='early'){
    if(o.newAuthors<r.minNewAuthors)return `本批有效新作者不足 ${r.minNewAuthors} 位`;
    if(o.at<=(arm.seen?.[t.ca]??0))return '本批已检查，等待下一批新作者';
    return '条件已满足，等待策略执行';
  }
  if(now-t.graduatedAt<600000)return 'B 组需毕业满 10 分钟';
  const candidate=arm.candidates?.[t.ca];
  if(candidate&&now-candidate.at<=300000){
    if(o.authors<Math.max(r.minAuthors,candidate.authors*r.authorRetention))return '候选讨论人数已回落';
    const h=historyBefore(t,t.marketAt);
    if(!h)return '5 分钟行情历史不足或有缺口';
    if(t.fdv<=h.high)return '讨论达标，等待 FDV 突破';
    if(t.fdv>h.high*(1+r.breakoutOvershoot))return '突破超过追价上限';
    return now<=candidate.at?'候选刚成立，等待后续突破':'条件已满足，等待策略执行';
  }
  if(!o.complete)return 'X 搜索分页尚未收齐';
  if(o.authors<r.minAuthors||o.clean<r.minPosts)return '有效作者或帖子数不足';
  if(!expanding(o,r))return '作者增长 / 新人比例未达标';
  if(!observations.some((p:any)=>p.at<=o.at-60000&&p.at>=o.at-180000&&expanding(p,r)))return '等待第二次真实 X 扩散确认';
  const h=historyBefore(t,o.at);
  if(!h)return '5 分钟行情历史不足或有缺口';
  if(t.fdv<h.base||t.fdv>h.base*(1+r.maxPreRise))return 'FDV 下跌或涨幅已过热';
  return o.at<=(arm.seen?.[t.ca]??0)?'本批已检查，等待新的扩散确认':'条件已满足，等待策略执行';
}
export function shadowDiagnostics(tokens:any[],arm:any,run:any,now:number) {
  const rows=tokens.filter(t=>!t.hidden).map(t=>({ca:t.ca,symbol:t.symbol,reason:shadowReason(t,arm,run,now),newAuthors:t.xObservations?.at(-1)?.newAuthors??null}));
  const counts:Record<string,number>={};for(const row of rows)counts[row.reason]=(counts[row.reason]??0)+1;
  return {rows,counts:Object.entries(counts).sort((a,b)=>b[1]-a[1])};
}
