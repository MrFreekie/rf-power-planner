// Display maths for the Modulation lab (educational). Pure module: no DOM, no Math.random.
// This is NOT the link budget. Carrier frequencies on screen are scaled down; spectra use real kHz.

import { audioSnrDb, stereoBlend } from './mpx.js';

export const TAU = 2 * Math.PI;
export const CHANNEL_KHZ = 200;
export const BESSEL_NULL = 2.404826; // first zero of J0: the FM carrier vanishes at this modulation index
export const TONE_KEY_DEFAULT_KHZ = 32.768; // analogue mic tone-key (researched, second-hand); NOT the 19 kHz stereo pilot
export const STEREO_PILOT_KHZ = 19;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---- messages: sums of tones, so the phase integral (needed for FM) is exact ------------------
// freq is in units of the base tone (1 = the modulation frequency slider).
const TONES = {
  sine: [{ a: 1, f: 1, ph: 0 }],
  twotone: [{ a: 0.6, f: 1, ph: 0 }, { a: 0.4, f: 1.75, ph: 1.1 }],
  // "speech-like": formant-ish partials with beating pairs that make a syllable-like swelling envelope
  speech: [
    { a: 0.30, f: 0.45, ph: 0 }, { a: 0.30, f: 0.55, ph: 0.4 },
    { a: 0.22, f: 1.0, ph: 1.3 }, { a: 0.22, f: 1.12, ph: 2.0 },
    { a: 0.16, f: 1.9, ph: 0.7 }, { a: 0.12, f: 2.3, ph: 2.6 }, { a: 0.08, f: 3.1, ph: 4.0 },
  ],
};
export const MESSAGE_KINDS = Object.freeze(Object.keys(TONES));
export const MESSAGE_LABELS = Object.freeze({ sine: 'Sine tone', twotone: 'Two tones', speech: 'Speech-like' });

const normCache = {};
function norm(kind) { // peak of the raw sum over a long span, so |message| <= 1
  if (normCache[kind]) return normCache[kind];
  let pk = 0; const tones = TONES[kind];
  for (let i = 0; i < 6000; i++) { const t = i * 0.01; let v = 0; for (const o of tones) v += o.a * Math.cos(TAU * o.f * t + o.ph); pk = Math.max(pk, Math.abs(v)); }
  return (normCache[kind] = pk || 1);
}
export function messageTones(kind) { const n = norm(kind); return (TONES[kind] || TONES.sine).map((o) => ({ ...o, a: o.a / n })); }
/** Message value in [-1, 1] at display time t (seconds) with base frequency f0 (Hz of display time). */
export function message(kind, t, f0 = 0.5) { let v = 0; for (const o of messageTones(kind)) v += o.a * Math.cos(TAU * o.f * f0 * t + o.ph); return v; }
/** Integral of the message from 0 to t (exact), used for FM phase. */
export function messageIntegral(kind, t, f0 = 0.5) { let v = 0; for (const o of messageTones(kind)) { const w = TAU * o.f * f0; v += (o.a * (Math.sin(w * t + o.ph) - Math.sin(o.ph))) / w; } return v; }

// ---- AM -----------------------------------------------------------------------------------
/** AM sample: (1 + m x(t)) cos(2 pi fc t). depth m as a fraction (1.2 = 120 %). */
export function amSample(kind, t, depth, fc, f0 = 0.5) { return (1 + depth * message(kind, t, f0)) * Math.cos(TAU * fc * t); }
/** Envelope an ideal envelope detector shows: |1 + m x|. Over-modulation (m > 1) folds the negative part back: distortion. */
export function amEnvelope(kind, t, depth, f0 = 0.5) { return Math.abs(1 + depth * message(kind, t, f0)); }
/** Recovered audio error versus the message: 0 up to 100 % depth, rising above (the fold-over). RMS over one display span. */
export function amDistortion(kind, depth, f0 = 0.5) {
  if (depth <= 1) return 0;
  let e = 0, n = 0;
  for (let i = 0; i < 400; i++) { const t = i * 0.01 / f0; const x = message(kind, t, f0); const rec = (Math.abs(1 + depth * x) - 1) / depth; e += (rec - x) * (rec - x); n++; }
  return Math.sqrt(e / n);
}
/** Sideband powers: carrier 1, each tone's pair at (m a / 2). Returns [{ khz, amp, kind }] for the given base audio frequency. */
export function amSpectrum(kind, depth, fmKhz) {
  const out = [{ khz: 0, amp: 1, kind: 'carrier' }];
  for (const o of messageTones(kind)) { const a = depth * Math.abs(o.a) / 2; out.push({ khz: o.f * fmKhz, amp: a, kind: 'usb' }, { khz: -o.f * fmKhz, amp: a, kind: 'lsb' }); }
  return out;
}
export function amBandwidthKhz(kind, fmKhz) { return 2 * Math.max(...messageTones(kind).map((o) => o.f * fmKhz)); }
/** Power in the sidebands as a fraction of total, for single-tone AM: m^2/2 / (1 + m^2/2). Shows why 100 % is not "free". */
export function amSidebandPowerShare(depth) { const s = depth * depth / 2; return s / (1 + s); }

