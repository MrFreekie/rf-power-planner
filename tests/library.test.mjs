import test from 'node:test';
import assert from 'node:assert/strict';
import { CABLES, ANTENNAS, SURFACES, MATERIALS, BANDS, REAL_SIZES, antennaPatternDb } from '../js/model/library.js';

test('cable attenuation is monotonic increasing with frequency', () => {
  for (const [id, c] of Object.entries(CABLES)) {
    const t = c.attenDbPer100m;
    assert.ok(t.length >= 7, id);
    for (let i = 1; i < t.length; i++) {
      assert.ok(t[i][0] > t[i - 1][0], `${id} freq order`);
      assert.ok(t[i][1] > t[i - 1][1], `${id} atten at ${t[i][0]}`);
    }
    assert.ok(c.velocityFactor > 0.5 && c.velocityFactor < 1, id);
  }
});

test('cable ranking sanity at 900 MHz: LMR-600 < LMR-400 < RG213 < RG58 < RG174', () => {
  const at = (id) => CABLES[id].attenDbPer100m.find(p => p[0] === 900)[1];
  assert.ok(at('lmr-600') < at('lmr-400'));
  assert.ok(at('lmr-400') < at('rg213'));
  assert.ok(at('rg213') < at('rg58'));
  assert.ok(at('rg58') < at('rg174'));
});

test('required keys present', () => {
  for (const k of ['rg58', 'rg213', 'rg174', 'lmr-195', 'lmr-240', 'lmr-400', 'lmr-600', 'belden-9913', 'belden-8214']) assert.ok(CABLES[k], k);
  for (const k of ['dipole', 'paddle', 'helical', 'cardioid', 'omni', 'logperiodic', 'body', 'custom']) assert.ok(ANTENNAS[k], k);
  for (const k of ['wood', 'concrete', 'grass', 'carpet', 'glass', 'metal']) assert.ok(SURFACES[k], k);
  for (const k of ['wood', 'concrete', 'glass', 'metal', 'drywall', 'drapes']) assert.ok(MATERIALS[k], k);
  for (const m of [...Object.values(SURFACES), ...Object.values(MATERIALS)]) {
    assert.ok(m.epsR >= 1 && m.sigma >= 0);
  }
  assert.ok(BANDS.some(b => b.fromMHz === 823 && b.toMHz === 832));
  assert.ok(BANDS.some(b => b.fromMHz === 863 && b.toMHz === 865));
  assert.ok(BANDS.every(b => b.toMHz > b.fromMHz && b.id && b.name));
  for (const [k, v] of Object.entries({ mic: 0.25, handheldMicLength: 0.25, paddle: 0.30, dipole: 0.30, helical: 0.15, person: 1.75, bodypack: 0.10, receiver: 0.48, stand: 2.0 })) {
    assert.equal(REAL_SIZES[k], v);
  }
  for (const a of Object.values(ANTENNAS)) {
    assert.equal(a.pattern.azDb.length, 361);
    assert.equal(a.pattern.elDb.length, 361);
  }
});

test('pattern is 0 dB at boresight and never positive', () => {
  for (const id of Object.keys(ANTENNAS)) {
    assert.equal(antennaPatternDb(id, 0, 0), 0, id);
    for (let az = -180; az <= 180; az += 15) for (let el = -90; el <= 90; el += 15) {
      assert.ok(antennaPatternDb(id, az, el) <= 0, `${id} ${az},${el}`);
    }
  }
});

test('directional antennas have front-to-back ratio and -3 dB near half beamwidth', () => {
  assert.ok(antennaPatternDb('paddle', 180, 0) <= -15);
  assert.ok(antennaPatternDb('logperiodic', 180, 0) <= -15);
  assert.ok(Math.abs(antennaPatternDb('paddle', 37.5, 0) + 3) < 0.1);
  assert.ok(antennaPatternDb('cardioid', 180, 0) <= -20);
  // dipole: omni in azimuth, null along its axis (elevation offset 90)
  assert.equal(antennaPatternDb('dipole', 120, 0), 0);
  assert.ok(antennaPatternDb('dipole', 0, 90) <= -30);
  assert.ok(antennaPatternDb('body', 180, 0) < antennaPatternDb('body', 90, 0));
  assert.equal(antennaPatternDb('unknown-id', 50, 20), 0);
});
