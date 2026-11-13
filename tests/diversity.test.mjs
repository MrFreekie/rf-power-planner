import test from 'node:test';
import assert from 'node:assert/strict';
import { solveDiversity, diversityStep, sweepLink, fadeDepthStats, expectedDiversityGain1pctDb, MIN_SPACING_LAMBDA } from '../js/model/diversity.js';
import { wavelengthM } from '../js/model/rf.js';
import { createDefaultScene } from '../js/model/scene.js';
import { solveLink } from '../js/model/rf.js';

const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} got ${a}, want ${b} +/- ${tol}`);
const SW = { mode: 'switching', hysteresisDb: 3, switchMs: 5, switchThresholdDbm: -Infinity };

test('ratio combining = 10log10(10^(a/10)+10^(b/10))', () => {
  const r = diversityStep(null, -70, -70, { ...SW, mode: 'ratio' });
  near(r.combinedDbm, -70 + 3.0103, 1e-3);
  near(r.gainDb, 3.0103, 1e-3);
  const r2 = diversityStep(null, -60, -80, { ...SW, mode: 'ratio' });
  near(r2.combinedDbm, 10 * Math.log10(1e-6 + 1e-8), 1e-9);
  near(r2.gainDb, 0.0432, 1e-3);
});

test('true diversity: best of A/B, gain 0', () => {
  const r = diversityStep({ active: 'A' }, -80, -70, { ...SW, mode: 'true' });
  assert.equal(r.active, 'B');
  assert.equal(r.switched, true);
  assert.equal(r.combinedDbm, -70);
  assert.equal(r.gainDb, 0);
  assert.equal(diversityStep({ active: 'B' }, -70, -70, { ...SW, mode: 'true' }).switched, false);
});

test('switching: hysteresis and hold-off sequence', () => {
  let s = null;
  s = diversityStep(s, -70, -72, SW, 0);
  assert.equal(s.active, 'A'); assert.equal(s.switched, false);
  s = diversityStep(s, -72, -70, SW, 10); // B only 2 better < 3
  assert.equal(s.active, 'A');
  s = diversityStep(s, -75, -70, SW, 20); // 5 better -> switch to B
  assert.equal(s.active, 'B'); assert.equal(s.switched, true);
  near(s.gainDb, 0, 1e-12);
  assert.equal(s.holdoffMs, 5);
  s = diversityStep(s, -60, -80, SW, 22); // A far better but inside hold-off
  assert.equal(s.active, 'B'); assert.equal(s.switched, false);
  near(s.gainDb, -20, 1e-9);
  near(s.holdoffMs, 3, 1e-9);
  s = diversityStep(s, -60, -80, SW, 25);
  assert.equal(s.active, 'A'); assert.equal(s.switched, true);
  const T = { ...SW, switchThresholdDbm: -90 };
  let t = diversityStep({ active: 'A', lastSwitchMs: -Infinity }, -95, -94, T, 0);
  assert.equal(t.active, 'B');
  t = diversityStep({ active: 'A', lastSwitchMs: -Infinity }, -85, -84, T, 0);
  assert.equal(t.active, 'A');
});

function sceneWithB(bPos) {
  const scene = createDefaultScene();
  const link = scene.links[0];
  link.rx.diversity = { antennaB: { pos: bPos || { ...link.rx.pos }, antenna: { ...link.rx.antenna } } };
  return { scene, link };
}

test('solveDiversity: coincident antennas identical; moved antenna differs', () => {
  const { scene, link } = sceneWithB();
  const { a, b } = solveDiversity(scene, link);
  assert.equal(a.inputPowerDbm, b.inputPowerDbm);
  assert.equal(a.inputPowerDbm, solveLink(scene, link).inputPowerDbm);
  const p = link.rx.pos;
  const m = sceneWithB({ x: p.x - 0.25, y: p.y, z: p.z });
  const before = JSON.stringify(m.link);
  const r = solveDiversity(m.scene, m.link);
  assert.notEqual(r.a.inputPowerDbm, r.b.inputPowerDbm);
  assert.equal(JSON.stringify(m.link), before); // input not mutated
  const s2 = createDefaultScene();
  s2.links[0].rx.diversity.enabled = false;
  const r2 = solveDiversity(s2, s2.links[0]);
  assert.equal(r2.a.inputPowerDbm, r2.b.inputPowerDbm);
});

test('sweepLink symmetric case: gain 0 for switching/true, +3.01 for ratio', () => {
  const { scene, link } = sceneWithB();
  const sw = sweepLink(scene, link.id, { x: 2, y: 2, z: 1.5 }, { x: 8, y: 4, z: 1.5 }, 25);
  assert.equal(sw.s.length, 25);
  near(sw.s[0], 0, 1e-12);
  near(sw.s[24], Math.hypot(6, 2), 1e-9);
  for (let i = 0; i < 25; i++) {
    assert.equal(sw.aDbm[i], sw.bDbm[i]);
    assert.equal(sw.singleBestDbm[i], sw.aDbm[i]);
    near(sw.combinedRatio[i] - sw.singleBestDbm[i], 3.0103, 1e-6);
    assert.equal(sw.activeSwitching[i], 'A');
  }
});

test('sweepLink with spaced antennas: ratio never worse than best, levels decorrelate', () => {
  const base = sceneWithB();
  const p = base.link.rx.pos;
  const { scene, link } = sceneWithB({ x: p.x - 0.3, y: p.y, z: p.z });
  const sw = sweepLink(scene, link.id, { x: 2, y: 1, z: 1.5 }, { x: 9, y: 5, z: 1.5 }, 120);
  let differs = 0;
  for (let i = 0; i < 120; i++) {
    assert.ok(sw.combinedRatio[i] >= sw.singleBestDbm[i] - 1e-9);
    if (Math.abs(sw.aDbm[i] - sw.bDbm[i]) > 0.01) differs++;
  }
  assert.ok(differs > 10, 'A and B levels differ along the sweep');
  assert.deepEqual(sweepLink(scene, 'nope', { x: 0, y: 0 }, { x: 1, y: 1 }, 5).s, []);
});

test('fadeDepthStats hand values', () => {
  const st = fadeDepthStats([-70, -72, -60, -80, -64]);
  assert.equal(st.min, -80);
  assert.equal(st.max, -60);
  assert.equal(st.medianDb, -70);
  assert.equal(st.fadeDepthDb, 10);
  assert.equal(st.count, 5);
  const m = 10 * Math.log10((1e-7 + Math.pow(10, -7.2) + 1e-6 + 1e-8 + Math.pow(10, -6.4)) / 5);
  near(st.meanDbm, m, 1e-9);
  near(fadeDepthStats([-50, -50]).fadeDepthDb, 0, 1e-12);
  assert.equal(fadeDepthStats([]).count, 0);
});

test('spacingWarning below 0.3 lambda; expected 1 percent gain scaled by correlation', () => {
  const lam = wavelengthM(600);
  const p = createDefaultScene().links[0].rx.pos;
  const close = sceneWithB({ x: p.x - 0.2 * lam, y: p.y, z: p.z });
  const r = solveDiversity(close.scene, close.link);
  assert.equal(r.spacingWarning, true);
  near(r.spacingLambda, 0.2, 1e-9);
  const ok = sceneWithB({ x: p.x - 0.5 * lam, y: p.y, z: p.z });
  assert.equal(solveDiversity(ok.scene, ok.link).spacingWarning, false);
  assert.equal(MIN_SPACING_LAMBDA, 0.3);
  const same = sceneWithB();
  assert.equal(solveDiversity(same.scene, same.link).spacingWarning, true);
  // theory: zero spacing no gain; large spacing approaches 10.2 / 11.7 dB; first J0 zero at 0.383 lambda is uncorrelated
  near(expectedDiversityGain1pctDb('true', 0), 0, 1e-6);
  near(expectedDiversityGain1pctDb('true', 0.3827), 10.2, 0.01);
  near(expectedDiversityGain1pctDb('ratio', 0.3827), 11.7, 0.01);
  assert.ok(expectedDiversityGain1pctDb('ratio', 0.1) < expectedDiversityGain1pctDb('ratio', 0.3));
});

test('sweepLink reports mean and 1 percent gains; coincident antennas give 0 and 3.01 mean', () => {
  const { scene, link } = sceneWithB();
  const sw = sweepLink(scene, link.id, { x: 2, y: 2, z: 1.5 }, { x: 8, y: 4, z: 1.5 }, 50);
  near(sw.gainMeanDb.true, 0, 1e-9);
  near(sw.gain1pctDb.true, 0, 1e-9);
  near(sw.gainMeanDb.ratio, 3.0103, 1e-4);
  near(sw.gain1pctDb.ratio, 3.0103, 1e-4);
  assert.equal(sw.spacingWarning, true);
  assert.ok(Number.isFinite(sw.stats.single.p1Db));
  assert.equal(sw.combinedSwitching.length, 50);
  // separated antennas: best-of-two lifts the 1 percent level at least as much as the mean
  const p = link.rx.pos;
  const m = sceneWithB({ x: p.x - 0.25, y: p.y, z: p.z });
  const sw2 = sweepLink(m.scene, m.link.id, { x: 2, y: 1, z: 1.5 }, { x: 9, y: 5, z: 1.5 }, 200);
  assert.ok(sw2.gain1pctDb.true >= 0 && sw2.gain1pctDb.ratio >= sw2.gain1pctDb.true - 1e-9);
});