// ---- FM -----------------------------------------------------------------------------------
export const carsonBwKhz = (devKhz, fmKhz) => 2 * (devKhz + fmKhz);
export const modIndex = (devKhz, fmKhz) => devKhz / fmKhz;
/**
 * Bessel function of the first kind J_n(x), integer n >= 0, by Simpson integration of
 * (1/pi) * integral_0^pi cos(n tau - x sin tau) dtau. Accurate to better than 1e-8 for |x| < 40.
 */
export function besselJ(n, x) {
  const N = 240, h = Math.PI / N; let s = 0;
  for (let i = 0; i <= N; i++) { const tau = i * h; const w = i === 0 || i === N ? 1 : i % 2 ? 4 : 2; s += w * Math.cos(n * tau - x * Math.sin(tau)); }
  return (s * h) / (3 * Math.PI);
}
/** FM line spectrum for a sine tone: carrier at 0 and sidebands at +-n fm with amplitude |J_n(beta)|. Lines below `floor` are dropped. */
export function fmSpectrum(beta, fmKhz, { maxLines = 60, floor = 1e-3 } = {}) {
  const out = [];
  for (let n = 0; n <= maxLines; n++) {
    const a = Math.abs(besselJ(n, beta));
    if (n > Math.ceil(beta) + 3 && a < floor) break;
    if (n === 0) out.push({ khz: 0, amp: a, n: 0, kind: 'carrier' });
    else if (a >= floor * 0.2) out.push({ khz: n * fmKhz, amp: a, n }, { khz: -n * fmKhz, amp: a, n: -n });
  }
  return out;
}
/** Instantaneous frequency offset in kHz: deviation * x(t). */
export const fmInstFreqKhz = (kind, t, devKhz, f0 = 0.5) => devKhz * message(kind, t, f0);
/** FM sample with the carrier shown at `fcDisp` Hz and the visual squeeze k = fraction of fcDisp per full deviation. */
export function fmSample(kind, t, fcDisp, squeeze, f0 = 0.5) {
  return Math.cos(TAU * fcDisp * t + TAU * fcDisp * squeeze * messageIntegral(kind, t, f0));
}
/** Visual squeeze: 100 kHz deviation squeezes the displayed carrier by about +-67 %. */
export const fmSqueeze = (devKhz) => clamp(devKhz / 150, 0, 0.7);
/** FM improvement of audio SNR over carrier SNR (above threshold), dB: 10 log10(3 beta^2 (beta + 1)), beta = dev / audio top. */
export function fmImprovementDb(devKhz, audioTopKhz) { const b = devKhz / audioTopKhz; return 10 * Math.log10(3 * b * b * (b + 1)); }
/** Illustrative FM threshold: noise bandwidth grows with Carson, so a wider signal hits the threshold at a higher input level. */
export const thresholdRiseDb = (bwKhz, refKhz) => 10 * Math.log10(bwKhz / refKhz);
export const DEVIATION_PRESETS = Object.freeze([
  { id: 'dev40', devKhz: 40, label: '+-40 kHz (SKM 5200-II class)' },
  { id: 'dev45', devKhz: 45, label: '+-45 kHz (UR4D class)' },
  { id: 'dev75', devKhz: 75, label: '+-75 kHz (broadcast FM)' },
  { id: 'dev12', devKhz: 12.5, label: '+-12.5 kHz (narrowband two-way)' },
]);
/** Own fallback table when fmDeviationComparison is not usable: Carson with 15 kHz audio (3 kHz for the narrowband preset). */
export function deviationRows(audioTopKhz = 15, presets = DEVIATION_PRESETS) {
  const ref = presets[0];
  return presets.map((p) => {
    const top = p.devKhz < 20 ? Math.min(3, audioTopKhz) : audioTopKhz, bw = carsonBwKhz(p.devKhz, top);
    return { ...p, audioTopKhz: top, beta: p.devKhz / top, carsonKhz: bw, improvementDb: fmImprovementDb(p.devKhz, top), thresholdRiseDb: thresholdRiseDb(bw, carsonBwKhz(ref.devKhz, audioTopKhz)), fits200: bw <= CHANNEL_KHZ };
  });
}

