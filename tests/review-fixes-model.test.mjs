// Review fixes: per-material candidate must beat simpler ones, single wall figure ignores overridden materials, crossings reported at 0 dB,
// diff headline for "other" changes, TV block level actions without a no-op undo step, example pulse notes and palette keywords.
// Hand anchors: a wall adds its loss once per crossing; truth brick +8 / glass +3 means a reading behind both is 11 dB low.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene, createDefaultLink } from '../js/model/scene.js';
import { predictAt, suggestCalibration, NEEDED_IMPROVEMENT_DB } from '../js/model/measurements.js';
import { solveLink } from '../js/model/rf.js';
import { diffScenes, headline } from '../js/model/scene-diff.js';
import { createStore } from '../js/store.js';
import * as AA from '../js/actionsAreas.js';
import { EXAMPLES, exampleKeywords } from '../js/examples.js';

const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} got ${a}, expected ${b} +- ${tol}`);
const omni = () => ({ type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 }, polarisation: 'vertical' });
function room(byMat, single) {
  const s = createDefaultScene(); s.environment.externalNoise = 0; s.environment.model = 'free-space'; s.environment.bodyLossDb = 0;
  const l = createDefaultLink('p2p'); s.links = [l]; l.freqMHz = 606.1; l.tx.powerDbm = 10; l.chain = [];
  l.tx.pos = { x: 0, y: 0, z: 1.5 }; l.rx.pos = { x: 10, y: 0, z: 1.5 }; l.tx.antenna = omni(); l.rx.antenna = omni();
  s.reflectors = [
    { id: 'wb', name: 'Brick wall', p1: { x: 15, y: -20 }, p2: { x: 15, y: 20 }, zMin: 0, zMax: 4, material: 'brick' },
    { id: 'wg', name: 'Glass wall', p1: { x: 30, y: -20 }, p2: { x: 30, y: 20 }, zMin: 0, zMax: 4, material: 'glass' },
  ];
  if (byMat) s.environment.wallLossAdjustByMaterialDb = byMat;
  if (single !== undefined) s.environment.wallLossAdjustDb = single;
  return s;
}
const readings = (model, truth, xs) => { const id = model.links[0].id; truth.links[0].id = id; return xs.map((x, i) => ({ id: `m${i}`, linkId: id, x, y: 0, rxDbm: predictAt(truth, id, { x, y: 0 }) })); };
const XS = [8, 12, 18, 22, 26, 33, 38, 43, 48, 52];

test('a wall crossing is reported (crossedWalls, wallLossDetail) even when an adjustment clamps its loss to 0 dB', () => {
  const s = room(undefined, -100); // far below any real wall loss: the clamp makes each crossing cost 0 dB
  s.links[0].rx.pos = { x: 20, y: 0, z: 1.5 };
  const p = solveLink(s, s.links[0]).paths[0];
  assert.deepEqual(p.crossedWalls, ['wb']);
  assert.equal(p.wallLossDetail.length, 1);
  assert.equal(p.wallLossDb, 0);
  const clear = room();
  assert.equal(solveLink(clear, clear.links[0]).paths[0].crossedWalls, undefined); // no crossing: still absent
});

test('single wall figure counts only walls of materials without an override (hand: glass +3 over brick override +8, tolerance 0.3 dB)', () => {
  const truth = room({ brick: 8, glass: 3 }), model = room({ brick: 8 });
  model.measurements = readings(model, truth, [33, 38, 43, 48]); // each crosses brick (already right) and glass (3 dB low)
  const c = suggestCalibration(model).candidates.find((x) => x.id === 'wall-loss');
  assert.ok(c.applicable);
  near(c.fitted, 3, 0.3, 'single figure'); // counting both walls would give 1.5
  assert.ok(c.afterRmsDb < 0.3, `after ${c.afterRmsDb}`);
});

test('the per-material candidate is never best unless it beats every simpler candidate by NEEDED_IMPROVEMENT_DB and the ambiguity ratio', () => {
  for (const [b, g] of [[8, 3], [8, 8.5], [8, 8], [5, 5.5]]) {
    const truth = room({ brick: b, glass: g }), model = room();
    model.measurements = readings(model, truth, XS);
    const r = suggestCalibration(model), pm = r.candidates.find((x) => x.id === 'wall-loss-by-material');
    if (pm.applicable) {
      for (const o of r.candidates.filter((x) => x.applicable && x.id !== pm.id)) {
        assert.ok(o.afterRmsDb - pm.afterRmsDb >= NEEDED_IMPROVEMENT_DB && o.afterRmsDb > pm.afterRmsDb * 1.15, `${b}/${g}: ${o.id} ${o.afterRmsDb} vs ${pm.afterRmsDb}`);
      }
    }
    if (Math.abs(b - g) < 1) assert.notEqual(r.best && r.best.id, 'wall-loss-by-material', `${b}/${g}`);
  }
  const t = room({ brick: 8, glass: 3 }), m = room();
  m.measurements = readings(m, t, XS);
  assert.equal(suggestCalibration(m).best.id, 'wall-loss-by-material'); // a real difference still wins
});

test('readings that cross no wall are not reported as "left out" of the per-material fit', () => {
  const truth = room({ brick: 8, glass: 3 }), model = room();
  model.measurements = readings(model, truth, XS);
  const r = suggestCalibration(model);
  assert.ok(!r.cautions.some((t) => /left out/.test(t)), r.cautions.join(' | '));
});

test('headline mentions a change that is only in the "other" items (TV block levels)', () => {
  const a = createDefaultScene(), b = JSON.parse(JSON.stringify(a)); b.tvBlockLevelsDbm = { 33: -60 };
  const lines = headline(diffScenes(a, b));
  assert.ok(!lines.includes('No differences.'), lines.join(' | '));
  assert.ok(lines.some((l) => /^Other settings:/.test(l)), lines.join(' | '));
  assert.deepEqual(headline(diffScenes(a, JSON.parse(JSON.stringify(a)))), ['No differences.']);
});

test('setTvBlockLevel / clearTvBlockLevels add no undo step when nothing changes', () => {
  const st = createStore(createDefaultScene());
  assert.equal(AA.clearTvBlockLevels(st), false); assert.equal(st.canUndo(), false);
  AA.setTvBlockLevel(st, 33, -60);
  assert.equal(AA.setTvBlockLevel(st, 33, -60), false); // same value again
  assert.equal(AA.setTvBlockLevel(st, '33', -60), false);
  let n = 0; while (st.canUndo()) { st.undo(); n++; }
  assert.equal(n, 1, 'one undo step only');
  AA.setTvBlockLevel(st, 33, -60);
  assert.equal(AA.setTvBlockLevel(st, 33, -55), true); // a real change still applies
});

test('per-material figures from a calibration use the shared safe-id check (prototype names refused)', () => {
  const st = createStore(createDefaultScene());
  assert.equal(AA.applyCalibration(st, { field: 'environment.wallLossAdjustByMaterialDb', fitted: { constructor: 3, 'bad name!': 2 } }), false);
  assert.ok(AA.applyCalibration(st, { field: 'environment.wallLossAdjustByMaterialDb', fitted: { brick: 3, constructor: 2 } }));
  assert.deepEqual(st.getScene().environment.wallLossAdjustByMaterialDb, { brick: 3 });
});

test('noise examples explain the spectrum pulse, steady sources say they do not pulse, palette keywords find them', () => {
  for (const e of EXAMPLES) {
    if (/^noise-|^squelch-noise-burst$/.test(e.id)) {
      assert.ok(/RF spectrum/.test(e.note) && /plan rings/.test(e.note), e.id);
      assert.ok(/pulse flicker/.test(e.keywords), e.id);
    }
    if (/^video-wall-|^tv-/.test(e.id)) assert.ok(/does not pulse/.test(e.note), e.id);
    if (/^tv-/.test(e.id)) assert.ok(/per channel/.test(e.keywords), e.id);
  }
  assert.ok(/wall material fit/.test(exampleKeywords({ id: 'measurements-x' })));
});
