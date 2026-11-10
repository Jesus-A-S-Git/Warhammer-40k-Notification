// Price search orchestration: fan out to allowlisted retailers, apply trust
// filter, fuzzy matching, MSRP flags, currency conversion and ranking.
import { RETAILERS } from './retailers.js';
import { adapterFor } from './adapters/index.js';
import { demoAdapter, UNTRUSTED_FIXTURES } from './fixtures.js';
import { checkOffer, flagOffer, compareOffers } from './trust.js';
import { isMatch, matchScore } from './match.js';
import { findMsrp, msrpIn } from './msrp.js';
import { convert, RATES_AS_OF } from './currency.js';

export const DISCLAIMER =
  'Prices and stock change frequently and may exclude shipping. Always verify the final price at '
  + 'checkout on the retailer’s own site. Converted prices use static approximate exchange rates ('
  + RATES_AS_OF + '). MSRP values are approximate. Only allowlisted retailers are shown; '
  + 'links to any other domain are discarded.';

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
      statuses.push({ ...base, status: 'skipped', reason: 'Live lookups disabled for this store (see notes)' });
      return;
    }
    try {
      const offers = await withTimeout((signal) => factory(r).search(query, { signal }), timeoutMs);
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

  const dropped = {};
  const drop = (reason) => { dropped[reason] = (dropped[reason] ?? 0) + 1; };
  const queryMsrp = findMsrp(query);
  const seen = new Set();
  const results = [];
  const byId = new Map(RETAILERS.map((r) => [r.id, r]));

  for (const c of candidates) {
    const { __source, ...offer } = c;
    if (__source && offer.retailerId !== __source) { drop('retailer-mismatch'); continue; }
    const check = checkOffer(offer);
    if (!check.ok) { drop(check.reason); continue; }
    if (!isMatch(query, offer.title)) { drop('no-match'); continue; }
    const href = new URL(offer.url).href;
    if (seen.has(href)) { drop('duplicate'); continue; }
    seen.add(href);
    const r = byId.get(offer.retailerId);
    if (region !== 'All' && r.region !== region) { drop('region'); continue; }
    const { flags, msrp, savingPct } = flagOffer(offer, queryMsrp);
    const target = currency === 'native' ? null : currency;
    results.push({
      retailerId: r.id, retailerName: r.name, tier: r.tier, region: r.region,
      title: offer.title, url: new URL(offer.url).href, imageUrl: offer.imageUrl,
      price: Math.round(offer.price * 100) / 100, currency: offer.currency,
      convertedPrice: target ? convert(offer.price, offer.currency, target) : null,
      convertedCurrency: target,
      inStock: typeof offer.inStock === 'boolean' ? offer.inStock : null,
      msrp, savingPct, flags,
      relevance: Math.round(matchScore(query, offer.title) * 100) / 100,
      fetchedAt: offer.fetchedAt ?? new Date().toISOString(),
      sortValue: convert(offer.price, offer.currency, 'GBP'),
    });
  }
  results.sort(compareOffers);
  const best = results.find((o) => o.inStock === true && !o.flags.includes('suspicious')) ?? null;

  const order = new Map(retailers.map((r, i) => [r.id, i]));
  statuses.sort((a, b) => order.get(a.id) - order.get(b.id));

  return {
    query, region, currency, demo,
    results: results.map(({ sortValue, ...o }) => o),
    best: best ? (({ sortValue, ...o }) => o)(best) : null,
    retailers: statuses,
    msrp: queryMsrp ? {
      name: queryMsrp.name, GBP: queryMsrp.GBP, USD: queryMsrp.USD, EUR: queryMsrp.EUR,
      inCurrency: currency === 'native' ? null : msrpIn(queryMsrp, currency),
      approximate: true, source: queryMsrp.source,
    } : null,
    filtered: dropped,
    disclaimer: DISCLAIMER,
  };
}
