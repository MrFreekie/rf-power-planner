import test from 'node:test';
import assert from 'node:assert/strict';
import { platformCorners, resizeFromCorner, rotationFromPointer, rotationHandleWorld, chordSpan, worldToLocal } from '../js/view/platformGeom.js';
import { platformBoxes, pointInPlatform } from '../js/model/floor.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const P = { id: 'p1', x: 2, y: 1, width: 4, depth: 2, topM: 0.4, material: 'wood', rotationDeg: 0 };

test('corners match platformBoxes for several rotations', () => {
  for (const r of [0, 30, 90, -45, 180]) {
    const p = { ...P, rotationDeg: r };
    const scene = { stage: { width: 12, depth: 8, heightM: 0 }, environment: { floor: 'wood' }, platforms: [p] };
    const box = platformBoxes(scene).find((b) => b.id === 'p1');
    platformCorners(p).forEach((c, i) => { near(c.x, box.corners[i].x); near(c.y, box.corners[i].y); });
  }
});

test('local frame agrees with pointInPlatform', () => {
  const p = { ...P, rotationDeg: 40 };
  for (const [x, y] of [[4, 2], [2.2, 1.1], [6, 3], [4, 4], [0, 0]]) {
    const l = worldToLocal(p, x, y);
    const inside = Math.abs(l.x) <= p.width / 2 && Math.abs(l.y) <= p.depth / 2;
    assert.equal(inside, pointInPlatform(p, x, y));
  }
});

test('resizing a rotated platform keeps the opposite corner fixed', () => {
  const p = { ...P, rotationDeg: 30 };
  const corners = platformCorners(p);
  for (let k = 0; k < 4; k++) {
    const opp = corners[(k + 2) % 4];
    const out = resizeFromCorner(p, k, { x: corners[k].x + 0.3, y: corners[k].y - 0.2 });
    const q = { ...p, ...out };
    const nc = platformCorners(q);
    // the fixed corner is the same index when the drag does not cross over
    near(nc[(k + 2) % 4].x, opp.x, 1e-9); near(nc[(k + 2) % 4].y, opp.y, 1e-9);
    assert.ok(out.width > 0 && out.depth > 0);
  }
});

test('resize with rotation 0 matches the axis-aligned rule', () => {
  const out = resizeFromCorner(P, 2, { x: 8, y: 4 });
  near(out.x, 2); near(out.y, 1); near(out.width, 6); near(out.depth, 3);
  const flipped = resizeFromCorner(P, 2, { x: 0, y: 0 }); // dragged past the fixed corner
  near(flipped.x, 0); near(flipped.y, 0); near(flipped.width, 2); near(flipped.depth, 1);
});

test('rotation from pointer uses azimuth (0 = +y, +90 = +x) and snaps', () => {
  const c = { x: 4, y: 2 };
  near(rotationFromPointer(P, { x: 4, y: 5 }), 0);
  near(rotationFromPointer(P, { x: 7, y: 2 }), 90);
  near(rotationFromPointer(P, { x: 1, y: 2 }), 270);
  near(rotationFromPointer(P, { x: c.x + Math.sin(0.25), y: c.y + Math.cos(0.25) }, 15), 15);
  const h = rotationHandleWorld({ ...P, rotationDeg: 90 }, 0.5); // local +y points to +x
  near(h.x, 4 + 1 + 0.5); near(h.y, 2);
});

test('chordSpan: axis-aligned and rotated', () => {
  const S = { x: 0, y: 2 }, u = { x: 1, y: 0 };
  let c = chordSpan(P, S, u); near(c[0], 2); near(c[1], 6);
  const p90 = { ...P, rotationDeg: 90 }; // 4 x 2 becomes 2 x 4 about (4,2): x from 3 to 5
  c = chordSpan(p90, S, u); near(c[0], 3); near(c[1], 5);
  assert.equal(chordSpan(P, { x: 0, y: 10 }, u), null);
  const p45 = { ...P, rotationDeg: 45 };
  c = chordSpan(p45, S, u); assert.ok(c[1] - c[0] > 0 && c[1] - c[0] < 4 + 2);
  // a ray along y through the rotated box's centre
  c = chordSpan(p90, { x: 4, y: -5 }, { x: 0, y: 1 }); near(c[1] - c[0], 4);
});
