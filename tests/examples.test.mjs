import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene, createDefaultLink, validateScene, migrateScene } from '../js/model/scene.js';
import { solveLink } from '../js/model/rf.js';
import { EXAMPLES, buildExample, getExample } from '../js/examples.js';
import { loadExample, setLinkKind } from '../js/actions.js';
import { createSquelchTracker } from '../js/squelchTracker.js';
import { createRxTracker } from '../js/rxTracker.js';
import { createMpxTracker } from '../js/mpxTracker.js';
import { createHistory } from '../js/history.js';
import { stopWalk, isWalking } from '../js/walk.js';

function rig(scene) {
  const st = createStore(scene);
  const sq = createSquelchTracker();
  const rx = createRxTracker();
  const mp = createMpxTracker();
  rx.install(sq); mp.install(sq);
  sq.attach(st);
  return { st, sq, rx, mp };
}

test('rx defaults: preset, overload overrides, diversity antenna B 0.6 m from A', () => {
  const mic = createDefaultLink('mic');
  assert.equal(mic.rx.rxPreset, 'mic-receiver-typical');
  assert.equal(createDefaultLink('iem').rx.rxPreset, 'iem-bodypack-typical');
  assert.deepEqual(mic.rx.overload, {});
  const d = mic.rx.diversity;
  assert.equal(d.enabled, false);
  assert.equal(d.mode, 'switching');
  assert.equal(d.hysteresisDb, 3);
  assert.equal(d.switchMs, 30);
  assert.equal(d.antennaB.antenna.type, mic.rx.antenna.type);
  assert.ok(Math.abs(Math.hypot(d.antennaB.pos.x - mic.rx.pos.x, d.antennaB.pos.y - mic.rx.pos.y, d.antennaB.pos.z - mic.rx.pos.z) - 0.6) < 1e-9);
});

test('rx migration back-fills and validation rejects bad values', () => {
  const s = createDefaultScene();
  delete s.links[0].rx.rxPreset; delete s.links[0].rx.overload; delete s.links[0].rx.diversity;
  assert.equal(validateScene(s).ok, true);
  const m = migrateScene(s);
  assert.equal(m.links[0].rx.rxPreset, 'mic-receiver-typical');
  assert.equal(m.links[0].rx.diversity.enabled, false);
  assert.equal(validateScene(m).ok, true);
  m.links[0].rx.rxPreset = 'nope';
  assert.equal(validateScene(m).ok, false);
  m.links[0].rx.rxPreset = 'budget-receiver';
  m.links[0].rx.overload = { maxInputDbm: 'x' };
  assert.equal(validateScene(m).ok, false);
  m.links[0].rx.overload = { maxInputDbm: -12, p1dBDbm: -20 };
  m.links[0].rx.diversity.mode = 'bogus';
  assert.equal(validateScene(m).ok, false);
});

test('every example validates, solves, and has a title and note', () => {
  assert.ok(EXAMPLES.length >= 9);
  const ids = new Set();
  for (const e of EXAMPLES) {
    assert.ok(!ids.has(e.id)); ids.add(e.id);
    const ex = buildExample(e.id);
    assert.ok(ex.title && ex.note.split('. ').length <= 4, e.id);
    assert.deepEqual(validateScene(ex.scene), { ok: true, errors: [] }, e.id);
    const link = ex.scene.links[0];
    const r = solveLink(ex.scene, link);
    assert.ok(Number.isFinite(r.inputPowerDbm), e.id);
    assert.ok(Object.keys(ex.scene.links[0]).length > 0);
    if (ex.walk) assert.ok(ex.walk.speedMps > 0);
  }
  assert.equal(getExample('nope'), null);
  assert.equal(buildExample('nope'), null);
});

test('overload examples: held at the antenna overloads, pad and distance does not', () => {
  const a = rig(buildExample('overload-at-antenna').scene);
  const idA = a.st.getScene().links[0].id;
  assert.equal(a.rx.get(idA).overload.level, 'overload');
  assert.ok(a.rx.get(idA).overload.headroomDb < 0);
  const b = rig(buildExample('overload-fix').scene);
  const idB = b.st.getScene().links[0].id;
  assert.equal(b.rx.get(idB).overload.level, 'ok');
  assert.ok(b.rx.get(idB).overload.headroomDb > 10);
});

test('dropout example: squelch closes in the null; diversity example keeps it open', () => {
  const walkOver = (id, mode) => {
    const ex = buildExample(id);
    const { st, sq } = rig(ex.scene);
    const lid = ex.scene.links[0].id;
    if (mode) st.update((d) => { d.links[0].rx.diversity.mode = mode; });
    const from = { ...ex.scene.links[0].tx.pos };
    const seen = new Set();
    for (let i = 0; i <= 40; i++) {
      const x = from.x + (ex.walk.to.x - from.x) * (i / 40);
      st.update((d) => { d.links[0].tx.pos = { ...from, x }; });
      seen.add(sq.get(lid).open);
    }
    return seen;
  };
  assert.ok(walkOver('dropout-two-ray').has(false));
  assert.equal(walkOver('diversity-null').has(false), false);
});

