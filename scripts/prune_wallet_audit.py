#!/usr/bin/env python3
"""Remove only exact wallet audit rows proven to exist in a verified COS archive."""
import argparse,gzip,hashlib,json,pathlib,sqlite3,tarfile,tempfile,time,os,sys
from export_daily import clean

class Progress:
    def __init__(self):self.last=0;self.stage=None;self.started=time.monotonic()
    def __call__(self,stage,**values):
        now=time.monotonic()
        if stage!=self.stage or now-self.last>=10 or values.get('done'):
            print(json.dumps({'stage':stage,'elapsedSeconds':round(now-self.started,1),**values},ensure_ascii=False),file=sys.stderr,flush=True)
            self.last=now;self.stage=stage

def stream_hash(stream,progress,stage):
    digest=hashlib.sha256();read=0
    while chunk:=stream.read(1024*1024):
        digest.update(chunk);read+=len(chunk);progress(stage,bytesRead=read)
    return digest.hexdigest()

def archive_manifest(path,progress=lambda *a,**k:None):
    progress('archive_hash');hashes={};manifest=None
    with tarfile.open(path,'r|gz') as tar:
        for member in tar:
            if not member.isfile():continue
            if member.name in hashes:raise ValueError('Duplicate archive member')
            f=tar.extractfile(member)
            if member.name=='manifest.json':
                if member.size>1024*1024:raise ValueError('Manifest too large')
                raw=f.read();manifest=json.loads(raw);hashes[member.name]=hashlib.sha256(raw).hexdigest()
            else:hashes[member.name]=stream_hash(f,progress,'archive_hash')
    if not manifest or not manifest.get('files'):raise ValueError('Missing manifest')
    for item in manifest['files']:
        if hashes.get(item['file'])!=item['sha256']:raise ValueError('Archive member hash mismatch')
    if set(hashes)!={x['file'] for x in manifest['files']}|{'manifest.json'}:raise ValueError('Unexpected archive files')
    return manifest

def verify_cos(path,key,progress=lambda *a,**k:None):
    from qcloud_cos import CosConfig,CosS3Client
    client=CosS3Client(CosConfig(Region='na-siliconvalley',SecretId=os.environ['COS_SECRET_ID'],SecretKey=os.environ['COS_SECRET_KEY'],Token=os.environ.get('COS_SESSION_TOKEN'),Scheme='https'))
    progress('cos_download_hash')
    remote=client.get_object(Bucket='guigu-1403019446',Key=key)['Body'].get_raw_stream()
    try:remote_hash=stream_hash(remote,progress,'cos_download_hash')
    finally:remote.close()
    with path.open('rb') as f:local_hash=stream_hash(f,progress,'local_archive_hash')
    if remote_hash!=local_hash:raise ValueError('COS object differs from local archive')

def prune(db_path,archive,apply=False,cos_key=None,_verify_cos=verify_cos,_progress=None):
    progress=_progress or (lambda *a,**k:None)
    archive=pathlib.Path(archive);manifest=archive_manifest(archive,progress)
    if apply:
        if not cos_key:raise ValueError('--apply requires --cos-key')
        if _verify_cos is verify_cos:_verify_cos(archive,cos_key,progress)
        else:_verify_cos(archive,cos_key)
    start,end=manifest['window']['startMs'],manifest['window']['endMs']
    db_path=pathlib.Path(db_path).resolve();matched=missing=total=deleted=0
    with tempfile.TemporaryDirectory(prefix='audit-prune-',dir=archive.parent) as tmp:
        ids=sqlite3.connect(pathlib.Path(tmp)/'ids.db');ids.execute('CREATE TABLE candidate(seq INTEGER PRIMARY KEY,at INTEGER,digest TEXT)')
        db=sqlite3.connect(db_path.as_uri()+'?mode=ro',uri=True)
        try:
            progress('compare_rows',rows=0,total=manifest['counts']['audit'])
            with tarfile.open(archive,'r|gz') as tar:
                for member in tar:
                    if not member.isfile() or not member.name.startswith('audit/'):continue
                    f=tar.extractfile(member)
                    if member.name.endswith('.gz'):f=gzip.GzipFile(fileobj=f)
                    for line in f:
                        a=json.loads(line);total+=1
                        if total%100==0:progress('compare_rows',rows=total,total=manifest['counts']['audit'],matched=matched,alreadyAbsent=missing)
                        if not start<=a['at']<end:raise ValueError('Audit outside declared window')
                        if a['kind']!='wallet':continue
                        row=db.execute('SELECT at,kind,ca,data FROM audit WHERE seq=?',(a['seq'],)).fetchone()
                        if not row:missing+=1;continue
                        if row[0]!=a['at'] or row[1]!='wallet' or row[2]!=a.get('ca') or clean(json.loads(row[3]))!=a['data']:raise ValueError('Archive does not match database row')
                        ids.execute('INSERT INTO candidate VALUES(?,?,?)',(a['seq'],a['at'],hashlib.sha256(row[3].encode()).hexdigest()));matched+=1
            if total!=manifest['counts']['audit']:raise ValueError('Audit count mismatch')
            ids.commit();progress('compare_rows',rows=total,total=total,matched=matched,alreadyAbsent=missing,done=True)
            if apply:
                db.close();db=sqlite3.connect(db_path,timeout=1)
                cursor=ids.execute('SELECT seq,at,digest FROM candidate ORDER BY seq')
                progress('delete_rows',deleted=0,matched=matched)
                while batch:=cursor.fetchmany(100):
                    try:
                        db.execute('BEGIN IMMEDIATE')
                        for seq,at,digest in batch:
                            row=db.execute("SELECT data FROM audit WHERE seq=? AND at=? AND kind='wallet'",(seq,at)).fetchone()
                            if not row:continue
                            if hashlib.sha256(row[0].encode()).hexdigest()!=digest:raise ValueError('Audit changed since verification')
                            deleted+=db.execute("DELETE FROM audit WHERE seq=? AND at=? AND kind='wallet'",(seq,at)).rowcount
                        db.commit()
                        progress('delete_rows',deleted=deleted,matched=matched)
                    except BaseException:db.rollback();raise
                    time.sleep(.02)
        finally:db.close();ids.close()
    progress('complete',deleted=deleted,matched=matched,dryRun=not apply,done=True)
    return {'matched':matched,'alreadyAbsent':missing,'deleted':deleted,'dryRun':not apply,'note':'Only wallet audit; SQLite pages are reusable, database file is not shrunk. No VACUUM.'}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--archive',required=True);p.add_argument('--cos-key');p.add_argument('--apply',action='store_true');a=p.parse_args()
    print(json.dumps(prune(a.db,a.archive,a.apply,a.cos_key,_progress=Progress()),ensure_ascii=False))
