// Price Finder UI. All retailer-provided strings are inserted with
// textContent / setAttribute only, never innerHTML.

import { STATIC, REPO } from './config.js';
// Shared typo-tolerant scorer (src/search/fuzzy.js; served at lib/search/ in both modes).
import { bestMatches, suggest, normalize } from './lib/search/fuzzy.js';

const REFRESH_URL = STATIC && /^[\w.-]+\/[\w.-]+$/.test(REPO || '')
  ? `https://github.com/${REPO}/actions/workflows/pages.yml` : null;

// On the static (GitHub Pages) build, results come from a published snapshot.
const doFetch = STATIC ? (await import('./static-api.js')).staticFetch : (p, o) => fetch(p, o);

const $ = (id) => document.getElementById(id);
const form = $('search-form');

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}

function money(amount, currency) {
  if (amount == null || !Number.isFinite(amount)) return '–';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount); }
  catch { return `${amount.toFixed(2)} ${currency}`; }
}

/** Only allow https links in hrefs (server already enforces this). */
function safeHref(u) {
  try { const x = new URL(u); return x.protocol === 'https:' ? x.href : null; } catch { return null; }
}

function extLink(url, text, cls) {
  const href = safeHref(url);
  if (!href) return el('span', { text });
  return el('a', { href, class: cls, target: '_blank', rel: 'noopener noreferrer nofollow', text });
}

const TIER_BADGE = { official: ['good', 'Official'], authorized: ['good', 'Trusted stockist'] };
const FLAG_BADGE = {
  suspicious: ['bad', 'Suspiciously cheap'],
  'out-of-stock': ['warn', 'Out of stock'],
  'stock-unknown': ['warn', 'Stock unknown'],
  international: ['warn', 'Ships internationally'],
};
function badge(kind, text, title) { return el('span', { class: `badge ${kind}`, text, title }); }
function tierBadge(tier) { const [k, t] = TIER_BADGE[tier] ?? ['warn', tier]; return badge(k, t); }

function stockCell(s) {
  if (s === true) return badge('good', 'In stock');
  if (s === false) return badge('bad', 'Out of stock');
  return badge('warn', 'Unknown');
}

function savingText(o) {
  if (o.savingPct == null) return null;
  if (o.savingPct > 0) return `${o.savingPct}% below MSRP (${money(o.msrp, o.currency)})`;
  if (o.savingPct < 0) return `${-o.savingPct}% above MSRP (${money(o.msrp, o.currency)})`;
  return `At MSRP (${money(o.msrp, o.currency)})`;
}

function renderBest(data) {
  const box = $('best');
  box.replaceChildren();
  const b = data.best;
  if (!b) {
    box.append(el('h2', { text: 'Best price' }),
      el('p', { class: 'muted', text: 'No trusted in-stock offer found for this search.' }));
    return;
  }
  const conv = b.convertedPrice != null && b.convertedCurrency !== b.currency ? ` ≈ ${money(b.convertedPrice, b.convertedCurrency)}` : '';
  box.append(
    el('h2', { text: 'Best price (cheapest trusted, in stock)' }),
    el('div', { class: 'price', text: money(b.price, b.currency) + conv }),
    b.estTotalHome != null && data.home
      ? el('div', { class: 'muted', text: `≈ ${money(b.estTotalHome, data.home.currency)} incl. ${data.home.salesTaxLabel}, before shipping` })
      : (data.home && !b.domestic ? el('div', { class: 'muted', text: `Ships internationally to ${data.home.label}: add shipping and possible import fees.` }) : null),
    extLink(b.url, b.title, 'title'),
    el('div', { class: 'meta' },
      el('span', { text: b.retailerName }), tierBadge(b.tier),
      savingText(b) ? el('span', { class: 'muted', text: savingText(b) }) : null),
  );
}

