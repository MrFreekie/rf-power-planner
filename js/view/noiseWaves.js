// Animated expanding waves around noise sources on the plan view. Greyscale dashed rings, no colour meaning.
//
// What is real: nothing about the spread. The rings only show WHEN and WHERE a source is active (its time behaviour from the catalogue:
// steady, occasional click, keyed on/off call) and that a video wall radiates from its whole line, not from a point. Ring speed and reach are
// a visual convention, like the link ripples (ripples.js), not a propagation model.
//
// Pure scheduling (no canvas): classifyNoiseWave, keyedState, waveRings. drawNoiseWaves does the drawing.
import { waveSchedule } from '../model/noise-sources.js';

export const NOISE_WAVE_MAX_SOURCES = 12;
export const MIN_REACH_PX = 110, MIN_WALL_REACH_PX = 60;
const REACH_M = 5;       // how far a ring travels before it fades out (visual)
const num = (v, d) => (Number.isFinite(v) ? v : d);

/** Deterministic hash of an id to [0, 1): keeps sources out of lockstep. */
export function idPhase(id) {
  let h = 2166136261;
  const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h >>> 0) / 4294967296;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const PULSE_MIN_PERIOD_S = 0.33, PULSE_MAX_ALIVE = 4, OCCASIONAL_PERIOD_S = [1.5, 8], KEYED_ON_S = [1, 8], KEYED_OFF_S = [3, 8];

/**
 * classifyNoiseWave(src, reflector?) -> null (draw nothing) or a config:
 *   { mode: 'steady' | 'faint' | 'pulse' | 'occasional' | 'keyed' | 'wall', period (s between births), life (s a ring lives), onS, offS (keyed only), reachM, label }
 * The timing comes from the model (waveSchedule in noise-sources.js) and is scaled to visual time only where real time is too fast or too slow:
 * steady: continuous source. faint: very dense or very busy bursts (dimmer, motor, Wi-Fi), fainter rings. pulse: a frequent train (a speedlight, 3 per second:
 * a ring about every 0.33 s, at most 4 alive). occasional: a rare event (pyro or flash trigger radio) at its real period clamped to 1.5 to 8 s.
 * keyed: rings only while on, the model on-time and gap clamped to 1 to 8 s and 3 to 8 s (PTT); DECT and GSM show the call cycle (4 s on, 3 s off, labelled,
 * the real burst duty is not drawn). wall: video wall, offset lines from the whole wall line.
 */
export function classifyNoiseWave(src, reflector = null) {
  if (!src || typeof src !== 'object' || src.enabled === false) return null;
  if (src.kind === 'video-wall' || (typeof src.reflectorId === 'string' && src.reflectorId)) {
    const n = reflector && reflector.noise;
    if (!reflector || !reflector.p1 || !reflector.p2 || !n || n.preset === 'off') return null;
    return { mode: 'wall', period: 1.1, life: 3.3, reachM: 3, onS: Infinity, offS: 0, label: 'video wall, continuous' };
  }
  const sch = waveSchedule(src), label = sch.label;
  const base = { reachM: REACH_M, onS: Infinity, offS: 0, label };
  if (sch.continuous) return { ...base, mode: 'steady', period: 0.9, life: 3.6 };
  const eps = num(sch.eventsPerS, 1);
  if (sch.behaviour === 'pulsed-tdma') return { ...base, mode: 'keyed', period: 0.8, life: 2.0, onS: 4, offS: 3, label: `call cycle (4 s on, 3 s off), ${label}` };
  if (sch.behaviour === 'impulsive') {
    if (eps >= 20) return { ...base, mode: 'faint', period: 1.2, life: 3.6 };
    if (eps >= 1) { const period = Math.max(PULSE_MIN_PERIOD_S, 1 / eps); return { ...base, mode: 'pulse', period, life: Math.min(2.2, PULSE_MAX_ALIVE * period) }; }
    return { ...base, mode: 'occasional', period: clamp(num(sch.periodS, 2.5), ...OCCASIONAL_PERIOD_S), life: 2.2 };
  }
  // intermittent
  const duty = num(sch.duty, 0.1), onS = num(sch.onS, 1);
  if (duty < 0.05) return { ...base, mode: 'occasional', period: clamp(num(sch.periodS, 2.5), ...OCCASIONAL_PERIOD_S), life: 2.2 };
  if (onS >= 0.5) return { ...base, mode: 'keyed', period: 0.8, life: 2.0, onS: clamp(onS, ...KEYED_ON_S), offS: clamp(num(sch.gapS, 3), ...KEYED_OFF_S) };
  return { ...base, mode: 'faint', period: 1.2, life: 3.6 }; // short, busy bursts (Wi-Fi, Bluetooth)
}

