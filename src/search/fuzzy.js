// Forgiving search for kit and unit names: typo-tolerant, prefix-aware and
// fluent in common Warhammer 40k nicknames ("termies", "cp sm", "nids").
//
// Browser-safe (no Node imports, no process): served to pages at
// /lib/search/fuzzy.js by the server and copied into _site/lib by the static build.
//
//   score(query, text)                     0..1, how well `text` covers the query
//   bestMatches(query, items, opts)        ranked [{ item, score, text }]
//   suggest(query, vocabulary)             "Did you mean" string, or null
//   expandQuery(query)                     query with unambiguous nicknames spelled out

/* ---------------------------------------------------------------- normalise */

/** Lower-case, strip accents/punctuation, "&" -> "and", collapse whitespace. */
export function normalize(s) {
  return String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Simple plural/singular folding: intercessors -> intercessor, boyz -> boy, bodies -> body. */
export function fold(t) {
  if (t.length <= 3 || /^\d/.test(t)) return t;
  if (t.endsWith('ies') && t.length > 4) return `${t.slice(0, -3)}y`;
  if (/(sh|ch|x|ss)es$/.test(t)) return t.slice(0, -2);
  if (t.endsWith('ss') || t.endsWith('us')) return t;
  if (t.endsWith('s') || (t.endsWith('z') && !t.endsWith('zz'))) return t.slice(0, -1);
  return t;
}

const STOP = new Set(['the', 'of', 'a', 'an', 'and', 'for', 'with', 'by', 'in', 'to', 'x']);

/** Normalised, folded tokens (stop words removed). */
export function tokens(s) {
  return normalize(s).split(' ').filter((t) => t && !STOP.has(t)).map(fold);
}

// Words that carry little meaning: matched if present, cheap if absent.
const WEAK = new Map([
  ['primari', 0.3], ['adeptu', 0.3], ['astarte', 0.3], ['squad', 0.2], ['unit', 0.2], ['team', 0.2],
  ['warhammer', 0.1], ['40k', 0.1], ['40000', 0.1], ['40', 0.1], ['game', 0.1], ['workshop', 0.1],
  ['gw', 0.1], ['box', 0.1], ['set', 0.1], ['kit', 0.1], ['miniature', 0.1], ['new', 0.1],
]);
const weightOf = (t) => WEAK.get(t) ?? (/^\d+$/.test(t) ? 0.1 : 1);

/* ----------------------------------------------------------- synonyms */

// Nicknames and abbreviations. `keep: true` marks words that are also normal
// words in product names ("guard" in "Custodian Guard"): the expansion is then
// an alternative, never a replacement, and expandQuery() leaves them alone.
const SYNONYM_LIST = [
  ['termies', 'terminators'], ['termy', 'terminators'],
  ['cp', 'combat patrol'], ['sm', 'space marines'],
  ['csm', 'chaos space marines'], ['dg', 'death guard'], ['tsons', 'thousand sons'],
  ['am', 'astra militarum'], ['ig', 'astra militarum'], ['imperial guard', 'astra militarum'],
  ['guard', 'astra militarum', true], ['guardsmen', 'cadian shock troops', true],
  ['custodes', 'adeptus custodes', true], ['custodians', 'custodian guard', true],
  ['nids', 'tyranids'], ['bugs', 'tyranids'], ['crons', 'necrons'], ['crins', 'necrons'],
  ['gaunts', 'termagants'], ['hormies', 'hormagaunts'], ['gk', 'grey knights'],
  ['sisters', 'adepta sororitas'], ['sob', 'adepta sororitas'], ['sisters of battle', 'adepta sororitas'],
  ['admech', 'adeptus mechanicus'], ['ad mech', 'adeptus mechanicus'], ['mechanicus', 'adeptus mechanicus', true],
  ['eldar', 'aeldari'], ['craftworlds', 'aeldari'], ['deldar', 'drukhari'], ['dark eldar', 'drukhari'],
  ['tau', 'tau empire', true], ['votann', 'leagues of votann', true], ['lov', 'leagues of votann'],
  ['br', 'bolt rifle'], ['boltrifle', 'bolt rifle'], ['bolt rifle marines', 'intercessors'],
  ['ba', 'blood angels'], ['da', 'dark angels'], ['sw', 'space wolves'], ['bt', 'black templars'],
  ['we', 'world eaters'], ['ek', 'emperors children'],
  ['russ', 'leman russ', true], ['dreads', 'dreadnought'], ['intercessor marines', 'intercessors'],
  ['spacemarines', 'space marines'], ['combatpatrol', 'combat patrol'],
];

// Primaris is ignorable: it only nudges ranking (weak weight above).
const SYN = new Map(); // first folded token -> [{ from: [tokens], to: [tokens], keep }]
for (const [from, to, keep = false] of SYNONYM_LIST) {
  const f = tokens(from);
  const entry = { from: f, to: tokens(to), toText: normalize(to), keep };
  if (!SYN.has(f[0])) SYN.set(f[0], []);
  SYN.get(f[0]).push(entry);
}
for (const list of SYN.values()) list.sort((a, b) => b.from.length - a.from.length);

/**
 * Parse a query into weighted groups. Each group is satisfied by its best
 * alternative (a token sequence): the literal words or a synonym expansion.
 */
function parse(query) {
  const toks = tokens(query);
  const groups = [];
  for (let i = 0; i < toks.length;) {
    const cands = SYN.get(toks[i]) ?? [];
    const hit = cands.find((e) => e.from.every((t, k) => toks[i + k] === t));
    if (hit) {
      const lit = toks.slice(i, i + hit.from.length);
      groups.push({ alts: [hit.to, lit], weight: 1, raw: lit, syn: true });
      i += hit.from.length;
    } else {
      groups.push({ alts: [[toks[i]]], weight: weightOf(toks[i]), raw: [toks[i]], syn: false });
      i += 1;
    }
  }
  return groups;
}

/** Query with unambiguous nicknames spelled out ("cp sm" -> "combat patrol space marines"). */
export function expandQuery(query) {
  const words = normalize(query).split(' ').filter((w) => w && !STOP.has(w));
  const out = [];
  for (let i = 0; i < words.length;) {
    const cands = SYN.get(fold(words[i])) ?? [];
    const hit = cands.find((e) => !e.keep && e.from.every((t, k) => words[i + k] && fold(words[i + k]) === t));
    if (hit) { out.push(hit.toText); i += hit.from.length; } else { out.push(words[i]); i += 1; }
  }
  return out.join(' ');
}

/* -------------------------------------------------- Damerau-Levenshtein */

let rowA = new Int32Array(64); let rowB = new Int32Array(64); let rowC = new Int32Array(64);

/**
 * Optimal-string-alignment (Damerau-Levenshtein) distance: insertions,
 * deletions, substitutions and adjacent transpositions each cost 1. With
 * `max`, returns max + 1 as soon as the distance must exceed it.
 */
export function distance(a, b, max = Infinity) {
  a = String(a); b = String(b);
  if (a === b) return 0;
  const n = a.length; const m = b.length;
  if (Math.abs(n - m) > max) return max + 1;
  if (!n) return m; if (!m) return n;
  if (m + 1 > rowA.length) { rowA = new Int32Array(m + 1); rowB = new Int32Array(m + 1); rowC = new Int32Array(m + 1); }
  let prev2 = rowA; let prev = rowB; let cur = rowC;
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i; let rowMin = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const bj = b.charCodeAt(j - 1);
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ai === bj ? 0 : 1));
      if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === bj) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v; if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev2; prev2 = prev; prev = cur; cur = t;
  }
  return prev[m];
}

