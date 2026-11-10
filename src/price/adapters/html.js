// Generic HTML adapter: fetches a server-rendered search page and reads
// schema.org JSON-LD Product/Offer blocks. If the search page carries no
// JSON-LD, and `productLinkPattern` is configured, it follows up to
// `maxProductPages` (default 3, hard max 3) product links and reads JSON-LD
// there. All requests go through politeFetch (rate limited + cached).
// VERIFY ON DEPLOY: search URLs and JSON-LD presence are unverified.
import { politeFetch } from '../../shared/httpClient.js';
import { parseJsonLdProducts } from './jsonld.js';
import { SEARCH_TTL_MS } from './shopify.js';

export function htmlAdapter(retailer) {
  const cfg = retailer.adapter;
  return {
    async search(query) {
      const searchUrl = cfg.searchUrl.replace('{q}', encodeURIComponent(query));
      const html = await politeFetch(searchUrl, { as: 'text', ttlMs: SEARCH_TTL_MS });
      let found = parseJsonLdProducts(html, searchUrl);

      if (!found.length && cfg.productLinkPattern) {
        const re = new RegExp(cfg.productLinkPattern, 'g');
        const links = [...new Set([...String(html).matchAll(re)].map((m) => m[1]))]
          .slice(0, Math.min(cfg.maxProductPages ?? 3, 3));
        for (const link of links) {
          let abs;
          try { abs = new URL(link, searchUrl); } catch { continue; }
          if (!retailer.domains.includes(abs.hostname)) continue; // never leave the store
          try {
            const page = await politeFetch(abs.href, { as: 'text', ttlMs: SEARCH_TTL_MS });
            found.push(...parseJsonLdProducts(page, abs.href));
          } catch { /* skip one bad product page */ }
        }
      }
      const fetchedAt = new Date().toISOString();
      return found.map((o) => ({ ...o, currency: o.currency ?? retailer.currency,
        retailerId: retailer.id, fetchedAt }));
    },
  };
}
