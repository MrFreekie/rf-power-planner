// Group (b): antenna contact and dampness options (assumed values), replacing, not double-counting, body loss.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as rf from '../js/model/rf.js';
import { createDefaultScene, validateScene } from '../js/model/scene.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);
const omni = (x = {}) => ({ type: 'omni', gainDbi: 0, orientation: { az: 0, el: 0 }, ...x });
const body = (x = {}) => ({ type: 'body', gainDbi: -3, orientation: { az: 0, el: 90 }, ...x });
const sc = (bodyLossDb = 0) => ({ version: 1, units: { power: 'dBm', length: 'm' }, stage: { width: 12, depth: 8 }, environment: { floor: 'wood', polarisation: 'vertical', model: 'free-space', fadeMarginDb: 0, bodyLossDb }, reflectors: [], links: [] });
const mk = (txA, rxA, rxBody = 0) => ({ id: 'l', name: 'l', kind: 'mic', freqMHz: 600, tx: { id: 't', name: 't', powerDbm: 10, pos: { x: 0, y: 0, z: 1.5 }, antenna: txA }, rx: { id: 'r', name: 'r', pos: { x: 0, y: 10, z: 1.5 }, antenna: rxA, sensitivityDbm: -90, bodyLossDb: rxBody }, chain: [] });

test('table values (assumed): 0 / 2.5 / 6 / 8 dB contact, 0 / 1 / 3 dB dampness', () => {
  assert.deepEqual({ ...rf.ANTENNA_CONTACT_LOSS_DB }, { free: 0, clothing: 2.5, skin: 6, cupped: 8 });
  assert.deepEqual({ ...rf.ANTENNA_DAMPNESS_LOSS_DB }, { dry: 0, damp: 1, wet: 3 });
});

test('no contact/dampness field: identical to before (body loss added as always)', () => {
  const a = rf.solveLink(sc(3), mk(body(), omni()));
  const b = rf.solveLink(sc(3), mk(body(), omni()));
  assert.equal(a.rxPowerDbm, b.rxPowerDbm);
  assert.deepEqual(rf.bodyCouplingLossDb({ bodyLossDb: 3 }, body(), { bodyLossDb: 1, antenna: omni() }), { bodyDb: 4, contactDb: 0, dampnessDb: 0, totalDb: 4, replaced: false });
});

test('contact on a body antenna replaces the scene body loss (counted once); on other antennas it adds', () => {
  const base = rf.solveLink(sc(0), mk(body(), omni()));
  const withBody = rf.solveLink(sc(5), mk(body({ contact: 'skin' }), omni()));
  near(base.rxPowerDbm - withBody.rxPowerDbm, 6, 1e-9, 'skin 6 dB only, the 5 dB scene body loss is replaced');
  assert.ok(withBody.waterfall.some((w) => /Antenna contact/.test(w.label)));
  assert.ok(!withBody.waterfall.some((w) => w.label === 'Body loss'));
  assert.ok(withBody.warnings.some((w) => /replaces the scene body loss/.test(w)));
  const free = rf.solveLink(sc(5), mk(body({ contact: 'free' }), omni()));
  near(base.rxPowerDbm - free.rxPowerDbm, 0, 1e-9, 'explicit free replaces too');
  // non-body antenna: contact adds on top of the scene body loss
  const add = rf.solveLink(sc(5), mk(omni({ contact: 'clothing' }), omni()));
  near(rf.solveLink(sc(0), mk(omni(), omni())).rxPowerDbm - add.rxPowerDbm, 7.5, 1e-9);
});

test('dampness adds without replacing body loss; contact and dampness add together', () => {
  const r0 = rf.solveLink(sc(2), mk(body(), omni()));
  const r1 = rf.solveLink(sc(2), mk(body({ dampness: 'wet' }), omni()));
  near(r0.rxPowerDbm - r1.rxPowerDbm, 3, 1e-9);
  const r2 = rf.solveLink(sc(2), mk(body({ contact: 'cupped', dampness: 'damp' }), omni()));
  near(rf.solveLink(sc(0), mk(body(), omni())).rxPowerDbm - r2.rxPowerDbm, 9, 1e-9);
});

test('branch coherent sum uses the same coupling loss as solveLink', () => {
  const s = sc(0);
  const link = { ...mk(omni({ contact: 'skin' }), omni()), kind: 'iem' };
  const single = rf.solveLink(s, link);
  const res = rf.solveBranches(s, link, { x: 0, y: 10, z: 1.5 }, { mode: 'power' });
  near(res.combinedDbm, single.inputPowerDbm, 1e-6);
});

test('scene validation: contact and dampness ids', () => {
  const s = createDefaultScene();
  s.links[0].rx.antenna = { ...s.links[0].rx.antenna, contact: 'skin', dampness: 'wet' };
  assert.equal(validateScene(s).ok, true, validateScene(s).errors.join(';'));
  for (const bad of [{ contact: 'glued' }, { dampness: 'soaked' }, { contact: 7 }]) {
    const t = structuredClone(s); Object.assign(t.links[0].rx.antenna, bad);
    assert.equal(validateScene(t).ok, false, JSON.stringify(bad));
  }
});
