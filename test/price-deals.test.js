// Deal Finder: delivered-cost estimates, deal scores, matching exclusions, cart
// optimizer, price history, snapshot planning/collection and the overview API.
// No live network: adapters are fakes and politeFetch is stubbed to fail loudly.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { __setFetch, __reset } from '../src/shared/httpClient.js';
import { orderCost, offerDeal, dealScore, dealLabel, shippingRule, SHIPPING_US } from '../src/price/deals.js';
import { optimizeCart } from '../src/price/cart.js';
import { mergeHistory, trimHistory, bestPricesByProduct, HISTORY_MAX_POINTS } from '../src/price/history.js';
import { isMatch, exclusionReason, cleanTitle } from '../src/price/match.js';
import { findMsrp, productIdForTitle } from '../src/price/msrp.js';
import { CATALOG, CATEGORIES, FACTIONS, productById } from '../src/price/catalog.js';
import { rankOffers } from '../src/price/rank.js';
import { buildOverview, planCart, sanitizeOverrides } from '../src/price/overview.js';
import { planQueries, collectLive, carryOver, buildSnapshot, buildDemoSnapshot } from '../src/price/snapshot.js';
import { getRetailer } from '../src/price/retailers.js';
import { HOME } from '../src/price/location.js';
import { __resetSearchLimiter } from '../src/price/routes.js';
import { __resetSnapshotCache } from '../src/price/snapshotStore.js';
import { createApp } from '../src/server.js';

beforeEach(() => {
  __reset(); __resetSearchLimiter(); __resetSnapshotCache();
  __setFetch(async (u) => { throw new Error(`unexpected network call in test: ${u}`); });
});
after(() => __reset());

const TAX = HOME.salesTaxRate;
const r2 = (n) => Math.round(n * 100) / 100;

// ---- shipping / tax / duty ------------------------------------------------------
test('orderCost: flat shipping below the threshold, free above, WA tax on goods + shipping', () => {
  const mm = SHIPPING_US['miniature-market'];
  const below = orderCost('miniature-market', 50);
  assert.equal(below.shipping, mm.flat);
  assert.equal(below.tax, r2((50 + mm.flat) * TAX));
  assert.equal(below.total, r2(50 + mm.flat + (50 + mm.flat) * TAX));
  assert.equal(below.toFree, r2(mm.freeOver - 50));
  assert.equal(below.duty, 0);
  assert.equal(below.estimate, true);
  const above = orderCost('miniature-market', mm.freeOver);
  assert.equal(above.shipping, 0);
  assert.equal(above.toFree, 0);
  assert.equal(orderCost('miniature-market', 0).total, 0);
});

test('orderCost: overseas stores charge no WA sales tax but add shipping and import duty', () => {
  const uk = orderCost('element-games', 100);
  assert.equal(uk.tax, 0);
  assert.equal(uk.collectsTax, false);
  assert.ok(uk.shipping >= 20, 'international shipping estimate');
  assert.equal(uk.duty, r2(100 * 0.10 + 10));
  assert.ok(uk.dutyNote);
  const eu = orderCost('fantasywelt', 100);
  assert.equal(eu.duty, r2(100 * 0.15 + 10));
});

test('shipping overrides replace the estimate; null freeOver means never free', () => {
  const r = shippingRule('wargame-portal', { 'wargame-portal': { flat: 5, freeOver: 60 } });
  assert.deepEqual([r.flat, r.freeOver, r.overridden], [5, 60, true]);
  assert.equal(orderCost('wargame-portal', 70, { overrides: { 'wargame-portal': { freeOver: 60 } } }).shipping, 0);
  assert.equal(orderCost('wargame-portal', 500, { overrides: { 'wargame-portal': { freeOver: null } } }).shipping,
    SHIPPING_US['wargame-portal'].flat);
  assert.deepEqual(sanitizeOverrides({ 'wargame-portal': { flat: '4.5', freeOver: -3 }, nope: { flat: 1 }, x: 3 }),
    { 'wargame-portal': { flat: 4.5, freeOver: 0 } });
});

