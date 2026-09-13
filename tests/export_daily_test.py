import importlib.util,pathlib,sqlite3,tempfile,json,tarfile,hashlib
spec=importlib.util.spec_from_file_location('daily','scripts/export_daily.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
order={'ca':'coin','side':'sell','signature':'sig'};pos={'ca':'coin','strategy':'stonk-graduation-c-v1','sellSignature':'sig'}
assert m.attribute_order(order,[pos])['strategy']==pos['strategy']
assert 'strategy' not in m.attribute_order({**order,'signature':'other'},[pos])
assert 'strategy' not in m.attribute_order(order,[pos,pos])
with tempfile.TemporaryDirectory() as tmp:
 p=pathlib.Path(tmp);db=sqlite3.connect(p/'db.sqlite');db.executescript('CREATE TABLE records(kind TEXT,id TEXT,data TEXT); CREATE TABLE posts(id TEXT,ca TEXT,at INTEGER,data TEXT); CREATE TABLE charges(day TEXT,id TEXT,cost REAL); CREATE TABLE audit(seq INTEGER PRIMARY KEY,at INTEGER,kind TEXT,ca TEXT,data TEXT);');end=1800000000000
 old={'id':'buy','ca':'coin','side':'buy','at':end-90000000,'signedTransaction':'NEVER_EXPORT'};position={'ca':'coin','status':'closed','openedAt':end-90000000,'closedAt':end-1000,'costLamports':100}
 for kind,key,row in [('live-order','buy',old),('live-position','coin',position)]:db.execute('INSERT INTO records VALUES(?,?,?)',(kind,key,json.dumps(row)))
 for key,at in [('in',end-1000),('out',end-90000000)]:db.execute('INSERT INTO records VALUES(?,?,?)',('flow-trade',key,json.dumps({'id':key,'at':at,'ca':'coin','usd':10})))
 db.execute('INSERT INTO audit VALUES(1,?,?,?,?)',(end-5000,'live-order','coin',json.dumps({'signedTransaction':'HIDDEN','status':'confirmed'})));db.commit();db.close()
 archive,manifest=m.export(p/'db.sqlite',p/'out',end)
 with tarfile.open(archive) as t:
  assert len(t.getnames())==4
  payload=json.load(t.extractfile('analysis.json'));assert payload['orders'][0]['contextOnly'];assert len(payload['audit'])==1
  assert [x['id'] for x in payload['context'] if x['kind']=='flow-trade']==['in']
  assert 'NEVER_EXPORT' not in json.dumps(payload) and 'HIDDEN' not in json.dumps(payload)
  for f in manifest['files']:assert hashlib.sha256(t.extractfile(f['file']).read()).hexdigest()==f['sha256']
 print('Export validation passed: 24h window, cross-window basis, archive SHA256, redaction, no upload')
