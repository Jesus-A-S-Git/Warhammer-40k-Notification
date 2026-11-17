// The static site's in-browser API (public/static-api.js + lib/) must return the
// same shapes and values as the Express server for every Deal Finder endpoint,
// given the same snapshot. Builds the static site into a temp dir, loads
// static-api.js there with a stubbed fetch for data/*, and compares with the
// server reading the same snapshot file. No live network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { __reset } from '../src/shared/httpClient.js';
import { buildDemoSnapshot } from '../src/price/snapshot.js';
import { __resetSnapshotCache } from '../src/price/snapshotStore.js';
import { createApp } from '../src/server.js';
import { BATTLESCRIBE } from './fixtures/army-lists.js';

const run = promisify(execFile);
const dirs = [];
after(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); delete process.env.PRICE_SNAPSHOT; });

// Values that legitimately differ: where the data came from and how old it is "now".
function strip(x) {
  if (Array.isArray(x)) return x.map(strip);
  if (x && typeof x === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(x)) if (!['source', 'ageHours', 'freshness'].includes(k)) o[k] = strip(v);
    return o;
  }
  return x;
}

test('static-api returns the same payloads as the server for overview, product, faction, cart, army, feed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'parity-'));
  dirs.push(dir);
  // A demo snapshot with a blocked store and a carried offer, written where both sides read it.
  const snap = buildDemoSnapshot({ now: Date.now() - 3_600_000 });
  snap.offers[0] = { ...snap.offers[0], carried: true };
  const snapFile = path.join(dir, 'data', 'prices.json');
  await mkdir(path.dirname(snapFile), { recursive: true });
  await writeFile(snapFile, JSON.stringify(snap));
  await run(process.execPath, ['scripts/build-static.js', dir]);
  const feedFile = await readFile(path.join(dir, 'data', 'deals.xml'), 'utf8');
  assert.match(feedFile, /<rss version="2.0"/);
  assert.match(feedFile, /SAMPLE DATA/);

  // ---- server ----
  __reset(); __resetSnapshotCache();
  process.env.PRICE_SNAPSHOT = snapFile;
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const requests = [
    ['GET', '/api/prices/overview'],
    ['GET', '/api/prices/product/space-marines-intercessors'],
    ['GET', '/api/prices/product/necrons-immortals'],
    ['GET', '/api/prices/product/nope'],
    ['GET', '/api/prices/faction/necrons'],
    ['GET', '/api/prices/faction/nope'],
    ['POST', '/api/prices/cart', { items: [{ id: 'combat-patrol-orks' }, { id: 'ork-boyz', qty: 2 }] }],
    ['POST', '/api/prices/army', { list: BATTLESCRIBE, owned: { 'necron-warriors': 1 } }],
    ['POST', '/api/prices/army', { list: '' }],
  ];
  const serverOut = [];
  try {
    for (const [method, p, body] of requests) {
      const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      serverOut.push([r.status, await r.json()]);
    }
  } finally { await new Promise((r) => server.close(r)); }
  const serverFeed = await (async () => {
    const s = createApp().listen(0);
    await new Promise((r) => s.once('listening', r));
    try { return await (await fetch(`http://127.0.0.1:${s.address().port}/api/prices/feed.xml`)).text(); } finally { await new Promise((r) => s.close(r)); }
  })();

  // ---- static (as the browser would run it) ----
  const realFetch = globalThis.fetch;
  globalThis.location = { href: 'https://example.github.io/site/prices.html' };
  globalThis.fetch = async (u) => {
    const rel = String(u);
    if (rel === 'data/prices.json' || rel === 'data/deals.xml') {
      const text = await readFile(path.join(dir, rel), 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
    }
    throw new Error(`static site fetched ${rel}`);
  };
  try {
    const { staticFetch } = await import(pathToFileURL(path.join(dir, 'static-api.js')));
    for (const [i, [method, p, body]] of requests.entries()) {
      const r = await staticFetch(p, { method, body: body ? JSON.stringify(body) : undefined });
      const [status, json] = serverOut[i];
      assert.equal(r.status, status, `${method} ${p} status`);
      assert.deepEqual(strip(await r.json()), strip(json), `${method} ${p} payload`);
    }
    const feed = await staticFetch('/api/prices/feed.xml');
    assert.equal(feed.status, 200);
    // Same items; only the links to the site itself differ.
    const items = (x) => x.split('<item>').slice(1).join('<item>');
    assert.equal(items(await feed.text()), items(serverFeed));
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.location;
  }
});