// ---- deal score ---------------------------------------------------------------
test('deal score: 0 at ~5% over RRP+tax, 100 at 30%+ under, stock/suspicious/caution adjust', () => {
  const base = 100 * (1 + TAX);
  assert.equal(dealScore({ total: base * 1.05, msrpHome: 100 }), 0);
  assert.equal(dealScore({ total: base * 0.70, msrpHome: 100 }), 100);
  assert.equal(dealScore({ total: base * 0.60, msrpHome: 100 }), 100);
  const mid = dealScore({ total: base * 0.85, msrpHome: 100 });
  assert.equal(mid, 57);
  assert.equal(dealScore({ total: base * 0.85, msrpHome: 100, inStock: false }), Math.round(57.14 * 0.4));
  assert.equal(dealScore({ total: base * 0.85, msrpHome: 100, inStock: null }), Math.round(57.142857 * 0.85));
  assert.equal(dealScore({ total: base * 0.85, msrpHome: 100, caution: true }), 52);
  assert.equal(dealScore({ total: base * 0.5, msrpHome: 100, suspicious: true }), 0);
  assert.equal(dealScore({ total: 50, msrpHome: null }), null);
  // Small kits: the RRP baseline includes typical shipping, so 15% off + $9.99 shipping still scores.
  const small = offerDeal({ retailerId: 'wargame-portal', price: 51, currency: 'USD', inStock: true }, 60);
  assert.ok(small.score >= 40 && small.score <= 60, String(small.score));
  assert.deepEqual([90, 60, 35, 5, null].map(dealLabel), ['Great deal', 'Good deal', 'Fair', 'Poor', null]);
});

test('offerDeal: % off RRP, savings and delivered total in USD', () => {
  const d = offerDeal({ retailerId: 'miniature-market', price: 136, currency: 'USD', inStock: true }, 170);
  assert.equal(d.pctOff, 20);
  assert.equal(d.savings, 34);
  assert.equal(d.shipping, 0); // over the free-shipping threshold
  assert.equal(d.total, r2(136 * (1 + TAX)));
  assert.ok(Math.abs(d.effectiveSavings - (170 * (1 + TAX) - d.total)) < 0.02);
  assert.ok(d.score > 55 && d.label === 'Good deal');
});

test('ranking: best = lowest delivered total, so free shipping can beat a lower sticker price', () => {
  const mk = (retailerId, host, price) => ({ retailerId, __source: retailerId, title: 'Space Marines Intercessors',
    price, currency: 'USD', inStock: true, url: `https://${host}/i` });
  // $95 at a store whose threshold is $99 pays $8.99 shipping; $99.50 ships free.
  const out = rankOffers({ query: 'intercessors', region: 'US', currency: 'USD', candidates: [
    mk('wargame-portal', 'wargameportal.com', 95),
    mk('miniature-market', 'www.miniaturemarket.com', 99.5),
  ], shippingOverrides: { 'wargame-portal': { flat: 8.99, freeOver: 99 } } });
  assert.equal(out.results[0].price, 95, 'results stay sorted by price');
  assert.equal(out.best.retailerId, 'miniature-market');
  assert.ok(out.best.deal.total < out.results[0].deal.total);
  assert.equal(out.best.productId, 'space-marines-intercessors');
});

