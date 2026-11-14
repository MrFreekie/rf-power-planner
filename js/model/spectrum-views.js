// Spectrum views for the bottom bar: a simulated audio spectrum and the RF spectrum of ONE selected carrier. Pure functions,
// no DOM, no Math.random (a small integer hash gives repeatable "life"). Everything here is illustrative where `notes` says so;
// the planner's own numbers (rx level, noise floor) come from the caller. The MPX view uses mpxSpectrum from mpx.js.
import { emphasisMagnitudeDb } from './audio-processing.js';
import { mpxSpectrum } from './mpx.js';
import { AUDIO_SOURCES, clipFraction, clipFractionGaussian, defaultAudioSource, erfcPos, normalizeAudioSource, sourceLinesHz, sourceSpectrumDb } from './audio-source.js';
import { FM_PRESETS } from './fm-presets.js';

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
export const FM_AUDIO_LIMIT_HZ = 15000; // FM STEREO audio band limit only (the 19 kHz pilot needs the band cut at 15 kHz)
/** Default audio ceiling (Hz) of a MONO analogue link (mic or mono IEM): ASSUMED, a low-pass between about 15 and 20 kHz set by the design. */
export const MONO_AUDIO_BANDWIDTH_HZ = 18000;
export const AUDIO_BANDWIDTH_LIMITS_HZ = Object.freeze([1000, 22000]);

/**
 * resolveAudioBandwidthHz({ link, kind, stereo }) -> { hz, source, confidence }
 * The audio ceiling of a link, in order: link.tx.audioBandwidthHz (user value); the transmitter FM preset's audioBwKhz (link.tx.fmPreset;
 * published figures, e.g. 18 kHz for the G4 microphones, 15 kHz for the PSM IEM systems: confidence = the preset's flag);
 * else stereo IEM = FM_AUDIO_LIMIT_HZ (15 kHz, standard, 19 kHz pilot); else MONO_AUDIO_BANDWIDTH_HZ (18 kHz, assumed).
 * A stereo link is never resolved above 15 kHz by the default rule (an explicit value or preset still wins). source is one of
 * 'link' | 'preset' | 'stereo-standard' | 'assumed-mono'.
 */
export function resolveAudioBandwidthHz({ link, kind, stereo } = {}) {
  const lo = AUDIO_BANDWIDTH_LIMITS_HZ[0], hi = AUDIO_BANDWIDTH_LIMITS_HZ[1];
  const tx = link && link.tx;
  if (tx && Number.isFinite(tx.audioBandwidthHz) && tx.audioBandwidthHz >= lo && tx.audioBandwidthHz <= hi) return { hz: tx.audioBandwidthHz, source: 'link', confidence: 'user' };
  const pr = tx && typeof tx.fmPreset === 'string' && Object.prototype.hasOwnProperty.call(FM_PRESETS, tx.fmPreset) ? FM_PRESETS[tx.fmPreset] : null;
  const khz = pr && pr.params ? pr.params.audioBwKhz : undefined;
  if (Number.isFinite(khz) && khz > 0) return { hz: khz * 1000, source: 'preset', confidence: (pr.confidence && pr.confidence.audioBwKhz) || 'assumed' };
  const k = kind || (link && link.kind);
  const st = stereo !== undefined ? !!stereo : !!(link && link.mpx && link.mpx.enabled && k === 'iem');
  if (k === 'iem' && st) return { hz: FM_AUDIO_LIMIT_HZ, source: 'stereo-standard', confidence: 'standard' };
  return { hz: MONO_AUDIO_BANDWIDTH_HZ, source: 'assumed-mono', confidence: 'assumed' };
}

/** Label for the audio band in the baseband view, for example 'AUDIO 0-18 kHz'. */
export const audioBandLabel = (hz) => `AUDIO 0-${+(hz / 1000).toFixed(1)} kHz`;
/** Caption for the mono baseband view with the link's audio ceiling. */
export const monoCaption = (hz) => `Mono carries only the programme audio (0 to ${+(hz / 1000).toFixed(1)} kHz) plus a control tone. Stereo FM adds a 19 kHz pilot and a difference (L-R) signal around 38 kHz.`;

/**
 * audioSpectrum({ kind, stereo, nBins, fMaxHz, t, preEmphasisTauUs, deEmphasised })
 *   -> { freqsHz, levelsDb, levelsDbR (or null), floorDb, peakHz, notes }
 * Simulated source, not real audio: voice-like for kind 'mic', music-like for 'iem' (L and R differ when stereo, else mono and
 * levelsDbR is null). dB relative to full scale, floored at floorDb. Slow deterministic variation from t (repeatable).
 * preEmphasisTauUs > 0 adds the pre-emphasis boost emphasisMagnitudeDb(f, tau) (dB), unless deEmphasised is true (the audio
 * as heard after de-emphasis, so the boost is undone). FM stereo IEM audio is cut above 15 kHz (steeply) as in FM broadcast.
 */
