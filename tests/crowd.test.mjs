// Crowd zones: polygon absorption with a clearance factor, caps, solver integration, validation, actions, diff, calibration note.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CROWD_DEFAULTS, CROWD_MAX_LOSS_DB, CROWD_CAVEAT, CROWD_CONFIDENCE, crowdParams, crowdClearanceFactor, fresnelF1,
  polygonSegmentInside, polygonAreaM2, crowdPathLoss, crowdSummary,
} from '../js/model/crowd.js';
import { createDefaultScene, createCrowd, validateScene, migrateScene, serialize, deserialize, SCHEMA_VERSION, SCENE_LIMITS } from '../js/model/scene.js';
import { solveLink } from '../js/model/rf.js';
import { createStore } from '../js/store.js';
import { addCrowd, updateCrowd, removeCrowd, moveCrowd } from '../js/actionsAreas.js';
import { diffScenes, headline } from '../js/model/scene-diff.js';
import { suggestCalibration } from '../js/model/measurements.js';
import { assumptionsInUse } from '../js/model/assumptions-in-use.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);
const square = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const crowd = (o = {}) => ({ id: 'c1', name: 'Pit', mode: 'standing', polygon: square(0, 0, 10, 10), ...o });
const F = 600;
const vErr = (sc) => validateScene(sc).errors;

// ---- geometry
test('segment-polygon: chord through a square, fully inside, outside, touching', () => {
  const P = square(0, 0, 10, 10);
  const iv = polygonSegmentInside(P, { x: -5, y: 5 }, { x: 15, y: 5 });
  assert.equal(iv.length, 1);
  near(iv[0].t0, 0.25, 1e-12); near(iv[0].t1, 0.75, 1e-12);
  const all = polygonSegmentInside(P, { x: 2, y: 2 }, { x: 8, y: 8 });
  near(all[0].t0, 0, 1e-12); near(all[0].t1, 1, 1e-12);
  assert.equal(polygonSegmentInside(P, { x: -5, y: -5 }, { x: -1, y: 20 }).length, 0);
  assert.equal(polygonSegmentInside(P, { x: 0, y: 15 }, { x: 10, y: 15 }).length, 0);
  assert.equal(polygonSegmentInside([{ x: 0, y: 0 }, { x: 1, y: 1 }], { x: 0, y: 0 }, { x: 5, y: 5 }).length, 0);
  near(polygonAreaM2(P), 100, 1e-12);
});

test('segment-polygon: concave (L shape) gives two separate chords; diagonal chord length', () => {
  const L = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 10 }, { x: 0, y: 10 }];
  const iv = polygonSegmentInside(L, { x: -1, y: 1 }, { x: 11, y: 1 }); // crosses the whole bottom arm
  assert.equal(iv.length, 1); near((iv[0].t1 - iv[0].t0) * 12, 10, 1e-9);
  const two = polygonSegmentInside(L, { x: 1, y: 11 }, { x: 11, y: 1 }); // line x + y = 12: enters the vertical arm? no: only touches arms at corners
  assert.ok(two.length <= 1);
  const gap = polygonSegmentInside(L, { x: -1, y: 5 }, { x: 11, y: 5 }); // only the vertical arm, x 0..2
  assert.equal(gap.length, 1); near((gap[0].t1 - gap[0].t0) * 12, 2, 1e-9);
  const U = [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }, { x: 6, y: 9 }, { x: 6, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 9 }, { x: 0, y: 9 }];
  const t = polygonSegmentInside(U, { x: -1, y: 6 }, { x: 10, y: 6 }); // through both legs of the U, not the gap
  assert.equal(t.length, 2);
  const inside = t.reduce((a, q) => a + (q.t1 - q.t0) * 11, 0);
  near(inside, 3 + 3, 1e-9);
});

// ---- per-ray loss
test('hand value: 4 m chord, standing default k 2.7, ray at 1.0 m (below heads) = 10.8 dB', () => {
  const r = crowdPathLoss({ crowds: [crowd()] }, [{ x: 3, y: 5, z: 1 }, { x: 7, y: 5, z: 1 }], F);
  assert.equal(r.chords.length, 1);
  near(r.chords[0].lengthM, 4, 1e-9);
  near(r.lossDb, 2.7 * 4, 1e-9);
  assert.equal(r.crowds[0].capped, false);
});

