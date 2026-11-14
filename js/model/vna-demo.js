// Virtual NanoVNA ("VNA lab") model. Pure module: no DOM, no Math.random, no time. Educational, NOT the link budget.
//
// A 2-port vector network analyser at Z0 = 50 ohm. Port 1 sends and measures S11 (reflection) and S21 (transmission to port 2).
// All complex numbers are { re, im }. Every S-parameter result is an array of complex numbers, one per sweep frequency.
//
// Confidence flags on every assumed figure (see VNA_ASSUMPTIONS):  S = stated in a source seen,  I = inferred / generic
// engineering value,  U = unverified placeholder. Devices are GENERIC classes, not products: all are teaching approximations.
//
// Standard formulas used (source names in the comments next to each):
//   Gamma = (Z - Z0)/(Z + Z0)            (reflection coefficient, transmission-line theory)
//   Z = Z0 (1 + Gamma)/(1 - Gamma)
//   VSWR = (1 + |Gamma|)/(1 - |Gamma|);  RL = -20 log10 |Gamma|;  ML = -10 log10(1 - |Gamma|^2) (mismatch loss)
//   Lossy line: gamma = alpha + j beta, beta = 2 pi f / (c VF);  S21 = e^{-gamma L};  input reflection of a terminated line
//   Gin = Gamma_L e^{-2 gamma L}  (the round trip gives the ripple period c VF /(2 L) in frequency)
//   Two-port termination: Gin = S11 + S12 S21 GL /(1 - S22 GL);  cascade of two S-matrices (connected through port 2 -> port 1)
//   One-port error model (OSL): Gm = e00 + e10e01 G/(1 - e11 G)  (directivity, tracking, source match; "12-term" one port)
//   Group delay tau = -d(phase)/d(omega)
//   Butterworth |H|^2 = 1/(1+x^2n); Chebyshev |H|^2 = 1/(1+eps^2 Tn(x)^2): realised here with their left-half-plane poles so the phase is real

import { antennaMatch, resolveDesignBand } from './antenna-band.js';
import { CABLES, cableDbPer100m, ANTENNA_CONTACT_LOSS_DB, ANTENNA_DAMPNESS_LOSS_DB } from './library.js';
import { CHAIN_PRESETS, couplerThroughLossDb } from './chain-presets.js';

export const Z0 = 50;
export const C_M_S = 299792458;
const TAU = 2 * Math.PI;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fin = (v, d) => (Number.isFinite(v) ? v : d);

/** Every assumed figure: { value, flag: 'S'|'I'|'U', note }. Read by the GUI to show a confidence badge. */
export const VNA_ASSUMPTIONS = Object.freeze({
  z0: { value: 50, flag: 'S', note: 'NanoVNA and pro-audio RF are 50 ohm.' },
  portDriveDbm: { value: -10, flag: 'I', note: 'Typical NanoVNA stimulus is about -10 dBm; keep external power far below this.' },
  portMaxInputDbm: { value: 10, flag: 'U', note: 'Receiver damage level is about +10 dBm class; check your VNA manual.' },
  rlFloorDb: { value: 120, flag: 'I', note: 'Display floor so a perfect load is a finite number (no -infinity or NaN).' },
  vswrCap: { value: 999, flag: 'I', note: 'VSWR shown as 999 when |Gamma| >= 1.' },
  cableConnectorRlDb: { value: 30, flag: 'U', note: 'Each cable connector reflects about 3 percent (RL 30 dB); this makes the ripple visible.' },
  vnaDirectivity: { value: 0.01, flag: 'U', note: 'Raw directivity |e00| = 0.01 (40 dB) rising with frequency (x(1 + f/500 MHz)).' },
  vnaSourceMatch: { value: 0.03, flag: 'U', note: 'Raw source match |e11| = 0.03 (30 dB) rising with frequency.' },
  vnaInternalDelayNs: { value: 0.3, flag: 'U', note: 'Delay inside the VNA to its port; gives the uncalibrated phase rotation.' },
  vnaTrackingLossDb: { value: 0.5, flag: 'U', note: 'Uncalibrated reflection and transmission tracking loss.' },
  handShiftFraction: { value: { free: 0, clothing: 0.01, skin: 0.03, cupped: 0.06 }, flag: 'U', note: 'A hand pulls the resonance down in frequency by this fraction.' },
  wetShiftFraction: { value: { dry: 0, damp: 0.005, wet: 0.015 }, flag: 'U', note: 'Damp or wet clothing adds to the detuning.' },
  handLossDb: { value: 'ANTENNA_CONTACT_LOSS_DB + ANTENNA_DAMPNESS_LOSS_DB (library.js)', flag: 'I', note: 'Power absorbed in the body; it lowers |S11| (looks better) while the antenna gets worse. A classic VNA pitfall.' },
  groundPlaneMinVswr: { value: { none: 1.8, body: 1.4, rack: 1.15, large: 1.0 }, flag: 'U', note: 'Best match of a quarter-wave whip by ground plane (applies to quarterwave only).' },
  antennaFractionalBw: { value: { quarterwave: 0.08, dipole: 0.12, helical: 0.25, yagi: 0.15, paddle: 0.5, logperiodic: 0.8 }, flag: 'U', note: '2:1 VSWR fractional bandwidths; real antennas vary.' },
  passiveReturnLossDb: { value: { splitter: 22, coupler: 25, biastee: 22, dcblock: 25, connector: 35, attenuator: Infinity }, flag: 'U', note: 'Residual match of generic devices; pads are ideal unless returnLossDb is given.' },
  activeReturnLossDb: { value: { input: 12, output: 10 }, flag: 'U', note: 'Generic booster ports.' },
  activeReverseIsolationDb: { value: 20, flag: 'U', note: 'Reverse isolation is gain + 20 dB.' },
  biasTeeCornerMHz: { value: 0.3, flag: 'U', note: 'Low-frequency corner of the RF path of a bias tee (first order).' },
  dcBlockCornerMHz: { value: 0.1, flag: 'U', note: 'Low-frequency corner of a DC block (first order).' },
  filterDefaults: { value: { centreMHz: 600, bandwidthMHz: 40, notchBandwidthMHz: 10, order: 3, rippleDb: 0.5 }, flag: 'U', note: 'Used when a filter item has no centre or bandwidth.' },
});

// ---------------------------------------------------------------------------------------------------------------------------------
// COMPLEX NUMBERS
// ---------------------------------------------------------------------------------------------------------------------------------
/** cx(re, im) -> { re, im } */
export const cx = (re = 0, im = 0) => ({ re, im });
export const cAdd = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });
export const cSub = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });
export const cMul = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
export const cScale = (a, k) => ({ re: a.re * k, im: a.im * k });
export const cConj = (a) => ({ re: a.re, im: -a.im });
export const cAbs = (a) => Math.hypot(a.re, a.im);
export const cArg = (a) => Math.atan2(a.im, a.re);
/** Complex division; a zero denominator returns a huge finite number (never NaN or Infinity). */
export function cDiv(a, b) {
  const d = b.re * b.re + b.im * b.im;
  if (d < 1e-300) return { re: 0, im: 0 };
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}
/** polar(mag, phaseRad) -> complex */
export const polar = (mag, ph) => ({ re: mag * Math.cos(ph), im: mag * Math.sin(ph) });
const ONE = Object.freeze({ re: 1, im: 0 });
const ZERO = Object.freeze({ re: 0, im: 0 });
const dbToAmp = (db) => Math.pow(10, db / 20);