export function audioSpectrum({ kind = 'mic', stereo = false, nBins = 256, fMaxHz = 20000, t = 0, preEmphasisTauUs = 0, deEmphasised = false, distortion, audioBandwidthHz, source, toneHz } = {}) {
  const n = Math.min(8192, Math.max(2, Math.floor(nBins)));
  const isIem = kind === 'iem';
  const sid = normalizeAudioSource(source) || defaultAudioSource(isIem ? 'iem' : 'mic'); // the global audio source; the default by link kind is the old behaviour
  const binHz = fMaxHz / (n - 1);
  const freqsHz = Array.from({ length: n }, (_, i) => (i / (n - 1)) * fMaxHz);
  const pre = preEmphasisTauUs > 0 && !deEmphasised;
  const abw = Number.isFinite(audioBandwidthHz) && audioBandwidthHz > 0 ? audioBandwidthHz : 0;
  const chan = (ch) => freqsHz.map((f, i) => {
    const ff = Math.max(f, 20); // avoid log of zero at DC; DC itself is shown at the 20 Hz level
    let d = sourceSpectrumDb(sid, ff, t, ch, { toneHz, binHz });
    d += 1.5 * wobble(i, t, ch); // fine fluctuation, +-1.5 dB
    if (isIem && stereo && f > FM_AUDIO_LIMIT_HZ && !(abw && abw > FM_AUDIO_LIMIT_HZ)) d -= 60 * octaves(f, FM_AUDIO_LIMIT_HZ) + 20;
    if (abw && f > abw) d -= 60 * octaves(f, abw) + 20; // explicit audio ceiling: steep low-pass
    if (pre) d += emphasisMagnitudeDb(f, preEmphasisTauUs, 'pre');
    return Math.max(AUDIO_SPECTRUM_FLOOR_DB, d);
  });
  let levelsDb = chan(0);
  let levelsDbR = isIem && stereo ? chan(1) : null;
  let pk = 0;
  for (let i = 1; i < n; i++) if (levelsDb[i] > levelsDb[pk]) pk = i;
  const dn = normDistortion(distortion);
  let harmonics = null;
  if (dn) { // overload simulation: harmonic lines, IM skirts (music-like source), raised floor
    const f0 = freqsHz[pk];
    const a = applyAudioDistortion(levelsDb, freqsHz, f0, dn, AUDIO_SOURCES[sid].musicLike, fMaxHz);
    levelsDb = a.levels; harmonics = a.harmonics;
    if (levelsDbR) levelsDbR = applyAudioDistortion(levelsDbR, freqsHz, f0, dn, AUDIO_SOURCES[sid].musicLike, fMaxHz).levels;
  }
  const notes = ['Simulated source, not real audio: ' + (source === undefined ? (isIem ? 'music-like' : 'voice-like') : AUDIO_SOURCES[sid].label.toLowerCase()) + ' spectrum shape, illustrative levels.'];
  if (pre) notes.push(`Pre-emphasis of ${preEmphasisTauUs} us applied (adds ${emphasisMagnitudeDb(10000, preEmphasisTauUs, 'pre').toFixed(1)} dB at 10 kHz).`);
  if (isIem && stereo) notes.push('FM stereo audio is limited to 15 kHz.');
  if (abw) notes.push(`Audio ceiling ${+(abw / 1000).toFixed(1)} kHz: a steep low-pass set by the design of the link (the 15 kHz limit applies only to FM stereo).`);
  if (dn) notes.push(...distortionNotes(dn));
  const out = { freqsHz, levelsDb, levelsDbR, floorDb: AUDIO_SPECTRUM_FLOOR_DB, peakHz: freqsHz[pk], notes, source: sid };
  if (abw) out.audioBandwidthHz = abw;
  if (dn) { out.harmonics = harmonics; out.distortion = dn.echo; }
  return out;
}

// ---------------------------------------------------------------- RF

/**
 * Bessel function of the first kind J_n(x), integer n, any real x. Power series for |x| <= 12; above that Miller's backward
 * recurrence J_{k-1} = (2k/x) J_k - J_{k+1}, normalised with J0 + 2 sum J_2k = 1 (stable for large x, where the series loses all
 * precision). Non-finite x gives NaN. J_{-n} = (-1)^n J_n, J_n(-x) = (-1)^n J_n(x).
 */