function renderMeta(data) {
  const m = data.msrp;
  if (m) {
    const parts = [`£${m.GBP}`, `$${m.USD}`, `€${m.EUR}`].join(' / ');
    $('msrp').textContent = `Approx. MSRP for “${m.name}”: ${parts} (approximate, ${m.source}).`;
  } else {
    $('msrp').textContent = 'No reference MSRP for this search, so the “too good to be true” check is limited.';
  }
  const ul = $('retailer-status');
  ul.replaceChildren();
  for (const r of data.retailers) {
    const kind = r.status === 'ok' ? 'good' : r.status === 'error' ? 'bad' : 'warn';
    const label = r.status === 'ok' ? `${r.name}: ok` : r.status === 'error' ? `${r.name}: failed` : `${r.name}: skipped`;
    ul.append(el('li', {}, badge(kind, label, r.error ?? r.reason ?? '')));
  }
  const f = data.filtered ?? {};
  const unsafe = (f['domain-mismatch'] ?? 0) + (f['insecure-url'] ?? 0) + (f['unlisted-retailer'] ?? 0)
    + (f['retailer-mismatch'] ?? 0) + (f['bad-url'] ?? 0);
  $('filtered').textContent = unsafe
    ? `${unsafe} offer(s) were discarded because they pointed to an untrusted or insecure site.`
    : '';
}

function renderRows(data) {
  const tbody = $('rows');
  tbody.replaceChildren();
  $('conv-head').textContent = data.currency === 'native' ? 'Converted' : `≈ ${data.currency}`;
  if (!data.results.length) {
    tbody.append(el('tr', {}, el('td', { colspan: '6', class: 'muted', text: 'No matching offers from trusted retailers.' })));
    return;
  }
  for (const o of data.results) {
    const flags = el('td', { class: 'flags opt' });
    for (const f of o.flags) {
      if (f === 'out-of-stock') continue; // shown in stock column
      const [k, t] = FLAG_BADGE[f] ?? ['warn', f];
      flags.append(badge(k, t, f === 'suspicious'
        ? 'Far below MSRP. The store is on our trusted list, but double-check the listing (e.g. used, partial or mislabelled).' : ''));
    }
    const s = savingText(o);
    tbody.append(el('tr', { class: o.inStock === false ? 'oos' : null },
      el('td', {}, el('div', { text: o.retailerName }), tierBadge(o.tier)),
      el('td', {}, extLink(o.url, o.title), s ? el('div', { class: 'muted', text: s }) : null),
      el('td', { class: 'num' }, el('div', { text: money(o.price, o.currency) }),
        o.estTotalHome != null && data.home
          ? el('div', { class: 'muted', title: `Incl. ${data.home.salesTaxLabel}`, text: `≈ ${money(o.estTotalHome, data.home.currency)} w/ tax` })
          : null),
      el('td', { class: 'num', text: o.convertedPrice != null && o.convertedCurrency !== o.currency ? money(o.convertedPrice, o.convertedCurrency) : '–' }),
      el('td', {}, stockCell(o.inStock)),
      flags,
    ));
  }
}

/* ------------------------------------------------- autocomplete + did you mean */

let vocab = [];       // kit names for suggestions (watchlist + MSRP names, or snapshot titles)
let popular = [];

/** Show "Did you mean X?" (X is a button that runs that search), or hide it. */
function renderDidYouMean(corrected, prefix = 'Did you mean') {
  const box = $('dym');
  if (!corrected) { box.classList.add('hidden'); box.replaceChildren(); return; }
  const btn = el('button', { type: 'button', class: 'linkish', text: corrected });
  btn.addEventListener('click', () => runQuery(corrected));
  box.replaceChildren(document.createTextNode(`${prefix} `), btn, document.createTextNode('?'));
  box.classList.remove('hidden');
}

/** Closest known kit name for a query that found nothing, or null. */
function closestKit(q) {
  const fixed = suggest(q, vocab);
  if (fixed && normalize(fixed) !== normalize(q)) return fixed;
  const top = bestMatches(q, vocab, { limit: 1, threshold: 0.45 })[0];
  return top && normalize(top.item) !== normalize(q) ? top.item : null;
}

function runQuery(q) {
  $('q').value = q;
  combo.close();
  form.requestSubmit();
}

