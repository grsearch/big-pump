// Offline integration check: no API keys, no signer, no network requests.
import {fork} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const dir=mkdtempSync(join(tmpdir(),'big-pump-process-check-'));
const child=fork(new URL('../backend/live-process-child.mjs',import.meta.url),[],{execArgv:[],env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,ENABLE_LIVE_TRADING:'false',LIVE_DB_PATH:join(dir,'test.db')},stdio:['ignore','ignore','inherit','ipc'],windowsHide:true});
const timeout=setTimeout(()=>{child.kill();process.exitCode=1;console.error('child check timed out');},15000);
let busyEnd;
child.on('message',m=>{
 if(m.type==='ready'){
  assert.equal(m.status.configured,false);const start=Date.now();busyEnd=start+6200;
  // Deliberately block this parent; the child's 5s heartbeat must still execute.
  while(Date.now()<busyEnd){}
 }
 if(m.type==='status'){
  assert(m.at<busyEnd,'child heartbeat was delayed by parent event loop');
  console.log('PASS: execution child heartbeat continued during 6.2s parent blockage; no credentials or transactions used');
  clearTimeout(timeout);child.disconnect();
 }
});
child.on('exit',code=>{clearTimeout(timeout);if(code!==0)process.exitCode=1;});
