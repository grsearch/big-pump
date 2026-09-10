import test from 'node:test';
import assert from 'node:assert/strict';
import {collectorApiBase, collectorRequest} from '../lib/collector-client.ts';

test('API base is SSR safe and preserves local SSH tunnel access', () => {
  assert.equal(typeof window, 'undefined');
  assert.equal(collectorApiBase(), '/api');
  for (const host of ['localhost', '127.0.0.1']) assert.equal(collectorApiBase(host), 'http://127.0.0.1:5010/api');
  for (const host of ['dashboard.example.com', '192.0.2.1', 'localhost.example.com']) assert.equal(collectorApiBase(host), '/api');
});

test('remote requests use same origin with authenticated GET and JSON POST', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/rules');
    assert.equal(options.credentials, 'same-origin');
    assert(options.signal instanceof AbortSignal);
    if (options.method === 'POST') {
      assert.equal(options.headers['Content-Type'], 'application/json');
      assert.deepEqual(JSON.parse(options.body), {dailyBudget: 10});
    } else assert.equal(options.body, undefined);
    return Response.json({ok: true});
  });
  assert.deepEqual(await collectorRequest('/rules'), {ok: true});
  assert.deepEqual(await collectorRequest('/rules', {dailyBudget: 10}), {ok: true});
});

test('proxy and backend failures remain errors, not successful data', async t => {
  const replies = [new Response('Unauthorized', {status: 401}), new Response('<html>bad gateway</html>', {status: 502}), Response.json({error: '预算无效'}, {status: 400})];
  t.mock.method(globalThis, 'fetch', async () => replies.shift());
  await assert.rejects(collectorRequest('/dashboard'), /认证失败/);
  await assert.rejects(collectorRequest('/dashboard'), /HTTP 502/);
  await assert.rejects(collectorRequest('/rules', {}), /预算无效/);
});
