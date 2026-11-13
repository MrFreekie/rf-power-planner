import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene, createDefaultLink, validateScene, migrateScene, deserialize, serialize } from '../js/model/scene.js';
import { solveLink } from '../js/model/rf.js';
import { coverageGrid, zoneStats } from '../js/model/coverage.js';
import { createCoverageTracker } from '../js/coverageTracker.js';
import { EXAMPLES, buildExample } from '../js/examples.js';
import * as A from '../js/actions.js';

const iemScene = () => {
  const s = createDefaultScene();
  s.links = [createDefaultLink('iem')];
  return s;
};

test('legacy IEM scene migrates to branch 0 without changing solveLink results', () => {
  const s = iemScene();
  const before = solveLink(s, s.links[0]);
  const legacy = structuredClone(s);
  delete legacy.links[0].branches; delete legacy.zones; delete legacy.coverage;
  assert.equal(validateScene(legacy).ok, true);
  const m = migrateScene(legacy);
  assert.equal(m.links[0].branches.length, 1);
  assert.deepEqual(m.links[0].branches[0].pos, m.links[0].tx.pos);
  assert.deepEqual(m.links[0].branches[0].antenna, m.links[0].tx.antenna);
  assert.deepEqual(m.links[0].branches[0].chain.map((c) => [c.kind, c.cableType, c.lengthM]), m.links[0].chain.map((c) => [c.kind, c.cableType, c.lengthM]));
  const after = solveLink(m, m.links[0]);
  assert.equal(after.inputPowerDbm, before.inputPowerDbm);
  assert.equal(after.rxPowerDbm, before.rxPowerDbm);
  assert.deepEqual(m.zones, []);
  assert.equal(m.coverage.mode, 'power');
  assert.equal(validateScene(m).ok, true);
  assert.deepEqual(deserialize(serialize(m)), m);
});

test('mic links keep one antenna; defaults for zones and reflectors validate', () => {
  const s = createDefaultScene();
  assert.equal(s.links[0].branches, undefined);
  s.links[0].branches = [{}];
  assert.equal(validateScene(s).ok, false);
  const t = iemScene();
  t.zones = [{ id: 'z1', name: 'Z', polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], zMin: 0, zMax: 2, requiredMarginDb: 10 }];
  t.reflectors = [{ id: 'w1', name: 'W', material: 'brick', p1: { x: 0, y: 1 }, p2: { x: 2, y: 1 }, zMin: 0, zMax: 3, transmissionLossDb: 12 }];
  assert.equal(validateScene(t).ok, true);
  t.zones[0].polygon.pop();
  assert.equal(validateScene(t).ok, false);
  t.zones[0].polygon.push({ x: 1, y: 1 });
  t.reflectors[0].transmissionLossDb = -3;
  assert.equal(validateScene(t).ok, false);
  t.reflectors[0].transmissionLossDb = 12;
  t.coverage = { mode: 'nope' };
  assert.equal(validateScene(t).ok, false);
  t.coverage = { mode: 'coherent' };
  t.links[0].splitter = { preset: 'passive-4', insertionLossDb: 1 };
  assert.equal(validateScene(t).ok, true);
  t.links[0].splitter.insertionLossDb = -1;
  assert.equal(validateScene(t).ok, false);
});

test('branch actions: add, update, move, remove, and branch 0 stays mirrored to the legacy fields', () => {
  const st = createStore(iemScene());
  const lid = st.getScene().links[0].id;
  const b1 = A.addBranch(st, lid, { name: 'Far' });
  let l = st.getScene().links[0];
  assert.equal(l.branches.length, 2);
  assert.equal(l.branches[1].id, b1);
  assert.equal(validateScene(st.getScene()).ok, true);
  A.moveBranch(st, lid, b1, { x: 9, y: 2 });
  assert.deepEqual([l = st.getScene().links[0]].map((x) => [x.branches[1].pos.x, x.branches[1].pos.y])[0], [9, 2]);
  // branch 0 edits go to the legacy fields; legacy edits show up in branch 0
  const b0 = st.getScene().links[0].branches[0].id;
  A.moveBranch(st, lid, b0, { x: 1.5 });
  assert.equal(st.getScene().links[0].tx.pos.x, 1.5);
  assert.equal(st.getScene().links[0].branches[0].pos.x, 1.5);
  A.setPath(st, 'links.0.tx.pos.y', 4.5);
  assert.equal(st.getScene().links[0].branches[0].pos.y, 4.5);
  A.updateBranch(st, lid, b1, { antenna: { gainDbi: 8 }, chain: [{ kind: 'booster', gainDb: 12 }], name: 'Far end' });
  l = st.getScene().links[0];
  assert.equal(l.branches[1].antenna.gainDbi, 8);
  assert.equal(l.branches[1].chain[0].kind, 'booster');
  assert.ok(l.branches[1].chain[0].id);
  assert.equal(l.branches[1].name, 'Far end');
  A.updateBranch(st, lid, b0, { chain: [{ kind: 'attenuator', lossDb: 6 }] });
  assert.equal(st.getScene().links[0].chain[0].kind, 'attenuator');
  assert.equal(st.getScene().links[0].branches[0].chain[0].kind, 'attenuator');
  A.removeBranch(st, lid, b0); // promotes branch 1 into the legacy fields
  l = st.getScene().links[0];
  assert.equal(l.branches.length, 1);
  assert.equal(l.tx.pos.x, 9);
  assert.equal(l.chain[0].kind, 'booster');
  assert.equal(A.removeBranch(st, lid, l.branches[0].id), false); // never below one branch
  assert.equal(validateScene(st.getScene()).ok, true);
  const mic = createStore(createDefaultScene());
  assert.equal(A.addBranch(mic, mic.getScene().links[0].id), null);
});

