// In-browser stand-in for the Express API, used by the static GitHub Pages build.
// It runs the exact same validation, dice engine and trust filtering as the server
// (modules copied into ./lib by scripts/build-static.js).
//
//   combat: computed locally, no network at all
//   prices: ranked locally from data/prices.json, a snapshot that a scheduled
//           GitHub Action refreshes through the rate-limited live pipeline.
//           Visitors never contact retailers, so no per-visitor rate limits are needed.
import { ALL_UNITS as UNITS, DATA_SOURCES } from './lib/combat/data/catalog.js';
import { BadRequest, listUnits, listFactions, unitById, runSimulation, RULES_VERSION } from './lib/combat/service.js';
import { rankOffers, retailersInfo, suggestionsPayload } from './lib/price/rank.js';
import { checkOffer } from './lib/price/trust.js';

let snapshotPromise;
export function loadSnapshot() {
  snapshotPromise ??= fetch('data/prices.json', { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(`Could not load price snapshot (${r.status})`);
    return r.json();
  });
  return snapshotPromise;
}

const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });

async function route(method, url, body) {
  const p = url.pathname.replace(/^.*\/api\//, '/api/');
  if (method === 'GET' && p === '/api/combat/units') {
    return reply(200, { units: listUnits(UNITS, url.searchParams.get('q') ?? '', url.searchParams.get('faction') ?? '',
      { view: url.searchParams.get('view') === 'brief' ? 'brief' : 'full' }),
      source: { source: 'catalog', mode: 'static', units: UNITS.length } });
  }
  if (method === 'GET' && p === '/api/combat/factions') {
    return reply(200, { factions: listFactions(UNITS), sources: DATA_SOURCES, source: { source: 'catalog', mode: 'static', units: UNITS.length } });
  }
  if (method === 'GET' && p.startsWith('/api/combat/units/')) {
    const id = decodeURIComponent(p.slice('/api/combat/units/'.length));
    let u = null;
    try { u = unitById(id, UNITS); } catch { /* not found */ }
    return u ? reply(200, { unit: u }) : reply(404, { error: `Unknown unit "${id}"` });
  }
  if (method === 'POST' && p === '/api/combat/simulate') {
    try {
      // Yield a frame so the "Calculating…" state can paint before heavy maths.
      await new Promise((r) => setTimeout(r, 0));
      return reply(200, runSimulation(body, UNITS));
    } catch (err) {
      return reply(err instanceof BadRequest ? 400 : 500, { error: err.message });
    }
  }
  if (method === 'GET' && p === '/api/combat/rules') return reply(200, { rulesVersion: RULES_VERSION });

  if (method === 'GET' && p === '/api/prices/retailers') return reply(200, retailersInfo());
  if (method === 'GET' && p === '/api/prices/suggestions') {
    // Tracked kits + MSRP names + every title in the published snapshot.
    let titles = [];
    try { titles = (await loadSnapshot()).offers.filter((o) => checkOffer(o).ok).map((o) => o.title); } catch { /* snapshot missing: kits only */ }
    return reply(200, suggestionsPayload(titles));
  }
  if (method === 'GET' && p === '/api/prices/search') {
    const q = (url.searchParams.get('q') ?? '').trim().replace(/\s+/g, ' ');
    if (q.length < 2 || q.length > 100) return reply(400, { error: 'Query "q" must be 2-100 characters' });
    const snap = await loadSnapshot();
    const result = rankOffers({
      query: q,
      region: url.searchParams.get('region') || 'All',
      currency: url.searchParams.get('currency') || 'native',
      demo: snap.demo,
      // Every published offer goes through the full trust filter again here.
      candidates: snap.offers.map((o) => ({ ...o, __source: o.retailerId })),
      statuses: snap.retailers,
    });
    return reply(200, {
      ...result,
      snapshot: { generatedAt: snap.generatedAt, demo: snap.demo, fallbackReason: snap.fallbackReason, watchlist: snap.watchlist },
    });
  }
  return reply(404, { error: 'Not available on the static site' });
}

/** fetch()-compatible for the API paths the pages use. */
export async function staticFetch(path, opts = {}) {
  const url = new URL(path, location.href);
  const body = opts.body ? JSON.parse(opts.body) : undefined;
  return route((opts.method || 'GET').toUpperCase(), url, body);
}
