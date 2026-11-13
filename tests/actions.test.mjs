import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene, validateScene, migrateScene, createChainItem } from '../js/model/scene.js';
import { solveLink } from '../js/model/rf.js';
import * as A from '../js/actions.js';

const mk = () => createStore(createDefaultScene());

test('setPath sets nested and array paths, undoable, no-ops on bad path', () => {
  const st = mk();
  assert.equal(A.setPath(st, 'links.0.tx.powerDbm', 20), true);
  assert.equal(st.getScene().links[0].tx.powerDbm, 20);
  A.setPath(st, 'links.0.chain.0.lengthM', 30);
  assert.equal(st.getScene().links[0].chain[0].lengthM, 30);
  assert.equal(A.setPath(st, 'links.5.tx.powerDbm', 1), false);
  assert.equal(A.setPath(st, 'links.0.nope.deep', 1), false);
  assert.equal(A.setPath(st, '__proto__.x', 1), false);
  assert.equal({}.x, undefined);
  st.undo();
  assert.equal(st.getScene().links[0].chain[0].lengthM, 15);
});

test('setPath coalesces consecutive edits into one undo step', () => {
  const st = mk();
  for (let v = 1; v <= 5; v++) A.setPath(st, 'links.0.tx.powerDbm', v, { coalesce: 'p' });
  st.undo();
  assert.equal(st.getScene().links[0].tx.powerDbm, 14);
});

test('setLinkField is relative to the link and ignores unknown ids', () => {
  const st = mk();
  const id = st.getScene().links[0].id;
  A.setLinkField(st, id, 'rx.antenna.gainDbi', 9);
  assert.equal(st.getScene().links[0].rx.antenna.gainDbi, 9);
  assert.equal(A.setLinkField(st, 'nope', 'freqMHz', 1), false);
});

test('chain add/remove/move with ids', () => {
  const st = mk();
  const id = st.getScene().links[0].id;
  assert.ok(st.getScene().links[0].chain[0].id);
  const a = A.addChainItem(st, id, { kind: 'filter', lossDb: 2 });
  const b = A.addChainItem(st, id, 'booster', 0);
  let ch = st.getScene().links[0].chain;
  assert.deepEqual(ch.map((c) => c.kind), ['booster', 'cable', 'filter']);
  assert.equal(ch[0].id, b);
  A.moveChainItem(st, id, b, 5);
  ch = st.getScene().links[0].chain;
  assert.equal(ch[2].id, b);
  A.moveChainItem(st, id, b, -1);
  assert.equal(st.getScene().links[0].chain[1].id, b);
  A.removeChainItem(st, id, a);
  assert.equal(st.getScene().links[0].chain.length, 2);
  assert.equal(validateScene(st.getScene()).ok, true);
  assert.equal(A.removeChainItem(st, id, 'missing'), false);
});

test('setUnits accepts valid values only', () => {
  const st = mk();
  A.setUnits(st, { power: 'mW', length: 'ft' });
  assert.deepEqual(st.getScene().units, { power: 'mW', length: 'ft' });
  assert.equal(A.setUnits(st, { power: 'bogus', length: 'km' }), false);
});

test('setLinkKind switches, keeps id/freq and restores edits', () => {
  const st = mk();
  const id = st.getScene().links[0].id;
  A.setPath(st, 'links.0.freqMHz', 700);
  A.setPath(st, 'links.0.tx.powerDbm', 10);
  A.setLinkKind(st, id, 'iem');
  let l = st.getScene().links[0];
  assert.equal(l.kind, 'iem'); assert.equal(l.id, id); assert.equal(l.freqMHz, 700);
  A.setLinkKind(st, id, 'mic');
  l = st.getScene().links[0];
  assert.equal(l.kind, 'mic'); assert.equal(l.tx.powerDbm, 10);
  assert.equal(A.setLinkKind(st, id, 'bad'), false);
  assert.equal(validateScene(st.getScene()).ok, true);
});

test('reflectors add/remove and resetScene', () => {
  const st = mk();
  const rid = A.addReflector(st, { name: 'Back wall' });
  assert.equal(st.getScene().reflectors[0].id, rid);
  assert.equal(validateScene(st.getScene()).ok, true);
  A.removeReflector(st, rid);
  assert.equal(st.getScene().reflectors.length, 0);
  A.setUnits(st, { power: 'mW' });
  A.setPath(st, 'links.0.freqMHz', 900);
  A.resetScene(st);
  assert.equal(st.getScene().links[0].freqMHz, 600);
  assert.equal(st.getScene().units.power, 'mW');
  st.undo();
  assert.equal(st.getScene().links[0].freqMHz, 900);
});

test('chain items get ids; migrateScene back-fills old scenes', () => {
  assert.ok(createChainItem('cable').id);
  const old = createDefaultScene();
  delete old.links[0].chain[0].id;
  old.links[0].chain.push({ kind: 'filter', lossDb: 1, id: 'dup' }, { kind: 'filter', lossDb: 1, id: 'dup' });
  assert.equal(validateScene(old).ok, true); // tolerant of missing id
  const m = migrateScene(old);
  const ids = m.links[0].chain.map((c) => c.id);
  assert.ok(ids.every((i) => typeof i === 'string' && i));
  assert.equal(new Set(ids).size, ids.length);
  old.links[0].chain[0].id = 7;
  assert.equal(validateScene(old).ok, false);
});

test('rf.js honours custom cable and custom antenna gain', () => {
  const st = mk();
  const id = st.getScene().links[0].id;
  A.setPath(st, 'links.0.chain.0', { kind: 'cable', id: 'c1', cableType: 'custom', lengthM: 50, freqLossOverrideDbPer100m: 10 });
  const s1 = st.getScene();
  const base = solveLink(s1, s1.links[0]);
  A.setPath(st, 'links.0.chain.0.freqLossOverrideDbPer100m', 20);
  const s2 = st.getScene();
  const r2 = solveLink(s2, s2.links[0]);
  assert.ok(Math.abs((base.inputPowerDbm - r2.inputPowerDbm) - 5) < 1e-6); // 50 m * 10 dB/100 m
  A.setLinkField(st, id, 'rx.antenna', { type: 'custom', gainDbi: 12, orientation: { az: 270, el: 0 } });
  const s3 = st.getScene();
  const r3 = solveLink(s3, s3.links[0]);
  const rxGain = (r) => r.paths[0].gainDb;
  assert.ok(rxGain(r3) > rxGain(r2) + 5);
});
