// Converter: BSData "wh40k-10e" BattleScribe catalogues (.cat/.gst XML) -> our
// unit shape (see the header of src/combat/data/units.js).
//
// Data source: https://github.com/BSData/wh40k-10e, community-maintained
// BattleScribe data files (not affiliated with or endorsed by Games Workshop).
// Values may lag behind codexes, FAQs and balance dataslates: always verify
// against the official datasheets.
//
// Pure JS with no Node imports: used by scripts/import-units.js and the tests
// (which feed it small fixture snippets). Never shipped to the browser.
import { keywordError, parseDice } from '../engine.js';

/* ------------------------------------------------------------ tiny XML */

const ENT = { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', nbsp: ' ' };
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * Minimal, well-formed-XML parser (enough for BattleScribe files).
 * @returns {{name:string, attrs:object, children:object[], text:string}} the root element
 */
export function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) { top.text += m[1]; continue; }
    if (m[3]) {
      if (m[2] === '/') {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const attrs = {};
      ATTR.lastIndex = 0;
      let a;
      while ((a = ATTR.exec(m[4] || ''))) attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? '');
      const node = { name: m[3], attrs, children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
      continue;
    }
    if (m[6] !== undefined && stack.length > 1) top.text += decodeEntities(m[6]);
  }
  const doc = root.children.find((c) => c.name !== '#text');
  if (!doc) throw new Error('No root element');
  return doc;
}

const kids = (n, name) => (n?.children || []).filter((c) => c.name === name);
const kid = (n, name) => (n?.children || []).find((c) => c.name === name);
const grand = (n, wrap, name) => kids(kid(n, wrap), name);

/* ------------------------------------------------------------ catalogue set */

/** Faction display name from a catalogue name ("Imperium - Adeptus Astartes - Blood Angels" -> "Blood Angels"). */
export function factionName(catalogueName) {
  let s = String(catalogueName || '').trim();
  s = s.replace(/^(Imperium|Chaos|Xenos|Aeldari|Library)\s+-\s+/i, '')
    .replace(/^Adeptus Astartes\s+-\s+/i, '')
    .replace(/\s+-\s+Library$/i, '').replace(/\s+Library$/i, '').trim();
  if (/^Daemons$/i.test(s)) return 'Chaos Daemons';
  if (/^Astartes Heresy Legends$/i.test(s)) return 'Heresy Legends';
  if (/^Unaligned Forces$/i.test(s)) return 'Unaligned';
  return s;
}

/**
 * Index a set of parsed files.
 * @param {{file:string, doc:object}[]} files parsed .cat/.gst roots
 */
export function buildIndex(files) {
  const cats = files.map(({ file, doc }) => {
    const ids = new Map();
    const walk = (n) => {
      if (n.attrs.id && !ids.has(n.attrs.id)) ids.set(n.attrs.id, n);
      for (const c of n.children) walk(c);
    };
    walk(doc);
    return {
      file, doc, ids, id: doc.attrs.id, name: doc.attrs.name || file,
      library: doc.attrs.library === 'true' || doc.name === 'gameSystem',
      gameSystem: doc.name === 'gameSystem',
      links: grand(doc, 'catalogueLinks', 'catalogueLink').map((l) => l.attrs.targetId),
    };
  });
  const byId = new Map(cats.map((c) => [c.id, c]));
  return { cats, byId };
}

/** Resolve an id from the point of view of catalogue `cat`: own file, linked catalogues, game system, then anywhere. */
function resolver(index, cat) {
  const order = [];
  const seen = new Set();
  const add = (c) => { if (c && !seen.has(c.id)) { seen.add(c.id); order.push(c); c.links.forEach((l) => add(index.byId.get(l))); } };
  add(cat);
  index.cats.filter((c) => c.gameSystem).forEach(add);
  index.cats.forEach(add);
  return (id) => {
    for (const c of order) { const n = c.ids.get(id); if (n) return n; }
    return null;
  };
}

/* ------------------------------------------------------------ value parsing */

