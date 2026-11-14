import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene, validateScene } from '../js/model/scene.js';
import { setAntennaField, setAntennaType, antennaOf } from '../js/actions.js';
import { tiltFromPointer, POLARISATION_LABELS } from '../js/ui/antennaFields.js';
import { allowedPolarisations, GROUND_PLANE_GAIN_DBI } from '../js/model/library.js';
import { solveLink } from '../js/model/rf.js';

const mk = () => { const s = createStore(createDefaultScene()); return { s, id: s.getScene().links[0].id }; };

test('tilt and roll: clamp, write, and delete at 0', () => {
  const { s, id } = mk();
  assert.equal(setAntennaField(s, id, 'tx', 'tiltDeg', 120), true);
  assert.equal(s.getScene().links[0].tx.antenna.tiltDeg, 90);
  setAntennaField(s, id, 'rx', 'rollDeg', -200);
  assert.equal(s.getScene().links[0].rx.antenna.rollDeg, -180);
  setAntennaField(s, id, 'tx', 'tiltDeg', 0);
  assert.equal('tiltDeg' in s.getScene().links[0].tx.antenna, false);
  assert.equal(setAntennaField(s, id, 'tx', 'tiltDeg', NaN), false);
  assert.equal(validateScene(s.getScene()).ok, true);
});

test('polarisation, contact and dampness: set, reject invalid, delete at default', () => {
  const { s, id } = mk();
  for (const p of allowedPolarisations('dipole')) { setAntennaField(s, id, 'rx', 'polarisation', p); assert.equal(s.getScene().links[0].rx.antenna.polarisation, p); assert.ok(POLARISATION_LABELS[p]); }
  setAntennaField(s, id, 'rx', 'polarisation', 'rhcp'); assert.equal(s.getScene().links[0].rx.antenna.polarisation, 'slant45'); // circular is illegal on a dipole: ignored
  setAntennaField(s, id, 'rx', 'polarisation', null); assert.equal(s.getScene().links[0].rx.antenna.polarisation, 'vertical'); // null = the type default, never absent
  setAntennaType(s, id, 'rx', 'helical-cp'); assert.equal(s.getScene().links[0].rx.antenna.polarisation, 'rhcp');
  setAntennaField(s, id, 'rx', 'polarisation', 'lhcp'); assert.equal(s.getScene().links[0].rx.antenna.polarisation, 'lhcp');
  setAntennaType(s, id, 'rx', 'dipole'); assert.equal(s.getScene().links[0].rx.antenna.polarisation, 'vertical');
  setAntennaField(s, id, 'rx', 'contact', 'skin'); setAntennaField(s, id, 'rx', 'dampness', 'wet');
  assert.equal(s.getScene().links[0].rx.antenna.contact, 'skin');
  setAntennaField(s, id, 'rx', 'contact', 'free'); setAntennaField(s, id, 'rx', 'dampness', 'dry');
  assert.equal('contact' in s.getScene().links[0].rx.antenna || 'dampness' in s.getScene().links[0].rx.antenna, false);
});

test('ground plane: quarter-wave only, sets gain, clearing restores library gain, type change drops it', () => {
  const { s, id } = mk();
  assert.equal(setAntennaField(s, id, 'rx', 'groundPlane', 'rack'), false); // default antenna is not a quarter-wave
  assert.equal(setAntennaType(s, id, 'rx', 'quarterwave'), true);
  for (const g of Object.keys(GROUND_PLANE_GAIN_DBI)) {
    setAntennaField(s, id, 'rx', 'groundPlane', g);
    assert.equal(s.getScene().links[0].rx.antenna.groundPlane, g);
    assert.equal(s.getScene().links[0].rx.antenna.gainDbi, GROUND_PLANE_GAIN_DBI[g]);
  }
  assert.equal(validateScene(s.getScene()).ok, true);
  setAntennaField(s, id, 'rx', 'groundPlane', null);
  assert.equal('groundPlane' in s.getScene().links[0].rx.antenna, false);
  setAntennaField(s, id, 'rx', 'groundPlane', 'large'); setAntennaType(s, id, 'rx', 'dipole');
  assert.equal('groundPlane' in s.getScene().links[0].rx.antenna, false);
  assert.equal(setAntennaType(s, id, 'rx', 'nope'), false);
});

test('targets: branches (branch 0 mirrors tx) and diversity antenna B', () => {
  const { s, id } = mk();
  const sc = s.getScene(), l = sc.links[0];
  assert.equal(antennaOf(l, 'antennaB'), null);
  assert.equal(setAntennaField(s, id, 'antennaB', 'tiltDeg', 10), false);
  s.update((d) => { d.links[0].rx.diversity = { enabled: true, antennaB: { pos: { x: 1, y: 1, z: 1 }, antenna: structuredClone(d.links[0].rx.antenna) } }; });
  assert.equal(setAntennaField(s, id, 'antennaB', 'polarisation', 'horizontal'), true);
  assert.equal(s.getScene().links[0].rx.diversity.antennaB.antenna.polarisation, 'horizontal');
  assert.equal(setAntennaField(s, id, 'nonsense', 'tiltDeg', 5), false);
  assert.equal(setAntennaField(s, id, 'tx', 'bad', 5), false);
});

test('coalesced drags are one undo step', () => {
  const { s, id } = mk();
  setAntennaField(s, id, 'tx', 'tiltDeg', 10, { coalesce: 'd' }); setAntennaField(s, id, 'tx', 'tiltDeg', 25, { coalesce: 'd' });
  s.undo(); assert.equal('tiltDeg' in s.getScene().links[0].tx.antenna, false);
});

test('tiltFromPointer: up is positive, symmetric about the antenna, clamped, null at the centre', () => {
  assert.equal(tiltFromPointer(30, 30), 45);
  assert.equal(tiltFromPointer(-30, 30), 45);
  assert.equal(tiltFromPointer(30, -30), -45);
  assert.equal(tiltFromPointer(0, 20), 90);
  assert.equal(tiltFromPointer(0, 0), null);
  assert.equal(tiltFromPointer(NaN, 1), null);
});

test('polarisation mismatch appears in the waterfall steps and warns above 10 dB', () => {
  const { s, id } = mk();
  setAntennaField(s, id, 'tx', 'polarisation', 'horizontal'); setAntennaField(s, id, 'rx', 'polarisation', 'vertical');
  const r = solveLink(s.getScene(), s.getScene().links[0]);
  assert.ok(r.waterfall.some((x) => x.label === 'Polarisation mismatch' && x.deltaDb < -10), JSON.stringify(r.waterfall.map((x) => x.label)));
  assert.ok(r.warnings.some((w) => /Polarisation mismatch/.test(w)));
});
