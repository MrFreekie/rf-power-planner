// Receiver overload model: soft-knee gain compression, 3rd-order intermodulation, desensitisation.
// Pure module (no DOM). Levels are dBm at the receiver input (inputPowerDbm from solveLink).
//
// Parameters come from rx-params.js when present (RX_PRESETS); the constants below are used for
// any field that is missing.

import { cascadeChainIip3Dbm, chainItemLossDb } from './rf.js';

let PARAMS = {};
try { PARAMS = await import('./rx-params.js'); } catch { PARAMS = {}; }

const FALLBACK = {
  sensitivityDbm: -90, // AGC runs from sensitivity to sensitivity + agcRangeDb
  maxInputDbm: -10, // absolute maximum input before damage / hard clipping
  p1dBDbm: -15, // input level at which gain is compressed by 1 dB
  iip3Dbm: -5, // input-referred third-order intercept
  agcRangeDb: 30, // gain reduction available from the AGC
  overloadHysteresisDb: 2,
  noiseFigureDb: 8,
  bandwidthHz: 200000,
  maxDesenseDb: 40, // no front end loses more sensitivity than this before it is simply blocked
  hotMarginDb: 10, // 'hot' begins this far below P1dB (compression starts about here)
};

function baseConfig() {
  if (PARAMS.RX_DEFAULTS && typeof PARAMS.RX_DEFAULTS === "object") return PARAMS.RX_DEFAULTS;
  const presets = PARAMS.RX_PRESETS;
  if (presets && typeof presets === 'object') {
    const first = presets.default || presets.typical || Object.values(presets)[0];
    if (first && typeof first === 'object') return first;
  }
  return {};
}

function cfgOf(cfg) {
  const c = { ...FALLBACK, ...baseConfig(), ...(cfg || {}) };
  return c;
}

/** Third-order IMD product relative to each carrier, dBc, 3:1 slope: 2 * (Pin - IIP3). Negative below IIP3. */
export function imd3Dbc(inputDbm, cfg) {
  const c = cfgOf(cfg);
  return 2 * (inputDbm - c.iip3Dbm);
}

/** Absolute IM3 product level, dBm = Pin + imd3Dbc = 3 Pin - 2 IIP3 (Pin = level of each of two equal tones). */
export function imdLevelDbm(inputDbm, cfg) {
  return inputDbm + imd3Dbc(inputDbm, cfg);
}

/**
 * Gain compression, dB, soft knee: 0 below (P1dB - hotMarginDb), quadratic rise to exactly 1 dB at P1dB,
 * then 1 dB per dB beyond P1dB.
 */
export function compressionDbOf(inputDbm, cfg) {
  const c = cfgOf(cfg);
  const x = inputDbm - (c.p1dBDbm - c.hotMarginDb);
  if (!(x > 0)) return 0;
  if (x <= c.hotMarginDb) return Math.pow(x / c.hotMarginDb, 2);
  return 1 + (x - c.hotMarginDb);
}

/**
 * overloadStep(prevState, inputDbm, cfg) -> { level, headroomDb, compressionDb, distortionPct, agcAttenDb, desenseDb }
 *  level: 'ok' below P1dB - hotMargin; 'hot' from there to the overload point; 'overload' at or above
 *         min(P1dB, maxInputDbm). Leaving a level needs the input to drop overloadHysteresisDb below its entry threshold.
 *  headroomDb = min(P1dB, maxInput) - input (negative once overloaded).
 *  distortionPct = 100 * r / sqrt(1 + r^2), r = 10^(IM3dBc / 20). This is TWO-CARRIER IM3: the amplitude of the
 *              third-order product relative to one of two equal carriers, not the distortion of one FM carrier.
 *              The saturation law is smooth, equals r for small r (r = 0.1 -> 9.95 %) and tends to 100 % but never
 *              exceeds it (a product cannot be larger than the carriers that make it).
 *  agcAttenDb = clamp(input - sensitivityDbm, 0, agcRangeDb): AGC gain reduction, the AGC runs from sensitivity to
 *              sensitivity + agcRangeDb. agcExhausted = input beyond that range.
 *  desenseDb = 2 x compression (of the strongest carrier) + IM3 noise rise, the latter only when cfg.otherCarriersDbm lists other
 *              carriers at the input (a lone carrier makes no IM3 product on its own channel);
 *              originally: 2 x compression + IM3 noise rise 10log10(1 + 10^((IM3sat - noiseFloor)/10)): cross-compression of a
 *              weak signal by a strong one is about twice the self-compression in dB (cubic nonlinearity); the
 *              noise rise is the (saturated) IM3 product sitting in the channel. The result is capped by the smallest of
 *              (a) the blocker's excess over the noise floor (input - noiseFloor: it cannot raise the floor above
 *              itself), (b) the AGC/compression-limited loss agcAttenDb + 2 x compression, and (c) maxDesenseDb
 *              (default 40 dB). Sensitivity loss for a weak wanted signal.
 * Receive chain: cfg.chain (items ahead of the receiver, with cfg.freqMHz, default 600) makes distortion and desense use the
 * cascaded IIP3 (cascadeChainIip3Dbm: a preamp lowers it, a pad raises it) referred to the receiver input, i.e. the antenna-
 * referred cascade plus the net chain gain; inputDbm stays the level at the receiver input. P1dB is not cascaded.
 * prevState may be null, a level string or { level }.
 */
