// Deal Finder overview: turns a price snapshot into per-product deal summaries,
// "top deals", value-per-model/point figures and per-store freshness. Shared by
// the API (/api/prices/overview) and the static site (computed in the browser).
// Every snapshot offer goes through the full trust filter again here.
import { CATALOG, CATEGORIES, FACTIONS, RRP_AS_OF, factionById } from './catalog.js';
import { RETAILERS, getRetailer } from './retailers.js';
import { checkOffer } from './trust.js';
import { productIdForTitle, msrpIn } from './msrp.js';
import { rankOffers, DISCLAIMER } from './rank.js';
import { trimHistory } from './history.js';
import { HOME } from './location.js';
import { SHIPPING_US, REGION_DEFAULTS, IMPORT_US, SHIPPING_AS_OF } from './deals.js';
import { optimizeCart } from './cart.js';

export const STALE_AFTER_HOURS = 24 * 7;  // snapshot older than a week: warn
export const AGING_AFTER_HOURS = 48;

const hoursSince = (iso, now) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? Math.max(0, (now - t) / 3_600_000) : null;
};
const r2 = (n) => Math.round(n * 100) / 100;

/** Slim offer for the UI (drops ranking internals). */
function slim(o) {
  return {
    retailerId: o.retailerId, retailerName: o.retailerName, tier: o.tier, region: o.region,
    title: o.title, url: o.url, price: o.price, currency: o.currency, inStock: o.inStock,
    flags: o.flags, fetchedAt: o.fetchedAt, domestic: o.domestic, deal: o.deal, carried: o.carried || undefined,
  };
}

/**
 * @param {object} snap  snapshot (data/prices.json shape)
 * @param {object} [o]
 * @param {number} [o.now]
 * @param {object} [o.home]
 * @param {object} [o.shippingOverrides]
 * @param {string} [o.region]  'home' (default: only stores shipping domestically) or 'All'
 */
