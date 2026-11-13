// FM stereo multiplex (MPX) demonstration model. Pure module (no DOM, no randomness).
//
// Composite baseband (what the stereo decoder sees after the FM discriminator):
//   0.03-15 kHz  L+R (mono compatible)
//   19 kHz       pilot tone (nominally 8-10 % injection)
//   23-53 kHz    L-R as DSB-SC around the suppressed 38 kHz sub-carrier
// FM noise at the discriminator output has a triangular spectrum (density rises 6 dB/octave,
// i.e. proportional to f in amplitude), so the L-R band sits in noise 8 dB worse than the top of
// the L+R band and the receiver sheds stereo first.

import { MPX_DEFAULTS } from './mpx-params.js';
import { captureState } from './interferer.js';

// Used only to back-fill fields missing from the supplied config.
const FALLBACK = {
  bandwidthHz: 200000,
  noiseFigureDb: 8,
  thresholdCnrDb: 12,
  blendStartCnrDb: 30,
  blendEndCnrDb: 18,
  pilotDetectCnrDb: 14,
  pilotHysteresisDb: 2,
  pilotInjection: 0.09,
  fmImprovementDb: 26.5, // 10log10(3*b^2*(b+1)), b=5 (75 kHz deviation, 15 kHz audio)
  stereoPenaltyDb: 22, // L-R noise penalty for stereo versus mono (triangular noise, 38 kHz band)
  maxSeparationDb: 40,
};

