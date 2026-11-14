// Platform rotation (platform.rotationDeg): floor height, chords, riser faces, validation and migration.
// Convention (floor.js): (x, y) = min corner of the UNROTATED box, rotation about its centre, azimuth 0 = +y, clockwise from above.
// Tolerances: geometry 1e-9 m unless stated; solver levels 1e-9 dB when the geometry is identical.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene, createPlatform, validateScene, migrateScene } from '../js/model/scene.js';
import { floorHeightAt, floorSurfaceAt, platformBoxes, risersOf, chordsThrough, pointInPlatform } from '../js/model/floor.js';
import { solveLink } from '../js/model/rf.js';
import { createStore } from '../js/store.js';
import { updatePlatform } from '../js/actions.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (tol ${tol})`);

function sceneWith(platforms, { deck = 0 } = {}) {
  const s = createDefaultScene();
  s.environment.externalNoise = 0;
  s.stage = { width: 12, depth: 8, heightM: deck };
  s.platforms = platforms.map((p) => createPlatform(p));
  const l = s.links[0];
  l.tx.pos = { x: 1, y: 1, z: 1.5 };
  l.rx.pos = { x: 11, y: 7, z: 1.0 };
  return s;
}

test('rotation 0 (unset or explicit) equals the previous axis-aligned results exactly', () => {
  const mk = (rot) => sceneWith([{ id: 'p1', x: 4, y: 3, width: 3, depth: 2, topM: 1.0, material: 'wood', ...(rot === undefined ? {} : { rotationDeg: rot }) }]);
  const a = mk(undefined), b = mk(0);
  for (let x = 2; x <= 9; x += 0.37) for (let y = 1; y <= 6; y += 0.41) {
    assert.equal(floorHeightAt(a, x, y), floorHeightAt(b, x, y));
    assert.equal(floorSurfaceAt(a, x, y), floorSurfaceAt(b, x, y));
  }
  assert.deepEqual(chordsThrough(a, { x: 2, y: 4, z: 0.3 }, { x: 10, y: 4, z: 0.3 }), chordsThrough(b, { x: 2, y: 4, z: 0.3 }, { x: 10, y: 4, z: 0.3 }));
  // the axis-aligned faces are exactly the old ones
  const r = risersOf(a).find((f) => f.id === 'p1:s');
  assert.deepEqual([r.p1, r.p2], [{ x: 4, y: 3 }, { x: 7, y: 3 }]);
  for (const key of ['paths', 'pathLossDb', 'rxPowerDbm', 'inputPowerDbm', 'marginDb']) {
    assert.deepEqual(solveLink(a, a.links[0])[key], solveLink(b, b.links[0])[key], key);
  }
});

test('rotation 90 equals the unrotated box with width and depth swapped about the same centre', () => {
  // 4 x 2 box at (3, 2): centre (5, 3). Rotated 90 it covers x 4..6, y 1..5 = an unrotated 2 x 4 box at (4, 1).
  const rot = sceneWith([{ id: 'p1', x: 3, y: 2, width: 4, depth: 2, topM: 1.2, material: 'concrete', rotationDeg: 90 }]);
  const ref = sceneWith([{ id: 'p1', x: 4, y: 1, width: 2, depth: 4, topM: 1.2, material: 'concrete' }]);
  for (let x = 3; x <= 7; x += 0.25) for (let y = 0; y <= 6; y += 0.25) {
    if (Math.abs(x - 4) < 1e-6 || Math.abs(x - 6) < 1e-6 || Math.abs(y - 1) < 1e-6 || Math.abs(y - 5) < 1e-6) continue; // edge points are a rounding coin toss
    assert.equal(floorHeightAt(rot, x, y), floorHeightAt(ref, x, y), `${x},${y}`);
  }
  const A = { x: 1, y: 3, z: 0.4 }, B = { x: 9, y: 3.3, z: 0.6 };
  const c1 = chordsThrough(rot, A, B), c2 = chordsThrough(ref, A, B);
  assert.equal(c1.length, 1);
  near(c1[0].lengthM, c2[0].lengthM, 1e-9);
  near(c1[0].lossDb, c2[0].lossDb, 1e-9);
  const b = platformBoxes(rot).find((q) => q.id === 'p1'), r = platformBoxes(ref).find((q) => q.id === 'p1');
  for (const k of ['x0', 'y0', 'x1', 'y1']) near(b[k], r[k], 1e-9, k);
  // the solver sees the same geometry (same face set, so same multipath): identical levels
  const s1 = solveLink(rot, rot.links[0]), s2 = solveLink(ref, ref.links[0]);
  near(s1.rxPowerDbm, s2.rxPowerDbm, 1e-9);
  near(s1.pathLossDb, s2.pathLossDb, 1e-9);
  assert.equal(s1.paths.length, s2.paths.length);
});

