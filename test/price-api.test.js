// API v2: ProductCard, product / faction payloads, 7-day change, new lows, RRP
// evidence from retailer list prices, product images, the RSS deals feed and the
// server routes. No live network: politeFetch is stubbed to fail loudly.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { __setFetch, __reset } from '../src/shared/httpClient.js';
import { buildOverview, changeOver, newLowInfo } from '../src/price/overview.js';
import { overviewPayload, productPayload, factionPayload, productCard, dealsRss, xmlEscape } from '../src/price/api.js';
import { resolveRrp } from '../src/price/rrp.js';
import { checkOffer, safeImageUrl } from '../src/price/trust.js';
import { getRetailer } from '../src/price/retailers.js';
import { productById } from '../src/price/catalog.js';
import { parseShopifySuggest } from '../src/price/adapters/shopify.js';
import { parseListing } from '../src/price/adapters/listing.js';
import { collectLive, buildDemoSnapshot } from '../src/price/snapshot.js';
import { __resetSearchLimiter } from '../src/price/routes.js';
import { __resetSnapshotCache } from '../src/price/snapshotStore.js';
import { createApp } from '../src/server.js';

beforeEach(() => {
  __reset(); __resetSearchLimiter(); __resetSnapshotCache();
  __setFetch(async (u) => { throw new Error(`unexpected network call in test: ${u}`); });
});
after(() => __reset());

const CARD_KEYS = ['id', 'name', 'category', 'faction', 'factionName', 'factionColor', 'imageUrl', 'rrp', 'rrpSource',
  'rrpConf', 'best', 'offerCount', 'inStockCount', 'dealScore', 'dealLabel', 'lowest', 'atLowest', 'change7d',
  'models', 'points', 'units'];
const BEST_KEYS = ['price', 'delivered', 'retailerId', 'retailerName', 'url', 'inStock', 'pctOff', 'savings', 'fetchedAt', 'carried'];
const OFFER_KEYS = ['retailerId', 'retailerName', 'title', 'url', 'imageUrl', 'price', 'currency', 'priceUsd', 'delivered',
  'shipping', 'tax', 'inStock', 'pctOff', 'dealScore', 'dealLabel', 'suspicious', 'carried', 'fetchedAt', 'caution'];

const has = (obj, keys, what) => { for (const k of keys) assert.ok(k in obj, `${what} has ${k}`); };

// A small hand-made snapshot: one product with a 10-day history and a fresh low.
const T0 = Date.parse('2026-11-16T12:00:00Z');
const iso = (daysAgo) => new Date(T0 - daysAgo * 86_400_000).toISOString();
function miniSnap(extra = {}) {
  return {
    generatedAt: iso(0), demo: false,
    offers: [
      { retailerId: 'miniature-market', title: 'Warhammer 40K: Space Marines - Intercessor Squad', price: 52, currency: 'USD',
        url: 'https://www.miniaturemarket.com/intercessors', inStock: true, fetchedAt: iso(0), listPrice: 67.5,
        imageUrl: 'https://cdn.miniaturemarket.com/media/intercessors.jpg' },
      { retailerId: 'wargame-portal', title: 'Space Marines Intercessors', price: 57.37, currency: 'USD',
        url: 'https://wargameportal.com/products/intercessors', inStock: true, fetchedAt: iso(0), listPrice: 67.5,
        imageUrl: 'https://evil.example/tracker.gif' },
      { retailerId: 'wargame-portal', title: 'Necrons Immortals', price: 51, currency: 'USD',
        url: 'https://wargameportal.com/products/immortals', inStock: true, fetchedAt: iso(0), listPrice: 60 },
      // Avoided store: never shown, even with a list price.
      { retailerId: 'discount-games-inc', title: 'Space Marines - Intercessor Squad', price: 40, currency: 'USD',
        url: 'https://www.discountgamesinc.com/intercessors', inStock: true, fetchedAt: iso(0), listPrice: 99 },
    ],
    history: {
      'space-marines-intercessors': [[iso(10), 58, 'wargame-portal'], [iso(7), 57, 'wargame-portal'], [iso(3), 55, 'wargame-portal'], [iso(0), 52, 'miniature-market']],
      'necrons-immortals': [[iso(8), 50, 'wargame-portal'], [iso(0), 51, 'wargame-portal']],
    },
    lowest: { 'space-marines-intercessors': [iso(0), 52, 'miniature-market'], 'necrons-immortals': [iso(8), 50, 'wargame-portal'] },
    ...extra,
  };
}

