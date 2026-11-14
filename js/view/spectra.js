// Bottom-bar spectrum views, in a row beside the timeline: Audio spectrum, MPX spectrum, RF spectrum.
//   Audio: simulated programme (voice-like for mics, music-like for IEMs; stereo draws L and R), js/model/spectrum-views.js audioSpectrum.
//   MPX:   the FM stereo baseband spectrum moved here from the MPX panel (same drawing code, mpxSpectrum from js/model/mpx.js).
//   RF:    the selected link's single carrier only (js/model/spectrum-views.js rfSpectrum); no other devices, no intermod, no interference.
// Pure helpers are exported for tests; mountSpectra() is the DOM part. The model modules are imported lazily so a missing
// one only blanks its own panel. Animation: one low-rate loop (about 20 fps) while running; paused or prefers-reduced-motion
// freezes the simulated time t.
import { createCanvasHost, activeLink, solveCached, setFont, haloText } from './util.js';
import { mpxSpectrum } from '../model/mpx.js';
import { getFmPreset } from '../model/fm-presets.js';
import { telemetry, dataConfig } from '../telemetryTracker.js';
import { squelch } from '../squelchTracker.js';
import { digitalConfig } from '../digitalTracker.js';
import { mpxMessage, modeText, SPEC_DB } from './mpx.js';

export const SPECTRA = Object.freeze([
  { id: 'audio', label: 'Audio spectrum' },
  { id: 'mpx', label: 'MPX spectrum' },
  { id: 'rf', label: 'RF spectrum' },
]);
export const TABS_BELOW_PX = 640; // the spectra container is narrower than this: show one spectrum at a time under tabs
export const FRAME_MS = 50; // about 20 fps for the animated views

// ---- pure helpers ----------------------------------------------------------------------------

/** 'tabs' (one spectrum at a time) or 'row' (all three) for the width of the spectra container. */
export const spectraLayout = (widthPx) => (widthPx > 0 && widthPx < TABS_BELOW_PX ? 'tabs' : 'row');

const fin = (v) => Number.isFinite(v);
const sgn = (v, d = 1) => (fin(v) ? `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}` : '-');

/** Nearest index of sorted `arr` to `x`; -1 when empty. */
export function nearestIndex(arr, x) {
  if (!arr || !arr.length) return -1;
  let lo = 0, hi = arr.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m; else hi = m; }
  return Math.abs(arr[lo] - x) <= Math.abs(arr[hi] - x) ? lo : hi;
}

/** Round tick values covering [min, max] with about `count` ticks on 1/2/5 steps. */
export function niceTicks(min, max, count = 5) {
  const span = Math.max(max - min, 1e-9), raw = span / Math.max(count, 1);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw - 1e-12) || 10 * pow;
  const out = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

/** Nominal FM deviation of the link's transmitter or receiver preset (kHz), else a class default. */
export function linkDeviationKhz(link) {
  const dev = (id) => { const q = id ? getFmPreset(id) : null; return q && q.params && fin(q.params.deviationKhz) ? q.params.deviationKhz : null; };
  return dev(link && link.tx && link.tx.fmPreset) ?? dev(link && link.rx && link.rx.rxPreset) ?? (link && link.kind === 'iem' ? 48 : 40);
}

/** Arguments for rfSpectrum from the solved link (only this link's carrier). Returns null when there is no usable level. */
export function rfInputs(scene, link, r, t, nBins = 240) {
  if (!link || !r || !fin(r.inputPowerDbm)) return null;
  const cas = r.cascade || {};
  const digital = !!(link.modulation && link.modulation.type === 'digital');
  const channelBwKhz = fin(cas.bandwidthKHz) ? cas.bandwidthKHz : 200;
  const noiseFloorDbm = fin(cas.noiseFloorDbm) ? cas.noiseFloorDbm : -110;
  let occupiedBwKhz = null;
  if (digital) { const c = digitalConfig(link); if (fin(c.symbolRateKSps)) occupiedBwKhz = Math.round(c.symbolRateKSps * 1.33); }
  return {
    carrierMHz: link.freqMHz, rxLevelDbm: r.inputPowerDbm, mode: digital ? 'digital' : 'fm',
    devKhz: linkDeviationKhz(link), audioMaxKhz: 15, occupiedBwKhz, channelBwKhz, noiseFloorDbm,
    spanKhz: Math.max(600, Math.round(channelBwKhz * 3)), nBins, t,
  };
}

