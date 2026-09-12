import {Store} from './store.mjs';
import {StonkDiscovery,STONK_CONFIGS} from './stonk.mjs';
import {helius} from './providers.mjs';
import {acquireLiveLock} from './live-lock.mjs';
if(!process.send||!process.env.DISCOVERY_DB_PATH)throw Error('毕业发现进程必须由采集服务启动');
const release=acquireLiveLock(process.env.DISCOVERY_DB_PATH+'.discovery');process.once('exit',release);
const s=new Store(process.env.DISCOVERY_DB_PATH);
const send=m=>{if(process.connected)process.send(m,()=>{});};
const w={s,env:process.env,running:false,discoveryOnly:true,rpc:process.env.HELIUS_API_KEY?helius(process.env.HELIUS_API_KEY):null,onGraduation:()=>send({type:'signal'})};
const discovery=new StonkDiscovery(w);
let socket,reconnect,stopping=false,lastMessageAt=null,connection='未启动',lastError=null;
const notifications=new Map();
const failure=()=>{lastError='发现任务暂时失败，将重试';};
function flushNotifications(){for(const [signature,item] of [...notifications].slice(0,8)){try{discovery.enqueue(signature,item.kind,item.at);notifications.delete(signature);}catch{failure();break;}}}
function connect(){
 if(stopping||!w.running||!w.rpc||socket)return;
 const ws=new WebSocket(`wss://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(process.env.HELIUS_API_KEY)}`);socket=ws;
 ws.onopen=()=>{connection='已连接';lastMessageAt=Date.now();STONK_CONFIGS.forEach((key,i)=>ws.send(JSON.stringify({jsonrpc:'2.0',id:i+1,method:'logsSubscribe',params:[{mentions:[key]},{commitment:'confirmed'}]})));};
 ws.onmessage=e=>{lastMessageAt=Date.now();try{const m=JSON.parse(e.data);if(m.error){connection='订阅被拒绝';ws.close();return;}const v=m.params?.result?.value;if(!v||v.err)return;
  if(v.logs?.some(x=>/Instruction: (?:MigrateToCpswap|InitializeWithToken2022|InitializeV2|Initialize)(?:$|\s)/i.test(x))){if(!notifications.has(v.signature))notifications.set(v.signature,{kind:v.logs.some(x=>/Instruction: MigrateToCpswap(?:$|\s)/i.test(x))?'migration':'creation',at:lastMessageAt});flushNotifications();}
 }catch{failure();}};
 ws.onerror=()=>{connection='连接错误';};ws.onclose=()=>{if(socket===ws)socket=null;connection='连接断开';if(w.running&&!stopping){reconnect=setTimeout(connect,1000);reconnect.unref();}};
}
function control(running){w.running=running;if(running){connect();void discovery.drainSignatures().catch(failure);}else{clearTimeout(reconnect);socket?.close();}}
process.on('message',m=>{if(m?.type==='control')control(m.running===true);});
const tick=setInterval(()=>{if(w.running){flushNotifications();void discovery.drainSignatures().catch(failure);void discovery.tick().catch(failure);if(socket?.readyState===1&&Date.now()-lastMessageAt>120000)socket.close();}},1000);
const report=type=>send({type,at:Date.now(),status:{running:w.running,helius:w.rpc?connection:'未配置',stonk:discovery.status,lastMessageAt,lastError,bufferedNotifications:notifications.size}});
const heartbeat=setInterval(()=>report('status'),5000);
function stop(){if(stopping)return;stopping=true;w.running=false;clearTimeout(reconnect);clearInterval(tick);clearInterval(heartbeat);socket?.close();s.close();process.exit(0);}
process.on('disconnect',stop);process.on('SIGTERM',stop);process.on('SIGINT',stop);report('ready');
