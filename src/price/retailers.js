// Curated allowlist of retailers the Price Finder will query and show.
//
// Inclusion policy (deliberately strict):
//  * 'official'   : Games Workshop's own webstore (MSRP reference).
//  * 'authorized' : long-established independent stockists with a physical
//                   business presence, a track record of 10+ years in the hobby
//                   and that sell new, boxed GW product themselves.
//
// Excluded on purpose:
//  * Amazon / eBay / AliExpress / Etsy and other marketplaces. Listings there
//    come from arbitrary third-party sellers (recasts, counterfeits, "sold by"
//    switch-ups), and the seller of a given listing can change at any time, so
//    a domain allowlist cannot vouch for them. Even "sold by Amazon" listings
//    share product pages with third-party offers. Simpler and safer to exclude.
//  * Any store not listed here. Offers from an unlisted source are never shown.
//
// `domains` are EXACT hostnames. A product URL is only accepted when its
// hostname equals one of them (see trust.js), so lookalikes such as
// "elementgames-uk.shop" or "warhammer.com.deals.example" are rejected.
//
// `adapter` configs: the live endpoint shapes below are best-effort and could
// NOT be verified from the build sandbox (retailer hosts are blocked by its
// network policy). VERIFY ON DEPLOY: each search URL, that the store is still on
// the platform stated, and that JSON-LD is present on search/product pages.