const intOf = (s) => { const m = /-?\d+/.exec(String(s ?? '')); return m ? Number(m[0]) : null; };
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const cleanName = (s) => String(s || '').replace(/^[\s➤►▶•*-]+/, '').replace(/\s+/g, ' ').trim();
const chars = (profile) => {
  const o = {};
  for (const c of grand(profile, 'characteristics', 'characteristic')) o[c.attrs.name] = c.text.trim();
  return o;
};
const DICE = /^(\d{1,3}|\d?D[36](\+\d{1,2})?)$/;
const diceText = (s) => String(s ?? '').toUpperCase().replace(/\s+/g, '');

/** "anti-INFANTRY 4+" -> "Anti-Infantry 4+", "twin linked" -> "Twin-linked". */
export function normalizeKeyword(raw) {
  let s = String(raw).replace(/\s+/g, ' ').trim().toLowerCase();
  if (s === 'twin linked') s = 'twin-linked';
  return s.replace(/(^|[\s-])([a-z])/g, (m, p, c) => p + c.toUpperCase()).replace(/^Twin-Linked$/, 'Twin-linked');
}

/** Split a Keywords characteristic into engine-supported keywords + the rest (kept for display). */
export function splitKeywords(text) {
  const keywords = [], other = [];
  for (const part of String(text || '').split(/[,;]/)) {
    const k = part.trim();
    if (!k || k === '-' || k === '–') continue;
    const n = normalizeKeyword(k);
    if (keywordError(n)) other.push(k); else if (!keywords.includes(n)) keywords.push(n);
  }
  return { keywords, other };
}

/**
 * Convert one weapon profile, or return { error } when it can't be simulated.
 * @returns {{weapon?:object, error?:string}}
 */
export function convertWeapon(profile) {
  const type = /melee/i.test(profile.attrs.typeName) ? 'melee' : 'ranged';
  const c = chars(profile);
  const name = cleanName(profile.attrs.name);
  const A = diceText(c.A), D = diceText(c.D);
  const S = intOf(c.S), AP = intOf(c.AP) ?? 0;
  const { keywords, other } = splitKeywords(c.Keywords);
  const torrent = keywords.includes('Torrent');
  const skillRaw = c.BS ?? c.WS;
  const skill = torrent ? null : intOf(skillRaw);
  if (!name) return { error: 'no name' };
  if (!DICE.test(A)) return { error: `A "${c.A}"` };
  if (!DICE.test(D)) return { error: `D "${c.D}"` };
  if (!/^\d+$/.test(String(c.S ?? '').trim()) || S < 1 || S > 30) return { error: `S "${c.S}"` };
  if (AP > 0 || AP < -6) return { error: `AP "${c.AP}"` };
  if (!torrent && !(skill >= 2 && skill <= 6)) return { error: `skill "${skillRaw}"` };
  try {
    if (parseDice(A).max > 40) return { error: `A "${c.A}" too large` };
    if (parseDice(D).max > 30) return { error: `D "${c.D}" too large` };
  } catch { return { error: 'dice' }; }
  const range = type === 'melee' ? 'Melee' : intOf(c.Range);
  const w = { id: slug(name) || 'weapon', name, type, range, A, skill, S, AP, D, keywords };
  if (other.length) w.otherKeywords = other;
  return { weapon: w };
}

/* ------------------------------------------------------------ unit walk */

// Option groups that never contain datasheet wargear.
const SKIP_GROUP = /\bcrusade\b|weapon modifications|battle honou?rs?|battle scars?|^enhancements?$|^warlord$|detachment|requisitions?|^relics?$|agendas?/i;
const LEVELS = { unit: 0, model: 1, gear: 2 };

