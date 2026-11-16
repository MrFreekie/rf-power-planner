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
/** Rows of a per-material candidate: [{ material, current, fitted, readings, text }] (empty for single-number candidates). */
export function materialRows(c) {
  return ((c && Array.isArray(c.byMaterial)) ? c.byMaterial : []).map((r) => ({ material: r.material, current: r.current, fitted: r.fitted, readings: r.readings, text: `${r.material}: ${f1(r.current)} → ${f1(r.fitted)} dB, ${r.readings} reading${r.readings === 1 ? '' : 's'}` }));
}
/** One plain line for a candidate's change; per-material candidates (current and fitted are maps) list the materials. */
export function changeText(c) {
  if (c && c.byMaterial) return `${c.label}: ${materialRows(c).map((r) => `${r.material} ${f1(r.current)} → ${f1(r.fitted)} dB`).join(', ') || 'no materials'}`;
  return `${c.label}: ${f1(c.current)} ${unitOf(c.field)} → ${f1(c.fitted)} ${unitOf(c.field)}`;
}
export function cardViews(sug) {
  if (!sug) return [];
  return (sug.candidates || []).map((c, i) => ({
    id: c.id, label: c.label, field: c.field, applicable: !!c.applicable && c.improvementDb >= NEEDED_IMPROVEMENT_DB && sug.needed !== false, isBest: !!sug.best && sug.best.id === c.id,
    change: changeText(c), materials: materialRows(c), perMaterial: !!c.byMaterial,
    lowConfidence: c.confidence === 'low' ? 'Low confidence: some wall materials rest on very few readings. Walk more paths through each wall type before relying on these figures.' : '',
    ignored: c.byMaterial && c.ignoredReadings > 0 ? `${c.ignoredReadings} reading${c.ignoredReadings === 1 ? '' : 's'} left out of this fit (no wall crossed, or a material with too few readings).` : '',
    rms: `rms ${f1(sug.before.rmsDb)} → ${f1(c.afterRmsDb)} dB`,
    improvement: `improves by ${f1(c.improvementDb)} dB`,
    reason: !c.applicable ? (c.reason || 'Not applicable to this scene.') : (c.improvementDb < NEEDED_IMPROVEMENT_DB || sug.needed === false) ? `it changes the rms by less than ${NEEDED_IMPROVEMENT_DB} dB, so there is nothing worth applying.` : '',
    candidate: c, order: i,
  }));
}
/** Cautions and the headline for the calibration section. */
export function calibrationNotes(sug, n) {
  const out = { headline: '', cautions: [], notes: [] };
  if (!sug || !n) { out.headline = 'Add readings to get a calibration suggestion.'; return out; }
  out.cautions = (sug.cautions || []).filter((t) => !/already matches/i.test(t)); // the headline says it
  out.notes = Array.isArray(sug.notes) ? sug.notes.filter((t) => typeof t === 'string' && t) : [];
  out.headline = sug.headline && /does not match|already matches/i.test(sug.headline) && !sug.best ? sug.headline : sug.best ? (sug.best.byMaterial ? `Best fit: ${changeText(sug.best)}${sug.best.confidence === 'low' ? ' (low confidence)' : ''}.` : `Best fit: ${sug.best.label} (${f1(sug.best.current)} → ${f1(sug.best.fitted)} dB).`) : 'No single calibration value explains these readings.';
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
let cache = { scene: null, sig: null, val: null, at: 0 };
/** The parts of a scene that change a comparison. The venue underlay and other big, unrelated fields are left out of the key. */
export function measureSignature(scene) {
  try { return JSON.stringify([scene.measurements, scene.links, scene.environment, scene.reflectors, scene.noiseSources]); } catch { return null; }
}
/**
 * compareMeasurements memoised by scene identity, then by a content signature (the walk replaces the scene object every frame).
 * opts.throttleMs: while the content keeps changing (a walk), return the previous result for that long instead of solving every frame.
 */
export function cachedCompare(scene, opts = {}) {
  if (!scene || !Array.isArray(scene.measurements) || !scene.measurements.length) return null;
  if (cache.scene === scene) return cache.val;
  const sig = measureSignature(scene);
  if (sig !== null && sig === cache.sig) { cache.scene = scene; return cache.val; }
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (opts.throttleMs > 0 && cache.val && cache.count === scene.measurements.length && now - cache.at < opts.throttleMs) return cache.val;
  const val = compareMeasurements(scene);
  cache = { scene, sig, val, at: now, count: scene.measurements.length };
  return val;
}
export function resetCompareCache() { cache = { scene: null, sig: null, val: null, at: 0 }; }

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