export const RETAILERS = [
  {
    id: 'warhammer',
    name: 'Warhammer.com (Games Workshop)',
    domains: ['www.warhammer.com', 'warhammer.com'],
    region: 'UK',
    country: 'GB',
    currency: 'GBP',
    tier: 'official',
    notes: 'Games Workshop’s official webstore. Prices here are the MSRP reference.',
    shippingNote: 'Free UK delivery over a threshold; ships worldwide from regional warehouses.',
    // The site's search is client-rendered (JS app), so there is no stable
    // server-rendered search page to read. Live lookups are disabled and MSRP
    // comes from the seeded table in msrp.js. Demo fixtures still include it.
    adapter: { type: 'html', live: false,
      searchUrl: 'https://www.warhammer.com/en-GB/plp?search={q}' },
  },
  {
    id: 'element-games',
    name: 'Element Games',
    domains: ['elementgames.co.uk', 'www.elementgames.co.uk'],
    region: 'UK', country: 'GB', currency: 'GBP', tier: 'authorized',
    notes: 'Long-running UK discount stockist (since ~2010) with a physical store in Stockport.',
    shippingNote: 'Free UK shipping over a threshold; international shipping available.',
    adapter: { type: 'html', searchUrl: 'https://elementgames.co.uk/search?search={q}',
      productLinkPattern: 'href="(https://elementgames\\.co\\.uk/[^"]+/[^"]+)"',
      maxProductPages: 1 }, // cold cache: robots + search + 1 page fits the 25 s deadline at 6 rpm
  },
  {
    id: 'wayland-games',
    name: 'Wayland Games',
    domains: ['www.waylandgames.co.uk', 'waylandgames.co.uk'],
    region: 'UK', country: 'GB', currency: 'GBP', tier: 'authorized',
    notes: 'Large UK independent stockist (since ~2008) based in Essex.',
    shippingNote: 'UK and international shipping; free UK delivery over a threshold.',
    adapter: { type: 'html', searchUrl: 'https://www.waylandgames.co.uk/search?search={q}' },
  },
  {
    id: 'firestorm-games',
    name: 'Firestorm Games',
    domains: ['www.firestormgames.co.uk', 'firestormgames.co.uk'],
    region: 'UK', country: 'GB', currency: 'GBP', tier: 'authorized',
    notes: 'Established UK stockist with a large gaming centre in Cardiff.',
    shippingNote: 'UK and international shipping.',
    adapter: { type: 'html', searchUrl: 'https://www.firestormgames.co.uk/search?q={q}' },
  },
  {
    id: 'goblin-gaming',
    name: 'Goblin Gaming',
    domains: ['www.goblingaming.co.uk', 'goblingaming.co.uk'],
    region: 'UK', country: 'GB', currency: 'GBP', tier: 'authorized',
    notes: 'Long-standing UK stockist with physical stores; Shopify storefront.',
    shippingNote: 'UK shipping; free over a threshold.',
    adapter: { type: 'shopify', host: 'www.goblingaming.co.uk' },
  },
  {
    id: 'miniature-market',
    name: 'Miniature Market',
    domains: ['www.miniaturemarket.com', 'miniaturemarket.com'],
    region: 'US', country: 'US', currency: 'USD', tier: 'authorized',
    notes: 'Major US hobby retailer (since ~2007) based in Missouri.',
    shippingNote: 'US shipping; free over a threshold within the contiguous US.',
    // Real search form found by the probe; old /searchresults URL returned 404.
    // No JSON-LD on results, so product cards are read directly (selectors from probe run 3).
    adapter: { type: 'listing', searchUrl: 'https://www.miniaturemarket.com/search?search={q}',
      cardMarker: 'class="product-info"', linkClass: 'product-name', priceClass: 'product-price' },
  },
  {
    id: 'noble-knight',
    name: 'Noble Knight Games',
    domains: ['www.nobleknight.com', 'nobleknight.com'],
    region: 'US', country: 'US', currency: 'USD', tier: 'authorized',
    notes: 'US retailer since the 1990s (Wisconsin); sells new and clearly-labelled used/OOP items.',
    shippingNote: 'US and international shipping.',
    // Probe (Nov 2026): robots.txt disallows /Search for automated clients, so we
    // don't search it. Still listed so users can see it was considered.
    adapter: { type: 'html', live: false, liveDisabledReason: 'robots.txt disallows automated search',
      searchUrl: 'https://www.nobleknight.com/Search?text={q}' },
  },
  {
    id: 'discount-games-inc',
    name: 'Discount Games Inc (Frontline Gaming)',
    domains: ['www.discountgamesinc.com', 'discountgamesinc.com'],
    region: 'US', country: 'US', currency: 'USD', tier: 'authorized',
    notes: 'Store run by Frontline Gaming, a long-standing US tournament organiser and stockist.',
    shippingNote: 'US shipping.',
    // Lightspeed store, not Shopify (suggest.json redirects). Search form found by the
    // probe; results pages have no JSON-LD, so product cards are read directly.
    adapter: { type: 'listing', searchUrl: 'https://www.discountgamesinc.com/search/?q={q}',
      cardMarker: 'class="product-info"', linkClass: 'product-title', priceClass: 'price' },
  },
  {
    id: 'wargame-portal',
    name: 'Wargame Portal',
    domains: ['wargameportal.com', 'www.wargameportal.com'],
    region: 'US', country: 'US', currency: 'USD', tier: 'authorized',
    notes: 'North American online stockist pricing GW kits at the maximum advertised discount '
      + '(typically 15% off MSRP). Real, established store, but customer reviews are mixed '
      + '(Trustpilot ≈2.9/5, mostly about slow shipping).',
    shippingNote: 'US shipping; reviews report slower dispatch on discounted orders.',
    caution: 'Mixed reviews on shipping speed',
    // Shopify storefront; probe (Nov 2026) confirmed /search/suggest.json returns products.
    adapter: { type: 'shopify', host: 'wargameportal.com' },
  },
  {
    id: 'fantasywelt',
    name: 'Fantasywelt',
    domains: ['www.fantasywelt.de', 'fantasywelt.de'],
    region: 'EU', country: 'DE', currency: 'EUR', tier: 'authorized',
    notes: 'Large German tabletop retailer, established for many years, ships across the EU.',
    shippingNote: 'EU-wide shipping from Germany.',
    adapter: { type: 'html', searchUrl: 'https://www.fantasywelt.de/search?sSearch={q}' },
  },
];

export const REGIONS = ['UK', 'US', 'EU'];

const byId = new Map(RETAILERS.map((r) => [r.id, r]));
export function getRetailer(id) { return byId.get(id); }

/** Public view (no adapter internals) for /api/prices/retailers. */
export function publicRetailer(r) {
  return {
    id: r.id, name: r.name, domains: r.domains, region: r.region, country: r.country,
    currency: r.currency, tier: r.tier, notes: r.notes, shippingNote: r.shippingNote,
    liveLookups: r.adapter?.live !== false,
    liveDisabledReason: r.adapter?.liveDisabledReason ?? null,
    caution: r.caution ?? null,
  };
}
