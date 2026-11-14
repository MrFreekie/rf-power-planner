// Canvas drawing for the VNA lab: rectangular trace plots, the Smith chart and the distance-to-fault trace.
// Light technical-drawing style: thin ink lines, colour only for the memory trace and warnings. Markers are numbered diamonds.
import { setFont, haloText } from './util.js';
import { dtfDbSeries } from '../ui/vnaState.js';

const TXT = 12; // minimum text size
const fin = Number.isFinite;

export function ticks(min, max, count = 5) {
  const span = Math.max(max - min, 1e-9), raw = span / Math.max(count, 1), pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw - 1e-12) || 10 * pow, out = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
const fmtTick = (v) => (Math.abs(v) >= 1000 ? String(Math.round(v)) : String(+v.toFixed(2)));

function frame(ctx, w, h, th, { xMin, xMax, yMin, yMax, xName, yName, xTicks, yTicks, L = 52, R = 22, T = 14, B = 38 }) {
  const pw = Math.max(10, w - L - R), ph = Math.max(10, h - T - B);
  const X = (x) => L + ((x - xMin) / (xMax - xMin || 1)) * pw, Y = (y) => T + ph - ((y - yMin) / (yMax - yMin || 1)) * ph;
  ctx.fillStyle = th.paper; ctx.fillRect(L, T, pw, ph);
  setFont(ctx, th, TXT); ctx.lineWidth = 1;
  for (const v of yTicks) {
    const y = Math.round(Y(v)) + 0.5;
    ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
    ctx.fillStyle = th.inkSoft; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(fmtTick(v), L - 5, y);
  }
  for (const v of xTicks) {
    const x = Math.round(X(v)) + 0.5;
    ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke();
    ctx.fillStyle = th.inkSoft; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(fmtTick(v), x, T + ph + 4);
  }
  ctx.strokeStyle = th.ink; ctx.strokeRect(L + 0.5, T + 0.5, pw, ph);
  ctx.fillStyle = th.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillText(xName, L + pw / 2, h - 5);
  ctx.save(); ctx.translate(13, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(yName, 0, 0); ctx.restore();
  return { L, T, pw, ph, X, Y, xMin, xMax, yMin, yMax };
}
function polyline(ctx, xs, ys, X, Y, { color, dash = [], width = 1.5, clip }) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.beginPath();
  let pen = false;
  for (let i = 0; i < xs.length; i++) {
    if (!fin(ys[i])) { pen = false; continue; }
    const x = X(xs[i]), y = Math.min(clip.b, Math.max(clip.t, Y(ys[i])));
    if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y); pen = true;
  }
  ctx.stroke(); ctx.setLineDash([]);
}
function diamond(ctx, th, x, y, n, active) {
  const r = active ? 6 : 5;
  ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
  ctx.fillStyle = active ? th.ink : th.paper; ctx.fill(); ctx.strokeStyle = th.ink; ctx.lineWidth = active ? 2 : 1.5; ctx.stroke();
  haloText(ctx, th, String(n), x + r + 2, y - r, { px: TXT, weight: '700' });
}
const interp = (xs, ys, x) => {
  const n = xs.length; if (!n) return NaN; if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  const k = (x - xs[lo]) / (xs[hi] - xs[lo] || 1); return ys[lo] + k * (ys[hi] - ys[lo]);
};

function emptyNote(ctx, w, h, th, text) {
  haloText(ctx, th, text, w / 2, h / 2, { align: 'center', px: TXT + 1, color: th.inkSoft });
}

