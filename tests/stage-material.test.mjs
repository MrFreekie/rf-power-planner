import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene, validateScene } from '../js/model/scene.js';
import { floorSurfaceAt, platformBoxes, hasFloorFeatures } from '../js/model/floor.js';
import { createStore } from '../js/store.js';
import { setStage } from '../js/actions.js';

test('stage deck material: unset follows the venue floor, set overrides inside the stage only', () => {
  const s = createDefaultScene();
  s.environment.floor = 'concrete';
  assert.equal(hasFloorFeatures(s), false);
  assert.equal(floorSurfaceAt(s, 1, 1), 'concrete');
  s.stage.material = 'wood';
  assert.equal(hasFloorFeatures(s), true);
  assert.equal(floorSurfaceAt(s, 1, 1), 'wood');
  assert.equal(floorSurfaceAt(s, 1, -3), 'concrete');
  s.stage.heightM = 1;
  assert.equal(platformBoxes(s)[0].material, 'wood');
  assert.equal(JSON.stringify(validateScene(s)).includes('stage.material'), false);
});

test('stage.material is validated and set through setStage', () => {
  const s = createDefaultScene();
  s.stage.material = 'nonsense';
  const r = validateScene(s);
  assert.ok(JSON.stringify(r).includes('stage.material'));
  const store = createStore(createDefaultScene());
  setStage(store, { material: 'concrete' });
  assert.equal(store.getScene().stage.material, 'concrete');
  setStage(store, { material: '' });
  assert.equal('material' in store.getScene().stage, false);
  setStage(store, { material: 'bogus' });
  assert.equal('material' in store.getScene().stage, false);
});
