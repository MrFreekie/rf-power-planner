// Audio processing maths (js/model/audio-processing.js). Hand values are stated next to each assertion with tolerances.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPHASIS_TAU_US, emphasisCornerHz, emphasisMagnitudeDb, emphasisResponse, preEmphasis, deEmphasis, fmNoiseSpectrumDb,
  deEmphasisNoiseImprovementDb, preEmphasisDeviation, preEmphasisDeviationSweep,
  COMPANDER_DEFAULTS, compressDb, expandDb, companderTransferCurve, companderMismatchErrorDb, companderProcess, companderRoundTrip,
  companderNoiseStatic, companderNoiseDemo, BROADCAST_AUDIO_CHAIN, broadcastAudioChain,
} from '../js/model/audio-processing.js';

const L20 = (x) => 20 * Math.log10(x);
const rms = (a, from, to) => { let s = 0; for (let n = from; n < to; n++) s += a[n] * a[n]; return Math.sqrt(s / (to - from)); };
const sine = (fs, n, hz, amp) => Float64Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / fs));

test('emphasis corners: 50 us -> 3183 Hz, 75 us -> 2122 Hz (tolerance 0.5 Hz)', () => {
  assert.deepEqual({ ...EMPHASIS_TAU_US }, { eu: 50, us: 75 });
  assert.ok(Math.abs(emphasisCornerHz(50) - 3183.1) < 0.5);
  assert.ok(Math.abs(emphasisCornerHz(75) - 2122.1) < 0.5);
});

test('emphasis magnitude: +-3.01 dB at the corner, 20.04 dB at ten times the corner, inverse pair', () => {
  const f1 = emphasisCornerHz(50);
  assert.ok(Math.abs(emphasisMagnitudeDb(f1, 50, 'pre') - 3.0103) < 1e-3);
  assert.ok(Math.abs(emphasisMagnitudeDb(f1, 50, 'de') + 3.0103) < 1e-3);
  assert.ok(Math.abs(emphasisMagnitudeDb(10 * f1, 50) - 10 * Math.log10(101)) < 1e-9);   // 20.04 dB
  assert.ok(Math.abs(emphasisMagnitudeDb(100, 50)) < 0.01);                              // flat well below the corner
  // 15 kHz at 75 us: 10 log10(1 + (15000/2122.07)^2) = 17.07 dB (tolerance 0.02)
  assert.ok(Math.abs(emphasisMagnitudeDb(15000, 75) - 17.07) < 0.02);
  const r = emphasisResponse([1000, 5000], 50, 'pre'), d = emphasisResponse([1000, 5000], 50, 'de');
  assert.ok(Math.abs(r[0] + d[0]) < 1e-12 && Math.abs(r[1] + d[1]) < 1e-12);
});

test('time domain: de-emphasis follows the analogue magnitude; pre then de returns the input', () => {
  const fs = 192000, n = 19200;
  for (const [hz, tau] of [[3183.1, 50], [10000, 50], [2122.1, 75]]) {
    const y = deEmphasis(sine(fs, n, hz, 1), fs, tau);
    const g = L20(rms(y, 9600, n) / rms(sine(fs, n, hz, 1), 9600, n));
    assert.ok(Math.abs(g - emphasisMagnitudeDb(hz, tau, 'de')) < 0.15, `${hz} Hz ${g}`);   // tolerance 0.15 dB at fs = 192 kHz
  }
  const x = Float64Array.from({ length: 5000 }, (_, i) => Math.sin(i * 0.37) * Math.cos(i * 0.011) + ((i * 7919) % 13) / 13 - 0.5);
  for (const tau of [50, 75]) {
    const back = deEmphasis(preEmphasis(x, 48000, tau), 48000, tau);
    let maxErr = 0; for (let i = 0; i < x.length; i++) maxErr = Math.max(maxErr, Math.abs(back[i] - x[i]));
    assert.ok(maxErr < 1e-12, `round trip error ${maxErr}`);
    // unity DC gain: a constant is preserved by both
    assert.ok(Math.abs(deEmphasis(new Float64Array(2000).fill(1), 48000, tau)[1999] - 1) < 1e-6);
  }
});

