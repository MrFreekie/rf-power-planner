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

// ---- combining modes with correlated and uncorrelated fades (examples diversity-correlated-antennas, diversity-spaced-antennas) ----
import { diversityCombiningReport } from '../js/examples.js';
import { EXAMPLES as EX2 } from '../js/examples.js';
test('correlated antennas (0.1 wavelength): no fade gain from switching or selection, ratio only the 3.01 dB power sum', () => {
  const r = diversityCombiningReport('correlated');
  assert.ok(Math.abs(r.spacingLambda - 0.1) < 0.005);
  assert.ok(Math.abs(r.singleFadeDepthDb - 8.8) < 0.05, `single fade ${r.singleFadeDepthDb}`);
  assert.ok(Math.abs(r.gain1pctDb.switching) < 0.05 && Math.abs(r.gain1pctDb.selection) < 0.05);
  assert.ok(Math.abs(r.gain1pctDb.ratio - 3.01) < 0.05, `ratio ${r.gain1pctDb.ratio}`); // 10 log10 2 = 3.0103 dB for two identical copies
  assert.ok(Math.abs(r.ratioFadeDepthDb - r.singleFadeDepthDb) < 0.05, 'the fade is just as deep');
});
test('spaced antennas (0.8 wavelength): switching < selection < ratio gain at 1 percent, and ratio shrinks the worst fade', () => {
  const r = diversityCombiningReport('spaced');
  assert.ok(Math.abs(r.spacingLambda - 0.81) < 0.01);
  const g = r.gain1pctDb;
  assert.ok(Math.abs(g.switching - 4.9) < 0.05 && Math.abs(g.selection - 6.5) < 0.05 && Math.abs(g.ratio - 8.8) < 0.05, JSON.stringify(g));
  assert.ok(g.switching < g.selection && g.selection < g.ratio);
  assert.ok(Math.abs(r.ratioFadeDepthDb - 4.3) < 0.05, `ratio fade ${r.ratioFadeDepthDb}`);
  assert.ok(Math.abs(r.singleFadeDepthDb - 8.8) < 0.05);
  const a = EX2.find((e) => e.id === 'diversity-correlated-antennas').note, b = EX2.find((e) => e.id === 'diversity-spaced-antennas').note;
  for (const x of ['0.05 m', '0.1 wavelength', '8.8 dB', '0.0 dB', '3.0 dB']) assert.ok(a.includes(x), x);
  for (const x of ['0.4 m', '0.8 wavelength', '4.9 dB', '6.5 dB', '8.8 dB', '4.3 dB', '3 dB']) assert.ok(b.includes(x), x);
  assert.match(a, /^Problem:/); assert.match(b, /^Compare:/);
  for (const n of [a, b]) assert.ok(n.split(/(?<=\.)\s/).length <= 4);
});
