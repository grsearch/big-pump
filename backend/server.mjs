import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { Store } from './store.mjs';
import { Worker } from './worker.mjs';
import {removePumpObservations} from './stonk-only.mjs';
import {LiveProcess} from './live-process.mjs';
import { heat, validateRules } from '../lib/engine.ts';
const bootAt=Date.now();console.log('Collector initializing: database and wallet verification');
const store=new Store(resolve(process.env.DATA_DIR??'data','pump.db'));removePumpObservations(store);for(const run of store.all('shadow-run'))if(run.status==='running'){store.put('shadow-run',run.id,{...run,status:'retired',acceptEntries:false,retiredAt:Date.now()});}store.put('config','shadow-active',null);const worker=new Worker(store,{...process.env,MONITOR_SOURCE:'stonk'});const port=Number(process.env.PORT??5010);
const live=new LiveProcess(store,process.env,resolve(process.env.DATA_DIR??'data','pump.db'));
worker.onGraduation=()=>live.notify(worker.running);


const origins=new Set(['http://localhost:3000','http://127.0.0.1:3000',`http://localhost:${port}`,`http://127.0.0.1:${port}`]);
export const server=createServer(async(req,res)=>{const origin=req.headers.origin;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');if(!['127.0.0.1','localhost'].includes((req.headers.host??'').split(':')[0])){res.writeHead(403);res.end('{}');return;}if(origin&&!origins.has(origin)){res.writeHead(403);res.end('{}');return;}if(origin)res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 try{const path=new URL(req.url,'http://localhost').pathname;if(req.method==='GET'&&path==='/api/dashboard'){const now=Date.now();store.purgeExpired(now);res.end(JSON.stringify({mode:'live',now,running:worker.running,status:worker.status,rules:store.rules(),dayCost:store.cost(),tokens:store.all('token').filter(t=>!t.hidden).map(t=>({...t,heat:heat(store.allPosts(t.ca),t.ca,now)})),wallets:store.all('wallet'),stonkHistory:worker.history.snapshot(),events:store.all('event').sort((a,b)=>b.at-a.at).slice(0,60),stonkEnabled:worker.stonk.enabled(),stonkPending:store.all('stonk-candidate').filter(c=>!store.get('token',c.ca)&&now-c.reportedGraduatedAt<86400000).length,xEnabled:process.env.ENABLE_X==='true',xBlocked:!!store.get('config','x-block'),researchEnabled:process.env.ENABLE_WALLET_RESEARCH==='true',analysisStatus:worker.analysis.status(),assessments:store.all('ai-latest'),liveTrading:live.snapshot(),walletDiagnostics:{total:store.all('wallet').length,verified:store.all('wallet').filter(w=>w.status==='verified').length,queued:store.all('coverage').filter(c=>c.queued).length,capped:store.all('coverage').filter(c=>c.capped).length,unsupported:store.all('coverage').filter(c=>c.unsupported).length}}));return;}
 if(req.method==='GET'&&path.startsWith('/api/posts/')){res.end(JSON.stringify(store.posts(decodeURIComponent(path.slice(11))).slice(0,200)));return;}
 if(req.method!=='POST'||!req.headers['content-type']?.startsWith('application/json')){res.writeHead(404);res.end('{}');return;}let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>200000)throw Error('请求内容过大');}const data=JSON.parse(raw||'{}');let result={ok:true};
 if(path==='/api/rules'){store.put('config','rules',validateRules(data));worker.reassessWallets();store.event('rules','监控规则已更新');}
 else if(path==='/api/control'){if(data.action==='start'){await worker.start();live.notify(true);}else if(data.action==='stop'){live.notify(false);worker.stop();}else throw Error('操作无效');}
 else if(path==='/api/pump/backfill/resume'){throw Error('已停止 Pump 监控');}
 else if(path==='/api/x/resume'){worker.resumeX();}
 else if(path==='/api/enroll'){result=await worker.addSignature(data.signature);}
 else if(path==='/api/token'){const t=store.get('token',data.ca);if(!t)throw Error('代币不存在');const now=Date.now();if(data.action==='sleep')store.put('token',t.ca,{...t,status:'sleeping',reason:'手动休眠',stateAt:now});else if(data.action==='wake'){if(now-t.graduatedAt>=Math.min(24,store.rules().maxAgeHours)*3600000)throw Error('已超过最大 AGE');if(t.wakeCount>=store.rules().maxWakes)throw Error('已达到唤醒次数上限');if(t.cost>=store.rules().tokenBudget||store.cost()>=store.rules().dailyBudget)throw Error('预算已耗尽');store.put('token',t.ca,{...t,status:'observing',stateAt:now,lastSignalAt:now,wakeCount:t.wakeCount+1,xWindowStart:now,xSince:undefined,xNext:undefined,xPendingNewest:undefined,reason:'手动唤醒'});}else if(data.action==='alias'){if(typeof data.verified!=='boolean')throw Error('参数错误');if(data.verified&&!t.xAccount)throw Error('没有可核对的项目账号');store.put('token',t.ca,{...t,aliasVerified:data.verified});}else throw Error('操作无效');store.event('manual',data.action,t.ca);}
 else if(path==='/api/live/control'){if(data.action==='start'&&data.confirmation!=='LIVE_C_0.1_SOL')throw Error('请确认启用策略 C，每笔 0.1 SOL 实盘');result=await live.control(data.action);}
 else if(path==='/api/shadow/start'){throw Error('Shadow 策略已移除');}
 else if(path==='/api/shadow/control'){throw Error('Shadow 策略已移除');}
 else if(path==='/api/wallet/history'){result=worker.history.control(data.action);}
 else if(path==='/api/wallet/scan'){result=await worker.scanWallet(data.address);}
 else{res.writeHead(404);res.end('{}');return;}res.end(JSON.stringify(result));
 }catch(e){res.writeHead(400);res.end(JSON.stringify({error:e.message}));}});
const cleanup=setInterval(()=>{try{removePumpObservations(store);store.purgeExpired();}catch{}},60000);cleanup.unref();server.on('close',()=>{clearInterval(cleanup);live.dispose();});
server.listen(port,'127.0.0.1',()=>{console.log(`Pump collector: http://127.0.0.1:${port}`);console.log('API secrets are loaded only from the local environment.');console.log('Collector initialization completed in '+(Date.now()-bootAt)+' ms');live.start();if(process.env.AUTO_START==='true')worker.start().then(()=>live.notify(worker.running)).catch(()=>{});});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{live.dispose();worker.stop();server.close();store.close();process.exit(0);});
