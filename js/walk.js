// Automatic walk: moves the mobile end of a link along a line, one store.update per animation frame.
// Mic: the Tx (handheld) moves. IEM: the bodypack (rx) moves, since the transmitter is fixed.
// The walk ends when the user moves that item (drag), the link disappears (reset, load), or on undo/redo.
import { solveLink } from './model/rf.js';

export const DEFAULT_SPEED_MPS = 1.2;
const COALESCE = 'walk';
const EPS = 1e-6;

const mobileKey = (link) => (link.kind === 'iem' ? 'rx' : 'tx');
const fixedKey = (link) => (link.kind === 'iem' ? 'tx' : 'rx');

/**
 * Find a point along the ray fixedEnd -> from, beyond `from`, where the squelch is certainly closed
 * (or 300 m past `from` if it never closes, e.g. squelch disabled). Returns {x, y, z}.
 */
export function outOfRangePoint(scene, linkId, from, fixed) {
  const link = scene.links.find((l) => l.id === linkId);
  const dx = from.x - fixed.x, dy = from.y - fixed.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const probe = structuredClone(scene);
  const pl = probe.links.find((l) => l.id === linkId);
  const mk = mobileKey(link);
  const q = link.rx.squelch;
  const closeAt = q && q.enabled ? q.thresholdDbm - Math.max(0, q.hysteresisDb || 0) - 3 : -Infinity;
  const at = (d) => {
    pl[mk].pos = { x: fixed.x + ux * d, y: fixed.y + uy * d, z: from.z };
    return solveLink(probe, pl).inputPowerDbm;
  };
  let lo = len, hi = len;
  if (Number.isFinite(closeAt)) {
    while (hi < 5000 && at(hi) >= closeAt) { lo = hi; hi *= 1.6; }
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (at(m) >= closeAt) lo = m; else hi = m; }
  } else hi = len + 300;
  const d = Math.max(len + 1, Math.min(hi * 1.02, 5000));
  return { x: fixed.x + ux * d, y: fixed.y + uy * d, z: from.z };
}

let active = null;

export function stopWalk() {
  if (active) active.stop();
}
export const isWalking = () => active !== null;

/**
 * startWalk(store, linkId, { from, to, speedMps = 1.2, pingPong = true, raf, caf, now, onStop }) -> controller
 *  from: {x,y,z?} default the item's current position
 *  to:   {x,y,z?} | 'range' (out of squelch range) | 'stage' (opposite stage corner, default)
 * controller = { step(dtSeconds), stop(), running }. step() is what the animation frame calls; tests call it directly.
 * Starting a walk stops any earlier one.
 */
export function startWalk(store, linkId, opts = {}) {
  stopWalk();
  const scene0 = store.getScene();
  const link0 = scene0.links.find((l) => l.id === linkId);
  if (!link0) return null;
  const mk = mobileKey(link0);
  const fixed = link0[fixedKey(link0)].pos;
  const cur = link0[mk].pos;
  const from = { x: opts.from?.x ?? cur.x, y: opts.from?.y ?? cur.y, z: opts.from?.z ?? cur.z };
  let to = opts.to;
  if (to === 'range') to = outOfRangePoint(scene0, linkId, from, fixed);
  else if (!to || to === 'stage') to = { x: scene0.stage.width - from.x, y: scene0.stage.depth - from.y, z: from.z };
  to = { x: to.x, y: to.y, z: to.z ?? from.z };
  const speed = Number.isFinite(opts.speedMps) && opts.speedMps > 0 ? opts.speedMps : DEFAULT_SPEED_MPS;
  const pingPong = opts.pingPong !== false;
  const L = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const raf = opts.raf || (typeof requestAnimationFrame === 'function' ? requestAnimationFrame.bind(globalThis) : null);
  const caf = opts.caf || (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame.bind(globalThis) : () => {});
  const now = opts.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));

  let s = 0; // distance travelled
  let lastWritten = null;
  let handle = null;
  let lastTime = null;
  const ctl = { running: true };

  const posAt = () => {
    if (L < EPS) return { ...from };
    const phase = pingPong ? s % (2 * L) : Math.min(s, L);
    const d = phase < L ? phase : 2 * L - phase;
    const f = d / L;
    return { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f, z: from.z + (to.z - from.z) * f };
  };

  const offStore = store.subscribe((scene, info) => {
    if (!ctl.running) return;
    const l = scene.links.find((x) => x.id === linkId);
    if (!l || info.type === 'undo' || info.type === 'redo') { ctl.stop(); return; }
    if (info.type === 'scene' && lastWritten) {
      const p = l[mk].pos;
      if (Math.abs(p.x - lastWritten.x) > EPS || Math.abs(p.y - lastWritten.y) > EPS || Math.abs(p.z - lastWritten.z) > EPS) ctl.stop();
    }
  });

  ctl.stop = () => {
    if (!ctl.running) return;
    ctl.running = false;
    if (handle !== null) caf(handle);
    handle = null;
    offStore();
    if (active === ctl) active = null;
    if (opts.onStop) opts.onStop();
  };

  ctl.step = (dt) => {
    if (!ctl.running) return;
    s += speed * Math.max(0, dt);
    const p = posAt();
    lastWritten = p;
    store.update((d) => {
      const l = d.links.find((x) => x.id === linkId);
      if (l) l[mk].pos = { x: p.x, y: p.y, z: p.z };
    }, { coalesce: COALESCE });
    if (!pingPong && s >= L) ctl.stop();
  };

  const frame = () => {
    handle = null;
    if (!ctl.running) return;
    const t = now();
    const dt = lastTime === null ? 0 : Math.min(0.1, (t - lastTime) / 1000);
    lastTime = t;
    ctl.step(dt);
    if (ctl.running && raf) handle = raf(frame);
  };

  active = ctl;
  if (raf) handle = raf(frame);
  return ctl;
}