/** Typo budget by word length: 0 edits for <= 3 chars, 1 for 4-7, 2 for 8+. */
export function typoBudget(len) {
  return len <= 3 ? 0 : len <= 7 ? 1 : 2;
}

/* ---------------------------------------------------------- token match */

/**
 * Similarity of one query token to one text token (0..1).
 *   exact 1 · prefix ("interc" -> intercessor) 0.8-0.95 · typo 0.9 per edit
 *   less · typo'd prefix ("intersess") 0.75.
 */
function tokenSim(q, t) {
  if (q === t) return 1;
  const ql = q.length; const tl = t.length;
  if (/^\d+$/.test(q) || /^\d+$/.test(t)) return 0;
  if (ql >= 3 && tl > ql && t.startsWith(q)) {
    // Short prefixes of long words are weak evidence.
    return ql >= 4 || ql / tl >= 0.5 ? 0.8 + 0.15 * (ql / tl) : 0.6;
  }
  const budget = typoBudget(Math.min(ql, tl));
  if (budget && Math.abs(ql - tl) <= budget) {
    // First letters rarely get mistyped; requiring a match keeps precision.
    if (q[0] === t[0] || (ql > 1 && tl > 1 && q[0] === t[1] && q[1] === t[0])) {
      const d = distance(q, t, budget);
      if (d <= budget) return 1 - 0.1 * d;
    }
  }
  // Typo while still typing: compare against the word's prefix, one edit fewer allowed.
  const pb = typoBudget(ql) - 1;
  if (pb > 0 && tl > ql && q[0] === t[0]) {
    const d = Math.min(distance(q, t.slice(0, ql), pb), distance(q, t.slice(0, ql + 1), pb));
    if (d <= pb) return 0.75;
  }
  return 0;
}

