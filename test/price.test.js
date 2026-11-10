import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { __setFetch, __reset } from '../src/shared/httpClient.js';
import { RETAILERS, getRetailer } from '../src/price/retailers.js';
import { checkOffer, flagOffer, compareOffers } from '../src/price/trust.js';
import { registerRetailerLimits, adapterFor, RETAILER_LIMIT } from '../src/price/adapters/index.js';
import { parseShopifySuggest } from '../src/price/adapters/shopify.js';
import { parseJsonLdProducts } from '../src/price/adapters/jsonld.js';
import { searchPrices } from '../src/price/search.js';
import { matchScore, isMatch } from '../src/price/match.js';
import { findMsrp } from '../src/price/msrp.js';
import { convert } from '../src/price/currency.js';
import { createApp } from '../src/server.js';

beforeEach(() => { __reset(); registerRetailerLimits(); process.env.SKIP_ROBOTS = '1'; delete process.env.PRICE_DEMO; });
after(() => __reset());

const offer = (o = {}) => ({ retailerId: 'element-games', title: 'Space Marines: Intercessors', price: 36.9,
  currency: 'GBP', url: 'https://elementgames.co.uk/p/intercessors', inStock: true, fetchedAt: 'x', ...o });

// ---- trust filter ---------------------------------------------------------
test('trust: accepts exact registered domain over https', () => {
  assert.deepEqual(checkOffer(offer()), { ok: true });
});

test('trust: rejects lookalike domains, subdomain tricks and http', () => {
  for (const url of [
    'https://elementgames-uk.shop/p/intercessors',
    'https://elementgames.co.uk.evil.example/p',
    'https://shop.elementgames.co.uk/p',          // unregistered subdomain
    'https://elementgames.co.uk@evil.example/p',
    'https://xn--elementgames-abc.co.uk/p',
    'https://www.waylandgames.co.uk/p',           // another retailer's domain
  ]) assert.equal(checkOffer(offer({ url })).ok, false, url);
  assert.equal(checkOffer(offer({ url: 'http://elementgames.co.uk/p' })).reason, 'insecure-url');
  assert.equal(checkOffer(offer({ retailerId: 'random-shop', url: 'https://random.example/x' })).reason, 'unlisted-retailer');
  assert.equal(checkOffer(offer({ price: -1 })).ok, false);
  assert.equal(checkOffer(offer({ price: NaN })).ok, false);
  assert.equal(checkOffer(offer({ url: 'javascript:alert(1)' })).ok, false);
});

test('registry: no marketplaces, every retailer well-formed', () => {
  for (const r of RETAILERS) {
    assert.ok(['official', 'authorized'].includes(r.tier), r.id);
    assert.ok(r.domains.length && r.currency && r.region && r.notes && r.shippingNote, r.id);
    for (const d of r.domains) assert.doesNotMatch(d, /amazon|ebay|aliexpress|etsy/i);
    assert.ok(r.domains.every((d) => d === d.toLowerCase() && !d.includes('/')));
  }
  assert.equal(RETAILERS.filter((r) => r.tier === 'official').length, 1);
});

test('rate limits are registered for every retailer host at <= 10 rpm', () => {
  const seen = new Map();
  registerRetailerLimits((host, limit) => seen.set(host, limit));
  for (const r of RETAILERS) {
    for (const h of [...r.domains, r.adapter.host].filter(Boolean)) {
      const l = seen.get(h);
      assert.ok(l, `missing limit for ${h}`);
      assert.ok(l.requestsPerMinute <= 10 && l.burst <= 2 && l.maxConcurrent === 1, h);
    }
  }
  assert.ok(RETAILER_LIMIT.requestsPerMinute <= 10);
});