test('defaults per mode: k and cap', () => {
  for (const [mode, k, lmax, head] of [['seated', 1.8, 15, 1.2], ['standing', 2.7, 20, 1.75], ['packed', 4.0, 22, 1.75]]) {
    const p = crowdParams({ mode });
    assert.equal(p.kDbPerM, k); assert.equal(p.lMaxDb, lmax); assert.equal(p.headHeightM, head);
    assert.equal(CROWD_DEFAULTS[mode].kDbPerM, k);
    near(crowdPathLoss({ crowds: [crowd({ mode })] }, [{ x: 1, y: 5, z: 0.5 }, { x: 2, y: 5, z: 0.5 }], F).lossDb, k * 1, 1e-9); // 1 m chord
    near(crowdPathLoss({ crowds: [crowd({ mode, polygon: square(0, 0, 200, 10) })] }, [{ x: 1, y: 5, z: 0.5 }, { x: 150, y: 5, z: 0.5 }], F).lossDb, lmax, 1e-9, mode + ' cap');
  }
});

test('density override gives k = 0.9 x rho; kDbPerM beats density; cap override is limited to 26 dB', () => {
  near(crowdParams({ mode: 'seated', densityPerM2: 4 }).kDbPerM, 3.6, 1e-12);
  assert.equal(crowdParams({ mode: 'seated', densityPerM2: 4, kDbPerM: 2 }).kDbPerM, 2);
  assert.equal(crowdParams({ mode: 'packed', lMaxDb: 99 }).lMaxDb, CROWD_MAX_LOSS_DB);
  assert.equal(crowdParams({ mode: 'bogus' }).mode, 'standing');
  const big = crowd({ polygon: square(0, 0, 500, 10), mode: 'packed', lMaxDb: 26, kDbPerM: 10 });
  near(crowdPathLoss({ crowds: [big] }, [{ x: 1, y: 5, z: 0.5 }, { x: 400, y: 5, z: 0.5 }], F).lossDb, 26, 1e-9);
});

test('total of several crowds on one path is capped at 26 dB', () => {
  const sc = { crowds: [crowd({ id: 'a', polygon: square(0, 0, 100, 10), mode: 'packed' }), crowd({ id: 'b', polygon: square(100, 0, 200, 10), mode: 'standing' })] };
  const r = crowdPathLoss(sc, [{ x: 1, y: 5, z: 0.5 }, { x: 190, y: 5, z: 0.5 }], F);
  near(r.lossDb, 26, 1e-9); // 22 + 20 would be 42
  assert.equal(r.crowds.length, 2);
});

test('clearance ramp: s = 1 at/below heads, linear to 0 at 0.6 F1, 0 above', () => {
  assert.equal(crowdClearanceFactor(1.0, 1.75, 2), 1);
  assert.equal(crowdClearanceFactor(1.75, 1.75, 2), 1);
  near(crowdClearanceFactor(1.75 + 0.3, 1.75, 1), 0.5, 1e-12); // 0.6 F1 = 0.6, c = 0.3
  assert.equal(crowdClearanceFactor(1.75 + 0.6, 1.75, 1), 0);
  assert.equal(crowdClearanceFactor(5, 1.75, 1), 0);
  assert.equal(crowdClearanceFactor(2, 1.75, 0), 0); // no Fresnel zone (end of path): above heads = clear
  // F1 hand value: 600 MHz, lambda 0.49965 m, d1 = d2 = 5 m: sqrt(0.49965 * 25 / 10) = 1.1176 m
  near(fresnelF1(600, 5, 5), 1.1176, 1e-3);
});

test('antenna height: raising the ray above the heads removes the loss (tolerance 1e-9 dB)', () => {
  const sc = { crowds: [crowd({ polygon: square(10, 0, 20, 10), mode: 'standing' })] }; // 10 m deep block, path 0 -> 30 m
  const at = (z) => crowdPathLoss(sc, [{ x: 0, y: 5, z }, { x: 30, y: 5, z }], F);
  near(at(1.2).lossDb, 20, 1e-9); // 10 m x 2.7 = 27 -> cap 20, s = 1
  near(at(1.75).lossDb, 20, 1e-9);
  // 15 m from each end: F1 = sqrt(0.49965*15*15/30) = 1.9 m ... wait, chord mid is 15 m from each end: use the reported value
  const mid = at(2.3);
  const f1 = mid.chords[0].f1M;
  near(f1, Math.sqrt((299.792458 / 600) * 15 * 15 / 30), 1e-9);
  near(mid.crowds[0].clearance, 1 - (2.3 - 1.75) / (0.6 * f1), 1e-9);
  near(mid.lossDb, 20 * (1 - 0.55 / (0.6 * f1)), 1e-9);
  assert.equal(at(1.75 + 0.6 * f1 + 0.01).lossDb, 0);
  assert.equal(at(6).lossDb, 0);
  // seated heads are lower: 1.5 m is clear-ish for seated (partial) but still below standing heads (full)
  const seated = { crowds: [crowd({ polygon: square(10, 0, 20, 10), mode: 'seated' })] };
  assert.ok(crowdPathLoss(seated, [{ x: 0, y: 5, z: 1.5 }, { x: 30, y: 5, z: 1.5 }], F).lossDb < 15);
  near(crowdPathLoss({ crowds: [crowd({ polygon: square(10, 0, 20, 10), headHeightM: 2.2 })] }, [{ x: 0, y: 5, z: 2 }, { x: 30, y: 5, z: 2 }], F).lossDb, 20, 1e-9); // head override
});

