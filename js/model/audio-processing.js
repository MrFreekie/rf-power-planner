// Audio processing maths for teaching demos: pre-/de-emphasis, FM noise triangle, a generic dB-domain compander, and the
// broadcast audio chain as data. Pure functions (no DOM, no state). Units: Hz, seconds, microseconds (tauUs), dB, kHz (deviation).
//
// EVERYTHING HERE IS GENERIC AND ILLUSTRATIVE. The compander is a textbook feed-forward dB-domain compander; its optional
// HF-weighted detector is "generic, not any manufacturer's published curve". Real wireless-microphone companders
// (and their time constants) are proprietary and differ between makes; do not expect them to interoperate with this model.
//
// ---- Pre-emphasis / de-emphasis (RC networks) -------------------------------------------------------------------------
//  Corner frequency        f1 = 1 / (2 pi tau): 50 us -> 3183 Hz (EU/UK), 75 us -> 2122 Hz (US).
//  De-emphasis (RC low-pass)  |H_de(f)| = 1 / sqrt(1 + (f/f1)^2);  pre-emphasis is its inverse |H_pre| = sqrt(1 + (f/f1)^2)  (+3.01 dB at f1).
//  Time domain, exact one-pole (step invariant):  de: y[n] = a x[n] + b y[n-1], b = exp(-1/(fs tau)), a = 1 - b.
//  Pre-emphasis is implemented as the exact inverse FIR: p[n] = (x[n] - b x[n-1]) / a, so pre followed by de returns the input
//  exactly (zero initial state). Both have unity DC gain; at low f (f << fs) they follow the analogue magnitudes above.
//
// ---- FM noise triangle ------------------------------------------------------------------------------------------------
//  Above FM threshold, discriminator output noise power spectral density rises as f^2 (6 dB/octave, the "triangle"; Taub and
//  Schilling, Haykin). De-emphasis multiplies the noise PSD by |H_de|^2 and restores the signal that pre-emphasis lifted, so
//  in the band fmin..fmax:
//      N_flat = integral f^2 df                 = (fmax^3 - fmin^3) / 3
//      N_de   = integral f^2 / (1 + (f/f1)^2) df = f1^2 [ f - f1 atan(f/f1) ] from fmin to fmax
//      improvement = 10 log10(N_flat / N_de)   (dB; signal level after pre then de is unchanged)
//  Hand values: 75 us (f1 = 2122 Hz), 20 Hz-15 kHz: about 13.2 dB; 50 us: about 10.2 dB.
//
// ---- Headroom cost of pre-emphasis ------------------------------------------------------------------------------------
//  A flat-level input of level L dB (0 dB = the reference deviation at low frequency) deviates the carrier by
//      dev(f) = refDeviation * 10^(L/20) * |H_pre(f)|
//  so programme with strong HF (cymbals, sibilance) reaches the deviation limit earlier; the level at which a tone at f just
//  reaches the limit is  L_max(f) = 20 log10(limit / refDeviation) - boost(f).
//
// ---- Compander (generic) ----------------------------------------------------------------------------------------------
//  Detector: |x| smoothed by a one-pole follower with separate attack and release time constants (fast attack, slow release makes it
//  peak-like: for tones above a few hundred Hz with the defaults a sine of amplitude A reads within about 0.5 dB of A): envDb = 20 log10(env). Optional HF weighting puts x + (G - 1) hp(x) into the
//  detector (one-pole high-pass at cornerHz, shelf of boostDb) so HF content drives the gain more: generic, not any manufacturer's curve.
//  Static law, levels in dB relative to full scale, reference level R and ratio r:
//      compressor  out = R + (in - R) / r      (gain = (1/r - 1)(in - R))
//      expander    out = R + (in - R) * r      (gain = (r - 1)(in - R))
//  Round trip with equal parameters is the identity (static). Both stages are feed-forward: the gain follows the envelope of the
//  stage INPUT. A noise floor added in the channel (between the two) is attenuated by the expander by the same gain it applies to
//  the signal, so quiet passages see less noise: with a signal at level Ls (after compression Lc) the noise is reduced by
//  (r - 1)(R - Lc) dB, and in silence by (r - 1)(R - Ln); as the signal dies away the noise floor "breathes" up and down
//  (noise pumping). Mismatch: a different ratio or reference in the expander gives a level error that depends on level.

const TWO_PI = 2 * Math.PI;
const L10 = (x) => 10 * Math.log10(x);
const L20 = (x) => 20 * Math.log10(x);

export const EMPHASIS_TAU_US = Object.freeze({ eu: 50, us: 75 });