// ARIA 1.2 combobox with a listbox popup (arrow keys, Enter, Escape, mouse/touch).
const combo = (() => {
  const input = $('q');
  const list = $('q-list');
  let items = [];
  let active = -1;

  function setActive(i) {
    active = i;
    [...list.children].forEach((li, k) => li.setAttribute('aria-selected', k === i ? 'true' : 'false'));
    if (i >= 0) {
      const li = list.children[i];
      input.setAttribute('aria-activedescendant', li.id);
      li.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  function close() {
    list.hidden = true; items = []; active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
  function open(matches) {
    items = matches;
    list.replaceChildren(...matches.map((m, i) => {
      const li = el('li', { id: `q-opt-${i}`, role: 'option', 'aria-selected': 'false' });
      li.textContent = m;
      // pointerdown keeps focus in the input; click picks (works for mouse and touch).
      li.addEventListener('pointerdown', (e) => e.preventDefault());
      li.addEventListener('click', () => runQuery(m));
      return li;
    }));
    if (!matches.length) return close();
    list.hidden = false; active = -1;
    input.setAttribute('aria-expanded', 'true');
  }
  function update() {
    const q = input.value.trim();
    if (q.length < 2 || !vocab.length) return close();
    open(bestMatches(q, vocab, { limit: 8, threshold: 0.6 }).map((m) => m.item));
  }
  input.addEventListener('input', update);
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) update(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (list.hidden) { update(); if (list.hidden) return; }
      e.preventDefault();
      const n = items.length;
      setActive(e.key === 'ArrowDown' ? (active + 1) % n : (active <= 0 ? n - 1 : active - 1));
    } else if (e.key === 'Enter' && !list.hidden && active >= 0) {
      e.preventDefault();
      runQuery(items[active]);
    } else if (e.key === 'Escape') {
      if (!list.hidden) { e.preventDefault(); close(); }
    } else if (e.key === 'Tab') close();
  });
  return { close, update };
})();

async function loadSuggestions() {
  try {
    const res = await doFetch('/api/prices/suggestions');
    if (!res.ok) return;
    const data = await res.json();
    vocab = (data.suggestions ?? []).filter((x) => typeof x === 'string');
    popular = (data.popular ?? []).filter((x) => typeof x === 'string').slice(0, 10);
  } catch { return; }
  const row = $('popular');
  for (const name of popular) {
    const chip = el('button', { type: 'button', class: 'chip', text: name });
    chip.addEventListener('click', () => runQuery(name));
    row.append(chip);
  }
  if (popular.length) row.classList.remove('hidden');
  if (document.activeElement === $('q')) combo.update();
}

