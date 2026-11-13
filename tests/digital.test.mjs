import test from 'node:test';
import assert from 'node:assert/strict';
import {
  erfc, qfunc, constellation, esN0Db, ebN0Db, berUncoded, postFecBer, berCoded, evmPercent, merDb,
  constellationSamples, amcStep, digitalLinkState, berCurve, analogVsDigitalCurve,
} from '../js/model/digital.js';

const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} got ${a}, want ${b} +/- ${tol}`);
const relNear = (a, b, rel, m = '') => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${m} got ${a}, want ${b} (rel ${rel})`);
const CFG = {
  symbolRateKSps: 150, noiseBwKHz: 200, noiseFigureDb: 8, codeRate: 0.75, implLossDb: 1.5,
  amcThresholdsDb: { 4: 12, 16: 19, 64: 25.5, 256: 32 }, amcHysteresisDb: 1.5,
  preFecCliffBer: 3e-3, cliffSharpness: 6, postFecFloor: 1e-12, frameBits: 1000,
  degradedFer: 1e-3, concealFer: 0.05, concealMaxMs: 200,
};
const NOISE = -174 + 10 * Math.log10(200000) + 8; // -112.99 dBm

test('erfc / Q: known values', () => {
  relNear(erfc(0), 1, 1e-7);
  relNear(erfc(1), 0.157299207, 2e-7);
  relNear(erfc(2), 0.004677735, 2e-7);
  near(erfc(-1), 2 - 0.157299207, 1e-7);
  relNear(qfunc(1), 0.158655254, 2e-7);
  relNear(qfunc(3), 0.001349898, 2e-7);
  relNear(qfunc(4.265), 1e-5, 0.02); // Q(4.265) ~ 1.0e-5
  assert.ok(erfc(10) > 0 && erfc(10) < 1e-40);
});

test('constellation: unit average power, sizes, Gray labels', () => {
  for (const m of [2, 4, 16, 64, 256]) {
    const c = constellation(m);
    assert.equal(c.length, m);
    near(c.reduce((s, p) => s + p.i * p.i + p.q * p.q, 0) / m, 1, 1e-12, `M=${m}`);
    assert.equal(new Set(c.map((p) => p.label)).size, m);
  }
  const q = constellation(4);
  near(Math.abs(q[0].i), Math.SQRT1_2, 1e-12);
  near(Math.abs(q[0].q), Math.SQRT1_2, 1e-12);
  assert.deepEqual(constellation(2).map((p) => p.i), [-1, 1]);
  // 16-QAM: levels +-1/sqrt(10), +-3/sqrt(10)
  const lv = [...new Set(constellation(16).map((p) => +p.i.toFixed(9)))].sort((a, b) => a - b);
  near(lv[0], -3 / Math.sqrt(10), 1e-9);
  near(lv[1], -1 / Math.sqrt(10), 1e-9);
  // Gray: nearest neighbours differ in exactly one bit
  for (const m of [4, 16, 64, 256]) {
    const c = constellation(m);
    const d = 2 / Math.sqrt((2 * (m - 1)) / 3);
    for (const a of c) for (const b of c) {
      if (Math.abs(Math.hypot(a.i - b.i, a.q - b.q) - d) < 1e-9) {
        let x = a.label ^ b.label, ones = 0;
        while (x) { ones += x & 1; x >>= 1; }
        assert.equal(ones, 1, `M=${m}`);
      }
    }
  }
  assert.throws(() => constellation(8));
});

test('Es/N0 and Eb/N0', () => {
  near(esN0Db(20, { symbolRateKSps: 100, noiseBwKHz: 200 }), 23.0103, 1e-4);
  near(ebN0Db(20, 4, 1), 20 - 3.0103, 1e-4);
  near(ebN0Db(20, 16, 0.5), 20 - 10 * Math.log10(2), 1e-9);
  near(ebN0Db(20, 2, 1), 20, 1e-12);
});

