// Watchlist + price alerts without accounts. Everything lives in this browser's
// localStorage (same key the Deal Finder tools use), every access is guarded.
//
//   watch.list() -> [{id, target|null, addedAt, priceAtAdd|null}]
//   watch.add(id, {target, price}) / remove(id) / setTarget(id, t) / has(id)
//   hits(products) -> watched products at or below target
//   notifyHits(products) -> shows a browser notification once per new hit (opt-in)
import { storage } from './api.js';

const KEY = 'prices.watch.v1';
const NOTIFIED = 'prices.watch.notified.v1';
const EVT = 'watch:change';

function read() {
  const v = storage.get(KEY, []);
  return Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string').slice(0, 500) : [];
}
function write(list) {
  storage.set(KEY, list);
  window.dispatchEvent(new CustomEvent(EVT, { detail: { count: list.length } }));
}

export const watch = {
  list: read,
  get: (id) => read().find((w) => w.id === id) ?? null,
  has: (id) => read().some((w) => w.id === id),
  add(id, { target = null, price = null } = {}) {
    const list = read().filter((w) => w.id !== id);
    list.push({ id, target: target == null || target === '' ? null : Math.max(0, Number(target)), addedAt: new Date().toISOString(), priceAtAdd: price });
    write(list);
  },
  remove(id) { write(read().filter((w) => w.id !== id)); },
  setTarget(id, target) {
    const list = read();
    const w = list.find((x) => x.id === id);
    if (!w) return;
    w.target = target == null || target === '' || !Number.isFinite(Number(target)) ? null : Math.max(0, Number(target));
    write(list);
  },
  clear() { write([]); },
  onChange(fn) {
    window.addEventListener(EVT, fn);
    window.addEventListener('storage', (e) => { if (e.key === KEY) fn(); });
  },
};

/** Watched products whose best in-stock item price is at or below the target. */
export function hits(byId) {
  return read().map((w) => ({ w, p: byId.get(w.id) }))
    .filter(({ w, p }) => w.target != null && p?.best?.price != null && p.best.inStock !== false && p.best.price <= w.target + 0.005);
}

export const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window;
export const notifyPermission = () => (notifySupported() ? Notification.permission : 'unsupported');
export async function enableNotifications() {
  if (!notifySupported()) return 'unsupported';
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

/**
 * Browser notification for hits not announced before at this price. Only while
 * the page is open (no push server, no account). Returns the new hits.
 */
export function notifyHits(list, { sample = false } = {}) {
  const seen = storage.get(NOTIFIED, {}) || {};
  const fresh = list.filter(({ p }) => !(seen[p.id] != null && seen[p.id] <= p.best.price + 0.005));
  for (const { p } of list) seen[p.id] = Math.min(seen[p.id] ?? Infinity, p.best.price);
  // Forget items that went back above target so a future drop alerts again.
  for (const id of Object.keys(seen)) if (!list.some(({ p }) => p.id === id)) delete seen[id];
  storage.set(NOTIFIED, seen);
  if (fresh.length && notifyPermission() === 'granted') {
    try {
      const first = fresh[0].p;
      const n = new Notification(fresh.length === 1 ? `${first.name} hit your target` : `${fresh.length} watched kits hit your target`, {
        body: `${sample ? '[Sample data] ' : ''}${first.name}: $${first.best.price.toFixed(2)} at ${first.best.retailerName}`,
        tag: 'wh40k-watch', silent: false,
      });
      n.onclick = () => { window.focus(); location.href = `product.html?id=${encodeURIComponent(first.id)}`; };
    } catch { /* some browsers only allow notifications from a service worker */ }
  }
  return fresh;
}
