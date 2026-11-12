// Builds the published price snapshot (data/prices.json). Node-only.
//
// Politeness and efficiency (live mode):
//  * every request still goes through politeFetch (per-host rate limits, caching,
//    robots.txt, redirect checks, pause-after-refusal);
//  * only live stores that ship domestically to HOME are searched;
//  * queries are de-duplicated (catalogue + watchlist, nicknames expanded);
//  * each store runs its own queue, so a slow store (2 req/min) doesn't hold up the others;
//  * every listing a search returns is kept for whichever catalogue product it
//    matches, and a later query is skipped at a store that already returned that
//    product in this run;
//  * per-store query cap and an overall deadline; products refreshed least
//    recently go first, so successive refreshes rotate through the catalogue;
//  * a store that refuses (403), rate-limits or disallows us is stopped for the run;
//    three failures in a row stop it too;
//  * offers not refreshed this run are carried over from the previous snapshot
//    (marked `carried`, original fetchedAt) for up to CARRY_MAX_DAYS.
import { RETAILERS } from './retailers.js';
import { CATALOG, productById } from './catalog.js';
import { WATCHLIST } from './watchlist.js';
import { HOME } from './location.js';
import { checkOffer } from './trust.js';
import { productIdForTitle } from './msrp.js';
import { searchRetailer } from './search.js';
import { adapterFor } from './adapters/index.js';
import { demoCatalogOffers } from './fixtures.js';
import { bestPricesByProduct, mergeHistory } from './history.js';
import { normalize, expandQuery } from '../search/fuzzy.js';

export const SNAPSHOT_VERSION = 2;
export const CARRY_MAX_DAYS = 14;
export const DEFAULTS = Object.freeze({ maxMinutes: 40, maxQueriesPerRetailer: 80, maxConsecutiveErrors: 3 });
const STOP_CODES = new Set(['PAUSED', 'REFUSED', 'RATE_LIMITED', 'ROBOTS', 'REDIRECT']);

/**
 * De-duplicated search queries: one per catalogue product (plus watchlist kits
 * not in the catalogue), ordered so products missing or oldest in the previous
 * snapshot come first, then popular ones.
 * @returns {{query:string, productId:string|null}[]}
 */
export function planQueries({ previous = null, catalog = CATALOG, watchlist = WATCHLIST } = {}) {
  const lastSeen = new Map(); // productId -> newest fetchedAt in previous snapshot
  for (const o of previous?.offers ?? []) {
    const id = o.productId ?? productIdForTitle(o.title);
    if (id && String(o.fetchedAt) > (lastSeen.get(id) ?? '')) lastSeen.set(id, String(o.fetchedAt));
  }
  const seen = new Set();
  const out = [];
  const add = (query, productId, popular) => {
    const k = normalize(expandQuery(query));
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push({ query, productId, popular: !!popular, last: productId ? lastSeen.get(productId) ?? '' : '' });
  };
  for (const e of catalog) {
    if (e.category === 'paint') continue; // paint sets: rarely discounted, not worth the requests
    add(e.name, e.id, e.popular);
  }
  const covered = new Set(out.map((q) => q.productId));
  for (const w of watchlist) {
    const id = productIdForTitle(w);
    if (id && covered.has(id)) continue;
    add(w, id, false);
  }
  out.sort((a, b) => a.last.localeCompare(b.last) || Number(b.popular) - Number(a.popular));
  return out.map(({ query, productId }) => ({ query, productId }));
}

/** Retailers a refresh searches: domestic to HOME and live. */
export function snapshotRetailers(home = HOME) {
  return RETAILERS.filter((r) => r.region === home.region && r.adapter?.live !== false);
}

/**
 * Keep a trusted offer for its catalogue product.
 * @returns {object|null}
 */
