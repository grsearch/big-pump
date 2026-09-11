// A failed, stale or disconnected quote must never look like a current zero P&L.
export function livePositionView(p:any, now:number, online:boolean) {
  const cost=Number.isFinite(p.costLamports)?p.costLamports:null;
  const mark=Number.isFinite(p.markLamports)?p.markLamports:null;
  const fresh=online&&!p.quoteError&&Number.isFinite(p.quoteAt)&&p.quoteAt<=now&&now-p.quoteAt<=30000&&mark!==null;
  const pnl=fresh&&cost!==null?mark-cost:null;
  return {cost,mark,fresh,pnl,percent:pnl!==null&&cost!==null&&cost>0?pnl/cost*100:null};
}
export function livePortfolio(positions:any[],now:number,online:boolean){
  const views=positions.filter(p=>p.status==='open').map(p=>livePositionView(p,now,online));
  const complete=views.every(p=>p.pnl!==null);
  return {count:views.length,priced:views.filter(p=>p.pnl!==null).length,
    cost:views.every(p=>p.cost!==null)?views.reduce((n,p)=>n+(p.cost??0),0):null,
    value:complete?views.reduce((n,p)=>n+(p.mark??0),0):null,
    pnl:complete?views.reduce((n,p)=>n+(p.pnl??0),0):null};
}
