// Browser-safe combat service: request validation + unit lookup + simulation.
// Shared by the Express API (src/combat/routes.js) and the static GitHub Pages
// build (public/static-api.js), so both enforce identical limits.
import { simulate, parseDice, parseKeywords, keywordError, RULES_VERSION, MAX_TRIALS } from './engine.js';
import { findUnits, resolveUnit } from './unitSearch.js';

export class BadRequest extends Error {}
const bad = (msg) => { throw new BadRequest(msg); };

/* ------------------------------------------------------------ validators */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function int(v, name, min, max) {
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) v = Number(v);
  if (!Number.isInteger(v) || v < min || v > max) bad(`${name} must be an integer between ${min} and ${max}`);
  return v;
}
const optInt = (v, name, min, max) => (v === undefined || v === null || v === '' ? null : int(v, name, min, max));
function bool(v, name) {
  if (v === undefined || v === null) return false;
  if (typeof v !== 'boolean') bad(`${name} must be true or false`);
  return v;
}
function str(v, name, max = 80) {
  if (typeof v !== 'string' || !v.trim() || v.length > max) bad(`${name} must be a non-empty string (max ${max} chars)`);
  return v.trim();
}
function dice(v, name, maxValue) {
  if (typeof v === 'number') v = String(v);
  if (typeof v !== 'string') bad(`${name} must be a number or dice expression like "D6+1"`);
  let d;
  try { d = parseDice(v); } catch { bad(`${name} must be a number or dice expression like "D6+1"`); }
  if (d.max > maxValue) bad(`${name} may be at most ${maxValue}`);
  return d.text;
}
function oneOf(v, name, options, dflt) {
  if (v === undefined || v === null) return dflt;
  if (!options.includes(v)) bad(`${name} must be one of: ${options.join(', ')}`);
  return v;
}
function onlyKeys(obj, name, allowed) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) bad(`Unknown field ${name}.${k}`);
}
function keywords(v, name) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 20) bad(`${name} must be an array of at most 20 strings`);
  return v.map((k, i) => str(k, `${name}[${i}]`, 40));
}
/** Weapon keywords: strict allowlist with bounded numeric values. */
function weaponKeywords(v, name) {
  const list = keywords(v, name);
  list.forEach((k, i) => { const e = keywordError(k); if (e) bad(`${name}[${i}]: ${e}`); });
  return list;
}

// Max attacks per weapon entry, after Blast / Rapid Fire bonuses.
const MAX_ATTACKS_PER_WEAPON = 600;
// Max hits per volley: sum over weapons of attacks x (1 + max Sustained Hits).
const MAX_HITS_PER_VOLLEY = 1200;

function weaponSpec(w, name) {
  if (!isObj(w)) bad(`${name} must be an object`);
  onlyKeys(w, name, ['id', 'name', 'type', 'range', 'A', 'skill', 'S', 'AP', 'D', 'keywords']);
  const kw = weaponKeywords(w.keywords, `${name}.keywords`);
  const torrent = kw.some((k) => k.toLowerCase() === 'torrent');
  const AP = int(w.AP ?? 0, `${name}.AP`, -6, 0);
  return {
    id: w.id === undefined ? undefined : str(String(w.id), `${name}.id`, 60),
    name: w.name === undefined ? 'Custom weapon' : str(w.name, `${name}.name`, 60),
    type: oneOf(w.type, `${name}.type`, ['ranged', 'melee'], 'ranged'),
    A: dice(w.A, `${name}.A`, 40),
    skill: torrent && (w.skill === undefined || w.skill === null) ? null : int(w.skill, `${name}.skill`, 2, 6),
    S: int(w.S, `${name}.S`, 1, 30),
    AP,
    D: dice(w.D, `${name}.D`, 30),
    keywords: kw,
  };
}

export function unitById(id, units) {
  if (typeof id !== 'string' || id.length > 80) bad('unitId must be a string');
  // Exact id, else exact name/alias, else a confident fuzzy match ("termies", "intersessors").
  return units.find((u) => u.id === id) || resolveUnit(units, id.replace(/-/g, ' ')) || null;
}

const ATTACKER_MODS = ['hitMod', 'woundMod', 'rerollHits', 'rerollWounds', 'stationary', 'halfRange', 'charged',
  'lethalHits', 'sustainedHits', 'devastatingWounds', 'critHit', 'critWound', 'ignoresCover'];
const DEFENDER_MODS = ['cover', 'fnp', 'invuln', 'damageReduction', 'hitMod', 'woundMod', 'apReduction'];
const REROLLS = ['none', 'ones', 'failed'];

