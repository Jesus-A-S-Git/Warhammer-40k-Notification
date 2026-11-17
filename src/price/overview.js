// Deal Finder overview: turns a price snapshot into per-product deal summaries,
// "top deals", value-per-model/point figures and per-store freshness. Shared by
// the API (/api/prices/overview) and the static site (computed in the browser).
// Every snapshot offer goes through the full trust filter again here.
import { CATALOG, CATEGORIES, FACTIONS, RRP_AS_OF, factionById, productById } from './catalog.js';
import { RETAILERS, getRetailer, blockedReason } from './retailers.js';
import { checkOffer } from './trust.js';
import { productIdForTitle, msrpIn } from './msrp.js';
import { rankOffers, DISCLAIMER } from './rank.js';
import { trimHistory } from './history.js';
import { HOME } from './location.js';
import { SHIPPING_US, REGION_DEFAULTS, IMPORT_US, SHIPPING_AS_OF } from './deals.js';
import { optimizeCart } from './cart.js';
import { resolveRrp } from './rrp.js';
import { convert } from './currency.js';

export const STALE_AFTER_HOURS = 24 * 7;  // snapshot older than a week: warn
export const AGING_AFTER_HOURS = 48;

const hoursSince = (iso, now) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? Math.max(0, (now - t) / 3_600_000) : null;
};
const r2 = (n) => Math.round(n * 100) / 100;

const DAY = 86_400_000;
export const CHANGE_DAYS = 7;
export const LIST_LIMIT = 12;

/** Contract Offer (see API v2) from a ranked offer. */
function toOffer(o, carried) {
  const r = getRetailer(o.retailerId);
  const d = o.deal ?? {};
  return {
    retailerId: o.retailerId, retailerName: o.retailerName, title: o.title, url: o.url,
    imageUrl: o.imageUrl ?? null,
    price: o.price, currency: o.currency, priceUsd: convert(o.price, o.currency, 'USD'),
    delivered: d.total ?? null, shipping: d.shipping ?? null, tax: d.tax ?? null, duty: d.duty ?? 0,
    inStock: o.inStock ?? null, pctOff: d.pctOff ?? null, dealScore: d.score ?? null, dealLabel: d.label ?? null,
    suspicious: !!o.flags?.includes('suspicious'), carried: !!carried, fetchedAt: o.fetchedAt ?? null,
    caution: r?.caution ?? null,
    // extras
    listPrice: Number.isFinite(o.listPrice) ? o.listPrice : null,
    tier: o.tier, region: o.region, domestic: !!o.domestic, flags: o.flags ?? [],
    // price in the home currency, used by the cart optimizer
    homePrice: d.price ?? null,
  };
}

/** Best price ~CHANGE_DAYS ago vs now, from the rolling history. */
export function changeOver(hist, current, refMs, days = CHANGE_DAYS) {
  if (!hist?.length || current == null || !Number.isFinite(refMs)) return null;
  const cutoff = refMs - days * DAY + DAY / 2; // a refresh a few hours late still counts
  let from = null;
  for (const [t, p] of hist) if (Date.parse(t) <= cutoff) from = p;
  if (from == null || !(from > 0)) return null;
  return { from, to: current, pct: Math.round(((current - from) / from) * 1000) / 10 || 0 };
}

/**
 * A new all-time low inside the last CHANGE_DAYS: the low was set recently and
 * beats every earlier recorded best price. Returns the previous low or null.
 */