export function besselJ(n, x) {
  if (!Number.isFinite(x) || !Number.isFinite(n)) return NaN;
  const m = Math.abs(Math.trunc(n));
  const ax = Math.abs(x);
  let v;
  if (ax === 0) v = m === 0 ? 1 : 0;
  else if (ax <= 12) {
    let term = 1;
    for (let k = 1; k <= m; k++) term *= (ax / 2) / k;
    v = term;
    for (let k = 1; k < 200; k++) {
      term *= -((ax / 2) * (ax / 2)) / (k * (k + m));
      v += term;
      if (Math.abs(term) < 1e-18 * Math.abs(v) && k > ax) break;
    }
  } else {
    if (m > ax + 60) return 0; // far beyond the transition order: negligible
    let N = 2 * Math.ceil((Math.max(m, ax) + 30) / 2);
    N = Math.min(N, 2 * 20000);
    let jp1 = 0, j = 1e-300, norm = 0, target = m === N ? j : 0;
    for (let k = N; k >= 1; k--) {
      const jm1 = (2 * k / ax) * j - jp1;
      jp1 = j; j = jm1;
      if (k - 1 === m) target = j;
      if ((k - 1) % 2 === 0) norm += (k - 1 === 0 ? 1 : 2) * j;
      if (Math.abs(j) > 1e250) { j *= 1e-250; jp1 *= 1e-250; norm *= 1e-250; target *= 1e-250; }
    }
    v = target / norm;
  }
  if (x < 0 && m % 2 === 1) v = -v;
  if (n < 0 && m % 2 === 1) v = -v;
  return v;
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
  spanKhz, nBins = 256, t = 0, distortion,
} = {}) {
  const n = Math.min(4096, Math.max(8, Math.floor(nBins)));
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
    const beta = Math.min(devKhz / fm, 200); // very large indices are shown as 200 (the shape is a box of width 2 dev anyway)
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

  const dn = normDistortion(distortion);
  const rxd = dn && dn.rxActive ? dn : null; // only the receiver front end regrows / desensitises the RF view
  const desenseMul = rxd ? 10 ** (rxd.desenseDb / 10) : 1;
  const noiseDens = 10 ** (floor / 10) / channelBwKhz * desenseMul; // mW per kHz
  const noiseDbm = floor + 10 * L10(rbwKhz / channelBwKhz);
  // IM3 regrowth (illustrative): two shoulders at +-bw, Gaussian sigma bw/4, together imd3Dbc below the signal power
  let shoulder = null;
  if (rxd && rxd.imd3Dbc > -100) {
    const ss = Math.max(bwKhz / 4, 1e-6), pSh = pSig * 10 ** (rxd.imd3Dbc / 10) / 2;
    shoulder = offs.map((o) => pSh * (Math.exp(-0.5 * ((o - bwKhz) / ss) ** 2) + Math.exp(-0.5 * ((o + bwKhz) / ss) ** 2)) / (ss * Math.sqrt(TWO_PI)));
  }
  const levelsDbm = offs.map((o, i) => {
    const h = 10 ** (filterDb(o, channelBwKhz) / 10);
    const sig = (shoulder ? dens[i] + shoulder[i] : dens[i]) * h * rbwKhz;
    const nz = noiseDens * h * rbwKhz * 10 ** (1.2 * wobble(i, t, 7, 3) / 10); // +-1.2 dB ripple on the noise
    return 10 * L10(sig + nz + 1e-30);
  });
  notes.push('Receiver channel filter drawn with illustrative skirts; window assumed centred on the carrier.');
  const clipsAtFilter = bwKhz > channelBwKhz;
  if (clipsAtFilter) notes.push('The signal is wider than the receiver channel filter: its edges are cut.');
  const out = {
    freqsMHz, levelsDbm, noiseDbm, noiseChannelDbm: floor, rbwKhz,
    window: { lowMHz: carrierMHz - channelBwKhz / 2000, highMHz: carrierMHz + channelBwKhz / 2000 },
    carrierLevelDbm: rxLevelDbm, marginToNoiseDb: rxLevelDbm - floor, bwKhz, sidebands, clipsAtFilter, notes,
  };
  if (rxd) {
    out.noiseDesensedDbm = noiseDbm + rxd.desenseDb;
    out.regrowth = shoulder ? { offsetsKhz: [-bwKhz, bwKhz], levelDbc: rxd.imd3Dbc } : null;
    out.distortion = rxd.echo;
    notes.push('Receiver overload: IM3 regrowth shoulders and in-channel desensitisation drawn (illustrative shapes; levels from the planner overload state).');
  }
  return out;
}

// ---------------------------------------------------------------- mono baseband (MPX view for mics and mono IEMs)

/** Generic tone-key (pilot) subcarrier frequency of a wireless mic, kHz. ASSUMED / illustrative: the real frequency is not published. */
export const TONE_KEY_GENERIC_KHZ = 32.768;
const PILOT_KHZ = 19; // standard FM stereo pilot (ITU-R BS.450)
const PILOT_INJECTION = 0.09; // fraction of peak deviation (standard 8 to 10 percent)
const TONE_KEY_INJECTION = 0.05; // illustrative
const DATA_INJECTION = 0.05;

