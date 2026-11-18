// The library lobe tables and the rf.js analytic directional constants describe the same antenna types and must agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ANTENNAS, antennaPatternDb } from '../js/model/library.js';
import { FRONT_TO_BACK_DB, DIRECTIONAL_HPBW_DEG, antennaGainDb } from '../js/model/rf.js';

const near = (a, b, t, msg) => assert.ok(Math.abs(a - b) <= t, `${msg}: got ${a}, expected ${b}`);

// Library types with a directional (lobe) pattern: everything with a rear null deeper than 3 dB except the cardioid and body classes.
const DIRECTIONAL = ['paddle', 'logperiodic', 'helical', 'helical-cp', 'yagi'];

test('every directional library type has analytic front-to-back and beamwidth entries', () => {
  for (const id of DIRECTIONAL) {
    assert.ok(ANTENNAS[id], id);
    assert.ok(Number.isFinite(FRONT_TO_BACK_DB[id]), `FRONT_TO_BACK_DB.${id}`);
    assert.ok(Number.isFinite(DIRECTIONAL_HPBW_DEG[id]), `DIRECTIONAL_HPBW_DEG.${id}`);
  }
});

test('library rear level equals the analytic front-to-back figure', () => {
  for (const id of DIRECTIONAL) near(-antennaPatternDb(id, 180, 0), FRONT_TO_BACK_DB[id], 1e-9, id);
});

test('library azimuth -3 dB point sits at half the analytic beamwidth', () => {
  for (const id of DIRECTIONAL) near(antennaPatternDb(id, DIRECTIONAL_HPBW_DEG[id] / 2, 0), -3, 0.05, id);
});

test('analytic and table patterns give the same gain at boresight, half beamwidth and behind', () => {
  for (const id of DIRECTIONAL) {
    const table = { type: id, gainDbi: 0, orientation: { az: 0, el: 0 } };
    const analytic = { ...table, patternOverride: id };
    for (const az of [0, DIRECTIONAL_HPBW_DEG[id] / 2, 180]) {
      near(antennaGainDb(analytic, { az, el: 0 }), antennaGainDb(table, { az, el: 0 }), 0.05, `${id} az ${az}`);
    }
  }
});

test('datasheet-family values: paddle, log-periodic, helical', () => {
  assert.equal(ANTENNAS.paddle.gainDbi, 6.5);
  assert.equal(ANTENNAS.logperiodic.gainDbi, 7);
  assert.equal(ANTENNAS['helical-cp'].gainDbi, 9);
  assert.equal(ANTENNAS.helical.gainDbi, 5); // compact generic helical, id unchanged for saved scenes
  assert.match(ANTENNAS.helical.name, /compact/i);
});
