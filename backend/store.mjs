import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {inResearchWindow} from '../lib/monitor-window.ts';
import {redact,tokenStreams} from './audit.mjs';
import { defaults } from '../lib/engine.ts';
export class Store {
 constructor(path){mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA busy_timeout=25;CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));CREATE TABLE IF NOT EXISTS posts(id TEXT NOT NULL,ca TEXT NOT NULL,at INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(id,ca));CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,kind TEXT NOT NULL,ca TEXT,data TEXT NOT NULL);CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at);CREATE INDEX IF NOT EXISTS idx_posts_ca_at ON posts(ca,at);CREATE INDEX IF NOT EXISTS idx_live_status ON records(kind,json_extract(data,'$.status')) WHERE kind IN ('live-order','live-position');CREATE INDEX IF NOT EXISTS idx_token_graduated ON records(json_extract(data,'$.graduatedAt')) WHERE kind='token';CREATE INDEX IF NOT EXISTS idx_live_signal_graduated ON records(json_extract(data,'$.graduatedAt')) WHERE kind='live-signal';CREATE INDEX IF NOT EXISTS idx_flow_ca_at ON records(json_extract(data,'$.ca'),json_extract(data,'$.at')) WHERE kind='flow-trade';CREATE TABLE IF NOT EXISTS charges(day TEXT NOT NULL,id TEXT NOT NULL,cost REAL NOT NULL,PRIMARY KEY(day,id));`);}
 get(kind,id){const row=this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind,id);return row?JSON.parse(row.data):null;}
 has(kind,id){return !!this.db.prepare('SELECT 1 FROM records WHERE kind=? AND id=?').get(kind,id);}
 all(kind){return this.db.prepare('SELECT data FROM records WHERE kind=?').all(kind).map(r=>JSON.parse(r.data));}
 // Project in SQLite: never parse large observation histories for list views.
 summaries(kind){return this.db.prepare("SELECT json_remove(data,'$.history','$.xObservations','$.execution','$.positions') AS data FROM records WHERE kind=?").all(kind).map(r=>JSON.parse(r.data));}
 identities(kind){return this.db.prepare("SELECT json_object('ca',json_extract(data,'$.ca'),'symbol',json_extract(data,'$.symbol'),'name',json_extract(data,'$.name')) AS data FROM records WHERE kind=?").all(kind).map(r=>JSON.parse(r.data));}
 recentEvents(){return this.db.prepare("SELECT data FROM records WHERE kind='event' ORDER BY json_extract(data,'$.at') DESC LIMIT 60").all().map(r=>JSON.parse(r.data));}
 statusRows(kind,status){return this.db.prepare("SELECT data FROM records WHERE kind IN ('live-order','live-position') AND kind=? AND json_extract(data,'$.status')=?").all(kind,status).map(r=>JSON.parse(r.data));}
 entryTokens(from,to){return this.db.prepare("SELECT json_remove(data,'$.history','$.xObservations','$.execution') AS data FROM records WHERE kind='token' AND json_extract(data,'$.graduatedAt')>=? AND json_extract(data,'$.graduatedAt')<=?").all(from,to).map(r=>JSON.parse(r.data));}
 entrySignals(from,to){return this.db.prepare("SELECT data FROM records WHERE kind='live-signal' AND json_extract(data,'$.graduatedAt')>=? AND json_extract(data,'$.graduatedAt')<=?").all(from,to).map(r=>JSON.parse(r.data));}
 audit(kind,ca,data,at=Date.now()){this.db.prepare('INSERT INTO audit(at,kind,ca,data) VALUES(?,?,?,?)').run(at,kind,ca??null,JSON.stringify(redact(data)));}
 put(kind,id,data){const prior=this.get(kind,id);if(kind==='token'&&data){const before=prior?tokenStreams(prior):{};for(const [stream,value] of Object.entries(tokenStreams(data)))if(JSON.stringify(value)!==JSON.stringify(before[stream]))this.audit(stream,id,value);}else if(['live-order','live-position','event','ai-result','wallet','coverage'].includes(kind)&&JSON.stringify(prior)!==JSON.stringify(data))this.audit(kind,data?.ca??null,{id,...data});if(['token','ai-latest'].includes(kind)&&!this.get('token',id)&&this.get('token-reference',id))return data;this.db.prepare('INSERT INTO records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(kind,id,JSON.stringify(data));return data;}
 researchTokens(){return [...new Map([...this.all('history-reference'),...this.all('token-reference'),...this.all('token')].map(t=>[t.ca,t])).values()];}
 purgeExpired(now=Date.now()){
  const held=new Set(this.all('shadow-run').filter(r=>r.status==='running').flatMap(r=>r.arms.flatMap(a=>a.positions.filter(p=>['pending','open'].includes(p.status)).map(p=>p.ca))));
  const expired=this.all('token').filter(t=>!inResearchWindow(t,now)&&['sleeping','archived'].includes(t.status)&&Number.isFinite(t.graduatedAt)&&now-t.graduatedAt>=86400000);
  this.db.exec('BEGIN');try{for(const t of expired){
   // Compact trade identity preserves wallet cost-basis classification, not the observation entry.
   this.put('token-reference',t.ca,{ca:t.ca,symbol:t.symbol,name:t.name,source:t.source??'pump',quoteMint:t.quoteMint,quoteSymbol:t.quoteSymbol,graduatedAt:t.graduatedAt});
   if(held.has(t.ca)){this.put('token',t.ca,{...t,hidden:true,status:'archived',reason:'已退出观察列表，等待 Shadow 清仓'});continue;}
   this.db.prepare('DELETE FROM posts WHERE ca=?').run(t.ca);
   for(const kind of ['token','ai-latest','stonk-candidate'])this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,t.ca);
  }this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}return expired.length;
 }
 allPosts(ca){return this.db.prepare('SELECT data FROM posts WHERE ca=? ORDER BY at ASC').all(ca).map(r=>JSON.parse(r.data));}
 posts(ca){return this.db.prepare('SELECT data FROM posts WHERE ca=? ORDER BY at DESC LIMIT 5000').all(ca).map(r=>JSON.parse(r.data));}
 post(p){if(!this.get('token',p.ca)&&this.get('token-reference',p.ca))return false;const inserted=Number(this.db.prepare('INSERT OR IGNORE INTO posts VALUES (?,?,?,?)').run(p.id,p.ca,p.at,JSON.stringify(p)).changes)>0;if(inserted)this.audit('post',p.ca,p);return inserted;}
 charge(id,cost,now=Date.now()){return Number(this.db.prepare('INSERT OR IGNORE INTO charges VALUES (?,?,?)').run(new Date(now).toISOString().slice(0,10),id,cost).changes)>0;}
 cost(now=Date.now()){return this.db.prepare('SELECT COALESCE(SUM(cost),0) total FROM charges WHERE day=?').get(new Date(now).toISOString().slice(0,10)).total;}
 rules(){return {...defaults,...this.get('config','rules')};}
 event(type,message,ca=null){this.put('event',`${Date.now()}-${Math.random()}`,{at:Date.now(),type,message,ca});}
 close(){this.db.close();}
}
