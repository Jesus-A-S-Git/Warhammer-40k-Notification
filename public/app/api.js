// Data layer for every page. Pages call api.overview(), api.product(id), ...
// and always get the API contract v2 shapes (docs: ProductCard, Offer).
//
// * Server mode: fetch('/api/...'). Static (GitHub Pages) mode: static-api.js
//   answers the same paths in the browser.
// * Endpoints that are not deployed yet (older server, older static build) are
//   derived from /api/prices/overview so pages degrade instead of breaking.
// * Sample data: ?demo=1 (server mode) is remembered for the session and every
//   page shows a "sample data" banner while it is on.
import { STATIC } from '../config.js';

const doFetch = STATIC ? (await import('../static-api.js')).staticFetch : (p, o) => fetch(p, o);

/* ------------------------------------------------------------------ storage (never throws) */
export const storage = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* blocked */ } },
};

/* ------------------------------------------------------------------ sample-data mode */
const DEMO_KEY = 'site.demo.v1';
function readDemo() {
  if (STATIC) return false; // the static build's snapshot says itself whether it is sample data
  let q = null;
  try { q = new URLSearchParams(location.search).get('demo'); } catch { /* no location */ }
  if (q === '1') { try { sessionStorage.setItem(DEMO_KEY, '1'); } catch { /* blocked */ } return true; }
  if (q === '0') { try { sessionStorage.removeItem(DEMO_KEY); } catch { /* blocked */ } return false; }
  try { return sessionStorage.getItem(DEMO_KEY) === '1'; } catch { return false; }
}
export let demo = readDemo();
export function setDemo(on) {
  try { if (on) sessionStorage.setItem(DEMO_KEY, '1'); else sessionStorage.removeItem(DEMO_KEY); } catch { /* blocked */ }
  const u = new URL(location.href);
  if (on) u.searchParams.set('demo', '1'); else u.searchParams.delete('demo');
  location.href = u.href;
}