// ---- flags / sorting --------------------------------------------------------
test('suspicious flag below 55% of MSRP', () => {
  assert.deepEqual(flagOffer(offer({ price: 18 })).flags, ['suspicious']);
  assert.deepEqual(flagOffer(offer({ price: 36.9 })).flags, []);
  const f = flagOffer(offer({ price: 36.9 }));
  assert.equal(f.msrp, 45); assert.equal(f.savingPct, 18);
  // USD offer compares against USD MSRP
  assert.deepEqual(flagOffer(offer({ currency: 'USD', price: 30 })).flags, ['suspicious']);
  assert.deepEqual(flagOffer(offer({ currency: 'USD', price: 52 })).flags, []);
  assert.ok(flagOffer(offer({ inStock: false })).flags.includes('out-of-stock'));
});

test('sorting: in-stock by price, then unknown, then out of stock', () => {
  const list = [
    { retailerId: 'a', inStock: false, sortValue: 1 },
    { retailerId: 'b', inStock: true, sortValue: 30 },
    { retailerId: 'c', inStock: null, sortValue: 2 },
    { retailerId: 'd', inStock: true, sortValue: 20 },
  ].sort(compareOffers);
  assert.deepEqual(list.map((o) => o.retailerId), ['d', 'b', 'c', 'a']);
});

test('currency conversion and MSRP lookup', () => {
  assert.equal(convert(100, 'GBP', 'GBP'), 100);
  assert.equal(convert(130, 'USD', 'GBP'), 100);
  assert.equal(convert(1, 'XYZ', 'GBP'), null);
  assert.equal(findMsrp('Primaris Intercessors')?.name, 'Space Marines Intercessors');
  assert.equal(findMsrp('Assault Intercessors')?.name, 'Space Marines Assault Intercessors');
  assert.equal(findMsrp('space marines'), null);
  assert.equal(findMsrp('chaos terminators'), null);
});

test('fuzzy matching excludes non-kits and other factions', () => {
  assert.ok(isMatch('Primaris Intercessors', 'Space Marines: Intercessors'));
  assert.ok(isMatch('Combat Patrol: Space Marines', 'Warhammer 40,000 Combat Patrol: Space Marines'));
  assert.ok(!isMatch('Combat Patrol: Space Marines', 'Combat Patrol: Necrons'));
  assert.equal(matchScore('intercessors', 'Contrast: Ultramarines Blue paint'), 0);
  assert.equal(matchScore('intercessors', 'Citadel Dice: Intercessors'), 0);
  assert.equal(matchScore('space marines', 'Codex: Space Marines'), 0);
  assert.ok(isMatch('space marines codex', 'Codex: Space Marines'));
});

// ---- adapters ---------------------------------------------------------------
const SUGGEST = { resources: { results: { products: [
  { title: 'Space Marines: Intercessors', handle: 'sm-intercessors', url: '/products/sm-intercessors?_pos=1&_sid=a',
    price: '36.50', available: true, image: 'https://cdn.shopify.com/i.jpg' },
  { title: 'Combat Patrol: Space Marines', handle: 'cp-sm', url: '/products/cp-sm?_pos=2', price: '83.50', available: false },
  { title: 'Broken', price: 'n/a' },
] } } };

test('shopify adapter parses suggest.json', () => {
  const out = parseShopifySuggest(SUGGEST, { host: 'www.goblingaming.co.uk', currency: 'GBP' });
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { title: 'Space Marines: Intercessors', price: 36.5, currency: 'GBP',
    url: 'https://www.goblingaming.co.uk/products/sm-intercessors', inStock: true, imageUrl: 'https://cdn.shopify.com/i.jpg' });
  assert.equal(out[1].inStock, false);
  assert.throws(() => parseShopifySuggest({ nope: 1 }, { host: 'h', currency: 'GBP' }));
});

test('shopify adapter fetches via politeFetch with the right URL', async () => {
  const urls = [];
  __setFetch(async (u) => { urls.push(u); return new Response(JSON.stringify(SUGGEST), { status: 200 }); });
  const offers = await adapterFor(getRetailer('goblin-gaming')).search('intercessors');
  assert.equal(urls.length, 1);
  assert.match(urls[0], /^https:\/\/www\.goblingaming\.co\.uk\/search\/suggest\.json\?q=intercessors&resources\[type\]=product/);
  assert.equal(offers[0].retailerId, 'goblin-gaming');
  assert.ok(offers[0].fetchedAt);
  // cached: second search does not hit the network
  await adapterFor(getRetailer('goblin-gaming')).search('intercessors');
  assert.equal(urls.length, 1);
});

