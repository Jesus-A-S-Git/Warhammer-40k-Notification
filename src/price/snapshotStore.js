// Server-side access to the price snapshot for the Deal Finder overview, top
// deals, watchlist and cart optimizer (live per-query search stays at /search).
// Node-only. Reads PRICE_SNAPSHOT, else data/prices.json, else _site/data/prices.json
// (written by `npm run snapshot` / `npm run snapshot:demo`). Demo mode builds the
// labelled SAMPLE snapshot in memory. Nothing here contacts a retailer.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemoSnapshot } from './snapshot.js';
import { buildOverview, STALE_AFTER_HOURS, AGING_AFTER_HOURS } from './overview.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function snapshotPaths() {
  return [process.env.PRICE_SNAPSHOT, path.join(root, 'data', 'prices.json'), path.join(root, '_site', 'data', 'prices.json')]
    .filter(Boolean);
}

let fileCache = null; // { file, mtimeMs, snap, overview }
let demoCache = null; // { day, snap, overview }

/** @returns {Promise<{snap:object|null, overview:object|null, source:string|null}>} */
export async function loadOverview({ demo = false } = {}) {
  if (demo) {
    const hour = Math.floor(Date.now() / 3_600_000);
    if (!demoCache || demoCache.hour !== hour) {
      const snap = buildDemoSnapshot();
      demoCache = { hour, snap, overview: buildOverview(snap) };
    }
    return { snap: demoCache.snap, overview: demoCache.overview, source: 'demo' };
  }
  for (const file of snapshotPaths()) {
    let st;
    try { st = await stat(file); } catch { continue; }
    if (!fileCache || fileCache.file !== file || fileCache.mtimeMs !== st.mtimeMs) {
      try {
        const snap = JSON.parse(await readFile(file, 'utf8'));
        fileCache = { file, mtimeMs: st.mtimeMs, snap, overview: buildOverview(snap) };
      } catch { continue; }
    }
    // Recompute ages (cheap) so "updated 3h ago" stays right on a long-running server.
    const ov = fileCache.overview;
    return { snap: fileCache.snap, overview: { ...ov, snapshot: { ...ov.snapshot, ...ageNow(fileCache.snap) } }, source: path.relative(root, file) };
  }
  return { snap: null, overview: null, source: null };
}

function ageNow(snap) {
  const t = Date.parse(snap?.generatedAt ?? '');
  if (!Number.isFinite(t)) return {};
  const h = (Date.now() - t) / 3_600_000;
  return { ageHours: Math.round(h * 10) / 10,
    freshness: h > STALE_AFTER_HOURS ? 'stale' : h > AGING_AFTER_HOURS ? 'aging' : 'fresh' };
}

/** Tests only. */
export function __resetSnapshotCache() { fileCache = null; demoCache = null; }
