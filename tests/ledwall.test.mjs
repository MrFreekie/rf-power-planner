// Video (LED) wall: noise field to receiver power, near-field clamp, directionality, construction (25a), solve output, examples.
// Preset levels are EMC limits (flag I) and construction figures are assumed (flag U).
import test from 'node:test';
import assert from 'node:assert/strict';
import { wallFieldDbuvm, wallNoiseAt, meshShieldingDb, wallConstruction, WALL_NOISE_PRESETS, WALL_CONSTRUCTIONS } from '../js/model/ledwall.js';
import * as rf from '../js/model/rf.js';
import { createDefaultScene, createReflector, validateScene } from '../js/model/scene.js';
import { videoWallScene, videoWallReport, EXAMPLES } from '../js/examples.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);
const f1 = (x) => x.toFixed(1);
const wall = (o = {}) => createReflector({ p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, zMin: 0, zMax: 5, noise: { preset: 'class-a' }, ...o });

test('presets: class B 30 / 37, class A 40 / 47 dBuV/m at 10 m, noisy = class A + 15; off is silent; custom with tilt', () => {
  near(wallFieldDbuvm({ preset: 'class-b' }, 100), 30, 0); near(wallFieldDbuvm({ preset: 'class-b' }, 600), 37, 0);
  near(wallFieldDbuvm({ preset: 'class-a' }, 100), 40, 0); near(wallFieldDbuvm({ preset: 'class-a' }, 600), 47, 0);
  near(wallFieldDbuvm({ preset: 'noisy' }, 600) - wallFieldDbuvm({ preset: 'class-a' }, 600), 15, 0);
  assert.equal(wallFieldDbuvm({ preset: 'off' }, 600), -Infinity);
  near(wallFieldDbuvm({ preset: 'custom', levelDbuvmAt10m: 35, tiltDbPerDecade: -10, bandMaxMHz: 100000 }, 6000), 25, 1e-9);
  near(wallFieldDbuvm({ preset: 'class-a' }, 10000), 47 - 40, 1e-9); // 1 decade above the 1000 MHz band edge: -40 dB per decade ... 47 - 40
  for (const p of Object.values(WALL_NOISE_PRESETS)) assert.ok(['S', 'I', 'U'].includes(p.flag));
});

test('hand value: class A, 600 MHz, isotropic antenna 10 m in front of the wall normal, 200 kHz: -86.6 dBm (tol 0.2)', () => {
  // E = 47 dBuV/m at 10 m; S = 47 - 120 - 25.76 = -98.76 dBW/m2; Ae = lambda^2/(4 pi) = -17.02 dB m2 (lambda 0.4997 m);
  // P = -115.78 dBW = -85.78 dBm in 120 kHz; +2.22 dB (200/120) = -83.56; -3 dB polarisation = -86.56 dBm (wall pattern 0 dB on the normal)
  const w = wallNoiseAt([wall()], { x: 5, y: 10, z: 2.5 }, 600, 200, () => 0);
  near(w.dbm, -86.56, 0.2); // closest point is directly in front: 10 m, on the normal
  assert.equal(w.walls[0].side, 'front');
});

test('distance law 6 dB per doubling beyond the clamp, held constant inside 3 m, antenna gain adds dB for dB, rear side loses 8 dB', () => {
  const at = (y, g = 0) => wallNoiseAt([wall()], { x: 5, y, z: 2.5 }, 600, 200, () => g).dbm;
  near(at(10) - at(20), 6.02, 0.01);
  near(at(1), at(2.5), 1e-9); near(at(3), at(1), 1e-9);
  near(at(10, 7) - at(10, 0), 7, 1e-9);
  near(at(10) - at(-10), 8, 0.01); // rear side, same distance
  const right = wall({ noise: { preset: 'class-a', facing: 'right' } });
  assert.equal(wallNoiseAt([right], { x: 5, y: 10, z: 2.5 }, 600, 200).walls[0].side, 'rear');
  assert.equal(wallNoiseAt([wall({ noise: { preset: 'off' } })], { x: 5, y: 10, z: 2.5 }, 600, 200).walls.length, 0);
  assert.equal(wallNoiseAt([createReflector()], { x: 5, y: 10, z: 2.5 }, 600, 200).dbm, -Infinity);
});

