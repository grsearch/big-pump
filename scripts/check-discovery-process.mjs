// Offline process isolation check; intentionally supplies no RPC or wallet keys.
import {fork} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const dir=mkdtempSync(join(tmpdir(),'big-pump-discovery-check-'));
const child=fork(new URL('../backend/discovery-process-child.mjs',import.meta.url),[],{execArgv:[],env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,ENABLE_STONK:'true',DISCOVERY_DB_PATH:join(dir,'test.db')},stdio:['ignore','ignore','inherit','ipc'],windowsHide:true});
const timeout=setTimeout(()=>{child.kill();process.exitCode=1;console.error('discovery check timed out');},15000);
let busyEnd;
child.on('message',m=>{
 if(m.type==='ready'){child.send({type:'control',running:true});busyEnd=Date.now()+6200;while(Date.now()<busyEnd){};}
 if(m.type==='status'){assert(m.at<busyEnd);assert.equal(m.status.running,true);assert.equal(m.status.helius,'未配置');console.log('PASS: discovery heartbeat continues during 6.2s parent blockage, no credentials or network used');clearTimeout(timeout);child.disconnect();}
});
child.on('exit',code=>{clearTimeout(timeout);if(code!==0)process.exitCode=1;});
