// Reputability safeguards. Every offer, live or demo, passes through here.
import { getRetailer } from './retailers.js';
import { isSupportedCurrency } from './currency.js';
import { findMsrp, msrpIn } from './msrp.js';

export const SUSPICIOUS_RATIO = 0.55; // < 55% of MSRP is "too good to be true"

/**
 * Hard gate: is this offer from an allowlisted retailer, on one of that
 * retailer's exact registered hostnames, over https?
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
export function checkOffer(offer) {
  const retailer = getRetailer(offer?.retailerId);
  if (!retailer) return { ok: false, reason: 'unlisted-retailer' };
  let u;
  try { u = new URL(offer.url); } catch { return { ok: false, reason: 'bad-url' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'insecure-url' };
  if (u.username || u.password || u.port) return { ok: false, reason: 'bad-url' };
  // Exact hostname match. No suffix/subdomain matching, so lookalikes such as
  // "elementgames.co.uk.evil.example" or "elementgames-uk.shop" are rejected.
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!retailer.domains.includes(host)) return { ok: false, reason: 'domain-mismatch' };
  if (!(typeof offer.price === 'number' && Number.isFinite(offer.price) && offer.price > 0)) {
    return { ok: false, reason: 'bad-price' };
  }
  if (!isSupportedCurrency(offer.currency)) return { ok: false, reason: 'unsupported-currency' };
  if (offer.imageUrl) {
    // Images are optional; drop non-https image URLs rather than the offer.
    try { if (new URL(offer.imageUrl).protocol !== 'https:') offer.imageUrl = undefined; }
    catch { offer.imageUrl = undefined; }
  }
  return { ok: true };
}

/**
 * Soft checks: returns flags for an offer that passed checkOffer().
 * @param {object} offer
 * @param {object|null} fallbackMsrp  MSRP entry for the query (used when the
 *   offer title doesn't map to a specific table entry itself)
 */
export function flagOffer(offer, fallbackMsrp = null) {
  const flags = [];
  const entry = findMsrp(offer.title) ?? fallbackMsrp;
  const msrp = msrpIn(entry, offer.currency);
  let savingPct = null;
  if (msrp) {
    savingPct = Math.round((1 - offer.price / msrp) * 100);
    if (offer.price < msrp * SUSPICIOUS_RATIO) flags.push('suspicious');
  }
  if (offer.inStock === false) flags.push('out-of-stock');
  if (offer.inStock == null) flags.push('stock-unknown');
  return { flags, msrp, savingPct };
}

/** Partition offers into accepted and rejected (with reasons). */
export function filterTrusted(offers) {
  const accepted = []; const rejected = [];
  for (const o of offers) {
    const r = checkOffer(o);
    if (r.ok) accepted.push(o); else rejected.push({ offer: o, reason: r.reason });
  }
  return { accepted, rejected };
}

const STOCK_RANK = (s) => (s === true ? 0 : s == null ? 1 : 2);
/** In-stock first, then unknown, then out-of-stock; within each, by price. */
export function compareOffers(a, b) {
  return STOCK_RANK(a.inStock) - STOCK_RANK(b.inStock)
    || (a.sortValue ?? Infinity) - (b.sortValue ?? Infinity)
    || String(a.retailerId).localeCompare(String(b.retailerId));
}
