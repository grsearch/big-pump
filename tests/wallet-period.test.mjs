import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateWallet, defaults} from '../lib/engine.ts';
import {walletPeriod} from '../lib/wallet-period.ts';
import {Worker} from '../backend/worker.mjs';
import {Store} from '../backend/store.mjs';
const now=1800000000000,day=86400000;
const pair=(ca,buy=1,sell=5,at=now-day)=>[
  {id:ca+'b',wallet:'w',ca,at,side:'buy',quantity:100,sol:buy,graduatedAt:at-1000},
  {id:ca+'s',wallet:'w',ca,at:at+21600000,side:'sell',quantity:100,sol:sell,graduatedAt:at-1000}
];
const winner=()=>Array.from({length:10},(_,i)=>pair('c'+i)).flat();
const assess=(tx,full=true)=>evaluateWallet(tx,defaults,now,full,now-40*day);
test('complete seven-day winner requires strict >20 SOL and recent realized big wins',()=>{
  assert.equal(assess(winner()).status,'verified');
  assert.equal(assess(winner()).sevenDayProfitSol,40);
  const exact=winner().map(t=>({...t,sol:t.sol/2}));
  assert.equal(assess(exact).sevenDayProfitSol,20);
  assert.equal(assess(exact).status,'watch');
  assert.equal(assess(winner(),false).sevenDayProfitSol,null);
});
test('wallet can qualify with realized big wins held for 30 minutes rather than six hours',()=>{
  const tx=winner().map(t=>t.side==='sell'?{...t,at:t.at-21600000+1800000}:t);
  assert.equal(assess(tx).status,'verified');assert.equal(assess(tx).bigWins.length,10);
});
test('old gains cannot hide recent losses or supply recent winning evidence',()=>{
  const old=winner().map(t=>({...t,at:t.at-10*day,graduatedAt:t.graduatedAt-10*day}));
  const w=assess([...old,...pair('loss',10,1)]);
  assert(w.profit>0);assert.equal(w.sevenDayProfitSol,-9);assert.equal(w.status,'watch');assert.equal(w.bigWins.length,0);
});
test('window profit replays earlier buy costs, includes losses and extra wallet fees',()=>{
  const tx=pair('cross',2,12,now-8*day);tx[1].at=now-1000;
  const p=walletPeriod([...tx,...pair('loss',3,1)],defaults,now,7,[{at:now-100,sol:1}]);
  assert.equal(p.profit,7);assert.equal(p.evidence[0].multiple,6);
  assert.equal(walletPeriod(tx,defaults,now,1).profit,10);
});
test('realized big wins no longer require 6h holding; unrealized winners remain excluded',()=>{
  const tx=pair('fast');tx[1].at=tx[0].at+60000;tx[1].quantity=99;
  tx.push({...tx[1],id:'tail',quantity:1,sol:.1,at:now-1000});
  assert.equal(walletPeriod(tx,defaults,now,7).evidence.length,1);
  assert.equal(walletPeriod([pair('open')[0]],defaults,now,7).evidence.length,0);
});
test('USD trades need contemporaneous SOL cost for every leg; future trades do not leak',()=>{
  const tx=pair('usd').map(t=>({...t,currency:'USD',value:t.sol*100,accountingSol:t.sol,sol:0}));
  assert.equal(walletPeriod(tx,defaults,now,7).profit,4);
  tx[0].accountingSol=null;assert.equal(walletPeriod(tx,defaults,now,7).profit,null);
  assert.equal(walletPeriod([...pair('good'),{...pair('future')[0],at:now+1,complete:false}],defaults,now,7).profit,4);
});
test('auto research queues zero-win wallets and age uses observed chain timestamps',async()=>{
  const s=new Store(':memory:'),w=new Worker(s,{HELIUS_API_KEY:'test',ENABLE_WALLET_RESEARCH:'true'});
  const observedAt=Date.now()-day;s.put('trade','x',{...pair('c')[0],at:observedAt});w.assess('w');
  assert.equal(s.get('wallet','w').firstActivityAt,observedAt);
  let queued;w.scanWallet=async a=>{queued=a;};await w.walletQueueTick();assert.equal(queued,'w');s.close();
});
test('coverage refresh expiry removes verified labels even without new wallet trades',()=>{
  const s=new Store(':memory:'),w=new Worker(s,{}),t=Date.now();
  for(const tr of winner())s.put('trade',tr.id,{...tr,at:tr.at+t-now,graduatedAt:tr.graduatedAt+t-now});
  s.put('coverage','w',{parserVersion:3,complete:true,checkedAt:t,firstActivityAt:t-40*day});w.assess('w');assert.equal(s.get('wallet','w').status,'verified');
  s.put('coverage','w',{parserVersion:3,complete:true,checkedAt:t-900001,firstActivityAt:t-40*day});w.reassessWallets();assert.equal(s.get('wallet','w').status,'watch');s.close();
});
test('history scan keeps failed transaction fees and blocks unparsed swaps',async t=>{
  const s=new Store(':memory:'),w=new Worker(s,{HELIUS_API_KEY:'test'}),address='11111111111111111111111111111111';
  const timestamp=Math.floor((Date.now()-1000)/1000);
  t.mock.method(globalThis,'fetch',async()=>Response.json([
    {signature:'failed',timestamp,transactionError:'failed',feePayer:address,fee:10000000},
    {signature:'unsupported',timestamp,type:'SWAP',feePayer:address,fee:5000}
  ]));
  await w.scanWallet(address);
  assert.equal(s.all('wallet-fee').length,2);
  assert.equal(s.get('coverage',address).unsupported,true);
  assert.equal(s.get('wallet',address).sevenDayProfitSol,null);
  s.close();
});