/* ---------------------------------------------------------------- caches */

const MAX_CACHE = 20_000;
const textCache = new Map();
function textInfo(text) {
  let info = textCache.get(text);
  if (info) return info;
  const toks = [...new Set(tokens(text))];
  // Joined neighbours let "spacemarines" match "space marines".
  const all = toks.slice();
  for (let i = 0; i + 1 < toks.length; i++) all.push(toks[i] + toks[i + 1]);
  info = { toks, all, weight: toks.reduce((s, t) => s + weightOf(t), 0) };
  if (textCache.size >= MAX_CACHE) textCache.clear();
  textCache.set(text, info);
  return info;
}

const queryCache = new Map();
function queryInfo(query) {
  let q = queryCache.get(query);
  if (q) return q;
  const groups = parse(query);
  q = { groups, total: groups.reduce((s, g) => s + g.weight, 0), distinctive: groups.filter((g) => g.weight >= 1).length };
  if (queryCache.size >= 500) queryCache.clear();
  queryCache.set(query, q);
  return q;
}

/* ---------------------------------------------------------------- scoring */

/**
 * Detailed match of `query` against `text`:
 *   score     weighted share of the query found in the text (0..1)
 *   coverage  share of the text's words the query accounted for (ranking tie-break)
 *   missing   distinctive (non-filler) query words with no match at all
 */
export function matchDetail(query, text) {
  const q = typeof query === 'string' ? queryInfo(query) : query;
  if (!q.total) return { score: 0, coverage: 0, missing: 0, distinctive: 0 };
  const t = textInfo(String(text ?? ''));
  if (!t.toks.length) return { score: 0, coverage: 0, missing: q.distinctive, distinctive: q.distinctive };
  const used = new Set();
  let got = 0; let missing = 0;
  for (const g of q.groups) {
    let best = 0; let bestUsed = null; let bestZeros = g.weight >= 1 ? 1 : 0;
    for (const alt of g.alts) {
      let sum = 0; let zeros = 0; const u = [];
      for (const qt of alt) {
        let b = 0; let bt = null;
        for (const tt of t.all) {
          const s = tokenSim(qt, tt);
          if (s > b) { b = s; bt = tt; if (s === 1) break; }
        }
        sum += b; if (bt) u.push(bt); else if (weightOf(qt) >= 1) zeros++;
      }
      const s = sum / alt.length;
      if (s > best) { best = s; bestUsed = u; bestZeros = zeros; }
    }
    got += best * g.weight;
    if (g.weight >= 1) missing += bestZeros;
    if (bestUsed) for (const x of bestUsed) used.add(x);
  }
  let covered = 0;
  for (const tt of t.toks) if (used.has(tt)) covered += weightOf(tt);
  return { score: got / q.total, coverage: t.weight ? Math.min(1, covered / t.weight) : 0, missing,
    distinctive: q.distinctive };
}

/** How well `text` matches `query`, 0..1 (1 = every query word found exactly). */
export function score(query, text) {
  return matchDetail(query, text).score;
}

/**
 * Rank `items` against `query`.
 * @param {string} query
 * @param {Array} items
 * @param {object} [o]
 * @param {(item)=>string|string[]} [o.key]  text(s) to match; an item scores its best text
 * @param {number} [o.limit=10]
 * @param {number} [o.threshold=0.6]
 * @param {boolean} [o.requireAll=false]  every distinctive query word must be
 *   found (approximately) in the text; queries of 5+ such words may miss one
 * @returns {{item:any, score:number, coverage:number, text:string}[]}
 *   coverage = share of the matched text the query accounts for (tie-break)
 */
