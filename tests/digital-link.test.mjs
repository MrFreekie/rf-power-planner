// Digital versus analogue link behaviour (js/model/digital-link.js) and the two contrast examples.
// Hand anchors: noise floor = -174 + 10 log10(200 000 Hz) + 8 dB NF = -112.99 dBm (tol 0.01); Carson 2 (40 + 15) = 110 kHz;
// analogue below the 11 dB threshold: SNR = CNR + 23.5 - 2 (11 - CNR), so 3 dB of audio SNR per dB of CNR (tol 0.05 dB).
import test from 'node:test';
import assert from 'node:assert/strict';
import { digitalProfile, digitalConfigOf, modeReport, analogOccupiedBwKHz, noiseFloorDbm } from '../js/model/digital-link.js';
import { modeContrastReport, EXAMPLES, MODE_CONTRAST_LEVELS } from '../js/examples.js';
import { validateScene } from '../js/model/scene.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (tol ${tol})`);
const link = { modulation: { type: 'digital', digital: { preset: 'mic-qpsk-fixed', fixedOrder: null, overrides: {} } } };

test('occupied bandwidth and noise floor hand anchors', () => {
  assert.equal(analogOccupiedBwKHz(40, 15), 110);
  assert.equal(analogOccupiedBwKHz(), 110);
  const cfg = digitalConfigOf(link);
  near(noiseFloorDbm(cfg), -112.99, 0.01, 'floor');
  assert.equal(digitalProfile(cfg).occupiedBwKHz, 200);
  near(digitalProfile(cfg).spectralEfficiency, 150 * 2 * 0.75 / 200, 1e-9, '1.125 bit/s/Hz');
});

test('digital cliff: thresholds ordered, narrow, and consistent with the frame error rate model', () => {
  const p = digitalProfile(digitalConfigOf(link));
  assert.ok(p.degradedCnrDb > p.concealCnrDb && p.concealCnrDb > p.downCnrDb);
  assert.ok(p.cliffWidthDb > 0 && p.cliffWidthDb < 1.5, `cliff width ${p.cliffWidthDb}`);
  near(p.concealInputDbm, -105.86, 0.05); near(p.degradedInputDbm, -105.64, 0.05); near(p.downInputDbm, -106.28, 0.05);
  // 1 dB above the conceal point the link is clean, 1 dB below it frames are being lost
  assert.equal(modeReport(p.concealInputDbm + 1, link).digital.state, 'ok');
  assert.notEqual(modeReport(p.concealInputDbm - 1, link).digital.state, 'ok');
});

test('analogue falls gradually (3 dB per dB below threshold), digital drops from clean to muted inside 1.5 dB', () => {
  const a = (x) => modeReport(x, link).analog.audioSnrDb;
  near(a(-105) - a(-106), 3, 0.01, 'slope below the knee');
  near(a(-107), 5.99 + 23.5 - 2 * (11 - 5.99), 0.05, 'hand value 19.47 dB');
  near(a(-95) - a(-100), 5, 0.01, '1 dB per dB above the knee');
  const fer = (x) => modeReport(x, link).digital.frameErrorRate;
  assert.ok(fer(-105) < 1e-6 && fer(-106.5) > 0.9, 'clean at -105, gone at -106.5');
  assert.ok(a(-106.5) > 15, 'analogue at -106.5 dBm still has audio');
});

test('contrast examples: same level, analogue hissy but present, digital muted; good level clean in both', () => {
  const wa = modeContrastReport('analog-fm', 'weak'), wd = modeContrastReport('digital', 'weak');
  near(wa.inputDbm, MODE_CONTRAST_LEVELS.weak, 0.05); near(wd.inputDbm, wa.inputDbm, 1e-9, 'same level');
  near(wa.cnrDb, 5.99, 0.01); near(wa.analog.thresholdMarginDb, -5.01, 0.01); near(wa.analog.audioSnrDb, 19.5, 0.05);
  assert.equal(wd.digital.state, 'down'); near(wd.digital.concealMarginDb, -1.14, 0.02);
  const g = modeContrastReport('digital', 'good');
  near(g.analog.audioSnrDb, 51.5, 0.05); assert.equal(g.digital.state, 'ok'); near(g.digital.concealMarginDb, 20.86, 0.02);
  assert.equal(wd.scene.links[0].modulation.type, 'digital'); assert.notEqual(wa.scene.links[0].modulation && wa.scene.links[0].modulation.type, 'digital');
});

test('contrast example notes: category first, at most four sentences, validated, every figure asserted', () => {
  const na = EXAMPLES.find((e) => e.id === 'analog-fm-weak-gradual'), nd = EXAMPLES.find((e) => e.id === 'digital-weak-cliff');
  for (const e of [na, nd]) { assert.ok(e); assert.ok(validateScene(e.build().scene).ok); assert.match(e.note, /^Compare:/); assert.ok(e.note.split(/(?<=\.)\s/).length <= 4); }
  for (const t of ['-107 dBm', '6.0 dB', '5.0 dB', '11 dB', '19.5 dB', '51.5 dB', '110 kHz']) assert.ok(na.note.includes(t), t);
  for (const t of ['-107 dBm', '1.1 dB', '0.6 dB', '-105.6 dBm', '-106.3 dBm', '20.9 dB', '200 kHz']) assert.ok(nd.note.includes(t), t);
  const p = digitalProfile(digitalConfigOf(link));
  near(p.cliffWidthDb, 0.6, 0.05); near(p.degradedInputDbm, -105.6, 0.05); near(p.downInputDbm, -106.3, 0.05);
});
