import test from 'node:test';
import assert from 'node:assert/strict';
import {captureStonkReview,stonkReviewMetrics} from '../lib/stonk-review.ts';
const position=()=>({id:'p',openedAt:100000,status:'open',signalAt:10000,evidence:{graduatedAt:10000},cost:50});
test('review persists independent of tokens and excludes observations after sell',()=>{
  const p=position();captureStonkReview(p,{history:[{at:10000,fdv:30000},{at:150000,fdv:40000}],xObservations:[{at:120000,authors:3,newAuthors:2,complete:true},{at:210000,authors:7,newAuthors:4,complete:true}]},200000);
  assert.equal(p.review.x.length,1);assert.equal(p.review.fdv.length,2);
  Object.assign(p,{status:'closed',closedAt:200000,realized:-20});captureStonkReview(p,null,220000);
  assert.equal(p.review.x.length,1);assert.equal(stonkReviewMetrics(p).roi,-.4);assert.equal(stonkReviewMetrics(p).classification,'observed');
  captureStonkReview(p,{xObservations:[{at:250000,authors:20,complete:true}]},260000);assert.equal(p.review.x.length,1);
});
test('zero discussion needs complete temporal coverage, not merely zero posts',()=>{
  const p={...position(),closedAt:400000,status:'closed',realized:-30};
  assert.equal(stonkReviewMetrics(p).classification,'unknown');
  p.review={x:[{at:150000,authors:0,newAuthors:0,complete:true},{at:300000,authors:0,newAuthors:0,complete:true}]};
  assert.equal(stonkReviewMetrics(p).classification,'absent');
  p.review.x[1].complete=false;assert.equal(stonkReviewMetrics(p).classification,'unknown');
  p.review.x[1].complete=true;p.closedAt=600000;assert.equal(stonkReviewMetrics(p).classification,'unknown');
});
test('pre-entry expansion and post-exit samples cannot classify a losing position',()=>{
  const p={...position(),closedAt:300000,review:{x:[{at:99000,authors:10,newAuthors:4,complete:true},{at:301000,authors:10,newAuthors:4,complete:true}]}};
  assert.equal(stonkReviewMetrics(p).classification,'unknown');assert.equal(stonkReviewMetrics(p).firstExpansionAt,null);
});
test('repeated ticks do not fabricate new X samples',()=>{
  const p=position(),t={xObservations:[{at:110000,authors:0,newAuthors:0,complete:true}]};
  captureStonkReview(p,t,120000);captureStonkReview(p,t,130000);assert.equal(p.review.x.length,1);assert.equal(stonkReviewMetrics(p).samples,1);
});
