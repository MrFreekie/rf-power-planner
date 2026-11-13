import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene } from '../js/model/scene.js';
import {
  cascadeIip3Dbm, productFrequencies, couplingLossDb, frontEndImd, txReverseImd, pimImd, noiseFloor, spectrum, coordinationCheck, sweepDistance,
} from '../js/model/imd.js';
import { imProductCount, TX_REVERSE_IM_5TH_EXTRA_DB, PIM_JUNCTIONS, coordinationRules, coupledNoiseDbm } from '../js/model/imd-params.js';

const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} got ${a}, want ${b} +/- ${tol}`);
const OMNI = { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 0 } };

function mk(txs, imdExtra = {}) {
  const scene = createDefaultScene();
  scene.environment = { ...scene.environment, model: 'free-space', fadeMarginDb: 0, bodyLossDb: 0 };
  scene.reflectors = [];
  scene.imd = {
    enabled: true, preset: 'mic-rack-typical', rxAntenna: { ...OMNI }, rxAntennaPos: { x: 0, y: 10, z: 1.5 }, channelBwKHz: 200, iip3Dbm: -8, noiseFigureDb: 8,
    combiner: { type: 'none' }, pim: { preset: 'none' },
    transmitters: txs.map((t, i) => ({ id: t.id || `t${i + 1}`, name: `TX${i + 1}`, freqMHz: t.f, powerDbm: t.p ?? 10, pos: t.pos || { x: 0, y: 0, z: 1.5 }, antenna: { ...OMNI } })),
    ...imdExtra,
  };
  return scene;
}
const fspl = (d, f) => 20 * Math.log10((4 * Math.PI * d * f * 1e6) / 299792458);

test('productFrequencies: exact counts for 2, 3, 4, 5 transmitters', () => {
  const f = [600, 600.4, 600.8, 601.2, 601.6];
  const o3 = [2, 9, 24, 50];
  const o5 = [2, 3, 4, 5].map((n) => imProductCount(n, 5));
  [2, 3, 4, 5].forEach((n, i) => {
    const p3 = productFrequencies(f.slice(0, n), [3]);
    assert.equal(p3.length, o3[i], `order 3, N=${n}`);
    assert.equal(p3.length, n * n * (n - 1) / 2);
    assert.equal(p3.filter((p) => p.terms.length === 2).length, n * (n - 1)); // two-tone 2fi - fj
    assert.equal(p3.filter((p) => p.terms.length === 3).length, n * (n - 1) * (n - 2) / 2); // fi + fj - fk
    const p5 = productFrequencies(f.slice(0, n), [5]);
    assert.equal(p5.length, o5[i], `order 5, N=${n}`);
    assert.equal(productFrequencies(f.slice(0, n), [3, 5]).length, o3[i] + o5[i]);
  });
  assert.equal(o5[0], 2); // 3f1-2f2, 3f2-2f1
  assert.equal(productFrequencies([600], [3, 5]).length, 0);
  assert.equal(productFrequencies([600, 601]).length, 4); // default orders [3, 5]
});

test('productFrequencies: frequencies and labels', () => {
  const p = productFrequencies([600, 600.4], [3, 5]);
  const by = (l) => p.find((x) => x.label === l);
  near(by('2f1-f2').fMHz, 599.6, 1e-9); // 2*600 - 600.4
  near(by('2f2-f1').fMHz, 600.8, 1e-9);
  near(by('3f1-2f2').fMHz, 599.2, 1e-9); // 1800 - 1200.8
  near(by('3f2-2f1').fMHz, 601.2, 1e-9);
  assert.equal(by('2f1-f2').order, 3);
  assert.equal(by('3f1-2f2').order, 5);
  const q = productFrequencies([600, 600.4, 601], [3]);
  const three = q.find((x) => x.label === 'f1+f2-f3');
  near(three.fMHz, 599.4, 1e-9);
  assert.deepEqual(three.terms, [{ tone: 0, coef: 1 }, { tone: 1, coef: 1 }, { tone: 2, coef: -1 }]);
  // every product satisfies sum a = 1
  for (const x of productFrequencies([600, 600.4, 601, 602], [3, 5])) assert.equal(x.terms.reduce((s, t) => s + t.coef, 0), 1);
  // equal spacing: 2(f+d) - f lands on f + 2d (collision of the classic kind)
  near(productFrequencies([600, 600.4, 600.8], [3]).find((x) => x.label === '2f2-f1').fMHz, 600.8, 1e-9);
});

test('couplingLossDb: Friis, 6 dB per halving, near-field floor, antenna gains', () => {
  const a = { pos: { x: 0, y: 0, z: 1.5 }, antenna: OMNI };
  const at = (d) => ({ pos: { x: d, y: 0, z: 1.5 }, antenna: OMNI });
  near(couplingLossDb(a, at(4), 600), fspl(4, 600), 1e-9);
  near(couplingLossDb(a, at(4), 600) - couplingLossDb(a, at(2), 600), 6.0206, 1e-3);
  near(couplingLossDb(a, at(2), 600) - couplingLossDb(a, at(1), 600), 6.0206, 1e-3);
  // floor: below lambda/2 the loss stops falling
  const lam = 299792458 / 600e6;
  near(couplingLossDb(a, at(0.01), 600), couplingLossDb(a, at(0.2), 600), 1e-9);
  near(couplingLossDb(a, at(0.01), 600), 20 * Math.log10(4 * Math.PI * 0.5), 1e-9); // 15.96 dB
  assert.ok(lam > 0.49 && lam < 0.51);
  // gains subtract
  const g = { pos: { x: 4, y: 0, z: 1.5 }, antenna: { ...OMNI, gainDbi: 3 } };
  near(couplingLossDb(a, g, 600), fspl(4, 600) - 3, 1e-9);
  near(couplingLossDb(a, g, 600), couplingLossDb(g, a, 600), 1e-9);
});

test('frontEndImd: 2f1-f2 level = 3L - 2 IIP3 with the 3:1 slope; three-tone +6 dB', () => {
  const L = 10 - fspl(10, 600.4); // tx at 10 dBm, 10 m, omni
  const sc = mk([{ f: 600 }, { f: 600.4 }]);
  const fe = frontEndImd(sc);
  assert.equal(fe.filter((p) => p.order === 3).length, 2);
  const p = fe.find((x) => x.label === '2f1-f2');
  near(p.fMHz, 599.6, 1e-9);
  near(p.levelDbm, 3 * L - 2 * -8, 0.05); // about -98.0 dBm
  near(p.levelDbm, -98.04, 0.1);
  // 3:1 slope: +1 dB on both carriers -> +3 dB; 5th order: +5 dB
  const sc2 = mk([{ f: 600, p: 11 }, { f: 600.4, p: 11 }]);
  const fe2 = frontEndImd(sc2);
  near(fe2.find((x) => x.label === '2f1-f2').levelDbm - p.levelDbm, 3, 1e-6);
  near(fe2.find((x) => x.label === '3f1-2f2').levelDbm - fe.find((x) => x.label === '3f1-2f2').levelDbm, 5, 1e-6);
  // IIP3 higher by 10 dB: product 20 dB lower
  const sc3 = mk([{ f: 600 }, { f: 600.4 }], { iip3Dbm: 2 });
  near(frontEndImd(sc3).find((x) => x.label === '2f1-f2').levelDbm - p.levelDbm, -20, 1e-6);
  // three equal tones: three-tone product is 6.02 dB above the two-tone one
  const s3 = mk([{ f: 600 }, { f: 600.4 }, { f: 601 }]);
  const f3 = frontEndImd(s3, undefined, [3]);
  const two = f3.find((x) => x.label === '2f1-f2'), three = f3.find((x) => x.label === 'f1+f2-f3');
  near(three.levelDbm - two.levelDbm, 20 * Math.log10(2) + (601 - 600.4 > 0 ? 0 : 0), 0.05);
  assert.deepEqual(frontEndImd(mk([{ f: 600 }])), []);
});

test('txReverseImd: linear in coupled power, 6 dB per halving, combiner isolation', () => {
  const a = { f: 600, pos: { x: 0, y: 0, z: 1.5 } };
  const at = (d) => mk([a, { f: 600.4, pos: { x: d, y: 0, z: 1.5 } }]);
  const lv = (sc) => txReverseImd(sc).find((x) => x.label === '2f1-f2' && x.order === 3);
  const p2 = lv(at(2)), p1 = lv(at(1));
  near(p1.levelDbm - p2.levelDbm, 6.0206, 0.02); // path to rx differs by < 0.1 dB at 10 m; tx b moves, a's product does not
  // hand value at the PA output: P_b - coupling - conversion (class-ab 20 dB for the mic-rack preset? preset has none: class-ab default)
  near(p2.atPaOutDbm, 10 - fspl(2, 600.4) - 20, 0.01);
  // product reaches the receiver like the carrier of a: atPaOut + path gain (-fspl(10 m))
  near(p2.levelDbm, p2.atPaOutDbm - fspl(10, 600), 0.01);
  // 5th order sits 15 dB lower at the PA output
  const p5 = txReverseImd(at(2)).find((x) => x.order === 5 && x.label === '3f1-2f2');
  near(p5.atPaOutDbm - p2.atPaOutDbm, -TX_REVERSE_IM_5TH_EXTRA_DB, 1e-9);
  // isolated combiner knocks the interferer down: loss 2 + isolation 50 instead of free-space coupling
  const iso = mk([a, { f: 600.4, pos: { x: 2, y: 0, z: 1.5 } }], { combiner: { type: 'isolated' } });
  const pi = lv(iso);
  near(pi.atPaOutDbm, 10 - 50 - 20, 1e-9); // isolation only; insertion loss is on the through path
  const hyb = mk([a, { f: 600.4, pos: { x: 2, y: 0, z: 1.5 } }], { combiner: { type: 'hybrid', isolationDb: 20, lossDb: 3 } });
  near(lv(hyb).atPaOutDbm, 10 - 20 - 20, 1e-9);
  assert.ok(pi.levelDbm < lv(hyb).levelDbm);
  assert.deepEqual(txReverseImd(mk([a])), []);
});

test('pimImd: 3:1 scaling and junction figures', () => {
  assert.deepEqual(pimImd(mk([{ f: 600 }, { f: 600.4 }])), []); // preset none
  const sc = (p, pre) => mk([{ f: 600, p }, { f: 600.4, p, pos: { x: 3, y: 0, z: 1.5 } }], { pim: pre || { preset: 'corroded' }, combiner: { type: 'hybrid', isolationDb: 25, lossDb: 3 } });
  const ref = pimImd(sc(43 + 3)).find((x) => x.label === '2f1-f2'); // shared combiner loss 3 dB -> 43 dBm per carrier at the junction
  near(ref.atJunctionDbm, 43 + PIM_JUNCTIONS['corroded-connector'].dbcAtRef, 1e-9); // -47 dBm
  // +1 dB on both carriers: +3 dB product
  const up = pimImd(sc(47)).find((x) => x.label === '2f1-f2');
  near(up.atJunctionDbm - ref.atJunctionDbm, 3, 1e-9);
  // +1 dB on one carrier only: pumped carrier counts twice (2:1), the other once
  const asym = mk([{ f: 600, p: 47 }, { f: 600.4, p: 46 }], { pim: { levelDbc: -100 }, combiner: { type: 'hybrid', lossDb: 3 } });
  const pa = pimImd(asym).find((x) => x.label === '2f1-f2');
  near(pa.atJunctionDbm, (43 - 100) + 2 * (44 - 43) + (43 - 43), 1e-9);
  const pb = pimImd(asym).find((x) => x.label === '2f2-f1');
  near(pb.atJunctionDbm, (43 - 100) + 2 * (43 - 43) + (44 - 43), 1e-9);
  // good connector is far cleaner than a corroded one
  const good = pimImd(sc(46, { preset: 'good' })).find((x) => x.label === '2f1-f2');
  near(ref.atJunctionDbm - good.atJunctionDbm, PIM_JUNCTIONS['corroded-connector'].dbcAtRef - PIM_JUNCTIONS['good-connector'].dbcAtRef, 1e-9);
});

test('noiseFloor: thermal, IM power sum inside the channel only, TX skirt, rise', () => {
  // two transmitters whose 2f1-f2 (599.6 MHz) lands on a third transmitter's channel
  const sc = mk([{ f: 600 }, { f: 600.4 }, { f: 599.6 }]);
  const nz = noiseFloor(sc);
  near(nz.thermalDbm, -174 + 10 * Math.log10(200000) + 8, 1e-9); // -112.99 dBm
  near(nz.thermalDbm, -112.99, 0.01);
  const t3 = nz.perChannel.find((c) => c.channelId === 't3');
  assert.ok(t3.imSumDbm > -150); // the 2f1-f2 product lands in the third channel
  assert.equal(nz.riseDb, Math.max(...nz.perChannel.map((c) => c.riseDb)));
  assert.ok(nz.perChannel.some((c) => c.channelId === nz.worstChannel));
  const L = 10 - fspl(10, 600.4);
  // products landing on 599.6: 2f1-f2 (two-tone) at 3L - 2 IIP3, and f1 + f2 - f3?  600+600.4-599.6=600.8 no; others are off-channel
  const inCh = frontEndImd(sc).concat(txReverseImd(sc), pimImd(sc)).filter((p) => Math.abs(p.fMHz - 599.6) * 1000 <= 100);
  assert.ok(inCh.length >= 1);
  const imP = inCh.reduce((s, p) => s + Math.pow(10, p.levelDbm / 10), 0);
  near(nz.imSumDbm, 10 * Math.log10(imP), 1e-3); // boundary products may differ by float rounding
  assert.ok(nz.imSumDbm >= 3 * L + 16 - 0.2); // at least the front-end product
  // total is the power sum, rise above thermal
  const tot = Math.pow(10, nz.thermalDbm / 10) + Math.pow(10, nz.imSumDbm / 10) + Math.pow(10, nz.txNoiseSkirtDbm / 10);
  near(nz.totalDbm, 10 * Math.log10(tot), 1e-9);
  near(nz.riseDb, nz.totalDbm - nz.thermalDbm, 1e-9);
  near(nz.desenseDb, nz.riseDb, 1e-9);
  assert.ok(nz.riseDb > 10);
  // two channels only: no product on either channel, so the only addition is the skirt of the other transmitter
  const quiet = noiseFloor(mk([{ f: 600 }, { f: 603 }]));
  near(quiet.imSumDbm, -200, 1e-9);
  assert.ok(quiet.txNoiseSkirtDbm < quiet.thermalDbm - 5); // 3 MHz away the skirt is below thermal (about -119 dBm)
  assert.ok(quiet.riseDb > 0 && quiet.riseDb < 1.5);
  // a single transmitter: nothing interferes
  const one = noiseFloor(mk([{ f: 600 }]));
  near(one.riseDb, 0, 1e-9);
  assert.equal(noiseFloor(mk([])).perChannel.length, 0);
  // in-channel power sum: a product 150 kHz away (outside +-100 kHz) does not count
  const off = noiseFloor(mk([{ f: 600 }, { f: 600.4 }, { f: 599.45 }]));
  near(off.perChannel[2].imSumDbm, -200, 1e-9);
});

test('coordinationCheck: collision detection and severity', () => {
  const clash = coordinationCheck(mk([{ f: 600 }, { f: 600.4 }, { f: 599.6 }]));
  assert.ok(clash.length >= 1);
  const c = clash.find((x) => x.channelId === 't3' && x.product.label === '2f1-f2');
  assert.ok(c);
  near(c.offsetKHz, 0, 1e-6);
  near(c.ciDb, c.wantedDbm - c.levelDbm, 1e-9);
  assert.ok(['critical', 'warning', 'info'].includes(c.severity));
  // C/I: wanted -38 dBm, product -98 dBm -> 60 dB: info
  assert.equal(c.severity, 'info');
  // hot product: raise the powers so that the product is only 6 dB below the wanted channel
  const hot = coordinationCheck(mk([{ f: 600, p: 10 }, { f: 600.4, p: 10 }, { f: 599.6, p: -40 }], { iip3Dbm: -60 }));
  const h = hot.find((x) => x.channelId === 't3' && x.product.label === '2f1-f2');
  assert.equal(h.severity, 'critical');
  assert.ok(h.ciDb < coordinationRules.requiredCiDb / 3);
  // sorted worst first
  for (let i = 1; i < hot.length; i++) assert.ok(hot[i - 1].ciDb <= hot[i].ciDb);
  // channels far apart: no collisions
  assert.deepEqual(coordinationCheck(mk([{ f: 600 }, { f: 605 }])), []);
  // own-tone hits are listed and flagged, not skipped
  assert.ok(coordinationCheck(mk([{ f: 600 }, { f: 600 }])).some((x) => x.ownTone));
});

test('spectrum: carriers at their levels, products at 3L - 2 IIP3, markers and collisions, determinism', () => {
  const sc = mk([{ f: 600 }, { f: 600.4 }, { f: 599.6 }]);
  const s = spectrum(sc, { centerMHz: 600, spanMHz: 2, points: 2001, rbwKHz: 10 });
  assert.equal(s.freqMHz.length, 2001);
  near(s.freqMHz[0], 599, 1e-12);
  near(s.freqMHz[2000], 601, 1e-12);
  const idx = (f) => s.freqMHz.reduce((bi, x, i) => (Math.abs(x - f) < Math.abs(s.freqMHz[bi] - f) ? i : bi), 0);
  const L = 10 - fspl(10, 600);
  near(s.carriersDbm[idx(600)], L, 0.02);
  assert.ok(s.carriersDbm[idx(600.2)] < L - 60); // far from any tone
  // the product 2f1-f2 sits on tx 3's channel: carrier trace there, im3 trace separately
  const fe = frontEndImd(sc).find((p) => p.label === '2f1-f2' && p.order === 3);
  near(s.im3FrontEndDbm[idx(fe.fMHz)], 10 * Math.log10(frontEndImd(sc).filter((p) => p.order === 3 && Math.abs(p.fMHz - fe.fMHz) < 1e-6).reduce((a, p) => a + Math.pow(10, p.levelDbm / 10), 0)), 0.01);
  assert.equal(s.noiseDbm.length, 2001);
  const markers = s.markers.filter((m) => m.kind === 'im3' && m.label === '2f1-f2');
  assert.equal(markers.length, 1);
  assert.equal(markers[0].collidesWith, 't3');
  assert.equal(s.markers.filter((m) => m.kind === 'carrier').length, 3);
  assert.ok(s.markers.filter((m) => m.kind === 'carrier').every((m) => m.collidesWith === null));
  for (let i = 1; i < s.markers.length; i++) assert.ok(s.markers[i].fMHz >= s.markers[i - 1].fMHz);
  // -3 dB at +-rbw/2
  near(s.carriersDbm[idx(600)] - s.carriersDbm[idx(600.005)], 3, 0.3);
  // noise = thermal in the RBW + coupled TX skirts (200 kHz from the two tones, 600 kHz from the third)
  const th = Math.pow(10, (-174 + 40 + 8) / 10);
  const sk = [[600, 0.2], [600.4, 0.2], [599.6, 0.6]].reduce((acc, [f, off]) => acc + Math.pow(10, coupledNoiseDbm(10 - fspl(10, f), off * 1000, 10000) / 10), 0);
  near(s.noiseDbm[idx(600.2)], 10 * Math.log10(th + sk), 0.05);
  // deterministic
  assert.deepEqual(spectrum(sc, { centerMHz: 600, spanMHz: 2, points: 2001, rbwKHz: 10 }), s);
  // other traces appear when their mechanism is on
  const withPim = spectrum(mk([{ f: 600, p: 40 }, { f: 600.4, p: 40, pos: { x: 3, y: 0, z: 1.5 } }], { pim: { preset: 'corroded' } }), { centerMHz: 600, spanMHz: 2, points: 401 });
  assert.ok(Math.max(...withPim.pimDbm) > -190);
  assert.ok(Math.max(...withPim.txReverseDbm) > -190);
  assert.ok(withPim.markers.some((m) => m.kind === 'pim') && withPim.markers.some((m) => m.kind === 'tx-reverse'));
  assert.equal(Math.max(...s.pimDbm), -200);
});

test('sweepDistance: front-end IM3 +18 dB per halving (rx), reverse IM +6 dB per halving (tx-tx)', () => {
  // both transmitters at the same point: moving the rx changes both carriers equally
  const sc = mk([{ f: 600 }, { f: 600.4 }], { rxAntennaPos: { x: 0, y: 8, z: 1.5 } });
  const sw = sweepDistance(sc, { txId: 't1', from: 8, to: 4, n: 2, what: 'rxAntenna' });
  assert.equal(sw.distanceM.length, 2);
  near(sw.worstFrontEndDbm[1] - sw.worstFrontEndDbm[0], 18.06, 0.05);
  // noise rise grows as the receiver gets closer
  assert.ok(sw.riseDb[1] >= sw.riseDb[0]);
  near(sw.thermalDbm, -112.99, 0.01);
  // reverse IM: rx far away so the path term is constant; move tx t2 from 2 m to 1 m from t1
  const far = mk([{ f: 600, pos: { x: 0, y: 0, z: 1.5 } }, { f: 600.4, pos: { x: 2, y: 0, z: 1.5 } }], { rxAntennaPos: { x: 0, y: 500, z: 1.5 } });
  const sr = sweepDistance(far, { txId: 't2', from: 2, to: 1, n: 2, what: 'otherTx' });
  near(sr.worstReverseDbm[1] - sr.worstReverseDbm[0], 6.02, 0.1);
  // front-end part hardly changes with tx-tx distance when the rx is far
  near(sr.worstFrontEndDbm[1] - sr.worstFrontEndDbm[0], 0, 0.1);
  assert.equal(sr.worstPimDbm[0], -200);
  assert.equal(sweepDistance(sc, { txId: 'nope', from: 1, to: 2 }).distanceM.length, 0);
  // input scene is not mutated
  assert.equal(far.imd.transmitters[1].pos.x, 2);
  // deterministic
  assert.deepEqual(sweepDistance(far, { txId: 't2', from: 2, to: 1, n: 4, what: 'otherTx' }), sweepDistance(far, { txId: 't2', from: 2, to: 1, n: 4, what: 'otherTx' }));
});

test('scene without imd or with missing fields is tolerated', () => {
  const sc = createDefaultScene();
  delete sc.imd; // the default scene may carry an imd block; this test is about a scene without one
  assert.deepEqual(frontEndImd(sc), []);
  assert.deepEqual(txReverseImd(sc), []);
  assert.deepEqual(pimImd(sc), []);
  assert.deepEqual(coordinationCheck(sc), []);
  assert.equal(noiseFloor(sc).riseDb, 0);
  const s = spectrum(sc);
  assert.equal(s.freqMHz.length, 512);
  const bare = createDefaultScene();
  bare.imd = { transmitters: [{ id: 'a', freqMHz: 600, powerDbm: 10, pos: { x: 0, y: 0, z: 1 } }, { id: 'b', freqMHz: 600.4, powerDbm: 10, pos: { x: 1, y: 0, z: 1 } }] };
  assert.ok(frontEndImd(bare).length > 0);
  assert.ok(Number.isFinite(noiseFloor(bare).riseDb));
});

test('coordinationCheck lists f1+f3-f2 landing on channel 2 (evenly spaced channels), flagged ownTone', () => {
  const sc = mk([{ f: 600 }, { f: 600.4 }, { f: 600.8 }]);
  const hits = coordinationCheck(sc);
  const own = hits.find((h) => h.product.label === 'f1+f3-f2' && h.channelId === 't2' && h.product.source === 'front-end');
  assert.ok(own, 'f1+f3-f2 must be reported on channel 2');
  assert.equal(own.ownTone, true);
  near(own.offsetKHz, 0, 1e-6);
  assert.ok(Number.isFinite(own.ciDb));
  // the classic 2f2-f1 on channel 3 and 2f2-f3 on channel 1 are reported as ordinary hits
  const c3 = hits.find((h) => h.product.label === '2f2-f1' && h.channelId === 't3');
  assert.ok(c3 && c3.ownTone === false);
  assert.ok(hits.find((h) => h.product.label === '2f2-f3' && h.channelId === 't1'));
  // level of the three-tone product: 6 dB above the two-tone products at equal levels
  const two = hits.find((h) => h.product.label === '2f2-f1' && h.channelId === 't3' && h.product.source === 'front-end');
  near(own.levelDbm - two.levelDbm, 6.02, 0.1);
  // spectrum marker carries the same information
  const s = spectrum(sc, { centerMHz: 600.4, spanMHz: 2, points: 401 });
  const m = s.markers.find((x) => x.kind === 'im3' && x.label === 'f1+f3-f2');
  assert.equal(m.collidesWith, 't2');
  assert.equal(m.ownTone, true);
  // Front-end products alone: the middle channel collects the own-tone three-tone product (+6 dB), so it is the worst one.
  const fe = frontEndImd(sc);
  const inCh = (f) => fe.filter((p) => Math.abs(p.fMHz - f) * 1000 <= 100).reduce((acc, p) => acc + Math.pow(10, p.levelDbm / 10), 0);
  assert.ok(inCh(600.4) > inCh(600) && inCh(600.4) > inCh(600.8));
  // With co-located transmitters the reverse IM (coupling at the near-field floor) dominates the outer channels, so the
  // overall worst channel by rise is t1 or t3 (a tie): it depends on which mechanism is strongest.
  const nz = noiseFloor(sc);
  assert.ok(['t1', 't3'].includes(nz.worstChannel)); // t1 and t3 are equal up to float rounding
  const t2 = nz.perChannel.find((c) => c.channelId === 't2');
  assert.ok(t2.imSumDbm > -100); // the own-tone product is counted in the noise sum as well
});

test('cascadeIip3Dbm: 1/IIP3 = sum G_before / IIP3_k; preamp lowers, pad raises; used by frontEndImd', () => {
  assert.equal(cascadeIip3Dbm([], -8, 600), -8);
  // booster 20 dB gain, IIP3 0 dBm, receiver -8 dBm: 1/1 mW + 100/0.1585 mW
  const pre = [{ kind: 'booster', gainDb: 20, iip3Dbm: 0 }];
  const expect = -10 * Math.log10(1 + 100 / Math.pow(10, -0.8));
  near(cascadeIip3Dbm(pre, -8, 600), expect, 1e-9);
  near(cascadeIip3Dbm(pre, -8, 600), -28.01, 0.01);
  // default booster: OIP3 20 dBm -> IIP3 = 20 - gain
  near(cascadeIip3Dbm([{ kind: 'booster', gainDb: 20 }], -8, 600), -10 * Math.log10(1 / Math.pow(10, 0) + 100 / Math.pow(10, -0.8)), 1e-9);
  // a 6 dB pad ahead of the receiver raises the antenna-referred IIP3 by 6 dB
  near(cascadeIip3Dbm([{ kind: 'attenuator', lossDb: 6 }], -8, 600), -2, 1e-9);
  // pad then booster: booster sees 6 dB less signal
  const mix = cascadeIip3Dbm([{ kind: 'attenuator', lossDb: 6 }, { kind: 'booster', gainDb: 20, iip3Dbm: 0 }], -8, 600);
  assert.ok(mix > cascadeIip3Dbm(pre, -8, 600));
  // frontEndImd: product at the receiver input = 3 L_ant - 2 IIP3_total + net chain gain
  const base = mk([{ f: 600 }, { f: 600.4 }]);
  const Lant = 10 - fspl(10, 600.4); // omni antennas, no body loss: antenna terminal level
  const withPre = mk([{ f: 600 }, { f: 600.4 }], { rxChain: pre });
  const p = frontEndImd(withPre).find((x) => x.label === '2f1-f2');
  near(p.levelDbm, 3 * Lant - 2 * cascadeIip3Dbm(pre, -8, 600) + 20, 0.1);
  const p0 = frontEndImd(base).find((x) => x.label === '2f1-f2');
  assert.ok(p.levelDbm - p0.levelDbm > 55, 'a high-gain preamp makes the product far stronger at the receiver input');
  // pad: product at the receiver input 6 dB pad: 3(L-6) - 2(-8) = 3L+16-18, i.e. 12 dB lower than without
  const padded = mk([{ f: 600 }, { f: 600.4 }], { rxChain: [{ kind: 'attenuator', lossDb: 6 }] });
  near(frontEndImd(padded).find((x) => x.label === '2f1-f2').levelDbm - p0.levelDbm, -18, 0.05);
});