// ---- matching ---------------------------------------------------------------------
test('matching: edition/word-order variants match; used, bits, 3rd-party, bundles do not', () => {
  const q = 'Combat Patrol: Necrons';
  for (const t of ['Combat Patrol: Necrons', 'Necrons Combat Patrol', 'Combat Patrol - Necrons (2023)',
    'Warhammer 40,000: Necrons Combat Patrol 10th Edition', 'WH40K Combat Patrol | Necrons', 'Combat Patrol: Necrons (English)']) {
    assert.ok(isMatch(q, t), t);
    assert.equal(productIdForTitle(t), 'combat-patrol-necrons', t);
  }
  const bad = {
    'Used - Combat Patrol: Necrons': 'not-new-or-official',
    'Combat Patrol: Necrons (pre-owned, partially painted)': 'not-new-or-official',
    'Necron Warriors bits - 5 torsos': 'not-new-or-official',
    'Necron Warriors Upgrade Sprue': 'not-new-or-official',
    'Necron Warriors compatible 3D printed proxy': 'not-new-or-official',
    'Combat Patrol: Necrons + Codex Bundle': 'bundle',
    'Necrons Dice Set': 'non-kit',
  };
  for (const [t, why] of Object.entries(bad)) {
    const query = /Warriors/.test(t) ? 'Necron Warriors' : q;
    assert.equal(isMatch(query, t), false, t);
    assert.equal(exclusionReason(query, t), why, t);
    assert.equal(productIdForTitle(t), null, t);
  }
  assert.ok(isMatch('Necron Warriors', 'Necron Warriors (unassembled)'), '"unassembled" is not "assembled"');
  assert.ok(isMatch('space marines bundle', 'Space Marines Army Bundle'), 'asked for a bundle');
});

test('matching: chapters and Chaos are different products', () => {
  assert.equal(isMatch('Combat Patrol: Space Marines', 'Space Marines - Blood Angels Combat Patrol'), false);
  assert.equal(productIdForTitle('Space Marines - Blood Angels Combat Patrol'), 'combat-patrol-blood-angels');
  assert.ok(isMatch('Combat Patrol: Blood Angels', 'Space Marines: Blood Angels Combat Patrol'));
  assert.ok(isMatch('Deathwing Knights', 'Dark Angels - Deathwing Knights'), 'no faction in query: chapter is fine');
  assert.equal(productIdForTitle('Chaos Space Marines: Chaos Terminators'), 'chaos-space-marines-chaos-terminators');
  assert.equal(productIdForTitle('Space Marines Terminator Squad'), 'space-marines-terminators');
  assert.equal(productIdForTitle('Space Marines Battleforce: Ultramarines Strike Force'), 'space-marines-battleforce');
  assert.equal(productIdForTitle('Warhammer 40,000: Ultimate Starter Set'), 'warhammer-40000-ultimate-starter-set');
  assert.equal(productIdForTitle('Warhammer 40,000 Starter Set'), 'warhammer-40000-starter-set');
  assert.equal(productIdForTitle('Combat Patrol Tau'), 'combat-patrol-tau-empire');
  assert.equal(cleanTitle('Warhammer 40,000: Space Marines Combat Patrol (2023) - 10th Edition'), 'Space Marines Combat Patrol');
  assert.equal(findMsrp('combat patrol'), null, 'vague query names no product');
  assert.equal(findMsrp('codex'), null);
});

test('catalogue: every faction with a Combat Patrol, categories, ids unique, sane RRPs', () => {
  const ids = new Set(CATALOG.map((e) => e.id));
  assert.equal(ids.size, CATALOG.length);
  assert.ok(CATALOG.length >= 100);
  const cats = new Set(CATEGORIES.map((c) => c.id));
  const facs = new Set(FACTIONS.map((f) => f.id));
  for (const e of CATALOG) {
    assert.ok(cats.has(e.category) && facs.has(e.faction), e.id);
    assert.ok(e.USD > 0 && e.GBP > 0 && e.EUR > 0 && e.approximate, e.id);
    assert.ok(['medium', 'low'].includes(e.conf), e.id);
    assert.equal(findMsrp(e.name)?.id, e.id, `${e.name} maps to itself`);
  }
  const cps = CATALOG.filter((e) => e.category === 'combat-patrol').length;
  assert.ok(cps >= 24, `${cps} combat patrols`);
});

// ---- cart optimizer --------------------------------------------------------------------
const OV = { A: { 'miniature-market': { flat: 10, freeOver: 100 }, 'wargame-portal': { flat: 10, freeOver: 100 },
  'discount-games-inc': { flat: 10, freeOver: 100 } } };