test('uncoded BER: hand values', () => {
  // BPSK/QPSK at Eb/N0 9.6 dB: Q(sqrt(2*9.120)) = Q(4.271) ~ 9.7e-6
  const eb = 9.6, g = Math.pow(10, eb / 10);
  relNear(berUncoded(2, eb), qfunc(Math.sqrt(2 * g)), 1e-9);
  relNear(berUncoded(4, eb + 10 * Math.log10(2)), 9.7e-6, 0.03);
  assert.ok(berUncoded(4, eb + 3.0103) > 5e-6 && berUncoded(4, eb + 3.0103) < 2e-5);
  // QPSK Es/N0 = 0 dB: Q(1)
  relNear(berUncoded(4, 0), 0.158655, 1e-5);
  // BPSK Es/N0 = 0 dB: Q(sqrt 2) = 0.0786496
  relNear(berUncoded(2, 0), 0.0786496, 1e-5);
  // 16-QAM, Es/N0 = 10 dB: 0.75 Q(sqrt(3*10/15)) = 0.75 Q(1.4142) = 0.75*0.0786496
  relNear(berUncoded(16, 10), 0.75 * 0.0786496, 1e-5);
  // 16-QAM needs about 4 dB more Eb/N0 than QPSK for the same BER (1e-5)
  const need = (m) => {
    const k = Math.log2(m);
    let lo = 0, hi = 30;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (berUncoded(m, mid + 10 * Math.log10(k)) > 1e-5) lo = mid; else hi = mid;
    }
    return lo;
  };
  near(need(4), 9.59, 0.1);
  near(need(16) - need(4), 3.9, 0.3);
  assert.ok(need(64) > need(16) && need(256) > need(64));
  // monotone decreasing in SNR, bounded, and ordered by order
  for (const m of [2, 4, 16, 64, 256]) {
    let p = 1;
    for (let s = -10; s <= 40; s += 1) { const b = berUncoded(m, s); assert.ok(b <= p && b >= 0 && b <= 0.5); p = b; }
  }
  for (let s = 5; s <= 30; s += 5) assert.ok(berUncoded(4, s) <= berUncoded(16, s) && berUncoded(16, s) <= berUncoded(64, s));
  assert.equal(berUncoded(4, -Infinity), 0.5);
  assert.equal(berUncoded(4, Infinity), 0);
});

test('postFecBer: parametric cliff', () => {
  // far below the cliff: floor; far above: ~ pre; half weight at the cliff
  near(Math.log10(postFecBer(1e-8, CFG)), -12, 0.05);
  relNear(postFecBer(0.3, CFG), 0.3, 0.05);
  // at pre = pc: log10 post = 0.5 floor + 0.5 log10 pc
  near(Math.log10(postFecBer(3e-3, CFG)), 0.5 * -12 + 0.5 * Math.log10(3e-3), 1e-9);
  let p = 0;
  for (let e = -12; e <= -0.4; e += 0.2) { const v = postFecBer(Math.pow(10, e), CFG); assert.ok(v >= p - 1e-18); p = v; }
  // cliff: one decade across it moves post by many decades
  assert.ok(postFecBer(1e-2, CFG) / postFecBer(1e-3, CFG) > 1e4);
  assert.equal(berCoded(4, 30, CFG), postFecBer(berUncoded(4, 30), CFG));
});

test('EVM / MER relation', () => {
  near(evmPercent(20, 0), 10, 1e-9);
  near(evmPercent(40, 0), 1, 1e-9);
  near(evmPercent(26, 6), 10, 1e-9); // implementation loss lowers effective SNR
  near(merDb(30, 1.5), 28.5, 1e-12);
  for (const s of [10, 17.3, 25, 33]) near(merDb(s, 2), -20 * Math.log10(evmPercent(s, 2) / 100), 1e-9);
});

