// Deal maths: what an offer really costs delivered to the home location, and how
// good a deal that is. Browser-safe (copied into the static build's lib/).
//
//   landedCost(offer)      price + estimated shipping + sales tax / import duty
//   dealScore(...)         0-100: effective saving vs buying at RRP (with tax), stock, trust
//   orderCost(retailer, subtotal)  the same for a whole basket at one store (cart optimizer)
//
// EVERY shipping / tax / duty figure here is an ESTIMATE for a single order to the
// home location, and the UI labels it so. Store policies change; users can
// override shipping rules in the cart optimizer.
import { getRetailer } from './retailers.js';
import { convert } from './currency.js';
import { HOME } from './location.js';

export const SHIPPING_AS_OF = 'Nov 2026 estimate';

// Per-retailer shipping to a US (contiguous) address, in USD.
//   flat     typical cheapest standard rate below the free threshold
//   freeOver order subtotal (before tax) from which standard shipping is free; null = never
//   conf     'medium' = published policy as last seen; 'low' = rough estimate
// Stores not listed fall back to REGION_DEFAULTS.
export const SHIPPING_US = {
  'miniature-market': { flat: 8.99, freeOver: 99, conf: 'low',
    note: 'Free contiguous-US shipping over a threshold (≈$99 last seen); otherwise about $9.' },
  'discount-games-inc': { flat: 9.99, freeOver: 150, conf: 'low',
    note: 'Threshold and rate are rough estimates; check the cart.' },
  'wargame-portal': { flat: 9.99, freeOver: 150, conf: 'low',
    note: 'Threshold and rate are rough estimates; reviews mention slower dispatch.' },
  'noble-knight': { flat: 7.99, freeOver: 99, conf: 'low', note: 'Rough estimate.' },
};
// International parcels to the US (UK/EU stores): tracked shipping is expensive
// and, since the US ended duty-free "de minimis" imports in 2025, duty + carrier
// brokerage apply to most parcels.
export const REGION_DEFAULTS = {
  US: { flat: 9.99, freeOver: null, conf: 'low', note: 'Generic US shipping estimate.' },
  UK: { flat: 25, freeOver: null, conf: 'low', note: 'International tracked shipping from the UK (estimate).' },
  EU: { flat: 30, freeOver: null, conf: 'low', note: 'International tracked shipping from the EU (estimate).' },
};
// Import duty to the US as a share of the goods value, plus a carrier brokerage fee.
export const IMPORT_US = {
  UK: { rate: 0.10, fee: 10, note: 'US import duty on UK goods (≈10%) plus carrier fees; estimate.' },
  EU: { rate: 0.15, fee: 10, note: 'US import duty on EU goods (≈15%) plus carrier fees; estimate.' },
};

/** Whether a store charges the home location's sales tax. */
export function collectsTax(retailer, home = HOME) {
  // US stores of this size pass Washington's economic-nexus threshold, so they
  // collect destination sales tax (WA also taxes the shipping charge).
  return !!retailer && retailer.region === home.region;
}

/**
 * Shipping rule for a retailer, with optional user overrides
 * ({ [retailerId]: { flat, freeOver } }).
 */
export function shippingRule(retailerId, overrides = {}) {
  const r = getRetailer(retailerId);
  const base = SHIPPING_US[retailerId] ?? REGION_DEFAULTS[r?.region] ?? REGION_DEFAULTS.US;
  const o = overrides?.[retailerId];
  const num = (v, d) => (v === null ? null : Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Math.max(0, Number(v)) : d);
  if (!o) return { ...base, overridden: false };
  return { ...base, flat: num(o.flat, base.flat), freeOver: num(o.freeOver, base.freeOver), overridden: true };
}

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Cost of a basket at one store delivered to `home`, in the home currency.
 * @param {string} retailerId
 * @param {number} subtotal  goods total in the home currency
 */