export function overloadStep(prevState, inputDbm, cfg) {
  const c = cfgOf(cfg);
  const prev = typeof prevState === 'string' ? prevState : prevState && prevState.level;
  const rank = { ok: 0, hot: 1, overload: 2 };
  const level = Number.isFinite(inputDbm) ? inputDbm : -Infinity;
  const overT = Math.min(c.p1dBDbm, c.maxInputDbm);
  const hotT = Math.min(c.p1dBDbm - c.hotMarginDb, overT);
  const h = Math.max(0, c.overloadHysteresisDb || 0);
  const p = rank[prev] ?? 0;
  let r;
  if (p === 2) r = level >= overT - h ? 2 : level >= hotT - h ? 1 : 0;
  else if (p === 1) r = level >= overT ? 2 : level >= hotT - h ? 1 : 0;
  else r = level >= overT ? 2 : level >= hotT ? 1 : 0;
  const name = ['ok', 'hot', 'overload'][r];

  const finite = Number.isFinite(level);
  const compressionDb = finite ? compressionDbOf(level, c) : 0;
  let iip3 = c.iip3Dbm;
  if (Array.isArray(c.chain) && c.chain.length) {
    const f = Number.isFinite(c.freqMHz) ? c.freqMHz : 600;
    iip3 = cascadeChainIip3Dbm(c.chain, c.iip3Dbm, f) - c.chain.reduce((acc, it) => acc + chainItemLossDb(it, f), 0);
  }
  const dbc = 2 * (level - iip3);
  const ratio = Math.pow(10, dbc / 20);
  const distortionPct = finite ? 100 * ratio / Math.sqrt(1 + ratio * ratio) : 0;
  const agcAttenDb = finite ? Math.min(c.agcRangeDb, Math.max(0, level - c.sensitivityDbm)) : 0;
  const agcExhausted = finite && level > c.sensitivityDbm + c.agcRangeDb;
  const noiseFloor = -174 + 10 * Math.log10(c.bandwidthHz) + c.noiseFigureDb;
  // IM3 desense needs a SECOND carrier: a lone carrier makes no in-band IM3 product at its own frequency. Other carriers at the
  // receiver input (dBm, from the scene IMD tones) are passed as cfg.otherCarriersDbm; the worst product 2 f_a - f_b of the
  // two strongest tones of {wanted, others} is 2 Pa + Pb - 2 IIP3 (3:1 slope), saturated so it never exceeds its carriers.
  const others = Array.isArray(c.otherCarriersDbm) ? c.otherCarriersDbm.filter(Number.isFinite) : [];
  let imNoiseRiseDb = 0;
  if (finite && others.length) {
    const all = [level, ...others].sort((a, b) => b - a).slice(0, 2);
    const prod = Math.max(2 * all[0] + all[1], 2 * all[1] + all[0]) - 2 * iip3;
    const imdLevel = Math.min(prod, all[1]); // saturated: never above a carrier
    imNoiseRiseDb = 10 * Math.log10(1 + Math.pow(10, (imdLevel - noiseFloor) / 10));
  }
  const worst = finite ? Math.max(level, ...others) : -Infinity;
  const compWorst = finite ? compressionDbOf(worst, c) : 0;
  const rawDesense = 2 * compWorst + imNoiseRiseDb;
  const desenseDb = finite
    ? Math.max(0, Math.min(rawDesense, worst - noiseFloor, agcAttenDb + 2 * compWorst, c.maxDesenseDb))
    : 0;
  return { level: name, headroomDb: overT - level, compressionDb, distortionPct, agcAttenDb, agcExhausted, desenseDb };
}