function attackerMods(m = {}) {
  if (!isObj(m)) bad('attacker.modifiers must be an object');
  onlyKeys(m, 'attacker.modifiers', ATTACKER_MODS);
  const p = 'attacker.modifiers';
  return {
    hitMod: optInt(m.hitMod, `${p}.hitMod`, -3, 3) ?? 0,
    woundMod: optInt(m.woundMod, `${p}.woundMod`, -3, 3) ?? 0,
    rerollHits: oneOf(m.rerollHits, `${p}.rerollHits`, REROLLS, 'none'),
    rerollWounds: oneOf(m.rerollWounds, `${p}.rerollWounds`, REROLLS, 'none'),
    stationary: bool(m.stationary, `${p}.stationary`),
    halfRange: bool(m.halfRange, `${p}.halfRange`),
    charged: bool(m.charged, `${p}.charged`),
    lethalHits: bool(m.lethalHits, `${p}.lethalHits`),
    devastatingWounds: bool(m.devastatingWounds, `${p}.devastatingWounds`),
    ignoresCover: bool(m.ignoresCover, `${p}.ignoresCover`),
    sustainedHits: m.sustainedHits === undefined || m.sustainedHits === null || m.sustainedHits === 0 || m.sustainedHits === '0'
      ? null : dice(m.sustainedHits, `${p}.sustainedHits`, 6),
    critHit: optInt(m.critHit, `${p}.critHit`, 2, 6) ?? 6,
    critWound: optInt(m.critWound, `${p}.critWound`, 2, 6) ?? 6,
  };
}

function defenderMods(m = {}) {
  if (!isObj(m)) bad('defender.modifiers must be an object');
  onlyKeys(m, 'defender.modifiers', DEFENDER_MODS);
  const p = 'defender.modifiers';
  return {
    cover: bool(m.cover, `${p}.cover`),
    fnp: optInt(m.fnp, `${p}.fnp`, 2, 6),
    invuln: optInt(m.invuln, `${p}.invuln`, 2, 6),
    damageReduction: optInt(m.damageReduction, `${p}.damageReduction`, 0, 2) ?? 0,
    hitMod: optInt(m.hitMod, `${p}.hitMod`, -3, 3) ?? 0,
    woundMod: optInt(m.woundMod, `${p}.woundMod`, -3, 3) ?? 0,
    apReduction: optInt(m.apReduction, `${p}.apReduction`, 0, 2) ?? 0,
  };
}

