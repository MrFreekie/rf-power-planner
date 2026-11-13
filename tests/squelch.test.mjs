import test from 'node:test';
import assert from 'node:assert/strict';
import { squelchState } from '../js/model/squelch.js';
import { createSquelchTracker } from '../js/squelchTracker.js';
import { createStore } from '../js/store.js';
import { createDefaultScene, validateScene, migrateScene } from '../js/model/scene.js';
import { setLinkField, setPath } from '../js/actions.js';

const q = { enabled: true, thresholdDbm: -90, hysteresisDb: 4 };

test('squelch hysteresis', () => {
  assert.equal(squelchState(false, -91, q).open, false);
  assert.equal(squelchState(false, -90, q).open, true);
  assert.equal(squelchState(true, -93, q).open, true);   // inside hysteresis band
  assert.equal(squelchState(true, -94.1, q).open, false);
  assert.equal(squelchState(false, -92, q).open, false); // closed stays closed in band
  assert.equal(squelchState(false, -80, q).headroomDb, 10);
  assert.equal(squelchState(false, -200, { ...q, enabled: false }).open, true);
  assert.equal(squelchState(true, NaN, q).open, false);
});

test('default scene has squelch; old scenes are back-filled', () => {
  const s = createDefaultScene();
  assert.deepEqual(s.links[0].rx.squelch, { enabled: true, thresholdDbm: -90, hysteresisDb: 3 });
  delete s.links[0].rx.squelch;
  assert.equal(validateScene(s).ok, true);
  assert.equal(migrateScene(s).links[0].rx.squelch.thresholdDbm, -90);
  s.links[0].rx.squelch = { enabled: 1 };
  assert.equal(validateScene(s).ok, false);
});

test('tracker follows the store and notifies only on change', () => {
  const st = createStore(createDefaultScene());
  const t = createSquelchTracker();
  t.attach(st);
  const id = st.getScene().links[0].id;
  assert.equal(t.get(id).open, true);
  let n = 0;
  t.subscribe(() => n++);
  setPath(st, 'links.0.rx.pos.x', 10.0); // no-op move keeps counts stable
  setLinkField(st, id, 'rx.squelch.thresholdDbm', -20);
  assert.equal(t.get(id).open, false);
  assert.ok(t.get(id).headroomDb < 0);
  const after = n;
  setLinkField(st, id, 'rx.squelch.thresholdDbm', -20);
  assert.equal(n, after);
  setLinkField(st, id, 'rx.squelch.enabled', false);
  assert.equal(t.get(id).open, true);
  assert.equal(t.get('nope'), null);
});
