import test from 'node:test';
import assert from 'node:assert/strict';
import {minuteEma} from '../lib/minute-ema.ts';
const samples=(n=21)=>Array.from({length:n},(_,i)=>({at:i*60000+1000,priceUsd:i+1,fdv:1000*(i+1)}));
test('minute EMA seeds with SMA9/20 then applies exponential weights',()=>{
 const {bars,metric}=minuteEma(samples(),21*60000,0);
 assert.equal(metric,'priceUsd');assert.equal(bars[7].ema9,null);assert.equal(bars[8].ema9,5);
 assert.equal(bars[9].ema9,6);assert.equal(bars[18].ema20,null);assert.equal(bars[19].ema20,10.5);assert.equal(bars[20].ema20,11.5);
});
test('OHLC uses sorted samples, source time, no duplicate source ticks or unfinished candles',()=>{
 const rows=[{at:40000,marketAt:2000,priceUsd:2},{at:1000,priceUsd:3},{at:3000,priceUsd:5},{at:4000,priceUsd:4},{at:50000,marketAt:2000,priceUsd:99},{at:65000,priceUsd:100}];
 const {bars}=minuteEma(rows,70000,0);assert.equal(bars.length,1);
 assert.deepEqual([bars[0].open,bars[0].high,bars[0].low,bars[0].close,bars[0].samples],[3,5,2,4,4]);
});
test('gaps reset both indicators; FDV never gets mixed into price series',()=>{
 const rows=samples(32);rows[20]={at:20*60000+1000,fdv:100000};
 const {bars}=minuteEma(rows,32*60000,0);
 assert.equal(bars[20].close,null);assert.equal(bars[20].ema20,null);assert.equal(bars[28].ema9,null);assert.equal(bars[29].ema9,26);assert.equal(bars[31].ema20,null);
});
test('legacy FDV is explicitly labelled, enrollment partial minute and future data excluded',()=>{
 const {bars,metric}=minuteEma(samples().map(({at,fdv})=>({at,fdv})),10*60000,1500);
 assert.equal(metric,'fdv');assert.equal(bars[0].at,60000);assert.equal(bars.length,9);assert.equal(bars.at(-1).ema9,6000);
 assert.deepEqual(minuteEma([],0).bars,[]);
});
