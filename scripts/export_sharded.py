#!/usr/bin/env python3
"""Bounded-row export from one SQLite backup; no production writes or service control."""
import argparse,csv,datetime as dt,gzip,hashlib,json,os,pathlib,shutil,sqlite3,tarfile,tempfile
from export_daily import clean,upload,TZ,attribute_order

def _export(db_path,out,end,start=None,_after_snapshot=None):
    start=end-86400000 if start is None else start
    if start>=end:raise ValueError('start must precede end')
    out=pathlib.Path(out);out.mkdir(parents=True,exist_ok=True)
    db_path=pathlib.Path(db_path).resolve()
    # Snapshot plus staging/archive headroom; never silently consume the last free bytes.
    needed=4*(db_path.stat().st_size+(pathlib.Path(str(db_path)+'-wal').stat().st_size if pathlib.Path(str(db_path)+'-wal').exists() else 0))+512*1024**2
    if shutil.disk_usage(out).free<needed:raise RuntimeError('Insufficient space for consistent snapshot and archive')
    name=dt.datetime.fromtimestamp(end/1000,TZ).strftime('%Y-%m-%d-%H%M%S')
    archive=out/(name+'.tar.gz')
    if archive.exists():raise FileExistsError(archive)
    with tempfile.TemporaryDirectory(prefix='flow-export-',dir=out) as tmp:
        temp=pathlib.Path(tmp);root=temp/'payload';root.mkdir();(root/'audit').mkdir()
        src=sqlite3.connect(db_path.as_uri()+'?mode=ro',uri=True);snap=sqlite3.connect(temp/'snapshot.db')
        try:
            src.execute('BEGIN')
            high=src.execute('SELECT COALESCE(MAX(seq),0) FROM audit').fetchone()[0]
            snapshot_at=int(dt.datetime.now(dt.timezone.utc).timestamp()*1000)
            src.backup(snap,pages=1024)
        except BaseException:
            snap.close();raise
        finally:src.close()
        try:
            if _after_snapshot:_after_snapshot()
            def records(kind):
                for (data,) in snap.execute('SELECT data FROM records WHERE kind=?',(kind,)):yield clean(json.loads(data))
            positions=[p for p in records('live-position') if (p.get('status')=='open' and p.get('openedAt',0)<end) or start<=p.get('closedAt',0)<end or start<=p.get('openedAt',0)<end]
            times=['at','firstAttemptAt','broadcastAt','confirmedAt','reconciledAt']
            orders=[d for d in records('live-order') if any(isinstance(d.get(k),(int,float)) and start<=d[k]<end for k in times)]
            cas={d.get('ca') for d in positions+orders};ids={d.get('id') for d in orders}
            orders += [{**d,'contextOnly':True} for d in records('live-order') if d.get('ca') in cas and d.get('id') not in ids]
            orders=[attribute_order(d,positions) for d in orders]
            def flow():
                for d in records('flow-trade'):
                    if start<=d.get('at',0)<end:yield d
            def context():
                kinds=['token','token-reference','stonk-creation','wallet','coverage','ai-result','event','shadow-run','history-reference','config']
                for k in kinds:
                    for i,data in snap.execute('SELECT id,data FROM records WHERE kind=?',(k,)):
                        if k=='config' and i not in ['rules','live-trading']:continue
                        yield {'kind':k,'id':i,'data':clean(json.loads(data))}
            def csv_file(name,rows,fields=None):
                if fields is None:fields=sorted({k for r in rows for k in r})
                count=0
                with (root/name).open('w',encoding='utf-8-sig',newline='') as f:
                    writer=csv.DictWriter(f,fieldnames=fields,extrasaction='raise');writer.writeheader()
                    for r in rows:writer.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else v for k,v in r.items()});count+=1
                return count
            csv_file('live_orders.csv',orders);csv_file('live_positions.csv',positions)
            fields=sorted({k for r in flow() for k in r})
            flow_count=csv_file('flow_trades.csv',flow(),fields)
            audits=0;shards=[];f=None;hour=None
            try:
                for seq,at,k,ca,data in snap.execute('SELECT seq,at,kind,ca,data FROM audit WHERE at>=? AND at<? AND seq<=? ORDER BY at,seq',(start,end,high)):
                    group=dt.datetime.fromtimestamp(at/1000,TZ).strftime('%Y%m%d-%H00')
                    if group!=hour:
                        if f:f.close()
                        hour=group;path='audit/'+group+'.jsonl.gz';f=gzip.open(root/path,'wt',encoding='utf8');shards.append({'file':path,'rows':0})
                    f.write(json.dumps({'seq':seq,'at':at,'kind':k,'ca':ca,'data':clean(json.loads(data))},ensure_ascii=False)+'\n');audits+=1;shards[-1]['rows']+=1
            finally:
                if f:f.close()
            window={'startMs':start,'endMs':end,'bounds':'[start,end)','startBeijing':dt.datetime.fromtimestamp(start/1000,TZ).isoformat(),'endBeijing':dt.datetime.fromtimestamp(end/1000,TZ).isoformat()}
            counts={'orders':len(orders),'positions':len(positions),'flowTrades':flow_count,'audit':audits}
            metadata={'snapshotAtMs':snapshot_at,'snapshotAuditMaxSeq':high,'consistentSnapshot':True,'window':window,'auditSummary':{'rows':audits,'shards':len(shards)},'notes':['All tables and audit share one SQLite snapshot. Context is snapshot state, not historical end state.','Flow may include backfilled earlier trades; completeness is not guaranteed. Use receivedAt and holderCheckedAt for point-in-time research.','Audit filtered by audit time, flowTrades by trade time; differing counts can be valid even with a consistent snapshot.','Missing trades, FX and holder evidence are unknown, not zero.']}
            with (root/'analysis.json').open('w',encoding='utf8') as f:
                f.write(json.dumps(metadata,ensure_ascii=False)[:-1])
                def array(key,rows):
                    f.write(','+json.dumps(key)+':[');n=0
                    for row in rows:
                        if n:f.write(',')
                        f.write(json.dumps(row,ensure_ascii=False));n+=1
                    f.write(']');return n
                array('orders',orders);array('positions',positions);array('flowTrades',flow());counts['flowScans']=array('flowScans',records('flow-scan'));array('context',context())
                counts['posts']=array('posts',(clean(json.loads(d)) for (d,) in snap.execute('SELECT data FROM posts WHERE at>=? AND at<?',(start,end))))
                array('chargesUtcDays',({'day':day,'id':i,'cost':cost} for day,i,cost in snap.execute('SELECT day,id,cost FROM charges WHERE day>=? AND day<=?',(dt.datetime.fromtimestamp(start/1000,dt.timezone.utc).date().isoformat(),dt.datetime.fromtimestamp(end/1000,dt.timezone.utc).date().isoformat()))))
                f.write('}')
        finally:snap.close()
        files=[]
        for path in sorted(root.rglob('*')):
            if path.is_file():
                with path.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
                files.append({'file':path.relative_to(root).as_posix(),'bytes':path.stat().st_size,'sha256':digest})
        manifest={'window':window,'snapshotAtMs':snapshot_at,'snapshotAuditMaxSeq':high,'consistentSnapshot':True,'counts':counts,'files':files}
        (root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
        staged=temp/'complete.tar.gz'
        with tarfile.open(staged,'w:gz') as tar:
            for path in sorted(root.rglob('*')):
                if path.is_file():tar.add(path,arcname=path.relative_to(root).as_posix())
        os.replace(staged,archive)
    return archive,manifest

def export(db_path,out,end,start=None,_after_snapshot=None):
    out=pathlib.Path(out);out.mkdir(parents=True,exist_ok=True)
    lock=out/'.export-sharded.lock'
    try:fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    except FileExistsError:raise RuntimeError('Another export holds the lock; check that process before removing a stale lock')
    try:
        os.write(fd,str(os.getpid()).encode());os.close(fd)
        return _export(db_path,out,end,start,_after_snapshot)
    finally:lock.unlink(missing_ok=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--db',default='data/pump.db');p.add_argument('--out',default='exports/daily');p.add_argument('--start-ms',type=int);p.add_argument('--end-ms',type=int);p.add_argument('--upload',action='store_true');args=p.parse_args()
    now=dt.datetime.now(TZ);end=now.replace(hour=6,minute=0,second=0,microsecond=0)
    if now<end:end-=dt.timedelta(days=1)
    archive,manifest=export(args.db,args.out,args.end_ms or int(end.timestamp()*1000),args.start_ms)
    print(json.dumps({'archive':str(archive),'counts':manifest['counts'],'upload':upload(archive) if args.upload else 'not requested'},ensure_ascii=False))
