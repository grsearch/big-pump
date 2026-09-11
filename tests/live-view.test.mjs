import test from 'node:test';
import assert from 'node:assert/strict';
import {livePositionView,livePortfolio} from '../lib/live-view.ts';
const now=1800000000000,p={status:'open',costLamports:100000000,markLamports:120000000,quoteAt:now};
test('current P&L uses net proceeds minus actual cost and preserves negative liquidation value',()=>{
 assert.equal(livePositionView(p,now,true).pnl,20000000);assert.equal(livePositionView(p,now,true).percent,20);
 assert.equal(livePositionView({...p,markLamports:-5000},now,true).pnl,-100005000);
});
test('failed stale missing future and disconnected quotes never masquerade as current P&L',()=>{
 for(const patch of [{quoteError:'HTTP 400'},{quoteAt:now-30001},{quoteAt:null},{quoteAt:now+1},{markLamports:undefined}])assert.equal(livePositionView({...p,...patch},now,true).pnl,null);
 assert.equal(livePositionView(p,now,false).pnl,null);
 const v=livePositionView({...p,quoteError:'failure'},now,true);assert.equal(v.mark,120000000);assert(!v.fresh);
});
test('portfolio never sums incomplete quotes as a complete live return or includes closed positions',()=>{
 const total=livePortfolio([p,{...p,status:'closed',markLamports:999999999}],now,true);assert.equal(total.pnl,20000000);assert.equal(total.count,1);
 const partial=livePortfolio([p,{...p,markLamports:undefined}],now,true);assert.equal(partial.pnl,null);assert.equal(partial.priced,1);assert.equal(partial.cost,200000000);
 assert.equal(livePortfolio([],now,true).pnl,0);
});
