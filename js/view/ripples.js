// Ripples: animated wavefronts for the plan and side views, driven by the real model.
//
// API (one shared instance per store):
//   getRipples(store) -> r
//   r.attach(kind, canvas, invalidate)     kind 'plan' | 'side'; adds the controls to the pane header and
//                                          registers the canvas for the animation loop; returns detach()
//   r.drawPlan(ctx, th, vp, scene, w, h, link)           call from the plan view after the floor is drawn
//   r.drawSide(ctx, th, vp, scene, link, geom, w, h)     geom = { u, D }: unit vector toward Rx, horizontal Tx-Rx distance
//   r.settings   { on, speed, field, paused }  (saved in localStorage only), r.set(patch), r.subscribe(cb)
// What is real: ring SPACING is the wavelength at the link frequency (a whole multiple of it when that would be
// under about 8 px, labelled), ring OPACITY follows the antenna pattern (plan: azimuth cut, side: elevation cut)
// and spreading loss, reflections use image sources. What is not real: the speed of the rings, which is a slow
// visual speed (the real wave is about 300 million m/s). Field mode draws the static coherent interference
// pattern of the direct wave and its reflections (antenna pattern ignored).
import { antennaGainDb, floorReflection, reflectorCoefficient } from '../model/rf.js';
import { solveCached, statusColor, setFont, haloText } from './util.js';
import { gateOf } from './squelchUi.js';
import { floorHeightAt } from '../model/floor.js';
import { parseColor } from './coverageUi.js';
import * as M from './rippleMath.js';

const KEY = 'rf-ripples.v1';
const N = 72;                       // pattern table size (5 degree steps)
const SEG = 360 / N;
const NB = 6;                       // opacity buckets
const MAX_RINGS = 48;
const FRAME_MS = 33;                // loop is capped at about 30 fps
const CELL_PX = 4;
const FIELD_INTERVAL_MS = 120;
const DEG = Math.PI / 180;
const IMD_COLORS = ['rgb(74,120,181)', 'rgb(201,120,40)', 'rgb(120,90,170)', 'rgb(40,150,150)'];
const TWO_PI = Math.PI * 2;

function loadSettings() {
  const s = { on: true, speed: 1, field: false, paused: false };
  try {
    const j = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (j && typeof j === 'object') {
      if (typeof j.on === 'boolean') s.on = j.on;
      if (typeof j.field === 'boolean') s.field = j.field;
      if (typeof j.paused === 'boolean') s.paused = j.paused;
      if (Number.isFinite(j.speed)) s.speed = Math.min(4, Math.max(0.25, j.speed));
    }
  } catch { /* storage unavailable */ }
  return s;
}

const registry = new WeakMap();
export function getRipples(store) {
  let r = registry.get(store);
  if (!r) { r = createRipples({ store }); registry.set(store, r); }
  return r;
}

