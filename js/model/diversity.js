// Antenna diversity: two-antenna Rx, switching / true / ratio combining. Pure module (no DOM).

import { solveLink, wavelengthM } from './rf.js';

let PARAMS = {};
try { PARAMS = await import('./rx-params.js'); } catch { PARAMS = {}; }

const FALLBACK = {
  mode: 'switching', // 'switching' | 'true' | 'ratio'
  hysteresisDb: 3,
  switchMs: 5, // hold-off after a switch
  switchThresholdDbm: -Infinity, // switching mode: also switch if the active antenna is below this and the other is better
};

function baseConfig() {
  const p = PARAMS.DIVERSITY_PRESETS;
  if (p && typeof p === 'object') {
    const first = p.default || p.switching || Object.values(p)[0];
    if (first && typeof first === 'object') return first;
  }
  return {};
}
const cfgOf = (cfg) => ({ ...FALLBACK, ...baseConfig(), ...(cfg || {}) });

export const MIN_SPACING_LAMBDA = 0.3; // closer than this the fades are strongly correlated

// Gain of a 2-branch scheme over one branch in Rayleigh fading with UNCORRELATED branches, at the 1 % level
// (level not exceeded with probability 1 %): selection about 10.2 dB, maximal ratio about 11.7 dB (switching, with
// hysteresis, a little less than selection). Derivation: single branch P(x) = 1 - e^-x, selection (1 - e^-x)^2,
// ratio 1 - e^-x (1 + x), compared at P = 0.01.
export const RAYLEIGH_GAIN_1PCT_DB = { switching: 9, true: 10.2, ratio: 11.7 };

