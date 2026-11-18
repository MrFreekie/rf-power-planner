import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStampText } from '../js/ui/buildStamp.js';

test('stamp text is empty for a missing or invalid time', () => {
  assert.equal(buildStampText(null), '');
  assert.equal(buildStampText('not a date'), '');
});
test('stamp text names the date and time', () => {
  const t = buildStampText('2026-11-18T14:05:00Z', 'en-GB');
  assert.match(t, /^Updated /);
  assert.match(t, /2026/);
});
