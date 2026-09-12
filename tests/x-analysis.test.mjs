import test from 'node:test';
import assert from 'node:assert/strict';
import {xAnalysis} from '../lib/x-analysis.ts';
const now=1800000000000;
const observations=Array.from({length:7},(_,i)=>({at:now-600000+i*100000,complete:true}));
const posts=[{id:'a',author:'alice',at:now-500000,text:'I like the community discussion'},
 {id:'b',author:'bob',at:now-100000,text:'The pairing reflects an artificial intelligence narrative'}];
test('X context separates recent, cumulative and previous-window authors',()=>{
 const x=xAnalysis({xObservations:observations},posts,now);
 assert.equal(x.comparisonAvailable,true);assert.equal(x.recentAuthors,1);assert.equal(x.totalAuthors,2);assert.equal(x.newAuthors,1);assert.equal(x.authorDelta,0);
});
test('missing collection, incomplete pages and pauses cannot be called cooling or zero heat',()=>{
 const missing=xAnalysis({},[],now);assert.equal(missing.recentAuthors,null);assert.equal(missing.authorDelta,null);
 for(const t of [{xObservations:observations.slice(2)},{xObservations:observations.map((o,i)=>({...o,complete:i!==3}))},{xObservations:observations,xPauseReason:'预算不足'}]){
  const x=xAnalysis(t,posts,now);assert.equal(x.comparisonAvailable,false);assert.equal(x.authorDelta,null);
 }
});
test('context excludes future posts and future FDV samples',()=>{
 const x=xAnalysis({xObservations:observations,history:[{at:now+1,fdv:100},{at:now-100,fdv:80}]},[...posts,{id:'c',author:'future',at:now+1,text:'future'}],now);
 assert.equal(x.totalAuthors,2);assert.deepEqual(x.fdvHistory,[{at:now-100,fdv:80}]);
});
