// Reflector name entry: spaces and full text kept, control characters dropped, limit message, empty fallback, rename by id, undo coalescing, round trip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { addReflector } from '../js/actions.js';
import { cleanName, nameOrDefault, limitMessage, renameReflector, NAME_MAX } from '../js/ui/nameInput.js';
import { serialize } from '../js/model/scene.js';
import { parseSceneText } from '../js/io.js';

test('cleanName keeps spaces and symbols, drops control characters, caps the length', () => {
  assert.equal(cleanName('Back wall (glass) 2'), 'Back wall (glass) 2');
  assert.equal(cleanName('  lead  '), '  lead  ', 'no trimming while typing');
  assert.equal(cleanName('a\tb\nc\u0000d'), 'abcd');
  assert.equal(cleanName('<b>x</b> & "q"'), '<b>x</b> & "q"');
  assert.equal(cleanName('é ü 墙'), 'é ü 墙');
  assert.equal(cleanName('x'.repeat(100)).length, NAME_MAX);
  assert.equal(cleanName(null), '');
});

test('empty names fall back to the default; the limit message appears only at the limit', () => {
  assert.equal(nameOrDefault('   ', 'Reflector 2'), 'Reflector 2');
  assert.equal(nameOrDefault('Wall', 'Reflector 2'), 'Wall');
  assert.equal(limitMessage('x'.repeat(NAME_MAX - 1)), '');
  assert.match(limitMessage('x'.repeat(NAME_MAX)), /40 characters/);
});

test('rename writes by id, so another selection cannot receive the text; typing coalesces into one undo step', () => {
  const store = createStore();
  addReflector(store); addReflector(store);
  const [a, b] = store.getScene().reflectors.map((r) => r.id);
  const before = store.getScene().reflectors.map((r) => r.name);
  for (const t of ['W', 'Wa', 'Wal', 'Wall ', 'Wall A']) renameReflector(store, a, t, { coalesce: 'insp:refl-name:1' });
  store.select(b); // the user moved on; a late event for the first field still targets the first reflector
  renameReflector(store, a, 'Wall A2', { coalesce: 'insp:refl-name:1' });
  const sc = store.getScene();
  assert.equal(sc.reflectors.find((r) => r.id === a).name, 'Wall A2');
  assert.equal(sc.reflectors.find((r) => r.id === b).name, before[1], 'the other reflector is untouched');
  store.undo();
  assert.equal(store.getScene().reflectors.find((r) => r.id === a).name, before[0], 'one undo reverts the whole typing burst');
  renameReflector(store, 'missing', 'x'); // no throw
});

test('special characters survive a save and load round trip and validate', () => {
  const store = createStore(); addReflector(store);
  const id = store.getScene().reflectors[0].id;
  renameReflector(store, id, '<img src=x onerror=alert(1)> "wall" & co');
  const sc = store.getScene();
  const back = parseSceneText(serialize(sc));
  const scene = back.scene ?? back;
  assert.equal(scene.reflectors[0].name, '<img src=x onerror=alert(1)> "wall" & co');
});
