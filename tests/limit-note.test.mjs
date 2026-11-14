import test from 'node:test';
import assert from 'node:assert/strict';
import { limitText, addOrLimit } from '../js/ui/limitNote.js';
import { SCENE_LIMITS } from '../js/model/scene.js';

test('limitText names the cap', () => {
  assert.equal(limitText('reflector'), `Limit reached (${SCENE_LIMITS.maxReflectors} reflectors).`);
  assert.equal(limitText('zone'), `Limit reached (${SCENE_LIMITS.maxZones} zones).`);
  assert.equal(limitText('transmitter'), `Limit reached (${SCENE_LIMITS.maxImdTransmitters} transmitters).`);
  assert.equal(limitText('nope'), 'Limit reached.');
});

test('addOrLimit selects a new item and shows a note when the action returns nothing', () => {
  const selected = [];
  const store = { select: (id) => selected.push(id) };
  assert.equal(addOrLimit(store, null, 'zone', () => 'z1'), 'z1');
  assert.deepEqual(selected, ['z1']);
  const made = [];
  const cls = new Set();
  const btn = { parentNode: {}, nextElementSibling: null, after: (n) => made.push(n) };
  globalThis.document = { createElement: () => ({ classList: { contains: () => false }, setAttribute() {}, remove() {} }) };
  const realTimeout = globalThis.setTimeout; globalThis.setTimeout = (f) => { return 0; };
  try {
    assert.equal(addOrLimit(store, btn, 'reflector', () => null), null);
  } finally { globalThis.setTimeout = realTimeout; delete globalThis.document; }
  assert.equal(made.length, 1); assert.equal(selected.length, 1, 'no selection change at the limit');
  void cls;
});
