// Digital RF link model: QAM constellations, BER, FEC cliff, adaptive modulation, concealment.
// Pure module (no DOM, no randomness beyond seeded PRNGs). Illustrative, not a product model.
//
// Parameters come from digital-params.js when present (DIGITAL_PRESETS / DIGITAL_DEFAULTS);
// the constants below back-fill any missing field.

import { audioSnrDb } from './mpx.js';

let PARAMS = {};
try { PARAMS = await import('./digital-params.js'); } catch { PARAMS = {}; }

const FALLBACK = {
  symbolRateKSps: 150,
  noiseBwKHz: 200,
  noiseFigureDb: 8,
  codeRate: 0.75,
  implLossDb: 1.5, // implementation loss subtracted from SNR for EVM/MER
  // minimum CNR (dB) to hold each order, then hysteresis for stepping up
  amcThresholdsDb: { 4: 12, 16: 19, 64: 25.5, 256: 32 },
  amcHysteresisDb: 1.5,
  preFecCliffBer: 3e-3, // pre-FEC BER at which the decoder falls off its cliff
  cliffSharpness: 6, // logistic steepness per decade of pre-FEC BER
  postFecFloor: 1e-12,
  frameBits: 1000,
  degradedFer: 1e-3, // FER above this is 'degraded'
  concealFer: 0.05, // FER above this the decoder conceals (repeat last frame)
  concealMaxMs: 200, // concealment longer than this ends in mute
  muteFer: 0.9, // FER at or above this: no usable frames, mute at once instead of concealing
  concealRecoverMs: 100, // frames must stay good this long before audio is un-muted / concealment ends
};

