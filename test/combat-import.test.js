// BSData importer/converter, the merged unit catalogue, faction listing and a
// sweep that runs the engine on every generated datasheet. No network: the
// converter is fed fixture XML and politeFetch gets a fake fetch.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseXml, convertBsdata, factionName, splitKeywords, normalizeKeyword, decodeEntities } from '../src/combat/import/bsdata.js';
import { GENERATED_UNITS, GENERATED_META } from '../src/combat/data/units.generated.js';
import { ALL_UNITS, mergeCatalog, DATA_SOURCES } from '../src/combat/data/catalog.js';
import { UNITS } from '../src/combat/data/units.js';
import { listUnits, listFactions, runSimulation, unitById } from '../src/combat/service.js';
import { keywordError, parseDice, simulate } from '../src/combat/engine.js';
import { __setFetch, __reset, getHostLimit } from '../src/shared/httpClient.js';
import { createApp } from '../src/server.js';

/* ------------------------------------------------------------ fixtures */

const GST = `<?xml version="1.0" encoding="UTF-8"?>
<gameSystem id="sys-1" name="Warhammer 40,000 10th Edition" xmlns="http://www.battlescribe.net/schema/gameSystemSchema">
  <sharedProfiles>
    <profile id="inv4" name="Invulnerable Save" typeName="Abilities"><characteristics><characteristic name="Description">4+</characteristic></characteristics></profile>
  </sharedProfiles>
  <sharedRules><rule id="fnp" name="Feel No Pain"/></sharedRules>
</gameSystem>`;