// J0 (Abramowitz and Stegun 9.4.1 / 9.4.3), enough for field correlation rho = J0(2 pi d / lambda).
function besselJ0(x) {
  const ax = Math.abs(x);
  if (ax < 8) {
    const y = x * x;
    const a1 = 57568490574.0 + y * (-13362590354.0 + y * (651619640.7 + y * (-11214424.18 + y * (77392.33017 + y * -184.9052456))));
    const a2 = 57568490411.0 + y * (1029532985.0 + y * (9494680.718 + y * (59272.64853 + y * (267.8532712 + y))));
    return a1 / a2;
  }
  const z = 8 / ax, y = z * z, xx = ax - 0.785398164;
  const a1 = 1 + y * (-0.1098628627e-2 + y * (0.2734510407e-4 + y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
  const a2 = -0.1562499995e-1 + y * (0.1430488765e-3 + y * (-0.6911147651e-5 + y * (0.7621095161e-6 - y * 0.934935152e-7)));
  return Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * a1 - z * Math.sin(xx) * a2);
}

/**
 * Expected 1 % fade-depth gain (dB) of a diversity scheme for antennas spaced spacingLambda apart:
 * RAYLEIGH_GAIN_1PCT_DB[mode] * (1 - rho^2), rho = |J0(2 pi d / lambda)| (field correlation, Clarke model;
 * rho^2 is the envelope-power correlation). Zero spacing gives 0 dB, large spacing the full uncorrelated value.
 */
export function expectedDiversityGain1pctDb(mode, spacingLambda) {
  const rho = Math.abs(besselJ0(2 * Math.PI * Math.max(0, spacingLambda)));
  return (RAYLEIGH_GAIN_1PCT_DB[mode] ?? RAYLEIGH_GAIN_1PCT_DB.true) * (1 - rho * rho);
}

const pwr = (dbm) => Math.pow(10, dbm / 10);
const toDbm = (p) => 10 * Math.log10(p);

/**
 * solveDiversity(scene, link) -> { a, b }: LinkResult for the link as is (antenna A) and for a copy whose
 * rx.pos / rx.antenna are replaced by link.rx.diversity.antennaB = { pos, antenna }. Without antennaB, or with diversity.enabled === false, B equals A.
 */
export function solveDiversity(scene, link) {
  const a = solveLink(scene, link);
  const dv = link.rx && link.rx.diversity;
  const ab = dv && dv.enabled !== false ? dv.antennaB : null;
  if (!ab) return { a, b: solveLink(scene, link), spacingM: 0, spacingLambda: 0, spacingWarning: true };
  const copy = JSON.parse(JSON.stringify(link));
  if (ab.pos) copy.rx.pos = { ...copy.rx.pos, ...ab.pos };
  if (ab.antenna) copy.rx.antenna = { ...copy.rx.antenna, ...ab.antenna };
  const bPos = copy.rx.pos;
  const spacingM = Math.hypot(bPos.x - link.rx.pos.x, bPos.y - link.rx.pos.y, (bPos.z || 0) - (link.rx.pos.z || 0));
  const spacingLambda = spacingM / wavelengthM(link.freqMHz);
  // spacingWarning: antennas closer than 0.3 lambda see correlated fades, little diversity gain is possible.
  return { a, b: solveLink(scene, copy), spacingM, spacingLambda, spacingWarning: spacingLambda < MIN_SPACING_LAMBDA };
}

/**
 * diversityStep(prev, aDbm, bDbm, cfg, nowMs = 0)
 *   -> { active, switched, combinedDbm, aDbm, bDbm, gainDb, holdoffMs, lastSwitchMs }
 * prev: null or a previous result ({ active, lastSwitchMs }).
 *  'switching': stay on the active antenna until the other exceeds it by hysteresisDb, or the active one is
 *     below switchThresholdDbm while the other is better. A switch is suppressed while nowMs - lastSwitchMs < switchMs.
 *     holdoffMs = remaining hold-off after this step. combined = active antenna level.
 *  'true': instantaneous best of A and B (ties keep the previous antenna).
 *  'ratio': power sum of the two (maximal-ratio idealisation), active = the stronger one.
 * gainDb = combined - max(a, b): 0 for 'true', <= 0 for 'switching', up to +3.01 for 'ratio'.
 */
export function diversityStep(prev, aDbm, bDbm, cfg, nowMs = 0) {
  const c = cfgOf(cfg);
  let active = prev && prev.active === 'B' ? 'B' : 'A';
  const lastSwitchMs = prev && Number.isFinite(prev.lastSwitchMs) ? prev.lastSwitchMs : -Infinity;
  const level = { A: aDbm, B: bDbm };
  const other = active === 'A' ? 'B' : 'A';
  const holdoff = Math.max(0, c.switchMs - (nowMs - lastSwitchMs));
  let switched = false;
  let combinedDbm;
  if (c.mode === 'ratio') {
    combinedDbm = toDbm(pwr(aDbm) + pwr(bDbm));
    const best = bDbm > aDbm ? 'B' : aDbm > bDbm ? 'A' : active;
    switched = best !== active;
    active = best;
  } else if (c.mode === 'true') {
    const best = bDbm > aDbm ? 'B' : aDbm > bDbm ? 'A' : active;
    switched = best !== active;
    active = best;
    combinedDbm = level[active];
  } else {
    const want = level[other] >= level[active] + c.hysteresisDb ||
      (level[active] < c.switchThresholdDbm && level[other] > level[active]);
    if (want && holdoff <= 0) { active = other; switched = true; }
    combinedDbm = level[active];
  }
  const newLast = switched ? nowMs : lastSwitchMs;
  return {
    active, switched, combinedDbm, aDbm, bDbm,
    gainDb: combinedDbm - Math.max(aDbm, bDbm),
    holdoffMs: switched ? c.switchMs : Math.max(0, c.switchMs - (nowMs - newLast)),
    lastSwitchMs: newLast,
  };
}

/**
 * sweepLink(scene, linkId, from, to, n, cfg = {}) moves the transmitter along from -> to ({x,y,z}) in n >= 2 samples
 * and returns { s[], aDbm[], bDbm[], activeSwitching[], activeTrue[], combinedRatio[], singleBestDbm[] }.
 * s = metres from `from`. Levels are inputPowerDbm. activeSwitching steps the switching combiner with
 * cfg.stepMs (default 100) between samples; activeTrue is the instantaneous best.
 */
export function sweepLink(scene, linkId, from, to, n, cfg = {}) {
  const link0 = (scene.links || []).find((l) => l.id === linkId);
  const out = { s: [], aDbm: [], bDbm: [], activeSwitching: [], activeTrue: [], combinedSwitching: [], combinedRatio: [], singleBestDbm: [] };
  if (!link0) return out;
  const N = Math.max(2, Math.floor(n));
  const total = Math.hypot(to.x - from.x, to.y - from.y, (to.z ?? 0) - (from.z ?? 0));
  const dv = link0.rx && link0.rx.diversity ? link0.rx.diversity : {};
  const sw = { hysteresisDb: dv.hysteresisDb, switchMs: dv.switchMs, ...cfg, mode: 'switching' };
  for (const k of Object.keys(sw)) if (sw[k] === undefined) delete sw[k];
  const stepMs = Number.isFinite(cfg.stepMs) ? cfg.stepMs : 100;
  let prev = null;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const pos = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: (from.z ?? 0) + ((to.z ?? 0) - (from.z ?? 0)) * t };
    const link = JSON.parse(JSON.stringify(link0));
    link.tx.pos = pos;
    const sp = solveDiversity(scene, link);
    const { a, b } = sp;
    const A = a.inputPowerDbm, B = b.inputPowerDbm;
    prev = diversityStep(prev, A, B, sw, i * stepMs);
    out.s.push(total * t);
    out.aDbm.push(A);
    out.bDbm.push(B);
    out.activeSwitching.push(prev.active);
    out.combinedSwitching.push(prev.combinedDbm);
    if (i === 0) { out.spacingM = sp.spacingM; out.spacingLambda = sp.spacingLambda; out.spacingWarning = sp.spacingWarning; }
    out.activeTrue.push(B > A ? 'B' : 'A');
    out.combinedRatio.push(toDbm(pwr(A) + pwr(B)));
    out.singleBestDbm.push(Math.max(A, B));
  }
  // Gains over a single antenna (A): mean-level gain and fade-depth gain at 1 % (the meaningful figure).
  const st = {
    single: fadeDepthStats(out.aDbm), switching: fadeDepthStats(out.combinedSwitching),
    true: fadeDepthStats(out.singleBestDbm), ratio: fadeDepthStats(out.combinedRatio),
  };
  const gain = (key, f) => st[key][f] - st.single[f];
  out.stats = st;
  out.gainMeanDb = { switching: gain('switching', 'meanDbm'), true: gain('true', 'meanDbm'), ratio: gain('ratio', 'meanDbm') };
  out.gain1pctDb = { switching: gain('switching', 'p1Db'), true: gain('true', 'p1Db'), ratio: gain('ratio', 'p1Db') };
  out.expectedGain1pctDb = {
    switching: expectedDiversityGain1pctDb('switching', out.spacingLambda || 0),
    true: expectedDiversityGain1pctDb('true', out.spacingLambda || 0),
    ratio: expectedDiversityGain1pctDb('ratio', out.spacingLambda || 0),
  };
  return out;
}

/**
 * fadeDepthStats(array of dBm) -> { min, max, medianDb, meanDbm (power average), p5Db, p1Db (level not exceeded by
 * the worst 1 % of samples), fadeDepthDb, count }
 * fadeDepthDb = median - min (how deep the worst fade is below the typical level).
 */
export function fadeDepthStats(arr) {
  const v = (arr || []).filter(Number.isFinite).sort((x, y) => x - y);
  if (!v.length) return { min: NaN, max: NaN, medianDb: NaN, meanDbm: NaN, p5Db: NaN, p1Db: NaN, fadeDepthDb: NaN, count: 0 };
  const q = (p) => {
    const pos = p * (v.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
    return v[lo] + (v[hi] - v[lo]) * (pos - lo);
  };
  const meanP = v.reduce((s, x) => s + pwr(x), 0) / v.length;
  const median = q(0.5);
  return { min: v[0], max: v[v.length - 1], medianDb: median, meanDbm: toDbm(meanP), p5Db: q(0.05), p1Db: q(0.01), fadeDepthDb: median - v[0], count: v.length };
}
