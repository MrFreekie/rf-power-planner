// A programme tone against the FM stereo (MPX) tones (item 32 and 32a). Pure functions, no DOM.
// The linear MPX only ADDS its components: a 1 kHz tone and the 19 kHz pilot are two clean lines and nothing else. Products appear only where
// something nonlinear acts on the pair, and there are three such places, each modelled here:
//   (a) the FM modulation itself (two-tone FM):  twoToneFm()  -> RF sidebands at fc + n f1 + m f2 with Bessel weights J_n(beta1) J_m(beta2);
//   (b) a baseband nonlinearity (limiter, clipper, overload, op-amp): basebandProducts() -> the lines 19 +- k, 2*19 +- 1, 2*1 +- 19, harmonics;
//   (c) the stereo decoder: decoderAlias() (L-R demodulation folds 23-53 kHz down by 38 kHz) and pilotBeat() (a tone near the pilot against the PLL).
// toneKeyHarmonics() covers the mono mic case (harmonics landing on the tone-key window) and neighbourHits() the RDS/SCA subcarriers.
// Levels are dB relative to 100 percent modulation (the MPX view convention) except RF sideband levels, which are dB relative to the UNMODULATED
// carrier. Every filter, nonlinearity, PLL and window figure below is an ASSUMED planning number (flag U) unless a source is named; the product
// frequencies and Bessel weights are exact maths.

import { besselJ, harmonicWeights } from './spectrum-views.js';

export const TONE_MPX_STANDARD = Object.freeze({
  pilotKhz: 19, // ITU-R BS.450 (flag S)
  subcarrierKhz: 38, // 2 x pilot, DSB-SC (S)
  audioLimitKhz: 15, // FM stereo audio limit (S)
  lPlusRKhz: [0.03, 15], lMinusRKhz: [23, 53],
});
export const TONE_MPX_ASSUMED = Object.freeze({
  filterRejectionAt19Db: { value: 40, flag: 'U' }, // audio low-pass: 0 dB at 15 kHz falling to this at 19 kHz, then 60 dB per octave (assumed; real filters differ)
  filterMaxDb: { value: 100, flag: 'U' },
  pllBandwidthHz: { value: 300, flag: 'U' }, // pilot PLL tracking bandwidth of the decoder (assumed)
  toneKeyKhz: { value: 32.768, flag: 'U' }, // generic analogue tone-key frequency (not published for any product)
  toneKeyWindowKhz: { value: 1, flag: 'U' }, // total width of the tone-key detector window
  asymmetry: { value: 0.5, flag: 'U' }, // size of the even-order (x squared) term relative to the cubic term of the baseband stage
  rdsInjectionPct: { value: 2.7, flag: 'U' }, // 57 kHz RDS, about 2 kHz of 75 kHz deviation (typical broadcast figure)
  scaInjectionPct: { value: 10, flag: 'U' }, // 67 and 92 kHz SCA, typical US broadcast figure
  leakToLmRDb: { value: 30, flag: 'U' }, // how far a tone leaking into the L-R channel is down on the same tone in L+R
});
export const MPX_NEIGHBOURS = Object.freeze([
  { id: 'rds', label: 'RDS 57 kHz (3 x pilot)', centreKhz: 57, halfWidthKhz: 2.4, flag: 'U' },
  { id: 'sca-67', label: 'SCA 67 kHz', centreKhz: 67, halfWidthKhz: 7, flag: 'U' },
  { id: 'sca-92', label: 'SCA 92 kHz', centreKhz: 92, halfWidthKhz: 7, flag: 'U' },
]);
export const TONE_MPX_DEFAULTS = Object.freeze({ toneKhz: 1, tonePct: 40, pilotPct: 9, overloadDb: -6, peakDevKhz: 75 });
// slider ranges: tone frequency kHz, tone level as percent of peak deviation, pilot injection percent, overload level dB (drive relative to nominal)
export const TONE_MPX_LIMITS = Object.freeze({ toneKhz: [0.02, 60], tonePct: [0, 100], pilotPct: [0, 15], overloadDb: [-40, 20], peakDevKhz: [5, 150] });

