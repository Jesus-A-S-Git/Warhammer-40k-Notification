import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseListing, decodeEntities } from '../src/price/adapters/listing.js';
import { RETAILERS } from '../src/price/retailers.js';
import { checkOffer } from '../src/price/trust.js';
import { MINIATURE_MARKET, DISCOUNT_GAMES_INC } from './fixtures/listing-samples.js';

const cfg = (id) => RETAILERS.find((r) => r.id === id).adapter;

test('Miniature Market: reads title, selling price (not list price), stock', () => {
  const out = parseListing(MINIATURE_MARKET, cfg('miniature-market'), 'https://www.miniaturemarket.com/search?search=x');
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    title: 'Warhammer 40K: Space Marines - Intercessor Squad', price: 57.99, inStock: true,
    url: 'https://www.miniaturemarket.com/Warhammer-40K-Space-Marines-Intercessor-Squad/GW-48-115-2026',
  });
  assert.equal(out[1].price, 31.99);
  assert.equal(out[1].inStock, false);
});

test('Discount Games Inc: reads title, price (not old price), decodes entities and thousands', () => {
  const out = parseListing(DISCOUNT_GAMES_INC, cfg('discount-games-inc'), 'https://www.discountgamesinc.com/search/x/');
  assert.equal(out.length, 2);
  assert.equal(out[0].title, 'Space Marines - Intercessor Squad');
  assert.equal(out[0].price, 57.38);
  assert.equal(out[0].inStock, null);
  assert.equal(out[1].title, 'Space Marines - Assault Intercessors & Sergeant');
  assert.equal(out[1].price, 1057.38);
});

test('parsed offers pass the trust filter for their own store only', () => {
  const mm = parseListing(MINIATURE_MARKET, cfg('miniature-market'), 'https://www.miniaturemarket.com/');
  assert.equal(checkOffer({ ...mm[0], currency: 'USD', retailerId: 'miniature-market' }).ok, true);
  assert.equal(checkOffer({ ...mm[0], currency: 'USD', retailerId: 'discount-games-inc' }).ok, false);
});

test('a redesigned page yields no offers rather than guesses', () => {
  assert.deepEqual(parseListing('<div class="product-info"><a href="/x">Thing</a> £5</div>', cfg('miniature-market'), 'https://www.miniaturemarket.com/'), []);
  assert.equal(decodeEntities('A &amp; B &#39;x&#39; &#x2013;'), "A & B 'x' –");
});

test('live regression: "intercessors" must not match Interceptor cards or tanks', async () => {
  const { isMatch } = await import('../src/price/match.js');
  for (const t of ['Interceptor Mechan - Edge of Eternities (Near Mint)',
    'Elite Interceptor // Rejoinder - Secrets of Strixhaven (Near Mint)',
    'Flames of War WW2: US - T55 Interceptor Tank Destroyer Platoon']) {
    assert.equal(isMatch('intercessors', t), false, t);
  }
  assert.equal(isMatch('intercessors', 'Space Marines - Intercessor Squad'), true);
  assert.equal(isMatch('intersessors', 'Space Marines - Intercessor Squad'), true, 'one typo still forgiven');
  assert.equal(isMatch('necron warriers', 'Necrons: Necron Warriors'), true);
});

test('best price prefers the kit searched for over a cheaper, different kit', async () => {
  const { rankOffers } = await import('../src/price/rank.js');
  const mk = (retailerId, host, title, price) => ({ retailerId, __source: retailerId, title, price, currency: 'USD',
    inStock: true, url: `https://${host}/${encodeURIComponent(title)}` });
  const out = rankOffers({ query: 'intercessors', region: 'US', currency: 'USD', candidates: [
    mk('discount-games-inc', 'www.discountgamesinc.com', 'Space Marines - Jump Pack Intercessors', 52.70),
    mk('wargame-portal', 'wargameportal.com', 'Intercessor Squad', 57.37),
    mk('discount-games-inc', 'www.discountgamesinc.com', 'Space Marines - Intercessor Squad', 57.38),
  ] });
  assert.equal(out.results[0].price, 52.70, 'cheaper related kit still listed first');
  assert.equal(out.best.title, 'Intercessor Squad');
  assert.equal(out.best.price, 57.37);
});