test('FM noise triangle: 6 dB per octave, de-emphasis flattens it', () => {
  assert.ok(Math.abs(fmNoiseSpectrumDb(2000) - fmNoiseSpectrumDb(1000) - 6.0206) < 1e-3);
  assert.ok(Math.abs(fmNoiseSpectrumDb(8000) - fmNoiseSpectrumDb(1000) - 18.0618) < 1e-3);
  // with 75 us de-emphasis the slope above ten corners is about 0 dB/octave
  const hi = fmNoiseSpectrumDb(40000, { tauUs: 75 }) - fmNoiseSpectrumDb(20000, { tauUs: 75 });
  assert.ok(Math.abs(hi) < 0.05, String(hi));
  assert.ok(fmNoiseSpectrumDb(15000, { tauUs: 75 }) < fmNoiseSpectrumDb(15000) - 16);
});

test('noise improvement: closed form agrees with numeric integration; 75 us about 13.2 dB, 50 us about 10.2 dB', () => {
  for (const tau of [50, 75]) {
    const f1 = emphasisCornerHz(tau);
    const N = 200000, a = 20, b = 15000, h = (b - a) / N;   // midpoint rule
    let flat = 0, de = 0;
    for (let i = 0; i < N; i++) { const f = a + (i + 0.5) * h; flat += f * f * h; de += (f * f / (1 + (f / f1) ** 2)) * h; }
    const r = deEmphasisNoiseImprovementDb({ tauUs: tau });
    assert.ok(Math.abs(r.improvementDb - 10 * Math.log10(flat / de)) < 1e-4, String(tau));
    assert.ok(Math.abs(r.noiseFlat - flat) / flat < 1e-6);
  }
  assert.ok(Math.abs(deEmphasisNoiseImprovementDb({ tauUs: 75 }).improvementDb - 13.2) < 0.05);
  assert.ok(Math.abs(deEmphasisNoiseImprovementDb({ tauUs: 50 }).improvementDb - 10.17) < 0.05);
  assert.ok(deEmphasisNoiseImprovementDb({ tauUs: 75 }).improvementDb > deEmphasisNoiseImprovementDb({ tauUs: 50 }).improvementDb);
  // a narrower audio band gains less (the triangle is mostly at the top of the band)
  assert.ok(deEmphasisNoiseImprovementDb({ tauUs: 50, fmaxHz: 5000 }).improvementDb < 4);
});

test('pre-emphasis headroom: HF flat-level tones over-deviate', () => {
  // 50 us, reference 22.5 kHz at low frequency, limit 75 kHz: at 15 kHz boost = 10 log10(1 + 4.712^2) = 13.7 dB, deviation 22.5 * 4.85 = 109 kHz
  const hi = preEmphasisDeviation({ freqHz: 15000, tauUs: 50 });
  assert.ok(Math.abs(hi.boostDb - 13.70) < 0.05, String(hi.boostDb));
  assert.ok(Math.abs(hi.deviationKhz - 22.5 * 10 ** (hi.boostDb / 20)) < 1e-9);
  assert.equal(hi.overLimit, true);
  assert.ok(hi.overDb > 0);
  assert.ok(Math.abs(hi.maxLevelDb - (L20(75 / 22.5) - hi.boostDb)) < 1e-9);   // 10.46 - 13.70 = -3.2 dB
  const lo = preEmphasisDeviation({ freqHz: 200, tauUs: 50 });
  assert.equal(lo.overLimit, false);
  assert.ok(lo.deviationKhz < 23 && lo.deviationKhz > 22.5);
  // level at the maxLevel puts the tone exactly at the limit
  const edge = preEmphasisDeviation({ freqHz: 15000, tauUs: 50, levelDb: hi.maxLevelDb });
  assert.ok(Math.abs(edge.deviationKhz - 75) < 1e-9);
  // boost rises monotonically with frequency
  const sweep = preEmphasisDeviationSweep([500, 2000, 5000, 15000], { tauUs: 75 });
  for (let i = 1; i < sweep.length; i++) assert.ok(sweep[i].deviationKhz > sweep[i - 1].deviationKhz);
  assert.ok(preEmphasisDeviation({ freqHz: 15000, tauUs: 75 }).boostDb > hi.boostDb);   // 75 us boosts more
});