test('cart: consolidating to clear a free-shipping threshold beats the cheapest-each split', () => {
  const offers = {
    a: [{ retailerId: 'miniature-market', price: 60 }, { retailerId: 'wargame-portal', price: 58 }],
    b: [{ retailerId: 'miniature-market', price: 45 }, { retailerId: 'discount-games-inc', price: 44 }],
  };
  const res = optimizeCart({ items: [{ id: 'a' }, { id: 'b' }], offers, overrides: OV.A });
  // Cheapest each: 58 @WP + 44 @DGI, both below $100 -> 2x $10 shipping.
  const each = r2((58 + 10) * (1 + TAX)) + r2((44 + 10) * (1 + TAX));
  assert.equal(res.comparisons.cheapestEach, r2(each));
  // Consolidated at MM: 105 -> free shipping.
  assert.equal(res.plan.length, 1);
  assert.equal(res.plan[0].retailerId, 'miniature-market');
  assert.equal(res.total, r2(105 * (1 + TAX)));
  assert.ok(res.comparisons.savedVsCheapestEach > 0);
  assert.equal(res.exact, true);
});

test('cart: splitting wins when each store is already over its threshold; qty and unavailable items', () => {
  const offers = {
    a: [{ retailerId: 'miniature-market', price: 120 }, { retailerId: 'wargame-portal', price: 150 }],
    b: [{ retailerId: 'miniature-market', price: 140 }, { retailerId: 'wargame-portal', price: 110 }],
  };
  const res = optimizeCart({ items: [{ id: 'a', qty: 2 }, { id: 'b' }, { id: 'zzz', name: 'Nothing' }], offers, overrides: OV.A });
  assert.deepEqual(res.plan.map((g) => g.retailerId), ['miniature-market', 'wargame-portal']);
  assert.equal(res.plan[0].items[0].qty, 2);
  assert.equal(res.plan[0].subtotal, 240);
  assert.equal(res.total, r2(r2(240 * (1 + TAX)) + r2(110 * (1 + TAX))));
  assert.deepEqual(res.unavailable.map((u) => u.id), ['zzz']);
});

test('cart: matches brute force on random baskets and is deterministic', () => {
  const stores = ['miniature-market', 'wargame-portal', 'discount-games-inc'];
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let trial = 0; trial < 25; trial++) {
    const n = 2 + Math.floor(rnd() * 5);
    const items = []; const offers = {};
    for (let i = 0; i < n; i++) {
      items.push({ id: `i${i}`, qty: 1 + Math.floor(rnd() * 2) });
      offers[`i${i}`] = stores.filter(() => rnd() > 0.2).map((s) => ({ retailerId: s, price: Math.round(20 + rnd() * 60) }));
      if (!offers[`i${i}`].length) offers[`i${i}`] = [{ retailerId: stores[0], price: 30 }];
    }
    const res = optimizeCart({ items, offers, overrides: OV.A });
    // Brute force.
    let best = Infinity;
    const rec = (k, subs) => {
      if (k === n) {
        best = Math.min(best, Object.entries(subs).reduce((t, [s, v]) => t + (v > 0 ? orderCost(s, v, { overrides: OV.A }).total : 0), 0));
        return;
      }
      for (const o of offers[`i${k}`]) { subs[o.retailerId] = (subs[o.retailerId] ?? 0) + o.price * items[k].qty; rec(k + 1, subs); subs[o.retailerId] -= o.price * items[k].qty; }
    };
    rec(0, {});
    assert.ok(Math.abs(res.total - best) < 0.02, `trial ${trial}: ${res.total} vs ${best}`);
    assert.deepEqual(optimizeCart({ items, offers, overrides: OV.A }), res);
  }
});

test('cart: node cap returns the best plan found and says it is not proven optimal', () => {
  const offers = {}; const items = [];
  for (let i = 0; i < 14; i++) {
    items.push({ id: `i${i}` });
    offers[`i${i}`] = ['miniature-market', 'wargame-portal', 'discount-games-inc'].map((s, k) => ({ retailerId: s, price: 30 + ((i * 7 + k * 3) % 11) }));
  }
  const res = optimizeCart({ items, offers, maxNodes: 50 });
  assert.equal(res.exact, false);
  assert.ok(res.total > 0 && res.total <= res.comparisons.cheapestEach + 1e-9);
});

