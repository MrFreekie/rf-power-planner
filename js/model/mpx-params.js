// FM MPX stereo link parameters and presets. Pure constants (no DOM, no functions of state).
// Units: kHz for frequencies and bandwidths unless the name says Hz, dB for ratios, dBm for levels.
//
// Everything here is GENERIC and ILLUSTRATIVE. It models a textbook FM multiplex stereo link
// (ITU-R BS.450 style: 19 kHz pilot, 38 kHz DSB-SC L-R). Real in-ear-monitor systems differ:
// many use proprietary pilot frequencies, companding, pre-emphasis curves, different deviations,
// or digital links with no MPX at all. The preset values are not a description of any product.
//
// Sources (see docs/PHYSICS-MPX.md for the derivations):
//  - ITU-R BS.450 (FM sound broadcasting transmission standards: pilot 19 kHz, 38 kHz subcarrier,
//    pilot injection 8 to 10 percent, 75 kHz peak deviation in the Americas and 50 kHz elsewhere).
//  - Standard FM / communications texts: Carson bandwidth, FM threshold near 10 to 12 dB CNR,
//    output SNR = (3/2) beta^2 * CNR_audio for tone modulation (e.g. Haykin, Communication Systems;
//    Taub and Schilling, Principles of Communication Systems).
//  - Standard FM stereo noise result: with triangular FM noise density the L-R channel, centred on
//    38 kHz, is 20 to 23 dB noisier than L+R (e.g. Crosby 1960s stereo analyses, broadcast engineering texts).

// kT at 290 K, dBm per Hz (-173.98, rounded). Thermal noise = this + 10 log10(B_Hz).
export const THERMAL_NOISE_DBM_PER_HZ = -174;

// Structural constants of the multiplex (same for every preset).
export const MPX_STRUCTURE = {
  pilotHz: 19000,          // BS.450
  subcarrierHz: 38000,     // 2 x pilot, DSB-SC
  lPlusRLowHz: 30,         // L+R baseband, 30 Hz to 15 kHz
  lPlusRHighHz: 15000,
  lMinusRLowHz: 23000,     // L-R DSB-SC sidebands, 38 kHz +/- 15 kHz
  lMinusRHighHz: 53000,
  pilotInjectionFrac: 0.09 // 8 to 10 percent of peak deviation (BS.450); 9 percent used
};

// Defaults equal the 'iem-typical' preset (assigned below).
export const MPX_DEFAULTS = {};

const BASE = {
  id: '',
  label: '',
  illustrative: true,

  // Receiver front end.
  channelBwKhz: 200,           // IF/channel noise bandwidth. 100 to 300 kHz allowed.
  noiseFigureDb: 8,            // receiver NF; noise floor = -174 + 10log10(B) + NF

  // Modulation.
  peakDeviationKhz: 50,        // total peak deviation incl. pilot (approx)
  audioBwKhz: 15,              // L+R audio bandwidth

  // FM threshold and mono quality.
  thresholdCnrDb: 11,          // approx: threshold knee 10 to 12 dB CNR in the channel bandwidth
  belowThresholdSlope: 3,      // approx: output SNR falls this many dB per dB of CNR below threshold
  snrCeilingDb: 80,            // approx: audio chain/DAC/noise floor limit; no companding modelled

  // Stereo penalty: L-R is this much worse in SNR than L+R at the same CNR.
  stereoPenaltyDb: 21,         // approx: 20 to 23 dB published

  // Stereo-to-mono blend (smoothstep between the two CNRs; blend 1 = full stereo, 0 = mono).
  blendStartCnrDb: 30,         // at or above: full stereo
  blendEndCnrDb: 18,           // at or below: mono
  maxSeparationDb: 35,         // approx: decoder separation at full stereo, good signal

  // Pilot detection (hysteresis: detect on at pilotDetectCnrDb, lost below pilotLoseCnrDb).
  pilotDetectCnrDb: 16,        // approx: design value, pilot lock threshold
  pilotLoseCnrDb: 13,

  // Pilot-tone squelch (mutes when the pilot is not detected). Distinct from carrier squelch (dBm).
  pilotSquelchEnabled: false,

  // FM capture: the C/I at which the weaker co-channel signal is suppressed by 30 dB (approx; good receivers 1 to 3 dB).
  captureRatioDb: 3
};

// FM improvement over CNR in the channel bandwidth for tone modulation:
//   SNR_audio = (3/2) beta^2 (B / W) CNR_B, beta = peak deviation / W   (Haykin; Taub and Schilling).
// Returned in dB. Uses the channel bandwidth B, which is at least the Carson bandwidth.
export function fmImprovementDb(peakDeviationKhz, audioBwKhz, channelBwKhz) {
  const beta = peakDeviationKhz / audioBwKhz;
  return 10 * Math.log10(1.5 * beta * beta * (channelBwKhz / audioBwKhz));
}

