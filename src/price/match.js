// Title matching for price offers: the shared fuzzy scorer (typos, plurals,
// prefixes, nicknames such as "termies" or "cp sm") plus price-specific
// precision rules (non-kit products, other-faction variants).
import { normalize, expandQuery, matchDetail } from '../search/fuzzy.js';

export { normalize };

// Product categories that are not "the kit" (paints, books, accessories...).
// A title containing one of these is excluded unless the query asks for it.
const NON_KIT = ['paint', 'contrast', 'shade', 'citadel colour', 'spray', 'primer', 'brush',
  'codex', 'novel', 'book', 'audiobook', 'black library', 'dice', 'datacard', 'sleeve',
  'transfer', 'decal', 'base', 'figure case', 'carry case', 'poster', 'mug', 't-shirt',
  'tool', 'clipper', 'glue'].map(normalize);

// Words that turn a kit into a different product line: "Chaos Terminators" are
// not "Terminators", so a title with one of these needs it in the query too.
const QUALIFIERS = ['chaos'];

export const MATCH_THRESHOLD = 0.7;

function hasPhrase(norm, phrase) {
  return new RegExp(`(^| )${phrase}s?( |$)`).test(norm);
}

/**
 * Score how well `title` matches `query` (0..1). Non-kit products and
 * other-faction variants score 0 unless the query itself mentions them.
 */
export function matchScore(query, title) {
  const nq = normalize(query);
  if (!nq) return 0;
  const nt = normalize(title);
  const nqx = `${nq} ${normalize(expandQuery(query))}`;
  for (const cat of NON_KIT) {
    if (hasPhrase(nt, cat) && !hasPhrase(nqx, cat)) return 0;
  }
  for (const w of QUALIFIERS) {
    if (hasPhrase(nt, w) && !hasPhrase(nqx, w)) return 0;
  }
  const d = matchDetail(query, title);
  // Every distinctive word must be found (approximately): "combat patrol space
  // marines" is not "Boarding Patrol: Space Marines". Long queries may miss one.
  if (d.missing > (d.distinctive >= 5 ? 1 : 0)) return Math.min(d.score, MATCH_THRESHOLD - 0.01) * (d.missing > 1 ? 0.5 : 1);
  return d.score;
}

export function isMatch(query, title, threshold = MATCH_THRESHOLD) {
  return matchScore(query, title) >= threshold;
}