test('ProductCard: every contract key, best/lowest/change7d shapes, avoided store ignored', () => {
  const ov = buildOverview(miniSnap(), { now: T0 });
  const payload = overviewPayload(ov);
  for (const p of payload.products) has(p, CARD_KEYS, p.id);
  const c = payload.products.find((p) => p.id === 'space-marines-intercessors');
  has(c.best, BEST_KEYS, 'best');
  assert.equal(c.best.retailerId, 'miniature-market');
  assert.equal(c.best.price, 52);
  assert.ok(c.best.delivered > 52, 'delivered adds shipping and tax');
  assert.deepEqual(c.lowest, { price: 52, date: iso(0), retailerId: 'miniature-market' });
  assert.equal(c.atLowest, true);
  assert.deepEqual(c.change7d, { from: 57, to: 52, pct: -8.8 });
  assert.equal(c.offerCount, 2, 'Discount Games Inc offer dropped');
  assert.equal(c.factionColor, '#2f5fb3');
  assert.ok(c.units.includes('intercessor-squad'));
  assert.equal(c.models, 10);
  // Unknown values are null, never missing.
  const none = payload.products.find((p) => p.id === 'necron-lychguard');
  assert.equal(none.best, null); assert.equal(none.change7d, null); assert.equal(none.lowest, null);
  assert.equal(none.imageUrl, null); assert.equal(none.dealScore, null);
});

test('drops, newLows and facets', () => {
  const ov = overviewPayload(buildOverview(miniSnap(), { now: T0 }));
  assert.deepEqual(ov.drops.map((p) => p.id), ['space-marines-intercessors']);
  assert.deepEqual(ov.newLows.map((p) => p.id), ['space-marines-intercessors'], 'Immortals at 51 is above its 50 low');
  assert.deepEqual(ov.newLows[0].prevLow, { price: 55, pct: -5.5 });
  const sm = ov.facets.factions.find((f) => f.id === 'space-marines');
  assert.ok(sm.count > 40 && sm.color && sm.group === 'Imperium');
  assert.equal(ov.facets.factions.find((f) => f.id === 'blood-angels').parent, 'space-marines');
  const kits = ov.facets.categories.find((c) => c.id === 'kit');
  assert.equal(kits.count, ov.products.filter((p) => p.category === 'kit').length);
  // History helpers on their own.
  assert.equal(changeOver([[iso(2), 10]], 9, T0), null, 'no point a week back');
  assert.equal(newLowInfo([[iso(30), 60], [iso(20), 50]], { price: 50, date: iso(20) }, T0), null, 'old low is not new');
});

