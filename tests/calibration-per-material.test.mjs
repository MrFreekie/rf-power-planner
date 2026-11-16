// Walk-test calibration per wall material, and the per-channel TV block level override.
// Hand anchors: a wall adds its loss once per crossing, so with truth brick +8 dB and glass +3 dB a reading behind brick only is 8 dB low, and a reading behind
// both is 11 dB low (the free-space level is Pt - FSPL, identical for truth and model). Tolerances are stated per assertion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene, createDefaultLink, validateScene } from '../js/model/scene.js';
import { predictAt, suggestCalibration, MIN_READINGS_PER_MATERIAL } from '../js/model/measurements.js';
import { createStore } from '../js/store.js';
import * as AA from '../js/actionsAreas.js';
import { tvNoiseRiseDb, tvBlockLevelDbm, tvBlockLevelsOf, tvBlockLevelIsAssumed, applyTvNoiseRise, TV_BLOCK_DBM, TV_BLOCK_LEVEL_LIMITS } from '../js/model/spectrum-map.js';

const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} got ${a}, expected ${b} +- ${tol}`);
const errs = (s) => validateScene(s).errors;
const omni = () => ({ type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 }, polarisation: 'vertical' });
function room(byMat) {
  const s = createDefaultScene(); s.environment.externalNoise = 0; s.environment.model = 'free-space'; s.environment.bodyLossDb = 0;
  const l = createDefaultLink('p2p'); s.links = [l]; l.freqMHz = 606.1; l.tx.powerDbm = 10; l.chain = [];
  l.tx.pos = { x: 0, y: 0, z: 1.5 }; l.rx.pos = { x: 10, y: 0, z: 1.5 }; l.tx.antenna = omni(); l.rx.antenna = omni();
  s.reflectors = [
    { id: 'wb', name: 'Brick wall', p1: { x: 15, y: -20 }, p2: { x: 15, y: 20 }, zMin: 0, zMax: 4, material: 'brick' },
    { id: 'wg', name: 'Glass wall', p1: { x: 30, y: -20 }, p2: { x: 30, y: 20 }, zMin: 0, zMax: 4, material: 'glass' },
  ];
  if (byMat) s.environment.wallLossAdjustByMaterialDb = byMat;
  return s;
}
const readings = (model, truth, xs) => { const id = model.links[0].id; truth.links[0].id = id; return xs.map((x, i) => ({ id: `m${i}`, linkId: id, x, y: 0, rxDbm: predictAt(truth, id, { x, y: 0 }) })); };

test('per-material wall fit recovers brick +8 and glass +3 from readings behind brick only and behind both (tolerance 0.3 dB)', () => {
  const truth = room({ brick: 8, glass: 3 }), model = room();
  model.measurements = readings(model, truth, [8, 12, 18, 22, 26, 33, 38, 43, 48, 52]);
  const g = suggestCalibration(model), c = g.candidates.find((x) => x.id === 'wall-loss-by-material');
  assert.ok(c.applicable, c.reason);
  near(c.fitted.brick, 8, 0.3, 'brick'); near(c.fitted.glass, 3, 0.3, 'glass');
  assert.ok(c.afterRmsDb < 0.1, `after ${c.afterRmsDb}`);
  assert.equal(c.confidence, 'ok'); // 8 and 5 readings: glass has 5 = CONFIDENT_READINGS_PER_MATERIAL
  assert.equal(g.best.id, 'wall-loss-by-material');
  assert.ok(/brick/.test(g.headline) && /glass/.test(g.headline) && /body loss/.test(g.headline), g.headline);
  assert.ok(g.notes.length >= 1 && g.notes.some((n) => /body loss/.test(n)));
  assert.equal(g.candidates.find((x) => x.id === 'wall-loss').afterRmsDb > c.afterRmsDb + 0.5, true, 'beats the single figure');
});

test('too little data: one material, or fewer than the minimum readings per material, falls back to the single figure and says why', () => {
  const truth = room({ brick: 8, glass: 3 }), model = room();
  assert.equal(MIN_READINGS_PER_MATERIAL, 3);
  model.measurements = readings(model, truth, [8, 12, 18, 22, 26, 40]); // glass crossed by one reading only
  let c = suggestCalibration(model).candidates.find((x) => x.id === 'wall-loss-by-material');
  assert.equal(c.applicable, false); assert.ok(/fewer than two/.test(c.reason), c.reason);
  const m2 = room(); m2.reflectors = [m2.reflectors[0]]; const t2 = room({ brick: 8 }); t2.reflectors = [t2.reflectors[0]];
  m2.measurements = readings(m2, t2, [8, 18, 22, 26, 30, 34]);
  const g2 = suggestCalibration(m2); c = g2.candidates.find((x) => x.id === 'wall-loss-by-material');
  assert.equal(c.applicable, false); assert.ok(/fewer than two different materials/.test(c.reason));
  assert.equal(g2.candidates.find((x) => x.id === 'wall-loss').applicable, true); near(g2.candidates.find((x) => x.id === 'wall-loss').fitted, 8, 0.3);
  assert.equal(g2.best.id === 'wall-loss-by-material', false);
});

test('low confidence is flagged with 3 to 4 readings per material; a per-material fit that does not beat one figure is refused (no overfit)', () => {
  const truth = room({ brick: 8, glass: 3 }), model = room();
  model.measurements = readings(model, truth, [8, 18, 22, 26, 33, 38, 43]); // brick 6, glass 3
  const g = suggestCalibration(model), c = g.candidates.find((x) => x.id === 'wall-loss-by-material');
  assert.ok(c.applicable); assert.equal(c.confidence, 'low'); assert.ok(/low confidence/.test(g.headline)); assert.ok(g.cautions.some((t) => /low confidence/.test(t)));
  // truth: the same +6 for both materials -> one figure is as good, so the per-material candidate is refused
  const same = room({ brick: 6, glass: 6 }), m2 = room(); m2.measurements = readings(m2, same, [8, 12, 18, 22, 26, 33, 38, 43, 48, 52]);
  const c2 = suggestCalibration(m2).candidates.find((x) => x.id === 'wall-loss-by-material');
  assert.equal(c2.applicable, false); assert.ok(/no better than one figure/.test(c2.reason));
});

test('a single wall-loss fit that leaves clear-path readings off says body loss or another cause is involved', () => {
  const truth = room({ brick: 6 }), model = room(); truth.environment.bodyLossDb = 4; truth.links[0].kind = model.links[0].kind;
  model.measurements = readings(model, truth, [8, 12, 18, 22, 26, 30]);
  const g = suggestCalibration(model);
  assert.ok(g.notes.some((n) => /body loss/.test(n)));
  assert.ok(Array.isArray(suggestCalibration(room()).notes), 'notes is always present');
});

test('rf.js applies the per-material figure to that material only and validateScene bounds it', () => {
  const a = room(), b = room({ brick: 10 }), id = a.links[0].id; b.links[0].id = id;
  near(predictAt(a, id, { x: 20, y: 0 }) - predictAt(b, id, { x: 20, y: 0 }), 10, 0.01, 'brick crossed');
  near(predictAt(a, id, { x: 10, y: 0 }) - predictAt(b, id, { x: 10, y: 0 }), 0, 1e-9, 'no wall');
  assert.deepEqual(errs(b), []);
  assert.ok(errs(room({ brick: 99 })).length > 0); assert.ok(errs(room({ brick: 'x' })).length > 0);
  const s = room(); s.environment.wallLossAdjustByMaterialDb = []; assert.ok(errs(s).length > 0);
});

test('applyCalibration writes the per-material map clamped, in one undo step, and refuses nothing else', () => {
  const store = createStore(room());
  assert.equal(AA.applyCalibration(store, { field: 'environment.wallLossAdjustByMaterialDb', fitted: { brick: 8.123, glass: 99 } }), true);
  assert.deepEqual(store.getScene().environment.wallLossAdjustByMaterialDb, { brick: 8.12, glass: 30 });
  assert.equal(AA.applyCalibration(store, { field: 'environment.wallLossAdjustByMaterialDb', fitted: {} }), false);
  assert.equal(AA.applyCalibration(store, { field: 'links', fitted: 1 }), false);
});

// ---------------------------------------------------------------- TV block override
test('TV block level: default unchanged; a per-channel override replaces the assumption for that channel only', () => {
  for (let n = 14; n < 70; n++) near(tvBlockLevelDbm(n), tvBlockLevelDbm(n, undefined), 0);
  near(tvBlockLevelDbm(34, { 34: -50 }), -50, 0); near(tvBlockLevelDbm(35, { 34: -50 }), tvBlockLevelDbm(35), 0);
  near(tvBlockLevelDbm(34, { 34: 'x' }), tvBlockLevelDbm(34), 0, 'invalid ignored'); near(tvBlockLevelDbm(34, { 34: -5 }), tvBlockLevelDbm(34), 0, 'above the cap ignored');
  assert.equal(tvBlockLevelIsAssumed(34, { 34: -50 }), false); assert.equal(tvBlockLevelIsAssumed(34, {}), true); assert.equal(tvBlockLevelIsAssumed(34), true);
  // hand: 8 MHz block, 200 kHz window: in-band = block - 10 log10(7600/200) = block - 15.798. At -50 dBm block, in-band -65.8 dBm; over a -120 dBm floor the rise is 54.2 dB (+-0.1)
  near(tvNoiseRiseDb(-120, tvBlockLevelDbm(34, { 34: -50 }), 8), 54.2, 0.1);
  assert.ok(tvNoiseRiseDb(-120, tvBlockLevelDbm(34, { 34: -50 }), 8) > tvNoiseRiseDb(-120, TV_BLOCK_DBM, 8) + 20);
});

test('applyTvNoiseRise uses blockLevelsDbm and marks user-set channels; tvBlockLevelsOf drops invalid entries; validateScene rejects bad ones', () => {
  const ch = [{ n: 34, loMHz: 586, hiMHz: 594, occupied: true }, { n: 35, loMHz: 594, hiMHz: 602, occupied: true }];
  const pts = [{ freqMHz: 590, dbm: -110 }, { freqMHz: 598, dbm: -110 }];
  const d = applyTvNoiseRise(pts, ch), o = applyTvNoiseRise(pts, ch, { blockLevelsDbm: { 34: -50 } });
  near(o[1].dbm, d[1].dbm, 0); assert.ok(o[0].dbm > d[0].dbm + 10); assert.equal(o[0].blockUserSet, true); assert.equal(o[1].blockUserSet, undefined); assert.equal(d[0].blockUserSet, undefined);
  assert.deepEqual(tvBlockLevelsOf({ tvBlockLevelsDbm: { 34: -50, 1: -50, 40: -500, abc: -50, '034': -50 } }), { 34: -50 });
  assert.deepEqual(tvBlockLevelsOf({}), {}); assert.deepEqual(tvBlockLevelsOf({ tvBlockLevelsDbm: [1] }), {});
  const s = createDefaultScene(); assert.deepEqual(errs(s), []);
  s.tvBlockLevelsDbm = { 34: -50 }; assert.deepEqual(errs(s), []);
  for (const bad of [{ 34: 5 }, { 1: -50 }, { x: -50 }, { 34: 'a' }, [], 'a']) { s.tvBlockLevelsDbm = bad; assert.ok(errs(s).length > 0, JSON.stringify(bad)); }
  s.tvBlockLevelsDbm = Object.fromEntries(Array.from({ length: 71 }, (_, i) => [i, -50])); assert.ok(errs(s).length > 0, 'cap');
  assert.deepEqual(TV_BLOCK_LEVEL_LIMITS.dbm, [-120, -10]);
});
