// Walk-test calibration (js/model/measurements.js, actions, examples).
// Hand anchors: FSPL at 606.1 MHz over 10 m = 20 log10(10) + 20 log10(606.1) - 27.55 = 20 + 55.65 - 27.55 = 48.10 dB; a pure body-loss offset moves every reading by the
// same dB; the CSV import is exact text parsing. Tolerances are stated per assertion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene, createDefaultLink, validateScene, migrateScene } from '../js/model/scene.js';
import { predictAt, compareMeasurements, suggestCalibration, importMeasurementsCsv } from '../js/model/measurements.js';
import * as AA from '../js/actionsAreas.js';
import { measurementsScene, EXAMPLES } from '../js/examples.js';

const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} got ${a}, expected ${b} +- ${tol}`);
const omni = (p = 'vertical') => ({ type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 }, polarisation: p });
function simple({ body = 0, txPol = 'vertical' } = {}) {
  const s = createDefaultScene(); s.environment.externalNoise = 0; s.environment.model = 'free-space'; s.environment.bodyLossDb = body;
  const l = createDefaultLink('mic'); s.links = [l]; l.freqMHz = 606.1; l.tx.powerDbm = 10;
  l.chain = []; l.tx.pos = { x: 0, y: 0, z: 1.5 }; l.rx.pos = { x: 10, y: 0, z: 1.5 }; l.tx.antenna = omni(txPol); l.rx.antenna = omni('vertical'); l.rx.diversity.antennaB.pos = { x: 10, y: -0.6, z: 1.5 };
  return s;
}

test('predictAt: free-space level at 10 m is Pt - FSPL (hand anchor 48.10 dB), moving the receiver changes it by 20 log10 of the distance ratio', () => {
  const s = simple();
  near(predictAt(s, s.links[0].id, { x: 10, y: 0 }), 10 - 48.10, 0.1, '10 m');
  near(predictAt(s, s.links[0].id, { x: 20, y: 0 }) - predictAt(s, s.links[0].id, { x: 10, y: 0 }), -6.02, 0.02, 'doubling the distance');
  assert.equal(predictAt(s, 'nope', { x: 1, y: 1 }), null);
  assert.equal(s.links[0].rx.pos.x, 10, 'the scene is not changed');
});

test('compareMeasurements: delta = measured - predicted, mean, rms and the worst point; unknown links are skipped', () => {
  const s = simple(); const id = s.links[0].id, p = (x) => predictAt(s, id, { x, y: 0 });
  s.measurements = [{ id: 'a', linkId: id, x: 10, y: 0, rxDbm: p(10) - 2 }, { id: 'b', linkId: id, x: 20, y: 0, rxDbm: p(20) + 4 }, { id: 'c', linkId: 'gone', x: 5, y: 0, rxDbm: -50 }];
  const c = compareMeasurements(s);
  assert.equal(c.n, 2); assert.equal(c.skipped, 1);
  near(c.points[0].deltaDb, -2, 1e-9); near(c.points[1].deltaDb, 4, 1e-9);
  near(c.meanDb, 1, 1e-9); near(c.rmsDb, Math.sqrt((4 + 16) / 2), 1e-9); assert.equal(c.worst.id, 'b');
});

test('suggestCalibration recovers the body loss that generated the readings (example 10 dB, assumed 3 dB) and brings the residual under 0.3 dB', () => {
  const s = measurementsScene('body-loss-high'), g = suggestCalibration(s);
  near(g.before.meanDb, -7, 0.05); near(g.before.rmsDb, 7.0, 0.05);
  assert.equal(g.needed, true); assert.equal(g.best.id, 'body-loss'); near(g.best.fitted, 10, 0.1, 'fitted body loss');
  assert.ok(g.best.afterRmsDb < 0.3 && g.best.improvementDb > 6.5);
  assert.equal(g.candidates.find((c) => c.id === 'wall-loss').applicable, false); assert.equal(g.candidates.find((c) => c.id === 'cross-polar').applicable, false);
  assert.deepEqual(g.cautions, []);
});
test('clean match: no calibration needed', () => {
  const g = suggestCalibration(measurementsScene('clean-match'));
  assert.equal(g.needed, false); assert.equal(g.best, null); near(g.before.rmsDb, 0.23, 0.02); assert.ok(g.cautions.some((c) => /no calibration/.test(c)));
});

test('cross-polar fit: readings made with a 25 dB floor are recovered when the antennas are cross-polarised', () => {
  const truth = simple({ txPol: 'horizontal' }); truth.environment.xpdDb = 25;
  const model = simple({ txPol: 'horizontal' }); model.links[0].id = truth.links[0].id; // assumed 15 dB floor (default)
  model.measurements = [10, 14, 19, 25, 31, 38].map((x, i) => ({ id: `m${i}`, linkId: truth.links[0].id, x, y: 0, rxDbm: predictAt(truth, truth.links[0].id, { x, y: 0 }) }));
  const g = suggestCalibration(model), c = g.candidates.find((x) => x.id === 'cross-polar');
  assert.ok(c.applicable); near(c.fitted, 25, 0.5, 'fitted floor'); assert.ok(c.afterRmsDb < 0.1);
  // a constant offset in free space is equally explained by body loss: the model must say so
  assert.ok(g.candidates.find((x) => x.id === 'body-loss').afterRmsDb < 0.1); assert.ok(g.cautions.length > 0, 'ambiguity caution');
});

test('cautions: too few points and all readings at the same distance', () => {
  const s = simple({ body: 3 }), id = s.links[0].id;
  s.measurements = [{ id: 'a', linkId: id, x: 10, y: 0, rxDbm: predictAt(s, id, { x: 10, y: 0 }) - 6 }, { id: 'b', linkId: id, x: 10, y: 0.5, rxDbm: predictAt(s, id, { x: 10, y: 0.5 }) - 6 }];
  const g = suggestCalibration(s);
  assert.ok(g.cautions.some((c) => /at least 5/.test(c))); assert.ok(g.cautions.some((c) => /nearly the same distance/.test(c)));
  near(g.best.fitted, 9, 0.05, 'a 6 dB shortfall on 3 dB assumed');
  assert.deepEqual(suggestCalibration(simple()).candidates, []); assert.ok(suggestCalibration(simple()).cautions[0].includes('no usable'));
});

test('wall fit: extra loss per wall is recovered from readings behind a wall', () => {
  const mk = (adj) => { const s = simple(); s.reflectors = [{ id: 'w1', name: 'Wall', p1: { x: 15, y: -10 }, p2: { x: 15, y: 10 }, zMin: 0, zMax: 4, material: 'brick' }]; if (adj !== undefined) s.environment.wallLossAdjustDb = adj; return s; };
  const truth = mk(5), model = mk(), id = model.links[0].id; truth.links[0].id = id;
  model.measurements = [8, 12, 18, 24, 30, 37, 45].map((x, i) => ({ id: `m${i}`, linkId: id, x, y: 0, rxDbm: predictAt(truth, id, { x, y: 0 }) }));
  const g = suggestCalibration(model), w = g.candidates.find((c) => c.id === 'wall-loss');
  assert.ok(w.applicable); near(w.fitted, 5, 0.3, 'extra dB per wall'); assert.ok(w.afterRmsDb < 0.1);
  // a wall adjustment can never make a wall negative
  const neg = mk(-50); assert.ok(predictAt(neg, id, { x: 30, y: 0 }) >= predictAt(mk(), id, { x: 30, y: 0 }) - 6);
});

test('importMeasurementsCsv: headers, separators, linkId column, bad rows, cap', () => {
  let r = importMeasurementsCsv('x,y,dBm\n1,2,-50\n3,4,-60.5\n');
  assert.deepEqual(r.points, [{ x: 1, y: 2, rxDbm: -50 }, { x: 3, y: 4, rxDbm: -60.5 }]); assert.deepEqual(r.errors, []);
  r = importMeasurementsCsv('Link;X (m);Y (m);Level (dBm);Comment\nL1;1;2;-50;by the door\n');
  assert.deepEqual(r.points, [{ linkId: 'L1', x: 1, y: 2, rxDbm: -50, note: 'by the door' }]);
  r = importMeasurementsCsv('﻿# walk 1\nL2\t5\t6\t-70 dBm\n7\t8\t-71');
  assert.deepEqual(r.points, [{ linkId: 'L2', x: 5, y: 6, rxDbm: -70 }, { x: 7, y: 8, rxDbm: -71 }]);
  r = importMeasurementsCsv('1,2,3,-55\n');
  assert.deepEqual(r.points, [{ x: 1, y: 2, z: 3, rxDbm: -55 }]);
  r = importMeasurementsCsv('x,y,dBm\n1,two,-50\n1,2,500\n9,9\n4,5,-40');
  assert.equal(r.points.length, 1); assert.equal(r.errors.length, 3);
  r = importMeasurementsCsv(Array.from({ length: 250 }, (_, i) => `${i},0,-50`).join('\n'));
  assert.equal(r.points.length, 200); assert.ok(r.errors.some((e) => /At most 200/.test(e)));
  assert.equal(importMeasurementsCsv('').points.length, 0);
});

test('validation: measurements are validated, capped at 200, ids unique; older scenes without them are unchanged', () => {
  const s = simple(), id = s.links[0].id;
  assert.equal(validateScene(s).ok, true);
  s.measurements = [{ id: 'a', linkId: id, x: 1, y: 2, rxDbm: -50, note: 'ok' }];
  assert.equal(validateScene(s).ok, true);
  for (const bad of [{ id: 'a', linkId: id, x: 1, y: 2, rxDbm: 999 }, { id: '', linkId: id, x: 1, y: 2, rxDbm: -50 }, { id: 'a', linkId: id, x: NaN, y: 2, rxDbm: -50 }, { id: 'a', linkId: id, x: 1, y: 2, rxDbm: -50, note: 'x'.repeat(300) }]) {
    s.measurements = [bad]; assert.equal(validateScene(s).ok, false, JSON.stringify(bad).slice(0, 60));
  }
  s.measurements = [{ id: 'a', linkId: id, x: 1, y: 2, rxDbm: -50 }, { id: 'a', linkId: id, x: 1, y: 2, rxDbm: -50 }]; assert.equal(validateScene(s).ok, false);
  s.measurements = Array.from({ length: 201 }, (_, i) => ({ id: `m${i}`, linkId: id, x: 0, y: 0, rxDbm: -50 })); assert.equal(validateScene(s).ok, false);
  assert.throws(() => migrateScene(JSON.parse(JSON.stringify(s))));
  const e = simple(); e.environment.xpdDb = 99; assert.equal(validateScene(e).ok, false);
  const ok = measurementsScene('body-loss-high'); assert.equal(validateScene(ok).ok, true); assert.equal(migrateScene(JSON.parse(JSON.stringify(ok))).measurements.length, 12);
});

test('actions: add, update, remove, clear, import (one undo step) and applyCalibration (undoable, bounded)', () => {
  const st = createStore(simple()), id = st.getScene().links[0].id;
  const m1 = AA.addMeasurement(st, { x: 10, y: 0, rxDbm: -40, note: 'a\u0000b' });
  assert.ok(m1); assert.equal(st.getScene().measurements[0].linkId, id); assert.equal(st.getScene().measurements[0].note, 'ab');
  assert.equal(AA.addMeasurement(st, { x: 'a', y: 0, rxDbm: -40 }), null); assert.equal(AA.addMeasurement(st, { x: 1, y: 0, rxDbm: NaN }), null);
  AA.updateMeasurement(st, m1, { rxDbm: -45, x: 12, z: 2, note: '' }); const m = st.getScene().measurements[0];
  assert.equal(m.rxDbm, -45); assert.equal(m.x, 12); assert.equal(m.z, 2); assert.equal(m.note, undefined);
  AA.updateMeasurement(st, m1, { rxDbm: 'x', linkId: 'nope' }); assert.equal(st.getScene().measurements[0].rxDbm, -45); assert.equal(st.getScene().measurements[0].linkId, id);
  assert.ok(validateScene(st.getScene()).ok);
  const r = AA.importMeasurements(st, 'x,y,dBm\n1,1,-50\n2,2,-51\nbad,1,1', { replace: true });
  assert.equal(r.added, 2); assert.equal(r.errors.length, 1); assert.equal(st.getScene().measurements.length, 2);
  st.undo(); assert.equal(st.getScene().measurements.length, 1, 'the import was one undo step');
  AA.removeMeasurement(st, m1); assert.equal(st.getScene().measurements, undefined);
  AA.importMeasurements(st, '1,1,-50'); AA.clearMeasurements(st); assert.equal(st.getScene().measurements, undefined);
  const big = Array.from({ length: 250 }, (_, i) => `${i},0,-50`).join('\n');
  assert.equal(AA.importMeasurements(st, big).added, 200); assert.equal(AA.addMeasurement(st, { x: 1, y: 1, rxDbm: -50 }), null);

  const ex = createStore(measurementsScene('body-loss-high')), g = suggestCalibration(ex.getScene());
  assert.ok(AA.applyCalibration(ex, g)); near(ex.getScene().environment.bodyLossDb, 10, 0.1);
  near(compareMeasurements(ex.getScene()).rmsDb, 0.23, 0.03); ex.undo(); assert.equal(ex.getScene().environment.bodyLossDb, 3);
  assert.equal(AA.applyCalibration(ex, { field: 'links', fitted: 1 }), false); assert.equal(AA.applyCalibration(ex, { best: null }), false);
  assert.ok(AA.applyCalibration(ex, { field: 'environment.bodyLossDb', fitted: 500 })); assert.equal(ex.getScene().environment.bodyLossDb, 30);
});

test('examples: figures quoted in the notes are asserted', () => {
  const hi = measurementsScene('body-loss-high'), cm = measurementsScene('clean-match'), g = suggestCalibration(hi);
  assert.equal(hi.measurements.length, 12); near(hi.measurements[11].x - hi.measurements[0].x, 62, 1e-9);
  near(-g.before.meanDb, 7.0, 0.05); near(g.best.fitted, 10.0, 0.05); near(g.before.rmsDb, 7.0, 0.05); near(g.best.afterRmsDb, 0.2, 0.05);
  near(suggestCalibration(cm).before.rmsDb, 0.2, 0.05);
  const a = EXAMPLES.find((e) => e.id === 'measurements-body-loss-high').note, b = EXAMPLES.find((e) => e.id === 'measurements-clean-match').note;
  for (const t of ['twelve', '62 m', '7.0 dB', '3 dB', '10.0 dB', '0.2 dB']) assert.ok(a.includes(t), t);
  for (const t of ['twelve', '0.2 dB', '6 dB']) assert.ok(b.includes(t), t);
  assert.match(a, /^Problem:/); assert.match(b, /^Best practice:/);
  for (const n of [a, b]) assert.ok(n.split(/(?<=\.)\s/).length <= 4);
  assert.ok(validateScene(EXAMPLES.find((e) => e.id === 'measurements-body-loss-high').build().scene).ok);
});