// Merge fallbacks, the shared defaults and the caller's config, then derive the fields this module
// uses from the parameter file's names: channelBwKhz -> bandwidthHz, pilotDetect - pilotLose ->
// pilotHysteresisDb, belowThresholdSlope -> rolloff, peakDeviationKhz/audioBwKhz -> FM improvement.
function cfgOf(cfg) {
  const raw = { ...(MPX_DEFAULTS || {}), ...(cfg || {}) };
  const c = { ...FALLBACK, ...raw };
  if (raw.bandwidthHz === undefined && Number.isFinite(raw.channelBwKhz)) c.bandwidthHz = raw.channelBwKhz * 1000;
  if (raw.pilotHysteresisDb === undefined && Number.isFinite(raw.pilotLoseCnrDb)) {
    c.pilotHysteresisDb = Math.max(0, c.pilotDetectCnrDb - raw.pilotLoseCnrDb);
  }
  if (raw.pilotInjection === undefined) c.pilotInjection = FALLBACK.pilotInjection;
  if (raw.fmImprovementDb === undefined && raw.peakDeviationKhz > 0 && raw.audioBwKhz > 0) {
    // textbook wideband FM improvement for tone modulation: 3 beta^2 (beta + 1), beta = dev / fmax
    const beta = raw.peakDeviationKhz / raw.audioBwKhz;
    c.fmImprovementDb = 10 * Math.log10(3 * beta * beta * (beta + 1));
  }
  c.belowThresholdSlope = Number.isFinite(raw.belowThresholdSlope) ? raw.belowThresholdSlope : 3;
  c.snrCeilingDb = Number.isFinite(raw.snrCeilingDb) ? raw.snrCeilingDb : Infinity;
  return c;
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const fin = (x, d) => (Number.isFinite(x) ? x : d);
const SPECTRUM_FLOOR_DB = -120;

/** Thermal noise floor, dBm: kTB (-174 dBm/Hz + 10log10(B)) plus receiver noise figure. */
export function noiseFloorDbm(cfg = {}) {
  const c = cfgOf(cfg);
  return -174 + 10 * Math.log10(c.bandwidthHz) + c.noiseFigureDb;
}

/** Carrier-to-noise ratio at the IF, dB = input level - noise floor. Non-finite input -> -Infinity. */
export function cnrDb(inputDbm, cfg) {
  if (!Number.isFinite(inputDbm)) return -Infinity;
  return inputDbm - noiseFloorDbm(cfgOf(cfg));
}

/**
 * Stereo blend factor 0..1 (1 = full stereo, 0 = mono). Smoothstep in CNR between
 * blendEndCnrDb (0) and blendStartCnrDb (1): t = clamp((cnr-end)/(start-end)), blend = t^2 (3 - 2t).
 */
export function stereoBlend(cnr, cfg = {}) {
  const c = cfgOf(cfg);
  if (!Number.isFinite(cnr)) return cnr > 0 ? 1 : 0;
  const span = c.blendStartCnrDb - c.blendEndCnrDb;
  if (!(span > 0)) return cnr >= c.blendStartCnrDb ? 1 : 0;
  const t = clamp01((cnr - c.blendEndCnrDb) / span);
  return t * t * (3 - 2 * t);
}

/**
 * Left/right fraction of L that bleeds into R. The decoder outputs
 *   r' = b*r + (1-b)*(l+r)/2  ->  L reaches R with amplitude (1-b)/2 (0 at full stereo, 0.5 at mono).
 */
export function lrLeakOf(blend) {
  return (1 - clamp01(blend)) / 2;
}

/**
 * Channel separation, dB. Law: the wanted channel has amplitude (1+b)/2 and the unwanted one
 * (1-b)/2 + x, where x = 10^(-sepMax/20) is the residual decoder crosstalk and
 * sepMax = min(maxSeparationDb, cnr + 10) (noise limits separation at low CNR).
 *   sep = 20log10( ((1+b)/2) / ((1-b)/2 + x) ), floored at 0 dB.
 * Roughly 40 dB when blend = 1 at healthy CNR, 0 dB at blend = 0 (mono: L and R identical).
 */
export function stereoSeparationDb(blend, cnr, cfg) {
  const c = cfgOf(cfg);
  const b = clamp01(blend);
  const sepMax = Math.min(c.maxSeparationDb, fin(cnr, -Infinity) + 10);
  const x = Math.pow(10, -Math.max(sepMax, 0) / 20);
  const sep = 20 * Math.log10(((1 + b) / 2) / ((1 - b) / 2 + x));
  return Math.max(0, sep);
}

/**
 * Demodulated audio SNR, dB.
 *   Above threshold: SNR = CNR + I, I = fmImprovementDb (FM improvement, ~26.5 dB for beta = 5).
 *   Below threshold (CNR < T): improvement collapses as clicks dominate. SNR = CNR + I - 2 (T - CNR),
 *   i.e. belowThresholdSlope (default 3) dB of audio SNR per dB of CNR, never below CNR - 3 dB.
 *   The result is capped at snrCeilingDb (audio chain limit) before the stereo penalty.
 *   Stereo penalty: L-R noise is ~stereoPenaltyDb worse than mono; it fades in with blend:
 *   SNR_stereo = SNR_mono - 10log10(1 + b^2 (10^(p/10) - 1)). Mono (stereo=false) has no penalty.
 * opts also accepts thresholdCnrDb, fmImprovementDb, stereoPenaltyDb overrides.
 */
export function audioSnrDb(cnr, opts = {}) {
  const c = cfgOf(opts);
  if (!Number.isFinite(cnr)) return -Infinity;
  let snr = cnr + c.fmImprovementDb;
  if (cnr < c.thresholdCnrDb) {
    snr -= (c.belowThresholdSlope - 1) * (c.thresholdCnrDb - cnr);
    snr = Math.max(snr, cnr - 3);
  }
  const b = opts.blend === undefined ? 1 : clamp01(opts.blend);
  snr = Math.min(snr, c.snrCeilingDb); // audio chain ceiling
  // penalty in the power domain: noise powers add, L-R noise weight b^2:
  //   penalty_dB = 10log10(1 + b^2 (10^(p/10) - 1))  (b = 0.5, p = 22 -> about 17.9 dB)
  if (opts.stereo) snr -= 10 * Math.log10(1 + b * b * (Math.pow(10, c.stereoPenaltyDb / 10) - 1));
  return snr;
}

/**
 * Pilot detector with hysteresis (cf. squelchState). Locks at cnr >= pilotDetectCnrDb, holds until
 * cnr < pilotDetectCnrDb - pilotHysteresisDb. marginDb = cnr - pilotDetectCnrDb.
 */
export function pilotStep(prevLocked, cnr, cfg) {
  const c = cfgOf(cfg);
  const level = Number.isFinite(cnr) ? cnr : -Infinity;
  const hyst = Math.max(0, c.pilotHysteresisDb || 0);
  const locked = prevLocked ? level >= c.pilotDetectCnrDb - hyst : level >= c.pilotDetectCnrDb;
  return { locked, marginDb: level - c.pilotDetectCnrDb };
}

/**
 * Whole demonstration state for one input level. `prev` is the previous result (or {pilotLocked}).
 * Without a locked pilot the decoder is mono, so the effective blend is 0.
 * pilotLevelDb: pilot level in the composite, dB relative to 100 % modulation = 20log10(injection)
 * while locked, SPECTRUM_FLOOR (-120) when the decoder has lost it.
 */
export function mpxState(inputDbm, cfg, prev, { pilotPresent = true, interferer = null } = {}) {
  const c = cfgOf(cfg);
  // Optional stray co-channel interferer { dbm, pilotPresent = false, captureRatioDb (default: the preset's) }: the carrier (and so the carrier
  // squelch) sees the stronger of the two; the pilot belongs to whoever captures the demodulator. A pilotless interferer that
  // captures (or a beat with no capture) removes the pilot: mono, and muted when pilot squelch is on, while the carrier
  // squelch stays open. The result then also carries { captured, cirDb, audioQuality, carrierLevelDbm }.
  const ifr = interferer && Number.isFinite(interferer.dbm) ? interferer : null;
  // capture ratio: the interferer's own value, else the receiver preset's captureRatioDb, else the 3 dB default
  const cap = ifr ? captureState(inputDbm, ifr.dbm, { captureRatioDb: Number.isFinite(ifr.captureRatioDb) ? ifr.captureRatioDb : Number.isFinite(c.captureRatioDb) ? c.captureRatioDb : undefined }) : null;
  if (cap) {
    pilotPresent = cap.captured === 'wanted' ? pilotPresent : cap.captured === 'interferer' ? ifr.pilotPresent === true : false;
  }
  const cnr = cnrDb(cap ? cap.carrierLevelDbm : inputDbm, c);
  // pilotPresent=false models an interfering carrier with no pilot: it can never lock.
  const pilot = pilotPresent
    ? pilotStep(!!(prev && prev.pilotLocked), cnr, c)
    : { locked: false, marginDb: -Infinity };
  const rawBlend = stereoBlend(cnr, c);
  const blend = pilot.locked ? rawBlend : 0;
  const mode = blend >= 0.999 ? 'stereo' : blend > 0 ? 'blend' : 'mono';
  const inj = Math.max(fin(c.pilotInjection, 0.09), 1e-6); // fraction of peak deviation (params: 9 %)
  let snr = audioSnrDb(cnr, { ...c, stereo: pilot.locked, blend });
  // FM suppression of a weaker co-channel signal is about 20 dB beyond the carrier ratio (approx): the audio SNR cannot beat it.
  if (cap) snr = Math.min(snr, cap.cirDb + 20);
  return {
    ...(cap ? { captured: cap.captured, cirDb: cap.cirDb, audioQuality: cap.audioQuality, carrierLevelDbm: cap.carrierLevelDbm } : {}),
    cnrDb: cnr,
    blend,
    mode,
    separationDb: stereoSeparationDb(blend, cnr, c),
    pilotLocked: pilot.locked,
    pilotMarginDb: pilot.marginDb,
    pilotLevelDb: pilot.locked ? 20 * Math.log10(inj) : SPECTRUM_FLOOR_DB,
    audioSnrDb: snr,
    lrLeak: lrLeakOf(blend),
    muted: !!c.pilotSquelchEnabled && !pilot.locked,
  };
}

const pwr = (db) => Math.pow(10, db / 10);
const dbOf = (p) => (p > 1e-12 ? 10 * Math.log10(p) : SPECTRUM_FLOOR_DB);

// Soft-edged band indicator: 1 inside [a,b], ramping to 0 over `edge` kHz outside.
function band(f, a, b, edge) {
  if (f >= a && f <= b) return 1;
  const d = f < a ? a - f : f - b;
  return d >= edge ? 0 : 0.5 * (1 + Math.cos(Math.PI * d / edge));
}

/**
 * Display spectrum of the composite signal. Levels in dB relative to 100 % modulation.
 *   L+R: -8 dB with a gentle 0 to -2 dB tilt across 0.03-15 kHz.
 *   Pilot: single spike at exactly 19 kHz (grid is snapped so a bin sits at 19), level pilotLevelDb.
 *   L-R: DSB-SC, -12 dB + 20log10(blend), mirrored tilt about 38 kHz, 23-53 kHz.
 *   Noise: -8 dB - CNR + 20log10(f/15 kHz) (triangular FM noise), so L-R is 8 dB deeper in noise
 *   than the top of L+R and drowns first. levelDb = power sum of signals and noise; noiseDb alone.
 * Deterministic. `seed` (number) adds +/-0.4 dB ripple on the noise only.
 */
export function mpxSpectrum(state, opts = {}) {
  const { points = 256, seed } = opts;
  // Optional telemetry subcarrier above the MPX band: opts or state may give dataKHz, dataLocked,
  // dataInjection (fraction of deviation, default 0.05) and dataHalfWidthKHz (default 1.5). The band is drawn at
  // 20log10(injection) while locked and not at all otherwise. Without dataKHz the output is unchanged.
  const dataKHz = Number.isFinite(opts.dataKHz) ? opts.dataKHz : state && Number.isFinite(state.dataKHz) ? state.dataKHz : null;
  const maxKHz = Number.isFinite(opts.maxKHz) ? opts.maxKHz : dataKHz !== null ? Math.max(60, dataKHz + 8) : 60;
  const dataLocked = opts.dataLocked !== undefined ? !!opts.dataLocked : !!(state && state.dataLocked);
  const dataInj = fin(opts.dataInjection !== undefined ? opts.dataInjection : state && state.dataInjection, 0.05);
  const dataHalf = fin(opts.dataHalfWidthKHz, 1.5);
  const dataDb = dataKHz !== null && dataLocked ? 20 * Math.log10(Math.max(dataInj, 1e-6)) : SPECTRUM_FLOOR_DB;
  const n = Math.max(8, Math.floor(points));
  const freqKHz = new Array(n);
  for (let i = 0; i < n; i++) freqKHz[i] = (maxKHz * i) / (n - 1);
  // snap the nearest bin to the pilot frequency
  let pilotIdx = -1;
  if (maxKHz >= 19) {
    pilotIdx = 0;
    for (let i = 1; i < n; i++) if (Math.abs(freqKHz[i] - 19) < Math.abs(freqKHz[pilotIdx] - 19)) pilotIdx = i;
    freqKHz[pilotIdx] = 19;
  }
  const cnr = fin(state && state.cnrDb, 40);
  const blend = clamp01(fin(state && state.blend, 0));
  const pilotDb = fin(state && state.pilotLevelDb, SPECTRUM_FLOOR_DB);
  const levelDb = new Array(n);
  const noiseDb = new Array(n);
  for (let i = 0; i < n; i++) {
    const f = freqKHz[i];
    let p = 0;
    // L+R baseband
    const lpr = band(f, 0.03, 15, 1);
    if (lpr > 0) p += lpr * pwr(-8 - 2 * Math.min(1, f / 15));
    // L-R DSB-SC around 38 kHz
    const lmr = band(f, 23, 53, 1);
    if (lmr > 0 && blend > 0) p += lmr * blend * blend * pwr(-12 - 2 * Math.min(1, Math.abs(f - 38) / 15));
    // pilot spike (one bin plus a narrow skirt)
    if (pilotDb > SPECTRUM_FLOOR_DB) {
      const d = Math.abs(f - 19);
      p += (i === pilotIdx ? 1 : pwr(-25 * d / 0.3 ) * 0.5) * pwr(pilotDb);
    }
    // telemetry subcarrier (narrow band, soft edges)
    if (dataKHz !== null && dataDb > SPECTRUM_FLOOR_DB) {
      p += band(f, dataKHz - dataHalf, dataKHz + dataHalf, 0.5) * pwr(dataDb);
    }
    // FM triangular noise
    let nDb = -8 - cnr + 20 * Math.log10(Math.max(f, 0.5) / 15);
    if (seed !== undefined) nDb += 0.4 * Math.sin(f * 7.3 + Number(seed) * 12.9898);
    noiseDb[i] = nDb;
    levelDb[i] = dbOf(p + pwr(nDb));
  }
  return {
    freqKHz,
    levelDb,
    noiseDb,
    bands: { lpr: [0.03, 15], pilot: 19, lmr: [23, 53] },
    pilotIndex: pilotIdx,
    // The displayed noise is the composite (pre-improvement) noise relative to the signal, NOT reduced
    // by the FM improvement that audioSnrDb includes. Kept this way so L-R visibly sinks first.
    exaggeratedNoise: true,
    ...(dataKHz !== null
      ? { dataKHz, dataBand: [dataKHz - dataHalf, dataKHz + dataHalf], dataLevelDb: dataDb, dataLocked }
      : {}),
  };
}

/** Audio the meters see: l' = b*l + (1-b)*(l+r)/2, r' = b*r + (1-b)*(l+r)/2. Blend 1 = untouched. */
export function monoBlendAudio({ l, r }, blend) {
  const b = clamp01(fin(blend, 1));
  const m = (l + r) / 2;
  return { l: b * l + (1 - b) * m, r: b * r + (1 - b) * m };
}
