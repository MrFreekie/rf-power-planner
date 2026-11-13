import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNumber, formatNumber, lengthToUi, lengthFromUi, powerUiToDbm, powerFieldRange, bandForFreq, bandCentre, lossText, pathRows } from '../js/ui/fields.js';
import { waterfallScale, tickLabel, deltaText, fitText, buildRows } from '../js/view/waterfall.js';

test('parseNumber', () => {
  assert.equal(parseNumber('12.5'), 12.5);
  assert.equal(parseNumber('12,5'), 12.5);
  assert.ok(Number.isNaN(parseNumber('')));
  assert.ok(Number.isNaN(parseNumber('-')));
  assert.ok(Number.isNaN(parseNumber('abc')));
});
test('formatNumber trims', () => {
  assert.equal(formatNumber(1.23456), '1.235');
  assert.equal(formatNumber(2), '2');
});
test('length round trip', () => {
  assert.ok(Math.abs(lengthToUi(10, 'ft') - 32.8084) < 1e-3);
  assert.ok(Math.abs(lengthFromUi(lengthToUi(7.3, 'ft'), 'ft') - 7.3) < 1e-9);
  assert.equal(lengthToUi(5, 'm'), 5);
});
test('power conversion clamps', () => {
  assert.equal(powerUiToDbm(14, 'dBm'), 14);
  assert.equal(powerUiToDbm(-16, 'dBW'), 14);
  assert.ok(Math.abs(powerUiToDbm(10, 'mW') - 10) < 1e-9);
  assert.equal(powerUiToDbm(500, 'dBm'), 50);
  assert.ok(Number.isNaN(powerUiToDbm(0, 'mW')));
  assert.equal(powerFieldRange('dBW').max, 20);
});
test('bands', () => {
  assert.equal(bandForFreq(600), 'uhf-470-608');
  assert.equal(bandForFreq(100), '');
  assert.equal(bandCentre('uhf-863-865'), 864);
});
test('lossText', () => {
  assert.equal(lossText(2.04), 'loss 2.0 dB');
  assert.equal(lossText(-10), 'gain 10.0 dB');
});
test('pathRows', () => {
  const rows = pathRows({ paths: [{ kind: 'direct', lengthM: 10, delayNs: 33.356, relDb: 0 }, { kind: 'wall', via: 'w', lengthM: 12, delayNs: 40, relDb: -6.04 }] },
    { reflectors: [{ id: 'w', name: 'Back wall' }] }, 'm');
  assert.equal(rows[0].relDb, '0.0');
  assert.equal(rows[1].kind, 'wall (Back wall)');
  assert.equal(rows[1].relDb, '-6.0');
});
test('waterfallScale covers values', () => {
  const s = waterfallScale([{ valueDbm: 14 }, { valueDbm: -62.5 }], -95);
  assert.ok(s.min <= -98 && s.max >= 17 && s.min % s.step === 0 && s.max % s.step === 0);
});
test('tickLabel units', () => {
  assert.equal(tickLabel(-30, 'dBm'), '-30');
  assert.equal(tickLabel(0, 'dBW'), '-30');
  assert.equal(tickLabel(10, 'mW'), '10 mW');
  assert.equal(tickLabel(-30, 'mW'), '1 µW');
});
test('deltaText and fitText', () => {
  assert.equal(deltaText(-3), '\u22123.0 dB');
  assert.equal(deltaText(2), '+2.0 dB');
  assert.equal(fitText('abcdef', 100, (t) => t.length * 10), 'abcdef');
  assert.equal(fitText('abcdefghijkl', 50, (t) => t.length * 10), 'abcd\u2026');
});
test('buildRows appends end row', () => {
  const rows = buildRows({ waterfall: [{ label: 'Tx power', valueDbm: 14, deltaDb: 0 }, { label: 'Loss', valueDbm: 4, deltaDb: -10 }], inputPowerDbm: 4, marginDb: 5, status: 'marginal' }, -1);
  assert.deepEqual(rows.map((r) => r.type), ['start', 'loss', 'end']);
});

import { stateSpans, timeStep, rfRange, runsBy } from '../js/view/timeline.js';
import { frac, peakHold, RF_RANGE } from '../js/view/meters.js';
test('stateSpans groups open/closed runs', () => {
  const s = [true, true, false, false, true].map((open, i) => ({ t: i, open }));
  assert.deepEqual(stateSpans(s).map((x) => [x.open, x.t0, x.t1]), [[true, 0, 2], [false, 2, 4], [true, 4, 4]]);
  assert.deepEqual(stateSpans([]), []);
  assert.equal(runsBy([{ t: 0, mode: 'a' }, { t: 1, mode: 'b' }], (x) => x.mode).length, 2);
});
test('timeline range helpers', () => {
  assert.equal(timeStep(10), 2); assert.equal(timeStep(30), 5); assert.equal(timeStep(120), 20);
  const r = rfRange([{ rfDbm: -62, thresholdDbm: -90 }]);
  assert.ok(r.min <= -95 && r.max >= -57 && r.max - r.min >= 30);
});
test('meter helpers', () => {
  assert.equal(frac(-110, RF_RANGE), 0); assert.equal(frac(0, RF_RANGE), 1); assert.equal(frac(-55, RF_RANGE), 0.5);
  const p = peakHold(null, -50, 0, RF_RANGE);
  assert.equal(peakHold(p, -80, 1, RF_RANGE).v, -50);
  assert.ok(peakHold(p, -80, 2, RF_RANGE).v < -50);
  assert.equal(peakHold(p, -40, 1, RF_RANGE).v, -40);
});
