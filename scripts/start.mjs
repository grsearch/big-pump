import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const children=[spawn(process.execPath,['--env-file-if-exists=.env','backend/server.mjs'],{cwd:root,stdio:'inherit',windowsHide:true}),spawn(process.execPath,[resolve(root,'node_modules/vinext/dist/cli.js'),'dev','--host','127.0.0.1'],{cwd:root,stdio:'inherit',windowsHide:true})];
let stopping=false;function stop(){if(stopping)return;stopping=true;for(const child of children)child.kill();}
for(const c of children){c.on('error',e=>{console.error(e.message);stop();process.exitCode=1;});c.on('exit',code=>{stop();process.exitCode=code??0;});}process.on('SIGINT',stop);process.on('SIGTERM',stop);
