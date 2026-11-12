// Small rolling price history kept inside the published snapshot: for each
// catalogue product, the best in-stock price (home currency) per refresh day,
// last HISTORY_MAX_POINTS points, plus the lowest price ever seen.
//
//   history: { [productId]: [[isoTime, price, retailerId], ...] }   oldest first
//   lowest:  { [productId]: [isoTime, price, retailerId] }
//
// Browser-safe (the static site reads it; the snapshot script writes it).
import { checkOffer } from './trust.js';
import { productIdForTitle, findMsrp, msrpIn } from './msrp.js';
import { productById } from './catalog.js';
import { convert } from './currency.js';
import { SUSPICIOUS_RATIO } from './trust.js';
import { HOME } from './location.js';

export const HISTORY_MAX_POINTS = 30;

/**
 * Best trusted, in-stock, non-suspicious price per catalogue product.
 * @returns {Record<string, {p:number, r:string}>}
 */
export function bestPricesByProduct(offers, { home = HOME } = {}) {
  const out = {};
  for (const o of offers ?? []) {
    if (o?.inStock !== true || !checkOffer({ ...o }).ok) continue;
    const id = o.productId && productById(o.productId) ? o.productId : productIdForTitle(o.title);
    if (!id) continue;
    const p = convert(o.price, o.currency, home.currency);
    if (p == null) continue;
    const msrp = msrpIn(findMsrp(o.title) ?? productById(id), o.currency);
    if (msrp && o.price < msrp * SUSPICIOUS_RATIO) continue;
    if (!out[id] || p < out[id].p || (p === out[id].p && o.retailerId < out[id].r)) out[id] = { p, r: o.retailerId };
  }
  return out;
}

/** Keep only well-formed points for known products, oldest first, at most `max` each. */
export function trimHistory(history, { max = HISTORY_MAX_POINTS } = {}) {
  const out = {};
  for (const [id, pts] of Object.entries(history ?? {})) {
    if (!productById(id) || !Array.isArray(pts)) continue;
    const ok = pts.filter((x) => Array.isArray(x) && typeof x[0] === 'string' && Number.isFinite(x[1]) && x[1] > 0)
      .sort((a, b) => a[0].localeCompare(b[0]));
    if (ok.length) out[id] = ok.slice(-max);
  }
  return out;
}

/**
 * Add this refresh's best prices to the history. One point per product per
 * calendar day (a second refresh the same day replaces that day's point).
 * @param {{history?:object, lowest?:object}} prev  previous snapshot (or {})
 * @param {Record<string,{p:number,r:string}>} points  from bestPricesByProduct
 * @param {string} t  ISO time of this refresh
 */
export function mergeHistory(prev, points, t, { max = HISTORY_MAX_POINTS } = {}) {
  const history = trimHistory(prev?.history, { max: Infinity });
  const lowest = {};
  for (const [id, v] of Object.entries(prev?.lowest ?? {})) {
    if (productById(id) && Array.isArray(v) && Number.isFinite(v[1])) lowest[id] = v;
  }
  for (const [id, { p, r }] of Object.entries(points)) {
    if (!productById(id)) continue;
    const pts = history[id] ?? (history[id] = []);
    const last = pts[pts.length - 1];
    const point = [t, Math.round(p * 100) / 100, r];
    if (last && last[0].slice(0, 10) === t.slice(0, 10)) pts[pts.length - 1] = point; else pts.push(point);
    if (!lowest[id] || point[1] < lowest[id][1]) lowest[id] = point;
  }
  return { history: trimHistory(history, { max }), lowest };
}