test('diversity state, switching and history fields', () => {
  const ex = buildExample('diversity-null');
  const { st, sq, rx } = rig(ex.scene);
  const id = ex.scene.links[0].id;
  const d0 = rx.get(id).diversity;
  assert.ok(d0 && ['A', 'B'].includes(d0.active));
  assert.ok(d0.combinedDbm >= Math.max(d0.aDbm, d0.bDbm) - 1e-9);
  const h = createHistory({ now: () => 5 });
  h.sampleOnce(st, sq, 5);
  const s = h.get(id, 10)[0];
  for (const k of ['aDbm', 'bDbm', 'active', 'switched', 'overloadLevel', 'compressionDb', 'distortionPct', 'batteryPercent', 'txPowerSagDb']) assert.ok(k in s, k);
  assert.equal(s.overloadLevel, 'ok');
  // without diversity, bDbm is NaN and active is A
  const plain = rig(createDefaultScene());
  const h2 = createHistory({ now: () => 5 });
  h2.sampleOnce(plain.st, plain.sq, 5);
  const p = h2.get(plain.st.getScene().links[0].id, 10)[0];
  assert.ok(Number.isNaN(p.bDbm));
  assert.equal(p.active, 'A');
});

test('rx tracker notifies only on change', () => {
  const { st, rx } = rig(createDefaultScene());
  let n = 0;
  rx.subscribe(() => n++);
  st.update((d) => { d.links[0].tx.powerDbm = 5; });
  assert.equal(n, 1);
  st.update((d) => { d.links[0].name = 'x'; });
  assert.equal(n, 1);
});

test('loadExample replaces the scene, selects and optionally walks', () => {
  const st = createStore(createDefaultScene());
  const ex = loadExample(st, 'dropout-two-ray', { walk: false });
  assert.equal(ex.id, 'dropout-two-ray');
  assert.equal(st.getScene().environment.floor, 'concrete');
  assert.equal(st.getSelection(), st.getScene().links[0].tx.id);
  assert.equal(isWalking(), false);
  assert.equal(loadExample(st, 'nope'), null);
  loadExample(st, 'reflective-wall');
  assert.equal(isWalking(), true);
  assert.equal(st.getScene().reflectors.length, 1);
  stopWalk();
  setLinkKind(st, st.getScene().links[0].id, 'iem');
  assert.equal(validateScene(st.getScene()).ok, true);
});

// ---- every number quoted in an example note is checked against the real solvers ----------------------------------

import { analyse } from '../js/imdTracker.js';
import { coverageGrid, zoneStats, zoneRequirement } from '../js/model/coverage.js';
import { productFrequencies, frontEndImd, txReverseImd, pimImd, noiseFloor } from '../js/model/imd.js';

function walkLevels(ex, steps) {
  const l = ex.scene.links[0];
  const from = { ...l.tx.pos };
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    l.tx.pos = { x: from.x + (ex.walk.to.x - from.x) * f, y: from.y + (ex.walk.to.y - from.y) * f, z: from.z };
    out.push({ s: f * Math.hypot(ex.walk.to.x - from.x, ex.walk.to.y - from.y), x: l.tx.pos.x, level: solveLink(ex.scene, l).inputPowerDbm });
  }
  return out;
}

test('note check: dropout-two-ray dips about 9 dB below the direct ray at about 7 m', () => {
  const ex = buildExample('dropout-two-ray');
  const l = ex.scene.links[0];
  const w = walkLevels(ex, 800);
  const dip = w.reduce((a, b) => (b.level < a.level ? b : a));
  const fs = structuredClone(ex.scene);
  fs.environment.model = 'free-space';
  fs.links[0].tx.pos = { ...l.tx.pos, x: dip.x };
  const direct = solveLink(fs, fs.links[0]).inputPowerDbm;
  assert.ok(Math.abs(direct - dip.level - 9) < 1, 'depth ' + (direct - dip.level));
  assert.ok(Math.abs((l.rx.pos.x - dip.x) - 6.8) < 0.3);
});

test('note check: long-cable run costs 42.5 dB and leaves about 5 dB margin', () => {
  const ex = buildExample('long-cable');
  const r = solveLink(ex.scene, ex.scene.links[0]);
  const cable = r.waterfall.find((w) => w.label.startsWith('Cable'));
  assert.ok(Math.abs(cable.deltaDb + 42.5) < 0.1, String(cable.deltaDb));
  assert.ok(Math.abs(r.marginDb - 5.3) < 0.3);
  assert.equal(r.status, 'marginal');
});