// ---- digital --------------------------------------------------------------------------------
export const DIGITAL_MODES = Object.freeze(['ASK', 'FSK', 'BPSK', 'QPSK', '16QAM']);
export const bitsPerSymbol = (m) => ({ ASK: 1, FSK: 1, BPSK: 1, QPSK: 2, '16QAM': 4 })[m] || 1;
/** Constellation points normalised to unit average symbol energy. ASK = on/off keying, FSK = two orthogonal tones (I and Q axes here). */
const cCache = {};
export function constellation(mode) {
  if (cCache[mode]) return cCache[mode];
  let pts;
  if (mode === 'ASK') pts = [[0, 0], [1, 0]];
  else if (mode === 'FSK') pts = [[1, 0], [0, 1]];
  else if (mode === 'BPSK') pts = [[-1, 0], [1, 0]];
  else if (mode === 'QPSK') pts = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  else { const L = [-3, -1, 1, 3]; pts = []; for (const q of L) for (const i of L) pts.push([i, q]); }
  const e = pts.reduce((s, [i, q]) => s + i * i + q * q, 0) / pts.length;
  const k = 1 / Math.sqrt(e);
  return (cCache[mode] = pts.map(([i, q]) => [i * k, q * k]));
}
/** Gray-ish bit labels: index -> bit string (natural binary is fine for the demo; Gray for QAM rows/cols). */
export function symbolBits(mode, idx) { const b = bitsPerSymbol(mode); return idx.toString(2).padStart(b, '0'); }

/** Deterministic hash random in [0,1) from integers. */
export function hash01(a, b = 0) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** Standard normal from two hashes (Box-Muller), deterministic in (k, salt). */
export function gauss(k, salt = 0) {
  const u = Math.max(1e-12, hash01(k, salt * 2 + 1)), v = hash01(k, salt * 2 + 2);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}
/** Symbol index k of a mode: pseudo-random but repeatable. */
export const symbolAt = (mode, k) => Math.floor(hash01(k, 77) * constellation(mode).length) % constellation(mode).length;

/**
 * Received symbol k at the given Es/N0 (dB): the transmitted point plus Gaussian noise of sigma^2 = 1 / (2 snr) per axis
 * (unit average symbol energy). Returns { tx, rx: [i, q], decided, error }.
 */
export function receiveSymbol(mode, k, snrDb) {
  const pts = constellation(mode), tx = symbolAt(mode, k);
  const sigma = Math.sqrt(1 / (2 * Math.pow(10, snrDb / 10)));
  const rx = [pts[tx][0] + sigma * gauss(k, 1), pts[tx][1] + sigma * gauss(k, 2)];
  let best = 0, bd = Infinity;
  pts.forEach((p, i) => { const d = (p[0] - rx[0]) ** 2 + (p[1] - rx[1]) ** 2; if (d < bd) { bd = d; best = i; } });
  return { tx, rx, decided: best, error: best !== tx };
}
/** Symbol error count over symbols [k0, k0 + n). */
export function symbolErrors(mode, k0, n, snrDb) { let e = 0; for (let k = k0; k < k0 + n; k++) if (receiveSymbol(mode, k, snrDb).error) e++; return e; }

