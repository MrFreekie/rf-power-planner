// Animated expanding waves around noise sources on the plan view. Greyscale dashed rings, no colour meaning.
//
// What is real: nothing about the spread. The rings only show WHEN and WHERE a source is active (its time behaviour from the catalogue:
// steady, occasional click, keyed on/off call) and that a video wall radiates from its whole line, not from a point. Ring speed and reach are
// a visual convention, like the link ripples (ripples.js), not a propagation model.
//
// Pure scheduling (no canvas): classifyNoiseWave, keyedState, waveRings. drawNoiseWaves does the drawing.
import { NOISE_CATALOGUE } from '../model/noise-sources.js';

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

/**
 * classifyNoiseWave(src, reflector?) -> null (draw nothing) or a config:
 *   { mode: 'steady' | 'faint' | 'occasional' | 'keyed' | 'wall', period (s between births), life (s a ring lives), onS, offS (keyed only), reachM }
 * steady: continuous source. faint: very dense or very busy bursts (dimmer, motor, Wi-Fi), fainter rings. occasional: a single ring every
 * 2.5 s (flash, flash trigger, pyro). keyed: rings only while on (PTT about 5 s on; DECT / GSM call 4 s on, 3 s off; other intermittent sources
 * with onS >= 0.5 s). wall: video wall, offset lines from the whole wall line.
 */
export function classifyNoiseWave(src, reflector = null) {
  if (!src || typeof src !== 'object' || src.enabled === false) return null;
  const def = NOISE_CATALOGUE[src.kind];
  const p = { ...(def ? def.params : {}), ...src };
  const behaviour = def ? def.behaviour : 'continuous';
  if (src.kind === 'video-wall' || (typeof src.reflectorId === 'string' && src.reflectorId)) {
    const n = reflector && reflector.noise;
    if (!reflector || !reflector.p1 || !reflector.p2 || !n || n.preset === 'off') return null;
    return { mode: 'wall', period: 1.1, life: 3.3, reachM: 3, onS: Infinity, offS: 0 };
  }
  if (behaviour === 'continuous') return { mode: 'steady', period: 0.9, life: 3.6, reachM: REACH_M, onS: Infinity, offS: 0 };
  const occasional = { mode: 'occasional', period: 2.5, life: 2.2, reachM: REACH_M, onS: Infinity, offS: 0 };
  if (behaviour === 'impulsive') return num(p.repHz, 1) >= 20 ? { mode: 'faint', period: 1.2, life: 3.6, reachM: REACH_M, onS: Infinity, offS: 0 } : occasional;
  if (behaviour === 'pulsed-tdma') return { mode: 'keyed', period: 0.8, life: 2.0, reachM: REACH_M, onS: 4, offS: 3 };
  // intermittent
  const duty = num(p.dutyCycle, 0.1), onS = num(p.onS, 1);
  if (duty < 0.05 || (onS < 0.5 && duty < 0.05)) return occasional;
  if (onS >= 0.5) {
    const on = Math.min(8, onS);
    const off = Math.min(8, Math.max(3, onS / Math.max(duty, 1e-3) - onS));
    return { mode: 'keyed', period: 0.8, life: 2.0, reachM: REACH_M, onS: on, offS: off };
  }
  return { mode: 'faint', period: 1.2, life: 3.6, reachM: REACH_M, onS: Infinity, offS: 0 }; // short, busy bursts (Wi-Fi, Bluetooth)
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
const reducedMotion = () => typeof matchMedia === 'function' && !!matchMedia('(prefers-reduced-motion: reduce)').matches;

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
export const NOISE_RING_STYLE = Object.freeze({ width: 1.7, dash: [7, 5], haloWidth: 4, haloAlpha: 0.3 });
export function drawNoiseWaves(ctx, th, vp, scene, w, h, rip) {
  const st = rip && rip.settings;
  if (!st || !st.on || st.field) return 0;
  const list = Array.isArray(scene.noiseSources) ? scene.noiseSources : [];
  if (!list.length) return 0;
  const tNow = now();
  if (st.paused && clock.last) clock.held += tNow - clock.last;
  clock.last = tNow;
  clock.t = tNow - clock.held;
  const reduced = reducedMotion();
  const refl = new Map((scene.reflectors || []).map((r) => [r.id, r]));
  let drawn = 0;
  ctx.save();
  ctx.lineCap = 'butt';
  for (const s of list) {
    if (drawn >= NOISE_WAVE_MAX_SOURCES) break;
    const cfg = classifyNoiseWave(s, s && s.reflectorId ? refl.get(s.reflectorId) : null);
    if (!cfg) continue;
    const wall = cfg.mode === 'wall' ? refl.get(s.reflectorId) : null;
    if (!wall && !(s.pos && Number.isFinite(s.pos.x) && Number.isFinite(s.pos.y))) continue;
    const reachPx = Math.max(cfg.reachM * vp.pxPerM, cfg.mode === 'wall' ? MIN_WALL_REACH_PX : MIN_REACH_PX); // never so small on screen that the rings cannot be seen
    const rings = reduced ? [{ f: 0.45 }] : waveRings(cfg, s.id, clock.t);
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
      ctx.globalAlpha = reduced ? 0.14 : ringAlpha(cfg, r.f);
      if (ctx.globalAlpha <= 0.005) continue;
      const path = () => { if (wall) stadium(ctx, a, b, Math.max(3, rad)); else { ctx.beginPath(); ctx.arc(c.x, c.y, rad, 0, Math.PI * 2); } };
      // a paper-coloured halo under the dashes keeps them readable over the denser, darker link rings; the dashes stay greyscale
      const al = ctx.globalAlpha;
      ctx.setLineDash([]); ctx.strokeStyle = th.paper || '#ffffff'; ctx.lineWidth = NOISE_RING_STYLE.haloWidth; ctx.globalAlpha = al * NOISE_RING_STYLE.haloAlpha; path(); ctx.stroke();
      ctx.setLineDash(NOISE_RING_STYLE.dash); ctx.strokeStyle = th.inkSoft || th.ink; ctx.lineWidth = NOISE_RING_STYLE.width; ctx.globalAlpha = al; path(); ctx.stroke();
    }
  }
  ctx.restore();
  return drawn;
}
