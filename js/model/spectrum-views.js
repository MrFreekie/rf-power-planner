// Spectrum views for the bottom bar: a simulated audio spectrum and the RF spectrum of ONE selected carrier. Pure functions,
// no DOM, no Math.random (a small integer hash gives repeatable "life"). Everything here is illustrative where `notes` says so;
// the planner's own numbers (rx level, noise floor) come from the caller. The MPX view uses mpxSpectrum from mpx.js.
import { emphasisMagnitudeDb } from './audio-processing.js';

const L10 = Math.log10;
const TWO_PI = 2 * Math.PI;

// ---------------------------------------------------------------- deterministic noise

/** 32-bit integer hash -> [0, 1). Same inputs always give the same value. */
function hash01(a, b = 0, c = 0) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Smooth value noise in time: hash values at 2 steps per second, cosine-interpolated. Range [-1, 1]. */
function wobble(bin, t, ch = 0, rate = 2) {
  const x = Math.max(0, t) * rate, i = Math.floor(x), f = x - i;
  const a = hash01(bin, i, ch) * 2 - 1, b = hash01(bin, i + 1, ch) * 2 - 1;
  const w = (1 - Math.cos(Math.PI * f)) / 2;
  return a + (b - a) * w;
}
const gauss = (x, c, s) => Math.exp(-0.5 * ((x - c) / s) ** 2);
const octaves = (f, f0) => Math.log2(Math.max(f, 1e-9) / f0);

// ---------------------------------------------------------------- audio

export const AUDIO_SPECTRUM_FLOOR_DB = -90;
export const FM_AUDIO_LIMIT_HZ = 15000; // FM broadcast-style audio band limit (stereo pilot at 19 kHz)

// Voice level in dB below full scale at f (Hz): a smooth envelope for a speech-like source.
function voiceDb(f, t) {
  const f0 = 130 + 18 * Math.sin(0.9 * t) + 6 * Math.sin(2.3 * t + 1); // slow pitch movement
  const shift = 1 + 0.08 * Math.sin(0.7 * t + 0.5); // formants drift a little
  let d = -26 - 6 * Math.max(0, octaves(f, 250)); // -6 dB/octave above ~250 Hz
  if (f < 90) d -= 24 * octaves(90, Math.max(f, 1)); // high-pass below 90 Hz
  d += 7 * gauss(Math.log2(f), Math.log2(500 * shift), 0.28);
  d += 5 * gauss(Math.log2(f), Math.log2(1500 * shift), 0.28);
  d += 4 * gauss(Math.log2(f), Math.log2(2500 * shift), 0.28);
  d += 8 * gauss(Math.log2(f), Math.log2(6000), 0.32) * (0.5 + 0.5 * Math.max(0, Math.sin(1.7 * t))); // sibilance comes and goes
  if (f > 8000) d -= 24 * octaves(f, 8000); // steep above 8 kHz
  if (f < 4000) d += 3 * Math.cos(TWO_PI * f / f0) * Math.min(1, 800 / Math.max(f, 1)); // harmonic comb, strongest low down
  d += 3 * Math.sin(0.6 * t + 1.3); // breathing
  return d;
}

// Music level for one channel (0 = L, 1 = R): pink-like tilt, strong bass, roll-off near 17 kHz, channel-specific instruments.
function musicDb(f, t, ch) {
  let d = -24 - 3 * Math.max(0, octaves(f, 100)); // -3 dB/octave per Hz (pink) from 100 Hz
  d += 9 * gauss(Math.log2(f), Math.log2(70), 0.45) * (0.8 + 0.2 * Math.sin(TWO_PI * 0.45 * t + ch)); // kick and bass
  if (f < 35) d -= 24 * octaves(35, Math.max(f, 1));
  if (ch === 0) { // left: bass guitar and a rhythm guitar
    d += 8 * gauss(Math.log2(f), Math.log2(110), 0.4) + 7 * gauss(Math.log2(f), Math.log2(800), 0.5) - 1.5 * octaves(f, 1000);
  } else { // right: keys and hi-hat
    d += 8 * gauss(Math.log2(f), Math.log2(2500), 0.5) + 10 * gauss(Math.log2(f), Math.log2(9000), 0.45) * (0.6 + 0.4 * Math.sin(TWO_PI * 0.7 * t));
    d -= 6 * gauss(Math.log2(f), Math.log2(110), 0.4) + 1.5 * octaves(f, 1000);
  }
  if (f > 16000) d -= 48 * octaves(f, 16000); // typical IEM mix roll-off
  d += 2 * Math.sin(TWO_PI * 0.2 * t + 2 * ch);
  return d;
}

/**
 * audioSpectrum({ kind, stereo, nBins, fMaxHz, t, preEmphasisTauUs, deEmphasised })
 *   -> { freqsHz, levelsDb, levelsDbR (or null), floorDb, peakHz, notes }
 * Simulated source, not real audio: voice-like for kind 'mic', music-like for 'iem' (L and R differ when stereo, else mono and
 * levelsDbR is null). dB relative to full scale, floored at floorDb. Slow deterministic variation from t (repeatable).
 * preEmphasisTauUs > 0 adds the pre-emphasis boost emphasisMagnitudeDb(f, tau) (dB), unless deEmphasised is true (the audio
 * as heard after de-emphasis, so the boost is undone). FM stereo IEM audio is cut above 15 kHz (steeply) as in FM broadcast.
 */