/** Gaussian tail Q(x) via erfc (Abramowitz-Stegun 7.1.26, abs error < 1.5e-7). */
export function qfunc(x) {
  const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z);
  const erfc = x >= 0 ? y : 2 - y; // erfc(z) = y for z >= 0; Q(x) = erfc(x/sqrt2)/2
  return erfc / 2;
}
/** Theoretical bit error rate versus Es/N0 (dB), coherent detection, ideal. */
export function theoryBer(mode, snrDb) {
  const s = Math.pow(10, snrDb / 10);
  if (mode === 'BPSK') return qfunc(Math.sqrt(2 * s));
  if (mode === 'QPSK') return qfunc(Math.sqrt(s));
  if (mode === '16QAM') return 0.75 * qfunc(Math.sqrt(s / 5));
  return qfunc(Math.sqrt(s)); // ASK (on-off) and coherent orthogonal FSK
}
/** Es/N0 (dB) at which the theoretical BER reaches `target` (bisection), for the "cliff" marker. */
export function snrForBer(mode, target = 1e-3) { let lo = -10, hi = 40; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (theoryBer(mode, m) > target) lo = m; else hi = m; } return (lo + hi) / 2; }

/** Digital baseband sample at time t in symbols (carrier at cps cycles per symbol), for the scaled time-domain view. */
export function digitalSample(mode, t, cps = 3, bitsOf = (k) => symbolAt(mode, k)) {
  const k = Math.floor(t), idx = bitsOf(k), pts = constellation(mode), p = pts[idx];
  if (mode === 'FSK') return Math.cos(TAU * t * (idx ? cps * 1.6 : cps * 0.8));
  return p[0] * Math.cos(TAU * cps * t) - p[1] * Math.sin(TAU * cps * t);
}
/** Digital spectrum: sinc^2 main lobe of rate Rs centred on 0 (ASK/PSK/QAM), two lobes for FSK; dB relative to peak. */
export function digitalSpectrumDb(mode, khz, rateKsym) {
  const sinc2 = (x) => { if (Math.abs(x) < 1e-9) return 1; const v = Math.sin(Math.PI * x) / (Math.PI * x); return v * v; };
  const f = khz / rateKsym;
  let p;
  if (mode === 'FSK') p = 0.5 * sinc2(f - 0.9) + 0.5 * sinc2(f + 0.9);
  else p = sinc2(f);
  return 10 * Math.log10(Math.max(p, 1e-9));
}
export const digitalBwKhz = (mode, rateKsym) => (mode === 'FSK' ? 3.8 * rateKsym : 2 * rateKsym); // null-to-null: ~2 Rs (FSK ~ 3.8 Rs for this spacing)

// ---- stereo FM (MPX) ---------------------------------------------------------------------------
/** Baseband composite sample. Audio tone frequencies are in display units where 1 Hz stands for 1 kHz, so 19 and 38 are true ratios. */
export function mpxComposite(t, { l = 1, r = 1, pilot = true, lrScale = 1, rds = false, fl = 1, fr = 1.37 } = {}) {
  const L = l * Math.sin(TAU * fl * t), R = r * Math.sin(TAU * fr * t);
  let v = 0.45 * (L + R) / 2 + 0.09 * (pilot ? Math.sin(TAU * 19 * t) : 0);
  v += 0.45 * ((L - R) / 2) * lrScale * Math.sin(TAU * 38 * t);
  if (rds) v += 0.035 * Math.sin(TAU * 57 * t) * Math.sign(Math.sin(TAU * 1.1875 * t * 2));
  return v;
}
/** Baseband spectrum lines/bands in kHz with levels in dB (relative to 100 % deviation) for the picture. */
export function mpxBands({ pilot = true, lrScale = 1, rds = false, leak = false } = {}) {
  const lr = lrScale > 0.001 ? 20 * Math.log10(0.45 * lrScale) : -120;
  const out = [
    { id: 'lpr', label: 'L+R', f0: 0.03, f1: 15, db: 20 * Math.log10(0.45), kind: 'band' },
    { id: 'pilot', label: '19 kHz pilot', f0: 19, f1: 19, db: pilot ? 20 * Math.log10(0.09) : -120, kind: 'line' },
    { id: 'lmr', label: 'L-R (DSB-SC around 38 kHz)', f0: 23, f1: 53, db: lr, kind: 'band' },
    { id: 'sc', label: '38 kHz suppressed', f0: 38, f1: 38, db: -120, kind: 'null' },
  ];
  if (rds) out.push({ id: 'rds', label: 'RDS 57 kHz', f0: 55.5, f1: 58.5, db: 20 * Math.log10(0.035), kind: 'band' });
  if (leak) out.push({ id: 'leak', label: 'console 17-20 kHz content', f0: 17, f1: 20, db: -22, kind: 'leak' });
  return out;
}

