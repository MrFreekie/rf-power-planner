import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene, serialize } from '../js/model/scene.js';
import { parseSceneText, loadSceneFromFile, MAX_SCENE_BYTES } from '../js/io.js';

const fileOf = (text) => new Blob([text], { type: 'application/json' });

test('parseSceneText round trips a scene', () => {
  const s = createDefaultScene();
  const r = parseSceneText(serialize(s));
  assert.equal(r.ok, true);
  assert.deepEqual(r.scene, s);
});

test('parseSceneText reports errors instead of throwing', () => {
  for (const bad of ['', '{nope', 'null', '[]', '{"version":1}', JSON.stringify({ ...createDefaultScene(), version: 99 })]) {
    const r = parseSceneText(bad);
    assert.equal(r.ok, false, bad);
    assert.equal(typeof r.error, 'string');
    assert.ok(r.error.length > 0);
  }
});

test('loadSceneFromFile reads blobs, back-fills chain ids, and never rejects', async () => {
  const s = createDefaultScene();
  delete s.links[0].chain[0].id;
  const ok = await loadSceneFromFile(fileOf(JSON.stringify(s)));
  assert.equal(ok.ok, true);
  assert.ok(ok.scene.links[0].chain[0].id);
  assert.equal((await loadSceneFromFile(fileOf('garbage'))).ok, false);
  assert.equal((await loadSceneFromFile(null)).ok, false);
  assert.equal((await loadSceneFromFile({ size: MAX_SCENE_BYTES + 1 })).ok, false);
  const throwing = { size: 1, text: async () => { throw new Error('boom'); } };
  const r = await loadSceneFromFile(throwing);
  assert.equal(r.ok, false);
  assert.match(r.error, /boom/);
});