test('a floor reflection through the same crowd twice cannot exceed that crowd\'s cap', () => {
  const sc = { crowds: [crowd({ polygon: square(0, 0, 10, 10), mode: 'seated' })] };
  const r = crowdPathLoss(sc, [{ x: -5, y: 5, z: 2 }, { x: 5, y: 5, z: 0 }, { x: 15, y: 5, z: 2 }], F);
  assert.equal(r.chords.length, 2);
  assert.ok(r.lossDb <= 15 + 1e-9);
});

test('crowdSummary carries the caveat and the confidence labels', () => {
  const sc = createDefaultScene(); sc.crowds = [crowd({ polygon: square(-200, -200, 200, 200) })];
  const res = solveLink(sc, sc.links[0]);
  const sm = crowdSummary(res);
  assert.equal(sm.caveat, CROWD_CAVEAT);
  assert.ok(/estimate/i.test(CROWD_CAVEAT) && /1-2 m above/.test(CROWD_CAVEAT));
  assert.deepEqual([...new Set(CROWD_CONFIDENCE.map((c) => c.flag))].sort(), ['A', 'I', 'S']);
  assert.equal(crowdSummary({}), null);
});

// ---- solver
function sceneWith(crowds) {
  const sc = createDefaultScene();
  const l = sc.links[0];
  l.tx.pos = { x: 0, y: 0, z: 1.0 }; l.rx.pos = { x: 0, y: -20, z: 1.0 };
  if (crowds) sc.crowds = crowds;
  return sc;
}

test('no crowds = bit-identical solve (undefined, empty list) and no crowd keys in the result', () => {
  const a = solveLink(sceneWith(), sceneWith().links[0]);
  const e = sceneWith([]);
  const b = solveLink(e, e.links[0]);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.crowd, undefined);
  assert.ok(!a.waterfall.some((s) => /crowd/i.test(s.label)));
  assert.equal(a.paths[0].crowdLossDb, undefined);
});

test('crowd in the path: named waterfall step equals the chord loss, margin drops by it, path loss rises by it', () => {
  const base = sceneWith(); const rb = solveLink(base, base.links[0]);
  const sc = sceneWith([crowd({ polygon: square(-5, -15, 5, -5), mode: 'seated', kDbPerM: 1 })]); // 10 m deep at 1 dB/m, ray at z 1.0 (below 1.2)
  const r = solveLink(sc, sc.links[0]);
  const step = r.waterfall.find((s) => s.label === 'Crowd absorption (assumed)');
  assert.ok(step);
  near(-step.deltaDb, 10, 1e-6);
  near(r.crowd.lossDb, 10, 1e-6);
  near(r.paths[0].crowdLossDb, 10, 1e-6);
  assert.equal(r.crowd.crowds[0].mode, 'seated');
  assert.equal(r.crowd.caveat, CROWD_CAVEAT);
  // the direct ray changes by exactly 10 dB; with the floor ray also in the crowd the coherent sum moves by about 10 dB too
  const wallStep = r.waterfall.find((s) => s.label === 'Wall transmission');
  assert.equal(wallStep, undefined); // crowd loss is not reported as a wall
  near(r.pathLossDb - rb.pathLossDb, 10, 3); // coherent sum with an also-attenuated floor ray: close to 10, not exact
  assert.ok(rb.marginDb - r.marginDb > 5);
});

test('raising the antennas above the heads restores the no-crowd result', () => {
  const sc = sceneWith([crowd({ polygon: square(-5, -15, 5, -5), mode: 'standing' })]);
  sc.links[0].tx.pos.z = 6; sc.links[0].rx.pos.z = 6;
  const ref = sceneWith(); ref.links[0].tx.pos.z = 6; ref.links[0].rx.pos.z = 6;
  const r = solveLink(sc, sc.links[0]);
  assert.equal(r.crowd, undefined);
  assert.equal(r.paths[0].crowdLossDb, undefined);
  // the floor-bounce ray dips to the floor inside the crowd and is attenuated, so the coherent sum differs slightly (not bit-identical)
  near(r.marginDb, solveLink(ref, ref.links[0]).marginDb, 1);
});

