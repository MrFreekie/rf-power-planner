import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSMISSION_LOSS_DB, MATERIAL_TRANSMISSION, transmissionLossDb, CROWD_ALLOWANCE_DB, SPLITTER_PRESETS,
  splitterPortLossDb, combSwingDb, coherenceLengthM, cableDelayNsPerM, COVERAGE_PRESETS, COVERAGE_DEFAULTS, requiredLevelDbm
} from '../js/model/zones-params.js';
import { MATERIALS, CABLES } from '../js/model/library.js';

test('every library material has a transmission entry; all frozen', () => {
  for (const id of Object.keys(MATERIALS)) assert.ok(MATERIAL_TRANSMISSION[id], 'missing ' + id);
  assert.ok(Object.isFrozen(MATERIAL_TRANSMISSION) && Object.isFrozen(MATERIAL_TRANSMISSION.brick));
  for (const [id, r] of Object.entries(MATERIAL_TRANSMISSION)) {
    assert.equal(TRANSMISSION_LOSS_DB[id], r.lossDb600);
    assert.ok(r.lossDb600 > 0 && r.refThicknessM > 0 && r.freqExponent >= 0 && r.freqExponent <= 1);
  }
});

test('loss ordering at 600 MHz (reference thickness)', () => {
  const L = TRANSMISSION_LOSS_DB;
  assert.ok(L.glass <= L.wood && L.wood < L.drywall && L.drywall < L.brick && L.brick < L.concrete);
  assert.ok(L.concrete < L['concrete-thick'] && L['concrete-thick'] <= L['concrete-reinforced']);
  assert.ok(L.metal >= 40 && L.metal > L['concrete-reinforced']);
  assert.ok(L['glass-lowe'] > 5 * L.glass);
});

test('frequency and thickness scaling', () => {
  assert.equal(transmissionLossDb('brick', 0.1, 600), 5);
  assert.ok(Math.abs(transmissionLossDb('brick', 0.1, 2400) - 8) < 1e-9, 'library value 8 dB at 2.4 GHz (was 5 x 4^0.7 = 13.2)');
  assert.ok(Math.abs(transmissionLossDb('concrete', 0.1, 5800) - 21) < 1e-9, 'concrete 0.1 m at 5.8 GHz: 21 dB (the old 0.6 power law gave 31)');
  assert.ok(Math.abs(transmissionLossDb('brick', 0.2, 600) - 8.5) < 1e-9);          // 1.5 + 35 x 0.2: affine in thickness
  assert.ok(Math.abs(transmissionLossDb('brick', 0, 600) - 1.5) < 1e-9);            // interface loss only
  assert.ok(transmissionLossDb('brick', 0.05, 600) > 0.5 * transmissionLossDb('brick', 0.1, 600));
  assert.equal(transmissionLossDb('brick'), 5);
  let prev = 0;
  for (const f of [470, 600, 900, 1800, 2400]) { const v = transmissionLossDb('concrete', 0.1, f); assert.ok(v > prev); prev = v; }
  assert.equal(transmissionLossDb('metal', 0.001, 470), transmissionLossDb('metal', 0.001, 2400)); // exponent 0
  assert.equal(transmissionLossDb('nothing', 1, 600), 0);
});

test('crowd allowance is monotonic', () => {
  const v = [CROWD_ALLOWANCE_DB.none, CROWD_ALLOWANCE_DB.sparse, CROWD_ALLOWANCE_DB.dense, CROWD_ALLOWANCE_DB.packed];
  for (let i = 1; i < v.length; i++) assert.ok(v[i] > v[i - 1]);
});

test('splitters: passive loss = 10log10 N + insertion; loss rises with ports; active has gain', () => {
  const p2 = SPLITTER_PRESETS['passive-2way'], p3 = SPLITTER_PRESETS['passive-3way'], p4 = SPLITTER_PRESETS['passive-4way'], p8 = SPLITTER_PRESETS['passive-8way'];
  assert.ok(Math.abs(splitterPortLossDb(p2) - (3.0103 + 0.3)) < 1e-3);
  assert.ok(Math.abs(splitterPortLossDb(p4) - (6.0206 + 0.6)) < 1e-3);
  assert.ok(Math.abs(splitterPortLossDb(p8) - (9.0309 + 1.0)) < 1e-3);
  const l = [p2, p3, p4, p8].map(splitterPortLossDb);
  for (let i = 1; i < l.length; i++) assert.ok(l[i] > l[i - 1]);
  for (let i = 1; i < 4; i++) assert.ok([p2, p3, p4, p8][i].insertionLossDb >= [p2, p3, p4, p8][i - 1].insertionLossDb);
  for (const s of Object.values(SPLITTER_PRESETS)) { assert.ok(s.illustrative && Object.isFrozen(s)); assert.ok(s.isolationDb >= 10); }
  assert.ok(splitterPortLossDb(SPLITTER_PRESETS['active-4way']) < 0);
  assert.ok(SPLITTER_PRESETS['active-4way'].noiseFigureDb > 0);
  // a booster/active path beats a 50 m RG58 branch (21 dB at 600 MHz) by a wide margin
  assert.ok(splitterPortLossDb(p4) < 10 && splitterPortLossDb(SPLITTER_PRESETS['active-4way']) < splitterPortLossDb(p4));
});

