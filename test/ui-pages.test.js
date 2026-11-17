// Every page shares the v2 shell (header, palette trigger, footer disclaimer),
// uses relative links (GitHub Pages project site) and loads only modules that exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const pages = (await readdir(pub)).filter((f) => f.endsWith('.html'));

test('all expected pages exist', () => {
  for (const p of ['index.html', 'deals.html', 'faction.html', 'product.html', 'army.html', 'watchlist.html', 'prices.html', 'combat.html'])
    assert.ok(pages.includes(p), `missing ${p}`);
});

for (const page of pages) {
  test(`${page} uses the shared shell`, async () => {
    const html = await readFile(path.join(pub, page), 'utf8');
    assert.doesNotMatch(html, /(href|src)="\//, 'links must be relative');
    assert.match(html, /<link rel="stylesheet" href="styles.css">/);
    assert.match(html, /<script type="module" src="ui.js"><\/script>/);
    assert.match(html, /<header class="site">/);
    assert.match(html, /data-palette/);
    assert.match(html, /data-theme-toggle/);
    assert.match(html, /data-watch-count/);
    for (const href of ['deals.html', 'faction.html', 'army.html', 'combat.html']) assert.ok(html.includes(`href="${href}"`), `nav link ${href}`);
    assert.match(html, /not affiliated with or endorsed by Games Workshop/);
    assert.match(html, /<meta name="viewport"/);
    for (const [, src] of html.matchAll(/<script type="module" src="([^"]+)"/g)) await access(path.join(pub, src));
  });
}

test('app modules only import files that exist (or the build-provided lib/)', async () => {
  const dir = path.join(pub, 'app');
  for (const f of (await readdir(dir)).filter((x) => x.endsWith('.js'))) {
    const src = await readFile(path.join(dir, f), 'utf8');
    for (const [, spec] of src.matchAll(/(?:from|import\()\s*'(\.[^']+)'/g)) {
      const target = path.resolve(dir, spec);
      if (target.includes(`${path.sep}lib${path.sep}`)) continue; // copied in by build-static / served by the server
      await access(target).catch(() => assert.fail(`${f} imports missing ${spec}`));
    }
    assert.doesNotMatch(src, /innerHTML\s*=\s*[^'`;]*\b(p|o|offer|product)\./, `${f}: retailer data must not go through innerHTML`);
  }
});

test('images are lazy, no-referrer, https-only', async () => {
  const kit = await readFile(path.join(pub, 'app', 'kit.js'), 'utf8');
  assert.match(kit, /loading: eager \? 'eager' : 'lazy'/);
  assert.match(kit, /referrerpolicy: 'no-referrer'/);
  assert.match(kit, /safeHttps\(p\.imageUrl\)/);
});
