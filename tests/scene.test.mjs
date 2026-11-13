import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene, createDefaultLink, validateScene, serialize, deserialize,
  migrateScene, newId, SCHEMA_VERSION } from '../js/model/scene.js';

test('default scene matches spec', () => {
  const s = createDefaultScene();
  assert.equal(s.version, SCHEMA_VERSION);
  assert.deepEqual(s.stage, { width: 12, depth: 8 });
  const l = s.links[0];
  assert.equal(l.kind, 'mic');
  assert.equal(l.tx.pos.z, 1.5);
  assert.equal(l.rx.pos.z, 2.5);
  assert.equal(l.rx.antenna.type, 'paddle');
  assert.deepEqual(l.chain.map((c) => [c.kind, c.cableType, c.lengthM]), [['cable', 'rg58', 15]]);
  assert.equal(s.environment.model, 'two-ray');
});

test('default scene and iem link validate', () => {
  assert.deepEqual(validateScene(createDefaultScene()), { ok: true, errors: [] });
  const s = createDefaultScene();
  s.links = [createDefaultLink('iem')];
  assert.equal(validateScene(s).ok, true);
  assert.equal(s.links[0].kind, 'iem');
});

test('validateScene reports problems without throwing', () => {
  const s = createDefaultScene();
  s.links[0].freqMHz = -1;
  s.environment.model = 'bogus';
  s.links[0].tx.pos.x = NaN;
  const r = validateScene(s);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('freqMHz')));
  assert.ok(r.errors.some((e) => e.includes('environment.model')));
  assert.ok(r.errors.some((e) => e.includes('tx.pos.x')));
  assert.equal(validateScene(null).ok, false);
  assert.equal(validateScene({}).ok, false);
});

test('serialize/deserialize round trip', () => {
  const s = createDefaultScene();
  assert.deepEqual(deserialize(serialize(s)), s);
});

test('deserialize rejects bad input with readable errors', () => {
  assert.throws(() => deserialize('{nope'), /Invalid JSON/);
  assert.throws(() => deserialize('{"version":1}'), /Invalid scene/);
  assert.throws(() => deserialize(JSON.stringify({ ...createDefaultScene(), version: 99 })), /newer/);
});

test('migrateScene fills missing version and does not mutate input', () => {
  const s = createDefaultScene();
  delete s.version;
  const m = migrateScene(s);
  assert.equal(m.version, SCHEMA_VERSION);
  assert.equal(s.version, undefined);
});

test('newId is unique and prefixed', () => {
  const ids = new Set(Array.from({ length: 2000 }, () => newId('x')));
  assert.equal(ids.size, 2000);
  assert.ok([...ids][0].startsWith('x_'));
});

test('duplicate ids are rejected', () => {
  const s = createDefaultScene();
  s.links.push(structuredClone(s.links[0]));
  assert.ok(validateScene(s).errors.some((e) => e.includes('duplicate')));
});
