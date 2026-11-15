// Digital versus analogue link behaviour at the receiver input. Pure module, no DOM. Illustrative, not a product model.
//
// Builds on digital.js (BER, FEC cliff, frame error rate, concealment) and mpx.js (FM audio SNR with its threshold). It adds the link-level view the
// examples and the GUI need:
//   occupied bandwidth   analogue FM by Carson's rule B = 2 (deviation + fmax) (Carson; Haykin); digital = the preset channel bandwidth (the symbol rate
//                        times (1 + roll-off) fits in it, preset.channelBwKHz)
//   FM threshold         analogue: below about thresholdCnrDb (11 dB, mpx.js, approx) the improvement collapses and clicks dominate (Rice / Taub and Schilling);
//                        audio SNR keeps falling gradually, about 3 dB per dB, never an abrupt drop
//   digital cliff        digital has no FM-threshold knee: it is clean (FER under 1e-3) down to the FEC cliff, then the frame error rate rises within a few dB:
//                        degradedCnrDb (FER 1e-3), concealCnrDb (FER 5 percent, the decoder starts repeating frames), downCnrDb (FER 90 percent, mute).
//                        cliffWidthDb = degradedCnrDb - downCnrDb. Found by bisection on the model's own FER, so it always agrees with digitalLinkState.
// The RF noise floor is the digital preset's (-174 + 10 log10(noiseBw) + NF); the analogue figures use the same floor so both modes are compared at the same
// input level. All figures are illustrative (flag U): the preset thresholds are approximations and vendors publish no constellation or FEC.
import { digitalLinkState } from './digital.js';
import { audioSnrDb } from './mpx.js';
import { DIGITAL_PRESETS, DIGITAL_DEFAULTS } from './digital-params.js';

export const FM_DEFAULT_DEVIATION_KHZ = 40; // flag I: a mic-class peak deviation (fm-deviation.js lists the classes)
export const FM_DEFAULT_AUDIO_KHZ = 15;     // flag A
export const FM_THRESHOLD_CNR_DB = 11;      // flag I: mpx.js default (threshold knee 10 to 12 dB)

/** digitalConfigOf(link) -> merged digital parameters (preset, then link.modulation.digital.overrides, then the link's fixedOrder). Same rule as digitalTracker.js. */
export function digitalConfigOf(link) {
  const d = (link && link.modulation && link.modulation.digital) || {};
  const base = (typeof d.preset === 'string' && Object.prototype.hasOwnProperty.call(DIGITAL_PRESETS, d.preset) && DIGITAL_PRESETS[d.preset]) || DIGITAL_DEFAULTS; // own keys only: 'constructor' or '__proto__' must not resolve
  const cfg = { ...base, ...(d.overrides || {}) };
  cfg.fixedOrder = d.fixedOrder || base.fixedOrder || null;
  return cfg;
}

/** analogOccupiedBwKHz(deviationKHz, audioKHz) -> Carson bandwidth, kHz. Default +-40 kHz and 15 kHz gives 110 kHz. */
export const analogOccupiedBwKHz = (deviationKHz = FM_DEFAULT_DEVIATION_KHZ, audioKHz = FM_DEFAULT_AUDIO_KHZ) => 2 * (deviationKHz + audioKHz);

/** noiseFloorDbm(cfg) -> receiver noise floor of the digital preset, dBm (kTB over the channel plus noise figure). */
export const noiseFloorDbm = (cfg) => -174 + 10 * Math.log10(cfg.noiseBwKHz * 1000) + cfg.noiseFigureDb;