function keepOffer(o, r, now) {
  const offer = { ...o, retailerId: r.id };
  if (o.retailerId && o.retailerId !== r.id) return null; // adapters speak only for their own store
  if (!checkOffer(offer).ok) return null;
  const productId = productIdForTitle(offer.title);
  if (!productId) return null;
  return {
    retailerId: r.id, productId, title: String(offer.title).slice(0, 200), url: new URL(offer.url).href,
    imageUrl: offer.imageUrl ?? undefined, price: Math.round(offer.price * 100) / 100, currency: offer.currency,
    inStock: typeof offer.inStock === 'boolean' ? offer.inStock : null, fetchedAt: offer.fetchedAt ?? now,
  };
}

/**
 * Live refresh. `factory` / `now` / `sleep` are injectable for tests.
 */
export async function collectLive({
  previous = null, home = HOME, retailers = snapshotRetailers(home), factory = adapterFor,
  maxMinutes = DEFAULTS.maxMinutes, maxQueriesPerRetailer = DEFAULTS.maxQueriesPerRetailer,
  maxConsecutiveErrors = DEFAULTS.maxConsecutiveErrors, clock = Date.now, log = () => {}, timeoutMs,
} = {}) {
  const started = clock();
  const deadline = started + maxMinutes * 60_000;
  const queries = planQueries({ previous });
  const offers = new Map(); // url -> offer
  const refreshed = new Set(); // `${retailerId}|${productId}` seen this run
  const stats = { planned: queries.length, run: 0, skippedCovered: 0, deferred: 0 };
  const stores = [];

  await Promise.all(retailers.map(async (r) => {
    const st = { id: r.id, name: r.name, status: 'ok', ok: 0, failed: 0, received: 0, kept: 0,
      lastOkAt: null, lastAttemptAt: null, error: null, stoppedReason: null, errors: {} };
    stores.push(st);
    let streak = 0; let ran = 0;
    for (const q of queries) {
      if (st.stoppedReason) { stats.deferred++; continue; }
      if (q.productId && refreshed.has(`${r.id}|${q.productId}`)) { stats.skippedCovered++; continue; }
      if (ran >= maxQueriesPerRetailer || clock() >= deadline) { stats.deferred++; continue; }
      ran++; stats.run++;
      st.lastAttemptAt = new Date(clock()).toISOString();
      const res = await searchRetailer(r, q.query, { factory, ...(timeoutMs ? { timeoutMs } : {}) });
      if (res.status.status === 'ok') {
        streak = 0; st.ok++; st.received += res.offers.length; st.lastOkAt = new Date(clock()).toISOString();
        for (const raw of res.offers) {
          const o = keepOffer(raw, r, st.lastOkAt);
          if (!o) continue;
          st.kept++;
          refreshed.add(`${r.id}|${o.productId}`);
          offers.set(o.url, o);
        }
        if (q.productId) refreshed.add(`${r.id}|${q.productId}`); // searched: don't repeat even if not stocked
      } else {
        streak++; st.failed++;
        const msg = res.status.error ?? res.status.reason ?? 'unknown';
        st.errors[msg] = (st.errors[msg] ?? 0) + 1;
        st.error = msg;
        if (STOP_CODES.has(res.error?.code)) st.stoppedReason = msg;
        else if (streak >= maxConsecutiveErrors) st.stoppedReason = `Stopped after ${streak} failures in a row: ${msg}`;
        if (st.stoppedReason) log(`${r.name}: stopping (${st.stoppedReason})`);
      }
    }
    st.status = st.ok ? 'ok' : st.failed ? 'error' : 'skipped';
    log(`${r.name}: ${st.ok} ok, ${st.failed} failed, ${st.kept} offers kept${st.stoppedReason ? ` | stopped: ${st.stoppedReason}` : ''}`);
  }));

  return { offers: [...offers.values()], stores, refreshed, stats, durationMs: clock() - started,
    partial: stats.deferred > 0 };
}

