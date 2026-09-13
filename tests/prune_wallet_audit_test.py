import sys,pathlib,tempfile,sqlite3,json
sys.path.insert(0,str(pathlib.Path('scripts').resolve()))
from export_sharded import export
from prune_wallet_audit import prune
with tempfile.TemporaryDirectory() as tmp:
    p=pathlib.Path(tmp);db=sqlite3.connect(p/'db')
    db.executescript('CREATE TABLE records(kind TEXT,id TEXT,data TEXT);CREATE TABLE audit(seq INTEGER PRIMARY KEY,at INTEGER,kind TEXT,ca TEXT,data TEXT);CREATE TABLE posts(id TEXT,ca TEXT,at INTEGER,data TEXT);CREATE TABLE charges(day TEXT,id TEXT,cost REAL);')
    end=1800000000000
    for seq,kind in [(1,'wallet'),(2,'live-position')]:db.execute('INSERT INTO audit VALUES(?,?,?,?,?)',(seq,end-1000,kind,None,json.dumps({'id':'w','profit':1})))
    db.execute('INSERT INTO records VALUES(?,?,?)',('wallet','w',json.dumps({'positions':[{'cost':1}]})));db.commit()
    archive,_=export(p/'db',p/'out',end)
    assert prune(p/'db',archive)['matched']==1
    assert db.execute('SELECT count(*) FROM audit').fetchone()[0]==2
    try:prune(p/'db',archive,True)
    except ValueError:pass
    else:raise AssertionError('COS verification required')
    def fail(*args):raise ValueError('remote mismatch')
    try:prune(p/'db',archive,True,'key',fail)
    except ValueError:pass
    else:raise AssertionError('remote mismatch must block deletion')
    assert db.execute('SELECT count(*) FROM audit').fetchone()[0]==2
    stages=[]
    result=prune(p/'db',archive,True,'key',lambda *args:None,_progress=lambda stage,**values:stages.append((stage,values)))
    assert stages[-1][0]=='complete' and stages[-1][1]['deleted']==1
    assert any(stage=='compare_rows' for stage,values in stages)
    assert result['deleted']==1
    assert db.execute('SELECT kind FROM audit').fetchone()[0]=='live-position'
    assert db.execute('SELECT count(*) FROM records').fetchone()[0]==1
    assert prune(p/'db',archive)['alreadyAbsent']==1
    db.close()
print('Archive-gated pruning: dry run, remote mismatch, scoped delete and idempotence passed')
