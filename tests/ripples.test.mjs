import test from 'node:test';
import assert from 'node:assert/strict';
import {
  wavelengthM, ringSpacing, advancePhase, ringOffsetM, ringRadiusM, ringCount, spreadingRelDb, ringAlpha, alphaBucket,
  relativeTable, angleIndex, ringArrival, fieldRelDb, fieldAlpha,
} from '../js/view/rippleMath.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('wavelength at 600 MHz is about 0.5 m (hand computed 299.79/600 = 0.4997)', () => {
  near(wavelengthM(600), 0.49965, 1e-4);
});

test('ringSpacing keeps the true wavelength when it is wide enough on screen', () => {
  const r = ringSpacing(0.5, 40); // 20 px
  assert.equal(r.multiple, 1);
  near(r.spacingM, 0.5, 1e-12);
});

test('ringSpacing picks a whole multiple when under 8 px', () => {
  const r = ringSpacing(0.5, 10); // 5 px -> ceil(8/5) = 2
  assert.equal(r.multiple, 2);
  near(r.spacingM, 1.0, 1e-12);
  const r2 = ringSpacing(0.5, 4); // 2 px -> 4
  assert.equal(r2.multiple, 4);
  assert.ok(r2.spacingM * 4 >= 8 / 1); // result is at least 8 px
  assert.ok(ringSpacing(0.5, 4).spacingM * 4 >= 8 - 1e-9);
});

test('ring phase and radii', () => {
  near(advancePhase(0.9, 0.5, 0.6), 0.2, 1e-12);
  near(ringOffsetM(0.25, 0.5), 0.125, 1e-12);
  near(ringRadiusM(3, 0.25, 0.5), 1.625, 1e-12);
  near(ringOffsetM(-0.25, 0.5), 0.375, 1e-12);
});

test('ringCount is capped and zero when out of range', () => {
  assert.equal(ringCount(0.05, 0.5, 0.5), 0);
  assert.equal(ringCount(100, 0, 0.5, 40), 40);
  assert.equal(ringCount(2, 0, 0.5), 5); // radii 0, 0.5, 1, 1.5, 2 (the zero-radius ring is not drawn)
});

test('spreading loss is 6 dB per doubling and zero inside the reference distance', () => {
  near(spreadingRelDb(2, 1), -6.0206, 1e-3);
  near(spreadingRelDb(0.3, 1), 0, 1e-12);
  near(spreadingRelDb(10, 1), -20, 1e-9);
});

test('ringAlpha: on-axis first ring is below saturation, falls with distance and off-axis', () => {
  const a0 = ringAlpha(0, 0.5, 0.5);
  assert.ok(a0 > 0.7 && a0 < 1);
  assert.ok(ringAlpha(0, 5, 0.5) < a0);
  assert.ok(ringAlpha(-12, 0.5, 0.5) < a0);
  assert.equal(ringAlpha(-40, 0.5, 0.5), 0);
  assert.ok(ringAlpha(0, 1, 0.5, 10) < ringAlpha(0, 1, 0.5, 0));
});

test('alphaBucket quantises and hides faint rings', () => {
  assert.equal(alphaBucket(0.0), 0);
  assert.equal(alphaBucket(0.8), 6);
  assert.ok(alphaBucket(0.3) > 0 && alphaBucket(0.3) < 6);
});

test('relativeTable and angleIndex', () => {
  const t = relativeTable([3, 7, 5]);
  assert.deepEqual([...t], [-4, 0, -2]);
  assert.equal(angleIndex(0, 72), 0);
  assert.equal(angleIndex(-5, 72), 71);
  assert.equal(angleIndex(360, 72), 0);
});

test('ringArrival is 1 on a ring and 0 between rings', () => {
  near(ringArrival(0.5, 0, 0.5, 40), 1, 1e-9);   // ring at 0 and 0.5
  assert.equal(ringArrival(0.25, 0, 0.5, 40), 0); // halfway between rings
});

test('fieldRelDb: equal in-phase image doubles the amplitude (+6 dB), anti-phase cancels', () => {
  const k = 2 * Math.PI / 0.5;
  // direct and an image at the same position with phase 0 -> 2x amplitude
  near(fieldRelDb([0, 0, 0, 1, 0, 0, 0, 0, 1, 0], k, 3, 0), 6.0206, 1e-3);
  // image with phase pi at the same position -> deep null (clamped to the floor)
  assert.equal(fieldRelDb([0, 0, 0, 1, 0, 0, 0, 0, 1, Math.PI], k, 3, 0), -40);
});

test('fieldRelDb shows a two-ray null where the path difference is a half wavelength', () => {
  const lambda = 0.5, k = 2 * Math.PI / lambda;
  // image source below the floor at z = -2 (plane: x along, y = z); reflection coefficient -1
  const src = [0, 2, 0, 1, 0, 0, -2, 0, 1, Math.PI];
  // observation point where d_image - d_direct = lambda * n: constructive/destructive alternate
  let min = Infinity, max = -Infinity;
  for (let y = 0; y < 4; y += 0.005) { const v = fieldRelDb(src, k, 5, y); min = Math.min(min, v); max = Math.max(max, v); }
  assert.ok(min < -15, `min ${min}`);
  assert.ok(max > 3, `max ${max}`);
});

test('fieldAlpha maps nulls to clear and peaks to dark', () => {
  assert.equal(fieldAlpha(-40), 0);
  assert.ok(fieldAlpha(6) > 0.6);
  assert.ok(fieldAlpha(0) > fieldAlpha(-10));
});
