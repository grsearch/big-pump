import test from 'node:test';
import assert from 'node:assert/strict';
import {heat} from '../lib/engine.ts';
import {Store} from '../backend/store.mjs';
test('cumulative heat survives five-minute expiry, deduplicates authors and filters spam',()=>{
  const now=1800000000000,post=(id,author,text,at,extra={})=>({id,ca:'c',author,text,at,association:'exact',...extra});
  const posts=[post('1','alice','I read the release notes',now-600000),post('2','alice','The team answered my question',now-1000),post('3','bob','Interesting community discussion',now-2000),post('4','bot','Interesting community discussion',now-500),post('5','other','Unrelated project news',now-500,{association:'ambiguous'}),post('6','future','Not available yet',now+1000)];
  const h=heat(posts,'c',now);assert.equal(h.totalPosts,3);assert.equal(h.totalAuthors,2);assert.equal(h.posts,2);assert.equal(h.totalRaw,5);
  const later=heat(posts.slice(0,5),'c',now+600000);assert.equal(later.posts,0);assert.equal(later.totalPosts,3);
});
test('dashboard cumulative input includes more than the recent-post cap',()=>{
  const s=new Store(':memory:');s.db.exec('BEGIN');for(let i=0;i<5001;i++)s.post({id:String(i),ca:'c',at:i});s.db.exec('COMMIT');
  assert.equal(s.posts('c').length,5000);assert.equal(s.allPosts('c').length,5001);s.close();
});
