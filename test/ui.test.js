// Guards the shared UI contract other pages are written against.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const ui = await readFile(new URL('../public/ui.js', import.meta.url), 'utf8');
const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

const TOKENS = ['bg', 'surface', 'surface-2', 'text', 'muted', 'border', 'accent', 'accent-text',
  'good', 'warn', 'bad', 'info', 'radius', 'gap', 'shadow', 'font-mono',
  'maxw', 'sp-1', 'sp-4', 'sp-8', 'fs-sm', 'fs-md', 'fs-xl', 'fs-3xl', 'media-bg', 'deal', 'deal-text', 'overlay'];

const CLASSES = ['container', 'stack', 'row', 'spacer', 'grid', 'grid-2', 'grid-3', 'layout-sidebar', 'sticky',
  'card', 'compact', 'card-title', 'section-title', 'divider', 'callout',
  'field', 'field-row', 'hint', 'input-group', 'stepper',
  'btn', 'secondary', 'ghost', 'danger', 'sm', 'icon',
  'chips', 'chip', 'active', 'seg', 'tabs', 'tab', 'tab-panel',
  'stats', 'stat', 'stat-label', 'stat-value', 'stat-sub', 'badge', 'accent', 'tag', 'table-wrap', 'num', 'best',
  'bar', 'chart', 'axis', 'gridline', 'series', 'series-alt', 'label', 'price', 'strike', 'savings',
  'muted', 'error', 'empty', 'skeleton', 'spinner', 'toast-host', 'toast',
  'ac', 'ac-list', 'ac-item', 'ac-sub', 'kbd', 'visually-hidden', 'faction-dot',
  'page-head', 'lede', 'theme-toggle', 'brand',
  // v2 shop components
  'search-trigger', 'nav-icon', 'palette', 'palette-backdrop', 'cb-item', 'cb-group', 'hero-search', 'sample-banner',
  'pc', 'pc-grid', 'pc-list', 'pc-media', 'pc-link', 'off-badge', 'watch-btn', 'art', 'art-initials', 'rail', 'rail-track',
  'ftile', 'ctile', 'tile-grid', 'tools', 'tool', 'verdict', 'verdict-box', 'sec-head', 'crumbs', 'fac-hero',
  'browse', 'filters', 'toolbar', 'active-filters', 'pp', 'pp-media', 'buybox', 'buybar', 'kv', 'pchart', 'pchart-tip',
  'army', 'parsed', 'pl', 'totals', 'order', 'wl', 'wl-row', 'alert-banner', 'cell-sub'];

test('styles.css defines every contract token', () => {
  for (const t of TOKENS) assert.match(css, new RegExp(`--${t}\\s*:`), `missing --${t}`);
});

test('styles.css supports OS + forced dark/light themes', () => {
  assert.match(css, /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/);
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
});

test('styles.css defines every contract class', () => {
  for (const c of CLASSES) assert.match(css, new RegExp(`\\.${c}(?![\\w-])`), `missing .${c}`);
  for (const sel of ['tr.best', '[aria-pressed="true"]', '[aria-selected="true"]', '[aria-busy="true"]',
    'input[type="range"]', 'input[type="checkbox"]', 'thead th', 'header.site', 'footer.site'])
    assert.ok(css.includes(sel), `missing ${sel}`);
});

test('ui.js exports the shared helpers', () => {
  for (const fn of ['toast', 'el', 'fmtMoney', 'debounce'])
    assert.match(ui, new RegExp(`export function ${fn}\\(`), `missing export ${fn}`);
  assert.match(ui, /aria-current/);
  assert.match(ui, /data-theme-toggle/);
  assert.match(ui, /try \{ localStorage/);
  assert.match(ui, /app\/palette\.js/, 'ui.js lazy-loads the command palette');
  assert.match(ui, /e\.metaKey \|\| e\.ctrlKey/, 'Ctrl/Cmd+K opens the palette');
});

test('index.html uses the shared page skeleton', () => {
  assert.match(index, /<link rel="stylesheet" href="styles.css">/);
  assert.match(index, /<script type="module" src="ui.js"><\/script>/);
  assert.match(index, /<header class="site">/);
  assert.match(index, /<footer class="site">/);
  for (const href of ['"./"', '"prices.html"', '"combat.html"', '"deals.html"', '"faction.html"', '"army.html"', '"watchlist.html"'])
    assert.ok(index.includes(`href=${href}`), `missing link ${href}`);
  assert.match(index, /data-theme-toggle/);
});
