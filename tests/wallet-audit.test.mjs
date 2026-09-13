import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../backend/store.mjs';
test('wallet audit ignores clock-only updates and never copies position histories',()=>{
 const s=new Store(':memory:'),w={address:'w',status:'watch',profit:1,positions:[{ca:'c',cost:9}],bigWins:[],updatedAt:1,walletAgeDays:31};
 try{s.put('wallet','w',w);s.put('wallet','w',{...w,updatedAt:2,walletAgeDays:31.01});assert.equal(s.db.prepare("SELECT count(*) n FROM audit WHERE kind='wallet'").get().n,1);
 s.put('wallet','w',{...w,status:'verified',verifiedAt:3});const rows=s.db.prepare("SELECT data FROM audit WHERE kind='wallet'").all();assert.equal(rows.length,2);assert.equal(JSON.parse(rows[1].data).verifiedAt,3);assert(!rows[1].data.includes('positions'));assert.equal(s.get('wallet','w').positions[0].cost,9);
 }finally{s.close();}
});