const clampV = (x, lim, d) => (Number.isFinite(x) ? Math.min(lim[1], Math.max(lim[0], x)) : d);
const db20 = (a) => (Math.abs(a) > 1e-12 ? 20 * Math.log10(Math.abs(a)) : -240);

/**
 * audioFilterDb(fKhz, { cutoffKhz = 15, rejectionAt19Db = 40, maxDb = 100 }) -> attenuation in dB of the audio low-pass ahead of the
 * modulator at f. 0 up to the cutoff; between the cutoff and 19 kHz the dB rejection rises with log frequency to rejectionAt19Db; beyond 19 kHz
 * rejectionAt19Db + 60 log2(f / 19) (60 dB per octave), capped at maxDb. ASSUMED shape.
 */
export function audioFilterDb(fKhz, { cutoffKhz = 15, rejectionAt19Db = 40, maxDb = 100 } = {}) {
  if (!(fKhz > cutoffKhz)) return 0;
  if (fKhz <= 19) return rejectionAt19Db * Math.log(fKhz / cutoffKhz) / Math.log(19 / cutoffKhz);
  return Math.min(maxDb, rejectionAt19Db + 60 * Math.log2(fKhz / 19));
}

/**
 * pilotBeat(toneKhz, { tonePct, pilotPct, filter }) -> { beatHz, toneAfterFilterDb, pilotDb, marginDb, phaseErrorDeg, pllTracks, risk, audible, notes }
 * A tone near 19 kHz that gets past the audio filter sits next to the pilot and beats with it at |f - 19| kHz. Relative to the pilot it is at
 * marginDb = pilotDb - toneAfterFilterDb (the pilot filtering margin); the pilot phase wobbles by up to asin(10^(-margin/20)) at the beat rate
 * (small-ratio two-phasor sum, exact). The decoder PLL follows wobble slower than its bandwidth (assumed 300 Hz), so a close tone moves the
 * regenerated 38 kHz and costs stereo separation, while a distant one is mostly rejected by the loop. risk: 'low' unless the tone is between 15 and 23 kHz; then 'high' for a margin
 * under 20 dB within 3 x the loop bandwidth, 'medium' for a margin under 20 dB elsewhere or within 3 x the loop bandwidth under 40 dB, else 'low'.
 */
export function pilotBeat(toneKhz, { tonePct = TONE_MPX_DEFAULTS.tonePct, pilotPct = TONE_MPX_DEFAULTS.pilotPct, filter = {} } = {}) {
  const f = clampV(toneKhz, TONE_MPX_LIMITS.toneKhz, 1);
  const att = audioFilterDb(f, filter);
  const toneDb = db20(tonePct / 100) - att, pilotDb = db20(pilotPct / 100);
  const marginDb = pilotDb - toneDb, beatHz = Math.abs(f - 19) * 1000;
  const ratio = Math.pow(10, -marginDb / 20);
  const phaseErrorDeg = (Math.asin(Math.min(1, ratio)) * 180) / Math.PI;
  const pllBw = TONE_MPX_ASSUMED.pllBandwidthHz.value;
  const pllTracks = beatHz <= pllBw + 1e-6;
  const near = beatHz <= 3 * pllBw + 1e-6;
  const relevant = f >= 15 && f <= 23; // only a tone between the audio band and the L-R band can sit next to the pilot
  const risk = !relevant ? 'low' : marginDb < 20 && near ? 'high' : marginDb < 20 || (near && marginDb < 40) ? 'medium' : 'low';
  const notes = [];
  if (f >= 15 && f <= 23) notes.push(`${f} kHz is between the audio band and the L-R band; the low-pass should remove it (${att.toFixed(0)} dB assumed).`);
  if (relevant && risk !== 'low') notes.push(`The tone is ${marginDb.toFixed(1)} dB under the pilot after filtering: it beats at ${beatHz.toFixed(0)} Hz and wobbles the pilot phase by up to ${phaseErrorDeg.toFixed(1)} degrees.`);
  return { toneKhz: f, beatHz, toneAfterFilterDb: toneDb, pilotDb, marginDb, phaseErrorDeg, pllTracks, risk, audible: beatHz >= 20 && beatHz <= 20000, filterDb: att, notes };
}