/**
 * monoBasebandSpectrum({ kind, stereo, pilotLocked, toneKeyKhz, dataConfig, cnrDb, nBins, fMaxKhz, t, preEmphasisTauUs })
 *   -> { freqKhz, levelDb, noiseDb, markers: [{ name, freqKhz, levelDb, present, status, note }], bands, notes }
 * The composite baseband the discriminator sees for a link that is not a stereo FM broadcast: programme audio 0-15 kHz (voice-like
 * for 'mic', music-like mono for 'iem', the audioSpectrum shapes scaled so the programme peaks at -8 dB, the level mpxSpectrum
 * uses for L+R), the FM noise triangle (the same noise as mpxSpectrum, so the stereo and mono views agree), and the control tones:
 *   - mic: tone-key subcarrier at toneKeyKhz (default TONE_KEY_GENERIC_KHZ = 32.768, status 'assumed': frequency not published);
 *   - iem: the 19 kHz stereo pilot is shown ABSENT (expected position) for a mono link, present when stereo && pilotLocked !== false;
 *   - data subcarrier from dataConfig { enabled, subcarrierKHz, injectionFrac } when enabled, else no marker.
 * dB relative to 100 percent modulation. cnrDb is the caller's carrier-to-noise ratio (default 40). status per marker:
 * 'standard' (pilot), 'assumed' (tone key), 'illustrative'. Deterministic from t.
 */
