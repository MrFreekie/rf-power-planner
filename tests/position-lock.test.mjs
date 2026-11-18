import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { validateScene } from '../js/model/scene.js';
import { findLockable, isLocked, lockedIds } from '../js/model/lock.js';
import { setLocked } from '../js/actions.js';
import { buildExample } from '../js/examples.js';
import { serialize, deserialize } from '../js/model/scene.js';
import { encodeScene, decodeScene } from '../js/share.js';
import { diffScenes } from '../js/model/scene-diff.js';
import { duplicateRadioLink } from '../js/actionsRadio.js';

const fresh = () => createStore(buildExample('band-four-piece-people').scene);

test('locking an antenna end sets locked and unlocking drops the field', () => {
  const store = fresh();
  const id = store.getScene().links[0].rx.id;
  assert.equal(isLocked(store.getScene(), id), false);
  setLocked(store, id, true);
  assert.equal(findLockable(store.getScene(), id).locked, true);
  assert.deepEqual(lockedIds(store.getScene()), [id]);
  setLocked(store, id, false);
  assert.equal('locked' in findLockable(store.getScene(), id), false);
});

test('locked scenes validate; a non-boolean locked is rejected', () => {
  const store = fresh();
  const l = store.getScene().links[0];
  setLocked(store, l.tx.id, true);
  assert.equal(validateScene(store.getScene()).ok, true);
  const bad = structuredClone(store.getScene());
  bad.links[0].rx.locked = 'yes';
  const r = validateScene(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /locked must be true or false/.test(e)));
});

test('unknown ids are ignored', () => {
  const store = fresh();
  setLocked(store, 'nope', true);
  assert.deepEqual(lockedIds(store.getScene()), []);
});

test('lock survives undo and redo as one step', () => {
  const store = fresh();
  const id = store.getScene().links[0].tx.id;
  setLocked(store, id, true);
  store.undo();
  assert.equal(isLocked(store.getScene(), id), false);
  store.redo();
  assert.equal(isLocked(store.getScene(), id), true);
});

test('lock survives save, load and a share link', async () => {
  const store = fresh();
  const sc = store.getScene();
  setLocked(store, sc.links[0].rx.id, true);
  setLocked(store, sc.people[0].id, true);
  const file = deserialize(serialize(store.getScene()));
  assert.equal(file.links[0].rx.locked, true);
  assert.equal(file.people[0].locked, true);
  const shared = await decodeScene(await encodeScene(store.getScene()));
  assert.equal(shared.ok, true);
  assert.equal(shared.scene.links[0].rx.locked, true);
  assert.equal(shared.scene.people[0].locked, true);
});

test('compare lists a lock change under its own label', () => {
  const store = fresh();
  const before = structuredClone(store.getScene());
  setLocked(store, before.links[0].rx.id, true);
  const d = diffScenes(before, store.getScene());
  assert.ok(d.links.some((l) => l.fields.some((f) => /position lock/.test(f.label))));
});

test('a duplicated link starts unlocked', () => {
  const store = fresh();
  const l = store.getScene().links.find((q) => q.kind === 'mic' && q.txOf === undefined);
  setLocked(store, l.tx.id, true); setLocked(store, l.rx.id, true);
  const id = duplicateRadioLink(store, l.id);
  const copy = store.getScene().links.find((q) => q.id === id);
  assert.ok(copy);
  assert.notEqual(copy.tx.locked, true);
  assert.notEqual(copy.rx.locked, true);
  assert.equal(isLocked(store.getScene(), l.rx.id), true);
});

test('a locked person does not move, and a locked pack stays put when its person moves', async () => {
  const { movePerson } = await import('../js/actions.js');
  const store = fresh();
  const p = store.getScene().people.find((q) => q.micLinkId);
  const link = store.getScene().links.find((q) => q.id === p.micLinkId);
  const before = { ...link.tx.pos }, home = { ...p.pos };
  setLocked(store, link.tx.id, true);
  movePerson(store, p.id, { x: home.x + 1, y: home.y });
  const l2 = store.getScene().links.find((q) => q.id === p.micLinkId);
  assert.deepEqual(l2.tx.pos, before);
  assert.equal(store.getScene().people.find((q) => q.id === p.id).pos.x, home.x + 1);
  setLocked(store, p.id, true);
  movePerson(store, p.id, { x: home.x + 3, y: home.y });
  assert.equal(store.getScene().people.find((q) => q.id === p.id).pos.x, home.x + 1);
});
