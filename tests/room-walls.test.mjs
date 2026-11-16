import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { addRoomWalls } from '../js/actions.js';
import { createDefaultScene, validateScene, SCENE_LIMITS } from '../js/model/scene.js';

test('addRoomWalls adds four valid walls around the stage and audience', () => {
  const store = createStore(createDefaultScene());
  const ids = addRoomWalls(store, { material: 'brick' });
  assert.equal(ids.length, 4);
  const s = store.getScene();
  assert.deepEqual(s.reflectors.map((r) => r.name), ['Back wall', 'Front wall', 'Left wall', 'Right wall']);
  assert.ok(s.reflectors.every((r) => r.material === 'brick'));
  assert.equal(validateScene(s).ok ?? true, true);
});

test('addRoomWalls adds nothing when the reflector limit would be passed', () => {
  const store = createStore(createDefaultScene());
  for (let i = 0; i < SCENE_LIMITS.maxReflectors - 2; i++) store.update((d) => { d.reflectors.push({ ...d.reflectors[0] ?? {}, id: `r${i}`, name: 'x', material: 'wood', p1: { x: 0, y: 1 }, p2: { x: 1, y: 1 }, zMin: 0, zMax: 3 }); });
  assert.deepEqual(addRoomWalls(store), []);
});
