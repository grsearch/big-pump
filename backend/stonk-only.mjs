// Remove observation data, retaining only identities needed for historical accounting.
export function removePumpObservations(s) {
  const tokens=s.all('token').filter(t=>t.source!=='stonk'),ids=new Set(tokens.map(t=>t.ca)),held=new Set();
  s.db.exec('BEGIN');
  try {
    for(const run of s.all('shadow-run')) {
      for(const arm of run.arms)for(const p of arm.positions)if(ids.has(p.ca)) {
        if(p.status==='pending'){p.status='cancelled';p.reason='已停止 Pump 监控';}
        if(p.status==='open')held.add(p.ca);
      }
      s.put('shadow-run',run.id,run);
    }
    for(const t of tokens) {
      s.put('token-reference',t.ca,{ca:t.ca,source:'pump',graduatedAt:t.graduatedAt});
      s.db.prepare('DELETE FROM posts WHERE ca=?').run(t.ca);
      for(const kind of ['ai-latest','stonk-candidate'])s.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,t.ca);
      if(held.has(t.ca))s.put('token',t.ca,{...t,hidden:true,status:'archived',reason:'Pump 已退出监控，仅处理旧 Shadow 持仓'});
      else s.db.prepare("DELETE FROM records WHERE kind='token' AND id=?").run(t.ca);
    }
    for(const kind of ['ai-result','event'])for(const record of s.all(kind))if(ids.has(record.ca))
      s.db.prepare('DELETE FROM records WHERE kind=? AND json_extract(data,\'$.ca\')=?').run(kind,record.ca);
    for(const id of ['pump-backfill','migrationCursor'])s.db.prepare("DELETE FROM records WHERE kind='config' AND id=?").run(id);
    s.db.exec('COMMIT');
  } catch(e){s.db.exec('ROLLBACK');throw e;}
  return tokens.length;
}
