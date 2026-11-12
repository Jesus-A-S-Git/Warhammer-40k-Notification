// Product catalogue for the Deal Finder: what people commonly buy, with
// APPROXIMATE US recommended retail prices (RRP), categories and faction tags.
// Browser-safe (copied into the static build's lib/).
//
// HONESTY RULES for this table
//  * Prices are rounded estimates of Games Workshop's US RRP at 2025-2026 levels
//    (RRP_AS_OF). GW changes prices most years, so every figure is approximate and
//    the UI says so. `conf` says how sure we are of the price:
//      'medium' = matches the well-known price point for that product type
//      'low'    = best guess (seasonal boxes, newer or rarer kits); verify before trusting
//  * `models` / `points` are only filled where reasonably known; points are rough
//    matched-play values for the whole box (they change with every balance update)
//    and are only used for "value per point" comparisons, clearly labelled.
//  * GBP / EUR are derived from USD unless given (for flagging UK/EU offers only).
//
// Add a product: append a line below. Ids are stable slugs of the name.

export const RRP_AS_OF = '2025-26 US RRP (approx.)';

export const CATEGORIES = [
  { id: 'combat-patrol', name: 'Combat Patrols', blurb: 'Faction starter boxes, about 500 pts' },
  { id: 'starter', name: 'Starter sets', blurb: 'Two-army boxes with rules and terrain' },
  { id: 'battleforce', name: 'Battleforces & boxed sets', blurb: 'Seasonal value boxes; contents vary by year' },
  { id: 'codex', name: 'Codexes', blurb: 'Faction rules books' },
  { id: 'kit', name: 'Unit kits', blurb: 'Individual squads, characters and vehicles' },
  { id: 'paint', name: 'Paint sets', blurb: 'Citadel paint and hobby sets' },
];

// Faction display colours feed the shared `.faction-dot` (--c).
export const FACTIONS = [
  { id: 'space-marines', name: 'Space Marines', group: 'Imperium', color: '#2f5fb3' },
  { id: 'blood-angels', name: 'Blood Angels', group: 'Imperium', color: '#a3141b', parent: 'space-marines' },
  { id: 'dark-angels', name: 'Dark Angels', group: 'Imperium', color: '#1f5a32', parent: 'space-marines' },
  { id: 'space-wolves', name: 'Space Wolves', group: 'Imperium', color: '#6f8aa3', parent: 'space-marines' },
  { id: 'black-templars', name: 'Black Templars', group: 'Imperium', color: '#222222', parent: 'space-marines' },
  { id: 'grey-knights', name: 'Grey Knights', group: 'Imperium', color: '#9aa4ad' },
  { id: 'adeptus-custodes', name: 'Adeptus Custodes', group: 'Imperium', color: '#c79a2b' },
  { id: 'adepta-sororitas', name: 'Adepta Sororitas', group: 'Imperium', color: '#7a1f2b' },
  { id: 'adeptus-mechanicus', name: 'Adeptus Mechanicus', group: 'Imperium', color: '#b0381e' },
  { id: 'astra-militarum', name: 'Astra Militarum', group: 'Imperium', color: '#6b6b3a' },
  { id: 'imperial-knights', name: 'Imperial Knights', group: 'Imperium', color: '#3d5f8a' },
  { id: 'chaos-space-marines', name: 'Chaos Space Marines', group: 'Chaos', color: '#5a1e1e' },
  { id: 'death-guard', name: 'Death Guard', group: 'Chaos', color: '#7c8a3a' },
  { id: 'thousand-sons', name: 'Thousand Sons', group: 'Chaos', color: '#1f6f9a' },
  { id: 'world-eaters', name: 'World Eaters', group: 'Chaos', color: '#b3241b' },
  { id: 'emperors-children', name: 'Emperor’s Children', group: 'Chaos', color: '#a03a8f' },
  { id: 'chaos-daemons', name: 'Chaos Daemons', group: 'Chaos', color: '#8a2a5a' },
  { id: 'chaos-knights', name: 'Chaos Knights', group: 'Chaos', color: '#3a3a3a' },
  { id: 'necrons', name: 'Necrons', group: 'Xenos', color: '#2f9a5a' },
  { id: 'orks', name: 'Orks', group: 'Xenos', color: '#4f8a2a' },
  { id: 'tyranids', name: 'Tyranids', group: 'Xenos', color: '#7a3aa0' },
  { id: 'tau-empire', name: 'T’au Empire', group: 'Xenos', color: '#c9822b' },
  { id: 'aeldari', name: 'Aeldari', group: 'Xenos', color: '#2a8a8a' },
  { id: 'drukhari', name: 'Drukhari', group: 'Xenos', color: '#3a2a5a' },
  { id: 'genestealer-cults', name: 'Genestealer Cults', group: 'Xenos', color: '#8a5aa0' },
  { id: 'leagues-of-votann', name: 'Leagues of Votann', group: 'Xenos', color: '#a0702a' },
  { id: 'multi', name: 'Multiple factions', group: 'Other', color: '#888888' },
  { id: 'hobby', name: 'Hobby & paint', group: 'Other', color: '#888888' },
];
const FACTION_BY_ID = new Map(FACTIONS.map((f) => [f.id, f]));
export const factionById = (id) => FACTION_BY_ID.get(id) ?? null;

