'use strict';
// Unit test for the Cloudflare Worker using an in-memory KV stub.
// Usage: node tools/test-worker.js

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

class FakeKV {
  constructor() {
    this.map = new Map();
  }
  async get(key, type) {
    const value = this.map.get(key);
    if (value === undefined) return null;
    return type === 'json' ? JSON.parse(value) : value;
  }
  async put(key, value) {
    this.map.set(key, value);
  }
}

const base = 'https://scores.test';

async function call(worker, env, method, url, body) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  return worker.fetch(new Request(base + url, init), env);
}

async function main() {
  const worker = (await import(pathToFileURL(path.join(__dirname, '..', 'server', 'worker.js')).href)).default;
  const env = { SCORES: new FakeKV() };
  let checks = 0;
  const ok = (name, cond, detail) => {
    checks++;
    if (!cond) throw new Error('FAIL ' + name + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
    console.log('PASS ' + name + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
  };

  let res = await worker.fetch(new Request(base + '/health'), env);
  let data = await res.json();
  ok('health responds', res.status === 200 && data.ok === true, data);
  ok('CORS header is present', res.headers.get('Access-Control-Allow-Origin') === '*');

  res = await call(worker, env, 'OPTIONS', '/scores');
  ok('preflight returns 204', res.status === 204);

  res = await call(worker, env, 'POST', '/scores', { name: '   ', score: 100 });
  ok('blank nickname rejected', res.status === 400, await res.json());

  res = await call(worker, env, 'POST', '/scores', { name: 'ace', score: 0 });
  ok('zero score rejected', res.status === 400);

  res = await call(worker, env, 'POST', '/scores', { name: 'ace', score: 1200, sector: 3, bossKills: 1, graze: 40, time: 95 });
  data = await res.json();
  ok('valid score accepted', res.status === 200 && data.ok === true && data.rank === 1, data);

  res = await call(worker, env, 'POST', '/scores', { name: 'nova', score: 3400, sector: 5, bossKills: 2, graze: 60, time: 210 });
  data = await res.json();
  ok('higher score takes rank 1', data.rank === 1, data);

  res = await call(worker, env, 'POST', '/scores', { id: 'dup-1', name: 'ace', score: 900, sector: 2, bossKills: 1, graze: 10, time: 80 });
  ok('first idempotent submission accepted', (await res.json()).rank === 3);
  res = await call(worker, env, 'POST', '/scores', { id: 'dup-1', name: 'ace', score: 900, sector: 2, bossKills: 1, graze: 10, time: 80 });
  ok('same id does not duplicate the entry', (await res.json()).total === 3);

  res = await call(worker, env, 'POST', '/scores', { id: 'dup-1', name: 'ace', score: 5000, sector: 7, bossKills: 3, graze: 90, time: 300 });
  data = await res.json();
  ok('better retry replaces the old entry', data.rank === 1 && data.total === 3, data);

  res = await call(worker, env, 'GET', '/scores?limit=2');
  data = await res.json();
  ok('board returns sorted top entries',
    data.ok === true && data.scores.length === 2 &&
    data.scores[0].score === 5000 && data.scores[1].score === 3400,
    data.scores.map(s => s.score));

  res = await call(worker, env, 'GET', '/scores?limit=999');
  data = await res.json();
  ok('limit is clamped', data.scores.length === 3, data.scores.length);

  res = await call(worker, env, 'GET', '/nope');
  ok('unknown route is 404', res.status === 404);

  res = await call(worker, env, 'POST', '/scores', 'not json');
  ok('invalid JSON rejected', res.status === 400);

  console.log('\nSUMMARY ' + checks + '/' + checks + ' passed');
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
