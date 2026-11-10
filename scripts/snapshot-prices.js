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
      const prev = statuses.get(s.id);
      if (!prev || (prev.status !== 'ok' && s.status === 'ok')) statuses.set(s.id, s);
    }
    tracked.push({ query, offers: r.results.length });
    console.log(`${demo ? '[demo] ' : ''}${query}: ${r.results.length} offers`);
  }
  return { offers: [...offers.values()], retailers: [...statuses.values()], tracked };
}

let demo = forceDemo;
let snap = await collect(demo);
let fallbackReason = null;
if (!demo && snap.offers.length === 0) {
  fallbackReason = 'No live offers could be fetched during the last update; showing sample data.';
  console.warn(fallbackReason);
  demo = true;
  snap = await collect(true);
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