// ---- radio-mic tone-key squelch gate ------------------------------------------------------------
export const GATE_SCENARIOS = Object.freeze(['own', 'fade', 'interferer', 'cycle', 'iem']);
export const GATE_LABELS = Object.freeze({ own: 'Own transmitter', fade: 'Transmitter fades out', interferer: 'Interferer (no tone)', cycle: 'Auto cycle', iem: 'Stereo IEM instead of a mic' });
export const GATE_CYCLE_S = 12;
/**
 * What the receiver sees at scenario time t (seconds).
 * rf: carrier above the noise-squelch threshold (0..1 level), tone: tone-key amplitude at the detector (0..1), audio: programme present.
 */
export function gateInputs(scenario, t) {
  const fade = (tl) => { const k = tl < 1 ? 1 : clamp(1 - (tl - 1) / 1.2, 0, 1); return { phase: 'fade', rf: 0.2 + 0.65 * k, tone: k < 0.5 ? 0 : k, audio: k > 0 }; };
  if (scenario === 'cycle') {
    const u = ((t % GATE_CYCLE_S) + GATE_CYCLE_S) % GATE_CYCLE_S;
    if (u < 4) return { phase: 'own', rf: 0.85, tone: 1, audio: true };
    if (u < 6) return fade(u - 4 + 1 > 0 ? u - 4 + 1 : 0);
    if (u < 10) return { phase: 'interferer', rf: 0.9, tone: 0, audio: true };
    return { phase: 'own', rf: 0.85, tone: 1, audio: true };
  }
  if (scenario === 'fade') return fade(((t % 4) + 4) % 4);
  if (scenario === 'interferer') return { phase: 'interferer', rf: 0.9, tone: 0, audio: true };
  if (scenario === 'iem') return { phase: 'iem', rf: 0.9, tone: 0, audio: true };
  return { phase: 'own', rf: 0.85, tone: 1, audio: true };
}
/** The gate: AND of RF above threshold and tone detected (with hysteresis via prevOpen). */
export function gateOpen({ rf, tone }, prevOpen = false, { rfThresh = 0.3, toneThresh = 0.5, toneHyst = 0.15 } = {}) {
  const toneOk = prevOpen ? tone >= toneThresh - toneHyst : tone >= toneThresh;
  return rf >= rfThresh && toneOk;
}
/** What a plain noise squelch (no tone) would do: opens on any strong enough carrier. */
export const noiseSquelchOpen = ({ rf }, rfThresh = 0.3) => rf >= rfThresh;

// ---- link presets for 'Use this scene's numbers' -----------------------------------------------
/** Map the current link/result onto lab parameters (read-only). All inputs optional. */
export function labFromLink({ kind = 'mic', digital = false, channelBwKhz = 200, cnrDb = null, snrDb = null, devKhz = null } = {}) {
  // nominal deviation of the selected transmitter preset when the scene carries one, else an illustrative default
  const dev = Number.isFinite(devKhz) && devKhz > 0 ? devKhz : kind === 'iem' ? 48 : 40;
  const out = { mode: digital ? 'digital' : 'fm', devKhz: dev, channelKhz: channelBwKhz, cnrDb: Number.isFinite(cnrDb) ? cnrDb : null };
  const s = Number.isFinite(snrDb) ? snrDb : cnrDb;
  out.snrDb = Number.isFinite(s) ? clamp(Math.round(s), -5, 40) : 25;
  return out;
}

