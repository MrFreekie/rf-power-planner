import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene, createDefaultLink, validateScene, migrateScene } from '../js/model/scene.js';
import { squelchState } from '../js/model/squelch.js';
import { createSquelchTracker } from '../js/squelchTracker.js';
import { createMpxTracker } from '../js/mpxTracker.js';
import { createHistory } from '../js/history.js';
import { createAudioSource, createStereoSource, gate, AUDIO_FLOOR_DB } from '../js/model/audio.js';
import { startWalk, stopWalk, isWalking } from '../js/walk.js';
import { setLinkField, setPath } from '../js/actions.js';

function iemSetup() {
  const scene = createDefaultScene();
  scene.links = [createDefaultLink('iem')];
  const st = createStore(scene);
  const sq = createSquelchTracker();
  const mpx = createMpxTracker();
  mpx.install(sq);
  sq.attach(st);
  return { st, sq, mpx, id: scene.links[0].id };
}

test('mpx defaults, migration and validation', () => {
  assert.equal(createDefaultLink('iem').mpx.enabled, true);
  assert.equal(createDefaultLink('mic').mpx.enabled, false);
  assert.deepEqual(createDefaultLink('mic').mpx, { enabled: false, preset: 'iem-typical', overrides: {}, pilotSquelch: false });
  const s = createDefaultScene();
  s.links.push(createDefaultLink('iem'));
  for (const l of s.links) { delete l.mpx; delete l.audio; }
  assert.equal(validateScene(s).ok, true);
  const m = migrateScene(s);
  assert.equal(m.links[0].mpx.enabled, false);
  assert.equal(m.links[1].mpx.enabled, true);
  assert.deepEqual(m.links[0].audio, { source: 'speech', gainDb: 0 });
  assert.equal(validateScene(m).ok, true);
  m.links[0].mpx.pilotSquelch = 'yes';
  assert.equal(validateScene(m).ok, false);
  m.links[0].mpx.pilotSquelch = false;
  m.links[0].audio.source = 'stereo-demo';
  assert.equal(validateScene(m).ok, true);
  m.links[0].audio.source = 'bogus';
  assert.equal(validateScene(m).ok, false);
});

test('squelchState pilot gating and reasons', () => {
  const q = { enabled: true, thresholdDbm: -90, hysteresisDb: 3 };
  assert.equal(squelchState(false, -80, q, { pilotRequired: true, pilotLocked: true }).reason, null);
  const noPilot = squelchState(false, -80, q, { pilotRequired: true, pilotLocked: false });
  assert.equal(noPilot.open, false);
  assert.equal(noPilot.reason, 'pilot');
  assert.equal(noPilot.carrierOpen, true);
  assert.equal(squelchState(false, -80, q, { pilotRequired: false, pilotLocked: false }).open, true);
  assert.equal(squelchState(false, -100, q, { pilotRequired: true, pilotLocked: false }).reason, 'carrier');
  assert.equal(squelchState(false, -100, { ...q, enabled: false }, { pilotRequired: true, pilotLocked: false }).open, true);
});

test('tracker: pilot squelch closes the gate when carrier is fine but pilot lost', () => {
  const { st, sq, mpx, id } = iemSetup();
  assert.equal(sq.get(id).open, true);
  assert.equal(mpx.get(id).pilotLocked, true);
  const level = sq.get(id).levelDbm;
  const power0 = st.getScene().links[0].tx.powerDbm;
  setLinkField(st, id, 'rx.squelch.thresholdDbm', -125);
  setLinkField(st, id, 'tx.powerDbm', power0 + (-105 - level)); // input about -105 dBm: low CNR, pilot not locked
  assert.ok(Math.abs(sq.get(id).levelDbm + 105) < 0.01);
  assert.equal(mpx.get(id).pilotLocked, false);
  assert.equal(sq.get(id).open, true); // carrier squelch alone: open
  setLinkField(st, id, 'mpx.pilotSquelch', true);
  assert.equal(sq.get(id).open, false);
  assert.equal(sq.get(id).reason, 'pilot');
  setLinkField(st, id, 'tx.powerDbm', power0);
  assert.equal(sq.get(id).open, true);
  assert.equal(sq.get(id).reason, null);
  assert.equal(mpx.get(id).mode, 'stereo');
  setLinkField(st, id, 'mpx.enabled', false);
  assert.equal(mpx.get(id), null);
});

test('mpx subscribers fire on change only', () => {
  const { st, mpx, id } = iemSetup();
  let n = 0;
  mpx.subscribe(() => n++);
  setLinkField(st, id, 'tx.powerDbm', 10);
  assert.equal(n, 1);
  setLinkField(st, id, 'name', 'renamed');
  assert.equal(n, 1);
});

test('history samples carry mpx and L/R fields; stereo versus mono', () => {
  const { st, sq, id } = iemSetup();
  let t = 100;
  const h = createHistory({ now: () => t });
  h.sampleOnce(st, sq, 100);
  t = 100.05;
  const s = h.get(id, 10)[0];
  for (const k of ['t', 'rfDbm', 'rxPowerDbm', 'thresholdDbm', 'open', 'audioDb', 'audioRawDb', 'cnrDb', 'blend', 'mode', 'pilotLocked', 'audioL', 'audioR']) {
    assert.ok(k in s, k);
  }
  assert.equal(s.mode, 'stereo');
  assert.equal(s.blend, 1);
  assert.equal(s.pilotLocked, true);
  assert.ok(s.cnrDb > 30);
  for (let i = 0; i < 200; i++) h.sampleOnce(st, sq, 100 + i * 0.05);
  t = 110;
  let diff = 0;
  for (const x of h.get(id, 20)) diff = Math.max(diff, Math.abs(x.audioL - x.audioR));
  assert.ok(diff > 3, 'L and R should differ in stereo, max diff ' + diff);
  // weak signal with carrier squelch off: the decoder falls back to mono, so L equals R
  setLinkField(st, id, 'rx.squelch.enabled', false);
  setLinkField(st, id, 'tx.powerDbm', st.getScene().links[0].tx.powerDbm - 70);
  h.clear();
  for (let i = 0; i < 100; i++) h.sampleOnce(st, sq, 120 + i * 0.05);
  t = 125;
  const xs = h.get(id, 10);
  assert.ok(xs.length > 0);
  assert.equal(xs[0].mode, 'mono');
  for (const x of xs) assert.ok(Math.abs(x.audioRawL - x.audioRawR) < 1e-6);
});