test('compander static law: 2:1 compress, 1:2 expand, reference level fixed, round trip identity', () => {
  const p = { ratio: 2, refDb: -20 };
  assert.equal(compressDb(-60, p), -40);
  assert.equal(compressDb(-20, p), -20);
  assert.equal(compressDb(-80, p), -50);
  assert.equal(expandDb(-40, p), -60);
  assert.equal(expandDb(-20, p), -20);
  for (const row of companderTransferCurve([-90, -60, -30, -20, -5], p)) assert.ok(Math.abs(row.roundTripDb - row.inDb) < 1e-12);
  assert.equal(compressDb(-60, { ratio: 3, refDb: -20 }), -20 - 40 / 3);
  assert.equal(COMPANDER_DEFAULTS.ratio, 2);
});

test('compander mismatch: wrong reference or ratio gives a level error', () => {
  const tx = { ratio: 2, refDb: -20 };
  assert.ok(Math.abs(companderMismatchErrorDb(-50, tx, tx)) < 1e-12);
  // rx reference -10: out = -10 + 2 (Lc + 10) with Lc = -20 + (L + 20)/2  -> L - 10: constant -10 dB at every level
  for (const L of [-70, -40, -15]) assert.ok(Math.abs(companderMismatchErrorDb(L, tx, { ratio: 2, refDb: -10 }) + 10) < 1e-12);
  // rx ratio 3 with the same reference: error = (3 - 2)/2 (L + 20) = 0.5 (L + 20): -20 dB at L = -60, 0 at the reference
  assert.ok(Math.abs(companderMismatchErrorDb(-60, tx, { ratio: 3, refDb: -20 }) + 20) < 1e-12);
  assert.ok(Math.abs(companderMismatchErrorDb(-20, tx, { ratio: 3, refDb: -20 })) < 1e-12);
});

test('compander time domain: steady-state gain follows the static law; round trip near identity', () => {
  const fs = 48000;
  const p = { ratio: 2, refDb: -20, attackMs: 3, releaseMs: 50 };
  // -50 dB sine at 1 kHz: compress gain = (1/2 - 1)(-50 + 20) = +15 dB (tolerance 1 dB: the peak-like detector ripples and reads up to about 1 dB low)
  const x = sine(fs, fs, 1000, 10 ** (-50 / 20));
  const c = companderProcess(x, 'compress', p, fs);
  assert.ok(Math.abs(c.gainDb[fs - 1] - 15) < 1.0, String(c.gainDb[fs - 1]));
  assert.ok(Math.abs(c.envDb[fs - 1] - (-50)) < 1.0);
  const e = companderProcess(x, 'expand', p, fs);
  assert.ok(Math.abs(e.gainDb[fs - 1] - (-30)) < 2.0);    // (2 - 1)(-50 + 20) = -30 dB
  // round trip, two levels with long settling: level error under 0.3 dB (tolerance for detector ripple and tracking)
  for (const db of [-30, -55]) {
    const s = sine(fs, fs, 1000, 10 ** (db / 20));
    const rt = companderRoundTrip(s, p, fs);
    const err = L20(rms(rt.output, 30000, fs) / rms(s, 30000, fs));
    assert.ok(Math.abs(err) < 0.3, `${db} dB: ${err}`);
  }
  // with HF weighting a 5 kHz tone sees more detector level than a 200 Hz tone of equal amplitude (generic weighting, 12 dB shelf at 1 kHz)
  const w = { ...p, hfWeight: { cornerHz: 1000, boostDb: 12 } };
  const hf = companderProcess(sine(fs, fs, 5000, 0.01), 'compress', w, fs).envDb[fs - 1];
  const lf = companderProcess(sine(fs, fs, 200, 0.01), 'compress', w, fs).envDb[fs - 1];
  assert.ok(hf - lf > 6, `${hf - lf}`);
  // matched HF-weighted round trip is still near identity for a 3 kHz tone
  const s3 = sine(fs, fs, 3000, 10 ** (-40 / 20));
  const rt3 = companderRoundTrip(s3, w, fs);
  assert.ok(Math.abs(L20(rms(rt3.output, 30000, fs) / rms(s3, 30000, fs))) < 0.4);
});

