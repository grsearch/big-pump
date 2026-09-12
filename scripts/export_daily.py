#!/usr/bin/env python3
"""Read-only consistent daily export. No transaction signing or collector controls."""
import argparse,csv,datetime as dt,gzip,hashlib,json,os,pathlib,re,sqlite3,tarfile,tempfile
TZ=dt.timezone(dt.timedelta(hours=8))
BAD=re.compile(r'signedTransaction|secret|private.?key|mnemonic|bearer|authorization|api.?key',re.I)
def clean(v):
    if isinstance(v,dict): return {k:clean(x) for k,x in v.items() if not BAD.search(k)}
    if isinstance(v,list): return [clean(x) for x in v]
    if isinstance(v,str): return re.sub(r'([?&](?:api-key|token|key)=)[^&\s]+',r'\1[redacted]',re.sub(r'Bearer\s+\S+','Bearer [redacted]',v,flags=re.I),flags=re.I)
    return v

def attribute_order(order,positions):
    if order.get('strategy') or order.get('side') not in ['buy','sell']:return order
    key='buySignature' if order.get('side')=='buy' else 'sellSignature'
    matches=[p for p in positions if order.get('signature') and p.get('ca')==order.get('ca') and p.get(key)==order['signature']]
    if len(matches)==1 and matches[0].get('strategy'):
        return {**order,'strategy':matches[0]['strategy'],'strategyEvidence':'对应持仓的成交签名匹配'}
    return order

