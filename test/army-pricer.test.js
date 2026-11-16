// Army list pricer: parsing the official app, BattleScribe, New Recruit (WTC)
// and plain-text lists, datasheet -> kit mapping, boxes, owned kits and the plan.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { __setFetch, __reset } from '../src/shared/httpClient.js';
import { parseArmyList, parseHead, armyItems, armyPayload, armyRequestError, kitForUnit } from '../src/price/army.js';
import { buildDemoSnapshot } from '../src/price/snapshot.js';
import { buildOverview } from '../src/price/overview.js';
import { __resetSearchLimiter } from '../src/price/routes.js';
import { __resetSnapshotCache } from '../src/price/snapshotStore.js';
import { createApp } from '../src/server.js';
import { WARHAMMER_APP, BATTLESCRIBE, NEW_RECRUIT_WTC, PLAIN } from './fixtures/army-lists.js';

beforeEach(() => {
  __reset(); __resetSearchLimiter(); __resetSnapshotCache();
  __setFetch(async (u) => { throw new Error(`unexpected network call in test: ${u}`); });
});
after(() => __reset());

const byUnit = (r) => Object.fromEntries(r.lines.map((l) => [l.unitId, l]));
const items = (r) => Object.fromEntries(r.items.map((i) => [i.productId, i.qty]));

test('parseHead: counts, points, wargear and decorations', () => {
  assert.deepEqual(parseHead('10x Intercessor Squad'), { name: 'Intercessor Squad', qty: 10, points: null });
  assert.deepEqual(parseHead('3 Hellblasters'), { name: 'Hellblasters', qty: 3, points: null });
  assert.deepEqual(parseHead('Necron Warriors (20)'), { name: 'Necron Warriors', qty: 20, points: null });
  assert.deepEqual(parseHead('Necron Warriors x20'), { name: 'Necron Warriors', qty: 20, points: null });
  assert.deepEqual(parseHead('2 x Redemptor Dreadnought'), { name: 'Redemptor Dreadnought', qty: 2, points: null });
  assert.deepEqual(parseHead('Char1: 1x Overlord (85 pts): Warlord, Resurrection Orb'), { name: 'Overlord', qty: 1, points: 85 });
  assert.deepEqual(parseHead('Intercessor Squad [160pts]:'), { name: 'Intercessor Squad', qty: null, points: 160 });
  assert.deepEqual(parseHead('Captain in Terminator Armour (95 points)'), { name: 'Captain in Terminator Armour', qty: null, points: 95 });
  assert.deepEqual(parseHead('Hellblaster Squad (10 models) [230pts]'), { name: 'Hellblaster Squad', qty: 10, points: 230 });
});

test('official Warhammer app export: model lines summed, wargear ignored, title skipped', () => {
  const r = armyItems(WARHAMMER_APP);
  assert.equal(r.format, 'warhammer-app');
  assert.ok(r.factions.includes('Space Marines'));
  assert.deepEqual(r.unmatched, [], 'army title and battle size are not units');
  assert.equal(r.lines.length, 7);
  const intercessors = r.lines.filter((l) => l.unitId === 'intercessor-squad').map((l) => l.qty);
  assert.deepEqual(intercessors, [10, 5]);
  assert.equal(byUnit(r)['hellblaster-squad'].qty, 5);
  assert.equal(byUnit(r)['captain-in-terminator-armour'].qty, 1, 'single-model unit: wargear bullets are not models');
  assert.equal(byUnit(r)['captain-in-terminator-armour'].productId, 'space-marines-captain-in-terminator-armour');
  // 15 Intercessors -> two 10-model boxes (pooled across both squads).
  assert.deepEqual(items(r), {
    'space-marines-captain-in-terminator-armour': 1, 'space-marines-lieutenant': 1, 'space-marines-intercessors': 2,
    'space-marines-hellblasters': 1, 'space-marines-redemptor-dreadnought': 1, 'space-marines-gladiator-lancer': 1,
  });
});