/* ------------------------------------------------------------------ fetch helpers */
export class ApiError extends Error {
  constructor(msg, status, missing = false) { super(msg); this.status = status; this.missing = missing; }
}
function withDemo(path) {
  if (!demo || STATIC) return path;
  return `${path}${path.includes('?') ? '&' : '?'}demo=1`;
}
/** JSON request. A 404 that is not JSON, or "Not available on the static site", marks the endpoint as missing. */
export async function getJson(path, opts) {
  const res = await doFetch(withDemo(path), opts);
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const missing = (res.status === 404 || res.status === 405) && (!data || /not available on the static site/i.test(data.error || ''));
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, missing);
  }
  if (data == null) throw new ApiError('Unexpected response', res.status, true);
  return data;
}
const postJson = (path, body) => getJson(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/* ------------------------------------------------------------------ normalisation (legacy -> v2) */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
export function safeHttps(u) {
  try { const x = new URL(u); return x.protocol === 'https:' ? x.href : null; } catch { return null; }
}

/** History rows as [{t, p, r}], oldest first. Accepts [[date, price, retailerId]] or [{t,p,r}]. */
export function normHistory(h) {
  if (!Array.isArray(h)) return [];
  return h.map((x) => (Array.isArray(x) ? { t: x[0], p: num(x[1]), r: x[2] ?? null } : { t: x.t ?? x.date, p: num(x.p ?? x.price), r: x.r ?? x.retailerId ?? null }))
    .filter((x) => x.p != null && !Number.isNaN(Date.parse(x.t))).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}

function change7dFrom(hist, now) {
  if (hist.length < 2 || now == null) return null;
  const end = Date.parse(hist.at(-1).t);
  const target = end - 7 * 864e5;
  let ref = null;
  for (const x of hist) { if (Date.parse(x.t) <= target + 12 * 36e5) ref = x; }
  ref ??= hist[0];
  if (!ref || ref === hist.at(-1) || !ref.p) return null;
  return { from: ref.p, to: now, pct: Math.round(((now - ref.p) / ref.p) * 1000) / 10 };
}

/** Offer in the v2 shape. Accepts legacy offers ({deal:{...}, flags}). */
export function normOffer(o) {
  if (!o) return null;
  const d = o.deal ?? {};
  return {
    retailerId: o.retailerId, retailerName: o.retailerName ?? o.retailerId, title: o.title ?? '',
    url: safeHttps(o.url), imageUrl: safeHttps(o.imageUrl),
    price: num(o.price) ?? num(d.price), currency: o.currency ?? 'USD', priceUsd: num(o.priceUsd) ?? num(d.price) ?? num(o.price),
    delivered: num(o.delivered) ?? num(d.total), shipping: num(o.shipping) ?? num(d.shipping),
    tax: num(o.tax) ?? (d.tax != null ? round2((d.tax ?? 0) + (d.duty ?? 0)) : null),
    inStock: o.inStock ?? null, pctOff: num(o.pctOff) ?? num(d.pctOff), savings: num(o.savings) ?? num(d.savings),
    dealScore: num(o.dealScore) ?? num(d.score), dealLabel: o.dealLabel ?? d.label ?? null,
    suspicious: o.suspicious ?? !!o.flags?.includes('suspicious'), carried: !!o.carried,
    fetchedAt: o.fetchedAt ?? null, caution: o.caution ?? null,
    freeOver: num(o.freeOver) ?? num(d.freeOver), toFree: num(o.toFree) ?? num(d.toFree),
    shippingNote: o.shippingNote ?? d.shippingNote ?? null, domestic: o.domestic ?? true,
  };
}

/** ProductCard in the v2 shape (fills fields an older API does not send). */
export function normCard(p, factions = new Map()) {
  if (!p) return null;
  const hist = p.history == null ? null : normHistory(p.history);
  const fac = factions.get(p.faction);
  let best = null;
  if (p.best) {
    const b = p.best; const d = b.deal ?? {};
    best = {
      price: num(b.price) ?? num(d.price), delivered: num(b.delivered) ?? num(d.total),
      retailerId: b.retailerId, retailerName: b.retailerName ?? b.retailerId, url: safeHttps(b.url),
      inStock: b.inStock ?? true, pctOff: num(b.pctOff) ?? num(d.pctOff), savings: num(b.savings) ?? num(d.savings),
      fetchedAt: b.fetchedAt ?? null, carried: !!b.carried,
      shipping: num(b.shipping) ?? num(d.shipping), tax: num(b.tax) ?? num(d.tax),
    };
  }
  const lowest = p.lowest ? {
    price: num(p.lowest.price) ?? num(p.lowest.p), date: p.lowest.date ?? p.lowest.t ?? null, retailerId: p.lowest.retailerId ?? p.lowest.r ?? null,
  } : null;
  const offers = Array.isArray(p.offers) ? p.offers.map(normOffer) : null;
  return {
    ...p,
    id: p.id, name: p.name, category: p.category, faction: p.faction,
    factionName: p.factionName ?? fac?.name ?? p.faction, factionColor: p.factionColor ?? fac?.color ?? null,
    imageUrl: safeHttps(p.imageUrl) ?? safeHttps(p.best?.imageUrl) ?? (offers?.find((o) => o.imageUrl)?.imageUrl ?? null),
    rrp: num(p.rrp) ?? num(p.msrp) ?? num(p.USD), rrpSource: p.rrpSource ?? (p.msrp != null ? 'catalogue' : null),
    rrpConf: p.rrpConf ?? p.conf ?? null,
    best,
    offerCount: num(p.offerCount) ?? offers?.length ?? 0,
    inStockCount: num(p.inStockCount) ?? offers?.filter((o) => o.inStock === true).length ?? 0,
    dealScore: num(p.dealScore) ?? num(p.best?.deal?.score), dealLabel: p.dealLabel ?? p.best?.deal?.label ?? null,
    lowest, atLowest: !!p.atLowest,
    change7d: p.change7d !== undefined ? p.change7d : change7dFrom(hist ?? [], best?.price ?? null),
    prevLow: p.prevLow ?? null,
    models: p.models ?? null, points: p.points ?? null, units: Array.isArray(p.units) ? p.units : [],
    history: hist, offers,
  };
}

function facetsFrom(products, factions, categories) {
  const fc = new Map(); const cc = new Map();
  for (const p of products) {
    fc.set(p.faction, (fc.get(p.faction) ?? 0) + 1);
    cc.set(p.category, (cc.get(p.category) ?? 0) + 1);
  }
  return {
    factions: factions.map((f) => ({ id: f.id, name: f.name, color: f.color, group: f.group, parent: f.parent ?? null, count: fc.get(f.id) ?? 0 })),
    categories: categories.map((c) => ({ id: c.id, name: c.name, blurb: c.blurb ?? null, count: cc.get(c.id) ?? 0 })),
  };
}

/* ------------------------------------------------------------------ overview (cached) */
const CACHE_TTL = 3 * 60_000;
const cacheKey = () => `cache.overview.v2.${STATIC ? 's' : 'a'}${demo ? 'd' : ''}`;
let overviewP = null;

/**
 * Overview with v2 fields guaranteed:
 *   { snapshot, home, stores, factions, categories, products: ProductCard[], byId: Map,
 *     facets, drops, newLows, topDeals: ProductCard[], hasPrices, disclaimer, assumptions }
 */
export function overview() {
  overviewP ??= (async () => {
    let raw = null;
    const cached = storage.get(cacheKey());
    if (cached && Date.now() - cached.at < CACHE_TTL && cached.data) raw = cached.data;
    if (!raw) {
      try {
        raw = await getJson('/api/prices/overview');
        if (!storage.set(cacheKey(), { at: Date.now(), data: raw })) storage.del(cacheKey());
      } catch (err) {
        if (err.status === 404) raw = null; else throw err;
      }
    }
    return shapeOverview(raw);
  })();
  overviewP.catch(() => { overviewP = null; });
  return overviewP;
}

function shapeOverview(raw) {
  const empty = !raw;
  raw ??= { snapshot: { generatedAt: null, demo: false, offers: 0 }, products: [], factions: [], categories: [], stores: [] };
  const factions = raw.facets?.factions?.length ? raw.facets.factions : (raw.factions ?? []);
  const fmap = new Map(factions.map((f) => [f.id, f]));
  const products = (raw.products ?? []).map((p) => normCard(p, fmap));
  const byId = new Map(products.map((p) => [p.id, p]));
  const facets = raw.facets?.factions?.length && raw.facets?.categories?.length
    ? { factions: raw.facets.factions, categories: raw.facets.categories.map((c) => ({ blurb: (raw.categories ?? []).find((x) => x.id === c.id)?.blurb ?? null, ...c })) }
    : facetsFrom(products, raw.factions ?? [], raw.categories ?? []);
  const hasPrices = !empty && products.some((p) => p.best);
  const pick = (list, fallback) => (Array.isArray(list) ? list.map((x) => byId.get(x?.id ?? x) ?? normCard(x, fmap)).filter(Boolean) : fallback());
  const priced = products.filter((p) => p.best && p.best.inStock !== false);
  const drops = pick(raw.drops, () => priced.filter((p) => p.change7d && p.change7d.pct <= -1)
    .sort((a, b) => a.change7d.pct - b.change7d.pct).slice(0, 12));
  const newLows = pick(raw.newLows, () => priced.filter((p) => p.atLowest && (p.history ?? []).length >= 3
    && p.history.slice(0, -1).some((h) => h.p > p.best.price + 0.005))
    .sort((a, b) => (b.best.pctOff ?? 0) - (a.best.pctOff ?? 0)).slice(0, 12));
  const topDeals = pick(raw.topDeals, () => [...priced].sort((a, b) => (b.dealScore ?? -1) - (a.dealScore ?? -1)).slice(0, 12));
  return {
    ...raw, empty, products, byId, facets, drops, newLows, topDeals, hasPrices,
    factions: raw.factions ?? factions, categories: raw.categories ?? facets.categories,
    factionById: new Map((raw.factions ?? factions).map((f) => [f.id, f])),
    categoryName: (id) => facets.categories.find((c) => c.id === id)?.name ?? (raw.categories ?? []).find((c) => c.id === id)?.name ?? id,
    stores: raw.stores ?? [],
    snapshot: raw.snapshot ?? { generatedAt: null, demo: false },
  };
}

/* ------------------------------------------------------------------ product */
/**
 * { product: ProductCard & {offers, history, related, rrpEvidence, blurb}, snapshot, derived }
 * `derived: true` when built from the overview because /product/:id is not deployed.
 */
export async function product(id) {
  try {
    const r = await getJson(`/api/prices/product/${encodeURIComponent(id)}`);
    const ov = await overview().catch(() => null);
    const fmap = ov?.factionById ?? new Map();
    const p = normCard(r.product, fmap);
    p.related = (r.product.related ?? []).map((x) => ov?.byId.get(x.id) ?? normCard(x, fmap));
    p.rrpEvidence = r.product.rrpEvidence ?? [];
    p.blurb = r.product.blurb ?? null;
    return { product: p, snapshot: r.snapshot ?? ov?.snapshot ?? {}, derived: false };
  } catch (err) {
    if (!err.missing && err.status !== 404) throw err;
    const ov = await overview();
    const base = ov.byId.get(id);
    if (!base) {
      // Maybe the server knows the id but has no overview entry: surface a clean 404.
      throw new ApiError(err.missing ? 'Unknown product' : err.message, 404);
    }
    const p = { ...base };
    p.offers = (base.offers ?? []).filter(Boolean);
    p.related = relatedFor(base, ov.products);
    p.rrpEvidence = base.rrp != null ? [{ source: base.rrpSource ?? 'catalogue', price: base.rrp, retailerId: null }] : [];
    p.blurb = base.note ?? null;
    return { product: p, snapshot: ov.snapshot, derived: true };
  }
}

export function relatedFor(p, products) {
  const score = (x) => (x.faction === p.faction ? 2 : 0) + (x.category === p.category ? 1 : 0) + (x.best ? 0.5 : 0) + (x.dealScore ?? 0) / 1000;
  return products.filter((x) => x.id !== p.id && (x.faction === p.faction || x.category === p.category))
    .sort((a, b) => score(b) - score(a)).slice(0, 8);
}

/* ------------------------------------------------------------------ faction */
export async function faction(id) {
  try {
    const r = await getJson(`/api/prices/faction/${encodeURIComponent(id)}`);
    const ov = await overview().catch(() => null);
    const fmap = ov?.factionById ?? new Map();
    return { faction: r.faction, products: (r.products ?? []).map((x) => ov?.byId.get(x.id) ?? normCard(x, fmap)), derived: false };
  } catch (err) {
    if (!err.missing && err.status !== 404) throw err;
    const ov = await overview();
    const f = ov.factionById.get(id);
    if (!f) throw new ApiError('Unknown faction', 404);
    const kids = new Set(ov.factions.filter((x) => x.parent === id).map((x) => x.id));
    return { faction: f, products: ov.products.filter((p) => p.faction === id || kids.has(p.faction)), derived: true };
  }
}

/* ------------------------------------------------------------------ cart + army */
export const cart = (items, shipping) => postJson('/api/prices/cart', { items, shipping, demo: demo || undefined });

/**
 * Army list pricer. Falls back to a small client-side parser + /cart when
 * POST /api/prices/army is not deployed yet.
 */
export async function army(list, owned = {}) {
  try {
    return { ...(await postJson('/api/prices/army', { list, owned, demo: demo || undefined })), derived: false };
  } catch (err) {
    if (!err.missing) throw err;
    const { armyFallback } = await import('./army-fallback.js');
    return { ...(await armyFallback(list, owned)), derived: true };
  }
}

/* ------------------------------------------------------------------ misc */
let catalogP = null;
export function catalog() {
  catalogP ??= getJson('/api/prices/catalog');
  catalogP.catch(() => { catalogP = null; });
  return catalogP;
}
let retailersP = null;
export function retailers() {
  retailersP ??= getJson('/api/prices/retailers');
  retailersP.catch(() => { retailersP = null; });
  return retailersP;
}
let unitsP = null;
/** Brief combat unit list (~200 KB), loaded only when a page or the palette needs it. */
export function unitsBrief() {
  unitsP ??= getJson('/api/combat/units?view=brief').then((r) => r.units ?? []);
  unitsP.catch(() => { unitsP = null; });
  return unitsP;
}
// The RSS file is served at the same relative path by the server and the static build.
export const feedUrl = () => 'data/deals.xml';
export { STATIC };