def export(db_path,out,end):
    start=end-86400000
    root=pathlib.Path(out)/dt.datetime.fromtimestamp(end/1000,TZ).strftime('%Y-%m-%d-%H%M%S');root.mkdir(parents=True,exist_ok=True)
    # sqlite backup includes committed WAL pages and does not stop the running writer.
    with tempfile.TemporaryDirectory() as tmp:
        src=sqlite3.connect(pathlib.Path(db_path).resolve().as_uri()+'?mode=ro',uri=True)
        snap=sqlite3.connect(str(pathlib.Path(tmp)/'snapshot.db'));src.backup(snap);src.close()
        rows=[(k,i,clean(json.loads(d))) for k,i,d in snap.execute('SELECT kind,id,data FROM records')]
        all_positions=[d for k,i,d in rows if k=='live-position']
        rows=[(k,i,attribute_order(d,all_positions) if k=='live-order' else d) for k,i,d in rows]
        orders=[d for k,i,d in rows if k=='live-order' and any(isinstance(d.get(t),(int,float)) and start<=d[t]<end for t in ['at','firstAttemptAt','broadcastAt','confirmedAt','reconciledAt'])]
        positions=[d for k,i,d in rows if k=='live-position' and ((d.get('status')=='open' and d.get('openedAt',0)<end) or start<=d.get('closedAt',0)<end or start<=d.get('openedAt',0)<end)]
        cas={d.get('ca') for d in orders+positions}
        # Old buys supply cost basis for exits in this window.
        ids={d.get('id') for d in orders}
        orders += [{**d,'contextOnly':True} for k,i,d in rows if k=='live-order' and d.get('ca') in cas and d.get('id') not in ids]
        context=[{'kind':k,'id':i,'data':d} for k,i,d in rows if k in ['token','token-reference','stonk-creation','wallet','coverage','ai-result','event','shadow-run','history-reference','config'] and (k not in ['config'] or i in ['rules','live-trading'])]
        audit=[]
        if snap.execute("SELECT name FROM sqlite_master WHERE name='audit'").fetchone():
            audit=[{'seq':seq,'at':at,'kind':k,'ca':ca,'data':clean(json.loads(d))} for seq,at,k,ca,d in snap.execute('SELECT seq,at,kind,ca,data FROM audit WHERE at>=? AND at<? ORDER BY seq',(start,end))]
        posts=[clean(json.loads(d)) for (d,) in snap.execute('SELECT data FROM posts WHERE at>=? AND at<?',(start,end))]
        charges=[{'day':day,'id':i,'cost':c} for day,i,c in snap.execute('SELECT day,id,cost FROM charges WHERE day>=? AND day<=?',(dt.datetime.fromtimestamp(start/1000,dt.timezone.utc).date().isoformat(),dt.datetime.fromtimestamp(end/1000,dt.timezone.utc).date().isoformat()))]
        snap.close()
    payload={'snapshotAtMs':int(dt.datetime.now(dt.timezone.utc).timestamp()*1000),'window':{'startMs':start,'endMs':end,'startBeijing':dt.datetime.fromtimestamp(start/1000,TZ).isoformat(),'endBeijing':dt.datetime.fromtimestamp(end/1000,TZ).isoformat(),'bounds':'[start,end)'},'orders':orders,'positions':positions,'audit':audit,'context':context,'posts':posts,'chargesUtcDays':charges,'notes':['Context and open position marks are snapshot state, not reconstructed end-boundary state.','Historical Shadow runs retained as archives; no new Shadow strategy.','Audit begins at upgrade; missing observations are not zero.','Charges have UTC-day resolution and may straddle the requested window.','Raw database and signing payloads are never exported.']}
    (root/'analysis.json').write_text(json.dumps(clean(payload),ensure_ascii=False),encoding='utf-8')
    for name,data in [('live_orders',orders),('live_positions',positions)]:
        fields=sorted({key for row in data for key in row})
        with (root/(name+'.csv')).open('w',newline='',encoding='utf-8-sig') as f:
            w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
            for row in data:w.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else v for k,v in row.items()})
    manifest={'window':payload['window'],'bucket':'guigu-1403019446','region':'na-siliconvalley','counts':{'orders':len(orders),'positions':len(positions),'audit':len(audit),'posts':len(posts)},'files':[]}
    for path in sorted(root.iterdir()):
        if path.name in ['analysis.json','live_orders.csv','live_positions.csv']:manifest['files'].append({'file':path.name,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    (root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    archive=root.with_suffix('.tar.gz')
    with tarfile.open(archive,'w:gz') as tar:
        for name in ['analysis.json','live_orders.csv','live_positions.csv','manifest.json']:tar.add(root/name,arcname=name)
    return archive,manifest

def upload(archive):
    from qcloud_cos import CosConfig,CosS3Client
    config=CosConfig(Region='na-siliconvalley',SecretId=os.environ['COS_SECRET_ID'],SecretKey=os.environ['COS_SECRET_KEY'],Token=os.environ.get('COS_SESSION_TOKEN'),Scheme='https')
    client=CosS3Client(config);bucket='guigu-1403019446';key='big-pump/daily/'+archive.name
    client.upload_file(Bucket=bucket,Key=key,LocalFilePath=str(archive),ACL='private',EnableMD5=True)
    # Verify uploaded bytes, including multipart uploads whose ETag is not MD5.
    remote=client.get_object(Bucket=bucket,Key=key)['Body'].get_raw_stream()
    digest=hashlib.sha256()
    while True:
        chunk=remote.read(1024*1024)
        if not chunk:break
        digest.update(chunk)
    remote.close()
    if digest.hexdigest()!=hashlib.sha256(archive.read_bytes()).hexdigest():raise RuntimeError('COS verification failed')
    return {'bucket':bucket,'region':'na-siliconvalley','key':key,'sha256':digest.hexdigest()}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--db',default=str(pathlib.Path(os.environ.get('DATA_DIR','data'))/'pump.db'));p.add_argument('--out',default='exports/daily');p.add_argument('--end-ms',type=int);p.add_argument('--upload',action='store_true');args=p.parse_args()
    now=dt.datetime.now(TZ);boundary=now.replace(hour=6,minute=0,second=0,microsecond=0)
    if now<boundary:boundary-=dt.timedelta(days=1)
    archive,manifest=export(args.db,args.out,args.end_ms or int(boundary.timestamp()*1000))
    print(json.dumps({'archive':str(archive),'counts':manifest['counts'],'upload':upload(archive) if args.upload else 'not requested'},ensure_ascii=False))