async function search(params) {
  $('error').classList.add('hidden');
  renderDidYouMean(null);
  $('go').disabled = true;
  $('status').textContent = 'Searching trusted retailers… (live lookups are rate-limited and may take a moment)';
  try {
    const res = await doFetch(`/api/prices/search?${params}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    renderBest(data); renderMeta(data); renderRows(data);
    $('disclaimer').textContent = data.disclaimer;
    $('results').classList.remove('hidden');
    const n = data.results.length;
    const as = data.searchedFor ? ` (searched as “${data.searchedFor}”)` : '';
    $('status').textContent = `${n} offer${n === 1 ? '' : 's'} for “${data.query}”${as}${data.demo ? ' (demo data)' : ''}.`;
    // Typos are already forgiven in the results; offer the corrected spelling,
    // or, when nothing matched, the closest tracked kit.
    renderDidYouMean(data.didYouMean?.corrected || (!n ? closestKit(data.query) : null));
    renderSnapshot(data);
  } catch (err) {
    $('status').textContent = '';
    $('error').textContent = err.message;
    $('error').classList.remove('hidden');
  } finally {
    $('go').disabled = false;
  }
}

function renderSnapshot(data) {
  const box = $('snapshot-note');
  if (!box) return;
  const s = data.snapshot;
  if (!s) { box.classList.add('hidden'); return; }
  const when = s.generatedAt ? new Date(s.generatedAt).toLocaleString() : 'never (press “Refresh prices” to fetch the first prices)';
  const parts = [el('div', { text: `Prices last updated: ${when}. Prices only refresh when the site owner presses “Refresh prices”.` })];
  if (REFRESH_URL) {
    parts.push(el('p', {}, el('a', { class: 'button', href: REFRESH_URL, target: '_blank', rel: 'noopener noreferrer',
      text: 'Refresh prices' }),
      el('span', { class: 'muted', text: ' Opens GitHub: click “Run workflow” (repo owner only). New prices appear in about 5–10 minutes.' })));
  }
  if (s.demo) {
    parts.push(el('div', { class: 'error', text: `SAMPLE DATA, not real prices. ${s.fallbackReason ?? ''}` }));
  }
  if (!data.results.length && s.watchlist?.length) {
    parts.push(el('div', { class: 'muted', text: `No tracked offers match. Tracked kits: ${s.watchlist.join(', ')}.` }));
  }
  box.replaceChildren(...parts);
  box.classList.remove('hidden');
}

function paramsFromForm() {
  const p = new URLSearchParams();
  p.set('q', $('q').value.trim());
  p.set('region', $('region').value);
  p.set('currency', $('currency').value);
  if (!STATIC && $('demo').checked) p.set('demo', '1');
  return p;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  combo.close();
  const q = $('q').value.trim();
  if (q.length < 2 || q.length > 100) {
    $('error').textContent = 'Please enter 2–100 characters.';
    $('error').classList.remove('hidden');
    return;
  }
  const p = paramsFromForm();
  history.replaceState(null, '', `?${p}`);
  try { localStorage.setItem('prices.prefs', JSON.stringify({ region: $('region').value, currency: $('currency').value })); } catch { /* ignore */ }
  search(p);
});

async function loadRetailers() {
  const box = $('retailer-list');
  try {
    const res = await doFetch('/api/prices/retailers');
    const data = await res.json();
    const tbody = el('tbody');
    for (const r of data.retailers) {
      tbody.append(el('tr', {},
        el('td', {}, el('div', { text: r.name }), tierBadge(r.tier)),
        el('td', { text: `${r.region} · ${r.currency}` }),
        el('td', { class: 'opt', text: r.domains.join(', ') }),
        el('td', {}, el('div', { text: r.notes }), el('div', { class: 'muted', text: r.shippingNote }),
          r.liveLookups ? null : el('div', { class: 'muted', text: 'Live lookups disabled; used as MSRP reference.' })),
      ));
    }
    const p = data.policy;
    box.replaceChildren(
      el('p', { text: p.domainRule }), el('p', { text: p.suspiciousRule }), el('p', { class: 'muted', text: p.excluded }),
      el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Store' }), el('th', { text: 'Region' }),
        el('th', { class: 'opt', text: 'Domains' }), el('th', { text: 'Why trusted' }))), tbody),
    );
  } catch {
    box.replaceChildren(el('p', { class: 'error', text: 'Could not load the retailer list.' }));
  }
}

// Restore state from URL / saved prefs.
(function init() {
  const u = new URLSearchParams(location.search);
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem('prices.prefs') || '{}'); } catch { /* ignore */ }
  const setSel = (id, v) => { if (v && [...$(id).options].some((o) => o.value === v)) $(id).value = v; };
  setSel('region', u.get('region') ?? prefs.region);
  setSel('currency', u.get('currency') ?? prefs.currency);
  if (u.get('demo') === '1') $('demo').checked = true;
  $('about').addEventListener('toggle', () => { if ($('about').open && !$('about').dataset.loaded) { $('about').dataset.loaded = '1'; loadRetailers(); } });
  const q = u.get('q');
  if (q) { $('q').value = q; search(paramsFromForm()); }
  loadSuggestions();
})();

if (STATIC) {
  // The static site has no live search or demo toggle: everything comes from the snapshot.
  $('demo')?.closest('label')?.classList.add('hidden');
}
