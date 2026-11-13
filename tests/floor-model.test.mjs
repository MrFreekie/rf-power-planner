import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene, createDefaultLink } from '../js/model/scene.js';
import {
  floorHeightAt, floorSurfaceAt, withAbsoluteHeights, platformBoxes, risersOf, chordsThrough, obstructionParams, hasFloorFeatures,
} from '../js/model/floor.js';
import { solveLink, tracePaths, solveBranches, fsplDb } from '../js/model/rf.js';
import { SURFACE_RISER_FACE_MATERIAL, PLATFORM_OBSTRUCTION, PLATFORM_BODY, platformThroughLossDb } from '../js/model/stage-params.js';
import { MATERIALS } from '../js/model/library.js';
import { coverageGrid } from '../js/model/coverage.js';

const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} got ${a}, want ${b} +/- ${tol}`);
const OMNI = { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 0 } };

function mk({ model = 'two-ray', stageH, platforms, tx = { x: 2, y: 2, z: 1.5 }, rx = { x: 8, y: 5, z: 1.0 }, reflectors = [] } = {}) {
  const scene = createDefaultScene();
  scene.environment = { ...scene.environment, model, fadeMarginDb: 0, bodyLossDb: 0, floor: 'wood' };
  scene.reflectors = reflectors;
  if (stageH !== undefined) scene.stage = { ...scene.stage, heightM: stageH };
  if (platforms !== undefined) scene.platforms = platforms;
  const link = createDefaultLink('mic');
  link.freqMHz = 600;
  link.tx = { ...link.tx, powerDbm: 10, pos: { ...tx }, antenna: { ...OMNI } };
  link.rx = { ...link.rx, pos: { ...rx }, antenna: { ...OMNI }, bodyLossDb: 0, sensitivityDbm: -95 };
  link.chain = [];
  scene.links = [link];
  return { scene, link };
}
const plat = (id, x, y, width, depth, topM, material = 'wood') => ({ id, name: id, x, y, width, depth, topM, material });

test('floorHeightAt / floorSurfaceAt: deck, platform on deck, stacked platforms, edges, outside', () => {
  const { scene } = mk({ stageH: 1.2, platforms: [plat('riser', 3, 2, 2, 2, 1.6, 'concrete'), plat('top', 3.5, 2.5, 1, 1, 2.0, 'metal'), plat('apron', 14, 1, 2, 2, 0.4)] });
  assert.equal(floorHeightAt(scene, 1, 1), 1.2); // deck
  assert.equal(floorHeightAt(scene, 4, 3), 2.0);
  assert.equal(floorHeightAt(scene, 3.1, 2.1), 1.6); // on the lower riser only
  assert.equal(floorHeightAt(scene, 15, 2), 0.4); // platform outside the stage
  assert.equal(floorHeightAt(scene, 13, 2), 0); // ground
  assert.equal(floorHeightAt(scene, 0, 0), 1.2); // deck corner inclusive
  assert.equal(floorHeightAt(scene, 12, 8), 1.2);
  assert.equal(floorHeightAt(scene, 12.01, 4), 0);
  assert.equal(floorHeightAt(scene, 3, 2), 1.6); // platform edge inclusive
  // surfaces
  assert.equal(floorSurfaceAt(scene, 1, 1), 'wood'); // deck uses environment.floor
  assert.equal(floorSurfaceAt(scene, 3.1, 2.1), 'concrete');
  assert.equal(floorSurfaceAt(scene, 4, 3), 'metal'); // the topmost body supplies the surface
  assert.equal(floorSurfaceAt(scene, 13, 2), 'wood');
  // a platform lower than the deck does not change anything
  const low = mk({ stageH: 1.2, platforms: [plat('low', 3, 2, 2, 2, 0.8, 'metal')] }).scene;
  assert.equal(floorHeightAt(low, 4, 3), 1.2);
  assert.equal(floorSurfaceAt(low, 4, 3), 'wood');
  // flat scenes
  const flat = mk().scene;
  assert.equal(hasFloorFeatures(flat), false);
  assert.equal(floorHeightAt(flat, 5, 5), 0);
  assert.equal(floorSurfaceAt(flat, 5, 5), 'wood');
});

test('withAbsoluteHeights: same object when flat, idempotent and cached otherwise, original untouched', () => {
  const flat = mk().scene;
  assert.equal(withAbsoluteHeights(flat), flat);
  const f2 = mk({ stageH: 0, platforms: [] }).scene;
  assert.equal(withAbsoluteHeights(f2), f2);
  const { scene, link } = mk({ stageH: 1.2, platforms: [plat('riser', 5, 4, 2, 2, 1.6)] });
  const abs = withAbsoluteHeights(scene);
  assert.notEqual(abs, scene);
  assert.equal(withAbsoluteHeights(scene), abs); // cached
  assert.equal(withAbsoluteHeights(abs), abs); // idempotent: no double shift
  near(abs.links[0].tx.pos.z, 1.2 + 1.5, 1e-12);
  near(abs.links[0].rx.pos.z, 1.2 + 1.0, 1e-12);
  assert.equal(link.tx.pos.z, 1.5); // the input scene is not mutated
  assert.equal(scene.links[0].rx.pos.z, 1.0);
  // an item standing on the riser (top 1.6) is at 1.6 + its height
  scene.links[0].rx.pos = { x: 6, y: 5, z: 1.0 };
  const abs2 = withAbsoluteHeights({ ...scene, links: scene.links });
  near(abs2.links[0].rx.pos.z, 2.6, 1e-12);
  // branches and imd transmitters
  const s3 = mk({ stageH: 1.2, platforms: [] }).scene;
  s3.links[0].branches = [{ id: 'b', pos: { x: 3, y: 3, z: 2 }, antenna: OMNI, chain: [] }];
  s3.imd = { transmitters: [{ id: 't', pos: { x: 3, y: 3, z: 1 } }], rxAntennaPos: { x: 20, y: 3, z: 1 } };
  const a3 = withAbsoluteHeights(s3);
  near(a3.links[0].branches[0].pos.z, 3.2, 1e-12);
  near(a3.imd.transmitters[0].pos.z, 2.2, 1e-12);
  near(a3.imd.rxAntennaPos.z, 1, 1e-12); // outside the deck: ground
});

test('default scenes: stage.heightM 0 and empty platforms give results identical to the scene without them', () => {
  for (const kind of ['mic', 'iem']) {
    const a = createDefaultScene();
    const l = createDefaultLink(kind); a.links = [l];
    const b = JSON.parse(JSON.stringify(a));
    b.stage.heightM = 0; b.platforms = [];
    assert.deepEqual(solveLink(b, b.links[0]), solveLink(a, a.links[0]));
  }
  // known flat values stay (free space 10 dBm, 10 m at 600 MHz)
  const { scene, link } = mk({ model: 'free-space', tx: { x: 0, y: 0, z: 1.5 }, rx: { x: 0, y: 10, z: 1.5 } });
  near(solveLink(scene, link).inputPowerDbm, 10 - fsplDb(10, 600), 1e-9);
});

test('mic 1.5 m above a 1.2 m deck, rx 1.0 above it: two-ray equals the flat-floor scene (plane raised)', () => {
  const flat = mk();
  const deck = mk({ stageH: 1.2, platforms: [] });
  const rf = solveLink(flat.scene, flat.link), rd = solveLink(deck.scene, deck.link);
  assert.equal(rd.paths.length, rf.paths.length); // risers add no paths: their top is below every ray
  near(rd.inputPowerDbm, rf.inputPowerDbm, 1e-9);
  near(rd.pathLossDb, rf.pathLossDb, 1e-9);
  const fl = rd.paths.find((p) => p.kind === 'floor');
  near(fl.reflections[0].point.z, 1.2, 1e-12); // the reflecting plane is the deck surface
  // same shape with a platform under both
  const p = mk({ platforms: [plat('big', 0, 0, 12, 8, 0.7)] });
  near(solveLink(p.scene, p.link).inputPowerDbm, rf.inputPowerDbm, 1e-9);
  // the surface material comes from the platform (concrete reflects differently from wood)
  const c = mk({ platforms: [plat('big', 0, 0, 12, 8, 0.7, 'concrete')] });
  const rc = solveLink(c.scene, c.link);
  assert.ok(Number.isFinite(rc.inputPowerDbm));
  const g = rc.paths.find((q) => q.kind === 'floor');
  assert.ok(g);
});

test('Tx on the deck, Rx on the ground in front: the specular plane is the ground (iterated), geometry by hand', () => {
  // deck 12 x 8, tx at (6,2) 1.5 above the deck (abs 2.7), rx at (6,12) 1.5 above the ground
  const { scene, link } = mk({ stageH: 1.2, platforms: [], tx: { x: 6, y: 2, z: 1.5 }, rx: { x: 6, y: 12, z: 1.5 } });
  const paths = tracePaths(scene, link);
  const fl = paths.filter((p) => p.kind === 'floor').find((p) => p.reflections[0].point.z === 0);
  assert.ok(fl);
  // plane h = 1.2 would put the bounce at y = 2 + 10 * 1.5/1.8 = 10.33 (off the deck, ground): iterate -> plane 0
  // plane 0: tx 2.7, rx 1.5: bounce at y = 2 + 10 * 2.7/4.2 = 8.4286, z = 0
  const H = fl.reflections[0].point;
  near(H.z, 0, 1e-12);
  near(H.y, 2 + 10 * 2.7 / 4.2, 1e-9);
  near(fl.lengthM, Math.hypot(10, 2.7 + 1.5), 1e-9); // image distance sqrt(100 + 4.2^2) = 10.846
  near(fl.lengthM, 10.8463, 1e-3);
  // both on the deck: plane at the deck, bounce at the mid (equal heights) y = 4, z = 1.2, length sqrt(16 + 3^2) = 5
  const on = mk({ stageH: 1.2, platforms: [], tx: { x: 6, y: 2, z: 1.5 }, rx: { x: 6, y: 6, z: 1.5 } });
  const f2 = tracePaths(on.scene, on.link).find((p) => p.kind === 'floor');
  near(f2.reflections[0].point.z, 1.2, 1e-12);
  near(f2.reflections[0].point.y, 4, 1e-9);
  near(f2.lengthM, 5, 1e-9);
  // the direct path is between absolute points
  near(tracePaths(scene, link)[0].lengthM, Math.hypot(10, 2.7 - 1.5), 1e-9);
  // a receiver below the platform surface at the specular point has no floor path (rx hidden): plane above the rx
  const hidden = mk({ stageH: 0, platforms: [plat('p', 5, 4, 2, 4, 3)], tx: { x: 6, y: 1, z: 1.5 }, rx: { x: 6, y: 12, z: 1.5 } });
  assert.ok(solveLink(hidden.scene, hidden.link).paths.length >= 1);
});

test('platform obstruction: chord length through a 1.0 m by 2.0 m platform, loss = interface + dB/m x chord', () => {
  const P = plat('pf', 4, 3, 1, 2, 1.0); // x 4..5, y 3..5, top 1.0
  const { scene, link } = mk({ model: 'free-space', platforms: [P], tx: { x: 4.5, y: 1, z: 0.5 }, rx: { x: 4.5, y: 7, z: 0.5 } });
  const [iface, perM] = obstructionParams('wood');
  // along y through the 2 m depth at z 0.5
  const ch = chordsThrough(scene, { x: 4.5, y: 1, z: 0.5 }, { x: 4.5, y: 7, z: 0.5 });
  assert.equal(ch.length, 1);
  near(ch[0].lengthM, 2.0, 1e-9);
  near(ch[0].lossDb, iface + perM * 2, 1e-9);
  // along x through the 1 m width
  near(chordsThrough(scene, { x: 2, y: 4, z: 0.5 }, { x: 8, y: 4, z: 0.5 })[0].lengthM, 1.0, 1e-9);
  // above the platform: nothing; beside it: nothing
  assert.equal(chordsThrough(scene, { x: 4.5, y: 1, z: 1.5 }, { x: 4.5, y: 7, z: 1.5 }).length, 0);
  assert.equal(chordsThrough(scene, { x: 6, y: 1, z: 0.5 }, { x: 6, y: 7, z: 0.5 }).length, 0);
  // a leg lying on the top surface does not count as inside
  assert.equal(chordsThrough(scene, { x: 4.5, y: 3.5, z: 1.0 }, { x: 4.5, y: 4.5, z: 1.0 }).length, 0);
  // oblique: from (4.5,1,0) to (4.5,7,1.2): z at y=3 is 0.4 (inside), at y=5 it is 0.8 (inside): chord = 2 * sqrt(1 + 0.2^2)
  near(chordsThrough(scene, { x: 4.5, y: 1, z: 0 }, { x: 4.5, y: 7, z: 1.2 })[0].lengthM, 2 * Math.hypot(1, 0.2), 1e-9);
  // solveLink: the direct path (free space) carries the platform loss, waterfall step and fields
  const flat = mk({ model: 'free-space', tx: { x: 4.5, y: 1, z: 0.5 }, rx: { x: 4.5, y: 7, z: 0.5 } });
  const r = solveLink(scene, link), r0 = solveLink(flat.scene, flat.link);
  near(r0.inputPowerDbm - r.inputPowerDbm, iface + perM * 2, 1e-9);
  near(r.paths[0].platformLossDb, iface + perM * 2, 1e-9);
  near(r.paths[0].wallLossDb, iface + perM * 2, 1e-9);
  assert.equal(r.paths[0].platformChords[0].id, 'pf');
  const step = r.waterfall.find((w) => w.label === 'Platform obstruction');
  near(step.deltaDb, -(iface + perM * 2), 1e-9);
  assert.ok(!r.waterfall.some((w) => w.label === 'Wall transmission'));
  near(r.waterfall.reduce((acc, w) => acc + w.deltaDb, r.waterfall[0].valueDbm), r.inputPowerDbm, 1e-9);
  // deck and a platform on it overlap: one merged chord, one interface
  const dk = mk({ model: 'free-space', stageH: 1.2, platforms: [plat('on', 4, 3, 1, 2, 1.6)], tx: { x: 4.5, y: 12, z: 0.5 }, rx: { x: 4.5, y: 12, z: 0.5 } });
  const c2 = chordsThrough(dk.scene, { x: 4.5, y: -2, z: 0.5 }, { x: 4.5, y: 10, z: 0.5 });
  assert.equal(c2.length, 1);
  near(c2[0].lengthM, 8, 1e-9); // the deck is 8 m deep; the platform lies inside it
});

test('risers: faces of platforms and the deck, zMin at the lower surface, not stored, reflect like walls', () => {
  const { scene, link } = mk({ platforms: [plat('pf', 4, 3, 2, 2, 1.0)], tx: { x: 2, y: 0, z: 0.5 }, rx: { x: 8, y: 0, z: 0.5 } });
  const rs = risersOf(scene);
  assert.equal(rs.length, 4);
  for (const r of rs) { assert.equal(r.riser, true); assert.equal(r.zMin, 0); assert.equal(r.zMax, 1.0); assert.equal(r.material, 'wood'); }
  assert.deepEqual(scene.reflectors, []); // never stored
  assert.deepEqual(rs.find((r) => r.id === 'pf:s').p1, { x: 4, y: 3 });
  // reflection off the south face (y = 3): image of tx (2,0) is (2,6); line to rx (8,0) crosses y = 3 at x = 5, z = 0.5
  const w = tracePaths(scene, link).find((p) => p.kind === 'wall' && p.via === 'pf:s');
  assert.ok(w);
  const H = w.reflections[0].point;
  near(H.x, 5, 1e-9); near(H.y, 3, 1e-9); near(H.z, 0.5, 1e-9);
  near(w.lengthM, Math.hypot(6, 6), 1e-9);
  // reflection coefficient comes from the riser material (it is part of the solved result)
  const res = solveLink(scene, link);
  assert.ok(res.paths.some((p) => p.via === 'pf:s'));
  // riser crossings add no wall loss of their own (the obstruction chord covers it)
  assert.equal(res.paths[0].wallLossDb, undefined);
  // deck faces: zMin = ground outside, zMax = deck height
  const dk = mk({ stageH: 1.2, platforms: [plat('on', 4, 3, 2, 2, 1.6, 'concrete'), plat('under', 8, 1, 1, 1, 1.0)] }).scene;
  const rd = risersOf(dk);
  const deck = rd.filter((r) => r.id.startsWith('stage-deck'));
  assert.equal(deck.length, 4);
  for (const r of deck) { assert.equal(r.zMin, 0); assert.equal(r.zMax, 1.2); }
  const on = rd.filter((r) => r.id.startsWith('on:'));
  assert.equal(on.length, 4);
  for (const r of on) { assert.equal(r.zMin, 1.2); assert.equal(r.zMax, 1.6); assert.equal(r.material, 'concrete'); } // starts at the deck
  assert.equal(rd.filter((r) => r.id.startsWith('under:')).length, 0); // top below the deck: no faces
  assert.deepEqual(risersOf(mk().scene), []);
  assert.equal(platformBoxes(mk().scene).length, 0);
  assert.equal(platformBoxes(dk).length, 3);
});

test('coverageGrid: rxHeight relative to the local floor; cells equal solveBranches; deck changes the field', () => {
  const { scene, link } = mk({ stageH: 1.2, platforms: [plat('pf', 4, 3, 2, 2, 1.6)] });
  scene.links[0].branches = [{ id: 'a', name: 'a', chain: [], antenna: { ...OMNI }, pos: { x: 1, y: 1, z: 2 } }];
  const g = coverageGrid(scene, link.id, { cellM: 2, rxHeight: 1.5, bounds: { x0: 0, y0: 0, x1: 14, y1: 10 } });
  assert.equal(g.done, true);
  for (const [i, j] of [[0, 0], [2, 1], [5, 3], [6, 4], [3, 2]]) {
    const pt = { x: i * 2 + 1, y: j * 2 + 1, z: 1.5 };
    near(g.levelDbm[j * g.nx + i], solveBranches(scene, link, pt).combinedDbm, 2e-4, `cell ${i},${j}`);
  }
  // the same relative heights over a flat floor give a different field (heights above ground differ off the deck)
  const flat = mk();
  flat.scene.links[0].branches = JSON.parse(JSON.stringify(scene.links[0].branches));
  const gf = coverageGrid(flat.scene, flat.link.id, { cellM: 2, rxHeight: 1.5, bounds: { x0: 0, y0: 0, x1: 14, y1: 10 } });
  let differ = 0;
  for (let k = 0; k < g.levelDbm.length; k++) if (Math.abs(g.levelDbm[k] - gf.levelDbm[k]) > 1e-3) differ++;
  assert.ok(differ > 5);
});


test('deck edge: no phantom reflection, weights by Fresnel-zone fraction, smooth across the boundary', () => {
  const build = (depth, ry) => {
    const m = mk({ stageH: 1.2, platforms: [], tx: { x: 6, y: 2, z: 1.5 }, rx: { x: 6, y: ry, z: 1.5 } });
    m.scene.stage.depth = depth;
    return m;
  };
  const floors = (m) => tracePaths(m.scene, m.link).filter((p) => p.kind === 'floor');
  // deck all the way past the receiver: one reflection from the deck at full weight
  const full = floors(build(20, 12));
  assert.equal(full.length, 1);
  assert.equal(full[0].floorFraction, undefined);
  near(full[0].reflections[0].point.z, 1.2, 1e-12);
  // deck ends at y = 8 (before the ground bounce at 8.43): the 1.2 m plane at y = 10.33 is beyond the deck -> its path is gone
  // or has a small weight, and the ground plane carries the reflection
  const d8 = floors(build(8, 12));
  const ground = d8.find((p) => p.reflections[0].point.z === 0);
  assert.ok(ground);
  near(ground.reflections[0].point.y, 2 + 10 * 2.7 / 4.2, 1e-9);
  for (const p of d8.filter((q) => q.reflections[0].point.z === 1.2)) assert.ok(p.floorFraction < 0.5); // never a full-strength phantom
  // edge at 9 (the repro: a deck that is not under the 1.2 m specular point at 10.33): the deck-plane path is weighted < 0.5
  const d9 = floors(build(9, 12));
  const phantom = d9.find((p) => p.reflections[0].point.z === 1.2);
  if (phantom) { assert.ok(phantom.floorFraction < 0.5); near(phantom.reflections[0].point.y, 2 + 10 * 1.5 / 1.8, 1e-9); }
  // continuity: moving the receiver 2 cm at a time across the switch of candidate planes never jumps the summed floor level by
  // more than ~1.5 dB (a hard plane switch used to jump by 10 dB or more)
  for (const depth of [8.5, 9, 10]) {
    let prev = null, maxJump = 0;
    for (let ry = 11.5; ry <= 12.5001; ry += 0.02) {
      const m = build(depth, ry);
      const r = solveLink(m.scene, m.link);
      const fl = r.paths.filter((p) => p.kind === 'floor');
      const pw = fl.reduce((acc, p) => acc + Math.pow(10, p.relDb / 10), 0);
      const lvl = 10 * Math.log10(pw);
      if (prev !== null) maxJump = Math.max(maxJump, Math.abs(lvl - prev));
      prev = lvl;
    }
    assert.ok(maxJump < 1.5, `depth ${depth}: jump ${maxJump.toFixed(2)} dB`);
  }
});

test('obstruction loss: stage-params body law with frequency exponent and cap; fallback figures', () => {
  const P = plat('pf', 4, 3, 1, 2, 1.0, 'wood');
  const { scene } = mk({ model: 'free-space', platforms: [P] });
  const A = { x: 4.5, y: 1, z: 0.5 }, B = { x: 4.5, y: 7, z: 0.5 };
  const body = PLATFORM_OBSTRUCTION.wood.body;
  near(chordsThrough(scene, A, B, 600)[0].lossDb, platformThroughLossDb(body, 2, 600), 1e-9);
  near(chordsThrough(scene, A, B, 1200)[0].lossDb, platformThroughLossDb(body, 2, 1200), 1e-9);
  const b = PLATFORM_BODY[body];
  near(chordsThrough(scene, A, B, 1200)[0].lossDb / chordsThrough(scene, A, B, 600)[0].lossDb, Math.pow(2, b.freqExponent), 1e-9);
  // cap: a 40 m chord would exceed maxLossDb
  const long = mk({ model: 'free-space', platforms: [plat('long', 0, 0, 100, 2, 1.0)] }).scene;
  assert.equal(chordsThrough(long, { x: -5, y: 1, z: 0.5 }, { x: 105, y: 1, z: 0.5 })[0].lossDb, b.maxLossDb);
  // concrete body: much heavier per metre
  const conc = mk({ model: 'free-space', platforms: [plat('c', 4, 3, 1, 2, 1.0, 'concrete')] }).scene;
  assert.ok(chordsThrough(conc, A, B)[0].lossDb > chordsThrough(scene, A, B)[0].lossDb);
  // the built-in fallback matches the default hollow wooden deck: 3 dB + 1 dB/m
  assert.deepEqual(obstructionParams('wood'), [3, 1]);
  assert.deepEqual(obstructionParams('unknown-surface'), [3, 1]);
});

test('riser faces use the surface-to-face material table (carpet is not a reflector material)', () => {
  const { scene } = mk({ stageH: 1.2, platforms: [plat('cp', 3, 2, 2, 2, 1.6, 'carpet')] });
  scene.environment.floor = 'carpet';
  const rs = risersOf(scene);
  assert.ok(rs.length > 0);
  for (const r of rs) {
    assert.ok(MATERIALS[r.material], `${r.id} material ${r.material} is a known reflector material`);
    assert.equal(r.material, SURFACE_RISER_FACE_MATERIAL.carpet);
  }
  // wood stays wood
  const w = risersOf(mk({ platforms: [plat('pw', 3, 2, 2, 2, 1.0, 'wood')] }).scene);
  assert.equal(w[0].material, SURFACE_RISER_FACE_MATERIAL.wood);
});
