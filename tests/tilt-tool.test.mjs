// Side-view tilt tool: pointer snapping, keyboard steps, reset, gauge geometry, label placement, wedge, key wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tiltFromPointer, snapTilt, stepTilt, tiltGaugeTicks, tiltHandleLength, placeLabel, tiltText } from '../js/ui/antennaFields.js';
import { drawTiltGauge, halfPowerWedge, elementAxis } from '../js/view/tiltGauge.js';
import { attachInteraction } from '../js/view/interact.js';

function fakeCtx() {
  const calls = [];
  return new Proxy({ calls }, { get(t, k) { if (k in t) return t[k]; if (k === 'measureText') return () => ({ width: 40 }); return (...a) => { calls.push([k, ...a]); }; }, set(t, k, v) { t[k] = v; return true; } });
}

test('tiltFromPointer snaps to the step and clamps', () => {
  assert.equal(tiltFromPointer(100, 27, { step: 5 }), 15); // 15.1 deg
  assert.equal(tiltFromPointer(100, 30, { step: 5 }), 15);
  assert.equal(tiltFromPointer(100, 41, { step: 5 }), 20); // 22.3 deg rounds to 20
  assert.equal(tiltFromPointer(100, 41, { step: 1 }), 22);
  assert.equal(tiltFromPointer(0, 5, { step: 5 }), 90);
  assert.equal(tiltFromPointer(0, -5, { step: 5 }), -90);
  assert.equal(tiltFromPointer(-100, 0, { step: 5 }), 0);
  assert.equal(tiltFromPointer(0, 0, { step: 5 }), null);
  assert.equal(snapTilt(200, 5), 90); assert.equal(snapTilt(-200, 1), -90); assert.equal(snapTilt(NaN), 0);
  assert.ok(Object.is(snapTilt(-1, 5), 0), 'no negative zero');
});

test('keyboard steps: 5 degrees coarse to the next multiple, 1 degree fine, clamped, then reset', () => {
  assert.equal(stepTilt(0, 1), 5); assert.equal(stepTilt(5, 1), 10); assert.equal(stepTilt(0, -1), -5);
  assert.equal(stepTilt(7, 1), 10); assert.equal(stepTilt(7, -1), 5); assert.equal(stepTilt(-7, 1), -5);
  assert.equal(stepTilt(0, 1, true), 1); assert.equal(stepTilt(25, -1, true), 24);
  assert.equal(stepTilt(90, 1), 90); assert.equal(stepTilt(-90, -1, true), -90);
  assert.equal(stepTilt(undefined, 1), 5);
  let t = 0; for (let i = 0; i < 40; i++) t = stepTilt(t, 1); assert.equal(t, 90);
  assert.equal(tiltText(25), '+25°'); assert.equal(tiltText(-5), '−5°'); assert.equal(tiltText(0), '0°');
});

test('gauge ticks every 15 degrees; handle length scales within 56..130 px', () => {
  const t = tiltGaugeTicks();
  assert.equal(t.length, 13); assert.equal(t[0].deg, -90); assert.equal(t[12].deg, 90);
  assert.deepEqual(t.filter((x) => x.major).map((x) => x.deg), [-90, -45, 0, 45, 90]);
  assert.equal(tiltHandleLength(10), 56); assert.equal(tiltHandleLength(1000), 130); assert.equal(tiltHandleLength(100), 80);
  assert.ok(tiltHandleLength(60) >= 56 && tiltHandleLength(60) <= 130);
});

test('label placement avoids the height and name labels and stays in bounds', () => {
  const size = { w: 70, h: 16 }, anchor = { x: 200, y: 100 };
  const free = placeLabel(anchor, size, [], { w: 400, h: 300 });
  assert.ok(free.clear); assert.ok(free.y < anchor.y, 'default is above the handle');
  const avoid = [{ x: 150, y: 70, w: 120, h: 20 }]; // a height label sitting where the default goes
  const r = placeLabel(anchor, size, avoid, { w: 400, h: 300 });
  assert.ok(r.clear);
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  assert.ok(!hit(r, avoid[0]));
  const edge = placeLabel({ x: 395, y: 5 }, size, [], { w: 400, h: 300 });
  assert.ok(edge.x >= 2 && edge.x + edge.w <= 398 && edge.y >= 2);
  const boxed = placeLabel(anchor, size, [{ x: 0, y: 0, w: 400, h: 300 }], { w: 400, h: 300 });
  assert.equal(boxed.clear, false);
});

