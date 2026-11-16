// Client-side stand-in for POST /api/prices/army, used only when the endpoint
// is not deployed. Same response shape; matching is simpler than the server's.
import { unitsBrief, catalog, cart } from './api.js';
import { resolveUnit } from '../lib/combat/unitSearch.js';
import { bestMatches, normalize } from '../lib/search/fuzzy.js';

const SKIP = /^(\+{2,}|={2,}|-{3,}|#|characters?$|battleline$|dedicated transports?$|other datasheets$|allied units$|fortifications?$|strike force|incursion|onslaught|combat patrol \(|detachment|army roster|exported with|total|points? ?:|\d+\s*(pts|points)$)/i;

function parseLines(text) {
  const out = [];
  let current = null;
  for (const rawLine of String(text).split(/\r?\n/).slice(0, 400)) {
    const raw = rawLine.trim();
    if (!raw || SKIP.test(raw)) { if (!raw) current = null; continue; }
    const bullet = /^[•*\-–·]/.test(raw) || /^\s{2,}/.test(rawLine);
    let s = raw.replace(/^[•*\-–·]+\s*/, '');
    let qty = null;
    let m = /^(\d{1,3})\s*[x×]?\s+(.+)$/i.exec(s) || /^(\d{1,3})[x×](.+)$/i.exec(s);
    if (m) { qty = Number(m[1]); s = m[2]; } else if ((m = /^(.+?)\s*[x×]\s*(\d{1,3})$/i.exec(s))) { qty = Number(m[2]); s = m[1]; }
    s = s.replace(/[([]\s*\d+\s*(pts|points?)\s*[)\]]/ig, '').replace(/\s*[:|].*$/, '').replace(/\s+-\s+\d+.*$/, '').trim();
    if (!s || s.length < 3) continue;
    if (bullet && current) {
      // Model lines inside a unit block ("• 4x Intercessor") add up to the unit's size.
      const first = normalize(current.unitName ?? current.raw).split(' ')[0];
      if (qty && first && normalize(s).includes(first)) { current.models = (current.models ?? 0) + qty; }
      continue;
    }
    current = { raw, name: s, qty };
    out.push(current);
  }
  return out;
}

export async function armyFallback(list, owned = {}) {
  const [units, cat] = await Promise.all([unitsBrief(), catalog()]);
  const products = cat.products ?? [];
  const kits = products.filter((p) => p.category === 'kit' || p.category === 'combat-patrol');
  const lines = []; const unmatched = []; const need = new Map();
  for (const l of parseLines(list)) {
    const u = resolveUnit(units, l.name, { min: 0.8, minCoverage: 0.4 });
    l.unitName = u?.name ?? null;
    const qty = l.models ?? l.qty ?? u?.models?.default ?? 1;
    let prod = null;
    if (u) {
      const m = bestMatches(u.name, kits, { key: (p) => [p.name.replace(/^[^:]*:\s*/, ''), p.name, ...(p.aliases ?? [])], limit: 1, threshold: 0.8 })[0];
      prod = m && (normalize(m.item.factionName ?? '').length === 0 || normalize(`${u.faction}`).includes(normalize(m.item.factionName).split(' ')[0]) || m.score > 0.95) ? m.item : null;
    }
    const per = prod?.models ?? null;
    const boxes = prod ? Math.max(1, per ? Math.ceil(qty / per) : 1) : 0;
    if (!u) unmatched.push(l.raw);
    lines.push({ raw: l.raw, qty, unitName: u?.name ?? null, unitId: u?.id ?? null, productId: prod?.id ?? null, boxes, modelsPerBox: per,
      note: !u ? 'No matching datasheet' : !prod ? 'No boxed kit tracked for this unit' : null });
    if (prod) need.set(prod.id, (need.get(prod.id) ?? 0) + boxes);
  }
  const items = [...need].map(([productId, qty]) => ({ productId, qty: Math.max(0, qty - (Number(owned[productId]) || 0)) })).filter((x) => x.qty > 0);
  let plan = null;
  if (items.length) {
    try { plan = await cart(items.map((x) => ({ id: x.productId, qty: x.qty }))); } catch { plan = null; }
  }
  const rrpOf = (id) => products.find((p) => p.id === id)?.USD ?? null;
  const rrp = items.reduce((t, x) => (rrpOf(x.productId) == null ? t : t + rrpOf(x.productId) * x.qty), 0) || null;
  const best = plan?.total ?? null;
  return { lines, unmatched, items, plan, totals: { rrp, best, savings: rrp != null && best != null ? Math.round((rrp - best) * 100) / 100 : null } };
}
