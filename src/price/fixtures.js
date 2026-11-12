// Deterministic demo/offline data (PRICE_DEMO=1 or ?demo=1). Prices are made
// up but plausible. Demo offers go through exactly the same trust filter,
// fuzzy matching and flagging as live ones; several entries below are
// deliberately bad to prove the filter works.

import { CATALOG as PRODUCT_CATALOG } from './catalog.js';

export const DEMO_FETCHED_AT = '2026-01-01T12:00:00.000Z';

const SLUG = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// [title, { retailerId: price | [price, inStock] }]
const CATALOG = [
  ['Combat Patrol: Space Marines', {
    warhammer: 100, 'element-games': 82, 'wayland-games': 85, 'firestorm-games': [84, false],
    'goblin-gaming': 83.5, 'miniature-market': 136, 'noble-knight': [79, true],
    'discount-games-inc': 136, fantasywelt: 99 }],
  ['Space Marines: Intercessors', {
    warhammer: 45, 'element-games': 36.9, 'wayland-games': 38.25, 'firestorm-games': 37.8,
    'goblin-gaming': [36.5, false], 'miniature-market': 52, 'noble-knight': 55.25,
    'discount-games-inc': 52, fantasywelt: 44 }],
  ['Space Marines: Assault Intercessors', {
    warhammer: 45, 'element-games': 36.9, 'wayland-games': 38.25, 'discount-games-inc': 52 }],
  ['Space Marines: Terminators', {
    warhammer: 42.5, 'element-games': 34.85, 'wayland-games': 36.1, 'goblin-gaming': 35,
    'miniature-market': 52, 'discount-games-inc': 52, fantasywelt: 42 }],
  ['Combat Patrol: Necrons', {
    warhammer: 100, 'element-games': 82, 'wayland-games': [85, false], 'miniature-market': 136,
    'noble-knight': 144.5, fantasywelt: 98 }],
  ['Necrons: Necron Warriors', {
    warhammer: 40, 'element-games': 32.8, 'firestorm-games': 33.6, 'miniature-market': 48 }],
  ['Orks: Boyz', { warhammer: 35, 'wayland-games': 29.75, 'discount-games-inc': 44 }],
  ['Boarding Patrol: Space Marines', { warhammer: 85, 'element-games': 69.7, 'noble-knight': 119 }],
  // Not kits: should be excluded by the fuzzy matcher for unit searches.
  ['Contrast: Ultramarines Blue (18ml) paint', { 'element-games': 6.3, 'wayland-games': 6.4 }],
  ['Codex: Space Marines', { warhammer: 35, 'wayland-games': 29.75 }],
  ['Citadel Dice: Intercessors', { 'firestorm-games': 9.5 }],
  // Too good to be true but from an allowlisted store: shown, flagged suspicious.
  ['Space Marines: Intercessors (clearance)', { 'goblin-gaming': 18 }],
];

const HOST = {
  warhammer: 'www.warhammer.com', 'element-games': 'elementgames.co.uk',
  'wayland-games': 'www.waylandgames.co.uk', 'firestorm-games': 'www.firestormgames.co.uk',
  'goblin-gaming': 'www.goblingaming.co.uk', 'miniature-market': 'www.miniaturemarket.com',
  'noble-knight': 'www.nobleknight.com', 'discount-games-inc': 'www.discountgamesinc.com',
  fantasywelt: 'www.fantasywelt.de', 'wargame-portal': 'wargameportal.com',
};

// Offers that MUST be dropped by the trust filter.
const BAD_OFFERS = {
  'element-games': [
    // Lookalike domain (e.g. after a redirect or a poisoned search result).
    { title: 'Space Marines: Intercessors', price: 19.99, currency: 'GBP',
      url: 'https://elementgames-uk.shop/products/intercessors', inStock: true },
    // Subdomain trick.
    { title: 'Combat Patrol: Space Marines', price: 39, currency: 'GBP',
      url: 'https://elementgames.co.uk.cheap-minis.example/cp-space-marines', inStock: true },
  ],
  'wayland-games': [
    // Plain http.
    { title: 'Space Marines: Intercessors', price: 38.25, currency: 'GBP',
      url: 'http://www.waylandgames.co.uk/intercessors', inStock: true },
  ],
};