/**
 * decoderAlias(fKhz) -> [{ audioKhz, path: 'L+R'|'L-R', note }]: where a composite component at f kHz lands in the audio after the stereo decoder.
 * 0.03-15 kHz comes through the L+R path unchanged (both channels, in phase). 23-53 kHz is demodulated against the 38 kHz subcarrier as an L-R
 * sideband: it lands at |f - 38| kHz (opposite sign in the two channels), so a tone at 21 kHz leaking past the filter folds to 17 kHz (above
 * the 15 kHz decoder low-pass, removed) and one at 25 kHz folds to 13 kHz (audible). The region 15-23 kHz only appears through the decoder's own limits.
 */
export function decoderAlias(fKhz) {
  const out = [];
  if (fKhz >= 0.03 && fKhz <= 15) out.push({ audioKhz: fKhz, path: 'L+R', note: 'direct' });
  if (fKhz >= 23 && fKhz <= 53) { const a = Math.abs(fKhz - 38); out.push({ audioKhz: a, path: 'L-R', note: a <= 15 ? 'folded by the 38 kHz demodulator (aliasing), opposite sign in L and R' : 'folds above the audio band' }); }
  return out;
}

/**
 * twoToneFm({ tone1Khz, dev1Khz, tone2Khz = 19, dev2Khz, minDb = -80 }) -> { beta1, beta2, carrierDb, lines: [{ offsetKhz, n, m, amp, levelDb }], occupiedKhz }
 * Two-tone FM, exact: carrier cos(wc t + b1 sin(w1 t) + b2 sin(w2 t)) = sum_n sum_m J_n(b1) J_m(b2) cos((wc + n w1 + m w2) t), with
 * b1 = dev1 / f1 and b2 = dev2 / f2 (Bessel functions of the first kind). A line at fc + n f1 + m f2 has amplitude J_n(b1) J_m(b2) relative to the
 * unmodulated carrier; lines at the same offset add coherently (signed). Lines weaker than minDb are dropped. Both sidebands (n, m of either
 * sign) are listed, J_-n = (-1)^n J_n. The carrier is J0(b1) J0(b2): it vanishes where b1 = 2.405, 5.520, ... (the Bessel nulls). When f2 is a whole multiple of f1 (1 kHz and 19 kHz)
 * different (n, m) land on the same frequency and add coherently: carrierDb is the J0 J0 term alone, carrierLineDb the line actually at the carrier.
 */