export function monoBasebandSpectrum({
  kind = 'mic', stereo = false, pilotLocked = true, toneKeyKhz, dataConfig, cnrDb = 40, nBins = 256, fMaxKhz = 100, t = 0, preEmphasisTauUs = 0, distortion, audioBandwidthHz, source, toneHz,
} = {}) {
  const isIem = kind === 'iem';
  const abwHz = Number.isFinite(audioBandwidthHz) && audioBandwidthHz >= AUDIO_BANDWIDTH_LIMITS_HZ[0] && audioBandwidthHz <= AUDIO_BANDWIDTH_LIMITS_HZ[1]
    ? audioBandwidthHz : (isIem && stereo ? FM_AUDIO_LIMIT_HZ : MONO_AUDIO_BANDWIDTH_HZ);
  const maxKhz = Math.max(20, Number.isFinite(fMaxKhz) ? fMaxKhz : 100);
  const base = mpxSpectrum({ cnrDb: Number.isFinite(cnrDb) ? cnrDb : 40, blend: 0, pilotLevelDb: -200 }, { points: Math.min(4096, Math.max(8, Math.floor(nBins))), maxKHz: maxKhz, seed: Math.floor(Math.max(0, t) * 2) });
  const freqKhz = base.freqKHz, n = freqKhz.length;
  // programme: audioSpectrum on a fine grid up to 15 kHz, scaled so its peak (before pre-emphasis) is -8 dB
  const aud = audioSpectrum({ kind: isIem ? 'iem' : 'mic', stereo: false, nBins: 512, fMaxHz: abwHz, t, source, toneHz });
  const peak = Math.max(...aud.levelsDb);
  const pre = audioSpectrum({ kind: isIem ? 'iem' : 'mic', stereo: false, nBins: 512, fMaxHz: abwHz, t, preEmphasisTauUs, source, toneHz });
  const at = (f) => { // linear interpolation of the programme; steep low-pass skirt just above the audio ceiling, nothing beyond
    if (f < 0.03) return -Infinity;
    const x = (f * 1000) / abwHz * 511;
    if (x > 511) return f * 1000 <= abwHz * 1.25 ? pre.levelsDb[511] - (60 * Math.log2(f * 1000 / abwHz) + 20) : -Infinity;
    const i = Math.floor(x), w = x - i, j = Math.min(511, i + 1);
    return pre.levelsDb[i] * (1 - w) + pre.levelsDb[j] * w;
  };
  const pwr = (db) => (Number.isFinite(db) ? Math.pow(10, db / 10) : 0);
  const dbOf = (p) => (p > 1e-12 ? 10 * Math.log10(p) : -120);
  const toneOn = !isIem;
  const tk = toneOn ? (Number.isFinite(toneKeyKhz) ? toneKeyKhz : TONE_KEY_GENERIC_KHZ) : null;
  const dc = dataConfig && dataConfig.enabled ? dataConfig : null;
  const dKhz = dc && Number.isFinite(dc.subcarrierKHz) ? dc.subcarrierKHz : dc ? 57 : null;
  const dInj = dc && Number.isFinite(dc.injectionFrac) ? dc.injectionFrac : DATA_INJECTION;
  const pilotPresent = isIem && stereo && pilotLocked !== false;
  const lineDb = (inj) => 20 * Math.log10(inj);
  const lineAt = (f, f0, db, half = 0.4) => (Math.abs(f - f0) <= half ? pwr(db) * (0.5 * (1 + Math.cos(Math.PI * Math.abs(f - f0) / half))) : 0);
  const levelDb = new Array(n);
  for (let i = 0; i < n; i++) {
    const f = freqKhz[i];
    let p = pwr(base.noiseDb[i]);
    const a = at(f);
    if (Number.isFinite(a)) p += pwr(Math.min(-3, a - peak - 8));
    if (pilotPresent) p += lineAt(f, PILOT_KHZ, lineDb(PILOT_INJECTION), 0.3);
    if (tk !== null) p += lineAt(f, tk, lineDb(TONE_KEY_INJECTION));
    if (dKhz !== null) p += lineAt(f, dKhz, lineDb(dInj), 1.5);
    levelDb[i] = dbOf(p);
  }
  const noiseAt = (f0) => { let k = 0; for (let i = 1; i < n; i++) if (Math.abs(freqKhz[i] - f0) < Math.abs(freqKhz[k] - f0)) k = i; return base.noiseDb[k]; };
  const markers = [];
  if (isIem) {
    markers.push({
      name: 'Stereo pilot', freqKhz: PILOT_KHZ, levelDb: pilotPresent ? lineDb(PILOT_INJECTION) : noiseAt(PILOT_KHZ), present: pilotPresent, status: 'standard',
      note: pilotPresent ? 'The 19 kHz pilot (8 to 10 percent of deviation) tells the receiver to decode stereo.' : 'Expected pilot position, absent: a mono link sends no pilot, so there is no stereo (L-R) band either.',
    });
  } else {
    markers.push({
      name: 'Tone key', freqKhz: tk, levelDb: lineDb(TONE_KEY_INJECTION), present: true, status: 'assumed',
      note: Number.isFinite(toneKeyKhz) ? 'Tone-key (pilot) subcarrier at the frequency given.' : 'About 32.768 kHz: the real frequency is not published, so this position and level are illustrative.',
    });
  }
  if (dKhz !== null) markers.push({ name: 'Data subcarrier', freqKhz: dKhz, levelDb: lineDb(dInj), present: true, status: 'illustrative', note: 'Telemetry subcarrier at the frequency the planner models.' });
  const ceilKhz = abwHz / 1000;
  const notes = [
    `Audio ceiling ${+ceilKhz.toFixed(1)} kHz (a low-pass set by the design${audioBandwidthHz === undefined ? ', assumed' : ''}); the control tone sits above it${tk !== null && tk > ceilKhz ? `, leaving a gap of ${(tk - ceilKhz).toFixed(1)} kHz` : ''}.`,
    'Programme audio is simulated, not real: ' + (source === undefined ? (isIem ? 'music-like mono' : 'voice-like') : aud.source) + ' shape, illustrative levels.',
    'Noise rises with frequency (FM triangular noise), the same law as the stereo MPX view.',
    isIem ? 'The 19 kHz stereo pilot is a standard of FM stereo; it is absent for a mono IEM.' : 'The tone-key frequency of a mic system is not published: the marker is illustrative.',
  ];
  if (dKhz === null) notes.push('No data subcarrier on this link.');
  const dn = normDistortion(distortion);
  if (dn) {
    const lines = markers.filter((m) => m.present).map((m) => ({ name: m.name, freqKhz: m.freqKhz, levelDb: m.levelDb }));
    const r = distortMpxSpectrum({ freqKhz, levelDb, noiseDb: base.noiseDb }, distortion, lines, { programmeDb: -8, programmeMaxKhz: ceilKhz });
    notes.push(...distortionNotes(dn));
    return { freqKhz, levelDb: r.levelDb, noiseDb: base.noiseDb, markers, bands: { programme: [0.03, ceilKhz], ...(tk !== null && tk > ceilKhz ? { gap: [ceilKhz, tk] } : {}) }, audioBandwidthHz: abwHz, audioCeilingKhz: ceilKhz, source: aud.source, notes, products: r.products, distortion: r.distortion };
  }
  return { freqKhz, levelDb, noiseDb: base.noiseDb, markers, bands: { programme: [0.03, ceilKhz], ...(tk !== null && tk > ceilKhz ? { gap: [ceilKhz, tk] } : {}) }, audioBandwidthHz: abwHz, audioCeilingKhz: ceilKhz, source: aud.source, notes };
}

// ---------------------------------------------------------------- overload distortion (illustrative simulation)
//
// All shapes here are ILLUSTRATIVE; only the inputs (compression, IM3 level, desense, clip fraction) come from the planner's overload
// state. Physics used:
//  - Memoryless soft nonlinearity y = x - a3 x^3 (weak tanh): the fundamental compresses by 3/4 a3 A^2; for one tone the 3rd harmonic
//    is a3 A^2 / 4, so THD3 ~ compression (amplitude fraction) / 3: compression c dB -> thd = (1 - 10^(-c/20)) / 3.
//  - Two-tone third-order intermodulation (IM3): products at 2f1-f2 and 2f2-f1 (and the 2nd-order f2-f1 for asymmetric devices).
//  - Hard clipping of a Gaussian-like signal at k sigma clips a fraction erfc(k/sqrt(2)) of the samples (erfc: Abramowitz and Stegun 7.1.26).
//  - Receiver desensitisation raises the in-channel noise by desenseDb (overload.js).

