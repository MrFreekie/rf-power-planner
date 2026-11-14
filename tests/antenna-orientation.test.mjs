// Group (a): antenna tilt/roll, per-antenna polarisation with mismatch loss, quarter-wave ground plane. Hand-computed values.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as rf from '../js/model/rf.js';
import { GROUND_PLANE_GAIN_DBI } from '../js/model/library.js';
import { createDefaultScene, validateScene } from '../js/model/scene.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);
const omni = (extra = {}) => ({ type: 'omni', gainDbi: 0, orientation: { az: 0, el: 0 }, ...extra });
const hz = { az: 0, el: 0 }; // path along +y (north); antennas at az 0 have their right axis (east) across the path
const lossOf = (t, r) => rf.polarisationLossDb(t, r, hz, { az: 180, el: 0 });

test('tiltDeg 0 / rollDeg 0 are bit-identical to no field; tilt equals orientation.el for a dipole (+/-1e-9 dB)', () => {
  const a = { type: 'dipole', gainDbi: 2.15, orientation: { az: 0, el: 0 } };
  for (const b of [{ az: 10, el: 5 }, { az: 90, el: 40 }, { az: 200, el: -20 }]) {
    assert.equal(rf.antennaGainDb({ ...a, tiltDeg: 0, rollDeg: 0 }, b), rf.antennaGainDb(a, b));
    near(rf.antennaGainDb({ ...a, tiltDeg: 30 }, b), rf.antennaGainDb({ ...a, orientation: { az: 0, el: 30 } }, b), 1e-9);
  }
  // a vertical dipole tilted 90 deg lies along the boresight (north): null toward north, full toward east
  const t = { ...a, tiltDeg: 90 };
  assert.ok(rf.antennaGainDb(t, { az: 0, el: 0 }) < -25);
  near(rf.antennaGainDb(t, { az: 90, el: 0 }), 2.15, 1e-6);
});

test('polarisation mismatch hand values: V-V 0, V-slant 2.875 (cos^2 45 with 15 dB floor), V-H 15, circ-linear 3.01', () => {
  near(lossOf(omni({ polarisation: 'vertical' }), omni({ polarisation: 'vertical' })), 0, 1e-9);
  // PLF = 0.5 (1 - X) + X, X = 10^-1.5 = 0.03162 -> 0.51581 -> 2.875 dB
  near(lossOf(omni({ polarisation: 'vertical' }), omni({ polarisation: 'slant45' })), 2.875, 0.01);
  near(lossOf(omni({ polarisation: 'vertical' }), omni({ polarisation: 'horizontal' })), rf.DEFAULT_XPD_DB, 1e-6);
  near(lossOf(omni({ polarisation: 'rhcp' }), omni({ polarisation: 'vertical' })), 3.0103, 1e-3);
  near(lossOf(omni({ polarisation: 'rhcp' }), omni({ polarisation: 'rhcp' })), 0, 1e-9);
  near(lossOf(omni({ polarisation: 'rhcp' }), omni({ polarisation: 'lhcp' })), rf.DEFAULT_CIRCULAR_XPD_DB, 1e-6);
  // one reflection flips handedness
  near(rf.polarisationLossDb(omni({ polarisation: 'rhcp' }), omni({ polarisation: 'rhcp' }), hz, { az: 180, el: 0 }, { reflections: 1 }), rf.DEFAULT_CIRCULAR_XPD_DB, 1e-6);
});

test('roll of the receive antenna: 45 deg = 2.88 dB, 90 deg = floor, 180 deg = 0 (polarisation vectors)', () => {
  const tx = omni({ polarisation: 'vertical' });
  near(lossOf(tx, omni({ polarisation: 'vertical', rollDeg: 45 })), 2.875, 0.01);
  near(lossOf(tx, omni({ polarisation: 'vertical', rollDeg: 90 })), rf.DEFAULT_XPD_DB, 1e-6);
  near(lossOf(tx, omni({ polarisation: 'vertical', rollDeg: 180 })), 0, 1e-9);
  // tilt: a whip tilted 60 deg toward the path projects cos 60 on the vertical: PLF ~ 0.25 -> about 6 dB
  near(lossOf(tx, omni({ polarisation: 'vertical', tiltDeg: 0, orientation: { az: 0, el: 0 }, rollDeg: 60 })), 10 * Math.log10(1 / (0.25 * (1 - 10 ** -1.5) + 10 ** -1.5)), 0.01);
});

