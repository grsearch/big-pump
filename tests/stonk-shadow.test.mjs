import test from 'node:test';
import assert from 'node:assert/strict';
import {newDiffusionRun,diffusionStep,diffusionDefaults} from '../lib/diffusion-shadow.ts';
import {stonkExit} from '../lib/stonk-shadow.ts';
const now=1800000000000;
const t=(extra={})=>({ca:'s',symbol:'S',source:'stonk',graduatedAt:now,marketAt:now,priceUsd:1,lp:30000,fdv:30000,
  execution:{at:now,priceAt:now,quotePriceUsd:1,baseFee:{bps:0,maxFee:0,decimals:6},quoteFee:{bps:0,maxFee:0,decimals:6}},...extra});
test('C buys on the graduation tick with valid data, without X, FDV gate or artificial latency',()=>{
  const run=diffusionStep(newDiffusionRun(now),[t({fdv:5000})],now),c=run.arms[2];assert.equal(c.positions[0].status,'open');assert.equal(run.arms[0].positions.length,0);
  assert.equal(c.positions[0].openedAt,now);assert.equal(c.positions[0].fills[0].signalDelayMs,0);assert.equal(c.cash,950);
});
test('C waits for real post-signal data and fills at first valid quote, before 15 seconds',()=>{
  let run=diffusionStep(newDiffusionRun(now),[t({marketAt:now-1000})],now);assert.equal(run.arms[2].positions[0].status,'pending');
  run=diffusionStep(run,[t({marketAt:now+1000,shadowBlocked:'unsupported'})],now+1000);assert.equal(run.arms[2].positions[0].status,'pending');
  run=diffusionStep(run,[t({marketAt:now+2000,fdv:null})],now+2000);assert.equal(run.arms[2].positions[0].status,'open');assert.equal(run.arms[2].positions[0].openedAt,now+2000);
});
test('C rejects old graduations and Pump; upgrades do not backfill old coins',()=>{
  const run=newDiffusionRun(now);run.arms.pop();
  const next=diffusionStep(run,[t({graduatedAt:now-1}),t({ca:'p',source:'pump'})],now);
  assert.equal(next.arms[2].positions.length,0);assert.equal(next.arms[2].startedAt,now);
});
test('C ignores low FDV and exits at 15m; no inherited fixed profit/stop',()=>{
  const p={cost:50,quantity:50,openedAt:now,highValue:0,trailingActive:false};
  assert.equal(stonkExit({...p},t({fdv:9999}),diffusionDefaults,now),null);
  assert.equal(stonkExit({...p},null,diffusionDefaults,now+900000),'持仓满 15 分钟');
  const r={...diffusionDefaults,fee:0,slippage:0,fixedCostUsd:0};
  assert.equal(stonkExit({...p},t({priceUsd:.8}),r,now),null);
  const trail={...p};assert.equal(stonkExit(trail,t({priceUsd:1.6}),r,now),null);assert(trail.trailingActive);
  assert.match(stonkExit(trail,t({priceUsd:1.4}),r,now),/回撤 10%/);
});
test('C queues timeout with missing quote and only closes on subsequent valid data',()=>{
  let run=diffusionStep(newDiffusionRun(now),[t()],now);
  run=diffusionStep(run,[t({marketAt:now+16000})],now+16000);
  run=diffusionStep(run,[],now+916000);assert.match(run.arms[2].positions[0].pendingExit.reason,/15 分钟/);assert.equal(run.arms[2].positions[0].status,'open');
  const later=now+932000;const coin=t({marketAt:later,execution:{...t().execution,at:later,priceAt:later}});
  run=diffusionStep(run,[coin],later);assert.equal(run.arms[2].positions[0].status,'closed');
});
test('C removes unfilled legacy FDV exits without altering closed trades',()=>{
  let run=diffusionStep(newDiffusionRun(now),[t()],now);
  run=diffusionStep(run,[t({marketAt:now+16000})],now+16000);
  const p=run.arms[2].positions[0];p.pendingExit={at:now+16000,reason:'FDV 跌破 $10,000'};
  run=diffusionStep(run,[t({fdv:9000,marketAt:now+32000})],now+32000);
  assert.equal(run.arms[2].positions[0].status,'open');assert.equal(run.arms[2].positions[0].pendingExit,null);
});
