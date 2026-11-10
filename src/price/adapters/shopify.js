// Generic Shopify adapter using the storefront predictive-search endpoint:
//   GET https://<host>/search/suggest.json?q=...&resources[type]=product&resources[limit]=10
// Response shape (Shopify Ajax API): { resources: { results: { products: [
//   { title, handle, url: "/products/<handle>?_pos=..", price: "45.00",
//     available: true, image: "https://cdn.shopify.com/..." } ] } } }
// Price is a decimal string in the shop's currency (some older themes return
// integer cents; set `priceInCents: true` in the config for those).
// VERIFY ON DEPLOY: could not be checked live from the build sandbox.
import { politeFetch } from '../../shared/httpClient.js';

export const SEARCH_TTL_MS = 30 * 60_000;

export function parseShopifySuggest(json, { host, currency, priceInCents = false }) {
  const products = json?.resources?.results?.products;
  if (!Array.isArray(products)) throw new Error('Unexpected Shopify suggest.json shape');
  const out = [];
  for (const p of products) {
    let price = typeof p.price === 'string' ? Number.parseFloat(p.price.replace(/,/g, ''))
      : Number(p.price ?? p.price_min);
    if (priceInCents || (typeof p.price === 'number' && Number.isInteger(p.price) && p.price > 10000)) price /= 100;
    const path = p.url ?? (p.handle ? `/products/${p.handle}` : null);
    if (!p.title || !path || !Number.isFinite(price)) continue;
    const u = new URL(path, `https://${host}`);
    u.search = ''; u.hash = '';
    let imageUrl = typeof p.image === 'string' ? p.image : p.featured_image?.url;
    if (imageUrl?.startsWith('//')) imageUrl = `https:${imageUrl}`;
    out.push({ title: String(p.title), price, currency, url: u.href,
      inStock: typeof p.available === 'boolean' ? p.available : null, imageUrl });
  }
  return out;
}

export function shopifyAdapter(retailer) {
  const cfg = retailer.adapter;
  return {
    async search(query, { signal } = {}) {
      const url = `https://${cfg.host}/search/suggest.json?q=${encodeURIComponent(query)}`
        + '&resources[type]=product&resources[limit]=10';
      const json = await politeFetch(url, { as: 'json', ttlMs: SEARCH_TTL_MS, signal });
      const fetchedAt = new Date().toISOString();
      return parseShopifySuggest(json, { host: cfg.host, currency: retailer.currency, priceInCents: cfg.priceInCents })
        .map((o) => ({ ...o, retailerId: retailer.id, fetchedAt }));
    },
  };
}