/** Validate + resolve a /simulate body into engine input. Throws BadRequest. */
export function buildSimulation(body, units) {
  if (!isObj(body)) bad('Body must be a JSON object');
  onlyKeys(body, 'body', ['attacker', 'defender', 'options']);
  const { attacker: a, defender: d } = body;
  if (!isObj(a)) bad('attacker is required');
  if (!isObj(d)) bad('defender is required');
  onlyKeys(a, 'attacker', ['unitId', 'custom', 'models', 'weaponIds', 'weapons', 'modifiers']);
  onlyKeys(d, 'defender', ['unitId', 'custom', 'models', 'modifiers']);

  // ---- attacker
  const aModels = int(a.models, 'attacker.models', 1, 30);
  if (!!a.unitId === !!a.custom) bad('attacker needs exactly one of unitId or custom');
  let aName, armoury;
  if (a.unitId) {
    const u = unitById(a.unitId, units);
    if (!u) bad(`Unknown attacker unitId "${a.unitId}"`);
    aName = u.name; armoury = u.weapons;
  } else {
    if (!isObj(a.custom)) bad('attacker.custom must be an object');
    onlyKeys(a.custom, 'attacker.custom', ['name', 'weapons']);
    aName = a.custom.name === undefined ? 'Custom attacker' : str(a.custom.name, 'attacker.custom.name', 60);
    const list = a.custom.weapons ?? [];
    if (!Array.isArray(list) || list.length > 10) bad('attacker.custom.weapons must be an array of at most 10 weapons');
    armoury = list.map((w, i) => ({ ...weaponSpec(w, `attacker.custom.weapons[${i}]`), id: w.id ? String(w.id) : `custom-${i + 1}` }));
  }
  const lookup = (id, name) => {
    const w = armoury.find((x) => x.id === id);
    if (!w) bad(`${name}: unknown weapon "${id}" for ${aName}`);
    return w;
  };
  let selected = [];
  if (a.weaponIds !== undefined && a.weapons !== undefined) bad('Use either attacker.weaponIds or attacker.weapons, not both');
  if (a.weaponIds !== undefined) {
    if (!Array.isArray(a.weaponIds) || a.weaponIds.length > 10) bad('attacker.weaponIds must be an array of at most 10 ids');
    selected = a.weaponIds.map((id, i) => ({ ...lookup(String(id), `attacker.weaponIds[${i}]`), models: aModels }));
  } else if (a.weapons !== undefined) {
    if (!Array.isArray(a.weapons) || a.weapons.length > 10) bad('attacker.weapons must be an array of at most 10 entries');
    selected = a.weapons.map((w, i) => {
      const n = `attacker.weapons[${i}]`;
      if (!isObj(w)) bad(`${n} must be an object`);
      onlyKeys(w, n, ['id', 'weaponId', 'models', 'custom']);
      const models = w.models === undefined ? aModels : int(w.models, `${n}.models`, 1, aModels);
      if (w.custom !== undefined) return { ...weaponSpec(w.custom, `${n}.custom`), models };
      const id = w.id ?? w.weaponId;
      if (id === undefined) bad(`${n} needs an id or a custom profile`);
      return { ...lookup(String(id), n), models };
    });
  } else if (a.custom) {
    selected = armoury.map((w) => ({ ...w, models: aModels }));
  }
  if (!selected.length) bad('Select at least one attacker weapon');

  // ---- defender
  const dModels = int(d.models, 'defender.models', 1, 30);
  if (!!d.unitId === !!d.custom) bad('defender needs exactly one of unitId or custom');
  let defender;
  if (d.unitId) {
    const u = unitById(d.unitId, units);
    if (!u) bad(`Unknown defender unitId "${d.unitId}"`);
    defender = { name: u.name, models: dModels, ...pick(u.profile), keywords: u.keywords };
  } else {
    const c = d.custom;
    if (!isObj(c)) bad('defender.custom must be an object');
    onlyKeys(c, 'defender.custom', ['name', 'T', 'Sv', 'inv', 'W', 'fnp', 'keywords']);
    defender = {
      name: c.name === undefined ? 'Custom defender' : str(c.name, 'defender.custom.name', 60),
      models: dModels,
      T: int(c.T, 'defender.custom.T', 1, 30),
      Sv: int(c.Sv, 'defender.custom.Sv', 2, 7),
      inv: optInt(c.inv, 'defender.custom.inv', 2, 6),
      W: int(c.W, 'defender.custom.W', 1, 40),
      fnp: optInt(c.fnp, 'defender.custom.fnp', 2, 6),
      keywords: keywords(c.keywords, 'defender.custom.keywords'),
    };
  }

  // ---- volley size (includes Blast, Rapid Fire and Sustained Hits bonuses)
  const aMods = attackerMods(a.modifiers);
  let volleyHits = 0;
  for (const w of selected) {
    const kw = parseKeywords(w.keywords); // seed/imported keywords are bounded too; throws on bad values
    const ranged = w.type !== 'melee';
    let bonus = kw.blast ? Math.floor(dModels / 5) : 0;
    if (kw.rapidFire && aMods.halfRange && ranged) bonus += kw.rapidFire;
    const maxAttacks = (parseDice(w.A).max + bonus) * w.models;
    if (maxAttacks > MAX_ATTACKS_PER_WEAPON) bad(`Too many attacks for ${w.name} (up to ${maxAttacks}; limit ${MAX_ATTACKS_PER_WEAPON})`);
    const sus = aMods.sustainedHits || kw.sustainedHits;
    volleyHits += maxAttacks * (1 + (sus ? parseDice(sus).max : 0));
  }
  if (volleyHits > MAX_HITS_PER_VOLLEY) bad(`Volley too large (up to ${volleyHits} hits; limit ${MAX_HITS_PER_VOLLEY})`);

  // ---- options
  const o = body.options ?? {};
  if (!isObj(o)) bad('options must be an object');
  onlyKeys(o, 'options', ['method', 'trials', 'seed']);
  const options = {
    method: oneOf(o.method, 'options.method', ['auto', 'exact', 'monte-carlo'], 'auto'),
    trials: optInt(o.trials, 'options.trials', 1000, MAX_TRIALS) ?? MAX_TRIALS,
    seed: optInt(o.seed, 'options.seed', 0, 2 ** 31 - 1) ?? 40_000,
  };

  return {
    attacker: { name: aName, models: aModels, weapons: selected },
    defender,
    attackerMods: aMods,
    defenderMods: defenderMods(d.modifiers),
    options,
  };
}

function pick(p) { return { T: p.T, Sv: p.Sv, inv: p.inv ?? null, W: p.W, fnp: p.fnp ?? null }; }

export const summary = (u) => ({
  id: u.id, name: u.name, faction: u.faction, aliases: u.aliases, models: u.models,
  profile: u.profile, keywords: u.keywords, points: u.points ?? null, source: u.source ?? 'seed',
  weapons: u.weapons.map((w) => ({ id: w.id, name: w.name, type: w.type })),
});

/** Lean row for pickers/autocomplete (the full catalogue summary is ~1 MB). */
export const brief = (u) => {
  const r = { id: u.id, name: u.name, faction: u.faction, models: u.models };
  if (u.aliases?.length) r.aliases = u.aliases;
  if (u.points) r.points = u.points;
  return r;
};

const normFaction = (s) => String(s ?? '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Units matching `q` (fuzzy), optionally limited to one faction (case-insensitive). */
export function listUnits(units, q = '', faction = '', { view = 'full' } = {}) {
  const f = normFaction(String(faction).slice(0, 80));
  const pool = f ? units.filter((u) => normFaction(u.faction) === f) : units;
  return findUnits(pool, String(q).slice(0, 80)).map(view === 'brief' ? brief : summary);
}

/** Factions with unit counts, alphabetical. */
export function listFactions(units) {
  const counts = new Map();
  for (const u of units) counts.set(u.faction, (counts.get(u.faction) || 0) + 1);
  return [...counts].map(([name, n]) => ({ name, units: n })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Validate + run. Throws BadRequest for invalid input. */
export function runSimulation(body, units) {
  return simulate(buildSimulation(body, units));
}

export { RULES_VERSION };
