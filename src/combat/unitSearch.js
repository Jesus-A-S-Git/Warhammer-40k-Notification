// Forgiving unit lookup for the combat calculator: exact name/alias first, then
// fuzzy-ranked by name, aliases and faction ("termies", "intersessors",
// "nec warr" all work). Browser-safe: shared by the API and the static build.
import { normalize, expandQuery, bestMatches, suggest } from '../search/fuzzy.js';

const aliasesOf = (u) => (Array.isArray(u.aliases) ? u.aliases : []);
const textsFor = (u) => [u.name, ...aliasesOf(u), `${u.faction} ${u.name}`, u.faction];

// "Chaos Terminators" are not "Terminators": units of a qualified line only
// match when the query names the qualifier (directly or via "csm").
const QUALIFIERS = ['chaos'];
const hasWord = (s, w) => ` ${s} `.includes(` ${w} `);

function isExact(u, s, raw) {
  return u.id === raw || normalize(u.name) === s || aliasesOf(u).some((a) => normalize(a) === s);
}

/**
 * Units matching `q`, best first. Exact name/alias/id matches come first with
 * score 1; the rest are fuzzy-ranked. `coverage` breaks ties (how much of the
 * matched name the query accounts for). `strict: false` lets a distinctive
 * query word go unmatched (used for "Did you mean" fallbacks).
 * @returns {{unit:object, score:number, coverage:number, exact:boolean}[]}
 */
export function rankUnits(units, q, { threshold = 0.7, strict = true } = {}) {
  const raw = String(q ?? '').trim().toLowerCase().slice(0, 80);
  const s = normalize(raw);
  if (!s) return units.map((unit) => ({ unit, score: 1, coverage: 1 }));
  const exact = units.filter((u) => isExact(u, s, raw));
  const qx = `${s} ${normalize(expandQuery(raw))}`;
  const rest = units.filter((u) => !exact.includes(u) && QUALIFIERS.every((w) =>
    hasWord(qx, w) || !hasWord(normalize(`${u.faction} ${u.name}`), w)));
  const fuzzy = bestMatches(raw, rest, { key: textsFor, limit: Infinity, threshold, requireAll: strict });
  return [...exact.map((unit) => ({ unit, score: 1, coverage: 1, exact: true })),
    ...fuzzy.map((m) => ({ unit: m.item, score: m.score, coverage: m.coverage, exact: false }))];
}

/** Same signature as the old data/units.js findUnits: matching units, best first. */
export function findUnits(units, q) {
  return rankUnits(units, q).map((m) => m.unit);
}

/**
 * The single unit a free-text id or nickname clearly means, or null. Needs a
 * confident match that is not tied with another unit ("guard" stays ambiguous,
 * "nope" stays unknown).
 */
export function resolveUnit(units, q, { min = 0.85, minCoverage = 0.5 } = {}) {
  const [top, next] = rankUnits(units, q);
  // With 1000+ datasheets a short typo can brush a long name ("nope" ~ "Node..."):
  // the query must also account for a fair share of the matched name.
  if (!top || top.score < min || (!top.exact && top.coverage < minCoverage)) return null;
  if (next && next.exact === top.exact && next.score === top.score && next.coverage === top.coverage) return null;
  return top.unit;
}

/** "Did you mean" for a unit search, built from unit names, factions and aliases, or null. */
export function suggestUnitQuery(units, q) {
  const vocab = [];
  for (const u of units) vocab.push(u.name, u.faction, ...aliasesOf(u));
  return suggest(q, vocab);
}
