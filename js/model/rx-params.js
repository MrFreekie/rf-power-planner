// Receiver front-end overload and diversity parameters. Pure constants (no DOM, no state).
// Units: dBm for levels, dB for ratios, ms for time.
//
// Everything here is GENERIC and ILLUSTRATIVE. The numbers describe a plausible class of receiver, not any
// product. Real datasheets rarely publish P1dB or IIP3; maximum input level and a "blocking" or
// "intermodulation rejection" figure are more common, so check the receiver you actually use.
//
// Sources (derivations in docs/PHYSICS-RX.md):
//  - Standard RF receiver design texts: Razavi, RF Microelectronics; Pozar, Microwave Engineering
//    (compression point, third-order intercept, cascade). For a memoryless cubic nonlinearity
//    IIP3 is about P1dB + 9.6 dB (approx).
//  - Third-order intermodulation: two equal tones at level P give IM3 at 3P - 2 IIP3 (dBm), slope 3:1.
//  - Clarke / Jakes model for spatial correlation: field correlation J0(2 pi d / lambda),
//    envelope correlation about J0^2 (Jakes, Microwave Mobile Communications).
//  - Diversity combining in Rayleigh fading: Brennan, "Linear diversity combining techniques" (1959);
//    Jakes (1974). Gains below are computed from the standard closed forms for 2 branches.

export const IM3_SLOPE = 3;                // dB of IM3 level per dB of input level (3:1)
export const IIP3_MINUS_P1DB_DB = 9.6;     // approx, memoryless cubic nonlinearity

const UHF_RX_PRESETS = Object.freeze({
  // Professional-grade true-diversity wireless microphone receiver with a filtered front end.
  'mic-receiver-typical': Object.freeze({
    id: 'mic-receiver-typical',
    label: 'Mic receiver, typical (illustrative)',
    illustrative: true,
    sensitivityDbm: -90,        // approx: matches the scene default for a mic link
    channelBwKhz: 200,          // noise bandwidth for kTB
    requiredCnrDb: 23,          // approx: sensitivity - (kTB + NF) = -90 + 113 = 23 dB
    noiseFigureDb: 8,           // approx
    agcRangeDb: 65,             // approx: AGC tops out at sensitivity + range = -25 dBm
    p1dBDbm: -18,               // approx: input-referred 1 dB compression point
    iip3Dbm: -8,                // approx: about P1dB + 10 dB
    maxInputDbm: -10,           // approx: level at which the manufacturer allows operation
    overloadHysteresisDb: 3,
    hotMarginDb: 10             // approx: "hot" warning starts this far below P1dB
  }),
  // Compact bodypack: fewer front-end resources and an antenna close to a strong transmitter.
  'iem-bodypack-typical': Object.freeze({
    id: 'iem-bodypack-typical',
    label: 'IEM bodypack, typical (illustrative)',
    illustrative: true,
    sensitivityDbm: -85,        // approx: matches the scene default for an IEM link
    channelBwKhz: 200,
    requiredCnrDb: 26,          // approx: -85 - (-174 + 53 + 10) = 26 dB
    noiseFigureDb: 10,          // approx
    agcRangeDb: 60,             // approx: AGC tops out at -25 dBm
    p1dBDbm: -22,               // approx
    iip3Dbm: -12,               // approx
    maxInputDbm: -15,           // approx
    overloadHysteresisDb: 3,
    hotMarginDb: 10             // approx: "hot" warning starts this far below P1dB
  }),
  // Low-cost receiver: less front-end linearity and less AGC range.
  'budget-receiver': Object.freeze({
    id: 'budget-receiver',
    label: 'Budget receiver (illustrative)',
    illustrative: true,
    sensitivityDbm: -85,
    channelBwKhz: 200,
    requiredCnrDb: 24,          // approx: -85 - (-174 + 53 + 12) = 24 dB
    noiseFigureDb: 12,          // approx
    agcRangeDb: 50,             // approx: AGC tops out at -35 dBm
    p1dBDbm: -28,               // approx
    iip3Dbm: -18,               // approx
    maxInputDbm: -20,           // approx
    overloadHysteresisDb: 2,
    hotMarginDb: 10             // approx: "hot" warning starts this far below P1dB
  })
});