// A library defines the datasheets; the faction catalogue lists them via root entryLinks.
const LIB = `<?xml version="1.0"?>
<catalogue id="lib-1" name="Imperium - Test Legion - Library" library="true" gameSystemId="sys-1">
  <sharedSelectionEntries>
    <selectionEntry id="bolter" name="Boltgun" type="upgrade">
      <profiles><profile id="p-bolter" name="Boltgun" typeName="Ranged Weapons"><characteristics>
        <characteristic name="Range">24&quot;</characteristic><characteristic name="A">2</characteristic>
        <characteristic name="BS">3+</characteristic><characteristic name="S">4</characteristic>
        <characteristic name="AP">0</characteristic><characteristic name="D">1</characteristic>
        <characteristic name="Keywords">rapid fire 1, Twin Linked</characteristic></characteristics></profile></profiles>
    </selectionEntry>
    <selectionEntry id="squad" name="Test Squad" type="unit" hidden="false">
      <categoryLinks><categoryLink name="Infantry" targetId="c1"/><categoryLink name="Faction: Test Legion" targetId="c2"/></categoryLinks>
      <infoLinks>
        <infoLink name="Invulnerable Save" type="profile" targetId="inv4"/>
        <infoLink name="Feel No Pain" type="rule" targetId="fnp"><modifiers><modifier type="append" field="name" value="5+"/></modifiers></infoLink>
      </infoLinks>
      <selectionEntryGroups>
        <selectionEntryGroup id="g1" name="Unit Composition">
          <constraints><constraint type="min" value="1" field="selections" scope="parent"/><constraint type="max" value="1" field="selections" scope="parent"/></constraints>
          <selectionEntries>
            <selectionEntry id="opt5" name="1 Sergeant and 4 Troopers" type="upgrade">
              <selectionEntries>
                <selectionEntry id="sgt" name="Sergeant" type="model">
                  <constraints><constraint type="min" value="1" field="selections" scope="parent"/><constraint type="max" value="1" field="selections" scope="parent"/></constraints>
                  <profiles><profile id="u-sgt" name="Sergeant" typeName="Unit"><characteristics>
                    <characteristic name="M">6&quot;</characteristic><characteristic name="T">4</characteristic><characteristic name="SV">3+</characteristic>
                    <characteristic name="W">2</characteristic><characteristic name="LD">6+</characteristic><characteristic name="OC">1</characteristic></characteristics></profile></profiles>
                  <selectionEntries><selectionEntry id="fist" name="Power fist" type="upgrade"><profiles>
                    <profile id="p-fist" name="➤ Power fist" typeName="Melee Weapons"><characteristics>
                      <characteristic name="Range">Melee</characteristic><characteristic name="A">3</characteristic><characteristic name="WS">3+</characteristic>
                      <characteristic name="S">8</characteristic><characteristic name="AP">-2</characteristic><characteristic name="D">2</characteristic>
                      <characteristic name="Keywords">anti-VEHICLE 4+, Conversion</characteristic></characteristics></profile></profiles></selectionEntry></selectionEntries>
                </selectionEntry>
              </selectionEntries>
              <entryLinks>
                <entryLink id="l-tr" name="Trooper" type="selectionEntry" targetId="trooper">
                  <constraints><constraint type="min" value="4" field="selections" scope="parent"/><constraint type="max" value="4" field="selections" scope="parent"/></constraints>
                </entryLink>
              </entryLinks>
            </selectionEntry>
            <selectionEntry id="opt10" name="2 Sergeants and 8 Troopers" type="upgrade">
              <entryLinks>
                <entryLink id="l-tr2" name="Trooper" type="selectionEntry" targetId="trooper">
                  <constraints><constraint type="min" value="9" field="selections" scope="parent"/><constraint type="max" value="9" field="selections" scope="parent"/></constraints>
                </entryLink>
              </entryLinks>
              <selectionEntries><selectionEntry id="sgt2" name="Sergeant" type="model">
                <constraints><constraint type="min" value="1" field="selections" scope="parent"/><constraint type="max" value="1" field="selections" scope="parent"/></constraints>
              </selectionEntry></selectionEntries>
            </selectionEntry>
          </selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
      <entryLinks><entryLink name="Crusade" type="selectionEntryGroup" targetId="nope"/></entryLinks>
      <costs><cost name="pts" value="90"/></costs>
    </selectionEntry>
    <selectionEntry id="trooper" name="Trooper" type="model">
      <profiles><profile id="u-tr" name="Trooper" typeName="Unit"><characteristics>
        <characteristic name="M">6&quot;</characteristic><characteristic name="T">4</characteristic><characteristic name="SV">4+</characteristic>
        <characteristic name="W">1</characteristic><characteristic name="LD">7+</characteristic><characteristic name="OC">2</characteristic></characteristics></profile></profiles>
      <entryLinks><entryLink id="l-b" name="Boltgun" type="selectionEntry" targetId="bolter"/></entryLinks>
    </selectionEntry>
    <selectionEntry id="weird" name="Weird Gun Platform" type="model">
      <profiles>
        <profile id="u-w" name="Weird" typeName="Unit"><characteristics><characteristic name="M">-</characteristic><characteristic name="T">9</characteristic>
          <characteristic name="SV">3+</characteristic><characteristic name="W">10</characteristic><characteristic name="LD">7+</characteristic><characteristic name="OC">0</characteristic></characteristics></profile>
        <profile id="p-w" name="Wobbly gun" typeName="Ranged Weapons"><characteristics><characteristic name="Range">36&quot;</characteristic>
          <characteristic name="A">D6+D3</characteristic><characteristic name="BS">4+</characteristic><characteristic name="S">12</characteristic>
          <characteristic name="AP">-3</characteristic><characteristic name="D">6</characteristic><characteristic name="Keywords">-</characteristic></characteristics></profile>
      </profiles>
    </selectionEntry>
    <selectionEntry id="broken" name="No Stats" type="unit"/>
  </sharedSelectionEntries>
</catalogue>`;

const FACTION = `<?xml version="1.0"?>
<catalogue id="cat-1" name="Imperium - Test Legion" library="false" gameSystemId="sys-1">
  <catalogueLinks><catalogueLink targetId="lib-1" importRootEntries="true"/></catalogueLinks>
  <entryLinks>
    <entryLink id="r1" name="Test Squad" type="selectionEntry" targetId="squad"/>
    <entryLink id="r2" name="Weird Gun Platform" type="selectionEntry" targetId="weird"/>
    <entryLink id="r3" name="No Stats" type="selectionEntry" targetId="broken"/>
  </entryLinks>
</catalogue>`;

const files = () => [['Warhammer 40,000.gst', GST], ['Lib.cat', LIB], ['Faction.cat', FACTION]]
  .map(([file, xml]) => ({ file, doc: parseXml(xml) }));

/* ------------------------------------------------------------ converter */

