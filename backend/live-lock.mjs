import {writeFileSync,linkSync,unlinkSync,readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};
// An orphan signer must exit before a replacement can start, including when its
// disconnect callback is delayed. PID reuse fails closed rather than risking two signers.
export function acquireLiveLock(dbPath){
 const path=dbPath+'.live.lock',nonce=randomUUID(),temporary=path+'.'+nonce;
 writeFileSync(temporary,JSON.stringify({pid:process.pid,nonce}),{flag:'wx',mode:0o600});
 try{
  try{linkSync(temporary,path);}catch(e){
   if(e.code!=='EEXIST')throw e;
   const previous=JSON.parse(readFileSync(path,'utf8'));
   if(!Number.isInteger(previous.pid)||previous.pid<=0||alive(previous.pid))throw Error('已有实盘进程持有账本执行锁，等待其退出');
   unlinkSync(path);linkSync(temporary,path);
  }
 }finally{unlinkSync(temporary);}
 return ()=>{try{if(JSON.parse(readFileSync(path,'utf8')).nonce===nonce)unlinkSync(path);}catch{}};
}
