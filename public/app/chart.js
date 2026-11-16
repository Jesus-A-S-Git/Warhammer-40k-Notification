// Inline-SVG price history chart: step line + soft area, dashed RRP line,
// lowest-price marker, hover/keyboard crosshair with a tooltip.
import { el } from '../ui.js';
import { money, fmtDate } from './kit.js';

const NS = 'http://www.w3.org/2000/svg';
const mk = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v));
  return n;
};

/**
 * @param {{t:string,p:number,r?:string}[]} points oldest first
 * @param {{rrp?:number|null, storeName?:(id)=>string, height?:number}} o
 */
export function priceChart(points, { rrp = null, storeName = (x) => x ?? '', height = 220, width = 640 } = {}) {
  const wrap = el('div', { class: 'pchart' });
  if (points.length < 2) {
    wrap.append(el('div', { class: 'empty slim' }, el('span', {}, points.length ? `One price so far: ${money(points[0].p)} on ${fmtDate(points[0].t)}. History builds up with each daily refresh.` : 'No price history yet.')));
    return wrap;
  }
  const W = Math.max(280, Math.round(width)); const H = height;
  const pad = { l: 48, r: 12, t: 16, b: 28 };
  const ts = points.map((x) => Date.parse(x.t));
  const t0 = ts[0]; const t1 = ts.at(-1);
  const vals = points.map((x) => x.p).concat(rrp ? [rrp] : []);
  let lo = Math.min(...vals); let hi = Math.max(...vals);
  const span = Math.max(hi - lo, hi * 0.04, 1);
  lo -= span * 0.12; hi += span * 0.12;
  if (lo < 0) lo = 0;
  const X = (t) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const minP = Math.min(...points.map((x) => x.p));
  const minI = points.findLastIndex ? points.findLastIndex((x) => x.p === minP) : points.map((x) => x.p).lastIndexOf(minP);

  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: '0', class: 'pchart-svg',
    'aria-label': `Best price history, ${points.length} days: from ${money(points[0].p)} on ${fmtDate(points[0].t)} to ${money(points.at(-1).p)} on ${fmtDate(points.at(-1).t)}; lowest ${money(minP)}. Use left and right arrow keys to read each day.` });
  const defs = mk('defs');
  const gid = `pg${Math.random().toString(36).slice(2, 8)}`;
  const grad = mk('linearGradient', { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 });
  grad.append(mk('stop', { offset: '0%', 'stop-color': 'currentColor', 'stop-opacity': '.22' }), mk('stop', { offset: '100%', 'stop-color': 'currentColor', 'stop-opacity': '0' }));
  defs.append(grad); svg.append(defs);

  // Grid + y labels (4 ticks).
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) * i) / 3;
    svg.append(mk('line', { class: 'gridline', x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }));
    const t = mk('text', { class: 'label', x: pad.l - 8, y: Y(v) + 4, 'text-anchor': 'end' }); t.textContent = `$${Math.round(v)}`; svg.append(t);
  }
  // X labels: first, middle, last.
  for (const i of [0, Math.floor((points.length - 1) / 2), points.length - 1]) {
    const t = mk('text', { class: 'label', x: X(ts[i]), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle' });
    t.textContent = fmtDate(points[i].t); svg.append(t);
  }
  if (rrp) {
    svg.append(mk('line', { class: 'rrp-line', x1: pad.l, x2: W - pad.r, y1: Y(rrp), y2: Y(rrp) }));
    const t = mk('text', { class: 'label rrp-label', x: W - pad.r, y: Y(rrp) - 6, 'text-anchor': 'end' }); t.textContent = `RRP ${money(rrp)}`; svg.append(t);
  }
  // Step path (a price holds until the next refresh).
  let d = `M${X(ts[0]).toFixed(1)},${Y(points[0].p).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) d += ` H${X(ts[i]).toFixed(1)} V${Y(points[i].p).toFixed(1)}`;
  const area = `${d} V${(H - pad.b).toFixed(1)} H${X(ts[0]).toFixed(1)} Z`;
  const g = mk('g', { class: 'pchart-series' });
  g.append(mk('path', { d: area, fill: `url(#${gid})`, stroke: 'none' }), mk('path', { d, class: 'pchart-line' }));
  svg.append(g);
  // Lowest marker.
  svg.append(mk('circle', { cx: X(ts[minI]), cy: Y(minP), r: 4.5, class: 'pchart-low' }));
  const lowT = mk('text', { class: 'label strong', x: Math.min(W - pad.r - 40, Math.max(pad.l + 40, X(ts[minI]))), y: Math.min(H - pad.b - 6, Y(minP) + 18), 'text-anchor': 'middle' });
  lowT.textContent = `Low ${money(minP)}`; svg.append(lowT);
  // Current dot.
  svg.append(mk('circle', { cx: X(ts.at(-1)), cy: Y(points.at(-1).p), r: 4, class: 'pchart-now' }));

  // Crosshair + tooltip.
  const cross = mk('line', { class: 'pchart-cross', y1: pad.t, y2: H - pad.b, x1: 0, x2: 0, visibility: 'hidden' });
  const dot = mk('circle', { class: 'pchart-dot', r: 5, cx: 0, cy: 0, visibility: 'hidden' });
  svg.append(cross, dot);
  const tip = el('div', { class: 'pchart-tip', hidden: true, role: 'status', 'aria-live': 'polite' });
  let cur = -1;
  const show = (i) => {
    cur = Math.max(0, Math.min(points.length - 1, i));
    const x = X(ts[cur]); const y = Y(points[cur].p);
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible'); dot.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x); dot.setAttribute('cy', y);
    const pt = points[cur];
    tip.replaceChildren(el('strong', {}, money(pt.p)), el('span', {}, `${fmtDate(pt.t, { weekday: 'short', month: 'short', day: 'numeric' })}${pt.r ? ` · ${storeName(pt.r)}` : ''}`),
      rrp ? el('span', { class: pt.p < rrp ? 'savings' : 'muted' }, pt.p < rrp ? `${Math.round((1 - pt.p / rrp) * 100)}% under RRP` : 'at/above RRP') : null);
    tip.hidden = false;
    const rect = svg.getBoundingClientRect();
    const px = (x / W) * rect.width;
    tip.style.left = `${Math.max(4, Math.min(rect.width - 170, px - 80))}px`;
    tip.style.top = `${Math.max(0, (y / H) * rect.height - 74)}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
  svg.addEventListener('pointermove', (e) => {
    const rect = svg.getBoundingClientRect();
    const t = t0 + (((e.clientX - rect.left) / rect.width) * W - pad.l) / (W - pad.l - pad.r) * (t1 - t0);
    let best = 0;
    for (let i = 0; i < ts.length; i++) if (Math.abs(ts[i] - t) < Math.abs(ts[best] - t)) best = i;
    show(best);
  });
  svg.addEventListener('pointerleave', () => { if (document.activeElement !== svg) hide(); });
  svg.addEventListener('focus', () => show(points.length - 1));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); show((cur < 0 ? points.length - 1 : cur) + (e.key === 'ArrowLeft' ? -1 : 1)); }
    else if (e.key === 'Home') { e.preventDefault(); show(0); } else if (e.key === 'End') { e.preventDefault(); show(points.length - 1); }
  });
  wrap.append(svg, tip);
  return wrap;
}

/** Tiny sparkline (no axes). */
export function sparkline(points, { w = 96, h = 28 } = {}) {
  if (points.length < 2) return el('span', { class: 'muted small' }, '—');
  const vals = points.map((x) => x.p);
  const lo = Math.min(...vals); const hi = Math.max(...vals) || 1;
  const X = (i) => 1 + (i / (points.length - 1)) * (w - 2);
  const Y = (v) => 2 + (1 - (v - lo) / Math.max(hi - lo, 0.01)) * (h - 4);
  const svg = mk('svg', { viewBox: `0 0 ${w} ${h}`, class: 'spark', 'aria-hidden': 'true' });
  svg.append(mk('polyline', { points: vals.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' '), class: 'spark-line' }));
  return svg;
}
