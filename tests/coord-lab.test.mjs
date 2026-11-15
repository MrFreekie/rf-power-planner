import test from 'node:test';
import assert from 'node:assert/strict';
import { planHits, equalSpacingPlan, evaluateCandidates, bestCandidates, candidateFrequencies, bestPlan, failureSummary, tvOccupiedBlocked } from '../js/model/coord-lab.js';
import { checkIntermod } from '../js/model/coordination.js';
import { imdSummary, coordinationCheck } from '../js/model/imd.js';
import { buildExample } from '../js/examples.js';
import { simulatedOccupancy } from '../js/model/spectrum-map.js';

test('planHits: three equally spaced channels, hand count 2 two-tx hits and 1 three-tx hit (guard 100 kHz)', () => {
  // f = 600.0, 600.4, 600.8: 2f2 - f1 = 600.8 = f3, 2f2 - f3 = 600.0 = f1 (2-tx), f1 + f3 - f2 = 600.4 = f2 (3-tx). 2f1 - f2 = 599.6, 2f3 - f2 = 601.2, 2f1 - f3 = 599.2, 2f3 - f1 = 601.6 are clear.
  const r = planHits(equalSpacingPlan(3, 600, 400), { guardKHz: 100 });
  assert.deepEqual([r.hits2, r.hits3, r.hitsTotal, r.ok], [2, 1, 3, false]);
  assert.equal(r.minProductDistanceKHz, 0);
  assert.deepEqual(equalSpacingPlan(3, 600, 400), [600, 600.4, 600.8]);
});

test('planHits agrees with checkIntermod (same engine) and with the IMD panel distinct third-order count', () => {
  const f = [606.1, 606.5, 607.3, 608.9, 610.1];
  const a = planHits(f), b = checkIntermod(f, {});
  assert.equal(a.hitsTotal, b.conflicts.length);
  const sc = buildExample('imd-too-close').scene;
  const freqs = sc.imd.transmitters.map((t) => t.freqMHz);
  const lab = planHits(freqs, { guardKHz: sc.imd.channelBwKHz / 2, minSpacingKHz: 0 });
  const sum = imdSummary(sc);
  assert.equal(lab.hitsTotal, 6, 'hand: 605.6, 606, 606.4, 607.2 gives 2f2-f1, 2f3-f1... six distinct third-order hits');
  assert.equal(sum.inChannelThirdOrderDistinctCount, lab.hitsTotal, 'lab and panel agree');
  // the old headline: every (product, mechanism) pair, third and fifth order. 28 = 6 front end + 4 reverse (same frequencies again) third order + 17 + 1 fifth order.
  assert.equal(sum.inChannelCount, 28);
  assert.equal(sum.inChannelThirdOrderCount, 10);
  const by = {};
  coordinationCheck(sc).forEach((c) => { const k = `${c.product.source}:${c.product.order}`; by[k] = (by[k] || 0) + 1; });
  assert.deepEqual(by, { 'front-end:3': 6, 'tx-reverse:3': 4, 'front-end:5': 17, 'tx-reverse:5': 1 });
  assert.ok(sum.inChannelDistinctCount < sum.inChannelCount && sum.inChannelDistinctCount >= sum.inChannelThirdOrderDistinctCount);
});

test('evaluateCandidates: hand-checked candidates next to fixed 600.0 and 600.4 MHz', () => {
  const rows = evaluateCandidates({ fixedMHz: [600, 600.4], candidatesMHz: [600.1, 600.8, 603, 601.2] });
  const at = (f) => rows.find((r) => r.freqMHz === f);
  // 600.8: 2f2 - f1 = 600.8 lands on the candidate (2-tx), 2f2 - f3 = 600.0 lands on f1 (2-tx), f1 + f3 - f2 = 600.4 lands on f2 (3-tx)
  assert.deepEqual([at(600.8).ok, at(600.8).hits2, at(600.8).hits3], [false, 2, 1]);
  assert.deepEqual(at(600.8).reasons.map((r) => r.code), ['product-on-candidate', 'product-on-fixed']);
  assert.equal(at(600.1).reasons[0].code, 'spacing');
  assert.equal(at(600.1).reasons[0].spacingKHz, 100);
  assert.ok(at(603).ok && at(603).hits2 === 0 && at(603).hits3 === 0 && at(603).nearestKHz === 2600);
  assert.ok(at(601.2).ok);
  assert.ok(at(603).rank >= 1 && at(601.2).rank >= 1 && at(600.8).rank === null);
  assert.match(at(600.8).explanation, /2f2-f1/);
  assert.deepEqual(bestCandidates(rows, 10).map((r) => r.freqMHz).sort(), [601.2, 603]);
  assert.deepEqual(failureSummary(rows).byReason, { 'product-on-candidate': 2, 'product-on-fixed': 2, spacing: 1 });
  // the candidate count of the 600.8 case equals planHits of the whole set
  const set = planHits([600, 600.4, 600.8]);
  assert.equal(at(600.8).hitsTotal, set.hitsTotal);
});

