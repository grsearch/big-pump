import test from 'node:test';
import assert from 'node:assert/strict';
import {attributedOrder,quotedRoute,strategyName} from '../lib/live-records.ts';
import {Store} from '../backend/store.mjs';
import {LiveTrading} from '../backend/live-trading.mjs';
const p={ca:'target',strategy:'stonk-graduation-c-v1',sellSignature:'sell-sig'};
test('historical strategy repair requires unique matching CA and signature',()=>{
 const order={id:'sell',ca:'target',side:'sell',signature:'sell-sig'};
 assert.equal(attributedOrder(order,[p]).strategy,p.strategy);
 assert.equal(attributedOrder({...order,signature:undefined},[p]).strategy,undefined);
 assert.equal(attributedOrder({...order,ca:'other'},[p]).strategy,undefined);
 assert.equal(attributedOrder(order,[p,p]).strategy,undefined);
 assert.equal(attributedOrder({...order,strategy:'legacy-a'},[p]).strategy,'legacy-a');
 assert.equal(strategyName(undefined),'策略未知');
});
test('startup persists evidence-based attribution without assigning unknown positions to A',()=>{
 const s=new Store(':memory:');try{
 s.put('live-position',p.ca,p);s.put('live-order','sell',{id:'sell',ca:p.ca,side:'sell',signature:p.sellSignature});
 s.put('live-order','unknown',{id:'unknown',ca:p.ca,side:'sell',signature:'different'});
 new LiveTrading(s,{},null);
 assert.equal(s.get('live-order','sell').strategy,p.strategy);
 assert.equal(s.get('live-order','unknown').strategy,undefined);
 }finally{s.close();}
});
test('quoted multi-hop routes distinguish intermediate mints and do not retain signing data',()=>{
 const sol='So11111111111111111111111111111111111111112',quote='11111111111111111111111111111111',target='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
 const r=quotedRoute({inputMint:sol,outputMint:target,transaction:'SECRET',routePlan:[{swapInfo:{inputMint:sol,outputMint:quote,label:'pool1'}},{swapInfo:{inputMint:quote,outputMint:target,label:'pool2'}}]});
 assert.deepEqual(r.intermediates,[quote]);assert.equal(r.legs.length,2);assert.equal(r.transaction,undefined);
 assert.equal(quotedRoute({inputMint:sol,outputMint:target}).legs.length,0);
});
test('new exit intents inherit strategy and quote identity from the held position',async()=>{
 const s=new Store(':memory:');try{
 const now=1800000000000,position={...p,status:'open',quoteMint:'quote',quoteSymbol:'QUOTE',quantity:'100',openedAt:now-1800001,costLamports:100};
 s.put('live-position',p.ca,position);
 const engine=new LiveTrading(s,{},null,{clock:()=>now,wallet:{address:'mock'},jupiter:{order:async()=>({outAmount:'80',signatureFeeLamports:0,prioritizationFeeLamports:0,rentFeeLamports:0})}});
 let captured;engine.submit=async(intent)=>{captured=intent;};
 await engine.checkExit(position);
 assert.equal(captured.strategy,p.strategy);assert.equal(captured.quoteMint,'quote');assert.equal(captured.side,'sell');
 }finally{s.close();}
});
