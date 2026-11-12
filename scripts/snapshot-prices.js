// Builds data/prices.json for the static site through the normal live pipeline
// (politeFetch: per-host rate limits, caching, robots.txt, redirect checks,
// pause after refusal). See src/price/snapshot.js for how a refresh stays
// polite: de-duplicated queries, one queue per store, per-store query cap,
// overall deadline, stop-on-refusal, carry-over of recent offers, and a small
// rolling price history merged from the previous snapshot.
//
// If no live offers come back at all (e.g. retailers block the CI runner), the
// snapshot falls back to clearly-labelled SAMPLE data so the page still works.
//
// Usage: node scripts/snapshot-prices.js [outFile] [--demo] [--previous file]
//          [--max-minutes N] [--max-queries N] [--retry-blocked]
// Stores that refuse us (HTTP 403 / robots.txt) are recorded in the snapshot's
// `blockedStores` and skipped by every later refresh; --retry-blocked clears that list.
// The previous snapshot defaults to outFile itself when it exists (the Pages
// workflow downloads the published one there first).
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildSnapshot, DEFAULTS } from '../src/price/snapshot.js';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const valued = new Set(['--previous', '--max-minutes', '--max-queries']);
const positional = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
const outFile = positional[0] ?? '_site/data/prices.json';
const demo = args.includes('--demo');
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

let previous = null;
const prevFile = opt('--previous') ?? outFile;
try {
  previous = JSON.parse(await readFile(prevFile, 'utf8'));
  console.log(`Previous snapshot: ${prevFile} (${previous.generatedAt ?? 'unknown date'}${previous.demo ? ', sample data' : ''})`);
} catch { console.log('No previous snapshot: starting fresh history.'); }

const snap = await buildSnapshot({
  previous, demo, retryBlocked: args.includes('--retry-blocked'),
  maxMinutes: num(opt('--max-minutes'), DEFAULTS.maxMinutes),
  maxQueriesPerRetailer: num(opt('--max-queries'), DEFAULTS.maxQueriesPerRetailer),
  log: (m) => console.log(m),
});

if (snap.queries) {
  const q = snap.queries;
  console.log(`\nQueries: ${q.planned} planned, ${q.run} run, ${q.skippedCovered} skipped (already covered), `
    + `${q.deferred} deferred to a later refresh${q.carried ? `, ${q.carried} offers carried over` : ''}.`);
}
for (const s of snap.liveDiagnostics ?? snap.retailers ?? []) {
  const errs = Object.entries(s.errors ?? {}).map(([m, n]) => `${n}× ${m}`).join('; ');
  console.log(`${s.name}: ${s.ok ?? 0} ok, ${s.failed ?? 0} failed${errs ? ` | ${errs}` : ''}`);
}
await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, JSON.stringify(snap));
console.log(`Wrote ${outFile}: ${snap.offers.length} offers, history for ${Object.keys(snap.history ?? {}).length} products`
  + `${snap.demo ? ' (SAMPLE data)' : ''}.`);
process.exit(0); // don't wait on limiter timers
