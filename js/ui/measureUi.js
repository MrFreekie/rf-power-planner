// Walk-test calibration GUI helpers (pure, no DOM): delta classes with words, row and summary text, calibration cards, the delta chart layout and a
// cached compareMeasurements (the plan redraws every frame while a walk runs; each comparison solves one link per point).
import { compareMeasurements, NEEDED_IMPROVEMENT_DB } from '../model/measurements.js';

export const OK_DB = 2, HIGH_DB = 6;
/** Diverging palette: measured stronger than predicted = blue, weaker = orange, close = grey. Always paired with a text word. */
export const DELTA_COLORS = Object.freeze({
  light: { pos: '#1f5f9e', neg: '#b0480f', ok: '#4a4a4a' },
  dark: { pos: '#7db4ec', neg: '#f0a070', ok: '#b8b8b8' },
});
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');
const sgn = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);

/** deltaView(deltaDb) -> { sign: 'ok'|'pos'|'neg', size: 'close'|'moderate'|'large', short: '+3.2', word, label } (delta = measured - predicted). */
export function deltaView(d) {
  if (!Number.isFinite(d)) return { sign: 'ok', size: 'close', short: '-', word: 'no prediction', label: 'no prediction' };
  const a = Math.abs(d), size = a <= OK_DB ? 'close' : a <= HIGH_DB ? 'moderate' : 'large';
  const sign = a <= OK_DB ? 'ok' : d > 0 ? 'pos' : 'neg';
  const word = sign === 'ok' ? 'close to prediction' : d > 0 ? (size === 'large' ? 'much stronger than predicted' : 'stronger than predicted') : (size === 'large' ? 'much weaker than predicted' : 'weaker than predicted');
  return { sign, size, short: sgn(d), word, label: `${sgn(d)} dB, ${word}` };
}
export const deltaColor = (d, dark) => DELTA_COLORS[dark ? 'dark' : 'light'][deltaView(d).sign];

/** Short marker label for the plan, e.g. "-6.2 weak". */
export function markerLabel(d) {
  const v = deltaView(d);
  return `${v.short} dB ${v.sign === 'ok' ? 'ok' : d > 0 ? 'strong' : 'weak'}`;
}

export function summaryText(cmp) {
  if (!cmp || !cmp.n) return cmp && cmp.skipped ? `No usable readings (${cmp.skipped} skipped: unknown link or bad value).` : 'No measurements yet. Add readings from a walk test to compare them with the model.';
  const w = cmp.worst ? `, worst ${sgn(cmp.worst.deltaDb)} dB` : '';
  const sk = cmp.skipped ? `, ${cmp.skipped} skipped` : '';
  const bias = Math.abs(cmp.meanDb) <= 0.5 ? 'no clear bias' : cmp.meanDb > 0 ? 'the room is stronger than predicted on average' : 'the room is weaker than predicted on average';
  return `${cmp.n} reading${cmp.n === 1 ? '' : 's'}: mean ${sgn(cmp.meanDb)} dB (${bias}), rms ${f1(cmp.rmsDb)} dB${w}${sk}.`;
}

/** Rows for the table, in scene order, with the prediction when it could be solved. */
export function tableRows(scene, cmp) {
  const by = new Map(((cmp && cmp.points) || []).map((p) => [p.id, p]));
  return (scene.measurements || []).map((m, i) => {
    const p = by.get(m.id);
    return { id: m.id, n: i + 1, x: m.x, y: m.y, z: m.z, rxDbm: m.rxDbm, note: m.note || '', linkId: m.linkId, predictedDbm: p ? p.predictedDbm : null, deltaDb: p ? p.deltaDb : null, view: deltaView(p ? p.deltaDb : NaN) };
  });
}

