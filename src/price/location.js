// Home location the Price Finder is tuned for. Change these values to
// re-target the site (e.g. another city or country).
//
// Seattle, WA: US retailers ship domestically (no import duty), prices shown in
// USD, and online orders shipped to Seattle are charged destination sales tax.
export const HOME = Object.freeze({
  label: 'Seattle, WA',
  region: 'US',
  currency: 'USD',
  // Seattle combined state + local sales tax. Approximate: rates change, so
  // verify at checkout. Only applied to offers from domestic (US) retailers.
  salesTaxRate: 0.1035,
  salesTaxLabel: 'Seattle sales tax (≈10.35%)',
});