function walkUnit(unitNode, resolve) {
  const acc = { unitProfiles: [], weapons: [], inv: [], fnp: [], categories: [], points: null };
  const seenProfiles = new Map(); // weapon profile -> { p, models: Set of model entries carrying it }
  const visit = (node, level, model, depth, path) => {
    if (depth > 14) return;
    for (const c of node.children) {
      switch (c.name) {
        case 'profiles':
          for (const p of kids(c, 'profile')) profile(p, level, model);
          break;
        case 'infoLinks':
          for (const l of kids(c, 'infoLink')) {
            const t = resolve(l.attrs.targetId);
            if (!t) continue;
            if (t.name === 'profile') profile(t, level, model, l);
            else if (t.name === 'rule' && level !== 'gear') rule(l, t);
          }
          break;
        case 'categoryLinks':
          if (level !== 'gear') for (const l of kids(c, 'categoryLink')) acc.categories.push(l.attrs.name || resolve(l.attrs.targetId)?.attrs.name);
          break;
        case 'selectionEntries': case 'selectionEntryGroups':
          for (const e of c.children) entry(e, e, level, model, depth, path);
          break;
        case 'entryLinks':
          for (const l of kids(c, 'entryLink')) {
            if (SKIP_GROUP.test(l.attrs.name || '')) continue;
            const t = resolve(l.attrs.targetId);
            if (!t || path.has(t)) continue;
            entry(t, l, level, model, depth, path);
            // Links can carry their own nested entries/profiles.
            visit(l, level, model, depth + 1, path);
          }
          break;
        default: break;
      }
    }
  };
  const entry = (e, via, level, model, depth, path) => {
    if (SKIP_GROUP.test(e.attrs.name || '') || SKIP_GROUP.test(via.attrs.name || '')) return;
    let lv = level, m = model;
    if (e.name === 'selectionEntry') {
      if (e.attrs.type === 'model') { lv = 'model'; m = e; }
      else if (e.attrs.type === 'upgrade' && level !== 'gear') lv = LEVELS[level] < LEVELS.gear ? 'gear' : level;
    }
    const next = new Set(path); next.add(e);
    visit(e, lv, m, depth + 1, next);
  };
  const profile = (p, level, model) => {
    const t = p.attrs.typeName || '';
    const key = p.attrs.id || p;
    if (/^unit$/i.test(t)) {
      if (level !== 'gear') acc.unitProfiles.push({ p, model });
      return;
    }
    if (/^(ranged|melee) weapons$/i.test(t)) {
      let rec = seenProfiles.get(key);
      if (!rec) { rec = { p, models: new Set() }; seenProfiles.set(key, rec); acc.weapons.push(rec); }
      rec.models.add(model);
      return;
    }
    if (/^abilities$/i.test(t) && level !== 'gear' && /^invulnerable save/i.test(p.attrs.name || '')) {
      const v = intOf(/(\d)\+/.exec(`${p.attrs.name} ${chars(p).Description || ''}`)?.[1]);
      if (v) acc.inv.push(v);
    }
    if (/^abilities$/i.test(t) && level !== 'gear' && /^feel no pain/i.test(p.attrs.name || '')) {
      const v = intOf(/(\d)\+/.exec(`${p.attrs.name} ${(chars(p).Description || '').slice(0, 60)}`)?.[1]);
      if (v) acc.fnp.push(v);
    }
  };
  const rule = (link, target) => {
    const base = link.attrs.name || target.attrs.name || '';
    if (!/^feel no pain/i.test(base)) return;
    const appended = kids(kid(link, 'modifiers'), 'modifier')
      .filter((x) => x.attrs.field === 'name' && x.attrs.type === 'append' && !kid(x, 'conditions') && !kid(x, 'conditionGroups'))
      .map((x) => x.attrs.value).join(' ');
    const v = intOf(/(\d)\+/.exec(`${base} ${appended}`)?.[1]);
    if (v) acc.fnp.push(v);
  };
  visit(unitNode, unitNode.attrs.type === 'model' ? 'model' : 'unit', unitNode.attrs.type === 'model' ? unitNode : null, 0, new Set([unitNode]));
  for (const c of kids(kid(unitNode, 'costs'), 'cost')) if (/^pts$/i.test(c.attrs.name)) acc.points = Number(c.attrs.value) || null;
  return acc;
}

/* ------------------------------------------------------------ model counts */

function bounds(node) {
  let min = null, max = null;
  for (const c of kids(kid(node, 'constraints'), 'constraint')) {
    if (c.attrs.field !== 'selections' || c.attrs.scope !== 'parent') continue;
    const v = Number(c.attrs.value);
    if (c.attrs.type === 'min') min = v;
    if (c.attrs.type === 'max') max = v;
  }
  return { min, max };
}

