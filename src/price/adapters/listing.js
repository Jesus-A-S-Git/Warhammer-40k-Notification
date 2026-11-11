// Listing adapter: reads a store's server-rendered search results page when it
// has no JSON-LD. Each store's config says how a product card looks:
//
//   cardMarker   text that starts every product card, e.g. 'class="product-info"'
//   linkClass    class on the card's product <a>, e.g. 'product-name'
//   priceClass   class on the element holding the selling price, e.g. 'product-price'
//
// Selectors were taken from real search pages fetched by the retailer probe
// (scripts/probe-retailers.js, Nov 2026). If a store redesigns its pages the
// adapter returns no offers and the refresh log says so; it never guesses.
// All requests go through politeFetch (rate limited, cached, robots.txt).
import { politeFetch } from '../../shared/httpClient.js';
import { SEARCH_TTL_MS } from './shopify.js';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘' };

export function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

const stripTags = (s) => decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Parse product cards out of a search results page. */
export function parseListing(html, { cardMarker, linkClass, priceClass }, baseUrl) {
  const out = [];
  const cards = String(html).split(cardMarker).slice(1);
  const linkRe = new RegExp(`<a\\b(?=[^>]*\\bclass="[^"]*\\b${escapeRe(linkClass)}\\b)[^>]*>([\\s\\S]*?)</a>`, 'i');
  const priceRe = new RegExp(`class="[^"]*\\b${escapeRe(priceClass)}\\b[^"]*"[^>]*>\\s*\\$\\s?([\\d,]+(?:\\.\\d{2})?)`, 'i');
  for (const raw of cards) {
    const card = raw.slice(0, 6000); // a card never spans more; stops prices bleeding in from the next one
    const link = card.match(linkRe);
    const price = card.match(priceRe);
    if (!link || !price) continue;
    const href = link[0].match(/\bhref="([^"]+)"/i)?.[1];
    const title = stripTags(link[1]) || decodeEntities(link[0].match(/\btitle="([^"]+)"/i)?.[1] ?? '');
    const amount = Number.parseFloat(price[1].replace(/,/g, ''));
    if (!href || !title || !Number.isFinite(amount) || amount <= 0) continue;
    let url;
    try { url = new URL(decodeEntities(href), baseUrl); } catch { continue; }
    url.hash = '';
    const inStock = /out of stock|sold out|unavailable/i.test(card) ? false
      : /data-add-to-cart="true"|add to cart/i.test(card) ? true : null;
    out.push({ title, price: amount, url: url.href, inStock });
  }
  return out;
}

export function listingAdapter(retailer) {
  const cfg = retailer.adapter;
  return {
    async search(query, { signal } = {}) {
      const searchUrl = cfg.searchUrl.replace('{q}', encodeURIComponent(query));
      const html = await politeFetch(searchUrl, { as: 'text', ttlMs: SEARCH_TTL_MS, signal });
      const fetchedAt = new Date().toISOString();
      return parseListing(html, cfg, searchUrl)
        .slice(0, 20)
        .map((o) => ({ ...o, currency: retailer.currency, retailerId: retailer.id, fetchedAt }));
    },
  };
}