export function orderCost(retailerId, subtotal, { home = HOME, overrides } = {}) {
  const r = getRetailer(retailerId);
  const rule = shippingRule(retailerId, overrides);
  const free = rule.freeOver != null && subtotal >= rule.freeOver;
  const shipping = subtotal > 0 && !free ? rule.flat : 0;
  const taxRate = collectsTax(r, home) ? home.salesTaxRate : 0;
  const tax = (subtotal + shipping) * taxRate; // WA taxes delivery charges too
  const imp = r && r.region !== home.region ? IMPORT_US[r.region] : null;
  const duty = imp && subtotal > 0 ? subtotal * imp.rate + imp.fee : 0;
  return {
    subtotal: r2(subtotal), shipping: r2(shipping), tax: r2(tax), duty: r2(duty),
    total: r2(subtotal + shipping + tax + duty),
    freeOver: rule.freeOver, toFree: rule.freeOver != null && !free ? r2(rule.freeOver - subtotal) : 0,
    taxRate, collectsTax: taxRate > 0, shippingNote: rule.note, shippingConf: rule.conf,
    dutyNote: imp?.note ?? null, estimate: true,
  };
}

// What buying at full RRP from a typical US store costs to ship: the baseline a
// deal is measured against (so a small kit isn't "worse than RRP" just because
// any single-item order pays shipping).
export const RRP_SHIPPING = { flat: 9.99, freeOver: 99 };

/** Rough delivered cost of buying the same item at RRP: price + typical shipping + tax. */
export function rrpBaseline(msrpHome, home = HOME) {
  if (msrpHome == null) return null;
  const ship = msrpHome >= RRP_SHIPPING.freeOver ? 0 : RRP_SHIPPING.flat;
  return r2((msrpHome + ship) * (1 + home.salesTaxRate));
}

/**
 * Deal score 0-100 (null when there's no RRP to compare with).
 *   0  = paying ~5% MORE than RRP delivered (RRP + typical shipping + tax); 100 = 30%+ below it.
 *   Stock: out of stock x0.4, unknown x0.85. Store caution -5.
 *   Suspiciously cheap listings score 0 (likely used/partial/mislabelled).
 */
export function dealScore({ total, msrpHome, inStock = true, suspicious = false, caution = false, home = HOME }) {
  const base = rrpBaseline(msrpHome, home);
  if (!base || !Number.isFinite(total)) return null;
  if (suspicious) return 0;
  const eff = 1 - total / base;
  let s = Math.max(0, Math.min(1, (eff + 0.05) / 0.35)) * 100;
  if (inStock === false) s *= 0.4; else if (inStock == null) s *= 0.85;
  if (caution) s -= 5;
  return Math.max(0, Math.min(100, Math.round(s)));
}

export function dealLabel(score) {
  if (score == null) return null;
  if (score >= 80) return 'Great deal';
  if (score >= 55) return 'Good deal';
  if (score >= 30) return 'Fair';
  return 'Poor';
}

/**
 * Deal summary for one offer bought on its own.
 * @param {{retailerId, price, currency, inStock, flags?: string[]}} offer
 * @param {number|null} msrpHome  RRP in the home currency
 */
export function offerDeal(offer, msrpHome, { home = HOME, overrides } = {}) {
  const r = getRetailer(offer.retailerId);
  const priceHome = convert(offer.price, offer.currency, home.currency);
  if (priceHome == null) return null;
  const cost = orderCost(offer.retailerId, priceHome, { home, overrides });
  const suspicious = !!offer.flags?.includes('suspicious');
  const score = dealScore({ total: cost.total, msrpHome, inStock: offer.inStock, suspicious, caution: !!r?.caution, home });
  return {
    currency: home.currency,
    price: r2(priceHome),
    ...cost,
    msrp: msrpHome,
    pctOff: msrpHome ? Math.round((1 - priceHome / msrpHome) * 100) : null,
    savings: msrpHome ? r2(msrpHome - priceHome) : null,
    // Saving on the delivered total vs paying RRP + typical shipping + tax.
    effectiveSavings: msrpHome ? r2(rrpBaseline(msrpHome, home) - cost.total) : null,
    score, label: dealLabel(score),
  };
}
