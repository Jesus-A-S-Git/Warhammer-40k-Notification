// Catalogue depth: every faction's common kits, linked to combat datasheets, with
// no invented prices. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, FACTIONS, productById, linkUnits } from '../src/price/catalog.js';
import { KITS } from '../src/price/kits.js';
import { ALL_UNITS } from '../src/combat/data/catalog.js';
import { findMsrp, productIdForTitle } from '../src/price/msrp.js';

const UNIT_IDS = new Set(ALL_UNITS.map((u) => u.id));

test('catalogue: several hundred products, every army has unit kits', () => {
  assert.ok(CATALOG.length >= 500, `${CATALOG.length} products`);
  const kits = CATALOG.filter((e) => e.category === 'kit');
  assert.ok(kits.length >= 450, `${kits.length} unit kits`);
  for (const f of FACTIONS.filter((x) => !['multi', 'hobby'].includes(x.id))) {
    const n = kits.filter((e) => e.faction === f.id).length;
    assert.ok(n >= 4, `${f.id} has ${n} kits`);
  }
});

test('catalogue: every unit kit builds at least one real datasheet; links stay inside the army family', () => {
  for (const e of CATALOG.filter((x) => x.category === 'kit')) {
    assert.ok(e.units.length >= 1, `${e.id} links no datasheet`);
    for (const u of e.units) assert.ok(UNIT_IDS.has(u), `${e.id}: unknown unit ${u}`);
  }
  const unitsOf = (id) => productById(id).units;
  assert.ok(unitsOf('space-marines-intercessors').includes('intercessor-squad'));
  assert.ok(unitsOf('necron-lychguard').includes('triarch-praetorians'), 'one box builds either');
  assert.ok(unitsOf('space-marines-infiltrator-squad').includes('incursor-squad'));
  assert.ok(unitsOf('chaos-space-marines-rhino').length >= 4, 'the Chaos Rhino serves every legion');
  assert.deepEqual(linkUnits('necrons', ['Rhino']), [], 'no cross-army links');
  // Each declared datasheet name resolves (catches typos in kits.js).
  for (const [faction, rows] of Object.entries(KITS)) {
    for (const [kit, , o = {}] of rows) {
      for (const n of [...(o.units ?? [kit]), ...(o.also ?? [])]) {
        assert.ok(linkUnits(faction, [n]).length, `${faction}: datasheet "${n}" not found`);
      }
    }
  }
});

test('catalogue: unpriced kits claim no price; each product name maps to itself; store titles map', () => {
  for (const [, rows] of Object.entries(KITS)) assert.ok(rows.length);
  const unpriced = CATALOG.filter((e) => e.USD == null);
  assert.ok(unpriced.length >= 400);
  for (const e of unpriced) assert.ok(e.GBP == null && e.EUR == null && e.conf == null, e.id);
  for (const e of CATALOG) assert.equal(findMsrp(e.name)?.id, e.id, e.name);
  const cases = {
    'Warhammer 40K: Necrons - Immortals': 'necrons-immortals',
    'Space Marines Heavy Intercessors': 'space-marines-heavy-intercessor-squad',
    'Chaos Space Marines: Chaos Rhino': 'chaos-space-marines-rhino',
    'Orks: Deff Dread': 'orks-deff-dreadnought',
    'Leagues of Votann: Hearthkyn Warriors': 'leagues-of-votann-hearthkyn-warriors',
    'Space Marines Captain in Terminator Armour': 'space-marines-captain-in-terminator-armour',
    'Space Marines: Captain': 'space-marines-captain',
  };
  for (const [title, id] of Object.entries(cases)) assert.equal(productIdForTitle(title), id, title);
  assert.equal(productIdForTitle('Necrons: Overlord with Translocation Shroud (used)'), null);
});