/**
 * Count models below `node`: {min, max, models: [{model, max}]}.
 * Unit composition is either model entries with min/max constraints, groups
 * bounding them, or "pick one" groups of upgrade options ("1 Sergeant and 9
 * Troopers" / "2 Sergeants and 18 Troopers"), which count as alternatives.
 */
function countModels(node, resolve, depth = 0, path = new Set(), alternatives = false) {
  const out = { min: 0, max: 0, models: [] };
  if (depth > 10) return out;
  const children = [];
  for (const e of grand(node, 'selectionEntries', 'selectionEntry')) children.push([e, e]);
  for (const g of grand(node, 'selectionEntryGroups', 'selectionEntryGroup')) children.push([g, g]);
  for (const l of grand(node, 'entryLinks', 'entryLink')) {
    const t = resolve(l.attrs.targetId);
    if (t && !path.has(t)) children.push([t, l]);
  }
  const options = [];
  for (const [e, via] of children) {
    if (SKIP_GROUP.test(e.attrs.name || '') || SKIP_GROUP.test(via.attrs.name || '')) continue;
    const b = via === e ? bounds(e) : (() => { const a = bounds(via), t = bounds(e); return { min: a.min ?? t.min, max: a.max ?? t.max }; })();
    if (e.name === 'selectionEntry' && e.attrs.type === 'model') {
      const min = b.min ?? 0, max = b.max ?? Infinity; // unbounded: the enclosing group's limit applies
      out.min += min; out.max += max;
      out.models.push({ model: e, max });
      continue;
    }
    const next = new Set(path); next.add(e);
    const isGroup = e.name === 'selectionEntryGroup';
    const inner = countModels(e, resolve, depth + 1, next, isGroup && b.max === 1);
    if (!inner.models.length) continue;
    let { min, max } = inner;
    if (isGroup && !inner.alternatives) { // a "pick one" group's max counts options, not models
      if (b.max !== null) max = Math.min(max, b.max);
      if (b.min !== null && b.min > min) min = b.min;
    }
    max = Math.max(min, max);
    const part = { min, max, models: inner.models.map((x) => ({ ...x, max: Math.min(x.max, max) })) };
    if (alternatives && e.name === 'selectionEntry' && e.attrs.type !== 'unit') { options.push(part); continue; }
    out.min += part.min; out.max += part.max;
    out.models.push(...part.models);
  }
  if (options.length) {
    out.alternatives = true;
    out.min += Math.min(...options.map((o) => o.min));
    out.max += Math.max(...options.map((o) => o.max));
    const byModel = new Map();
    for (const o of options) for (const m of o.models) byModel.set(m.model, Math.max(byModel.get(m.model) ?? 0, m.max));
    for (const [model, max] of byModel) out.models.push({ model, max });
  }
  return out;
}

/* ------------------------------------------------------------ catalogue -> units */

const ROOT_TYPES = new Set(['unit', 'model']);

/** Root unit entries a catalogue offers: [{entry, defined:boolean}] */
function rootUnits(cat, resolve) {
  const out = [];
  for (const e of grand(cat.doc, 'selectionEntries', 'selectionEntry')) {
    if (ROOT_TYPES.has(e.attrs.type)) out.push({ entry: e, defined: true, hidden: e.attrs.hidden === 'true' });
  }
  for (const l of grand(cat.doc, 'entryLinks', 'entryLink')) {
    const t = resolve(l.attrs.targetId);
    if (t && t.name === 'selectionEntry' && ROOT_TYPES.has(t.attrs.type)) {
      out.push({ entry: t, defined: cat.ids.get(t.attrs.id) === t, hidden: l.attrs.hidden === 'true' || t.attrs.hidden === 'true' });
    }
  }
  return out;
}

const pickProfileStats = (p) => {
  const c = chars(p);
  return { M: intOf(c.M), T: intOf(c.T), Sv: intOf(c.SV ?? c.Sv), W: intOf(c.W), Ld: intOf(c.LD ?? c.Ld), OC: intOf(c.OC) };
};

