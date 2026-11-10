import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  simulate, woundTarget, rollTest, saveFor, parseDice, damageDistribution, applyDamage, parseKeywords,
  keywordError, MAX_TRIALS,
} from '../src/combat/engine.js';
import { buildSimulation } from '../src/combat/routes.js';
import { UNITS, findUnits } from '../src/combat/data/units.js';
import {
  refreshRemote, getUnits, dataSourceStatus, parsePipeCsv, normalizeWahapedia, __resetDataSource, REMOTE_LIMIT,
} from '../src/combat/dataSource.js';
import { __setFetch, __reset } from '../src/shared/httpClient.js';
import { createApp } from '../src/server.js';

const close = (a, b, tol = 0.005, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}, got ${a}`);
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

const boltRifle = { name: 'Bolt rifle', type: 'ranged', A: '2', skill: 3, S: 4, AP: -1, D: '1', keywords: ['Assault', 'Heavy'] };
const terminators = { name: 'Terminators', models: 5, T: 5, Sv: 2, inv: 4, W: 3, keywords: ['Infantry', 'Terminator'] };
const one = (weapon, models, defender, extra = {}) => simulate({ attacker: { weapons: [{ ...weapon, models }] }, defender, ...extra });

describe('tables', () => {
  test('wound table covers every branch', () => {
    assert.equal(woundTarget(8, 4), 2);   // S >= 2T
    assert.equal(woundTarget(10, 4), 2);
    assert.equal(woundTarget(5, 4), 3);   // S > T
    assert.equal(woundTarget(4, 4), 4);   // S == T
    assert.equal(woundTarget(4, 5), 5);   // S < T
    assert.equal(woundTarget(4, 7), 5);
    assert.equal(woundTarget(4, 8), 6);   // S <= T/2
    assert.equal(woundTarget(3, 7), 6);
  });

  test('hit roll: unmodified 1 always fails, 6 always hits, modifier capped at +/-1', () => {
    const plus3 = rollTest(2, +3);
    close(plus3.fail, 1 / 6, 1e-12, '1 always fails even at 2+ with +3');
    assert.deepEqual(rollTest(3, +3), rollTest(3, +1));
    assert.deepEqual(rollTest(3, -3), rollTest(3, -1));
    close(rollTest(3, -1).ok + rollTest(3, -1).crit, 3 / 6, 1e-12);
    const hopeless = rollTest(6, -1);
    close(hopeless.ok + hopeless.crit, 1 / 6, 1e-12, 'unmodified 6 always hits');
    const crit5 = rollTest(3, 0, 5);
    close(crit5.crit, 2 / 6, 1e-12);
    close(crit5.ok, 2 / 6, 1e-12);
  });

  test('re-rolls', () => {
    const ones = rollTest(3, 0, 6, 'ones');
    close(ones.ok + ones.crit, 4 / 6 + (1 / 6) * (4 / 6), 1e-12);
    const failed = rollTest(3, 0, 6, 'failed');
    close(failed.ok + failed.crit, 1 - (2 / 6) ** 2, 1e-12);
  });

  test('saves: AP, invulnerable, cover rules, unmodified 1', () => {
    assert.equal(saveFor({ Sv: 2, inv: 4 }, { AP: -1 }).target, 3);
    const s = saveFor({ Sv: 2, inv: 4 }, { AP: -3 });
    assert.equal(s.target, 4); assert.equal(s.used, 'invulnerable');
    assert.equal(saveFor({ Sv: 3 }, { AP: 0 }, ).target, 3);
    assert.equal(saveFor({ Sv: 3, cover: true }, { AP: 0 }).target, 3, 'no cover for 3+ vs AP0');
    assert.equal(saveFor({ Sv: 3, cover: true }, { AP: -1 }).target, 3, 'cover offsets AP-1');
    assert.equal(saveFor({ Sv: 4, cover: true }, { AP: 0 }).target, 3);
    assert.equal(saveFor({ Sv: 4, cover: true }, { AP: 0, ranged: false }).target, 4, 'no cover in melee');
    assert.equal(saveFor({ Sv: 4, cover: true }, { AP: 0, ignoresCover: true }).target, 4);
    assert.equal(saveFor({ Sv: 2, cover: true }, { AP: -1 }).target, 2, 'unmodified 1 always fails (min 2+)');
    const none = saveFor({ Sv: 5 }, { AP: -3 });
    assert.equal(none.pSave, 0); assert.equal(none.used, 'none');
  });

  test('dice parsing', () => {
    close(parseDice('D6+2').mean, 5.5, 1e-9);
    close(parseDice('2D6').mean, 7, 1e-9);
    assert.equal(parseDice('D3').max, 3);
    assert.equal(parseDice(4).mean, 4);
    assert.throws(() => parseDice('D7'));
    close(sum(parseDice('2D6').dist), 1, 1e-12);
  });

  test('keyword parsing', () => {
    const k = parseKeywords(['Lethal Hits', 'Sustained Hits D3', 'Anti-Infantry 4+', 'Rapid Fire 2', 'Melta 2', 'Twin-linked']);
    assert.equal(k.lethalHits, true); assert.equal(k.sustainedHits, 'D3'); assert.equal(k.rapidFire, 2);
    assert.equal(k.melta, 2); assert.equal(k.twinLinked, true);
    assert.deepEqual(k.anti, [{ keyword: 'infantry', threshold: 4 }]);
  });

  test('damage: reduction (min 1) and Feel No Pain', () => {
    const red = damageDistribution({ D: '1', damageReduction: 1 });
    assert.equal(red.mean, 1);
    close(damageDistribution({ D: '2', damageReduction: 1 }).mean, 1, 1e-12);
    close(damageDistribution({ D: '3', fnp: 5 }).mean, 3 * (4 / 6), 1e-12);
    close(damageDistribution({ D: 'D6', melta: 2, halfRange: true }).mean, 5.5, 1e-12);
  });

  test('allocation: no spill for normal damage, spill for mortal wounds', () => {
    assert.deepEqual(applyDamage({ alive: 3, dmg: 0 }, 5, { W: 2 }), { alive: 2, dmg: 0 });
    assert.deepEqual(applyDamage({ alive: 3, dmg: 0 }, 5, { W: 2, spill: true }), { alive: 1, dmg: 1 });
    assert.deepEqual(applyDamage({ alive: 3, dmg: 1 }, 1, { W: 3 }), { alive: 3, dmg: 2 });
  });
});

describe('engine', () => {
  test('10 Intercessors (bolt rifle) vs 5 Terminators matches the hand calculation', () => {
    const r = one(boltRifle, 10, terminators);
    assert.equal(r.method, 'exact');
    close(r.expected.attacks, 20, 1e-9);
    close(r.expected.hits, 13.33);
    close(r.expected.wounds, 4.44);
    close(r.expected.unsavedWounds, 1.48);
    close(r.expected.damage, 1.48);
    assert.equal(r.weapons[0].saveTarget, 3);
    assert.equal(r.weapons[0].saveUsed, 'armour');
    close(sum(r.killDistribution), 1, 1e-9);
    // D1 vs W3: kills = floor(unsaved/3) with unsaved ~ Binomial(20, 2/3*1/3*1/3)
    const p = 2 / 27;
    let p0 = 0;
    for (let k = 0; k <= 2; k++) p0 += binom(20, k) * p ** k * (1 - p) ** (20 - k);
    close(r.killDistribution[0], p0, 1e-9);
  });

  test('Heavy adds +1 to hit when stationary (capped)', () => {
    const r = one(boltRifle, 10, terminators, { attackerMods: { stationary: true, hitMod: 1 } });
    close(r.expected.hits, 20 * (5 / 6));
  });

  test('Lethal Hits: crits auto-wound', () => {
    const w = { name: 'gauss', A: '1', skill: 4, S: 4, AP: 0, D: '1', keywords: ['Lethal Hits'] };
    const r = one(w, 6, { models: 10, T: 8, Sv: 7, W: 1 });
    // per attack: crit 1/6 auto-wounds; normal hit 2/6 wounds on 6+ (1/6)
    close(r.expected.wounds, 6 * (1 / 6 + (2 / 6) * (1 / 6)), 1e-9);
  });

  test('Sustained Hits X and D3 add hits on crits', () => {
    const w = { name: 's', A: '6', skill: 4, S: 4, AP: 0, D: '1', keywords: ['Sustained Hits 2'] };
    const r = one(w, 1, { models: 10, T: 4, Sv: 7, W: 1 });
    close(r.expected.hits, 6 * (3 / 6 + (1 / 6) * 2), 1e-9);
    const r2 = one({ ...w, keywords: ['Sustained Hits D3'] }, 1, { models: 10, T: 4, Sv: 7, W: 1 });
    close(r2.expected.hits, 6 * (3 / 6 + (1 / 6) * 2), 1e-9);
    close(sum(r2.killDistribution), 1, 1e-9);
  });

  test('Devastating Wounds: crit wounds ignore saves, keep normal damage, do not spill', () => {
    const w = { name: 'dev', A: '6', skill: 2, S: 4, AP: 0, D: '3', keywords: ['Devastating Wounds'] };
    // Sv2+ invuln 2++ : only devastating wounds get through.
    const def = { models: 5, T: 4, Sv: 2, inv: 2, W: 2 };
    const r = one(w, 1, def);
    const pCritWound = (5 / 6) * (1 / 6); // 2+ to hit, then a 6 to wound
    close(r.expected.devastatingWounds, 6 * pCritWound, 1e-9);
    close(r.expected.unsavedWounds, 6 * pCritWound + 6 * (5 / 6) * (2 / 6) * (1 / 6), 1e-9);
    // no spill: each unsaved wound of 3 damage can kill at most one W2 model
    const mc = one(w, 1, def, { options: { method: 'monte-carlo', trials: 40000, seed: 7 } });
    close(r.expected.modelsKilled, mc.expected.modelsKilled, 0.03);
    // Lethal Hits do not trigger Devastating Wounds
    const both = one({ ...w, keywords: ['Devastating Wounds', 'Lethal Hits'], skill: 6 }, 1, { ...def, inv: null, Sv: 7 });
    assert.ok(both.expected.devastatingWounds < 6 * (1 / 6) * (1 / 6) + 1e-9);
  });

  test('Anti-X lowers the critical wound threshold for matching targets', () => {
    const w = { name: 'anti', A: '6', skill: 2, S: 3, AP: 0, D: '1', keywords: ['Anti-Infantry 4+', 'Devastating Wounds'] };
    const inf = one(w, 1, { models: 5, T: 8, Sv: 2, W: 1, keywords: ['Infantry'] });
    const veh = one(w, 1, { models: 5, T: 8, Sv: 2, W: 1, keywords: ['Vehicle'] });
    assert.equal(inf.weapons[0].critWoundOn, 4);
    assert.equal(veh.weapons[0].critWoundOn, 6);
    assert.ok(inf.expected.unsavedWounds > veh.expected.unsavedWounds * 2);
  });

  test('no spill: D3 damage vs W2 models kills at most one model per unsaved wound', () => {
    const w = { name: 'd3', A: '1', skill: 2, S: 10, AP: -6, D: 'D3', keywords: [] };
    const r = one(w, 3, { models: 5, T: 4, Sv: 7, W: 2 });
    // 3 attacks; each hits 5/6, wounds 5/6, no save; D3 => 1/3 chance of only 1 damage
    assert.equal(r.killDistribution.length, 6);
    close(r.killDistribution[4] + r.killDistribution[5], 0, 1e-12);
    close(r.expected.modelsKilled, mcKills(w, 3, { models: 5, T: 4, Sv: 7, W: 2 }), 0.03);
  });

  test('Feel No Pain applies per point of damage', () => {
    const w = { name: 'fist', A: '1', skill: 2, S: 10, AP: -6, D: '2', keywords: [] };
    const r = one(w, 1, { models: 1, T: 4, Sv: 7, W: 2, fnp: 5 });
    // P(hit & wound) = 25/36; both points must get through FNP 5+ (2/3 each)
    close(r.pWipe, (25 / 36) * (4 / 9), 1e-9);
  });

  test('distribution sums to 1 and exact matches Monte Carlo for random attacks/damage', () => {
    const w = { name: 'mix', A: 'D6', skill: 3, S: 5, AP: -2, D: 'D3', keywords: ['Sustained Hits D3', 'Lethal Hits', 'Devastating Wounds'] };
    const def = { models: 10, T: 4, Sv: 3, W: 2, fnp: 5, keywords: ['Infantry'] };
    const ex = one(w, 5, def);
    const mc = one(w, 5, def, { options: { method: 'monte-carlo', trials: 30000, seed: 123 } });
    assert.equal(ex.method, 'exact'); assert.equal(mc.method, 'monte-carlo');
    close(sum(ex.killDistribution), 1, 1e-9);
    close(sum(mc.killDistribution), 1, 1e-9);
    close(ex.expected.modelsKilled, mc.expected.modelsKilled, 0.08);
    ex.killDistribution.forEach((p, k) => close(p, mc.killDistribution[k], 0.015, `P(${k})`));
  });

  test('multiple weapons resolve sequentially against the same defender', () => {
    const fist = { name: 'Power fist', type: 'melee', A: '3', skill: 3, S: 8, AP: -2, D: '2', keywords: [] };
    const ccw = { name: 'CCW', type: 'melee', A: '3', skill: 3, S: 4, AP: 0, D: '1', keywords: [] };
    const r = simulate({ attacker: { weapons: [{ ...ccw, models: 9 }, { ...fist, models: 1 }] }, defender: terminators });
    assert.equal(r.weapons.length, 2);
    close(sum(r.killDistribution), 1, 1e-9);
    const mc = simulate({ attacker: { weapons: [{ ...ccw, models: 9 }, { ...fist, models: 1 }] }, defender: terminators,
      options: { method: 'monte-carlo', trials: 30000, seed: 9 } });
    close(r.expected.modelsKilled, mc.expected.modelsKilled, 0.03);
  });

  test('Blast, Rapid Fire, Torrent, Melta', () => {
    const blast = one({ name: 'b', A: 'D6', skill: 3, S: 4, AP: 0, D: '1', keywords: ['Blast'] }, 1, { models: 10, T: 4, Sv: 7, W: 1 });
    close(blast.expected.attacks, 3.5 + 2, 1e-9);
    const rf = one({ name: 'r', A: '1', skill: 3, S: 4, AP: 0, D: '1', keywords: ['Rapid Fire 1'] }, 10, { models: 10, T: 4, Sv: 7, W: 1 },
      { attackerMods: { halfRange: true } });
    close(rf.expected.attacks, 20, 1e-9);
    const torrent = one({ name: 't', A: '6', skill: null, S: 4, AP: 0, D: '1', keywords: ['Torrent'] }, 1, { models: 10, T: 4, Sv: 7, W: 1 },
      { attackerMods: { hitMod: -1 } });
    close(torrent.expected.hits, 6, 1e-9);
    const melta = one({ name: 'm', A: '1', skill: 2, S: 9, AP: -4, D: 'D6', keywords: ['Melta 2'] }, 1, { models: 1, T: 11, Sv: 2, W: 13 },
      { attackerMods: { halfRange: true } });
    close(melta.weapons[0].damagePerUnsaved, 5.5, 1e-9);
  });

  test('large volleys fall back to Monte Carlo', () => {
    const w = { name: 'big', A: '2D6', skill: 3, S: 5, AP: -1, D: 'D3', keywords: ['Devastating Wounds', 'Sustained Hits D3'] };
    const r = one(w, 30, { models: 30, T: 4, Sv: 3, W: 3 }, { options: { trials: 2000 } });
    assert.equal(r.method, 'monte-carlo');
    close(sum(r.killDistribution), 1, 1e-9);
  });
});

function binom(n, k) { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; }
function mcKills(w, models, def) {
  return one(w, models, def, { options: { method: 'monte-carlo', trials: 40000, seed: 3 } }).expected.modelsKilled;
}

describe('unit data', () => {
  test('seed set has ~15+ units with valid weapons', () => {
    assert.ok(UNITS.length >= 15);
    const ids = new Set();
    for (const u of UNITS) {
      assert.ok(!ids.has(u.id), `duplicate ${u.id}`); ids.add(u.id);
      assert.ok(u.profile.T && u.profile.Sv && u.profile.W, u.id);
      for (const w of u.weapons) { parseDice(w.A); parseDice(w.D); }
    }
  });
  test('"primaris terminators" alias maps to Terminator Squad', () => {
    assert.equal(findUnits(UNITS, 'primaris terminators')[0].id, 'terminator-squad');
    assert.equal(findUnits(UNITS, 'Primaris Intercessors')[0].id, 'intercessor-squad');
  });
});

describe('remote data source', () => {
  beforeEach(() => { __reset(); __resetDataSource(); delete process.env.UNIT_DATA_REMOTE; });

  const fixtures = {
    'Factions.csv': 'id|name|link|\nSM|Space Marines|x|\n',
    'Datasheets.csv': '﻿id|name|faction_id|virtual|\n000001|Company Heroes|SM|false|\n000002|Intercessor Squad|SM|false|\n',
    'Datasheets_models.csv': 'datasheet_id|line|name|M|T|Sv|inv_sv|W|Ld|OC|\n000001|1|Company Hero|6"|4|3+|-|2|6+|1|\n000002|1|Intercessor|6"|4|3+|-|2|6+|2|\n',
    'Datasheets_wargear.csv': 'datasheet_id|line|line_in_wargear|dice|name|description|range|type|A|BS_WS|S|AP|D|\n'
      + '000001|1|1||Heroic bolt rifle|<a>assault</a>, <a>heavy</a>, <a>devastating wounds</a>|24"|Ranged|2|3+|4|-1|1|\n'
      + '000002|1|1||Bolt rifle||24"|Ranged|2|3+|4|-1|1|\n',
  };

  test('remote import is disabled by default and never fetches', async () => {
    let calls = 0;
    __setFetch(async () => { calls++; return new Response('', { status: 500 }); });
    assert.equal(getUnits(), UNITS);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls, 0);
    assert.equal(dataSourceStatus().source, 'seed');
  });

  test('declares the polite host budget', () => {
    assert.deepEqual(REMOTE_LIMIT, { requestsPerMinute: 2, burst: 1, maxConcurrent: 1 });
  });

  test('imports CSV fixtures via politeFetch and merges with seed data', async () => {
    process.env.SKIP_ROBOTS = '1';
    const seen = [];
    __setFetch(async (url) => {
      seen.push(url);
      const file = url.split('/').pop();
      return fixtures[file] ? new Response(fixtures[file], { status: 200 }) : new Response('', { status: 404 });
    });
    const units = await refreshRemote({ hostLimit: { requestsPerMinute: 6000, burst: 10 } });
    assert.equal(seen.length, 4);
    assert.ok(seen.every((u) => u.startsWith('https://wahapedia.ru/wh40k10ed/')));
    const heroes = units.find((u) => u.name === 'Company Heroes');
    assert.ok(heroes, "imported unit not in seed data is merged in");
    assert.equal(heroes.faction, 'Space Marines');
    assert.equal(heroes.profile.T, 4);
    assert.deepEqual(heroes.weapons[0].keywords, ['Assault', 'Heavy', 'Devastating Wounds']);
    assert.equal(units.filter((u) => u.name === 'Intercessor Squad').length, 1, 'seed wins on duplicates');
    assert.equal(dataSourceStatus().source, 'seed+remote');
  });

  test('falls back to seed data on failure', async () => {
    process.env.SKIP_ROBOTS = '1';
    __setFetch(async () => new Response('nope', { status: 403 }));
    const units = await refreshRemote({ hostLimit: { requestsPerMinute: 6000, burst: 10 } });
    assert.equal(units, UNITS);
    assert.match(dataSourceStatus().lastError, /403/);
  });

  test('CSV parsing helpers', () => {
    const rows = parsePipeCsv('a|b|\n1|2|\n');
    assert.deepEqual(rows, [{ a: '1', b: '2' }]);
    assert.deepEqual(normalizeWahapedia({}), []);
  });
});

describe('API', () => {
  async function withServer(fn) {
    const server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}/api/combat`;
    try { await fn(base); } finally { await new Promise((r) => server.close(r)); }
  }
  const post = (base, body) => fetch(`${base}/simulate`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body) });

  test('lists units and fetches one (alias lookup)', async () => {
    await withServer(async (base) => {
      const list = await (await fetch(`${base}/units`)).json();
      assert.ok(list.units.length >= 15);
      assert.ok(list.units[0].weapons.length);
      const q = await (await fetch(`${base}/units?q=primaris%20terminators`)).json();
      assert.equal(q.units[0].id, 'terminator-squad');
      const u = await (await fetch(`${base}/units/terminator-squad`)).json();
      assert.equal(u.unit.profile.W, 3);
      const alias = await (await fetch(`${base}/units/primaris-terminators`)).json();
      assert.equal(alias.unit.id, 'terminator-squad');
      assert.equal((await fetch(`${base}/units/nope`)).status, 404);
    });
  });

  test('simulates intercessors vs terminators', async () => {
    await withServer(async (base) => {
      const res = await post(base, {
        attacker: { unitId: 'intercessor-squad', models: 10, weaponIds: ['bolt-rifle'] },
        defender: { unitId: 'terminator-squad', models: 5 },
      });
      assert.equal(res.status, 200);
      const r = await res.json();
      close(r.expected.unsavedWounds, 1.48);
      assert.equal(r.method, 'exact');
      assert.equal(r.killDistribution.length, 6);
    });
  });

  test('mixed weapons with per-weapon model counts and custom profiles', async () => {
    await withServer(async (base) => {
      const r = await (await post(base, {
        attacker: { unitId: 'intercessor-squad', models: 10, weapons: [{ id: 'close-combat-weapon', models: 9 }, { id: 'power-fist', models: 1 }],
          modifiers: { rerollHits: 'ones' } },
        defender: { custom: { T: 4, Sv: 3, W: 2, keywords: ['Infantry'] }, models: 10, modifiers: { cover: true, fnp: 6 } },
      })).json();
      assert.equal(r.weapons.length, 2);
      assert.equal(r.weapons[1].models, 1);
      const c = await post(base, {
        attacker: { custom: { name: 'Gun', weapons: [{ name: 'g', A: 'D6', skill: 4, S: 6, AP: -1, D: 'D3', keywords: ['Blast'] }] }, models: 2 },
        defender: { unitId: 'ork-boyz', models: 10 },
      });
      assert.equal(c.status, 200);
    });
  });

  test('rejects invalid input with 400 { error }', async () => {
    await withServer(async (base) => {
      const okA = { unitId: 'intercessor-squad', models: 10, weaponIds: ['bolt-rifle'] };
      const okD = { unitId: 'terminator-squad', models: 5 };
      const cases = [
        {},
        { attacker: { ...okA, models: 0 }, defender: okD },
        { attacker: { ...okA, models: 31 }, defender: okD },
        { attacker: okA, defender: { ...okD, models: 100 } },
        { attacker: { ...okA, unitId: 'nope' }, defender: okD },
        { attacker: { ...okA, weaponIds: ['laser-sword'] }, defender: okD },
        { attacker: { ...okA, weaponIds: [] }, defender: okD },
        { attacker: { ...okA, modifiers: { hitMod: 'lots' } }, defender: okD },
        { attacker: { ...okA, modifiers: { typo: true } }, defender: okD },
        { attacker: { ...okA, modifiers: { rerollHits: 'everything' } }, defender: okD },
        { attacker: { ...okA, weaponIds: undefined, weapons: [{ id: 'bolt-rifle', models: 11 }] }, defender: okD },
        { attacker: { custom: { weapons: [{ A: 'D7', skill: 3, S: 4, D: '1' }] }, models: 5 }, defender: okD },
        { attacker: { custom: { weapons: [{ A: '99', skill: 3, S: 4, D: '1' }] }, models: 5 }, defender: okD },
        { attacker: { custom: { weapons: [{ A: '2', skill: 3, S: 4, AP: 2, D: '1' }] }, models: 5 }, defender: okD },
        { attacker: okA, defender: { custom: { T: 0, Sv: 3, W: 1 }, models: 5 } },
        { attacker: okA, defender: { ...okD, custom: { T: 4, Sv: 3, W: 1 } } },
        { attacker: okA, defender: okD, options: { method: 'guess' } },
      ];
      for (const body of cases) {
        const res = await post(base, body);
        assert.equal(res.status, 400, JSON.stringify(body));
        const j = await res.json();
        assert.equal(typeof j.error, 'string');
      }
    });
  });
});