/** Corner frequency in Hz of an RC network with time constant tauUs microseconds: 1 / (2 pi tau). */
export const emphasisCornerHz = (tauUs) => 1e6 / (TWO_PI * tauUs);

/** Magnitude in dB at freqHz of the 'pre' (default) or 'de' emphasis network: +-10 log10(1 + (f/f1)^2). */
export function emphasisMagnitudeDb(freqHz, tauUs, kind = 'pre') {
  const x = freqHz / emphasisCornerHz(tauUs);
  const m = L10(1 + x * x);
  return kind === 'de' ? -m : m;
}

/** emphasisResponse(freqsHz, tauUs, kind) -> number[] dB. */
export const emphasisResponse = (freqsHz, tauUs, kind = 'pre') => freqsHz.map((f) => emphasisMagnitudeDb(f, tauUs, kind));

/** De-emphasis (one-pole low-pass) on a sample array. Returns a new Float64Array. */
export function deEmphasis(samples, fs, tauUs) {
  const b = Math.exp(-1 / (fs * tauUs * 1e-6)), a = 1 - b;
  const y = new Float64Array(samples.length);
  let prev = 0;
  for (let n = 0; n < samples.length; n++) { prev = a * samples[n] + b * prev; y[n] = prev; }
  return y;
}

/** Pre-emphasis (exact inverse of deEmphasis) on a sample array. Returns a new Float64Array. */
export function preEmphasis(samples, fs, tauUs) {
  const b = Math.exp(-1 / (fs * tauUs * 1e-6)), a = 1 - b;
  const p = new Float64Array(samples.length);
  let prev = 0;
  for (let n = 0; n < samples.length; n++) { p[n] = (samples[n] - b * prev) / a; prev = samples[n]; }
  return p;
}

/** FM output noise PSD in dB relative to the flat-system noise at refHz: 20 log10(f/ref) (6 dB/octave), minus the de-emphasis loss when tauUs is given. */
export function fmNoiseSpectrumDb(freqHz, { tauUs = null, refHz = 1000 } = {}) {
  const tri = L20(freqHz / refHz);
  if (!tauUs) return tri;
  const x2 = (freqHz / emphasisCornerHz(tauUs)) ** 2;
  return tri - L10(1 + x2); // de-emphasis loss at f; the reference stays the flat system at refHz
}

/**
 * deEmphasisNoiseImprovementDb({ tauUs, fminHz = 20, fmaxHz = 15000 }) ->
 *   { tauUs, cornerHz, noiseFlat, noiseDeEmphasised, improvementDb }
 * Closed forms in the header (noise powers in Hz^3 units, relative). Signal after pre then de is unchanged, so improvement is the noise ratio.
 */
export function deEmphasisNoiseImprovementDb({ tauUs = 50, fminHz = 20, fmaxHz = 15000 } = {}) {
  const f1 = emphasisCornerHz(tauUs);
  const flat = (fmaxHz ** 3 - fminHz ** 3) / 3;
  const g = (f) => f - f1 * Math.atan(f / f1);
  const de = f1 * f1 * (g(fmaxHz) - g(fminHz));
  return { tauUs, cornerHz: f1, noiseFlat: flat, noiseDeEmphasised: de, improvementDb: L10(flat / de) };
}

/**
 * preEmphasisDeviation({ freqHz, levelDb = 0, tauUs = 50, refDeviationKhz = 22.5, limitKhz = 75 }) ->
 *   { boostDb, deviationKhz, overLimit, overDb, maxLevelDb }
 * Peak deviation of a flat-level tone through pre-emphasis (see header). overDb = 20 log10(deviation / limit) (positive = over-deviates);
 * maxLevelDb = highest flat input level (same 0 dB reference) at which this frequency stays within the limit.
 */
export function preEmphasisDeviation({ freqHz, levelDb = 0, tauUs = 50, refDeviationKhz = 22.5, limitKhz = 75 } = {}) {
  const boostDb = emphasisMagnitudeDb(freqHz, tauUs, 'pre');
  const deviationKhz = refDeviationKhz * 10 ** ((levelDb + boostDb) / 20);
  const overDb = L20(deviationKhz / limitKhz);
  return { boostDb, deviationKhz, overLimit: deviationKhz > limitKhz, overDb, maxLevelDb: L20(limitKhz / refDeviationKhz) - boostDb };
}

/** Same for a list of frequencies: array of { freqHz, ...preEmphasisDeviation }. */
export const preEmphasisDeviationSweep = (freqsHz, opts = {}) => freqsHz.map((freqHz) => ({ freqHz, ...preEmphasisDeviation({ ...opts, freqHz }) }));

