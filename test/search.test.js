import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import {
  normalize, fold, distance, typoBudget, score, bestMatches, suggest, expandQuery,
} from '../src/search/fuzzy.js';
import { matchScore, isMatch } from '../src/price/match.js';
import { findMsrp } from '../src/price/msrp.js';
import { rankOffers, suggestionVocabulary, suggestionsPayload } from '../src/price/rank.js';
import { WATCHLIST, POPULAR } from '../src/price/watchlist.js';
import { searchPrices } from '../src/price/search.js';
import { listUnits, unitById } from '../src/combat/service.js';
import { findUnits, resolveUnit, suggestUnitQuery } from '../src/combat/unitSearch.js';
import { UNITS } from '../src/combat/data/units.js';
import { createApp } from '../src/server.js';
import { __resetSearchLimiter } from '../src/price/routes.js';

const run = promisify(execFile);

// Realistic retailer titles: the haystack for price matching.
const TITLES = [
  'Space Marines: Intercessors', 'Space Marines: Assault Intercessors', 'Space Marines: Hellblasters',
  'Space Marines: Terminators', 'Space Marines: Terminator Assault Squad', 'Tyranids: Termagants',
  'Tyranids: Hormagaunts', 'Combat Patrol: Space Marines', 'Combat Patrol: Necrons',
  'Combat Patrol: Chaos Space Marines', 'Boarding Patrol: Space Marines', 'Necrons: Necron Warriors',
  'Orks: Boyz', 'Chaos Space Marines: Chaos Terminators', 'Adeptus Custodes: Custodian Guard',
  'Astra Militarum: Cadian Shock Troops', 'Contrast: Ultramarines Blue (18ml) paint', 'Codex: Space Marines',
  'Citadel Dice: Intercessors', 'Combat Patrol: Grey Knights', 'Combat Patrol: Adepta Sororitas',
  'Combat Patrol: Adeptus Mechanicus', 'Combat Patrol: Death Guard', 'Combat Patrol: Astra Militarum',
];
const matches = (q) => TITLES.filter((t) => isMatch(q, t));

