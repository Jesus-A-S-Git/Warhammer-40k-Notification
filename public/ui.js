// Shared UI behaviour for every page: active nav link, theme toggle,
// mobile nav collapse, plus a few tiny helpers pages may import.
//
//   import { toast, el, fmtMoney, debounce } from './ui.js';

const THEME_KEY = 'theme';
const root = document.documentElement;

const ICONS = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

// ---------- storage (never throws) ----------
function readStored() {
  try { return localStorage.getItem(THEME_KEY); } catch { return null; }
}
function writeStored(v) {
  try { localStorage.setItem(THEME_KEY, v); } catch { /* storage blocked */ }
}

// ---------- theme ----------
const mql = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

/** The theme currently in effect: 'light' or 'dark'. */
export function currentTheme() {
  const forced = root.getAttribute('data-theme');
  if (forced === 'light' || forced === 'dark') return forced;
  return mql && mql.matches ? 'dark' : 'light';
}

/** Force a theme ('light' | 'dark'), or pass null to follow the OS again. */
export function setTheme(theme, { persist = true } = {}) {
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  if (persist) writeStored(theme || '');
  syncToggles();
}

function syncToggles() {
  const t = currentTheme();
  const next = t === 'dark' ? 'light' : 'dark';
  for (const btn of document.querySelectorAll('[data-theme-toggle]')) {
    btn.innerHTML = t === 'dark' ? ICONS.sun : ICONS.moon;
    btn.setAttribute('aria-label', `Switch to ${next} theme`);
    btn.title = `Switch to ${next} theme`;
  }
}

// Apply the stored preference as early as this module runs.
const stored = readStored();
if (stored === 'light' || stored === 'dark') root.setAttribute('data-theme', stored);

// ---------- nav ----------
function pageName(href) {
  const u = new URL(href, location.href);
  let p = u.pathname.split('/').pop() || 'index.html';
  if (!p.includes('.')) p = 'index.html';
  return p;
}

function markCurrentNav() {
  const here = pageName(location.href);
  for (const a of document.querySelectorAll('header.site nav a')) {
    if (a.classList.contains('brand')) continue;
    if (pageName(a.getAttribute('href') || '') === here) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

function setupMobileNav() {
  const nav = document.querySelector('header.site nav');
  if (!nav || nav.querySelector('.nav-toggle')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-toggle';
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-label', 'Open menu');
  btn.innerHTML = ICONS.menu;
  const set = (open) => {
    nav.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    btn.innerHTML = open ? ICONS.close : ICONS.menu;
  };
  btn.addEventListener('click', () => set(!nav.classList.contains('open')));
  nav.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('open')) { set(false); btn.focus(); }
  });
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
  nav.appendChild(btn);
  nav.classList.add('has-toggle');
}

function init() {
  markCurrentNav();
  setupMobileNav();
  for (const btn of document.querySelectorAll('[data-theme-toggle]')) {
    if (!btn.getAttribute('type')) btn.setAttribute('type', 'button');
    btn.addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
  }
  syncToggles();
  mql?.addEventListener?.('change', syncToggles);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();

// ---------- helpers ----------

/**
 * Tiny DOM builder.
 *   el('a', { href: '#', class: 'btn sm', onclick: fn, dataset: { id: 3 } }, 'Go')
 * attrs: `class`/`className`, `style` (string or object), `dataset`, `on*` functions
 * become listeners, booleans toggle the attribute, null/undefined are skipped.
 * Children: strings/numbers (as text), Nodes, arrays (flattened), null/false skipped.
 */
export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') node.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) node.style.setProperty(sk, sv);
        else node.style[sk] = sv;
      }
    } else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'text') node.textContent = v;
    else if (v === true) node.setAttribute(k, '');
    else if (k in node && typeof v !== 'string' && k !== 'list') node[k] = v;
    else node.setAttribute(k, String(v));
  }
  const add = (c) => {
    if (c == null || c === false || c === true) return;
    if (Array.isArray(c)) c.forEach(add);
    else node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return node;
}

const moneyFormatters = new Map();
/** Format a number as money, e.g. fmtMoney(42.5, 'GBP') -> "£42.50". Non-numbers -> "—". */
export function fmtMoney(n, currency = 'USD') {
  const v = typeof n === 'string' ? Number(n) : n;
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  const cur = (currency || 'USD').toUpperCase();
  let f = moneyFormatters.get(cur);
  if (!f) {
    try {
      f = new Intl.NumberFormat(undefined, { style: 'currency', currency: cur });
    } catch {
      f = { format: (x) => `${x.toFixed(2)} ${cur}` };
    }
    moneyFormatters.set(cur, f);
  }
  return f.format(v);
}

/** Debounce: call fn once, ms after the last call. Returned fn has .cancel(). */
export function debounce(fn, ms = 200) {
  let t;
  const d = function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

let toastHost;
/**
 * Show a transient message. kind: 'info' | 'good' | 'warn' | 'bad' (alias 'error').
 * Returns a function that dismisses it early.
 */
export function toast(msg, kind = 'info', { timeout = 4000 } = {}) {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = el('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  const k = kind === 'error' ? 'bad' : kind;
  const t = el('div', { class: `toast ${k || ''}`.trim(), role: k === 'bad' ? 'alert' : null }, msg);
  toastHost.appendChild(t);
  let gone = false;
  const dismiss = () => {
    if (gone) return;
    gone = true;
    t.classList.add('leaving');
    setTimeout(() => t.remove(), 220);
  };
  t.addEventListener('click', dismiss);
  if (timeout > 0) setTimeout(dismiss, timeout);
  return dismiss;
}