test('history: closed squelch gates audio to the floor; mic link is mono; ring limit', () => {
  const scene = createDefaultScene();
  const st = createStore(scene);
  const sq = createSquelchTracker();
  sq.attach(st);
  const id = scene.links[0].id;
  let t = 0;
  const h = createHistory({ now: () => t, maxSeconds: 5 });
  setLinkField(st, id, 'rx.squelch.thresholdDbm', -10);
  for (let i = 0; i < 400; i++) { t = i * 0.05; h.sampleOnce(st, sq, t); }
  const all = h.get(id, 100);
  assert.ok(all[0].t >= t - 5 - 1e-9);
  const x = all[all.length - 1];
  assert.equal(x.open, false);
  assert.equal(x.audioDb, AUDIO_FLOOR_DB);
  assert.equal(x.audioL, AUDIO_FLOOR_DB);
  assert.equal(x.mode, 'mono');
  assert.equal(x.reason, 'carrier');
  assert.ok(x.audioRawDb > AUDIO_FLOOR_DB);
});

test('audio sources are deterministic, in range, and gate to the floor', () => {
  const sp = createAudioSource({ kind: 'speech', seed: 2 });
  let max = -Infinity, maxRms = -Infinity, sum = 0, n = 0;
  for (let t = 0; t < 20; t += 0.01) {
    const a = sp.level(t), b = sp.level(t);
    assert.deepEqual(a, b);
    assert.ok(a.peakDb >= a.rmsDb - 1e-9 && a.peakDb <= 0);
    max = Math.max(max, a.peakDb); maxRms = Math.max(maxRms, a.rmsDb);
    if (a.rmsDb > -50) { sum += a.rmsDb; n++; }
  }
  assert.ok(max > -9 && max <= -6 + 1e-9, 'peak near -6, got ' + max);
  assert.ok(maxRms > -26 && maxRms < -18, "speech RMS tops out near -22 dBFS, got " + maxRms);
  assert.equal(createAudioSource({ kind: 'tone' }).level(3).rmsDb, -18);
  assert.equal(createAudioSource({ kind: 'off' }).level(1).rmsDb, AUDIO_FLOOR_DB);
  assert.equal(createAudioSource({ kind: 'nonsense' }).kind, 'off');
  assert.deepEqual(gate({ rmsDb: -20, peakDb: -8 }, false), { rmsDb: AUDIO_FLOOR_DB, peakDb: AUDIO_FLOOR_DB });
  const stereo = createStereoSource({ kind: 'stereo-demo', seed: 1 });
  let d = 0;
  for (let t = 0; t < 20; t += 0.05) d = Math.max(d, Math.abs(stereo.l(t).rmsDb - stereo.r(t).rmsDb));
  assert.ok(d > 6);
  assert.equal(createStereoSource({ kind: 'off' }).l(0).rmsDb, AUDIO_FLOOR_DB);
});

test('walk moves the mic, coalesces to one undo step, and stops on drag, reset or undo', () => {
  const st = createStore(createDefaultScene());
  const id = st.getScene().links[0].id;
  const start = { ...st.getScene().links[0].tx.pos };
  const w = startWalk(st, id, { to: { x: 10, y: 3 }, speedMps: 2, pingPong: true, raf: () => 1, caf: () => {} });
  assert.equal(isWalking(), true);
  w.step(1);
  assert.ok(Math.abs(st.getScene().links[0].tx.pos.x - 6) < 1e-9); // 4 + 2 m/s * 1 s
  w.step(1.5); // s = 5 on a 6 m leg
  assert.ok(Math.abs(st.getScene().links[0].tx.pos.x - 9) < 1e-9);
  w.step(3.5); // s = 12 = two legs: back at the start
  assert.ok(Math.abs(st.getScene().links[0].tx.pos.x - 4) < 1e-9);
  assert.equal(st.canUndo(), true);
  setPath(st, 'links.0.tx.pos.x', 7.5); // user drag cancels
  assert.equal(isWalking(), false);
  st.undo(); // the drag
  st.undo(); // the whole walk
  assert.deepEqual(st.getScene().links[0].tx.pos, start);
  const w2 = startWalk(st, id, { speedMps: 1, raf: () => 1, caf: () => {} });
  w2.step(0.5);
  st.setScene(createDefaultScene()); // reset: link id changes
  assert.equal(isWalking(), false);
  assert.equal(startWalk(st, 'missing', {}), null);
  stopWalk();
});

test('walk to range reaches a point where the squelch is closed', () => {
  const st = createStore(createDefaultScene());
  const sq = createSquelchTracker();
  sq.attach(st);
  const id = st.getScene().links[0].id;
  const w = startWalk(st, id, { to: 'range', speedMps: 1, pingPong: false, raf: () => 1, caf: () => {} });
  w.step(0);
  w.step(100000);
  assert.equal(isWalking(), false);
  assert.equal(sq.get(id).open, false);
});
