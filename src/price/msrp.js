// Seeded, APPROXIMATE MSRP table for common kits (2025-2026 price levels).
// Used for the "too good to be true" check and the "% saving" display when no
// official price is available. Values are rounded estimates, not quotes:
// GW changes prices periodically, so verify on warhammer.com.
import { convert } from './currency.js';
import { matchScore } from './match.js';

export const MSRP_TABLE = [
  { name: 'Combat Patrol: Space Marines', kit: 'Combat Patrol', GBP: 100, USD: 170, EUR: 120 },
  { name: 'Combat Patrol: Necrons', kit: 'Combat Patrol', GBP: 100, USD: 170, EUR: 120 },
  { name: 'Combat Patrol: Orks', kit: 'Combat Patrol', GBP: 100, USD: 170, EUR: 120 },
  { name: 'Combat Patrol: Tyranids', kit: 'Combat Patrol', GBP: 100, USD: 170, EUR: 120 },
  { name: 'Combat Patrol: Chaos Space Marines', kit: 'Combat Patrol', GBP: 100, USD: 170, EUR: 120 },
  { name: 'Combat Patrol: Astra Militarum', kit: 'Combat Patrol', GBP: 100, USD: 170, EUR: 120 },
  { name: 'Combat Patrol: Adepta Sororitas', kit: 'Combat Patrol', GBP: 100, USD: 170, EUR: 120 },
  { name: 'Combat Patrol: T’au Empire', kit: 'Combat Patrol', GBP: 100, USD: 170, EUR: 120 },
  { name: 'Space Marines Intercessors', kit: 'Intercessors', GBP: 45, USD: 65, EUR: 55 },
  { name: 'Space Marines Assault Intercessors', kit: 'Assault Intercessors', GBP: 45, USD: 65, EUR: 55 },
  { name: 'Space Marines Terminators', kit: 'Terminators', GBP: 42.5, USD: 65, EUR: 52.5 },
  { name: 'Space Marines Terminator Assault Squad', kit: 'Terminator Assault Squad', GBP: 42.5, USD: 65, EUR: 52.5 },
  { name: 'Space Marines Infernus Squad', kit: 'Infernus Squad', GBP: 45, USD: 65, EUR: 55 },
  { name: 'Necron Warriors', kit: 'Warriors', GBP: 40, USD: 60, EUR: 50 },
  { name: 'Ork Boyz', kit: 'Boyz', GBP: 35, USD: 55, EUR: 45 },
  { name: 'Tyranids Termagants', kit: 'Termagants', GBP: 32.5, USD: 50, EUR: 40 },
  { name: 'Boarding Patrol: Space Marines', kit: 'Boarding Patrol', GBP: 85, USD: 140, EUR: 105 },
  { name: 'Start Collecting! Space Marines (legacy)', kit: 'Start Collecting', GBP: 60, USD: 95, EUR: 75 },
].map((e) => ({ ...e, approximate: true, source: 'seeded table (approximate)' }));

/**
 * Best MSRP entry for a title or query, or null.
 *  back = how much of `text` the entry name covers (must be high: no extra
 *         distinctive words, so "Assault Intercessors" != "Intercessors").
 *  fwd  = how much of the entry's kit name (without faction) `text` covers,
 *         so a vague query such as "space marines" matches nothing.
 */
export function findMsrp(text, { minBack = 0.75, minFwd = 0.75 } = {}) {
  let best = null; let bestKey = -1;
  for (const e of MSRP_TABLE) {
    const back = matchScore(text, e.name.replace(/\(legacy\)/, ''));
    const fwd = matchScore(e.kit, text);
    if (back < minBack || fwd < minFwd) continue;
    const key = back * 10 + fwd;
    if (key > bestKey) { best = e; bestKey = key; }
  }
  return best;
}

/** MSRP of entry in the given currency (native value, else converted from GBP). */
export function msrpIn(entry, currency) {
  if (!entry) return null;
  return entry[currency] ?? convert(entry.GBP, 'GBP', currency);
}
