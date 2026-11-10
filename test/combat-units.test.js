import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { keywordError, parseDice } from '../src/combat/engine.js';
import { runSimulation } from '../src/combat/service.js';
import { UNITS, findUnits } from '../src/combat/data/units.js';

const FACTIONS = [
  'Space Marines', 'Blood Angels', 'Dark Angels', 'Space Wolves',
  'Chaos Space Marines', 'Death Guard', 'Thousand Sons', 'World Eaters',
  'Astra Militarum', 'Adeptus Custodes', 'Grey Knights', 'Adepta Sororitas', 'Adeptus Mechanicus',
  'Imperial Knights', 'Chaos Knights', 'Chaos Daemons',
  'Orks', 'Necrons', 'Tyranids', 'Genestealer Cults', "T'au Empire", 'Aeldari', 'Drukhari', 'Leagues of Votann',
];

describe('unit catalogue', () => {
  test('has at least 80 units with unique kebab-case ids', () => {
    assert.ok(UNITS.length >= 80, `only ${UNITS.length} units`);
    const ids = new Set();
    for (const u of UNITS) {
      assert.match(u.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, u.id);
      assert.ok(!ids.has(u.id), `duplicate id ${u.id}`);
      ids.add(u.id);
    }
  });

  test('aliases are lower-case and unique across units', () => {
    const seen = new Map();
    for (const u of UNITS) {
      assert.ok(Array.isArray(u.aliases) && u.aliases.length, `${u.id} has no aliases`);
      for (const a of u.aliases) {
        assert.equal(a, a.toLowerCase().trim(), `${u.id}: alias "${a}" not lower-case`);
        assert.ok(!seen.has(a), `alias "${a}" used by ${seen.get(a)} and ${u.id}`);
        seen.set(a, u.id);
      }
    }
  });

  test('every major faction is present', () => {
    const present = new Set(UNITS.map((u) => u.faction));
    for (const f of FACTIONS) assert.ok(present.has(f), `missing faction ${f}`);
  });

  test('units follow the datasheet shape', () => {
    for (const u of UNITS) {
      assert.ok(u.name && u.faction && Array.isArray(u.keywords), u.id);
      const { min, max, default: dflt } = u.models;
      assert.ok(min >= 1 && min <= dflt && dflt <= max && max <= 30, `${u.id} models`);
      for (const k of ['M', 'T', 'Sv', 'W', 'Ld', 'OC']) assert.ok(Number.isInteger(u.profile[k]), `${u.id}.${k}`);
      assert.ok('inv' in u.profile && 'fnp' in u.profile, `${u.id} inv/fnp`);
      assert.ok(u.weapons.length, `${u.id} has no weapons`);
      const wids = new Set();
      for (const w of u.weapons) {
        assert.ok(!wids.has(w.id), `${u.id}: duplicate weapon id ${w.id}`);
        wids.add(w.id);
        assert.ok(['ranged', 'melee'].includes(w.type), `${u.id}/${w.id} type`);
        assert.ok(w.type === 'ranged' ? typeof w.range === 'number' : w.range === 'Melee', `${u.id}/${w.id} range`);
      }
    }
  });

  test('weapon keywords pass the allowlist and dice expressions parse', () => {
    for (const u of UNITS) {
      for (const w of u.weapons) {
        for (const k of w.keywords) assert.equal(keywordError(k), null, `${u.id}/${w.id}: ${k}`);
        assert.doesNotThrow(() => parseDice(w.A), `${u.id}/${w.id} A`);
        assert.doesNotThrow(() => parseDice(w.D), `${u.id}/${w.id} D`);
        const torrent = w.keywords.some((k) => k.toLowerCase() === 'torrent');
        assert.ok(torrent ? w.skill === null : Number.isInteger(w.skill), `${u.id}/${w.id} skill`);
      }
    }
  });

  test('nickname aliases find the right units', () => {
    const cases = {
      termies: 'terminator-squad', 'primaris terminators': 'terminator-squad', intercessors: 'intercessor-squad',
      gaunts: 'termagants', hormies: 'hormagaunts', 'crisis suits': 'crisis-battlesuits', lootas: 'lootas',
      custodes: 'custodian-guard', 'leman russ': 'leman-russ-battle-tank', 'land raider': 'land-raider',
      carnifex: 'carnifex', fexes: 'carnifex',
    };
    for (const [q, id] of Object.entries(cases)) assert.equal(findUnits(UNITS, q)[0]?.id, id, q);
  });

  test('every unit/weapon simulates against 5 Terminators', () => {
    const start = Date.now();
    let runs = 0;
    for (const u of UNITS) {
      for (const w of u.weapons) {
        const r = runSimulation({
          attacker: { unitId: u.id, models: u.models.default, weaponIds: [w.id] },
          defender: { unitId: 'terminator-squad', models: 5 },
          options: { trials: 2000 },
        }, UNITS);
        for (const [k, v] of Object.entries(r.expected)) assert.ok(Number.isFinite(v), `${u.id}/${w.id}: ${k}=${v}`);
        assert.ok(r.expected.modelsKilled >= 0 && r.expected.modelsKilled <= 5, `${u.id}/${w.id} kills`);
        runs++;
      }
    }
    const ms = Date.now() - start;
    assert.ok(ms < 30_000, `took ${ms} ms for ${runs} simulations`);
  });
});