/**
 * Convert one unit entry. Returns { unit } or { error }.
 */
export function convertUnit(entry, resolve, faction) {
  const name = cleanName(entry.attrs.name);
  const acc = walkUnit(entry, resolve);
  if (!acc.unitProfiles.length) return { error: 'no Unit profile' };
  // Defender stat line: the model type the unit has most of (e.g. the bodyguard, not the sergeant).
  const counts = entry.attrs.type === 'model' ? { min: 1, max: 1, models: [{ model: entry, max: 1 }] } : countModels(entry, resolve);
  let best = acc.unitProfiles[0];
  let bestMax = -1;
  for (const up of acc.unitProfiles) {
    const m = counts.models.find((x) => x.model === up.model);
    const mx = m ? m.max : 0;
    if (mx > bestMax) { best = up; bestMax = mx; }
  }
  const stats = pickProfileStats(best.p);
  if (!(stats.T >= 1 && stats.T <= 30) || !(stats.Sv >= 2 && stats.Sv <= 7) || !(stats.W >= 1 && stats.W <= 120)) {
    return { error: `bad stat line T${stats.T} Sv${stats.Sv} W${stats.W}` };
  }
  const weapons = [];
  const weaponErrors = [];
  const sig = new Map();
  const unitMax = Number.isFinite(counts.max) ? Math.max(1, Math.min(30, counts.max)) : Math.max(1, Math.min(30, counts.min || 1));
  // How many models can carry a weapon: the summed size of the model types that have it as an option.
  const carriersOf = (models) => {
    let n = 0;
    for (const m of models) n += m ? (counts.models.find((x) => x.model === m)?.max ?? 1) : unitMax;
    return Math.max(1, Math.min(unitMax, n));
  };
  for (const { p, models } of acc.weapons) {
    const r = convertWeapon(p);
    if (r.error) { weaponErrors.push(`${cleanName(p.attrs.name)}: ${r.error}`); continue; }
    const w = r.weapon;
    w.carriers = carriersOf(models);
    const key = JSON.stringify([w.name.toLowerCase(), w.type, w.A, w.skill, w.S, w.AP, w.D, w.keywords]);
    const prev = sig.get(key);
    if (prev) { prev.carriers = Math.max(prev.carriers, w.carriers); continue; }
    sig.set(key, w);
    weapons.push(w);
  }
  // Most widely carried first (the squad's main gun before the sergeant's options), ranged before melee.
  weapons.sort((a, b) => (a.type === b.type ? 0 : a.type === 'ranged' ? -1 : 1) || b.carriers - a.carriers);
  // Weaponless datasheets (Drop Pods, Spore Mines, fortifications) are still valid targets.
  // Unique weapon ids; same name with a different profile gets a qualifier.
  const ids = new Set();
  const nameCount = new Map();
  const nk = (w) => `${w.type}|${w.name.toLowerCase()}`;
  for (const w of weapons) nameCount.set(nk(w), (nameCount.get(nk(w)) || 0) + 1);
  for (const w of weapons) {
    if (nameCount.get(nk(w)) > 1) w.name = `${w.name} (${w.skill ? `${w.skill}+, ` : ''}S${w.S} AP${w.AP} D${w.D})`;
    let id = w.id, i = 2;
    while (ids.has(id)) id = `${w.id}-${i++}`;
    ids.add(id); w.id = id;
  }
  const keywords = [];
  for (const k of acc.categories) {
    if (!k) continue;
    const kw = k.replace(/^Faction:\s*/i, '').trim();
    if (kw && !/^(configuration|reference|uncategorised)$/i.test(kw) && !keywords.includes(kw)) keywords.push(kw);
  }
  const min = Math.max(1, Math.min(30, counts.min || 1));
  const max = Number.isFinite(counts.max) ? Math.max(min, Math.min(30, counts.max)) : min;
  const inv = acc.inv.length ? Math.min(...acc.inv) : null;
  const fnp = acc.fnp.length ? Math.min(...acc.fnp) : null;
  const unit = {
    id: slug(name), name, faction, aliases: [], keywords,
    models: { min, max, default: min },
    profile: { ...stats, inv: inv && inv >= 2 && inv <= 6 ? inv : null, fnp: fnp && fnp >= 2 && fnp <= 6 ? fnp : null },
    weapons,
    source: 'bsdata',
  };
  if (acc.points) unit.points = acc.points;
  return { unit, weaponErrors };
}

