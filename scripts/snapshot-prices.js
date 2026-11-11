// Builds data/prices.json for the static site by searching every kit in the
// watchlist through the normal live pipeline (politeFetch: per-host rate limits,
// caching, robots.txt, redirect checks). Queries run one at a time, so each
// retailer sees at most its registered budget (6 req/min).
//
// If no live offers come back at all (e.g. retailers block the CI runner), the
// snapshot falls back to clearly-labelled sample data so the page still works.
//
// Usage: node scripts/snapshot-prices.js [outFile] [--demo]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { searchPrices } from '../src/price/search.js';
import { WATCHLIST } from '../src/price/watchlist.js';
import { HOME } from '../src/price/location.js';

const args = process.argv.slice(2);
const forceDemo = args.includes('--demo');
const outFile = args.find((a) => !a.startsWith('--')) ?? '_site/data/prices.json';

async function collect(demo) {
  const offers = new Map(); // url -> offer
  const statuses = new Map(); // retailerId -> status
  const tally = new Map(); // retailerId -> { ok, offers, errors: Map(message -> count) }
  const tracked = [];
  for (const query of WATCHLIST) {
    // Only retailers that ship domestically to HOME are queried: fewer requests, relevant prices.
    const r = await searchPrices({ query, region: HOME.region, currency: 'native', demo });
    for (const o of r.results) {
      if (!offers.has(o.url)) {
        offers.set(o.url, {
          retailerId: o.retailerId, title: o.title, url: o.url, imageUrl: o.imageUrl ?? undefined,
          price: o.price, currency: o.currency, inStock: o.inStock, fetchedAt: o.fetchedAt,
        });
      }
    }
    for (const s of r.retailers) {
      if (s.status !== 'skipped' || !/^Not in region/.test(s.reason ?? '')) {
        const t = tally.get(s.id) ?? { name: s.name, ok: 0, offers: 0, errors: new Map() };
        if (s.status === 'ok') { t.ok++; t.offers += s.received ?? 0; }
        else { const m = `${s.status}: ${s.error ?? s.reason ?? 'unknown'}`; t.errors.set(m, (t.errors.get(m) ?? 0) + 1); }
        tally.set(s.id, t);
      }
      const prev = statuses.get(s.id);
      if (!prev || (prev.status !== 'ok' && s.status === 'ok')) statuses.set(s.id, s);
    }
    tracked.push({ query, offers: r.results.length });
    console.log(`${demo ? '[demo] ' : ''}${query}: ${r.results.length} offers`);
  }
  // Per-retailer diagnostics, so an empty refresh explains itself in the job log.
  console.log(`\n=== ${demo ? '[demo] ' : ''}Retailer summary (${WATCHLIST.length} searches) ===`);
  for (const t of tally.values()) {
    const errs = [...t.errors].map(([m, n]) => `${n}× ${m}`).join('; ');
    console.log(`${t.name}: ${t.ok} ok searches, ${t.offers} raw offers received${errs ? ` | ${errs}` : ''}`);
  }
  return { offers: [...offers.values()], retailers: [...statuses.values()], tracked,
    diagnostics: [...tally.entries()].map(([id, t]) => ({ id, ok: t.ok, offers: t.offers, errors: Object.fromEntries(t.errors) })) };
}

let demo = forceDemo;
let snap = await collect(demo);
let fallbackReason = null;
if (!demo && snap.offers.length === 0) {
  fallbackReason = 'No live offers could be fetched during the last update; showing sample data.';
  console.warn(fallbackReason);
  demo = true;
  const liveDiagnostics = snap.diagnostics;
  snap = await collect(true);
  snap.liveDiagnostics = liveDiagnostics; // keep the live failure reasons in the published file
}

const out = {
  generatedAt: new Date().toISOString(),
  demo,
  fallbackReason,
  watchlist: WATCHLIST,
  home: HOME,
  ...snap,
};
await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, JSON.stringify(out));
console.log(`Wrote ${outFile}: ${out.offers.length} offers${demo ? ' (sample data)' : ''}`);
process.exit(0); // don't wait on limiter timers
