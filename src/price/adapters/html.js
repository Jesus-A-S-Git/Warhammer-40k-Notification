// Generic HTML adapter: fetches a server-rendered search page and reads
// schema.org JSON-LD Product/Offer blocks. If the search page carries no
// JSON-LD, and `productLinkPattern` is configured, it follows up to
// `maxProductPages` product links (default 1, hard max 3) and reads JSON-LD
// there. Kept low: at 6 req/min each extra page costs ~10 s on a cold cache.
// An AbortSignal (`signal`) is passed to every politeFetch call so queued
// requests are dropped when the caller gives up. All requests go through politeFetch (rate limited + cached).
// VERIFY ON DEPLOY: search URLs and JSON-LD presence are unverified.
import { politeFetch } from '../../shared/httpClient.js';
import { parseJsonLdProducts } from './jsonld.js';
import { SEARCH_TTL_MS } from './shopify.js';

export const DEFAULT_PRODUCT_PAGES = 1;
export const MAX_PRODUCT_PAGES = 3;

export function htmlAdapter(retailer) {
  const cfg = retailer.adapter;
  return {
    async search(query, { signal } = {}) {
      const searchUrl = cfg.searchUrl.replace('{q}', encodeURIComponent(query));
      const html = await politeFetch(searchUrl, { as: 'text', ttlMs: SEARCH_TTL_MS, signal });
      let found = parseJsonLdProducts(html, searchUrl);

      if (!found.length && cfg.productLinkPattern) {
        const re = new RegExp(cfg.productLinkPattern, 'g');
        const links = [...new Set([...String(html).matchAll(re)].map((m) => m[1]))]
          .slice(0, Math.max(0, Math.min(cfg.maxProductPages ?? DEFAULT_PRODUCT_PAGES, MAX_PRODUCT_PAGES)));
        for (const link of links) {
          if (signal?.aborted) break;
          let abs;
          try { abs = new URL(link, searchUrl); } catch { continue; }
          if (!retailer.domains.includes(abs.hostname)) continue; // never leave the store
          try {
            const page = await politeFetch(abs.href, { as: 'text', ttlMs: SEARCH_TTL_MS, signal });
            found.push(...parseJsonLdProducts(page, abs.href));
          } catch (err) {
            // Skip one bad product page, but not an abort/busy/robots signal.
            if (signal?.aborted || ['BUSY', 'ROBOTS'].includes(err?.code)) throw err;
          }
        }
      }
      const fetchedAt = new Date().toISOString();
      return found.map((o) => ({ ...o, currency: o.currency ?? retailer.currency,
        retailerId: retailer.id, fetchedAt }));
    },
  };
}
