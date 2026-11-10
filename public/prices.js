// Price Finder UI. All retailer-provided strings are inserted with
// textContent / setAttribute only, never innerHTML.

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
  const conv = b.convertedPrice != null ? ` ≈ ${money(b.convertedPrice, b.convertedCurrency)}` : '';
  box.append(
    el('h2', { text: 'Best price (cheapest trusted, in stock)' }),
    el('div', { class: 'price', text: money(b.price, b.currency) + conv }),
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
      el('td', { class: 'num', text: money(o.price, o.currency) }),
      el('td', { class: 'num', text: o.convertedPrice != null ? money(o.convertedPrice, o.convertedCurrency) : '–' }),
      el('td', {}, stockCell(o.inStock)),
      flags,
    ));
  }
}

async function search(params) {
  $('error').classList.add('hidden');
  $('go').disabled = true;
  $('status').textContent = 'Searching trusted retailers… (live lookups are rate-limited and may take a moment)';
  try {
    const res = await fetch(`/api/prices/search?${params}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    renderBest(data); renderMeta(data); renderRows(data);
    $('disclaimer').textContent = data.disclaimer;
    $('results').classList.remove('hidden');
    const n = data.results.length;
    $('status').textContent = `${n} offer${n === 1 ? '' : 's'} for “${data.query}”${data.demo ? ' (demo data)' : ''}.`;
  } catch (err) {
    $('status').textContent = '';
    $('error').textContent = err.message;
    $('error').classList.remove('hidden');
  } finally {
    $('go').disabled = false;
  }
}

function paramsFromForm() {
  const p = new URLSearchParams();
  p.set('q', $('q').value.trim());
  p.set('region', $('region').value);
  p.set('currency', $('currency').value);
  if ($('demo').checked) p.set('demo', '1');
  return p;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
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
    const res = await fetch('/api/prices/retailers');
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
})();