// ---- history ------------------------------------------------------------------------------
test('history: one point per day, trimmed to the last N, lowest kept after trimming', () => {
  let h = {};
  const id = 'combat-patrol-necrons';
  for (let d = 0; d < 40; d++) {
    const day = new Date(Date.UTC(2026, 0, 1 + d, 12)).toISOString();
    h = mergeHistory(h, { [id]: { p: d === 3 ? 100 : 140 - (d % 5), r: 'miniature-market' } }, day);
  }
  assert.equal(h.history[id].length, HISTORY_MAX_POINTS);
  assert.equal(h.history[id][0][0].slice(0, 10), '2026-01-11');
  assert.deepEqual(h.lowest[id].slice(1), [100, 'miniature-market'], 'all-time low survives trimming');
  // Same-day refresh replaces that day's point.
  const last = h.history[id].at(-1)[0];
  const h2 = mergeHistory(h, { [id]: { p: 120, r: 'wargame-portal' } }, last.replace('12:00', '18:00'));
  assert.equal(h2.history[id].length, HISTORY_MAX_POINTS);
  assert.equal(h2.history[id].at(-1)[1], 120);
  // Garbage and unknown products are dropped.
  assert.deepEqual(trimHistory({ nope: [['2026-01-01', 1]], [id]: [['x', -1], 'bad', ['2026-01-02T00:00:00Z', 5, 'r']] }),
    { [id]: [['2026-01-02T00:00:00Z', 5, 'r']] });
});

test('history: best price per product ignores out-of-stock, untrusted and suspicious listings', () => {
  const o = (title, price, extra = {}) => ({ retailerId: 'miniature-market', title, price, currency: 'USD', inStock: true,
    url: `https://www.miniaturemarket.com/${price}`, ...extra });
  const best = bestPricesByProduct([
    o('Combat Patrol: Necrons', 140), o('Combat Patrol: Necrons', 120, { inStock: false }),
    o('Combat Patrol: Necrons', 50), // suspicious (< 55% of RRP)
    o('Combat Patrol: Necrons', 100, { url: 'https://evil.example/x' }),
    o('Necrons Combat Patrol', 135, { retailerId: 'wargame-portal', url: 'https://wargameportal.com/cp' }),
  ]);
  assert.deepEqual(best, { 'combat-patrol-necrons': { p: 135, r: 'wargame-portal' } });
});

// ---- snapshot ------------------------------------------------------------------------------
test('snapshot plan: de-duplicated, stale products first, paints skipped', () => {
  const q = planQueries();
  const keys = q.map((x) => x.query.toLowerCase());
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(q.length >= CATALOG.length - 5);
  assert.ok(!q.some((x) => productById(x.productId)?.category === 'paint'));
  const prev = { offers: CATALOG.filter((e) => e.id !== 'necron-lychguard')
    .map((e) => ({ title: e.name, productId: e.id, fetchedAt: '2026-11-01T00:00:00Z' })) };
  assert.equal(planQueries({ previous: prev })[0].productId, 'necron-lychguard', 'never-fetched product goes first');
});

function fakeFactory(behaviour) {
  const calls = [];
  return { calls, factory: (r) => ({ async search(q) { calls.push([r.id, q]); return behaviour(r, q, calls); } }) };
}

test('snapshot collect: one queue per store, covered products skipped, refusing store stopped, caps respected', async () => {
  const retailers = ['miniature-market', 'discount-games-inc', 'wargame-portal'].map(getRetailer);
  const { calls, factory } = fakeFactory((r, q) => {
    if (r.id === 'discount-games-inc') { const e = new Error('403'); e.code = 'REFUSED'; throw e; }
    if (r.id === 'miniature-market' && /combat patrol/i.test(q)) {
      // A broad answer: every Combat Patrol at once.
      return CATALOG.filter((e) => e.category === 'combat-patrol').map((e) => ({ title: e.name, price: 140,
        currency: 'USD', inStock: true, url: `https://www.miniaturemarket.com/${e.id}` }));
    }
    return [];
  });
  const res = await collectLive({ retailers, factory, maxQueriesPerRetailer: 30 });
  const by = (id) => calls.filter(([r]) => r === id).length;
  assert.equal(by('discount-games-inc'), 1, 'refused store is not asked again');
  assert.match(res.stores.find((s) => s.id === 'discount-games-inc').stoppedReason, /refused/i);
  assert.ok(by('wargame-portal') <= 30);
  const mmCp = calls.filter(([r, q]) => r === 'miniature-market' && /combat patrol/i.test(q)).length;
  assert.equal(mmCp, 1, 'other Combat Patrols were covered by the first broad answer');
  assert.ok(res.stats.skippedCovered >= 20);
  assert.ok(res.offers.every((o) => o.productId && o.retailerId === 'miniature-market'));
  assert.equal(res.partial, true);
});

