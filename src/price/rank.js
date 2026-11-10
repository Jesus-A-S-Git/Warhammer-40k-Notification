// Browser-safe ranking: trust-filter, match, flag, convert and sort candidate
// offers. Shared by the live API (search.js) and the static GitHub Pages build,
// which re-runs every trust check client-side on the published snapshot.
import { RETAILERS, publicRetailer } from './retailers.js';
import { checkOffer, flagOffer, compareOffers, SUSPICIOUS_RATIO } from './trust.js';
import { isMatch, matchScore } from './match.js';
import { findMsrp, msrpIn } from './msrp.js';
import { convert, RATES_AS_OF, RATES_PER_GBP } from './currency.js';
import { HOME } from './location.js';

export const DISCLAIMER =
  'Prices and stock change frequently and may exclude shipping. Always verify the final price at '
  + 'checkout on the retailer’s own site. Converted prices use static approximate exchange rates ('
  + RATES_AS_OF + '). MSRP values are approximate. Only allowlisted retailers are shown; '
  + 'links to any other domain are discarded.';

/**
 * @param {object} o
 * @param {string} o.query
 * @param {string} [o.region='All']
 * @param {string} [o.currency='native']
 * @param {boolean} [o.demo=false]
 * @param {object[]} o.candidates  offers, each with `__source` = id of the retailer whose adapter produced it (or null)
 * @param {object[]} [o.statuses]  per-retailer status entries
 * @param {object[]} [o.retailers] retailer order for statuses
 */
export function rankOffers({ query, region = 'All', currency = 'native', demo = false, candidates, statuses = [], retailers = RETAILERS, home = HOME }) {
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
    const domestic = !!home && r.region === home.region;
    if (home && !domestic) flags.push('international');
    const homePrice = home ? convert(offer.price, offer.currency, home.currency) : null;
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
      domestic,
      // Estimated total in the home currency incl. destination sales tax (domestic
      // retailers only; international orders add shipping + import fees instead).
      estTotalHome: domestic && homePrice != null ? Math.round(homePrice * (1 + home.salesTaxRate) * 100) / 100 : null,
      sortValue: convert(offer.price, offer.currency, 'GBP'),
    });
  }
  results.sort(compareOffers);
  // Best = cheapest trusted in-stock offer, preferring retailers that ship
  // domestically to the home location (no import fees); else any region.
  const eligible = (o) => o.inStock === true && !o.flags.includes('suspicious');
  const best = results.find((o) => eligible(o) && o.domestic) ?? results.find(eligible) ?? null;

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
    home: home ? { ...home } : null,
    disclaimer: DISCLAIMER,
  };
}

/** Public description of the retailer allowlist and trust policy. */
export function retailersInfo() {
  return {
    retailers: RETAILERS.map(publicRetailer),
    policy: {
      tiers: {
        official: 'Games Workshop’s own store; used as the MSRP reference.',
        authorized: 'Long-established independent stockists selling new GW product themselves.',
      },
      excluded: 'Marketplaces (Amazon, eBay, AliExpress, Etsy...) are excluded: listings come from '
        + 'arbitrary third-party sellers, so a domain allowlist cannot vouch for them.',
      domainRule: 'Offers are only shown when the product URL is https and its hostname exactly matches '
        + 'one of the retailer’s registered domains.',
      suspiciousRule: `Prices below ${Math.round(SUSPICIOUS_RATIO * 100)}% of approximate MSRP are flagged as suspicious.`,
    },
    currencies: { rates: RATES_PER_GBP, base: 'GBP', asOf: RATES_AS_OF, approximate: true },
    home: { ...HOME },
    disclaimer: DISCLAIMER,
  };
}
