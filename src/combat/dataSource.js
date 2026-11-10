// Unit data source: curated seed datasheets, optionally extended with a
// community CSV export (Wahapedia's 10th-edition export).
//
// Remote import is OFF by default; enable with UNIT_DATA_REMOTE=1.
// Wahapedia asks people not to hammer the site, so:
//   * every request goes through politeFetch (robots.txt, caching, backoff)
//   * the host budget is 2 requests/minute, burst 1, one at a time
//   * responses are cached for 24 hours and the merged list is reused for 24h
//   * the import runs in the background; the API keeps serving seed data
//     meanwhile, and falls back to seed data on any failure.

import { politeFetch, setHostLimit } from '../shared/httpClient.js';
import { UNITS } from './data/units.js';
import { keywordError } from './engine.js';

export const REMOTE_HOST = 'wahapedia.ru';
export const REMOTE_BASE = `https://${REMOTE_HOST}/wh40k10ed`;
export const REMOTE_LIMIT = { requestsPerMinute: 2, burst: 1, maxConcurrent: 1 };
const DAY_MS = 24 * 3600_000;
const FILES = ['Factions', 'Datasheets', 'Datasheets_models', 'Datasheets_wargear'];

const state = { units: UNITS, loadedAt: 0, loading: null, lastError: null, source: 'seed' };

export function remoteEnabled() { return process.env.UNIT_DATA_REMOTE === '1'; }

/** Current unit list (seed, or seed + imported). Kicks off a background refresh when enabled. */
export function getUnits() {
  if (remoteEnabled() && !state.loading && Date.now() - state.loadedAt > DAY_MS) {
    refreshRemote().catch(() => {});
  }
  return state.units;
}

export function dataSourceStatus() {
  return { source: state.source, remoteEnabled: remoteEnabled(), loadedAt: state.loadedAt || null,
    lastError: state.lastError, units: state.units.length };
}

/** Tests only. */
export function __resetDataSource() {
  Object.assign(state, { units: UNITS, loadedAt: 0, loading: null, lastError: null, source: 'seed' });
}

/**
 * Fetch the CSV export and merge it with the seed list. Never throws: on any
 * failure the seed list is kept and the error recorded.
 * @param {object} [opts]
 * @param {object} [opts.hostLimit] override the per-host budget (tests only)
 */
export function refreshRemote({ hostLimit = REMOTE_LIMIT } = {}) {
  if (state.loading) return state.loading;
  state.loading = (async () => {
    try {
      setHostLimit(REMOTE_HOST, hostLimit);
      const tables = {};
      for (const f of FILES) { // sequential on purpose: one request at a time
        const text = await politeFetch(`${REMOTE_BASE}/${f}.csv`, { as: 'text', ttlMs: DAY_MS, timeoutMs: 20_000, maxRetries: 1 });
        tables[f] = parsePipeCsv(text);
      }
      const imported = normalizeWahapedia(tables);
      if (!imported.length) throw new Error('Remote export contained no usable datasheets');
      state.units = mergeUnits(UNITS, imported);
      state.source = 'seed+remote';
      state.lastError = null;
    } catch (err) {
      state.units = UNITS;
      state.source = 'seed';
      state.lastError = String(err?.message || err);
    } finally {
      state.loadedAt = Date.now();
      state.loading = null;
    }
    return state.units;
  })();
  return state.loading;
}

/** Parse Wahapedia's pipe-separated export (header row, trailing "|"). */
export function parsePipeCsv(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = lines[0].split('|').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split('|');
    const row = {};
    header.forEach((h, i) => { if (h) row[h] = (cells[i] ?? '').trim(); });
    return row;
  });
}

const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
const num = (s) => { const m = /-?\d+/.exec(String(s || '')); return m ? Number(m[0]) : null; };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function weaponKeywords(description) {
  return stripHtml(description).split(',').map((s) => s.trim()).filter((s) => !keywordError(s)) // allowlist, bounded values
    .map((s) => s.replace(/\b\w/g, (c) => c.toUpperCase()));
}

/** Convert the four CSV tables into our unit shape (first model line = profile). */
export function normalizeWahapedia({ Factions = [], Datasheets = [], Datasheets_models = [], Datasheets_wargear = [] }) {
  const factionName = new Map(Factions.map((f) => [f.id, f.name]));
  const modelsBy = new Map();
  for (const m of Datasheets_models) if (!modelsBy.has(m.datasheet_id)) modelsBy.set(m.datasheet_id, m);
  const gearBy = new Map();
  for (const w of Datasheets_wargear) {
    if (!gearBy.has(w.datasheet_id)) gearBy.set(w.datasheet_id, []);
    gearBy.get(w.datasheet_id).push(w);
  }
  const out = [];
  for (const d of Datasheets) {
    if (d.virtual === 'true') continue;
    const m = modelsBy.get(d.id);
    const T = num(m?.T), Sv = num(m?.Sv), W = num(m?.W);
    if (!m || !T || !Sv || !W) continue;
    const seen = new Set();
    const weapons = [];
    for (const w of gearBy.get(d.id) || []) {
      const S = num(w.S), A = String(w.A || '').toUpperCase().replace(/\s/g, ''), D = String(w.D || '').toUpperCase().replace(/\s/g, '');
      if (!S || !/^(\d+|\d?D[36](\+\d+)?)$/.test(A) || !/^(\d+|\d?D[36](\+\d+)?)$/.test(D)) continue;
      const type = /melee/i.test(w.type || w.range) ? 'melee' : 'ranged';
      const keywords = weaponKeywords(w.description);
      const torrent = keywords.some((k) => /^torrent$/i.test(k));
      let id = slug(w.name) || `weapon-${weapons.length + 1}`;
      while (seen.has(id)) id += '-x';
      seen.add(id);
      weapons.push({ id, name: stripHtml(w.name), type, range: type === 'melee' ? 'Melee' : num(w.range),
        A, skill: torrent ? null : (num(w.BS_WS) ?? 4), S, AP: Math.min(0, num(w.AP) ?? 0), D, keywords });
    }
    if (!weapons.length) continue;
    const name = stripHtml(d.name);
    out.push({
      id: `wh-${slug(d.id)}`, name, faction: factionName.get(d.faction_id) || d.faction_id || 'Unknown',
      aliases: [name.toLowerCase()], keywords: [], models: { min: 1, max: 30, default: 5 },
      profile: { M: num(m.M), T, Sv, inv: num(m.inv_sv) || null, W, Ld: num(m.Ld), OC: num(m.OC), fnp: null },
      weapons, source: 'wahapedia',
    });
  }
  return out;
}

/** Seed datasheets win over imported ones with the same name. */
export function mergeUnits(seed, imported) {
  const names = new Set(seed.map((u) => u.name.toLowerCase()));
  return [...seed, ...imported.filter((u) => !names.has(u.name.toLowerCase()))];
}
