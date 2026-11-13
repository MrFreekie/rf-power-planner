import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import {
  createDefaultScene, createDefaultLink, validateScene, migrateScene, deserialize, serialize, createPlatform, PLATFORM_MATERIALS,
} from '../js/model/scene.js';
import { solveLink } from '../js/model/rf.js';
import { encodeScene, decodeScene } from '../js/share.js';
import { buildReportData } from '../js/reportData.js';
import { parseSceneText } from '../js/io.js';
import { createHistory } from '../js/history.js';
import { createSquelchTracker } from '../js/squelchTracker.js';
import * as A from '../js/actions.js';

const withPlatform = (over = {}) => {
  const s = createDefaultScene();
  s.platforms = [createPlatform({ id: 'p1', x: 1, y: 1, width: 3, depth: 2, topM: 0.4, ...over })];
  return s;
};

test('defaults and migration: heightM 0, platforms [], identical solve results for old scenes', () => {
  const s = createDefaultScene();
  assert.deepEqual(s.stage, { width: 12, depth: 8, heightM: 0 });
  assert.deepEqual(s.platforms, []);
  const old = structuredClone(s);
  delete old.stage.heightM;
  delete old.platforms;
  assert.equal(validateScene(old).ok, true);
  const m = migrateScene(old);
  assert.equal(m.stage.heightM, 0);
  assert.deepEqual(m.platforms, []);
  assert.equal(validateScene(m).ok, true);
  const a = solveLink(s, s.links[0]), b = solveLink(m, m.links[0]);
  assert.equal(a.inputPowerDbm, b.inputPowerDbm);
  assert.equal(a.rxPowerDbm, b.rxPowerDbm);
  assert.deepEqual(deserialize(serialize(m)), m);
});

test('validation: stage size and deck height, platform fields, limits, ids, materials', () => {
  const ok = (s) => validateScene(s).ok;
  const s = withPlatform();
  assert.equal(ok(s), true);
  for (const [path, val] of [['stage.width', 0.4], ['stage.width', 501], ['stage.depth', 0.1], ['stage.heightM', -1], ['stage.heightM', 20.5], ['stage.heightM', 'tall']]) {
    const t = structuredClone(s);
    const [o, k] = path.split('.');
    t[o][k] = val;
    assert.equal(ok(t), false, path + '=' + val);
  }
  const t0 = structuredClone(s);
  t0.stage = { width: 0.5, depth: 500, heightM: 20 };
  assert.equal(ok(t0), true); // inclusive limits
  for (const [k, v] of [['x', 2000], ['y', 'a'], ['width', 0.05], ['depth', 600], ['topM', 0], ['topM', 31], ['topM', -2], ['material', 'unobtainium'], ['name', 7]]) {
    const t = structuredClone(s);
    t.platforms[0][k] = v;
    assert.equal(ok(t), false, k + '=' + v);
  }
  const dup = structuredClone(s);
  dup.platforms.push({ ...dup.platforms[0] });
  assert.equal(ok(dup), false);
  const many = structuredClone(s);
  many.platforms = Array.from({ length: 51 }, (_, i) => createPlatform({ id: 'q' + i }));
  assert.equal(ok(many), false);
  many.platforms.pop();
  assert.equal(ok(many), true);
  const notArray = structuredClone(s);
  notArray.platforms = {};
  assert.equal(ok(notArray), false);
  for (const m of ['wood', 'concrete', 'metal', 'carpet', 'glass', 'grass', 'brick']) assert.ok(PLATFORM_MATERIALS.includes(m), m);
});

test('setStage clamps and keeps what it was not given', () => {
  const st = createStore(createDefaultScene());
  A.setStage(st, { width: 20, depth: 10, heightM: 1.2 });
  assert.deepEqual(st.getScene().stage, { width: 20, depth: 10, heightM: 1.2 });
  A.setStage(st, { width: 9999, depth: 0, heightM: 99 });
  assert.deepEqual(st.getScene().stage, { width: 500, depth: 0.5, heightM: 20 });
  A.setStage(st, { heightM: -5 });
  assert.equal(st.getScene().stage.heightM, 0);
  A.setStage(st, { width: NaN, depth: 'x' });
  assert.equal(st.getScene().stage.width, 500);
  for (let w = 10; w < 15; w++) A.setStage(st, { width: w }, { coalesce: 'sz' });
  st.undo();
  assert.equal(st.getScene().stage.width, 500);
  assert.equal(validateScene(st.getScene()).ok, true);
});

