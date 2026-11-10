// Warhammer 40,000 (10th edition) attack-sequence engine.
//
// Pure and isomorphic: no I/O and no Node-only imports, so it can be imported by
// the server and, unchanged, by a browser as an ES module.
//
// Rules implemented (10th edition core rules + keyword abilities):
//  * Attacks: fixed or dice ("2", "D3", "D6+1", "2D6") per model. Blast (+1 A per
//    5 models in the target unit), Rapid Fire X (+X A at half range).
//  * Hit roll vs BS/WS. Unmodified 1 always fails, unmodified 6 always hits, net
//    modifier capped at +/-1. Torrent auto-hits (no hit roll, so no Critical Hits).
//    Heavy: +1 to hit if the unit Remained Stationary. Re-rolls: ones / failed.
//    Critical Hit on an unmodified roll >= critHit (default 6).
//  * Lethal Hits: a Critical Hit automatically wounds (it is NOT a Critical Wound,
//    so it never triggers Devastating Wounds).
//    Sustained Hits X: a Critical Hit scores X additional hits (X may be dice).
//  * Wound roll from the S vs T table, modifier capped at +/-1, unmodified 1 fails,
//    unmodified 6 wounds. Lance: +1 to wound if the bearer charged.
//    Twin-linked: re-roll the wound roll. Anti-KEYWORD N+: Critical Wound on N+.
//  * Devastating Wounds — rule version: 10th ed. as amended by the 2024 Balance
//    Dataslate. A Critical Wound means no saving throw of any kind can be made;
//    the attack keeps its normal Damage (it is NOT converted into spilling mortal
//    wounds). Such attacks are allocated after all other attacks made by the
//    attacking unit, so the engine defers them to the end of the volley.
//  * Saves: armour Sv worsened by AP; Benefit of Cover (+1 to the armour save vs
//    ranged attacks, except models with Sv 3+ or better vs AP 0; Ignores Cover);
//    invulnerable save is unaffected by AP and the defender uses the better save;
//    unmodified 1 always fails.
//  * Damage: fixed or dice; Melta X (+X Damage at half range); defender Damage
//    reduction (-N, minimum 1); Feel No Pain X+ rolled per point of damage.
//  * Allocation: damage is applied model by model. Excess damage from one attack is
//    lost (no spill); mortal wounds DO spill (applyDamage(..., { spill: true })).
//
// Method: exact dynamic programming over the defender state
// (models alive, damage on the wounded model, pending Devastating-Wounds attacks),
// mixing over random attack counts / damage / Sustained Hits exactly. When the
// state space would be too large, a seeded Monte Carlo simulation is used instead.
//
// Simplifications: every defending model shares one profile (no mixed-W
// sergeants or Characters); attacker-only re-rolls are "re-roll failures" (not
// "fish for crits"); Hazardous, Precision, Pistol, Assault, Indirect Fire and
// similar keywords don't change the maths and are ignored.

export const RULES_VERSION = '10th edition core rules (Devastating Wounds per 2024 Balance Dataslate)';

const D6 = [1, 2, 3, 4, 5, 6];

/* ------------------------------------------------------------------ dice */

/**
 * Parse a dice expression ("3", "D3", "D6+2", "2D6", "2D3+1").
 * @returns {{text:string, dist:number[], min:number, max:number, mean:number}}
 *   dist[v] = P(value == v)
 */
export function parseDice(expr) {
  const text = String(expr ?? '').trim().toUpperCase().replace(/\s+/g, '');
  let m = /^(\d{1,3})$/.exec(text);
  if (m) {
    const v = Number(m[1]);
    const dist = new Array(v + 1).fill(0); dist[v] = 1;
    return { text, dist, min: v, max: v, mean: v };
  }
  m = /^(\d?)D(3|6)(?:\+(\d{1,2}))?$/.exec(text);
  if (!m) throw new Error(`Invalid dice expression "${expr}"`);
  const n = m[1] === '' ? 1 : Number(m[1]);
  if (n < 1 || n > 9) throw new Error(`Invalid dice expression "${expr}"`);
  const sides = Number(m[2]);
  const plus = m[3] ? Number(m[3]) : 0;
  const one = new Array(sides + 1).fill(1 / sides); one[0] = 0;
  let dist = [1];
  for (let i = 0; i < n; i++) dist = convolve(dist, one);
  dist = shift(dist, plus);
  return describe(text, dist);
}