describe('resource limits (DoS protection)', () => {
  test('keyword allowlist with bounded values', () => {
    for (const k of ['Melta 100000000', 'Rapid Fire 1000000', 'Sustained Hits 7', 'Sustained Hits 2D6', 'Anti-Infantry 1+', 'Explodes Everything']) {
      assert.ok(keywordError(k), k);
    }
    for (const k of ['Melta 2', 'Rapid Fire 6', 'Sustained Hits D3', 'Sustained Hits 6', 'Anti-Vehicle 3+', 'Assault', 'Hazardous']) {
      assert.equal(keywordError(k), null, k);
    }
    assert.throws(() => parseKeywords(['Melta 100000000']));
    assert.throws(() => parseKeywords(['Rapid Fire 1000000']));
    for (const u of UNITS) for (const w of u.weapons) for (const k of w.keywords) assert.equal(keywordError(k), null, `${u.id}/${k}`);
  });

  test('forced exact respects the work budget and falls back to Monte Carlo', () => {
    const w = { name: 'big', A: '2D6+8', skill: 2, S: 6, AP: 0, D: 'D6', keywords: ['Devastating Wounds', 'Sustained Hits 1'] };
    const r = one(w, 30, { models: 30, T: 4, Sv: 2, inv: 2, W: 40, fnp: 4 }, { options: { method: 'exact' } });
    assert.equal(r.method, 'monte-carlo');
    assert.match(r.fallbackReason, /budget/);
    assert.ok(r.trials <= MAX_TRIALS);
  });

  const W = (o) => ({ name: 'w', skill: 2, S: 4, AP: 0, ...o });
  const worst = {
    devForcedExact: { attacker: { custom: { weapons: [W({ A: '2D6+8', S: 6, D: 'D6', keywords: ['Devastating Wounds', 'Sustained Hits 1'] })] }, models: 30 },
      defender: { custom: { T: 4, Sv: 2, inv: 2, W: 40, fnp: 4 }, models: 30 }, options: { method: 'exact', trials: 20000 } },
    tenWeapons: { attacker: { custom: { weapons: Array.from({ length: 10 }, () => W({ A: '2D6', D: 'D6+2', keywords: ['Devastating Wounds'] })) }, models: 10 },
      defender: { custom: { T: 8, Sv: 2, inv: 2, W: 40, fnp: 2 }, models: 30 }, options: { method: 'exact' } },
    meltaRapidFire: { attacker: { custom: { weapons: [W({ A: '2D6+6', D: '2D6+18', S: 12, keywords: ['Melta 6', 'Rapid Fire 6', 'Blast', 'Sustained Hits 1'] })] }, models: 20, modifiers: { halfRange: true } },
      defender: { custom: { T: 30, Sv: 2, W: 40, fnp: 2 }, models: 30 }, options: { method: 'monte-carlo', trials: 20000 } },
    exactNearBudget: { attacker: { custom: { weapons: [W({ A: '4', S: 5, AP: -2, D: '2', skill: 3, keywords: ['Sustained Hits 2', 'Devastating Wounds'] })] }, models: 30 },
      defender: { custom: { T: 4, Sv: 3, W: 2 }, models: 30 } },
  };
  for (const [name, body] of Object.entries(worst)) {
    test(`worst case finishes in < 2s: ${name}`, () => {
      const input = buildSimulation(body);
      const t = performance.now();
      const r = simulate(input);
      const ms = performance.now() - t;
      assert.ok(ms < 2000, `${name} took ${ms.toFixed(0)}ms`);
      close(sum(r.killDistribution), 1, 1e-9);
    });
  }

  test('API rejects abusive keyword values and oversized volleys with 400', async () => {
    const server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}/api/combat/simulate`;
    const defender = { custom: { T: 4, Sv: 3, W: 2 }, models: 10 };
    const cases = [
      { attacker: { custom: { weapons: [W({ A: '1', D: '1', keywords: ['Melta 100000000'] })] }, models: 1, modifiers: { halfRange: true } }, defender },
      { attacker: { custom: { weapons: [W({ A: '1', D: '1', keywords: ['Rapid Fire 1000000'] })] }, models: 1, modifiers: { halfRange: true } }, defender },
      { attacker: { custom: { weapons: [W({ A: '1', D: '1', keywords: ['Sustained Hits 99'] })] }, models: 1 }, defender },
      { attacker: { custom: { weapons: [W({ A: '20', D: '1', keywords: ['Rapid Fire 6', 'Blast'] })] }, models: 30, modifiers: { halfRange: true } }, defender: { ...defender, models: 30 } },
      { attacker: { custom: { weapons: [W({ A: '20', D: '1', keywords: ['Sustained Hits 6'] })] }, models: 30 }, defender },
      { attacker: { custom: { weapons: [W({ A: '1', D: '1' })] }, models: 1 }, defender, options: { trials: 100000 } },
    ];
    try {
      for (const body of cases) {
        const res = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.equal(typeof (await res.json()).error, 'string');
      }
    } finally { await new Promise((r) => server.close(r)); }
  });
});