test('zone actions, splitter and coverage mode', () => {
  const st = createStore(iemScene());
  const zid = A.addZone(st, { name: 'Aisle' });
  assert.equal(st.getScene().zones[0].polygon.length, 4);
  assert.equal(st.getScene().zones[0].requiredMarginDb, 10);
  A.addZonePoint(st, zid, { x: 7, y: 7 }, 2);
  assert.equal(st.getScene().zones[0].polygon[2].x, 7);
  A.movePoint(st, zid, 0, { x: 0.5, y: 0.25 }, { coalesce: 'pt' });
  A.movePoint(st, zid, 0, { x: 0.75 }, { coalesce: 'pt' });
  assert.deepEqual(st.getScene().zones[0].polygon[0], { x: 0.75, y: 0.25 });
  st.undo();
  assert.deepEqual(st.getScene().zones[0].polygon[0], { x: 2, y: 2 }); // both drag steps undone together
  A.removeZonePoint(st, zid, 2);
  assert.equal(st.getScene().zones[0].polygon.length, 4);
  A.updateZone(st, zid, { name: 'Aisle B', requiredMarginDb: 6, zMax: 3 });
  assert.equal(st.getScene().zones[0].name, 'Aisle B');
  assert.equal(validateScene(st.getScene()).ok, true);
  A.removeZone(st, zid);
  assert.equal(st.getScene().zones.length, 0);
  const lid = st.getScene().links[0].id;
  A.setSplitter(st, lid, { preset: 'passive-4', insertionLossDb: 1.5 });
  assert.equal(st.getScene().links[0].splitter.insertionLossDb, 1.5);
  A.setSplitter(st, lid, null);
  assert.equal(st.getScene().links[0].splitter, undefined);
  assert.equal(A.setCoverageMode(st, 'bogus'), false);
  A.setCoverageMode(st, 'coherent');
  assert.equal(st.getScene().coverage.mode, 'coherent');
});

test('coverage tracker: debounced, sliced, coarse then fine, never blocks, publishes zone stats', () => {
  const ex = buildExample('zones-dead-spot');
  const st = createStore(ex.scene);
  const timeouts = [];
  const frames = [];
  const cov = createCoverageTracker({
    raf: (fn) => { frames.push(fn); return frames.length; }, caf: () => {},
    setTimeoutFn: (fn) => { timeouts.push(fn); return timeouts.length; }, clearTimeoutFn: () => {},
    budgetMs: 1,
  });
  cov.install(st);
  const lid = ex.scene.links[0].id;
  assert.equal(cov.get(lid), null);
  timeouts.shift()(); // initial debounce fires
  let seenCoarse = false, steps = 0, partial = false;
  while (frames.length && steps < 5000) {
    frames.shift()();
    steps++;
    const r = cov.get(lid);
    if (r && !r.grid.done) partial = true;
    if (r && r.grid.done && r.cellM === 1) seenCoarse = true;
  }
  const done = cov.get(lid);
  assert.ok(partial, 'work was sliced across frames');
  assert.ok(seenCoarse, 'coarse pass finished first');
  assert.equal(done.cellM, 0.25);
  assert.equal(done.fineCoverage, 'full');
  assert.equal(typeof done.undersampled, 'boolean');
  assert.ok(done.zones[0].requirement && Number.isFinite(done.zones[0].requirement.requiredDbm));
  assert.equal(done.computing, false);
  assert.equal(done.progress, 1);
  assert.equal(done.zones.length, 1);
  assert.equal(done.zones[0].stats.pass, true);
  // moving something cancels the stale pass and the debounce delays the restart
  A.moveBranch(st, lid, ex.scene.links[0].branches[1].id, { x: 21 });
  A.moveBranch(st, lid, ex.scene.links[0].branches[1].id, { x: 21.5 });
  assert.equal(frames.length, 0);
  assert.equal(cov.get(lid).computing, true);
  assert.ok(timeouts.length >= 1);
  timeouts.pop()();
  assert.equal(frames.length, 1);
  // selection changes and no-op updates do not retrigger
  const n = timeouts.length;
  st.select('x');
  A.setPath(st, 'links.0.name', ex.scene.links[0].name);
  assert.equal(timeouts.length, n);
});

