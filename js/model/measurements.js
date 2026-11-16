// Walk-test calibration: compare measured levels with the model and fit the assumed figures a measurement can settle. Pure module, no DOM.
//
//   scene.measurements: [{ id, linkId, x, y, z?, rxDbm, note?, t? }] (measurement-schema.js; at most 200). (x, y, z) = where the RECEIVER was when it read rxDbm
//   (dBm at the receiver input, what an RSSI display or analyser at the receiver shows). The transmitter stays where the link has it.
//   predictAt(scene, linkId, point)        -> the solver's level at the receiver input with the receiver moved to the point (dBm), or null for an unknown link
//   compareMeasurements(scene)             -> { points: [{ id, linkId, x, y, z, predictedDbm, measuredDbm, deltaDb }], n, skipped, meanDb, rmsDb, worst }
//                                             deltaDb = measured - predicted (positive: the real link is stronger than the model says)
//   suggestCalibration(scene)              -> { n, before, candidates, best, cautions, notes, needed } (see below)
//   importMeasurementsCsv(text, opts)      -> { points: [{ linkId?, x, y, z?, rxDbm, note?, t? }], errors: [string], lines: [file line of each point] }
//
// suggestCalibration fits ONE offset at a time, each by least squares with bounds, and reports which one leaves the smallest residual:
//   body-loss      environment.bodyLossDb        shifts every point by the same dB (body loss is a plain loss), fitted in closed form: new = old - mean(delta), 0..30 dB
//   wall-loss      environment.wallLossAdjustDb  extra dB per wall crossed on the direct path: closed form from the crossing counts, -10..30 dB
//   wall-loss-by-material  environment.wallLossAdjustByMaterialDb  { material: dB }: one adjustment per wall material, only when the readings span paths crossing different
//                  materials (see MIN_READINGS_PER_MATERIAL); otherwise not applicable and the single wall-loss figure stands. Never suggested unless it beats the single figure.
//   cross-polar    environment.xpdDb             the cross-polar floor (dB), 5..30, found by a bounded 1-D search (the effect is not linear)
// Every candidate is verified by solving the scene again with the fitted value, so afterRmsDb is the real residual, not the linearised one.
// Honest limits: with too few points, or points at nearly the same distance, a constant offset can be explained by any of the three; the cautions say so.
import { solveLink, DEFAULT_XPD_DB } from './rf.js';
import { MEASUREMENT_LIMITS, CALIBRATION_FIELDS, WALL_ADJUST_BY_MATERIAL } from './measurement-schema.js';

export { MEASUREMENT_LIMITS, CALIBRATION_FIELDS };
export const MIN_POINTS_FOR_FIT = 5;      // fewer points than this: a fit is shown with a caution
export const NEEDED_RMS_DB = 1.0;         // a model already within this rms of the measurements needs no calibration
export const MATCH_RMS_DB = 3;            // the model "matches" the readings only when the rms error is within this ...
export const MATCH_WORST_DB = 6;          // ... and no single reading is worse than this
export const NEEDED_IMPROVEMENT_DB = 0.5; // a fit that improves the rms by less than this is not suggested
export const MIN_READINGS_PER_MATERIAL = 3;      // a wall material gets its own figure only when at least this many readings cross it (and at least 2 materials qualify)
export const CONFIDENT_READINGS_PER_MATERIAL = 5; // below this many readings per material the per-material figures are flagged low confidence
const AMBIGUOUS_RATIO = 1.15;             // two candidates within 15 percent of the best residual cannot be told apart

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const r2 = (v) => Math.round(v * 100) / 100;

const linkOf = (scene, id) => (scene && Array.isArray(scene.links) ? scene.links.find((l) => l.id === id) : null) || null;

/** The result of solving link with the receiver at point (z defaults to the receiver's own height). */
function solveAt(scene, link, point) {
  const copy = JSON.parse(JSON.stringify(link));
  copy.rx.pos = { x: point.x, y: point.y, z: finite(point.z) ? point.z : link.rx.pos.z };
  return solveLink(scene, copy);
}

