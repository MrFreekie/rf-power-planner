// Review fixes from lessons 78 to 84: calibration headline, required spacing, scene.imd double counting, polarisation wording, noise wave schedule, example keywords.
// Tolerances are stated per assertion; hand anchors are written beside the numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene, createDefaultLink } from '../js/model/scene.js';
import { suggestCalibration, compareMeasurements, MATCH_RMS_DB, MATCH_WORST_DB } from '../js/model/measurements.js';
import { coordinationSummary, frequencyPlanRows, planSummary, extraImdTransmitters } from '../js/model/plan-export.js';
import { diffScenes, headline } from '../js/model/scene-diff.js';
import { waveSchedule, createNoiseSource, dutyOf, noiseEvents } from '../js/model/noise-sources.js';
import { EXAMPLES, buildExample, exampleKeywords } from '../js/examples.js';

const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} got ${a}, expected ${b} +- ${tol}`);
const omni = (p = 'vertical') => ({ type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 }, polarisation: p });
function simple() {
  const s = createDefaultScene(); s.environment.externalNoise = 0; s.environment.model = 'free-space';
  const l = createDefaultLink('mic'); l.id = 'L1'; l.name = 'Mic 1'; s.links = [l]; l.freqMHz = 606.1; l.chain = [];
  l.tx.pos = { x: 0, y: 0, z: 1.5 }; l.rx.pos = { x: 10, y: 0, z: 1.5 }; l.tx.antenna = omni(); l.rx.antenna = omni(); l.rx.diversity.antennaB.pos = { x: 10, y: -0.6, z: 1.5 };
  return s;
}
// readings equal to the model's own prediction, plus per-index offsets (dB)
function readings(s, offsets) {
  const probe = { ...s, measurements: offsets.map((_, i) => ({ id: `m${i}`, linkId: 'L1', x: 5 + i, y: 0, z: 1.5, rxDbm: 0 })) };
  return compareMeasurements(probe).points.map((p, i) => ({ id: p.id, linkId: 'L1', x: p.x, y: p.y, z: p.z, rxDbm: p.predictedDbm + offsets[i] }));
}

test('calibration headline: rms 2.89 dB but one reading 10 dB off does NOT say the model matches', () => {
  const s = simple();
  s.measurements = readings(s, [0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0]);
  const sug = suggestCalibration(s);
  near(compareMeasurements(s).rmsDb, 10 / Math.sqrt(12), 0.01, 'rms = 10/sqrt(12)'); // hand: sqrt(100/12) = 2.887
  assert.ok(compareMeasurements(s).rmsDb <= MATCH_RMS_DB && MATCH_WORST_DB < 10);
  assert.equal(sug.matches, false);
  assert.ok(!/already matches/i.test(sug.headline) && /does not match/i.test(sug.headline), sug.headline);
  assert.ok(sug.cautions.some((c) => /does not match/.test(c)) && !sug.cautions.some((c) => /already matches/.test(c)));
});
test('calibration headline: exact readings match; a 4 dB worst error with rms under 3 dB still matches when no fit is needed', () => {
  const s = simple();
  s.measurements = readings(s, [0, 0, 0]);
  const exact = suggestCalibration(s);
  assert.equal(exact.matches, true); assert.match(exact.headline, /already matches/);
  s.measurements = readings(s, [4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // rms 4/sqrt(12) = 1.15 dB, worst 4 dB
  const mid = suggestCalibration(s);
  assert.equal(mid.matches, true);
  if (!mid.needed) assert.match(mid.headline, /already matches/);
});

test('coordination: required spacing is the rule (300 kHz), the measured minimum is separate', () => {
  const s = buildExample('coord-equal-spacing').scene;
  const c = coordinationSummary(s);
  assert.equal(c.requiredSpacingKHz, 300); near(c.minSpacingKHz, 400, 0.5, 'measured minimum, equally spaced by 400 kHz');
  const c5 = coordinationSummary(s, { minSpacingKHz: 500 });
  assert.equal(c5.requiredSpacingKHz, 500); assert.equal(c5.spacingViolations, 2, 'two 400 kHz pairs are closer than 500 kHz');
  const one = createDefaultScene(); one.links = [createDefaultLink('mic')];
  assert.equal(coordinationSummary(one).requiredSpacingKHz, 300);
});
test('IMD examples do not double count the wanted transmitter: coord-equal-spacing exports 3 frequencies, imd-plan-bad 4', () => {
  const s = buildExample('coord-equal-spacing').scene;
  assert.equal(s.links.length, 1); assert.equal(s.imd.transmitters.length, 3);
  const c = coordinationSummary(s);
  assert.equal(c.frequencies, 3);
  assert.deepEqual(c.overlapWarnings, [], 'no false "Mic 1 and Mic 1 (wanted) are 0 kHz apart"');
  assert.equal(c.hits2, 2); assert.equal(c.hits3, 1); assert.equal(c.hitsTotal, 3); // the example note: three distinct third-order hits, two 2-mic and one 3-mic
  assert.equal(frequencyPlanRows(s).length, 3); assert.equal(planSummary(s).imdTransmitters, 2);
  const b = buildExample('imd-plan-bad').scene;
  assert.equal(coordinationSummary(b).frequencies, 4);
  assert.equal(coordinationSummary(b).overlapWarnings.length, 0);
  assert.equal(frequencyPlanRows(b).length, 4);
});
test('dedupe: by id first, then by frequency within 1 kHz; a different frequency stays', () => {
  const s = simple(); s.imd = { transmitters: [{ id: 'L1', freqMHz: 700 }, { id: 'y', freqMHz: 606.105 }] };
  assert.deepEqual(extraImdTransmitters(s).map((t) => t.id), ['y'], 'L1 matched by id although its frequency differs; 606.105 is 5 kHz away so it stays');
  const s2 = simple(); s2.imd = { transmitters: [{ id: 'x', freqMHz: 606.1005 }, { id: 'z', freqMHz: 610 }] };
  assert.deepEqual(extraImdTransmitters(s2).map((t) => t.id), ['z'], '0.5 kHz away counts as the same device');
});

test('scene diff names both polarisations: a fault and a fix read differently', () => {
  const a = simple(), b = structuredClone(a); b.links[0].rx.antenna.polarisation = 'horizontal'; // tx vertical, rx horizontal: cross-polarised
  const fault = headline(diffScenes(a, b)).join(' ');
  assert.match(fault, /after: receiver antenna horizontal, transmitter vertical: cross-polarised/);
  assert.match(fault, /before: receiver antenna vertical, transmitter vertical: matched/);
  const fix = headline(diffScenes(b, a)).join(' ');
  assert.match(fix, /after: receiver antenna vertical, transmitter vertical: matched/); assert.match(fix, /before: receiver antenna horizontal, transmitter vertical: cross-polarised/);
});

test('waveSchedule: speedlight 3 per second 1 ms; keyed PTT on-time and duty; DECT 100 bursts per second duty 4.17 percent; continuous', () => {
  const f = waveSchedule(createNoiseSource('speedlight-flash'));
  assert.equal(f.behaviour, 'impulsive'); near(f.eventsPerS, 3, 1e-9); near(f.onS, 0.001, 1e-9); near(f.periodS, 1 / 3, 1e-9); near(f.duty, 0.003, 1e-9);
  const k = waveSchedule(createNoiseSource('ptt-pmr446')); // onS 5 + hold 0.5 = 5.5 s on, duty 0.3 -> period 18.33 s
  near(k.onS, 5.5, 1e-9); near(k.duty, 0.3, 1e-9); near(k.periodS, 5.5 / 0.3, 1e-9); near(k.eventsPerS, 0.3 / 5.5, 1e-9);
  const d = waveSchedule(createNoiseSource('dect-comms')); // 0.417 ms x 100 Hz
  near(d.eventsPerS, 100, 1e-9); near(d.duty, 0.0417, 1e-6); near(d.onS, 0.000417, 1e-9);
  const c = waveSchedule(createNoiseSource('switch-mode-psu'));
  assert.equal(c.continuous, true); assert.equal(c.duty, 1); assert.equal(c.eventsPerS, 0);
  for (const [id, T] of [['speedlight-flash', 60], ['ptt-pmr446', 600], ['dect-comms', 30], ['gsm-phone-900', 10]]) { // the schedule agrees with the model: duty and event count (the model caps 4000 events)
    const src = createNoiseSource(id), w = waveSchedule(src), ev = noiseEvents(src, T);
    assert.equal(w.duty, dutyOf(src)); near(ev.length, w.eventsPerS * T, 1.01, id);
  }
});

test('examples carry palette keywords: measurement, walk and noise are findable', () => {
  assert.ok(EXAMPLES.every((e) => typeof e.keywords === 'string'));
  const has = (w) => EXAMPLES.filter((e) => e.keywords.split(' ').includes(w)).map((e) => e.id);
  assert.ok(has('measurement').includes('measurements-clean-match')); assert.ok(has('measure').length >= 3);
  assert.ok(has('noise').includes('noise-flash-at-pit') && has('noise').includes('video-wall-noisy'));
  for (const e of EXAMPLES) if (buildExample(e.id).walk) assert.ok(e.keywords.split(' ').includes('walk'), `${e.id} has a walk`);
  assert.equal(exampleKeywords({ id: 'zzz' }), '');
});
