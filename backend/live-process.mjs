import {fork} from 'node:child_process';
import {LiveTrading} from './live-trading.mjs';
// The collector never constructs a signer or executes an order. Only the child
// owns live writes. IPC carries control notifications, never signed transactions.
export class LiveProcess {
  constructor(store,env,dbPath,spawn=fork){
    this.s=store;this.env=env;this.dbPath=dbPath;this.spawn=spawn;this.pending=new Map();this.sequence=0;this.running=false;
    this.status={configured:false,error:env.ENABLE_LIVE_TRADING==='true'?'实盘进程启动中':'实盘未启用'};
  }
  start(){
    if(this.closed||this.child||this.env.ENABLE_LIVE_TRADING!=='true')return;
    this.ready=false;
    try{const child=this.spawn(new URL('./live-process-child.mjs',import.meta.url),[],{env:{...this.env,LIVE_DB_PATH:this.dbPath},execArgv:[],stdio:['ignore','inherit','inherit','ipc'],windowsHide:true});this.child=child;
      child.on('message',m=>{if(this.child!==child)return;
        if(m?.type==='ready'||m?.type==='status'){this.status=m.status;this.lastStatusAt=m.at??Date.now();if(m.type==='ready'){this.ready=true;this.notify(this.running);}}
        if(m?.type==='result'){const p=this.pending.get(m.id);if(p){clearTimeout(p.timer);this.pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.result);}}
      });
      child.on('error',()=>{this.status={configured:false,error:'实盘子进程启动或通信失败'};});
      const stopped=()=>{if(this.child!==child)return;this.child=null;this.ready=false;this.status={configured:false,error:'实盘进程退出，等待重启'};
        for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('实盘进程退出，控制结果待核对'));}this.pending.clear();
        if(!this.closed){this.restart=setTimeout(()=>this.start(),1000);this.restart.unref?.();}
      };child.on('exit',stopped);child.on('close',stopped);
    }catch{this.status={configured:false,error:'实盘子进程启动失败'};if(!this.closed){this.restart=setTimeout(()=>this.start(),1000);this.restart.unref?.();}}
  }
  send(message){if(this.child?.connected)this.child.send(message,error=>{if(error)this.status={...this.status,error:'实盘通信失败'};});}
  notify(running){this.running=!!running;if(this.ready)this.send({type:'collector',running:this.running});}
  control(action){
    if(!['start','pause'].includes(action))return Promise.reject(Error('操作无效'));
    if(!this.ready)return Promise.reject(Error('实盘进程尚未就绪'));
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('实盘控制响应超时，请刷新核对状态；请求不会自动重发'));},5000);
      this.pending.set(id,{resolve,reject,timer});this.send({type:'control',id,action});
    });
  }
  snapshot(){
    const status=this.status,facade={s:this.s,env:this.env,state:()=>this.s.get('config','live-trading')??{acceptEntries:false},
      wallet:status.configured?{address:status.wallet}:null,error:status.error??'',jup:{status:()=>status.jupiter??{}},
      slippageBps:Number(this.env.LIVE_SLIPPAGE_BPS??1500),maxFeeLamports:Number(this.env.LIVE_MAX_FEE_LAMPORTS??5000000)};
    return {...LiveTrading.prototype.snapshot.call(facade),executionProcess:{isolated:true,ready:!!this.ready,pid:this.child?.pid??null,lastStatusAt:this.lastStatusAt??null}};
  }
  dispose(){this.closed=true;clearTimeout(this.restart);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('服务关闭'));}this.pending.clear();this.child?.kill();}
}