export function twoToneFm({ tone1Khz = TONE_MPX_DEFAULTS.toneKhz, dev1Khz, tone2Khz = 19, dev2Khz, minDb = -80 } = {}) {
  const f1 = clampV(tone1Khz, TONE_MPX_LIMITS.toneKhz, 1), f2 = Math.max(1e-3, Number.isFinite(tone2Khz) ? tone2Khz : 19);
  const d1 = Math.max(0, Number.isFinite(dev1Khz) ? dev1Khz : 0.4 * 75), d2 = Math.max(0, Number.isFinite(dev2Khz) ? dev2Khz : 0.09 * 75);
  const b1 = d1 / f1, b2 = d2 / f2;
  const N = Math.min(80, Math.ceil(b1 + 4 * Math.cbrt(b1 + 1) + 3)), M = Math.min(8, Math.ceil(b2 + 4 * Math.cbrt(b2 + 1) + 2));
  const J1 = [], J2 = [];
  for (let n = -N; n <= N; n++) J1[n + N] = besselJ(n, b1);
  for (let m = -M; m <= M; m++) J2[m + M] = besselJ(m, b2);
  const map = new Map();
  for (let n = -N; n <= N; n++) for (let m = -M; m <= M; m++) {
    const a = J1[n + N] * J2[m + M];
    if (Math.abs(a) < 1e-12) continue;
    const off = n * f1 + m * f2, key = Math.round(off * 1e6);
    const e = map.get(key);
    if (e) { if (Math.abs(a) > Math.abs(e.big)) { e.n = n; e.m = m; e.big = a; } e.amp += a; e.terms.push([n, m]); } else map.set(key, { offsetKhz: off, n, m, amp: a, big: a, terms: [[n, m]] });
  }
  const lines = [...map.values()].map((e) => ({ offsetKhz: e.offsetKhz, n: e.n, m: e.m, amp: e.amp, levelDb: db20(e.amp), ...(e.terms.length > 1 ? { coincident: e.terms } : {}) }))
    .filter((l) => l.levelDb >= minDb || (l.n === 0 && l.m === 0)).sort((a, b) => a.offsetKhz - b.offsetKhz);
  const edge = Math.max(0, ...lines.filter((l) => l.levelDb >= -40).map((l) => Math.abs(l.offsetKhz)));
  const c0 = lines.find((l) => Math.abs(l.offsetKhz) < 1e-6);
  return { beta1: b1, beta2: b2, carrierDb: db20(J1[N] * J2[M]), carrierLineDb: c0 ? c0.levelDb : -240, lines, occupiedKhz: 2 * edge };
}

function coef(n, p) { // multinomial n! / prod p_i!
  let r = 1; for (let i = 2; i <= n; i++) r *= i; for (const q of p) for (let i = 2; i <= q; i++) r /= i; return r;
}

/**
 * basebandProducts({ toneKhz, tonePct, pilotPct, overloadDb, asymmetry, maxOrder = 5, maxKhz = 100, minDb = -110 })
 *   -> { lines: [{ fKhz, i, j, order, amp, levelDb, kind, label }], a1, a2, drive }
 * A memoryless stage y = x + h2 x^2 - (d^2/3) x^3 + (2 d^4/15) x^5 (the series of tanh(d x)/d, a smooth limiter, with an even-order term
 * h2 = asymmetry d / 3), x = a1 cos(2 pi f1 t) + a2 cos(2 pi 19 kHz t), a1 = tonePct/100, a2 = pilotPct/100 (fractions of 100 percent
 * modulation), d = 10^(overloadDb/20) the drive relative to nominal. The cosine product expansion is exact: x^n gives, at i f1 + j f2, the amplitude
 * n! / (p1! q1! p2! q2!) (a1/2)^(p1+q1) (a2/2)^(p2+q2) x 2, summed over p1 - q1 = i, p2 - q2 = j. Lines at the same frequency add (signed).
 * kind: 'tone', 'pilot', 'harmonic' (j = 0), 'pilot-harmonic' (i = 0), 'intermod' (both nonzero). label is e.g. '2f2-f1'. Levels in dB relative to
 * 100 percent modulation. Order 2 and 3 products are the ones named in item 32a: with maxOrder 3 and asymmetry 0 a cubic term gives
 * -a1 a2^2 / 4 at 2 f2 +- f1 and -a1^2 a2 / 4 at 2 f1 +- f2 (d = 1).
 */
