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

// ---------------------------------------------------------------- several transmitters at once

const imdTx = (scene, id) => ((scene.imd && scene.imd.transmitters) || []).find((t) => t.id === id);

/**
 * startMultiWalk(store, items, opts) -> controller | null
 * Moves several items in one store.update per frame (one coalesced undo step), so intermod products and zone coverage can be
 * watched while a group of transmitters moves. Items:
 *   { linkId, from?, to?, speedMps?, pingPong? }   the link's mobile end, exactly as startWalk (mic: Tx, IEM: the bodypack)
 *   { imdId,  from?, to?, speedMps?, pingPong? }   a transmitter of the intermod demo (scene.imd.transmitters)
 * Each item has its own path. `to` is a point, 'stage' (mirror across the stage, default) or, for links, 'range'.
 * opts.offset = { x, y, z? }: a shared displacement; every item without its own `to` walks from its start to start + offset,
 * so the group moves rigidly (a band walking together). opts.speedMps / opts.pingPong are the defaults for items without their own.
 * Items whose target is missing are skipped; null when none is left. Starting a walk stops any earlier walk (single or multi).
 * Stops when any moved item is dragged by the user, a target disappears, on undo/redo, reset or load. The controller is
 * { step(dtSeconds), stop(), running, items: [{ linkId? , imdId?, key }] } and ctl.positions() -> current points.
 */
export function startMultiWalk(store, items = [], opts = {}) {
  stopWalk();
  const scene0 = store.getScene();
  const defSpeed = Number.isFinite(opts.speedMps) && opts.speedMps > 0 ? opts.speedMps : DEFAULT_SPEED_MPS;
  const defPing = opts.pingPong !== false;
  const offset = opts.offset ? { x: opts.offset.x || 0, y: opts.offset.y || 0, z: opts.offset.z || 0 } : null;
  const list = [];
  for (const it of items) {
    let cur, fixed = null, getPos, setPos, key;
    if (it.linkId !== undefined) {
      const link = scene0.links.find((l) => l.id === it.linkId);
      if (!link) continue;
      const mk = mobileKey(link);
      cur = link[mk].pos; fixed = link[fixedKey(link)].pos; key = `link:${it.linkId}`;
      getPos = (scene) => { const l = scene.links.find((x) => x.id === it.linkId); return l ? l[mk].pos : null; };
      setPos = (d, p) => { const l = d.links.find((x) => x.id === it.linkId); if (l) l[mk].pos = { x: p.x, y: p.y, z: p.z }; };
    } else if (it.imdId !== undefined) {
      const t = imdTx(scene0, it.imdId);
      if (!t) continue;
      cur = t.pos; key = `imd:${it.imdId}`;
      getPos = (scene) => { const x = imdTx(scene, it.imdId); return x ? x.pos : null; };
      setPos = (d, p) => { const x = imdTx(d, it.imdId); if (x) x.pos = { x: p.x, y: p.y, z: p.z }; };
    } else continue;
    const from = { x: it.from?.x ?? cur.x, y: it.from?.y ?? cur.y, z: it.from?.z ?? cur.z ?? 0 };
    let to = it.to;
    if (to === 'range' && it.linkId !== undefined) to = outOfRangePoint(scene0, it.linkId, from, fixed);
    else if (!to && offset) to = { x: from.x + offset.x, y: from.y + offset.y, z: from.z + offset.z };
    else if (!to || to === 'stage' || to === 'range') to = { x: scene0.stage.width - from.x, y: scene0.stage.depth - from.y, z: from.z };
    to = { x: to.x, y: to.y, z: to.z ?? from.z };
    const speed = Number.isFinite(it.speedMps) && it.speedMps > 0 ? it.speedMps : defSpeed;
    list.push({
      key, linkId: it.linkId, imdId: it.imdId, from, to, speed, pingPong: it.pingPong === undefined ? defPing : it.pingPong !== false,
      L: Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z), getPos, setPos, last: null,
    });
  }
  if (!list.length) return null;

  const raf = opts.raf || (typeof requestAnimationFrame === 'function' ? requestAnimationFrame.bind(globalThis) : null);
  const caf = opts.caf || (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame.bind(globalThis) : () => {});
  const now = opts.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  let t = 0, handle = null, lastTime = null;
  const ctl = { running: true, items: list.map((w) => ({ key: w.key, linkId: w.linkId, imdId: w.imdId })) };

  const posOf = (w) => {
    if (w.L < EPS) return { ...w.from };
    const s = w.speed * t;
    const phase = w.pingPong ? s % (2 * w.L) : Math.min(s, w.L);
    const d = phase < w.L ? phase : 2 * w.L - phase;
    const f = d / w.L;
    return { x: w.from.x + (w.to.x - w.from.x) * f, y: w.from.y + (w.to.y - w.from.y) * f, z: w.from.z + (w.to.z - w.from.z) * f };
  };
  ctl.positions = () => Object.fromEntries(list.map((w) => [w.key, w.last || posOf(w)]));

  const offStore = store.subscribe((scene, info) => {
    if (!ctl.running) return;
    if (info.type === 'undo' || info.type === 'redo') { ctl.stop(); return; }
    for (const w of list) {
      const p = w.getPos(scene);
      if (!p) { ctl.stop(); return; }
      if (info.type === 'scene' && w.last && (Math.abs(p.x - w.last.x) > EPS || Math.abs(p.y - w.last.y) > EPS || Math.abs((p.z ?? 0) - w.last.z) > EPS)) { ctl.stop(); return; }
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
    t += Math.max(0, dt);
    const ps = list.map(posOf);
    list.forEach((w, i) => { w.last = ps[i]; });
    store.update((d) => { list.forEach((w, i) => w.setPos(d, ps[i])); }, { coalesce: COALESCE });
    if (list.every((w) => !w.pingPong) && list.every((w) => w.speed * t >= w.L)) ctl.stop();
  };

  const frame = () => {
    handle = null;
    if (!ctl.running) return;
    const tm = now();
    const dt = lastTime === null ? 0 : Math.min(0.1, (tm - lastTime) / 1000);
    lastTime = tm;
    ctl.step(dt);
    if (ctl.running && raf) handle = raf(frame);
  };

  active = ctl;
  if (raf) handle = raf(frame);
  return ctl;
}
