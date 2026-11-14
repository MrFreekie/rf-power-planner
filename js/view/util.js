// Shared helpers for the canvas views: theme, canvas host (DPR, resize, rAF), scene lookups, grid, scale bar.
import { niceGridStep } from './viewport.js';
import { solveLink } from '../model/rf.js';
import { initTheme, isForcedLight, effectiveTheme, LIGHT_TOKENS } from './theme.js';

if (typeof document !== 'undefined') initTheme(); // apply the stored theme as soon as any view module loads

export const DEG = Math.PI / 180;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round2 = (v) => Math.round(v * 100) / 100;

/** Read the CSS custom properties (see css/style.css) so canvas colours follow the stylesheet. */
const hosts = new Set();
/** Smoothed draw time (ms) per canvas; the ripple loop uses it to lower its frame rate when the views are expensive. */
export const drawCost = new WeakMap();
let themeVersion = 0, themeCache = null, themeCacheVer = -1;
if (typeof window !== 'undefined') {
  window.addEventListener('rf-theme', () => { themeVersion++; });
  if (typeof matchMedia === 'function') for (const q of ['(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)']) { const m = matchMedia(q); if (m.addEventListener) m.addEventListener('change', () => { themeVersion++; for (const h of hosts) h.invalidate(); }); }
}

/** Computed-style reads are slow, so the palette is cached until the theme or a media preference changes. */
export function readTheme(el) {
  if (!isForcedLight() && themeCache && themeCacheVer === themeVersion) return themeCache;
  const th = readThemeUncached(el);
  if (!isForcedLight()) { themeCache = th; themeCacheVer = themeVersion; }
  return th;
}
function readThemeUncached(el) {
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const font = (() => { try { return getComputedStyle(el).getPropertyValue('--font').trim(); } catch { return ''; } })() || 'system-ui, -apple-system, "Segoe UI", sans-serif';
  if (isForcedLight()) return { ...LIGHT_TOKENS, mech: { 'front-end': '#4a78b5', 'tx-reverse': '#c77a1f', pim: '#7d5ba6' }, font, reduceMotion, dark: false }; // report snapshots: always the light sheet
  const cs = getComputedStyle(el);
  const g = (n, d) => cs.getPropertyValue(n).trim() || d, L = LIGHT_TOKENS;
  return {
    paper: g('--paper', L.paper), paper2: g('--paper-2', L.paper2),
    ink: g('--ink', L.ink), inkSoft: g('--ink-soft', L.inkSoft),
    grid: g('--grid', L.grid), gridMajor: g('--grid-major', L.gridMajor), hatch: g('--hatch', L.hatch),
    pass: g('--pass', L.pass), marginal: g('--marginal', L.marginal), fail: g('--fail', L.fail),
    warnText: g('--warn-text', L.warnText), onFail: g('--on-fail', L.onFail), blue: g('--blue', L.blue), mono: g('--mono', L.mono),
    mech: { 'front-end': g('--mech-fe', '#4a78b5'), 'tx-reverse': g('--mech-tx', '#c77a1f'), pim: g('--mech-pim', '#7d5ba6') },
    inkRgb: g('--ink-rgb', L.inkRgb).replace(/s+/g, ''),
    dark: effectiveTheme() === 'dark',
    font, reduceMotion,
  };
}
/** rgba() string of the ink colour at the given alpha (translucent fills that must follow the theme). */
export const inkAlpha = (th, a) => `rgba(${th.inkRgb || LIGHT_TOKENS.inkRgb},${a})`;
export const statusColor = (th, status) => (status === 'pass' ? th.pass : status === 'marginal' ? th.marginal : status === 'fail' ? th.fail : th.inkSoft);

/**
 * Canvas host: HiDPI backing store, ResizeObserver, redraw only when invalidated (rAF-coalesced).
 * draw(ctx, w, h, theme) gets a context already scaled so 1 unit = 1 CSS px.
 */
if (typeof window !== 'undefined') window.addEventListener('rf-theme', () => { for (const h of hosts) h.invalidate(); });