// ---- Compander ------------------------------------------------------------------------------------------------------
export const COMPANDER_DEFAULTS = Object.freeze({
  ratio: 2, refDb: -20, attackMs: 3, releaseMs: 100, maxGainDb: 40, minGainDb: -80,
  hfWeight: null, // { cornerHz, boostDb }: generic, not any manufacturer's published curve
});

const cfg = (p) => ({ ...COMPANDER_DEFAULTS, ...(p || {}) });

/** Static compressor output level in dB for an input level in dB (R + (in - R) / r). */
export const compressDb = (inDb, p) => { const c = cfg(p); return c.refDb + (inDb - c.refDb) / c.ratio; };
/** Static expander output level in dB (R + (in - R) * r). */
export const expandDb = (inDb, p) => { const c = cfg(p); return c.refDb + (inDb - c.refDb) * c.ratio; };

/** Static transfer curve: [{ inDb, compressedDb, expandedDb, roundTripDb }] for a list of input levels (dB). */
export function companderTransferCurve(levelsDb, p) {
  return levelsDb.map((inDb) => ({ inDb, compressedDb: compressDb(inDb, p), expandedDb: expandDb(inDb, p), roundTripDb: expandDb(compressDb(inDb, p), p) }));
}

/**
 * Level error of a mismatched pair, dB (output - input) at input level inDb: tx compresses with txParams, rx expands with rxParams.
 * Matched parameters give 0 at every level.
 */
export function companderMismatchErrorDb(inDb, txParams, rxParams) {
  return expandDb(compressDb(inDb, txParams), rxParams) - inDb;
}

/**
 * companderProcess(samples, mode, params, fs) -> { y: Float64Array, gainDb: Float64Array, envDb: Float64Array }
 * mode 'compress' or 'expand'; params as COMPANDER_DEFAULTS. gainDb[n] is the applied gain (the "breathing" trace), envDb[n] the detector level.
 */
export function companderProcess(samples, mode, params, fs) {
  const c = cfg(params);
  const ca = 1 - Math.exp(-1 / (fs * c.attackMs * 1e-3)), cr = 1 - Math.exp(-1 / (fs * c.releaseMs * 1e-3));
  const slope = mode === 'expand' ? c.ratio - 1 : 1 / c.ratio - 1;
  const hf = c.hfWeight && c.hfWeight.cornerHz > 0 ? c.hfWeight : null;
  const alpha = hf ? 1 / (1 + TWO_PI * hf.cornerHz / fs) : 0;     // one-pole high-pass: hp[n] = alpha (hp[n-1] + x[n] - x[n-1])
  const G = hf ? 10 ** (hf.boostDb / 20) : 1;
  const N = samples.length;
  const y = new Float64Array(N), gainDb = new Float64Array(N), envDb = new Float64Array(N);
  let e = 0, hp = 0, xPrev = 0;
  for (let n = 0; n < N; n++) {
    const x = samples[n];
    let s = x;
    if (hf) { hp = alpha * (hp + x - xPrev); s = x + (G - 1) * hp; }
    xPrev = x;
    const a = Math.abs(s);
    e += (a > e ? ca : cr) * (a - e);
    const lvl = L20(Math.max(e, 1e-9));
    const g = Math.min(c.maxGainDb, Math.max(c.minGainDb, slope * (lvl - c.refDb)));
    envDb[n] = lvl; gainDb[n] = g; y[n] = x * 10 ** (g / 20);
  }
  return { y, gainDb, envDb };
}

/** Compress then expand an ideal channel: { compressed, output, compressGainDb, expandGainDb } (same params both ends unless rxParams is given). */
export function companderRoundTrip(samples, params, fs, rxParams = params) {
  const c = companderProcess(samples, 'compress', params, fs);
  const e = companderProcess(c.y, 'expand', rxParams, fs);
  return { compressed: c.y, output: e.y, compressGainDb: c.gainDb, expandGainDb: e.gainDb };
}

/**
 * Static noise-reduction figures for a signal at signalDb and a channel noise floor at noiseDb (both dB re full scale, measured at the
 * channel, i.e. after compression is applied to the signal). Returns { channelSignalDb, expanderGainDb, noiseOutDb, noiseReductionDb,
 * silenceNoiseOutDb, silenceReductionDb }. The expander detector sees signal + noise power.
 */