const LD_HTML = `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"x"}</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"ItemList","itemListElement":[
 {"@type":"ListItem","position":1,"item":{"@type":"Product","name":"Space Marines: Intercessors",
   "url":"/space-marines-intercessors","image":["/img/a.jpg"],
   "offers":{"@type":"Offer","price":"38.25","priceCurrency":"GBP","availability":"https://schema.org/InStock"}}},
 {"@type":"ListItem","position":2,"item":{"@type":"Product","name":"Combat Patrol: Space Marines",
   "url":"https://www.waylandgames.co.uk/cp-sm",
   "offers":{"@type":"AggregateOffer","lowPrice":85,"highPrice":90,"priceCurrency":"GBP",
   "offers":[{"@type":"Offer","price":"85.00","priceCurrency":"GBP","availability":"http://schema.org/OutOfStock"}]}}}
]}
</script>
<script type="application/ld+json">{ broken json </script>
</head><body></body></html>`;

test('JSON-LD parsing: ItemList, AggregateOffer, relative URLs, availability', () => {
  const out = parseJsonLdProducts(LD_HTML, 'https://www.waylandgames.co.uk/search?search=x');
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { title: 'Space Marines: Intercessors', price: 38.25, currency: 'GBP',
    url: 'https://www.waylandgames.co.uk/space-marines-intercessors', inStock: true,
    imageUrl: 'https://www.waylandgames.co.uk/img/a.jpg' });
  assert.equal(out[1].price, 85);
  assert.equal(out[1].inStock, false);
  const eu = parseJsonLdProducts('<script type="application/ld+json">{"@graph":[{"@type":"Product","name":"N","url":"https://www.fantasywelt.de/n","offers":{"price":"44,00","priceCurrency":"EUR"}}]}</script>', 'https://www.fantasywelt.de/');
  assert.equal(eu[0].price, 44);
  assert.equal(eu[0].inStock, null);
});

test('html adapter goes through politeFetch and parses JSON-LD', async () => {
  __setFetch(async () => new Response(LD_HTML, { status: 200 }));
  const offers = await adapterFor(getRetailer('wayland-games')).search('intercessors');
  assert.equal(offers.length, 2);
  assert.ok(offers.every((o) => o.retailerId === 'wayland-games'));
});

// ---- search pipeline --------------------------------------------------------
test('one adapter failing does not break others', async () => {
  const retailers = RETAILERS.filter((r) => ['element-games', 'wayland-games', 'goblin-gaming'].includes(r.id));
  const out = await searchPrices({
    query: 'intercessors', retailers,
    adapterFactory: (r) => ({ async search() {
      if (r.id === 'wayland-games') throw new Error('boom');
      if (r.id === 'goblin-gaming') return [offer({ retailerId: 'goblin-gaming', url: 'https://www.goblingaming.co.uk/p', price: 35 })];
      return [offer()];
    } }),
  });
  assert.deepEqual(out.retailers.map((r) => [r.id, r.status]),
    [['element-games', 'ok'], ['wayland-games', 'error'], ['goblin-gaming', 'ok']]);
  assert.equal(out.retailers[1].error, 'boom');
  assert.deepEqual(out.results.map((o) => o.retailerId), ['goblin-gaming', 'element-games']);
});

test('real adapters: network failure for one retailer, success for another', async () => {
  __setFetch(async (u) => {
    if (u.includes('goblingaming')) return new Response(JSON.stringify(SUGGEST), { status: 200 });
    return new Response('nope', { status: 404 });
  });
  const retailers = RETAILERS.filter((r) => ['goblin-gaming', 'element-games'].includes(r.id));
  const out = await searchPrices({ query: 'intercessors', retailers });
  const st = Object.fromEntries(out.retailers.map((r) => [r.id, r.status]));
  assert.deepEqual(st, { 'element-games': 'error', 'goblin-gaming': 'ok' });
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].url, 'https://www.goblingaming.co.uk/products/sm-intercessors');
});

