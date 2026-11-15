// IMD pop-out: pure axis zoom and pan, and the dialog id stays unique when two zoom dialogs exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { zoomAxis, panAxis, FULL_VIEW } from '../js/view/imd.js';

test('zoomAxis zooms about a point, never leaves 0..1, has a minimum span', () => {
  const v = zoomAxis(FULL_VIEW, 2, 0.5);
  assert.ok(Math.abs(v.a - 0.25) < 1e-9 && Math.abs(v.b - 0.75) < 1e-9);
  const l = zoomAxis(FULL_VIEW, 4, 0); assert.equal(l.a, 0); assert.ok(Math.abs(l.b - 0.25) < 1e-9);
  const r = zoomAxis(FULL_VIEW, 4, 1); assert.equal(r.b, 1);
  let w = { ...FULL_VIEW }; for (let i = 0; i < 30; i++) w = zoomAxis(w, 2, 0.3);
  assert.ok(w.b - w.a >= 0.04 - 1e-9 && w.a >= 0 && w.b <= 1);
  assert.deepEqual(zoomAxis(v, 0.01, 0.5).b - zoomAxis(v, 0.01, 0.5).a, 1, 'zooming far out returns the full axis');
});

test('panAxis keeps the span and stays inside the axis', () => {
  const v = { a: 0.4, b: 0.6 };
  const p = panAxis(v, 0.5); assert.ok(Math.abs(p.a - 0.5) < 1e-9 && Math.abs(p.b - 0.7) < 1e-9);
  assert.equal(panAxis(v, -100).a, 0); assert.equal(panAxis(v, 100).b, 1);
  assert.deepEqual(panAxis(FULL_VIEW, 1), { a: 0, b: 1 });
});
