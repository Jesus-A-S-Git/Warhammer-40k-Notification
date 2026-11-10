// Fuzzy title matching: weighted token coverage of the query by the title.

const STOP = new Set(['the', 'of', 'a', 'an', 'and', 'for', 'with', 'by', 'in', 'to', '&', 'x']);
// Tokens that add little meaning; matched if present but weigh less if absent.
const WEAK_RAW = [
  ['primaris', 0.3], ['adeptus', 0.3], ['astartes', 0.3], ['warhammer', 0.1], ['40k', 0.1],
  ['40000', 0.1], ['40', 0.1], ['games', 0.1], ['workshop', 0.1], ['gw', 0.1], ['box', 0.1],
  ['set', 0.1], ['kit', 0.1], ['miniature', 0.1], ['new', 0.1],
];
// Product categories that are not "the kit" (paints, books, accessories...).
// A title containing one of these is excluded unless the query asks for it.
const NON_KIT = ['paint', 'contrast', 'shade', 'citadel colour', 'spray', 'primer', 'brush',
  'codex', 'novel', 'book', 'audiobook', 'black library', 'dice', 'datacard', 'sleeve',
  'transfer', 'decal', 'base', 'figure case', 'carry case', 'poster', 'mug', 't-shirt',
  'tool', 'clipper', 'glue'];

export function normalize(s) {
  return String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function stem(t) {
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 3 && t.endsWith('es') && /(sh|ch|x|ss)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

// Keys are stemmed the same way as query/title tokens.
const WEAK = new Map(WEAK_RAW.map(([k, w]) => [stem(k), w]));

export function tokens(s) {
  return normalize(s).split(' ').filter((t) => t && !STOP.has(t)).map(stem);
}

function hasPhrase(normTitle, phrase) {
  return new RegExp(`(^| )${phrase.replace(/ /g, ' ')}s?( |$)`).test(normTitle);
}

/**
 * Score how well `title` matches `query` (0..1). Non-kit products score 0
 * unless the query itself mentions that category.
 */
export function matchScore(query, title) {
  const q = tokens(query);
  if (!q.length) return 0;
  const tset = new Set(tokens(title));
  const nt = normalize(title); const nq = normalize(query);
  for (const cat of NON_KIT) {
    if (hasPhrase(nt, cat) && !hasPhrase(nq, cat)) return 0;
  }
  let total = 0; let got = 0;
  for (const t of new Set(q)) {
    const w = WEAK.get(t) ?? (/^\d+$/.test(t) ? 0.1 : 1);
    total += w;
    if (tset.has(t) || [...tset].some((x) => x.length >= 5 && t.length >= 5 && (x.startsWith(t) || t.startsWith(x)))) got += w;
  }
  return total ? got / total : 0;
}

export const MATCH_THRESHOLD = 0.7;
export function isMatch(query, title, threshold = MATCH_THRESHOLD) {
  return matchScore(query, title) >= threshold;
}