test('BattleScribe text export: ". 20x Necron Warrior" selections, unknown datasheet reported', () => {
  const r = armyItems(BATTLESCRIBE);
  assert.equal(r.format, 'battlescribe');
  assert.deepEqual(r.factions, ['Necrons']);
  assert.deepEqual(r.unmatched, ['Some Forge World Thing [100pts]: Weird gun']);
  assert.deepEqual(r.lines.filter((l) => l.unitId === 'necron-warriors').map((l) => l.qty), [20, 10]);
  assert.equal(byUnit(r)['doomsday-ark'].productId, 'necrons-ghost-ark', 'one box builds the Ghost Ark or the Doomsday Ark');
  assert.equal(byUnit(r).immortals.modelsPerBox, null);
  assert.match(byUnit(r).immortals.note, /box contents unknown/);
  assert.equal(items(r)['necron-warriors'], 3, '30 Warriors -> three 10-model boxes');
});

test('New Recruit WTC compact export', () => {
  const r = armyItems(NEW_RECRUIT_WTC);
  assert.equal(r.format, 'newrecruit-wtc');
  assert.deepEqual(r.factions, ['Orks']);
  assert.deepEqual(r.unmatched, []);
  assert.deepEqual(r.lines.map((l) => [l.unitId, l.qty]), [['warboss', 1], ['weirdboy', 1], ['ork-boyz', 20], ['ork-boyz', 10],
    ['nobz', 5], ['battlewagon', 1], ['deffkoptas', 3]]);
  assert.equal(items(r)['ork-boyz'], 3);
  assert.equal(r.lines[2].points, 170);
});

test('plain lines: counts are models, small counts are units, nicknames resolve, junk unmatched', () => {
  const r = armyItems(PLAIN);
  assert.equal(r.format, 'plain');
  const l = byUnit(r);
  assert.equal(l['intercessor-squad'].boxes, 1);
  assert.equal(l['hellblaster-squad'].qty, 15);
  assert.match(l['hellblaster-squad'].note, /3 units of 5/);
  assert.equal(l['necron-warriors'].boxes, 2);
  assert.equal(l['redemptor-dreadnought'].boxes, 2);
  assert.equal(l['terminator-squad'].productId, 'space-marines-terminators');
  assert.match(l.gretchin.note, /assumed/);
  assert.deepEqual(r.unmatched, ['Flibbertigibbet Squad']);
  assert.equal(parseArmyList('').entries.length, 0);
});

test('owned boxes are subtracted; plan + totals use the cart optimizer', () => {
  const ov = buildOverview(buildDemoSnapshot({ now: Date.parse('2026-11-16T12:00:00Z') }));
  const r = armyPayload(ov, PLAIN, { 'space-marines-hellblasters': 1, 'necron-warriors': 5 });
  assert.equal(items(r)['space-marines-hellblasters'], 1);
  assert.equal(items(r)['necron-warriors'], undefined, 'already own enough');
  assert.deepEqual(r.owned, { 'space-marines-hellblasters': 1, 'necron-warriors': 2 });
  for (const k of ['plan', 'total', 'unavailable', 'comparisons', 'goods']) assert.ok(k in r.plan, k);
  assert.ok(r.plan.total > 0);
  assert.equal(r.totals.best, r.plan.goods);
  assert.ok(r.totals.rrp > r.totals.best && r.totals.savings > 0);
  const planned = r.plan.plan.flatMap((g) => g.items).reduce((t, it) => t + it.qty, 0)
    + r.plan.unavailable.reduce((t, it) => t + it.qty, 0);
  assert.equal(planned, r.items.reduce((t, it) => t + it.qty, 0));
  assert.equal(kitForUnit('nope'), null);
  assert.equal(armyRequestError({}), '"list" must be the army list as text');
  assert.match(armyRequestError({ list: 'x'.repeat(20_001) }), /at most/);
  assert.match(armyRequestError({ list: 'x', owned: [] }), /owned/);
  assert.equal(armyRequestError({ list: '10 boyz' }), null);
});

test('route: POST /api/prices/army', async () => {
  __reset();
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}/api/prices/army`;
  const post = (body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ demo: true })).status, 400);
    const r = await (await post({ demo: true, list: NEW_RECRUIT_WTC, owned: { 'orks-nobz': 1 } })).json();
    for (const k of ['lines', 'unmatched', 'items', 'plan', 'totals']) assert.ok(k in r, k);
    for (const l of r.lines) for (const k of ['raw', 'qty', 'unitName', 'unitId', 'productId', 'boxes', 'modelsPerBox', 'note']) assert.ok(k in l, k);
    assert.equal(items(r)['orks-nobz'], undefined);
    assert.ok(r.plan.total > 0);
  } finally { await new Promise((r) => server.close(r)); }
});
