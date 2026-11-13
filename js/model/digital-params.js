// Digital RF link parameters: modulation, forward error correction, adaptive modulation, presets.
// Pure constants (no DOM, no state), all frozen. Units: kHz, ksym/s, dB, ms.
//
// Everything here is GENERIC and ILLUSTRATIVE. Real digital wireless microphone and in-ear-monitor systems use
// proprietary modulation, coding, framing and latency; some are not QAM at all. The numbers describe a plausible class
// of link, not any product.
//
// Sources (derivations in docs/PHYSICS-DIGITAL.md):
//  - Proakis, Digital Communications; Sklar, Digital Communications: Fundamentals and Applications
//    (BPSK/QPSK BER = Q(sqrt(2 Eb/N0)); square M-QAM nearest-neighbour approximation with Gray labelling:
//    BER ~ (4/k)(1 - 1/sqrt M) Q(sqrt(3 Es/N0 / (M-1))), k = log2 M).
//  - Es/N0 = k R Eb/N0 for code rate R. CNR = Es/N0 x (symbol rate / noise bandwidth).
//  - EVM_rms ~ 10^(-MER/20); for an ideal receiver MER equals the SNR.
//  - Pre-FEC BER tolerances below are order-of-magnitude values typical of convolutional plus Reed-Solomon or
//    short-block LDPC class codes (approx); they are not taken from one standard.

export const MODULATIONS = Object.freeze({
  2: Object.freeze({ order: 2, id: 'bpsk', name: 'BPSK', bitsPerSymbol: 1 }),
  4: Object.freeze({ order: 4, id: 'qpsk', name: 'QPSK', bitsPerSymbol: 2 }),
  16: Object.freeze({ order: 16, id: '16qam', name: '16-QAM', bitsPerSymbol: 4 }),
  64: Object.freeze({ order: 64, id: '64qam', name: '64-QAM', bitsPerSymbol: 6 }),
  256: Object.freeze({ order: 256, id: '256qam', name: '256-QAM', bitsPerSymbol: 8 })
});

// Uncoded AWGN requirements from the formulas above, dB (computed numerically, rounded to 0.01).
// esN0 = Es/N0, ebN0 = Eb/N0 (rate 1). b3e3 is the pre-FEC value at BER 3e-3.
export const REQUIRED_SNR = Object.freeze({
  2: Object.freeze({ esN0At1e3: 6.79, ebN0At1e3: 6.79, esN0At1e6: 10.53, ebN0At1e6: 10.53, esN0At3e3: 5.77 }),
  4: Object.freeze({ esN0At1e3: 9.80, ebN0At1e3: 6.79, esN0At1e6: 13.54, ebN0At1e6: 10.53, esN0At3e3: 8.78 }),
  16: Object.freeze({ esN0At1e3: 16.54, ebN0At1e3: 10.52, esN0At1e6: 20.42, ebN0At1e6: 14.40, esN0At3e3: 15.46 }),
  64: Object.freeze({ esN0At1e3: 22.55, ebN0At1e3: 14.77, esN0At1e6: 26.56, ebN0At1e6: 18.78, esN0At3e3: 21.41 }),
  256: Object.freeze({ esN0At1e3: 28.41, ebN0At1e3: 19.38, esN0At1e6: 32.55, ebN0At1e6: 23.51, esN0At3e3: 27.22 })
});

// Code rates and the pre-FEC BER at which the decoder falls off its cliff (approx). Higher rate = less redundancy =
// lower tolerance. Post-FEC BER is a logistic cliff in log10(pre-FEC BER) with `cliffSharpness` per decade.
export const CODES = Object.freeze({
  '1/2': Object.freeze({ rate: 1 / 2, preFecCliffBer: 8e-2 }),
  '2/3': Object.freeze({ rate: 2 / 3, preFecCliffBer: 3e-2 }),
  '3/4': Object.freeze({ rate: 3 / 4, preFecCliffBer: 1.5e-2 }),
  '5/6': Object.freeze({ rate: 5 / 6, preFecCliffBer: 7e-3 }),
  '7/8': Object.freeze({ rate: 7 / 8, preFecCliffBer: 4e-3 })
});

export const FEC_CLIFF = Object.freeze({
  cliffSharpness: 6,     // approx: logistic steepness per decade of pre-FEC BER (about 1 dB wide)
  postFecFloor: 1e-12,   // quasi error-free
  qefBer: 1e-6           // reference post-FEC BER for thresholds
});

// Adaptive modulation: hold threshold (CNR to stay on an order), step-up needs `amcHysteresisDb` more.
// holdCnr(order) = Es/N0 at the code's cliff BER + implementationLossDb + fadeMarginDb - 10 log10(B / Rs).
// Values computed from the tables above for each preset and rounded to 0.1 dB. Orders a preset does not allow are Infinity.
const NOT_ALLOWED = Infinity;

