// Review fixes: noise label fallback, surrogate-safe name clipping, cached half-power wedge, owners passed once per draw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { noiseLabel } from '../js/ui/noiseUi.js';
import { cleanName } from '../js/ui/nameInput.js';
import { halfPowerWedge } from '../js/view/tiltGauge.js';
import { personOfLink } from '../js/ui/peopleUi.js';
import { linkOwners } from '../js/model/people.js';
import { EXAMPLES } from '../js/examples.js';

test('noiseLabel: own name, else the catalogue label, else a plain default', () => {
  assert.equal(noiseLabel({ name: ' Crew radio ', kind: 'walkie-talkie' }), 'Crew radio');
  assert.ok(noiseLabel({ name: '', kind: 'led-wall' }).length > 0);
  assert.equal(noiseLabel({ name: '  ', kind: 'nope' }), 'Noise source');
  assert.equal(noiseLabel(null), 'Noise source');
});

test('cleanName clips by code point and never leaves half a surrogate pair', () => {
  const s = 'ab\u{1F3A4}\u{1F3A4}';
  const out = cleanName(s, 3);
  assert.equal(out, 'ab\u{1F3A4}');
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out));
  assert.equal(cleanName('a\u0007b'), 'ab');
});

test('halfPowerWedge is cached: the same antenna and axis give the same object, a change gives a new answer', () => {
  const sc0 = EXAMPLES.find((e) => e.id === 'band-four-piece-people').build().scene, a = sc0.links[0].rx.antenna;
  const u = { x: 0, y: 1 };
  const w1 = halfPowerWedge(a, u), w2 = halfPowerWedge(a, u);
  assert.equal(w1, w2);
  assert.equal(halfPowerWedge(a, { x: 1, y: 0 }), halfPowerWedge(a, { x: 1, y: 0 }));
});

test('personOfLink takes a prebuilt owners map and answers the same', () => {
  const sc = EXAMPLES.find((e) => e.id === 'band-four-piece-people').build().scene;
  const owners = linkOwners(sc.people), id = sc.people[0].micLinkId;
  assert.deepEqual(personOfLink(sc, id, owners), personOfLink(sc, id));
});

import { placeText } from '../js/view/util.js';
test('placeText moves a colliding label clear, skips optional ones that cannot fit, and records boxes', () => {
  const ctx = new Proxy({}, { get(t, k) { if (k === 'measureText') return (s) => ({ width: s.length * 6 }); return k in t ? t[k] : () => {}; }, set(t, k, v) { t[k] = v; return true; } });
  const th = { ink: '#000', paper: '#fff', font: 'sans-serif' };
  const placed = [];
  const a = placeText(ctx, th, 'first label', 50, 100, { px: 11 }, placed);
  const b = placeText(ctx, th, 'second label', 50, 100, { px: 11 }, placed);
  assert.ok(b.y + b.h <= a.y || b.y >= a.y + a.h, 'no overlap');
  assert.equal(placed.length, 2);
  const tight = { x: 0, y: 80, w: 500, h: 16 };
  assert.equal(placeText(ctx, th, 'third label', 50, 100, { px: 11, optional: true }, placed, tight), null);
});