/**
 * Convert a set of parsed BSData files into units.
 * @param {{file:string, doc:object}[]} files
 * @returns {{units:object[], report:object}}
 */
export function convertBsdata(files, { includeHidden = false } = {}) {
  const index = buildIndex(files);
  const resolvers = new Map(index.cats.map((c) => [c.id, resolver(index, c)]));
  // Who offers each unit entry?
  const claims = new Map(); // entry -> [{cat, defined, hidden}]
  for (const cat of index.cats) {
    if (cat.gameSystem) continue;
    for (const r of rootUnits(cat, resolvers.get(cat.id))) {
      if (!claims.has(r.entry)) claims.set(r.entry, []);
      claims.get(r.entry).push({ cat, ...r });
    }
  }
  const rootCount = new Map(index.cats.map((c) => [c.id, 0]));
  for (const list of claims.values()) for (const c of list) rootCount.set(c.cat.id, rootCount.get(c.cat.id) + 1);
  const owner = (entry, list) => {
    const definer = list.find((c) => c.defined && !c.cat.library);
    if (definer) return definer;
    const home = index.cats.find((c) => c.ids.get(entry.attrs.id) === entry);
    const homeFaction = home ? factionName(home.name) : null;
    const nonLib = list.filter((c) => !c.cat.library);
    const pool = nonLib.length ? nonLib : list;
    const match = pool.find((c) => factionName(c.cat.name) === homeFaction);
    if (match) return match;
    // Shared library datasheets no claimant "owns" (Titans, Heresy Legends): file them under the library.
    if (home && home.library && !home.gameSystem && pool.length > 1) return { cat: home, defined: true, hidden: false };
    return [...pool].sort((a, b) => rootCount.get(b.cat.id) - rootCount.get(a.cat.id) || a.cat.name.localeCompare(b.cat.name))[0];
  };

  const report = { entries: 0, converted: 0, skipped: [], hidden: 0, weaponsDropped: 0, byFaction: {} };
  const units = [];
  for (const [entry, list] of claims) {
    report.entries++;
    const own = owner(entry, list);
    if (!includeHidden && list.every((c) => c.hidden)) { report.hidden++; continue; }
    const faction = factionName(own.cat.name);
    let r;
    try { r = convertUnit(entry, resolvers.get(own.cat.id), faction); } catch (err) { r = { error: `threw: ${err.message}` }; }
    if (r.weaponErrors) report.weaponsDropped += r.weaponErrors.length;
    if (r.error) { report.skipped.push({ name: entry.attrs.name, faction, reason: r.error }); continue; }
    units.push(r.unit);
  }
  // De-duplicate identical datasheets (same name + faction) and make ids unique.
  const seen = new Set();
  const out = [];
  for (const u of units.sort((a, b) => a.faction.localeCompare(b.faction) || a.name.localeCompare(b.name))) {
    const key = `${u.faction}|${u.name}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  assignIds(out);
  for (const u of out) report.byFaction[u.faction] = (report.byFaction[u.faction] || 0) + 1;
  report.converted = out.length;
  return { units: out, report };
}

/** Unique kebab-case ids: name slug, faction-qualified on collision. Mutates `units`. */
export function assignIds(units, taken = new Set()) {
  const counts = new Map();
  for (const u of units) counts.set(slug(u.name), (counts.get(slug(u.name)) || 0) + 1);
  for (const u of units) {
    const base = slug(u.name) || 'unit';
    let id = counts.get(base) > 1 || taken.has(base) ? `${slug(u.faction)}-${base}` : base;
    let i = 2;
    const stem = id;
    while (taken.has(id)) id = `${stem}-${i++}`;
    taken.add(id); u.id = id;
  }
  return units;
}
