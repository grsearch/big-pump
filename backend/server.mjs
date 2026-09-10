import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { Store } from './store.mjs';
import { Worker } from './worker.mjs';
import { heat, validateRules } from '../lib/engine.ts';
const store=new Store(resolve(process.env.DATA_DIR??'data','pump.db'));const worker=new Worker(store);const port=Number(process.env.PORT??5010);
const origins=new Set(['http://localhost:3000','http://127.0.0.1:3000',`http://localhost:${port}`,`http://127.0.0.1:${port}`]);
export const server=createServer(async(req,res)=>{const origin=req.headers.origin;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');if(!['127.0.0.1','localhost'].includes((req.headers.host??'').split(':')[0])){res.writeHead(403);res.end('{}');return;}if(origin&&!origins.has(origin)){res.writeHead(403);res.end('{}');return;}if(origin)res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 try{const path=new URL(req.url,'http://localhost').pathname;if(req.method==='GET'&&path==='/api/dashboard'){const now=Date.now();res.end(JSON.stringify({mode:'live',now,running:worker.running,status:worker.status,rules:store.rules(),dayCost:store.cost(),tokens:store.all('token').map(t=>({...t,heat:heat(store.posts(t.ca),t.ca,now)})),wallets:store.all('wallet'),events:store.all('event').sort((a,b)=>b.at-a.at).slice(0,60),xEnabled:process.env.ENABLE_X==='true',xBlocked:!!store.get('config','x-block'),researchEnabled:process.env.ENABLE_WALLET_RESEARCH==='true',analysisStatus:worker.analysis.status(),assessments:store.all('ai-latest'),shadowRuns:store.all('shadow-run')}));return;}
 if(req.method==='GET'&&path.startsWith('/api/posts/')){res.end(JSON.stringify(store.posts(decodeURIComponent(path.slice(11))).slice(0,200)));return;}
 if(req.method!=='POST'||!req.headers['content-type']?.startsWith('application/json')){res.writeHead(404);res.end('{}');return;}let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>200000)throw Error('请求内容过大');}const data=JSON.parse(raw||'{}');let result={ok:true};
 if(path==='/api/rules'){store.put('config','rules',validateRules(data));worker.reassessWallets();store.event('rules','监控规则已更新');}
 else if(path==='/api/control'){if(data.action==='start')await worker.start();else if(data.action==='stop')worker.stop();else throw Error('操作无效');}
 else if(path==='/api/x/resume'){worker.resumeX();}
 else if(path==='/api/enroll'){result=await worker.addSignature(data.signature);}
 else if(path==='/api/token'){const t=store.get('token',data.ca);if(!t)throw Error('代币不存在');const now=Date.now();if(data.action==='sleep')store.put('token',t.ca,{...t,status:'sleeping',reason:'手动休眠',stateAt:now});else if(data.action==='wake'){if(now-t.graduatedAt>=Math.min(24,store.rules().maxAgeHours)*3600000)throw Error('已超过最大 AGE');if(t.wakeCount>=store.rules().maxWakes)throw Error('已达到唤醒次数上限');if(t.cost>=store.rules().tokenBudget||store.cost()>=store.rules().dailyBudget)throw Error('预算已耗尽');store.put('token',t.ca,{...t,status:'observing',stateAt:now,lastSignalAt:now,wakeCount:t.wakeCount+1,xWindowStart:now,xSince:undefined,xNext:undefined,xPendingNewest:undefined,reason:'手动唤醒'});}else if(data.action==='alias'){if(typeof data.verified!=='boolean')throw Error('参数错误');if(data.verified&&!t.xAccount)throw Error('没有可核对的项目账号');store.put('token',t.ca,{...t,aliasVerified:data.verified});}else throw Error('操作无效');store.event('manual',data.action,t.ca);}
 else if(path==='/api/shadow/start'){result=worker.analysis.startShadow(data.rules??{});}
 else if(path==='/api/shadow/control'){result=worker.analysis.controlShadow(data.action);}
 else if(path==='/api/wallet/scan'){result=await worker.scanWallet(data.address);}
 else{res.writeHead(404);res.end('{}');return;}res.end(JSON.stringify(result));
 }catch(e){res.writeHead(400);res.end(JSON.stringify({error:e.message}));}});
server.listen(port,'127.0.0.1',()=>{console.log(`Pump collector: http://127.0.0.1:${port}`);console.log('API secrets are loaded only from the local environment.');if(process.env.AUTO_START==='true')worker.start().catch(()=>{});});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{worker.stop();server.close();store.close();process.exit(0);});