test('addPlatform defaults, update, move, resize, remove, limits', () => {
  const st = createStore(createDefaultScene());
  A.setStage(st, { heightM: 1.2 });
  const id = A.addPlatform(st);
  let p = st.getScene().platforms[0];
  assert.equal(p.id, id);
  assert.equal(p.width, 2);
  assert.equal(p.depth, 2);
  assert.ok(Math.abs(p.topM - 1.6) < 1e-9); // deck + 0.4
  assert.ok(p.x >= 0 && p.x + p.width <= st.getScene().stage.width && p.y >= 0 && p.y + p.depth <= st.getScene().stage.depth); // on the stage
  assert.equal(p.material, 'wood');
  const id2 = A.addPlatform(st, { name: 'Drum riser', width: 3, depth: 2.5, topM: 2, material: 'metal', x: 5, y: 1 });
  p = st.getScene().platforms[1];
  assert.deepEqual([p.name, p.width, p.depth, p.topM, p.material, p.x, p.y], ['Drum riser', 3, 2.5, 2, 'metal', 5, 1]);
  const id3 = A.addPlatform(st); // a further default platform is offset from the first
  assert.notEqual(st.getScene().platforms[2].x, st.getScene().platforms[0].x);
  A.removePlatform(st, id3);
  A.updatePlatform(st, id, { name: 'Riser A', material: 'carpet', topM: 99, width: -3 });
  p = st.getScene().platforms[0];
  assert.deepEqual([p.name, p.material, p.topM, p.width], ['Riser A', 'carpet', 30, 0.1]);
  A.updatePlatform(st, id, { material: 'unobtainium', name: 5, x: NaN });
  assert.equal(st.getScene().platforms[0].material, 'carpet');
  A.movePlatform(st, id, { x: 3, y: 4 }, { coalesce: 'drag' });
  A.movePlatform(st, id, { x: 3.5 }, { coalesce: 'drag' });
  p = st.getScene().platforms[0];
  assert.deepEqual([p.x, p.y], [3.5, 4]);
  st.undo();
  assert.deepEqual([st.getScene().platforms[0].x, st.getScene().platforms[0].y].length, 2);
  A.resizePlatform(st, id, { width: 4, depth: 1 });
  p = st.getScene().platforms[0];
  assert.deepEqual([p.width, p.depth], [4, 1]);
  assert.equal(A.updatePlatform(st, 'missing', { name: 'x' }), false);
  assert.equal(validateScene(st.getScene()).ok, true);
  A.removePlatform(st, id2);
  assert.deepEqual(st.getScene().platforms.map((x) => x.id), [id]);
  for (let i = 0; i < 60; i++) A.addPlatform(st);
  assert.equal(st.getScene().platforms.length, 50);
  assert.equal(A.addPlatform(st), null);
  assert.equal(validateScene(st.getScene()).ok, true);
});

test('platform selection: store selection takes platform ids; removing the selected platform clears it', () => {
  const st = createStore(createDefaultScene());
  const id = A.addPlatform(st);
  let events = 0;
  st.subscribe((_s, info) => { if (info.type === 'selection') events++; });
  st.select(id);
  assert.equal(st.getSelection(), id);
  assert.equal(events, 1);
  st.select(id);
  assert.equal(events, 1);
  A.removePlatform(st, id);
  assert.equal(st.getSelection(), null);
});

test('share link, JSON save/load and history keep the new fields', async () => {
  const s = withPlatform({ topM: 0.8 });
  s.stage.heightM = 1.2;
  const r = await decodeScene(await encodeScene(s));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.scene, s);
  const f = parseSceneText(serialize(s));
  assert.equal(f.ok, true);
  assert.equal(f.scene.platforms[0].topM, 0.8);
  assert.equal(f.scene.stage.heightM, 1.2);
  const bad = structuredClone(s);
  bad.platforms[0].topM = 99;
  assert.equal(parseSceneText(JSON.stringify(bad)).ok, false);
  // undo/redo restore platforms
  const st = createStore(createDefaultScene());
  A.addPlatform(st);
  A.setStage(st, { heightM: 2 });
  st.undo();
  assert.equal(st.getScene().stage.heightM, 0);
  assert.equal(st.getScene().platforms.length, 1);
  st.undo();
  assert.equal(st.getScene().platforms.length, 0);
  st.redo();
  assert.equal(st.getScene().platforms.length, 1);
  // the trackers keep working with platforms in the scene
  const sq = createSquelchTracker();
  const st2 = createStore(s);
  sq.attach(st2);
  const h = createHistory({ now: () => 1 });
  h.sampleOnce(st2, sq, 1);
  assert.equal(h.get(s.links[0].id, 5).length, 1);
});

