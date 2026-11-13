import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene, createDefaultLink, validateScene, migrateScene, deserialize, serialize } from '../js/model/scene.js';
import { solveDiversity, effectiveAntennaB } from '../js/model/diversity.js';
import { solveLink } from '../js/model/rf.js';
import * as A from '../js/actions.js';

const scene = () => {
  const s = createDefaultScene();
  s.links[0].rx.diversity.enabled = true;
  return s;
};

test('default: orientation null, results unchanged, helper says everything follows A', () => {
  const s = scene();
  const l = s.links[0];
  assert.equal(l.rx.diversity.antennaB.orientation, null);
  const e = effectiveAntennaB(l);
  assert.deepEqual(e.orientation, l.rx.antenna.orientation);
  assert.equal(e.type, l.rx.antenna.type);
  assert.equal(e.gainDbi, l.rx.antenna.gainDbi);
  assert.deepEqual(e.followsA, { antenna: true, orientation: true });
  // B at the same position as A with the same antenna gives exactly A's level
  l.rx.diversity.antennaB.pos = { ...l.rx.pos };
  const { a, b } = solveDiversity(s, l);
  assert.equal(b.inputPowerDbm, a.inputPowerDbm);
  assert.equal(a.inputPowerDbm, solveLink(s, l).inputPowerDbm);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test('an orientation override changes only B: a paddle aimed away loses gain, aimed at the mic gains it back', () => {
  const st = createStore(scene());
  const id = st.getScene().links[0].id;
  st.update((d) => { d.links[0].rx.diversity.antennaB.pos = { ...d.links[0].rx.pos }; });
  const base = solveDiversity(st.getScene(), st.getScene().links[0]);
  const rxAz = st.getScene().links[0].rx.antenna.orientation.az;
  A.setAntennaBOrientation(st, id, { az: (rxAz + 180) % 360 });
  let l = st.getScene().links[0];
  assert.deepEqual(l.rx.antenna.orientation, { az: rxAz, el: 0 }); // A untouched
  let r = solveDiversity(st.getScene(), l);
  assert.equal(r.a.inputPowerDbm, base.a.inputPowerDbm);
  assert.ok(r.b.inputPowerDbm < base.b.inputPowerDbm - 8, 'aimed away loses gain: ' + (base.b.inputPowerDbm - r.b.inputPowerDbm));
  assert.equal(solveLink(st.getScene(), l).inputPowerDbm, base.a.inputPowerDbm);
  // back to following A
  A.setAntennaBOrientation(st, id, null);
  r = solveDiversity(st.getScene(), st.getScene().links[0]);
  assert.equal(r.b.inputPowerDbm, base.b.inputPowerDbm);
  assert.equal(st.getScene().links[0].rx.diversity.antennaB.orientation, null);
  // an omni-pattern antenna does not care about direction
  const o = createStore(scene());
  o.update((d) => { d.links[0].rx.antenna = { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 } }; d.links[0].rx.diversity.antennaB.pos = { ...d.links[0].rx.pos }; });
  const before = solveDiversity(o.getScene(), o.getScene().links[0]).b.inputPowerDbm;
  A.setAntennaBOrientation(o, o.getScene().links[0].id, { az: 123, el: 10 });
  assert.ok(Math.abs(solveDiversity(o.getScene(), o.getScene().links[0]).b.inputPowerDbm - before) < 1e-9);
});

test('setAntennaBOrientation: partial values, wrapping, clamping, coalescing', () => {
  const st = createStore(scene());
  const id = st.getScene().links[0].id;
  A.setAntennaBOrientation(st, id, { az: 450 });
  assert.deepEqual(st.getScene().links[0].rx.diversity.antennaB.orientation, { az: 90, el: 0 }); // el kept from A
  A.setAntennaBOrientation(st, id, { az: -30, el: 120 });
  assert.deepEqual(st.getScene().links[0].rx.diversity.antennaB.orientation, { az: 330, el: 90 });
  A.setAntennaBOrientation(st, id, { el: -200 });
  assert.deepEqual(st.getScene().links[0].rx.diversity.antennaB.orientation, { az: 330, el: -90 });
  assert.equal(validateScene(st.getScene()).ok, true);
  for (let v = 10; v < 60; v += 10) A.setAntennaBOrientation(st, id, { az: v }, { coalesce: 'aim' });
  st.undo();
  assert.deepEqual(st.getScene().links[0].rx.diversity.antennaB.orientation, { az: 330, el: -90 });
  assert.equal(A.setAntennaBOrientation(st, 'missing', { az: 1 }), false);
  assert.equal(A.setAntennaBOrientation(st, id, 'north'), false);
});

test('validation and migration', () => {
  const s = scene();
  const b = () => s.links[0].rx.diversity.antennaB;
  b().orientation = { az: 200, el: -45 };
  assert.equal(validateScene(s).ok, true);
  for (const bad of [{ az: 361, el: 0 }, { az: -1, el: 0 }, { az: 0, el: 91 }, { az: 0, el: -91 }, { az: 'x', el: 0 }, { az: 0 }, 'north', 5]) {
    b().orientation = bad;
    assert.equal(validateScene(s).ok, false, JSON.stringify(bad));
  }
  const old = scene();
  delete old.links[0].rx.diversity.antennaB.orientation;
  assert.equal(validateScene(old).ok, true);
  assert.equal(migrateScene(old).links[0].rx.diversity.antennaB.orientation, null);
  const iem = createDefaultScene();
  iem.links = [createDefaultLink('iem')];
  assert.equal(iem.links[0].rx.diversity.antennaB.orientation, null);
});

test('effectiveAntennaB helper cases', () => {
  const s = scene();
  const l = s.links[0];
  const A0 = l.rx.antenna;
  // 1. orientation-only override
  l.rx.diversity.antennaB.orientation = { az: 10, el: 5 };
  let e = effectiveAntennaB(l);
  assert.deepEqual(e.orientation, { az: 10, el: 5 });
  assert.equal(e.type, A0.type);
  assert.deepEqual(e.followsA, { antenna: true, orientation: false });
  // 2. different antenna type without its own orientation: inherits A's direction
  l.rx.diversity.antennaB.orientation = null;
  l.rx.diversity.antennaB.antenna = { type: 'dipole', gainDbi: 2.15 };
  e = effectiveAntennaB(l);
  assert.equal(e.type, 'dipole');
  assert.equal(e.gainDbi, 2.15);
  assert.deepEqual(e.orientation, A0.orientation);
  assert.deepEqual(e.followsA, { antenna: false, orientation: true });
  // 3. different antenna with its own orientation
  l.rx.diversity.antennaB.antenna = { type: 'helical', gainDbi: 5, orientation: { az: 77, el: 0 } };
  e = effectiveAntennaB(l);
  assert.deepEqual(e.orientation, { az: 77, el: 0 });
  assert.deepEqual(e.followsA, { antenna: false, orientation: false });
  // 4. antennaB.orientation wins over the antenna's own orientation
  l.rx.diversity.antennaB.orientation = { az: 200, el: 20 };
  assert.deepEqual(effectiveAntennaB(l).orientation, { az: 200, el: 20 });
  // 5. no diversity data at all
  const bare = { rx: { antenna: { type: 'omni', gainDbi: 0, orientation: { az: 1, el: 2 } } } };
  assert.deepEqual(effectiveAntennaB(bare), { type: 'omni', gainDbi: 0, orientation: { az: 1, el: 2 }, followsA: { antenna: true, orientation: true } });
  // the returned orientation is a copy
  e.orientation.az = 999;
  assert.equal(l.rx.diversity.antennaB.orientation.az, 200);
});
