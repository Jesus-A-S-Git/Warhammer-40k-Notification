import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const run = promisify(execFile);

test('static build: browser-safe libs, STATIC config, relative links, and in-browser modules work', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'site-'));
  try {
    await run(process.execPath, ['scripts/build-static.js', dir]);
    assert.match(await readFile(path.join(dir, 'config.js'), 'utf8'), /STATIC = true/);
    for (const page of ['index.html', 'prices.html', 'combat.html']) {
      const html = await readFile(path.join(dir, page), 'utf8');
      assert.doesNotMatch(html, /(href|src)="\//, `${page} must use relative links for GitHub Pages`);
    }
    // The copied modules run standalone (as the browser would load them).
    const svc = await import(pathToFileURL(path.join(dir, 'lib/combat/service.js')));
    const { UNITS } = await import(pathToFileURL(path.join(dir, 'lib/combat/data/units.js')));
    const r = svc.runSimulation({
      attacker: { unitId: 'primaris-intercessors', models: 10, weaponIds: ['bolt-rifle'] },
      defender: { unitId: 'primaris-terminators', models: 5 },
    }, UNITS);
    assert.equal(r.expected.unsavedWounds.toFixed(2), '1.48');

    const rank = await import(pathToFileURL(path.join(dir, 'lib/price/rank.js')));
    const out = rank.rankOffers({
      query: 'intercessors',
      candidates: [
        { retailerId: 'element-games', __source: 'element-games', title: 'Space Marines: Intercessors',
          url: 'https://elementgames.co.uk/x', price: 36.9, currency: 'GBP', inStock: true },
        { retailerId: 'element-games', __source: 'element-games', title: 'Space Marines: Intercessors',
          url: 'https://elementgames.co.uk.evil.example/x', price: 5, currency: 'GBP', inStock: true },
      ],
    });
    assert.equal(out.results.length, 1, 'snapshot offers are re-checked by the trust filter');
    assert.equal(out.best.price, 36.9);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Seattle home: domestic offers get est. total with sales tax, best prefers US retailers', async () => {
  const { rankOffers } = await import('../src/price/rank.js');
  const { HOME } = await import('../src/price/location.js');
  assert.equal(HOME.label, 'Seattle, WA');
  const out = rankOffers({
    query: 'intercessors',
    candidates: [
      // Cheaper but ships from the UK: flagged international, not "best".
      { retailerId: 'element-games', __source: 'element-games', title: 'Space Marines: Intercessors',
        url: 'https://elementgames.co.uk/i', price: 36.9, currency: 'GBP', inStock: true },
      { retailerId: 'miniature-market', __source: 'miniature-market', title: 'Space Marines: Intercessors',
        url: 'https://www.miniaturemarket.com/i', price: 52, currency: 'USD', inStock: true },
    ],
  });
  const uk = out.results.find((o) => o.retailerId === 'element-games');
  const us = out.results.find((o) => o.retailerId === 'miniature-market');
  assert.ok(uk.flags.includes('international'));
  assert.equal(uk.estTotalHome, null);
  assert.equal(us.domestic, true);
  assert.equal(us.estTotalHome, Math.round(52 * (1 + HOME.salesTaxRate) * 100) / 100);
  assert.equal(out.best.retailerId, 'miniature-market');
});