export function companderNoiseStatic({ signalDb, noiseDb, ...p }) {
  const c = cfg(p);
  const chSig = compressDb(signalDb, c);
  const env = L10(10 ** (chSig / 10) + 10 ** (noiseDb / 10));
  const gain = (c.ratio - 1) * (env - c.refDb);
  const silGain = (c.ratio - 1) * (noiseDb - c.refDb);
  return { channelSignalDb: chSig, expanderGainDb: gain, noiseOutDb: noiseDb + gain, noiseReductionDb: -gain, silenceNoiseOutDb: noiseDb + silGain, silenceReductionDb: -silGain };
}

// Small deterministic generator (mulberry32) so demos and tests repeat.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(TWO_PI * r());

/**
 * companderNoiseDemo({ fs = 48000, toneHz = 1000, toneDb = -30, burstS = 0.5, tailS = 0.5, decayDb = 0, noiseDb = -60, seed = 1, ...compander params, rxParams? })
 *   -> { t, input, compressed, received, output, noiseOnly, compressGainDb, expandGainDb, noiseRmsDbWithout, noiseRmsDbWith, tailNoiseReductionDb }
 * A tone burst followed by silence (the "tail"); white Gaussian channel noise of rms noiseDb is added between compressor and expander.
 * noiseOnly is the same noise through the expander alone, noiseRmsDb* are measured on the silent tail (last half of it) without and with the
 * compander; expandGainDb shows the noise floor pumping as the burst ends.
 */
export function companderNoiseDemo(opts = {}) {
  const { fs = 48000, toneHz = 1000, toneDb = -30, burstS = 0.5, tailS = 0.5, noiseDb = -60, seed = 1, rxParams, ...p } = opts;
  const N = Math.round((burstS + tailS) * fs), nb = Math.round(burstS * fs);
  const amp = 10 ** (toneDb / 20);
  const input = new Float64Array(N);
  for (let n = 0; n < nb; n++) input[n] = amp * Math.sin(TWO_PI * toneHz * n / fs);
  const c = companderProcess(input, 'compress', p, fs);
  const r = rng(seed), sigma = 10 ** (noiseDb / 20);
  const noise = new Float64Array(N), received = new Float64Array(N);
  for (let n = 0; n < N; n++) { noise[n] = sigma * gauss(r); received[n] = c.y[n] + noise[n]; }
  const e = companderProcess(received, 'expand', rxParams || p, fs);
  const t = new Float64Array(N); for (let n = 0; n < N; n++) t[n] = n / fs;
  const rms = (a, from, to) => { let s = 0; for (let n = from; n < to; n++) s += a[n] * a[n]; return Math.sqrt(s / (to - from)); };
  const from = nb + Math.round(tailS * fs / 2);
  const without = L20(rms(noise, from, N)), withC = L20(Math.max(rms(e.y, from, N), 1e-12));
  return { t, input, compressed: c.y, received, output: e.y, noiseOnly: noise, compressGainDb: c.gainDb, expandGainDb: e.gainDb, noiseRmsDbWithout: without, noiseRmsDbWith: withC, tailNoiseReductionDb: without - withC };
}

// ---- Broadcast audio chain (data) -----------------------------------------------------------------------------------
export const BROADCAST_AUDIO_CHAIN = Object.freeze([
  Object.freeze({ id: 'source', label: 'Programme source', explain: 'Stereo programme audio, usually already compressed and loudness managed.' }),
  Object.freeze({ id: 'pre-emphasis', label: 'Pre-emphasis (50 or 75 us)', explain: 'Boosts highs above the 3.18 or 2.12 kHz corner so they sit above the FM noise triangle.' }),
  Object.freeze({ id: 'limiter', label: 'Limiter / clipper', explain: 'Stops the boosted highs from over-deviating the carrier; the price is loudness-limited, sometimes dull highs.' }),
  Object.freeze({ id: 'composite-clipper', label: 'Composite clipper', explain: 'Hard limit on the final stereo multiplex peaks so total deviation stays within +-75 kHz (or +-50 kHz in some regions).' }),
  Object.freeze({ id: 'mpx', label: 'Stereo MPX encoder', explain: 'Mono sum, 19 kHz pilot and the 38 kHz DSB-SC difference signal are combined into one composite baseband.' }),
  Object.freeze({ id: 'fm-link', label: 'FM modulator, RF channel, discriminator', explain: 'Noise out of the discriminator rises 6 dB per octave with frequency (the noise triangle).' }),
  Object.freeze({ id: 'de-emphasis', label: 'De-emphasis in the receiver', explain: 'The exact inverse of the pre-emphasis restores the highs and cuts the triangle noise, about 10 to 13 dB better.' }),
]);

/** The broadcast-style chain as an array of { id, label, explain } (a fresh copy so callers may reorder it). */
export const broadcastAudioChain = () => BROADCAST_AUDIO_CHAIN.map((s) => ({ ...s }));
