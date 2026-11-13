import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene } from '../js/model/scene.js';

test('update is copy-on-write and notifies', () => {
  const store = createStore();
  const before = store.getScene();
  let calls = 0;
  store.subscribe(() => calls++);
  store.update((d) => { d.links[0].freqMHz = 700; });
  assert.equal(before.links[0].freqMHz, 600);
  assert.equal(store.getScene().links[0].freqMHz, 700);
  assert.notEqual(store.getScene(), before);
  assert.equal(calls, 1);
});

test('update may return a replacement; no-op updates do nothing', () => {
  const store = createStore();
  let calls = 0;
  store.subscribe(() => calls++);
  assert.equal(store.update(() => {}), false);
  assert.equal(calls, 0);
  assert.equal(store.canUndo(), false);
  store.update((d) => ({ ...d, stage: { width: 20, depth: 10 } }));
  assert.equal(store.getScene().stage.width, 20);
});

test('undo/redo', () => {
  const store = createStore();
  store.update((d) => { d.links[0].freqMHz = 700; });
  store.update((d) => { d.links[0].freqMHz = 800; });
  assert.equal(store.undo(), true);
  assert.equal(store.getScene().links[0].freqMHz, 700);
  store.undo();
  assert.equal(store.getScene().links[0].freqMHz, 600);
  assert.equal(store.undo(), false);
  assert.equal(store.canRedo(), true);
  store.redo();
  assert.equal(store.getScene().links[0].freqMHz, 700);
  store.update((d) => { d.links[0].freqMHz = 900; });
  assert.equal(store.canRedo(), false);
});

test('history is limited to 50 steps', () => {
  const store = createStore();
  for (let i = 1; i <= 80; i++) store.update((d) => { d.links[0].freqMHz = 600 + i; });
  let n = 0;
  while (store.undo()) n++;
  assert.equal(n, 50);
  assert.equal(store.getScene().links[0].freqMHz, 600 + 30);
});

test('coalesce merges consecutive updates into one undo step', () => {
  const store = createStore();
  for (let i = 1; i <= 10; i++) store.update((d) => { d.links[0].tx.pos.x = i; }, { coalesce: 'drag' });
  assert.equal(store.getScene().links[0].tx.pos.x, 10);
  store.undo();
  assert.equal(store.getScene().links[0].tx.pos.x, 4);
  assert.equal(store.canUndo(), false);
});

test('selection notifies only on change', () => {
  const store = createStore();
  const types = [];
  const off = store.subscribe((s, info) => types.push(info.type));
  store.select('a'); store.select('a'); store.select(null);
  assert.deepEqual(types, ['selection', 'selection']);
  assert.equal(store.getSelection(), null);
  off();
  store.select('b');
  assert.equal(types.length, 2);
});

test('setScene resets history by default', () => {
  const store = createStore();
  store.update((d) => { d.links[0].freqMHz = 700; });
  store.setScene(createDefaultScene());
  assert.equal(store.canUndo(), false);
  store.setScene(createDefaultScene(), { resetHistory: false });
  assert.equal(store.canUndo(), true);
});
