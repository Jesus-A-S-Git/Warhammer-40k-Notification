// Assembles the static GitHub Pages site in _site/:
//   public/*                 pages, styles, scripts (config.js switched to STATIC = true)
//   lib/combat, lib/price,   browser-safe modules shared with the server
//   lib/search
//   data/prices.json         price snapshot (from scripts/snapshot-prices.js; kept if present)
//
// Usage: node scripts/build-static.js [outDir]
import { cp, mkdir, writeFile, access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] ?? path.join(root, '_site'));

// Browser-safe modules only (no express, no node:*, no process.env).
const LIB = [
  'combat/engine.js', 'combat/service.js', 'combat/data/units.js',
  'combat/data/units.generated.js', 'combat/data/catalog.js',
  'price/rank.js', 'price/retailers.js', 'price/trust.js', 'price/match.js',
  'price/msrp.js', 'price/currency.js', 'price/location.js', 'price/watchlist.js',
  'search/fuzzy.js', 'combat/unitSearch.js',
];

await mkdir(out, { recursive: true });
await cp(path.join(root, 'public'), out, { recursive: true });
// GITHUB_REPOSITORY ("owner/repo") is set inside GitHub Actions; used for the Refresh prices button.
const repo = /^[\w.-]+\/[\w.-]+$/.test(process.env.GITHUB_REPOSITORY ?? '') ? process.env.GITHUB_REPOSITORY : '';
await writeFile(path.join(out, 'config.js'), `export const STATIC = true;\nexport const REPO = ${JSON.stringify(repo)};\n`);
await writeFile(path.join(out, '.nojekyll'), '');

for (const f of LIB) {
  const src = path.join(root, 'src', f);
  const text = await readFile(src, 'utf8');
  if (/from ['"](node:|express)|process\.env/.test(text)) throw new Error(`${f} is not browser-safe`);
  const dest = path.join(out, 'lib', f);
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest);
}

const snap = path.join(out, 'data', 'prices.json');
try { await access(snap); } catch {
  console.warn('No data/prices.json yet: run scripts/snapshot-prices.js first. Writing an empty snapshot.');
  await mkdir(path.dirname(snap), { recursive: true });
  await writeFile(snap, JSON.stringify({ generatedAt: null, demo: false, offers: [], retailers: [], watchlist: [] }));
}
console.log(`Static site written to ${out}`);