test('RRP evidence: agreeing store list prices beat the catalogue estimate; rules are conservative', () => {
  const e = productById('space-marines-intercessors'); // catalogue estimate $65, conf medium
  const mm = (lp) => ({ retailerId: 'miniature-market', currency: 'USD', listPrice: lp });
  const wp = (lp) => ({ retailerId: 'wargame-portal', currency: 'USD', listPrice: lp });
  let r = resolveRrp(e, [mm(67.5), wp(67.5)]);
  assert.deepEqual([r.rrp, r.rrpSource, r.rrpConf], [67.5, 'retailer-list', 'high']);
  assert.deepEqual(r.evidence.map((x) => x.source), ['retailer-list', 'retailer-list', 'catalogue']);
  r = resolveRrp(e, [mm(68)]);
  assert.deepEqual([r.rrp, r.rrpSource, r.rrpConf], [68, 'retailer-list', 'high'], 'one store within 10% of the estimate');
  r = resolveRrp(e, [mm(80)]);
  assert.deepEqual([r.rrp, r.rrpConf], [80, 'medium'], 'one store, plausible but not corroborated');
  r = resolveRrp(e, [mm(150)]);
  assert.deepEqual([r.rrp, r.rrpSource, r.rrpConf], [65, 'catalogue', 'medium'], 'implausible list price ignored');
  r = resolveRrp(e, [{ retailerId: 'element-games', currency: 'GBP', listPrice: 45 }]);
  assert.equal(r.rrpSource, 'catalogue', 'a UK store’s GBP list price is not the US RRP');
  const unpriced = productById('necrons-immortals');
  assert.equal(unpriced.USD, null);
  r = resolveRrp(unpriced, []);
  assert.deepEqual([r.rrp, r.rrpSource, r.rrpConf], [null, null, null]);
  r = resolveRrp(unpriced, [wp(60)]);
  assert.deepEqual([r.rrp, r.rrpSource, r.rrpConf], [60, 'retailer-list', 'medium']);
  r = resolveRrp(unpriced, [wp(60), mm(70)]);
  assert.deepEqual([r.rrp, r.rrpConf], [65, 'low'], 'stores disagree, no estimate');
  // In the overview the evidence drives % off and deal score.
  const ov = buildOverview(miniSnap(), { now: T0 });
  const imm = ov.products.find((p) => p.id === 'necrons-immortals');
  assert.equal(imm.rrp, 60);
  assert.equal(imm.best.pctOff, 15);
  assert.ok(imm.dealScore != null);
});

test('list prices: sanity-checked by the trust filter; parsed from Shopify compare_at_price and listings', () => {
  const o = { retailerId: 'wargame-portal', title: 'x', price: 50, currency: 'USD', url: 'https://wargameportal.com/p', listPrice: 40 };
  checkOffer(o);
  assert.equal(o.listPrice, undefined, 'list price below the selling price is dropped');
  const o2 = { ...o, listPrice: '67.50' }; checkOffer(o2); assert.equal(o2.listPrice, 67.5);
  const o3 = { ...o, listPrice: 500 }; checkOffer(o3); assert.equal(o3.listPrice, undefined, 'absurd list price dropped');
  const shop = parseShopifySuggest({ resources: { results: { products: [
    { title: 'Space Marines Intercessors', url: '/products/intercessors', price: '57.37', compare_at_price_max: '67.50', available: true,
      image: '//cdn.shopify.com/s/files/1/intercessors.jpg' },
    { title: 'Necron Warriors', url: '/products/warriors', price: '51.00', compare_at_price_max: '0.00', available: true },
  ] } } }, { host: 'wargameportal.com', currency: 'USD' });
  assert.equal(shop[0].listPrice, 67.5);
  assert.equal(shop[0].imageUrl, 'https://cdn.shopify.com/s/files/1/intercessors.jpg');
  assert.equal('listPrice' in shop[1], false, '"0.00" means no compare-at price');
});

