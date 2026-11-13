import test from 'node:test';
import assert from 'node:assert/strict';
import {
  noiseFloorDbm, cnrDb, stereoBlend, stereoSeparationDb, audioSnrDb, pilotStep,
  mpxState, mpxSpectrum, monoBlendAudio,
} from '../js/model/mpx.js';

// Explicit config so tests do not depend on the tuned parameter values.
test('params file integration: defaults and presets work through the model', async () => {
  const { MPX_DEFAULTS, MPX_PRESETS } = await import('../js/model/mpx-params.js');
  for (const p of [MPX_DEFAULTS, ...Object.values(MPX_PRESETS)]) {
    const nf = noiseFloorDbm(p);
    near(nf, -174 + 10 * Math.log10(p.channelBwKhz * 1000) + p.noiseFigureDb, 1e-9);
    const hi = mpxState(-50, p, null);
    assert.equal(hi.mode, 'stereo');
    assert.ok(Number.isFinite(hi.audioSnrDb) && hi.audioSnrDb <= p.snrCeilingDb);
    const lo = mpxState(nf + 3, p, null);
    assert.equal(lo.mode, 'mono');
    const ps = pilotStep(true, p.pilotLoseCnrDb, p);
    assert.equal(ps.locked, true);
    assert.equal(pilotStep(true, p.pilotLoseCnrDb - 0.01, p).locked, false);
  }
});

