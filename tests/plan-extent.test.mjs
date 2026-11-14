import test from 'node:test';
import assert from 'node:assert/strict';
import { planExtent, planPoints, farBounds } from '../js/view/planExtent.js';

const base = { stage: { width: 12, depth: 8 }, links: [], reflectors: [], zones: [], platforms: [] };

test('empty scene gives the stage rectangle with margins', () => {
  assert.deepEqual(planExtent(base), { x0: -1, y0: -1.2, x1: 13, y1: 9.8 });
});
test('reflector far ends extend the area', () => {
  const e = planExtent({ ...base, reflectors: [{ p1: { x: -30, y: 4 }, p2: { x: 40, y: 60 } }] });
  assert.ok(e.x0 <= -31 && e.x1 >= 41 && e.y1 >= 61);
});
test('zones, platforms, tx/rx, antenna B, branches and IMD transmitters count', () => {
  const s = { ...base,
    zones: [{ polygon: [{ x: 0, y: 0 }, { x: 5, y: -20 }, { x: 5, y: 5 }] }],
    platforms: [{ x: 20, y: 0, width: 4, depth: 2, rotationDeg: 0 }],
    links: [{ tx: { pos: { x: 1, y: 1 } }, rx: { pos: { x: -15, y: 2 }, diversity: { antennaB: { pos: { x: 3, y: 30 } } } }, branches: [{ pos: { x: 50, y: 1 } }] }],
    imd: { enabled: true, transmitters: [{ pos: { x: 0, y: -40 } }] } };
  const e = planExtent(s);
  assert.ok(e.y0 <= -41 && e.y1 >= 31 && e.x0 <= -16 && e.x1 >= 51);
});
test('venue underlay never affects extent', () => {
  const v = { layers: [{ shades: [{ step: 1, edges: [[-500, -500, 900, 900]] }] }] };
  assert.deepEqual(planExtent({ ...base, venue: v }), planExtent(base));
});
test('disabled IMD and invalid numbers are ignored', () => {
  const s = { ...base, imd: { enabled: false, transmitters: [{ pos: { x: 99, y: 99 } }] }, reflectors: [{ p1: { x: NaN, y: 0 }, p2: { x: 1e9, y: 0 } }] };
  assert.deepEqual(planExtent(s), planExtent(base));
  assert.equal(planPoints(s).length, 1);
});
test('rotated platform corners are used', () => {
  const pts = planPoints({ platforms: [{ x: 0, y: 0, width: 10, depth: 2, rotationDeg: 90 }] });
  assert.ok(Math.max(...pts.map((p) => p.y)) > 5);
});
test('far bounds allow about 200 m beyond the stage', () => {
  const b = farBounds({ width: 12, depth: 8 });
  assert.equal(b.x0, -200); assert.equal(b.x1, 212); assert.equal(b.y1, 208);
});