test('images: https on the store’s own domain or registered CDN only; listing photos never borrowed', () => {
  const wp = getRetailer('wargame-portal');
  assert.equal(safeImageUrl('https://cdn.shopify.com/a.jpg', wp), 'https://cdn.shopify.com/a.jpg');
  assert.equal(safeImageUrl('https://wargameportal.com/cdn/shop/a.jpg', wp), 'https://wargameportal.com/cdn/shop/a.jpg');
  assert.equal(safeImageUrl('//cdn.shopify.com/a.jpg', wp), 'https://cdn.shopify.com/a.jpg');
  for (const bad of ['http://cdn.shopify.com/a.jpg', 'https://evil.example/a.jpg', 'https://cdn.shopify.com.evil.example/a.jpg',
    'javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://user:pw@cdn.shopify.com/a.jpg']) {
    assert.equal(safeImageUrl(bad, wp), null, bad);
  }
  const o = { retailerId: 'wargame-portal', title: 'x', price: 50, currency: 'USD', url: 'https://wargameportal.com/p',
    imageUrl: 'https://www.miniaturemarket.com/a.jpg' };
  assert.equal(checkOffer(o).ok, true, 'a bad image never drops the offer');
  assert.equal(o.imageUrl, undefined, 'another store’s image is dropped');

  const cfg = getRetailer('miniature-market').adapter;
  const html = `<div class="item"><img data-src="https://cdn.miniaturemarket.com/media/int.jpg" alt="Warhammer 40K: Space Marines - Intercessor Squad"></div>
<div class="product-info"><a href="/int" class="product-name">Warhammer 40K: Space Marines - Intercessor Squad</a>
<span class="list-price-price">$67.50</span><span class="product-price with-list-price">$57.99</span></div>
<div class="item"><img src="https://cdn.miniaturemarket.com/media/other.jpg" alt="Some Other Box"></div>
<div class="product-info"><a href="/hb" class="product-name">Warhammer 40K: Space Marines - Hellblasters</a>
<span class="product-price">$57.99</span></div>`;
  const out = parseListing(html, cfg, 'https://www.miniaturemarket.com/search?search=x');
  assert.equal(out[0].imageUrl, 'https://cdn.miniaturemarket.com/media/int.jpg');
  assert.equal(out[0].listPrice, 67.5);
  assert.equal(out[1].imageUrl, undefined, 'the photo before card 2 is captioned for another product');
  // Overview picks the best offer's (sanitized) image for the card.
  const ov = buildOverview(miniSnap(), { now: T0 });
  assert.equal(ov.products.find((p) => p.id === 'space-marines-intercessors').imageUrl, 'https://cdn.miniaturemarket.com/media/intercessors.jpg');
});

test('snapshot refresh keeps list prices and safe images, drops unsafe ones', async () => {
  const factory = () => ({ async search() {
    return [
      { title: 'Space Marines Intercessors', price: 57.37, currency: 'USD', url: 'https://wargameportal.com/products/int',
        inStock: true, listPrice: 67.5, imageUrl: 'https://cdn.shopify.com/int.jpg' },
      { title: 'Space Marines Hellblasters', price: 57.37, currency: 'USD', url: 'https://wargameportal.com/products/hb',
        inStock: true, listPrice: 30, imageUrl: 'http://cdn.shopify.com/hb.jpg' },
    ];
  } });
  const res = await collectLive({ retailers: [getRetailer('wargame-portal')], factory, maxQueriesPerRetailer: 1 });
  const int = res.offers.find((o) => o.productId === 'space-marines-intercessors');
  assert.equal(int.listPrice, 67.5);
  assert.equal(int.imageUrl, 'https://cdn.shopify.com/int.jpg');
  const hb = res.offers.find((o) => o.productId === 'space-marines-hellblasters');
  assert.equal(hb.listPrice, undefined);
  assert.equal(hb.imageUrl, undefined);
});

test('product and faction payloads: offers, history, related, evidence; unknown ids', () => {
  const ov = buildOverview(miniSnap(), { now: T0 });
  const out = productPayload(ov, 'space-marines-intercessors');
  has(out.product, [...CARD_KEYS, 'blurb', 'offers', 'history', 'related', 'rrpEvidence'], 'product');
  assert.deepEqual(out.snapshot, { generatedAt: iso(0), demo: false });
  for (const o of out.product.offers) has(o, OFFER_KEYS, 'offer');
  assert.equal(out.product.offers[0].imageUrl, 'https://cdn.miniaturemarket.com/media/intercessors.jpg');
  assert.equal(out.product.offers.find((o) => o.retailerId === 'wargame-portal').imageUrl, null, 'unsafe image dropped');
  assert.deepEqual(out.product.history.at(-1), [iso(0), 52, 'miniature-market']);
  assert.equal(out.product.rrpSource, 'retailer-list');
  assert.equal(out.product.rrp, 67.5);
  assert.ok(out.product.related.length >= 4 && out.product.related.every((r) => ['space-marines', 'blood-angels', 'dark-angels',
    'space-wolves', 'black-templars', 'deathwatch'].includes(r.faction)));
  assert.equal(productPayload(ov, 'nope'), null);
  const f = factionPayload(ov, 'necrons');
  assert.equal(f.faction.name, 'Necrons');
  assert.ok(f.products.length >= 30 && f.products.every((p) => p.faction === 'necrons'));
  assert.deepEqual(factionPayload(ov, 'space-marines').faction.children.sort(), ['black-templars', 'blood-angels', 'dark-angels', 'deathwatch', 'space-wolves']);
  assert.equal(factionPayload(ov, 'nope'), null);
  assert.deepEqual(Object.keys(productCard(ov.products[0])).slice(0, CARD_KEYS.length), CARD_KEYS);
});

