import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene, createDefaultLink, validateScene, migrateScene, referenceThicknessM } from '../js/model/scene.js';
import { solveLink } from '../js/model/rf.js';
import { createSquelchTracker } from '../js/squelchTracker.js';
import { createRxTracker } from '../js/rxTracker.js';
import { createMpxTracker } from '../js/mpxTracker.js';
import { createTelemetryTracker } from '../js/telemetryTracker.js';
import { createHistory } from '../js/history.js';
import { buildExample } from '../js/examples.js';
import { coverageGrid, zoneStats, zoneRequirement } from '../js/model/coverage.js';
import { setInterferer, setRequiredSnr } from '../js/actions.js';

function rig(scene) {
  let t = 0;
  const st = createStore(scene);
  const sq = createSquelchTracker();
  const rx = createRxTracker();
  const mp = createMpxTracker();
  const tl = createTelemetryTracker({ now: () => t });
  rx.install(sq); mp.install(sq); tl.install(sq, st, { start: false });
  sq.attach(st);
  return { st, sq, rx, mp, tl, id: scene.links[0].id };
}

test('interferer and requiredSnrDb: defaults, migration, validation, actions', () => {
  const l = createDefaultLink('mic');
  assert.deepEqual(l.interferer, { enabled: false, levelDbm: -70, hasPilot: false, offsetKHz: 0 });
  const s = createDefaultScene();
  delete s.links[0].interferer;
  assert.equal(validateScene(s).ok, true);
  const m = migrateScene(s);
  assert.equal(m.links[0].interferer.enabled, false);
  m.links[0].interferer.levelDbm = 'x';
  assert.equal(validateScene(m).ok, false);
  m.links[0].interferer.levelDbm = -60;
  m.links[0].rx.requiredSnrDb = 'high';
  assert.equal(validateScene(m).ok, false);
  m.links[0].rx.requiredSnrDb = 12;
  assert.equal(validateScene(m).ok, true);
  const st = createStore(createDefaultScene());
  const id = st.getScene().links[0].id;
  setInterferer(st, id, { enabled: true, levelDbm: -55, hasPilot: true, offsetKHz: 25 });
  assert.deepEqual(st.getScene().links[0].interferer, { enabled: true, levelDbm: -55, hasPilot: true, offsetKHz: 25 });
  setInterferer(st, id, { levelDbm: NaN, enabled: 'yes' });
  assert.equal(st.getScene().links[0].interferer.levelDbm, -55);
  setRequiredSnr(st, id, 20);
  assert.equal(st.getScene().links[0].rx.requiredSnrDb, 20);
  setRequiredSnr(st, id, null);
  assert.equal(st.getScene().links[0].rx.requiredSnrDb, undefined);
  assert.equal(validateScene(st.getScene()).ok, true);
});

test('cascade examples: booster at the antenna keeps the noise figure low; at the rack it does not', () => {
  const a = buildExample('cascade-booster-antenna').scene;
  const r = buildExample('cascade-booster-rack').scene;
  const ra = solveLink(a, a.links[0]), rr = solveLink(r, r.links[0]);
  assert.ok(Math.abs(ra.cascade.systemNfDb - 13.9) < 0.2, String(ra.cascade.systemNfDb));
  assert.ok(Math.abs(rr.cascade.systemNfDb - 28.6) < 0.2, String(rr.cascade.systemNfDb));
  assert.ok(Math.abs(ra.inputPowerDbm - rr.inputPowerDbm) < 1e-6); // same received power
  assert.ok(Math.abs(ra.marginDb - 12.3) < 0.3 && ra.status === 'pass');
  assert.ok(Math.abs(rr.marginDb + 2.5) < 0.3 && rr.status === 'fail');
  const cable = ra.cascade.stages.find((s) => s.label.startsWith('Cable'));
  assert.ok(Math.abs(cable.nfDb - 25.5) < 0.2);
  // the cascade reaches the rx tracker and the history
  const { st, sq, rx, id } = rig(buildExample('cascade-booster-rack').scene);
  assert.ok(Math.abs(rx.get(id).cascade.systemNfDb - 28.6) < 0.2);
  const h = createHistory({ now: () => 1 });
  h.sampleOnce(st, sq, 1);
  const s = h.get(id, 5)[0];
  assert.ok(Math.abs(s.systemNfDb - 28.6) < 0.2);
  assert.ok(Number.isFinite(s.noiseFloorDbm) && Number.isFinite(s.sensitivityAtAntennaDbm) && Number.isFinite(s.marginAtAntennaDb));
});