export function basebandProducts({ toneKhz = TONE_MPX_DEFAULTS.toneKhz, tonePct = TONE_MPX_DEFAULTS.tonePct, pilotPct = TONE_MPX_DEFAULTS.pilotPct, overloadDb = TONE_MPX_DEFAULTS.overloadDb,
  asymmetry = TONE_MPX_ASSUMED.asymmetry.value, maxOrder = 5, maxKhz = 100, minDb = -110 } = {}) {
  const f1 = clampV(toneKhz, TONE_MPX_LIMITS.toneKhz, 1), f2 = TONE_MPX_STANDARD.pilotKhz;
  const a1 = clampV(tonePct, TONE_MPX_LIMITS.tonePct, 0) / 100, a2 = clampV(pilotPct, TONE_MPX_LIMITS.pilotPct, 0) / 100;
  const d = 10 ** (clampV(overloadDb, TONE_MPX_LIMITS.overloadDb, 0) / 20);
  const c = { 1: 1, 2: asymmetry * d / 3, 3: -(d * d) / 3, 5: (2 * d ** 4) / 15 };
  const acc = new Map();
  const add = (i, j, order, v) => {
    let f = i * f1 + j * f2;
    if (f < 0) { i = -i; j = -j; f = -f; } // a cosine at -f is the same line: fold onto positive frequency
    if (f <= 1e-9 || f > maxKhz) return;
    const key = `${Math.round(f * 1e6)}`; const e = acc.get(key);
    if (e) { e.amp += v; e.maxOrder = Math.max(e.maxOrder, order); if (!e.alt) e.alt = []; e.alt.push([i, j]); } else acc.set(key, { fKhz: f, i, j, order, maxOrder: order, amp: v });
  };
  for (const nStr of Object.keys(c)) {
    const n = Number(nStr); if (n > maxOrder || !c[n]) continue;
    for (let p1 = 0; p1 <= n; p1++) for (let q1 = 0; p1 + q1 <= n; q1++) for (let p2 = 0; p1 + q1 + p2 <= n; p2++) {
      const q2 = n - p1 - q1 - p2;
      const v = c[n] * coef(n, [p1, q1, p2, q2]) * (a1 / 2) ** (p1 + q1) * (a2 / 2) ** (p2 + q2);
      if (v === 0) continue;
      const i = p1 - q1, j = p2 - q2;
      if (i < 0 || (i === 0 && j < 0)) continue; // the mirror term is counted below by doubling
      add(i, j, n, 2 * v);
    }
  }
  const lines = [];
  for (const e of acc.values()) {
    const lv = db20(e.amp); if (lv < minDb) continue;
    const kind = e.i === 1 && e.j === 0 ? 'tone' : e.i === 0 && e.j === 1 ? 'pilot' : e.j === 0 ? 'harmonic' : e.i === 0 ? 'pilot-harmonic' : 'intermod';
    lines.push({ fKhz: e.fKhz, i: e.i, j: e.j, order: Math.abs(e.i) + Math.abs(e.j), amp: e.amp, levelDb: lv, kind, label: productLabel(e.i, e.j), ...(e.alt ? { coincident: [[e.i, e.j], ...e.alt] } : {}) });
  }
  lines.sort((a, b) => a.fKhz - b.fKhz);
  return { lines, a1, a2, drive: d };
}

function productLabel(i, j) {
  const t = (k, name) => (k === 0 ? '' : `${Math.abs(k) === 1 ? '' : Math.abs(k)}${name}`);
  const parts = [[i, 'f1'], [j, 'f2']].filter(([k]) => k !== 0);
  return parts.map(([k, name], idx) => `${k < 0 ? '-' : idx === 0 ? '' : '+'}${t(k, name)}`).join('');
}

/**
 * toneKeyHarmonics({ toneKhz, levelDb, thdPercent, hard = true, kMax = 12, toneKeyKhz = 32.768, windowKhz = 1 })
 *   -> { hits: [{ k, fKhz, levelDb, inWindow }], harmonics: [...], worstDb }
 * Mono mic: harmonics of a loud programme tone at k f. Their levels are the overload distortion model's (spectrum-views harmonicWeights: hard
 * clipping odd harmonics ~ 1/k, soft clipping k^-1.5, normalised so the total harmonic distortion is thdPercent): level_k = levelDb + 20 log10(thd a_k).
 * A harmonic inside toneKeyKhz +- windowKhz/2 can open or mute the tone-key squelch. 3 x 10.9 kHz = 32.7 kHz, 4 x 8.192 kHz = 32.768 kHz.
 */