/** Rectangular plot. spec from vnaState.plotSpec. Returns the geometry for pointer hit-testing (or null when nothing was drawn). */
export function drawRect(ctx, w, h, th, spec, { markers = [], active = -1, labelMemory = 'memory' } = {}) {
  ctx.fillStyle = th.paper; ctx.fillRect(0, 0, w, h);
  if (!spec.ys) { emptyNote(ctx, w, h, th, spec.note || 'No data'); return null; }
  const xs = spec.xs, xMin = xs[0], xMax = xs[xs.length - 1];
  const f = frame(ctx, w, h, th, { xMin, xMax, yMin: spec.yMin, yMax: spec.yMax, xName: 'frequency (MHz)', yName: spec.yName, xTicks: ticks(xMin, xMax, w < 420 ? 4 : 7), yTicks: ticks(spec.yMin, spec.yMax, 5) });
  const clip = { t: f.T, b: f.T + f.ph };
  ctx.save(); ctx.beginPath(); ctx.rect(f.L, f.T, f.pw, f.ph); ctx.clip();
  for (const r of spec.refLines || []) {
    if (r.y < spec.yMin || r.y > spec.yMax) continue;
    ctx.strokeStyle = th.inkSoft; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(f.L, f.Y(r.y)); ctx.lineTo(f.L + f.pw, f.Y(r.y)); ctx.stroke(); ctx.setLineDash([]);
  }
  if (spec.mem && spec.mem.ys) polyline(ctx, spec.mem.xs, spec.mem.ys, f.X, f.Y, { color: th.blue, dash: [6, 4], width: 1.5, clip });
  polyline(ctx, xs, spec.ys, f.X, f.Y, { color: th.ink, width: 1.75, clip });
  ctx.restore();
  for (const r of spec.refLines || []) if (r.y >= spec.yMin && r.y <= spec.yMax) haloText(ctx, th, r.label, f.L + f.pw - 4, f.Y(r.y) - 3, { align: 'right', px: TXT, color: th.inkSoft });
  haloText(ctx, th, spec.title, f.L + 6, f.T + 14, { px: TXT, weight: '600' });
  if (spec.mem && spec.mem.ys) haloText(ctx, th, `solid = measured, dashed = ${labelMemory}`, f.L + 6, f.T + 29, { px: TXT, color: th.blue });
  markers.forEach((m, i) => {
    const x = Math.round(f.X(m.fMHz)) + 0.5;
    ctx.strokeStyle = th.ink; ctx.lineWidth = i === active ? 1.5 : 1; ctx.setLineDash(i === active ? [] : [4, 3]);
    ctx.beginPath(); ctx.moveTo(x, f.T); ctx.lineTo(x, f.T + f.ph); ctx.stroke(); ctx.setLineDash([]);
    const v = interp(xs, spec.ys, m.fMHz); if (fin(v)) diamond(ctx, th, x, Math.min(clip.b, Math.max(clip.t, f.Y(v))), i + 1, i === active);
  });
  return f;
}