test('half-power wedge follows the tilt and the gauge draws for every selection state', () => {
  const u = { x: 1, y: 0 }; // slice along east
  const yagi = { type: 'yagi', orientation: { az: 90, el: 0 }, tiltDeg: 0 };
  const w0 = halfPowerWedge(yagi, u), w1 = halfPowerWedge({ ...yagi, tiltDeg: 25 }, u);
  assert.ok(w0 && w0.lo > 0 && w0.hi > 0 && w0.lo < 90, 'a directional antenna has a finite wedge');
  assert.ok(Math.abs(w0.centre - 90) < 1e-6, 'level boresight points along +s');
  assert.ok(Math.abs(w1.centre - 65) < 1e-6, 'tilting the nose up by 25 deg moves the centre line up');
  assert.equal(halfPowerWedge({ type: 'yagi', orientation: { az: 0, el: 0 } }, u), null, 'boresight across the slice has no wedge');
  assert.deepEqual(elementAxis({ type: 'whip', polarisation: 'rhcp', orientation: { az: 90, el: 0 } }), null);
  for (const type of ['whip', 'dipole', 'panel', 'yagi', 'log-periodic']) for (const selected of [true, false]) for (const tilt of [0, 25, -90, 90]) {
    const g = fakeCtx();
    const a = { type, orientation: { az: 90, el: 0 }, tiltDeg: tilt, polarisation: 'slant45', rollDeg: 10 };
    const r = drawTiltGauge(g, { ink: '#000', inkSoft: '#555', paper: '#fff' }, { x: 100, y: 100 }, { len: 80, selected, tilt, el: 0, u, antenna: a, hot: true, active: true });
    assert.ok(r.tip && /tilt/.test(r.text));
    assert.equal(g.calls.filter((c) => c[0] === 'save').length, g.calls.filter((c) => c[0] === 'restore').length);
    if (selected) assert.ok(g.calls.filter((c) => c[0] === 'moveTo').length >= 13, 'ticks drawn');
  }
});

test('keys: Page Up/Down tilt, Shift is fine, End resets, double-click reaches the hit handler, arrows stay unchanged', () => {
  const listeners = {};
  const canvas = { style: {}, clientWidth: 400, clientHeight: 300, addEventListener: (n, f) => { listeners[n] = f; }, removeEventListener() {}, focus() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const got = [];
  const vp = { screenToWorld: (x, y) => ({ x, y }), zoomAt() {}, panBy() {} };
  attachInteraction(canvas, vp, {
    hitTest: () => ({ kind: 'tilt', itemId: 'rx1' }),
    tiltBy: (d, fine) => got.push(['tilt', d, fine]), tiltReset: () => got.push(['reset']),
    nudge: (dx, dy) => got.push(['nudge', dx, dy]), rotate: (a, e) => got.push(['rotate', a, e]), cycle: (d) => got.push(['cycle', d]),
    dblclick: (hd) => got.push(['dbl', hd.itemId]),
  });
  const key = (k, o = {}) => listeners.keydown({ target: canvas, key: k, preventDefault() {}, ...o });
  key('PageUp'); key('PageDown', { shiftKey: true }); key('End'); key('ArrowUp'); key('ArrowUp', { altKey: true }); key(']');
  listeners.dblclick({ clientX: 5, clientY: 5 });
  assert.deepEqual(got, [['tilt', 1, undefined], ['tilt', -1, true], ['reset'], ['nudge', 0, -1], ['rotate', 0, -1], ['cycle', 1], ['dbl', 'rx1']]);
});
