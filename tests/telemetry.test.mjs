import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene, createDefaultLink, validateScene, migrateScene } from '../js/model/scene.js';
import { solveLink } from '../js/model/rf.js';
import { createSquelchTracker } from '../js/squelchTracker.js';
import { createRxTracker } from '../js/rxTracker.js';
import { createTelemetryTracker } from '../js/telemetryTracker.js';
import { createHistory } from '../js/history.js';
import { buildExample } from '../js/examples.js';
import { setPath, setLinkField } from '../js/actions.js';

function rig(scene) {
  let t = 0;
  const st = createStore(scene);
  const sq = createSquelchTracker();
  const rx = createRxTracker();
  const tl = createTelemetryTracker({ now: () => t });
  rx.install(sq);
  tl.install(sq, st, { start: false });
  sq.attach(st);
  return { st, sq, rx, tl, id: scene.links[0].id, advance: (ms) => { t += ms; } };
}

test('telemetry defaults, migration and validation', () => {
  const l = createDefaultLink('mic');
  assert.deepEqual(l.telemetry, {
    enabled: true, preset: 'narrow-telemetry',
    battery: { chemistry: 'alkaline-aa-x2', startPercent: 100, timeScale: 60, running: false },
    deviceName: 'Lead Vox', gainDb: 0,
  });
  assert.equal(l.modulation.type, 'analog-fm');
  const s = createDefaultScene();
  delete s.links[0].telemetry; delete s.links[0].modulation;
  assert.equal(validateScene(s).ok, true);
  const m = migrateScene(s);
  assert.equal(m.links[0].telemetry.battery.startPercent, 100);
  assert.equal(m.links[0].modulation.type, 'analog-fm');
  assert.equal(validateScene(m).ok, true);
  m.links[0].telemetry.battery.startPercent = 150;
  assert.equal(validateScene(m).ok, false);
  m.links[0].telemetry.battery.startPercent = 50;
  m.links[0].telemetry.battery.chemistry = 'zinc';
  assert.equal(validateScene(m).ok, false);
  m.links[0].telemetry.battery.chemistry = 'nimh-aa-x2';
  m.links[0].modulation.digital.fixedOrder = 8;
  assert.equal(validateScene(m).ok, false);
  m.links[0].modulation.digital.fixedOrder = 64;
  m.links[0].modulation.type = 'digital';
  assert.equal(validateScene(m).ok, true);
});

test('battery drains only while running, tx sag lowers the solved level', () => {
  const scene = createDefaultScene();
  scene.links[0].telemetry.battery = { chemistry: 'alkaline-aa-x2', startPercent: 30, timeScale: 2000, running: false };
  const { st, sq, tl, id } = rig(scene);
  const base = sq.get(id).levelDbm;
  assert.ok(Math.abs(base - solveLink(st.getScene(), st.getScene().links[0]).inputPowerDbm) < 1e-9);
  tl.tick(5); // not running: nothing changes
  assert.equal(Math.round(tl.get(id).battery.trueSocPercent), 30);
  assert.equal(sq.get(id).sagDb, 0);
  setPath(st, 'links.0.telemetry.battery.running', true);
  let prevPct = 30;
  for (let i = 0; i < 20; i++) {
    tl.tick(1);
    const pct = tl.get(id).battery.trueSocPercent;
    assert.ok(pct <= prevPct);
    prevPct = pct;
  }
  assert.ok(sq.get(id).sagDb > 5, 'sag ' + sq.get(id).sagDb);
  // the solved level is the unsagged level minus exactly the sag
  assert.ok(Math.abs(sq.get(id).levelDbm - (base - sq.get(id).sagDb)) < 1e-6);
});

test("squelch closes with reason 'battery' when the sag, not distance, pushes it under", () => {
  const ex = buildExample('battery-fade');
  const { sq, tl, id } = rig(ex.scene);
  assert.equal(sq.get(id).open, true);
  assert.equal(sq.get(id).reason, null);
  let reason = null;
  for (let i = 0; i < 40 && !reason; i++) { tl.tick(1); reason = sq.get(id).reason; }
  assert.equal(reason, 'battery');
  assert.equal(sq.get(id).open, false);
  // a refill brings it back
  tl.reset(id);
  assert.equal(sq.get(id).sagDb, 0);
  assert.equal(sq.get(id).open, true);
});

test('start percent changes reset the battery; disabling telemetry removes state and sag', () => {
  const { st, sq, tl, id } = rig(createDefaultScene());
  setLinkField(st, id, 'telemetry.battery.startPercent', 55);
  tl.tick(0);
  assert.equal(Math.round(tl.get(id).battery.trueSocPercent), 55);
  setLinkField(st, id, 'telemetry.enabled', false);
  assert.equal(tl.get(id), null);
  assert.equal(sq.get(id).sagDb, 0);
});

test('data link locks on a healthy link and goes stale on a weak one; history carries the fields', () => {
  const { st, sq, tl, id, advance } = rig(createDefaultScene());
  for (let i = 0; i < 20; i++) { advance(500); tl.tick(0); }
  const good = tl.get(id);
  assert.equal(good.data.locked, true);
  assert.ok(good.data.packetsOk > 5);
  assert.equal(good.data.decoded.name, 'Lead Vox');
  const h = createHistory({ now: () => 1 });
  h.sampleOnce(st, sq, 1);
  const s = h.get(id, 10)[0];
  assert.equal(s.dataLocked, true);
  assert.equal(Math.round(s.batteryTruePercent), 100);
  assert.ok(Math.abs(s.batteryPercent - 100) <= 30); // the gauge reading may be off
  assert.ok(Number.isFinite(s.batteryReportedPercent) && Number.isFinite(s.batteryGaugeErrorPct));
  assert.ok(s.batteryVoltage > 3);
  assert.equal(s.txPowerSagDb, 0);
  assert.equal(s.dataStale, false);
  setLinkField(st, id, 'tx.powerDbm', -80);
  for (let i = 0; i < 20; i++) { advance(500); tl.tick(0); }
  const weak = tl.get(id);
  assert.equal(weak.data.locked, false);
  assert.equal(weak.data.stale, true);
});

test('telemetry examples: data drops before the audio squelch closes', () => {
  const ex = buildExample('telemetry-before-audio');
  const { st, sq, tl, id, advance } = rig(ex.scene);
  const from = { ...ex.scene.links[0].tx.pos };
  let lostAt = null, closedAt = null;
  for (let i = 0; i <= 40; i++) {
    const f = i / 40;
    st.update((d) => { d.links[0].tx.pos = { x: from.x + (ex.walk.to.x - from.x) * f, y: from.y + (ex.walk.to.y - from.y) * f, z: from.z }; });
    advance(1000); tl.tick(0);
    const s = sq.get(id);
    if (lostAt === null && !s.telemetry.data.locked) lostAt = i;
    if (closedAt === null && !s.open) closedAt = i;
  }
  assert.ok(lostAt !== null && closedAt !== null && lostAt < closedAt, 'data lost at ' + lostAt + ', squelch closed at ' + closedAt);
});