export function bestMatches(query, items, { key = (x) => x, limit = 10, threshold = 0.6, requireAll = false } = {}) {
  const q = queryInfo(String(query ?? ''));
  if (!q.total) return [];
  const out = [];
  for (const item of items) {
    const texts = key(item);
    let best = null;
    for (const text of Array.isArray(texts) ? texts : [texts]) {
      if (text == null) continue;
      const d = matchDetail(q, text);
      if (requireAll && d.missing > (d.distinctive >= 5 ? 1 : 0)) continue;
      if (!best || d.score > best.score || (d.score === best.score && d.coverage > best.coverage)) best = { ...d, text: String(text) };
    }
    if (best && best.score >= threshold) out.push({ item, score: best.score, coverage: best.coverage, text: best.text });
  }
  out.sort((a, b) => b.score - a.score || b.coverage - a.coverage || a.text.length - b.text.length);
  return out.slice(0, limit).map(({ item, score: s, coverage, text }) => ({
    item, score: Math.round(s * 1000) / 1000, coverage: Math.round(coverage * 1000) / 1000, text }));
}

/* ---------------------------------------------------------------- suggest */

const vocabCache = new WeakMap();
function vocabIndex(vocabulary) {
  let idx = Array.isArray(vocabulary) ? vocabCache.get(vocabulary) : null;
  if (idx) return idx;
  const words = new Map(); // folded -> { surfaces: Map(surface -> count), count }
  for (const phrase of vocabulary) {
    for (const w of normalize(phrase).split(' ')) {
      if (!w || STOP.has(w) || /^\d+$/.test(w)) continue;
      const f = fold(w);
      let e = words.get(f);
      if (!e) { e = { surfaces: new Map(), count: 0 }; words.set(f, e); }
      e.count++; e.surfaces.set(w, (e.surfaces.get(w) ?? 0) + 1);
    }
  }
  const byFirst = new Map();
  for (const [f, e] of words) {
    if (!byFirst.has(f[0])) byFirst.set(f[0], []);
    byFirst.get(f[0]).push([f, e]);
  }
  idx = { words, byFirst };
  if (Array.isArray(vocabulary)) vocabCache.set(vocabulary, idx);
  return idx;
}

function surfaceFor(entry, typed) {
  const plural = /[sz]$/.test(typed);
  let best = null; let bestN = -1;
  for (const [s, n] of entry.surfaces) {
    const k = (/[sz]$/.test(s) === plural ? 1000 : 0) + n;
    if (k > bestN) { best = s; bestN = k; }
  }
  return best;
}

/**
 * "Did you mean": the query with each misspelt word replaced by the closest
 * vocabulary word (within the typo budget). Known words, nicknames, numbers and
 * prefixes of known words are left alone. Returns null when nothing changed.
 * @param {string} query
 * @param {string[]} vocabulary  phrases (kit names, unit names...)
 */
export function suggest(query, vocabulary) {
  if (!vocabulary?.length) return null;
  const idx = vocabIndex(vocabulary);
  const words = normalize(query).split(' ').filter(Boolean);
  let changed = false;
  const out = words.map((w) => {
    const f = fold(w);
    if (STOP.has(w) || /\d/.test(w) || idx.words.has(f) || SYN.has(f) || WEAK.has(f)) return w;
    const budget = typoBudget(f.length);
    if (!budget) return w;
    // A prefix of a known word is someone still typing, not a typo.
    for (const [vf] of idx.byFirst.get(f[0]) ?? []) if (vf.startsWith(f)) return w;
    let best = null; let bestD = budget + 1; let bestCount = 0;
    const firsts = new Set([f[0], f[1]]);
    for (const c of firsts) {
      for (const [vf, e] of idx.byFirst.get(c) ?? []) {
        if (Math.abs(vf.length - f.length) > budget) continue;
        const d = distance(f, vf, budget);
        if (d > budget) continue;
        if (d < bestD || (d === bestD && e.count > bestCount)) { best = e; bestD = d; bestCount = e.count; }
      }
    }
    if (!best) return w;
    changed = true;
    return surfaceFor(best, w);
  });
  return changed ? out.join(' ') : null;
}