test('assumptions in use lists the crowd as an assumed item and not as a wall', () => {
  const sc = sceneWith([crowd({ polygon: square(-5, -15, 5, -5), mode: 'seated' })]);
  const items = assumptionsInUse(sc);
  assert.ok(items.some((i) => i.id === 'crowd-loss' && i.flag === 'U'));
  assert.ok(!items.some((i) => i.id === 'wall-loss'));
});

// ---- scene: validation, limits, loading
test('old scenes load; crowds optional; SCHEMA_VERSION unchanged', () => {
  const sc = createDefaultScene();
  assert.equal(sc.crowds, undefined);
  assert.deepEqual(vErr(sc), []);
  assert.equal(migrateScene(sc).crowds, undefined);
  assert.equal(SCHEMA_VERSION, sc.version);
});

test('createCrowd is valid and round-trips through serialize/deserialize', () => {
  const sc = createDefaultScene(); sc.crowds = [createCrowd({ name: 'Front pit', mode: 'packed', densityPerM2: 5, headHeightM: 1.7 })];
  assert.deepEqual(vErr(sc), []);
  const back = deserialize(serialize(sc));
  assert.deepEqual(back.crowds, sc.crowds);
});

test('validation: bad mode, polygon, overrides, counts, names, duplicate ids', () => {
  const v = (mut) => { const sc = createDefaultScene(); sc.crowds = [createCrowd()]; mut(sc.crowds[0], sc); return vErr(sc); };
  assert.ok(v((c) => { c.mode = 'sitting'; }).some((e) => /crowds\[0\]\.mode/.test(e)));
  assert.ok(v((c) => { c.polygon = c.polygon.slice(0, 2); }).some((e) => /at least 3/.test(e)));
  assert.ok(v((c) => { c.polygon[0].x = NaN; }).some((e) => /polygon\[0\]\.x/.test(e)));
  assert.ok(v((c) => { c.polygon[1].y = 1e9; }).some((e) => /out of range/.test(e)));
  assert.ok(v((c) => { c.polygon = Array.from({ length: SCENE_LIMITS.maxCrowdPoints + 1 }, (_, i) => ({ x: i, y: i % 2 })); }).some((e) => /more than/.test(e)));
  assert.ok(v((c) => { c.densityPerM2 = 50; }).some((e) => /densityPerM2/.test(e)));
  assert.ok(v((c) => { c.headHeightM = 5; }).some((e) => /headHeightM/.test(e)));
  assert.ok(v((c) => { c.kDbPerM = -1; }).some((e) => /kDbPerM/.test(e)));
  assert.ok(v((c) => { c.lMaxDb = 40; }).some((e) => /lMaxDb/.test(e)));
  assert.ok(v((c) => { c.name = 'x'.repeat(81); }).some((e) => /name/.test(e)));
  assert.ok(v((c) => { c.id = '<b>'; }).some((e) => /id/.test(e)));
  assert.ok(v((c, sc) => { sc.crowds.push({ ...createCrowd(), id: c.id }); }).some((e) => /duplicate/.test(e)));
  assert.ok(v((c, sc) => { sc.crowds = Array.from({ length: SCENE_LIMITS.maxCrowds + 1 }, () => createCrowd()); }).some((e) => /more than/.test(e)));
  assert.ok(v((c, sc) => { sc.crowds = 'x'; }).some((e) => /crowds must be an array/.test(e)));
  assert.throws(() => migrateScene({ ...createDefaultScene(), crowds: Array.from({ length: SCENE_LIMITS.maxCrowds + 1 }, () => ({})) }), /crowds/);
});

test('migrate cleans crowd names', () => {
  const sc = createDefaultScene(); sc.crowds = [createCrowd({ name: '  Pit\u0007  ' })];
  assert.equal(migrateScene(sc).crowds[0].name, 'Pit');
});