/** predictAt(scene, linkId, point) -> predicted level at the receiver input, dBm, or null when the link does not exist. */
export function predictAt(scene, linkId, point) {
  const link = linkOf(scene, linkId);
  if (!link || !point || !finite(point.x) || !finite(point.y)) return null;
  return solveAt(scene, link, point).inputPowerDbm;
}

const stats = (deltas) => {
  const n = deltas.length;
  if (!n) return { n: 0, meanDb: 0, rmsDb: 0 };
  const mean = deltas.reduce((a, b) => a + b, 0) / n;
  return { n, meanDb: mean, rmsDb: Math.sqrt(deltas.reduce((a, b) => a + b * b, 0) / n) };
};

/** compareMeasurements(scene) -> per point predicted, measured and delta, plus the mean, rms and the worst point. Points of an unknown link, with a bad number or with a non-finite predicted level are counted in `skipped`. */
export function compareMeasurements(scene) {
  const list = scene && Array.isArray(scene.measurements) ? scene.measurements : [];
  const points = [];
  let skipped = 0;
  for (const m of list) {
    const link = linkOf(scene, m && m.linkId);
    if (!link || !finite(m.x) || !finite(m.y) || !finite(m.rxDbm)) { skipped++; continue; }
    const predicted = solveAt(scene, link, m).inputPowerDbm;
    if (!finite(predicted)) { skipped++; continue; } // a non-finite prediction (a muted or broken solve) would poison the mean and rms
    points.push({ id: m.id, linkId: m.linkId, x: m.x, y: m.y, z: finite(m.z) ? m.z : link.rx.pos.z, predictedDbm: predicted, measuredDbm: m.rxDbm, deltaDb: m.rxDbm - predicted });
  }
  const s = stats(points.map((p) => p.deltaDb));
  const worst = points.reduce((a, p) => (!a || Math.abs(p.deltaDb) > Math.abs(a.deltaDb) ? p : a), null);
  return { points, n: s.n, skipped, meanDb: s.meanDb, rmsDb: s.rmsDb, worst: worst ? { id: worst.id, deltaDb: worst.deltaDb } : null };
}

// A copy of the scene whose environment carries one calibration value.
const withEnv = (scene, field, value) => ({ ...scene, environment: { ...(scene.environment || {}), [field]: value } });

function rmsOf(scene) { const c = compareMeasurements(scene); return { rmsDb: c.rmsDb, meanDb: c.meanDb, n: c.n }; }

function directCrossings(res) {
  const d = (res.paths || []).find((p) => !p.reflections || p.reflections.length === 0) || (res.paths || [])[0] || {};
  return Array.isArray(d.crossedWalls) ? d.crossedWalls.length : 0;
}

// Materials of the walls the direct path crosses, one entry per crossing.
function directMaterials(res) {
  const d = (res.paths || []).find((p) => !p.reflections || p.reflections.length === 0) || (res.paths || [])[0] || {};
  return Array.isArray(d.wallLossDetail) ? d.wallLossDetail.map((w) => String(w.material)) : [];
}

// Solve the small normal-equation system A x = b by Gaussian elimination with partial pivoting; null when near-singular (walls always crossed together).
function solveSmall(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]), scale = A.map((r, i) => r[i]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 0.15 * scale[c]) return null; // the material is almost a combination of the others: cannot be told apart
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let v = M[r][n]; for (let k = r + 1; k < n; k++) v -= M[r][k] * x[k]; x[r] = v / M[r][r]; }
  return x;
}