test('mesh shielding 20 log10(lambda / 2a): 10 mm at 600 MHz = 28 dB, capped at 40, zero for holes of half a wavelength or more', () => {
  const lam = 299792458 / 600e6 * 1000;
  near(meshShieldingDb(10, 600), 20 * Math.log10(lam / 20), 1e-9);
  near(meshShieldingDb(10, 600), 27.9, 0.1);
  assert.equal(meshShieldingDb(0.1, 600), 40);
  assert.equal(meshShieldingDb(lam / 2, 600), 0); assert.equal(meshShieldingDb(300, 600), 0);
  assert.ok(meshShieldingDb(10, 2400) < meshShieldingDb(10, 600)); // same hole, shorter wavelength: less shielding
});

test('construction table: solid metal 40 dB, solid plastic 6 dB (thickness scales), mesh metal = shielding, carbon 15 + SE/2 capped 30, rear losses', () => {
  const c = (id, o = {}) => wallConstruction({ construction: id, ...o }, 600);
  near(c('solid-metal').transmissionLossDb, 40, 0); near(c('solid-metal').rearLossDb, 25, 0);
  near(c('solid-plastic').transmissionLossDb, 6, 1e-9); near(c('solid-plastic', { thicknessM: 0.2 }).transmissionLossDb, 12, 1e-9);
  near(c('mesh-metal').transmissionLossDb, meshShieldingDb(10, 600), 1e-9);
  near(c('mesh-metal', { holeSizeMm: 100 }).transmissionLossDb, 7.9, 0.1);
  near(c('mesh-carbon').transmissionLossDb, 15 + 0.5 * meshShieldingDb(10, 600), 1e-9);
  near(c('mesh-plastic').transmissionLossDb, 2, 0);
  assert.ok(c('mesh-metal').reflectionLossDb < 0.05 && c('mesh-metal', { holeSizeMm: 100 }).reflectionLossDb > 0.5);
  assert.equal(wallConstruction({ material: 'metal' }, 600), null);
  assert.deepEqual(Object.keys(WALL_CONSTRUCTIONS), ['solid-metal', 'solid-plastic', 'mesh-metal', 'mesh-plastic', 'mesh-carbon']);
});

test('solveLink: the wall noise power-sums into the floor; result.wallNoise, waterfall note and warning; margin falls by the rise; off and no-noise are unchanged', () => {
  const off = videoWallReport(videoWallScene({ preset: 'off', rx: 'foh' }));
  const s = videoWallScene({ preset: 'class-a', rx: 'foh' }), r = rf.solveLink(s, s.links[0]), w = r.wallNoise;
  assert.ok(w && w.walls.length === 1);
  near(w.floorAfterDbm, 10 * Math.log10(Math.pow(10, w.floorBeforeDbm / 10) + Math.pow(10, w.dbm / 10)), 1e-9);
  near(w.riseDb, w.floorAfterDbm - w.floorBeforeDbm, 1e-9);
  near(r.marginDb, off.marginDb - w.riseDb, 1e-6);
  near(w.marginChangeDb, -w.riseDb, 1e-9);
  assert.equal(r.cascade.noiseFloorDbm, w.floorAfterDbm);
  assert.ok(r.waterfall.some((x) => /^Video wall noise/.test(x.label) && x.note));
  assert.ok(r.warnings.some((x) => /Video wall noise/.test(x)));
  const plain = createDefaultScene(); assert.equal(rf.solveLink(plain, plain.links[0]).wallNoise, null);
  near(off.marginDb, videoWallReport(videoWallScene({ preset: 'off', rx: 'foh' })).marginDb, 0);
  assert.equal(rf.solveLink(videoWallScene({ preset: 'off' }), videoWallScene({ preset: 'off' }).links[0]).warnings.some((x) => /Video wall noise/.test(x)), false);
});

test('construction in the tracer: crossing loss from the construction, reflection weaker for plastic and mesh-carbon, noise behind the wall by rear loss', () => {
  const R = (c, rx, extra) => videoWallReport(videoWallScene({ preset: 'class-a', construction: c, rx, ...extra }));
  near(R('solid-metal', 'back').wallLossDb, 40, 1e-6);
  near(R('mesh-metal', 'back').wallLossDb, meshShieldingDb(10, 606.1), 1e-6);
  near(R('mesh-metal', 'back', { holeSizeMm: 100 }).wallLossDb, meshShieldingDb(100, 606.1), 1e-6);
  near(R('mesh-carbon', 'back').wallLossDb, 15 + 0.5 * meshShieldingDb(10, 606.1), 1e-6);
  assert.ok(R('solid-metal', 'foh').reflectionDb > R('mesh-carbon', 'foh').reflectionDb + 4);
  assert.ok(R('mesh-carbon', 'foh').reflectionDb > R('solid-plastic', 'foh').reflectionDb + 8);
  near(R('mesh-metal', 'back').noiseDbm - R('solid-metal', 'back').noiseDbm, 22, 1e-6); // rear loss 3 versus 25 dB
  near(R('mesh-carbon', 'back').noiseDbm - R('solid-metal', 'back').noiseDbm, 19, 1e-6);
});