/** Whether a spectrum fits the channel: occupied bandwidth versus channel, with a status word. */
export function channelFit(bwKhz, channelKhz = CHANNEL_KHZ) { return { fits: bwKhz <= channelKhz, pct: Math.round((100 * bwKhz) / channelKhz), status: bwKhz <= channelKhz * 0.9 ? 'pass' : bwKhz <= channelKhz ? 'marginal' : 'fail' }; }

// ---- Mid/Side (IEM) ------------------------------------------------------------------------------
// General engineering practice for stereo FM/MPX feeds, not manufacturer-specific. M = (L+R)/2 travels as plain baseband,
// S = (L-R)/2 as DSB-SC around the suppressed 38 kHz subcarrier, with the 19 kHz pilot. They share one deviation budget.

export const msFromLR = (l, r) => ({ m: (l + r) / 2, s: (l - r) / 2 });
export const lrFromMS = (m, s) => ({ l: m + s, r: m - s });
/** What a mono receiver plays: the sum, which is M. Pure side content (l = -r) cancels exactly. */
export const monoSum = (l, r) => (l + r) / 2;
/** Level change (dB) of content with mid amplitude m and side amplitude s when summed to mono: 20 log10(|m| / hypot(m, s)). */
export const monoLossDb = (m, s) => (Math.abs(m) < 1e-12 ? -Infinity : 20 * Math.log10(Math.abs(m) / Math.hypot(m, s)));
/** Goniometer (phase scope) point: vertical = mono (L+R), horizontal = side (R-L). */
export const gonioPoint = (l, r) => ({ x: (r - l) / Math.SQRT2, y: (l + r) / Math.SQRT2 });

export const MS_SOURCES = Object.freeze([
  { id: 'vocal', label: 'Vocal / click (centre)', a: 0.5, fd: 2.0, fHz: 1000, l: 1, r: 1, hf: 0.2 },
  { id: 'left', label: 'Instrument hard left', a: 0.4, fd: 3.3, fHz: 2000, l: 1, r: 0, hf: 0.4 },
  { id: 'right', label: 'Instrument hard right', a: 0.4, fd: 4.7, fHz: 3000, l: 0, r: 1, hf: 0.4 },
  { id: 'amb', label: 'Wide ambience', a: 0.3, fd: 6.1, fd2: 7.3, fHz: 8000, hf: 0.8, amb: true },
  { id: 'bass', label: 'Bass (partly out of phase)', a: 0.6, fd: 1.0, fHz: 60, l: 0.8, r: -0.4, hf: 0 },
]);
export const MS_DEFAULTS = Object.freeze({ srcs: Object.freeze({ vocal: true, left: true, right: true, amb: true, bass: true }), hp: 0, width: 1, boost: 0, limit: 1 });
export const PILOT_FRACTION = 0.09;
export const MS_BUDGET_TARGET = 0.8; // default mix peaks at 80 % of the deviation limit including the pilot

/** 2nd-order Butterworth high-pass magnitude at fHz for corner fcHz (0 = off). */
export const hpGain = (fHz, fcHz) => (fcHz > 0 ? 1 / Math.sqrt(1 + Math.pow(fcHz / fHz, 4)) : 1);
/** High-frequency shelf gain on a source whose energy is `hf` (0..1) in the boosted region. */
export const sideShelfGain = (boostDb, hf) => 1 + (Math.pow(10, boostDb / 20) - 1) * hf;
/** Gentle 4:1 compressor above the threshold thr (fraction of full scale); thr >= 1 = off. */
export function sideCompress(x, thr) { const a = Math.abs(x); if (thr >= 1 || a <= thr) return x; return Math.sign(x) * (thr + (a - thr) / 4); }