test('snapshot collect: overall deadline stops new queries', async () => {
  let t = 0;
  const { calls, factory } = fakeFactory(() => { t += 60_000; return []; });
  const res = await collectLive({ retailers: [getRetailer('wargame-portal')], factory, maxMinutes: 5, clock: () => t });
  assert.equal(calls.length, 5);
  assert.ok(res.stats.deferred > 0);
});

test('snapshot build: history merged, recent offers carried over, demo history never mixed in', async () => {
  const day = (d) => Date.UTC(2026, 10, d, 12);
  const retailers = ['miniature-market', 'wargame-portal'].map(getRetailer);
  // Wargame Portal is down this run, so its recent offers are carried over.
  const { factory } = fakeFactory((r, q) => { if (r.id === 'wargame-portal') throw new Error('down'); return (r.id === 'miniature-market' && q === 'Combat Patrol: Necrons'
    ? [{ title: 'Combat Patrol: Necrons', price: 136, currency: 'USD', inStock: true, url: 'https://www.miniaturemarket.com/cp-n' }]
    : []); });
  const previous = {
    demo: false,
    offers: [
      { retailerId: 'wargame-portal', productId: 'necron-warriors', title: 'Necron Warriors', price: 51, currency: 'USD',
        inStock: true, url: 'https://wargameportal.com/nw', fetchedAt: new Date(day(5)).toISOString() },
      { retailerId: 'wargame-portal', title: 'Ork Boyz', price: 47, currency: 'USD', inStock: true,
        url: 'https://wargameportal.com/boyz', fetchedAt: new Date(day(1) - 30 * 86_400_000).toISOString() }, // too old
    ],
    history: { 'combat-patrol-necrons': [[new Date(day(10)).toISOString(), 150, 'wargame-portal']] },
    lowest: { 'combat-patrol-necrons': [new Date(day(10)).toISOString(), 150, 'wargame-portal'] },
    retailers: [{ id: 'wargame-portal', lastOkAt: '2026-11-10T00:00:00.000Z' }],
  };
  const snap = await buildSnapshot({ previous, retailers, factory, now: () => day(12), log: () => {}, maxQueriesPerRetailer: 500 });
  assert.equal(snap.demo, false);
  assert.ok(snap.offers.some((o) => o.url === 'https://www.miniaturemarket.com/cp-n' && !o.carried));
  const carried = snap.offers.filter((o) => o.carried);
  assert.deepEqual(carried.map((o) => o.url), ['https://wargameportal.com/nw']);
  const wp = snap.retailers.find((s) => s.id === 'wargame-portal');
  assert.equal(wp.status, 'error');
  assert.equal(wp.lastOkAt, '2026-11-10T00:00:00.000Z', 'last success kept from the previous snapshot');
  assert.equal(wp.failed, 3, 'stopped after three failures in a row');
  assert.deepEqual(snap.history['combat-patrol-necrons'].map((p) => p[1]), [150, 136]);
  assert.equal(snap.lowest['combat-patrol-necrons'][1], 136);
  // A demo previous snapshot contributes nothing.
  const snap2 = await buildSnapshot({ previous: { ...previous, demo: true }, retailers, factory, now: () => day(12), log: () => {}, maxQueriesPerRetailer: 500 });
  assert.deepEqual(snap2.history['combat-patrol-necrons'].map((p) => p[1]), [136]);
  assert.equal(snap2.offers.filter((o) => o.carried).length, 0);
});