test('note check: reflective-wall dips are metres apart (about 2.5 m), not a quarter wavelength', () => {
  const ex = buildExample('reflective-wall');
  const w = walkLevels(ex, 600);
  const dips = [];
  for (let i = 2; i < w.length - 2; i++) {
    const v = w[i].level;
    if (v < w[i - 1].level && v < w[i + 1].level && v < w[i - 2].level && v < w[i + 2].level && v < -45) dips.push(w[i].s);
  }
  assert.ok(dips.length >= 3, 'dips ' + dips.join(','));
  const gaps = dips.slice(1).map((d, i) => d - dips[i]);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  assert.ok(mean > 1.5 && mean < 3.5, 'mean gap ' + mean);
  assert.ok(Math.min(...gaps) > 0.5, 'every gap exceeds one wavelength');
});

test('note check: zones-long-hall needs the 24 dB booster; 20 dB leaves about a third failing', () => {
  const pass = (gain) => {
    const ex = buildExample('zones-long-hall');
    const l = ex.scene.links[0];
    l.branches[1].chain.find((c) => c.kind === 'booster').gainDb = gain;
    const g = coverageGrid(ex.scene, l.id, { cellM: 0.25, mode: ex.scene.coverage.mode, rxHeight: l.rx.pos.z });
    const rq = zoneRequirement(ex.scene, l, ex.scene.zones[0]);
    return zoneStats(g, ex.scene.zones[0], rq.squelchThresholdDbm, rq.appliedMarginDb);
  };
  assert.equal(buildExample('zones-long-hall').scene.links[0].branches[1].chain.find((c) => c.kind === 'booster').gainDb, 24);
  const s24 = pass(24), s20 = pass(20);
  assert.equal(s24.pass, true);
  assert.ok(s20.passFraction > 0.6 && s20.passFraction < 0.72, String(s20.passFraction));
  assert.equal(s20.pass, false);
});

test('note check: imd-pim connector grades differ by 35 dB in the product but not in the noise rise', () => {
  const run = (grade) => {
    const ex = buildExample('imd-pim');
    ex.scene.imd.pim.preset = grade;
    const W = 604.0;
    const ch = noiseFloor(ex.scene).perChannel.find((c) => Math.abs(c.freqMHz - W) < 0.1);
    const at = (arr) => Math.max(...arr.filter((p) => Math.abs(p.fMHz - W) < 0.1).map((p) => p.levelDbm));
    return { pim: at(pimImd(ex.scene)), rev: at(txReverseImd(ex.scene)), skirt: ch.txNoiseSkirtDbm, rise: ch.riseDb };
  };
  const bad = run('corroded'), good = run('good');
  assert.ok(Math.abs(bad.pim + 118) < 1 && Math.abs(good.pim + 153) < 1);
  assert.ok(Math.abs(bad.pim - good.pim - 35) < 1);
  assert.ok(Math.abs(bad.rev + 114) < 1);
  assert.ok(Math.abs(bad.skirt + 103) < 1);
  assert.ok(Math.abs(bad.rise - good.rise) < 0.5, 'rise ' + bad.rise + ' vs ' + good.rise);
  assert.ok(bad.skirt > bad.pim + 10, 'the transmitter noise hides the passive product');
});

test('note check: imd-plan-bad retune clears the checker and meets the 400 kHz clearance (orders 3 and 5)', () => {
  const bad = buildExample('imd-plan-bad').scene;
  const plan = [606.0, 606.5, 610.2, 611.7];
  const good = structuredClone(bad);
  plan.forEach((f, i) => { good.imd.transmitters[i].freqMHz = f; });
  assert.equal(analyse(good).coordination.length, 0);
  assert.ok(analyse(bad).coordination.length > 10);
  let minOffsetKHz = Infinity;
  for (const p of productFrequencies(plan, [3, 5])) {
    for (const f of plan) {
      const off = Math.abs(p.fMHz - f) * 1000;
      if (off < 1e-6 && p.terms.length === 1) continue;
      minOffsetKHz = Math.min(minOffsetKHz, off);
    }
  }
  assert.ok(minOffsetKHz >= 400, 'closest product is ' + minOffsetKHz + ' kHz from a channel centre');
});

test('note check: imd-too-close link meter is the own transmitter (-46 dBm), mic A at the antenna is -40 dBm', () => {
  const ex = buildExample('imd-too-close');
  const meter = solveLink(ex.scene, ex.scene.links[0]).inputPowerDbm;
  const a = noiseFloor(ex.scene).perChannel.find((c) => Math.abs(c.freqMHz - 605.6) < 0.1);
  assert.ok(Math.abs(meter + 45.7) < 0.5);
  assert.ok(Math.abs(a.wantedDbm + 40) < 0.5);
  assert.ok(a.imSumDbm > a.wantedDbm - 10);
  assert.ok(frontEndImd(ex.scene).length > 0);
});