const clampN = (x, lo, hi, dflt = 0) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt);

// erfc for x >= 0, Abramowitz and Stegun 7.1.26 (absolute error below 1.5e-7).
/**
 * clipFractionFromOverdrive(overdriveDb) -> fraction of samples clipped, 0..1. A programme with a 3-sigma crest factor whose limiter
 * threshold sits overdriveDb below the programme peak clips erfc(k/sqrt(2)) - erfc(3/sqrt(2)) with k = 3 * 10^(-od/20) (0 at od <= 0,
 * continuous, monotonic). ASSUMED Gaussian programme statistics.
 */
export function clipFractionFromOverdrive(overdriveDb, source) {
  if (source !== undefined && normalizeAudioSource(source)) return clipFraction(source, overdriveDb); // the global audio source's own crest factor
  return clipFractionGaussian(overdriveDb); // 3-sigma crest, the original
}

/**
 * distortionFromLink({ overload, txOverdriveDb, txClipFraction })
 *   -> { active, source: 'none'|'rx-front-end'|'tx-limiter'|'both', severity: 'none'|'amber'|'red', compressionDb, thdPercent,
 *        imd3Dbc, clipFraction, desenseDb, rxActive, txActive, clipKind: 'soft'|'hard', notes }
 * overload is an overloadStep() result (level, compressionDb, distortionPct, desenseDb). txOverdriveDb (dB the programme exceeds the
 * transmit limiter threshold) or txClipFraction (0..1, wins when given) describe the Tx side. Formulas (ILLUSTRATIVE):
 *   rx thd = min(30, max((1 - 10^(-c/20)) / 3 * 100, 0.5 * distortionPct)) percent, c = compressionDb;
 *   rx imd3Dbc = 20 log10(r), r = p / sqrt(1 - p^2), p = distortionPct / 100 (the inverse of overload.js), capped <= 0 dBc;
 *   tx thd = min(30, 150 * clipFraction) percent, tx imd3Dbc = 20 log10(tx thd / 100); total thd = hypot(rx, tx), imd3Dbc = the larger.
 * active when compression >= 0.1 dB, level 'overload', desense >= 0.5 dB or clipFraction > 0. Non-finite input counts as 0.
 */
export function distortionFromLink({ overload, txOverdriveDb, txClipFraction, audioSource } = {}) {
  const o = overload && typeof overload === 'object' ? overload : {};
  const comp = clampN(o.compressionDb, 0, 60);
  const pct = clampN(o.distortionPct, 0, 99);
  const desense = clampN(o.desenseDb, 0, 120);
  const clip = Number.isFinite(txClipFraction) ? clampN(txClipFraction, 0, 1) : clipFractionFromOverdrive(txOverdriveDb, audioSource);
  const rxThd = Math.min(30, Math.max((1 - 10 ** (-comp / 20)) / 3 * 100, 0.5 * pct));
  const rxActive = comp >= 0.1 || o.level === 'overload' || desense >= 0.5;
  const txActive = clip > 0;
  const txThd = Math.min(30, 150 * clip);
  const p = pct / 100;
  const rxImd = pct > 0 ? Math.min(0, 20 * L10(p / Math.sqrt(1 - p * p))) : -120;
  const txImd = txThd > 0 ? Math.min(0, 20 * L10(txThd / 100)) : -120;
  const thd = Math.hypot(rxActive ? rxThd : 0, txThd);
  const active = rxActive || txActive;
  const source = rxActive && txActive ? 'both' : rxActive ? 'rx-front-end' : txActive ? 'tx-limiter' : 'none';
  const severity = !active ? 'none' : (o.level === 'overload' || thd >= 10) ? 'red' : 'amber';
  const notes = [];
  if (rxActive) notes.push('Receiver front-end overload: compression, IM3 and desensitisation come from the planner overload state; the thd mapping is illustrative.');
  if (txActive) notes.push(normalizeAudioSource(audioSource) ? `Transmit limiter clipping: clip fraction from the ${AUDIO_SOURCES[normalizeAudioSource(audioSource)].label} source (crest factor ${AUDIO_SOURCES[normalizeAudioSource(audioSource)].crestDb.toFixed(1)} dB, illustrative).` : 'Transmit limiter clipping: clip fraction from the assumed Gaussian programme model (illustrative).');
  return {
    active, source, severity, compressionDb: comp, thdPercent: thd, imd3Dbc: Math.max(rxActive ? rxImd : -120, txImd),
    clipFraction: clip, desenseDb: rxActive ? desense : 0, rxActive, txActive, clipKind: txActive ? 'hard' : 'soft', notes,
  };
}