describe('BSData converter', () => {
  test('XML parser handles entities, self-closing tags and nesting', () => {
    const doc = parseXml('<?xml version="1.0"?><a x="1 &amp; 2"><b/><c>T&apos;au &#x2014; &quot;x&quot;</c><!-- note --></a>');
    assert.equal(doc.name, 'a');
    assert.equal(doc.attrs.x, '1 & 2');
    assert.deepEqual(doc.children.map((c) => c.name), ['b', 'c']);
    assert.equal(doc.children[1].text, 'T\'au — "x"');
    assert.equal(decodeEntities('&lt;&gt;&#65;'), '<>A');
  });

  test('faction names drop catalogue prefixes', () => {
    assert.equal(factionName('Imperium - Adeptus Astartes - Blood Angels'), 'Blood Angels');
    assert.equal(factionName('Xenos - T\'au Empire'), 'T\'au Empire');
    assert.equal(factionName('Chaos - Daemons Library'), 'Chaos Daemons');
    assert.equal(factionName('Imperium - Astra Militarum - Library'), 'Astra Militarum');
    assert.equal(factionName('Library - Tyranids'), 'Tyranids');
  });

  test('weapon keywords: normalised, engine-supported ones kept, the rest set aside', () => {
    assert.equal(normalizeKeyword('anti-VEHICLE 4+'), 'Anti-Vehicle 4+');
    assert.equal(normalizeKeyword('Twin Linked'), 'Twin-linked');
    assert.deepEqual(splitKeywords('Rapid Fire D3, Lethal hits, -, Conversion'), { keywords: ['Lethal Hits'], other: ['Rapid Fire D3', 'Conversion'] });
  });

  test('converts a library-backed datasheet with composition options, links, invuln and FNP', () => {
    const { units, report } = convertBsdata(files());
    const squad = units.find((u) => u.name === 'Test Squad');
    assert.ok(squad, 'unit converted');
    assert.equal(squad.faction, 'Test Legion', 'attributed to the catalogue that lists it, not the library');
    assert.deepEqual(squad.models, { min: 5, max: 10, default: 5 }, '"pick one" composition options are alternatives');
    // Stat line of the most numerous model (Trooper), not the Sergeant.
    assert.deepEqual(squad.profile, { M: 6, T: 4, Sv: 4, W: 1, Ld: 7, OC: 2, inv: 4, fnp: 5 });
    assert.equal(squad.points, 90);
    assert.deepEqual(squad.keywords, ['Infantry', 'Test Legion']);
    const bolter = squad.weapons.find((w) => w.id === 'boltgun');
    assert.deepEqual({ ...bolter }, { id: 'boltgun', name: 'Boltgun', type: 'ranged', range: 24, A: '2', skill: 3, S: 4, AP: 0, D: '1',
      keywords: ['Rapid Fire 1', 'Twin-linked'], carriers: 9 });
    const fist = squad.weapons.find((w) => w.id === 'power-fist');
    assert.equal(fist.name, 'Power fist', 'BattleScribe arrows are stripped');
    assert.deepEqual(fist.keywords, ['Anti-Vehicle 4+']);
    assert.deepEqual(fist.otherKeywords, ['Conversion']);
    assert.equal(squad.weapons[0].type, 'ranged', 'ranged weapons listed first');

    const weird = units.find((u) => u.name === 'Weird Gun Platform');
    assert.equal(weird.profile.M, null, '"-" movement becomes null');
    assert.equal(weird.weapons.length, 0, 'un-simulatable dice dropped, datasheet kept as a target');
    assert.equal(report.weaponsDropped, 1);
    assert.ok(report.skipped.some((s) => s.name === 'No Stats' && /Unit profile/.test(s.reason)));
    assert.equal(report.converted, 2);
  });
});

/* ------------------------------------------------------------ importer download */

describe('importer download', () => {
  beforeEach(() => { __reset(); });

  test('fetches the catalogues one by one through politeFetch with a small budget', async () => {
    process.env.SKIP_ROBOTS = '1';
    const { download, BSDATA_HOST, BSDATA_LIMIT } = await import('../scripts/import-units.js');
    const seen = [];
    __setFetch(async (url) => { seen.push(url); return new Response('<catalogue id="x" name="X"/>', { status: 200 }); });
    assert.ok(BSDATA_LIMIT.requestsPerMinute <= 10 && BSDATA_LIMIT.maxConcurrent === 1, 'no published limit: at most 10 req/min, one at a time');
    const out = await download('abc123', ['Orks.cat', "T'au Empire.cat"], { hostLimit: { requestsPerMinute: 6000, burst: 10 } });
    assert.equal(out.length, 2);
    assert.deepEqual(seen, [
      `https://${BSDATA_HOST}/BSData/wh40k-10e/abc123/Orks.cat`,
      `https://${BSDATA_HOST}/BSData/wh40k-10e/abc123/T'au%20Empire.cat`,
    ]);
    assert.equal(getHostLimit(BSDATA_HOST).requestsPerMinute, 6000);
    delete process.env.SKIP_ROBOTS;
  });
});

/* ------------------------------------------------------------ catalogue */