export function buildOverview(snap, { now = Date.now(), home = HOME, shippingOverrides, region = 'home' } = {}) {
  const groups = new Map(); // productId -> candidates
  let unmatched = 0; let rejected = 0;
  const wantRegion = region === 'All' ? null : home.region;
  for (const raw of snap?.offers ?? []) {
    const o = { ...raw };
    if (!checkOffer(o).ok) { rejected++; continue; }
    const r = getRetailer(o.retailerId);
    if (wantRegion && r.region !== wantRegion) continue;
    const id = productIdForTitle(o.title);
    if (!id) { unmatched++; continue; }
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push({ ...o, __source: o.retailerId });
  }
  const history = trimHistory(snap?.history);
  const lowestAll = snap?.lowest ?? {};

  const products = CATALOG.map((e) => {
    const cands = groups.get(e.id) ?? [];
    const ranked = cands.length
      ? rankOffers({ query: e.name, product: e, candidates: cands, currency: home.currency, home,
        didYouMean: false, shippingOverrides })
      : { results: [], best: null };
    // Carried-over offers keep their flag for the "stale" note.
    const carried = new Set(cands.filter((c) => c.carried).map((c) => c.url));
    const offers = ranked.results.map((x) => slim({ ...x, carried: carried.has(x.url) }));
    const best = ranked.best ? slim({ ...ranked.best, carried: carried.has(ranked.best.url) }) : null;
    const msrp = msrpIn(e, home.currency);
    const hist = history[e.id] ?? [];
    const low = Array.isArray(lowestAll[e.id]) ? lowestAll[e.id] : null;
    const bestPrice = best?.deal?.price ?? null;
    return {
      id: e.id, name: e.name, category: e.category, faction: e.faction,
      factionName: factionById(e.faction)?.name ?? null,
      msrp, conf: e.conf, models: e.models, points: e.points, note: e.note, popular: e.popular,
      offers, best,
      inStockCount: offers.filter((x) => x.inStock === true).length,
      history: hist.map(([t, p, r]) => ({ t, p, r })),
      lowest: low ? { t: low[0], p: low[1], r: low[2] } : null,
      atLowest: !!(low && bestPrice != null && bestPrice <= low[1] + 0.005),
      perModel: bestPrice != null && e.models ? r2(bestPrice / e.models) : null,
      perPoint: bestPrice != null && e.points ? Math.round((bestPrice / e.points) * 1000) / 1000 : null,
      rrpPerModel: msrp && e.models ? r2(msrp / e.models) : null,
      rrpPerPoint: msrp && e.points ? Math.round((msrp / e.points) * 1000) / 1000 : null,
    };
  });

  const topDeals = products
    .filter((p) => p.best?.deal?.score != null && p.best.deal.pctOff > 0)
    .sort((a, b) => b.best.deal.score - a.best.deal.score || b.best.deal.pctOff - a.best.deal.pctOff
      || a.best.deal.total - b.best.deal.total || a.id.localeCompare(b.id))
    .slice(0, 12)
    .map((p) => p.id);

  // Per-store freshness: last successful fetch, offers in this snapshot, errors.
  const statusById = new Map((snap?.retailers ?? []).map((s) => [s.id, s]));
  const diag = new Map((snap?.diagnostics ?? []).map((d) => [d.id, d]));
  const latestOffer = new Map();
  const offerCount = new Map();
  for (const o of snap?.offers ?? []) {
    offerCount.set(o.retailerId, (offerCount.get(o.retailerId) ?? 0) + 1);
    if (!latestOffer.has(o.retailerId) || String(o.fetchedAt) > latestOffer.get(o.retailerId)) latestOffer.set(o.retailerId, String(o.fetchedAt));
  }
  const stores = RETAILERS.filter((r) => !wantRegion || r.region === wantRegion).map((r) => {
    const s = statusById.get(r.id) ?? {};
    const d = diag.get(r.id) ?? {};
    const lastOkAt = s.lastOkAt ?? latestOffer.get(r.id) ?? null;
    const age = hoursSince(lastOkAt, now);
    return {
      id: r.id, name: r.name, tier: r.tier, caution: r.caution ?? null,
      status: s.status ?? (r.adapter?.live === false ? 'skipped' : 'unknown'),
      reason: s.error ?? s.reason ?? (r.adapter?.live === false ? r.adapter.liveDisabledReason ?? 'Live lookups disabled' : null),
      lastOkAt, ageHours: age == null ? null : Math.round(age * 10) / 10,
      stale: age != null && age > STALE_AFTER_HOURS,
      offers: offerCount.get(r.id) ?? 0,
      searches: d.ok ?? s.ok ?? null, failures: d.failed ?? (d.errors ? Object.values(d.errors).reduce((a, b) => a + b, 0) : null),
      stoppedReason: s.stoppedReason ?? null,
      shipping: { ...(SHIPPING_US[r.id] ?? REGION_DEFAULTS[r.region]) },
    };
  });

  const age = hoursSince(snap?.generatedAt, now);
  return {
    snapshot: {
      generatedAt: snap?.generatedAt ?? null,
      ageHours: age == null ? null : Math.round(age * 10) / 10,
      freshness: age == null ? 'none' : age > STALE_AFTER_HOURS ? 'stale' : age > AGING_AFTER_HOURS ? 'aging' : 'fresh',
      demo: !!snap?.demo,
      fallbackReason: snap?.fallbackReason ?? null,
      partial: !!snap?.partial,
      offers: (snap?.offers ?? []).length,
      unmatched, rejected,
      queries: snap?.queries ?? null,
    },
    home: { ...home },
    products,
    topDeals,
    stores,
    categories: CATEGORIES,
    factions: FACTIONS,
    assumptions: {
      rrp: RRP_AS_OF,
      shipping: SHIPPING_AS_OF,
      salesTax: home.salesTaxLabel,
      importDuty: Object.fromEntries(Object.entries(IMPORT_US).map(([k, v]) => [k, v.note])),
      dealScore: 'Deal score 0-100 compares the estimated delivered total (price + shipping + tax/duty) with '
        + 'paying RRP at a typical store (RRP + $9.99 shipping under $99 + sales tax): 0 ≈ 5% above that, '
        + '100 = 30% or more below. Out-of-stock and '
        + 'unknown-stock offers score lower; suspiciously cheap listings score 0.',
    },
    disclaimer: DISCLAIMER,
  };
}

/**
 * Cart optimizer over an overview's offers: in-stock, non-suspicious listings
 * only. `items`: [{id, qty}] (unknown ids are reported as unavailable).
 */
export function planCart(overview, items, { overrides, home = overview?.home ?? HOME } = {}) {
  const byId = new Map((overview?.products ?? []).map((p) => [p.id, p]));
  const clean = [];
  const seen = new Set();
  for (const it of (Array.isArray(items) ? items : []).slice(0, 40)) {
    const id = typeof it?.id === 'string' ? it.id : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    clean.push({ id, name: byId.get(id)?.name ?? id, qty: it.qty });
  }
  const offers = {};
  for (const it of clean) {
    offers[it.id] = (byId.get(it.id)?.offers ?? [])
      .filter((o) => o.inStock === true && !o.flags?.includes('suspicious') && o.deal?.price > 0)
      .map((o) => ({ retailerId: o.retailerId, price: o.deal.price, url: o.url, title: o.title }));
  }
  return optimizeCart({ items: clean, offers, home, overrides: sanitizeOverrides(overrides) });
}

/** Accept only {retailerId: {flat, freeOver}} with sane numbers for known stores. */
export function sanitizeOverrides(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  for (const [id, v] of Object.entries(o)) {
    if (!getRetailer(id) || !v || typeof v !== 'object') continue;
    const n = (x) => (x === null ? null : Number.isFinite(Number(x)) && x !== '' ? Math.min(10_000, Math.max(0, Number(x))) : undefined);
    const flat = n(v.flat); const freeOver = n(v.freeOver);
    out[id] = {};
    if (flat !== undefined && flat !== null) out[id].flat = flat;
    if (freeOver !== undefined) out[id].freeOver = freeOver;
  }
  return out;
}
