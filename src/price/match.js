// Title matching for price offers: the shared fuzzy scorer (typos, plurals,
// prefixes, nicknames such as "termies" or "cp sm") plus price-specific
// precision rules:
//   * non-kit products (paints, books, dice...) unless the query asks for them
//   * listings that are not a new, complete, official box: used/pre-owned,
//     bits, upgrade sprues, 3rd-party/3D-printed proxies, job lots, bundles
//   * other-faction variants ("Chaos Terminators" are not "Terminators";
//     "Space Marines: Blood Angels Combat Patrol" is not the Space Marines one)
//   * store/edition noise in titles ("Warhammer 40,000", "(2023)", "10th Edition",
//     "Combat Patrol - X" vs "X Combat Patrol") is stripped before matching.
import { normalize, expandQuery, matchDetail } from '../search/fuzzy.js';

export { normalize };

// Product categories that are not "the kit" (paints, books, accessories...).
// A title containing one of these is excluded unless the query asks for it.
const NON_KIT = ['paint', 'contrast', 'shade', 'citadel colour', 'spray', 'primer', 'brush',
  'codex', 'novel', 'book', 'audiobook', 'black library', 'dice', 'datacard', 'data cards', 'datasheet cards',
  'index cards', 'sleeve', 'transfer', 'decal', 'base', 'figure case', 'carry case', 'poster', 'mug', 't-shirt',
  'tool', 'clipper', 'glue', 'mat', 'gaming mat', 'terrain', 'token', 'tokens', 'templates'].map(normalize);

// Listings that are never "a new boxed kit", whatever the query says. These are
// excluded outright (counted as 'not-new-or-official' by callers that care).
const NOT_NEW_OR_OFFICIAL = ['used', 'pre owned', 'preowned', 'second hand', 'secondhand', 'pre loved',
  'bits', 'bitz', 'bit', 'sprue only', 'single sprue', 'loose', 'upgrade sprue', 'upgrade pack', 'upgrade set',
  'upgrades', 'conversion kit', 'compatible', '3d printed', '3d print', 'stl', 'proxy', 'proxies', 'alternative',
  'recast', 'resin copy', 'job lot', 'lot of', 'painted', 'pro painted', 'built', 'assembled', 'nib open',
  'open box', 'damaged box', 'incomplete', 'missing'].map(normalize);
// "unassembled", "unpainted", "unbuilt" are fine: hasPhrase matches whole words only.

// Bundles mix several products; excluded unless the query asks for a bundle.
const BUNDLE = ['bundle', 'army deal', 'army set deal'].map(normalize);

// Words that turn a kit into a different product line: "Chaos Terminators" are
// not "Terminators", so a title with one of these needs it in the query too.
const QUALIFIERS = ['chaos'];
// Space Marine chapters with their own Combat Patrols / kits. A title naming one
// is rejected when the query names a (different) faction but not this chapter:
// "Combat Patrol: Space Marines" must not match "Space Marines - Blood Angels Combat
// Patrol", while "Deathwing Knights" still matches "Dark Angels Deathwing Knights".
// (Codex chapters such as Ultramarines sell the plain Space Marines kits, so they aren't listed.)
const CHAPTERS = ['blood angels', 'dark angels', 'space wolves', 'black templars', 'deathwatch', 'grey knights'];
const FACTION_WORDS = ['space marines', 'adeptus astartes', ...CHAPTERS, 'necrons', 'orks', 'tyranids',
  'tau', 'tau empire', 'aeldari', 'drukhari', 'adeptus custodes', 'custodes', 'astra militarum',
  'adepta sororitas', 'adeptus mechanicus', 'imperial knights', 'death guard', 'thousand sons',
  'world eaters', 'emperors children', 'chaos daemons', 'chaos knights', 'genestealer cults',
  'leagues of votann', 'chaos space marines'];

export const MATCH_THRESHOLD = 0.7;
export const TITLE_MAX_TYPOS = 1;

function hasPhrase(norm, phrase) {
  return new RegExp(`(^| )${phrase}s?( |$)`).test(norm);
}

/**
 * Strip store and edition noise from a product title so word order and
 * decoration don't matter: "Warhammer 40,000: Space Marines Combat Patrol (2023)
 * - 10th Edition" -> "Space Marines Combat Patrol".
 */
export function cleanTitle(title) {
  let t = String(title ?? '');
  t = t.replace(/\((?:[^()]*\b(?:19|20)\d\d\b[^()]*|[^()]*edition[^()]*|new|eng(?:lish)?|en|us|gw|pre-?order|in stock)\)/gi, ' ');
  t = t.replace(/\b(?:warhammer\s*40,?000|warhammer\s*40k|wh\s?40k|40k|games\s*workshop|citadel\s*miniatures)\b\s*:?/gi, ' ');
  t = t.replace(/\b(?:(?:8th|9th|10th|11th)\s+edition|new\s+edition|2nd\s+edition)\b/gi, ' ');
  t = t.replace(/\b(?:\d{2}-\d{2,3}|gw-?\d+)\b/gi, ' '); // GW product codes like 48-07
  return t.replace(/\s*[-–—:|]\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Why `title` can never be an offer for `query`, or null. Reasons:
 * 'not-new-or-official' | 'bundle' | 'non-kit' | 'other-faction'.
 */
export function exclusionReason(query, title) {
  const nt = normalize(title);
  const nqx = `${normalize(query)} ${normalize(expandQuery(query))}`;
  for (const p of NOT_NEW_OR_OFFICIAL) if (hasPhrase(nt, p) && !hasPhrase(nqx, p)) return 'not-new-or-official';
  for (const p of BUNDLE) if (hasPhrase(nt, p) && !hasPhrase(nqx, p)) return 'bundle';
  for (const cat of NON_KIT) if (hasPhrase(nt, cat) && !hasPhrase(nqx, cat)) return 'non-kit';
  for (const w of QUALIFIERS) {
    if (hasPhrase(nt, w) && !hasPhrase(nqx, w)) return 'other-faction';
  }
  if (FACTION_WORDS.some((f) => hasPhrase(nqx, f))) {
    for (const c of CHAPTERS) if (hasPhrase(nt, c) && !hasPhrase(nqx, c)) return 'other-faction';
  }
  return null;
}

/**
 * Score how well `title` matches `query` (0..1). Excluded titles (see
 * exclusionReason) score 0 unless `exclusions: false` (used when the title
 * side has already passed the exclusion check).
 */
export function matchScore(query, title, { exclusions = true } = {}) {
  const nq = normalize(query);
  if (!nq) return 0;
  if (exclusions && exclusionReason(query, title)) return 0;
  // One typo per word at most against a store's title (see matchDetail); bigger
  // misspellings are handled earlier by correcting the query ("Did you mean").
  const d = matchDetail(query, cleanTitle(title) || title, { maxTypos: TITLE_MAX_TYPOS });
  // Every distinctive word must be found (approximately): "combat patrol space
  // marines" is not "Boarding Patrol: Space Marines". Long queries may miss one.
  if (d.missing > (d.distinctive >= 5 ? 1 : 0)) return Math.min(d.score, MATCH_THRESHOLD - 0.01) * (d.missing > 1 ? 0.5 : 1);
  return d.score;
}

export function isMatch(query, title, threshold = MATCH_THRESHOLD) {
  return matchScore(query, title) >= threshold;
}
