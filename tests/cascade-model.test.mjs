import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene, createDefaultLink } from '../js/model/scene.js';
import { solveLink, cascadeNoise, chainItemNoise, wallTransmissionInfo, wallTransmissionLossDb, pathWallLoss } from '../js/model/rf.js';
import { MATERIAL_TRANSMISSION } from '../js/model/zones-params.js';

const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} got ${a}, want ${b} +/- ${tol}`);
const OMNI = { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 0 } };

function micScene(chain, rxExtra = {}) {
  const scene = createDefaultScene(); scene.environment.externalNoise = undefined; // these tests check the model with no external noise (the new-scene default is urban)
  scene.environment = { ...scene.environment, model: 'free-space', fadeMarginDb: 0, bodyLossDb: 0 };
  scene.reflectors = [];
  const link = createDefaultLink('mic');
  link.freqMHz = 600;
  link.tx = { ...link.tx, powerDbm: 10, pos: { x: 0, y: 0, z: 1.5 }, antenna: { ...OMNI } };
  link.rx = { ...link.rx, pos: { x: 0, y: 10, z: 1.5 }, antenna: { ...OMNI }, bodyLossDb: 0, sensitivityDbm: -95, noiseFigureDb: 8, channelBwKHz: 200, ...rxExtra };
  link.chain = chain;
  scene.links = [link];
  return { scene, link };
}
const cableDb = (db) => ({ kind: 'cable', cableType: 'rg58', lengthM: 100, freqLossOverrideDbPer100m: db });
const lin = (db) => Math.pow(10, db / 10);

test('chain item noise: passive NF = loss, booster default 3 dB, splitter NF = loss', () => {
  near(chainItemNoise(cableDb(6), 600).nfDb, 6, 1e-9);
  near(chainItemNoise(cableDb(6), 600).gainDb, -6, 1e-9);
  assert.deepEqual(chainItemNoise({ kind: 'booster', gainDb: 20, nfDb: 2 }, 600), { gainDb: 20, nfDb: 2 });
  assert.deepEqual(chainItemNoise({ kind: 'booster', gainDb: 20 }, 600), { gainDb: 20, nfDb: 3 });
  near(chainItemNoise({ kind: 'splitter', ports: 2, insertionLossDb: 0.5 }, 600).nfDb, 3.0103 + 0.5, 1e-3);
  near(chainItemNoise({ kind: 'attenuator', lossDb: 10 }, 600).nfDb, 10, 1e-9);
});

test('passive chain: marginDb equals the old margin (input - sensitivity), cascade reports loss + receiver NF', () => {
  const { scene, link } = micScene([cableDb(6), { kind: 'filter', lossDb: 2 }]);
  const r = solveLink(scene, link);
  near(r.marginDb, r.inputPowerDbm - link.rx.sensitivityDbm, 1e-9);
  near(r.cascade.marginAtAntennaDb, r.marginDb, 1e-12);
  near(r.cascade.systemNfDb, 8 + 8, 1e-9); // passive losses add: 6 + 2 + receiver 8
  const kTB = -174 + 10 * Math.log10(200000);
  near(r.cascade.noiseFloorDbm, kTB + 16, 1e-9);
  near(r.requiredSnrDb, -95 - (kTB + 8), 1e-9);
  near(r.cascade.sensitivityAtAntennaDbm, -95 + 8, 1e-9); // sensitivity + chain loss
  assert.equal(r.cascade.stages.length, 3);
  near(r.cascade.stages[2].cumulativeNfDb, 16, 1e-9);
  near(r.cascade.stages[2].cumulativeGainDb, -8, 1e-9);
  const noteStep = r.waterfall.find((w) => w.note);
  assert.ok(noteStep && /System NF 16\.0 dB/.test(noteStep.label) && noteStep.deltaDb === 0);
  // empty chain: system NF = receiver NF, margin unchanged
  const e = micScene([]);
  const re = solveLink(e.scene, e.link);
  near(re.cascade.systemNfDb, 8, 1e-9);
  near(re.marginDb, re.inputPowerDbm + 95, 1e-9);
  // requiredSnrDb override
  const o = micScene([], { requiredSnrDb: 12 });
  near(solveLink(o.scene, o.link).requiredSnrDb, 12, 1e-12);
});

test('booster at the antenna before 40 dB of cable beats the same booster after the cable (Friis)', () => {
  const booster = { kind: 'booster', gainDb: 20, nfDb: 3 };
  const front = micScene([booster, cableDb(40)]);
  const back = micScene([cableDb(40), booster]);
  const rf = solveLink(front.scene, front.link), rb = solveLink(back.scene, back.link);
  // Friis by hand (linear)
  const F1 = lin(3), G1 = lin(20), F2 = lin(40), G2 = lin(-40), F3 = lin(8);
  const frontF = F1 + (F2 - 1) / G1 + (F3 - 1) / (G1 * G2);
  const backF = F2 + (F1 - 1) / lin(-40) + (F3 - 1) / (lin(-40) * G1);
  near(rf.cascade.systemNfDb, 10 * Math.log10(frontF), 1e-9);
  near(rb.cascade.systemNfDb, 10 * Math.log10(backF), 1e-9);
  near(rf.cascade.systemNfDb, 28.0, 0.05);
  near(rb.cascade.systemNfDb, 43.1, 0.05);
  // same antenna terminal level, net gain identical, but the margin differs by the NF difference
  near(rf.rxPowerDbm, rb.rxPowerDbm, 1e-12);
  near(rf.inputPowerDbm, rb.inputPowerDbm, 1e-9);
  near(rf.marginDb - rb.marginDb, rb.cascade.systemNfDb - rf.cascade.systemNfDb, 1e-9);
  assert.ok(rf.marginDb - rb.marginDb > 15);
  assert.ok(rf.marginDb > rb.marginDb);
  // cumulative stage numbers: after booster + cable the running NF is F1 + (F2-1)/G1
  near(rf.cascade.stages[1].cumulativeNfDb, 10 * Math.log10(F1 + (F2 - 1) / G1), 1e-9);
  near(rf.cascade.stages[1].cumulativeGainDb, -20, 1e-9);
  // the booster does not cure a lossy cable by its gain alone: compare with the old (gain-only) margin, which overstated it
  assert.ok(rb.marginDb < rb.inputPowerDbm - back.link.rx.sensitivityDbm);
});

test('iem link: the bodypack is the receiver; cascade, noise floor and SNR margin work like a mic link', () => {
  const scene = createDefaultScene(); scene.environment.externalNoise = undefined;
  scene.environment = { ...scene.environment, model: 'free-space' };
  scene.reflectors = [];
  const link = createDefaultLink('iem');
  link.chain = [cableDb(6), { kind: 'booster', gainDb: 10 }];
  delete link.branches;
  scene.links = [link];
  const r = solveLink(scene, link);
  // Tx-side noise at the bodypack is ~60 dB below the bodypack floor here: margin = input - sensitivity to ~1e-5 dB (tolerance 1e-4)
  near(r.marginDb, r.inputPowerDbm - link.rx.sensitivityDbm, 1e-4);
  near(r.cascade.marginAtAntennaDb, r.marginDb, 1e-12);
  assert.equal(r.cascade.side, 'rx');
  assert.equal(r.cascade.stages.length, 1); // bodypack only (no rx.chain)
  assert.equal(r.cascade.stages[0].label, 'Receiver');
  near(r.cascade.systemNfDb, r.cascade.receiverNfDb, 1e-12);
  assert.ok(r.waterfall.some((w) => w.note && /System NF/.test(w.label)));
  // Tx-side chain by hand (Friis): cable 6 dB then booster 10 dB NF 3 dB
  near(r.cascade.txSide.systemNfDb, 10 * Math.log10(lin(6) + (lin(3) - 1) / lin(-6)), 1e-9);
  near(r.cascade.txSide.chainGainDb, 4, 1e-9);
  const c = cascadeNoise(link, link.chain, 600, true); // legacy Tx-side-only call is unchanged
  near(c.systemNfDb, 10 * Math.log10(lin(6) + (lin(3) - 1) / lin(-6)), 1e-9);
});

test('iem link: receiver NF, rx.chain LNA and external noise move the margin; Tx booster noise appears only when close and noisy', () => {
  const mk = (extra = {}, chain = []) => {
    const scene = createDefaultScene(); scene.environment.externalNoise = undefined;
    scene.environment = { ...scene.environment, model: 'free-space', fadeMarginDb: 0, bodyLossDb: 0 };
    scene.reflectors = [];
    const link = createDefaultLink('iem'); delete link.branches;
    link.freqMHz = 600;
    link.tx = { ...link.tx, powerDbm: 10, pos: { x: 0, y: 0, z: 1.5 }, antenna: { ...OMNI } };
    link.rx = { ...link.rx, pos: { x: 0, y: 10, z: 1.5 }, antenna: { ...OMNI }, bodyLossDb: 0, sensitivityDbm: -85, ...extra };
    link.chain = chain;
    scene.links = [link];
    return { scene, link };
  };
  const base = mk(); const rb = solveLink(base.scene, base.link);
  // raising the bodypack NF by 4 dB lowers the margin by 4 dB (preset path: requiredSnr fixed, floor +4 dB)
  const nf = mk({ noiseFigureDb: base.link.rx.noiseFigureDb ?? 10 }); // same value: unchanged
  near(solveLink(nf.scene, nf.link).marginDb, rb.marginDb, 1e-4);
  const hi = mk({ noiseFigureDb: 14 }); const rh = solveLink(hi.scene, hi.link);
  near(rb.marginDb - rh.marginDb, 4, 1e-3);
  // external noise (noisy-venue = 12 dB at 600 MHz): floor = kTB + 10log(F_sys + F_ext - 1), like a mic receiver (tolerance 1e-4)
  const ext = mk(); ext.scene.environment.externalNoise = 'noisy-venue';
  const re = solveLink(ext.scene, ext.link);
  const kTB = -174 + 10 * Math.log10(200000);
  near(re.cascade.rxFloorDbm, kTB + 10 * Math.log10(lin(10) + lin(12) - 1), 1e-9);
  near(rb.marginDb - re.marginDb, re.cascade.rxFloorDbm - rb.cascade.rxFloorDbm, 1e-3);
  // optional rx.chain: 3 dB cable then bodypack adds 3 dB NF and 3 dB loss; a 2 dB NF / 15 dB LNA ahead of it recovers the margin
  const cab = mk({ chain: [cableDb(3)] }); const rc = solveLink(cab.scene, cab.link);
  near(rc.cascade.systemNfDb, rb.cascade.systemNfDb + 3, 1e-9);
  near(rb.marginDb - rc.marginDb, 3, 1e-3);
  assert.equal(rc.cascade.stages.length, 2);
  near(rb.inputPowerDbm - rc.inputPowerDbm, 3, 1e-9);
  const lna = mk({ chain: [{ kind: 'booster', gainDb: 15, nfDb: 2 }, cableDb(3)] }); const rl = solveLink(lna.scene, lna.link);
  const F = lin(2) + (lin(3) - 1) / lin(15) + (lin(10) - 1) / (lin(15) * lin(-3));
  near(rl.cascade.systemNfDb, 10 * Math.log10(F), 1e-9);
  assert.ok(rl.marginDb > rc.marginDb + 9);
  // Tx-side booster: 40 dB gain, NF 30 dB, bodypack 0.3 m away -> its radiated noise exceeds the bodypack floor and costs margin
  const near_ = mk({}, [{ kind: 'booster', gainDb: 40, nfDb: 30 }]); near_.link.rx.pos = { x: 0, y: 0.3, z: 1.5 };
  const rn = solveLink(near_.scene, near_.link);
  const pathGain = rn.rxPowerDbm - (10 + 40);
  const noiseAtRx = kTB + 30 + 40 + pathGain;
  near(rn.cascade.txSide.noiseAtRxDbm, noiseAtRx, 1e-9);
  near(rn.cascade.noiseFloorDbm, 10 * Math.log10(Math.pow(10, rn.cascade.rxFloorDbm / 10) + Math.pow(10, noiseAtRx / 10)), 1e-9);
  assert.ok(rn.cascade.noiseFloorDbm - rn.cascade.rxFloorDbm > 10);
  // same booster 10 m away: FSPL(10 m) - FSPL(0.3 m) = 20log10(10/0.3) = 30.5 dB lower noise at the bodypack, so the floor rise is far smaller
  const far_ = mk({}, [{ kind: 'booster', gainDb: 40, nfDb: 30 }]); const rf2 = solveLink(far_.scene, far_.link);
  const riseFar = rf2.cascade.noiseFloorDbm - rf2.cascade.rxFloorDbm;
  near(rf2.cascade.txSide.noiseAtRxDbm, rn.cascade.txSide.noiseAtRxDbm - 20 * Math.log10(10 / 0.3), 1e-6);
  assert.ok(riseFar < 13 && riseFar > 11, `riseFar ${riseFar}`); // -99 dBm noise vs -111 dBm floor: 10log(1+10^1.2) = 12.2 dB
});

test('wall thickness: reference thickness reported, scaling documented by test', () => {
  const brick = MATERIAL_TRANSMISSION.brick;
  const w = { id: 'w', material: 'brick', p1: { x: -5, y: 5 }, p2: { x: 5, y: 5 }, zMin: 0, zMax: 3 };
  const base = wallTransmissionInfo(w, 600);
  assert.equal(base.source, 'table');
  assert.equal(base.refThicknessM, brick.refThicknessM);
  assert.equal(base.thicknessM, brick.refThicknessM);
  assert.equal(base.thicknessFactor, 1);
  near(base.lossDb, brick.lossDb600, 1e-9);
  const thick = wallTransmissionInfo({ ...w, thicknessM: 0.3 }, 600);
  near(thick.thicknessFactor, 0.3 / brick.refThicknessM, 1e-9);
  near(thick.lossDb, brick.lossDb600 * 0.3 / brick.refThicknessM, 1e-9);
  near(thick.thicknessM, 0.3, 1e-12);
  near(wallTransmissionInfo({ ...w, thicknessFactor: 2 }, 600).lossDb, 2 * brick.lossDb600, 1e-9);
  const ov = wallTransmissionInfo({ ...w, transmissionLossDb: 9, thicknessM: 1 }, 600);
  assert.equal(ov.source, 'override'); assert.equal(ov.lossDb, 9);
  assert.equal(wallTransmissionLossDb(w, 600), base.lossDb);
  // the detail rides on the crossing result and on solved paths
  const pl = pathWallLoss({ reflectors: [{ ...w, thicknessM: 0.2 }] }, [{ x: 0, y: 0, z: 1 }, { x: 0, y: 10, z: 1 }], 600);
  assert.equal(pl.detail.length, 1);
  assert.equal(pl.detail[0].refThicknessM, brick.refThicknessM);
  near(pl.detail[0].thicknessM, 0.2, 1e-12);
  near(pl.lossDb, brick.lossDb600 * 2, 1e-9);
  const { scene, link } = micScene([]);
  scene.reflectors = [{ ...w, thicknessM: 0.2 }];
  const r = solveLink(scene, link);
  assert.equal(r.paths[0].wallLossDetail[0].refThicknessM, brick.refThicknessM);
});

test('requiredSnrDb: override, then the receiver preset (so raising NF worsens sensitivity), then derived from sensitivity', async () => {
  const { RX_PRESETS } = await import('../js/model/rx-params.js');
  const pre = RX_PRESETS['mic-receiver-typical'];
  const mk = (extra) => micScene([], { rxPreset: 'mic-receiver-typical', sensitivityDbm: pre.sensitivityDbm, noiseFigureDb: pre.noiseFigureDb, ...extra });
  const a = mk({}); const ra = solveLink(a.scene, a.link);
  assert.equal(ra.cascade.requiredSource, 'preset');
  assert.equal(ra.requiredSnrDb, pre.requiredCnrDb);
  // presets are built so that the preset figure equals the derived one (to about 0.01 dB): the default margin is unchanged
  near(ra.marginDb, ra.inputPowerDbm - pre.sensitivityDbm, 0.02);
  // raising the receiver NF by 4 dB now moves the system sensitivity by 4 dB and the margin by -4 dB
  const b = mk({ noiseFigureDb: pre.noiseFigureDb + 4 }); const rb = solveLink(b.scene, b.link);
  near(rb.cascade.sensitivityAtAntennaDbm - ra.cascade.sensitivityAtAntennaDbm, 4, 1e-9);
  near(ra.marginDb - rb.marginDb, 4, 1e-9);
  // hand-edited sensitivity differing from the preset: derived from the sensitivity (the user's edit wins), margin = input - sens
  const c = mk({ sensitivityDbm: -100 }); const rc = solveLink(c.scene, c.link);
  assert.equal(rc.cascade.requiredSource, 'sensitivity');
  near(rc.marginDb, rc.inputPowerDbm + 100, 1e-9);
  // explicit override first
  const d = mk({ requiredSnrDb: 30 }); const rd = solveLink(d.scene, d.link);
  assert.equal(rd.cascade.requiredSource, 'override');
  assert.equal(rd.requiredSnrDb, 30);
  // the default mic scene (sensitivity -95 differs from the preset's -90) keeps its old margin exactly
  const def = createDefaultScene(); def.environment.externalNoise = undefined; def.environment = { ...def.environment, model: 'free-space' }; def.reflectors = [];
  const ml = def.links.find((l) => l.kind === 'mic') || createDefaultLink('mic');
  const rm = solveLink(def, ml);
  near(rm.marginDb, rm.inputPowerDbm - ml.rx.sensitivityDbm, 1e-9);
});

test('external noise (off by default) raises the antenna noise floor and falls with frequency', () => {
  const kTB = -174 + 10 * Math.log10(200000);
  const off = micScene([]); const r0 = solveLink(off.scene, off.link);
  assert.equal(r0.cascade.externalNoiseNfDb, 0);
  near(r0.cascade.noiseFloorDbm, kTB + 8, 1e-9);
  const on = micScene([]); on.scene.environment.externalNoise = 'noisy-venue'; // 12 dB at 600 MHz
  const r1 = solveLink(on.scene, on.link);
  near(r1.cascade.externalNoiseNfDb, 12, 1e-9);
  near(r1.cascade.noiseFloorDbm, kTB + 10 * Math.log10(lin(8) + lin(12) - 1), 1e-9);
  near(r1.marginDb, r0.marginDb - (r1.cascade.noiseFloorDbm - r0.cascade.noiseFloorDbm), 1e-9);
  assert.ok(r1.marginDb < r0.marginDb - 4);
  // quiet site: a low-noise chain cannot beat the external floor
  const q = micScene([{ kind: 'booster', gainDb: 20, nfDb: 1 }]); q.scene.environment.externalNoise = 'outdoor';
  const rq = solveLink(q.scene, q.link);
  assert.ok(rq.cascade.noiseFloorDbm > kTB + rq.cascade.systemNfDb);
  // frequency scaling: 12 dB at 600 MHz -> 12 - 27.7 log10(2) at 1200 MHz; numeric value in dB above kT, never negative
  const hi = micScene([]); hi.scene.environment.externalNoise = 12; hi.link.freqMHz = 1200;
  near(solveLink(hi.scene, hi.link).cascade.externalNoiseNfDb, 12 - 27.7 * Math.log10(2), 1e-9);
  const huge = micScene([]); huge.scene.environment.externalNoise = 3; huge.link.freqMHz = 6000;
  assert.equal(solveLink(huge.scene, huge.link).cascade.externalNoiseNfDb, 0);
  // IEM: external noise now applies at the bodypack antenna (margin falls by the floor rise, tolerance 1e-3)
  const iem = createDefaultScene(); iem.environment = { ...iem.environment, externalNoise: 'noisy-venue', model: 'free-space' }; iem.reflectors = [];
  const il = createDefaultLink('iem'); delete il.branches; iem.links = [il];
  const ri = solveLink(iem, il);
  assert.equal(ri.cascade.externalNoiseNfDb, 12);
  near(ri.marginDb, ri.inputPowerDbm - il.rx.sensitivityDbm - (ri.cascade.noiseFloorDbm - (kTB + ri.cascade.systemNfDb)), 1e-3);
  assert.ok(ri.cascade.noiseFloorDbm > kTB + ri.cascade.systemNfDb + 2);
});