// ---- actions
test('addCrowd / updateCrowd / removeCrowd / moveCrowd are undoable and clamp', () => {
  const st = createStore(createDefaultScene());
  const id = addCrowd(st, { name: 'Pit', mode: 'packed' });
  assert.ok(id);
  assert.equal(st.getScene().crowds.length, 1);
  assert.deepEqual(vErr(st.getScene()), []);
  const id2 = addCrowd(st);
  assert.notDeepEqual(st.getScene().crowds[0].polygon, st.getScene().crowds[1].polygon); // offset
  assert.equal(updateCrowd(st, id, { mode: 'seated', densityPerM2: 99, headHeightM: 0.01, lMaxDb: 80 }), true);
  const c = st.getScene().crowds[0];
  assert.equal(c.mode, 'seated'); assert.equal(c.densityPerM2, CROWD_LIMITS_DENSITY_MAX); assert.equal(c.headHeightM, 0.3); assert.equal(c.lMaxDb, 26);
  assert.equal(updateCrowd(st, id, { densityPerM2: null }), true);
  assert.equal('densityPerM2' in st.getScene().crowds[0], false);
  assert.equal(updateCrowd(st, id, { mode: 'nope', polygon: [{ x: 1, y: 1 }], name: 5 }), true); // bad fields ignored
  assert.equal(st.getScene().crowds[0].mode, 'seated'); assert.equal(st.getScene().crowds[0].polygon.length, 4);
  const before = st.getScene().crowds[0].polygon[0].x;
  assert.equal(moveCrowd(st, id, 2.5, -1), true);
  near(st.getScene().crowds[0].polygon[0].x, before + 2.5, 1e-9);
  assert.equal(moveCrowd(st, id, NaN, 0), false);
  assert.equal(updateCrowd(st, 'missing', { mode: 'seated' }), false);
  st.undo(); near(st.getScene().crowds[0].polygon[0].x, before, 1e-9);
  removeCrowd(st, id2);
  assert.equal(st.getScene().crowds.length, 1);
  st.undo(); assert.equal(st.getScene().crowds.length, 2);
  st.redo(); assert.equal(st.getScene().crowds.length, 1);
  removeCrowd(st, id);
  assert.equal(st.getScene().crowds, undefined);
  st.undo(); assert.equal(st.getScene().crowds.length, 1);
  assert.deepEqual(vErr(st.getScene()), []);
});
const CROWD_LIMITS_DENSITY_MAX = 8;

test('addCrowd stops at the limit', () => {
  const st = createStore(createDefaultScene());
  for (let i = 0; i < SCENE_LIMITS.maxCrowds; i++) assert.ok(addCrowd(st));
  assert.equal(addCrowd(st), null);
  assert.equal(st.getScene().crowds.length, SCENE_LIMITS.maxCrowds);
});

test('coalesced updates make one undo step', () => {
  const st = createStore(createDefaultScene());
  const id = addCrowd(st);
  updateCrowd(st, id, { kDbPerM: 2 }, { coalesce: 'k' }); updateCrowd(st, id, { kDbPerM: 3 }, { coalesce: 'k' });
  st.undo();
  assert.equal(st.getScene().crowds[0].kDbPerM, undefined);
});

// ---- scene diff and calibration note
test('scene diff labels crowd changes and a crowd that changes the margin', () => {
  const a = sceneWith();
  const b = structuredClone(a); b.crowds = [crowd({ name: 'Pit', polygon: square(-5, -15, 5, -5), mode: 'seated' })];
  const d = diffScenes(a, b);
  assert.equal(d.items.crowds.added.length, 1);
  assert.equal(d.items.crowds.added[0].name, 'Pit');
  assert.ok(headline(d).some((t) => /Crowds: 1 added/.test(t)));
  assert.ok(d.links[0].deltas.marginDb < -3);
  const c = sceneWith([crowd({ name: 'Pit', polygon: square(-5, -15, 5, -5), mode: 'packed' })]);
  const d2 = diffScenes(b, c);
  assert.equal(d2.items.crowds.changed[0].fields[0].label, 'Crowd "Pit" mode');
  const d3 = diffScenes(c, sceneWith([crowd({ name: 'Pit', polygon: square(-5, -15, 5, -5), mode: 'packed', headHeightM: 1.5 })]));
  assert.equal(d3.items.crowds.changed[0].fields[0].label, 'Crowd "Pit" head height (m)');
});

test('calibration notes mention crowds only when the scene has them', () => {
  const mk = (withCrowd) => {
    const sc = sceneWith(withCrowd ? [crowd({ polygon: square(-5, -15, 5, -5) })] : undefined);
    sc.measurements = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, linkId: sc.links[0].id, x: 0, y: -5 - i, z: 1, rxDbm: -70 }));
    return suggestCalibration(sc);
  };
  assert.ok(mk(true).notes.some((n) => /crowd zones/.test(n)));
  assert.ok(!mk(false).notes.some((n) => /crowd zones/.test(n)));
});
