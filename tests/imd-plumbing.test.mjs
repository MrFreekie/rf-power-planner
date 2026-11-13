import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene, validateScene, migrateScene, deserialize, serialize, defaultImdTransmitters } from '../js/model/scene.js';
import { createSquelchTracker } from '../js/squelchTracker.js';
import { createImdTracker, analyse } from '../js/imdTracker.js';
import { createHistory } from '../js/history.js';
import { solveLink } from '../js/model/rf.js';
import { buildExample, EXAMPLES } from '../js/examples.js';
import * as A from '../js/actions.js';

function rig(scene) {
  const st = createStore(scene);
  const sq = createSquelchTracker();
  const im = createImdTracker();
  im.install(st, sq);
  sq.attach(st);
  return { st, sq, im, id: scene.links[0].id };
}

const rise = (id) => {
  const ex = buildExample(id);
  const l = ex.scene.links[0];
  const a = analyse(ex.scene);
  return a.noise.perChannel.find((c) => Math.abs(c.freqMHz - l.freqMHz) < 0.1).riseDb;
};

test('imd defaults, migration, round trip and validation', () => {
  const s = createDefaultScene();
  assert.equal(s.imd.enabled, false);
  assert.deepEqual(s.imd.transmitters, []);
  assert.equal(defaultImdTransmitters().length, 4);
  const old = structuredClone(s);
  delete old.imd;
  assert.equal(validateScene(old).ok, true);
  const m = migrateScene(old);
  assert.equal(m.imd.enabled, false);
  assert.equal(validateScene(m).ok, true);
  assert.deepEqual(deserialize(serialize(m)), m);
  const bad = structuredClone(m);
  bad.imd.transmitters = defaultImdTransmitters();
  assert.equal(validateScene(bad).ok, true);
  bad.imd.transmitters[0].freqMHz = -1;
  assert.equal(validateScene(bad).ok, false);
  bad.imd.transmitters[0].freqMHz = 606;
  bad.imd.combiner.type = 'magic';
  assert.equal(validateScene(bad).ok, false);
  bad.imd.combiner.type = 'hybrid';
  bad.imd.pim.preset = 'rusty';
  assert.equal(validateScene(bad).ok, false);
  bad.imd.pim.preset = 'good';
  bad.imd.transmitters[1].id = bad.imd.transmitters[0].id;
  assert.equal(validateScene(bad).ok, false);
});

test('imd actions', () => {
  const st = createStore(createDefaultScene());
  A.setImdEnabled(st, true);
  let m = st.getScene().imd;
  assert.equal(m.enabled, true);
  assert.equal(m.transmitters.length, 4); // default plan added on first use
  const near = m.transmitters[3];
  assert.ok(Math.hypot(near.pos.x - m.rxAntennaPos.x, near.pos.y - m.rxAntennaPos.y) < 1.5);
  const id = A.addImdTransmitter(st, { name: 'Extra' });
  assert.equal(st.getScene().imd.transmitters.length, 5);
  A.moveImdTransmitter(st, id, { x: 5, y: 2 }, { coalesce: 'd' });
  A.moveImdTransmitter(st, id, { x: 5.5 }, { coalesce: 'd' });
  assert.deepEqual([st.getScene().imd.transmitters[4].pos.x, st.getScene().imd.transmitters[4].pos.y], [5.5, 2]);
  A.updateImdTransmitter(st, id, { freqMHz: 610, powerDbm: 20, name: 'Z' });
  A.updateImdTransmitter(st, id, { freqMHz: -5, powerDbm: NaN });
  const t = st.getScene().imd.transmitters[4];
  assert.deepEqual([t.freqMHz, t.powerDbm, t.name], [610, 20, 'Z']);
  assert.equal(validateScene(st.getScene()).ok, true);
  A.removeImdTransmitter(st, id);
  assert.equal(st.getScene().imd.transmitters.length, 4);
  A.setImdPreset(st, 'iem-combiner-isolated');
  m = st.getScene().imd;
  assert.equal(m.preset, 'iem-combiner-isolated');
  assert.equal(m.combiner.type, 'isolated');
  assert.equal(A.setImdPreset(st, 'nope'), false);
  A.setImdCombiner(st, { type: 'hybrid', isolationDb: 12 });
  assert.deepEqual([st.getScene().imd.combiner.type, st.getScene().imd.combiner.isolationDb], ['hybrid', 12]);
  A.setImdPim(st, { preset: 'corroded', levelDbc: -60 });
  assert.deepEqual(st.getScene().imd.pim, { preset: 'corroded', levelDbc: -60 });
  A.setImdPreset(st, 'pim-corroded-connector');
  assert.equal(st.getScene().imd.pim.preset, 'corroded');
  A.setImdEnabled(st, false);
  assert.equal(st.getScene().imd.enabled, false);
  assert.equal(analyse(st.getScene()), null);
  assert.equal(validateScene(st.getScene()).ok, true);
});