function describe(text, dist) {
  let min = -1, max = 0, mean = 0;
  dist.forEach((p, v) => { if (p > 0) { if (min < 0) min = v; max = v; mean += v * p; } });
  return { text, dist, min: Math.max(0, min), max, mean };
}

export function convolve(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (!a[i]) continue;
    for (let j = 0; j < b.length; j++) if (b[j]) out[i + j] += a[i] * b[j];
  }
  return out;
}

function shift(dist, k) {
  if (!k) return dist.slice();
  return new Array(k).fill(0).concat(dist);
}

function distPow(dist, n) {
  let out = [1];
  for (let i = 0; i < n; i++) out = convolve(out, dist);
  return out;
}

/* ------------------------------------------------------------- keywords */

/** Turn datasheet keyword strings into a structured object. */
export function parseKeywords(list = []) {
  const k = {
    lethalHits: false, sustainedHits: null, devastatingWounds: false, twinLinked: false,
    torrent: false, heavy: false, blast: false, rapidFire: 0, melta: 0, lance: false,
    ignoresCover: false, anti: [], other: [],
  };
  for (const raw of list) {
    const s = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
    let m;
    if (s === 'lethal hits') k.lethalHits = true;
    else if ((m = /^sustained hits (\d?d[36](?:\+\d+)?|\d+)$/.exec(s))) k.sustainedHits = m[1].toUpperCase();
    else if (s === 'devastating wounds') k.devastatingWounds = true;
    else if (s === 'twin-linked' || s === 'twin linked') k.twinLinked = true;
    else if (s === 'torrent') k.torrent = true;
    else if (s === 'heavy') k.heavy = true;
    else if (s === 'blast') k.blast = true;
    else if ((m = /^rapid fire (\d+)$/.exec(s))) k.rapidFire = Number(m[1]);
    else if ((m = /^melta (\d+)$/.exec(s))) k.melta = Number(m[1]);
    else if (s === 'lance') k.lance = true;
    else if (s === 'ignores cover') k.ignoresCover = true;
    else if ((m = /^anti-(.+?) ([2-6])\+$/.exec(s))) k.anti.push({ keyword: m[1], threshold: Number(m[2]) });
    else k.other.push(String(raw));
  }
  return k;
}

/* ---------------------------------------------------------- roll tables */

const clampMod = (m) => Math.max(-1, Math.min(1, m || 0));

/** S vs T wound roll target (2..6). */
export function woundTarget(S, T) {
  if (S >= 2 * T) return 2;
  if (S > T) return 3;
  if (S === T) return 4;
  if (S * 2 <= T) return 6;
  return 5;
}

function classify(r, target, mod, crit) {
  if (r >= crit) return 'crit';       // unmodified crit (6 by default) always succeeds
  if (r === 1) return 'fail';          // unmodified 1 always fails
  return r + mod >= target ? 'ok' : 'fail';
}

/**
 * Probability of fail / ok (non-critical success) / crit for one D6 test
 * (hit roll or wound roll) with an optional single re-roll.
 * @param {number} target  e.g. BS 3 for "3+"
 * @param {number} mod     summed modifier (capped to +/-1 here)
 * @param {number} crit    critical threshold (2..6)
 * @param {'none'|'ones'|'failed'} reroll
 */
