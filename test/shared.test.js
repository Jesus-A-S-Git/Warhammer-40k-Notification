import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../src/shared/rateLimiter.js';
import { politeFetch, setHostLimit, __setFetch, __reset } from '../src/shared/httpClient.js';

test('RateLimiter spaces requests to the configured rate', async () => {
  let t = 0; const slept = [];
  const rl = new RateLimiter({ requestsPerMinute: 60, burst: 1, now: () => t,
    sleep: async (ms) => { slept.push(ms); t += ms; } });
  const stamps = [];
  await Promise.all([1, 2, 3].map(() => rl.schedule(async () => stamps.push(t))));
  assert.deepEqual(stamps, [0, 1000, 2000]);
});

test('RateLimiter penalize blocks the host', async () => {
  let t = 0;
  const rl = new RateLimiter({ requestsPerMinute: 600, burst: 5, now: () => t, sleep: async (ms) => { t += ms; } });
  rl.penalize(30_000);
  let ran = -1; await rl.schedule(async () => { ran = t; });
  assert.ok(ran >= 30_000);
});

beforeEach(() => { __reset(); process.env.SKIP_ROBOTS = '1'; });

test('politeFetch caches and de-dupes', async () => {
  let calls = 0;
  __setFetch(async () => { calls++; return new Response(JSON.stringify({ ok: 1 }), { status: 200 }); });
  setHostLimit('a.example', { requestsPerMinute: 6000, burst: 10 });
  const [a, b] = await Promise.all([politeFetch('https://a.example/x'), politeFetch('https://a.example/x')]);
  await politeFetch('https://a.example/x');
  assert.deepEqual(a, { ok: 1 }); assert.deepEqual(b, { ok: 1 });
  assert.equal(calls, 1);
});

test('politeFetch retries after 429 with Retry-After', async () => {
  let calls = 0;
  __setFetch(async () => (++calls === 1
    ? new Response('', { status: 429, headers: { 'retry-after': '0' } })
    : new Response('{"v":2}', { status: 200 })));
  setHostLimit('b.example', { requestsPerMinute: 6000, burst: 10 });
  assert.deepEqual(await politeFetch('https://b.example/y'), { v: 2 });
  assert.equal(calls, 2);
});

test('politeFetch refuses http', async () => {
  await assert.rejects(politeFetch('http://c.example/'), /https/);
});