test('rotation direction: 90 deg is clockwise from above (the +y side points to +x)', () => {
  const p = createPlatform({ x: 0, y: 0, width: 2, depth: 6, rotationDeg: 90 }); // centre (1, 3), long axis now along x
  assert.equal(pointInPlatform(p, 3.5, 3), true);
  assert.equal(pointInPlatform(p, 1, 5.5), false);
  const q = createPlatform({ x: 0, y: 0, width: 2, depth: 6, rotationDeg: 45 });
  const [c0, c1, c2, c3] = platformBoxes({ platforms: [q], environment: {}, stage: { width: 1, depth: 1, heightM: 0 } }).find((b) => b.id === q.id).corners;
  // local (0,0) corner is (-1,-3) from the centre; rotated clockwise 45: x = -1 c - 3 s = -2.828, y = +1 s - 3 c = -1.414 (about centre (1,3))
  near(c0.x, 1 - 4 / Math.SQRT2, 1e-9); near(c0.y, 3 - 2 / Math.SQRT2, 1e-9);
  assert.ok(c1 && c2 && c3);
});

test('rotated box chord: a 2 m square at 45 deg crossed through its centre along x is 2 sqrt 2 m', () => {
  const s = sceneWith([{ id: 'p1', x: 4, y: 4, width: 2, depth: 2, topM: 1.0, material: 'concrete', rotationDeg: 45 }]);
  const c = chordsThrough(s, { x: 0, y: 5, z: 0.3 }, { x: 10, y: 5, z: 0.3 });
  assert.equal(c.length, 1);
  near(c[0].lengthM, 2 * Math.SQRT2, 1e-9);
  // a ray just inside the corner tip (offset 1.3 m from the centre line > 1.414 - 0.1) is much shorter: chord = 2 (1.414 - 1.3) = 0.228
  const t = chordsThrough(s, { x: 0, y: 6.3, z: 0.3 }, { x: 10, y: 6.3, z: 0.3 });
  near(t[0].lengthM, 2 * (Math.SQRT2 - 1.3), 1e-9);
  assert.equal(chordsThrough(s, { x: 0, y: 6.5, z: 0.3 }, { x: 10, y: 6.5, z: 0.3 }).length, 0, 'beyond the corner');
});

test('rotated riser edge: a specular reflection off the 45 deg face exists and has the image-method length', () => {
  const s = sceneWith([{ id: 'p1', x: 4, y: 4, width: 2, depth: 2, topM: 1.0, material: 'concrete', rotationDeg: 45 }]);
  const face = risersOf(s).find((f) => f.id === 'p1:s');
  near(face.p1.x, 5 - Math.SQRT2, 1e-9); near(face.p1.y, 5, 1e-9);
  near(face.p2.x, 5, 1e-9); near(face.p2.y, 5 - Math.SQRT2, 1e-9);
  assert.equal(face.zMin, 0); assert.equal(face.zMax, 1);
  const l = s.links[0];
  l.tx.pos = { x: 2, y: 4, z: 0.5 };
  l.rx.pos = { x: 4, y: 2.5, z: 0.5 };
  const paths = solveLink(s, l).paths;
  const w = paths.find((p) => p.kind === 'wall' && p.via === 'p1:s');
  assert.ok(w, 'wall path via the rotated south face');
  // face line x + y = 10 - sqrt 2 = 8.586; image of tx (2,4) is (2 + k, 4 + k), k = 8.586 - 6 = 2.586 (x2 = 2 k along the normal)
  const k = 10 - Math.SQRT2 - 6;
  near(w.lengthM, Math.hypot(2 + k - 4, 4 + k - 2.5), 1e-6);
  // the unrotated box has no such path
  const s0 = structuredClone(s); s0.platforms[0].rotationDeg = 0;
  assert.ok(!solveLink(s0, s0.links[0]).paths.some((p) => p.via === 'p1:s'));
  // transmission through the rotated box: the leg from a far side crosses a chord and carries platform loss
  l.tx.pos = { x: 1, y: 5, z: 0.5 }; l.rx.pos = { x: 10, y: 5, z: 0.5 };
  const d = solveLink(s, l).paths[0];
  assert.ok(d.platformLossDb > 0);
  near(d.platformChords[0].lengthM, 2 * Math.SQRT2, 1e-9);
});

