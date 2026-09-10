export function expiredObservation(t:any,now:number){return t.hidden===true||(['sleeping','archived'].includes(t.status)&&Number.isFinite(t.graduatedAt)&&now-t.graduatedAt>=86400000);}
export function observationRows(tokens:any[],options:{filter:string;source:string;search:string;sort:string;page:number;pageSize:number},now:number){
 const rank:Record<string,number>={observing:0,priority:1,sleeping:2,archived:3};
 const all=tokens.filter(t=>!expiredObservation(t,now));
 const rows=all.filter(t=>(options.filter==='all'||t.status===options.filter)&&(options.source==='all'||(t.source??'pump')===options.source)&&`${t.name} ${t.symbol} ${t.ca}`.toLowerCase().includes(options.search.toLowerCase())).sort((a,b)=>{
  const group=(rank[a.status]??4)-(rank[b.status]??4);if(group)return group;
  const sub=options.sort==='fdv'?(b.fdv??-1)-(a.fdv??-1):options.sort==='age'?b.graduatedAt-a.graduatedAt:(b.heat?.authors??0)-(a.heat?.authors??0);
  return sub||b.graduatedAt-a.graduatedAt||a.ca.localeCompare(b.ca);
 });
 const pageSize=[10,20,50].includes(options.pageSize)?options.pageSize:20;const pages=Math.max(1,Math.ceil(rows.length/pageSize));const page=Math.max(1,Math.min(pages,Math.floor(options.page)||1));
 return {all,total:rows.length,pages,page,rows:rows.slice((page-1)*pageSize,page*pageSize)};
}
