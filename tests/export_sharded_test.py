import pathlib,sqlite3,tempfile,json,tarfile,sys
sys.path.insert(0,str(pathlib.Path('scripts').resolve()))
from export_sharded import export

with tempfile.TemporaryDirectory() as tmp:
    p=pathlib.Path(tmp);path=p/'db';db=sqlite3.connect(path)
    db.executescript('PRAGMA journal_mode=WAL;CREATE TABLE records(kind TEXT,id TEXT,data TEXT);CREATE TABLE audit(seq INTEGER PRIMARY KEY,at INTEGER,kind TEXT,ca TEXT,data TEXT);CREATE TABLE posts(id TEXT,ca TEXT,at INTEGER,data TEXT);CREATE TABLE charges(day TEXT,id TEXT,cost REAL);')
    end=1800000000000
    def insert(i):
        event={'id':str(i),'ca':'c','at':end-1000,'receivedAt':end-500,'side':'buy','usd':10}
        db.execute('INSERT INTO records VALUES(?,?,?)',('flow-trade',str(i),json.dumps(event)))
        db.execute('INSERT INTO audit VALUES(?,?,?,?,?)',(i,end-500,'flow-trade','c',json.dumps(event)));db.commit()
    insert(1)
    archive,manifest=export(path,p/'out',end,_after_snapshot=lambda:insert(2))
    with tarfile.open(archive) as tar:
        a=json.load(tar.extractfile('analysis.json'))
        assert len(a['flowTrades'])==1 and a['flowTrades'][0]['id']=='1'
        assert a['snapshotAuditMaxSeq']==1 and a['consistentSnapshot']
        assert manifest['counts']['audit']==1
    assert not list((p/'out').glob('flow-export-*')) and not (p/'out'/'.export-sharded.lock').exists()
    try:export(path,p/'out',end+1000,_after_snapshot=lambda:(_ for _ in ()).throw(RuntimeError('intentional')))
    except RuntimeError:pass
    else:raise AssertionError('expected failure')
    assert not list((p/'out').glob('flow-export-*')) and not (p/'out'/'.export-sharded.lock').exists()
    db.close()
print('Sharded export: concurrent writer excluded, same snapshot, failure cleanup passed')