test('report data: stage size with deck height, platform table, local-floor assumption', () => {
  const s = withPlatform({ name: 'Drum riser', topM: 0.8 });
  s.stage.heightM = 1.2;
  const r = buildReportData(s, s.links[0].id, { now: '2026-11-13' });
  const stage = r.scenario.find((x) => x.label === 'Stage').value;
  assert.match(stage, /12/);
  assert.match(stage, /deck 1\.20 m above ground/);
  assert.equal(r.platforms.length, 1);
  assert.equal(r.platforms[0].name, 'Drum riser');
  assert.match(r.platforms[0].text, /top 0\.80 m above ground/);
  assert.ok(r.assumptions.some((a) => /above the local floor/.test(a) && /1\.20 m above ground/.test(a)));
  assert.ok(r.assumptions.some((a) => /1 raised platform/.test(a)));
  const plain = buildReportData(createDefaultScene(), createDefaultScene().links[0].id, { now: '2026-11-13' });
  assert.deepEqual(plain.platforms, []);
  assert.ok(plain.assumptions.some((a) => /above the local floor/.test(a)));
  assert.doesNotMatch(plain.scenario.find((x) => x.label === 'Stage').value, /deck/);
  const l2 = createDefaultLink('iem');
  assert.ok(l2);
});

// ---- examples: every number quoted in the notes is checked against the solver --------------------------------------

import { buildExample } from '../js/examples.js';

const pathOf = (r, kind) => r.paths.find((p) => p.kind === kind);

test('raised-stage-null: the dip moves from 6.8 m (-46 dBm) to 5.1 m (-41 dBm) when the deck is 1.2 m', () => {
  const ex = buildExample('raised-stage-null');
  assert.deepEqual(validateScene(ex.scene), { ok: true, errors: [] });
  assert.equal(ex.scene.stage.heightM, 1.2);
  const dip = (scene) => {
    const l = scene.links[0];
    let best = [0, Infinity];
    for (let i = 0; i <= 700; i++) {
      const y = 7.5 - (3.5 * i) / 700; // distances 4.5 to 8 m: the region of the dip
      l.tx.pos = { x: 6, y, z: 1.75 };
      const v = solveLink(scene, l).inputPowerDbm;
      if (v < best[1]) best = [12 - y, v];
    }
    return best;
  };
  const deck = dip(structuredClone(ex.scene));
  const ground = structuredClone(ex.scene);
  ground.stage.heightM = 0;
  const flat = dip(ground);
  assert.ok(Math.abs(deck[0] - 5.1) < 0.2 && Math.abs(deck[1] + 40.8) < 0.5, deck.join(','));
  assert.ok(Math.abs(flat[0] - 6.8) < 0.2 && Math.abs(flat[1] + 46.3) < 0.5, flat.join(','));
  assert.ok(deck[1] > ex.scene.links[0].rx.squelch.thresholdDbm, 'the squelch stays open on the deck');
  assert.ok(flat[1] < ex.scene.links[0].rx.squelch.thresholdDbm, 'and closes at 6.8 m on the ground');
});

test('drum-riser: the floor bounce reflects from the riser and is about 14.6 dB weaker', () => {
  const ex = buildExample('drum-riser');
  assert.deepEqual(validateScene(ex.scene), { ok: true, errors: [] });
  assert.equal(ex.scene.platforms.length, 1);
  assert.equal(ex.scene.platforms[0].topM, 1.6);
  const l = ex.scene.links[0];
  const withR = solveLink(ex.scene, l);
  const bare = structuredClone(ex.scene);
  bare.platforms = [];
  const without = solveLink(bare, l);
  assert.ok(Math.abs(pathOf(withR, 'floor').relDb + 41.6) < 0.2 && Math.abs(pathOf(without, 'floor').relDb + 26.9) < 0.2);
  assert.ok(Math.abs(pathOf(without, 'floor').relDb - pathOf(withR, 'floor').relDb - 14.6) < 0.2);
  assert.ok(Math.abs(withR.inputPowerDbm + 35.9) < 0.2 && Math.abs(without.inputPowerDbm + 36.1) < 0.2);
});

test('audience-vs-stage: deck costs 1.9 dB, a wooden riser 3.6 dB more, a metal one 5.8 dB', () => {
  const ex = buildExample('audience-vs-stage');
  assert.deepEqual(validateScene(ex.scene), { ok: true, errors: [] });
  const l = ex.scene.links[0];
  const noRiser = structuredClone(ex.scene);
  noRiser.platforms = [];
  const flat = structuredClone(noRiser);
  flat.stage.heightM = 0;
  const metal = structuredClone(ex.scene);
  metal.platforms[0].material = 'metal';
  const a = solveLink(flat, l).inputPowerDbm, b = solveLink(noRiser, l).inputPowerDbm, c = solveLink(ex.scene, l).inputPowerDbm, d = solveLink(metal, l).inputPowerDbm;
  assert.ok(Math.abs(a + 36.6) < 0.2 && Math.abs(b + 38.5) < 0.2 && Math.abs(c + 42.1) < 0.2, [a, b, c].join(','));
  assert.ok(Math.abs(b - c - 3.6) < 0.3 && Math.abs(b - d - 5.8) < 0.3);
  const directLoss = pathOf(solveLink(noRiser, l), 'direct').gainDb - pathOf(solveLink(ex.scene, l), 'direct').gainDb;
  assert.ok(Math.abs(directLoss - 3.6) < 0.3);
});