test('stray carrier: carrier squelch opens on it, pilot squelch rejects it, audio quality reaches the history', () => {
  const ex = buildExample('stray-carrier-pilot');
  const { st, sq, mp, id } = rig(ex.scene);
  const l = ex.scene.links[0];
  let s = sq.get(id);
  assert.ok(Math.abs(s.levelDbm + 89.5) < 0.5);
  assert.ok(Math.abs(s.capture.cirDb + 8) < 0.1, 'interferer is 8 dB stronger');
  assert.equal(s.capture.captured, 'interferer');
  assert.equal(s.capture.audioQuality, 0);
  assert.equal(s.open, false);
  assert.equal(s.reason, 'pilot');
  assert.equal(mp.get(id).pilotLocked, false);
  // without pilot squelch the stray carrier opens the gate and the wanted audio is lost to capture
  st.update((d) => { d.links[0].mpx.pilotSquelch = false; });
  s = sq.get(id);
  assert.equal(s.open, true);
  const h = createHistory({ now: () => 1 });
  h.sampleOnce(st, sq, 1);
  const x = h.get(id, 5)[0];
  assert.equal(x.captured, 'interferer');
  assert.equal(x.audioQuality, 0);
  assert.ok(x.cirDb < -7);
  assert.ok(x.audioDb <= -60, 'wanted audio is gone under capture, got ' + x.audioDb);
  assert.ok(x.audioRawDb > -60);
  // a foreign pilot is present but still rejected: reason interferer
  setInterferer(st, id, { hasPilot: true });
  st.update((d) => { d.links[0].mpx.pilotSquelch = true; });
  assert.equal(sq.get(id).open, false);
  assert.equal(sq.get(id).reason, 'interferer');
  // weaker interferer: the wanted signal is captured again and the pilot is the wanted one
  setInterferer(st, id, { hasPilot: false, levelDbm: l.interferer.levelDbm - 30 });
  s = sq.get(id);
  assert.equal(s.capture.captured, 'wanted');
  assert.equal(s.open, true);
  assert.equal(mp.get(id).pilotLocked, true);
  // switching it off removes the capture state
  setInterferer(st, id, { enabled: false });
  assert.equal(sq.get(id).capture, null);
});

test('battery gauge example: reported differs from true and the transmitter power does not sag yet', () => {
  const ex = buildExample('battery-gauge');
  const { st, sq, tl, id } = rig(ex.scene);
  tl.tick(0);
  const b = tl.get(id).battery;
  assert.ok(Math.abs(b.trueSocPercent - 50) < 0.5);
  assert.ok(Math.abs(b.reportedPercent - 22) < 1.5, String(b.reportedPercent));
  assert.ok(Math.abs(b.gaugeErrorPct + 28) < 1.5, String(b.gaugeErrorPct));
  assert.equal(sq.get(id).sagDb, 0);
  const h = createHistory({ now: () => 1 });
  h.sampleOnce(st, sq, 1);
  const s = h.get(id, 5)[0];
  assert.ok(Math.abs(s.batteryTruePercent - 50) < 0.5);
  assert.ok(Math.abs(s.batteryReportedPercent - 22) < 1.5);
  assert.ok(s.batteryGaugeErrorPct < -25);
  // run until the gauge reads empty: the true charge is then still about 30 % and the power has not sagged
  st.update((d) => { d.links[0].telemetry.battery.running = true; });
  let guard = 0;
  while (tl.get(id).battery.reportedPercent > 0.5 && guard++ < 400) tl.tick(0.5);
  const e = tl.get(id).battery;
  assert.ok(e.trueSocPercent > 25 && e.trueSocPercent < 36, String(e.trueSocPercent));
  assert.ok(sq.get(id).sagDb < 0.5);
});

test('wall thickness example: the thin-wall zone passes and the thick-wall zone fails; reference thickness is exposed', () => {
  assert.equal(referenceThicknessM('concrete'), 0.1);
  assert.equal(referenceThicknessM('nonsense'), null);
  const ex = buildExample('wall-thickness');
  assert.deepEqual(validateScene(ex.scene), { ok: true, errors: [] });
  const l = ex.scene.links[0];
  const g = coverageGrid(ex.scene, l.id, { cellM: 0.25, mode: 'power', rxHeight: 1.5 });
  const res = ex.scene.zones.map((z) => { const rq = zoneRequirement(ex.scene, l, z); return zoneStats(g, z, rq.squelchThresholdDbm, rq.appliedMarginDb); });
  assert.equal(res[0].pass, true);
  assert.equal(res[1].pass, false);
  assert.ok(Math.abs(res[0].minDbm + 70) < 2 && Math.abs(res[1].minDbm + 94) < 2);
  // a thinner thick wall lets the second zone pass too
  const thin = structuredClone(ex.scene);
  thin.reflectors[1].thicknessM = 0.1;
  const g2 = coverageGrid(thin, l.id, { cellM: 0.25, mode: 'power', rxHeight: 1.5 });
  const rq = zoneRequirement(thin, l, thin.zones[1]);
  assert.equal(zoneStats(g2, thin.zones[1], rq.squelchThresholdDbm, rq.appliedMarginDb).pass, true);
});