function baseConfig() {
  if (PARAMS.DIGITAL_DEFAULTS && typeof PARAMS.DIGITAL_DEFAULTS === 'object') return PARAMS.DIGITAL_DEFAULTS;
  const p = PARAMS.DIGITAL_PRESETS;
  if (p && typeof p === 'object') {
    const first = p.default || Object.values(p)[0];
    if (first && typeof first === 'object') return first;
  }
  return {};
}
// The parameter-file defaults are merged only when the caller passes no configuration at all. A caller-supplied
// (even partial) config is merged over the built-in fallback alone, so a default preset can never leak a field
// such as fixedOrder into another configuration.
const cfgOf = (cfg) => {
  const given = cfg && Object.keys(cfg).length > 0;
  const c = { ...FALLBACK, ...(given ? {} : baseConfig()), ...(cfg || {}) };
  c.amcThresholdsDb = { ...FALLBACK.amcThresholdsDb, ...(c.amcThresholdsDb || {}) };
  return c;
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const log2 = (x) => Math.log(x) / Math.LN2;
export const ORDERS = [2, 4, 16, 64, 256];

// ---- math ----------------------------------------------------------------------------------

/** Complementary error function, Numerical Recipes erfcc (Chebyshev fit, relative error < 1.2e-7 everywhere). */
export function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/** Gaussian tail probability Q(x) = erfc(x / sqrt 2) / 2. */
export const qfunc = (x) => 0.5 * erfc(x / Math.SQRT2);

function mulberry32(seed) {
  let a = (seed | 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussianPair(rand) {
  // Box-Muller
  const u1 = Math.max(rand(), 1e-12), u2 = rand();
  const r = Math.sqrt(-2 * Math.log(u1));
  return [r * Math.cos(2 * Math.PI * u2), r * Math.sin(2 * Math.PI * u2)];
}

// ---- constellation -------------------------------------------------------------------------

const gray = (n) => n ^ (n >> 1);

/**
 * constellation(order) -> [{ i, q, label, bits }] with unit average power.
 * order 2 = BPSK (+-1 on I), 4/16/64/256 = square QAM. Per-axis levels (2m - (L-1)), L = sqrt(M), scaled by
 * 1/sqrt(2 (M-1) / 3). Gray labelled per axis: label = (gray(mI) << k) | gray(mQ), k = log2(L), so nearest
 * neighbours differ by one bit.
 */
export function constellation(order) {
  if (order === 2) {
    return [{ i: -1, q: 0, label: 0, bits: '0' }, { i: 1, q: 0, label: 1, bits: '1' }];
  }
  const L = Math.round(Math.sqrt(order));
  if (!ORDERS.includes(order) || L * L !== order) throw new RangeError(`unsupported modulation order ${order}`);
  const k = Math.round(log2(L));
  const scale = 1 / Math.sqrt((2 * (order - 1)) / 3);
  const pts = [];
  for (let mi = 0; mi < L; mi++) {
    for (let mq = 0; mq < L; mq++) {
      const label = (gray(mi) << k) | gray(mq);
      pts.push({ i: (2 * mi - (L - 1)) * scale, q: (2 * mq - (L - 1)) * scale, label, bits: label.toString(2).padStart(2 * k, '0') });
    }
  }
  return pts;
}

// ---- SNR bookkeeping and BER ----------------------------------------------------------------

/** Es/N0, dB = CNR + 10 log10(noiseBw / symbolRate). */
export function esN0Db(cnrDb, { symbolRateKSps, noiseBwKHz } = {}) {
  const c = cfgOf({ symbolRateKSps, noiseBwKHz });
  return cnrDb + 10 * Math.log10(c.noiseBwKHz / c.symbolRateKSps);
}

/** Eb/N0, dB = Es/N0 - 10 log10(bitsPerSymbol * codeRate) (information bits). */
export function ebN0Db(esN0, order, codeRate = 1) {
  return esN0 - 10 * Math.log10(log2(order) * codeRate);
}

/**
 * Uncoded bit error rate for Gray-labelled constellations over AWGN, from Es/N0 (dB):
 *   BPSK: Q(sqrt(2 Es/N0));  M-QAM (M >= 4): (4/k)(1 - 1/sqrt M) Q(sqrt(3 Es/N0 / (M-1))), k = log2 M.
 * (M = 4 reduces to Q(sqrt(Es/N0)), exact QPSK.) The M >= 16 form is the standard nearest-neighbour approximation.
 */
export function berUncoded(order, esN0) {
  if (!Number.isFinite(esN0)) return esN0 > 0 ? 0 : 0.5;
  const g = Math.pow(10, esN0 / 10);
  let ber;
  if (order === 2) ber = qfunc(Math.sqrt(2 * g));
  else {
    const k = log2(order);
    ber = ((4 / k) * (1 - 1 / Math.sqrt(order))) * qfunc(Math.sqrt((3 * g) / (order - 1)));
  }
  return Math.min(0.5, ber);
}

/**
 * Post-FEC BER as a parametric cliff of the pre-FEC BER. With pc = preFecCliffBer, s = cliffSharpness,
 * floor = postFecFloor and w = 1 / (1 + 10^(-s (log10 pre - log10 pc))):
 *   log10 post = (1 - w) log10 floor + w log10 min(pre, 0.5).
 * Far below pc: post -> floor (quasi error-free). Far above: post -> pre (decoder gives nothing).
 * Monotonic non-decreasing in pre; 0.5 weight exactly at pre = pc.
 */
export function postFecBer(preFecBer, cfg) {
  const c = cfgOf(cfg);
  const pre = Math.min(0.5, Math.max(preFecBer, c.postFecFloor));
  const w = 1 / (1 + Math.pow(10, -c.cliffSharpness * (Math.log10(pre) - Math.log10(c.preFecCliffBer))));
  return Math.pow(10, (1 - w) * Math.log10(c.postFecFloor) + w * Math.log10(pre));
}

/** Coded BER for a channel Es/N0 (dB): the FEC cliff applied to the uncoded channel BER. */
export function berCoded(order, esN0, cfg) {
  return postFecBer(berUncoded(order, esN0), cfg);
}

/** EVM (rms, percent of rms constellation amplitude) = 100 * 10^(-(snr - implLoss)/20). */
export function evmPercent(snrDb, implLossDb = 0) {
  return 100 * Math.pow(10, -(snrDb - implLossDb) / 20);
}

/** MER, dB = -20 log10(EVM fraction) = snr - implLoss. */
export function merDb(snrDb, implLossDb = 0) {
  return snrDb - implLossDb;
}

/**
 * constellationSamples(order, snrDb, { n = 512, seed = 1, phaseNoiseDeg = 0, iqGainDb = 0, iqPhaseDeg = 0 })
 *   -> { points: [{ i, q, ideal: {i, q}, label }], evmPercent }
 * Random symbols (seeded), IQ imbalance (Q gain g and phase skew phi: Q' = g (Q cos phi + I sin phi)), Gaussian phase
 * noise (rms degrees), then complex AWGN with per-axis sigma sqrt(10^(-snr/10) / 2) on the unit-power constellation.
 * Deterministic for a given seed. evmPercent is the measured rms error over the samples.
 */
export function constellationSamples(order, snrDb, { n = 512, seed = 1, phaseNoiseDeg = 0, iqGainDb = 0, iqPhaseDeg = 0 } = {}) {
  const pts = constellation(order);
  const rand = mulberry32(seed);
  const sigma = Math.sqrt(Math.pow(10, -snrDb / 10) / 2);
  const g = Math.pow(10, iqGainDb / 20);
  const phi = (iqPhaseDeg * Math.PI) / 180;
  const out = [];
  let err = 0;
  for (let k = 0; k < n; k++) {
    const s = pts[Math.min(pts.length - 1, Math.floor(rand() * pts.length))];
    let i = s.i, q = g * (s.q * Math.cos(phi) + s.i * Math.sin(phi));
    const [pn] = gaussianPair(rand);
    if (phaseNoiseDeg) {
      const th = (pn * phaseNoiseDeg * Math.PI) / 180;
      [i, q] = [i * Math.cos(th) - q * Math.sin(th), i * Math.sin(th) + q * Math.cos(th)];
    }
    const [ni, nq] = gaussianPair(rand);
    i += sigma * ni; q += sigma * nq;
    err += (i - s.i) ** 2 + (q - s.q) ** 2;
    out.push({ i, q, ideal: { i: s.i, q: s.q }, label: s.label });
  }
  return { points: out, evmPercent: 100 * Math.sqrt(err / Math.max(1, n)) };
}

// ---- adaptive modulation -------------------------------------------------------------------

const AMC_LADDER = [4, 16, 64, 256];

/**
 * amcStep(prev, cnrDb, cfg) -> { order, switched, marginDb }
 * order 0 = link down. T[o] = amcThresholdsDb[o] is the CNR needed to hold order o. Stepping up to o needs
 * cnr >= T[o] + amcHysteresisDb; stepping down happens when cnr < T[current] (to the highest order whose T is met,
 * possibly several steps, or down below T[4]). marginDb = cnr - T[order] (cnr - T[4] when down).
 * prev may be null, a number or { order }.
 */
export function amcStep(prev, cnrDb, cfg) {
  const c = cfgOf(cfg);
  const T = c.amcThresholdsDb, H = c.amcHysteresisDb;
  const cur = typeof prev === 'number' ? prev : prev && Number.isFinite(prev.order) ? prev.order : 0;
  const cnr = Number.isFinite(cnrDb) ? cnrDb : -Infinity;
  let order = cur;
  if (cur !== 0 && cnr < T[cur]) {
    order = 0;
    for (const o of AMC_LADDER) if (o < cur && cnr >= T[o]) order = o;
  } else {
    let up = cur;
    for (const o of AMC_LADDER) if (o > cur && cnr >= T[o] + H) up = o;
    if (cur === 0 && up === 0) up = 0;
    order = up;
  }
  return { order, switched: order !== cur, marginDb: cnr - T[order || 4] };
}

// ---- link state ----------------------------------------------------------------------------

/**
 * digitalLinkState(inputDbm, cfg, prev, tMs) -> { cnrDb, order, esN0Db, ebN0Db, preFecBer, postFecBer, evmPercent,
 *   merDb, frameErrorRate, throughputKbps, state, muted, amcSwitched, badMs, goodMs, trouble, lastMs }
 * cnr = input - (-174 + 10 log10 noiseBw + NF). Order from amcStep unless cfg.fixedOrder is set.
 * FER = 1 - (1 - postFecBer)^frameBits. state: 'down' (no order, or muted after concealment ran out),
 * 'concealing' (FER >= concealFer: last frame repeated, up to concealMaxMs of continuous trouble), 'degraded'
 * (FER >= degradedFer), else 'ok'. muted is true in 'down'. throughput = Rs * log2(order) * codeRate * (1 - FER).
 */
export function digitalLinkState(inputDbm, cfg, prev, tMs = 0) {
  const c = cfgOf(cfg);
  const noiseDbm = -174 + 10 * Math.log10(c.noiseBwKHz * 1000) + c.noiseFigureDb;
  const cnr = Number.isFinite(inputDbm) ? inputDbm - noiseDbm : -Infinity;
  // fixedOrder: the link stays on that order whenever there is a signal; it fails through the FEC cliff itself.
  const amc = c.fixedOrder
    ? { order: Number.isFinite(cnr) ? c.fixedOrder : 0, switched: false }
    : amcStep(prev, cnr, c);
  const order = amc.order;
  const es = Number.isFinite(cnr) ? esN0Db(cnr, c) : -Infinity;
  const eb = order ? ebN0Db(es, order, c.codeRate) : -Infinity;
  // Implementation loss degrades the effective Es/N0 seen by the demodulator (BER as well as EVM/MER).
  const pre = order ? berUncoded(order, es - (c.implLossDb || 0)) : 0.5;
  const post = order ? postFecBer(pre, c) : 0.5;
  const fer = order ? 1 - Math.pow(1 - post, c.frameBits) : 1;
  const snr = es;
  const dt = prev && Number.isFinite(prev.lastMs) ? Math.max(0, tMs - prev.lastMs) : 0;
  const bad = fer >= c.concealFer;
  // Recovery hysteresis: once in trouble (concealing or muted) the decoder needs concealRecoverMs of good frames.
  const wasTrouble = !!(prev && prev.trouble);
  const goodMs = !bad && wasTrouble ? (prev.goodMs || 0) + dt : 0;
  const trouble = bad || (wasTrouble && goodMs < c.concealRecoverMs);
  const badMs = trouble ? (prev && prev.trouble ? prev.badMs || 0 : 0) + dt : 0;
  let state;
  if (!order) state = 'down';
  else if (fer >= c.muteFer || (trouble && badMs > c.concealMaxMs)) state = 'down'; // total loss: nothing to conceal with
  else if (trouble) state = 'concealing';
  else if (fer >= c.degradedFer) state = 'degraded';
  else state = 'ok';
  return {
    cnrDb: cnr, order, esN0Db: es, ebN0Db: eb, preFecBer: pre, postFecBer: post,
    evmPercent: evmPercent(snr, c.implLossDb), merDb: merDb(snr, c.implLossDb),
    frameErrorRate: fer,
    throughputKbps: order && state !== 'down' ? c.symbolRateKSps * log2(order) * c.codeRate * (1 - fer) : 0,
    state, muted: state === 'down', amcSwitched: amc.switched, badMs, goodMs, trouble, lastMs: tMs,
  };
}

// ---- plotting helpers ----------------------------------------------------------------------

/**
 * berCurve(order, codeRate, fromDb, toDb, n) -> { x[], uncoded[], coded[] } against Eb/N0 (dB).
 * uncoded: berUncoded at Es/N0 = Eb/N0 + 10 log10 k (rate 1). coded: Es/N0 = Eb/N0 + 10 log10 (k R), then the FEC cliff.
 */
export function berCurve(order, codeRate, fromDb, toDb, n = 64, cfg) {
  const k = log2(order);
  const x = [], uncoded = [], coded = [];
  for (let j = 0; j < n; j++) {
    const eb = fromDb + ((toDb - fromDb) * j) / Math.max(1, n - 1);
    x.push(eb);
    uncoded.push(berUncoded(order, eb + 10 * Math.log10(k)));
    coded.push(postFecBer(berUncoded(order, eb + 10 * Math.log10(k * codeRate)), cfg));
  }
  return { x, uncoded, coded };
}

/**
 * analogVsDigitalCurve(fromDb, toDb, n, { analog, digital }) -> { cnr[], analogSnrDb[], analogQuality[],
 *   digitalQuality[], digitalOrder[], throughputKbps[] }
 * analog: FM mono audio SNR via audioSnrDb (mpx.js), mapped to 0..100 % as clamp((snr - 10) / 50). Falls gradually.
 * digital: stateless AMC order (highest whose threshold is met), quality = 100 (1 - FER): flat then a cliff.
 */
export function analogVsDigitalCurve(fromDb, toDb, n = 64, { analog = {}, digital = {} } = {}) {
  const c = cfgOf(digital);
  const out = { cnr: [], analogSnrDb: [], analogQuality: [], digitalQuality: [], digitalOrder: [], throughputKbps: [] };
  for (let j = 0; j < n; j++) {
    const cnr = fromDb + ((toDb - fromDb) * j) / Math.max(1, n - 1);
    const snr = audioSnrDb(cnr, { ...analog, stereo: false });
    let order = 0;
    for (const o of AMC_LADDER) if (cnr >= c.amcThresholdsDb[o]) order = o;
    let fer = 1;
    if (order) {
      const es = esN0Db(cnr, c);
      fer = 1 - Math.pow(1 - postFecBer(berUncoded(order, es), c), c.frameBits);
    }
    out.cnr.push(cnr);
    out.analogSnrDb.push(snr);
    out.analogQuality.push(100 * clamp01((snr - 10) / 50));
    out.digitalQuality.push(100 * (1 - fer));
    out.digitalOrder.push(order);
    out.throughputKbps.push(order ? c.symbolRateKSps * log2(order) * c.codeRate * (1 - fer) : 0);
  }
  return out;
}