// Band receivers from library.js BAND_PROFILES (docs/PHYSICS-BANDS.md): sensitivity = -174 + 10 log10(B) + NF + required CNR (within 1 dB).
// Overload figures are approx (a digital ISM-band receiver chip is less tolerant of strong signals than a filtered UHF mic receiver).
// Their noise bandwidth is the preset's channelBwKhz: cascadeNoise uses it unless rx.channelBwKHz is set.
const bandPreset = (id, label, sensitivityDbm, channelBwKhz, requiredCnrDb, noiseFigureDb, extra) => Object.freeze({
  id, label, illustrative: true, sensitivityDbm, channelBwKhz, requiredCnrDb, noiseFigureDb, agcRangeDb: 55, overloadHysteresisDb: 3, hotMarginDb: 10, ...extra,
});
export const BAND_RX_PRESETS = Object.freeze({
  'rx-vhf-typical': bandPreset('rx-vhf-typical', 'VHF receiver, typical (illustrative)', -91, 200, 23, 7, { p1dBDbm: -18, iip3Dbm: -8, maxInputDbm: -10 }),
  'rx-2g4-typical': bandPreset('rx-2g4-typical', '2.4 GHz receiver, typical (illustrative)', -90, 2000, 14, 7, { p1dBDbm: -20, iip3Dbm: -10, maxInputDbm: -10 }),
  'rx-5g8-typical': bandPreset('rx-5g8-typical', '5.8 GHz receiver, typical (illustrative)', -88, 2000, 14, 9, { p1dBDbm: -20, iip3Dbm: -10, maxInputDbm: -10 }),
});
export const RX_PRESETS = Object.freeze({ ...UHF_RX_PRESETS, ...BAND_RX_PRESETS });

/** Suggested receiver preset id for a link kind at a carrier: VHF below 300 MHz, 2.4 / 5.8 GHz bands, else the UHF presets. */
export function rxPresetForFreq(kind, freqMHz) {
  if (freqMHz < 300) return 'rx-vhf-typical';
  if (freqMHz >= 4000) return 'rx-5g8-typical';
  if (freqMHz >= 2000) return 'rx-2g4-typical';
  return kind === 'iem' ? 'iem-bodypack-typical' : 'mic-receiver-typical';
}

export const RX_DEFAULTS = RX_PRESETS['iem-bodypack-typical'];

// Spatial correlation of two antennas (Clarke / Jakes). Spacing in wavelengths.
export const SPACING_RULES = Object.freeze({
  fieldCorrelationFirstZeroLambda: 0.383,  // J0(x) = 0 at x = 2.405 = 2 pi d / lambda
  minUsefulSpacingLambda: 0.5,             // rule of thumb: half a wavelength or more
  recommendedSpacingLambda: 1.0
});

// Gain of a 2-branch scheme over one branch in Rayleigh fading with uncorrelated branches, dB,
// measured as the improvement of the level not exceeded with probability 1 % and 10 %.
// Selection / true diversity: P(out) = (1 - e^-x)^2. Maximal ratio: P(out) = 1 - e^-x (1 + x).
// Single branch: x = -ln(1 - P). Hand values: 1 %: 10.2 and 11.7 dB; 10 %: 5.6 and 7.0 dB.
export const DIVERSITY_PRESETS = Object.freeze({
  switching: Object.freeze({
    id: 'switching',
    mode: 'switching',         // key read by the diversity model
    label: 'Antenna switching diversity (illustrative)',
    illustrative: true,
    modeDescription: 'One receiver, two antennas. The receiver stays on one antenna and switches to the other when the level falls below a threshold. Cheapest; the switch can click and it does not always pick the better antenna.',
    branches: 2,
    combining: 'switch-and-stay',
    hysteresisDb: 3,            // approx
    switchMs: 2,                // approx: decision plus dwell, audio muted or faded around the switch
    gainAt1pctDb: 8,            // approx: below selection because the pick is not instantaneous
    gainAt10pctDb: 4.5          // approx
  }),
  true: Object.freeze({
    id: 'true',
    mode: 'true',         // key read by the diversity model
    label: 'True diversity (illustrative)',
    illustrative: true,
    modeDescription: 'Two complete receivers, one per antenna. The audio follows whichever has the stronger signal (instantaneous pick with a small hysteresis).',
    branches: 2,
    combining: 'selection',
    hysteresisDb: 2,            // approx
    switchMs: 0.5,              // approx: audio crossfade
    gainAt1pctDb: 10.2,
    gainAt10pctDb: 5.6
  }),
  ratio: Object.freeze({
    id: 'ratio',
    mode: 'ratio',         // key read by the diversity model
    label: 'Ratio / maximal-ratio combining (illustrative)',
    illustrative: true,
    modeDescription: 'Both branches are co-phased and added with weights proportional to their signal-to-noise ratio, so the output is never worse than the best branch. Best performance, most complex.',
    branches: 2,
    combining: 'mrc',
    hysteresisDb: 0,
    switchMs: 0,
    gainAt1pctDb: 11.7,
    gainAt10pctDb: 7.0
  })
});