test('validation: noise block and construction are bounded', () => {
  const mk = (patch) => { const s = videoWallScene({}); Object.assign(s.reflectors[0], patch); return validateScene(s); };
  assert.equal(mk({}).ok, true);
  for (const bad of [{ noise: { preset: 'loud' } }, { noise: { levelDbuvmAt10m: 500 } }, { noise: { tiltDbPerDecade: 1e9 } }, { noise: { rearLossDb: -1 } }, { noise: { heightM: 0 } }, { noise: { facing: 'up' } }, { noise: 'class-b' }, { construction: 'wood' }, { holeSizeMm: -1 }]) assert.equal(mk(bad).ok, false, JSON.stringify(bad));
});

test('the four video wall examples quote the model', () => {
  const note = (id) => EXAMPLES.find((e) => e.id === id).note;
  const R = (o) => videoWallReport(videoWallScene(o));
  const off = R({ preset: 'off', rx: 'foh' }), b = R({ preset: 'class-b', rx: 'foh' }), bs = R({ preset: 'class-b', rx: 'side' });
  for (const v of [f1(b.noiseDbm), f1(b.riseDb), f1(off.marginDb), f1(b.marginDb), f1(bs.riseDb), f1(bs.marginDb), f1(-b.reflectionDb)]) assert.ok(note('video-wall-class-b').includes(v), v);
  const n = R({ preset: 'noisy', rx: 'foh' }), a = R({ preset: 'class-a', rx: 'foh' }), nn = R({ preset: 'noisy', rx: 'near' }), ns = R({ preset: 'noisy', rx: 'side' });
  for (const v of [f1(n.noiseDbm), f1(n.riseDb), f1(n.marginDb), f1(a.marginDb), f1(nn.marginDb), f1(ns.marginDb)]) assert.ok(note('video-wall-noisy').includes(v), v);
  for (const v of [f1(n.marginDb), f1(ns.marginDb), f1(ns.marginDb - n.marginDb), f1(b.marginDb), f1(b.marginDb - n.marginDb), f1(bs.marginDb), f1(bs.marginDb - n.marginDb), f1(bs.noiseDbm), f1(bs.riseDb)]) assert.ok(note('video-wall-fixes').includes(v), v);
  assert.notEqual(JSON.stringify(EXAMPLES.find((e) => e.id === 'video-wall-fixes').build().scene.links[0].rx.pos), JSON.stringify(EXAMPLES.find((e) => e.id === 'video-wall-noisy').build().scene.links[0].rx.pos)); // the fixes example is not the noisy scene
  const ms = videoWallScene({ preset: 'class-a', rx: 'back', sections: ['solid-metal', 'mesh-metal', 'mesh-carbon'] }), m = [0, 1, 2].map((i) => videoWallReport(ms, i)), fm = ['solid-metal', 'mesh-metal', 'mesh-carbon'].map((c) => R({ preset: 'class-a', construction: c, rx: 'foh' }));
  for (const v of [...m.map((x) => f1(x.wallLossDb)), ...m.map((x) => f1(x.noiseDbm)), ...m.map((x) => f1(x.marginDb)), f1(-fm[0].reflectionDb), f1(-fm[2].reflectionDb), f1(meshShieldingDb(100, 606.1))]) assert.ok(note('video-wall-solid-vs-mesh').includes(v), v);
  assert.deepEqual(ms.reflectors.map((w) => w.construction), ['solid-metal', 'mesh-metal', 'mesh-carbon']); assert.equal(ms.links.length, 3);
  for (const id of ['video-wall-class-b', 'video-wall-noisy', 'video-wall-fixes', 'video-wall-solid-vs-mesh']) { assert.ok(note(id).split('. ').length <= 4, id); assert.equal(validateScene(EXAMPLES.find((e) => e.id === id).build().scene).ok, true); }
});
