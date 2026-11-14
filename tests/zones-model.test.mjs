import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene, createDefaultLink } from '../js/model/scene.js';
import {
  solveLink, solveBranches, pathWallLoss, wallTransmissionLossDb, wavelengthM, branchesOf,
} from '../js/model/rf.js';
import {
  coverageGrid, zoneStats, pointInPolygon, suggestFix, zoneRequirement, FINE_CELL_M, COARSE_CELL_M,
} from '../js/model/coverage.js';

const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} got ${a}, want ${b} +/- ${tol}`);
const OMNI = { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 0 } };

// Free-space IEM scene with an omni receiver and optional branches.
function mkScene(branches, extra = {}) {
  const scene = createDefaultScene();
  scene.environment = { ...scene.environment, model: 'free-space', fadeMarginDb: 0, bodyLossDb: 0 };
  const link = createDefaultLink('iem');
  link.freqMHz = 600;
  link.tx = { ...link.tx, powerDbm: 10, pos: { x: 0, y: 0, z: 1.5 }, antenna: { ...OMNI } };
  link.rx = { ...link.rx, pos: { x: 0, y: 10, z: 1.5 }, antenna: { ...OMNI }, bodyLossDb: 0, sensitivityDbm: -90 };
  link.chain = [];
  if (branches) link.branches = branches; else delete link.branches;
  Object.assign(link, extra);
  scene.links = [link];
  scene.reflectors = [];
  return { scene, link };
}
const br = (id, x, y, z = 1.5, chain = []) => ({ id, name: id, chain, antenna: { ...OMNI }, pos: { x, y, z } });
const wall = (over = {}) => ({ id: 'w1', name: 'wall', material: 'brick', p1: { x: -10, y: 5 }, p2: { x: 10, y: 5 }, zMin: 0, zMax: 3, ...over });

test('wall transmission: applied once when crossed, not otherwise', () => {
  const { scene, link } = mkScene();
  const clear = solveLink(scene, link);
  scene.reflectors = [wall({ transmissionLossDb: 7 })];
  const through = solveLink(scene, link);
  near(clear.inputPowerDbm - through.inputPowerDbm, 7, 1e-9);
  assert.equal(through.paths[0].wallLossDb, 7);
  assert.deepEqual(through.paths[0].crossedWalls, ['w1']);
  assert.ok(through.waterfall.some((w) => w.label === 'Wall transmission' && w.deltaDb === -7));
  near(through.pathLossDb - clear.pathLossDb, 7, 1e-9);
  for (const over of [{ p1: { x: 20, y: 5 }, p2: { x: 30, y: 5 } }, { zMin: 2.5, zMax: 3 }, { p1: { x: -10, y: 12 }, p2: { x: 10, y: 12 } }]) {
    scene.reflectors = [wall({ transmissionLossDb: 7, ...over })];
    const r = solveLink(scene, link);
    assert.equal(r.inputPowerDbm, clear.inputPowerDbm);
    assert.equal(r.paths[0].wallLossDb, undefined);
  }
  scene.reflectors = [wall({ transmissionLossDb: 7 }), wall({ id: 'w2', p1: { x: -10, y: 7 }, p2: { x: 10, y: 7 }, transmissionLossDb: 3 })];
  near(clear.inputPowerDbm - solveLink(scene, link).inputPowerDbm, 10, 1e-9);
});

test('pathWallLoss: polyline legs, touching endpoints do not count', () => {
  const w = wall({ transmissionLossDb: 5 });
  const sc = { reflectors: [w] };
  const pts = [{ x: 0, y: 0, z: 1 }, { x: 0, y: 8, z: 1 }, { x: 1, y: 0, z: 1 }];
  assert.equal(pathWallLoss(sc, pts, 600).lossDb, 10);
  assert.equal(pathWallLoss(sc, [{ x: 0, y: 0, z: 1 }, { x: 0, y: 5, z: 1 }, { x: 0, y: 0, z: 1 }], 600).lossDb, 0);
  assert.equal(pathWallLoss(sc, [{ x: 0, y: 0, z: 5 }, { x: 0, y: 10, z: 5 }], 600).lossDb, 0);
  assert.equal(wallTransmissionLossDb({ material: 'concrete', transmissionLossDb: 4 }, 600), 4);
});

test('wall transmission fallback table equals zones-params; thickness hook', async () => {
  const ZPm = await import('../js/model/zones-params.js');
  for (const id of ['drywall', 'brick', 'concrete', 'glass', 'wood', 'drapes', 'metal', 'grass']) {
    const w = { material: id };
    near(wallTransmissionLossDb(w, 600), ZPm.MATERIAL_TRANSMISSION[id].lossDb600, 1e-9, id);
    const lib = await import('../js/model/library.js');
    near(wallTransmissionLossDb(w, 900), lib.wallLossDb(id, 900), 1e-9, id); // library table value at 900 MHz
  }
  const base = wallTransmissionLossDb({ material: 'brick' }, 600);
  near(wallTransmissionLossDb({ material: 'brick', thicknessFactor: 2 }, 600), 2 * base, 1e-9);
  near(wallTransmissionLossDb({ material: 'brick', thicknessM: 0.2 }, 600), 2 * base, 1e-9); // reference 0.1 m
  assert.equal(wallTransmissionLossDb({ material: 'brick', transmissionLossDb: 3, thicknessFactor: 5 }, 600), 3);
});

test('solveBranches: 2-way splitter costs 3.01 dB plus insertion', () => {
  const { scene, link } = mkScene([br('a', -1, 0), br('b', 1, 0)], { splitter: { insertionLossDb: 0.5 } });
  const pt = { x: 0, y: 10, z: 1.5 };
  const r = solveBranches(scene, link, pt);
  near(r.splitterLossDb, 3.0103 + 0.5, 1e-4);
  const single = mkScene(null);
  single.link.tx.pos = { x: -1, y: 0, z: 1.5 };
  single.link.tx.powerDbm = 10 - 3.0103 - 0.5;
  near(r.perBranchDbm[0], solveLink(single.scene, single.link).inputPowerDbm, 1e-3);
  const unsplit = solveBranches(scene, { ...link, branches: [br('a', -1, 0)] }, pt);
  near(unsplit.perBranchDbm[0] - r.perBranchDbm[0], 3.0103 + 0.5, 1e-4);
  assert.equal(unsplit.splitterLossDb, 0);
});

test('solveBranches: equidistant equal-phase antennas +6 dB coherent, +3 dB power sum', () => {
  const { scene, link } = mkScene([br('a', -1, 0), br('b', 1, 0)]);
  const pt = { x: 0, y: 10, z: 1.5 };
  const co = solveBranches(scene, link, pt, { mode: 'coherent' });
  const pw = solveBranches(scene, link, pt, { mode: 'power' });
  const best = solveBranches(scene, link, pt, { mode: 'best' });
  near(co.perBranchDbm[0], co.perBranchDbm[1], 1e-9);
  near(co.combinedDbm - co.perBranchDbm[0], 6.0206, 1e-6);
  near(pw.combinedDbm - pw.perBranchDbm[0], 3.0103, 1e-6);
  near(best.combinedDbm, best.perBranchDbm[0], 1e-12);
  assert.equal(co.nullDepthDb, 0);
});

test('solveBranches: half-wavelength cable difference nulls, quarter wavelength gives +3 dB', () => {
  const lam = wavelengthM(600);
  const cab = (lenM) => [{ kind: 'cable', cableType: 'rg58', lengthM: lenM, freqLossOverrideDbPer100m: 0 }];
  const vf = 0.66;
  const pt = { x: 0, y: 10, z: 1.5 };
  let { scene, link } = mkScene([br('a', -1, 0, 1.5, cab(2)), br('b', 1, 0, 1.5, cab(2 + (lam / 2) * vf))]);
  let r = solveBranches(scene, link, pt);
  assert.ok(r.nullDepthDb > 50, `null depth ${r.nullDepthDb}`);
  near(solveBranches(scene, link, pt, { mode: 'power' }).combinedDbm, r.powerSumDbm, 1e-12);
  ({ scene, link } = mkScene([br('a', -1, 0, 1.5, cab(2)), br('b', 1, 0, 1.5, cab(2 + (lam / 4) * vf))]));
  r = solveBranches(scene, link, pt);
  near(r.combinedDbm, r.powerSumDbm, 1e-6);
  ({ scene, link } = mkScene([br('a', -1, 0, 1.5, cab(5)), br('b', 1, 0, 1.5, cab(5))]));
  r = solveBranches(scene, link, pt);
  near(r.combinedDbm - r.perBranchDbm[0], 6.0206, 1e-6);
});

test('link without branches behaves as one branch built from tx and chain', () => {
  const { scene, link } = mkScene(null);
  link.chain = [{ kind: 'cable', cableType: 'rg58', lengthM: 10 }, { kind: 'attenuator', lossDb: 2 }];
  assert.equal(branchesOf(link).length, 1);
  const r = solveBranches(scene, link, link.rx.pos);
  near(r.combinedDbm, solveLink(scene, link).inputPowerDbm, 1e-9);
});

test('coverageGrid matches solveBranches / solveLink at sample points', () => {
  const { scene, link } = mkScene([br('a', 2, 1), br('b', 9, 1)]);
  scene.environment.model = 'two-ray';
  scene.reflectors = [wall({ p1: { x: 0, y: 4 }, p2: { x: 5, y: 4 }, transmissionLossDb: 6 }), wall({ id: 'w2', material: 'concrete', p1: { x: 12, y: 0 }, p2: { x: 12, y: 8 } })];
  const g = coverageGrid(scene, link.id, { cellM: 1, rxHeight: 1.2, bounds: { x0: 0, y0: 0, x1: 12, y1: 8 } });
  assert.equal(g.nx, 12); assert.equal(g.ny, 8);
  assert.equal(g.done, true); assert.equal(g.progress, 1);
  assert.ok(g.levelDbm instanceof Float32Array);
  assert.ok(g.dominantBranch instanceof Uint8Array);
  for (const [i, j] of [[0, 0], [3, 5], [11, 7], [6, 2], [9, 6]]) {
    const r = solveBranches(scene, link, { x: i + 0.5, y: j + 0.5, z: 1.2 });
    near(g.levelDbm[j * g.nx + i], r.combinedDbm, 2e-4, `cell ${i},${j}`);
    assert.equal(g.dominantBranch[j * g.nx + i], r.dominantBranch);
  }
  assert.equal(g.dominantBranch[1], 0);
  assert.equal(g.dominantBranch[10], 1);
  const s1 = mkScene(null);
  const g1 = coverageGrid(s1.scene, s1.link.id, { cellM: 2, rxHeight: 1.5, bounds: { x0: 0, y0: 0, x1: 12, y1: 8 } });
  const ref = solveLink(s1.scene, { ...s1.link, rx: { ...s1.link.rx, pos: { x: 5, y: 3, z: 1.5 } } }).inputPowerDbm;
  near(g1.levelDbm[1 * g1.nx + 2], ref, 2e-4);
  assert.equal(coverageGrid(s1.scene, 'nope'), null);
});

test('coverageGrid budget: partial progress, resumable, same final result', () => {
  const { scene, link } = mkScene([br('a', 2, 1), br('b', 9, 1)]);
  const opts = { cellM: 1, rxHeight: 1.2, bounds: { x0: 0, y0: 0, x1: 12, y1: 8 } };
  const full = coverageGrid(scene, link.id, opts);
  let g = coverageGrid(scene, link.id, { ...opts, budgetMs: -1 });
  assert.equal(g.done, false);
  assert.ok(g.progress > 0 && g.progress < 1);
  assert.equal(g.levelDbm[g.nx * g.ny - 1], -Infinity);
  let guard = 0;
  while (!g.done && guard++ < 100) g = coverageGrid(scene, link.id, { budgetMs: -1, resume: g });
  assert.deepEqual(Array.from(g.levelDbm), Array.from(full.levelDbm));
  assert.deepEqual(Array.from(g.dominantBranch), Array.from(full.dominantBranch));
});

test('coverageGrid: default fine cell 0.25 m, coarse 1 m, undersampled flag at cell > lambda/4', () => {
  assert.equal(FINE_CELL_M, 0.25);
  assert.equal(COARSE_CELL_M, 1);
  const { scene, link } = mkScene([br('a', 2, 1)]);
  const b = { x0: 0, y0: 0, x1: 2, y1: 1 };
  const fine = coverageGrid(scene, link.id, { bounds: b });
  assert.equal(fine.cellM, 0.25);
  assert.equal(fine.nx, 8);
  const coarse = coverageGrid(scene, link.id, { bounds: b, pass: 'coarse' });
  assert.equal(coarse.cellM, 1);
  assert.equal(coarse.undersampled, true);
  near(coarse.lambdaM, 0.49965, 1e-4);
  assert.equal(coverageGrid(scene, link.id, { bounds: b, cellM: 0.1 }).undersampled, false); // 0.1 < 0.125
  assert.equal(fine.undersampled, true); // 0.25 > 0.125 at 600 MHz
});

test('pointInPolygon edge cases', () => {
  const sq = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
  assert.equal(pointInPolygon({ x: 2, y: 2 }, sq), true);
  assert.equal(pointInPolygon({ x: 0, y: 2 }, sq), true);
  assert.equal(pointInPolygon({ x: 4, y: 4 }, sq), true);
  assert.equal(pointInPolygon({ x: 4.01, y: 2 }, sq), false);
  const L = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 }];
  assert.equal(pointInPolygon({ x: 1, y: 3 }, L), true);
  assert.equal(pointInPolygon({ x: 3, y: 3 }, L), false);
  assert.equal(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }]), false);
  assert.equal(pointInPolygon({ x: 0, y: 0 }, []), false);
  assert.equal(pointInPolygon({ x: 2, y: 2 }, [...sq].reverse()), true);
});

function synthGrid() {
  const levelDbm = new Float32Array(16);
  for (let k = 0; k < 16; k++) levelDbm[k] = -80 + k;
  return { x0: 0, y0: 0, nx: 4, ny: 4, cellM: 1, levelDbm, dominantBranch: new Uint8Array(16) };
}

test('zoneStats: pass logic, worst point, quantiles', () => {
  const g = synthGrid();
  const zone = { id: 'z', polygon: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }], requiredMarginDb: 0 };
  const s = zoneStats(g, zone, -78, 0);
  assert.equal(s.cells, 4);
  assert.equal(s.minDbm, -80);
  assert.deepEqual(s.worstPoint, { x: 0.5, y: 0.5 });
  near(s.passFraction, 0.5, 1e-12);
  assert.equal(s.pass, false);
  assert.equal(s.allCellsPass, false);
  near(s.meanDbm, 10 * Math.log10((1e-8 + Math.pow(10, -7.9) + Math.pow(10, -7.6) + Math.pow(10, -7.5)) / 4), 1e-9);
  near(s.p5Dbm, -80 + 0.05 * 3 * 1, 1e-6);
  assert.equal(zoneStats(g, zone, -85, 5).pass, true);
  assert.equal(zoneStats(g, zone, -85, 5.01).pass, false);
  assert.equal(zoneStats(g, zone, -85, 5.01).passFraction, 0.75);
  assert.equal(zoneStats(g, { ...zone, requiredMarginDb: 6 }, -85).pass, false);
  assert.equal(zoneStats(g, { ...zone, requiredMarginDb: 5 }, -85).pass, true);
  const edge = { id: 'e', polygon: [{ x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }, { x: 1.5, y: 1.5 }, { x: 0.5, y: 1.5 }] };
  assert.equal(zoneStats(g, edge, -100, 0).cells, 4);
  const tiny = { id: 't', polygon: [{ x: 2.1, y: 2.1 }, { x: 2.3, y: 2.1 }, { x: 2.2, y: 2.3 }] };
  const t = zoneStats(g, tiny, -100, 0);
  assert.equal(t.cells, 1);
  assert.equal(t.minDbm, -80 + 2 * 4 + 2);
  const bad = zoneStats(g, { id: 'b', polygon: [{ x: 0, y: 0 }] }, -80, 0);
  assert.equal(bad.cells, 0); assert.equal(bad.pass, false); assert.equal(bad.worstPoint, null);
});

test('zoneStats: 95 percent pass rule, allCellsPass kept strict', () => {
  const n = 20;
  const grid = { x0: 0, y0: 0, nx: n, ny: 1, cellM: 1, levelDbm: new Float32Array(n).fill(-60), dominantBranch: new Uint8Array(n) };
  grid.levelDbm[7] = -100;
  const zone = { id: 'z', polygon: [{ x: 0, y: 0 }, { x: n, y: 0 }, { x: n, y: 1 }, { x: 0, y: 1 }] };
  const s = zoneStats(grid, zone, -80, 0);
  near(s.passFraction, 0.95, 1e-12);
  assert.equal(s.pass, true);
  assert.equal(s.allCellsPass, false);
  grid.levelDbm[8] = -100;
  assert.equal(zoneStats(grid, zone, -80, 0).pass, false);
  assert.equal(zoneStats(grid, { ...zone, passAreaFraction: 0.9 }, -80, 0).pass, true);
  assert.equal(zoneStats(grid, zone, -200, 0).allCellsPass, true);
});

test('zoneRequirement: squelch threshold plus margin, fade margin counted once', () => {
  const { scene, link } = mkScene(null);
  link.rx.sensitivityDbm = -90;
  link.rx.squelch = { enabled: true, thresholdDbm: -85, hysteresisDb: 3 };
  const zone = { id: 'z', requiredMarginDb: 10 };
  const r = zoneRequirement(scene, link, zone);
  assert.equal(r.squelchThresholdDbm, -85);
  assert.equal(r.marginDb, 10);
  assert.equal(r.requiredDbm, -75);
  assert.equal(r.appliedMarginDb, 10);
  link.rx.squelch.enabled = false;
  assert.equal(zoneRequirement(scene, link, zone).squelchThresholdDbm, -90);
  scene.environment.fadeMarginDb = 6;
  assert.equal(zoneRequirement(scene, link, zone).appliedMarginDb, 4);
  scene.environment.fadeMarginDb = 12;
  assert.equal(zoneRequirement(scene, link, zone).appliedMarginDb, 0);
  scene.environment.fadeMarginDb = 0;
  const d = zoneRequirement(scene, link, { id: 'q' });
  assert.ok(d.marginDb >= 6 && d.marginDb <= 30);
});

test('suggestFix: ranked, deterministic, effects reported', () => {
  const { scene, link } = mkScene([br('a', 1, 1, 2), br('b', 1, 2, 2)]);
  link.tx.powerDbm = 0;
  link.rx.squelch = { enabled: false, thresholdDbm: -85, hysteresisDb: 3 };
  scene.zones = [
    { id: 'far', name: 'Far', polygon: [{ x: 8, y: 5 }, { x: 11, y: 5 }, { x: 11, y: 7.5 }, { x: 8, y: 7.5 }], zMin: 1, zMax: 1.5, requiredMarginDb: 0, passAreaFraction: 1 },
    { id: 'near', name: 'Near', polygon: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 3 }], zMin: 1, zMax: 1.5, requiredMarginDb: 0 },
  ];
  const g = coverageGrid(scene, link.id, { cellM: 0.75, rxHeight: 1.2 });
  const far0 = zoneStats(g, scene.zones[0], -999, 0);
  link.rx.sensitivityDbm = (far0.minDbm + far0.meanDbm) / 2 + 2;
  const st = zoneStats(g, scene.zones[0], link.rx.sensitivityDbm, 0);
  assert.ok(st.passFraction > 0 && st.passFraction < 1, `far pass fraction ${st.passFraction}`);
  const sug = suggestFix(scene, link.id, 'far', { cellM: 0.75, rxHeight: 1.2 });
  assert.ok(sug.length > 0);
  for (let i = 1; i < sug.length; i++) assert.ok(sug[i - 1].score >= sug[i].score);
  for (const s of sug) {
    assert.ok(['move', 'attenuate', 'gain'].includes(s.kind));
    assert.ok(s.score > 0 && s.description.length > 0);
    assert.equal(s.others.length, 1);
    assert.equal(s.others[0].zoneId, 'near');
  }
  assert.ok(sug.some((s) => s.kind === 'gain' && s.deltaMinDb > 0));
  assert.deepEqual(suggestFix(scene, link.id, 'far', { cellM: 0.75, rxHeight: 1.2 }), sug);
  assert.equal(scene.links[0].branches[0].pos.x, 1);
  assert.deepEqual(suggestFix(scene, link.id, 'missing'), []);
  assert.deepEqual(suggestFix(scene, 'nope', 'far'), []);
});