// ---- Noise-figure cascade ----------------------------------------------------------------------------------------
// Friis: F_total = F1 + (F2 - 1)/G1 + (F3 - 1)/(G1 G2) + ... (linear). A passive lossy stage (cable, filter, attenuator,
// splitter) at the reference temperature has noise figure equal to its loss and gain equal to minus its loss.
// System sensitivity at the antenna = -174 + 10 log10(B_Hz) + NF_system + required CNR.
// Required CNR = the sensitivity figure minus (kTB + receiver NF): the CNR the quoted sensitivity implies.
// Sources: Friis (1944); Pozar, Microwave Engineering; Razavi, RF Microelectronics (noise figure and cascade).
export const KTB_DBM_PER_HZ = -174; // 290 K

export const CASCADE_TYPICAL = Object.freeze({
  // Typical ranges of external gain stages (approx).
  boosterNfDb: Object.freeze({ min: 1, typical: 2, max: 3 }),          // low-noise antenna-mounted preamp
  boosterGainDb: Object.freeze({ min: 10, typical: 15, max: 25 }),
  boosterIip3Dbm: Object.freeze({ min: 10, typical: 18, max: 30 }),     // input-referred: output IP3 minus gain, approx
  receiverNfDb: Object.freeze({ min: 6, typical: 9, max: 14 }),
  requiredCnrDb: Object.freeze({ min: 20, typical: 24, max: 28 }),      // approx: CNR at the quoted sensitivity
  cableNfEqualsLoss: true,                                              // passive at 290 K
  defaultBoosterNfDb: 3
});

// External noise at the antenna (man-made plus galactic) as a noise figure at 600 MHz, dB above kT, approx. ITU-R P.372
// gives man-made Fam = c - d log10 f (business area c = 76.8, d = 27.7: about 0 dB at 600 MHz), so galactic and ground
// noise (about 1 to 3 dB) and local interference sources dominate. Near dimmers, LED walls and switch-mode supplies the
// local noise can be 10 dB or more higher.
export const EXTERNAL_NOISE_FIGURE_600MHZ_DB = Object.freeze({ quiet: 1, outdoor: 3, urban: 5, 'noisy-venue': 12 });

// In-band interference floor rise (dB) at 2.4 / 5.8 GHz from other users of the licence-exempt band (Wi-Fi, Bluetooth, ...).
// Noise-floor rise at a Wi-Fi channel centre per venue level, from docs/PHYSICS-BANDS.md (library.js INTERFERENCE_MODEL: average Wi-Fi + Bluetooth
// power in the receiver channel against its noise floor, rise = 10 log10(1 + I/N); approx). 5.8 GHz is quieter than 2.4 GHz (less Wi-Fi
// airtime, no Bluetooth). Applies only at or above INTERFERENCE_MIN_MHZ; 'none' (or unset) = no rise, so older scenes keep their numbers.
export const INTERFERENCE_LEVELS = Object.freeze(['none', 'quiet', 'typical', 'busy']);
export const INTERFERENCE_RISE_DB = Object.freeze({
  '2g4': Object.freeze({ none: 0, quiet: 2, typical: 9, busy: 20 }),
  '5g8': Object.freeze({ none: 0, quiet: 0.6, typical: 4, busy: 12 }),
});
/** Interference band key of a carrier: '2g4' below 4 GHz, else '5g8'. */
export const interferenceBandOf = (freqMHz) => (freqMHz < 4000 ? '2g4' : '5g8');
export const INTERFERENCE_MIN_MHZ = 2000;

/** Cascade noise figure in dB of ordered stages [{ gainDb, nfDb }] (signal-flow order). Empty list gives 0. */
export function cascadeNfDb(stages) {
  let f = 0, g = 1;
  stages.forEach((s, i) => {
    const F = Math.pow(10, s.nfDb / 10);
    f = i === 0 ? F : f + (F - 1) / g;
    g *= Math.pow(10, s.gainDb / 10);
  });
  return stages.length ? 10 * Math.log10(f) : 0;
}

/** CNR the sensitivity figure implies: sensitivity - (kTB + receiver NF). */
export function impliedRequiredCnrDb(sensitivityDbm, noiseFigureDb, channelBwKhz = 200) {
  return sensitivityDbm - (KTB_DBM_PER_HZ + 10 * Math.log10(channelBwKhz * 1000) + noiseFigureDb);
}

/** System sensitivity at the antenna terminals for a given system NF and required CNR, dBm. */
export function systemSensitivityDbm(systemNfDb, requiredCnrDb, channelBwKhz = 200) {
  return KTB_DBM_PER_HZ + 10 * Math.log10(channelBwKhz * 1000) + systemNfDb + requiredCnrDb;
}

/** IIP3 of a cascade of stages [{ gainDb, iip3Dbm }] (signal-flow order): 1/IIP3 = 1/I1 + G1/I2 + G1 G2/I3 ... (linear mW). */
export function cascadeIip3Dbm(stages) {
  let inv = 0, g = 1;
  for (const s of stages) {
    inv += g / Math.pow(10, s.iip3Dbm / 10);
    g *= Math.pow(10, s.gainDb / 10);
  }
  return -10 * Math.log10(inv);
}