test('compander noise reduction: static figures and the time-domain demo with a breathing tail', () => {
  // signal -40 dB, channel noise -60 dB, ref -20, 2:1: compressed signal -30; expander gain (2-1)(-30 + 20) = -10 dB
  // (envelope includes the -60 dB noise: gain -9.9957 dB); noise out -70.0 dB: reduced 10 dB. In silence: gain -40, noise -100 dB.
  const s = companderNoiseStatic({ signalDb: -40, noiseDb: -60, ratio: 2, refDb: -20 });
  assert.equal(s.channelSignalDb, -30);
  assert.ok(Math.abs(s.noiseReductionDb - 10) < 0.01);
  assert.ok(Math.abs(s.noiseOutDb - (-70)) < 0.01);
  assert.equal(s.silenceNoiseOutDb, -100);
  assert.equal(s.silenceReductionDb, 40);
  // louder signal -> less reduction (noise breathes up with the programme)
  assert.ok(companderNoiseStatic({ signalDb: -25, noiseDb: -60 }).noiseReductionDb < s.noiseReductionDb);
  const d = companderNoiseDemo({ toneDb: -30, noiseDb: -60, seed: 3 });
  assert.ok(Math.abs(d.noiseRmsDbWithout - (-60)) < 0.3);               // measured channel noise rms
  assert.ok(d.tailNoiseReductionDb > 20, String(d.tailNoiseReductionDb)); // static law predicts 40 dB in silence; the release time limits it
  // breathing: expander gain during the burst is much higher than in the tail
  const nb = 24000;
  assert.ok(d.expandGainDb[nb - 100] - d.expandGainDb[d.expandGainDb.length - 1] > 25);
  assert.equal(d.output.length, d.input.length);
  // reproducible with a seed
  assert.deepEqual(Array.from(companderNoiseDemo({ seed: 3 }).output.slice(0, 5)), Array.from(companderNoiseDemo({ seed: 3 }).output.slice(0, 5)));
  // mismatch demo: expander reference 10 dB higher lowers the output tone by 10 dB (tolerance 0.5 dB)
  const mm = companderNoiseDemo({ toneDb: -30, noiseDb: -90, rxParams: { ratio: 2, refDb: -10, attackMs: 3, releaseMs: 100 } });
  const ok = companderNoiseDemo({ toneDb: -30, noiseDb: -90 });
  const diff = L20(rms(mm.output, 12000, 24000) / rms(ok.output, 12000, 24000));
  assert.ok(Math.abs(diff + 10) < 0.5, String(diff));
});

test('broadcast chain data', () => {
  assert.deepEqual(BROADCAST_AUDIO_CHAIN.map((s) => s.id), ['source', 'pre-emphasis', 'limiter', 'composite-clipper', 'mpx', 'fm-link', 'de-emphasis']);
  for (const s of BROADCAST_AUDIO_CHAIN) { assert.ok(s.label && s.explain); assert.ok(!s.explain.includes('\n')); }
  assert.ok(Object.isFrozen(BROADCAST_AUDIO_CHAIN));
  const c = broadcastAudioChain(); c.reverse();
  assert.equal(BROADCAST_AUDIO_CHAIN[0].id, 'source');
});
