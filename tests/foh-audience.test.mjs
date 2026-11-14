// FOH mic and IEM antennas behind a crowd: low, raised, remote. Crowd absorption is an assumed planning figure (audience.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fohScene, fohReport, EXAMPLES } from '../js/examples.js';
import { validateScene } from '../js/model/scene.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);
const f1 = (x) => x.toFixed(1);
const low = fohReport(fohScene('low')), raised = fohReport(fohScene('raised')), remote = fohReport(fohScene('remote'));
const rack = fohReport(fohScene('remote', { remote: 'booster-at-rack' })), rof = fohReport(fohScene('remote', { remote: 'rof' }));
const note = (id) => EXAMPLES.find((e) => e.id === id).note;

test('low antennas behind a standing crowd: absorption capped at 30 dB, tiny mic margin; density 3 per m2 costs 27 dB (0.5 x 3 x 18 m)', () => {
  near(low.mic.audienceLossDb, 30, 1e-9); near(low.iem.audienceLossDb, 30, 1e-9);
  const d3 = fohReport(fohScene('low', { densityPerM2: 3 }));
  near(d3.mic.audienceLossDb, 0.5 * 3 * 18, 0.01, 'hand value: 0.5 dB/m x 3 per m2 x 18 m inside the crowd');
  assert.ok(low.mic.marginDb < 5);
  const seated = fohReport(fohScene('low', { kind: 'seated' }));
  assert.ok(seated.mic.marginDb > low.mic.marginDb + 15);
});

test('raised antennas recover the crowd loss for the mic link (about 27 dB) and the IEM link', () => {
  near(raised.mic.audienceLossDb, 0, 1e-9);
  assert.ok(raised.mic.marginDb - low.mic.marginDb > 25);
  assert.ok(raised.iem.marginDb - low.iem.marginDb > 25);
  near(raised.mic.distanceM, low.mic.distanceM, 0.1);
});

test('remote antennas: free of the crowd, booster at the antenna end beats the booster after the cable by the cable loss, cable loss reported', () => {
  assert.equal(remote.mic.audienceLossDb, 0);
  assert.ok(remote.mic.marginDb - rack.mic.marginDb > 3);
  assert.ok(remote.mic.marginDb > rof.mic.marginDb);
  assert.ok(remote.iem.chainLossDb > 3 && remote.iem.chainLossDb < 8); // 45 m of LMR-400 at 614 MHz
  assert.ok(remote.mic.marginDb - low.mic.marginDb > 60);
});

test('all variants validate and the three notes quote the model', () => {
  for (const [v, o] of [['low'], ['raised'], ['remote'], ['remote', { remote: 'rof' }], ['low', { kind: 'seated' }]]) { const r = validateScene(fohScene(v, o)); assert.equal(r.ok, true, r.errors.join(';')); }
  const seated = fohReport(fohScene('low', { kind: 'seated' })), d3 = fohReport(fohScene('low', { densityPerM2: 3 }));
  for (const v of [f1(low.mic.audienceLossDb), f1(low.mic.marginDb), f1(low.mic.inputPowerDbm), f1(low.iem.marginDb), f1(d3.mic.marginDb), f1(seated.mic.marginDb), f1(seated.iem.marginDb)]) assert.ok(note('foh-mic-iem-audience').includes(v), v);
  for (const v of [f1(raised.mic.inputPowerDbm), f1(low.mic.marginDb), f1(raised.mic.marginDb), f1(raised.mic.marginDb - low.mic.marginDb), f1(raised.iem.marginDb), f1(raised.iem.marginDb - low.iem.marginDb), f1(raised.iem.audienceLossDb)]) assert.ok(note('foh-raised-antennas').includes(v), v);
  for (const v of [f1(remote.mic.marginDb), f1(remote.iem.marginDb), f1(remote.iem.chainLossDb), f1(remote.mic.marginDb - rack.mic.marginDb), f1(rack.mic.marginDb), f1(rof.mic.marginDb), f1(remote.mic.marginDb - low.mic.marginDb), f1(remote.iem.marginDb - low.iem.marginDb)]) assert.ok(note('foh-remote-antennas').includes(v), v);
  for (const id of ['foh-mic-iem-audience', 'foh-raised-antennas', 'foh-remote-antennas']) assert.ok(note(id).split('. ').length <= 4, id);
});