describe('fuzzy: building blocks', () => {
  test('normalisation: case, accents, punctuation, & -> and', () => {
    assert.equal(normalize('Combat Patrol: T’au Empire'), 'combat patrol tau empire');
    assert.equal(normalize('Ça & Là!'), 'ca and la');
    assert.equal(normalize('  Warhammer   40,000 '), 'warhammer 40 000');
    assert.equal(normalize(null), '');
  });

  test('plural/singular folding', () => {
    assert.equal(fold('intercessors'), fold('intercessor'));
    assert.equal(fold('boyz'), fold('boy'));
    assert.equal(fold('bodies'), 'body');
    assert.equal(fold('boxes'), 'box');
    assert.equal(fold('grass'), 'grass');
    assert.equal(fold('orks'), 'ork');
    assert.equal(fold('40k'), '40k');
  });

  test('Damerau-Levenshtein distance', () => {
    assert.equal(distance('', ''), 0);
    assert.equal(distance('abc', ''), 3);
    assert.equal(distance('', 'ab'), 2);
    assert.equal(distance('kitten', 'sitting'), 3);
    assert.equal(distance('necron', 'necorn'), 1, 'adjacent transposition costs 1');
    assert.equal(distance('ca', 'ac'), 1);
    assert.equal(distance('intersessors', 'intercessors'), 1);
    assert.equal(distance('terminator', 'termagant'), 5);
    assert.equal(distance('terminator', 'termagant', 2), 3, 'early exit returns max + 1');
    assert.equal(distance('a'.repeat(100), 'b'.repeat(100), 2), 3);
  });

  test('typo budget scales with length', () => {
    assert.deepEqual([1, 2, 3, 4, 7, 8, 20].map(typoBudget), [0, 0, 0, 1, 1, 2, 2]);
    // <= 3 chars must be exact: "orc" is not "ork", "cp" is not "cs".
    assert.equal(score('orc', 'Orks: Boyz'), 0);
    // 4-7 chars: one edit
    assert.ok(score('nekron', 'Necrons: Necron Warriors') > 0.8);
    assert.equal(score('nekrom', 'Necrons: Necron Warriors'), 0);
    // 8+ chars: two edits
    assert.ok(score('intersesors', 'Intercessors') >= 0.8);
    assert.equal(score('inntersesorz', 'Intercessors'), 0);
  });

  test('prefix matching while typing', () => {
    assert.ok(score('interc', 'Space Marines: Intercessors') > 0.8);
    assert.ok(score('termi', 'Space Marines: Terminators') > 0.8);
    assert.equal(score('termi', 'Tyranids: Termagants'), 0);
    assert.ok(score('nec warr', 'Necrons: Necron Warriors') > 0.8);
    assert.ok(score('intersess', 'Space Marines: Intercessors') >= 0.7, 'typo inside a partial word');
    const top = bestMatches('interc', ['Space Marines: Assault Intercessors', 'Space Marines: Intercessors'], { limit: 3 });
    assert.equal(top[0].item, 'Space Marines: Intercessors', 'shorter, fuller match ranks first');
  });

  test('synonyms and abbreviations', () => {
    const cases = [
      ['termies', 'Space Marines: Terminators'], ['cp sm', 'Combat Patrol: Space Marines'],
      ['cp csm', 'Combat Patrol: Chaos Space Marines'], ['cp dg', 'Combat Patrol: Death Guard'],
      ['ig', 'Astra Militarum: Cadian Shock Troops'], ['am', 'Astra Militarum: Cadian Shock Troops'],
      ['imperial guard', 'Astra Militarum: Cadian Shock Troops'], ['custodes', 'Adeptus Custodes: Custodian Guard'],
      ['nids', 'Tyranids: Termagants'], ['crons', 'Combat Patrol: Necrons'], ['gaunts', 'Tyranids: Termagants'],
      ['hormies', 'Tyranids: Hormagaunts'], ['cp gk', 'Combat Patrol: Grey Knights'],
      ['sisters', 'Combat Patrol: Adepta Sororitas'], ['sob', 'Combat Patrol: Adepta Sororitas'],
      ['admech', 'Combat Patrol: Adeptus Mechanicus'], ['spacemarines', 'Space Marines: Intercessors'],
    ];
    for (const [q, t] of cases) assert.ok(score(q, t) >= 0.9, `${q} -> ${t}: ${score(q, t)}`);
    // "primaris" is ignorable filler
    assert.ok(score('primaris intercessors', 'Space Marines: Intercessors') >= 0.7);
    // "guard" is both a nickname and a normal word: the literal still works.
    assert.equal(score('custodian guard', 'Adeptus Custodes: Custodian Guard'), 1);
    assert.equal(expandQuery('cp sm'), 'combat patrol space marines');
    assert.equal(expandQuery('Termies'), 'terminators');
    assert.equal(expandQuery('custodian guard'), 'custodian guard', 'ambiguous nicknames are not rewritten');
    assert.equal(expandQuery('sisters of battle'), 'adepta sororitas');
  });

  test('bestMatches: key, limit, threshold, multi-text items', () => {
    const items = [{ n: 'Hellblasters', a: ['plasma marines'] }, { n: 'Intercessors', a: ['bolt rifle marines'] }];
    const r = bestMatches('plasma', items, { key: (x) => [x.n, ...x.a] });
    assert.equal(r.length, 1);
    assert.equal(r[0].item.n, 'Hellblasters');
    assert.equal(r[0].text, 'plasma marines');
    assert.equal(bestMatches('marines', items, { key: (x) => [x.n, ...x.a], limit: 1 }).length, 1);
    assert.deepEqual(bestMatches('', items), []);
    assert.deepEqual(bestMatches('zzzz', ['abc']), []);
  });

  test('suggest builds the corrected query from vocabulary words', () => {
    const vocab = WATCHLIST;
    assert.equal(suggest('intersessors', vocab), 'intercessors');
    assert.equal(suggest('terminater squad', vocab), 'terminator squad');
    assert.equal(suggest('necron warriers', vocab), 'necron warriors');
    assert.equal(suggest('hellblastr', vocab), 'hellblasters');
    assert.equal(suggest('Custodain Gaurd', vocab), 'custodian guard');
    // Nothing to fix: known words, nicknames, prefixes, numbers, very short words.
    for (const q of ['intercessors', 'cp sm', 'termies', 'interc', 'combat patrol 2025', 'xyz']) {
      assert.equal(suggest(q, vocab), null, q);
    }
    assert.equal(suggest('qqqqqqqq', vocab), null, 'no close word: no suggestion');
    assert.equal(suggest('intersessors', []), null);
  });

  test('performance: ranking 500 strings per keystroke takes < 5 ms', () => {
    const factions = ['Space Marines', 'Necrons', 'Orks', 'Tyranids', 'Chaos Space Marines', 'Aeldari', 'Astra Militarum'];
    const kits = ['Intercessors', 'Hellblasters', 'Warriors', 'Boyz', 'Termagants', 'Terminator Squad', 'Combat Patrol',
      'Leman Russ Battle Tank', 'Guardian Defenders', 'Redemptor Dreadnought', 'Carnifex'];
    const items = Array.from({ length: 500 }, (_, i) => `${factions[i % 7]}: ${kits[i % 11]} ${['', 'Kit', 'Box', 'Set'][i % 4]} #${i}`);
    const typed = 'intersessors squad'.split('').map((_, i, a) => a.slice(0, i + 1).join('')).filter((q) => q.length >= 2);
    bestMatches('warmup', items);
    // Best of several runs: the suites run in parallel (and on shared CI runners),
    // so a single run can be slowed by scheduling noise unrelated to this code.
    const best = (fn, runs) => Math.min(...Array.from({ length: runs }, () => {
      const t = performance.now(); fn(); return performance.now() - t;
    }));
    const per = best(() => { for (const q of typed) bestMatches(q, items, { limit: 8 }); }, 5) / typed.length;
    assert.ok(per < 5, `${per.toFixed(2)} ms per keystroke`);
    // Cold cache (new strings every time) is still fast enough.
    let n = 0;
    const cold = best(() => { const v = ++n; bestMatches('necron warriers', items.map((s) => `${s} v${v}`)); }, 3);
    assert.ok(cold < 25, `${cold.toFixed(2)} ms cold`);
  });
});

