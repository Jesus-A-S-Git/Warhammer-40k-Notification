import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../src/shared/rateLimiter.js';
import { politeFetch, setHostLimit, getHostLimit, canonicalHost, __setFetch, __reset } from '../src/shared/httpClient.js';
import { parseRobots, isAllowed } from '../src/shared/robots.js';

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

test('politeFetch rejects cross-host redirects', async () => {
  __setFetch(async () => new Response('', { status: 302, headers: { location: 'https://evil-lookalike.example/x' } }));
  await assert.rejects(politeFetch('https://d.example/x'), /Cross-host redirect/);
});

test('politeFetch follows same-host redirects, each hop rate-limited', async () => {
  const urls = [];
  __setFetch(async (u) => { urls.push(u);
    return u.endsWith('/a') ? new Response('', { status: 301, headers: { location: '/b' } })
      : new Response('{"ok":true}', { status: 200 }); });
  setHostLimit('e.example', { requestsPerMinute: 6000, burst: 10 });
  assert.deepEqual(await politeFetch('https://e.example/a'), { ok: true });
  assert.deepEqual(urls, ['https://e.example/a', 'https://e.example/b']);
});

test('limiter keys are canonical (case / trailing dot share one bucket)', () => {
  assert.equal(canonicalHost('Shop.Example.'), 'shop.example');
  setHostLimit('Shop.Example.', { requestsPerMinute: 3 });
  assert.equal(getHostLimit('https://shop.example/x').requestsPerMinute, 3);
});

test('queue depth is bounded: excess requests fail fast with BUSY', async () => {
  let t = 0;
  const rl = new RateLimiter({ requestsPerMinute: 1, burst: 1, maxQueue: 2, now: () => t, sleep: async (ms) => { t += ms; } });
  const ok = [rl.schedule(async () => 1), rl.schedule(async () => 2)];
  await assert.rejects(rl.schedule(async () => 3), (e) => e.code === 'BUSY');
  assert.deepEqual(await Promise.all(ok), [1, 2]);
});

test('aborted queued request is dropped without consuming a token', async () => {
  let t = 0; let ran = 0;
  const rl = new RateLimiter({ requestsPerMinute: 60, burst: 1, now: () => t, sleep: async (ms) => { t += ms; } });
  const ctrl = new AbortController(); ctrl.abort();
  await assert.rejects(rl.schedule(async () => { ran++; }, ctrl.signal), (e) => e.code === 'ABORTED');
  await rl.schedule(async () => { ran++; });
  assert.equal(ran, 1); assert.equal(t, 0);
});

test('penalize: no burst accumulates during the block', async () => {
  let t = 0; const stamps = [];
  const rl = new RateLimiter({ requestsPerMinute: 60, burst: 5, now: () => t, sleep: async (ms) => { t += ms; } });
  rl.penalize(10_000);
  await Promise.all([1, 2].map(() => rl.schedule(async () => stamps.push(t))));
  assert.ok(stamps[0] >= 11_000 && stamps[1] - stamps[0] >= 1000, String(stamps));
});

test('robots: RFC 9309 wildcards, Allow precedence and grouped agents', () => {
  const rules = parseRobots(
    'User-agent: Googlebot\nUser-agent: *\nDisallow: /*?q=\nDisallow: /search\nAllow: /search/ok$\n', 'Wh40kToolkit');
  assert.equal(isAllowed(rules, '/products?q=x'), false);
  assert.equal(isAllowed(rules, '/search/suggest.json'), false);
  assert.equal(isAllowed(rules, '/search/ok'), true);
  assert.equal(isAllowed(rules, '/collections/all'), true);
  const specific = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: wh40ktoolkit\nAllow: /\n', 'Wh40kToolkit');
  assert.equal(isAllowed(specific, '/x'), true);
});

test('robots: 5xx robots.txt means disallow all', async () => {
  delete process.env.SKIP_ROBOTS;
  __setFetch(async (u) => (u.endsWith('/robots.txt') ? new Response('', { status: 500 }) : new Response('{}')));
  setHostLimit('f.example', { requestsPerMinute: 6000, burst: 10 });
  await assert.rejects(politeFetch('https://f.example/x'), (e) => e.code === 'ROBOTS');
});

test('very long Retry-After fails fast instead of being shortened', async () => {
  __setFetch(async () => new Response('', { status: 429, headers: { 'retry-after': '3600' } }));
  setHostLimit('g.example', { requestsPerMinute: 6000, burst: 10 });
  await assert.rejects(politeFetch('https://g.example/x'), (e) => e.code === 'RATE_LIMITED');
});
