// Minimum research window starts at enrollment, including delayed discoveries.
export function inResearchWindow(t:any,now:number){return Number.isFinite(t.enrolledAt)&&now>=t.enrolledAt&&now-t.enrolledAt<1800000;}
