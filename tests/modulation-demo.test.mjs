import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/model/modulation-demo.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test('message is normalised and the integral is exact', () => {
  for (const k of M.MESSAGE_KINDS) {
    let pk = 0; for (let i = 0; i < 5000; i++) pk = Math.max(pk, Math.abs(M.message(k, i * 0.01)));
    assert.ok(pk <= 1.001 && pk > 0.8, `${k} peak ${pk}`);
    const t = 1.37, h = 1e-5; // d/dt of the integral equals the message
    near((M.messageIntegral(k, t + h) - M.messageIntegral(k, t - h)) / (2 * h), M.message(k, t), 1e-4);
  }
});

test('Bessel functions: known values and the carrier null', () => {
  near(M.besselJ(0, 0), 1); near(M.besselJ(1, 0), 0);
  near(M.besselJ(0, 1), 0.7651976866, 1e-7); near(M.besselJ(1, 1), 0.4400505857, 1e-7); near(M.besselJ(2, 3), 0.4860912606, 1e-7);
  assert.ok(Math.abs(M.besselJ(0, M.BESSEL_NULL)) < 1e-5);
  // power conservation: J0^2 + 2 sum Jn^2 = 1
  const b = 4.2; let p = M.besselJ(0, b) ** 2; for (let n = 1; n < 30; n++) p += 2 * M.besselJ(n, b) ** 2; near(p, 1, 1e-6);
});

test('Carson bandwidth and presets', () => {
  assert.equal(M.carsonBwKhz(75, 15), 180); assert.equal(M.carsonBwKhz(40, 15), 110); assert.equal(M.carsonBwKhz(12.5, 3), 31);
  const rows = M.deviationRows(15); assert.equal(rows.length, 4);
  assert.ok(rows.find((r) => r.devKhz === 75).improvementDb > rows.find((r) => r.devKhz === 40).improvementDb);
  near(M.fmImprovementDb(75, 15), 26.53, 0.01);
  assert.ok(rows.find((r) => r.devKhz === 75).thresholdRiseDb > 0);
});

test('FM spectrum has a carrier null at beta 2.405 and AM spectrum sidebands scale with depth', () => {
  const s = M.fmSpectrum(M.BESSEL_NULL, 3);
  assert.ok(s[0].amp < 1e-4 && s.length > 4);
  const am = M.amSpectrum('sine', 0.8, 3);
  near(am.find((l) => l.kind === 'usb').amp, 0.4); near(am[0].amp, 1);
  near(M.amSidebandPowerShare(1), 1 / 3);
  assert.equal(M.amBandwidthKhz('sine', 3), 6);
});

test('AM over-modulation distorts only above 100 percent', () => {
  assert.equal(M.amDistortion('sine', 1), 0);
  assert.ok(M.amDistortion('sine', 1.2) > 0.01);
  assert.ok(M.amEnvelope('sine', 0.7, 1.2) >= 0);
});

test('constellations have unit average energy and nearest-point detection is clean at high SNR', () => {
  for (const m of M.DIGITAL_MODES) {
    const pts = M.constellation(m); assert.equal(pts.length, 2 ** M.bitsPerSymbol(m));
    near(pts.reduce((s, [i, q]) => s + i * i + q * q, 0) / pts.length, 1);
    assert.equal(M.symbolErrors(m, 0, 500, 40), 0);
  }
});

test('simulated symbol errors fall with SNR and track theory', () => {
  const lo = M.symbolErrors('QPSK', 0, 4000, 4), hi = M.symbolErrors('QPSK', 0, 4000, 14);
  assert.ok(lo > hi * 5);
  assert.equal(M.receiveSymbol('16QAM', 5, 10).tx, M.receiveSymbol('16QAM', 5, 20).tx); // same symbol, deterministic
  const e = M.symbolErrors('BPSK', 0, 20000, 4) / 20000; // BER theory at 4 dB: Q(sqrt(2*2.51))
  assert.ok(Math.abs(e - M.theoryBer('BPSK', 4)) < 0.01, `${e} vs ${M.theoryBer('BPSK', 4)}`);
});

test('Q function and theory ordering', () => {
  near(M.qfunc(0), 0.5, 1e-6); near(M.qfunc(1), 0.158655, 1e-5); near(M.qfunc(-1), 0.841345, 1e-5);
  assert.ok(M.theoryBer('16QAM', 15) > M.theoryBer('QPSK', 15));
  assert.ok(M.snrForBer('16QAM') > M.snrForBer('QPSK'));
  assert.ok(M.snrForBer('QPSK') > M.snrForBer('BPSK'));
});

test('MPX bands: pilot and suppressed carrier', () => {
  const b = M.mpxBands({ rds: true });
  assert.deepEqual(b.map((x) => x.id), ['lpr', 'pilot', 'lmr', 'sc', 'rds']);
  assert.equal(b.find((x) => x.id === 'pilot').f0, 19);
  assert.ok(M.mpxBands({ lrScale: 0 }).find((x) => x.id === 'lmr').db <= -100);
  assert.ok(M.mpxBands({ pilot: false }).find((x) => x.id === 'pilot').db <= -100);
  assert.ok(Math.abs(M.mpxComposite(0.123, { l: 1, r: 1 })) < 1);
});

