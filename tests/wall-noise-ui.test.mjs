// Video wall GUI: reflector construction and noise fields, budget row, plan overlay cells.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { setWallField } from '../js/actionsAreas.js';
import { budgetExtras } from '../js/ui/budgetExtras.js';
import { wallNoiseCells } from '../js/view/wallNoiseDraw.js';
import { solveLink } from '../js/model/rf.js';
import { EXAMPLES } from '../js/examples.js';
import { createDefaultScene } from '../js/model/scene.js';

const scene = () => EXAMPLES.find((e) => e.id === 'video-wall-noisy').build().scene;
const wallOf = (st) => st.getScene().reflectors.find((r) => r.noise);

test('setWallField: construction, hole size and noise fields are validated and clamped', () => {
  const st = createStore(scene()), id = wallOf(st).id;
  setWallField(st, id, 'construction', 'mesh-carbon'); assert.equal(wallOf(st).construction, 'mesh-carbon');
  setWallField(st, id, 'construction', 'bogus'); assert.equal(wallOf(st).construction, 'mesh-carbon');
  setWallField(st, id, 'holeSizeMm', 5000); assert.equal(wallOf(st).holeSizeMm, 2000);
  setWallField(st, id, 'preset', 'custom'); assert.equal(wallOf(st).noise.preset, 'custom'); assert.ok(Number.isFinite(wallOf(st).noise.levelDbuvmAt10m));
  setWallField(st, id, 'levelDbuvmAt10m', 500); assert.equal(wallOf(st).noise.levelDbuvmAt10m, 120);
  setWallField(st, id, 'tiltDbPerDecade', -99); assert.equal(wallOf(st).noise.tiltDbPerDecade, -60);
  setWallField(st, id, 'rearLossDb', 12); setWallField(st, id, 'heightM', 4); setWallField(st, id, 'facing', 'right');
  assert.deepEqual([wallOf(st).noise.rearLossDb, wallOf(st).noise.heightM, wallOf(st).noise.facing], [12, 4, 'right']);
  setWallField(st, id, 'facing', 'up'); assert.equal(wallOf(st).noise.facing, 'right');
  setWallField(st, id, 'construction', 'none'); assert.equal(wallOf(st).construction, undefined);
  setWallField(st, 'nope', 'preset', 'off'); // unknown id: no change, no throw
});

test('a noise preset change moves the budget: quiet wall off, noisy wall warns, the budget row says so', () => {
  const st = createStore(scene()), id = wallOf(st).id;
  const rowOf = () => budgetExtras(solveLink(st.getScene(), st.getScene().links[0])).find((x) => x.label === 'Video wall noise');
  assert.equal(rowOf().severity, 'warning'); assert.match(rowOf().value, /WARNING/);
  const noisy = solveLink(st.getScene(), st.getScene().links[0]).wallNoise.dbm;
  setWallField(st, id, 'preset', 'class-b');
  const quiet = solveLink(st.getScene(), st.getScene().links[0]).wallNoise.dbm;
  assert.ok(quiet < noisy - 10);
  setWallField(st, id, 'preset', 'off');
  assert.equal(rowOf(), undefined, 'no wall noise, no row');
  assert.equal(budgetExtras(solveLink(createDefaultScene(), createDefaultScene().links[0])).some((x) => x.label === 'Video wall noise'), false);
});

test('plan overlay cells follow the receiver floor and vanish with the noise', () => {
  const sc = scene(), link = sc.links[0], r = solveLink(sc, link), rect = { x0: -20, x1: 40, y0: -10, y1: 45 };
  const cells = wallNoiseCells(sc, link, r, rect, 2);
  assert.ok(cells.length > 100 && cells.some((c) => c.level === 2), 'the noisy wall raises the floor over much of the plan');
  const off = { ...sc, reflectors: sc.reflectors.map((w) => (w.noise ? { ...w, noise: { ...w.noise, preset: 'off' } } : w)) };
  assert.deepEqual(wallNoiseCells(off, link, solveLink(off, link), rect, 2), []);
  const near = wallNoiseCells(sc, link, r, rect, 2).filter((c) => c.level === 2).length, far = wallNoiseCells(sc, link, r, { x0: 200, x1: 300, y0: 200, y1: 300 }, 5).filter((c) => c.level === 2).length;
  assert.ok(near > far, 'less noise far from the wall');
});
