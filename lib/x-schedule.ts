import {inResearchWindow} from './monitor-window.ts';
import {socialWindow} from './social.ts';
import {executionReady} from './execution.ts';

export function xObservation(before:any[], posts:any[], at:number, complete:boolean, firstBatch:boolean) {
  const seen=new Set(before.map(p=>p.author));
  const recent=socialWindow(posts,at,5), prior=socialWindow(posts.filter(p=>p.at<=at-300000),at-300000,5);
  const earlier=new Set(posts.filter(p=>p.at>at-900000&&p.at<=at-300000).map(p=>p.author));
  const added=recent.eligible.filter(p=>!seen.has(p.author)&&p.receivedAt===at&&at-p.at<=120000);
  return {at,complete,firstBatch,authors:recent.authors,clean:recent.clean,priorAuthors:prior.authors,
    newcomers:new Set(recent.eligible.filter(p=>!earlier.has(p.author)).map(p=>p.author)).size,
    newAuthors:new Set(added.map(p=>p.author)).size,postIds:added.map(p=>p.id),postTimes:added.map(p=>p.at)};
}

export function xSchedule(tokens:any[],now:number,lowFdv:number) {
  const eligible=tokens.filter(t=>inResearchWindow(t,now)||(['observing','priority'].includes(t.status)&&!t.marketError&&t.fdv>=lowFdv&&t.marketAt<=now&&now-t.marketAt<120000));
  const tradable=(t:any)=>t.fdv>=20000&&t.fdv<=500000&&t.lp>=15000&&now-t.graduatedAt<=10800000&&executionReady(t,now);
  const accelerated=new Set(eligible.filter(t=>tradable(t)&&t.xBoostUntil>now).sort((a,b)=>(b.xNewAuthorAt??0)-(a.xNewAuthorAt??0)||a.ca.localeCompare(b.ca)).slice(0,5).map(t=>t.ca));
  return eligible.map(t=>{
    const latest=t.xObservations?.at(-1);
    const interval=accelerated.has(t.ca)?15000:tradable(t)&&now-t.enrolledAt<300000?30000:latest?.authors>0&&now-latest.at<300000?60000:120000;
    return {token:t,interval,due:(t.xLastPoll??0)+interval,tier:interval===15000?'加速':interval===30000?'新币':interval===60000?'有讨论':'低频'};
  }).sort((a,b)=>a.due-b.due||a.token.ca.localeCompare(b.token.ca));
}
