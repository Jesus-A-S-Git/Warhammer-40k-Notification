// Curated seed datasheets for the combat calculator.
//
// NOTE: values are transcribed from memory of 10th-edition datasheets and are
// a convenience starter set only. Points, profiles and keywords change with
// codexes and balance dataslates: verify against the current official
// datasheets / Munitorum Field Manual / balance updates before relying on them.
// Every unit also supports a fully custom profile in the UI/API.
//
// Shapes:
//   profile: { M, T, Sv, inv, W, Ld, OC, fnp }  (Sv/inv/Ld as the number before "+")
//   weapon:  { id, name, type: 'ranged'|'melee', range, A, skill, S, AP, D, keywords[] }
//            A and D are strings so dice expressions ("D6", "D6+1") are allowed.

const ccw = (skill, S = 4, A = '3') => ({
  id: 'close-combat-weapon', name: 'Close combat weapon', type: 'melee', range: 'Melee',
  A, skill, S, AP: 0, D: '1', keywords: [],
});

export const UNITS = [
  {
    id: 'intercessor-squad', name: 'Intercessor Squad', faction: 'Space Marines',
    aliases: ['primaris intercessors', 'intercessors', 'primaris marines', 'bolt rifle marines'],
    keywords: ['Infantry', 'Imperium', 'Adeptus Astartes', 'Tacticus', 'Grenades', 'Battleline'],
    models: { min: 5, max: 10, default: 10 },
    profile: { M: 6, T: 4, Sv: 3, inv: null, W: 2, Ld: 6, OC: 2, fnp: null },
    weapons: [
      { id: 'bolt-rifle', name: 'Bolt rifle', type: 'ranged', range: 24, A: '2', skill: 3, S: 4, AP: -1, D: '1', keywords: ['Assault', 'Heavy'] },
      { id: 'auto-bolt-rifle', name: 'Auto bolt rifle', type: 'ranged', range: 24, A: '3', skill: 3, S: 4, AP: 0, D: '1', keywords: ['Assault', 'Sustained Hits 2'] },
      { id: 'stalker-bolt-rifle', name: 'Stalker bolt rifle', type: 'ranged', range: 36, A: '1', skill: 3, S: 5, AP: -2, D: '2', keywords: ['Heavy', 'Precision'] },
      { id: 'bolt-pistol', name: 'Bolt pistol', type: 'ranged', range: 12, A: '1', skill: 3, S: 4, AP: 0, D: '1', keywords: ['Pistol'] },
      ccw(3, 4, '3'),
      { id: 'power-fist', name: 'Power fist (Sergeant)', type: 'melee', range: 'Melee', A: '3', skill: 3, S: 8, AP: -2, D: '2', keywords: [] },
    ],
  },
  {
    id: 'assault-intercessor-squad', name: 'Assault Intercessor Squad', faction: 'Space Marines',
    aliases: ['assault intercessors', 'chainsword marines'],
    keywords: ['Infantry', 'Imperium', 'Adeptus Astartes', 'Tacticus', 'Grenades', 'Battleline'],
    models: { min: 5, max: 10, default: 10 },
    profile: { M: 6, T: 4, Sv: 3, inv: null, W: 2, Ld: 6, OC: 2, fnp: null },
    weapons: [
      { id: 'heavy-bolt-pistol', name: 'Heavy bolt pistol', type: 'ranged', range: 18, A: '1', skill: 3, S: 4, AP: -1, D: '1', keywords: ['Pistol'] },
      { id: 'astartes-chainsword', name: 'Astartes chainsword', type: 'melee', range: 'Melee', A: '4', skill: 3, S: 4, AP: -1, D: '1', keywords: [] },
      { id: 'thunder-hammer', name: 'Thunder hammer (Sergeant)', type: 'melee', range: 'Melee', A: '3', skill: 4, S: 8, AP: -2, D: '2', keywords: ['Devastating Wounds'] },
    ],
  },
  {
    id: 'hellblaster-squad', name: 'Hellblaster Squad', faction: 'Space Marines',
    aliases: ['hellblasters', 'plasma marines'],
    keywords: ['Infantry', 'Imperium', 'Adeptus Astartes', 'Grenades'],
    models: { min: 5, max: 10, default: 5 },
    profile: { M: 6, T: 4, Sv: 3, inv: null, W: 2, Ld: 6, OC: 1, fnp: null },
    weapons: [
      { id: 'plasma-incinerator-standard', name: 'Plasma incinerator (standard)', type: 'ranged', range: 24, A: '2', skill: 3, S: 7, AP: -2, D: '1', keywords: ['Assault', 'Heavy'] },
      { id: 'plasma-incinerator-supercharge', name: 'Plasma incinerator (supercharge)', type: 'ranged', range: 24, A: '2', skill: 3, S: 8, AP: -3, D: '2', keywords: ['Assault', 'Heavy', 'Hazardous'] },
      ccw(3, 4, '3'),
    ],
  },
  {
    id: 'terminator-squad', name: 'Terminator Squad', faction: 'Space Marines',
    aliases: ['terminators', 'primaris terminators', 'tactical terminators', 'space marine terminators'],
    keywords: ['Infantry', 'Imperium', 'Adeptus Astartes', 'Terminator'],
    models: { min: 5, max: 10, default: 5 },
    profile: { M: 5, T: 5, Sv: 2, inv: 4, W: 3, Ld: 6, OC: 1, fnp: null },
    weapons: [
      { id: 'storm-bolter', name: 'Storm bolter', type: 'ranged', range: 24, A: '2', skill: 3, S: 4, AP: 0, D: '1', keywords: ['Rapid Fire 2'] },
      { id: 'assault-cannon', name: 'Assault cannon', type: 'ranged', range: 24, A: '6', skill: 3, S: 6, AP: 0, D: '1', keywords: ['Devastating Wounds'] },
      { id: 'heavy-flamer', name: 'Heavy flamer', type: 'ranged', range: 12, A: 'D6', skill: null, S: 5, AP: -1, D: '1', keywords: ['Ignores Cover', 'Torrent'] },
      { id: 'power-fist', name: 'Power fist', type: 'melee', range: 'Melee', A: '3', skill: 3, S: 8, AP: -2, D: '2', keywords: [] },
      { id: 'chainfist', name: 'Chainfist', type: 'melee', range: 'Melee', A: '3', skill: 4, S: 8, AP: -2, D: '2', keywords: ['Anti-Vehicle 3+'] },
      { id: 'power-weapon', name: 'Power weapon (Sergeant)', type: 'melee', range: 'Melee', A: '4', skill: 3, S: 5, AP: -2, D: '1', keywords: [] },
    ],
  },
  {
    id: 'assault-terminator-squad', name: 'Assault Terminator Squad', faction: 'Space Marines',
    aliases: ['assault terminators', 'thunder hammer terminators', 'th/ss terminators'],
    keywords: ['Infantry', 'Imperium', 'Adeptus Astartes', 'Terminator'],
    models: { min: 5, max: 10, default: 5 },
    // W4 reflects the storm shield wargear ability (+1 Wounds).
    profile: { M: 5, T: 5, Sv: 2, inv: 4, W: 4, Ld: 6, OC: 1, fnp: null },
    weapons: [
      { id: 'thunder-hammer', name: 'Thunder hammer', type: 'melee', range: 'Melee', A: '3', skill: 4, S: 8, AP: -2, D: '2', keywords: ['Devastating Wounds'] },
      { id: 'twin-lightning-claws', name: 'Twin lightning claws', type: 'melee', range: 'Melee', A: '5', skill: 3, S: 5, AP: -2, D: '1', keywords: ['Twin-linked'] },
    ],
  },
  {
    id: 'aggressor-squad', name: 'Aggressor Squad', faction: 'Space Marines',
    aliases: ['aggressors', 'gravis aggressors'],
    keywords: ['Infantry', 'Imperium', 'Adeptus Astartes', 'Gravis'],
    models: { min: 3, max: 6, default: 3 },
    profile: { M: 5, T: 6, Sv: 3, inv: null, W: 3, Ld: 6, OC: 1, fnp: null },
    weapons: [
      { id: 'auto-boltstorm-gauntlets', name: 'Auto boltstorm gauntlets', type: 'ranged', range: 18, A: '3', skill: 3, S: 4, AP: 0, D: '1', keywords: ['Twin-linked'] },
      { id: 'fragstorm-grenade-launcher', name: 'Fragstorm grenade launcher', type: 'ranged', range: 18, A: 'D6', skill: 3, S: 4, AP: 0, D: '1', keywords: ['Blast'] },
      { id: 'flamestorm-gauntlets', name: 'Flamestorm gauntlets', type: 'ranged', range: 12, A: 'D6+1', skill: null, S: 4, AP: -1, D: '1', keywords: ['Ignores Cover', 'Torrent', 'Twin-linked'] },
      { id: 'twin-power-fists', name: 'Twin power fists', type: 'melee', range: 'Melee', A: '3', skill: 3, S: 8, AP: -2, D: '2', keywords: ['Twin-linked'] },
    ],
  },
  {
    id: 'bladeguard-veteran-squad', name: 'Bladeguard Veteran Squad', faction: 'Space Marines',
    aliases: ['bladeguard', 'bladeguard veterans'],
    keywords: ['Infantry', 'Imperium', 'Adeptus Astartes', 'Grenades'],
    models: { min: 3, max: 6, default: 3 },
    profile: { M: 6, T: 4, Sv: 3, inv: 4, W: 3, Ld: 6, OC: 1, fnp: null },
    weapons: [
      { id: 'heavy-bolt-pistol', name: 'Heavy bolt pistol', type: 'ranged', range: 18, A: '1', skill: 3, S: 4, AP: -1, D: '1', keywords: ['Pistol'] },
      { id: 'master-crafted-power-weapon', name: 'Master-crafted power weapon', type: 'melee', range: 'Melee', A: '4', skill: 3, S: 5, AP: -2, D: '2', keywords: [] },
    ],
  },
  {
    id: 'ork-boyz', name: 'Boyz', faction: 'Orks',
    aliases: ['ork boyz', 'boyz', 'orks', 'slugga boyz', 'shoota boyz'],
    keywords: ['Infantry', 'Ork', 'Mob', 'Battleline'],
    models: { min: 10, max: 20, default: 10 },
    profile: { M: 6, T: 5, Sv: 5, inv: null, W: 1, Ld: 7, OC: 2, fnp: null },
    weapons: [
      { id: 'slugga', name: 'Slugga', type: 'ranged', range: 12, A: '1', skill: 5, S: 4, AP: 0, D: '1', keywords: ['Pistol'] },
      { id: 'shoota', name: 'Shoota', type: 'ranged', range: 18, A: '2', skill: 5, S: 4, AP: 0, D: '1', keywords: ['Assault'] },
      { id: 'rokkit-launcha', name: 'Rokkit launcha', type: 'ranged', range: 24, A: 'D3', skill: 5, S: 9, AP: -2, D: 'D6', keywords: ['Blast'] },
      { id: 'choppa', name: 'Choppa', type: 'melee', range: 'Melee', A: '3', skill: 3, S: 4, AP: -1, D: '1', keywords: [] },
      { id: 'big-choppa', name: 'Big choppa (Nob)', type: 'melee', range: 'Melee', A: '3', skill: 3, S: 7, AP: -1, D: '2', keywords: [] },
    ],
  },
  {
    id: 'necron-warriors', name: 'Necron Warriors', faction: 'Necrons',
    aliases: ['warriors', 'necrons'],
    keywords: ['Infantry', 'Necrons', 'Battleline'],
    models: { min: 10, max: 20, default: 10 },
    profile: { M: 5, T: 4, Sv: 4, inv: null, W: 1, Ld: 7, OC: 2, fnp: null },
    weapons: [
      { id: 'gauss-flayer', name: 'Gauss flayer', type: 'ranged', range: 24, A: '1', skill: 4, S: 4, AP: 0, D: '1', keywords: ['Lethal Hits', 'Rapid Fire 1'] },
      { id: 'gauss-reaper', name: 'Gauss reaper', type: 'ranged', range: 12, A: '2', skill: 4, S: 5, AP: -1, D: '1', keywords: ['Lethal Hits'] },
      ccw(4, 4, '1'),
    ],
  },
  {
    id: 'termagants', name: 'Termagants', faction: 'Tyranids',
    aliases: ['gaunts', 'termagant', 'tyranid termagants'],
    keywords: ['Infantry', 'Tyranids', 'Endless Multitude', 'Battleline'],
    models: { min: 10, max: 20, default: 10 },
    profile: { M: 6, T: 3, Sv: 5, inv: null, W: 1, Ld: 8, OC: 2, fnp: null },
    weapons: [
      { id: 'fleshborer', name: 'Fleshborer', type: 'ranged', range: 18, A: '1', skill: 4, S: 5, AP: 0, D: '1', keywords: ['Assault'] },
      { id: 'devourer', name: 'Termagant devourer', type: 'ranged', range: 18, A: '2', skill: 4, S: 4, AP: 0, D: '1', keywords: ['Assault'] },
      { id: 'chitinous-claws', name: 'Chitinous claws and teeth', type: 'melee', range: 'Melee', A: '1', skill: 4, S: 3, AP: 0, D: '1', keywords: [] },
    ],
  },
  {
    id: 'chaos-terminator-squad', name: 'Chaos Terminator Squad', faction: 'Chaos Space Marines',
    aliases: ['chaos terminators', 'csm terminators'],
    keywords: ['Infantry', 'Chaos', 'Terminator'],
    models: { min: 5, max: 10, default: 5 },
    profile: { M: 5, T: 5, Sv: 2, inv: 4, W: 3, Ld: 6, OC: 1, fnp: null },
    weapons: [
      { id: 'combi-bolter', name: 'Combi-bolter', type: 'ranged', range: 24, A: '2', skill: 3, S: 4, AP: 0, D: '1', keywords: ['Rapid Fire 2'] },
      { id: 'reaper-autocannon', name: 'Reaper autocannon', type: 'ranged', range: 36, A: '4', skill: 3, S: 7, AP: -1, D: '1', keywords: ['Devastating Wounds', 'Sustained Hits 1'] },
      { id: 'accursed-weapon', name: 'Accursed weapon', type: 'melee', range: 'Melee', A: '4', skill: 3, S: 5, AP: -2, D: '1', keywords: [] },
      { id: 'power-fist', name: 'Power fist', type: 'melee', range: 'Melee', A: '3', skill: 3, S: 8, AP: -2, D: '2', keywords: [] },
      { id: 'chainfist', name: 'Chainfist', type: 'melee', range: 'Melee', A: '3', skill: 4, S: 8, AP: -2, D: '2', keywords: ['Anti-Vehicle 3+'] },
    ],
  },
  {
    id: 'custodian-guard', name: 'Custodian Guard', faction: 'Adeptus Custodes',
    aliases: ['custodes', 'custodians', 'guardian spears'],
    keywords: ['Infantry', 'Imperium', 'Battleline'],
    models: { min: 4, max: 5, default: 4 },
    profile: { M: 6, T: 6, Sv: 2, inv: 4, W: 3, Ld: 6, OC: 2, fnp: null },
    weapons: [
      { id: 'guardian-spear-ranged', name: 'Guardian spear (shooting)', type: 'ranged', range: 24, A: '2', skill: 2, S: 4, AP: -1, D: '2', keywords: ['Assault'] },
      { id: 'guardian-spear-melee', name: 'Guardian spear', type: 'melee', range: 'Melee', A: '5', skill: 2, S: 7, AP: -2, D: '2', keywords: [] },
      { id: 'sentinel-blade-melee', name: 'Sentinel blade', type: 'melee', range: 'Melee', A: '5', skill: 2, S: 6, AP: -2, D: '1', keywords: [] },
    ],
  },
  {
    id: 'leman-russ-battle-tank', name: 'Leman Russ Battle Tank', faction: 'Astra Militarum',
    aliases: ['leman russ', 'russ', 'battle tank', 'tank'],
    keywords: ['Vehicle', 'Imperium', 'Smoke'],
    models: { min: 1, max: 1, default: 1 },
    profile: { M: 10, T: 11, Sv: 2, inv: null, W: 13, Ld: 7, OC: 3, fnp: null },
    weapons: [
      { id: 'battle-cannon', name: 'Leman Russ battle cannon', type: 'ranged', range: 48, A: 'D6+3', skill: 4, S: 10, AP: -1, D: '3', keywords: ['Blast'] },
      { id: 'lascannon', name: 'Lascannon', type: 'ranged', range: 48, A: '1', skill: 4, S: 12, AP: -3, D: 'D6+1', keywords: [] },
      { id: 'heavy-bolter', name: 'Heavy bolter', type: 'ranged', range: 36, A: '3', skill: 4, S: 5, AP: -1, D: '2', keywords: ['Sustained Hits 1'] },
      { id: 'armoured-tracks', name: 'Armoured tracks', type: 'melee', range: 'Melee', A: '3', skill: 4, S: 7, AP: 0, D: '1', keywords: [] },
    ],
  },
  {
    id: 'cadian-shock-troops', name: 'Cadian Shock Troops', faction: 'Astra Militarum',
    aliases: ['cadians', 'imperial guard', 'guardsmen', 'shock troops', 'infantry squad'],
    keywords: ['Infantry', 'Imperium', 'Regiment', 'Battleline'],
    models: { min: 10, max: 20, default: 10 },
    profile: { M: 6, T: 3, Sv: 5, inv: null, W: 1, Ld: 7, OC: 2, fnp: null },
    weapons: [
      { id: 'lasgun', name: 'Lasgun', type: 'ranged', range: 24, A: '1', skill: 4, S: 3, AP: 0, D: '1', keywords: ['Rapid Fire 1'] },
      { id: 'plasma-gun-standard', name: 'Plasma gun (standard)', type: 'ranged', range: 24, A: '1', skill: 4, S: 7, AP: -2, D: '1', keywords: ['Rapid Fire 1'] },
      { id: 'plasma-gun-supercharge', name: 'Plasma gun (supercharge)', type: 'ranged', range: 24, A: '1', skill: 4, S: 8, AP: -3, D: '2', keywords: ['Rapid Fire 1', 'Hazardous'] },
      { id: 'meltagun', name: 'Meltagun', type: 'ranged', range: 12, A: '1', skill: 4, S: 9, AP: -4, D: 'D6', keywords: ['Assault', 'Melta 2'] },
      ccw(4, 3, '1'),
    ],
  },
  {
    id: 'guardian-defenders', name: 'Guardian Defenders', faction: 'Aeldari',
    aliases: ['guardians', 'eldar guardians', 'aeldari guardians'],
    keywords: ['Infantry', 'Aeldari', 'Battleline'],
    models: { min: 10, max: 10, default: 10 },
    profile: { M: 7, T: 3, Sv: 4, inv: null, W: 1, Ld: 7, OC: 2, fnp: null },
    weapons: [
      { id: 'shuriken-catapult', name: 'Shuriken catapult', type: 'ranged', range: 18, A: '2', skill: 3, S: 4, AP: -1, D: '1', keywords: ['Assault'] },
      ccw(3, 3, '1'),
    ],
  },
  {
    id: 'strike-team', name: 'Strike Team', faction: "T'au Empire",
    aliases: ['fire warriors', 'tau fire warriors', 'fire warrior strike team'],
    keywords: ['Infantry', 'Battleline'],
    models: { min: 10, max: 10, default: 10 },
    profile: { M: 6, T: 3, Sv: 4, inv: null, W: 1, Ld: 7, OC: 2, fnp: null },
    weapons: [
      { id: 'pulse-rifle', name: 'Pulse rifle', type: 'ranged', range: 30, A: '1', skill: 4, S: 5, AP: 0, D: '1', keywords: ['Rapid Fire 1'] },
      ccw(5, 3, '1'),
    ],
  },
  {
    id: 'plague-marines', name: 'Plague Marines', faction: 'Death Guard',
    aliases: ['plague marines', 'death guard marines'],
    keywords: ['Infantry', 'Chaos', 'Nurgle', 'Battleline'],
    models: { min: 5, max: 10, default: 5 },
    // Feel No Pain varies with Death Guard rules versions; edit it in the UI if needed.
    profile: { M: 5, T: 5, Sv: 3, inv: null, W: 2, Ld: 6, OC: 2, fnp: 5 },
    weapons: [
      { id: 'boltgun', name: 'Boltgun', type: 'ranged', range: 24, A: '1', skill: 3, S: 4, AP: 0, D: '1', keywords: ['Lethal Hits', 'Rapid Fire 1'] },
      { id: 'plague-knife', name: 'Plague knife', type: 'melee', range: 'Melee', A: '3', skill: 3, S: 4, AP: 0, D: '1', keywords: ['Lethal Hits'] },
    ],
  },
];

/** Case-insensitive search by name, id, faction or alias. */
export function findUnits(units, q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return units;
  const exact = units.filter((u) => u.aliases.includes(s) || u.name.toLowerCase() === s);
  const loose = units.filter((u) => !exact.includes(u) && (
    u.name.toLowerCase().includes(s) || u.id.includes(s) || u.faction.toLowerCase().includes(s)
    || u.aliases.some((a) => a.includes(s))));
  return [...exact, ...loose];
}