const CFG = {
  bandwidthHz: 200000, noiseFigureDb: 8, thresholdCnrDb: 12,
  blendStartCnrDb: 30, blendEndCnrDb: 18,
  pilotDetectCnrDb: 14, pilotHysteresisDb: 2, pilotInjection: 0.1,
  fmImprovementDb: 26.5, stereoPenaltyDb: 22, maxSeparationDb: 40,
};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, want ${b} +/- ${tol}`);

test('noise floor: 200 kHz, NF 8 dB = -174 + 53.01 + 8 = -112.99 dBm (+/-0.1)', () => {
  near(noiseFloorDbm({ bandwidthHz: 200000, noiseFigureDb: 8 }), -112.99, 0.1);
  near(noiseFloorDbm({ bandwidthHz: 1, noiseFigureDb: 0 }), -174, 1e-9);
  near(noiseFloorDbm({ bandwidthHz: 1e6, noiseFigureDb: 0 }), -114, 1e-9);
});

test('cnrDb = input - noise floor', () => {
  near(cnrDb(-83, CFG), 29.99, 0.1);
  assert.equal(cnrDb(NaN, CFG), -Infinity);
});

test('stereoBlend: endpoints, midpoint, clamped, monotonic', () => {
  assert.equal(stereoBlend(40, CFG), 1);
  assert.equal(stereoBlend(30, CFG), 1);
  assert.equal(stereoBlend(18, CFG), 0);
  assert.equal(stereoBlend(-20, CFG), 0);
  near(stereoBlend(24, CFG), 0.5, 1e-12); // t = 0.5 -> 0.25*(3-1) = 0.5
  near(stereoBlend(21, CFG), 0.15625, 1e-9); // t=0.25 -> 0.0625*2.5
  let prev = -1;
  for (let c = 0; c <= 50; c += 0.25) {
    const b = stereoBlend(c, CFG);
    assert.ok(b >= 0 && b <= 1);
    assert.ok(b >= prev - 1e-12);
    prev = b;
  }
});

test('stereoSeparationDb: large at full stereo, about 0 at mono, monotonic in blend', () => {
  near(stereoSeparationDb(1, 40, CFG), 40, 0.5); // residual 0.01 -> 20log10(1/0.01)
  near(stereoSeparationDb(0, 40, CFG), 0, 0.2);
  assert.ok(stereoSeparationDb(0, 5, CFG) >= 0);
  // noise-limited at low CNR: cnr 20 -> sepMax 30
  near(stereoSeparationDb(1, 20, CFG), 30, 0.5);
  let prev = -1;
  for (let b = 0; b <= 1.0001; b += 0.05) {
    const s = stereoSeparationDb(b, 40, CFG);
    assert.ok(s >= prev - 1e-9);
    prev = s;
  }
});

test('audioSnrDb: improvement, stereo penalty, threshold roll-off', () => {
  near(audioSnrDb(30, { ...CFG, stereo: false }), 56.5, 1e-9);
  near(audioSnrDb(30, { ...CFG, stereo: true, blend: 1 }), 34.5, 1e-9);
  near(audioSnrDb(30, { ...CFG, stereo: true, blend: 0 }), 56.5, 1e-9);
  near(audioSnrDb(30, { ...CFG, stereo: true, blend: 0.5 }), 56.5 - 10 * Math.log10(1 + 0.25 * (Math.pow(10, 2.2) - 1)), 1e-9);
  near(audioSnrDb(30, { ...CFG, stereo: true, blend: 0.5 }), 40.44, 0.01); // penalty 16.06 dB
  // at threshold: no roll-off yet
  near(audioSnrDb(12, { ...CFG, stereo: false }), 38.5, 1e-9);
  // 4 dB below: 8 + 26.5 - 8 = 26.5 -> 3 dB audio per dB CNR (38.5 - 12)
  near(audioSnrDb(8, { ...CFG, stereo: false }), 26.5, 1e-9);
  // far below: floored at cnr - 3
  near(audioSnrDb(-20, { ...CFG, stereo: false }), -23, 1e-9);
  // monotonic in cnr
  let prev = -Infinity;
  for (let c = -10; c <= 50; c += 0.5) {
    const s = audioSnrDb(c, { ...CFG, stereo: false });
    assert.ok(s >= prev - 1e-9, `non-monotonic at ${c}`);
    prev = s;
  }
});

test('pilotStep hysteresis sequences', () => {
  // detect 14, hysteresis 2 -> lock >= 14, hold >= 12
  let r = pilotStep(false, 13.9, CFG);
  assert.equal(r.locked, false);
  near(r.marginDb, -0.1, 1e-9);
  r = pilotStep(false, 14, CFG);
  assert.equal(r.locked, true);
  near(r.marginDb, 0, 1e-9);
  assert.equal(pilotStep(true, 12, CFG).locked, true); // inside hysteresis band
  assert.equal(pilotStep(true, 11.99, CFG).locked, false);
  assert.equal(pilotStep(false, 13, CFG).locked, false); // does not relock inside the band
  // sweep down then up
  let locked = false;
  const seq = [20, 15, 13, 12.5, 11, 13, 13.9, 14.1, 12.1];
  const out = [];
  for (const c of seq) { locked = pilotStep(locked, c, CFG).locked; out.push(locked); }
  assert.deepEqual(out, [true, true, true, true, false, false, false, true, true]);
  assert.equal(pilotStep(true, -Infinity, CFG).locked, false);
});

test('mpxState: strong -> stereo, weak -> mono, mid -> blend, pilot lock needs hysteresis', () => {
  const strong = mpxState(-60, CFG, null);
  assert.equal(strong.mode, 'stereo');
  assert.equal(strong.blend, 1);
  assert.equal(strong.pilotLocked, true);
  near(strong.pilotLevelDb, -20, 1e-9);
  assert.equal(strong.lrLeak, 0);
  assert.ok(strong.separationDb > 35);
  near(strong.audioSnrDb, strong.cnrDb + 26.5 - 22, 1e-6);

  const weak = mpxState(-105, CFG, null); // CNR about 8
  assert.equal(weak.mode, 'mono');
  assert.equal(weak.blend, 0);
  assert.equal(weak.pilotLocked, false);
  assert.equal(weak.lrLeak, 0.5);
  near(weak.separationDb, 0, 0.5);

  const mid = mpxState(-89, CFG, { pilotLocked: true }); // CNR about 24
  assert.equal(mid.mode, 'blend');
  assert.ok(mid.blend > 0.4 && mid.blend < 0.6);
  near(mid.lrLeak, (1 - mid.blend) / 2, 1e-12);

  // pilot lock hysteresis through mpxState: CNR 13 (input -100) only holds if previously locked
  assert.equal(mpxState(-100, CFG, { pilotLocked: false }).pilotLocked, false);
  assert.equal(mpxState(-100, CFG, { pilotLocked: true }).pilotLocked, true);
  // falling level: mode follows stereo -> blend -> mono monotonically
  let st = null; const modes = [];
  for (let d = -60; d >= -110; d -= 2) { st = mpxState(d, CFG, st); modes.push(st.mode); }
  const rank = { stereo: 2, blend: 1, mono: 0 };
  for (let i = 1; i < modes.length; i++) assert.ok(rank[modes[i]] <= rank[modes[i - 1]]);
  assert.equal(modes[0], 'stereo');
  assert.equal(modes[modes.length - 1], 'mono');
});

test('mpxSpectrum: shape, pilot bin at 19 kHz, L-R shrinks with blend', () => {
  const full = mpxState(-60, CFG, null);
  const s = mpxSpectrum(full);
  assert.equal(s.freqKHz.length, 256);
  assert.equal(s.levelDb.length, 256);
  assert.equal(s.noiseDb.length, 256);
  near(s.freqKHz[0], 0, 1e-12);
  near(s.freqKHz[255], 60, 1e-9);
  assert.deepEqual(s.bands, { lpr: [0.03, 15], pilot: 19, lmr: [23, 53] });
  const pi = s.freqKHz.indexOf(19);
  assert.ok(pi > 0, 'a bin at exactly 19 kHz');
  // pilot is the peak between 16 and 22 kHz, sticks out of neighbours by many dB
  for (let i = 0; i < 256; i++) if (s.freqKHz[i] > 17 && s.freqKHz[i] < 21 && i !== pi) assert.ok(s.levelDb[i] < s.levelDb[pi] - 10);
  near(s.levelDb[pi], -20, 0.5);
  // monotonic frequency axis
  for (let i = 1; i < 256; i++) assert.ok(s.freqKHz[i] > s.freqKHz[i - 1]);
  // noise rises with frequency (triangular): +6 dB per octave
  const k = (f) => s.freqKHz.reduce((bi, x, i) => (Math.abs(x - f) < Math.abs(s.freqKHz[bi] - f) ? i : bi), 0);
  near(s.noiseDb[k(40)] - s.noiseDb[k(20)], 6.02, 0.3);

  const lmrEnergy = (spec) => {
    let e = 0;
    for (let i = 0; i < spec.freqKHz.length; i++) if (spec.freqKHz[i] >= 24 && spec.freqKHz[i] <= 52) e += Math.pow(10, (spec.levelDb[i] - spec.noiseDb[i] > 0 ? spec.levelDb[i] : -200) / 10);
    return e;
  };
  const mid = mpxSpectrum({ ...full, blend: 0.5 });
  const none = mpxSpectrum({ ...full, blend: 0 });
  const rawLmr = (spec) => spec.levelDb[spec.freqKHz.findIndex((f) => f >= 38)];
  assert.ok(rawLmr(s) > rawLmr(mid) + 0.0 || rawLmr(s) >= rawLmr(mid));
  assert.ok(lmrEnergy(s) > lmrEnergy(mid));
  assert.ok(lmrEnergy(mid) > lmrEnergy(none));
  // L-R at 38 kHz is 6 dB lower at blend 0.5 than at full (signal-dominated at high CNR)
  const i38 = s.freqKHz.findIndex((f) => f >= 38);
  near(s.levelDb[i38] - mid.levelDb[i38], 6.02, 0.5);
  // no L-R and no pilot -> 38 kHz is just noise
  const mono = mpxSpectrum(mpxState(-105, CFG, null));
  near(mono.levelDb[i38], mono.noiseDb[i38], 0.01);
  // weak signal: L-R lies under the noise (deeper than L+R)
  const weakFull = mpxSpectrum({ cnrDb: 15, blend: 1, pilotLevelDb: -20 });
  const iLpr = weakFull.freqKHz.findIndex((f) => f >= 14);
  const mLmr = weakFull.levelDb[i38] - weakFull.noiseDb[i38];
  const mLpr = weakFull.levelDb[iLpr] - weakFull.noiseDb[iLpr];
  assert.ok(mLmr < 6 && mLmr < mLpr - 6, `L-R margin ${mLmr} vs L+R ${mLpr}`);
  // deterministic, and seed ripple is bounded
  assert.deepEqual(mpxSpectrum(full), mpxSpectrum(full));
  const r1 = mpxSpectrum(full, { seed: 3 });
  for (let i = 0; i < 256; i++) assert.ok(Math.abs(r1.noiseDb[i] - s.noiseDb[i]) <= 0.4 + 1e-9);
  // custom points/maxKHz
  const small = mpxSpectrum(full, { points: 64, maxKHz: 30 });
  assert.equal(small.freqKHz.length, 64);
  assert.ok(small.freqKHz.includes(19));
});

test('monoBlendAudio mixes toward (l+r)/2', () => {
  const a = { l: 1, r: 0 };
  assert.deepEqual(monoBlendAudio(a, 1), { l: 1, r: 0 });
  assert.deepEqual(monoBlendAudio(a, 0), { l: 0.5, r: 0.5 });
  const h = monoBlendAudio(a, 0.5);
  near(h.l, 0.75, 1e-12);
  near(h.r, 0.25, 1e-12);
  // leak consistency: L reaches R with (1-b)/2
  const lk = monoBlendAudio({ l: 1, r: 0 }, 0.3);
  near(lk.r, (1 - 0.3) / 2, 1e-12);
  // clamped
  assert.deepEqual(monoBlendAudio(a, 2), { l: 1, r: 0 });
  assert.deepEqual(monoBlendAudio(a, -1), { l: 0.5, r: 0.5 });
});

test('pilotPresent=false never locks; muted follows pilotSquelchEnabled', () => {
  const a = mpxState(-60, { ...CFG, pilotSquelchEnabled: false }, { pilotLocked: true }, { pilotPresent: false });
  assert.equal(a.pilotLocked, false);
  assert.equal(a.mode, 'mono');
  assert.equal(a.muted, false);
  const b = mpxState(-60, { ...CFG, pilotSquelchEnabled: true }, null, { pilotPresent: false });
  assert.equal(b.muted, true);
  assert.equal(mpxState(-60, { ...CFG, pilotSquelchEnabled: true }, null).muted, false); // pilot locked -> not muted
  assert.equal(mpxSpectrum(a).exaggeratedNoise, true);
});