test('zone examples validate and the zone passes with all antennas but fails without antenna 2', () => {
  const ids = ['zones-dead-spot', 'zones-long-hall', 'zones-backstage-corridor'];
  for (const id of ids) {
    const ex = buildExample(id);
    assert.deepEqual(validateScene(ex.scene), { ok: true, errors: [] }, id);
    const link = ex.scene.links[0];
    assert.ok(link.branches.length >= 2, id);
    assert.ok(Number.isFinite(solveLink(ex.scene, link).inputPowerDbm));
    const run = (scene) => {
      const g = coverageGrid(scene, link.id, { cellM: 0.5, mode: scene.coverage.mode, rxHeight: 1.5 });
      return zoneStats(g, scene.zones[0], link.rx.sensitivityDbm, scene.zones[0].requiredMarginDb);
    };
    const withAll = run(ex.scene);
    const one = structuredClone(ex.scene);
    one.links[0].branches = one.links[0].branches.slice(0, 1);
    const without = run(one);
    assert.ok(withAll.passFraction > without.passFraction, id + ': ' + withAll.passFraction + ' vs ' + without.passFraction);
  }
  assert.equal(buildExample('zones-dead-spot').scene.coverage.mode, 'power');
  assert.equal(buildExample('zones-coherent-nulls').scene.coverage.mode, 'coherent');
  assert.ok(EXAMPLES.length >= 19);
});

test('zone passAreaFraction, wall thickness fields: defaults, migration, validation, updateZone', () => {
  const s = iemScene();
  s.zones = [{ id: 'z1', name: 'Z', polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], zMin: 0, zMax: 2, requiredMarginDb: 10 }];
  assert.equal(validateScene(s).ok, true);
  assert.equal(migrateScene(s).zones[0].passAreaFraction, 0.95);
  const st = createStore(iemScene());
  const zid = A.addZone(st, {});
  assert.equal(st.getScene().zones[0].passAreaFraction, 0.95);
  A.updateZone(st, zid, { passAreaFraction: 0.8 });
  assert.equal(st.getScene().zones[0].passAreaFraction, 0.8);
  A.updateZone(st, zid, { passAreaFraction: 0.2 }); // out of range: ignored
  assert.equal(st.getScene().zones[0].passAreaFraction, 0.8);
  const bad = structuredClone(st.getScene());
  bad.zones[0].passAreaFraction = 1.2;
  assert.equal(validateScene(bad).ok, false);
  const w = iemScene();
  w.reflectors = [{ id: 'w1', name: 'W', material: 'brick', p1: { x: 0, y: 1 }, p2: { x: 2, y: 1 }, zMin: 0, zMax: 3, thicknessFactor: 2, thicknessM: 0.2 }];
  assert.equal(validateScene(w).ok, true);
  w.reflectors[0].thicknessFactor = -1;
  assert.equal(validateScene(w).ok, false);
  w.reflectors[0].thicknessFactor = 1;
  w.reflectors[0].thicknessM = 'x';
  assert.equal(validateScene(w).ok, false);
});

test('coverage tracker: large venues get the fine pass over the zones only; zone pass follows passAreaFraction', () => {
  const ex = buildExample('zones-long-hall');
  const scene = structuredClone(ex.scene);
  scene.stage = { width: 60, depth: 20 }; // 1200 m2 (> 600)
  const st = createStore(scene);
  const timeouts = [], frames = [];
  const cov = createCoverageTracker({
    raf: (fn) => { frames.push(fn); return frames.length; }, caf: () => {},
    setTimeoutFn: (fn) => { timeouts.push(fn); return timeouts.length; }, clearTimeoutFn: () => {}, budgetMs: 50,
  });
  cov.install(st);
  timeouts.shift()();
  let guard = 0;
  while (frames.length && guard++ < 5000) frames.shift()();
  const lid = scene.links[0].id;
  const r = cov.get(lid);
  assert.equal(r.fineCoverage, 'zones-only');
  assert.equal(r.grid.cellM, 1); // whole venue stays at the coarse resolution
  assert.equal(r.fineGrid.cellM, 0.25);
  assert.ok(r.fineGrid.nx * r.fineGrid.ny < r.grid.nx * r.grid.ny * 16, 'fine grid covers less than the whole venue at 0.25 m');
  assert.equal(r.cellM, 0.25);
  const z = r.zones[0];
  assert.ok(Number.isFinite(z.requirement.squelchThresholdDbm));
  assert.equal(z.stats.pass, z.stats.passFraction >= 0.95);
  assert.ok(typeof r.undersampled === 'boolean');
  // a lenient pass fraction can flip the verdict without changing the cells
  const lenient = structuredClone(scene);
  lenient.zones[0].passAreaFraction = 0.5;
  const g = coverageGrid(lenient, lid, { cellM: 0.5, mode: 'power', rxHeight: 1.5 });
  const strict = zoneStats(g, { ...lenient.zones[0], passAreaFraction: 1 }, z.requirement.squelchThresholdDbm, z.requirement.appliedMarginDb);
  const loose = zoneStats(g, lenient.zones[0], z.requirement.squelchThresholdDbm, z.requirement.appliedMarginDb);
  assert.equal(strict.passFraction, loose.passFraction);
  assert.equal(strict.pass, strict.allCellsPass);
  assert.equal(loose.pass, loose.passFraction >= 0.5);
});
