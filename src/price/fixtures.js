// Deterministic demo/offline data (PRICE_DEMO=1 or ?demo=1). Prices are made
// up but plausible. Demo offers go through exactly the same trust filter,
// fuzzy matching and flagging as live ones; several entries below are
// deliberately bad to prove the filter works.

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
  fantasywelt: 'www.fantasywelt.de',
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
    async search() {
      if (DEMO_FAILING.has(retailer.id)) throw new Error('Simulated outage (demo mode)');
      const host = HOST[retailer.id];
      const offers = [];
      for (const [title, prices] of CATALOG) {
        const v = prices[retailer.id];
        if (v === undefined) continue;
        const [price, inStock] = Array.isArray(v) ? v : [v, true];
        offers.push({ retailerId: retailer.id, title, price, currency: retailer.currency,
          url: `https://${host}/products/${SLUG(title)}`, inStock,
          imageUrl: undefined, fetchedAt: DEMO_FETCHED_AT });
      }
      for (const b of BAD_OFFERS[retailer.id] ?? []) {
        offers.push({ ...b, retailerId: retailer.id, fetchedAt: DEMO_FETCHED_AT });
      }
      return offers;
    },
  };
}
