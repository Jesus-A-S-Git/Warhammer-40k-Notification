import { setHostLimit } from '../../shared/httpClient.js';
import { RETAILERS } from '../retailers.js';
import { shopifyAdapter } from './shopify.js';
import { htmlAdapter } from './html.js';

// Conservative per-host budget: none of these retailers publish an API rate
// limit, so we stay well under the project-wide ≤10 req/min ceiling.
export const RETAILER_LIMIT = Object.freeze({ requestsPerMinute: 6, burst: 2, maxConcurrent: 1 });

/** Register a rate limit for EVERY registered hostname of every retailer. */
export function registerRetailerLimits(set = setHostLimit) {
  const hosts = [];
  for (const r of RETAILERS) {
    for (const host of new Set([...r.domains, ...(r.adapter?.host ? [r.adapter.host] : [])])) {
      set(host, { ...RETAILER_LIMIT });
      hosts.push(host);
    }
  }
  return hosts;
}
registerRetailerLimits();

const FACTORIES = { shopify: shopifyAdapter, html: htmlAdapter };

export function adapterFor(retailer) {
  const f = FACTORIES[retailer.adapter?.type];
  if (!f) throw new Error(`No adapter type ${retailer.adapter?.type} for ${retailer.id}`);
  return f(retailer);
}
