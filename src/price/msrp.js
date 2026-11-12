// APPROXIMATE recommended retail prices, derived from the product catalogue
// (catalog.js). Used for the "too good to be true" check, "% off RRP", deal
// scores and to map a store's listing title onto a catalogue product.
// Values are rounded estimates, not quotes: GW changes prices periodically.
import { convert } from './currency.js';
import { matchScore, cleanTitle } from './match.js';
import { expandQuery, normalize } from '../search/fuzzy.js';
import { CATALOG, RRP_AS_OF } from './catalog.js';

export const MSRP_TABLE = CATALOG.map((e) => ({ ...e, source: `seeded catalogue, ${RRP_AS_OF}` }));

const STOP = new Set(['the', 'of', 'and', 'set', 'squad', 'warhammer', '40000', '40k', 'space', 'marine', 'marines']);
const words = (s) => normalize(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.slice(0, 5));
// Prefilter index: 5-letter word stems -> entries, so a title is only scored
// against entries that share at least one distinctive stem (or a typo of one,
// handled by also indexing 4-letter stems).
const INDEX = new Map();
for (const e of MSRP_TABLE) {
  for (const t of [e.name, e.kit, ...e.aliases]) {
    for (const w of words(t)) {
      for (const k of [w, w.slice(0, 4)]) {
        if (!INDEX.has(k)) INDEX.set(k, new Set());
        INDEX.get(k).add(e);
      }
    }
  }
}
function candidates(text) {
  const out = new Set();
  for (const w of words(text)) for (const k of [w, w.slice(0, 4)]) for (const e of INDEX.get(k) ?? []) out.add(e);
  return out.size ? out : MSRP_TABLE;
}

const cache = new Map();

const CHAPTER_RE = /\b(blood angels|dark angels|space wolves|black templars|deathwatch|grey knights)\b/i;
const PROMO_RE = /\b(clearance|on sale|sale|hot deal|special offer|new release|pre-?order|in stock|free shipping)\b/gi;
/** Title reduced to the words that identify the product. */
function productText(text) {
  let t = cleanTitle(text) || String(text ?? '');
  t = t.replace(PROMO_RE, ' ');
  // "Space Marines - Blood Angels Combat Patrol": the chapter is the product line.
  if (CHAPTER_RE.test(t)) t = t.replace(/\b(space marines?|adeptus astartes)\b/gi, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Best catalogue entry for a title or query, or null.
 *  back = how much of `text` the entry name covers (must be high: no extra
 *         distinctive words, so "Assault Intercessors" != "Intercessors").
 *  fwd  = how much of the entry's `kit` words `text` covers, so a vague query
 *         such as "space marines" or "combat patrol" matches nothing.
 */
export function findMsrp(text, { minBack = 0.75, minFwd = 0.75 } = {}) {
  const key = `${minBack}|${minFwd}|${text}`;
  if (cache.has(key)) return cache.get(key);
  let best = null; let bestKey = -1;
  const t = expandQuery(productText(text)); // "cp sm" -> "combat patrol space marines"
  if (t) {
    for (const e of candidates(t)) {
      let back = 0;
      for (const n of [e.name, ...e.aliases]) back = Math.max(back, matchScore(t, n));
      if (back < minBack) continue;
      // An alias counts as the kit too ("Primaris Intercessors").
      // (`back` already applied the exclusion rules in the right direction.)
      let fwd = matchScore(e.kit, t, { exclusions: false });
      for (const a of e.aliases) fwd = Math.max(fwd, matchScore(a, t, { exclusions: false }));
      if (fwd < minFwd) continue;
      const k = back * 10 + fwd;
      if (k > bestKey) { best = e; bestKey = k; }
    }
  }
  if (cache.size > 5000) cache.clear();
  cache.set(key, best);
  return best;
}

/**
 * Catalogue product id for a store listing title, or null. Seasonal boxes carry
 * their own marketing names ("Space Marines Battleforce: Ultramarines Strike
 * Force"), so for those it is enough that the title contains the whole entry name.
 */
export function productIdForTitle(title) {
  const e = findMsrp(title);
  if (e) return e.id;
  const t = productText(title);
  let best = null; let bestScore = 0;
  for (const c of candidates(t)) {
    if (c.category !== 'battleforce') continue;
    const s = matchScore(c.name, t);
    if (s >= 0.9 && s > bestScore) { best = c; bestScore = s; }
  }
  return best?.id ?? null;
}

/** MSRP of entry in the given currency (native value, else converted from USD). */
export function msrpIn(entry, currency) {
  if (!entry) return null;
  return entry[currency] ?? convert(entry.USD, 'USD', currency) ?? convert(entry.GBP, 'GBP', currency);
}