export function audioSpectrum({ kind = 'mic', stereo = false, nBins = 256, fMaxHz = 20000, t = 0, preEmphasisTauUs = 0, deEmphasised = false } = {}) {
  const n = Math.max(2, Math.floor(nBins));
  const isIem = kind === 'iem';
  const freqsHz = Array.from({ length: n }, (_, i) => (i / (n - 1)) * fMaxHz);
  const pre = preEmphasisTauUs > 0 && !deEmphasised;
  const chan = (ch) => freqsHz.map((f, i) => {
    const ff = Math.max(f, 20); // avoid log of zero at DC; DC itself is shown at the 20 Hz level
    let d = isIem ? musicDb(ff, t, ch) : voiceDb(ff, t);
    d += 1.5 * wobble(i, t, ch); // fine fluctuation, +-1.5 dB
    if (isIem && stereo && f > FM_AUDIO_LIMIT_HZ) d -= 60 * octaves(f, FM_AUDIO_LIMIT_HZ) + 20;
    if (pre) d += emphasisMagnitudeDb(f, preEmphasisTauUs, 'pre');
    return Math.max(AUDIO_SPECTRUM_FLOOR_DB, d);
  });
  const levelsDb = chan(0);
  const levelsDbR = isIem && stereo ? chan(1) : null;
  let pk = 0;
  for (let i = 1; i < n; i++) if (levelsDb[i] > levelsDb[pk]) pk = i;
  const notes = ['Simulated source, not real audio: ' + (isIem ? 'music-like' : 'voice-like') + ' spectrum shape, illustrative levels.'];
  if (pre) notes.push(`Pre-emphasis of ${preEmphasisTauUs} us applied (adds ${emphasisMagnitudeDb(10000, preEmphasisTauUs, 'pre').toFixed(1)} dB at 10 kHz).`);
  if (isIem && stereo) notes.push('FM stereo audio is limited to 15 kHz.');
  return { freqsHz, levelsDb, levelsDbR, floorDb: AUDIO_SPECTRUM_FLOOR_DB, peakHz: freqsHz[pk], notes };
}

// ---------------------------------------------------------------- RF

/** Bessel function of the first kind J_n(x), integer n >= 0, by its power series (accurate for x up to about 30). */
export function besselJ(n, x) {
  const m = Math.abs(n);
  let term = 1;
  for (let k = 1; k <= m; k++) term *= (x / 2) / k;
  let sum = term;
  for (let k = 1; k < 200; k++) {
    term *= -((x / 2) * (x / 2)) / (k * (k + m));
    sum += term;
    if (Math.abs(term) < 1e-18 * Math.abs(sum) && k > x) break;
  }
  return (n < 0 && m % 2 === 1) ? -sum : sum;
}

/** Carson bandwidth (kHz) of FM: 2 (deviation + highest audio frequency). */
export const carsonBwKhz = (devKhz, audioMaxKhz) => 2 * (devKhz + audioMaxKhz);

// Channel filter, power gain in dB at an offset (kHz) from the carrier: flat inside the window, then skirts at 60 dB per quarter
// of a channel width beyond the edge, capped at -70 dB. Illustrative (a real filter depends on the receiver).
function filterDb(offKhz, chBwKhz) {
  const excess = Math.abs(offKhz) - chBwKhz / 2;
  return excess <= 0 ? 0 : -Math.min(70, 60 * excess / (chBwKhz / 4));
}

/**
 * rfSpectrum({ carrierMHz, rxLevelDbm, mode, devKhz, audioMaxKhz, occupiedBwKhz, channelBwKhz, noiseFloorDbm, spanKhz, nBins, t })
 *   -> { freqsMHz, levelsDbm, noiseDbm, noiseChannelDbm, rbwKhz, window: { lowMHz, highMHz }, carrierLevelDbm, marginToNoiseDb,
 *        bwKhz, sidebands: [{ offsetKhz, levelDb }], clipsAtFilter, notes }
 * One selected carrier only: no other devices, no intermodulation, no interference.
 * Display unit: dBm in a resolution bandwidth rbwKhz (about 2.5 display bins), like a spectrum analyser. A narrow line therefore
 * reads its true power; a signal spread over a bandwidth B reads rxLevel + 10 log10(rbw / B); noise reads
 * noiseFloorDbm + 10 log10(rbw / channelBw) (noiseDbm, flat). noiseChannelDbm = noiseFloorDbm is the caller's noise in the whole
 * channel, and marginToNoiseDb = rxLevelDbm - noiseFloorDbm is the planner's carrier-to-noise ratio.
 * FM: carrier plus sidebands of a single tone with modulation index beta = dev / fm (fm = min(audioMax, 5 kHz)); the line powers
 * are Bessel J_n(beta)^2 (sidebands lists them in dB relative to the unmodulated carrier, down to -60 dB). The Carson edges are
 * at +- (dev + audioMax). Digital: flat-top of occupiedBwKhz (default 75 percent of the channel) with short raised-cosine edges.
 * The receiver channel filter (window, centred on the carrier) shapes both the signal and the noise.
 */