test('snapshot build: nothing fetched and nothing to carry -> labelled sample data', async () => {
  const { factory } = fakeFactory(() => { throw new Error('blocked'); });
  const snap = await buildSnapshot({ retailers: [getRetailer('wargame-portal')], factory, log: () => {} });
  assert.equal(snap.demo, true);
  assert.match(snap.fallbackReason, /SAMPLE/);
  assert.ok(snap.liveDiagnostics[0].stoppedReason);
});

// ---- overview + API -----------------------------------------------------------------------
test('overview: top deals, value per model, freshness, stores; untrusted offers dropped', () => {
  const now = Date.parse('2026-11-12T12:00:00Z');
  const snap = buildDemoSnapshot({ now });
  const ov = buildOverview(snap, { now: now + 5 * 3_600_000 });
  assert.equal(ov.snapshot.demo, true);
  assert.equal(ov.snapshot.ageHours, 5);
  assert.equal(ov.snapshot.freshness, 'fresh');
  assert.ok(ov.snapshot.rejected >= 1, 'lookalike domain dropped');
  assert.ok(ov.topDeals.length >= 5);
  const scores = ov.topDeals.map((id) => ov.products.find((p) => p.id === id).best.deal.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  const intercessors = ov.products.find((p) => p.id === 'space-marines-intercessors');
  assert.ok(!intercessors.offers.some((o) => /Upgrade Sprue/.test(o.title)));
  if (intercessors.best) assert.equal(intercessors.perModel, r2(intercessors.best.deal.price / 10));
  assert.ok(intercessors.history.length > 1 && intercessors.lowest);
  assert.ok(ov.stores.every((s) => s.lastOkAt || s.status === 'skipped'));
  assert.equal(buildOverview(snap, { now: now + 9 * 86_400_000 }).snapshot.freshness, 'stale');
  const empty = buildOverview({ generatedAt: null, offers: [] });
  assert.equal(empty.snapshot.freshness, 'none');
  assert.equal(empty.topDeals.length, 0);
  const cart = planCart(ov, [{ id: 'combat-patrol-orks' }, { id: 'ork-boyz', qty: 2 }, { id: 'nope' }]);
  assert.ok(cart.total > 0 && cart.plan.length >= 1);
  assert.deepEqual(cart.unavailable.map((u) => u.id), ['nope']);
});

test('routes: catalog, demo overview and cart; cart validation', async () => {
  __reset(); // talk to our own local server with the real fetch
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const cat = await (await fetch(`${base}/api/prices/catalog`)).json();
    assert.equal(cat.products.length, CATALOG.length);
    const ov = await (await fetch(`${base}/api/prices/overview?demo=1`)).json();
    assert.equal(ov.snapshot.demo, true);
    assert.ok(ov.topDeals.length);
    const post = (body) => fetch(`${base}/api/prices/cart`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const bad = await post({ items: [] });
    assert.equal(bad.status, 400);
    const ok = await (await post({ demo: true, items: [{ id: 'combat-patrol-space-marines' }, { id: 'space-marines-intercessors', qty: 2 }],
      shipping: { 'miniature-market': { flat: 0 } } })).json();
    assert.ok(ok.total > 0 && Array.isArray(ok.plan));
  } finally { await new Promise((r) => server.close(r)); }
});

// ---- stores that block us are avoided entirely --------------------------------------------

test('Discount Games Inc is avoided: never searched, offers dropped, shown as Avoided', async () => {
  const dgi = getRetailer('discount-games-inc');
  const { snapshotRetailers } = await import('../src/price/snapshot.js');
  assert.ok(dgi.blocked, 'marked blocked in the retailer list');
  assert.ok(!snapshotRetailers(HOME).some((r) => r.id === 'discount-games-inc'));
  // Its offers in an existing snapshot (e.g. the one published before it was blocked) never show.
  const t = new Date().toISOString();
  const snap = { demo: false, generatedAt: t, offers: [
    { retailerId: 'discount-games-inc', title: 'Combat Patrol: Necrons', price: 120, currency: 'USD', inStock: true,
      url: 'https://www.discountgamesinc.com/cp-n', fetchedAt: t },
    { retailerId: 'miniature-market', title: 'Combat Patrol: Necrons', price: 140, currency: 'USD', inStock: true,
      url: 'https://www.miniaturemarket.com/cp-n', fetchedAt: t },
  ] };
  const ov = buildOverview(snap);
  const cp = ov.products.find((p) => p.id === 'combat-patrol-necrons');
  assert.deepEqual(cp.offers.map((o) => o.retailerId), ['miniature-market']);
  const store = ov.stores.find((s) => s.id === 'discount-games-inc');
  assert.equal(store.status, 'blocked');
  assert.equal(store.blocked, true);
  assert.equal(store.offers, 0);
});

test('a store that refuses us (403) is recorded and skipped by every later refresh', async () => {
  const day = (d) => Date.UTC(2026, 10, d, 12);
  const retailers = ['miniature-market', 'wargame-portal'].map(getRetailer);
  const refused = () => Object.assign(new Error('HTTP 403'), { code: 'REFUSED' });
  const run1 = fakeFactory((r, q) => {
    if (r.id === 'wargame-portal') throw refused();
    return q === 'Combat Patrol: Necrons'
      ? [{ title: 'Combat Patrol: Necrons', price: 136, currency: 'USD', inStock: true, url: 'https://www.miniaturemarket.com/cp-n' }] : [];
  });
  const previous = { demo: false, offers: [
    { retailerId: 'wargame-portal', productId: 'necron-warriors', title: 'Necron Warriors', price: 51, currency: 'USD',
      inStock: true, url: 'https://wargameportal.com/nw', fetchedAt: new Date(day(10)).toISOString() },
  ] };
  const snap1 = await buildSnapshot({ previous, retailers, factory: run1.factory, now: () => day(12), log: () => {}, maxQueriesPerRetailer: 500 });
  assert.equal(run1.calls.filter(([id]) => id === 'wargame-portal').length, 1, 'stopped on the first refusal');
  assert.deepEqual(Object.keys(snap1.blockedStores), ['wargame-portal']);
  assert.equal(snap1.blockedStores['wargame-portal'].since, '2026-11-12');
  assert.ok(!snap1.offers.some((o) => o.retailerId === 'wargame-portal'), 'its old offers are not carried over');

  // Next refresh: never contacted, still blocked.
  const run2 = fakeFactory(() => []);
  const snap2 = await buildSnapshot({ previous: snap1, retailers, factory: run2.factory, now: () => day(13), log: () => {}, maxQueriesPerRetailer: 500 });
  assert.equal(run2.calls.filter(([id]) => id === 'wargame-portal').length, 0);
  assert.deepEqual(snap2.blockedStores, snap1.blockedStores);
  assert.equal(buildOverview(snap2).stores.find((s) => s.id === 'wargame-portal').status, 'blocked');

  // The block survives a sample-data fallback, and --retry-blocked clears it.
  const fallback = await buildSnapshot({ previous: { ...snap1, offers: [] }, retailers: [getRetailer('miniature-market')],
    factory: fakeFactory(() => { throw new Error('down'); }).factory, log: () => {} });
  assert.equal(fallback.demo, true);
  assert.ok(fallback.blockedStores['wargame-portal']);
  const run3 = fakeFactory(() => []);
  await buildSnapshot({ previous: fallback, retailers, factory: run3.factory, log: () => {}, retryBlocked: true, maxQueriesPerRetailer: 2 });
  assert.ok(run3.calls.some(([id]) => id === 'wargame-portal'));
});

test('a temporary rate limit (429) stops the run but does not block the store', async () => {
  const retailers = [getRetailer('wargame-portal')];
  const { factory } = fakeFactory(() => { throw Object.assign(new Error('429'), { code: 'RATE_LIMITED' }); });
  const snap = await buildSnapshot({ retailers, factory, log: () => {} });
  assert.deepEqual(snap.blockedStores, {});
});