test('comb swing between overlapping antennas', () => {
  assert.equal(combSwingDb(0), Infinity);
  assert.ok(Math.abs(combSwingDb(6) - 9.57) < 0.03);
  assert.ok(Math.abs(combSwingDb(10) - 5.68) < 0.03);
  assert.ok(Math.abs(combSwingDb(20) - 1.74) < 0.02);
  assert.ok(combSwingDb(3) > combSwingDb(6) && combSwingDb(6) > combSwingDb(12));
});

test('coherence length and cable delay', () => {
  assert.ok(Math.abs(coherenceLengthM(200e3) - 1498.96) < 0.01);       // km scale for a 200 kHz channel
  assert.ok(Math.abs(coherenceLengthM(20e6) - 14.99) < 0.01);          // only metres for a wideband digital link
  // lmr-400 vf 0.85: 3.92 ns/m, so 10 m of extra cable is ~39 ns, ~ 11.8 m of free space, about 24 wavelengths at 600 MHz
  const d = cableDelayNsPerM(CABLES['lmr-400'].velocityFactor);
  assert.ok(Math.abs(d - 3.924) < 0.01);
  assert.ok(Math.abs(d * 10 * 0.299792458 / 0.4996 - 23.6) < 0.2);
});

test('coverage presets and required level', () => {
  assert.equal(COVERAGE_DEFAULTS, COVERAGE_PRESETS['moving-bodypack']);
  const ids = ['static-performer', 'moving-bodypack', 'critical-wide-stage'];
  let pm = 0, pf = 0;
  for (const id of ids) {
    const p = COVERAGE_PRESETS[id];
    assert.ok(p.illustrative && Object.isFrozen(p));
    assert.ok(p.fadeMarginDb > pm && p.passAreaFraction > pf);
    pm = p.fadeMarginDb; pf = p.passAreaFraction;
    assert.ok(p.passAreaFraction >= 0.9 && p.passAreaFraction <= 1);
  }
  assert.ok(COVERAGE_DEFAULTS.fadeMarginDb >= 10 && COVERAGE_DEFAULTS.fadeMarginDb <= 20);
  // IEM default squelch: sensitivity -85 + 5 = -80 dBm, + 15 dB fade margin = -65 dBm
  assert.equal(requiredLevelDbm(-80), -65);
  assert.equal(requiredLevelDbm(-80, COVERAGE_PRESETS['critical-wide-stage']), -80 + 20 + 6);
});

import { wallTransmissionLossDb } from '../js/model/rf.js';

test('rf.js wall transmission reads the parameter table (reference thickness)', () => {
  assert.ok(Math.abs(wallTransmissionLossDb({ material: 'brick' }, 600) - 5) < 1e-9);
  assert.ok(Math.abs(wallTransmissionLossDb({ material: 'brick' }, 2400) - transmissionLossDb('brick', 0.1, 2400)) < 1e-9);
  assert.equal(wallTransmissionLossDb({ material: 'brick', transmissionLossDb: 7 }, 600), 7);
});

test('interface plus absorption decomposition reproduces the reference loss', () => {
  for (const [id, r] of Object.entries(MATERIAL_TRANSMISSION)) {
    assert.ok(r.interfaceDb >= 0 && r.interfaceDb <= r.lossDb600, id);
    assert.ok(Math.abs(r.interfaceDb + r.absorptionDbPerM * r.refThicknessM - r.lossDb600) < 1e-9, id);
    assert.ok(Math.abs(transmissionLossDb(id, r.refThicknessM, 600) - r.lossDb600) < 1e-9, id);
    assert.ok(transmissionLossDb(id, 2 * r.refThicknessM, 600) > r.lossDb600 - 1e-12);
  }
});