test('solveLink: mismatch appears in the waterfall and lowers the level by the same dB; absent field = unchanged', () => {
  const sc = { version: 1, units: { power: 'dBm', length: 'm' }, stage: { width: 12, depth: 8 }, environment: { floor: 'wood', polarisation: 'vertical', model: 'free-space', fadeMarginDb: 0, bodyLossDb: 0 }, reflectors: [], links: [] };
  const mk = (txA, rxA) => ({ id: 'l', name: 'l', kind: 'mic', freqMHz: 600, tx: { id: 't', name: 't', powerDbm: 10, pos: { x: 0, y: 0, z: 1.5 }, antenna: txA }, rx: { id: 'r', name: 'r', pos: { x: 0, y: 10, z: 1.5 }, antenna: rxA, sensitivityDbm: -90, bodyLossDb: 0 }, chain: [] });
  const base = rf.solveLink(sc, mk(omni(), omni()));
  const same = rf.solveLink(sc, mk(omni({ polarisation: 'vertical' }), omni({ polarisation: 'vertical' })));
  assert.equal(same.rxPowerDbm, base.rxPowerDbm);
  assert.ok(!base.waterfall.some((w) => w.label === 'Polarisation mismatch'));
  const bad = rf.solveLink(sc, mk(omni({ polarisation: 'vertical' }), omni({ polarisation: 'horizontal' })));
  near(base.rxPowerDbm - bad.rxPowerDbm, rf.DEFAULT_XPD_DB, 1e-6);
  assert.ok(bad.waterfall.some((w) => w.label === 'Polarisation mismatch'));
  assert.ok(bad.warnings.some((w) => /Polarisation mismatch/.test(w)));
});

test('quarter-wave ground plane: gain -1 / 1 / 3 / 5 dBi replaces gainDbi; free cable warns; no field = library gain', () => {
  assert.deepEqual({ ...GROUND_PLANE_GAIN_DBI }, { none: -1, body: 1, rack: 3, large: 5 });
  for (const [k, g] of Object.entries(GROUND_PLANE_GAIN_DBI)) assert.equal(rf.nominalGainDbi({ type: 'quarterwave', gainDbi: 1, groundPlane: k }), g);
  assert.equal(rf.nominalGainDbi({ type: 'quarterwave', gainDbi: 1 }), 1);
  const sc = { version: 1, units: { power: 'dBm', length: 'm' }, stage: { width: 12, depth: 8 }, environment: { floor: 'wood', polarisation: 'vertical', model: 'free-space', fadeMarginDb: 0, bodyLossDb: 0 }, reflectors: [], links: [] };
  const mk = (gp) => ({ id: 'l', name: 'l', kind: 'mic', freqMHz: 600, tx: { id: 't', name: 't', powerDbm: 10, pos: { x: 0, y: 0, z: 1.5 }, antenna: omni() }, rx: { id: 'r', name: 'r', pos: { x: 0, y: 10, z: 1.5 }, antenna: { type: 'quarterwave', gainDbi: 1, orientation: { az: 0, el: 0 }, ...(gp ? { groundPlane: gp } : {}) }, sensitivityDbm: -90, bodyLossDb: 0 }, chain: [] });
  const r0 = rf.solveLink(sc, mk(null)), rn = rf.solveLink(sc, mk('none')), rl = rf.solveLink(sc, mk('large'));
  near(rl.rxPowerDbm - rn.rxPowerDbm, 6, 1e-6);
  assert.ok(rn.warnings.some((w) => /ground plane/.test(w)));
  assert.ok(!r0.warnings.some((w) => /ground plane/.test(w)));
});

test('scene validation: new antenna fields are range-checked; quarterwave is a valid type', () => {
  const s = createDefaultScene();
  const l = s.links[0];
  assert.equal(validateScene(s).ok, true);
  l.rx.antenna = { ...l.rx.antenna, type: 'quarterwave', tiltDeg: 30, rollDeg: -45, polarisation: 'slant45', groundPlane: 'rack' };
  assert.equal(validateScene(s).ok, true, validateScene(s).errors.join('; '));
  for (const bad of [{ tiltDeg: 91 }, { tiltDeg: NaN }, { rollDeg: 181 }, { polarisation: 'diagonal' }, { groundPlane: 'huge' }]) {
    const t = structuredClone(s); Object.assign(t.links[0].rx.antenna, bad);
    assert.equal(validateScene(t).ok, false, JSON.stringify(bad));
  }
});