function srcLR(src, t) {
  const w = src.a * Math.sin(TAU * src.fd * t);
  if (src.amb) return [w, src.a * Math.sin(TAU * src.fd2 * t + 1)];
  return [src.l * w, src.r * w];
}
let msNormV = 0;
function msNorm() {
  if (msNormV) return msNormV;
  let pk = 0;
  for (let i = 0; i < 4000; i++) { const t = i * 0.003; let m = 0, s = 0; for (const src of MS_SOURCES) { const [l, r] = srcLR(src, t); m += (l + r) / 2; s += (l - r) / 2; } pk = Math.max(pk, Math.abs(m) + Math.abs(s)); }
  return (msNormV = ((MS_BUDGET_TARGET - PILOT_FRACTION) / (1 - PILOT_FRACTION)) / pk);
}
/** One time sample of the processed mix: { m, s, sRaw, l, r }. p = { srcs, hp (Hz), width, boost (dB), limit }. */
export function msSample(t, p = MS_DEFAULTS) {
  const N = msNorm(); let m = 0, sRaw = 0, s = 0;
  for (const src of MS_SOURCES) {
    if (!p.srcs[src.id]) continue;
    const [l, r] = srcLR(src, t), mi = (l + r) / 2, si = (l - r) / 2;
    m += mi; sRaw += si; s += si * hpGain(src.fHz, p.hp) * sideShelfGain(p.boost, src.hf) * p.width;
  }
  m *= N; sRaw *= N; s = sideCompress(s * N, p.limit);
  return { m, s, sRaw, l: m + s, r: m - s };
}
/** Peaks and RMS over a long span of display time: { mPk, sPk, sRawPk, compPk, mRms, sRms }. */
export function msPeaks(p = MS_DEFAULTS, n = 1200, span = 12) {
  let mPk = 0, sPk = 0, sRawPk = 0, compPk = 0, m2 = 0, s2 = 0;
  for (let i = 0; i < n; i++) { const o = msSample((i / n) * span, p); mPk = Math.max(mPk, Math.abs(o.m)); sPk = Math.max(sPk, Math.abs(o.s)); sRawPk = Math.max(sRawPk, Math.abs(o.sRaw)); compPk = Math.max(compPk, Math.abs(o.m) + Math.abs(o.s)); m2 += o.m * o.m; s2 += o.s * o.s; }
  return { mPk, sPk, sRawPk, compPk, mRms: Math.sqrt(m2 / n), sRms: Math.sqrt(s2 / n) };
}
/**
 * Shared deviation budget (fractions of the peak deviation limit): audio (M and S together) plus the 19 kHz pilot, RDS and any
 * stray content near the pilot. over = total > 1.
 */
export function compositeBudget({ compPk = 0, mPk = 0, sPk = 0, pilot = PILOT_FRACTION, rds = 0, leak = 0 } = {}) {
  const share = 1 - pilot - rds;
  const total = compPk * share + pilot + rds + leak;
  return { share, mPart: mPk * share, sPart: sPk * share, pilot, rds, leak, total, over: total > 1.0001, headroomDb: total > 0 ? -20 * Math.log10(total) : Infinity };
}
/** Per-source mono behaviour with the current side processing: [{ id, label, lossDb }]. */
export function msSourceMono(p = MS_DEFAULTS) {
  return MS_SOURCES.filter((src) => p.srcs[src.id]).map((src) => {
    let m2 = 0, s2 = 0; const n = 600;
    for (let i = 0; i < n; i++) { const [l, r] = srcLR(src, (i / n) * 12); const mi = (l + r) / 2, si = ((l - r) / 2) * hpGain(src.fHz, p.hp) * sideShelfGain(p.boost, src.hf) * p.width; m2 += mi * mi; s2 += si * si; }
    return { id: src.id, label: src.label, lossDb: monoLossDb(Math.sqrt(m2 / n), Math.sqrt(s2 / n)) };
  });
}
/**
 * Stereo noise penalty at the receiver for carrier-to-noise cnr (dB). Uses the MPX model: the S channel is about stereoPenaltyDb
 * (22 dB) noisier than M, and the decoder blends to mono as the signal weakens (pilot lock supplied by the caller).
 * Returns { blend, monoSnr, sSnr, lrSnr, penaltyDb, sGapDb } with penaltyDb = monoSnr - lrSnr (what stereo costs right now).
 */
export function msNoise(cnr, pilotLocked = true) {
  const blend = pilotLocked ? stereoBlend(cnr) : 0;
  const monoSnr = audioSnrDb(cnr, { stereo: false }), full = audioSnrDb(cnr, { stereo: true, blend: 1 });
  const lrSnr = audioSnrDb(cnr, { stereo: true, blend });
  return { blend, monoSnr, sSnr: full, lrSnr, penaltyDb: monoSnr - lrSnr, sGapDb: monoSnr - full };
}
