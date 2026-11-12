// The full unit catalogue: hand-curated seed datasheets (units.js, with
// nickname aliases) + every datasheet imported from BSData by
// scripts/import-units.js (units.generated.js). Browser-safe: shared by the
// API and the static GitHub Pages build.
import { UNITS } from './units.js';
import { GENERATED_UNITS, GENERATED_META } from './units.generated.js';

const norm = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const slug = (s) => norm(s).replace(/ /g, '-');

export const DATA_SOURCES = [
  { id: 'seed', name: 'Hand-curated starter datasheets', units: UNITS.length },
  { id: 'bsdata', name: GENERATED_META.source, url: GENERATED_META.url, ref: GENERATED_META.ref,
    generatedAt: GENERATED_META.generatedAt, units: GENERATED_META.units,
    licence: 'Community-maintained BattleScribe data; not affiliated with or endorsed by Games Workshop' },
];

/**
 * Seed entries win over imported ones for the same datasheet (same faction and
 * name or alias); imported ids that collide with a seed id get a faction prefix.
 */
export function mergeCatalog(seed, imported) {
  const taken = new Set(seed.map((u) => u.id));
  const names = new Set();
  for (const u of seed) for (const n of [u.name, ...(u.aliases || [])]) names.add(`${norm(u.faction)}|${norm(n)}`);
  const out = [...seed];
  for (const u of imported) {
    if (names.has(`${norm(u.faction)}|${norm(u.name)}`)) continue;
    let id = u.id;
    if (taken.has(id)) id = `${slug(u.faction)}-${u.id}`;
    for (let i = 2; taken.has(id); i++) id = `${slug(u.faction)}-${u.id}-${i}`;
    taken.add(id);
    out.push(id === u.id ? u : { ...u, id });
  }
  return out;
}

export const ALL_UNITS = mergeCatalog(UNITS, GENERATED_UNITS);
