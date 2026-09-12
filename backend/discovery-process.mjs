import {fork} from 'node:child_process';

// Owns process lifecycle only. The discovery child has its own WebSocket/RPC
// and durable queue, so a busy dashboard cannot delay receipt of chain events.
export class DiscoveryProcess {
 constructor(env,dbPath,onStatus=()=>{},onSignal=()=>{},spawn=fork){Object.assign(this,{env,dbPath,onStatus,onSignal,spawn,running:false,status:{ready:false}});}
 start(){
  if(this.closed||this.child||this.env.ENABLE_STONK!=='true')return;
  let child;try{child=this.spawn(new URL('./discovery-process-child.mjs',import.meta.url),[],{env:{...this.env,DISCOVERY_DB_PATH:this.dbPath},execArgv:[],stdio:['ignore','inherit','inherit','ipc'],windowsHide:true});}catch{this.status={ready:false,error:'毕业发现进程启动失败，等待重试'};this.onStatus(this.status);this.retry=setTimeout(()=>this.start(),1000);this.retry.unref?.();return;}this.child=child;
  const stopped=()=>{if(this.child!==child)return;this.child=null;this.status={ready:false,error:'毕业发现进程退出，等待重启'};this.onStatus(this.status);if(!this.closed){this.retry=setTimeout(()=>this.start(),1000);this.retry.unref?.();}};
  child.on('error',stopped);child.on('exit',stopped);child.on('close',stopped);
  child.on('message',m=>{if(this.child!==child)return;if(m.type==='status'||m.type==='ready'){this.status={...m.status,ready:true,pid:child.pid,lastStatusAt:m.at};this.onStatus(this.status);if(m.type==='ready')this.notify(this.running);}if(m.type==='signal')this.onSignal();});
 }
 notify(running){this.running=!!running;if(this.child?.connected)this.child.send({type:'control',running:this.running},()=>{});}
 snapshot(){return {isolated:true,...this.status};}
 dispose(){this.closed=true;clearTimeout(this.retry);this.child?.kill();}
}
