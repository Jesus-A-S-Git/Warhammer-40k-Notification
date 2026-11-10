// Static, APPROXIMATE exchange rates (units of currency per 1 GBP).
// Snapshot of rough late-2025/2026 levels. Used only to rank offers and to show
// an indicative converted price; no exchange-rate API is called. The UI labels
// converted prices as approximate.
export const RATES_PER_GBP = Object.freeze({
  GBP: 1,
  USD: 1.30,
  EUR: 1.17,
  CAD: 1.80,
  AUD: 2.00,
});
export const RATES_AS_OF = 'static 2026 snapshot';
export const CURRENCIES = Object.keys(RATES_PER_GBP);

export function isSupportedCurrency(c) { return Object.hasOwn(RATES_PER_GBP, c); }

/** Convert amount between supported currencies. Returns null if unsupported. */
export function convert(amount, from, to) {
  if (!isSupportedCurrency(from) || !isSupportedCurrency(to) || !Number.isFinite(amount)) return null;
  return Math.round((amount / RATES_PER_GBP[from]) * RATES_PER_GBP[to] * 100) / 100;
}