export function rfSpectrum({
  carrierMHz, rxLevelDbm, mode = 'fm', devKhz = 40, audioMaxKhz = 15, occupiedBwKhz, channelBwKhz = 200, noiseFloorDbm,
  spanKhz, nBins = 256, t = 0,
} = {}) {
  const n = Math.max(8, Math.floor(nBins));
  const span = Number.isFinite(spanKhz) && spanKhz > 0 ? spanKhz : 4 * channelBwKhz;
  const binKhz = span / (n - 1);
  const sigma = binKhz; // display smoothing (Gaussian)
  const rbwKhz = sigma * Math.sqrt(TWO_PI);
  const digital = mode === 'digital';
  const occ = digital ? (Number.isFinite(occupiedBwKhz) && occupiedBwKhz > 0 ? occupiedBwKhz : 0.75 * channelBwKhz) : null;
  const bwKhz = digital ? occ : carsonBwKhz(devKhz, audioMaxKhz);
  const floor = Number.isFinite(noiseFloorDbm) ? noiseFloorDbm : -110;
  const pSig = 10 ** (rxLevelDbm / 10); // mW, whole signal at the receiver
  const offs = Array.from({ length: n }, (_, i) => (i / (n - 1) - 0.5) * span);
  const freqsMHz = offs.map((o) => carrierMHz + o / 1000);

  // signal power density, mW per kHz, before the channel filter
  let dens;
  let sidebands = [];
  const notes = [];
  if (digital) {
    const edge = 0.1 * occ; // raised-cosine edge width on each side
    dens = offs.map((o) => {
      const a = Math.abs(o), h = occ / 2;
      if (a >= h) return 0;
      const shape = a <= h - edge ? 1 : 0.5 * (1 + Math.cos(Math.PI * (a - (h - edge)) / edge));
      return shape;
    });
    // normalise so the integral equals pSig
    const integral = dens.reduce((s, v) => s + v, 0) * binKhz;
    const k = integral > 0 ? pSig / integral : 0;
    dens = dens.map((v) => v * k);
    notes.push('Digital signal shown as a flat-top block with soft edges; the real shape depends on the system (illustrative).');
    if (!Number.isFinite(occupiedBwKhz)) notes.push('Occupied bandwidth not given: 75 percent of the channel assumed.');
  } else {
    const fm = Math.min(audioMaxKhz, 5);
    const beta = devKhz / fm;
    const nMax = Math.ceil(beta + 3) + 2;
    const lines = [];
    for (let k = -nMax; k <= nMax; k++) {
      const j = besselJ(k, beta);
      lines.push({ offsetKhz: k * fm, p: pSig * j * j });
    }
    sidebands = lines.filter((l) => l.p > 0 && 10 * L10(l.p / pSig) > -60).map((l) => ({ offsetKhz: l.offsetKhz, levelDb: 10 * L10(l.p / pSig) }));
    dens = offs.map((o) => lines.reduce((s, l) => s + l.p * Math.exp(-0.5 * ((o - l.offsetKhz) / sigma) ** 2) / (sigma * Math.sqrt(TWO_PI)), 0));
    notes.push(`Sidebands shown for a single tone of ${fm} kHz (modulation index ${beta.toFixed(1)}); real programme audio fills in between them. Carson edges at +-${(bwKhz / 2).toFixed(0)} kHz.`);
  }

  const noiseDens = 10 ** (floor / 10) / channelBwKhz; // mW per kHz
  const noiseDbm = floor + 10 * L10(rbwKhz / channelBwKhz);
  const levelsDbm = offs.map((o, i) => {
    const h = 10 ** (filterDb(o, channelBwKhz) / 10);
    const sig = dens[i] * h * rbwKhz;
    const nz = noiseDens * h * rbwKhz * 10 ** (1.2 * wobble(i, t, 7, 3) / 10); // +-1.2 dB ripple on the noise
    return 10 * L10(sig + nz + 1e-30);
  });
  notes.push('Receiver channel filter drawn with illustrative skirts; window assumed centred on the carrier.');
  const clipsAtFilter = bwKhz > channelBwKhz;
  if (clipsAtFilter) notes.push('The signal is wider than the receiver channel filter: its edges are cut.');
  return {
    freqsMHz, levelsDbm, noiseDbm, noiseChannelDbm: floor, rbwKhz,
    window: { lowMHz: carrierMHz - channelBwKhz / 2000, highMHz: carrierMHz + channelBwKhz / 2000 },
    carrierLevelDbm: rxLevelDbm, marginToNoiseDb: rxLevelDbm - floor, bwKhz, sidebands, clipsAtFilter, notes,
  };
}
