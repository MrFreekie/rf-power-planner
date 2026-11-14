import test from 'node:test';
import assert from 'node:assert/strict';
import { toDisplay, fromDisplay, dispX, dispY, internalX, internalY, dispRange, describePos } from '../js/ui/coords.js';

const scene = { stage: { width: 12, depth: 8 } };

test('stage centre line and front edge are the display origin', () => {
  assert.deepEqual(toDisplay(scene, { x: 6, y: 8 }), { x: 0, y: 0 });
  assert.deepEqual(toDisplay(scene, { x: 0, y: 0 }), { x: -6, y: 8 });   // front-left model corner is back-left in display terms
  assert.deepEqual(toDisplay(scene, { x: 12, y: 8 }), { x: 6, y: 0 });
  assert.equal(dispY(scene, 10), -2); // 2 m in front of the stage (audience side) is negative
});

test('round trip and pass-through fields', () => {
  for (const p of [{ x: 1.25, y: 3.5, z: 1.5 }, { x: -3, y: 12.1 }, { x: 6, y: 4 }]) {
    const back = fromDisplay(scene, toDisplay(scene, p));
    assert.deepEqual(back, p);
  }
  assert.equal(toDisplay(scene, { x: 1, y: 1, z: 2.5 }).z, 2.5);
});

test('no negative zero and no float noise', () => {
  assert.ok(Object.is(dispX(scene, 6), 0));
  assert.equal(internalX({ stage: { width: 0.7, depth: 0.1 } }, 0.1), 0.45);
  assert.equal(dispY({ stage: { width: 1, depth: 0.3 } }, 0.1), 0.2);
});

test('works for other stage sizes', () => {
  const s2 = { stage: { width: 24, depth: 12 } };
  assert.equal(dispX(s2, 12), 0);
  assert.equal(internalY(s2, 0), 12);
  assert.equal(internalX(s2, -12), 0);
});

test('ranges flip for y', () => {
  assert.deepEqual(dispRange(scene, 'x', -50, 100), [-56, 94]);
  assert.deepEqual(dispRange(scene, 'y', -50, 100), [-92, 58]);
  assert.deepEqual(dispRange(scene, 'z', 0, 5), [0, 5]);
});

test('describePos', () => {
  assert.equal(describePos(scene, { x: 7.2, y: 5 }), 'x 1.20 m, y 3.00 m');
});