// Minimise f over [lo, hi]: a coarse grid, then golden-section refinement around the best grid cell.
function minimise(f, lo, hi, grid = 11) {
  let bestX = lo, bestF = Infinity;
  const xs = Array.from({ length: grid }, (_, i) => lo + ((hi - lo) * i) / (grid - 1));
  const fs = xs.map((x) => f(x));
  fs.forEach((v, i) => { if (v < bestF) { bestF = v; bestX = xs[i]; } });
  const i = xs.indexOf(bestX);
  let a = xs[Math.max(0, i - 1)], b = xs[Math.min(grid - 1, i + 1)];
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
  for (let k = 0; k < 10; k++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  const x = (a + b) / 2, fx = f(x);
  return fx < bestF ? { x, f: fx } : { x: bestX, f: bestF };
}

/**
 * suggestCalibration(scene) -> {
 *   n, before: { rmsDb, meanDb },
 *   candidates: [{ id, label, field, current, fitted, afterRmsDb, improvementDb, applicable, reason? }] (best first; not applicable ones last),
 *   best: the best applicable candidate that improves the rms by at least NEEDED_IMPROVEMENT_DB, else null,
 *   matches: rms <= MATCH_RMS_DB and worst error <= MATCH_WORST_DB; headline: one plain sentence for the dialog and report (use it instead of building one from needed),
 *   needed: false when the model already matches (rms under NEEDED_RMS_DB) or nothing improves it,
 *   cautions: [plain-language sentences] }
 */
export function suggestCalibration(scene) {
  const base = compareMeasurements(scene);
  const out = { n: base.n, before: { rmsDb: base.rmsDb, meanDb: base.meanDb }, candidates: [], best: null, needed: false, cautions: [], notes: [], matches: false, headline: '' };
  if (base.n === 0) { out.cautions.push('There are no usable measurements: add readings taken at known receiver positions.'); return out; }
  const env = scene.environment || {};

  // distinct geometry: the spread of the distances between the fixed transmitter and the measured receiver positions
  const dists = base.points.map((p) => { const l = linkOf(scene, p.linkId); return Math.hypot(p.x - l.tx.pos.x, p.y - l.tx.pos.y, p.z - l.tx.pos.z); });
  const spread = Math.max(...dists) - Math.min(...dists), meanDist = dists.reduce((a, b) => a + b, 0) / dists.length;
  // one solve per reading: wall crossings, crossed materials and polarisation loss are all read from it
  const solved = base.points.map((p) => solveAt(scene, linkOf(scene, p.linkId), p));
  const crossings = solved.map(directCrossings);
  const matLists = solved.map(directMaterials);
  const polMatters = solved.some((r) => r.polarisation && r.polarisation.lossDb >= 3);

  const cand = (id, label, field, current, fitted, applicable, reason, knownAfterRms) => {
    const lim = CALIBRATION_FIELDS[field], v = Math.min(lim.max, Math.max(lim.min, fitted));
    let after = base.rmsDb;
    if (applicable) after = finite(knownAfterRms) && v === fitted ? knownAfterRms : rmsOf(withEnv(scene, field.split('.')[1], v)).rmsDb; // knownAfterRms: the search already solved this exact value
    out.candidates.push({ id, label, field, current, fitted: applicable ? r2(v) : current, afterRmsDb: after, improvementDb: applicable ? base.rmsDb - after : 0, applicable, ...(!applicable && reason ? { reason } : {}) });
  };

  // 1) body loss: a plain loss in dB; every point moves by the same amount
  const bodyNow = finite(env.bodyLossDb) ? env.bodyLossDb : 0;
  cand('body-loss', 'Body loss', 'environment.bodyLossDb', bodyNow, bodyNow - base.meanDb, base.points.some((p) => linkOf(scene, p.linkId).kind !== 'p2p'), 'point-to-point links carry no body loss');

  // 2) wall loss: closed form from the crossing counts of the points that cross a wall
  const adjNow = finite(env.wallLossAdjustDb) ? env.wallLossAdjustDb : 0;
  // walls whose material has its own per-material figure do not take the single figure, so they are not counted here
  const ovr = env.wallLossAdjustByMaterialDb && typeof env.wallLossAdjustByMaterialDb === 'object' ? env.wallLossAdjustByMaterialDb : null;
  const hasOvr = (m) => !!ovr && Number.isFinite(ovr[m]) && Object.prototype.hasOwnProperty.call(ovr, m);
  const singleCross = crossings.map((k, i) => (ovr && Object.keys(ovr).length ? matLists[i].filter((m) => !hasOvr(m)).length : k));
  const k2 = singleCross.reduce((a, k) => a + k * k, 0);
  if (k2 > 0) {
    const kr = singleCross.reduce((a, k, i) => a + k * (base.points[i].deltaDb), 0);
    cand('wall-loss', 'Extra loss per wall crossed', 'environment.wallLossAdjustDb', adjNow, adjNow - kr / k2, true);
  } else cand('wall-loss', 'Extra loss per wall crossed', 'environment.wallLossAdjustDb', adjNow, adjNow, false, 'no measured path crosses a wall');

  // 3) cross-polar floor: only matters where the antennas are cross-polarised (computed before 2b, which must beat every simpler candidate)
  const xpdNow = finite(env.xpdDb) ? env.xpdDb : DEFAULT_XPD_DB;
  if (polMatters) {
    const lim = CALIBRATION_FIELDS['environment.xpdDb'];
    const fit = minimise((v) => rmsOf(withEnv(scene, 'xpdDb', v)).rmsDb, lim.min, lim.max);
    cand('cross-polar', 'Cross-polar floor', 'environment.xpdDb', xpdNow, fit.x, true, undefined, fit.f);
  } else cand('cross-polar', 'Cross-polar floor', 'environment.xpdDb', xpdNow, xpdNow, false, 'the antennas are not cross-polarised on any measured path');

  // 2b) wall loss per wall material: only when enough readings cross each of at least two materials, and they are not always crossed together
  const byMatNow = env.wallLossAdjustByMaterialDb && typeof env.wallLossAdjustByMaterialDb === 'object' ? env.wallLossAdjustByMaterialDb : {};
  const matCounts = matLists.map((list) => { const c = {}; for (const m of list) c[m] = (c[m] || 0) + 1; return c; });
  const readingsBy = {};
  matCounts.forEach((c) => { for (const m of Object.keys(c)) readingsBy[m] = (readingsBy[m] || 0) + 1; });
  const eligible = Object.keys(readingsBy).filter((m) => readingsBy[m] >= MIN_READINGS_PER_MATERIAL).sort();
  const WM = WALL_ADJUST_BY_MATERIAL;
  const wmId = 'wall-loss-by-material', wmLabel = 'Extra loss per wall, by wall material', wmField = 'environment.wallLossAdjustByMaterialDb';
  const wmNo = (reason) => out.candidates.push({ id: wmId, label: wmLabel, field: wmField, current: { ...byMatNow }, fitted: { ...byMatNow }, afterRmsDb: base.rmsDb, improvementDb: 0, applicable: false, reason });
  let wmFit = null, wmReason = '';
  if (Object.keys(readingsBy).length < 2) wmReason = 'the measured paths cross walls of fewer than two different materials';
  else if (eligible.length < 2) wmReason = `fewer than two wall materials are crossed by at least ${MIN_READINGS_PER_MATERIAL} readings each`;
  else {
    // points that cross a material without enough readings are left out of this fit (that wall would be unconstrained)
    const used = base.points.map((_, i) => i).filter((i) => Object.keys(matCounts[i]).length > 0 && Object.keys(matCounts[i]).every((m) => eligible.includes(m)));
    const n = eligible.length, A = eligible.map(() => new Array(n).fill(0)), bv = new Array(n).fill(0);
    for (const i of used) eligible.forEach((m, r) => { const kr = matCounts[i][m] || 0; if (!kr) return; bv[r] += kr * base.points[i].deltaDb; eligible.forEach((m2, c) => { A[r][c] += kr * (matCounts[i][m2] || 0); }); });
    const perUsed = {};
    used.forEach((i) => { for (const m of Object.keys(matCounts[i])) perUsed[m] = (perUsed[m] || 0) + 1; });
    if (eligible.some((m) => (perUsed[m] || 0) < MIN_READINGS_PER_MATERIAL)) wmReason = `too few readings cross only well-measured materials: at least ${MIN_READINGS_PER_MATERIAL} per material are needed`;
    else {
      const x = solveSmall(A, bv);
      if (!x) wmReason = 'the walls of different materials are always crossed together, so their losses cannot be told apart';
      else wmFit = { x, perUsed, dropped: base.points.filter((_, i) => !used.includes(i) && Object.keys(matCounts[i]).length > 0).length }; // only readings whose wall material is under-measured; readings crossing no wall are not "left out"
    }
  }
  if (wmFit) {
    const fitted = {}, rows = [];
    eligible.forEach((m, r) => {
      const cur = finite(byMatNow[m]) ? byMatNow[m] : adjNow, v = Math.min(WM.max, Math.max(WM.min, cur - wmFit.x[r]));
      fitted[m] = r2(v); rows.push({ material: m, current: r2(cur), fitted: r2(v), readings: wmFit.perUsed[m] });
    });
    const merged = { ...byMatNow, ...fitted };
    const after = rmsOf(withEnv(scene, 'wallLossAdjustByMaterialDb', merged)).rmsDb; // verified by solving again
    const others = out.candidates.filter((c) => c.applicable).map((c) => c.afterRmsDb); // body loss, single wall figure, cross-polar
    const otherBest = others.length ? Math.min(...others) : base.rmsDb;
    const gain = otherBest - after; // must beat the best simpler candidate, or it is overfitting
    if (gain < NEEDED_IMPROVEMENT_DB || otherBest <= after * AMBIGUOUS_RATIO) wmNo('no better than one figure for all walls, body loss or the cross-polar floor, so the simpler one is kept (a per-material fit would overfit)');
    else {
      const low = rows.some((r) => r.readings < CONFIDENT_READINGS_PER_MATERIAL);
      out.candidates.push({ id: wmId, label: wmLabel, field: wmField, current: { ...byMatNow }, fitted: merged, byMaterial: rows, afterRmsDb: after, improvementDb: base.rmsDb - after, applicable: true, confidence: low ? 'low' : 'ok', readingsPerMaterial: wmFit.perUsed, ignoredReadings: wmFit.dropped });
      if (low) out.cautions.push(`Per-material wall figures rest on few readings (under ${CONFIDENT_READINGS_PER_MATERIAL} per material): treat them as low confidence and walk more paths through each wall type.`);
      if (wmFit.dropped > 0) out.cautions.push(`${wmFit.dropped} reading${wmFit.dropped === 1 ? '' : 's'} (a wall material with under ${MIN_READINGS_PER_MATERIAL} readings) left out of the per-material fit.`);
    }
  } else wmNo(wmReason);

  out.candidates.sort((a, b) => (b.applicable - a.applicable) || (a.afterRmsDb - b.afterRmsDb));
  const top = out.candidates[0];
  out.needed = base.rmsDb >= NEEDED_RMS_DB && !!top && top.applicable && top.improvementDb >= NEEDED_IMPROVEMENT_DB;
  out.best = out.needed ? top : null;

  // cautions
  if (base.n < MIN_POINTS_FOR_FIT) out.cautions.push(`Only ${base.n} measurement${base.n === 1 ? '' : 's'}: at least ${MIN_POINTS_FOR_FIT} are needed before a fitted value means much.`);
  if (base.n >= 2 && spread < Math.max(2, 0.1 * meanDist)) out.cautions.push('All the readings are at nearly the same distance from the transmitter, so a constant offset could be body loss, polarisation or a wall: walk a range of distances and through a wall to tell them apart.');
  const app = out.candidates.filter((c) => c.applicable);
  if (out.needed && app.length > 1 && app[1].afterRmsDb <= app[0].afterRmsDb * AMBIGUOUS_RATIO + 1e-9) {
    out.cautions.push(`${app[1].label} explains the readings almost as well as ${app[0].label} (residual ${r2(app[1].afterRmsDb)} dB against ${r2(app[0].afterRmsDb)} dB): the data cannot tell them apart.`);
  }
  if (out.needed && top.afterRmsDb > NEEDED_RMS_DB * 2) out.cautions.push(`Even the best single figure leaves ${r2(top.afterRmsDb)} dB rms: something else (a reflection, a blocked path, a wrong antenna) is not in the model.`);
  const worstDb = base.worst ? Math.abs(base.worst.deltaDb) : 0;
  out.matches = base.rmsDb <= MATCH_RMS_DB && worstDb <= MATCH_WORST_DB;
  if (!out.needed) {
    if (out.matches) out.cautions.push('The model already matches the readings: no calibration is needed.');
    else out.cautions.push(`The model does not match these readings (rms ${r2(base.rmsDb)} dB, worst ${r2(worstDb)} dB) and no single calibration figure explains them: look for fades (multipath), polarisation, a wall or an obstruction, or a wrong reading position.`);
  }
  // notes: where a fitted single number could really be something else (body loss, another wall, polarisation); for the UI to say so
  const bestId = out.best && out.best.id;
  const nonWall = base.points.map((p, i) => (crossings[i] === 0 ? p.deltaDb : null)).filter((v) => v !== null);
  if (bestId === 'wall-loss' || bestId === 'wall-loss-by-material') {
    out.notes.push('A wall-loss figure can also be absorbing body loss (the person holding the receiver), antenna orientation or a fade: it is only a wall if readings that cross no wall already match.');
    if (nonWall.length >= 2) {
      const m = nonWall.reduce((a2, b2) => a2 + b2, 0) / nonWall.length;
      if (Math.abs(m) >= 2) out.notes.push(`Readings that cross no wall are also ${r2(Math.abs(m))} dB ${m < 0 ? 'below' : 'above'} the model, so the wall figure alone does not explain the error: body loss or another cause is likely involved.`);
    } else out.notes.push('No reading is taken in clear line of sight, so body loss cannot be separated from wall loss: add readings with no wall in the way.');
  } else if (bestId === 'body-loss') {
    out.notes.push('A body-loss figure is a constant offset: it can also be an unmodelled wall, an obstruction, polarisation or antenna orientation.');
  } else if (bestId === 'cross-polar') {
    out.notes.push('A cross-polar floor only explains readings where the antennas are cross-polarised: a constant offset from body loss would look different.');
  }
  const fmtCand = (c) => (c.byMaterial ? c.byMaterial.map((r) => `${r.material} ${r2(r.fitted)} dB`).join(', ') : `${r2(c.current)} to ${r2(c.fitted)} dB`);
  out.headline = out.best ? `Best fit: ${out.best.label} (${fmtCand(out.best)})${out.best.confidence === 'low' ? ', low confidence' : ''}.${out.notes.length ? ' This may also be body loss or another cause.' : ''}`
    : out.matches ? 'The model already matches these readings; no calibration is needed.'
    : 'The model does not match these readings and no single calibration value explains them: the readings need explaining (fades, polarisation, a wall).';
  return out;
}

// ---- CSV import ----------------------------------------------------------------------------------------------------------------

const NUM = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const HEADER_NAMES = {
  linkId: ['link', 'linkid', 'link_id', 'mic', 'channel'],
  x: ['x', 'xm', 'east', 'x_m'], y: ['y', 'ym', 'north', 'y_m'], z: ['z', 'zm', 'height', 'h', 'z_m'],
  rxDbm: ['dbm', 'rx', 'rxdbm', 'rx_dbm', 'level', 'rssi', 'power', 'signal', 'measured'],
  note: ['note', 'notes', 'comment', 'comments', 'name', 'label', 'where'], t: ['t', 'time', 'timestamp', 's'],
};
const norm = (h) => String(h).toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9_]/g, '');
const sepOf = (line) => (line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',');
const splitRow = (line, sep) => line.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1').trim());
const toNum = (c) => (c === undefined ? NaN : NUM.test(String(c).replace(/\s*dbm$/i, '')) ? parseFloat(c) : NaN);

