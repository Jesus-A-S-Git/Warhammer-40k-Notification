// RRP (recommended retail price) for a product, from two kinds of evidence:
//
//   'retailer-list'  the list / "compare at" / "retail price" figure that trusted
//                    stores print next to their selling price (Shopify
//                    compare_at_price, Miniature Market "Retail Price"). This is the
//                    store quoting Games Workshop's current RRP, so when it is
//                    corroborated it beats our own estimate.
//   'catalogue'      the approximate figure hand-entered in catalog.js (may be null
//                    for kits we have no reliable figure for).
//
// Rules (deliberately conservative):
//   * only stores in the home region quoting in the home currency count (a UK
//     store's GBP list price is not the US RRP);
//   * >= 2 stores agreeing within LIST_AGREE (3%)              -> their median, conf 'high'
//   * 1 store (or stores that disagree) within CAT_AGREE (10%)
//     of the catalogue estimate                                 -> that list price, conf 'high'
//   * 1 store, within CAT_PLAUSIBLE (40%) of the catalogue      -> list price, conf 'medium'
//     (GW raises prices; the store's figure is usually newer than ours)
//   * 1 store and no catalogue figure                           -> list price, conf 'medium'
//   * several stores that disagree and no catalogue figure      -> median, conf 'low'
//   * otherwise the catalogue estimate with its own conf, or null.
// Browser-safe.
import { convert } from './currency.js';
import { HOME } from './location.js';
import { getRetailer } from './retailers.js';
import { msrpIn } from './msrp.js';

export const LIST_AGREE = 0.03;
export const CAT_AGREE = 0.10;
export const CAT_PLAUSIBLE = 0.40;

const r2 = (n) => Math.round(n * 100) / 100;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : r2((s[m - 1] + s[m]) / 2);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(a, b);

/**
 * @param {object} entry   catalogue entry
 * @param {object[]} offers trusted offers already matched to this product
 *                          ({retailerId, currency, listPrice?})
 * @returns {{rrp:number|null, rrpSource:'retailer-list'|'catalogue'|null,
 *            rrpConf:'high'|'medium'|'low'|null,
 *            evidence:{source:string, price:number, retailerId:string|null}[]}}
 */
export function resolveRrp(entry, offers, { home = HOME } = {}) {
  const cat = msrpIn(entry, home.currency);
  // One list price per store (median of its listings for this product).
  const per = new Map();
  for (const o of offers ?? []) {
    if (!Number.isFinite(o?.listPrice) || o.listPrice <= 0) continue;
    const r = getRetailer(o.retailerId);
    if (!r || r.region !== home.region || o.currency !== home.currency) continue;
    const v = convert(o.listPrice, o.currency, home.currency);
    if (v == null) continue;
    if (!per.has(r.id)) per.set(r.id, []);
    per.get(r.id).push(v);
  }
  const lists = [...per.entries()].map(([retailerId, vs]) => ({ retailerId, price: r2(median(vs)) }))
    .sort((a, b) => a.retailerId.localeCompare(b.retailerId));
  const evidence = [
    ...lists.map((l) => ({ source: 'retailer-list', price: l.price, retailerId: l.retailerId })),
    ...(cat != null ? [{ source: 'catalogue', price: cat, retailerId: null }] : []),
  ];
  const out = (rrp, rrpSource, rrpConf) => ({ rrp: rrp == null ? null : r2(rrp), rrpSource, rrpConf, evidence });

  if (lists.length >= 2) {
    // Largest group of stores agreeing with each other.
    let group = [];
    for (const a of lists) {
      const g = lists.filter((b) => near(a.price, b.price, LIST_AGREE));
      if (g.length > group.length) group = g;
    }
    if (group.length >= 2) return out(median(group.map((g) => g.price)), 'retailer-list', 'high');
  }
  if (lists.length && cat != null) {
    const byGap = [...lists].sort((a, b) => Math.abs(a.price - cat) - Math.abs(b.price - cat));
    if (near(byGap[0].price, cat, CAT_AGREE)) return out(byGap[0].price, 'retailer-list', 'high');
    if (lists.length === 1 && near(byGap[0].price, cat, CAT_PLAUSIBLE)) return out(byGap[0].price, 'retailer-list', 'medium');
  }
  if (lists.length && cat == null) {
    return lists.length === 1 ? out(lists[0].price, 'retailer-list', 'medium')
      : out(median(lists.map((l) => l.price)), 'retailer-list', 'low');
  }
  if (cat != null) return out(cat, 'catalogue', entry?.conf ?? 'low');
  return out(null, null, null);
}