test('tracker: noise rise desenses the wanted link, gate reason imd, history carries noiseRiseDb', () => {
  const ex = buildExample('imd-too-close');
  const { st, sq, im, id } = rig(ex.scene);
  const s = sq.get(id);
  assert.equal(s.open, false);
  assert.equal(s.reason, 'imd');
  assert.ok(s.desenseDb > 40);
  assert.ok(s.levelDbm - s.desenseDb < ex.scene.links[0].rx.squelch.thresholdDbm);
  const h = createHistory({ now: () => 1 });
  h.sampleOnce(st, sq, 1);
  assert.ok(h.get(id, 5)[0].noiseRiseDb > 40);
  im.recomputeNow();
  const g = im.get();
  for (const k of ['spectrum', 'noise', 'products', 'coordination', 'sweep', 'computing']) assert.ok(k in g, k);
  assert.equal(g.computing, false);
  assert.ok(g.products.length > 10);
  // moving the near mics away (a drag) removes the problem
  for (const tx of ex.scene.imd.transmitters.slice(1, 3)) A.moveImdTransmitter(st, tx.id, { x: 2, y: 6.5 });
  assert.equal(sq.get(id).reason, null);
  assert.equal(sq.get(id).open, true);
  // switching the demo off removes the desense
  A.setImdEnabled(st, false);
  assert.equal(sq.get(id).desenseDb, 0);
  im.recomputeNow();
  assert.equal(im.get(), null);
});

test('tracker is debounced and ignores selection changes', () => {
  const timeouts = [];
  const st = createStore(buildExample('imd-too-close').scene);
  const im = createImdTracker({ setTimeoutFn: (fn) => { timeouts.push(fn); return timeouts.length; }, clearTimeoutFn: () => {} });
  im.install(st, null);
  timeouts.shift()();
  assert.ok(im.get());
  const id = st.getScene().imd.transmitters[0].id;
  A.moveImdTransmitter(st, id, { x: 3 });
  A.moveImdTransmitter(st, id, { x: 3.5 });
  assert.equal(im.get().computing, true);
  const n = timeouts.length;
  st.select('x');
  assert.equal(timeouts.length, n);
  timeouts.pop()();
  assert.equal(im.get().computing, false);
});

test('imd examples validate and solve; contrasts hold (isolators, distance, frequency plan)', () => {
  const ids = ['imd-too-close', 'imd-iem-no-isolation', 'imd-iem-isolators', 'imd-move-apart', 'imd-pim', 'imd-plan-bad'];
  for (const id of ids) {
    const ex = buildExample(id);
    assert.deepEqual(validateScene(ex.scene), { ok: true, errors: [] }, id);
    assert.equal(ex.scene.imd.enabled, true);
    assert.ok(Number.isFinite(solveLink(ex.scene, ex.scene.links[0]).inputPowerDbm), id);
    assert.ok(analyse(ex.scene).products.length > 0, id);
    assert.ok(ex.scene.imd.transmitters.some((t) => Math.abs(t.freqMHz - ex.scene.links[0].freqMHz) < 0.05), id + ': link sits on one of the channels');
  }
  assert.ok(EXAMPLES.length >= 25);
  assert.ok(rise('imd-iem-no-isolation') > rise('imd-iem-isolators') + 15);
  assert.ok(rise('imd-too-close') > rise('imd-move-apart') + 30);
  // a bad plan has more products landing on channels than the retuned plan
  const bad = buildExample('imd-plan-bad').scene;
  const countHits = (scene) => analyse(scene).coordination.length;
  const good = structuredClone(bad);
  [606.0, 606.5, 610.2, 611.7].forEach((f, i) => { good.imd.transmitters[i].freqMHz = f; });
  assert.ok(countHits(bad) > countHits(good), countHits(bad) + ' vs ' + countHits(good));
  assert.equal(countHits(good), 0);
});
