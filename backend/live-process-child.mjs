import {Store} from './store.mjs';
import {LiveTrading} from './live-trading.mjs';
import {helius} from './providers.mjs';
import {acquireLiveLock} from './live-lock.mjs';
// Only the collector supervisor may launch this process, preventing an accidental
// standalone second signer against the same order book.
if(!process.send||!process.env.LIVE_DB_PATH)throw Error('实盘执行进程必须由采集服务启动');
const release=acquireLiveLock(process.env.LIVE_DB_PATH);process.once('exit',release);
const store=new Store(process.env.LIVE_DB_PATH);
const live=new LiveTrading(store,process.env,process.env.HELIUS_API_KEY?helius(process.env.HELIUS_API_KEY):null);
let running=false,stopping=false;
const send=m=>{if(process.connected)process.send(m,()=>{});};
const status=type=>send({type,at:Date.now(),status:{configured:!!live.wallet&&!live.error,wallet:live.wallet?.address??null,error:live.error,jupiter:live.jup.status()}});
const failure=e=>{console.error('Live execution task failed:',e?.code==='ERR_SQLITE_ERROR'?'database busy/error':e?.name??'Error');};
process.on('message',m=>{
 if(stopping)return;
 if(m?.type==='collector'){running=m.running===true;live.collectorRunning=running;void live.onGraduation(running).catch(failure);}
 if(m?.type==='control'){
  try{if(!['start','pause'].includes(m.action))throw Error('操作无效');const result=live.control(m.action);send({type:'result',id:m.id,result});}
  catch(e){send({type:'result',id:m.id,error:e.message});}
 }
});
const tick=setInterval(()=>{void live.tick(running).catch(failure);},1000);
const exit=setInterval(()=>{void live.exitTick().catch(failure);},1000);
const report=setInterval(()=>{try{status('status');}catch(e){failure(e);}},5000);
const stop=()=>{if(stopping)return;stopping=true;live.collectorRunning=false;live.dispose();clearInterval(tick);clearInterval(exit);clearInterval(report);store.close();process.exit(0);};
process.on('disconnect',stop);process.on('SIGTERM',stop);process.on('SIGINT',stop);
status('ready');