export function createRipples({ store }) {
  const settings = loadSettings();
  const subs = new Set();
  const views = new Map(); // kind -> { canvas, invalidate, visible, ctl }
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = !!(mq && mq.matches);
  let phase = 0, raf = 0, lastTs = 0, observer = null;

  // ---- scene cache (rebuilt only when the scene object changes) ---------------------------------
  let cacheScene = null, emitters = [], reflInfo = [];
  const makeEmitter = (id, linkId, pos, antenna, freqMHz, color) => ({
    id, linkId, x: pos.x, y: pos.y, z: pos.z || 0, antenna, freqMHz, color,
    plan: new Float32Array(N), side: new Float32Array(N), sideAz: NaN, wallIdx: [],
  });
  function build(scene) {
    cacheScene = scene; emitters = []; reflInfo = [];
    const env = scene.environment || {};
    for (const link of scene.links || []) {
      const br = link.kind === 'iem' && Array.isArray(link.branches) && link.branches.length > 1 ? link.branches : null;
      if (br) br.forEach((b) => emitters.push(makeEmitter(b.id, link.id, b.pos, b.antenna || link.tx.antenna, link.freqMHz, null)));
      else emitters.push(makeEmitter(link.tx.id, link.id, link.tx.pos, link.tx.antenna, link.freqMHz, null));
    }
    const imd = scene.imd;
    if (imd && imd.enabled && Array.isArray(imd.transmitters)) {
      imd.transmitters.forEach((t, i) => emitters.push(makeEmitter(t.id, null, t.pos, t.antenna, t.freqMHz, IMD_COLORS[i % IMD_COLORS.length])));
    }
    const walls = (scene.reflectors || []).slice(0, 4);
    walls.forEach((w) => {
      const dx = w.p2.x - w.p1.x, dy = w.p2.y - w.p1.y, len = Math.hypot(dx, dy) || 1;
      const f = (scene.links[0] && scene.links[0].freqMHz) || 600;
      let g = { re: 0.5, im: 0 };
      try { g = reflectorCoefficient(w.material, 30, env.polarisation || 'vertical', f); } catch { /* keep default */ }
      reflInfo.push({ w, nx: -dy / len, ny: dx / len, mag: Math.hypot(g.re, g.im), ph: Math.atan2(g.im, g.re), loss: Number.isFinite(w.transmissionLossDb) ? w.transmissionLossDb : null });
    });
    const bearing = { az: 0, el: 0 };
    const tmp = new Float32Array(N);
    for (const e of emitters) {
      for (let i = 0; i < N; i++) { bearing.az = (i + 0.5) * SEG; bearing.el = 0; tmp[i] = antennaGainDb(e.antenna, bearing); }
      M.relativeTable(tmp, e.plan);
      reflInfo.forEach((ri, k) => {
        const idx = new Int16Array(N);
        for (let i = 0; i < N; i++) {
          const az = (i + 0.5) * SEG * DEG, dx = Math.sin(az), dy = Math.cos(az), dn = dx * ri.nx + dy * ri.ny;
          const ex = dx - 2 * dn * ri.nx, ey = dy - 2 * dn * ri.ny;
          idx[i] = M.angleIndex(Math.atan2(ex, ey) / DEG, N);
        }
        e.wallIdx[k] = idx;
      });
    }
  }
  const emittersFor = (scene) => { if (scene !== cacheScene) build(scene); return emitters; };

  function sideTable(e, azU) {
    if (e.sideAz === azU) return e.side;
    e.sideAz = azU;
    const ux = Math.sin(azU * DEG), uy = Math.cos(azU * DEG);
    const b = { az: 0, el: 0 }, tmp = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i + 0.5) * SEG * DEG, ds = Math.cos(a), dz = -Math.sin(a);
      b.az = Math.atan2(ds * ux, ds * uy) / DEG; b.el = Math.atan2(dz, Math.abs(ds)) / DEG;
      tmp[i] = antennaGainDb(e.antenna, b);
    }
    M.relativeTable(tmp, e.side);
    return e.side;
  }

  // ---- ring drawing (hot path: no allocations) ------------------------------------------------
  const dbg = { cx: 0, cy: 0, pxPerM: 0, spacingM: 0 }; // last plan emitter position, for inspection
  const P = { cx: 0, cy: 0, table: null, idx: null, mirror: false, planMode: true, extra: 0, spacingM: 0.5, pxPerM: 40, maxRpx: 0, cap: MAX_RINGS, muted: false, refD: 0.5 };

  function strokeRings(ctx) {
    const { cx, cy, table, idx, mirror, planMode, extra, spacingM, pxPerM, maxRpx, cap, refD } = P;
    const first = M.ringOffsetM(phase, spacingM);
    let nRings = M.ringCount(maxRpx / pxPerM, phase, spacingM, cap);
    for (let k = 0; k < nRings; k++) {
      const r = first + k * spacingM, rpx = r * pxPerM;
      if (rpx < 2) continue;
      const base = M.spreadingRelDb(r, refD) - extra;
      let run = 0;
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const ti = idx ? idx[i] : (mirror ? (N - 1 - i) : i);
        const kk = 1 + (table[ti] + base) / M.ALPHA_RANGE_DB;
        const b = kk <= 0.04 ? 0 : (kk >= 1 ? NB : Math.ceil(kk * NB));
        if (b !== run) {
          if (run > 0) flush(ctx, run);
          run = b;
          ctx.beginPath();
        }
        if (b > 0) {
          if (planMode) ctx.arc(cx, cy, rpx, (90 - i * SEG) * DEG, (90 - (i + 1) * SEG) * DEG, true);
          else ctx.arc(cx, cy, rpx, i * SEG * DEG, (i + 1) * SEG * DEG, false);
        }
      }
      if (run > 0) flush(ctx, run);
    }
  }
  function flush(ctx, b) {
    ctx.globalAlpha = (P.muted ? 0.55 : 1) * (b / NB) * M.MAX_ALPHA;
    ctx.lineWidth = 0.7 + 1.5 * (b / NB);
    ctx.stroke();
  }

  function setRingStyle(ctx, th, e, muted) {
    ctx.strokeStyle = e.color || th.ink;
    ctx.setLineDash(muted ? [5, 4] : []);
    P.muted = muted;
  }

  function farthest(cx, cy, w, h) {
    const dx = Math.max(cx, w - cx), dy = Math.max(cy, h - cy);
    return Math.hypot(dx, dy);
  }

  // clip to one side of a wall line (screen space); side = +1 along the normal (nx, ny), -1 opposite
  function clipSide(ctx, a, b, nx, ny, side) {
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, BIG = 4000, sx = nx * side * BIG, sy = ny * side * BIG;
    ctx.beginPath();
    ctx.moveTo(a.x - ux * BIG, a.y - uy * BIG);
    ctx.lineTo(b.x + ux * BIG, b.y + uy * BIG);
    ctx.lineTo(b.x + ux * BIG + sx, b.y + uy * BIG + sy);
    ctx.lineTo(a.x - ux * BIG + sx, a.y - uy * BIG + sy);
    ctx.closePath();
    ctx.clip();
  }

  function label(ctx, th, w, h, lambdaM, multiple) {
    const txt = multiple > 1 ? `ring spacing = ${multiple} x wavelength (wavelength ${lambdaM.toFixed(2)} m)` : `ring spacing = wavelength ${lambdaM.toFixed(2)} m`;
    haloText(ctx, th, txt, w / 2, h - 8, { align: 'center', px: 11, color: th.inkSoft });
  }

  const arrival = (ctx, th, x, y, a, status, muted) => {
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a * 0.9;
    ctx.strokeStyle = muted ? th.inkSoft : statusColor(th, status);
    ctx.lineWidth = 2.2;
    if (muted) ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.arc(x, y, 5 + 9 * (1 - a), 0, TWO_PI); ctx.stroke();
    ctx.restore();
  };

  // ---- plan --------------------------------------------------------------------------------------
  function drawPlan(ctx, th, vp, scene, w, h, link) {
    if (!settings.on || !link) return;
    if (settings.field) { drawPlanField(ctx, th, vp, scene, w, h, link); return; }
    const list = emittersFor(scene);
    ctx.save();
    ctx.lineCap = 'butt';
    let shown = 0;
    for (const e of list) if (e.linkId === link.id || e.linkId === null) shown++;
    const cap = shown > 2 ? 24 : MAX_RINGS;
    let lambda0 = 0.5, mult0 = 1;
    for (const e of list) {
      const own = e.linkId === link.id;
      if (!own && e.linkId !== null) continue; // other links stay quiet
      const lambda = M.wavelengthM(e.freqMHz);
      const sp = M.ringSpacing(lambda, vp.pxPerM);
      if (own && lambda0 === 0.5) { lambda0 = lambda; mult0 = sp.multiple; }
      const g = e.linkId ? gateOf(e.linkId) : null;
      const muted = !!(g && !g.open);
      const c = vp.worldToScreen(e.x, e.y);
      P.cx = c.x; P.cy = c.y; P.table = e.plan; P.idx = null; P.mirror = false; P.planMode = true; P.extra = 0;
      if (own) { dbg.cx = c.x; dbg.cy = c.y; dbg.pxPerM = vp.pxPerM; dbg.spacingM = sp.spacingM; }
      P.spacingM = sp.spacingM; P.pxPerM = vp.pxPerM; P.maxRpx = farthest(c.x, c.y, w, h); P.cap = cap; P.refD = Math.max(sp.spacingM, 0.5);
      setRingStyle(ctx, th, e, muted);
      // a wall with transmission loss: dim the rings beyond it
      let lossWall = -1;
      for (let k = 0; k < reflInfo.length; k++) if (reflInfo[k].loss != null) { lossWall = k; break; }
      if (lossWall >= 0) {
        const ri = reflInfo[lossWall], a = vp.worldToScreen(ri.w.p1), b = vp.worldToScreen(ri.w.p2);
        const side = ((e.x - ri.w.p1.x) * ri.nx + (e.y - ri.w.p1.y) * ri.ny) >= 0 ? 1 : -1;
        ctx.save(); clipSide(ctx, a, b, ri.nx, ri.ny, side); strokeRings(ctx); ctx.restore();
        ctx.save(); clipSide(ctx, a, b, ri.nx, ri.ny, -side); P.extra = ri.loss; strokeRings(ctx); ctx.restore();
        P.extra = 0;
      } else strokeRings(ctx);
      // one-bounce wall images, clipped to the emitter's side of each wall
      if (own) {
        for (let k = 0; k < reflInfo.length; k++) {
          const ri = reflInfo[k];
          const dist = (e.x - ri.w.p1.x) * ri.nx + (e.y - ri.w.p1.y) * ri.ny;
          const ix = e.x - 2 * dist * ri.nx, iy = e.y - 2 * dist * ri.ny;
          const ic = vp.worldToScreen(ix, iy), a = vp.worldToScreen(ri.w.p1), b = vp.worldToScreen(ri.w.p2);
          ctx.save();
          clipSide(ctx, a, b, ri.nx, ri.ny, dist >= 0 ? 1 : -1);
          P.cx = ic.x; P.cy = ic.y; P.idx = e.wallIdx[k]; P.extra = -20 * Math.log10(Math.max(ri.mag, 0.05)) + 3; P.maxRpx = farthest(ic.x, ic.y, w, h); P.cap = 30;
          setRingStyle(ctx, th, e, muted);
          strokeRings(ctx);
          ctx.restore();
        }
        P.idx = null; P.extra = 0;
      }
    }
    ctx.restore();
    // arrival pulses at the receive antenna(s) of the active link
    const e0 = list.find((q) => q.linkId === link.id);
    if (e0) {
      const sp = M.ringSpacing(M.wavelengthM(link.freqMHz), vp.pxPerM);
      const res = solveCached(scene, link), g = gateOf(link.id), muted = !!(g && !g.open);
      const pts = [link.rx.pos];
      const dv = link.rx.diversity;
      if (dv && dv.enabled && dv.antennaB && dv.antennaB.pos) pts.push(dv.antennaB.pos);
      for (const p of pts) {
        const d = Math.hypot(p.x - e0.x, p.y - e0.y);
        const a = M.ringArrival(d, phase, sp.spacingM, vp.pxPerM, 7);
        const s = vp.worldToScreen(p.x, p.y);
        arrival(ctx, th, s.x, s.y, a, res && res.status, muted);
      }
    }
    label(ctx, th, w, h, lambda0, mult0);
  }

  // ---- field mode (offscreen, low resolution, throttled) ---------------------------------------
  const field = { canvas: null, ctx: null, img: null, w: 0, h: 0, key: '', at: 0, pxPerM: 0, ox: 0, oy: 0, scene: null, linkId: '', mode: '' };
  const inkRgb = [29, 39, 51];

  function ensureField(w, h) {
    const cw = Math.max(2, Math.ceil(w / CELL_PX)), ch = Math.max(2, Math.ceil(h / CELL_PX));
    if (!field.canvas || field.w !== cw || field.h !== ch) {
      field.canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(cw, ch) : Object.assign(document.createElement('canvas'), { width: cw, height: ch });
      field.ctx = field.canvas.getContext('2d');
      field.img = field.ctx.createImageData(cw, ch);
      field.w = cw; field.h = ch; field.scene = null;
    }
  }
  const needField = (scene, vp, linkId, mode) => {
    const now = performance.now();
    const same = field.scene === scene && field.pxPerM === vp.pxPerM && field.ox === vp.origin.x && field.oy === vp.origin.y && field.linkId === linkId && field.mode === mode;
    if (same) return false;
    if (now - field.at < FIELD_INTERVAL_MS && field.scene !== null && field.mode === mode) return false;
    field.scene = scene; field.pxPerM = vp.pxPerM; field.ox = vp.origin.x; field.oy = vp.origin.y; field.linkId = linkId; field.mode = mode; field.at = now;
    return true;
  };
  const srcs = new Array(40).fill(0);
  let nSrc = 0;

  function paintField(w, h, toX, toY, valid, k, pz) {
    const { img, w: cw, h: ch } = field, d = img.data;
    const view = srcs.slice(0, nSrc * 5);
    for (let j = 0; j < ch; j++) {
      for (let i = 0; i < cw; i++) {
        const o = (j * cw + i) * 4;
        const px = (i + 0.5) * CELL_PX, py = (j + 0.5) * CELL_PX;
        const X = toX(px, py), Y = toY(px, py);
        if (!valid(X, Y)) { d[o + 3] = 0; continue; }
        const a = M.fieldAlpha(M.fieldRelDb(view, k, X, Y, pz));
        d[o] = inkRgb[0]; d[o + 1] = inkRgb[1]; d[o + 2] = inkRgb[2]; d[o + 3] = Math.round(a * 255);
      }
    }
    field.ctx.putImageData(img, 0, 0);
  }

  function blitField(ctx, w, h) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(field.canvas, 0, 0, field.w * CELL_PX, field.h * CELL_PX);
    ctx.restore();
  }

  function drawPlanField(ctx, th, vp, scene, w, h, link) {
    const list = emittersFor(scene);
    const e = list.find((q) => q.linkId === link.id);
    if (!e) return;
    ensureField(w, h);
    if (needField(scene, vp, link.id, 'plan')) {
      const rgb = parseColor(th.ink, inkRgb); inkRgb[0] = rgb[0]; inkRgb[1] = rgb[1]; inkRgb[2] = rgb[2];
      nSrc = 0;
      const put = (x, y, z, a, ph) => { const o = nSrc * 5; srcs[o] = x; srcs[o + 1] = y; srcs[o + 2] = z; srcs[o + 3] = a; srcs[o + 4] = ph; nSrc++; };
      put(e.x, e.y, e.z, 1, 0);
      const env = scene.environment || {};
      if (env.model !== 'free-space') { // the floor image sits straight below the emitter: circular fringes in the plan
        let gm = 0.5, gph = Math.PI;
        try {
          const gr = floorReflection(env.floor, env.polarisation || 'vertical', Math.atan2(e.z + link.rx.pos.z, Math.max(Math.hypot(link.rx.pos.x - e.x, link.rx.pos.y - e.y), 1e-6)) / DEG, link.freqMHz);
          gm = Math.hypot(gr.re, gr.im); gph = Math.atan2(gr.im, gr.re);
        } catch { /* default */ }
        put(e.x, e.y, -e.z, gm, gph);
      }
      for (const ri of reflInfo) {
        const dist = (e.x - ri.w.p1.x) * ri.nx + (e.y - ri.w.p1.y) * ri.ny;
        put(e.x - 2 * dist * ri.nx, e.y - 2 * dist * ri.ny, e.z, ri.mag, ri.ph);
      }
      const k = TWO_PI / M.wavelengthM(link.freqMHz);
      paintField(w, h, (px) => (px - vp.origin.x) / vp.pxPerM, (px, py) => (py - vp.origin.y) / vp.pxPerM, () => true, k, link.rx.pos.z);
    }
    blitField(ctx, w, h);
    fieldCaption(ctx, th, w, h, 'plan');
  }

  function fieldCaption(ctx, th, w, h, kind) {
    haloText(ctx, th, kind === 'plan' ? 'Field at receiver height: direct wave, floor and wall reflections; light rings are nulls' : 'Field: direct wave plus floor reflection; light bands are nulls', w / 2, h - 8, { align: 'center', px: 11, color: th.inkSoft });
  }

  // ---- side --------------------------------------------------------------------------------------
  function drawSide(ctx, th, vp, scene, link, geom, w, h) {
    if (!settings.on || !link || !geom) return;
    const env = scene.environment || {};
    const list = emittersFor(scene);
    const e = list.find((q) => q.linkId === link.id);
    if (!e) return;
    const azU = Math.atan2(geom.u.x, geom.u.y) / DEG;
    const fy = vp.worldToScreen(0, 0).y;
    // heights above the ground: item height plus the floor beneath it; the reflecting plane is the floor at the specular point
    const zrAbs = link.rx.pos.z + floorHeightAt(scene, link.rx.pos.x, link.rx.pos.y), ztAbs = link.tx.pos.z + floorHeightAt(scene, link.tx.pos.x, link.tx.pos.y);
    let hr = floorHeightAt(scene, link.tx.pos.x, link.tx.pos.y);
    { const rs = solveCached(scene, link); const fp = rs && rs.paths && rs.paths.find((q) => q.kind === 'floor'); const bp = fp && fp.points && fp.points[1]; if (bp) hr = floorHeightAt(scene, bp.x, bp.y); }
    const zr = zrAbs, zt = ztAbs;
    const horiz = geom.D;
    // floor reflection at the grazing angle of the real Tx -> floor -> Rx path
    let gm = 0.5, gph = Math.PI;
    try {
      const gr = floorReflection(env.floor, env.polarisation || 'vertical', Math.atan2((zt - hr) + (zr - hr), Math.max(horiz, 1e-6)) / DEG, link.freqMHz);
      gm = Math.hypot(gr.re, gr.im); gph = Math.atan2(gr.im, gr.re);
    } catch { /* default */ }
    const lambda = M.wavelengthM(link.freqMHz);
    const sp = M.ringSpacing(lambda, vp.pxPerM);
    if (settings.field) {
      ensureField(w, h);
      if (needField(scene, vp, link.id, 'side')) {
        const rgb = parseColor(th.ink, inkRgb); inkRgb[0] = rgb[0]; inkRgb[1] = rgb[1]; inkRgb[2] = rgb[2];
        nSrc = 0;
        const sT = geom.sTx ?? 0;
        srcs[0] = sT; srcs[1] = zt; srcs[2] = 0; srcs[3] = 1; srcs[4] = 0;
        srcs[5] = sT; srcs[6] = 2 * hr - zt; srcs[7] = 0; srcs[8] = env.model === 'free-space' ? 0 : gm; srcs[9] = gph; nSrc = 2;
        const k = TWO_PI / lambda;
        paintField(w, h, (px) => (px - vp.origin.x) / vp.pxPerM, (px, py) => -((py - vp.origin.y) / vp.pxPerM), (X, Y) => Y >= 0, k, 0);
      }
      blitField(ctx, w, h);
      fieldCaption(ctx, th, w, h, 'side');
      return;
    }
    const g = gateOf(link.id), muted = !!(g && !g.open);
    const table = sideTable(e, azU);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, fy); ctx.clip(); // only above the floor
    ctx.lineCap = 'butt';
    const sTx = geom.sTx ?? 0, sRx = geom.sRx ?? geom.D;
    const c = vp.worldToScreen(sTx, -zt);
    P.cx = c.x; P.cy = c.y; P.table = table; P.idx = null; P.mirror = false; P.planMode = false; P.extra = 0;
    P.spacingM = sp.spacingM; P.pxPerM = vp.pxPerM; P.maxRpx = farthest(c.x, c.y, w, h); P.cap = MAX_RINGS; P.refD = Math.max(sp.spacingM, 0.5);
    setRingStyle(ctx, th, e, muted);
    strokeRings(ctx);
    if (env.model !== 'free-space') {
      const ic = vp.worldToScreen(sTx, -(2 * hr - zt)); // image source below the local floor plane
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, vp.worldToScreen(0, -hr).y); ctx.clip(); // reflected rings live above the local floor plane
      P.cx = ic.x; P.cy = ic.y; P.mirror = true; P.extra = -20 * Math.log10(Math.max(gm, 0.05)) + 3; P.maxRpx = farthest(ic.x, ic.y, w, h); P.cap = 36;
      setRingStyle(ctx, th, e, muted);
      strokeRings(ctx);
      ctx.restore();
      P.mirror = false; P.extra = 0;
    }
    ctx.restore();
    const d = Math.hypot(horiz, zr - zt);
    const a = M.ringArrival(d, phase, sp.spacingM, vp.pxPerM, 7);
    const res = solveCached(scene, link);
    const rp = vp.worldToScreen(sRx, -zr);
    arrival(ctx, th, rp.x, rp.y, a, res && res.status, muted);
    label(ctx, th, w, h, lambda, sp.multiple);
  }

  // ---- loop and visibility ------------------------------------------------------------------------
  function anyVisible() {
    for (const v of views.values()) if (v.visible) return true;
    return false;
  }
  function running() {
    return settings.on && !settings.field && !settings.paused && !reduced && !document.hidden && anyVisible() && views.size > 0;
  }
  function invalidateAll() { for (const v of views.values()) v.invalidate(); }
  function loop(ts) {
    raf = 0;
    if (!running()) return;
    if (ts - lastTs >= FRAME_MS) {
      const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
      lastTs = ts;
      phase = M.advancePhase(phase, dt, M.BASE_RINGS_PER_S * settings.speed);
      invalidateAll();
    }
    raf = requestAnimationFrame(loop);
  }
  function kick() {
    if (!raf && running()) { lastTs = 0; raf = requestAnimationFrame(loop); }
  }
  function emit() { for (const cb of [...subs]) cb(settings); }
  function set(patch) {
    Object.assign(settings, patch);
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
    emit(); invalidateAll(); kick();
  }
  const onVis = () => kick();
  document.addEventListener('visibilitychange', onVis);
  const onMq = () => { reduced = !!(mq && mq.matches); phase = reduced ? 0 : phase; emit(); invalidateAll(); kick(); };
  if (mq && mq.addEventListener) mq.addEventListener('change', onMq);
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver((entries) => {
      for (const en of entries) for (const v of views.values()) if (v.canvas === en.target) v.visible = en.isIntersecting;
      kick();
    });
  }

  // ---- controls in the pane header --------------------------------------------------------------
  function buildControls(canvas, kind) {
    const pane = canvas.parentElement;
    const h2 = pane && pane.querySelector('h2');
    if (!pane || !h2) return null;
    let head = pane.querySelector(':scope > .pane-head');
    if (!head) {
      head = document.createElement('div');
      head.className = 'pane-head';
      pane.insertBefore(head, h2);
      head.append(h2);
    }
    const ctl = document.createElement('div');
    ctl.className = 'ripple-ctl';
    ctl.setAttribute('role', 'group');
    ctl.setAttribute('aria-label', `${kind === 'plan' ? 'Plan' : 'Side'} ripple controls`);
    const mk = (tag, props, text) => { const e = document.createElement(tag); Object.assign(e, props); if (text) e.textContent = text; return e; };
    const lOn = mk('label', { className: 'rc-check' }); const cOn = mk('input', { type: 'checkbox' }); lOn.append(cOn, document.createTextNode(' Ripples'));
    const lSp = mk('label', { className: 'rc-speed', title: 'Visual speed only. The rings move slowly so you can read them; real radio waves travel about 300 million metres per second.' });
    const rng = mk('input', { type: 'range', min: '0.25', max: '4', step: '0.05' });
    rng.setAttribute('aria-label', 'Ripple visual speed (not real RF speed)');
    const spTxt = mk('span', { className: 'rc-sp' });
    const spNum = mk('span'); const spVis = mk('span', { className: 'rc-vis' }, ', visual only');
    spTxt.append(spNum, spVis);
    lSp.append(document.createTextNode('Speed '), rng, spTxt);
    const lFd = mk('label', { className: 'rc-check', title: 'Show the static interference pattern of the direct and reflected waves' }); const cFd = mk('input', { type: 'checkbox' }); lFd.append(cFd, document.createTextNode(' Field'));
    const bP = mk('button', { type: 'button', className: 'rc-pause' }, 'Pause'); bP.setAttribute('aria-pressed', 'false');
    const note = mk('span', { className: 'rc-note hint' });
    ctl.append(lOn, lSp, lFd, bP, note);
    head.append(ctl);
    cOn.addEventListener('change', () => set({ on: cOn.checked }));
    rng.addEventListener('input', () => set({ speed: parseFloat(rng.value) }));
    cFd.addEventListener('change', () => set({ field: cFd.checked }));
    bP.addEventListener('click', () => set({ paused: !settings.paused }));
    const sync = () => {
      cOn.checked = settings.on; rng.value = String(settings.speed); spNum.textContent = `${settings.speed.toFixed(2)}x`;
      cFd.checked = settings.field; bP.textContent = settings.paused ? 'Resume' : 'Pause'; bP.setAttribute('aria-pressed', String(settings.paused));
      rng.disabled = !settings.on || settings.field; bP.disabled = !settings.on || settings.field || reduced; cFd.disabled = !settings.on;
      note.textContent = !settings.on ? '' : settings.field
        ? 'Field: where the direct and reflected waves cancel (a null) the shading is light. Moving the receiver a few centimetres can change a null into a peak.'
        : reduced ? 'Reduced motion: static rings. Spacing is the true wavelength.' : '';
      note.hidden = !note.textContent;
    };
    subs.add(sync); sync();
    return { head, ctl, sync };
  }

  function attach(kind, canvas, invalidate) {
    const ui = buildControls(canvas, kind);
    const v = { canvas, invalidate, visible: true, ui };
    views.set(kind, v);
    if (observer) observer.observe(canvas);
    kick();
    return () => {
      views.delete(kind);
      if (observer) observer.unobserve(canvas);
      if (ui) { subs.delete(ui.sync); ui.ctl.remove(); }
    };
  }

  return {
    settings, attach, set, drawPlan, drawSide, debug: dbg,
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb); },
    get phase() { return phase; },
    destroy() {
      document.removeEventListener('visibilitychange', onVis);
      if (mq && mq.removeEventListener) mq.removeEventListener('change', onMq);
      if (observer) observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