/** Smith chart (Gamma plane, 50 ohm normalised). Points come from traceSet().smith. */
export function drawSmith(ctx, w, h, th, traces, mem, { markers = [], active = -1 } = {}) {
  ctx.fillStyle = th.paper; ctx.fillRect(0, 0, w, h);
  const R = Math.max(30, Math.min(w, h) / 2 - 22), cx = w / 2, cy = h / 2;
  const P = (x, y) => [cx + x * R, cy - y * R];
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
  ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
  for (const r of [0.2, 0.5, 1, 2, 5]) { ctx.beginPath(); const c = P(r / (1 + r), 0); ctx.arc(c[0], c[1], R / (1 + r), 0, Math.PI * 2); ctx.stroke(); }
  for (const x of [0.2, 0.5, 1, 2, 5]) for (const s of [1, -1]) { ctx.beginPath(); const c = P(1, s / x); ctx.arc(c[0], c[1], R / x, 0, Math.PI * 2); ctx.stroke(); }
  ctx.strokeStyle = th.gridMajor || th.grid; ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = th.ink; ctx.lineWidth = 1.25; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  setFont(ctx, th, TXT); ctx.fillStyle = th.inkSoft; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
  for (const r of [0, 0.5, 1, 2, 5]) { const g = r / (1 + r), p = P(g - (r === 0 ? 0 : 0), 0); if (r === 0) continue; ctx.fillText(String(r), p[0] - 1, p[1] + 3); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('short', cx - R + 14, cy - 3); ctx.fillText('open', cx + R - 14, cy - 3);
  const clampP = (s) => { const m = Math.hypot(s.x, s.y), k = m > 1.15 ? 1.15 / m : 1; return P(s.x * k, s.y * k); };
  const trace = (pts, color, dash, width) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.beginPath();
    pts.forEach((s, i) => { const p = clampP(s); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.stroke(); ctx.setLineDash([]);
  };
  if (mem && mem.smith) trace(mem.smith, th.blue, [6, 4], 1.5);
  trace(traces.smith, th.ink, [], 1.75);
  const first = clampP(traces.smith[0]), last = clampP(traces.smith[traces.smith.length - 1]);
  haloText(ctx, th, `${+traces.fMHz[0].toFixed(0)}`, first[0] + 6, first[1] - 4, { px: TXT, color: th.inkSoft });
  haloText(ctx, th, `${+traces.fMHz[traces.fMHz.length - 1].toFixed(0)} MHz`, last[0] + 6, last[1] + 12, { px: TXT, color: th.inkSoft });
  markers.forEach((m, i) => {
    const k = interp(traces.fMHz, traces.fMHz.map((_, j) => j), m.fMHz), j0 = Math.floor(k), j1 = Math.min(traces.smith.length - 1, j0 + 1), t = k - j0;
    const a = traces.smith[j0], b = traces.smith[j1], p = clampP({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    diamond(ctx, th, p[0], p[1], i + 1, i === active);
  });
  haloText(ctx, th, 'Smith chart, 50 ohm (rings = resistance, arcs = reactance)', 6, 14, { px: TXT, weight: '600' });
  if (mem && mem.smith) haloText(ctx, th, 'dashed = memory', 6, 29, { px: TXT, color: th.blue });
  return { cx, cy, R };
}

/** Distance-to-fault: |h(d)| in dB against distance, with the peaks labelled. */
export function drawDtf(ctx, w, h, th, d, { faultM = null } = {}) {
  ctx.fillStyle = th.paper; ctx.fillRect(0, 0, w, h);
  if (!d) { emptyNote(ctx, w, h, th, 'No distance-to-fault data'); return null; }
  const xs = d.dtf.distanceM, ys = dtfDbSeries(d.dtf), mem = d.mem ? dtfDbSeries(d.mem) : null;
  const f = frame(ctx, w, h, th, { xMin: 0, xMax: xs[xs.length - 1], yMin: -60, yMax: 0, xName: `distance from the VNA port (m), velocity factor ${d.vf}`, yName: 'reflection (dB)', xTicks: ticks(0, xs[xs.length - 1], w < 420 ? 4 : 8), yTicks: [-60, -40, -20, 0], L: 52, B: 38 });
  const clip = { t: f.T, b: f.T + f.ph };
  ctx.save(); ctx.beginPath(); ctx.rect(f.L, f.T, f.pw, f.ph); ctx.clip();
  if (mem) polyline(ctx, xs, mem, f.X, f.Y, { color: th.blue, dash: [6, 4], clip });
  polyline(ctx, xs, ys, f.X, f.Y, { color: th.ink, width: 1.75, clip });
  if (faultM != null) { ctx.strokeStyle = th.warnText; ctx.lineWidth = 1.5; ctx.setLineDash([2, 3]); const x = Math.round(f.X(faultM)) + 0.5; ctx.beginPath(); ctx.moveTo(x, f.T); ctx.lineTo(x, f.T + f.ph); ctx.stroke(); ctx.setLineDash([]); }
  ctx.restore();
  haloText(ctx, th, `Distance to fault (resolution ${d.dtf.resolutionM.toFixed(2)} m, range ${d.dtf.rangeM.toFixed(1)} m)`, f.L + 6, f.T + 14, { px: TXT, weight: '600' });
  if (faultM != null) haloText(ctx, th, `planted fault ${faultM.toFixed(2)} m`, f.L + 6, f.T + 29, { px: TXT, color: th.warnText });
  const top = [...d.dtf.peaks].sort((a, b) => b.magnitude - a.magnitude).slice(0, 4);
  for (const p of top) {
    const x = f.X(p.distanceM), y = f.Y(Math.max(-60, 20 * Math.log10(Math.max(1e-4, p.magnitude))));
    ctx.fillStyle = th.ink; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    haloText(ctx, th, `${p.distanceM.toFixed(2)} m`, Math.min(f.L + f.pw - 28, x + 5), Math.max(f.T + 44, y - 6), { px: TXT });
  }
  return f;
}