// Sanitise a descriptor (any partial object is accepted). Returns null when nothing is active, so callers keep the exact old path.
function normDistortion(d) {
  if (!d || typeof d !== 'object' || d.active === false) return null;
  const thdPct = clampN(d.thdPercent, 0, 50);
  const clip = clampN(d.clipFraction, 0, 1);
  const desenseDb = clampN(d.desenseDb, 0, 120);
  const imd3Dbc = clampN(d.imd3Dbc, -120, 0, -120);
  const comp = clampN(d.compressionDb, 0, 60);
  const rxActive = d.rxActive !== undefined ? !!d.rxActive : (d.source !== 'tx-limiter');
  if (thdPct <= 0 && clip <= 0 && desenseDb < 0.5 && imd3Dbc <= -100 && comp < 0.1) return null;
  const hard = d.clipKind ? d.clipKind === 'hard' : clip > 0;
  const echo = { active: true, source: d.source || 'rx-front-end', thdPercent: thdPct, imd3Dbc, clipFraction: clip, compressionDb: comp, desenseDb, clipKind: hard ? 'hard' : 'soft' };
  return { thd: thdPct / 100, imd3Dbc, clip, desenseDb, comp, hard, rxActive, echo };
}

function distortionNotes(dn) {
  return [`Overload distortion simulated (illustrative): thd ${(dn.thd * 100).toFixed(1)} percent, IM3 ${dn.imd3Dbc.toFixed(0)} dBc, ${dn.hard ? 'hard clipping (odd harmonics)' : 'soft compression'}.`];
}

// Harmonic amplitude weights a_k (k = 2..), normalised so sqrt(sum a_k^2) = 1: soft clip ~ k^-1.5 all harmonics, hard clip odd only ~ 1/k.
export function harmonicWeights(hard, kMax) {
  const ks = [];
  for (let k = 2; k <= kMax; k++) if (!hard || k % 2 === 1) ks.push(k);
  const raw = ks.map((k) => (hard ? 1 / k : k ** -1.5));
  const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0)) || 1;
  return ks.map((k, i) => ({ k, a: raw[i] / norm }));
}

function applyAudioDistortion(levels, freqs, f0, dn, isIem, fMaxHz) {
  const n = levels.length;
  const pw = levels.map((l) => 10 ** (l / 10));
  let ref = -Infinity;
  for (const l of levels) if (l > ref) ref = l;
  // IM skirts: the own spectrum box-smoothed (about 4 percent of the axis each side), imd3Dbc down (music-like source only)
  if (isIem && dn.imd3Dbc > -100) {
    const w = Math.max(1, Math.round(n * 0.04)), pre = new Array(n + 1).fill(0), g = 10 ** (dn.imd3Dbc / 10);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + pw[i];
    for (let i = 0; i < n; i++) { const a = Math.max(0, i - w), b = Math.min(n - 1, i + w); pw[i] += g * (pre[b + 1] - pre[a]) / (b - a + 1); }
  }
  // raised floor: broadband distortion residue 40 dB below the thd level (relative to the programme peak)
  if (dn.thd > 0 && Number.isFinite(ref)) {
    const fl = 20 * L10(dn.thd) - 40 + ref;
    if (fl > -110) { const e = 10 ** (fl / 10); for (let i = 0; i < n; i++) pw[i] += e; }
  }
  // harmonic lines at k f0, level thd * a_k relative to the peak line
  const harmonics = [];
  if (dn.thd > 0 && f0 > 0 && Number.isFinite(ref)) {
    const kMax = Math.min(12, Math.floor(fMaxHz / f0));
    for (const { k, a } of harmonicWeights(dn.hard, kMax)) {
      const i = Math.round(k * f0 / fMaxHz * (n - 1));
      if (i < 0 || i > n - 1) continue;
      const lvl = ref + 20 * L10(dn.thd * a);
      pw[i] += 10 ** (lvl / 10);
      harmonics.push({ k, freqHz: freqs[i], levelDb: lvl });
    }
  }
  return { levels: pw.map((p) => Math.max(AUDIO_SPECTRUM_FLOOR_DB, 10 * L10(p + 1e-30))), harmonics };
}

/**
 * distortMpxSpectrum(spec, distortion, lines, { programmeDb = -8, programmeMaxKhz = 15 })
 *   -> { ...spec, levelDb, products: [{ name, freqKhz, levelDb, order }], distortion }
 * Adds overload effects to a baseband (MPX) spectrum { freqKhz, levelDb, noiseDb? }, dB relative to 100 percent modulation. lines is
 * the list of present lines [{ name, freqKhz, levelDb }] (pilot, tone key, data subcarrier, ...). For each pair (a, b): third-order
 * products 2a-b and 2b-a at mean(la, lb) + imd3Dbc, and the second-order b-a at imd3Dbc - 6 (ILLUSTRATIVE); products at <= 0.03 kHz or
 * above the axis are dropped. Also adds a programme-intermodulation floor programmeDb + 20log10(thd) - 30 over 0..programmeMaxKhz
 * (falling 12 dB per octave above) and raises the existing noise by desenseDb. With nothing active returns spec with products [] and
 * distortion null (levelDb untouched).
 */
