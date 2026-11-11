// Price search orchestration: fan out to allowlisted retailers, apply trust
// filter, fuzzy matching, MSRP flags, currency conversion and ranking.
import { RETAILERS } from './retailers.js';
import { adapterFor } from './adapters/index.js';
import { demoAdapter, UNTRUSTED_FIXTURES } from './fixtures.js';
import { rankOffers, DISCLAIMER } from './rank.js';

export { DISCLAIMER };

const DEFAULT_TIMEOUT_MS = 25_000;

/**
 * Run `fn(signal)` with a deadline. On timeout the AbortController fires, so
 * politeFetch drops this retailer's still-queued requests instead of spending
 * the host's rate budget on a search nobody is waiting for.
 */
function withTimeout(fn, ms) {
  const ctrl = new AbortController();
  let t;
  return Promise.race([
    Promise.resolve().then(() => fn(ctrl.signal)),
    new Promise((_, rej) => {
      t = setTimeout(() => {
        const err = new Error(`Timed out after ${ms} ms`); err.code = 'TIMEOUT';
        ctrl.abort(err); rej(err);
      }, ms);
    }),
  ]).finally(() => clearTimeout(t));
}

/** Map an adapter failure to a retailer status entry. */
export function statusForError(err) {
  switch (err?.code) {
    case 'BUSY': return { status: 'error', error: 'Retailer busy, try again shortly' };
    case 'ROBOTS': return { status: 'skipped', reason: 'Retailer’s robots.txt disallows automated search' };
    case 'RATE_LIMITED': return { status: 'error', error: 'Retailer is rate limiting us, try again later' };
    case 'REFUSED':
    case 'PAUSED': return { status: 'error', error: 'Store refused automated requests (HTTP 403); paused for an hour' };
    case 'REDIRECT': return { status: 'error', error: 'Retailer redirected to another site; result discarded' };
    default: return { status: 'error', error: safeError(err) };
  }
}

function safeError(err) {
  const msg = String(err?.message ?? err ?? 'Unknown error');
  return msg.length > 200 ? `${msg.slice(0, 197)}...` : msg;
}

/**
 * @param {object} o
 * @param {string} o.query
 * @param {'UK'|'US'|'EU'|'All'} [o.region='All']
 * @param {string} [o.currency='native']  target display currency or 'native'
 * @param {boolean} [o.demo=false]
 * @param {(retailer)=>{search:(q)=>Promise<object[]>}} [o.adapterFactory]
 * @param {object[]} [o.extraOffers]  extra candidate offers (tests/demo)
 */
export async function searchPrices({
  query, region = 'All', currency = 'native', demo = false,
  retailers = RETAILERS, adapterFactory, timeoutMs = DEFAULT_TIMEOUT_MS, extraOffers = [],
}) {
  const factory = adapterFactory ?? (demo ? demoAdapter : adapterFor);
  const statuses = [];
  const candidates = [];

  await Promise.all(retailers.map(async (r) => {
    const base = { id: r.id, name: r.name };
    if (region !== 'All' && r.region !== region) {
      statuses.push({ ...base, status: 'skipped', reason: `Not in region ${region}` }); return;
    }
    if (!demo && !adapterFactory && r.adapter?.live === false) {
      statuses.push({ ...base, status: 'skipped', reason: r.adapter.liveDisabledReason ?? 'Live lookups disabled for this store (see notes)' });
      return;
    }
    try {
      // A slow per-store rate limit means a request can wait its turn longer than the
      // default timeout; allow one full interval plus the normal budget.
      const rpm = r.rateLimit?.requestsPerMinute;
      const limitMs = rpm ? Math.max(timeoutMs, Math.ceil(60_000 / rpm) + timeoutMs) : timeoutMs;
      const offers = await withTimeout((signal) => factory(r).search(query, { signal }), limitMs);
      if (!Array.isArray(offers)) throw new Error('Adapter returned no list');
      let count = 0;
      for (const o of offers) {
        // An adapter may only speak for its own retailer.
        candidates.push({ ...o, __source: r.id });
        count++;
      }
      statuses.push({ ...base, status: 'ok', received: count });
    } catch (err) {
      statuses.push({ ...base, ...statusForError(err) });
    }
  }));
  if (demo) for (const o of UNTRUSTED_FIXTURES) candidates.push({ ...o, __source: null });
  for (const o of extraOffers) candidates.push({ ...o, __source: o.retailerId });

  return rankOffers({ query, region, currency, demo, candidates, statuses, retailers });
}