/**
 * importMeasurementsCsv(text, { max = 200 }) -> { points, errors, lines }. Tolerant: comma, semicolon or tab separators, an optional header with any of the usual names
 * (x, y, z, dBm / rx / level / rssi, link / linkId, note, t), blank and # lines ignored, a "dBm" suffix on levels allowed. Without a header: 3 columns = x, y, dBm;
 * 4 columns = linkId, x, y, dBm when the first cell is not a number, else x, y, z, dBm; 5 or more = linkId, x, y, dBm, note. A point carries linkId only when the
 * file gave one (the caller supplies a default). More than `max` data rows: the rest are dropped with an error.
 */
export function importMeasurementsCsv(text, { max = MEASUREMENT_LIMITS.max } = {}) {
  const points = [], errors = [], fileLines = []; // fileLines[k] = the file line of points[k]
  // keep the file line number of every kept line (blank and # lines are dropped but still counted), so an error names the line the user sees
  const lines = [], lineNos = [];
  String(text ?? '').replace(/^﻿/, '').split(/\r\n|\n|\r/).forEach((raw, k) => { const l = raw.trim(); if (l && !l.startsWith('#')) { lines.push(l); lineNos.push(k + 1); } });
  if (!lines.length) { errors.push('The file has no rows.'); return { points, errors, lines: [] }; }
  const sep = sepOf(lines[0]); // detected once, from the first line, for the whole file
  let cols = null, start = 0;
  const first = splitRow(lines[0], sep);
  // a header: no cell that is a plain number, and at least one cell naming a field
  if (first.every((c) => !NUM.test(c)) && first.some((c) => Object.values(HEADER_NAMES).some((names) => names.includes(norm(c))))) {
    cols = first.map((c) => { const n = norm(c); return Object.keys(HEADER_NAMES).find((k) => HEADER_NAMES[k].includes(n)) || null; });
    start = 1;
    for (const need of ['x', 'y', 'rxDbm']) if (!cols.includes(need)) errors.push(`The header has no column for ${need === 'rxDbm' ? 'the level (dBm)' : need}.`);
    if (errors.length) return { points, errors, lines: [] };
  }
  let rows = 0;
  for (let i = start; i < lines.length; i++) {
    const row = splitRow(lines[i], sep), lineNo = lineNos[i];
    if (rows >= max) { errors.push(`At most ${max} rows are read; the rest were dropped.`); break; }
    rows++;
    let m;
    if (cols) {
      m = {};
      cols.forEach((k, j) => { if (k && row[j] !== undefined && row[j] !== '') m[k] = k === 'linkId' || k === 'note' ? row[j] : toNum(row[j]); });
    } else if (row.length < 3) { errors.push(`Line ${lineNo}: expected x, y, dBm.`); continue; }
    else if (row.length === 3) m = { x: toNum(row[0]), y: toNum(row[1]), rxDbm: toNum(row[2]) };
    else if (row.length === 4 && !NUM.test(row[0])) m = { linkId: row[0], x: toNum(row[1]), y: toNum(row[2]), rxDbm: toNum(row[3]) };
    else if (row.length === 4) m = { x: toNum(row[0]), y: toNum(row[1]), z: toNum(row[2]), rxDbm: toNum(row[3]) };
    else m = { linkId: row[0], x: toNum(row[1]), y: toNum(row[2]), rxDbm: toNum(row[3]), note: row[4] };
    const L = MEASUREMENT_LIMITS;
    if (!(finite(m.x) && finite(m.y) && finite(m.rxDbm))) { errors.push(`Line ${lineNo}: x, y and the level must be numbers.`); continue; }
    if (Math.abs(m.x) > L.coordM || Math.abs(m.y) > L.coordM) { errors.push(`Line ${lineNo}: position outside +-${L.coordM} m.`); continue; }
    if (m.rxDbm < L.dbm[0] || m.rxDbm > L.dbm[1]) { errors.push(`Line ${lineNo}: level ${m.rxDbm} dBm is outside ${L.dbm[0]} to ${L.dbm[1]} dBm.`); continue; }
    const p = { x: m.x, y: m.y, rxDbm: m.rxDbm };
    if (finite(m.z) && m.z >= L.zM[0] && m.z <= L.zM[1]) p.z = m.z;
    if (typeof m.linkId === 'string' && m.linkId) p.linkId = m.linkId.slice(0, L.idChars);
    if (typeof m.note === 'string' && m.note) p.note = m.note.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, L.noteChars);
    if (finite(m.t)) p.t = m.t;
    points.push(p); fileLines.push(lineNo);
  }
  return { points, errors, lines: fileLines };
}