const frozen = (o) => Object.freeze(o);
function preset(p) {
  const hyst = p.amcHysteresisDb;
  const t = p.amcThresholdsDb;
  const out = {
    ...p,
    illustrative: true,
    fixedOrder: p.fixedOrder || null,   // explicit null so a default preset's fixedOrder cannot leak in through a merge
    // aliases read by the model (digital.js)
    noiseBwKHz: p.channelBwKHz,
    implLossDb: p.implementationLossDb,
    amcThresholdsDb: frozen({ 4: NOT_ALLOWED, 16: NOT_ALLOWED, 64: NOT_ALLOWED, 256: NOT_ALLOWED, ...t }),
    preFecCliffBer: CODES[p.code].preFecCliffBer,
    cliffSharpness: FEC_CLIFF.cliffSharpness,
    postFecFloor: FEC_CLIFF.postFecFloor,
    codeRate: CODES[p.code].rate,
    // frame length in coded information bits at the lowest allowed order
    frameBits: Math.round(p.concealment.frameMs * p.symbolRateKSps * 2 * CODES[p.code].rate),
    concealMaxMs: p.concealment.frameMs * p.concealment.repeatFrames,
    // switch thresholds in plain form: up = hold + hysteresis, down = hold
    switchUpCnrDb: frozen(Object.fromEntries(Object.entries(t).map(([o, v]) => [o, v + hyst]))),
    switchDownCnrDb: frozen({ ...t })
  };
  return frozen(out);
}

export const DIGITAL_PRESETS = frozen({
  // Multi-carrier-like link, adaptive between QPSK, 16-QAM and 64-QAM.
  'iem-ofdm-like-adaptive': preset({
    id: 'iem-ofdm-like-adaptive',
    label: 'Digital IEM, OFDM-like adaptive (illustrative)',
    channelBwKHz: 400,
    symbolRateKSps: 300,
    noiseFigureDb: 10,            // approx
    code: '2/3',
    allowedModulations: frozen([4, 16, 64]),
    amcThresholdsDb: { 4: 8.2, 16: 14.6, 64: 20.2 }, // approx
    amcHysteresisDb: 2,
    implementationLossDb: 2.5,
    fadeMarginDb: 1.5,
    latencyMs: 2,                 // approx
    concealment: frozen({ strategy: 'repeat-then-mute', frameMs: 1, repeatFrames: 30 }),
    degradedFer: 1e-3,
    concealFer: 0.05
  }),
  // Fixed QPSK, single-order link: simplest, no adaptation. Falls off a cliff.
  'mic-qpsk-fixed': preset({
    id: 'mic-qpsk-fixed',
    label: 'Digital mic, fixed QPSK (illustrative)',
    channelBwKHz: 200,
    symbolRateKSps: 150,          // roll-off about 0.33: Rs / B = 0.75
    noiseFigureDb: 8,             // approx
    code: '3/4',
    allowedModulations: frozen([4]),
    fixedOrder: 4,
    amcThresholdsDb: { 4: 9.0 }, // approx
    amcHysteresisDb: 2,
    implementationLossDb: 2,      // approx: filters, phase noise, quantisation
    fadeMarginDb: 1.5,
    latencyMs: 3,                 // approx: framing, FEC interleaving, buffers
    // Concealment: repeat the last good audio frame for up to repeatFrames, then mute.
    concealment: frozen({ strategy: 'repeat-then-mute', frameMs: 2, repeatFrames: 20 }),
    degradedFer: 1e-3,
    concealFer: 0.05
  }),
  // Wide channel with the full ladder down from 256-QAM.
  'wideband-adaptive': preset({
    id: 'wideband-adaptive',
    label: 'Wideband adaptive (illustrative)',
    channelBwKHz: 1000,
    symbolRateKSps: 800,
    noiseFigureDb: 8,             // approx
    code: '3/4',
    allowedModulations: frozen([4, 16, 64, 256]),
    amcThresholdsDb: { 4: 10.3, 16: 16.8, 64: 22.5, 256: 28.2 }, // approx
    amcHysteresisDb: 2,
    implementationLossDb: 3,
    fadeMarginDb: 1.5,
    latencyMs: 4,                 // approx
    concealment: frozen({ strategy: 'repeat-then-mute', frameMs: 1, repeatFrames: 60 }),
    degradedFer: 1e-3,
    concealFer: 0.05
  })
});

export const DIGITAL_DEFAULTS = DIGITAL_PRESETS[Object.keys(DIGITAL_PRESETS)[0]]; // first preset: adaptive, so a merge never forces a fixed order