/** Previous offers for store+product pairs not refreshed this run, if recent enough. */
export function carryOver(previous, refreshed, { now = Date.now(), maxDays = CARRY_MAX_DAYS, liveIds = null } = {}) {
  const out = [];
  for (const o of previous?.offers ?? []) {
    const id = o.productId ?? productIdForTitle(o.title);
    if (!id || !productById(id)) continue;
    if (liveIds && !liveIds.has(o.retailerId)) continue;
    if (refreshed.has(`${o.retailerId}|${id}`)) continue;
    const t = Date.parse(o.fetchedAt ?? '');
    if (!Number.isFinite(t) || now - t > maxDays * 86_400_000) continue;
    if (!checkOffer({ ...o }).ok) continue;
    out.push({ ...o, productId: id, carried: true });
  }
  return out;
}

/** SAMPLE snapshot (demo): generated offers + synthetic history, clearly labelled. */
export function buildDemoSnapshot({ now = Date.now(), home = HOME } = {}) {
  const t = new Date(now).toISOString();
  const offers = demoCatalogOffers(t).map((o) => ({ ...o, productId: productIdForTitle(o.title) ?? undefined }));
  // Synthetic 20-day history so the charts have something to show (labelled demo).
  let prev = { history: {}, lowest: {} };
  const best = bestPricesByProduct(offers, { home });
  for (let d = 19; d >= 0; d--) {
    const day = new Date(now - d * 86_400_000).toISOString();
    const pts = {};
    for (const [id, v] of Object.entries(best)) {
      let h = 0; for (const c of `${id}${d}`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      const wiggle = d === 0 ? 1 : 1 + (((h % 1000) / 1000) - 0.35) * 0.12;
      pts[id] = { p: Math.round(v.p * wiggle * 100) / 100, r: v.r };
    }
    prev = mergeHistory(prev, pts, day);
  }
  const stores = snapshotRetailers(home).map((r) => ({ id: r.id, name: r.name, status: 'ok', ok: 1, failed: 0,
    lastOkAt: t, lastAttemptAt: t, error: null, stoppedReason: null }));
  return {
    version: SNAPSHOT_VERSION, generatedAt: t, demo: true,
    fallbackReason: 'Sample data for testing the site: these are NOT real prices.',
    partial: false, home, watchlist: WATCHLIST, offers, retailers: stores,
    queries: { planned: 0, run: 0, skippedCovered: 0, deferred: 0 },
    history: prev.history, lowest: prev.lowest, durationMs: 0,
  };
}

/**
 * Full refresh: live collection, carry-over, history. Falls back to labelled
 * sample data if nothing at all could be fetched and nothing can be carried.
 */
export async function buildSnapshot({ previous = null, demo = false, now = Date.now, log = console.log, ...opts } = {}) {
  if (demo) return buildDemoSnapshot({ now: now() });
  const home = opts.home ?? HOME;
  // History from a demo snapshot must never mix with real prices.
  const prev = previous && !previous.demo ? previous : null;
  const live = await collectLive({ previous: prev, log, clock: now, ...opts });
  const liveIds = new Set((opts.retailers ?? snapshotRetailers(home)).map((r) => r.id));
  const carried = carryOver(prev, live.refreshed, { now: now(), liveIds });
  const offers = [...live.offers, ...carried];
  if (!live.offers.length && !carried.length) {
    const snap = buildDemoSnapshot({ now: now(), home });
    snap.fallbackReason = 'No live offers could be fetched during the last update; showing SAMPLE data, not real prices.';
    snap.liveDiagnostics = live.stores;
    return snap;
  }
  const t = new Date(now()).toISOString();
  const { history, lowest } = mergeHistory(prev ?? {}, bestPricesByProduct(live.offers, { home }), t);
  // Keep each store's last success from the previous snapshot if it failed now.
  const prevStores = new Map((prev?.retailers ?? []).map((s) => [s.id, s]));
  const retailers = live.stores.map((s) => ({ ...s, lastOkAt: s.lastOkAt ?? prevStores.get(s.id)?.lastOkAt ?? null }));
  return {
    version: SNAPSHOT_VERSION, generatedAt: t, demo: false, fallbackReason: null,
    partial: live.partial, home, watchlist: WATCHLIST,
    offers, retailers,
    queries: { ...live.stats, carried: carried.length },
    history, lowest, durationMs: live.durationMs,
  };
}