test('tone-key gate needs RF and the tone; a no-tone interferer stays muted', () => {
  assert.equal(M.TONE_KEY_DEFAULT_KHZ, 32.768);
  assert.notEqual(M.TONE_KEY_DEFAULT_KHZ, M.STEREO_PILOT_KHZ);
  assert.equal(M.gateOpen(M.gateInputs('own', 1)), true);
  assert.equal(M.gateOpen(M.gateInputs('interferer', 1)), false);
  assert.equal(M.noiseSquelchOpen(M.gateInputs('interferer', 1)), true);
  assert.equal(M.gateOpen(M.gateInputs('iem', 1)), false);
  assert.equal(M.gateOpen(M.gateInputs('cycle', 7)), false);
  assert.equal(M.gateOpen(M.gateInputs('cycle', 11)), true);
  // fade: opens at first, then loses the tone
  assert.equal(M.gateOpen(M.gateInputs('fade', 0.5)), true);
  assert.equal(M.gateOpen(M.gateInputs('fade', 3)), false);
  // hysteresis holds the gate through a small dip
  assert.equal(M.gateOpen({ rf: 0.8, tone: 0.45 }, true), true);
  assert.equal(M.gateOpen({ rf: 0.8, tone: 0.45 }, false), false);
});

test('link mapping and channel fit', () => {
  assert.equal(M.labFromLink({ digital: true, snrDb: 17.4 }).snrDb, 17);
  assert.equal(M.labFromLink({ kind: 'iem' }).mode, 'fm');
  assert.equal(M.labFromLink({ snrDb: 99 }).snrDb, 40);
  assert.equal(M.channelFit(180).status, 'pass'); assert.equal(M.channelFit(195).status, 'marginal'); assert.equal(M.channelFit(210).fits, false);
});

test('mid/side: exact round trip, mono cancels pure side content', () => {
  for (const [l, r] of [[0.3, -0.7], [1, 1], [-0.25, 0.9], [0, 0.5]]) { const { m, s } = M.msFromLR(l, r), o = M.lrFromMS(m, s); near(o.l, l, 1e-15); near(o.r, r, 1e-15); }
  assert.equal(M.monoSum(0.6, -0.6), 0);
  assert.equal(M.monoLossDb(0, 0.5), -Infinity);
  near(M.monoLossDb(0.5, 0), 0); near(M.monoLossDb(1, 1), -3.0103, 1e-3);
  const g = M.gonioPoint(1, 1); near(g.x, 0); assert.ok(g.y > 1.4); near(M.gonioPoint(1, -1).y, 0);
});

test('mid/side: side high-pass removes out-of-phase bass and frees deviation', () => {
  assert.ok(M.hpGain(60, 150) < M.hpGain(60, 100) && M.hpGain(60, 100) < 1);
  near(M.hpGain(1000, 150), 1, 1e-3); assert.equal(M.hpGain(60, 0), 1);
  const base = { ...M.MS_DEFAULTS }, hp = { ...base, hp: 150 };
  const a = M.msPeaks(base), b = M.msPeaks(hp);
  assert.ok(b.sPk < a.sPk && b.compPk < a.compPk);
  const bass = (p) => M.msSourceMono(p).find((x) => x.id === 'bass').lossDb;
  assert.ok(bass(hp) > bass(base)); // less lost in mono once the side bass is filtered
});

test('mid/side: composite deviation budget and the default mix headroom', () => {
  const a = M.msPeaks(M.MS_DEFAULTS), b = M.compositeBudget(a);
  assert.ok(b.total > 0.7 && b.total <= 0.8001 && !b.over, `total ${b.total}`);
  const wide = M.msPeaks({ ...M.MS_DEFAULTS, width: 2, boost: 12 });
  assert.ok(M.compositeBudget(wide).over);
  const lim = M.msPeaks({ ...M.MS_DEFAULTS, width: 2, boost: 12, limit: 0.2 });
  assert.ok(lim.sPk < wide.sPk && M.compositeBudget(lim).total < M.compositeBudget(wide).total);
  assert.equal(M.sideCompress(0.3, 1), 0.3); assert.ok(M.sideCompress(0.9, 0.5) < 0.9 && M.sideCompress(0.9, 0.5) > 0.5);
  assert.ok(M.sideShelfGain(6, 0.8) > M.sideShelfGain(6, 0.2) && M.sideShelfGain(0, 1) === 1);
  assert.ok(M.compositeBudget({ compPk: 0.5, leak: 0.2 }).total > M.compositeBudget({ compPk: 0.5 }).total);
});

test('mid/side: stereo noise penalty grows with signal strength via blend, S is about 20 dB noisier', () => {
  let prevS = -Infinity, prevPen = -1;
  for (let c = 5; c <= 45; c += 2) {
    const n = M.msNoise(c);
    assert.ok(n.sSnr >= prevS - 1e-9, `S SNR rises with signal at ${c}`); prevS = n.sSnr;
    assert.ok(n.penaltyDb >= prevPen - 1e-9, `applied penalty non-decreasing at ${c}`); prevPen = n.penaltyDb;
    assert.ok(n.sGapDb >= 20 - 1e-6);
    assert.ok(n.lrSnr <= n.monoSnr + 1e-9);
  }
  assert.equal(M.msNoise(8).blend, 0); assert.equal(M.msNoise(8).penaltyDb, 0);
  assert.equal(M.msNoise(40).blend, 1);
  assert.equal(M.msNoise(40, false).blend, 0);
});