// Adds the aliases the model (mpx.js) reads, so presets and the model cannot disagree.
function make(over) {
  const p = { ...BASE, ...over };
  p.bandwidthHz = p.channelBwKhz * 1000;
  p.pilotHysteresisDb = p.pilotDetectCnrDb - p.pilotLoseCnrDb;
  p.pilotInjection = MPX_STRUCTURE.pilotInjectionFrac;
  p.fmImprovementDb = Math.round(fmImprovementDb(p.peakDeviationKhz, p.audioBwKhz, p.channelBwKhz) * 10) / 10;
  return Object.freeze(p);
}

export const MPX_PRESETS = Object.freeze({
  // Conservative: switches to mono early, protects the listener from hiss in the L-R channel.
  'broadcast-like': make({
    id: 'broadcast-like',
    label: 'Broadcast-like (conservative, illustrative)',
    channelBwKhz: 200,
    noiseFigureDb: 7,
    peakDeviationKhz: 75,
    audioBwKhz: 15,
    thresholdCnrDb: 12,
    snrCeilingDb: 70,
    stereoPenaltyDb: 22,
    captureRatioDb: 1.5,
    blendStartCnrDb: 36,
    blendEndCnrDb: 24,
    maxSeparationDb: 40,
    pilotDetectCnrDb: 18,
    pilotLoseCnrDb: 14
  }),
  // A generic narrower-deviation personal monitor link.
  'iem-typical': make({
    id: 'iem-typical',
    label: 'IEM typical (illustrative)'
  }),
  // Wider channel, wider deviation: more FM improvement, 1.8 dB more noise, same threshold CNR.
  'iem-wideband': make({
    id: 'iem-wideband',
    label: 'IEM wideband (illustrative)',
    captureRatioDb: 2,
    channelBwKhz: 300,
    noiseFigureDb: 9,
    peakDeviationKhz: 75,
    snrCeilingDb: 85,
    blendStartCnrDb: 32,
    blendEndCnrDb: 20,
    maxSeparationDb: 40,
    pilotDetectCnrDb: 17,
    pilotLoseCnrDb: 14
  })
});

Object.assign(MPX_DEFAULTS, MPX_PRESETS['iem-typical']);
Object.freeze(MPX_DEFAULTS);

// Allowed ranges for UI sliders and validation.
export const MPX_RANGES = Object.freeze({
  channelBwKhz: [100, 300],
  noiseFigureDb: [3, 15],
  peakDeviationKhz: [30, 100],
  audioBwKhz: [10, 20],
  thresholdCnrDb: [8, 14],
  stereoPenaltyDb: [18, 25],
  blendStartCnrDb: [15, 50],
  blendEndCnrDb: [5, 45],
  captureRatioDb: [1, 6]
});

// ---- Co-channel interference and FM capture ----------------------------------------------------------------------
// Capture ratio: good FM receivers 1 to 3 dB, poor ones up to 6 to 10 dB (approx; broadcast tuner literature, e.g. Taub and
// Schilling, and receiver test conventions where the capture ratio is the C/I giving 30 dB suppression of the weaker signal).
// Wanted-to-interferer audio ratio S(C/I) (approx, odd symmetric): 0 dB at C/I = 0 (neither dominates), 30 dB at the capture
// ratio, then about 1 dB per dB (the weaker signal keeps being suppressed as the stronger one grows).
export const INTERFERER_PARAMS = Object.freeze({
  captureRatioDb: Object.freeze({ good: 1.5, typical: 3, poor: 6 }),
  suppressionAtCaptureDb: 30,
  suppressionSlopeAboveCapture: 1,        // dB of audio ratio per dB of C/I beyond the capture ratio
  // Behaviour of a stray unmodulated or pilotless carrier at the same frequency (illustrative).
  strayCarrier: Object.freeze({
    carrierSquelchOpens: true,            // carrier squelch only sees total RF level, so any carrier above threshold opens it
    pilotSquelchOpensWhenInterfererCaptures: false,   // it has no 19 kHz pilot; the receiver loses lock and mutes
    pilotSquelchOpensWhenWantedCaptures: true         // the wanted pilot is intact once the wanted signal captures
  })
});

/** Wanted-to-interferer audio ratio in dB for a C/I (dB), odd symmetric about 0. Positive = wanted dominates. */
export function captureSuppressionDb(ciDb, captureRatioDb = INTERFERER_PARAMS.captureRatioDb.typical) {
  const a = Math.abs(ciDb);
  const cap = Math.max(1e-6, captureRatioDb);
  const s = a <= cap ? (INTERFERER_PARAMS.suppressionAtCaptureDb * a) / cap
    : INTERFERER_PARAMS.suppressionAtCaptureDb + INTERFERER_PARAMS.suppressionSlopeAboveCapture * (a - cap);
  return ciDb < 0 ? -s : s;
}
