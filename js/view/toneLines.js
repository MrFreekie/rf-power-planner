// Programme tone against the MPX tones: which settings apply to the selected link, and the extra lines drawn in the MPX and RF views.
//   toneSetup(scene, link, tone, t, stereo) -> null unless the global audio source is a tone, two-tone or sweep.
//   baseband lines (basebandProducts) are drawn in the MPX view; two-tone FM lines (twoToneFm) in the RF view. Both are model results, levels illustrative (assumed nonlinearity).
import { resolveAudioSource, resolveToneHz, sweepHz } from '../model/audio-source.js';
import { basebandProducts, twoToneFm, TONE_MPX_LIMITS } from '../model/tone-mpx.js';
import { haloText } from './util.js';

export const TONE_SOURCES = Object.freeze(['tone', 'two-tone', 'sweep']);
const fin = (v) => Number.isFinite(v);
const clamp = (v, [a, b]) => Math.min(b, Math.max(a, v));

/** The settings for the selected link, or null when the source is not a tone. Mono links carry no pilot (pilotPct 0). */
export function toneSetup(scene, link, tone, t = 0, stereo = false) {
  if (!link || !tone) return null;
  const source = resolveAudioSource(scene, link);
  if (!TONE_SOURCES.includes(source)) return null;
  const hz = source === 'sweep' ? sweepHz(t) : resolveToneHz(scene);
  return { source, toneKhz: clamp(hz / 1000, TONE_MPX_LIMITS.toneKhz), tonePct: tone.tonePct, pilotPct: stereo ? tone.pilotPct : 0, overloadDb: tone.overloadDb, stereo };
}

/** Baseband lines for the MPX view and the two-tone FM lines for the RF view (peakDevKhz = the link's peak deviation). */
export function toneProducts(setup, peakDevKhz = 75) {
  if (!setup) return null;
  const bp = basebandProducts({ toneKhz: setup.toneKhz, tonePct: setup.tonePct, pilotPct: setup.pilotPct, overloadDb: setup.overloadDb, maxKhz: 100 });
  const tt = twoToneFm({ tone1Khz: setup.toneKhz, dev1Khz: setup.tonePct / 100 * peakDevKhz, tone2Khz: 19, dev2Khz: setup.pilotPct / 100 * peakDevKhz });
  return { setup, baseband: bp.lines, twoTone: tt };
}

const num = (v) => +v.toFixed(v < 10 ? 2 : 1);
export function baseLabel(l, setup) {
  if (l.kind === 'tone') return `tone ${num(setup.toneKhz)} kHz`;
  if (l.kind === 'pilot') return 'pilot 19';
  return l.label || `${num(l.fKhz)} kHz`;
}

/** Stems for each baseband line: solid for the tone and pilot themselves, dashed for products; the strongest products are named. ax = { X, Y, L, T, pw, ph, span, floorDb }. */
export function drawBasebandLines(ctx, th, ax, prod) {
  if (!prod) return;
  const { setup } = prod, lines = prod.baseband.filter((l) => fin(l.fKhz) && l.fKhz >= 0 && l.fKhz <= ax.span && l.levelDb > ax.floorDb);
  const yb = ax.Y(ax.floorDb);
  ctx.save(); ctx.strokeStyle = th.blue; ctx.fillStyle = th.blue; ctx.lineWidth = 1.5;
  for (const l of lines) {
    const x = ax.X(l.fKhz), y = ax.Y(l.levelDb), main = l.kind === 'tone' || l.kind === 'pilot';
    ctx.setLineDash(main ? [] : [3, 2]);
    ctx.beginPath(); ctx.moveTo(x, yb); ctx.lineTo(x, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x - 3.5, y); ctx.lineTo(x + 3.5, y); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  // names: tone first, then the strongest others, no two labels closer than 34 px
  const order = [...lines].sort((a, b) => (b.kind === 'tone') - (a.kind === 'tone') || b.levelDb - a.levelDb);
  const placed = [];
  for (const l of order) {
    if (placed.length >= 9) break;
    const x = ax.X(l.fKhz);
    if (placed.some((p) => Math.abs(p - x) < 34)) continue;
    placed.push(x);
    haloText(ctx, th, baseLabel(l, setup), Math.min(Math.max(x, ax.L + 22), ax.L + ax.pw - 22), ax.Y(l.levelDb) - 8, { align: 'center', px: 11, weight: '600', color: th.blue });
  }
  haloText(ctx, th, `programme ${setup.source === 'sweep' ? 'sweep' : 'tone'} ${num(setup.toneKhz)} kHz at ${Math.round(setup.tonePct)}%${setup.stereo ? `, pilot ${+setup.pilotPct.toFixed(1)}%` : ''}, stage ${setup.overloadDb >= 0 ? '+' : '−'}${Math.abs(setup.overloadDb).toFixed(0)} dB: lines and products`, ax.L + 4, ax.T + ax.ph - 6, { px: 11, color: th.blue });
}

/** Two-tone FM lines in the RF view as thin stems from the bottom; carrier and the +- pilot lines are named. f = the frame (X, Y, L, T, pw, ph), rxLevelDbm = unmodulated carrier. */
export function drawRfLines(ctx, th, f, prod, rxLevelDbm, yMin, xMin, xMax) {
  if (!prod || !fin(rxLevelDbm)) return;
  const tt = prod.twoTone, yb = f.Y(yMin);
  ctx.save(); ctx.strokeStyle = th.blue; ctx.lineWidth = 1; ctx.globalAlpha = 0.85;
  for (const l of tt.lines) {
    if (l.offsetKhz < xMin || l.offsetKhz > xMax) continue;
    const x = Math.round(f.X(l.offsetKhz)) + 0.5, y = f.Y(Math.max(yMin, rxLevelDbm + l.levelDb));
    ctx.beginPath(); ctx.moveTo(x, yb); ctx.lineTo(x, y); ctx.stroke();
  }
  ctx.restore();
  const named = tt.lines.filter((l) => l.offsetKhz >= xMin && l.offsetKhz <= xMax && ((l.n === 0 && l.m === 0) || (l.n === 0 && Math.abs(l.m) === 1))).slice(0, 4);
  for (const l of named) {
    const x = f.X(l.offsetKhz), y = f.Y(Math.max(yMin, rxLevelDbm + l.levelDb));
    haloText(ctx, th, l.m === 0 ? 'carrier line' : `${l.m > 0 ? '+' : '−'}19 kHz pilot line`, Math.min(Math.max(x, f.L + 40), f.L + f.pw - 40), y - 6, { align: 'center', px: 11, weight: '600', color: th.blue });
  }
  haloText(ctx, th, `two-tone FM lines (tone ${num(prod.setup.toneKhz)} kHz, beta ${prod.twoTone.beta1.toFixed(1)}${prod.setup.pilotPct ? ' + pilot' : ''}), occupied about ${Math.round(tt.occupiedKhz)} kHz`, f.L + 4, f.T + 26 + 14, { px: 11, color: th.blue });
}

/** Text rows for the dialog table alternative. */
export function lineRows(prod) {
  if (!prod) return [];
  return prod.baseband.filter((l) => l.levelDb > -90).sort((a, b) => a.fKhz - b.fKhz).map((l) => [`${num(l.fKhz)} kHz`, `${baseLabel(l, prod.setup)} (${l.kind})`, `${l.levelDb.toFixed(1)} dB`]);
}
