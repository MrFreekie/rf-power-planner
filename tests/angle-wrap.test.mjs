import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapAngle } from '../js/ui/angleWrap.js';

test('azimuth 0..360: negative and large angles fold in', () => {
  assert.equal(wrapAngle(-90, 360, 0, 360), 270);
  assert.equal(wrapAngle(-450, 360, 0, 360), 270);
  assert.equal(wrapAngle(450, 360, 0, 360), 90);
  assert.equal(wrapAngle(360, 360, 0, 360), 360);
  assert.equal(wrapAngle(0, 360, 0, 360), 0);
});
test('signed -180..180 fields fold 270 to -90', () => {
  assert.equal(wrapAngle(270, 360, -180, 180), -90);
  assert.equal(wrapAngle(-270, 360, -180, 180), 90);
  assert.equal(wrapAngle(180, 360, -180, 180), 180);
});
test('no period, or a non-number, passes through', () => {
  assert.equal(wrapAngle(-90, 0, 0, 360), -90);
  assert.ok(Number.isNaN(wrapAngle(NaN, 360, 0, 360)));
});

import { createStore } from '../js/store.js';
import { buildExample } from '../js/examples.js';
import { setAntennaType } from '../js/actions.js';

test('switching an antenna to a paddle aims it level (elevation 0)', () => {
  const store = createStore(buildExample('band-four-piece-people').scene);
  const l = store.getScene().links[0];
  setAntennaType(store, l.id, 'rx', 'omni');
  const o = store.getScene().links[0].rx.antenna.orientation;
  store.update((d) => { d.links[0].rx.antenna.orientation = { az: 40, el: 90 }; });
  setAntennaType(store, l.id, 'rx', 'paddle');
  assert.deepEqual(store.getScene().links[0].rx.antenna.orientation, { az: 40, el: 0 });
  assert.ok(o);
});

import { migrateScene } from '../js/model/scene.js';
import { setAntennaPitch } from '../js/actions.js';

test('old tilt folds into elevation on load; omni-type tilt stays as lean', () => {
  const raw = structuredClone(buildExample('band-four-piece-people').scene);
  raw.links[0].rx.antenna = { type: 'paddle', gainDbi: 2, orientation: { az: 90, el: 10 }, tiltDeg: 25 };
  raw.links[0].tx.antenna = { type: 'dipole', gainDbi: 2, orientation: { az: 0, el: 90 }, tiltDeg: 30 };
  const s = migrateScene(raw);
  assert.deepEqual(s.links[0].rx.antenna.orientation, { az: 90, el: 35 });
  assert.equal('tiltDeg' in s.links[0].rx.antenna, false);
  assert.equal(s.links[0].tx.antenna.tiltDeg, 30);
});

test('setAntennaPitch edits elevation for a paddle and lean for an omni', () => {
  const store = createStore(buildExample('band-four-piece-people').scene);
  const id = store.getScene().links[0].id;
  store.update((d) => { d.links[0].rx.antenna = { type: 'paddle', gainDbi: 2, orientation: { az: 90, el: 0 } }; d.links[0].tx.antenna = { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 } }; });
  setAntennaPitch(store, id, 'rx', 20);
  assert.equal(store.getScene().links[0].rx.antenna.orientation.el, 20);
  setAntennaPitch(store, id, 'tx', 15);
  assert.equal(store.getScene().links[0].tx.antenna.tiltDeg, 15);
  assert.equal(store.getScene().links[0].tx.antenna.orientation.el, 90);
});
