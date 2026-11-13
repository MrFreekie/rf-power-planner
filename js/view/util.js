// Shared helpers for the canvas views: theme, canvas host (DPR, resize, rAF), scene lookups, grid, scale bar.
import { niceGridStep } from './viewport.js';
import { solveLink } from '../model/rf.js';

export const DEG = Math.PI / 180;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round2 = (v) => Math.round(v * 100) / 100;

/** Read the CSS custom properties (see css/style.css) so canvas colours follow the stylesheet. */
export function readTheme(el) {
  const cs = getComputedStyle(el);
  const g = (n, d) => cs.getPropertyValue(n).trim() || d;
  return {
    paper: g('--paper', '#fbf9f3'), paper2: g('--paper-2', '#f1eee4'),
    ink: g('--ink', '#1d2733'), inkSoft: g('--ink-soft', '#5b6673'),
    grid: g('--grid', '#e6e1d3'), gridMajor: g('--grid-major', '#d2cbb7'), hatch: g('--hatch', '#d9d3c1'),
    pass: g('--pass', '#2e8b57'), marginal: g('--marginal', '#d99a00'), fail: g('--fail', '#c0392b'),
    font: g('--font', 'system-ui, -apple-system, "Segoe UI", sans-serif'),
    reduceMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}
export const statusColor = (th, status) => (status === 'pass' ? th.pass : status === 'marginal' ? th.marginal : status === 'fail' ? th.fail : th.inkSoft);

/**
 * Canvas host: HiDPI backing store, ResizeObserver, redraw only when invalidated (rAF-coalesced).
 * draw(ctx, w, h, theme) gets a context already scaled so 1 unit = 1 CSS px.
 */
export function createCanvasHost(canvas, draw, onResize) {
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1, raf = 0, dirty = true, dead = false;
  const host = { get width() { return w; }, get height() { return h; }, invalidate, destroy };

  function resize() {
    if (dead) return;
    const r = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    w = Math.max(1, Math.round(r.width)); h = Math.max(1, Math.round(r.height));
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    if (r.width > 0 && r.height > 0 && onResize) onResize(w, h);
    invalidate();
  }
  function frame() {
    raf = 0;
    if (dead || !dirty || w < 2 || h < 2) return;
    dirty = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    draw(ctx, w, h, readTheme(canvas));
  }
  function invalidate() { dirty = true; if (!raf && !dead) raf = requestAnimationFrame(frame); }
  function destroy() { dead = true; ro?.disconnect(); window.removeEventListener('resize', resize); if (raf) cancelAnimationFrame(raf); }

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  ro?.observe(canvas);
  window.addEventListener('resize', resize);
  queueMicrotask(resize); // after the caller has stored the returned host
  return host;
}

// ---- scene lookups -----------------------------------------------------------------------
/** Find what a selection id refers to: {type:'tx'|'rx'|'reflector'|'link', link?, item}. */
export function findItem(scene, id) {
  if (!id || !scene) return null;
  for (const link of scene.links || []) {
    if (link.tx?.id === id) return { type: 'tx', link, item: link.tx };
    if (link.rx?.id === id) return { type: 'rx', link, item: link.rx };
    if (link.id === id) return { type: 'link', link, item: link };
  }
  for (const r of scene.reflectors || []) if (r.id === id) return { type: 'reflector', item: r };
  return null;
}
/** The link the side view and detail overlays follow: the selection's link, else the first link. */
export function activeLink(scene, selection) {
  const f = findItem(scene, selection);
  return (f && f.link) || (scene.links && scene.links[0]) || null;
}
export function selectableIds(scene) {
  const ids = [];
  for (const l of scene.links || []) ids.push(l.tx.id, l.rx.id);
  for (const r of scene.reflectors || []) ids.push(r.id);
  return ids;
}

const solveCache = new WeakMap(); // scene object (copy-on-write => identity changes on edit) -> Map(linkId -> result)
/** solveLink with a per-scene-object cache; returns null if the model throws. */
export function solveCached(scene, link) {
  if (!link) return null;
  let m = solveCache.get(scene);
  if (!m) solveCache.set(scene, (m = new Map()));
  if (!m.has(link.id)) {
    let r = null;
    try { r = solveLink(scene, link); } catch (e) { console.warn('solveLink failed', e); }
    m.set(link.id, r);
  }
  return m.get(link.id);
}

export function fmtLen(m, units) {
  return units?.length === 'ft' ? `${(m * 3.28084).toFixed(1)} ft` : `${m.toFixed(m < 10 ? 2 : 1)} m`;
}
export const fmtDb = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + ' dB';
export const fmtDbm = (v) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + ' dBm';

// ---- drawing helpers -------------------------------------------------------------------------
export function setFont(ctx, th, px = 12, weight = '') {
  ctx.font = `${weight} ${px}px ${th.font}`.trim();
}

/** Label with a paper-coloured halo so it stays legible over lines. */
export function haloText(ctx, th, text, x, y, { align = 'left', baseline = 'alphabetic', color, px = 12, weight = '' } = {}) {
  setFont(ctx, th, px, weight);
  ctx.textAlign = align; ctx.textBaseline = baseline;
  ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = th.paper;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color || th.ink;
  ctx.fillText(text, x, y);
}

/**
 * Metre grid over the visible area. yLabel(v) maps world y to the displayed number (side view: -y = z).
 * Major lines every 5 steps; labels on the top and left edges.
 */
export function drawGrid(ctx, vp, w, h, th, { yLabel = (v) => v, xName = '', yName = '' } = {}) {
  const step = niceGridStep(vp.pxPerM, 48);
  const b = vp.visibleBounds(w, h);
  const dec = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const lines = (axis) => {
    const lo = axis === 'x' ? b.x0 : Math.min(b.y0, b.y1), hi = axis === 'x' ? b.x1 : Math.max(b.y0, b.y1);
    const i0 = Math.floor(lo / step), i1 = Math.ceil(hi / step);
    if (i1 - i0 > 400) return;
    for (let i = i0; i <= i1; i++) {
      const major = i % 5 === 0;
      ctx.strokeStyle = major ? th.gridMajor : th.grid;
      ctx.lineWidth = major ? 1 : 0.7;
      ctx.beginPath();
      if (axis === 'x') { const p = vp.worldToScreen(i * step, 0).x; ctx.moveTo(Math.round(p) + 0.5, 0); ctx.lineTo(Math.round(p) + 0.5, h); }
      else { const p = vp.worldToScreen(0, i * step).y; ctx.moveTo(0, Math.round(p) + 0.5); ctx.lineTo(w, Math.round(p) + 0.5); }
      ctx.stroke();
    }
  };
  lines('x'); lines('y');
  // labels on every 5th... or every line if there is room
  const labelEvery = step * vp.pxPerM >= 56 ? 1 : 5;
  const stepLabel = (axis) => {
    const lo = axis === 'x' ? b.x0 : Math.min(b.y0, b.y1), hi = axis === 'x' ? b.x1 : Math.max(b.y0, b.y1);
    for (let i = Math.floor(lo / step); i <= Math.ceil(hi / step); i++) {
      if (i % labelEvery !== 0) continue;
      const v = i * step;
      if (axis === 'x') {
        const p = vp.worldToScreen(v, 0).x;
        if (p > 18 && p < w - 6) haloText(ctx, th, v.toFixed(dec), p, 13, { align: 'center', color: th.inkSoft, px: 11 });
      } else {
        const p = vp.worldToScreen(0, v).y;
        if (p > 22 && p < h - 6) haloText(ctx, th, yLabel(v).toFixed(dec), 4, p - 3, { color: th.inkSoft, px: 11 });
      }
    }
  };
  stepLabel('x'); stepLabel('y');
  if (w < 520) return; // phone: skip axis captions
  if (xName) haloText(ctx, th, xName, w - 6, 13, { align: 'right', color: th.inkSoft, px: 11 });
  if (yName) haloText(ctx, th, yName, 4, 26, { color: th.inkSoft, px: 11 });
}

/** Scale bar (metres) in the bottom-left corner. */
export function drawScaleBar(ctx, vp, h, th) {
  const target = 110; // px
  const L = niceGridStep(vp.pxPerM, target * 0.6);
  const px = L * vp.pxPerM, x0 = 14, y0 = h - 16;
  ctx.strokeStyle = th.ink; ctx.lineWidth = 1.5; ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.moveTo(x0, y0 - 5); ctx.lineTo(x0, y0); ctx.lineTo(x0 + px, y0); ctx.lineTo(x0 + px, y0 - 5); ctx.stroke();
  ctx.fillStyle = th.ink; ctx.fillRect(x0, y0 - 3, px / 2, 3);
  haloText(ctx, th, `${L < 1 ? L.toFixed(L < 0.1 ? 2 : 1) : L} m`, x0 + px / 2, y0 - 8, { align: 'center', px: 12 });
}

export function strokeHatchRect(ctx, x, y, w, h, color, gap = 8) {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
  for (let k = -h; k < w; k += gap) { ctx.moveTo(x + k, y + h); ctx.lineTo(x + k + h, y); }
  ctx.stroke(); ctx.restore();
}
