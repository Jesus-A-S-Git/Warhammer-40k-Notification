// Small in-memory TTL cache with LRU-ish eviction (Map insertion order).
export class TTLCache {
  constructor({ maxEntries = 1000, now = Date.now } = {}) {
    this.max = maxEntries;
    this.now = now;
    this.map = new Map();
  }
  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.exp <= this.now()) { this.map.delete(key); return undefined; }
    this.map.delete(key); this.map.set(key, e); // refresh recency
    return e.value;
  }
  set(key, value, ttlMs) {
    this.map.delete(key);
    this.map.set(key, { value, exp: this.now() + ttlMs });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  clear() { this.map.clear(); }
  get size() { return this.map.size; }
}
