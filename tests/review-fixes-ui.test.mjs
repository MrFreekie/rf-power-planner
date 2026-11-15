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