test('continuity: the chord length through a rotating box has no jumps', () => {
  const A = { x: 0, y: 5, z: 0.3 }, B = { x: 10, y: 5.2, z: 0.3 };
  let prev = null, max = 0;
  for (let deg = -180; deg <= 180; deg += 0.25) {
    const s = sceneWith([{ id: 'p1', x: 4, y: 4, width: 3, depth: 2, topM: 1.0, material: 'wood', rotationDeg: deg }]);
    const len = chordsThrough(s, A, B).reduce((a, c) => a + c.lengthM, 0);
    if (prev !== null) max = Math.max(max, Math.abs(len - prev));
    prev = len;
  }
  // d(chord)/d(angle) <= about 3 m per rad (box size / sin of the chord angle near grazing); 0.25 deg = 0.00436 rad. Allow a grazing edge.
  assert.ok(max < 0.08, 'max step ' + max);
  // 180 and -180 are the same box
  const a = sceneWith([{ id: 'p1', x: 4, y: 4, width: 3, depth: 2, topM: 1, rotationDeg: 180 }]);
  const b = sceneWith([{ id: 'p1', x: 4, y: 4, width: 3, depth: 2, topM: 1, rotationDeg: -180 }]);
  near(chordsThrough(a, A, B)[0].lengthM, chordsThrough(b, A, B)[0].lengthM, 1e-9);
});

test('overlapping rotated platforms ("stage on a stage"): highest top wins and chords merge', () => {
  const s = sceneWith([{ id: 'p1', x: 4, y: 3, width: 2, depth: 2, topM: 1.6, material: 'wood', rotationDeg: 45 }], { deck: 1.2 });
  assert.equal(floorHeightAt(s, 5, 4), 1.6);
  // the AABB corner of the rotated box lies outside it: only the deck there
  assert.equal(floorHeightAt(s, 5 - Math.SQRT2 + 0.05, 4 - Math.SQRT2 + 0.05), 1.2);
  const c = chordsThrough(s, { x: -1, y: 4, z: 0.3 }, { x: 13, y: 4, z: 0.3 });
  assert.equal(c.length, 1, 'deck and platform merged into one chord');
  assert.equal(floorSurfaceAt(s, 5, 4), 'wood');
  const r = solveLink(s, s.links[0]);
  assert.ok(Number.isFinite(r.rxPowerDbm));
});

test('validation, migration and the updatePlatform action', () => {
  const s = createDefaultScene();
  s.platforms = [createPlatform({ id: 'a' })];
  assert.equal(validateScene(s).ok, true, 'unset is valid');
  for (const v of [0, -180, 180, 33.3]) { s.platforms[0].rotationDeg = v; assert.equal(validateScene(s).ok, true, String(v)); }
  for (const v of [181, -181, NaN, '45', null]) { s.platforms[0].rotationDeg = v; assert.equal(validateScene(s).ok, false, String(v)); }
  s.platforms[0].rotationDeg = 270;
  assert.equal(migrateScene(s).platforms[0].rotationDeg, -90);
  s.platforms[0].rotationDeg = -190;
  assert.equal(migrateScene(s).platforms[0].rotationDeg, 170);
  s.platforms[0].rotationDeg = null;
  assert.equal('rotationDeg' in migrateScene(s).platforms[0], false);
  s.platforms[0].rotationDeg = 'x';
  assert.equal(validateScene(migrateScene(s)).ok, true);
  delete s.platforms[0].rotationDeg;
  assert.equal('rotationDeg' in migrateScene(s).platforms[0], false, 'old saves stay unset');
  const st = createStore(createDefaultScene());
  st.update((d) => { d.platforms = [createPlatform({ id: 'a' })]; });
  updatePlatform(st, 'a', { rotationDeg: 200 });
  assert.equal(st.getScene().platforms[0].rotationDeg, -160);
  updatePlatform(st, 'a', { rotationDeg: 360 });
  assert.equal('rotationDeg' in st.getScene().platforms[0], false, '0 stored as unset');
  updatePlatform(st, 'a', { rotationDeg: 'bad' });
  assert.equal('rotationDeg' in st.getScene().platforms[0], false);
});

test('platform materials: every selectable material has body through-loss data', async () => {
  const { PLATFORM_MATERIALS } = await import('../js/model/scene.js');
  const { PLATFORM_OBSTRUCTION, SURFACE_RISER_FACE_MATERIAL } = await import('../js/model/stage-params.js');
  for (const m of ['wood', 'concrete', 'metal', 'glass', 'brick']) assert.ok(PLATFORM_MATERIALS.includes(m), m);
  for (const m of PLATFORM_MATERIALS) {
    assert.ok(PLATFORM_OBSTRUCTION[m] && PLATFORM_OBSTRUCTION[m].body, 'obstruction ' + m);
    assert.ok(SURFACE_RISER_FACE_MATERIAL[m], 'face ' + m);
  }
  assert.ok(PLATFORM_OBSTRUCTION.brick.interfaceDb + PLATFORM_OBSTRUCTION.brick.dbPerM * 0.1 > 4.9);
});
