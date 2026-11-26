import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampBottomHeight } from '../js/ui/bottomResize.js';

test('clampBottomHeight keeps the bar between 140 px and 70% of the window', () => {
  assert.equal(clampBottomHeight(50, 900), 140);
  assert.equal(clampBottomHeight(300.4, 900), 300);
  assert.equal(clampBottomHeight(5000, 900), 630);
  assert.equal(clampBottomHeight(NaN, 900), 140);
  assert.equal(clampBottomHeight(400, 100), 140);
});