/** Arguments for audioSpectrum. Stereo only for an IEM link with MPX stereo on and the receiver not in mono. */
export function audioInputs(link, mpxState, t, nBins = 200) {
  const iem = !!link && link.kind === 'iem';
  const stereoOn = iem && !!(link.mpx && link.mpx.enabled) && !(mpxState && mpxState.mode === 'mono');
  return { kind: iem ? 'iem' : 'mic', stereo: stereoOn, nBins, fMaxHz: 20000, t, preEmphasisTauUs: 50, deEmphasised: true };
}

export const audioSummary = (a, inp) => (a
  ? `Audio spectrum, simulated ${inp.kind === 'iem' ? `music${inp.stereo ? ' in stereo (left and right)' : ' (mono)'}` : 'voice'}, 0 to ${Math.round(inp.fMaxHz / 1000)} kilohertz, after de-emphasis. Noise floor ${sgn(a.floorDb, 0)} dB. Illustrative, not a measurement.`
  : 'Audio spectrum not available.');

export function rfSummary(s, inp) {
  if (!s) return 'RF spectrum not available: no received level for this link.';
  const bw = fin(s.bwKhz) ? `${Math.round(s.bwKhz)} kHz` : '-';
  let t = `RF spectrum of this link's carrier only (${inp.mode === 'digital' ? 'digital, flat-topped' : 'analogue FM'}): received level ${sgn(inp.rxLevelDbm)} dBm, ${sgn(s.marginToNoiseDb)} dB above the receiver channel noise floor ${sgn(inp.noiseFloorDbm, 0)} dBm (the plot shows power per ${fin(s.rbwKhz) ? Math.round(s.rbwKhz) : '-'} kHz resolution bandwidth, so the noise trace sits lower), occupied bandwidth ${bw} in a ${Math.round(inp.channelBwKhz)} kHz receiver channel.`;
  if (s.clipsAtFilter) t += ' The signal is wider than the receiver filter and is clipped by it.';
  return t;
}

export const mpxSummary = (st) => (st
  ? `MPX baseband spectrum 0 to 60 kilohertz. ${modeText(st)}, pilot ${st.pilotLocked ? 'locked' : 'lost'}, carrier to noise ${sgn(st.cnrDb)} dB.`
  : 'MPX baseband spectrum');

// ---- drawing -----------------------------------------------------------------------------------

