// FOH mic and IEM antennas behind a crowd: low, raised, remote. Crowd absorption is an assumed planning figure (audience.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fohScene, fohReport, EXAMPLES } from '../js/examples.js';
import { validateScene } from '../js/model/scene.js';
import { overloadStep } from '../js/model/overload.js';
import { RX_PRESETS } from '../js/model/rx-params.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);
const f1 = (x) => x.toFixed(1);
const low = fohReport(fohScene('low')), raised = fohReport(fohScene('raised')), remote = fohReport(fohScene('remote'));
const rack = fohReport(fohScene('remote', { remote: 'booster-at-rack' })), rof = fohReport(fohScene('remote', { remote: 'rof' }));
const note = (id) => EXAMPLES.find((e) => e.id === id).note;

test('low antennas behind a standing crowd: absorption capped at 26 dB, small mic margin; density 1 per m2 costs 16.2 dB (0.9 x 1 x 18 m)', () => {
  near(low.mic.audienceLossDb, 26, 1e-9); near(low.iem.audienceLossDb, 26, 1e-9);
  const d1 = fohReport(fohScene('low', { densityPerM2: 1 }));
  near(d1.mic.audienceLossDb, 0.9 * 1 * 18, 0.01, 'hand value: 0.9 dB/m x 1 per m2 x 18 m inside the crowd');
  assert.ok(low.mic.marginDb < 10);
  const seated = fohReport(fohScene('low', { kind: 'seated' }));
  assert.ok(seated.mic.marginDb > low.mic.marginDb + 2); // seated heads 1.2 m: the low ray grazes them inside the clearance ramp
});

test('raised antennas (5 m) recover most of the crowd loss for the mic link (about 28 dB) and the IEM link', () => {
  assert.ok(raised.mic.audienceLossDb < 5);
  assert.ok(raised.mic.marginDb - low.mic.marginDb > 25);
  assert.ok(raised.iem.marginDb - low.iem.marginDb > 20);
  near(raised.mic.distanceM, low.mic.distanceM, 0.5);
});

test('remote antennas: free of the crowd, booster at the antenna end beats the booster after the cable by the cable loss, cable loss reported', () => {
  assert.equal(remote.mic.audienceLossDb, 0);
  assert.ok(remote.mic.marginDb - rack.mic.marginDb > 1); // with the 12 dB pad the difference is small (1.3 dB): the pad, not the cable, sets the noise at the receiver input
  assert.ok(remote.mic.marginDb > rof.mic.marginDb);
  assert.ok(remote.iem.chainLossDb > 3 && remote.iem.chainLossDb < 8); // 45 m of LMR-400 at 614 MHz
  assert.ok(remote.mic.marginDb - low.mic.marginDb > 55);
});

test('remote chains end with a pad: the receiver input is ok (not hot), 12 dB clear of hot by P1dB, and the unpadded chain would have been hot', () => {
  const cfg = RX_PRESETS['mic-receiver-typical'];
  for (const o of [{}, { remote: 'booster-at-rack' }, { remote: 'rof' }]) {
    const s = fohScene('remote', o), r = fohReport(s), ov = overloadStep(null, r.mic.inputPowerDbm, { ...cfg, ...(s.links[0].rx.overload || {}) });
    assert.equal(ov.level, 'ok', JSON.stringify(o)); assert.ok(ov.headroomDb > 10, JSON.stringify(o));
    const bare = structuredClone(s); bare.links[0].chain = bare.links[0].chain.filter((c) => c.kind !== 'attenuator');
    const ovb = overloadStep(null, fohReport(bare).mic.inputPowerDbm, { ...cfg, ...(bare.links[0].rx.overload || {}) });
    assert.equal(ovb.level, 'hot', JSON.stringify(o) + ' unpadded'); assert.ok(ovb.headroomDb < 4);
  }
  near(fohReport(fohScene('remote')).mic.inputPowerDbm, -31.0, 0.05);
});

test('all variants validate and the three notes quote the model', () => {
  for (const [v, o] of [['low'], ['raised'], ['remote'], ['remote', { remote: 'rof' }], ['low', { kind: 'seated' }]]) { const r = validateScene(fohScene(v, o)); assert.equal(r.ok, true, r.errors.join(';')); }
  const seated = fohReport(fohScene('low', { kind: 'seated' })), d1 = fohReport(fohScene('low', { densityPerM2: 1 }));
  for (const v of [f1(low.mic.audienceLossDb), f1(low.mic.marginDb), f1(low.mic.inputPowerDbm), f1(low.iem.marginDb), f1(d1.mic.audienceLossDb), f1(d1.mic.marginDb), f1(seated.mic.marginDb), f1(seated.iem.marginDb)]) assert.ok(note('foh-mic-iem-audience').includes(v), v);
  for (const v of [f1(raised.mic.inputPowerDbm), f1(low.mic.marginDb), f1(raised.mic.marginDb), f1(raised.mic.marginDb - low.mic.marginDb), f1(raised.iem.marginDb), f1(raised.iem.marginDb - low.iem.marginDb), f1(raised.iem.audienceLossDb)]) assert.ok(note('foh-raised-antennas').includes(v), v);
  for (const v of [f1(remote.mic.marginDb), f1(remote.iem.marginDb), f1(remote.iem.chainLossDb), f1(rack.mic.marginDb), f1(rof.mic.marginDb), f1(remote.mic.marginDb - low.mic.marginDb), f1(remote.iem.marginDb - low.iem.marginDb), f1(remote.mic.inputPowerDbm), f1(-18 - remote.mic.inputPowerDbm), f1(remote.mic.inputPowerDbm + 12), f1(fohReport(fohScene('remote', { remote: 'rof' })).mic.inputPowerDbm)]) assert.ok(note('foh-remote-antennas').includes(v), v);
  for (const id of ['foh-mic-iem-audience', 'foh-raised-antennas', 'foh-remote-antennas']) assert.ok(note(id).split('. ').length <= 4, id);
});