describe('unit catalogue (seed + BSData)', () => {
  test('covers 1000+ datasheets across every faction, with unique ids', () => {
    assert.ok(GENERATED_UNITS.length >= 1000, `only ${GENERATED_UNITS.length} generated units`);
    assert.equal(GENERATED_META.units, GENERATED_UNITS.length);
    assert.ok(ALL_UNITS.length >= 1000);
    const ids = new Set();
    for (const u of ALL_UNITS) {
      assert.match(u.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, u.id);
      assert.ok(!ids.has(u.id), `duplicate id ${u.id}`);
      ids.add(u.id);
    }
    const factions = new Set(listFactions(ALL_UNITS).map((f) => f.name));
    for (const f of ['Space Marines', 'Blood Angels', 'Dark Angels', 'Space Wolves', 'Black Templars', 'Deathwatch',
      'Chaos Space Marines', 'Death Guard', 'Thousand Sons', 'World Eaters', "Emperor's Children", 'Chaos Daemons', 'Chaos Knights',
      'Astra Militarum', 'Adeptus Custodes', 'Grey Knights', 'Adepta Sororitas', 'Adeptus Mechanicus', 'Imperial Knights',
      'Agents of the Imperium', 'Orks', 'Necrons', 'Tyranids', 'Genestealer Cults', "T'au Empire", 'Aeldari', 'Drukhari',
      'Leagues of Votann']) {
      assert.ok(factions.has(f), `missing faction ${f}`);
      assert.ok(listFactions(ALL_UNITS).find((x) => x.name === f).units >= 10 || ['Deathwatch'].includes(f), `${f} has few units`);
    }
  });

  test('hand-curated seed entries win over imported duplicates', () => {
    const merged = mergeCatalog(
      [{ id: 'boyz', name: 'Ork Boyz', faction: 'Orks', aliases: ['boyz'] }],
      [{ id: 'boyz', name: 'Boyz', faction: 'Orks' }, { id: 'boyz', name: 'Boyz', faction: 'Space Marines' }, { id: 'gretchin', name: 'Gretchin', faction: 'Orks' }],
    );
    assert.deepEqual(merged.map((u) => u.id), ['boyz', 'space-marines-boyz', 'gretchin']);
    // Real data: the seed Intercessor Squad (with aliases) is the only one in Space Marines.
    const inter = ALL_UNITS.filter((u) => u.faction === 'Space Marines' && u.name === 'Intercessor Squad');
    assert.equal(inter.length, 1);
    assert.ok(inter[0].aliases.includes('intercessors'));
    assert.equal(ALL_UNITS.slice(0, UNITS.length).every((u, i) => u === UNITS[i]), true);
  });

  test('data sources are credited', () => {
    const bs = DATA_SOURCES.find((s) => s.id === 'bsdata');
    assert.match(bs.url, /github\.com\/BSData\/wh40k-10e/);
    assert.match(bs.licence, /not affiliated/i);
  });

  test('every generated datasheet passes validation', () => {
    for (const u of GENERATED_UNITS) {
      const tag = `${u.faction}/${u.id}`;
      assert.ok(u.name && u.faction && Array.isArray(u.keywords), tag);
      const { min, max, default: d } = u.models;
      assert.ok(Number.isInteger(min) && min >= 1 && min <= d && d <= max && max <= 30, `${tag} models`);
      const p = u.profile;
      assert.ok(p.T >= 1 && p.T <= 30 && p.Sv >= 2 && p.Sv <= 7 && p.W >= 1 && p.W <= 120, `${tag} profile`);
      for (const k of ['M', 'Ld', 'OC']) assert.ok(p[k] === null || Number.isInteger(p[k]), `${tag}.${k}`);
      assert.ok(p.inv === null || (p.inv >= 2 && p.inv <= 6), `${tag} inv`);
      assert.ok(p.fnp === null || (p.fnp >= 2 && p.fnp <= 6), `${tag} fnp`);
      const wids = new Set();
      for (const w of u.weapons) {
        assert.ok(!wids.has(w.id), `${tag}: duplicate weapon ${w.id}`);
        wids.add(w.id);
        assert.ok(['ranged', 'melee'].includes(w.type), `${tag}/${w.id} type`);
        for (const k of w.keywords) assert.equal(keywordError(k), null, `${tag}/${w.id}: ${k}`);
        assert.ok(parseDice(w.A).max <= 40 && parseDice(w.D).max <= 30, `${tag}/${w.id} dice`);
        assert.ok(w.S >= 1 && w.S <= 30 && w.AP <= 0 && w.AP >= -6, `${tag}/${w.id} S/AP`);
        const torrent = w.keywords.includes('Torrent');
        assert.ok(torrent ? w.skill === null : w.skill >= 2 && w.skill <= 6, `${tag}/${w.id} skill`);
        assert.ok(w.carriers >= 1 && w.carriers <= max, `${tag}/${w.id} carriers`);
      }
    }
    assert.ok(GENERATED_UNITS.filter((u) => u.weapons.length).length >= 1000);
  });

  test('the engine runs on every datasheet as attacker and as defender', () => {
    const bolter = { name: 'Bolt rifle', type: 'ranged', A: '2', skill: 3, S: 4, AP: -1, D: '1', keywords: [], models: 5 };
    const opts = { method: 'monte-carlo', trials: 1000, seed: 7 };
    for (const u of ALL_UNITS) {
      const p = u.profile;
      const defender = { name: u.name, models: u.models.min, T: p.T, Sv: p.Sv, inv: p.inv, W: p.W, fnp: p.fnp, keywords: u.keywords };
      const asDef = simulate({ attacker: { weapons: [bolter] }, defender, options: opts });
      assert.ok(Number.isFinite(asDef.expected.damage), `${u.id} as defender`);
      // Each weapon via the validated service path (the same one the API uses).
      for (const w of u.weapons.slice(0, 3)) {
        const r = runSimulation({
          attacker: { unitId: u.id, models: u.models.min, weapons: [{ id: w.id, models: Math.min(u.models.min, w.carriers ?? u.models.min) }] },
          defender: { custom: { T: 5, Sv: 3, W: 3, keywords: ['Infantry'] }, models: 5 },
          options: { method: 'monte-carlo', trials: 1000 },
        }, ALL_UNITS);
        assert.ok(r.expected.attacks > 0 && Number.isFinite(r.pWipe), `${u.id}/${w.id}`);
      }
    }
  });
});

