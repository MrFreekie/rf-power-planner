import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene, createDefaultLink, deserialize, migrateScene, validateScene, serialize } from '../js/model/scene.js';
import { solveLink, solveBranches, fsplDb, antennaGainDb, NEAR_FIELD_M } from '../js/model/rf.js';
import { besselJ, rfSpectrum, audioSpectrum } from '../js/model/spectrum-views.js';
import { esN0Db, berUncoded } from '../js/model/digital.js';
import { coordinateFrequencies } from '../js/model/coordination.js';
import { analyse } from '../js/imdTracker.js';
import { buildExample } from '../js/examples.js';
import { coverageGrid } from '../js/model/coverage.js';

const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} ${a} vs ${b} (tol ${tol})`);

function freeScene(kind = 'mic') {
  const s = createDefaultScene();
  s.environment = { ...s.environment, model: 'free-space', fadeMarginDb: 0, bodyLossDb: 0, externalNoise: 0 };
  s.reflectors = [];
  const l = createDefaultLink(kind);
  s.links = [l];
  return { s, l };
}

test('property: free-space path loss rises monotonically with distance (6.02 dB per doubling) and with frequency', () => {
  let prev = -Infinity;
  for (let d = 0.2; d < 400; d *= 1.3) { const v = fsplDb(d, 600); assert.ok(v > prev); prev = v; }
  near(fsplDb(20, 600) - fsplDb(10, 600), 6.0206, 1e-3);
  near(fsplDb(10, 1200) - fsplDb(10, 600), 6.0206, 1e-3);
  // hand value: FSPL(10 m, 600 MHz) = 20 log10(4 pi 10 / 0.49965) = 48.0 dB (tol 0.05)
  near(fsplDb(10, 600), 48.0, 0.05);
});

test('property: solved link in free space is monotonic in distance and reciprocal for omni antennas', () => {
  const { s, l } = freeScene('mic');
  l.tx.antenna = { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 0 } };
  l.rx.antenna = { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 0 } };
  let prev = Infinity;
  for (const d of [1, 2, 4, 8, 16]) {
    l.tx.pos = { x: 1, y: 1, z: 1.5 }; l.rx.pos = { x: 1 + d, y: 1, z: 1.5 };
    const r = solveLink(s, l);
    assert.ok(r.rxPowerDbm < prev); prev = r.rxPowerDbm;
  }
  l.tx.pos = { x: 1, y: 1, z: 1.5 }; l.rx.pos = { x: 6, y: 3, z: 1.2 };
  const a = solveLink(s, l).pathLossDb;
  const t = l.tx.pos; l.tx.pos = l.rx.pos; l.rx.pos = t;
  near(solveLink(s, l).pathLossDb, a, 1e-9, 'reciprocity');
});

test('near field: distances under 0.1 m are flagged, FSPL is held at its 0.1 m value, no NaN at zero distance', () => {
  assert.equal(NEAR_FIELD_M, 0.1);
  assert.equal(fsplDb(0, 600), fsplDb(0.1, 600));
  assert.equal(fsplDb(0.01, 600), fsplDb(0.1, 600));
  const { s, l } = freeScene('mic');
  l.tx.pos = { x: 3, y: 3, z: 1.5 }; l.rx.pos = { x: 3, y: 3.05, z: 1.5 };
  const r = solveLink(s, l);
  assert.equal(r.nearField, true);
  assert.ok(r.warnings.some((w) => /near field/.test(w)));
  assert.ok(Number.isFinite(r.rxPowerDbm) && Number.isFinite(r.marginDb));
  l.rx.pos = { x: 3, y: 3, z: 1.5 };
  assert.ok(Number.isFinite(solveLink(s, l).rxPowerDbm));
  l.rx.pos = { x: 8, y: 3, z: 1.5 };
  assert.equal(solveLink(s, l).nearField, false);
  assert.deepEqual(solveLink(s, l).warnings, []);
});

test('body antenna plus a body loss setting warns about double counting', () => {
  const { s, l } = freeScene('mic');
  l.rx.antenna = { type: 'body', gainDbi: -3, orientation: { az: 0, el: 0 } };
  assert.deepEqual(solveLink(s, l).warnings, []);
  s.environment.bodyLossDb = 3;
  assert.ok(solveLink(s, l).warnings.some((w) => /twice/.test(w)));
});

test('antennaGainDb never returns NaN for a bad bearing; pattern floors follow the documented policy', () => {
  const ant = { type: 'dipole', gainDbi: 2.15, orientation: { az: 0, el: 0 } };
  for (const b of [{ az: NaN, el: 0 }, { az: 0, el: NaN }, undefined, null, { az: Infinity, el: 0 }]) assert.equal(antennaGainDb(ant, b), 2.15);
  const dip = antennaGainDb({ type: 'dipole', gainDbi: 0, orientation: { az: 0, el: 90 } }, { az: 0, el: 90 });
  assert.ok(dip >= -30 - 1e-9);
  const pad = antennaGainDb({ type: 'paddle', gainDbi: 0, orientation: { az: 0, el: 0 } }, { az: 180, el: 0 });
  assert.ok(pad >= -25 - 1e-9 && pad < -10, String(pad)); // table pattern: -18 dB behind
});

test('IEM branch coherent sum includes the bodypack rx chain loss (coherent equals the solved level for one branch)', () => {
  const { s, l } = freeScene('iem');
  delete l.branches;
  l.rx.chain = [{ id: 'c1', kind: 'cable', cableType: 'rg58', lengthM: 10 }];
  const pt = { x: 6, y: 4, z: 1.5 };
  const r = solveBranches(s, l, pt, { mode: 'coherent' });
  near(r.coherentDbm, r.perBranchDbm[0], 0.05);
  const noChain = structuredClone(l); noChain.rx.chain = [];
  assert.ok(solveBranches(s, noChain, pt).coherentDbm > r.coherentDbm + 1);
});

test('Bessel: stable for large arguments, sum of squares is 1, known values', () => {
  near(besselJ(0, 60), -0.0914718, 1e-6);
  near(besselJ(1, 60), 0.0465984, 1e-6);
  near(besselJ(3, -20), 0.0989014, 1e-6);
  assert.ok(Number.isNaN(besselJ(0, NaN)));
  for (const beta of [0.5, 5, 30, 60, 150]) {
    let sum = 0;
    for (let k = -Math.ceil(beta + 40); k <= Math.ceil(beta + 40); k++) sum += besselJ(k, beta) ** 2;
    near(sum, 1, 1e-6, 'beta ' + beta);
  }
  const r = rfSpectrum({ carrierMHz: 600, rxLevelDbm: -50, devKhz: 5000, audioMaxKhz: 15, noiseFloorDbm: -100 });
  assert.ok(r.levelsDbm.every(Number.isFinite));
});

test('digital: esN0Db with no config uses the defaults (no NaN)', () => {
  assert.ok(Number.isFinite(esN0Db(20)));
  near(esN0Db(20, { symbolRateKSps: 100, noiseBwKHz: 200 }), 20 + 10 * Math.log10(2), 1e-9);
  assert.ok(Number.isFinite(esN0Db(20, { symbolRateKSps: undefined, noiseBwKHz: undefined })));
  assert.equal(berUncoded(4, Infinity), 0);
});

test('spectrum views stay finite with extreme inputs', () => {
  for (const o of [{ nBins: 1 }, { nBins: 1e7 }, { fMaxHz: 0 }, { t: -5 }, { t: 1e9 }]) {
    const a = audioSpectrum({ kind: 'iem', stereo: true, ...o });
    assert.ok(a.levelsDb.every(Number.isFinite) && a.levelsDb.length <= 8192);
  }
  const r = rfSpectrum({ carrierMHz: 600, rxLevelDbm: -Infinity, noiseFloorDbm: -100 });
  assert.ok(r.levelsDbm.every(Number.isFinite));
});

test('migration: old-shape scenes (no version, missing newer fields) open at the current version with no venue', () => {
  const base = createDefaultScene();
  const old = JSON.parse(JSON.stringify(base));
  delete old.imd; delete old.platforms; delete old.zones; delete old.coverage; delete old.stage.heightM; delete old.version;
  for (const l of old.links) { delete l.rx.squelch; delete l.interferer; delete l.telemetry; delete l.modulation; delete l.mpx; delete l.audio; delete l.rx.rxPreset; delete l.rx.overload; }
  const m = deserialize(JSON.stringify(old));
  assert.equal(m.version, 2);
  assert.equal(m.venue, undefined);
  assert.deepEqual(validateScene(m), { ok: true, errors: [] });
  const v1 = { ...JSON.parse(JSON.stringify(base)), version: 1 };
  assert.equal(migrateScene(v1).version, 2);
  assert.deepEqual(deserialize(serialize(m)), m);
  assert.throws(() => deserialize(JSON.stringify({ ...base, version: 3 })), /newer/);
});

test('performance: worst-case timings stay interactive (loose bounds)', () => {
  const t = (fn) => { const a = performance.now(); fn(); return performance.now() - a; };
  const dc = t(() => coordinateFrequencies({ regionId: 'uk', mics: 20, seed: 1 }));
  assert.ok(dc < 10000, `coordination ${dc.toFixed(0)} ms`);
  const di = t(() => analyse(buildExample('imd-plan-bad').scene));
  assert.ok(di < 3000, `imd analyse ${di.toFixed(0)} ms`);
  const { s, l } = freeScene('mic');
  s.stage = { width: 60, depth: 40, heightM: 0 };
  const dg = t(() => coverageGrid(s, l.id, { cellM: 0.5 }));
  assert.ok(dg < 10000, `coverage ${dg.toFixed(0)} ms`);
});
