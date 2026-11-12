// Cart optimizer: given several products (with quantities) and the offers for
// each, find the cheapest way to split the order across stores once each
// store's shipping rule (flat rate / free-shipping threshold), sales tax and
// import duty are counted. Sometimes consolidating at one store to clear its
// free-shipping threshold beats buying every item where it is cheapest.
//
// Exact branch-and-bound search with a deterministic order; falls back to the
// best plan found so far (flagged exact:false) if the search grows too large.
// Browser-safe (copied into the static build's lib/).
import { orderCost, IMPORT_US, collectsTax } from './deals.js';
import { getRetailer } from './retailers.js';
import { HOME } from './location.js';

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {object} o
 * @param {{id:string, name?:string, qty?:number}[]} o.items
 * @param {Record<string, {retailerId:string, price:number, url?:string, title?:string}[]>} o.offers
 *        usable offers per item id, `price` per unit in the home currency
 *        (caller filters out out-of-stock / suspicious listings)
 * @param {object} [o.overrides]  shipping overrides per retailer ({flat, freeOver})
 * @returns {{plan, total, unavailable, comparisons, exact, nodes, currency}}
 */
export function optimizeCart({ items, offers, home = HOME, overrides = {}, maxNodes = 250_000 }) {
  const unavailable = [];
  const rows = [];
  for (const it of items ?? []) {
    const qty = Math.max(1, Math.min(99, Math.floor(Number(it.qty) || 1)));
    // Cheapest listing per store for this item.
    const per = new Map();
    for (const o of offers?.[it.id] ?? []) {
      if (!(o && Number.isFinite(o.price) && o.price > 0 && getRetailer(o.retailerId))) continue;
      const cur = per.get(o.retailerId);
      if (!cur || o.price < cur.price || (o.price === cur.price && String(o.url) < String(cur.url))) per.set(o.retailerId, o);
    }
    if (!per.size) { unavailable.push({ id: it.id, name: it.name ?? it.id, qty }); continue; }
    rows.push({ id: it.id, name: it.name ?? it.id, qty, per });
  }
  const retailers = [...new Set(rows.flatMap((r) => [...r.per.keys()]))].sort();
  const R = retailers.length;
  const idx = new Map(retailers.map((id, i) => [id, i]));
  // Proportional cost rate per store (tax + duty) for the lower bound.
  const rate = retailers.map((id) => {
    const r = getRetailer(id);
    return 1 + (collectsTax(r, home) ? home.salesTaxRate : 0) + (r.region !== home.region ? IMPORT_US[r.region]?.rate ?? 0 : 0);
  });
  // Options per item: [storeIndex, lineCost]. Sorted cheapest first (deterministic).
  for (const row of rows) {
    row.opts = [...row.per.entries()].map(([id, o]) => [idx.get(id), o.price * row.qty])
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    row.minLb = Math.min(...row.opts.map(([s, c]) => c * rate[s]));
  }
  // Expensive / most-contested items first: better pruning.
  rows.sort((a, b) => b.opts[0][1] - a.opts[0][1] || a.id.localeCompare(b.id));
  const restLb = new Array(rows.length + 1).fill(0);
  for (let i = rows.length - 1; i >= 0; i--) restLb[i] = restLb[i + 1] + rows[i].minLb;

  const costOf = (subs) => {
    let t = 0;
    for (let s = 0; s < R; s++) if (subs[s] > 0) t += orderCost(retailers[s], subs[s], { home, overrides }).total;
    return t;
  };
  const evalAssign = (assign) => {
    const subs = new Array(R).fill(0);
    rows.forEach((row, i) => { subs[assign[i]] += row.opts.find(([s]) => s === assign[i])[1]; });
    return costOf(subs);
  };

  // Starting plans: every item at its cheapest store; everything at one store.
  let bestAssign = rows.map((row) => row.opts[0][0]);
  let bestCost = evalAssign(bestAssign);
  const naiveCost = bestCost;
  const single = [];
  for (let s = 0; s < R; s++) {
    if (!rows.every((row) => row.per.has(retailers[s]))) { single.push({ retailerId: retailers[s], total: null }); continue; }
    const a = rows.map(() => s);
    const c = evalAssign(a);
    single.push({ retailerId: retailers[s], total: r2(c) });
    if (c < bestCost - 1e-9) { bestCost = c; bestAssign = a; }
  }

  // Branch and bound. Lower bound: goods + tax/duty so far + cheapest possible rest
  // (shipping only ever adds, so it is left out of the bound).
  let nodes = 0; let exact = true;
  const subs = new Array(R).fill(0);
  const assign = new Array(rows.length);
  const dutyFee = retailers.map((id) => { const r = getRetailer(id); return r.region !== home.region ? IMPORT_US[r.region]?.fee ?? 0 : 0; });
  const partialLb = () => {
    let t = 0;
    for (let s = 0; s < R; s++) if (subs[s] > 0) t += subs[s] * rate[s] + dutyFee[s];
    return t;
  };
  (function dfs(i) {
    if (!exact) return;
    if (++nodes > maxNodes) { exact = false; return; }
    if (i === rows.length) {
      const c = costOf(subs);
      if (c < bestCost - 1e-9) { bestCost = c; bestAssign = assign.slice(); }
      return;
    }
    if (partialLb() + restLb[i] >= bestCost - 1e-9) return;
    for (const [s, c] of rows[i].opts) {
      subs[s] += c; assign[i] = s;
      dfs(i + 1);
      subs[s] -= c;
    }
  }(0));

  // Build the plan.
  const groups = new Map();
  rows.forEach((row, i) => {
    const s = bestAssign[i]; const id = retailers[s]; const o = row.per.get(id);
    if (!groups.has(id)) groups.set(id, { retailerId: id, items: [], goods: 0 });
    const g = groups.get(id);
    g.items.push({ id: row.id, name: row.name, qty: row.qty, unitPrice: r2(o.price), lineTotal: r2(o.price * row.qty),
      url: o.url ?? null, title: o.title ?? null });
    g.goods += o.price * row.qty;
  });
  const plan = [...groups.values()].sort((a, b) => a.retailerId.localeCompare(b.retailerId)).map((g) => {
    const cost = orderCost(g.retailerId, g.goods, { home, overrides });
    g.items.sort((a, b) => a.name.localeCompare(b.name));
    return { retailerId: g.retailerId, retailerName: getRetailer(g.retailerId)?.name ?? g.retailerId, items: g.items, ...cost };
  });
  const total = r2(plan.reduce((t, g) => t + g.total, 0));
  const bestSingle = single.filter((x) => x.total != null).sort((a, b) => a.total - b.total)[0] ?? null;
  return {
    currency: home.currency,
    plan, total,
    unavailable,
    exact, nodes,
    comparisons: {
      cheapestEach: r2(naiveCost),        // each item where its sticker price is lowest
      savedVsCheapestEach: r2(naiveCost - total),
      singleStore: single,
      bestSingleStore: bestSingle,
    },
    goods: r2(plan.reduce((t, g) => t + g.subtotal, 0)),
    shipping: r2(plan.reduce((t, g) => t + g.shipping, 0)),
    tax: r2(plan.reduce((t, g) => t + g.tax + g.duty, 0)),
    estimate: true,
  };
}