export const slug = (s) => String(s).replace(/(\d),(\d)/g, '$1$2').toLowerCase().normalize('NFKD').replace(/[̀-ͯ’']/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Rough GBP/EUR from a US price (GW's UK prices run at roughly 0.6-0.7 of the US number).
const gbp = (usd) => Math.round((usd * 0.64) / 2.5) * 2.5;
const eur = (usd) => Math.round((usd * 0.76) / 2.5) * 2.5;

function entry(category, faction, name, USD, o = {}) {
  return {
    id: o.id ?? slug(name),
    name,
    // `kit` = the words a query must contain to mean this product (defaults to the
    // whole name), so vague queries such as "space marines" or "combat patrol" match nothing.
    kit: o.kit ?? name,
    category, faction, USD,
    GBP: o.GBP ?? gbp(USD), EUR: o.EUR ?? eur(USD),
    conf: o.conf ?? 'low',
    models: o.models ?? null,
    points: o.points ?? null,
    // "T’au Empire" is often written "Tau" by stores and players.
    aliases: [...(o.aliases ?? []), ...(name.includes('T’au Empire') ? [name.replace('T’au Empire', 'Tau')] : [])],
    note: o.note ?? null,
    popular: !!o.popular,
    approximate: true,
  };
}

const cp = (faction, o = {}) => entry('combat-patrol', faction,
  `Combat Patrol: ${factionById(faction).name}`, o.USD ?? 170,
  { conf: 'medium', points: 500,
    note: 'Combat Patrol boxes are built for ~500 pt games; matched-play value varies.', ...o });
const codex = (faction, o = {}) => entry('codex', faction, `Codex: ${factionById(faction).name}`, o.USD ?? 60,
  { conf: 'medium', ...o });
const supplement = (faction) => entry('codex', faction, `Codex Supplement: ${factionById(faction).name}`, 40,
  { conf: 'low' });
const kit = (faction, name, USD, models, points, o = {}) => entry('kit', faction, name, USD, { models, points, ...o });
const battleforce = (faction, name, USD = 230) => entry('battleforce', faction, name, USD,
  { conf: 'low', note: 'Seasonal box: contents and price change each year.' });

const LIST = [
  // ---- Combat Patrols (every faction that has one) --------------------------------
  cp('space-marines', { GBP: 100, EUR: 120, popular: true }),
  cp('blood-angels'), cp('dark-angels'), cp('space-wolves'), cp('black-templars'),
  cp('grey-knights'), cp('adeptus-custodes', { popular: true }), cp('adepta-sororitas', { GBP: 100, EUR: 120 }),
  cp('adeptus-mechanicus'), cp('astra-militarum', { GBP: 100, EUR: 120 }), cp('imperial-knights', { conf: 'low' }),
  cp('chaos-space-marines', { GBP: 100, EUR: 120, popular: true }), cp('death-guard'), cp('thousand-sons'),
  cp('world-eaters'), cp('emperors-children', { conf: 'low', USD: 175 }), cp('chaos-daemons'),
  cp('necrons', { GBP: 100, EUR: 120, popular: true }), cp('orks', { GBP: 100, EUR: 120, popular: true }),
  cp('tyranids', { GBP: 100, EUR: 120, popular: true }), cp('tau-empire', { GBP: 100, EUR: 120 }),
  cp('aeldari'), cp('drukhari'), cp('genestealer-cults'), cp('leagues-of-votann'),
  entry('combat-patrol', 'space-marines', 'Boarding Patrol: Space Marines', 140,
    { GBP: 85, EUR: 105, conf: 'low', kit: 'Boarding Patrol' }),

  // ---- Starter sets (10th edition line-up) -----------------------------------------
  entry('starter', 'multi', 'Warhammer 40,000 Introductory Set', 65,
    { conf: 'low', kit: 'Introductory Set', aliases: ['40k Introductory Set'] }),
  entry('starter', 'multi', 'Warhammer 40,000 Starter Set', 110,
    { conf: 'low', kit: 'Starter Set', aliases: ['40k Starter Set'] }),
  entry('starter', 'multi', 'Warhammer 40,000 Ultimate Starter Set', 220,
    { conf: 'low', kit: 'Ultimate Starter Set', popular: true, aliases: ['40k Ultimate Starter Set'] }),
  entry('starter', 'multi', 'Kill Team Starter Set', 130, { conf: 'low', kit: 'Kill Team Starter Set' }),

  // ---- Battleforces / seasonal boxes ------------------------------------------------
  battleforce('space-marines', 'Space Marines Battleforce'),
  battleforce('necrons', 'Necrons Battleforce'),
  battleforce('orks', 'Orks Battleforce'),
  battleforce('tyranids', 'Tyranids Battleforce'),
  battleforce('chaos-space-marines', 'Chaos Space Marines Battleforce'),
  battleforce('astra-militarum', 'Astra Militarum Battleforce'),
  battleforce('adeptus-custodes', 'Adeptus Custodes Battleforce'),
  battleforce('aeldari', 'Aeldari Battleforce'),

  // ---- Codexes -------------------------------------------------------------------------
  ...['space-marines', 'grey-knights', 'adeptus-custodes', 'adepta-sororitas', 'adeptus-mechanicus',
    'astra-militarum', 'imperial-knights', 'chaos-space-marines', 'death-guard', 'thousand-sons',
    'world-eaters', 'emperors-children', 'chaos-daemons', 'chaos-knights', 'necrons', 'orks', 'tyranids',
    'tau-empire', 'aeldari', 'drukhari', 'genestealer-cults', 'leagues-of-votann'].map((f) => codex(f)),
  ...['blood-angels', 'dark-angels', 'space-wolves', 'black-templars'].map(supplement),

  // ---- Popular unit kits --------------------------------------------------------------------
  // Space Marines
  kit('space-marines', 'Space Marines Intercessors', 65, 10, 160,
    { conf: 'medium', GBP: 45, EUR: 55, kit: 'Intercessors', popular: true, aliases: ['Primaris Intercessors', 'Intercessor Squad'] }),
  kit('space-marines', 'Space Marines Assault Intercessors', 65, 10, 150,
    { conf: 'medium', GBP: 45, EUR: 55, kit: 'Assault Intercessors', aliases: ['Assault Intercessor Squad'] }),
  kit('space-marines', 'Space Marines Terminators', 65, 5, 170,
    { conf: 'medium', GBP: 42.5, EUR: 52.5, kit: 'Terminators', popular: true, aliases: ['Terminator Squad'] }),
  kit('space-marines', 'Space Marines Terminator Assault Squad', 65, 5, 180,
    { GBP: 42.5, EUR: 52.5, kit: 'Terminator Assault Squad', aliases: ['Assault Terminators'] }),
  kit('space-marines', 'Space Marines Infernus Squad', 65, 10, 180,
    { GBP: 45, EUR: 55, kit: 'Infernus Squad' }),
  kit('space-marines', 'Space Marines Hellblasters', 65, 10, 230, { kit: 'Hellblasters' }),
  kit('space-marines', 'Space Marines Aggressors', 60, 3, 95, { kit: 'Aggressors' }),
  kit('space-marines', 'Space Marines Bladeguard Veterans', 60, 3, 80, { kit: 'Bladeguard Veterans' }),
  kit('space-marines', 'Space Marines Sternguard Veteran Squad', 65, null, null, { kit: 'Sternguard Veteran Squad' }),
  kit('space-marines', 'Space Marines Eradicators', 60, 3, 95, { kit: 'Eradicators' }),
  kit('space-marines', 'Space Marines Inceptors', 60, 3, 120, { kit: 'Inceptors' }),
  kit('space-marines', 'Space Marines Captain', 40, 1, 80, { kit: 'Captain' }),
  kit('space-marines', 'Space Marines Redemptor Dreadnought', 75, 1, 210, { kit: 'Redemptor Dreadnought' }),
  kit('space-marines', 'Space Marines Ballistus Dreadnought', 70, 1, 140, { kit: 'Ballistus Dreadnought' }),
  kit('space-marines', 'Space Marines Gladiator Lancer', 80, 1, 160, { kit: 'Gladiator Lancer' }),
  kit('space-marines', 'Space Marines Repulsor Executioner', 110, 1, 220, { kit: 'Repulsor Executioner' }),
  kit('space-marines', 'Space Marines Land Raider', 90, 1, 240, { kit: 'Land Raider' }),
  kit('blood-angels', 'Blood Angels Sanguinary Guard', 60, null, null, { kit: 'Sanguinary Guard' }),
  kit('dark-angels', 'Dark Angels Deathwing Knights', 65, 5, 250, { kit: 'Deathwing Knights' }),
  // Imperium
  kit('adeptus-custodes', 'Adeptus Custodes Custodian Guard', 65, 5, 170,
    { kit: 'Custodian Guard', popular: true, aliases: ['Custodian Guard Squad'] }),
  kit('astra-militarum', 'Astra Militarum Cadian Shock Troops', 50, 10, 65, { kit: 'Cadian Shock Troops' }),
  kit('astra-militarum', 'Astra Militarum Leman Russ Battle Tank', 65, 1, 190, { kit: 'Leman Russ Battle Tank' }),
  kit('adepta-sororitas', 'Adepta Sororitas Battle Sisters Squad', 50, 10, 105, { kit: 'Battle Sisters Squad' }),
  kit('adeptus-mechanicus', 'Adeptus Mechanicus Skitarii Rangers', 50, 10, 85, { kit: 'Skitarii Rangers' }),
  kit('imperial-knights', 'Imperial Knights Armiger Warglaives', 90, null, null, { kit: 'Armiger Warglaives' }),
  // Chaos
  kit('chaos-space-marines', 'Chaos Space Marines Chaos Terminators', 65, 5, 180, { kit: 'Chaos Terminators' }),
  kit('chaos-space-marines', 'Chaos Space Marines Legionaries', 60, 10, 180, { kit: 'Legionaries' }),
  kit('death-guard', 'Death Guard Plague Marines', 60, 7, null, { kit: 'Plague Marines' }),
  kit('thousand-sons', 'Thousand Sons Rubric Marines', 65, 10, 200, { kit: 'Rubric Marines' }),
  kit('world-eaters', 'World Eaters Khorne Berzerkers', 65, 10, 180, { kit: 'Khorne Berzerkers' }),
  // Xenos
  kit('orks', 'Ork Boyz', 55, 10, 80, { GBP: 35, EUR: 45, kit: 'Boyz', popular: true }),
  kit('orks', 'Ork Beast Snagga Boyz', 55, 10, 95, { kit: 'Beast Snagga Boyz' }),
  kit('necrons', 'Necron Warriors', 60, null, null, { GBP: 40, EUR: 50, kit: 'Warriors', popular: true }),
  kit('necrons', 'Necron Lychguard', 60, 5, 85, { kit: 'Lychguard' }),
  kit('tyranids', 'Tyranids Termagants', 50, 10, 60, { GBP: 32.5, EUR: 40, kit: 'Termagants', popular: true }),
  kit('tyranids', 'Tyranids Hormagaunts', 50, 10, 65, { kit: 'Hormagaunts' }),
  kit('tyranids', 'Tyranids Carnifex', 60, 1, 115, { kit: 'Carnifex' }),
  kit('tau-empire', 'T’au Empire Strike Team', 50, 10, 75, { kit: 'Strike Team', aliases: ['Fire Warriors Strike Team'] }),
  kit('tau-empire', 'T’au Empire Crisis Battlesuits', 75, 3, 130, { kit: 'Crisis Battlesuits' }),
  kit('aeldari', 'Aeldari Guardian Defenders', 50, null, null, { kit: 'Guardian Defenders' }),

  // ---- Paint sets ---------------------------------------------------------------------------
  entry('paint', 'hobby', 'Warhammer 40,000 Paints + Tools Set', 50,
    { conf: 'low', kit: 'Paints Tools Set', aliases: ['40k Paints and Tools Set'] }),
  entry('paint', 'hobby', 'Citadel Colour Contrast Paint Set', 70, { conf: 'low', kit: 'Contrast Paint Set' }),
  entry('paint', 'hobby', 'Citadel Colour Base Paint Set', 50, { conf: 'low', kit: 'Base Paint Set' }),
];

export const CATALOG = Object.freeze(LIST.map((e) => Object.freeze(e)));
const BY_ID = new Map(CATALOG.map((e) => [e.id, e]));
export const productById = (id) => BY_ID.get(id) ?? null;

/** Public, JSON-safe catalogue payload. */
export function catalogPayload() {
  return {
    asOf: RRP_AS_OF,
    categories: CATEGORIES,
    factions: FACTIONS,
    products: CATALOG.map((e) => ({ ...e, factionName: factionById(e.faction)?.name ?? null })),
    note: 'RRP figures are approximate US prices (rounded, 2025-26 levels) and may be out of date; '
      + '“conf” is our confidence in each figure. Models and points are rough and only used for value comparisons.',
  };
}