export function toneKeyHarmonics({ toneKhz, levelDb = -8, thdPercent = 10, hard = true, kMax = 12, toneKeyKhz = TONE_MPX_ASSUMED.toneKeyKhz.value, windowKhz = TONE_MPX_ASSUMED.toneKeyWindowKhz.value } = {}) {
  const f = clampV(toneKhz, TONE_MPX_LIMITS.toneKhz, 1), thd = Math.max(0, thdPercent) / 100;
  const harmonics = harmonicWeights(hard, Math.max(2, Math.min(40, Math.floor(kMax)))).map(({ k, a }) => ({
    k, fKhz: k * f, levelDb: levelDb + db20(thd * a), inWindow: Math.abs(k * f - toneKeyKhz) <= windowKhz / 2,
  }));
  const hits = harmonics.filter((h) => h.inWindow);
  return { hits, harmonics, worstDb: hits.length ? Math.max(...hits.map((h) => h.levelDb)) : -Infinity, toneKeyKhz, windowKhz };
}

/**
 * neighbourHits(lines, { neighbours = MPX_NEIGHBOURS }) -> [{ line, neighbour }]: product lines (from basebandProducts, with fKhz) that land inside
 * the RDS (57 kHz) or SCA (67, 92 kHz) bands. The third harmonic of the pilot (3 x 19 = 57 kHz) lands in the RDS band; f2 + 38 style products near 57 do too.
 */
export function neighbourHits(lines, { neighbours = MPX_NEIGHBOURS } = {}) {
  const out = [];
  for (const l of lines) for (const nb of neighbours) if (Math.abs(l.fKhz - nb.centreKhz) <= nb.halfWidthKhz) out.push({ line: l, neighbour: nb });
  return out;
}

/**
 * overdeviation({ tonePct, pilotPct, otherPct = 0, peakDevKhz = 75 }) -> { totalPct, headroomDb, over, toneDevKhz, pilotDevKhz, availableTonePct }
 * The deviation budget: the tone, the pilot (about 9 percent) and any other composite content share the peak deviation. In the worst case their peaks
 * add in phase: totalPct = sum. Over 100 percent the transmit limiter clips (or the deviation exceeds the allowed bandwidth). availableTonePct is what
 * the tone can have before the sum reaches 100 percent.
 */
export function overdeviation({ tonePct = TONE_MPX_DEFAULTS.tonePct, pilotPct = TONE_MPX_DEFAULTS.pilotPct, otherPct = 0, peakDevKhz = TONE_MPX_DEFAULTS.peakDevKhz } = {}) {
  const dev = clampV(peakDevKhz, TONE_MPX_LIMITS.peakDevKhz, 75);
  const total = Math.max(0, tonePct) + Math.max(0, pilotPct) + Math.max(0, otherPct);
  return { totalPct: total, headroomDb: db20(100 / Math.max(total, 1e-9)), over: total > 100, toneDevKhz: (dev * tonePct) / 100, pilotDevKhz: (dev * pilotPct) / 100, availableTonePct: Math.max(0, 100 - pilotPct - otherPct) };
}

/**
 * toneMpxReport(opts) -> everything the example and the GUI show for one setting: { settings, filter, beat, alias, deviation, fm, products, neighbours,
 *   toneKey, notes }. opts: { toneKhz, tonePct, pilotPct, overloadDb, peakDevKhz, mono = false, thdPercent, filter }. In a stereo link the tone first
 * passes the 15 kHz audio filter (filter), so the composite tone level is tonePct - filterDb; a mono mic link is shown with the tone key harmonics.
 */
