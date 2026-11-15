// assumptionsInUse / marginIsProven / confidenceSummary (js/model/assumptions-in-use.js): assumptions are listed only when they influenced the scene.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assumptionsInUse, assumptionsForLink, marginIsProven, confidenceSummary, PROVEN_BODY_WORN_MARGIN_DB } from '../js/model/assumptions-in-use.js';
import { solveLink } from '../js/model/rf.js';
import { boosterOverloadScene, weakTvScene, modeContrastScene } from '../js/examples.js';
import { createDefaultScene, createDefaultLink } from '../js/model/scene.js';

const ids = (items) => items.map((x) => x.id);
const omni = { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 }, polarisation: 'vertical' };
function cleanScene(body = 0, dist = 10) {
  const s = createDefaultScene(); s.environment.externalNoise = 0; s.environment.model = 'free-space'; s.environment.bodyLossDb = body;
  const l = createDefaultLink('mic'); s.links = [l]; l.freqMHz = 606.1;
  l.tx.pos = { x: 2, y: 5, z: 1.5 }; l.rx.pos = { x: 2 + dist, y: 5, z: 1.5 }; l.tx.antenna = { ...omni }; l.rx.antenna = { ...omni };
  l.rx.diversity.antennaB.pos = { x: 2 + dist, y: 4.6, z: 1.5 };
  return s;
}

test('a clean free-space scene uses no listed assumption and is proven', () => {
  const s = cleanScene(), items = assumptionsInUse(s);
  assert.deepEqual(ids(items), []);
  const r = solveLink(s, s.links[0]);
  assert.equal(marginIsProven(s.links[0], r, [], s).proven, true);
  assert.equal(confidenceSummary(s)[0].proven, true);
});

test('body loss is listed only when set, with U flag, effect, sensitivity and fix text', () => {
  const s = cleanScene(6, 10), items = assumptionsInUse(s);
  const b = items.find((x) => x.id === 'body-loss'); assert.ok(b);
  assert.equal(b.flag, 'U'); assert.equal(b.sensitivityDb, 3); assert.deepEqual(b.linkIds, [s.links[0].id]);
  assert.match(b.value, /^6\.0 dB/); assert.ok(b.effect.length > 40 && b.fix.length > 20 && b.label);
  const big = assumptionsInUse(cleanScene(10, 10)).find((x) => x.id === 'body-loss'); assert.equal(big.sensitivityDb, 5, '0.5 x 10 dB');
});

test('marginIsProven: body-worn under 10 dB is not proven; the same link with a big margin is; summed sensitivity can also fail it', () => {
  const near = cleanScene(6, 10), far = cleanScene(6, 900);
  const rn = solveLink(near, near.links[0]), rf = solveLink(far, far.links[0]);
  assert.ok(rn.marginDb > 20, `margin ${rn.marginDb}`);
  assert.equal(marginIsProven(near.links[0], rn, undefined, near).proven, true);
  assert.ok(rf.marginDb >= 0 && rf.marginDb < PROVEN_BODY_WORN_MARGIN_DB, `far margin ${rf.marginDb}`);
  const m = marginIsProven(far.links[0], rf, undefined, far);
  assert.equal(m.proven, false); assert.equal(m.bodyWorn, true); assert.ok(m.reasons.some((x) => /body-worn/.test(x)));
  // not body-worn, but assumptions add up to more than the margin
  const fake = [{ id: 'a', sensitivityDb: 4 }, { id: 'b', sensitivityDb: 4 }];
  const v = marginIsProven({ kind: 'mic' }, { marginDb: 6 }, fake);
  assert.equal(v.proven, false); assert.equal(v.sumSensitivityDb, 8); assert.ok(v.reasons.some((x) => /together/.test(x)));
  assert.equal(marginIsProven({ kind: 'mic' }, { marginDb: 12 }, fake).proven, true);
  assert.equal(marginIsProven({ kind: 'mic' }, { marginDb: -2 }, []).proven, false);
});

test('booster overload scene lists compression and noise levels; the filtered and plain variants list no compression', () => {
  const over = assumptionsInUse(boosterOverloadScene('overloaded'));
  assert.ok(ids(over).includes('booster-compression')); assert.ok(ids(over).includes('noise-source-levels'));
  const c = over.find((x) => x.id === 'booster-compression');
  assert.equal(c.flag, 'U'); assert.ok(Math.abs(c.sensitivityDb - 3.5) < 0.05); assert.match(c.effect, /3\.5 dB/);
  assert.ok(!ids(assumptionsInUse(boosterOverloadScene('filtered'))).includes('booster-compression'));
  assert.ok(!ids(assumptionsInUse(boosterOverloadScene('plain'))).includes('booster-compression'));
});

test('a TV block scene lists the TV illustration; the digital scene lists the cliff and the analogue twin does not', () => {
  const tv = assumptionsInUse(weakTvScene('strong-cochannel'));
  assert.ok(ids(tv).includes('tv-block-level')); assert.ok(ids(tv).includes('noise-source-levels'));
  const dg = assumptionsInUse(modeContrastScene('digital', 'weak')), an = assumptionsInUse(modeContrastScene('analog-fm', 'weak'));
  assert.ok(ids(dg).includes('digital-cliff')); assert.ok(!ids(an).includes('digital-cliff'));
  const cliff = dg.find((x) => x.id === 'digital-cliff'); assert.match(cliff.value, /-105\.9 dBm/);
});

test('external noise and wall emission are listed when they matter; results can be passed as an array, a Map or an object', () => {
  const s = cleanScene(); s.environment.externalNoise = 'urban';
  const items = assumptionsInUse(s); assert.ok(ids(items).includes('external-noise')); assert.equal(items.find((x) => x.id === 'external-noise').flag, 'I');
  const r = solveLink(s, s.links[0]), id = s.links[0].id;
  for (const res of [[r], new Map([[id, r]]), { [id]: r }]) assert.deepEqual(ids(assumptionsInUse(s, res)), ids(items));
  assert.equal(assumptionsForLink(items, id).length, items.length); assert.equal(assumptionsForLink(items, 'nope').length, 0);
});

test('every listed item carries the documented fields and no private wording', () => {
  const all = [...assumptionsInUse(boosterOverloadScene('overloaded')), ...assumptionsInUse(weakTvScene('strong-cochannel')), ...assumptionsInUse(modeContrastScene('digital', 'weak')), ...assumptionsInUse(cleanScene(8))];
  assert.ok(all.length >= 6);
  for (const x of all) {
    for (const k of ['id', 'label', 'value', 'flag', 'effect', 'fix']) assert.ok(typeof x[k] === 'string' && x[k].length > 0, `${x.id}.${k}`);
    assert.ok(x.flag === 'U' || x.flag === 'I'); assert.ok(x.sensitivityDb === null || Number.isFinite(x.sensitivityDb)); assert.ok(Array.isArray(x.linkIds));
    assert.ok(!/docs[\/]|research|agent|claude/i.test(`${x.label} ${x.effect} ${x.fix} ${x.value}`), x.id);
  }
});