export function newLowInfo(hist, lowest, refMs, days = CHANGE_DAYS) {
  if (!lowest || !hist?.length || !Number.isFinite(refMs)) return null;
  const lowMs = Date.parse(lowest.date);
  if (!(lowMs >= refMs - days * DAY)) return null;
  const before = hist.filter(([t]) => Date.parse(t) < lowMs).map(([, p]) => p);
  if (!before.length) return null;
  const prev = Math.min(...before);
  return prev > lowest.price + 0.005 ? { price: prev, pct: Math.round(((lowest.price - prev) / prev) * 1000) / 10 || 0 } : null;
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
    if (blockedReason(r, snap?.blockedStores)) continue; // avoided stores never appear in results
    if (wantRegion && r.region !== wantRegion) continue;
    const id = (o.productId && productById(o.productId) && productIdForTitle(o.title) === o.productId)
      ? o.productId : productIdForTitle(o.title);
    if (!id) { unmatched++; continue; }
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push({ ...o, __source: o.retailerId });
  }
  const history = trimHistory(snap?.history);
  const lowestAll = snap?.lowest ?? {};
  const refMs = Number.isFinite(Date.parse(snap?.generatedAt ?? '')) ? Date.parse(snap.generatedAt) : now;

  const products = CATALOG.map((e) => {
    const cands = groups.get(e.id) ?? [];
    const rrp = resolveRrp(e, cands, { home });
    // RRP used for % off, deal scores and the "too cheap" check.
    const priced = rrp.rrpSource === 'retailer-list'
      ? { ...e, [home.currency]: rrp.rrp, ...(e.USD == null ? { GBP: null, EUR: null } : {}) } : e;
    const ranked = cands.length
      ? rankOffers({ query: e.name, product: priced, candidates: cands, currency: home.currency, home,
        didYouMean: false, shippingOverrides })
      : { results: [], best: null };
    // Carried-over offers keep their flag for the "stale" note.
    const carried = new Set(cands.filter((c) => c.carried).map((c) => c.url));
    const offers = ranked.results.map((x) => toOffer(x, carried.has(x.url)));
    const bestRaw = ranked.best;
    const bestOffer = bestRaw ? offers.find((o) => o.url === bestRaw.url) ?? null : null;
    const best = bestOffer ? {
      price: bestOffer.homePrice, delivered: bestOffer.delivered, retailerId: bestOffer.retailerId,
      retailerName: bestOffer.retailerName, url: bestOffer.url, inStock: bestOffer.inStock,
      pctOff: bestOffer.pctOff, savings: bestRaw.deal?.savings ?? null, fetchedAt: bestOffer.fetchedAt,
      carried: bestOffer.carried,
    } : null;
    const hist = history[e.id] ?? [];
    const lowRaw = Array.isArray(lowestAll[e.id]) ? lowestAll[e.id]
      : hist.length ? hist.reduce((m, x) => (x[1] < m[1] ? x : m)) : null;
    const lowest = lowRaw ? { price: lowRaw[1], date: lowRaw[0], retailerId: lowRaw[2] ?? null } : null;
    // History records the lowest in-stock sticker price per refresh, so compare like with like.
    const stickers = offers.filter((o) => o.inStock === true && !o.suspicious && o.homePrice > 0
      && (!wantRegion || o.region === wantRegion)).map((o) => o.homePrice);
    const curLow = stickers.length ? Math.min(...stickers) : null;
    const bestPrice = best?.price ?? null;
    const imageUrl = bestOffer?.imageUrl ?? offers.find((o) => o.imageUrl)?.imageUrl ?? null;
    const msrp = rrp.rrp;
    const f = factionById(e.faction);
    return {
      // ---- ProductCard (API v2) ----
      id: e.id, name: e.name, category: e.category, faction: e.faction,
      factionName: f?.name ?? null, factionColor: f?.color ?? null, imageUrl,
      rrp: msrp, rrpSource: rrp.rrpSource, rrpConf: rrp.rrpConf,
      best,
      offerCount: offers.length,
      inStockCount: offers.filter((x) => x.inStock === true).length,
      dealScore: bestOffer?.dealScore ?? null, dealLabel: bestOffer?.dealLabel ?? null,
      lowest,
      atLowest: !!(lowest && curLow != null && curLow <= lowest.price + 0.005),
      change7d: changeOver(hist, curLow, refMs),
      models: e.models ?? null, points: e.points ?? null, units: [...(e.units ?? [])],
      // ---- extras ----
      popular: !!e.popular, note: e.note ?? null, catalogueRrp: msrpIn(e, home.currency), catalogueConf: e.conf ?? null,
      perModel: bestPrice != null && e.models ? r2(bestPrice / e.models) : null,
      perPoint: bestPrice != null && e.points ? Math.round((bestPrice / e.points) * 1000) / 1000 : null,
      rrpPerModel: msrp && e.models ? r2(msrp / e.models) : null,
      rrpPerPoint: msrp && e.points ? Math.round((msrp / e.points) * 1000) / 1000 : null,
      // ---- internal (product page / cart only; not in list payloads) ----
      offers, history: hist, rrpEvidence: rrp.evidence,
      newLow: newLowInfo(hist, lowest, refMs),
    };
  });

  const topDeals = products
    .filter((p) => p.dealScore != null && p.best.pctOff > 0)
    .sort((a, b) => b.dealScore - a.dealScore || b.best.pctOff - a.best.pctOff
      || a.best.delivered - b.best.delivered || a.id.localeCompare(b.id))
    .slice(0, LIST_LIMIT)
    .map((p) => p.id);
  // Biggest 7-day drops of the best in-stock price, and fresh all-time lows.
  const drops = products.filter((p) => p.change7d && p.change7d.pct <= -1)
    .sort((a, b) => a.change7d.pct - b.change7d.pct || a.id.localeCompare(b.id))
    .slice(0, LIST_LIMIT).map((p) => p.id);
  const newLows = products.filter((p) => p.atLowest && p.newLow)
    .sort((a, b) => a.newLow.pct - b.newLow.pct || a.id.localeCompare(b.id))
    .slice(0, LIST_LIMIT).map((p) => p.id);

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
    const blocked = blockedReason(r, snap?.blockedStores);
    const lastOkAt = s.lastOkAt ?? latestOffer.get(r.id) ?? null;
    const age = hoursSince(lastOkAt, now);
    return {
      id: r.id, name: r.name, tier: r.tier, caution: r.caution ?? null,
      status: blocked ? 'blocked' : s.status ?? (r.adapter?.live === false ? 'skipped' : 'unknown'),
      reason: blocked ?? s.error ?? s.reason ?? (r.adapter?.live === false ? r.adapter.liveDisabledReason ?? 'Live lookups disabled' : null),
      blocked: Boolean(blocked),
      lastOkAt, ageHours: age == null ? null : Math.round(age * 10) / 10,
      stale: age != null && age > STALE_AFTER_HOURS,
      offers: blocked ? 0 : offerCount.get(r.id) ?? 0,
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
    topDeals, drops, newLows,
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
      .filter((o) => o.inStock === true && !o.suspicious && o.homePrice > 0)
      .map((o) => ({ retailerId: o.retailerId, price: o.homePrice, url: o.url, title: o.title }));
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