test('deals RSS: valid structure, escaped text, sample data labelled, no tracking', () => {
  assert.equal(xmlEscape('a & b <c> "d" \'e\'\u0001'), 'a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;');
  const ov = buildOverview(miniSnap(), { now: T0 });
  const xml = dealsRss(ov, { siteUrl: 'https://example.github.io/site/prices.html', selfUrl: 'https://example.github.io/site/data/deals.xml' });
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0"/);
  assert.equal((xml.match(/<item>/g) ?? []).length, 1, 'new low and drop for one product -> one item');
  assert.match(xml, /<title>New low: Space Marines Intercessors \$52.00 \(was \$55.00\)<\/title>/);
  assert.match(xml, /<link>https:\/\/www.miniaturemarket.com\/intercessors<\/link>/);
  assert.doesNotMatch(xml, /[?&](utm_|ref=|tag=)/);
  assert.equal((xml.match(/<item>/g) ?? []).length, (xml.match(/<\/item>/g) ?? []).length);
  // Every & in the document is an entity.
  assert.doesNotMatch(xml.replace(/&(amp|lt|gt|quot|apos);/g, ''), /&/);
  const demo = dealsRss(buildOverview(buildDemoSnapshot({ now: T0 }), { now: T0 }));
  assert.match(demo, /<title>\[SAMPLE DATA, not real prices\]/);
  for (const item of demo.split('<item>').slice(1)) assert.match(item, /SAMPLE DATA/);
  // Hostile product text stays escaped.
  const evil = { ...ov, products: ov.products.map((p) => (p.id === 'space-marines-intercessors' ? { ...p, name: '<script>&"' } : p)) };
  assert.match(dealsRss(evil), /New low: &lt;script&gt;&amp;&quot;/);
});

test('routes: overview v2, product, faction, feed; 404s', async () => {
  __reset();
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/prices`;
  try {
    const ov = await (await fetch(`${base}/overview?demo=1`)).json();
    assert.equal(ov.snapshot.demo, true);
    for (const k of ['products', 'drops', 'newLows', 'facets', 'topDeals', 'stores']) assert.ok(k in ov, k);
    has(ov.products[0], CARD_KEYS, 'card');
    assert.ok(ov.drops.length && ov.newLows.length, 'demo data has drops and new lows');
    assert.ok(ov.products.some((p) => p.rrpSource === 'retailer-list') && ov.products.some((p) => p.rrpSource === 'catalogue'));
    const prod = await (await fetch(`${base}/product/necron-warriors?demo=1`)).json();
    assert.equal(prod.product.id, 'necron-warriors');
    assert.ok(prod.product.offers.length && prod.product.history.length);
    const nf = await fetch(`${base}/product/nope?demo=1`);
    assert.equal(nf.status, 404);
    assert.ok((await nf.json()).error);
    assert.equal((await fetch(`${base}/product/${encodeURIComponent('<x>')}?demo=1`)).status, 404);
    const fac = await (await fetch(`${base}/faction/orks?demo=1`)).json();
    assert.equal(fac.faction.id, 'orks');
    assert.equal((await fetch(`${base}/faction/nope?demo=1`)).status, 404);
    const feed = await fetch(`${base}/feed.xml?demo=1`);
    assert.match(feed.headers.get('content-type'), /application\/rss\+xml/);
    assert.match(await feed.text(), /<rss version="2.0"/);
    // Same relative path as the static site's file, so pages can link "data/deals.xml" in both modes.
    const same = await fetch(`${base.replace('/api/prices', '')}/data/deals.xml?demo=1`);
    assert.equal(same.status, 200);
    assert.match(await same.text(), /atom:link href="http:\/\/127.0.0.1:\d+\/data\/deals.xml"/);
  } finally { await new Promise((r) => server.close(r)); }
});