test('evaluateCandidates: blocked ranges and duplicates give reasons', () => {
  const rows = evaluateCandidates({ fixedMHz: [606.1], candidatesMHz: [606.1, 610.05, 611.2], blocked: [{ fromMHz: 610, toMHz: 610.1, label: 'TV ch 38 test' }] });
  assert.equal(rows[0].reasons[0].code, 'duplicate');
  assert.equal(rows[1].reasons[0].code, 'blocked');
  assert.match(rows[1].explanation, /TV ch 38 test/);
  assert.equal(rows[2].ok, true);
});

test('candidateFrequencies: raster count by hand and blocked ranges', () => {
  // 606.5-613.5 with a 100 kHz edge guard and a 25 kHz raster: 606.6 .. 613.4 = (613400 - 606600) / 25 + 1 = 273 points
  const c = candidateFrequencies({ band: [{ startMHz: 606.5, endMHz: 613.5 }] });
  assert.equal(c.frequenciesMHz.length, 273);
  assert.equal(c.frequenciesMHz[0], 606.6);
  assert.equal(c.frequenciesMHz.at(-1), 613.4);
  // a blocked 610-611 range widened by 100 kHz each side removes 610.0 +- ... points strictly inside (609.9, 611.1): 609.925 .. 611.075 = 47
  const b = candidateFrequencies({ band: [{ startMHz: 606.5, endMHz: 613.5 }], blocked: [{ fromMHz: 610, toMHz: 611 }] });
  assert.equal(b.blockedCount, 47);
  assert.equal(b.frequenciesMHz.length, 273 - 47);
  const t = candidateFrequencies({ band: [{ startMHz: 470, endMHz: 694 }], maxCandidates: 500 });
  assert.ok(t.thinned && t.frequenciesMHz.length <= 500);
});

test('tvOccupiedBlocked from the illustrative occupancy removes those channels from the candidates', () => {
  const occ = simulatedOccupancy('uk-suburban', 'weak-tv-example');
  const blocked = tvOccupiedBlocked(occ.channels);
  assert.equal(blocked.length, occ.occupiedCount);
  const c = candidateFrequencies({ band: [{ startMHz: 566, endMHz: 582 }], blocked });
  assert.ok(c.frequenciesMHz.every((f) => !(f > 565.9 && f < 582.1)), 'ch 33 and 34 (566-582) are occupied');
});

test('bestPlan: UK ch38 with a kept channel, verified by planHits and checkIntermod', () => {
  const r = bestPlan({ regionId: 'uk', rangeIds: ['uk-ch38'], mics: 3, fixed: [{ id: 'keep', freqMHz: 607.0 }] });
  assert.equal(r.ok, true);
  assert.equal(r.frequencies.length, 4);
  assert.equal(r.frequencies.find((f) => f.id === 'keep').freqMHz, 607.0);
  assert.equal(r.lab.hitsTotal, 0);
  assert.ok(r.frequencies.every((f) => f.freqMHz >= 606.5 && f.freqMHz <= 613.5));
  assert.equal(checkIntermod(r.frequencies.map((f) => f.freqMHz), { guardKHz: r.guardKHz, minSpacingKHz: r.minSpacingKHz }).ok, true);
  assert.equal(r.candidates.total, 273);
  const bad = bestPlan({ regionId: 'uk', rangeIds: ['uk-ch38'], mics: 40 });
  assert.equal(bad.ok, false);
  assert.equal(bad.failure.reason, 'band-too-narrow');
});