export function distortMpxSpectrum(spec, distortion, lines = [], { programmeDb = -8, programmeMaxKhz = 15 } = {}) {
  const dn = normDistortion(distortion);
  if (!dn || !spec || !Array.isArray(spec.freqKhz)) return { ...spec, products: [], distortion: null };
  const f = spec.freqKhz, n = f.length, maxKhz = f[n - 1];
  const pw = spec.levelDb.map((l) => 10 ** (l / 10));
  if (dn.rxActive && dn.desenseDb > 0 && Array.isArray(spec.noiseDb)) {
    const m = 10 ** (dn.desenseDb / 10) - 1;
    for (let i = 0; i < n; i++) pw[i] += 10 ** (spec.noiseDb[i] / 10) * m;
  }
  if (dn.thd > 0) {
    const fl = programmeDb + 20 * L10(dn.thd) - 30;
    for (let i = 0; i < n; i++) {
      const lv = f[i] <= programmeMaxKhz ? fl : fl - 12 * Math.log2(f[i] / programmeMaxKhz);
      if (lv > -140) pw[i] += 10 ** (lv / 10);
    }
  }
  const good = (Array.isArray(lines) ? lines : []).filter((l) => l && Number.isFinite(l.freqKhz) && Number.isFinite(l.levelDb));
  const products = [];
  const half = 0.4;
  const add = (name, fk, lvl, order) => {
    if (!(fk > 0.03) || fk > maxKhz || !Number.isFinite(lvl) || lvl < -140) return;
    products.push({ name, freqKhz: fk, levelDb: lvl, order });
    for (let i = 0; i < n; i++) { const d = Math.abs(f[i] - fk); if (d <= half) pw[i] += 10 ** (lvl / 10) * 0.5 * (1 + Math.cos(Math.PI * d / half)); }
  };
  if (dn.imd3Dbc > -100) {
    for (let i = 0; i < good.length; i++) for (let j = i + 1; j < good.length; j++) {
      const a = good[i], b = good[j], m = (a.levelDb + b.levelDb) / 2;
      add(`2${a.name}-${b.name}`, 2 * a.freqKhz - b.freqKhz, m + dn.imd3Dbc, 3);
      add(`2${b.name}-${a.name}`, 2 * b.freqKhz - a.freqKhz, m + dn.imd3Dbc, 3);
      add(`${b.name}-${a.name}`, Math.abs(b.freqKhz - a.freqKhz), m + dn.imd3Dbc - 6, 2);
    }
  }
  return { ...spec, levelDb: pw.map((p) => 10 * L10(p + 1e-30)), products, distortion: dn.echo };
}

/**
 * clipSamples(samples, { clipFraction, thdPercent, compressionDb, mode }) -> Float64Array
 * Time-domain waveform helper for the audio view. mode 'hard' (default when clipFraction > 0): clips at the threshold that exceeds
 * clipFraction of the samples (percentile of |x|). mode 'soft' (default otherwise): y = peak * tanh(g x / peak) / g with
 * g = sqrt(12 thd), so a sine gets a 3rd harmonic of g^2/12 = thd (weak-nonlinearity limit); thd from thdPercent, else from
 * compressionDb as in distortionFromLink. Non-finite samples become 0; no clipping returns a copy.
 */
export function clipSamples(samples, { clipFraction, thdPercent, compressionDb, mode } = {}) {
  const n = samples ? samples.length | 0 : 0;
  const x = new Float64Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) { const v = Number.isFinite(samples[i]) ? samples[i] : 0; x[i] = v; if (Math.abs(v) > peak) peak = Math.abs(v); }
  const cf = clampN(clipFraction, 0, 1);
  const m = mode === 'hard' || mode === 'soft' ? mode : cf > 0 ? 'hard' : 'soft';
  if (peak === 0 || n === 0) return x;
  if (m === 'hard') {
    if (cf <= 0) return x;
    const s = Array.from(x, Math.abs).sort((a, b) => a - b);
    const thr = s[Math.min(n - 1, Math.max(0, Math.floor((1 - cf) * n)))];
    if (!(thr > 0)) return x;
    for (let i = 0; i < n; i++) x[i] = Math.max(-thr, Math.min(thr, x[i]));
    return x;
  }
  const thd = Number.isFinite(thdPercent) ? clampN(thdPercent, 0, 50) / 100 : Math.min(0.3, (1 - 10 ** (-clampN(compressionDb, 0, 60) / 20)) / 3);
  if (thd <= 0) return x;
  const g = Math.sqrt(12 * thd);
  for (let i = 0; i < n; i++) x[i] = peak * Math.tanh(g * x[i] / peak) / g;
  return x;
}
