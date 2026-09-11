import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { defaults } from '../lib/engine.ts';
export class Store {
 constructor(path){mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL;CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));CREATE TABLE IF NOT EXISTS posts(id TEXT NOT NULL,ca TEXT NOT NULL,at INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(id,ca));CREATE INDEX IF NOT EXISTS idx_posts_ca_at ON posts(ca,at);CREATE TABLE IF NOT EXISTS charges(day TEXT NOT NULL,id TEXT NOT NULL,cost REAL NOT NULL,PRIMARY KEY(day,id));`);}
 get(kind,id){const row=this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind,id);return row?JSON.parse(row.data):null;}
 all(kind){return this.db.prepare('SELECT data FROM records WHERE kind=?').all(kind).map(r=>JSON.parse(r.data));}
 put(kind,id,data){if(['token','ai-latest'].includes(kind)&&!this.get('token',id)&&this.get('token-reference',id))return data;this.db.prepare('INSERT INTO records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(kind,id,JSON.stringify(data));return data;}
 researchTokens(){return [...new Map([...this.all('token-reference'),...this.all('token')].map(t=>[t.ca,t])).values()];}
 purgeExpired(now=Date.now()){
  const held=new Set(this.all('shadow-run').filter(r=>r.status==='running').flatMap(r=>r.arms.flatMap(a=>a.positions.filter(p=>['pending','open'].includes(p.status)).map(p=>p.ca))));
  const expired=this.all('token').filter(t=>['sleeping','archived'].includes(t.status)&&Number.isFinite(t.graduatedAt)&&now-t.graduatedAt>=86400000);
  this.db.exec('BEGIN');try{for(const t of expired){
   // Compact trade identity preserves wallet cost-basis classification, not the observation entry.
   this.put('token-reference',t.ca,{ca:t.ca,source:t.source??'pump',quoteMint:t.quoteMint,graduatedAt:t.graduatedAt});
   if(held.has(t.ca)){this.put('token',t.ca,{...t,hidden:true,status:'archived',reason:'已退出观察列表，等待 Shadow 清仓'});continue;}
   this.db.prepare('DELETE FROM posts WHERE ca=?').run(t.ca);
   for(const kind of ['token','ai-latest','stonk-candidate'])this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,t.ca);
  }this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}return expired.length;
 }
 allPosts(ca){return this.db.prepare('SELECT data FROM posts WHERE ca=? ORDER BY at ASC').all(ca).map(r=>JSON.parse(r.data));}
 posts(ca){return this.db.prepare('SELECT data FROM posts WHERE ca=? ORDER BY at DESC LIMIT 5000').all(ca).map(r=>JSON.parse(r.data));}
 post(p){if(!this.get('token',p.ca)&&this.get('token-reference',p.ca))return false;return Number(this.db.prepare('INSERT OR IGNORE INTO posts VALUES (?,?,?,?)').run(p.id,p.ca,p.at,JSON.stringify(p)).changes)>0;}
 charge(id,cost,now=Date.now()){return Number(this.db.prepare('INSERT OR IGNORE INTO charges VALUES (?,?,?)').run(new Date(now).toISOString().slice(0,10),id,cost).changes)>0;}
 cost(now=Date.now()){return this.db.prepare('SELECT COALESCE(SUM(cost),0) total FROM charges WHERE day=?').get(new Date(now).toISOString().slice(0,10)).total;}
 rules(){return {...defaults,...this.get('config','rules')};}
 event(type,message,ca=null){this.put('event',`${Date.now()}-${Math.random()}`,{at:Date.now(),type,message,ca});}
 close(){this.db.close();}
}