// Frame error rate at a CNR for the weakest allowed order (the order a link ends on before it fails), stateless.
function ferAt(cfg, cnrDb) {
  const orders = (cfg.allowedModulations || [cfg.fixedOrder || 4]).slice().sort((a, b) => a - b);
  const c = { ...cfg, fixedOrder: orders[0] };
  return digitalLinkState(noiseFloorDbm(c) + cnrDb, c, null, 0).frameErrorRate;
}
// CNR (dB) at which the FER crosses `target` (FER falls with CNR): bisection on [-10, 60].
function cnrForFer(cfg, target) {
  let lo = -10, hi = 60;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (ferAt(cfg, m) > target) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/**
 * digitalProfile(cfg) -> { occupiedBwKHz, noiseFloorDbm, degradedCnrDb, concealCnrDb, downCnrDb, cliffWidthDb,
 *   degradedInputDbm, concealInputDbm, downInputDbm, spectralEfficiency (information bit/s per Hz) }
 */
export function digitalProfile(cfg) {
  const key = profileKey(cfg), hit = PROFILE_CACHE.get(key);
  if (hit) return hit;
  const out = computeProfile(cfg);
  if (PROFILE_CACHE.size > 64) PROFILE_CACHE.clear();
  PROFILE_CACHE.set(key, out);
  return out;
}
// The bisection costs 180 model evaluations: memoised on the figures that decide it (a profile object is shared, treat it as read-only).
const PROFILE_CACHE = new Map();
const profileKey = (c) => JSON.stringify([c.noiseBwKHz, c.noiseFigureDb, c.symbolRateKSps, c.codeRate, c.implLossDb, c.frameBits, c.preFecCliffBer, c.cliffSharpness, c.postFecFloor, c.allowedModulations, c.fixedOrder, c.degradedFer, c.concealFer, c.muteFer, c.amcThresholdsDb]);
function computeProfile(cfg) {
  const floor = noiseFloorDbm(cfg);
  const degradedCnrDb = cnrForFer(cfg, cfg.degradedFer ?? 1e-3), concealCnrDb = cnrForFer(cfg, cfg.concealFer ?? 0.05), downCnrDb = cnrForFer(cfg, cfg.muteFer ?? 0.9);
  const orders = (cfg.allowedModulations || [cfg.fixedOrder || 4]);
  const k = Math.log2(Math.max(...orders));
  return {
    occupiedBwKHz: cfg.noiseBwKHz, noiseFloorDbm: floor, degradedCnrDb, concealCnrDb, downCnrDb, cliffWidthDb: degradedCnrDb - downCnrDb,
    degradedInputDbm: floor + degradedCnrDb, concealInputDbm: floor + concealCnrDb, downInputDbm: floor + downCnrDb,
    spectralEfficiency: (cfg.symbolRateKSps * k * cfg.codeRate) / cfg.noiseBwKHz,
  };
}

/**
 * modeReport(inputDbm, link, { deviationKHz, audioKHz }) -> both modes at the same receiver input level (dBm):
 *   analog:  { occupiedBwKHz, cnrDb, thresholdCnrDb, thresholdMarginDb, audioSnrDb, quality (0..100, as analogVsDigitalCurve), usable (audio SNR >= 30 dB) }
 *   digital: { occupiedBwKHz, cnrDb, order, state, frameErrorRate, quality (100 (1 - FER)), concealMarginDb (CNR above the 5 percent FER point), cliff: digitalProfile }
 * `usable` for the analogue mode is a stated convention (30 dB audio SNR, flag U), not a standard.
 */
export function modeReport(inputDbm, link, { deviationKHz = FM_DEFAULT_DEVIATION_KHZ, audioKHz = FM_DEFAULT_AUDIO_KHZ, usableAudioSnrDb = 30 } = {}) {
  const cfg = digitalConfigOf(link);
  const prof = digitalProfile(cfg);
  const cnr = inputDbm - prof.noiseFloorDbm;
  const snr = audioSnrDb(cnr, { stereo: false });
  const st = digitalLinkState(inputDbm, cfg, null, 0);
  const q = (x) => Math.max(0, Math.min(100, x));
  return {
    inputDbm, cnrDb: cnr,
    analog: {
      occupiedBwKHz: analogOccupiedBwKHz(deviationKHz, audioKHz), cnrDb: cnr, thresholdCnrDb: FM_THRESHOLD_CNR_DB, thresholdMarginDb: cnr - FM_THRESHOLD_CNR_DB,
      audioSnrDb: snr, quality: q(100 * ((snr - 10) / 50)), usable: snr >= usableAudioSnrDb,
    },
    digital: {
      occupiedBwKHz: prof.occupiedBwKHz, cnrDb: cnr, order: st.order, state: st.state, frameErrorRate: st.frameErrorRate, quality: q(100 * (1 - st.frameErrorRate)),
      concealMarginDb: cnr - prof.concealCnrDb, cliff: prof,
    },
  };
}