export function rollTest(target, mod = 0, crit = 6, reroll = 'none') {
  const m = clampMod(mod);
  const single = { fail: 0, ok: 0, crit: 0 };
  for (const r of D6) single[classify(r, target, m, crit)] += 1 / 6;
  const out = { fail: 0, ok: 0, crit: 0 };
  for (const r of D6) {
    const c = classify(r, target, m, crit);
    const rerolled = (reroll === 'ones' && r === 1) || (reroll === 'failed' && c === 'fail');
    if (rerolled) for (const key of ['fail', 'ok', 'crit']) out[key] += single[key] / 6;
    else out[c] += 1 / 6;
  }
  return out;
}

/** Resolve the save a defender gets against a weapon. */
export function saveFor({ Sv, inv, cover = false }, { AP = 0, ranged = true, ignoresCover = false } = {}) {
  const ap = Math.min(0, AP);
  let armour = Sv - ap;
  // Benefit of Cover: +1 vs ranged attacks, not for Sv 3+ or better vs AP 0.
  const coverApplies = cover && ranged && !ignoresCover && !(ap === 0 && Sv <= 3);
  if (coverApplies) armour -= 1;
  armour = Math.max(2, armour);                 // unmodified 1 always fails
  const invuln = inv ? Math.max(2, inv) : null; // invulnerable saves ignore AP
  let target = armour, used = 'armour';
  if (invuln && invuln < armour) { target = invuln; used = 'invulnerable'; }
  if (target > 6) { used = 'none'; target = 7; }
  const pSave = target > 6 ? 0 : (7 - target) / 6;
  return { target, used, pSave, pFail: 1 - pSave, armour, invuln, coverApplied: coverApplies };
}

