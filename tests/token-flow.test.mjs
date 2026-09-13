import test from 'node:test';
import assert from 'node:assert/strict';
import {flowTrade,flowSummary,TokenFlow,newHolderEvidence} from '../backend/token-flow.mjs';
import {Store} from '../backend/store.mjs';
import {SOL_MINT} from '../backend/valuation.mjs';
const t={ca:'c',source:'stonk',quoteMint:'q',pool:'p',graduatedAt:60000,enrolledAt:60000};
const endpoint=(mint,amount)=>({mint,userAccount:'w',rawTokenAmount:{tokenAmount:String(amount),decimals:0}});
const tx={signature:'s',timestamp:65,type:'SWAP',events:{swap:{nativeInput:{account:'w',amount:100000000},tokenOutputs:[endpoint('c',100)],innerSwaps:[{ignored:true}]}}};
test('flow counts multi-hop once using trader endpoints, excluding network fees',()=>{const x=flowTrade(tx,t,()=>100,70000);assert.equal(x.usd,10);assert.equal(x.quoteMint,SOL_MINT);assert.equal(x.quantity,100);assert.equal(x.side,'buy');});
test('failed, transfer and ambiguous swaps are excluded; missing FX stays unknown',()=>{assert.equal(flowTrade({...tx,transactionError:{}},t,()=>10,70000),null);assert.equal(flowTrade({...tx,type:'TRANSFER'},t,()=>10,70000),null);assert.equal(flowTrade({...tx,events:{swap:{...tx.events.swap,tokenOutputs:[endpoint('c',10),endpoint('x',10)]}}},t,()=>10,70000),null);assert.equal(flowTrade(tx,t,()=>null,70000).usd,null);});
test('summary separates large sells and first observed buys; unknown valuation hides net',()=>{const s=new Store(':memory:');const put=(id,wallet,side,usd,at)=>s.put('flow-trade',id,{id,ca:'c',wallet,side,usd,at});put('a','w','buy',10,65000);put('b','w','buy',20,66000);put('c','z','sell',600,67000);put('d','v','buy',null,68000);const f=flowSummary(s,t);assert.equal(f.bars[0].firstObservedBuyers,2);assert.equal(f.bars[0].firstObservedBuyerUsd,10);assert.equal(f.bars[0].largeSellUsd,600);assert.equal(f.bars[0].netUsd,null);assert.equal(f.bars[0].holders,null);s.close();});
test('flow scanner persists cursor, deduplicates and never advances incomplete responses',async()=>{const s=new Store(':memory:'),now=Date.now(),token={...t,graduatedAt:now-10000,enrolledAt:now-10000};s.put('token','c',token);const original=globalThis.fetch;let requests=0;const w={s,running:true,env:{HELIUS_API_KEY:'test'},valuation:{price:()=>100},rpc:async()=>[{signature:'s',blockTime:Math.floor(now/1000)}]};const f=new TokenFlow(w);globalThis.fetch=async()=>{requests++;return new Response(JSON.stringify([{...tx,timestamp:Math.floor(now/1000)}]));};try{await f.tick();await f.tick();assert.equal(s.all('flow-trade').length,1);assert.equal(s.get('flow-scan','c').head,'s');globalThis.fetch=async()=>new Response('[]');await f.tick();assert(s.get('flow-scan','c').error);assert.equal(s.get('flow-scan','c').pages,2);assert.equal(requests,2);}finally{globalThis.fetch=original;s.close();}});

test('new holding evidence needs known owners and zero to positive touched-account balances',()=>{const b=n=>({mint:'c',owner:'w',uiTokenAmount:{amount:String(n)}});const event={ca:'c',wallet:'w'};assert.equal(newHolderEvidence({meta:{preTokenBalances:[b(0)],postTokenBalances:[b(10)]}},event),true);assert.equal(newHolderEvidence({meta:{preTokenBalances:[b(4)],postTokenBalances:[b(10)]}},event),false);assert.equal(newHolderEvidence({meta:{preTokenBalances:[{...b(0),owner:null}],postTokenBalances:[b(10)]}},event),null);});

test('latest lane advances while legacy historical RPC is pending and preserves newly queued gaps',async()=>{
 const s=new Store(':memory:'),now=Date.now(),token={...t,graduatedAt:now-100000,enrolledAt:now-100000};s.put('token','c',token);
 s.put('flow-scan','c',{ca:'c',pages:8,unsupported:2,before:'old-cursor',pendingHead:'old-head'});
 const f=new TokenFlow({s,running:true,rpc:()=>{},env:{}});f.enrich=async()=>{};
 let release,heads=0;const calls=[];
 f.page=async(t,options)=>{calls.push(options);if(options.before)return new Promise(resolve=>{release=resolve;});heads++;return {sigs:Array.from({length:20},(_,i)=>({signature:'head'+heads+'-'+i})),unsupported:0,done:false};};
 await f.tick();await f.tick();assert.equal(heads,2);assert.equal(calls.filter(c=>!c.before).length,2);assert.equal(s.get('flow-scan','c').head,'head2-0');assert.equal(s.get('flow-scan','c').jobs.length,3);
 release({sigs:[],unsupported:0,done:true});await f.historyPromise;assert.equal(s.get('flow-scan','c').jobs.length,2);assert.equal(s.get('flow-scan','c').head,'head2-0');s.close();
});
