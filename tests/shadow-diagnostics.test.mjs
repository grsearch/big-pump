import test from 'node:test';
import assert from 'node:assert/strict';
import {newDiffusionRun,diffusionStep} from '../lib/diffusion-shadow.ts';
import {shadowDiagnostics,shadowReason} from '../lib/shadow-diagnostics.ts';
const now=1800000000000;
const t=(extra={})=>({ca:'c',symbol:'C',status:'observing',graduatedAt:now-600000,marketAt:now,priceUsd:1,fdv:30000,lp:20000,xObservations:[],...extra});
test('no trades are explained by post-start observations and actual author thresholds',()=>{
  const run=newDiffusionRun(now-1000),a=run.arms[0];
  assert.match(shadowReason(t(),a,run,now),/尚无 X/);
  assert.match(shadowReason(t({xObservations:[{at:now-2000,newAuthors:5}]}),a,run,now),/尚无 X/);
  assert.match(shadowReason(t({xObservations:[{at:now,newAuthors:1}]}),a,run,now),/不足 2/);
  const ready=t({xObservations:[{at:now,newAuthors:2}]});
  assert.match(shadowReason(ready,a,run,now),/条件已满足/);
  const stepped=diffusionStep(run,[ready],now);assert.match(shadowReason(ready,stepped.arms[0],stepped,now),/等待成交/);
});
test('diagnostics distinguish LP, FDV, tax and expired quotes without mutating strategy',()=>{
  const run=newDiffusionRun(now-1000),before=structuredClone(run);
  const rows=[t({ca:'lp',lp:5000}),t({ca:'fdv',fdv:600000}),t({ca:'tax',shadowBlocked:'tax unknown'}),t({ca:'stale',marketAt:now-61000})];
  const d=shadowDiagnostics(rows,run.arms[0],run,now);
  assert.deepEqual(d.rows.map(r=>r.reason),['LP 不足','FDV 不在入场范围','税费或执行估值未就绪','行情缺失或超过 60 秒']);
  assert.equal(d.counts.reduce((s,[,n])=>s+n,0),4);assert.deepEqual(run,before);
});
test('breakout diagnostics explain warmup and second confirmation; hidden entries excluded',()=>{
  const run=newDiffusionRun(now-120000),a=run.arms[1];
  const o={at:now,complete:true,authors:9,clean:12,priorAuthors:4,newcomers:5};
  assert.match(shadowReason(t({graduatedAt:now-300000,xObservations:[o]}),a,run,now),/满 10/);
  assert.match(shadowReason(t({xObservations:[o]}),a,run,now),/第二次/);
  assert.equal(shadowDiagnostics([t({hidden:true})],a,run,now).rows.length,0);
  run.acceptEntries=false;assert.equal(shadowReason(t(),a,run,now),'已暂停开仓');
});
