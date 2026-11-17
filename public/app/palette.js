// Command palette (Ctrl/Cmd+K or the header search button): products,
// factions, datasheets and pages from anywhere. Loaded on first use by ui.js.
import { el, setTheme, currentTheme } from '../ui.js';
import { combobox, loadIndex, loadUnits } from './search.js';

let root = null; let input = null; let lastFocus = null; let cb = null;

function build() {
  input = el('input', { type: 'search', class: 'palette-input', placeholder: 'Search kits, factions, datasheets, pages…', autocomplete: 'off',
    spellcheck: 'false', 'aria-label': 'Search everything', maxlength: '100' });
  const list = el('ul', { id: 'palette-list', class: 'palette-list' });
  const themeBtn = el('button', { type: 'button', class: 'btn ghost sm', onclick: () => { setTheme(currentTheme() === 'dark' ? 'light' : 'dark'); } }, 'Toggle theme');
  const dialog = el('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search' },
    el('div', { class: 'palette-bar' }, el('span', { class: 'palette-ico', 'aria-hidden': 'true' }), input,
      el('button', { type: 'button', class: 'kbd palette-esc', onclick: close, 'aria-label': 'Close search' }, 'Esc')),
    list,
    el('div', { class: 'palette-foot' },
      el('span', {}, el('kbd', {}, '↑'), el('kbd', {}, '↓'), ' move'), el('span', {}, el('kbd', {}, 'Enter'), ' open'),
      el('span', { class: 'spacer' }), themeBtn));
  root = el('div', { class: 'palette-backdrop', hidden: true, onclick: (e) => { if (e.target === root) close(); } }, dialog);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') { // keep focus inside the dialog
      const f = [...dialog.querySelectorAll('input, button')].filter((x) => !x.disabled);
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  });
  document.body.append(root);
  cb = combobox(input, list, { inline: true, onGo: (it) => { close(); location.href = it.href; } });
}

export function open(prefill = '') {
  if (!root) build();
  if (!root.hidden) { input.focus(); return; }
  lastFocus = document.activeElement;
  root.hidden = false;
  document.documentElement.classList.add('palette-open');
  input.value = prefill;
  input.focus();
  loadIndex().then(() => cb.update());
  loadUnits();
}
export function close() {
  if (!root || root.hidden) return;
  root.hidden = true;
  document.documentElement.classList.remove('palette-open');
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
export const isOpen = () => !!root && !root.hidden;