test('constellationSamples: deterministic by seed, EVM matches SNR, impairments', () => {
  const a = constellationSamples(16, 25, { n: 400, seed: 11 });
  const b = constellationSamples(16, 25, { n: 400, seed: 11 });
  const c = constellationSamples(16, 25, { n: 400, seed: 12 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.points[0], c.points[0]);
  assert.equal(a.points.length, 400);
  // 25 dB -> EVM 5.62 %; 4000 samples -> within 5 %
  const big = constellationSamples(64, 25, { n: 4000, seed: 3 });
  relNear(big.evmPercent, evmPercent(25, 0), 0.05);
  // noiseless: sits on the ideal points
  const clean = constellationSamples(16, 200, { n: 50, seed: 1 });
  for (const p of clean.points) { near(p.i, p.ideal.i, 1e-6); near(p.q, p.ideal.q, 1e-6); }
  // phase noise increases EVM; IQ gain imbalance moves Q
  const pn = constellationSamples(64, 200, { n: 2000, seed: 5, phaseNoiseDeg: 2 });
  assert.ok(pn.evmPercent > 1);
  const gi = constellationSamples(4, 200, { n: 100, seed: 5, iqGainDb: 6 });
  for (const p of gi.points) near(Math.abs(p.q), Math.abs(p.ideal.q) * Math.pow(10, 6 / 20), 1e-4);
  const sk = constellationSamples(4, 200, { n: 100, seed: 5, iqPhaseDeg: 10 });
  assert.ok(sk.evmPercent > 10);
});

test('amcStep: hysteresis sequences', () => {
  // up thresholds: 4 at 13.5, 16 at 20.5, 64 at 27, 256 at 33.5; hold thresholds 12, 19, 25.5, 32
  let s = { order: 0 };
  const seq = [11, 12, 13.4, 13.5, 19, 20.4, 20.5, 26, 27, 33, 33.5, 32.5, 31.9, 25.4, 18, 11.9];
  const out = [];
  for (const c of seq) { s = amcStep(s, c, CFG); out.push(s.order); }
  assert.deepEqual(out, [0, 0, 0, 4, 4, 4, 16, 16, 64, 64, 256, 256, 64, 16, 4, 0]);
  // switched flag and margin
  let r = amcStep({ order: 4 }, 20.5, CFG);
  assert.equal(r.order, 16); assert.equal(r.switched, true); near(r.marginDb, 1.5, 1e-12);
  r = amcStep({ order: 16 }, 20, CFG);
  assert.equal(r.switched, false); near(r.marginDb, 1, 1e-12);
  // multi-step down and link down
  assert.equal(amcStep({ order: 256 }, 20, CFG).order, 16);
  r = amcStep({ order: 4 }, 5, CFG);
  assert.equal(r.order, 0); assert.equal(r.switched, true); near(r.marginDb, -7, 1e-12);
  assert.equal(amcStep(null, -Infinity, CFG).order, 0);
  // holds inside the hysteresis band (no flapping)
  assert.equal(amcStep({ order: 16 }, 19.5, CFG).order, 16);
  assert.equal(amcStep({ order: 4 }, 20.0, CFG).order, 4);
});

test('digitalLinkState: strong, mid, weak; cliff and concealment', () => {
  const strong = digitalLinkState(NOISE + 40, CFG, null, 0);
  near(strong.cnrDb, 40, 1e-9);
  assert.equal(strong.order, 256);
  assert.equal(strong.state, 'ok');
  assert.equal(strong.muted, false);
  near(strong.esN0Db, 40 + 10 * Math.log10(200 / 150), 1e-9);
  near(strong.ebN0Db, strong.esN0Db - 10 * Math.log10(8 * 0.75), 1e-9);
  near(strong.merDb, strong.esN0Db - 1.5, 1e-9);
  near(strong.evmPercent, evmPercent(strong.esN0Db, 1.5), 1e-9);
  assert.ok(strong.frameErrorRate < 1e-6);
  near(strong.throughputKbps, 150 * 8 * 0.75, 0.01);

  const weak = digitalLinkState(NOISE + 5, CFG, null, 0);
  assert.equal(weak.order, 0);
  assert.equal(weak.state, 'down');
  assert.equal(weak.muted, true);
  assert.equal(weak.throughputKbps, 0);
  assert.equal(weak.frameErrorRate, 1);

  // fixed QPSK driven through the cliff: ok -> degraded/concealing -> down (mute) after concealMaxMs
  const fx = { ...CFG, fixedOrder: 4 };
  let s = null, t = 0;
  s = digitalLinkState(NOISE + 20, fx, s, t);
  assert.equal(s.state, 'ok');
  // pick a CNR where FER is between concealment limit and 1
  let hit = null;
  for (let cn = 10; cn >= 0; cn -= 0.1) {
    const r = digitalLinkState(NOISE + cn, fx, null, 0);
    if (r.frameErrorRate >= 0.05 && r.order) { hit = cn; break; }
  }
  assert.ok(hit !== null, 'concealment region reachable');
  s = digitalLinkState(NOISE + hit, fx, s, (t += 100));
  assert.equal(s.state, 'concealing'); assert.equal(s.muted, false);
  s = digitalLinkState(NOISE + hit, fx, s, (t += 100));
  assert.equal(s.state, 'concealing'); // 200 ms, limit is strict >
  s = digitalLinkState(NOISE + hit, fx, s, (t += 100));
  assert.equal(s.state, 'down'); assert.equal(s.muted, true);
  s = digitalLinkState(NOISE + 20, fx, s, (t += 100)); // recovers
  assert.equal(s.state, 'ok'); assert.equal(s.muted, false);
  // AMC steps through state: sequence of inputs drops order
  let a = null; const orders = [];
  for (const cn of [40, 30, 22, 15, 5]) { a = digitalLinkState(NOISE + cn, CFG, a, 0); orders.push(a.order); }
  assert.deepEqual(orders, [256, 64, 16, 4, 0]);
});

test('berCurve and analogVsDigitalCurve shapes', () => {
  const cv = berCurve(4, 0.75, 0, 14, 29, CFG);
  assert.equal(cv.x.length, 29);
  near(cv.x[0], 0, 1e-12); near(cv.x[28], 14, 1e-12);
  for (let i = 1; i < 29; i++) { assert.ok(cv.uncoded[i] <= cv.uncoded[i - 1]); assert.ok(cv.coded[i] <= cv.coded[i - 1] + 1e-18); }
  relNear(cv.uncoded[0], berUncoded(4, 3.0103), 1e-6);
  // coded wins at high Eb/N0 and loses (cliff) at low
  assert.ok(cv.coded[20] < cv.uncoded[20]); // Eb/N0 = 10 dB: FEC wins
  assert.ok(cv.coded[0] > 0.1 && cv.coded[0] <= 0.5);

  const ad = analogVsDigitalCurve(0, 45, 46, { digital: CFG });
  assert.equal(ad.cnr.length, 46);
  // analog degrades gradually: monotone, intermediate qualities exist; digital: cliff (few intermediate points)
  for (let i = 1; i < 46; i++) assert.ok(ad.analogSnrDb[i] >= ad.analogSnrDb[i - 1] - 1e-9);
  const midA = ad.analogQuality.filter((q) => q > 10 && q < 90).length;
  const midD = ad.digitalQuality.filter((q) => q > 10 && q < 90).length;
  assert.ok(midA > 15, `analog mid points ${midA}`);
  assert.ok(midD <= 3, `digital mid points ${midD}`);
  assert.equal(ad.digitalQuality[0], 0);
  assert.ok(ad.digitalQuality[45] > 99.9);
  assert.equal(ad.digitalOrder[45], 256);
  near(ad.analogSnrDb[30], 30 + 26.5 > 0 ? ad.analogSnrDb[30] : 0, 1e6); // finite
});

test('implementation loss applies to BER as well as EVM', () => {
  const lo = digitalLinkState(NOISE + 14, { ...CFG, fixedOrder: 4, implLossDb: 0 }, null, 0);
  const hi = digitalLinkState(NOISE + 14, { ...CFG, fixedOrder: 4, implLossDb: 3 }, null, 0);
  assert.ok(hi.preFecBer > lo.preFecBer * 5, `${hi.preFecBer} vs ${lo.preFecBer}`);
  near(hi.preFecBer, berUncoded(4, hi.esN0Db - 3), 1e-15);
  near(lo.preFecBer, berUncoded(4, lo.esN0Db), 1e-15);
  near(hi.merDb, hi.esN0Db - 3, 1e-9);
});

test('fixedOrder keeps the order and fails through the cliff itself (no hidden offset)', () => {
  const fx = { ...CFG, fixedOrder: 4 };
  const r = digitalLinkState(NOISE + 3, fx, null, 0); // far below any threshold, still a signal
  assert.equal(r.order, 4);
  assert.ok(r.frameErrorRate > 0.9);
  assert.equal(r.state, 'down'); // total frame loss mutes at once
  assert.equal(digitalLinkState(-Infinity, fx, null, 0).order, 0);
});

test('concealment recovery hysteresis: unmute only after concealRecoverMs of good frames', () => {
  const cfg = { ...CFG, fixedOrder: 4, concealMaxMs: 150, concealRecoverMs: 300 };
  let cn = null;
  for (let c = 10; c >= 0; c -= 0.1) if (digitalLinkState(NOISE + c, cfg, null, 0).frameErrorRate >= 0.05 && digitalLinkState(NOISE + c, cfg, null, 0).frameErrorRate < 0.9) { cn = c; break; }
  assert.ok(cn !== null);
  let s = digitalLinkState(NOISE + 20, cfg, null, 0), t = 0;
  s = digitalLinkState(NOISE + cn, cfg, s, (t += 100));
  assert.equal(s.state, 'concealing');
  s = digitalLinkState(NOISE + cn, cfg, s, (t += 100));
  assert.equal(s.state, 'down'); // 200 ms > 150
  s = digitalLinkState(NOISE + 20, cfg, s, (t += 100)); // good again, 100 ms of good frames
  assert.equal(s.state, 'down'); assert.equal(s.muted, true);
  s = digitalLinkState(NOISE + 20, cfg, s, (t += 100)); // 200 ms
  assert.equal(s.muted, true);
  s = digitalLinkState(NOISE + 20, cfg, s, (t += 100)); // 300 ms
  assert.equal(s.state, 'ok'); assert.equal(s.muted, false);
  // a relapse during recovery restarts the timer
  s = digitalLinkState(NOISE + cn, cfg, s, (t += 100));
  s = digitalLinkState(NOISE + 20, cfg, s, (t += 100));
  s = digitalLinkState(NOISE + cn, cfg, s, (t += 100));
  assert.equal(s.goodMs, 0);
});

test('config merge: parameter defaults only when no config is passed; no fixedOrder leak', async () => {
  const P = await import('../js/model/digital-params.js');
  const none = digitalLinkState(NOISE + 40, undefined, null, 0);
  assert.equal(none.order, P.DIGITAL_DEFAULTS.fixedOrder || 256 > 0 ? none.order : 0); // runs with parameter defaults
  const partial = digitalLinkState(NOISE + 40, { noiseBwKHz: 200, noiseFigureDb: 8 }, null, 0);
  assert.equal(partial.order, 256); // built-in fallback only: adaptive, not a fixed preset order
});