test('adapter cannot speak for another retailer; slow adapter times out', async () => {
  const retailers = RETAILERS.filter((r) => ['element-games', 'wayland-games'].includes(r.id));
  const out = await searchPrices({
    query: 'intercessors', retailers, timeoutMs: 50,
    adapterFactory: (r) => ({ search: () => (r.id === 'wayland-games'
      ? new Promise(() => {})
      : Promise.resolve([offer({ retailerId: 'goblin-gaming', url: 'https://www.goblingaming.co.uk/p' })])) }),
  });
  assert.equal(out.results.length, 0);
  assert.equal(out.filtered['retailer-mismatch'], 1);
  assert.equal(out.retailers.find((r) => r.id === 'wayland-games').status, 'error');
});

test('demo mode: fixtures pass through trust filter', async () => {
  const out = await searchPrices({ query: 'intercessors', demo: true, currency: 'USD' });
  assert.ok(out.results.length > 3);
  for (const o of out.results) {
    const r = getRetailer(o.retailerId);
    assert.ok(r.domains.includes(new URL(o.url).hostname));
    assert.ok(o.url.startsWith('https://'));
    assert.equal(o.convertedCurrency, 'USD');
  }
  assert.ok(out.filtered['domain-mismatch'] >= 1);
  assert.ok(out.filtered['unlisted-retailer'] >= 1);
  assert.ok(out.filtered['insecure-url'] >= 1);
  assert.ok(!out.results.some((o) => /paint|dice/i.test(o.title)));
  const sus = out.results.find((o) => o.flags.includes('suspicious'));
  assert.ok(sus, 'expected a suspicious offer');
  assert.ok(out.best && !out.best.flags.includes('suspicious') && out.best.inStock === true);
  // in-stock offers come before out-of-stock ones
  const firstOos = out.results.findIndex((o) => o.inStock === false);
  assert.ok(firstOos === -1 || out.results.slice(firstOos).every((o) => o.inStock !== true));
  assert.ok(out.retailers.some((r) => r.status === 'error'));
  assert.equal(out.msrp.name, 'Space Marines Intercessors');
});

test('region filter skips other regions', async () => {
  const out = await searchPrices({ query: 'combat patrol space marines', demo: true, region: 'US' });
  assert.ok(out.results.every((o) => o.region === 'US'));
  assert.ok(out.retailers.filter((r) => r.status === 'skipped').length >= 5);
});

// ---- routes -----------------------------------------------------------------
async function withServer(fn) {
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { await new Promise((r) => server.close(r)); }
}

test('routes: validation, demo search, retailers list', async () => {
  // Tests talk to our own local server; restore the real fetch for this.
  await withServer(async (base) => {
    const get = (p) => globalThis.fetch(base + p);
    for (const q of ['', 'a', 'x'.repeat(101)]) {
      const r = await get(`/api/prices/search?q=${q}`);
      assert.equal(r.status, 400);
      assert.ok((await r.json()).error);
    }
    assert.equal((await get('/api/prices/search?q=intercessors&region=MARS')).status, 400);
    assert.equal((await get('/api/prices/search?q=intercessors&currency=BTC')).status, 400);

    const r = await get('/api/prices/search?q=intercessors&demo=1&currency=gbp&region=uk');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.query, 'intercessors');
    assert.ok(body.results.length && body.disclaimer && body.msrp);
    assert.ok(body.results.every((o) => o.region === 'UK' && o.retailerName && o.tier && Array.isArray(o.flags)));
    const prices = body.results.filter((o) => o.inStock === true).map((o) => o.convertedPrice);
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b));

    const list = await (await get('/api/prices/retailers')).json();
    assert.equal(list.retailers.length, RETAILERS.length);
    assert.ok(list.retailers.every((x) => x.notes && x.tier && !('adapter' in x)));
  });
});