describe('price matching', () => {
  const finds = [
    ['intersessors', 'Space Marines: Intercessors'],
    ['terminater squad', 'Space Marines: Terminators'],
    ['combat patrol space marine', 'Combat Patrol: Space Marines'],
    ['cp sm', 'Combat Patrol: Space Marines'],
    ['termies', 'Space Marines: Terminators'],
    ['necron warriers', 'Necrons: Necron Warriors'],
    ['ork boys', 'Orks: Boyz'],
    ['custodian gaurd', 'Adeptus Custodes: Custodian Guard'],
    ['gaunts', 'Tyranids: Termagants'],
  ];
  for (const [q, t] of finds) {
    test(`"${q}" finds ${t}`, () => assert.ok(isMatch(q, t), `${q} vs ${t}: ${matchScore(q, t)}`));
  }

  test('precision: unrelated kits do not match', () => {
    assert.ok(!matches('intercessors').includes('Space Marines: Hellblasters'));
    assert.ok(!matches('intersessors').includes('Space Marines: Hellblasters'));
    // Terminators vs Termagants: close in spelling, very different models.
    for (const q of ['terminators', 'Terminators', 'terminator', 'terminater', 'termies', 'termi', 'Terminator Squad']) {
      assert.ok(!matches(q).includes('Tyranids: Termagants'), `${q} must not match Termagants`);
    }
    for (const q of ['termagants', 'termagant', 'termagaunts', 'gaunts']) {
      assert.ok(!matches(q).some((t) => /Terminator/.test(t)), `${q} must not match Terminators`);
    }
    // Like "intercessors" also listing Assault Intercessors, every title that
    // contains the whole query matches; nothing else does.
    assert.deepEqual(matches('terminators'), ['Space Marines: Terminators', 'Space Marines: Terminator Assault Squad']);
    assert.deepEqual(matches('termagants'), ['Tyranids: Termagants']);
    // Every distinctive word must be found.
    assert.ok(!matches('combat patrol space marines').includes('Boarding Patrol: Space Marines'));
    assert.ok(!matches('cp sm').includes('Boarding Patrol: Space Marines'));
    assert.ok(!matches('cp sm').includes('Combat Patrol: Necrons'));
    // "Chaos" kits only when asked for.
    assert.ok(!matches('combat patrol space marines').includes('Combat Patrol: Chaos Space Marines'));
    assert.ok(!matches('termies').includes('Chaos Space Marines: Chaos Terminators'));
    assert.ok(matches('chaos terminators').includes('Chaos Space Marines: Chaos Terminators'));
    assert.ok(matches('csm termies').includes('Chaos Space Marines: Chaos Terminators'));
    // Paints, books, dice still filtered.
    for (const q of ['intersessors', 'ultramarines', 'space marines']) {
      assert.ok(!matches(q).some((t) => /paint|Codex|Dice/.test(t)), q);
    }
    assert.ok(matches('space marines codex').includes('Codex: Space Marines'));
  });

  test('MSRP lookups benefit without false positives', () => {
    assert.equal(findMsrp('intersessors')?.name, 'Space Marines Intercessors');
    assert.equal(findMsrp('termies')?.name, 'Space Marines Terminators');
    assert.equal(findMsrp('cp sm')?.name, 'Combat Patrol: Space Marines');
    assert.equal(findMsrp('necron warriers')?.name, 'Necron Warriors');
    assert.equal(findMsrp('gaunts')?.name, 'Tyranids Termagants');
    assert.equal(findMsrp('Assault Intercessors')?.name, 'Space Marines Assault Intercessors');
    assert.equal(findMsrp('hellblasters'), null);
    assert.equal(findMsrp('chaos terminators'), null);
    assert.equal(findMsrp('termagants')?.name, 'Tyranids Termagants');
    assert.notEqual(findMsrp('terminators')?.name, 'Tyranids Termagants');
  });

  const cand = (title, i) => ({ retailerId: 'element-games', __source: 'element-games', title,
    url: `https://elementgames.co.uk/p/${i}`, price: 30 + i, currency: 'GBP', inStock: true });

  test('rankOffers: misspelled queries find offers and report didYouMean', () => {
    const candidates = TITLES.map(cand);
    const out = rankOffers({ query: 'intersessors', candidates });
    assert.deepEqual(out.didYouMean, { query: 'intersessors', corrected: 'intercessors' });
    const titles = out.results.map((o) => o.title);
    assert.ok(titles.includes('Space Marines: Intercessors'));
    assert.ok(!titles.includes('Space Marines: Hellblasters'));
    assert.ok(!titles.some((t) => /Dice/.test(t)));

    const t = rankOffers({ query: 'terminater squad', candidates });
    assert.equal(t.didYouMean.corrected, 'terminator squad');
    assert.deepEqual(t.results.map((o) => o.title), ['Space Marines: Terminators', 'Space Marines: Terminator Assault Squad']);

    const n = rankOffers({ query: 'necron warriers', candidates });
    assert.equal(n.didYouMean.corrected, 'necron warriors');
    assert.deepEqual(n.results.map((o) => o.title), ['Necrons: Necron Warriors']);

    for (const q of ['intercessors', 'termies', 'cp sm']) {
      assert.equal(rankOffers({ query: q, candidates }).didYouMean, null, `${q}: nothing to correct`);
    }
    assert.deepEqual(rankOffers({ query: 'cp sm', candidates }).results.map((o) => o.title), ['Combat Patrol: Space Marines']);
  });

  test('didYouMean ignores untrusted offer titles', () => {
    const evil = { retailerId: 'element-games', __source: 'element-games', title: 'Intersessorz Mega Deal',
      url: 'https://evil.example/x', price: 1, currency: 'GBP', inStock: true };
    const out = rankOffers({ query: 'intersessorzz', candidates: [evil] });
    assert.notEqual(out.didYouMean?.corrected, 'intersessorz');
  });

  test('searchPrices (demo) with typos and nicknames', async () => {
    const out = await searchPrices({ query: 'necron warriers', demo: true });
    assert.ok(out.results.length >= 2);
    assert.ok(out.results.every((o) => o.title === 'Necrons: Necron Warriors'));
    assert.equal(out.msrp.name, 'Necron Warriors');
    const t = await searchPrices({ query: 'termies', demo: true });
    assert.ok(t.results.length && t.results.every((o) => o.title === 'Space Marines: Terminators'));
  });

  test('watchlist: ~60 kits, unique, popular picks are tracked', () => {
    assert.ok(WATCHLIST.length >= 55 && WATCHLIST.length <= 70, `${WATCHLIST.length}`);
    assert.equal(new Set(WATCHLIST.map(normalize)).size, WATCHLIST.length);
    for (const p of POPULAR) assert.ok(WATCHLIST.includes(p), p);
    const vocab = suggestionVocabulary(['Space Marines: Intercessors', 'space marines: intercessors', 42]);
    assert.ok(vocab.includes('Combat Patrol: Space Marines'));
    assert.equal(vocab.filter((v) => normalize(v) === 'space marines intercessors').length, 1);
    assert.deepEqual(suggestionsPayload().popular, POPULAR);
  });

  test('routes: /api/prices/suggestions and corrected live search', async () => {
    __resetSearchLimiter();
    const server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const s = await (await fetch(`${base}/api/prices/suggestions`)).json();
      assert.ok(s.suggestions.length >= WATCHLIST.length);
      assert.ok(s.popular.length >= 4);
      const r = await (await fetch(`${base}/api/prices/search?q=intersessors&demo=1`)).json();
      assert.equal(r.query, 'intersessors');
      assert.deepEqual(r.didYouMean, { query: 'intersessors', corrected: 'intercessors' });
      assert.equal(r.searchedFor, 'intercessors');
      assert.ok(r.results.some((o) => o.title === 'Space Marines: Intercessors'));
      const cp = await (await fetch(`${base}/api/prices/search?q=cp%20sm&demo=1`)).json();
      assert.equal(cp.searchedFor, 'combat patrol space marines');
      assert.equal(cp.didYouMean, null);
      assert.ok(cp.results.length && cp.results.every((o) => o.title === 'Combat Patrol: Space Marines'));
      // Shared browser modules are served for the pages.
      const js = await fetch(`${base}/lib/search/fuzzy.js`);
      assert.equal(js.status, 200);
      assert.match(js.headers.get('content-type'), /javascript/);
      assert.equal((await fetch(`${base}/lib/combat/unitSearch.js`)).status, 200);
      assert.equal((await fetch(`${base}/lib/combat/service.js`)).status, 404, 'only the search modules are exposed');
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe('combat unit search', () => {
  const ids = (q) => listUnits(UNITS, q).map((u) => u.id);

  test('nicknames and typos find the right unit first', () => {
    const cases = {
      termies: 'terminator-squad', intersessors: 'intercessor-squad', interc: 'intercessor-squad',
      'nec warr': 'necron-warriors', 'necron warriers': 'necron-warriors', gaunts: 'termagants',
      'primaris terminators': 'terminator-squad', 'csm termies': 'chaos-terminator-squad', hellblastrs: 'hellblaster-squad',
      custodes: 'custodian-guard', boyz: 'ork-boyz', 'ork boys': 'ork-boyz',
    };
    for (const [q, id] of Object.entries(cases)) assert.equal(ids(q)[0], id, q);
  });

  test('precision: no cross-matching', () => {
    assert.ok(!ids('terminators').includes('termagants'));
    assert.ok(!ids('termagants').some((id) => id.includes('terminator')));
    assert.ok(!ids('intercessors').includes('hellblaster-squad'));
    assert.ok(!ids('termies').includes('chaos-terminator-squad'), 'Chaos only when asked for');
    assert.deepEqual(ids('nope'), []);
    assert.deepEqual(ids('qwertyuiop'), []);
    assert.equal(ids('').length, UNITS.length);
  });

  test('exact alias/name first; same signature as the old findUnits', () => {
    assert.equal(findUnits(UNITS, 'primaris terminators')[0].id, 'terminator-squad');
    assert.equal(findUnits(UNITS, 'Primaris Intercessors')[0].id, 'intercessor-squad');
    assert.equal(findUnits(UNITS, 'terminators')[0].id, 'terminator-squad');
    assert.equal(findUnits([{ id: 'x', name: 'X Squad', faction: 'Y' }], 'x squad')[0].id, 'x', 'units without aliases');
  });

  test('unitById resolves nicknames and typos, but only confidently', () => {
    assert.equal(unitById('termies', UNITS)?.id, 'terminator-squad');
    assert.equal(unitById('intersessors', UNITS)?.id, 'intercessor-squad');
    assert.equal(unitById('primaris-terminators', UNITS)?.id, 'terminator-squad');
    assert.equal(unitById('necron-warriers', UNITS)?.id, 'necron-warriors');
    assert.equal(unitById('nope', UNITS), null);
    assert.equal(resolveUnit(UNITS, 'guard'), null, 'ambiguous nickname stays unresolved');
    assert.equal(resolveUnit(UNITS, 'custodes')?.id, 'custodian-guard', 'an exact alias beats faction matches');
  });

  test('"Did you mean" for unit searches', () => {
    assert.equal(suggestUnitQuery(UNITS, 'intersessors'), 'intercessors');
    assert.equal(suggestUnitQuery(UNITS, 'hellblastrs'), 'hellblasters');
    assert.equal(suggestUnitQuery(UNITS, 'termies'), null);
  });
});

test('static build ships lib/search/fuzzy.js and the shared unit search', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'site-search-'));
  try {
    await run(process.execPath, ['scripts/build-static.js', dir]);
    const fz = await import(pathToFileURL(path.join(dir, 'lib/search/fuzzy.js')));
    assert.equal(fz.suggest('intersessors', ['Primaris Intercessors']), 'intercessors');
    assert.ok(fz.score('termies', 'Space Marines: Terminators') >= 0.9);
    const us = await import(pathToFileURL(path.join(dir, 'lib/combat/unitSearch.js')));
    const { UNITS: U } = await import(pathToFileURL(path.join(dir, 'lib/combat/data/units.js')));
    assert.equal(us.findUnits(U, 'termies')[0].id, 'terminator-squad');
    const rank = await import(pathToFileURL(path.join(dir, 'lib/price/rank.js')));
    assert.ok(rank.suggestionsPayload(['Space Marines: Intercessors']).suggestions.length > 50);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('silent first letters are forgiven but precision holds', async () => {
  const { listUnits } = await import('../src/combat/service.js');
  const { UNITS } = await import('../src/combat/data/units.js');
  assert.equal(listUnits(UNITS, 'deathwing nights')[0]?.name, 'Deathwing Knights');
  assert.equal(score('nights', 'Space Marines: Terminators'), 0);
});