/** Plot frame with ticks and labels. Returns { L, T, pw, ph, X(x), Y(y) }. */
function frame(ctx, w, h, th, { xMin, xMax, yMin, yMax, xTicks, yTicks, xFmt = String, yFmt = String, xName = '', yName = '', L = 40, R = 8, T = 20, B = 30 }) {
  const pw = w - L - R, ph = h - T - B;
  const X = (x) => L + ((x - xMin) / (xMax - xMin)) * pw;
  const Y = (y) => T + ph - ((Math.min(Math.max(y, yMin), yMax) - yMin) / (yMax - yMin)) * ph;
  ctx.fillStyle = th.paper2; ctx.fillRect(L, T, pw, ph);
  setFont(ctx, th, 11); ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 1; ctx.strokeStyle = th.grid; ctx.fillStyle = th.inkSoft;
  ctx.textAlign = 'right';
  for (const v of yTicks) { const y = Math.round(Y(v)) + 0.5; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.fillText(yFmt(v), L - 4, y + 4); }
  ctx.textAlign = 'center';
  for (const v of xTicks) { const x = Math.round(X(v)) + 0.5; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke(); ctx.fillText(xFmt(v), Math.min(Math.max(x, L + 8), w - R - 8), T + ph + 13); }
  ctx.strokeStyle = th.ink; ctx.strokeRect(L + 0.5, T + 0.5, pw - 1, ph - 1);
  if (xName) { ctx.fillStyle = th.inkSoft; ctx.textAlign = 'center'; ctx.fillText(xName, L + pw / 2, h - 3); }
  if (yName) { ctx.save(); ctx.translate(10, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillStyle = th.inkSoft; ctx.textAlign = 'center'; ctx.fillText(yName, 0, 0); ctx.restore(); }
  return { L, T, pw, ph, X, Y };
}

function curve(ctx, f, xs, ys, { stroke, fill, alpha = 0.3, width = 1.4, dash = null }) {
  if (!xs.length) return;
  ctx.save(); ctx.beginPath(); ctx.rect(f.L, f.T, f.pw, f.ph); ctx.clip();
  if (fill) {
    ctx.beginPath(); ctx.moveTo(f.X(xs[0]), f.T + f.ph);
    xs.forEach((x, i) => ctx.lineTo(f.X(x), f.Y(ys[i])));
    ctx.lineTo(f.X(xs[xs.length - 1]), f.T + f.ph); ctx.closePath();
    ctx.globalAlpha = alpha; ctx.fillStyle = fill; ctx.fill(); ctx.globalAlpha = 1;
  }
  ctx.beginPath(); xs.forEach((x, i) => (i ? ctx.lineTo(f.X(x), f.Y(ys[i])) : ctx.moveTo(f.X(x), f.Y(ys[i]))));
  if (dash) ctx.setLineDash(dash);
  ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke();
  ctx.restore();
}

function note(ctx, w, h, th, text) {
  setFont(ctx, th, 13); ctx.fillStyle = th.inkSoft; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const words = text.split(' '); let line = '', y = h / 2 - 8; const lines = [];
  for (const wd of words) { const tt = line ? line + ' ' + wd : wd; if (ctx.measureText(tt).width > w - 24 && line) { lines.push(line); line = wd; } else line = tt; }
  lines.push(line);
  y = h / 2 - ((lines.length - 1) * 9);
  for (const l of lines) { ctx.fillText(l, w / 2, y); y += 18; }
  ctx.textBaseline = 'alphabetic';
}

function hoverMark(ctx, th, f, h, w, hoverX, xs, ys, fmtX, fmtY) {
  if (hoverX == null || hoverX < f.L || hoverX > f.L + f.pw || !xs.length) return;
  const xv = ((hoverX - f.L) / f.pw) * (f.xMax - f.xMin) + f.xMin;
  const i = nearestIndex(xs, xv); if (i < 0) return;
  const px = f.X(xs[i]), py = f.Y(ys[i]);
  ctx.save(); ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(px, f.T); ctx.lineTo(px, f.T + f.ph); ctx.stroke(); ctx.restore();
  ctx.fillStyle = th.ink; ctx.beginPath(); ctx.arc(px, py, 3, 0, 2 * Math.PI); ctx.fill();
  const txt = `${fmtX(xs[i])}: ${fmtY(ys[i])}`;
  haloText(ctx, th, txt, Math.min(Math.max(px, f.L + 60), f.L + f.pw - 60), f.T + 12, { align: 'center', px: 12, weight: '600' });
}

/** Audio spectrum panel. a = audioSpectrum result. */
export function drawAudio(ctx, w, h, th, a, inp, hoverX) {
  if (!a || !a.freqsHz || !a.freqsHz.length) { note(ctx, w, h, th, 'Audio spectrum not available.'); return; }
  const yMin = -90, yMax = 0, fMaxK = a.freqsHz[a.freqsHz.length - 1] / 1000;
  const f = frame(ctx, w, h, th, { xMin: 0, xMax: fMaxK, yMin, yMax, xTicks: niceTicks(0, fMaxK, w < 300 ? 4 : 5), yTicks: [-90, -60, -30, 0], xFmt: (v) => String(v), xName: 'audio frequency (kHz)', yName: 'dB' });
  f.xMin = 0; f.xMax = fMaxK;
  const xs = a.freqsHz.map((v) => v / 1000);
  curve(ctx, f, xs, a.levelsDb, { stroke: th.ink, fill: th.ink });
  if (a.levelsDbR) curve(ctx, f, xs, a.levelsDbR, { stroke: th.blue, fill: th.blue, alpha: 0.18 });
  if (fin(a.floorDb)) curve(ctx, f, [0, fMaxK], [a.floorDb, a.floorDb], { stroke: th.fail, dash: [5, 3] });
  haloText(ctx, th, inp.kind === 'iem' ? (inp.stereo ? 'music, L and R' : 'music, mono') : 'voice', f.L + 4, f.T + 12, { px: 11, weight: '600', color: th.inkSoft });
  haloText(ctx, th, 'simulated', f.L + f.pw - 4, f.T + f.ph - 5, { align: 'right', px: 11, color: th.inkSoft });
  hoverMark(ctx, th, f, h, w, hoverX, xs, a.levelsDb, (v) => `${v.toFixed(1)} kHz`, (v) => `${v.toFixed(0)} dB`);
}

/** RF spectrum panel. s = rfSpectrum result, inp = the arguments it was made from. */
export function drawRf(ctx, w, h, th, s, inp, hoverX) {
  if (!s || !s.freqsMHz || !s.freqsMHz.length) { note(ctx, w, h, th, 'No received level for this link, so there is no RF spectrum to show.'); return; }
  const xs = s.freqsMHz.map((m) => (m - inp.carrierMHz) * 1000);
  const lo = s.noiseDbm, hi = Math.max(...s.levelsDbm.filter(fin), s.noiseDbm); // far skirts can be hundreds of dB down: the axis follows the noise trace
  const yMin = Math.floor((lo - 12) / 10) * 10, yMax = Math.max(Math.ceil((hi + 8) / 10) * 10, yMin + 40);
  const xMin = xs[0], xMax = xs[xs.length - 1];
  const f = frame(ctx, w, h, th, { xMin, xMax, yMin, yMax, xTicks: niceTicks(xMin, xMax, w < 300 ? 4 : 6), yTicks: niceTicks(yMin, yMax, 4), xFmt: (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v), xName: `offset from ${inp.carrierMHz} MHz (kHz)`, yName: `dBm per RBW (${fin(s.rbwKhz) ? s.rbwKhz.toFixed(0) : '-'} kHz)`, L: 44 });
  f.xMin = xMin; f.xMax = xMax;
  // receiver channel window, shaded
  if (s.window) {
    const a = f.X((s.window.lowMHz - inp.carrierMHz) * 1000), b = f.X((s.window.highMHz - inp.carrierMHz) * 1000);
    ctx.fillStyle = th.blue; ctx.globalAlpha = 0.14; ctx.fillRect(a, f.T, b - a, f.ph); ctx.globalAlpha = 1;
    ctx.strokeStyle = th.blue; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(a, f.T); ctx.lineTo(a, f.T + f.ph); ctx.moveTo(b, f.T); ctx.lineTo(b, f.T + f.ph); ctx.stroke(); ctx.setLineDash([]);
    haloText(ctx, th, 'receiver channel', (a + b) / 2, f.T + f.ph - 5, { align: 'center', px: 11, color: th.blue });
  }
  curve(ctx, f, xs, s.levelsDbm, { stroke: s.clipsAtFilter ? th.marginal : th.ink, fill: th.ink });
  curve(ctx, f, [xMin, xMax], [s.noiseDbm, s.noiseDbm], { stroke: th.fail, dash: [5, 3] });
  haloText(ctx, th, `noise in RBW ${sgn(s.noiseDbm, 0)} dBm`, f.L + f.pw - 4, f.Y(s.noiseDbm) - 4, { align: 'right', px: 11, color: th.fail });
  haloText(ctx, th, `rx ${sgn(inp.rxLevelDbm)} dBm  margin ${sgn(s.marginToNoiseDb)} dB  BW ${fin(s.bwKhz) ? Math.round(s.bwKhz) : '-'} kHz`, f.L + 4, f.T + 12, { px: 11, weight: '600' });
  if (s.clipsAtFilter) haloText(ctx, th, 'CLIPS AT FILTER', f.L + f.pw / 2, f.T + 26, { align: 'center', px: 12, weight: '700', color: th.warnText });
  hoverMark(ctx, th, f, h, w, hoverX, xs, s.levelsDbm, (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)} kHz`, (v) => `${v.toFixed(1)} dBm`);
}

/** MPX baseband spectrum: the drawing code moved unchanged from the MPX panel (js/view/mpx.js). */
export function drawMpx(ctx, w, h, th, { state, link, hoverX }) {
  if (!state) return;
  const L = 34, R = 8, T = 22, B = 22;
  const pw = w - L - R, ph = h - T - B;
  const tel0 = link && link.telemetry && link.telemetry.enabled ? telemetry.get(link.id) : null;
  const spanKHz = tel0 ? Math.max(60, dataConfig(link).subcarrierKHz + 8) : 60;
  const X = (k) => L + (k / (spanKHz)) * pw;
  const Y = (db) => T + ph - ((Math.min(Math.max(db, SPEC_DB.min), SPEC_DB.max) - SPEC_DB.min) / (SPEC_DB.max - SPEC_DB.min)) * ph;
  const tel = link && link.telemetry && link.telemetry.enabled ? telemetry.get(link.id) : null;
  const dataKHz = tel ? dataConfig(link).subcarrierKHz : null;
  const maxKHz = dataKHz != null ? Math.max(60, dataKHz + 8) : 60;
  const s = mpxSpectrum(state, { points: Math.max(120, Math.round(pw)), maxKHz, ...(dataKHz != null ? { dataKHz, dataLocked: !!(tel.data && tel.data.locked) } : {}) });
  const blend = state.blend ?? 0;
  ctx.fillStyle = th.paper2; ctx.fillRect(L, T, pw, ph);
  // L-R region shading follows the blend
  ctx.fillStyle = th.blue; ctx.globalAlpha = 0.06 + 0.12 * blend; ctx.fillRect(X(23), T, X(53) - X(23), ph); ctx.globalAlpha = 1;
  ctx.fillStyle = th.mono; ctx.globalAlpha = 0.18; ctx.fillRect(X(0.03), T, X(15) - X(0.03), ph); ctx.globalAlpha = 1;
  // grid
  setFont(ctx, th, 11); ctx.textBaseline = 'alphabetic';
  for (let db = SPEC_DB.min; db <= SPEC_DB.max; db += 30) {
    const y = Math.round(Y(db)) + 0.5;
    ctx.strokeStyle = th.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
    ctx.fillStyle = th.inkSoft; ctx.textAlign = 'right'; ctx.fillText(String(db), L - 4, y + 4);
  }
  const ticks = w < 380 ? [0, 15, 19, 38, 53] : [0, 15, 19, 23, 38, 53, 60];
  if (tel0) ticks.push(dataConfig(link).subcarrierKHz);
  ctx.textAlign = 'center';
  for (const k of ticks) {
    const x = Math.round(X(k)) + 0.5;
    ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke();
    ctx.fillStyle = th.inkSoft; ctx.fillText(k === 60 ? '60 kHz' : String(Math.round(k)), Math.min(Math.max(x, L + 6), w - R - 14), h - 6);
  }
  ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(L + 0.5, T + 0.5, pw - 1, ph - 1);
  // signal + noise fill
  ctx.beginPath(); ctx.moveTo(X(s.freqKHz[0]), Y(SPEC_DB.min));
  s.freqKHz.forEach((fq, i) => ctx.lineTo(X(fq), Y(s.levelDb[i])));
  ctx.lineTo(X(spanKHz), Y(SPEC_DB.min)); ctx.closePath();
  ctx.fillStyle = th.ink; ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = th.ink; ctx.lineWidth = 1.4; ctx.beginPath();
  s.freqKHz.forEach((fq, i) => (i ? ctx.lineTo(X(fq), Y(s.levelDb[i])) : ctx.moveTo(X(fq), Y(s.levelDb[i])))); ctx.stroke();
  // noise floor, dashed
  ctx.save(); ctx.setLineDash([5, 3]); ctx.strokeStyle = th.fail; ctx.lineWidth = 1.4; ctx.beginPath();
  s.freqKHz.forEach((fq, i) => (i ? ctx.lineTo(X(fq), Y(s.noiseDb[i])) : ctx.moveTo(X(fq), Y(s.noiseDb[i])))); ctx.stroke(); ctx.restore();
  // pilot marker
  const px = X(19);
  ctx.strokeStyle = state.pilotLocked ? th.pass : th.fail; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(px, T + 2); ctx.lineTo(px, T + 12); ctx.stroke();
  // region labels
  const lab = (txt, k0, k1, color) => {
    haloText(ctx, th, txt, (X(k0) + X(k1)) / 2, T - 6, { align: 'center', px: 11, weight: '600', color });
  };
  lab('L+R', 0.03, 15, th.ink);
  lab(state.pilotLocked ? 'PILOT' : 'PILOT lost', 15.5, 22.5, state.pilotLocked ? th.pass : th.fail);
  lab(w < 380 ? 'L−R' : 'L−R stereo', 23, 53, blend > 0.05 ? th.blue : th.inkSoft);
  if (s.dataBand) {
    const [a, b] = s.dataBand;
    ctx.fillStyle = th.marginal; ctx.globalAlpha = s.dataLevelDb > -100 ? 0.35 : 0.1; ctx.fillRect(X(a), T, Math.max(X(b) - X(a), 3), ph); ctx.globalAlpha = 1;
    haloText(ctx, th, s.dataLocked ? 'DATA' : 'DATA lost', X(s.dataKHz), T + ph - 6, { align: 'center', px: 11, weight: '600', color: s.dataLocked ? th.warnText : th.fail });
  }
  const sqs = link ? squelch.get(link.id) : null;
  if (link && link.interferer && link.interferer.enabled && sqs && sqs.capture && Number.isFinite(sqs.capture.cirDb)) {
    const ifr = link.interferer, cirDb = sqs.capture.cirDb;
    if (ifr.hasPilot) {
      ctx.save(); ctx.strokeStyle = th.marginal; ctx.setLineDash([3, 3]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X(19), T + 14); ctx.lineTo(X(19), T + ph); ctx.stroke(); ctx.restore();
    }
    haloText(ctx, th, `stray carrier${ifr.hasPilot ? ' + pilot' : ' (no pilot)'}  C/I ${cirDb >= 0 ? '+' : '−'}${Math.abs(cirDb).toFixed(1)} dB`, L + pw - 4, T + ph - 6, { align: 'right', px: 11, weight: '600', color: th.warnText });
  }
  haloText(ctx, th, 'noise', X(Math.min(57, spanKHz - 3)), Y(s.noiseDb[s.noiseDb.length - 1]) - 4, { align: 'center', px: 11, color: th.fail });
  if (hoverX != null && hoverX >= L && hoverX <= L + pw) {
    const k = ((hoverX - L) / pw) * spanKHz, i = nearestIndex(s.freqKHz, k);
    if (i >= 0) {
      ctx.save(); ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(s.freqKHz[i]), T); ctx.lineTo(X(s.freqKHz[i]), T + ph); ctx.stroke(); ctx.restore();
      haloText(ctx, th, `${s.freqKHz[i].toFixed(1)} kHz: ${s.levelDb[i].toFixed(0)} dB`, Math.min(Math.max(X(s.freqKHz[i]), L + 60), L + pw - 60), T + 12, { align: 'center', px: 12, weight: '600' });
    }
  }
}

// ---- DOM ---------------------------------------------------------------------------------------

export function mountSpectra({ container, store, now = () => performance.now() }) {
  container.classList.add('spectra');
  container.textContent = '';
  const el = (tag, cls, text, attrs) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const head = el('div', 'spectra-head');
  const h2 = el('h2', null, 'Spectra');
  const tabs = el('div', 'spectra-tabs group', null, { role: 'tablist', 'aria-label': 'Spectrum views' });
  const pauseBtn = el('button', null, reduce ? 'Play' : 'Pause', { type: 'button', 'aria-pressed': String(reduce), title: 'Freeze or run the simulated signals' });
  head.append(h2, tabs, pauseBtn);
  const grid = el('div', 'spectra-grid');
  container.append(head, grid);

  const panels = {};
  let active = 'audio';
  for (const sp of SPECTRA) {
    const tab = el('button', null, sp.label, { type: 'button', role: 'tab', id: `spectra-tab-${sp.id}`, 'aria-controls': `spectra-panel-${sp.id}` });
    tab.addEventListener('click', () => { active = sp.id; syncTabs(); invalidateAll(); });
    tab.addEventListener('keydown', (e) => {
      const i = SPECTRA.findIndex((x) => x.id === active); let j = i;
      if (e.key === 'ArrowRight') j = (i + 1) % SPECTRA.length; else if (e.key === 'ArrowLeft') j = (i + SPECTRA.length - 1) % SPECTRA.length; else return;
      e.preventDefault(); active = SPECTRA[j].id; syncTabs(); panels[active].tab.focus(); invalidateAll();
    });
    tabs.append(tab);
    const panel = el('section', 'spectrum-panel', null, { id: `spectra-panel-${sp.id}`, role: 'tabpanel', 'aria-labelledby': `spectra-tab-${sp.id}` });
    const title = el('h3', null, sp.label);
    const canvas = el('canvas', 'spectrum-canvas', null, { role: 'img', 'aria-label': sp.label, tabindex: '0' });
    const sum = el('p', 'spectrum-sum', '', { role: 'status', 'aria-live': 'off' });
    const about = el('details', 'spectrum-about'); about.append(el('summary', null, 'About this spectrum'));
    const aboutBody = el('p', null, ''); about.append(aboutBody);
    panel.append(title, canvas, sum, about);
    grid.append(panel);
    panels[sp.id] = { tab, panel, canvas, sum, aboutBody, hover: null, lastText: '', host: null };
  }
  function syncTabs() {
    const tabbed = container.classList.contains('spectra-tabbed');
    for (const sp of SPECTRA) {
      const p = panels[sp.id], on = sp.id === active;
      p.tab.setAttribute('aria-selected', String(on)); p.tab.tabIndex = on ? 0 : -1;
      p.panel.hidden = tabbed && !on;
    }
  }

  let model = null, mpxTracker = null;
  import('../model/spectrum-views.js').then((m) => { model = m; invalidateAll(); }).catch((e) => { console.warn('spectrum model missing', e); invalidateAll(); });
  import('../mpxTracker.js').then((m) => { mpxTracker = m.mpx || m.default; mpxTracker.subscribe(() => panels.mpx.host && panels.mpx.host.invalidate()); invalidateAll(); }).catch(() => {});

  let t = 0, lastNow = now(), running = !reduce, loop = 0, lastFrame = 0;
  const ctxInfo = () => {
    const scene = store.getScene(), link = activeLink(scene, store.getSelection());
    const r = link ? solveCached(scene, link) : null;
    const mst = link && mpxTracker ? mpxTracker.get(link.id) : null;
    return { scene, link, r, mst };
  };
  const cache = {}; // last computed result per panel for the hover readout and the text summaries

  /** Model results for one panel (no drawing); also feeds the text summaries of panels that are not on screen. */
  function compute(id, w = 300) {
    const { scene, link, r, mst } = ctxInfo();
    let res = null;
    if (id === 'audio') {
      if (link && model && model.audioSpectrum) { const inp = audioInputs(link, mst, t); let a = null; try { a = model.audioSpectrum(inp); } catch (e) { console.warn(e); } res = { a, inp }; }
    } else if (id === 'rf') {
      if (link && model && model.rfSpectrum) {
        const inp = rfInputs(scene, link, r, t, Math.max(120, Math.min(400, Math.round(w - 52))));
        let s = null; if (inp) { try { s = model.rfSpectrum(inp); } catch (e) { console.warn(e); } }
        res = { s, inp };
      }
    } else if (link && !mpxMessage(link) && mst) res = { st: mst, link };
    cache[id] = res;
    return { res, link, mst };
  }
  function makeDraw(id) {
    return (ctx, w, h, th) => {
      const t0 = now();
      const { res, link, mst } = compute(id, w);
      const hv = panels[id].hover;
      if (id === 'audio') {
        if (!res) note(ctx, w, h, th, link ? 'Audio spectrum model not loaded.' : 'No link selected.'); else drawAudio(ctx, w, h, th, res.a, res.inp, hv);
      } else if (id === 'rf') {
        if (!res) note(ctx, w, h, th, link ? 'RF spectrum model not loaded.' : 'No link selected.'); else drawRf(ctx, w, h, th, res.s, res.inp || { carrierMHz: 0 }, hv);
      } else {
        const m = mpxMessage(link);
        if (m) note(ctx, w, h, th, m);
        else if (!mst) note(ctx, w, h, th, 'Waiting for the MPX model.');
        else drawMpx(ctx, w, h, th, { state: mst, link, hoverX: hv });
      }
      panels[id].canvas.dataset.ms = (now() - t0).toFixed(2);
    };
  }
  function updateText() {
    for (const sp of SPECTRA) if (panels[sp.id].panel.hidden) compute(sp.id);
    const c = cache;
    const texts = {
      audio: c.audio && c.audio.a ? audioSummary(c.audio.a, c.audio.inp) : 'Audio spectrum not available.',
      rf: c.rf && c.rf.inp ? rfSummary(c.rf.s, c.rf.inp) : 'RF spectrum not available.',
      mpx: c.mpx ? mpxSummary(c.mpx.st) : 'MPX baseband spectrum not shown for this link.',
    };
    const notes = {
      audio: ['Standard or illustrative: the signal is simulated, not real audio. Levels are illustrative.', ...((c.audio && c.audio.a && c.audio.a.notes) || [])],
      rf: ["Only the selected link's own carrier is simulated: no other devices, intermodulation or interference.", 'The received level and the channel noise floor are the planner numbers; the carrier shape is illustrative.', ...((c.rf && c.rf.s && c.rf.s.notes) || [])],
      mpx: ['Standard: the 19 kHz pilot, 38 kHz stereo subcarrier and 57 kHz RDS positions are FM broadcast practice. Levels are illustrative.'],
    };
    for (const id of Object.keys(texts)) { const nt = notes[id].join(' '); if (nt !== panels[id].aboutBody.textContent) panels[id].aboutBody.textContent = nt; }
    for (const id of Object.keys(texts)) {
      const p = panels[id];
      if (texts[id] !== p.lastText) { p.lastText = texts[id]; p.sum.textContent = texts[id]; p.canvas.setAttribute('aria-label', texts[id]); }
    }
  }
  for (const sp of SPECTRA) {
    const p = panels[sp.id];
    p.host = createCanvasHost(p.canvas, makeDraw(sp.id));
    p.canvas.addEventListener('pointermove', (e) => { const b = p.canvas.getBoundingClientRect(); p.hover = e.clientX - b.left; p.host.invalidate(); });
    p.canvas.addEventListener('pointerleave', () => { p.hover = null; p.host.invalidate(); });
    p.canvas.addEventListener('keydown', (e) => { // keyboard hover marker: arrows move it, Escape clears
      const b = p.canvas.getBoundingClientRect();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); p.hover = Math.min(b.width, Math.max(0, (p.hover ?? b.width / 2) + (e.key === 'ArrowRight' ? 8 : -8))); p.host.invalidate(); }
      else if (e.key === 'Escape') { p.hover = null; p.host.invalidate(); }
    });
  }
  function invalidateAll() { for (const sp of SPECTRA) { const p = panels[sp.id]; if (p.host && !p.panel.hidden) p.host.invalidate(); } updateText(); }

  function tick(ts) {
    loop = 0;
    if (!running) return;
    const n = now();
    if (n - lastFrame >= FRAME_MS) { t += (n - lastNow) / 1000; lastNow = n; lastFrame = n; invalidateAll(); } else lastNow = lastNow;
    loop = requestAnimationFrame(tick);
  }
  function setRunning(on) {
    running = on; lastNow = now();
    pauseBtn.textContent = on ? 'Pause' : 'Play'; pauseBtn.setAttribute('aria-pressed', String(!on));
    if (on && !loop && !document.hidden) loop = requestAnimationFrame(tick);
    if (!on && loop) { cancelAnimationFrame(loop); loop = 0; }
    invalidateAll();
  }
  pauseBtn.addEventListener('click', () => setRunning(!running));
  const onVis = () => { if (document.hidden) { if (loop) { cancelAnimationFrame(loop); loop = 0; } } else if (running && !loop) { lastNow = now(); loop = requestAnimationFrame(tick); } };
  document.addEventListener('visibilitychange', onVis);

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver((es) => {
    const w = es[0].contentRect.width;
    container.classList.toggle('spectra-tabbed', spectraLayout(w) === 'tabs');
    syncTabs(); invalidateAll();
  }) : null;
  if (ro) ro.observe(container);
  syncTabs();
  const unsub = [store.subscribe(() => invalidateAll())];
  if (running) loop = requestAnimationFrame(tick);
  return {
    setRunning, invalidate: invalidateAll, panels,
    destroy() { running = false; if (loop) cancelAnimationFrame(loop); document.removeEventListener('visibilitychange', onVis); if (ro) ro.disconnect(); unsub.forEach((u) => u && u()); for (const sp of SPECTRA) panels[sp.id].host.destroy(); container.textContent = ''; },
  };
}