export function toneMpxReport(opts = {}) {
  const s = {
    toneKhz: clampV(opts.toneKhz, TONE_MPX_LIMITS.toneKhz, TONE_MPX_DEFAULTS.toneKhz), tonePct: clampV(opts.tonePct, TONE_MPX_LIMITS.tonePct, TONE_MPX_DEFAULTS.tonePct),
    pilotPct: clampV(opts.pilotPct, TONE_MPX_LIMITS.pilotPct, TONE_MPX_DEFAULTS.pilotPct), overloadDb: clampV(opts.overloadDb, TONE_MPX_LIMITS.overloadDb, TONE_MPX_DEFAULTS.overloadDb),
    peakDevKhz: clampV(opts.peakDevKhz, TONE_MPX_LIMITS.peakDevKhz, TONE_MPX_DEFAULTS.peakDevKhz), mono: !!opts.mono,
  };
  const filter = opts.filter || {};
  const att = s.mono ? 0 : audioFilterDb(s.toneKhz, filter);
  const toneAfterPct = s.tonePct * Math.pow(10, -att / 20);
  const beat = pilotBeat(s.toneKhz, { tonePct: s.tonePct, pilotPct: s.pilotPct, filter });
  const deviation = overdeviation({ tonePct: toneAfterPct, pilotPct: s.mono ? 0 : s.pilotPct, peakDevKhz: s.peakDevKhz });
  const fm = twoToneFm({ tone1Khz: s.toneKhz, dev1Khz: deviation.toneDevKhz, tone2Khz: 19, dev2Khz: s.mono ? 0 : deviation.pilotDevKhz });
  const products = basebandProducts({ toneKhz: s.toneKhz, tonePct: toneAfterPct, pilotPct: s.mono ? 0 : s.pilotPct, overloadDb: s.overloadDb });
  const neighbours = neighbourHits(products.lines.filter((l) => l.kind !== 'tone' && l.kind !== 'pilot'));
  const thd = Number.isFinite(opts.thdPercent) ? opts.thdPercent : 100 * Math.sqrt(products.lines.filter((l) => l.kind === 'harmonic').reduce((q, l) => q + l.amp * l.amp, 0)) / Math.max(1e-9, products.a1);
  let toneKey = s.mono ? toneKeyHarmonics({ toneKhz: s.toneKhz, levelDb: db20(toneAfterPct / 100), thdPercent: thd }) : null;
  if (toneKey) { // where the polynomial stage has the harmonic itself (k up to 5) use its level so the two views agree
    for (const h of toneKey.harmonics) { const pl = products.lines.find((l) => l.i === h.k && l.j === 0); if (pl) h.levelDb = pl.levelDb; }
    toneKey.hits = toneKey.harmonics.filter((h) => h.inWindow);
    toneKey.worstDb = toneKey.hits.length ? Math.max(...toneKey.hits.map((h) => h.levelDb)) : -Infinity;
  }
  const notes = [];
  if (!s.mono && s.toneKhz > 15) notes.push(`${s.toneKhz} kHz is above the 15 kHz audio limit: the low-pass removes ${att.toFixed(0)} dB (assumed filter).`);
  if (deviation.over) notes.push(`The tone and pilot together reach ${deviation.totalPct.toFixed(0)} percent of peak deviation: the limiter clips and the products above get worse.`);
  notes.push(...beat.notes);
  if (neighbours.length) notes.push(`A product lands in the ${neighbours[0].neighbour.label} band at ${neighbours[0].line.fKhz.toFixed(1)} kHz (${neighbours[0].line.levelDb.toFixed(1)} dB).`);
  if (toneKey && toneKey.hits.length) notes.push(`Harmonic ${toneKey.hits[0].k} of the tone (${toneKey.hits[0].fKhz.toFixed(2)} kHz) falls in the tone-key window around ${toneKey.toneKeyKhz} kHz at ${toneKey.hits[0].levelDb.toFixed(1)} dB.`);
  return { settings: s, filter: { attenuationDb: att, toneAfterPct }, beat, alias: decoderAlias(s.toneKhz), deviation, fm, products, neighbours, toneKey, notes };
}
