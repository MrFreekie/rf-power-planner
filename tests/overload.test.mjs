import test from 'node:test';
import assert from 'node:assert/strict';
import { overloadStep, imd3Dbc, imdLevelDbm, compressionDbOf } from '../js/model/overload.js';

const CFG = { maxInputDbm: -10, p1dBDbm: -15, iip3Dbm: -5, sensitivityDbm: -90, agcRangeDb: 65, overloadHysteresisDb: 2, noiseFigureDb: 8, bandwidthHz: 200000, hotMarginDb: 10 };
const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} got ${a}, want ${b} +/- ${tol}`);

test('imd3: 3:1 slope relative level, hand values', () => {
  near(imd3Dbc(-25, CFG), -40, 1e-9); // 2*(-25+5)
  near(imd3Dbc(-15, CFG), -20, 1e-9);
  near(imdLevelDbm(-25, CFG), -65, 1e-9); // 3*-25 - 2*-5
  near(imdLevelDbm(-24, CFG) - imdLevelDbm(-25, CFG), 3, 1e-9);
  near(imd3Dbc(-24, CFG) - imd3Dbc(-25, CFG), 2, 1e-9);
  near(imd3Dbc(-5, CFG), 0, 1e-9);
});

test('compression: 0 until 10 dB below P1dB, 1 dB at P1dB, monotonic', () => {
  assert.equal(compressionDbOf(-40, CFG), 0);
  assert.equal(compressionDbOf(-25, CFG), 0);
  near(compressionDbOf(-20, CFG), 0.25, 1e-9);
  near(compressionDbOf(-15, CFG), 1, 1e-9);
  near(compressionDbOf(-13, CFG), 3, 1e-9);
  let p = -1;
  for (let x = -60; x <= 0; x += 0.5) { const c = compressionDbOf(x, CFG); assert.ok(c >= p); p = c; }
});

test('overloadStep levels, headroom, distortion, AGC', () => {
  const lo = overloadStep(null, -60, CFG);
  assert.equal(lo.level, 'ok');
  near(lo.headroomDb, 45, 1e-9);
  assert.equal(lo.compressionDb, 0);
  near(lo.agcAttenDb, 30, 1e-9); // -60 - sensitivity (-90), AGC runs from sensitivity
  assert.equal(lo.agcExhausted, false);
  assert.equal(overloadStep(null, -95, CFG).agcAttenDb, 0);
  assert.ok(lo.distortionPct < 0.01);
  assert.ok(lo.desenseDb < 0.01);
  const hot = overloadStep('ok', -22, CFG);
  assert.equal(hot.level, 'hot');
  near(hot.agcAttenDb, 65, 1e-9); // -22 + 90 = 68, clamped to the 65 dB range
  assert.equal(hot.agcExhausted, true); // beyond sensitivity + range = -25 dBm
  const over = overloadStep(null, -15, CFG);
  assert.equal(over.level, 'overload');
  near(over.headroomDb, 0, 1e-9);
  near(over.compressionDb, 1, 1e-9);
  near(over.distortionPct, 100 * 0.1 / Math.sqrt(1.01), 1e-9); // -20 dBc: r = 0.1 -> 9.95 % (smooth saturation)
  near(over.agcAttenDb, 65, 1e-9);
  near(overloadStep(null, 20, CFG).agcAttenDb, 65, 1e-9);
  assert.ok(overloadStep(null, 20, CFG).distortionPct > 99.99 && overloadStep(null, 20, CFG).distortionPct <= 100);
  let pd = 0;
  for (let x = -80; x <= 40; x += 2) { const d = overloadStep(null, x, CFG).distortionPct; assert.ok(d >= pd - 1e-12 && d <= 100); pd = d; }
  near(over.desenseDb, 2, 1e-9); // lone carrier at P1dB: twice the 1 dB compression, no IM3 (needs a second carrier)
  // desense = 2 x compression + IM3 noise rise: at -25 dBm compression is 0 and the rise is small
  // strong tone: the IM3 noise rise is huge, but desense is capped (maxDesenseDb 40, never above blocker excess over noise)
  near(overloadStep(null, -20, { ...CFG, otherCarriersDbm: [-20] }).desenseDb, 40, 1e-9);
  // a lone strong carrier makes no IM3 desense (physics review): only twice its compression
  assert.ok(overloadStep(null, -30, { ...CFG, iip3Dbm: -12 }).desenseDb < 0.2);
  assert.ok(overloadStep(null, -8.2, CFG).desenseDb <= 40);
  assert.ok(overloadStep(null, -8.2, CFG).distortionPct <= 100);
  // blocker-over-noise cap: input -100 dBm is 13 dB over the noise floor, desense cannot exceed that
  assert.ok(overloadStep(null, -100, CFG).desenseDb <= 13.0);
  near(overloadStep(null, -20, { ...CFG, maxDesenseDb: 25, otherCarriersDbm: [-20] }).desenseDb, 25, 1e-9);
});

test('overloadStep hysteresis sequence', () => {
  // hot threshold -25 (exit -27), overload -15 (exit -17)
  let s = null; const out = [];
  for (const x of [-30, -25, -26, -28, -15, -16, -17.5, -20, -26, -27.5]) { s = overloadStep(s, x, CFG); out.push(s.level); }
  assert.deepEqual(out, ['ok', 'hot', 'hot', 'ok', 'overload', 'overload', 'hot', 'hot', 'hot', 'ok']);
  assert.equal(overloadStep('overload', -17, CFG).level, 'overload');
  assert.equal(overloadStep('overload', -17.01, CFG).level, 'hot');
  assert.equal(overloadStep(null, -Infinity, CFG).level, 'ok');
});

test('receive chain: cascaded IIP3 (shared implementation) drives distortion and desense', async () => {
  const { cascadeChainIip3Dbm } = await import('../js/model/rf.js');
  const { cascadeIip3Dbm: viaImd } = await import('../js/model/imd.js');
  assert.equal(viaImd, cascadeChainIip3Dbm); // one implementation
  const pre = [{ kind: 'booster', gainDb: 20, iip3Dbm: 0 }];
  near(cascadeChainIip3Dbm(pre, -8, 600), -10 * Math.log10(1 + 100 / Math.pow(10, -0.8)), 1e-9); // -28.01 dBm at the antenna
  // distortion at the receiver input: IIP3 referred to the receiver input = cascade (antenna) + net chain gain (+20) = -8.01 dBm
  const base = { ...CFG, iip3Dbm: -8 };
  const eff = cascadeChainIip3Dbm(pre, -8, 600) + 20;
  const withPre = overloadStep(null, -40, { ...base, chain: pre });
  const r = Math.pow(10, 2 * (-40 - eff) / 20);
  near(withPre.distortionPct, 100 * r / Math.sqrt(1 + r * r), 1e-9);
  // a preamp whose own IIP3 is the weak link lowers the effective intercept below the receiver's own
  const noChain = overloadStep(null, -40, base);
  assert.ok(withPre.distortionPct >= noChain.distortionPct);
  // a 6 dB pad ahead of the receiver: antenna-referred IIP3 rises by 6 dB, receiver-input IIP3 unchanged
  const pad = [{ kind: 'attenuator', lossDb: 6 }];
  near(overloadStep(null, -40, { ...base, chain: pad }).distortionPct, noChain.distortionPct, 1e-9);
  // no chain: unchanged results
  assert.deepEqual(overloadStep(null, -40, { ...base, chain: [] }), noChain);
});