/* ------------------------------------------------------------ faction API */

describe('faction listing and filtering', () => {
  test('listFactions counts units; listUnits filters by faction (case-insensitive) and query', () => {
    const f = listFactions(ALL_UNITS);
    assert.deepEqual(f.map((x) => x.name), [...f.map((x) => x.name)].sort((a, b) => a.localeCompare(b)));
    assert.equal(f.reduce((s, x) => s + x.units, 0), ALL_UNITS.length);
    const orks = listUnits(ALL_UNITS, '', 'orks');
    assert.ok(orks.length >= 30 && orks.every((u) => u.faction === 'Orks'));
    const tau = listUnits(ALL_UNITS, 'crisis', "t'au empire");
    assert.ok(tau.length && tau.every((u) => u.faction === "T'au Empire"));
    assert.deepEqual(listUnits(ALL_UNITS, '', 'Not A Faction'), []);
    const brief = listUnits(ALL_UNITS, 'boyz', 'Orks', { view: 'brief' })[0];
    assert.deepEqual(Object.keys(brief).sort().filter((k) => !['aliases', 'points'].includes(k)), ['faction', 'id', 'models', 'name']);
  });

  test('fuzzy id lookup stays confident with 1000+ units', () => {
    assert.equal(unitById('nope', ALL_UNITS), null);
    assert.equal(unitById('intersessors', ALL_UNITS)?.id, 'intercessor-squad');
    assert.equal(unitById('primaris-terminators', ALL_UNITS)?.id, 'terminator-squad');
  });

  test('GET /api/combat/factions and /units?faction=&view=brief', async () => {
    const server = createApp().listen(0);
    const base = `http://127.0.0.1:${server.address().port}/api/combat`;
    try {
      const fac = await (await fetch(`${base}/factions`)).json();
      assert.ok(fac.factions.length >= 25);
      assert.ok(fac.sources.some((s) => s.id === 'bsdata'));
      const list = await (await fetch(`${base}/units?faction=Necrons&view=brief`)).json();
      assert.ok(list.units.length >= 30 && list.units.every((u) => u.faction === 'Necrons' && !u.weapons));
      const warriors = await (await fetch(`${base}/units?faction=Necrons&q=warriors`)).json();
      assert.equal(warriors.units[0].name, 'Necron Warriors');
    } finally { server.close(); }
  });

  test('search stays fast with the full catalogue', () => {
    const t = performance.now();
    for (const q of ['termies', 'hellblasters', 'leman russ', 'nec warr', 'crisis suits', 'boyz', 'x']) listUnits(ALL_UNITS, q);
    assert.ok(performance.now() - t < 1500, 'seven searches in well under 1.5s');
  });
});