/** Offers from a source that is not on the allowlist (always dropped). */
export const UNTRUSTED_FIXTURES = [
  { retailerId: 'warhammer-outlet-deals', title: 'Space Marines: Intercessors', price: 14.99,
    currency: 'GBP', url: 'https://warhammer-outlet-deals.example/intercessors', inStock: true,
    fetchedAt: DEMO_FETCHED_AT },
  { retailerId: 'warhammer-outlet-deals', title: 'Combat Patrol: Space Marines', price: 29.99,
    currency: 'GBP', url: 'https://warhammer-outlet-deals.example/combat-patrol', inStock: true,
    fetchedAt: DEMO_FETCHED_AT },
];

// Demo-only simulated outage, to show per-retailer error reporting in the UI.
export const DEMO_FAILING = new Set(['miniature-market']);

/** Demo adapter for one retailer: returns its whole fixture catalogue. */
export function demoAdapter(retailer) {
  return {
    async search(_query, { signal } = {}) {
      if (signal?.aborted) throw signal.reason ?? new Error('Aborted');
      if (DEMO_FAILING.has(retailer.id)) throw new Error('Simulated outage (demo mode)');
      const host = HOST[retailer.id];
      const offers = [];
      for (const [title, prices] of CATALOG) {
        const v = prices[retailer.id];
        if (v === undefined) continue;
        const [price, inStock] = Array.isArray(v) ? v : [v, true];
        offers.push({ retailerId: retailer.id, title, price, currency: retailer.currency,
          url: `https://${host}/products/${SLUG(title)}`, inStock,
          imageUrl: undefined, fetchedAt: new Date().toISOString() });
      }
      for (const b of BAD_OFFERS[retailer.id] ?? []) {
        offers.push({ ...b, retailerId: retailer.id, fetchedAt: DEMO_FETCHED_AT });
      }
      return offers;
    },
  };
}

// ---- Demo snapshot data for the Deal Finder (SAMPLE prices, never real) ----------

// Deterministic pseudo-random 0..1 from a string (FNV-1a).
function rnd(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return ((h >>> 0) % 10_000) / 10_000;
}

// How each demo store formats titles (exercises the matcher).
const DEMO_TITLE = {
  'miniature-market': (n) => n,
  'discount-games-inc': (n) => `Warhammer 40,000: ${n}`,
  'wargame-portal': (n) => n.replace(/^Combat Patrol: (.+)$/, '$1 Combat Patrol').replace(/^Codex: (.+)$/, 'Codex - $1'),
};
// Typical demo discount band per store (fraction of RRP).
const DEMO_BAND = { 'miniature-market': [0.80, 0.92], 'discount-games-inc': [0.78, 0.90], 'wargame-portal': [0.85, 0.85] };

/**
 * SAMPLE offers for every catalogue product at the US stores (for the demo
 * snapshot / UI checks). Includes a few listings the filters must reject.
 */
export function demoCatalogOffers(fetchedAt) {
  const out = [];
  for (const e of PRODUCT_CATALOG) {
    for (const [rid, fmt] of Object.entries(DEMO_TITLE)) {
      const x = rnd(`${e.id}|${rid}`);
      if (x < 0.12) continue; // not stocked at this store
      const [lo, hi] = DEMO_BAND[rid];
      const price = Math.round(e.USD * (lo + (hi - lo) * rnd(`${rid}|${e.id}|p`)) * 100) / 100;
      const inStock = x < 0.22 ? false : x < 0.27 ? null : true;
      out.push({ retailerId: rid, title: fmt(e.name), price, currency: 'USD',
        url: `https://${HOST[rid]}/products/${SLUG(e.name)}`, inStock, fetchedAt });
    }
  }
  // Must be filtered out / flagged by the pipeline:
  out.push(
    { retailerId: 'miniature-market', title: 'Used - Combat Patrol: Necrons (partially built)', price: 60, currency: 'USD',
      url: 'https://www.miniaturemarket.com/products/used-cp-necrons', inStock: true, fetchedAt },
    { retailerId: 'discount-games-inc', title: 'Space Marines Intercessors Upgrade Sprue', price: 9, currency: 'USD',
      url: 'https://www.discountgamesinc.com/products/intercessor-upgrade-sprue', inStock: true, fetchedAt },
    { retailerId: 'wargame-portal', title: 'Space Marines Intercessors (clearance)', price: 24, currency: 'USD',
      url: 'https://wargameportal.com/products/intercessors-clearance', inStock: true, fetchedAt },
    { retailerId: 'wargame-portal', title: 'Combat Patrol: Orks', price: 59, currency: 'USD',
      url: 'https://wargame-portal-deals.example/products/cp-orks', inStock: true, fetchedAt },
  );
  return out;
}