const unitOf = (field) => 'dB';
/** Calibration cards: one per candidate with plain text and a flag for the Apply button. */
export function cardViews(sug) {
  if (!sug) return [];
  return (sug.candidates || []).map((c, i) => ({
    id: c.id, label: c.label, field: c.field, applicable: !!c.applicable && c.improvementDb >= NEEDED_IMPROVEMENT_DB && sug.needed !== false, isBest: !!sug.best && sug.best.id === c.id,
    change: `${c.label}: ${f1(c.current)} ${unitOf(c.field)} → ${f1(c.fitted)} ${unitOf(c.field)}`,
    rms: `rms ${f1(sug.before.rmsDb)} → ${f1(c.afterRmsDb)} dB`,
    improvement: `improves by ${f1(c.improvementDb)} dB`,
    reason: !c.applicable ? (c.reason || 'Not applicable to this scene.') : (c.improvementDb < NEEDED_IMPROVEMENT_DB || sug.needed === false) ? `it changes the rms by less than ${NEEDED_IMPROVEMENT_DB} dB, so there is nothing worth applying.` : '',
    candidate: c, order: i,
  }));
}
/** Cautions and the headline for the calibration section. */
export function calibrationNotes(sug, n) {
  const out = { headline: '', cautions: [] };
  if (!sug || !n) { out.headline = 'Add readings to get a calibration suggestion.'; return out; }
  out.cautions = (sug.cautions || []).filter((t) => !/already matches/i.test(t)); // the headline says it
  out.headline = sug.needed === false && !sug.best ? 'The model already matches these readings; no calibration is needed.' : sug.best ? `Best fit: ${sug.best.label} (${f1(sug.best.current)} → ${f1(sug.best.fitted)} dB).` : 'No single calibration value explains these readings.';
  return out;
}

/** Delta chart layout in a w x h box: x by order or distance from the transmitter, y in dBm. Returns { pts, x0, x1, y0, y1, xMin, xMax, dMin, dMax }. */
export function chartLayout(scene, cmp, mode, w, h, pad = { l: 52, r: 16, t: 28, b: 40 }) {
  const pts = (cmp && cmp.points) || [];
  const linkOf = (id) => (scene.links || []).find((l) => l.id === id);
  const xv = pts.map((p, i) => {
    if (mode !== 'distance') return i + 1;
    const l = linkOf(p.linkId); const t = l && l.tx && l.tx.pos;
    return t ? Math.hypot(p.x - t.x, p.y - t.y) : i + 1;
  });
  const lo = Math.min(...xv, 0), hi = Math.max(...xv, lo + 1);
  const vals = pts.flatMap((p) => [p.measuredDbm, p.predictedDbm]).filter(Number.isFinite);
  let dMin = Math.min(...vals, 0), dMax = Math.max(...vals, -1);
  if (!vals.length) { dMin = -100; dMax = -20; }
  dMin = Math.floor((dMin - 3) / 5) * 5; dMax = Math.ceil((dMax + 3) / 5) * 5;
  if (dMax - dMin < 10) dMax = dMin + 10;
  const x0 = pad.l, x1 = Math.max(x0 + 10, w - pad.r), y0 = pad.t, y1 = Math.max(y0 + 10, h - pad.b);
  const sx = (v) => x0 + ((v - lo) / (hi - lo || 1)) * (x1 - x0), sy = (v) => y1 - ((v - dMin) / (dMax - dMin)) * (y1 - y0);
  const order = pts.map((p, i) => ({ p, x: sx(xv[i]), xv: xv[i], ym: sy(p.measuredDbm), yp: sy(p.predictedDbm) }));
  const sorted = mode === 'distance' ? [...order].sort((a, b) => a.xv - b.xv) : order;
  return { pts: sorted, x0, x1, y0, y1, xMin: lo, xMax: hi, dMin, dMax, sx, sy, mode };
}

// ---- cached comparison -------------------------------------------------------------------------------------------------------------------------------
let cache = { scene: null, sig: null, val: null };
/** compareMeasurements memoised by scene identity, then by a content signature (the walk replaces the scene object every frame). */
export function cachedCompare(scene) {
  if (!scene || !Array.isArray(scene.measurements) || !scene.measurements.length) return null;
  if (cache.scene === scene) return cache.val;
  let sig; try { sig = JSON.stringify(scene); } catch { sig = null; }
  if (sig !== null && sig === cache.sig) { cache.scene = scene; return cache.val; }
  const val = compareMeasurements(scene);
  cache = { scene, sig, val };
  return val;
}
export function resetCompareCache() { cache = { scene: null, sig: null, val: null }; }

/** Report block: null when there are no readings. */
export function reportMeasurements(scene) {
  const cmp = cachedCompare(scene);
  if (!cmp || !cmp.n) return null;
  return {
    n: cmp.n, skipped: cmp.skipped, meanDb: cmp.meanDb, rmsDb: cmp.rmsDb, worst: cmp.worst, text: summaryText(cmp),
    rows: tableRows(scene, cmp).slice(0, 40),
    truncated: Math.max(0, (scene.measurements || []).length - 40),
  };
}