export function createCanvasHost(canvas, draw, onResize) {
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1, raf = 0, dirty = true, dead = false, visible = true;
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
    if (!visible) return; // off screen (scrolled away, collapsed or in a hidden panel): stay dirty, draw when it comes back
    dirty = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const t0 = performance.now();
    draw(ctx, w, h, readTheme(canvas));
    const ms = performance.now() - t0, prev = drawCost.get(canvas);
    drawCost.set(canvas, prev === undefined ? ms : prev * 0.85 + ms * 0.15);
  }
  function invalidate() { dirty = true; if (!raf && !dead) raf = requestAnimationFrame(frame); }
  function destroy() { dead = true; hosts.delete(host); io?.disconnect(); ro?.disconnect(); window.removeEventListener('resize', resize); if (raf) cancelAnimationFrame(raf); }

  hosts.add(host);
  const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((es) => {
    const en = es[es.length - 1];
    const v = en.isIntersecting; if (v === visible) return;
    visible = v; if (v) invalidate();
  }, { rootMargin: '120px' }) : null;
  io?.observe(canvas);
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
  for (const p of scene.platforms || []) if (p.id === id) return { type: 'platform', item: p };
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
  for (const p of scene.platforms || []) ids.push(p.id);
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
export function drawGrid(ctx, vp, w, h, th, { yLabel = (v) => v, xName = '', yName = '', xOrigin = 0, yOrigin = 0, yFlip = false } = {}) {
  // Display value k*step sits at world x = xOrigin + k*step, and at world y = yOrigin - k*step (yFlip) or yOrigin + k*step.
  // Plan: xOrigin = stage centre line, yOrigin = front edge, yFlip. Side view: origins 0 and yLabel maps -z to z.
  const step = niceGridStep(vp.pxPerM, 48);
  const b = vp.visibleBounds(w, h);
  const dec = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const yWorld = (k) => (yFlip ? yOrigin - k : yOrigin + k);
  const range = (axis) => {
    if (axis === 'x') return [Math.floor((Math.min(b.x0, b.x1) - xOrigin) / step), Math.ceil((Math.max(b.x0, b.x1) - xOrigin) / step)];
    const lo = Math.min(b.y0, b.y1), hi = Math.max(b.y0, b.y1);
    return yFlip ? [Math.floor((yOrigin - hi) / step), Math.ceil((yOrigin - lo) / step)] : [Math.floor((lo - yOrigin) / step), Math.ceil((hi - yOrigin) / step)];
  };
  const lines = (axis) => {
    const [i0, i1] = range(axis);
    if (i1 - i0 > 400) return;
    for (let i = i0; i <= i1; i++) {
      const major = i % 5 === 0;
      ctx.strokeStyle = major ? th.gridMajor : th.grid;
      ctx.lineWidth = major ? 1 : 0.7;
      ctx.beginPath();
      if (axis === 'x') { const p = vp.worldToScreen(xOrigin + i * step, 0).x; ctx.moveTo(Math.round(p) + 0.5, 0); ctx.lineTo(Math.round(p) + 0.5, h); }
      else { const p = vp.worldToScreen(0, yWorld(i * step)).y; ctx.moveTo(0, Math.round(p) + 0.5); ctx.lineTo(w, Math.round(p) + 0.5); }
      ctx.stroke();
    }
  };
  lines('x'); lines('y');
  // labels on every 5th line, or every line if there is room
  const labelEvery = step * vp.pxPerM >= 56 ? 1 : 5;
  const stepLabel = (axis) => {
    const [i0, i1] = range(axis);
    for (let i = i0; i <= i1; i++) {
      if (i % labelEvery !== 0) continue;
      const v = i * step;
      const txt = (Math.abs(v) < 1e-9 ? 0 : v);
      if (axis === 'x') {
        const p = vp.worldToScreen(xOrigin + v, 0).x;
        if (p > 18 && p < w - 6) haloText(ctx, th, txt.toFixed(dec), p, 13, { align: 'center', color: th.inkSoft, px: 11 });
      } else {
        const p = vp.worldToScreen(0, yWorld(v)).y;
        if (p > 22 && p < h - 6) haloText(ctx, th, (yFlip ? txt : yLabel(yWorld(v))).toFixed(dec), 4, p - 3, { color: th.inkSoft, px: 11 });
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