// ---------------------------------------------------------------------------------------------------------------------------------
// S-PARAMETER HELPERS: Gamma <-> impedance, VSWR, return loss, phase, Smith chart
// ---------------------------------------------------------------------------------------------------------------------------------
/** Gamma = (Z - Z0)/(Z + Z0). z = { re, im } in ohm (re may be Infinity for an open: returns 1). */
export function gammaFromZ(z, z0 = Z0) {
  if (!Number.isFinite(z.re) || !Number.isFinite(z.im)) return { re: 1, im: 0 };
  return cDiv(cSub(z, cx(z0, 0)), cAdd(z, cx(z0, 0)));
}
/** Z = Z0 (1 + Gamma)/(1 - Gamma). At Gamma = 1 (open) the result is capped at 1e9 ohm (finite). */
export function zFromGamma(g, z0 = Z0) {
  const den = cSub(ONE, g);
  if (cAbs(den) < 1e-9) return { re: 1e9, im: 0 };
  const z = cMul(cx(z0, 0), cDiv(cAdd(ONE, g), den));
  return { re: clamp(z.re, -1e9, 1e9), im: clamp(z.im, -1e9, 1e9) };
}
/** VSWR from |Gamma| (a number) or a complex Gamma. |Gamma| >= 1 gives the cap 999. */
export function vswrFromGamma(g) {
  const m = typeof g === 'number' ? Math.abs(g) : cAbs(g);
  return m >= 1 ? VNA_ASSUMPTIONS.vswrCap.value : Math.min(VNA_ASSUMPTIONS.vswrCap.value, (1 + m) / (1 - m));
}
/** |Gamma| from VSWR: (S - 1)/(S + 1). */
export const gammaMagFromVswr = (s) => (Math.max(1, s) - 1) / (Math.max(1, s) + 1);
/** Return loss in dB (positive for a passive load), floored at 120 dB so a perfect match is finite. */
export function returnLossDbFromGamma(g) {
  const m = typeof g === 'number' ? Math.abs(g) : cAbs(g);
  return Math.min(VNA_ASSUMPTIONS.rlFloorDb.value, -20 * Math.log10(Math.max(m, 1e-12)));
}
/** S-parameter magnitude in dB (20 log10 |S|), floored at -120 dB: this is what the NanoVNA LOGMAG trace shows. */
export function magDb(s) {
  const m = typeof s === 'number' ? Math.abs(s) : cAbs(s);
  return Math.max(-VNA_ASSUMPTIONS.rlFloorDb.value, 20 * Math.log10(Math.max(m, 1e-12)));
}
/** Mismatch loss in dB (power not delivered): -10 log10(1 - |Gamma|^2). Capped at 30 dB; |Gamma| >= 1 gives 30. */
export function mismatchLossDbFromGamma(g) {
  const m = typeof g === 'number' ? Math.abs(g) : cAbs(g);
  return m >= 1 ? 30 : Math.min(30, -10 * Math.log10(1 - m * m));
}
/** Phase in degrees (-180..180]. */
export const phaseDeg = (s) => (cArg(s) * 180) / Math.PI;
/** Smith chart point: x, y are the Gamma plane coordinates (unit circle); zNorm is z/Z0; zOhm the impedance. */
export function smithPoint(g, z0 = Z0) {
  const z = zFromGamma(g, z0);
  return { x: g.re, y: g.im, zOhm: z, zNorm: { re: z.re / z0, im: z.im / z0 } };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// SWEEP
// ---------------------------------------------------------------------------------------------------------------------------------
export const SWEEP_MIN_MHZ = 0.05;   // 50 kHz (NanoVNA lower limit, I)
export const SWEEP_MAX_MHZ = 6000;   // generous cap; real VNAs stop at 900 MHz to 3 GHz (I)
export const SWEEP_MIN_POINTS = 3;
export const SWEEP_MAX_POINTS = 1001;
export const SWEEP_DEFAULT_POINTS = 101;

/** Sweep presets (MHz). Bands are the planner design bands widened for context. Round numbers, flag I. */
export const SWEEP_PRESETS = Object.freeze({
  default: { label: 'Default 100-1000 MHz', startMHz: 100, stopMHz: 1000 },
  'uhf-470-520': { label: 'UHF band A 470-520 MHz (zoom 400-600)', startMHz: 400, stopMHz: 600 },
  'uhf-520-570': { label: 'UHF band B 520-570 MHz (zoom 450-650)', startMHz: 450, stopMHz: 650 },
  'uhf-570-608': { label: 'UHF band C 570-608 MHz (zoom 500-700)', startMHz: 500, stopMHz: 700 },
  'uhf-600-700': { label: 'UHF 600-700 MHz (zoom 550-750)', startMHz: 550, stopMHz: 750 },
  'uhf-800': { label: 'UHF 790-865 MHz (zoom 700-950)', startMHz: 700, stopMHz: 950 },
  'srd-863-865': { label: '863-865 MHz (zoom 800-930)', startMHz: 800, stopMHz: 930 },
  'cell-1800': { label: '1.8 GHz 1600-2000 MHz', startMHz: 1600, stopMHz: 2000 },
  'ism-2400': { label: '2.4 GHz ISM 2300-2600 MHz', startMHz: 2300, stopMHz: 2600 },
});

/**
 * buildSweep({ startMHz, stopMHz, points, preset }) -> { startMHz, stopMHz, points, stepMHz, fMHz: number[] }
 * Linear sweep. Swapped ends are reordered, equal ends are widened by 1 MHz, the range and point count are clamped
 * (never throws, never NaN). A `preset` id from SWEEP_PRESETS supplies start/stop when those are not given.
 */
export function buildSweep(opts = {}) {
  const p = SWEEP_PRESETS[opts.preset] || null;
  let a = fin(opts.startMHz, p ? p.startMHz : 100), b = fin(opts.stopMHz, p ? p.stopMHz : 1000);
  if (b < a) [a, b] = [b, a];
  a = clamp(a, SWEEP_MIN_MHZ, SWEEP_MAX_MHZ); b = clamp(b, SWEEP_MIN_MHZ, SWEEP_MAX_MHZ);
  if (b - a < 1e-6) b = Math.min(SWEEP_MAX_MHZ, a + 1) > a ? Math.min(SWEEP_MAX_MHZ, a + 1) : a;
  if (b <= a) a = b - 1;
  const n = clamp(Math.round(fin(opts.points, SWEEP_DEFAULT_POINTS)), SWEEP_MIN_POINTS, SWEEP_MAX_POINTS);
  const fMHz = new Array(n);
  for (let i = 0; i < n; i++) fMHz[i] = a + ((b - a) * i) / (n - 1);
  return { startMHz: a, stopMHz: b, points: n, stepMHz: (b - a) / (n - 1), fMHz };
}
/** Sweep preset around an antenna design band: lo/2 .. hi*1.5 style zoom, rounded for a clean display. */
export function sweepForBand(loMHz, hiMHz, points = SWEEP_DEFAULT_POINTS) {
  const c = Math.sqrt(Math.max(1, loMHz) * Math.max(1, hiMHz)), span = Math.max(hiMHz - loMHz, 0.1 * c);
  return buildSweep({ startMHz: Math.max(SWEEP_MIN_MHZ, c - 2 * span), stopMHz: c + 2 * span, points });
}
/** Longest delay (ns) a sweep can measure without phase aliasing (phase step < 180 degrees per point): 1/(2 step). */
export const maxUnambiguousDelayNs = (stepMHz) => (stepMHz > 0 ? 500 / stepMHz : Infinity);

// ---------------------------------------------------------------------------------------------------------------------------------
// TWO-PORT S-MATRICES AND CASCADE
// ---------------------------------------------------------------------------------------------------------------------------------
/** A two-port S-matrix { s11, s12, s21, s22 } (complex each). */
export const twoPort = (s11, s12, s21, s22) => ({ s11, s12, s21, s22 });
/** Reflection seen at port 1 when port 2 is terminated in gammaL: S11 + S12 S21 GL /(1 - S22 GL). */
export function terminate(s, gammaL) {
  return cAdd(s.s11, cDiv(cMul(cMul(s.s12, s.s21), gammaL), cSub(ONE, cMul(s.s22, gammaL))));
}
/** Cascade A then B (A's port 2 connects to B's port 1) using the standard S-parameter formulas. */
export function cascade(A, B) {
  const D = cSub(ONE, cMul(A.s22, B.s11));
  return {
    s11: cAdd(A.s11, cDiv(cMul(cMul(A.s12, A.s21), B.s11), D)),
    s21: cDiv(cMul(A.s21, B.s21), D),
    s12: cDiv(cMul(A.s12, B.s12), D),
    s22: cAdd(B.s22, cDiv(cMul(cMul(B.s12, B.s21), A.s22), D)),
  };
}
const matched = (s21, s12 = s21) => twoPort(ZERO, s12, s21, ZERO);

/** Gamma of a termination: 'open' (1), 'short' (-1), 'load' (0, a perfect 50 ohm), or { gamma:{re,im} } or { zOhm:{re,im} } or a function f(fMHz). */
export function terminationGamma(term, fMHz) {
  if (term === 'open') return { re: 1, im: 0 };
  if (term === 'short') return { re: -1, im: 0 };
  if (term === 'load' || term == null) return { re: 0, im: 0 };
  if (typeof term === 'function') return term(fMHz);
  if (term.gamma) return term.gamma;
  if (term.zOhm) return gammaFromZ(term.zOhm);
  if (term.zFn) return gammaFromZ(term.zFn(fMHz)); // impedance as a function of frequency (reactive loads)
  return { re: 0, im: 0 };
}
export const TERMINATIONS = Object.freeze(['open', 'short', 'load']);

// ---------------------------------------------------------------------------------------------------------------------------------
// CABLE
// ---------------------------------------------------------------------------------------------------------------------------------
export const CABLE_MIN_M = 0.01, CABLE_MAX_M = 500;
/** Resolve { cableId, lengthM, velocityFactor } with defaults and clamps. Unknown id falls back to RG58. */
export function resolveCable(spec = {}) {
  const id = CABLES[spec.cableId] ? spec.cableId : 'rg58';
  const vf = fin(spec.velocityFactor, CABLES[id].velocityFactor);
  return { cableId: id, lengthM: clamp(fin(spec.lengthM, 1), CABLE_MIN_M, CABLE_MAX_M), velocityFactor: clamp(vf, 0.3, 1),
    connectorRlDb: Math.max(6, fin(spec.connectorReturnLossDb, VNA_ASSUMPTIONS.cableConnectorRlDb.value)), lossScale: clamp(fin(spec.lossScale, 1), 0, 20) };
}
/** Round-trip ripple period in MHz of an open or short cable: c VF /(2 L). Source: transmission-line delay. */
export function cableRipplePeriodMHz(lengthM, velocityFactor) { return (C_M_S * velocityFactor) / (2 * lengthM) / 1e6; }
/** Length from a measured ripple period (inverse of cableRipplePeriodMHz). */
export function cableLengthFromRippleMHz(periodMHz, velocityFactor) { return (C_M_S * velocityFactor) / (2 * periodMHz * 1e6); }
/** One-way electrical delay of a cable in ns: L/(c VF). */
export const cableDelayNs = (lengthM, velocityFactor) => (lengthM / (C_M_S * velocityFactor)) * 1e9;

/** Ideal lossy line at fMHz: S11 = S22 = 0, S21 = exp(-(alpha + j beta) L) with alpha from the library cable table, beta = 2 pi f/(c VF). */
export function lineSparams(cable, fMHz, sec = {}) {
  const c = resolveCable(cable), len = fin(sec.lengthM, c.lengthM);
  const dbPerM = (cableDbPer100m(c.cableId, fMHz) / 100) * c.lossScale + fin(sec.extraDbPerMPerGHz, 0) * (fMHz / 1000);
  const alphaNp = Math.min(30, (dbPerM / 8.685889638) * len);
  const beta = (TAU * fMHz * 1e6 * len) / (C_M_S * c.velocityFactor);
  const zc = fin(sec.zOhm, Z0);
  if (Math.abs(zc - Z0) < 1e-9) return matched(polar(Math.exp(-alphaNp), -beta));
  // line section of characteristic impedance zc (a kink, a wrong-impedance connector): ABCD with gamma l = a + j b, converted to S at Z0
  const ch = cx(Math.cosh(alphaNp) * Math.cos(beta), Math.sinh(alphaNp) * Math.sin(beta));
  const sh = cx(Math.sinh(alphaNp) * Math.cos(beta), Math.cosh(alphaNp) * Math.sin(beta));
  return abcdToS(ch, cScale(sh, zc), cScale(sh, 1 / zc), ch);
}
/** ABCD -> S at Z0 (reciprocal, standard conversion): S11 = (A + B/Z0 - C Z0 - D)/den, S21 = 2 (AD - BC)... here AD - BC = 1. */
function abcdToS(A, B, C, D) {
  const den = cAdd(cAdd(A, cScale(B, 1 / Z0)), cAdd(cScale(C, Z0), D));
  const det = cSub(cMul(A, D), cMul(B, C));
  return twoPort(cDiv(cSub(cAdd(A, cScale(B, 1 / Z0)), cAdd(cScale(C, Z0), D)), den), cDiv(cScale(det, 2), den), cDiv(cScale(det, 2), den),
    cDiv(cAdd(cSub(cScale(B, 1 / Z0), A), cSub(D, cScale(C, Z0))), den));
}
/** Series impedance two-port (z in ohm): S11 = z/(z + 2 Z0), S21 = 2 Z0/(z + 2 Z0). */
export function seriesSparams(z) { return abcdToS(ONE, z, ZERO, ONE); }
/** Shunt admittance two-port (y in siemens): S11 = -y Z0/(2 + y Z0), S21 = 2/(2 + y Z0). */
export function shuntSparams(y) { return abcdToS(ONE, ZERO, y, ONE); }
/** Lump at one point: { rOhm, lNH, seriesCpF, shuntOhm, shuntCpF } series R + jwL (- j/wC for a gap) then shunt conductance and capacitance. */
export function lumpSparams(l = {}, fMHz) {
  const w = TAU * fMHz * 1e6;
  let z = cx(fin(l.rOhm, 0), w * fin(l.lNH, 0) * 1e-9);
  if (l.seriesCpF > 0) z = cAdd(z, cx(0, -1 / (w * l.seriesCpF * 1e-12)));
  const y = cx(l.shuntOhm > 0 ? 1 / l.shuntOhm : 0, w * fin(l.shuntCpF, 0) * 1e-12);
  let s = matched(ONE);
  if (z.re !== 0 || z.im !== 0) s = cascade(s, seriesSparams(z));
  if (y.re !== 0 || y.im !== 0) s = cascade(s, shuntSparams(y));
  return s;
}
function connectorSparams(rlDb, flip) {
  const g = Math.pow(10, -rlDb / 20), t = Math.sqrt(1 - g * g), s = flip ? -g : g;
  return twoPort(cx(s, 0), cx(t, 0), cx(t, 0), cx(-s, 0));
}
/** Cable with a connector at each end (ASSUMED RL 30 dB each): the two reflections make the S11 and S21 ripple. */
export function cableSparams(cable, fMHz) {
  const c = resolveCable(cable);
  const bumps = (cable.bumps || []).map((b) => ({ kind: 'bump', posM: b.posM, ...b }));
  const lumps = (cable.lumps || []).map((l) => ({ kind: 'lump', ...l }));
  const ev = bumps.concat(lumps).filter((e) => Number.isFinite(e.posM)).sort((a, b) => a.posM - b.posM);
  let s = connectorSparams(c.connectorRlDb, false), pos = 0;
  for (const e of ev) {
    const p = clamp(e.posM, pos, c.lengthM);
    if (p > pos) s = cascade(s, lineSparams(c, fMHz, { lengthM: p - pos }));
    pos = p;
    if (e.kind === 'bump') {
      const len = Math.min(Math.max(0, fin(e.lengthM, 0.04)), c.lengthM - pos);
      if (len > 0) s = cascade(s, lineSparams(c, fMHz, { lengthM: len, zOhm: e.zOhm, extraDbPerMPerGHz: e.extraDbPerMPerGHz }));
      pos += len;
    } else s = cascade(s, lumpSparams(e, fMHz));
  }
  if (c.lengthM > pos) s = cascade(s, lineSparams(c, fMHz, { lengthM: c.lengthM - pos }));
  return cascade(s, connectorSparams(c.connectorRlDb, true));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// ANTENNA
// ---------------------------------------------------------------------------------------------------------------------------------
/** Antenna types for the lab: id, label, fractional 2:1 bandwidth, order (1 resonant, 3 wideband), best match. ALL ASSUMED (flag U). */
export const ANTENNA_DUT_TYPES = Object.freeze({
  quarterwave: { label: 'Quarter-wave whip (needs a ground plane)', fracBw: 0.08, order: 1, minVswr: 1, groundPlane: true },
  dipole: { label: 'Half-wave dipole', fracBw: 0.12, order: 1, minVswr: 1 },
  helical: { label: 'Helical (IEM style)', fracBw: 0.25, order: 3, minVswr: 1.3 },
  yagi: { label: 'Yagi (directional)', fracBw: 0.15, order: 1, minVswr: 1.1 },
  paddle: { label: 'Paddle / panel', fracBw: 0.5, order: 3, minVswr: 1.3 },
  logperiodic: { label: 'Wideband log-periodic', fracBw: 0.8, order: 3, minVswr: 1.3 },
});
/** Design band of a lab antenna type cut for centreMHz: { loMHz, hiMHz, order, minVswr, label } (feeds antenna-band.js). */
export function antennaDesignBand(typeId, centreMHz) {
  const t = ANTENNA_DUT_TYPES[typeId] || ANTENNA_DUT_TYPES.quarterwave, c = Math.max(1, fin(centreMHz, 600));
  return { loMHz: c * (1 - t.fracBw / 2), hiMHz: c * (1 + t.fracBw / 2), order: t.order, minVswr: t.minVswr, label: `${t.label} cut for ${c} MHz` };
}
/**
 * antennaSparams(spec, fMHz[]) -> { fMHz, s11[], s21: null, efficiencyDb, detuneFraction, band }
 * spec: { antennaType (ANTENNA_DUT_TYPES id), centreMHz, designBand? (object or antenna-band id, overrides), contact, dampness, groundPlane }
 * |S11| comes from antenna-band.js antennaMatch (series-resonator model, VSWR 2:1 at the band edges). The phase is that of a series
 * reactance: Gamma = jX/(2 + jX) with X = 2|G|/sqrt(1-|G|^2), capacitive (negative) below the resonance and inductive above.
 * Handling (ASSUMED, U): a hand or wet clothing detunes the resonance DOWN in frequency (response evaluated at f(1 + shift)) and absorbs
 * power: |S11| is multiplied by 10^(-loss/20) with loss from ANTENNA_CONTACT_LOSS_DB + ANTENNA_DAMPNESS_LOSS_DB. That makes S11 look BETTER
 * while the antenna radiates worse: efficiencyDb reports the loss. A quarter-wave whip raises its best-match VSWR with a poor ground plane.
 */
export function antennaSparams(spec = {}, fMHz) {
  const contact = Object.prototype.hasOwnProperty.call(ANTENNA_CONTACT_LOSS_DB, spec.contact) ? spec.contact : 'free';
  const damp = Object.prototype.hasOwnProperty.call(ANTENNA_DAMPNESS_LOSS_DB, spec.dampness) ? spec.dampness : 'dry';
  const gp = Object.prototype.hasOwnProperty.call(VNA_ASSUMPTIONS.groundPlaneMinVswr.value, spec.groundPlane) ? spec.groundPlane : 'large';
  const typeId = ANTENNA_DUT_TYPES[spec.antennaType] ? spec.antennaType : 'quarterwave';
  const type = ANTENNA_DUT_TYPES[typeId];
  let band = spec.designBand != null ? resolveDesignBand({ designBand: spec.designBand }) : null;
  if (band) band = { loMHz: band.statedLoMHz, hiMHz: band.statedHiMHz, order: band.order, minVswr: band.minVswr };
  else band = antennaDesignBand(typeId, spec.centreMHz);
  if (type.groundPlane) band = { ...band, minVswr: Math.max(band.minVswr, VNA_ASSUMPTIONS.groundPlaneMinVswr.value[gp]) };
  // fault hooks (ASSUMED, U): centreScale moves the whole band (a short or bent element, wrong length); minVswrFloor = a poorer best match;
  // extraLossDb = extra absorption; commonMode = { amp, lengthM }: a reflection from the cable shield or a nearby metal object (ripple); front = lump at the connector.
  const cs = clamp(fin(spec.centreScale, 1), 0.2, 5);
  if (cs !== 1) band = { ...band, loMHz: band.loMHz * cs, hiMHz: band.hiMHz * cs };
  if (spec.minVswrFloor > 1) band = { ...band, minVswr: Math.max(band.minVswr, Math.min(50, spec.minVswrFloor)) };
  const shift = VNA_ASSUMPTIONS.handShiftFraction.value[contact] + VNA_ASSUMPTIONS.wetShiftFraction.value[damp];
  const lossDb = ANTENNA_CONTACT_LOSS_DB[contact] + ANTENNA_DAMPNESS_LOSS_DB[damp] + Math.max(0, fin(spec.extraLossDb, 0));
  const cm = spec.commonMode && spec.commonMode.amp > 0 ? spec.commonMode : null;
  const amp = dbToAmp(-lossDb);
  const f0 = Math.sqrt(band.loMHz * band.hiMHz);
  const ant = { designBand: band };
  const s11 = fMHz.map((f) => {
    const fe = Math.max(1e-3, f * (1 + shift));
    const m = antennaMatch(ant, fe);
    const g = Math.sqrt(m.gammaSq);
    const X = (2 * g) / Math.sqrt(Math.max(1e-12, 1 - g * g));
    const Xs = fe >= f0 ? X : -X;
    const gam = cDiv(cx(0, Xs), cx(2, Xs));
    let out = cScale(gam, amp);
    if (cm) { out = cAdd(out, polar(cm.amp, -2 * TAU * f * 1e6 * fin(cm.lengthM, 1) / C_M_S)); const m = cAbs(out); if (m > 0.98) out = cScale(out, 0.98 / m); }
    if (spec.front) out = terminate(lumpSparams(spec.front, f), out);
    return out;
  });
  return { fMHz: fMHz.slice(), s11, s21: null, efficiencyDb: -lossDb, detuneFraction: shift, band };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// TWO-PORT CHAIN ITEMS (data from chain-presets.js)
// ---------------------------------------------------------------------------------------------------------------------------------
export const VNA_ITEM_KINDS = Object.freeze(['attenuator', 'connector', 'splitter', 'combiner', 'activesplitter', 'activecombiner', 'coupler', 'filter', 'biastee', 'dcblock', 'booster', 'cable', 'faultshort', 'faultopen']);

/** Merge a preset (item.presetId in CHAIN_PRESETS) under the item's own fields; the item's `kind` falls back to the preset's kind. */
export function resolveChainItem(item = {}) {
  const p = item.presetId && CHAIN_PRESETS[item.presetId] ? CHAIN_PRESETS[item.presetId] : null;
  return p ? { kind: p.kind, ...p.item, ...item } : { ...item };
}
const rlAmp = (rlDb) => (Number.isFinite(rlDb) ? Math.pow(10, -rlDb / 20) : 0);
const delayRot = (fMHz, ns) => polar(1, -TAU * fMHz * 1e6 * (ns || 0) * 1e-9);

function lowCut(fMHz, cornerMHz) { // first-order high-pass 1: H = jx/(1 + jx), x = f/fc (bias tee / DC block RF path)
  const x = fMHz / cornerMHz;
  return cDiv(cx(0, x), cx(1, x));
}

// Filter prototype: returns the lowpass H(jx) from left-half-plane poles, DC gain 1 (passband peak 1 for Chebyshev too).
function lowpassH(x, order, response, rippleDb) {
  const n = clamp(Math.round(order), 1, 8);
  let num = ONE, den = ONE;
  const poles = [];
  if (response === 'chebyshev') {
    const eps = Math.sqrt(Math.pow(10, clamp(rippleDb, 0.01, 3) / 10) - 1), a = Math.asinh(1 / eps) / n;
    for (let k = 1; k <= n; k++) { const th = ((2 * k - 1) * Math.PI) / (2 * n); poles.push(cx(-Math.sinh(a) * Math.sin(th), Math.cosh(a) * Math.cos(th))); }
    for (const p of poles) { num = cMul(num, cScale(p, -1)); den = cMul(den, cSub(cx(0, x), p)); }
    const h = cDiv(num, den);
    return n % 2 === 0 ? cScale(h, 1 / Math.sqrt(1 + eps * eps)) : h;
  }
  for (let k = 0; k < n; k++) { const th = (Math.PI * (2 * k + n + 1)) / (2 * n); poles.push(cx(Math.cos(th), Math.sin(th))); }
  for (const p of poles) { num = cMul(num, cScale(p, -1)); den = cMul(den, cSub(cx(0, x), p)); }
  return cDiv(num, den);
}
/**
 * filterSparams(item, fMHz) -> two-port. item: { filterType 'bandpass'|'notch', centreMHz, bandwidthMHz, order (1..8), response 'butterworth'|'chebyshev',
 * rippleDb, lossDb, rejectionDb }. Lowpass-to-bandpass mapping x = (f/f0 - f0/f)/(BW/f0) (BW = 3 dB for Butterworth, ripple width for Chebyshev).
 * Notch = 1 - bandpass. The stopband is floored at the preset rejection (|H|^2 + floor^2), the passband loss is added, and S11 follows
 * from passivity: |S11|^2 = a^2 (1 - |Hn|^2) in quadrature with S21 (j rotation), so S11 is ~0 in the passband and ~1 in the stopband.
 */
export function filterSparams(item, fMHz) {
  const d = VNA_ASSUMPTIONS.filterDefaults.value;
  const notch = item.filterType === 'notch';
  const f0 = Math.max(0.1, fin(item.centreMHz, d.centreMHz)), bw = Math.max(0.01, fin(item.bandwidthMHz, notch ? d.notchBandwidthMHz : d.bandwidthMHz));
  const a = dbToAmp(-Math.max(0, fin(item.lossDb, 1.5))), fl = dbToAmp(-Math.max(1, fin(item.rejectionDb, 30)));
  const f = Math.max(1e-3, fMHz);
  const x = (f / f0 - f0 / f) / (bw / f0);
  const bp = lowpassH(x, fin(item.order, d.order), item.response === 'chebyshev' ? 'chebyshev' : 'butterworth', fin(item.rippleDb, d.rippleDb));
  const hn = notch ? cSub(ONE, bp) : bp;
  const m = cAbs(hn), ph = m > 1e-12 ? cArg(hn) : 0;
  const mTot = Math.sqrt(m * m + fl * fl) / Math.sqrt(1 + fl * fl);
  const s21 = polar(a * Math.min(1, mTot), ph);
  const r = Math.sqrt(Math.max(0, 1 - Math.min(1, m) * Math.min(1, m)));
  const s11 = polar(a * r, ph + Math.PI / 2);
  const s22 = polar(a * r, ph + Math.PI / 2);
  return twoPort(s11, s21, s21, s22);
}

/**
 * itemSparams(item, fMHz, opts) -> two-port at fMHz. `item` is a chain item (or a preset merged by resolveChainItem).
 * opts.path (splitter, combiner, coupler only): 'through' (default; splitter common to one output), 'coupled' (coupler tap), 'isolated' (coupler isolated port
 * or splitter output to output). Passive items are reciprocal (S12 = S21).
 *   attenuator / connector : S21 = -lossDb, matched (ideal; returnLossDb optional).
 *   splitter / combiner    : through = -10 log10(N) - insertionLossDb (1/N power split + excess); isolated = -isolationDb. Other ports assumed terminated.
 *   coupler                : through = -couplerThroughLossDb, coupled = -(coupling + excess), isolated = -isolationDb.
 *   biastee / dcblock      : -lossDb with a first-order low-frequency corner.
 *   booster / active*      : +gainDb forward, reverse = -(gain + 20) dB, input RL 12 dB, output RL 10 dB (U).
 *   filter                 : filterSparams.  cable: cableSparams.
 */
export function itemSparams(rawItem, fMHz, opts = {}) {
  const item = resolveChainItem(rawItem), kind = item.kind || 'attenuator', path = opts.path || 'through';
  const dly = delayRot(fMHz, item.delayNs);
  const P = VNA_ASSUMPTIONS.passiveReturnLossDb.value;
  const passive = (lossDb, rlDb) => {
    const t = cMul(polar(dbToAmp(-Math.max(0, lossDb)), 0), dly), g = cx(rlAmp(rlDb), 0);
    return twoPort(g, t, t, g);
  };
  const rl = (def) => fin(item.returnLossDb, def);
  switch (kind) {
    case 'cable': return cableSparams(item, fMHz);
    case 'filter': return filterSparams(item, fMHz);
    case 'attenuator': return passive(fin(item.lossDb, 0), rl(P.attenuator));
    case 'connector': return passive(fin(item.lossDb, 0.1), rl(P.connector));
    case 'splitter': case 'combiner': {
      const n = clamp(Math.round(fin(item.ports, 2)), 2, 64);
      if (path === 'isolated') return passive(fin(item.isolationDb, 20), 20);
      return passive(10 * Math.log10(n) + fin(item.insertionLossDb, 0.5), rl(P.splitter));
    }
    case 'coupler': {
      if (path === 'coupled') return passive(fin(item.couplingDb, 10) + fin(item.excessLossDb, 0), rl(P.coupler));
      if (path === 'isolated') return passive(fin(item.isolationDb, 25), 20);
      return passive(couplerThroughLossDb(item), rl(P.coupler));
    }
    case 'biastee': case 'dcblock': {
      const corner = kind === 'biastee' ? VNA_ASSUMPTIONS.biasTeeCornerMHz.value : VNA_ASSUMPTIONS.dcBlockCornerMHz.value;
      const t = cMul(cScale(lowCut(Math.max(1e-6, fMHz), corner), dbToAmp(-fin(item.lossDb, 0.5))), dly);
      const g = cx(rlAmp(rl(kind === 'biastee' ? P.biastee : P.dcblock)), 0);
      return twoPort(g, t, t, g);
    }
    case 'booster': case 'activesplitter': case 'activecombiner': {
      // fault hooks (U): tiltDbPerGHz = gain slope about 600 MHz; oscMHz/oscWidthMHz/oscPeakDb = a narrow gain peak with |S11| > 1 (negative resistance)
      let gain = fin(item.gainDb, 0) + fin(item.tiltDbPerGHz, 0) * (fMHz - 600) / 1000;
      const A = VNA_ASSUMPTIONS.activeReturnLossDb.value;
      let osc = 0;
      if (item.oscMHz > 0) { const w = Math.max(0.1, fin(item.oscWidthMHz, 5)), u = (fMHz - item.oscMHz) / w; osc = 1 / (1 + u * u); gain += fin(item.oscPeakDb, 12) * osc; }
      const t = cMul(polar(dbToAmp(gain), 0), dly), rev = polar(dbToAmp(-(Math.max(gain, 0) + VNA_ASSUMPTIONS.activeReverseIsolationDb.value)), 0);
      if (path === 'isolated') return passive(fin(item.isolationDb, 25), 15);
      const gIn = cx(rlAmp(A.input) + 0.9 * osc, 0), gOut = cx(rlAmp(A.output) + 0.9 * osc, 0);
      return twoPort(gIn, rev, t, gOut);
    }
    case 'faultshort': return shuntSparams(cx(1 / Math.max(0.05, fin(item.rOhm, 0.5)), 0));  // a shorted port: 0.5 ohm to ground (U)
    case 'faultopen': return seriesSparams(cx(0, -1 / (TAU * fMHz * 1e6 * fin(item.cPF, 0.1) * 1e-12))); // an open port: 0.1 pF gap (U)
    default: return passive(fin(item.lossDb, 0), Infinity);
  }
}
/** Cascade of items (signal flow order) at one frequency. An empty chain is a through (S21 = 1, S11 = 0). */
export function chainSparamsAt(items, fMHz, opts = {}) {
  let s = matched(ONE);
  for (const it of items || []) s = cascade(s, itemSparams(it, fMHz, opts));
  return s;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// DEVICE UNDER TEST -> true S-parameters (before the VNA error model)
// ---------------------------------------------------------------------------------------------------------------------------------
/**
 * dutSparams(dut, fMHz[]) -> { fMHz, s11[], s21[]|null, s12[], s22[], kind }
 * dut.type:
 *   'antenna' : { antennaType, centreMHz, designBand?, contact, dampness, groundPlane }  (one port, s21 null)
 *   'cable'   : { cableId, lengthM, velocityFactor?, termination? }   termination 'open'|'short'|'load'|{gamma}: one-port S11 (s21 null);
 *               without a termination the cable is a two-port (S11 = connector ripple, S21 = loss and delay).
 *   'chain'   : { items: [chain item...], path?, termination? }  likewise, termination makes it one-port (S11 of the whole chain with that load on its far end).
 *   'load' / 'open' / 'short' : the calibration standards (one port).
 */
export function dutSparams(dut = {}, fMHz) {
  const n = fMHz.length;
  const out = { fMHz: fMHz.slice(), s11: new Array(n), s21: null, s12: null, s22: null, kind: dut.type || 'load' };
  const type = dut.type || 'load';
  if (type === 'antenna') { const a = antennaSparams(dut, fMHz); out.s11 = a.s11; out.info = { efficiencyDb: a.efficiencyDb, detuneFraction: a.detuneFraction, band: a.band }; return out; }
  if (type === 'open' || type === 'short' || type === 'load') { for (let i = 0; i < n; i++) out.s11[i] = terminationGamma(type, fMHz[i]); return out; }
  const two = new Array(n);
  for (let i = 0; i < n; i++) {
    two[i] = type === 'cable' ? cableSparams(dut, fMHz[i]) : chainSparamsAt(dut.items || [], fMHz[i], { path: dut.path });
  }
  if (dut.termination != null) {
    for (let i = 0; i < n; i++) out.s11[i] = terminate(two[i], terminationGamma(dut.termination, fMHz[i]));
    return out;
  }
  out.s21 = two.map((s) => s.s21); out.s12 = two.map((s) => s.s12); out.s22 = two.map((s) => s.s22);
  out.s11 = two.map((s) => s.s11);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// VNA ERROR MODEL, OSL CALIBRATION, PORT EXTENSION
// ---------------------------------------------------------------------------------------------------------------------------------
/**
 * Raw (uncalibrated) one-port error terms at fMHz: { e00 directivity, e11 source match, e10e01 reflection tracking, et transmission tracking }.
 * Deterministic and ASSUMED (U): internal delay, small leakage and loss; the phase rotates with frequency like a short internal cable.
 */
export function rawErrorTerms(fMHz) {
  const A = VNA_ASSUMPTIONS, rot = (k) => TAU * fMHz * 1e6 * k * A.vnaInternalDelayNs.value * 1e-9;
  const grow = 1 + fMHz / 500;
  return {
    e00: polar(A.vnaDirectivity.value * grow, -rot(2) + 0.7),
    e11: polar(A.vnaSourceMatch.value * grow, -rot(2) - 0.4),
    e10e01: polar(dbToAmp(-A.vnaTrackingLossDb.value), -rot(2)),
    et: polar(dbToAmp(-A.vnaTrackingLossDb.value), -rot(1)),
  };
}
/** Measured Gamma from the true Gamma: Gm = e00 + e10e01 G/(1 - e11 G). */
export function applyErrorTerms(g, t) { return cAdd(t.e00, cDiv(cMul(t.e10e01, g), cSub(ONE, cMul(t.e11, g)))); }
/** Corrected Gamma: G = (m - e00)/(e10e01 + e11 (m - e00)). */
export function correctGamma(m, t) { const d = cSub(m, t.e00); return cDiv(d, cAdd(t.e10e01, cMul(t.e11, d))); }
/**
 * solveOSL(mOpen, mShort, mLoad) -> { e00, e11, e10e01 } from the three raw measurements of ideal standards (G = +1, -1, 0).
 * e00 = mL; with A = mO - e00, B = mS - e00:  e11 = (A + B)/(A - B),  e10e01 = A (1 - e11).
 */
export function solveOSL(mO, mS, mL) {
  const e00 = mL, A = cSub(mO, e00), B = cSub(mS, e00);
  const e11 = cDiv(cAdd(A, B), cSub(A, B));
  return { e00, e11, e10e01: cMul(A, cSub(ONE, e11)) };
}
/** Run an OSL calibration. seenThrough (optional) = a function (G, fMHz) -> Gamma at the VNA port for a standard at the cal plane (a cable at the plane). */
export function calibrateOSL(fMHz, seenThrough = null) {
  return fMHz.map((f) => {
    const t = rawErrorTerms(f), st = seenThrough || ((g) => g);
    const m = (g) => applyErrorTerms(st(g, f), t);
    return solveOSL(m(ONE), m({ re: -1, im: 0 }), m(ZERO));
  });
}
/** Port extension: remove a cable delay (ns, one way) from S11 (two-way, e^{+j 2 omega tau}) or S21 (one-way). */
export function portExtension(arr, fMHz, delayNs, oneWay = false) {
  return arr.map((s, i) => cMul(s, polar(1, TAU * fMHz[i] * 1e6 * delayNs * 1e-9 * (oneWay ? 1 : 2))));
}
export const CAL_STATES = Object.freeze(['none', 'good', 'extraCable', 'cableAtCal']);
export const CAL_LABELS = Object.freeze({
  none: 'Not calibrated (raw VNA)',
  good: 'Calibrated at the connector (open, short, load)',
  extraCable: 'Calibrated at the VNA port, then an extra cable added (bad cal plane)',
  cableAtCal: 'Calibrated with a cable on, then the cable removed',
});

/**
 * measure(cfg) -> { sweep, fMHz, s11[], s21[]|null, dut, calState, truth: { s11[], s21[]|null }, info }
 * cfg: { sweep: buildSweep options, dut, calibration: { state: CAL_STATES, extraCable: {cableId, lengthM, velocityFactor} }, portExtensionNs }
 *   none       : the DUT's S11 passes through the raw VNA error terms (directivity, source match, tracking, internal delay): visible rotation and ripple;
 *                S21 is multiplied by the uncalibrated transmission tracking.
 *   good       : the OSL solution inverts the same error terms exactly: the corrected result equals the true DUT (numerical floor ~1e-12).
 *   extraCable : the DUT is measured through the extra cable (cable S-parameters in front of it) but the calibration did not include it: the result
 *                shows the cable's phase rotation (2 beta L), loss and connector ripple.
 *   cableAtCal : the cal was done at the cable end and the cable then removed: the result is rotated the opposite way (apparent negative length).
 * Port extension (ns) is applied last. Nothing here uses randomness.
 */
export function measure(cfg = {}) {
  const sweep = buildSweep(cfg.sweep || {}), fMHz = sweep.fMHz, n = fMHz.length;
  const dut = cfg.dut || { type: 'load' };
  const calState = CAL_STATES.includes(cfg.calibration && cfg.calibration.state) ? cfg.calibration.state : 'good';
  const cable = (cfg.calibration && cfg.calibration.extraCable) || { cableId: 'rg58', lengthM: 1 };
  const truth = dutSparams(dut, fMHz);
  const terms = fMHz.map(rawErrorTerms);
  const hasS21 = !!truth.s21;
  // what the VNA port actually sees (extra cable in front of the DUT)
  const seen11 = new Array(n), seen21 = hasS21 ? new Array(n) : null;
  for (let i = 0; i < n; i++) {
    if (calState === 'extraCable') {
      const cs = cableSparams(cable, fMHz[i]);
      if (hasS21) { const d = twoPort(truth.s11[i], truth.s12[i], truth.s21[i], truth.s22[i]); const c = cascade(cs, d); seen11[i] = c.s11; seen21[i] = c.s21; }
      else { seen11[i] = terminate(cs, truth.s11[i]); }
    } else { seen11[i] = truth.s11[i]; if (hasS21) seen21[i] = truth.s21[i]; }
  }
  let s11, s21 = null;
  if (calState === 'none') {
    s11 = seen11.map((g, i) => applyErrorTerms(g, terms[i]));
    if (hasS21) s21 = seen21.map((s, i) => cMul(s, terms[i].et));
  } else if (calState === 'cableAtCal') {
    const seenThrough = (g, f) => terminate(cableSparams(cable, f), g);
    const cal = calibrateOSL(fMHz, seenThrough);
    s11 = seen11.map((g, i) => correctGamma(applyErrorTerms(g, terms[i]), cal[i]));
    if (hasS21) s21 = seen21.map((s, i) => cMul(s, polar(1 / dbToAmp(-lineSparamsLossDb(cable, fMHz[i])), 0)));
  } else {
    const cal = calibrateOSL(fMHz);
    s11 = seen11.map((g, i) => correctGamma(applyErrorTerms(g, terms[i]), cal[i]));
    if (hasS21) s21 = seen21.slice();
  }
  const ext = fin(cfg.portExtensionNs, 0);
  if (ext) { s11 = portExtension(s11, fMHz, ext); if (s21) s21 = portExtension(s21, fMHz, ext, true); }
  return { sweep, fMHz, s11, s21, dut, calState, truth: { s11: truth.s11, s21: truth.s21 }, info: truth.info || null };
}
function lineSparamsLossDb(cable, f) { return -20 * Math.log10(Math.max(1e-12, cAbs(lineSparams(cable, f).s21))); }

// ---------------------------------------------------------------------------------------------------------------------------------
// TRACES, GROUP DELAY, MARKERS
// ---------------------------------------------------------------------------------------------------------------------------------
/** Unwrap an array of phases (radians) so consecutive steps are within +-pi. */
export function unwrap(ph) {
  const out = ph.slice();
  for (let i = 1; i < out.length; i++) { let d = out[i] - out[i - 1]; while (d > Math.PI) { out[i] -= TAU; d -= TAU; } while (d < -Math.PI) { out[i] += TAU; d += TAU; } }
  return out;
}
/** Group delay in ns from the phase slope: tau = -d(phase)/d(omega), central differences (one-sided at the ends). Needs the phase step < 180 degrees per point. */
export function groupDelayNs(fMHz, s) {
  const n = fMHz.length;
  if (n < 2) return new Array(n).fill(0);
  const ph = unwrap(s.map(cArg)), out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), dF = fMHz[b] - fMHz[a];
    out[i] = dF > 0 ? (-(ph[b] - ph[a]) / (TAU * dF)) * 1e3 : 0; // rad / (2 pi MHz) = us -> x1000 = ns
  }
  return out;
}
/**
 * traceSet(result) -> every trace the GUI plots, all finite:
 * { fMHz, s11Db, rlDb, vswr, s11PhaseDeg, smith: [{x, y, zOhm, zNorm}], mismatchDb, s21Db|null, s21PhaseDeg|null, groupDelayNs|null, s11GroupDelayNs }
 * rlDb = return loss (positive for a passive load). s11Db = 20 log10|S11| (negative, the VNA LOGMAG).
 */
export function traceSet(res) {
  const s11 = res.s11, s21 = res.s21;
  return {
    fMHz: res.fMHz, s11Db: s11.map(magDb), rlDb: s11.map(returnLossDbFromGamma), vswr: s11.map(vswrFromGamma),
    s11PhaseDeg: s11.map(phaseDeg), smith: s11.map((g) => smithPoint(g)), mismatchDb: s11.map(mismatchLossDbFromGamma),
    s21Db: s21 ? s21.map(magDb) : null, s21PhaseDeg: s21 ? s21.map(phaseDeg) : null,
    groupDelayNs: s21 ? groupDelayNs(res.fMHz, s21) : null, s11GroupDelayNs: groupDelayNs(res.fMHz, s11).map((v) => v / 2),
  };
}
export const MAX_MARKERS = 4;
/** Linear interpolation of a real series at fMHz (clamped to the ends). */
export function interpAt(fMHz, vals, f) {
  const n = fMHz.length;
  if (!n) return 0;
  if (f <= fMHz[0]) return vals[0];
  if (f >= fMHz[n - 1]) return vals[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (fMHz[m] <= f) lo = m; else hi = m; }
  const k = (f - fMHz[lo]) / (fMHz[hi] - fMHz[lo]);
  return vals[lo] + k * (vals[hi] - vals[lo]);
}
/** Linear interpolation of a complex series. */
export function interpComplexAt(fMHz, arr, f) {
  return { re: interpAt(fMHz, arr.map((c) => c.re), f), im: interpAt(fMHz, arr.map((c) => c.im), f) };
}
/**
 * markerReadout(result, fMHz) -> { fMHz, s11: {re, im, db, rlDb, vswr, phaseDeg, mismatchDb, zOhm, smith}, s21: {re, im, db, phaseDeg, delayNs} | null }
 * Values are interpolated between sweep points (a marker is clamped to the sweep range).
 */
export function markerReadout(res, f) {
  const fc = clamp(fin(f, res.fMHz[0]), res.fMHz[0], res.fMHz[res.fMHz.length - 1]);
  const g = interpComplexAt(res.fMHz, res.s11, fc);
  const out = { fMHz: fc, s11: { re: g.re, im: g.im, db: magDb(g), rlDb: returnLossDbFromGamma(g), vswr: vswrFromGamma(g), phaseDeg: phaseDeg(g),
    mismatchDb: mismatchLossDbFromGamma(g), zOhm: zFromGamma(g), smith: smithPoint(g) }, s21: null };
  if (res.s21) {
    const s = interpComplexAt(res.fMHz, res.s21, fc);
    out.s21 = { re: s.re, im: s.im, db: magDb(s), phaseDeg: phaseDeg(s), delayNs: interpAt(res.fMHz, groupDelayNs(res.fMHz, res.s21), fc) };
  }
  return out;
}
/**
 * markerSearch(fMHz, values, 'min'|'max', { loMHz, hiMHz }) -> { index, fMHz, value } over the (optional) frequency window. NaN values are skipped.
 * Returns null if the window holds no points.
 */
export function markerSearch(fMHz, values, mode = 'min', win = {}) {
  const lo = fin(win.loMHz, -Infinity), hi = fin(win.hiMHz, Infinity);
  let best = -1;
  for (let i = 0; i < fMHz.length; i++) {
    if (fMHz[i] < lo || fMHz[i] > hi || !Number.isFinite(values[i])) continue;
    if (best < 0 || (mode === 'max' ? values[i] > values[best] : values[i] < values[best])) best = i;
  }
  return best < 0 ? null : { index: best, fMHz: fMHz[best], value: values[best] };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// CAUTIONS AND TEACHING TEXT
// ---------------------------------------------------------------------------------------------------------------------------------
/** Always-on real-world cautions (shown in the lab). */
export const VNA_CAUTIONS = Object.freeze([
  'Never connect a bias-powered output (an antenna distribution port with 12 V, a powered booster) or any DC to the VNA port. Put a DC block in front of it.',
  'Never connect a transmitter, an IEM or wireless-mic output or any RF power to the VNA port: it is a receiver with a -10 dBm class stimulus, not a power meter.',
  'A VNA measures the device, not the radio: switch the radio off and disconnect it from the antenna before sweeping.',
  'S11 and S21 are measured at the calibration plane: re-calibrate at the end of the cable you are testing, or use port extension.',
]);
/**
 * vnaCautions(dut) -> [{ level: 'info'|'warn'|'danger', text }] static cautions plus DC and drive-level hazards found in a chain.
 */
export function vnaCautions(dut = {}) {
  const out = VNA_CAUTIONS.map((text) => ({ level: 'info', text }));
  let gain = 0;
  const items = dut.type === 'chain' ? (dut.items || []).map(resolveChainItem) : [];
  for (const it of items) {
    const label = it.presetId && CHAIN_PRESETS[it.presetId] ? CHAIN_PRESETS[it.presetId].label : it.kind;
    if (it.dcSupplyV > 0 && it.dcMode !== 'block') out.push({ level: 'danger', text: `${label} injects ${it.dcSupplyV} V DC. Switch the supply off or add a DC block before the VNA port.` });
    if (it.dcNeedV > 0) out.push({ level: 'warn', text: `${label} needs DC bias to work (${it.dcNeedV} V); the VNA will not supply it. Measure it with its own supply and a DC block on both VNA ports.` });
    if (it.kind === 'biastee') out.push({ level: 'danger', text: 'A bias tee passes DC from its DC port to the RF output: never connect that output to the VNA while the DC port is powered.' });
    gain += fin(it.gainDb, 0) - (it.kind === 'attenuator' || it.kind === 'dcblock' || it.kind === 'connector' ? fin(it.lossDb, 0) : 0);
    if (Number.isFinite(it.maxInputDbm) && VNA_ASSUMPTIONS.portDriveDbm.value > it.maxInputDbm) out.push({ level: 'warn', text: `${label} input is rated below the VNA stimulus.` });
  }
  const outDbm = VNA_ASSUMPTIONS.portDriveDbm.value + gain;
  if (outDbm > VNA_ASSUMPTIONS.portMaxInputDbm.value) out.push({ level: 'danger', text: `Chain gain puts about ${outDbm.toFixed(0)} dBm into VNA port 2: add a pad (receiver limit about ${VNA_ASSUMPTIONS.portMaxInputDbm.value} dBm).` });
  return out;
}
/**
 * explainTrace(kind, value) -> plain-English reading of a number: kind 'rl' (return loss dB), 'vswr', 'il' (insertion loss dB, positive loss),
 * with a verdict 'good'|'ok'|'poor'. Thresholds are rules of thumb (I): RL >= 14 dB (VSWR 1.5) good, >= 9.5 dB (VSWR 2) ok.
 */
export function explainTrace(kind, value) {
  if (kind === 'rl' || kind === 'vswr') {
    const rl = kind === 'rl' ? value : returnLossDbFromGamma(gammaMagFromVswr(value));
    const v = kind === 'vswr' ? value : vswrFromGamma(Math.pow(10, -rl / 20));
    const verdict = rl >= 14 ? 'good' : rl >= 9.5 ? 'ok' : 'poor';
    const txt = { good: 'Well matched: nearly all the power goes into the load.', ok: 'Usable but not ideal: about 10 percent or more of the power is reflected.',
      poor: 'Poorly matched: a large share of the power is reflected. Check the antenna cut, the cable, the connector and what is near the antenna.' }[verdict];
    return { verdict, text: `Return loss ${rl.toFixed(1)} dB (VSWR ${v.toFixed(2)}:1). ${txt}` };
  }
  const verdict = value <= 1 ? 'good' : value <= 3 ? 'ok' : 'poor';
  return { verdict, text: `Insertion loss ${value.toFixed(1)} dB (${Math.round(Math.pow(10, -value / 10) * 100)} percent of the power gets through).` };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// DISTANCE TO FAULT (time-domain reflectometry from S11) AND RIPPLE SPACING
// ---------------------------------------------------------------------------------------------------------------------------------
/** Window weights for n points: 'rect', 'hann' (default), 'hamming', 'blackman'. */
export function windowWeights(n, kind = 'hann') {
  const w = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = n > 1 ? i / (n - 1) : 0;
    w[i] = kind === 'rect' ? 1 : kind === 'hamming' ? 0.54 - 0.46 * Math.cos(TAU * x)
      : kind === 'blackman' ? 0.42 - 0.5 * Math.cos(TAU * x) + 0.08 * Math.cos(2 * TAU * x) : 0.5 - 0.5 * Math.cos(TAU * x);
  }
  return w;
}
/** Distance resolution (m) of a sweep of bandwidth spanMHz: c VF /(2 BW) (before windowing, which widens the peak about 1.5x for Hann). */
export const dtfResolutionM = (spanMHz, vf) => (C_M_S * vf) / (2 * spanMHz * 1e6);
/** Unambiguous range (m) of a sweep with step stepMHz: c VF /(2 step). Beyond it reflections alias back. */
export const dtfRangeM = (stepMHz, vf) => (C_M_S * vf) / (2 * stepMHz * 1e6);
/**
 * distanceToFault(fMHz, s11, { velocityFactor, window, points, maxDistanceM }) -> { distanceM[], magnitude[], peaks[], resolutionM, rangeM }
 * Windowed inverse Fourier transform of S11 evaluated at the round-trip delays t = 2 d/(c VF): h(d) = | sum_k w_k S11(f_k) e^{+j 2 pi f_k t} | / sum w_k,
 * so a lossless total reflection at distance d reads 1 at d. Each reflection of amplitude G shows as a peak of height about G at its distance
 * (cable loss lowers far peaks by e^{-2 alpha d}). A wrong velocity factor scales every distance. peaks: local maxima above 5 percent of the tallest,
 * sorted by distance, [{ distanceM, magnitude }]. Needs a uniformly spaced sweep.
 */
export function distanceToFault(fMHz, s11, opts = {}) {
  const n = fMHz.length, vf = clamp(fin(opts.velocityFactor, 0.66), 0.3, 1);
  const range = dtfRangeM(n > 1 ? (fMHz[n - 1] - fMHz[0]) / (n - 1) : 1, vf);
  const dMax = Math.min(range, Math.max(0.1, fin(opts.maxDistanceM, 50)));
  const m = clamp(Math.round(fin(opts.points, 401)), 11, 2001);
  const w = windowWeights(n, opts.window || 'hann'), wsum = w.reduce((a, b) => a + b, 0) || 1;
  const distanceM = new Array(m), magnitude = new Array(m);
  for (let k = 0; k < m; k++) {
    const d = (dMax * k) / (m - 1), t = (2 * d) / (C_M_S * vf);
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      const ph = TAU * fMHz[i] * 1e6 * t, c = Math.cos(ph), s = Math.sin(ph);
      re += w[i] * (s11[i].re * c - s11[i].im * s); im += w[i] * (s11[i].re * s + s11[i].im * c);
    }
    distanceM[k] = d; magnitude[k] = Math.hypot(re, im) / wsum;
  }
  let top = 0;
  for (const v of magnitude) if (v > top) top = v;
  const peaks = [];
  for (let k = 1; k < m - 1; k++) if (magnitude[k] > magnitude[k - 1] && magnitude[k] >= magnitude[k + 1] && magnitude[k] > 0.05 * top) peaks.push({ distanceM: distanceM[k], magnitude: magnitude[k] });
  return { distanceM, magnitude, peaks, resolutionM: dtfResolutionM(fMHz[n - 1] - fMHz[0], vf), rangeM: range };
}
/** Mean spacing (MHz) between local maxima of a series (the S11 ripple period): (last - first)/(count - 1), or null with fewer than 2 maxima. */
export function rippleSpacingMHz(fMHz, vals) {
  const pk = [];
  for (let i = 1; i < vals.length - 1; i++) if (vals[i] > vals[i - 1] && vals[i] >= vals[i + 1]) pk.push(fMHz[i]);
  return pk.length < 2 ? null : (pk[pk.length - 1] - pk[0]) / (pk.length - 1);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// FAULT LIBRARY (item 26a). Every figure is ASSUMED (flag U): teaching magnitudes, not measurements of any product.
// ---------------------------------------------------------------------------------------------------------------------------------
const copy = (o) => JSON.parse(JSON.stringify(o));
// Apply fn to a copy of the target: the DUT itself if its type is in `types`, else the first (or targetIndex) chain item whose kind is in `kinds`.
function mapTarget(dut, types, kinds, fn) {
  if (dut && types.includes(dut.type)) { const d = { ...copy({ ...dut, termination: undefined }), termination: dut.termination }; if (d.termination === undefined) delete d.termination; fn(d); return d; }
  if (dut && dut.type === 'chain') {
    const items = dut.items || [];
    const idx = items.findIndex((it, i) => (Number.isInteger(dut.targetIndex) ? i === dut.targetIndex : kinds.includes(resolveChainItem(it).kind)));
    if (idx >= 0) { const d = { ...dut, items: items.map(copy) }; d.items[idx] = { ...resolveChainItem(d.items[idx]) }; delete d.items[idx].presetId; fn(d.items[idx]); return d; }
  }
  return null;
}
const posOf = (t, p, dflt) => fin(p.posM, dflt != null ? dflt : 0.5 * fin(t.lengthM, 1));
const FAULTS_MUT = {};
function def(id, device, label, cause, symptom, cure, link, params, apply) { FAULTS_MUT[id] = Object.freeze({ id, device, label, cause, symptom, cure, link, params, flag: 'U', apply }); }
const cableFault = (fn) => (dut, p) => { const d = mapTarget(dut, ['cable'], ['cable'], (t) => fn(t, p)); return d && { dut: d }; };
const antFault = (fn) => (dut, p) => { const d = mapTarget(dut, ['antenna'], [], (t) => fn(t, p)); return d && { dut: d }; };
const itemFault = (kinds, fn, warn) => (dut, p) => { const d = mapTarget(dut, [], kinds, (t) => fn(t, p)); return d && { dut: d, warnings: warn || [] }; };
const bump = (t, pos, z, len, extra = {}) => { t.bumps = (t.bumps || []).concat([{ posM: pos, zOhm: z, lengthM: len, ...extra }]); };
const lump = (t, pos, l) => { t.lumps = (t.lumps || []).concat([{ posM: pos, ...l }]); };
const termFault = (make) => (dut, p) => { if (!dut || (dut.type !== 'cable' && dut.type !== 'chain')) return null; return { dut: { ...dut, termination: make(p) } }; };
const measFault = (fn) => (dut, p) => ({ dut, ...fn(p) });

// ---- cables
def('cable-kink', 'cable', 'Kinked cable', 'A tight bend or a boot on the cable flattens the dielectric for a few centimetres, raising the impedance there.',
  'A small return-loss spike at one point; S11 ripple whose period gives the distance to the kink; a small peak on the distance-to-fault trace at the kink; a little extra loss.',
  'Replace the cable (a kink does not recover). Coil with a radius of at least 10 times the cable diameter.', 'About 0.1 to 0.5 dB extra loss and VSWR 1.3 to 1.5 at that point: a little less range.',
  { posM: null, zOhm: 68, lengthM: 0.04 }, cableFault((t, p) => bump(t, posOf(t, p), fin(p.zOhm, 68), fin(p.lengthM, 0.04))));
def('cable-crush', 'cable', 'Crushed cable', 'A heavy object or a cable ramp crushes the coax, lowering the impedance over a few centimetres.',
  'A return-loss spike at one place (impedance below 50 ohm); the distance-to-fault peak has the opposite sign to a kink (Smith chart loop on the other side).', 'Replace the cable; use proper cable ramps.',
  'Similar to a kink: small loss, a hot spot in the VSWR.', { posM: null, zOhm: 36, lengthM: 0.05 }, cableFault((t, p) => bump(t, posOf(t, p), fin(p.zOhm, 36), fin(p.lengthM, 0.05))));
def('cable-cut-open', 'cable', 'Cut or open break', 'The centre conductor is broken inside the jacket, leaving a tiny gap.',
  'S21 collapses to almost nothing; S11 looks like an open circuit (Smith chart at the right edge) with ripple at the break distance.', 'Find the break by distance and re-terminate or replace the cable.',
  'No signal at all: total dropout.', { posM: null, seriesCpF: 0.1 }, cableFault((t, p) => lump(t, posOf(t, p), { seriesCpF: fin(p.seriesCpF, 0.1) })));
def('cable-short', 'cable', 'Shorted cable', 'The centre conductor touches the shield (crushed or a bad connector).',
  'S21 collapses; S11 looks like a short (Smith chart at the left edge) with ripple at the fault distance.', 'Replace the cable or connector.', 'No signal: total dropout.',
  { posM: null, shuntOhm: 0.5 }, cableFault((t, p) => lump(t, posOf(t, p), { shuntOhm: fin(p.shuntOhm, 0.5) })));
def('cable-water', 'cable', 'Water ingress', 'Water in a cut or a cracked jacket raises the loss and lowers the impedance over a stretch of cable.',
  'Insertion loss rising steeply with frequency, poor return loss over the wet length, a broad hump on the distance-to-fault trace.', 'Cut back past the wet section, re-terminate, seal with self-amalgamating tape and a drip loop.',
  'Extra loss of 3 to 10 dB at UHF: short range and dropouts when it rains.', { posM: null, lengthM: 0.6, zOhm: 42, extraDbPerMPerGHz: 8 }, cableFault((t, p) => bump(t, posOf(t, p), fin(p.zOhm, 42), fin(p.lengthM, 0.6), { extraDbPerMPerGHz: fin(p.extraDbPerMPerGHz, 8) })));
def('cable-connector-corroded', 'cable', 'Corroded or loose connector', 'Oxidised contact or a loose coupling nut: series resistance and inductance at the connector.',
  'Return loss worse at high frequency, a little extra loss, erratic when you wiggle the connector.', 'Clean or replace the connector; tighten to the right torque.', 'A dB or two of extra loss; intermittent dropouts.',
  { posM: 0, rOhm: 6, lNH: 8 }, cableFault((t, p) => lump(t, fin(p.posM, 0), { rOhm: fin(p.rOhm, 6), lNH: fin(p.lNH, 8) })));
def('cable-bad-joint', 'cable', 'Bad crimp or cold solder joint', 'A poor termination of the connector: series resistance and a stray capacitance.',
  'Slightly poor return loss rising with frequency, intermittent with movement.', 'Re-terminate the connector.', 'A small loss and a noisy link.',
  { posM: null, rOhm: 3, lNH: 10, shuntCpF: 1.2 }, cableFault((t, p) => lump(t, posOf(t, p, t.lengthM), { rOhm: fin(p.rOhm, 3), lNH: fin(p.lNH, 10), shuntCpF: fin(p.shuntCpF, 1.2) })));
def('cable-wrong-impedance-connector', 'cable', 'Wrong-impedance connector', 'A 75 ohm BNC (video) in a 50 ohm RF system.',
  'A small return-loss spike at the connector; Smith chart loop; worse at higher frequency.', 'Use 50 ohm RF connectors throughout.', 'A fraction of a dB, but it adds a ripple.',
  { posM: 0, zOhm: 75, lengthM: 0.02 }, cableFault((t, p) => bump(t, fin(p.posM, 0), fin(p.zOhm, 75), fin(p.lengthM, 0.02))));
def('cable-wrong-adapter', 'cable', 'Wrong-type or poor adapter', 'A cheap adapter between connector families: a short mismatched section with a stray capacitance.',
  'Return-loss spike at the adapter distance, worse as frequency rises.', 'Use a good 50 ohm adapter or remove it.', 'Some tenths of a dB; added ripple.',
  { posM: 0, zOhm: 60, lengthM: 0.03, shuntCpF: 0.8 }, cableFault((t, p) => { bump(t, fin(p.posM, 0), fin(p.zOhm, 60), fin(p.lengthM, 0.03)); lump(t, fin(p.posM, 0) + fin(p.lengthM, 0.03), { shuntCpF: fin(p.shuntCpF, 0.8) }); }));
def('cable-shield-damaged', 'cable', 'Damaged shield', 'A torn braid leaks: it radiates and picks up signals.',
  'S11 looks almost fine (a small bump) but the cable couples to its surroundings: the traces change when you touch or move the cable.', 'Replace the cable.', 'Interference ingress and dropouts when the cable moves.',
  { posM: null, zOhm: 54, lengthM: 0.5 }, cableFault((t, p) => bump(t, posOf(t, p), fin(p.zOhm, 54), fin(p.lengthM, 0.5))));
def('cable-high-loss', 'cable', 'Long, high-loss cable', 'A thin cable (RG174 class) run too far.', 'Insertion loss large and rising with frequency; the S11 of an open end shrinks (the reflection is absorbed).', 'Use a thicker, lower-loss cable or a shorter run.',
  'Several dB of lost range.', { lossScale: 2.5 }, cableFault((t, p) => { t.lossScale = fin(p.lossScale, 2.5); }));
def('cable-poor-vf', 'cable', 'Cheap cable with a poor velocity factor', 'Cable with a velocity factor lower than rated (cheap dielectric).',
  'A distance-to-fault peak at the wrong distance when you enter the rated VF: the cable looks longer than it is.', 'Measure a known length and enter the real VF.', 'No direct effect on level; it ruins length and fault-location estimates.',
  { velocityFactor: 0.55 }, cableFault((t, p) => { t.velocityFactor = fin(p.velocityFactor, 0.55); }));
def('term-open', 'cable', 'Bad termination: open', 'The antenna or load is not connected.', 'Return loss near 0 dB; a ripple whose period gives the cable length; Smith chart on the rim.', 'Connect the antenna or a 50 ohm load.', 'No radiation: dropout.', {}, termFault(() => 'open'));
def('term-short', 'cable', 'Bad termination: short', 'A shorted connector or antenna.', 'Return loss near 0 dB, ripple in antiphase with an open.', 'Repair the antenna or connector.', 'No radiation: dropout.', {}, termFault(() => 'short'));
def('term-25', 'cable', 'Wrong load: 25 ohm', 'A low-impedance load.', 'Return loss 9.5 dB (VSWR 2:1) flat.', 'Use a 50 ohm load.', 'About 0.5 dB mismatch.', { zOhm: 25 }, termFault((p) => ({ zOhm: { re: fin(p.zOhm, 25), im: 0 } })));
def('term-100', 'cable', 'Wrong load: 100 ohm', 'A high-impedance load.', 'Return loss 9.5 dB (VSWR 2:1) flat.', 'Use a 50 ohm load.', 'About 0.5 dB mismatch.', { zOhm: 100 }, termFault((p) => ({ zOhm: { re: fin(p.zOhm, 100), im: 0 } })));
def('term-reactive', 'cable', 'Reactive termination', 'A load with a series capacitance (a stray or a wrong antenna).', 'Return loss gets worse with falling frequency; the Smith chart trace curves along the lower half.', 'Add the matching network or fix the antenna.', 'Level drops at the band edge.', { cPF: 10 },
  termFault((p) => { const c = fin(p.cPF, 10); return { zFn: (f) => ({ re: 50, im: -1 / (TAU * f * 1e6 * c * 1e-12) }) }; }));

// ---- antennas
def('ant-broken-short', 'antenna', 'Broken or short element', 'A snapped or cut-short whip or dipole element resonates too high.', 'The S11 dip moves UP in frequency and is shallow; in the wanted band the return loss is poor.', 'Replace the antenna or element.', 'VSWR 3:1 or worse at the carrier: loses range, a hot Tx.',
  { centreScale: 1.3, minVswrFloor: 1.6 }, antFault((t, p) => { t.centreScale = fin(p.centreScale, 1.3); t.minVswrFloor = fin(p.minVswrFloor, 1.6); }));
def('ant-wrong-length', 'antenna', 'Wrong length for the band', 'An antenna cut for a different band.', 'The S11 dip is in the wrong place; nothing useful at the wanted frequency.', 'Fit the antenna for the band (see the lesson on antenna choice).', 'Poor match and short range.',
  { centreScale: 0.75 }, antFault((t, p) => { t.centreScale = fin(p.centreScale, 0.75); }));
def('ant-bent', 'antenna', 'Bent or detuned element', 'A bent whip or one deformed by a case: the resonance shifts a few percent.', 'The S11 dip shifts a few percent and the minimum is shallower.', 'Straighten or replace.', 'A slightly worse match at the carrier.',
  { centreScale: 0.96, minVswrFloor: 1.5 }, antFault((t, p) => { t.centreScale = fin(p.centreScale, 0.96); t.minVswrFloor = fin(p.minVswrFloor, 1.5); }));
def('ant-no-ground', 'antenna', 'No ground plane or choke', 'A whip on a free cable: the cable shield acts as the other half of the antenna.', 'The S11 dip is shallow and the trace has ripple that moves when you touch the cable; the match changes with cable length.', 'Fit a ground plane (see the placement lessons) or a ferrite choke.',
  'Ground-plane loss about 4 dB versus a large plane; erratic range.', { ripple: 0.12, lengthM: 1.5 }, antFault((t, p) => { t.groundPlane = 'none'; t.commonMode = { amp: fin(p.ripple, 0.12), lengthM: fin(p.lengthM, 1.5) }; }));
def('ant-hand', 'antenna', 'Hand or body on the antenna', 'Skin or a cupped hand absorbs power and detunes the antenna.', 'The S11 dip moves down and the return loss can look BETTER because the hand absorbs the power. Check the efficiency, not just S11.', 'Keep the hand away from the antenna.',
  'Body contact costs 6 to 8 dB in the planner.', { contact: 'cupped' }, antFault((t, p) => { t.contact = p.contact || 'cupped'; }));
def('ant-wet', 'antenna', 'Wet or sweaty antenna', 'Wet clothing or sweat on the antenna.', 'Slight detuning and extra loss.', 'Keep the antenna dry and clear of the body.', 'Extra 1 to 3 dB loss.', { dampness: 'wet', contact: 'clothing' },
  antFault((t, p) => { t.dampness = p.dampness || 'wet'; if (!t.contact || t.contact === 'free') t.contact = p.contact || 'clothing'; }));
def('ant-metal-rack', 'antenna', 'Metal rack nearby', 'A rack or metal panel within a wavelength reflects and detunes.', 'Ripple on S11 that changes when you move the antenna, a small detune.', 'Move the antenna at least a quarter wave from metal, or mount it correctly on the rack.', 'Pattern distortion and a notch in coverage.',
  { centreScale: 0.97, minVswrFloor: 1.3, ripple: 0.08, lengthM: 0.4 }, antFault((t, p) => { t.centreScale = fin(p.centreScale, 0.97); t.minVswrFloor = fin(p.minVswrFloor, 1.3); t.commonMode = { amp: fin(p.ripple, 0.08), lengthM: fin(p.lengthM, 0.4) }; }));
def('ant-connector-damaged', 'antenna', 'Damaged antenna connector', 'A damaged centre pin or worn connector: series resistance and inductance at the antenna.', 'S11 poor at high frequency, worse than the antenna alone; intermittent.', 'Replace the connector.', 'Loss plus a poor match: dropouts.',
  { rOhm: 12, lNH: 18 }, antFault((t, p) => { t.front = { rOhm: fin(p.rOhm, 12), lNH: fin(p.lNH, 18) }; }));
def('ant-cracked-helical', 'antenna', 'Cracked helical', 'A broken helix winding: the resonance moves and the efficiency falls.', 'A poor, shifted S11 with no clean dip.', 'Replace the antenna.', 'Hot Tx and short range.',
  { centreScale: 1.06, minVswrFloor: 2.5, extraLossDb: 1.5 }, antFault((t, p) => { t.centreScale = fin(p.centreScale, 1.06); t.minVswrFloor = fin(p.minVswrFloor, 2.5); t.extraLossDb = fin(p.extraLossDb, 1.5); }));

// ---- filters, splitters, bias tees, boosters
def('filter-shifted', 'filter', 'Shifted passband', 'A detuned or knocked cavity or filter: the passband moves.', 'The S21 passband and the S11 match moved to the wrong frequency; your wanted channel is in the skirt.', 'Retune the filter or replace it.', 'A wanted channel attenuated several dB.',
  { shiftFraction: 0.08 }, itemFault(['filter'], (t, p) => { t.centreMHz = fin(t.centreMHz, 600) * (1 + fin(p.shiftFraction, 0.08)); }));
def('filter-high-loss', 'filter', 'High insertion loss', 'Corroded or worn contacts in the filter.', 'S21 in the passband lower than the datasheet.', 'Service or replace the filter.', 'Several dB lost.', { addLossDb: 4 },
  itemFault(['filter'], (t, p) => { t.lossDb = fin(t.lossDb, 1.5) + fin(p.addLossDb, 4); }));
def('filter-poor-rejection', 'filter', 'Poor rejection', 'A damaged cavity or loose lid: the stopband no longer rejects.', 'S21 in the stopband much higher than expected.', 'Replace the filter.', 'Interference passes the filter.', { rejectionDb: 12 },
  itemFault(['filter'], (t, p) => { t.rejectionDb = fin(p.rejectionDb, 12); }));
const addEnd = (kind) => (dut) => (dut && dut.type === 'chain' ? { dut: { ...dut, items: [...(dut.items || []).map(copy), { kind }] } } : null);
def('splitter-port-short', 'splitter', 'Shorted port', 'A shorted output on a splitter, combiner or other device.', 'S21 almost gone; S11 near total reflection.', 'Remove the short; terminate unused ports.', 'No signal through that path.', {}, addEnd('faultshort'));
def('splitter-port-open', 'splitter', 'Open port', 'A disconnected output on a splitter or combiner.', 'S21 almost gone; S11 looks like an open.', 'Connect the port or terminate it.', 'No signal through that path.', {}, addEnd('faultopen'));
def('splitter-unterminated', 'splitter', 'Unterminated splitter port', 'An unused splitter output left open.', 'S11 at the common port worse (return loss near 8 dB); extra power reflected back.', 'Fit a 50 ohm terminator on every unused port.', 'Reflected power: VSWR warning on the transmitter.',
  { returnLossDb: 8 }, itemFault(['splitter', 'combiner', 'activesplitter', 'activecombiner', 'coupler'], (t, p) => { t.returnLossDb = fin(p.returnLossDb, 8); }));
def('biastee-dc-short', 'biastee', 'Bias tee shorted (DC fault)', 'A failed capacitor or fault in the bias tee puts DC on the RF path.', 'Extra loss and a poor match in RF; DC reaches the VNA port. DANGER: this can destroy the VNA.', 'Fit a DC block before the VNA; replace the bias tee.', 'The remote amplifier gets no power or the Rx front end can be damaged.',
  { addLossDb: 1 }, itemFault(['biastee'], (t, p) => { t.lossDb = fin(t.lossDb, 0.6) + fin(p.addLossDb, 1); t.returnLossDb = 12; t.dcSupplyV = fin(t.dcSupplyV, 12); t.dcMode = 'pass'; }, ['DC present at the VNA port: fit a DC block now. This can damage the VNA.']));
const ACT = ['booster', 'activesplitter', 'activecombiner'];
def('booster-low-gain', 'booster', 'Low gain', 'A failing amplifier or low supply voltage.', 'S21 gain well below the rated value.', 'Check the supply and the bias; replace the booster.', 'Less range gain than planned.', { gainLossDb: 8 },
  itemFault(ACT, (t, p) => { t.gainDb = fin(t.gainDb, 0) - fin(p.gainLossDb, 8); }));
def('booster-tilt', 'booster', 'Gain tilt', 'A mismatched or damaged amplifier: gain falls with frequency.', 'S21 slopes across the sweep.', 'Replace the booster or add an equaliser.', 'Channels at one end of the band are weaker.', { tiltDbPerGHz: -12 },
  itemFault(ACT, (t, p) => { t.tiltDbPerGHz = fin(p.tiltDbPerGHz, -12); }));
def('booster-oscillation', 'booster', 'Oscillation hint', 'An amplifier with positive feedback (a bad termination or poor decoupling).', 'A narrow S21 gain peak and |S11| above 0 dB (return loss negative): the amplifier is generating power.', 'Check the cables, terminations and supply decoupling; add a pad.', 'Interference and a strong spur at that frequency.',
  { oscMHz: 600, oscWidthMHz: 5, oscPeakDb: 12 }, itemFault(ACT, (t, p) => { t.oscMHz = fin(p.oscMHz, 600); t.oscWidthMHz = fin(p.oscWidthMHz, 5); t.oscPeakDb = fin(p.oscPeakDb, 12); }));

// ---- measurement mistakes
def('meas-no-cal', 'measurement', 'No calibration', 'The VNA was not calibrated: its raw directivity, source match and internal delay show.', 'A matched load shows a return loss of only 30 to 40 dB, the phase rotates with frequency, small ripple everywhere.', 'Calibrate (open, short, load) at the connector you will measure from.', 'You trust a wrong number.', {},
  measFault(() => ({ calibration: { state: 'none' } })));
def('meas-wrong-plane', 'measurement', 'Wrong calibration plane', 'The calibration was done at the VNA and then a cable was added.', 'A phase rotation with frequency and ripple from the extra cable; the extra cable shows on the distance-to-fault trace.', 'Calibrate at the end of the cable, or use port extension.', 'The extra cable loss is attributed to the device.',
  { cableId: 'rg58', lengthM: 1 }, measFault((p) => ({ calibration: { state: 'extraCable', extraCable: { cableId: p.cableId || 'rg58', lengthM: fin(p.lengthM, 1) } } })));
def('meas-adapter-out', 'measurement', 'Adapter left out of the calibration', 'The cal was done without the adapter that is in the measurement.', 'A small ripple and offset from the adapter, a phase step; a spike on the distance-to-fault trace.', 'Calibrate with the same adapters in place.', 'Wrong loss and match numbers.', {},
  measFault(() => ({ calibration: { state: 'extraCable', extraCable: { cableId: 'rg316', lengthM: 0.1, connectorReturnLossDb: 20 } } })));
def('meas-cal-cable-removed', 'measurement', 'Calibrated with a cable, then removed', 'The cable was in place at calibration and then removed.', 'The phase rotates the other way (apparent negative length) and the return loss is wrong.', 'Calibrate at the point you measure.', 'You measure a different cable than you think.',
  { cableId: 'rg58', lengthM: 1 }, measFault((p) => ({ calibration: { state: 'cableAtCal', extraCable: { cableId: p.cableId || 'rg58', lengthM: fin(p.lengthM, 1) } } })));
def('meas-sweep-mismatch', 'measurement', 'Sweep does not cover the device band', 'The sweep range is far from the device band.', 'The dip or passband is not on the screen: only flat, uninformative traces.', 'Set the sweep with a preset for the band, or zoom around the design band.', 'You miss the problem.',
  { startMHz: 1600, stopMHz: 2000 }, measFault((p) => ({ sweep: { startMHz: fin(p.startMHz, 1600), stopMHz: fin(p.stopMHz, 2000) } })));
def('meas-dc-live', 'measurement', 'DC live at the VNA port', 'A bias tee or powered booster is connected to the VNA.', 'No numbers are reliable and the VNA may already be damaged.', 'Disconnect the power. Fit a DC block before the VNA.', 'Not a link fault: a measurement hazard.', {},
  measFault(() => ({ warnings: ['DC present at the VNA port: disconnect the power and fit a DC block. This can destroy the VNA input.'] })));

/** FAULTS: id -> { id, device, label, cause, symptom, cure, link, params (defaults), flag 'U', apply(dut, params) }. Device: cable | antenna | filter | splitter | biastee | booster | measurement. */
export const FAULTS = Object.freeze(FAULTS_MUT);
export const FAULT_IDS = Object.freeze(Object.keys(FAULTS));

/** Fault ids the GUI should offer for a DUT (device match, plus every measurement mistake). */
export function faultsFor(dut = {}) {
  const dev = new Set(['measurement']);
  const map = { cable: 'cable', antenna: 'antenna', filter: 'filter', splitter: 'splitter', combiner: 'splitter', activesplitter: 'splitter', activecombiner: 'splitter', coupler: 'splitter', biastee: 'biastee', booster: 'booster' };
  if (dut.type === 'cable') dev.add('cable');
  if (dut.type === 'antenna') dev.add('antenna');
  if (dut.type === 'chain') { for (const it of dut.items || []) if (map[resolveChainItem(it).kind]) dev.add(map[resolveChainItem(it).kind]); dev.add('splitter'); }
  return FAULT_IDS.filter((id) => dev.has(FAULTS[id].device) && !(dut.type === 'chain' && id.startsWith('term-') && false));
}
/**
 * applyFault(cfg, faultId, params) -> { cfg, fault, applicable, warnings }
 * cfg is a measure() config { sweep, dut, calibration, portExtensionNs }. Returns a new cfg with the fault applied (the input is not changed).
 * params override the catalogue defaults (fault.params); a cable `posM` is the distance in metres from the near end (default the middle).
 * If the fault does not apply to the DUT, applicable is false, cfg is unchanged and warnings says why.
 */
export function applyFault(cfg = {}, faultId, params = {}) {
  const fault = FAULTS[faultId];
  if (!fault) return { cfg, fault: null, applicable: false, warnings: [`Unknown fault: ${faultId}`] };
  const p = { ...Object.fromEntries(Object.entries(fault.params).filter(([, v]) => v != null)), ...params };
  const r = fault.apply(cfg.dut || { type: 'load' }, p);
  if (!r) return { cfg, fault, applicable: false, warnings: [`${fault.label} does not apply to this device.`] };
  const out = { ...cfg, dut: r.dut };
  if (r.calibration) out.calibration = r.calibration;
  if (r.sweep) out.sweep = { ...(cfg.sweep || {}), ...r.sweep };
  return { cfg: out, fault, applicable: true, warnings: r.warnings || [] };
}
/** Faulty true S-parameters of a device: dutSparams of the faulted DUT (measurement-type faults leave the DUT unchanged). Null if the fault does not apply. */
export function faultySparams(dut, faultId, fMHz, params = {}) {
  const r = applyFault({ dut }, faultId, params);
  return r.applicable ? dutSparams(r.cfg.dut, fMHz) : null;
}
/** Measure with the fault in place (calibration and sweep faults included): { result, fault, warnings, applicable }. */
export function measureWithFault(cfg, faultId, params = {}) {
  const r = applyFault(cfg, faultId, params);
  return { result: measure(r.cfg), fault: r.fault, warnings: r.warnings, applicable: r.applicable };
}
/**
 * faultPlannerFigures(dut, faultId, params, fMHz = 600) -> { extraCableLossDb, antennaVswr, antennaMismatchDb, antennaExtraLossDb, returnLossDb, dcWarning, notes, flag } | null
 * Maps a fault to planner inputs at fMHz as the difference from the ideal device: extraCableLossDb = ideal |S21| dB minus faulty |S21| dB (null for a
 * one-port, floored at 0); antennaVswr = VSWR of the faulty antenna at fMHz; antennaExtraLossDb = added body or absorption loss plus extra mismatch
 * loss versus the ideal antenna. Suggested figures for an example's cable loss or antenna match, flag U (assumed).
 */
export function faultPlannerFigures(dut, faultId, params = {}, fMHz = 600) {
  const f = [fMHz], r = applyFault({ dut }, faultId, params);
  if (!r.applicable) return null;
  const ideal = dutSparams(dut, f), bad = dutSparams(r.cfg.dut, f);
  const out = { extraCableLossDb: null, antennaVswr: null, antennaMismatchDb: null, antennaExtraLossDb: null, returnLossDb: returnLossDbFromGamma(bad.s11[0]),
    dcWarning: r.warnings.length > 0, notes: r.fault.link, flag: 'U' };
  if (ideal.s21 && bad.s21) out.extraCableLossDb = Math.max(0, magDb(ideal.s21[0]) - magDb(bad.s21[0]));
  if (dut.type === 'antenna') {
    out.antennaVswr = vswrFromGamma(bad.s11[0]); out.antennaMismatchDb = mismatchLossDbFromGamma(bad.s11[0]);
    const effIdeal = ideal.info ? ideal.info.efficiencyDb : 0, effBad = bad.info ? bad.info.efficiencyDb : 0;
    out.antennaExtraLossDb = Math.max(0, effIdeal - effBad + out.antennaMismatchDb - mismatchLossDbFromGamma(ideal.s11[0]));
  }
  return out;
}
