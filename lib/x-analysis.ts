import {socialWindow} from './social.ts';
// All counts describe collected, filtered posts, never the entire X platform.
export function xAnalysis(t:any,posts:any[],now:number){
 const w=socialWindow(posts,now,5);
 const clean=w.classified.filter(p=>p.association!=='ambiguous'&&p.quality.weight===1);
 const prior=new Set(clean.filter(p=>p.at<=now-300000).map(p=>p.author));
 const previous=new Set(clean.filter(p=>p.at>now-600000&&p.at<=now-300000).map(p=>p.author));
 const authors=new Set(w.eligible.map(p=>p.author));
 const observations=(t.xObservations??[]).filter((o:any)=>Number.isFinite(o.at)&&o.at<=now).sort((a:any,b:any)=>a.at-b.at);
 const from=now-600000,anchor=observations.filter((o:any)=>o.at<=from).at(-1);
 const coveragePoints=[...(anchor?[anchor]:[]),...observations.filter((o:any)=>o.at>from)];
 const last=observations.at(-1);
 const covered=!!anchor&&now-last.at<=180000&&coveragePoints.every((o:any,i:number)=>o.complete===true&&(!i||o.at-coveragePoints[i-1].at<=180000));
 const paused=!!t.xPauseReason||['sleeping','archived'].includes(t.status);
 const comparisonAvailable=covered&&!paused;
 return {at:now,scope:'本系统已采集并过滤的帖子，不是全 X 统计',
 recentPosts:last?w.clean:null,recentAuthors:last?w.authors:null,
 newAuthors:last?[...authors].filter(a=>!prior.has(a)).length:null,
 totalPosts:clean.length,totalAuthors:new Set(clean.map(p=>p.author)).size,
 previousAuthors:comparisonAvailable?previous.size:null,authorDelta:comparisonAvailable?authors.size-previous.size:null,
 comparisonAvailable,coverage:paused?'采集暂停或休眠':!last?'尚未采集':covered?'近 10 分钟采集间隔与分页检查通过':'采集窗口不足、分页未完成或存在缺口',
 pauseReason:t.xPauseReason??null,lastCollectedAt:last?.at??null,
 filtered:w.filtered,raw:w.raw,
 observations:observations.filter((o:any)=>o.at>from).slice(-40).map((o:any)=>({at:o.at,authors:o.authors,newAuthors:o.newAuthors,complete:o.complete===true})),
 fdvHistory:(t.history??[]).filter((p:any)=>p.at>from&&p.at<=now&&Number.isFinite(p.fdv)).slice(-40).map((p:any)=>({at:p.at,fdv:p.fdv})),
 };
}
