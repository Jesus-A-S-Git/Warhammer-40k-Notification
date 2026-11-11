// End-to-end check of the real price pipeline (adapters + trust filter + ranking)
// for ONE query against the home-region retailers. Same rate limits as a refresh.
// Usage: node scripts/check-live-search.js [query]
import { searchPrices } from '../src/price/search.js';
import { HOME } from '../src/price/location.js';

const query = process.argv[2] || 'intercessors';
const r = await searchPrices({ query, region: HOME.region, currency: 'USD' });
console.log(`\n=== Live search "${query}" (${HOME.label}) ===`);
for (const s of r.retailers.filter((x) => !/^Not in region/.test(x.reason ?? ''))) {
  console.log(`${s.name.padEnd(40)} ${s.status}${s.received != null ? ` (${s.received} raw)` : ''}${s.error ? ` ${s.error}` : ''}${s.reason ? ` ${s.reason}` : ''}`);
}
console.log(`\n${r.results.length} trusted, matching offers. Dropped: ${JSON.stringify(r.filtered)}`);
for (const o of r.results.slice(0, 8)) {
  console.log(`  ${o.retailerName.padEnd(28)} $${o.price.toFixed(2).padStart(7)}  ${o.inStock === false ? 'OOS ' : ''}${o.flags.join(',')}  ${o.title}`);
}
if (r.best) console.log(`\nBest: ${r.best.retailerName} $${r.best.price} (≈ $${r.best.estTotalHome} with Seattle tax) ${r.best.url}`);
process.exit(r.results.length ? 0 : 1);