/** keyedState(cfg, id, t) -> { on, phaseS } for a keyed config: whether the source is transmitting at time t (s). Others are always on. */
export function keyedState(cfg, id, t) {
  if (!cfg || cfg.mode !== 'keyed') return { on: true, phaseS: 0 };
  const cycle = cfg.onS + cfg.offS, local = (((t + idPhase(id) * cycle) % cycle) + cycle) % cycle;
  return { on: local < cfg.onS, phaseS: local };
}

/**
 * waveRings(cfg, id, t) -> [{ age (s), f (0..1 of its life) }] the rings alive at time t (s). Births are deterministic from the id and t.
 * A ring born while a keyed source is on keeps travelling after it switches off; none is born in the off gap.
 */
export function waveRings(cfg, id, t) {
  const out = [];
  if (!cfg) return out;
  const P = cfg.period, L = cfg.life;
  const cycle = cfg.mode === 'keyed' ? cfg.onS + cfg.offS : Infinity;
  const local = t + idPhase(id) * (Number.isFinite(cycle) ? cycle : P * 7);
  const c0 = Number.isFinite(cycle) ? Math.floor((local - L) / cycle) : 0, c1 = Number.isFinite(cycle) ? Math.floor(local / cycle) : 0;
  for (let c = c0; c <= c1; c++) {
    const base = Number.isFinite(cycle) ? c * cycle : 0;
    const span = cfg.mode === 'keyed' ? cfg.onS : Infinity; // births allowed in [base, base + span)
    const jmin = Math.max(Number.isFinite(cycle) ? 0 : -Infinity, Math.ceil((local - L - base) / P));
    const jmax = Math.min(Number.isFinite(span) ? Math.ceil(span / P) - 1 : Infinity, Math.floor((local - base) / P));
    for (let j = jmin; j <= jmax; j++) {
      const age = local - (base + j * P);
      if (age >= 0 && age < L) out.push({ age, f: age / L });
    }
  }
  return out;
}

// ---- drawing ------------------------------------------------------------------------------------------------------------------------
const clock = { t: 0, last: 0, held: 0 }; // t = real time minus the time spent paused: rings freeze while paused and do not slow down when frames are sparse
function now() {
  const ms = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return ms / 1000;
}
// prefers-reduced-motion is read once and kept current by a change listener (no matchMedia call per frame)
let reducedMq = null, reducedNow = false;
const reducedMotion = () => {
  if (!reducedMq && typeof matchMedia === 'function') {
    try {
      reducedMq = matchMedia('(prefers-reduced-motion: reduce)'); reducedNow = !!reducedMq.matches;
      const on = (e) => { reducedNow = !!e.matches; };
      if (reducedMq.addEventListener) reducedMq.addEventListener('change', on); else if (reducedMq.addListener) reducedMq.addListener(on);
    } catch { reducedMq = null; }
  }
  return reducedNow;
};
/** Test hook: forget the cached media query. */
export function resetNoiseWaveCaches() { reducedMq = null; reducedNow = false; cfgCache = new WeakMap(); reflCache = { list: null, map: null }; }
// classification per source object (the scene replaces objects only when they change) and the reflector map per reflectors array
let cfgCache = new WeakMap(), reflCache = { list: null, map: null };
function cfgFor(s, reflector) {
  if (!s || typeof s !== 'object') return classifyNoiseWave(s, reflector);
  const hit = cfgCache.get(s);
  if (hit && hit.reflector === reflector && hit.noise === (reflector && reflector.noise) && hit.p1 === (reflector && reflector.p1) && hit.p2 === (reflector && reflector.p2)) return hit.cfg;
  const cfg = classifyNoiseWave(s, reflector);
  cfgCache.set(s, { reflector, noise: reflector && reflector.noise, p1: reflector && reflector.p1, p2: reflector && reflector.p2, cfg });
  return cfg;
}
function reflectorMap(list) {
  if (reflCache.list !== list) reflCache = { list, map: new Map((list || []).map((r) => [r.id, r])) };
  return reflCache.map;
}

function ringAlpha(cfg, f) {
  const base = cfg.mode === 'faint' ? 0.4 : cfg.mode === 'wall' ? 0.75 : 0.85;
  return base * (1 - f * f) * Math.min(1, f * 8 + 0.25);
}

function stadium(ctx, a, b, d) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, ang = Math.atan2(ny, nx);
  ctx.beginPath();
  ctx.moveTo(a.x + nx * d, a.y + ny * d);
  ctx.lineTo(b.x + nx * d, b.y + ny * d);
  ctx.arc(b.x, b.y, d, ang, ang - Math.PI, true); // round the p2 end, through the outward direction
  ctx.lineTo(a.x - nx * d, a.y - ny * d);
  ctx.arc(a.x, a.y, d, ang + Math.PI, ang, true); // round the p1 end
  ctx.closePath();
}

