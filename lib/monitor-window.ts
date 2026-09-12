// Minimum research window starts at enrollment, including delayed discoveries.
export const RESEARCH_WINDOW_MS=60*60000;
export function inResearchWindow(t:any,now:number){return Number.isFinite(t.enrolledAt)&&now>=t.enrolledAt&&now-t.enrolledAt<RESEARCH_WINDOW_MS;}
