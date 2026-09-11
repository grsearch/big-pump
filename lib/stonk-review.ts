// Preserve source timestamps. Review data never feeds the entry/exit decisions.
export function captureStonkReview(p:any,t:any,now:number) {
  if(!p.openedAt||p.review?.finalized)return;
  const end=p.closedAt??now,start=p.evidence?.graduatedAt??p.signalAt;
  const prior=p.review??{version:1,startedAt:now,fdv:[],x:[]};
  const merge=(old:any[],rows:any[])=>[...new Map([...old,...rows].filter(r=>r.at>=start&&r.at<=end).map(r=>[r.at,r])).values()].sort((a,b)=>a.at-b.at);
  const fdv=(t?.history??[]).filter((h:any)=>Number.isFinite(h.fdv)&&h.fdv>0).map((h:any)=>({at:h.at,fdv:h.fdv}));
  if(t?.marketAt<=end&&t.fdv>0&&!t.marketError)fdv.push({at:t.marketAt,fdv:t.fdv});
  const x=(t?.xObservations??[]).map((o:any)=>({at:o.at,authors:o.authors,newAuthors:o.newAuthors,clean:o.clean,complete:o.complete===true}));
  p.review={...prior,graduatedAt:start,through:end,fdv:merge(prior.fdv,fdv),x:merge(prior.x,x),finalized:p.status==='closed'};
}
export function stonkReviewMetrics(p:any) {
  const end=p.closedAt??p.review?.through??p.openedAt;
  const x=(p.review?.x??[]).filter((o:any)=>o.at>=p.openedAt&&o.at<=end&&o.complete);
  const gaps=x.length?[x[0].at-p.openedAt,...x.slice(1).map((o:any,i:number)=>o.at-x[i].at),end-x.at(-1).at]:[Infinity];
  const coverage=x.length>=2&&Math.max(...gaps)<=180000;
  const first=x.find((o:any)=>o.authors>=3&&o.newAuthors>=2);
  const peak=x.length?Math.max(...x.map((o:any)=>o.authors)):null;
  return {coverage,samples:x.length,maxGap:Math.max(...gaps),peakAuthors:peak,
    firstExpansionAt:first?.at??null,classification:first?'observed':coverage?'absent':'unknown',
    roi:p.status==='closed'&&p.cost>0?p.realized/p.cost:null};
}