function binom(n, k) {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** Damage per unsaved wound after Melta, damage reduction and Feel No Pain. */
export function damageDistribution({ D, melta = 0, halfRange = false, damageReduction = 0, fnp = null }) {
  const base = parseDice(D);
  let dist = base.dist.slice();
  if (melta && halfRange) dist = shift(dist, melta);
  if (damageReduction > 0) {
    const red = [0];
    dist.forEach((p, v) => {
      if (!p) return;
      const nv = v === 0 ? 0 : Math.max(1, v - damageReduction);
      red[nv] = (red[nv] || 0) + p;
    });
    dist = Array.from(red, (x) => x || 0);
  }
  const preFnp = describe('', dist);
  if (fnp && fnp >= 2 && fnp <= 6) {
    const pIgnore = (7 - fnp) / 6, pThrough = 1 - pIgnore;
    const out = new Array(dist.length).fill(0);
    dist.forEach((p, d) => {
      if (!p) return;
      for (let k = 0; k <= d; k++) out[k] += p * binom(d, k) * pThrough ** k * pIgnore ** (d - k);
    });
    dist = out;
  }
  return { dist, mean: describe('', dist).mean, meanBeforeFnp: preFnp.mean, max: dist.length - 1 };
}

/* ------------------------------------------------------- allocation */

/**
 * Apply one damage packet to the defender state.
 * No spill (normal attacks): excess damage beyond the current model is lost.
 * spill: true (mortal wounds): excess carries over to the next model.
 */
export function applyDamage(state, d, { W, spill = false } = {}) {
  let { alive, dmg } = state;
  let left = d;
  while (left > 0 && alive > 0) {
    const need = W - dmg;
    if (left >= need) { alive -= 1; dmg = 0; left = spill ? left - need : 0; }
    else { dmg += left; left = 0; }
  }
  return { alive, dmg };
}

/* -------------------------------------------------------- planning */

function plan(weapon, defender, am, dm) {
  const kw = parseKeywords(weapon.keywords);
  const ranged = weapon.type !== 'melee';
  const notes = [];
  // Overrides from attacker modifiers.
  const lethal = kw.lethalHits || !!am.lethalHits;
  const sustainedExpr = am.sustainedHits && am.sustainedHits !== '0' ? String(am.sustainedHits) : kw.sustainedHits;
  const dev = kw.devastatingWounds || !!am.devastatingWounds;
  const torrent = kw.torrent;

  // Attacks.
  const perModel = parseDice(weapon.A);
  let bonus = 0;
  if (kw.blast) { const b = Math.floor(defender.models / 5); bonus += b; if (b) notes.push(`Blast: +${b} attack(s) per model`); }
  if (kw.rapidFire && am.halfRange && ranged) { bonus += kw.rapidFire; notes.push(`Rapid Fire ${kw.rapidFire}: +${kw.rapidFire} attack(s) per model at half range`); }
  const perModelDist = shift(perModel.dist, bonus);
  const attacksDist = distPow(perModelDist, weapon.models);
  const attacks = describe('', attacksDist);

  // Hit roll.
  let hitModRaw = (am.hitMod || 0) + (dm.hitMod || 0);
  if (kw.heavy && am.stationary && ranged) { hitModRaw += 1; notes.push('Heavy: +1 to hit (remained stationary)'); }
  const critHit = am.critHit || 6;
  const hit = torrent ? { fail: 0, ok: 1, crit: 0 } : rollTest(weapon.skill, hitModRaw, critHit, am.rerollHits || 'none');
  if (torrent) notes.push('Torrent: hits automatically');

  // Sustained Hits.
  const sustained = sustainedExpr ? parseDice(sustainedExpr) : parseDice('0');

  // Wound roll.
  const wTarget = woundTarget(weapon.S, defender.T);
  let woundModRaw = (am.woundMod || 0) + (dm.woundMod || 0);
  if (kw.lance && am.charged) { woundModRaw += 1; notes.push('Lance: +1 to wound (charged)'); }
  const defKw = (defender.keywords || []).map((x) => String(x).toLowerCase());
  let critWound = am.critWound || 6;
  for (const a of kw.anti) {
    if (defKw.includes(a.keyword)) { critWound = Math.min(critWound, a.threshold); notes.push(`Anti-${a.keyword} ${a.threshold}+: critical wounds on ${a.threshold}+`); }
  }
  const woundReroll = kw.twinLinked ? 'failed' : (am.rerollWounds || 'none');
  if (kw.twinLinked) notes.push('Twin-linked: re-roll wound rolls');
  const wound = rollTest(wTarget, woundModRaw, critWound, woundReroll);

  // Save.
  const ap = Math.min(0, (weapon.AP || 0) + (dm.apReduction ? Math.min(-(weapon.AP || 0), dm.apReduction) : 0));
  const save = saveFor({ Sv: defender.Sv, inv: defender.inv, cover: !!dm.cover },
    { AP: ap, ranged, ignoresCover: kw.ignoresCover || !!am.ignoresCover });

  // Damage.
  const dmg = damageDistribution({ D: weapon.D, melta: ranged ? kw.melta : 0, halfRange: !!am.halfRange,
    damageReduction: dm.damageReduction || 0, fnp: defender.fnp || null });
  if (kw.melta && am.halfRange && ranged) notes.push(`Melta ${kw.melta}: +${kw.melta} damage at half range`);

  // Per-hit transition probabilities (a "hit" that must roll to wound).
  const pWoundNormal = wound.ok + (dev ? 0 : wound.crit);
  const pDev = dev ? wound.crit : 0;
  const hitT = packetTransition(pWoundNormal * save.pFail, dmg.dist, pDev);
  const lethalT = packetTransition(save.pFail, dmg.dist, 0);
  const devT = packetTransition(1, dmg.dist, 0);

  const pCritHit = hit.crit;
  const pNormalHit = hit.ok;
  const eSust = sustained.mean;
  const eAtt = attacks.mean;
  const eHits = eAtt * (pNormalHit + pCritHit * (1 + eSust));
  const eRolledHits = eAtt * (pNormalHit + pCritHit * ((lethal ? 0 : 1) + eSust));
  const eLethal = lethal ? eAtt * pCritHit : 0;
  const eWounds = eRolledHits * (wound.ok + wound.crit) + eLethal;
  const eDevWounds = eRolledHits * pDev;
  const eUnsavedNormal = (eWounds - eDevWounds) * save.pFail;
  const eUnsaved = eUnsavedNormal + eDevWounds;

  return {
    name: weapon.name, type: ranged ? 'ranged' : 'melee', models: weapon.models,
    keywords: weapon.keywords || [], lethal, dev, torrent,
    attacksDist, sustainedDist: sustained.dist, hit, wound, save, dmg,
    hitT, lethalT, devT,
    maxAttacks: attacks.max, maxSustained: sustained.max,
    breakdown: {
      weapon: weapon.name, type: ranged ? 'ranged' : 'melee', models: weapon.models,
      profile: { A: weapon.A, skill: weapon.skill, S: weapon.S, AP: weapon.AP || 0, D: weapon.D, keywords: weapon.keywords || [] },
      attacksPerModel: perModel.text + (bonus ? `+${bonus}` : ''),
      attacks: eAtt,
      hitTarget: torrent ? null : weapon.skill, hitModifier: clampMod(hitModRaw), critHitOn: torrent ? null : critHit,
      pHit: hit.ok + hit.crit, pCritHit,
      hits: eHits, criticalHits: eAtt * pCritHit,
      sustainedHits: sustainedExpr || null, lethalHits: lethal,
      woundTarget: wTarget, woundModifier: clampMod(woundModRaw), critWoundOn: critWound, woundReroll,
      pWound: wound.ok + wound.crit, pCritWound: wound.crit,
      wounds: eWounds, autoWounds: eLethal, devastatingWounds: eDevWounds,
      saveTarget: save.target > 6 ? null : save.target, saveUsed: save.used, coverApplied: save.coverApplied,
      pFailSave: save.pFail,
      unsavedWounds: eUnsaved,
      damagePerUnsaved: dmg.mean, damageBeforeFnp: dmg.meanBeforeFnp,
      damage: eUnsaved * dmg.mean,
      notes,
    },
  };
}

/** q[d] for d>=1 (packet of d damage), q0 (nothing), qDev (deferred dev-wound attack). */
function packetTransition(pPacket, dmgDist, pDev) {
  const q = new Float64Array(dmgDist.length);
  let used = pDev;
  for (let d = 1; d < dmgDist.length; d++) { q[d] = pPacket * dmgDist[d]; used += q[d]; }
  return { q, q0: Math.max(0, 1 - used), qDev: pDev };
}

/* ------------------------------------------------------------ exact DP */

function addTo(map, key, p) { if (p > 0) map.set(key, (map.get(key) || 0) + p); }
function addScaled(out, dist, s) { if (s > 0) for (const [k, p] of dist) addTo(out, k, p * s); }

function makeSpace(N, W) {
  const K = (N + 1) * W;
  return {
    N, W, K,
    // key = pendingPart + alive*W + dmg ; alive==0 is canonicalised to key 0
    apply(key, d) {
      const base = key % K;
      const alive = Math.floor(base / W), dmg = base % W;
      if (dmg + d >= W) return alive - 1 === 0 ? 0 : key - base + (alive - 1) * W;
      return key + d;
    },
  };
}

function transition(dist, tr, space, devStride) {
  const out = new Map();
  const { q, q0, qDev } = tr;
  for (const [key, p] of dist) {
    if (key === 0) { addTo(out, 0, p); continue; }
    addTo(out, key, p * q0);
    for (let d = 1; d < q.length; d++) if (q[d] > 0) addTo(out, space.apply(key, d), p * q[d]);
    if (qDev > 0) addTo(out, key + devStride, p * qDev);
  }
  return out;
}

function attackStep(dist, pl, space) {
  if (pl.torrent) return transition(dist, pl.hitT, space, pl.devStride);
  const out = new Map();
  addScaled(out, dist, pl.hit.fail);
  if (pl.hit.ok > 0) addScaled(out, transition(dist, pl.hitT, space, pl.devStride), pl.hit.ok);
  if (pl.hit.crit > 0) {
    let cur = transition(dist, pl.lethal ? pl.lethalT : pl.hitT, space, pl.devStride);
    const s = pl.sustainedDist;
    for (let x = 0; x < s.length; x++) {
      if (s[x] > 0) addScaled(out, cur, pl.hit.crit * s[x]);
      if (x < s.length - 1) cur = transition(cur, pl.hitT, space, pl.devStride);
    }
  }
  return out;
}

function runExact(plans, defender) {
  const space = makeSpace(defender.models, defender.W);
  let stride = space.K;
  for (const pl of plans) {
    pl.devStride = 0;
    if (pl.dev) { pl.devStride = stride; pl.devMax = pl.maxAttacks * (1 + pl.maxSustained); stride *= pl.devMax + 1; }
  }
  let dist = new Map([[defender.models * defender.W, 1]]);
  for (const pl of plans) {
    const a = pl.attacksDist;
    const acc = new Map();
    let cur = dist;
    addScaled(acc, cur, a[0] || 0);
    let remaining = 1 - (a[0] || 0);
    for (let n = 1; n < a.length && remaining > 1e-15; n++) {
      cur = attackStep(cur, pl, space);
      if (cur.size === 1 && cur.has(0)) { addScaled(acc, cur, remaining); remaining = 0; break; }
      addScaled(acc, cur, a[n] || 0);
      remaining -= a[n] || 0;
    }
    dist = acc;
  }
  // Devastating Wounds attacks are allocated after all other attacks.
  for (const pl of plans) {
    if (!pl.dev) continue;
    const radix = pl.devMax + 1;
    for (let iter = 0; iter < pl.devMax; iter++) {
      let any = false;
      const out = new Map();
      for (const [key, p] of dist) {
        const pend = Math.floor(key / pl.devStride) % radix;
        if (key === 0 || pend === 0) { addTo(out, key, p); continue; }
        any = true;
        const k2 = key - pl.devStride;
        addTo(out, k2, p * pl.devT.q0);
        for (let d = 1; d < pl.devT.q.length; d++) if (pl.devT.q[d] > 0) addTo(out, space.apply(k2, d), p * pl.devT.q[d]);
      }
      dist = out;
      if (!any) break;
    }
  }
  const N = defender.models, W = defender.W;
  const kills = new Array(N + 1).fill(0);
  let inflicted = 0;
  for (const [key, p] of dist) {
    const base = key % space.K;
    const alive = Math.floor(base / W), dmg = base % W;
    kills[N - alive] += p;
    inflicted += p * ((N - alive) * W + (alive > 0 ? dmg : 0));
  }
  return { kills, inflicted };
}

function estimateWork(plans, defender) {
  let states = (defender.models + 1) * defender.W;
  for (const pl of plans) if (pl.dev) states *= pl.maxAttacks * (1 + pl.maxSustained) + 1;
  let work = 0;
  for (const pl of plans) {
    work += pl.maxAttacks * Math.min(states, 5e6) * (2 + pl.dmg.dist.length * (1 + pl.maxSustained));
  }
  return { work, states };
}

/* ----------------------------------------------------------- Monte Carlo */

/** Small, fast, seedable PRNG (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleDist(dist, rnd) {
  let u = rnd();
  for (let v = 0; v < dist.length; v++) { u -= dist[v]; if (u < 0) return v; }
  return dist.length - 1;
}

function runMonteCarlo(plans, defender, ctx, trials, seed) {
  const rnd = mulberry32(seed);
  const d6 = () => 1 + Math.floor(rnd() * 6);
  const N = defender.models, W = defender.W;
  const kills = new Array(N + 1).fill(0);
  const tot = { attacks: 0, hits: 0, wounds: 0, unsaved: 0, damage: 0, inflicted: 0 };
  const fnpIgnore = defender.fnp ? (7 - defender.fnp) / 6 : 0;

  const test = (target, mod, crit, reroll) => {
    const m = clampMod(mod);
    let r = d6(); let c = classify(r, target, m, crit);
    if ((reroll === 'ones' && r === 1) || (reroll === 'failed' && c === 'fail')) { r = d6(); c = classify(r, target, m, crit); }
    return c;
  };

  for (let t = 0; t < trials; t++) {
    let st = { alive: N, dmg: 0 };
    const pending = [];
    const damageRoll = (pl) => {
      let d = sampleDist(pl.rawDmg, rnd);
      if (pl.meltaBonus) d += pl.meltaBonus;
      if (ctx.damageReduction > 0 && d > 0) d = Math.max(1, d - ctx.damageReduction);
      let through = 0;
      for (let i = 0; i < d; i++) if (!(fnpIgnore && rnd() < fnpIgnore)) through++;
      tot.damage += through;
      return through;
    };
    const allocate = (d) => {
      const before = st.alive * W - st.dmg;
      st = applyDamage(st, d, { W });
      tot.inflicted += before - (st.alive * W - st.dmg);
    };
    const resolveWound = (pl, autoWound) => {
      let c = 'ok';
      if (!autoWound) {
        c = test(pl.woundTargetN, pl.woundMod, pl.critWound, pl.woundReroll);
        if (c === 'fail') return;
      }
      tot.wounds++;
      if (!autoWound && c === 'crit' && pl.dev) { tot.unsaved++; pending.push(pl); return; }
      const sv = pl.save.target;
      if (sv <= 6 && d6() >= sv) return;
      tot.unsaved++;
      allocate(damageRoll(pl));
    };
    for (const pl of plans) {
      let n = 0;
      for (let m = 0; m < pl.models; m++) n += sampleDist(pl.perModelDist, rnd);
      tot.attacks += n;
      for (let i = 0; i < n && st.alive > 0; i++) {
        if (pl.torrent) { tot.hits++; resolveWound(pl, false); continue; }
        const c = test(pl.skill, pl.hitMod, pl.critHit, pl.hitReroll);
        if (c === 'fail') continue;
        tot.hits++;
        resolveWound(pl, c === 'crit' && pl.lethal);
        if (c === 'crit') {
          const x = sampleDist(pl.sustainedDist, rnd);
          for (let j = 0; j < x; j++) { tot.hits++; resolveWound(pl, false); }
        }
      }
    }
    for (const pl of pending) { if (st.alive === 0) break; allocate(damageRoll(pl)); }
    kills[N - st.alive]++;
  }
  for (let k = 0; k <= N; k++) kills[k] /= trials;
  for (const k of Object.keys(tot)) tot[k] /= trials;
  return { kills, tot };
}

/* -------------------------------------------------------------- public */

/**
 * Simulate one volley.
 * @param {object} input
 * @param {{name?:string, models?:number, weapons:Array<{name:string,type?:'ranged'|'melee',A:string|number,skill?:number,S:number,AP?:number,D:string|number,keywords?:string[],models:number}>}} input.attacker
 * @param {{name?:string, models:number, T:number, Sv:number, inv?:number|null, W:number, fnp?:number|null, keywords?:string[]}} input.defender
 * @param {object} [input.attackerMods] hitMod, woundMod, rerollHits, rerollWounds ('none'|'ones'|'failed'),
 *   stationary, halfRange, charged, lethalHits, sustainedHits, devastatingWounds, critHit, critWound, ignoresCover
 * @param {object} [input.defenderMods] cover, hitMod, woundMod, damageReduction, apReduction, fnp, invuln
 * @param {object} [input.options] method ('auto'|'exact'|'monte-carlo'), trials, seed
 */
export function simulate(input) {
  const { attacker, attackerMods = {}, defenderMods = {}, options = {} } = input;
  const defender = { ...input.defender };
  if (defenderMods.fnp) defender.fnp = defender.fnp ? Math.min(defender.fnp, defenderMods.fnp) : defenderMods.fnp;
  if (defenderMods.invuln) defender.inv = defender.inv ? Math.min(defender.inv, defenderMods.invuln) : defenderMods.invuln;
  defender.W = Math.max(1, Math.floor(defender.W));
  defender.models = Math.max(1, Math.floor(defender.models));

  const plans = attacker.weapons.map((w) => plan({ skill: 3, AP: 0, type: 'ranged', ...w }, defender, attackerMods, defenderMods));

  const { work, states } = estimateWork(plans, defender);
  const keySpaceOk = states < 2 ** 52;
  let method = options.method || 'auto';
  if (method === 'auto') method = work <= 3e7 && keySpaceOk ? 'exact' : 'monte-carlo';
  if (method === 'exact' && !keySpaceOk) method = 'monte-carlo';

  const exp = {
    attacks: 0, hits: 0, wounds: 0, devastatingWounds: 0, unsavedWounds: 0, damage: 0,
  };
  for (const pl of plans) {
    const b = pl.breakdown;
    exp.attacks += b.attacks; exp.hits += b.hits; exp.wounds += b.wounds;
    exp.devastatingWounds += b.devastatingWounds; exp.unsavedWounds += b.unsavedWounds; exp.damage += b.damage;
  }

  let kills, inflicted, trials = null, seed = null;
  if (method === 'exact') {
    ({ kills, inflicted } = runExact(plans, defender));
  } else {
    trials = Math.max(100, Math.min(200_000, Math.floor(options.trials || 20_000)));
    seed = Number.isFinite(options.seed) ? options.seed : 40_000;
    const ctx = { damageReduction: defenderMods.damageReduction || 0 };
    for (const pl of plans) {
      const w = attacker.weapons[plans.indexOf(pl)];
      const kw = parseKeywords(w.keywords);
      const ranged = pl.type === 'ranged';
      let bonus = 0;
      if (kw.blast) bonus += Math.floor(defender.models / 5);
      if (kw.rapidFire && attackerMods.halfRange && ranged) bonus += kw.rapidFire;
      pl.perModelDist = shift(parseDice(w.A).dist, bonus);
      pl.skill = w.skill ?? 3;
      pl.hitMod = pl.breakdown.hitModifier;
      pl.critHit = attackerMods.critHit || 6;
      pl.hitReroll = attackerMods.rerollHits || 'none';
      pl.woundTargetN = pl.breakdown.woundTarget;
      pl.woundMod = pl.breakdown.woundModifier;
      pl.critWound = pl.breakdown.critWoundOn;
      pl.woundReroll = pl.breakdown.woundReroll;
      pl.rawDmg = parseDice(w.D).dist;
      pl.meltaBonus = kw.melta && attackerMods.halfRange && ranged ? kw.melta : 0;
    }
    const mc = runMonteCarlo(plans, defender, ctx, trials, seed);
    kills = mc.kills; inflicted = mc.tot.inflicted;
  }

  const modelsKilled = kills.reduce((s, p, k) => s + p * k, 0);
  return {
    method, trials, seed,
    rulesVersion: RULES_VERSION,
    attacker: { name: attacker.name || 'Attacker', models: attacker.models ?? null },
    defender: { name: defender.name || 'Defender', models: defender.models, T: defender.T, Sv: defender.Sv,
      inv: defender.inv || null, W: defender.W, fnp: defender.fnp || null },
    expected: {
      attacks: exp.attacks,
      hits: exp.hits,
      wounds: exp.wounds,
      devastatingWounds: exp.devastatingWounds,
      unsavedWounds: exp.unsavedWounds,
      damage: exp.damage,               // damage after FNP, before allocation losses
      damageInflicted: inflicted,       // wounds actually removed (no spill, capped by unit)
      modelsKilled,
    },
    killDistribution: kills,
    pWipe: kills[defender.models],
    weapons: plans.map((p) => p.breakdown),
  };
}