/**
 * drawNoiseWaves(ctx, th, vp, scene, w, h, rip): call right after rip.drawPlan(...). Respects rip.settings (on, paused, field), the print
 * switch (settings.on = false) and prefers-reduced-motion (one static faint ring). At most NOISE_WAVE_MAX_SOURCES sources are drawn.
 */
export const NOISE_RING_STYLE = Object.freeze({ width: 1.7, dash: [7, 5], dotted: [1.5, 5], haloWidth: 4, haloAlpha: 0.3 });
export const QUIET_BELOW_FLOOR_DB = 20;
/** quietSources(result) -> Set of source ids whose average level at the active receiver is more than 20 dB under the floor (nothing to show moving). */
export function quietSources(result) {
  const ns = result && result.noiseSources, out = new Set();
  if (!ns || !Array.isArray(ns.sources)) return out;
  const floor = Number.isFinite(ns.floorBeforeDbm) ? ns.floorBeforeDbm : result.cascade && result.cascade.noiseFloorDbm;
  if (!Number.isFinite(floor)) return out;
  for (const x of ns.sources) if (x && x.id != null && Number.isFinite(x.averageDbm) && x.averageDbm < floor - QUIET_BELOW_FLOOR_DB) out.add(x.id);
  return out;
}
export function drawNoiseWaves(ctx, th, vp, scene, w, h, rip, result = null) {
  const st = rip && rip.settings;
  if (!st || !st.on || st.field) return 0;
  const list = Array.isArray(scene.noiseSources) ? scene.noiseSources : [];
  if (!list.length) return 0;
  const tNow = now();
  if (st.paused && clock.last) clock.held += tNow - clock.last;
  clock.last = tNow;
  clock.t = tNow - clock.held;
  const reduced = reducedMotion();
  const refl = reflectorMap(scene.reflectors);
  const quiet = quietSources(result);
  let drawn = 0;
  ctx.save();
  ctx.lineCap = 'butt';
  for (const s of list) {
    if (drawn >= NOISE_WAVE_MAX_SOURCES) break;
    const cfg = cfgFor(s, s && s.reflectorId ? refl.get(s.reflectorId) : null);
    if (!cfg) continue;
    const wall = cfg.mode === 'wall' ? refl.get(s.reflectorId) : null;
    if (!wall && !(s.pos && Number.isFinite(s.pos.x) && Number.isFinite(s.pos.y))) continue;
    const reachPx = Math.max(cfg.reachM * vp.pxPerM, cfg.mode === 'wall' ? MIN_WALL_REACH_PX : MIN_REACH_PX); // never so small on screen that the rings cannot be seen
    const isQuiet = cfg.mode !== 'wall' && quiet.has(s.id); // far below the floor: one faint static dotted ring, nothing moving
    const rings = reduced || isQuiet ? [{ f: 0.45 }] : waveRings(cfg, s.id, clock.t);
    if (!rings.length) { drawn++; continue; }
    let a = null, b = null, c = null;
    if (wall) {
      a = vp.worldToScreen(wall.p1.x, wall.p1.y); b = vp.worldToScreen(wall.p2.x, wall.p2.y);
      if (Math.max(a.x, b.x) + reachPx < 0 || Math.min(a.x, b.x) - reachPx > w || Math.max(a.y, b.y) + reachPx < 0 || Math.min(a.y, b.y) - reachPx > h) continue;
    } else {
      c = vp.worldToScreen(s.pos.x, s.pos.y);
      if (c.x < -reachPx || c.x > w + reachPx || c.y < -reachPx || c.y > h + reachPx) continue;
    }
    drawn++;
    for (const r of rings) {
      const rad = Math.max(2, r.f * reachPx);
      ctx.globalAlpha = isQuiet ? 0.18 : reduced ? 0.14 : ringAlpha(cfg, r.f);
      if (ctx.globalAlpha <= 0.005) continue;
      const path = () => { if (wall) stadium(ctx, a, b, Math.max(3, rad)); else { ctx.beginPath(); ctx.arc(c.x, c.y, rad, 0, Math.PI * 2); } };
      // a paper-coloured halo under the dashes keeps them readable over the denser, darker link rings; the dashes stay greyscale
      const al = ctx.globalAlpha;
      ctx.setLineDash([]); ctx.strokeStyle = th.paper || '#ffffff'; ctx.lineWidth = NOISE_RING_STYLE.haloWidth; ctx.globalAlpha = al * NOISE_RING_STYLE.haloAlpha; path(); ctx.stroke();
      ctx.setLineDash(isQuiet ? NOISE_RING_STYLE.dotted : NOISE_RING_STYLE.dash); ctx.strokeStyle = th.inkSoft || th.ink; ctx.lineWidth = NOISE_RING_STYLE.width; ctx.globalAlpha = al; path(); ctx.stroke();
    }
  }
  ctx.restore();
  return drawn;
}
