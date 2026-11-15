// Example batch: presenter with a backup pack, two mics on one weak TV block, squelch noise burst, walking four-piece band, coordination pair.
// Every figure quoted in a note is recomputed from the model; hand anchors carry their tolerances.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXAMPLES, buildExample, presenterScene, weakTvTwoMicScene, squelchBurstReport, bandPeopleScene, bandWalkEndScene, linkMargins, coordScene, COORD_PLANS_MHZ, movePersonInScene,
} from '../js/examples.js';
import { solveLink } from '../js/model/rf.js';
import { validateScene } from '../js/model/scene.js';
import { imdSummary, noiseFloor } from '../js/model/imd.js';
import { planHits } from '../js/model/coord-lab.js';
import { personPackPositions } from '../js/model/people.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);
const f1 = (x) => x.toFixed(1);
const note = (id) => EXAMPLES.find((e) => e.id === id).note;
const has = (id, ...vals) => vals.forEach((v) => assert.ok(note(id).includes(v), `${id}: "${v}" not in note`));
const ok = (s) => assert.deepEqual(validateScene(s), { ok: true, errors: [] });
const IDS = ['presenter-with-backup-bodypack', 'two-mics-one-weak-tv-block', 'squelch-noise-burst', 'band-four-piece-walk', 'coord-equal-spacing', 'coord-spread-plan'];

test('the six new examples exist, validate, solve, name a category and have at most four sentences', () => {
  for (const id of IDS) {
    const ex = buildExample(id);
    assert.ok(ex, id); ok(ex.scene);
    for (const l of ex.scene.links) assert.ok(Number.isFinite(solveLink(ex.scene, l).marginDb), id);
    assert.match(ex.note, /^(Best practice|Less ideal|Problem|Compare): /, id);
    assert.ok(ex.note.split('. ').length <= 4, id);
  }
});

test('presenter: main pack owned by the person, backup beside it, margins and plan hand-checked', () => {
  const s = presenterScene(), p = s.people[0];
  const [mic, backup, iem] = s.links;
  assert.equal(p.micLinkId, mic.id); assert.equal(p.iemLinkId, iem.id);
  assert.deepEqual(p.extraLinkIds, [backup.id], 'the spare is owned by the presenter');
  near(Math.hypot(mic.tx.pos.x - backup.tx.pos.x, mic.tx.pos.y - backup.tx.pos.y), 0.3, 1e-6, 'packs 0.3 m apart across the belt line');
  near(mic.tx.pos.x - backup.tx.pos.x, -0.3, 1e-6);
  const mr = solveLink(s, mic), br = solveLink(s, backup), ir = solveLink(s, iem);
  near(mr.distanceM, 11.2, 0.15, 'about 11 m');
  has('presenter-with-backup-bodypack', f1(mr.marginDb), f1(br.marginDb), '607.3', '606.1', '614.1', '0.3 m apart');
  const h = planHits(s.links.map((l) => l.freqMHz));
  assert.equal(h.hitsTotal, 0);
  near(h.minProductDistanceKHz, 1200, 1e-6); // hand: 2 x 607.3 - 606.1 = 608.5 is 1200 kHz from 607.3; the other products are farther
  has('presenter-with-backup-bodypack', String(Math.round(h.minProductDistanceKHz)));
  assert.ok(Number.isFinite(ir.marginDb));
  // moving the person carries the main mic, the backup and the IEM pack
  const m = movePersonInScene(s, 'Presenter', { x: 6, y: 10 });
  const pk = personPackPositions(m.people[0]);
  near(m.links[0].tx.pos.x, pk.mic.x, 1e-9); near(m.links[2].rx.pos.x, pk.iem.x, 1e-9);
  near(m.links[1].tx.pos.x, pk.extra[backup.id].x, 1e-9); near(m.links[1].tx.pos.y, pk.extra[backup.id].y, 1e-9);
  near(m.links[1].tx.pos.x - m.links[0].tx.pos.x, backup.tx.pos.x - mic.tx.pos.x, 1e-9, 'the 0.3 m spacing is kept');
});

test('two mics on one weak block: same noise in both channels, products 1000 kHz clear', () => {
  const s = weakTvTwoMicScene();
  const [a, b] = s.links.map((l) => solveLink(s, l));
  near(a.noiseSources.sources[0].averageDbm, -100.8, 0.05); // hand: -85 - 10 log10(7600 / 200) = -100.80
  near(b.noiseSources.sources[0].averageDbm, a.noiseSources.sources[0].averageDbm, 0.05);
  near(a.noiseSources.riseDb, b.noiseSources.riseDb, 0.1);
  has('two-mics-one-weak-tv-block', f1(a.noiseSources.sources[0].averageDbm), f1(a.noiseSources.riseDb), f1(a.marginDb), f1(b.marginDb), '570.4', '571.4', '569.4', '572.4');
  const h = planHits([570.4, 571.4]);
  assert.equal(h.hitsTotal, 0);
  near(h.minProductDistanceKHz, 1000, 1e-6); // hand: 2 x 570.4 - 571.4 = 569.4 and 2 x 571.4 - 570.4 = 572.4, 1000 kHz from the nearer channel
  assert.equal(imdSummary(s).inChannelThirdOrderDistinctCount, 0);
  has('two-mics-one-weak-tv-block', '1000');
});

test('squelch burst: idle level under the threshold, flash over it, 30 events and 30 ms in 10 s', () => {
  const r = squelchBurstReport(10);
  assert.equal(r.idleOpen, false); assert.equal(r.burstOpen, true);
  near(r.peakDbm - r.avgDbm, -10 * Math.log10(0.003), 0.01); // hand: duty = 1 ms x 3 Hz = 0.003, 25.23 dB
  assert.equal(r.events, 30); near(r.openMs, 30, 1e-6);
  near(r.headroomIdleDb, r.idleLevelDbm - r.thresholdDbm, 1e-9);
  has('squelch-noise-burst', f1(r.distanceM), f1(r.peakDbm), f1(r.avgDbm), f1(r.floorDbm), f1(r.idleLevelDbm), f1(-r.headroomIdleDb), f1(r.headroomBurstDb), '30 times for 30 ms', '-90 dBm');
  // the idle level is the power sum of floor and average: never below the larger of the two
  assert.ok(r.idleLevelDbm >= Math.max(r.floorDbm, r.avgDbm));
});

test('walking band: the singer moves 6.5 m right and 1 m forward, only her two links change, packs keep their offsets', () => {
  const a = bandPeopleScene(), b = bandWalkEndScene();
  const ma = linkMargins(a), mb = linkMargins(b);
  for (const k of ['Ben mic', 'Ben IEM', 'Chloe mic', 'Chloe IEM', 'Dev mic', 'Dev IEM']) near(mb[k], ma[k], 1e-9, k);
  near(mb['Anna mic'] - ma['Anna mic'], -6.1, 0.05); near(mb['Anna IEM'] - ma['Anna IEM'], 10.9, 0.05);
  const pa = a.people.find((p) => p.name === 'Anna'), pb = b.people.find((p) => p.name === 'Anna');
  near(pb.pos.x - pa.pos.x, 6.5, 1e-9); near(pb.pos.y - pa.pos.y, 1, 1e-9);
  const ka = a.links.find((l) => l.id === pa.micLinkId).tx.pos, kb = b.links.find((l) => l.id === pb.micLinkId).tx.pos;
  near(kb.x - ka.x, 6.5, 1e-9); near(kb.y - ka.y, 1, 1e-9); near(kb.z, ka.z, 1e-9);
  has('band-four-piece-walk', f1(ma['Anna mic']), f1(mb['Anna mic']), f1(mb['Anna mic'] - ma['Anna mic']), f1(ma['Anna IEM']), f1(mb['Anna IEM']), '+' + f1(mb['Anna IEM'] - ma['Anna IEM']), '0.0 dB');
  const ex = buildExample('band-four-piece-walk');
  assert.deepEqual(ex.walk.to, b.links.find((l) => l.id === pb.micLinkId).tx.pos);
});

test('coordination pair: equal spacing has 2 + 1 hits, the spread plan none and keeps 1000 kHz; scenes carry the plan', () => {
  const eq = coordScene('equal'), sp = coordScene('spread');
  assert.deepEqual(eq.imd.transmitters.map((t) => t.freqMHz), COORD_PLANS_MHZ.equal);
  assert.deepEqual(sp.imd.transmitters.map((t) => t.freqMHz), COORD_PLANS_MHZ.spread);
  assert.equal(eq.links[0].freqMHz, 600.0);
  const he = planHits(COORD_PLANS_MHZ.equal, { guardKHz: 100, minSpacingKHz: 0 }), hs = planHits(COORD_PLANS_MHZ.spread, { guardKHz: 100, minSpacingKHz: 0 });
  assert.deepEqual([he.hits2, he.hits3], [2, 1]); // hand: 2f2-f1 = 600.8, 2f2-f3 = 600.0, f1+f3-f2 = 600.4
  assert.equal(hs.hitsTotal, 0);
  near(hs.minProductDistanceKHz, 1000, 1e-6); // hand: nearest products 599.0, 602.0, 602.3, 604.3, each 1000 kHz from a channel
  const se = imdSummary(eq), ss = imdSummary(sp);
  assert.equal(se.inChannelThirdOrderDistinctCount, he.hitsTotal, 'the panel and the lab agree');
  assert.equal(ss.inChannelThirdOrderDistinctCount, 0);
  const ne = noiseFloor(eq), ns = noiseFloor(sp);
  has('coord-equal-spacing', String(se.inChannelCount), f1(ne.imSumDbm), f1(ne.riseDb), '600.0, 600.4 and 600.8');
  has('coord-spread-plan', f1(ns.riseDb), '1000 kHz', '600.0, 601.0 and 603.3');
  assert.equal(ns.imSumDbm, -200, 'no product in any channel');
  const m1 = solveLink(eq, eq.links[0]).marginDb, m2 = solveLink(sp, sp.links[0]).marginDb;
  near(m1, m2, 0.05); has('coord-spread-plan', f1(m2));
});

// ---- pass 3 review fixes and the five new examples (figures re-run from the model; tolerances stated per assertion) ----
import { noiseSourceScene, weakTvScene, weakTvReport, boosterOverloadReport, boosterOverloadScene, measurementsScene, bodyWornScene } from '../js/examples.js';
import { suggestCalibration, compareMeasurements } from '../js/model/measurements.js';
import { confidenceSummary } from '../js/model/assumptions-in-use.js';
import { tvChannelOf, TV_OCCUPIED_MHZ } from '../js/model/spectrum-map.js';

const NEW_IDS = ['measurements-too-few-readings', 'tv-weak-6mhz-us-plan', 'noise-dect-intercom', 'noise-pyro-trigger-433', 'booster-padded-before-radio'];
test('the five pass-3 examples exist, validate, solve, lead with a category and have at most four sentences', () => {
  for (const id of NEW_IDS) {
    const ex = buildExample(id); assert.ok(ex, id); ok(ex.scene);
    for (const l of ex.scene.links) assert.ok(Number.isFinite(solveLink(ex.scene, l).marginDb), id);
    assert.match(ex.note, /^(Best practice|Less ideal|Problem|Compare): /, id); assert.ok(ex.note.split('. ').length <= 4, id);
  }
  assert.match(note('measurements-too-few-readings'), /^Less ideal: /); assert.match(note('noise-dect-intercom'), /^Problem: /);
});

test('every example note starts with exactly one of the four category words and a colon (the two old odd leads are fixed)', () => {
  for (const e of EXAMPLES) assert.match(e.note, /^(Best practice|Less ideal|Problem|Compare): /, e.id);
  assert.match(note('splitter-two-way-receiver'), /^Less ideal: /); assert.match(note('pad-on-iem-transmitter'), /^Less ideal: /);
});

test('booster examples: the bias is supplied (no 12 V warning) and the quoted 4.1, 7.6, 3.5 dB figures are unchanged', () => {
  for (const v of ['overloaded', 'filtered']) {
    const r = boosterOverloadReport(v).result;
    assert.ok(!r.warnings.some((w) => /bias|DC/i.test(w)), `${v}: ${r.warnings.join(' | ')}`);
  }
  const o = boosterOverloadReport('overloaded'), f = boosterOverloadReport('filtered'), p = boosterOverloadReport('plain');
  near(p.marginDb, 7.6, 0.05); near(o.marginDb, 4.1, 0.05); near(f.marginDb, 7.6, 0.05); near(o.compressionDb, 3.5, 0.05); assert.equal(f.compressionDb, 0);
  assert.equal(o.scene.links[0].rx.antennaBiasV, 12);
  assert.ok(o.result.warnings.every((w) => /compression|1 dB point/.test(w)), 'the only warning left is the point of the example');
});

test('body-worn twins: the polarisation warning is named in the notes as the assumed floor, not left as a contradiction', () => {
  for (const v of ['thin', 'short']) { const sc = bodyWornScene(v); assert.ok(solveLink(sc, sc.links[0]).warnings.some((w) => /Polarisation mismatch costs 15\.0 dB/.test(w)), v); }
  assert.match(note('body-worn-proven-twin'), /polarisation warning is that deliberately assumed floor/);
  assert.match(note('body-worn-thin-margin'), /why the model warns about polarisation/);
});

test('band walk note: the animated walk moves only the mic link, and the note says so (both packs move only when the person is moved)', () => {
  const ex = buildExample('band-four-piece-walk'), n = ex.note;
  assert.match(n, /animated walk moves only her mic pack/); assert.doesNotMatch(n, /walks from/);
  assert.deepEqual(ex.walk.to, bandWalkEndScene().links[0].tx.pos);
});

test('measurements-too-few-readings: three readings at nearly one distance; the fit is offered with the two cautions', () => {
  const sc = measurementsScene('too-few'), c = compareMeasurements(sc), g = suggestCalibration(sc);
  assert.equal(c.n, 3); near(c.meanDb, -7.0, 0.05); near(c.rmsDb, 7.0, 0.05);
  const l = sc.links[0], dists = c.points.map((p) => Math.hypot(p.x - l.tx.pos.x, p.y - l.tx.pos.y, p.z - l.tx.pos.z));
  near(Math.min(...dists), 29.0, 0.05); near(Math.max(...dists), 31.0, 0.05);
  assert.equal(g.best.id, 'body-loss'); near(g.best.fitted, 10.0, 0.05); near(g.best.afterRmsDb, 0.3, 0.05);
  assert.ok(g.cautions.some((x) => /Only 3 measurements/.test(x))); assert.ok(g.cautions.some((x) => /nearly the same distance/.test(x)));
  has('measurements-too-few-readings', '29 to 31 m', '7.0 dB', '10.0 dB', '0.3 dB rms');
});

test('tv-weak-6mhz-us-plan: 6 MHz width, channel 26, 5.38 MHz block: -85.0 -> -99.3 dBm in 200 kHz, floor rise and margin re-run', () => {
  const w = weakTvReport('on-channel', 6), sc = w.scene;
  assert.equal(sc.tvChannelWidthMHz, 6); assert.equal(w.channel, 26); assert.equal(tvChannelOf(sc.links[0].freqMHz, 6).n, 26); near(sc.links[0].freqMHz, 545.4, 1e-9);
  near(w.noise.sources[0].rawDbm, -85.0, 0.05);
  const hand = -85 - 10 * Math.log10((TV_OCCUPIED_MHZ[6] * 1000) / 200); // hand: 10 log10(5380 / 200) = 14.30 dB
  near(hand, -99.30, 0.01); near(w.noise.sources[0].averageDbm, hand, 0.05);
  const w8 = weakTvReport('on-channel'); near(w.noise.sources[0].averageDbm - w8.noise.sources[0].averageDbm, 10 * Math.log10(7600 / 5380), 0.05); // 1.50 dB
  assert.equal(w.result.warnings.length, 0);
  has('tv-weak-6mhz-us-plan', '-85.0 dBm', '14.3 dB', '-99.3 dBm', f1(w.riseDb), f1(w.marginDb), '1.5 dB', '5.38 MHz', 'channel 26', '542 to 548');
  assert.equal(weakTvScene('on-channel').tvChannelWidthMHz, undefined, 'the 8 MHz scene is unchanged');
});

test('noise-dect-intercom and noise-pyro-trigger-433: peak against average figures re-run', () => {
  for (const id of ['dect-intercom', 'pyro-trigger-433']) {
    const sc = noiseSourceScene(id), l = sc.links[0], r = solveLink(sc, l), n = r.noiseSources, s = n.sources[0];
    assert.equal(r.warnings.length, 0, id);
    near(s.peakDbm - s.averageDbm, -10 * Math.log10(s.duty), 0.01, 'peak minus average = -10 log10(duty)');
    if (id === 'dect-intercom') {
      near(s.duty, 0.417e-3 * 100, 1e-9); near(s.distanceM, 4.0, 0.05); near(s.rawDbm, -29.0, 0.05);
      has('noise-dect-intercom', '1893', f1(s.distanceM), f1(s.rawDbm), f1(s.peakDbm), f1(s.averageDbm), f1(n.riseDb), f1(r.marginDb), f1(r.inputPowerDbm - s.peakDbm), '4.2 percent');
    } else {
      near(s.duty, 0.001, 1e-12); assert.equal(s.inChannel, false); near(s.selectivityDb, 38.1, 0.05);
      has('noise-pyro-trigger-433', '433.9', '433.1', f1(s.distanceM), f1(s.peakDbm), f1(s.averageDbm), f1(n.peakRiseDb), f1(n.riseDb), f1(r.marginDb), f1(r.inputPowerDbm - s.peakDbm), '38.1 dB');
    }
  }
});

test('booster-padded-before-radio: the 10 dB pad cuts compression to 0.1 dB, keyed margin 7.5 dB, 10 dB lost with the radio off', () => {
  const pd = boosterOverloadReport('padded'), ov = boosterOverloadReport('overloaded');
  near(pd.boosterOutDbm, ov.boosterOutDbm - 10, 0.01); near(pd.boosterOutDbm, 3.9, 0.05); near(pd.compressionDb, 0.06, 0.01); near(pd.marginDb, 7.5, 0.05);
  const quiet = (v) => { const sc = boosterOverloadScene(v); sc.noiseSources = []; return solveLink(sc, sc.links[0]).marginDb; };
  near(quiet('overloaded') - quiet('padded'), 10, 0.05, 'the pad costs exactly its 10 dB'); near(quiet('padded'), 27.5, 0.05); near(quiet('overloaded'), 37.5, 0.05); near(quiet('filtered'), 36.0, 0.05);
  has('booster-padded-before-radio', '13.9 dBm', '3.9 dBm', '3.5 dB', '0.1 dB', '4.1 dB', '7.5 dB', '27.5 dB', '37.5 dB', '7.6 dB', '36.0 dB');
  assert.ok(confidenceSummary(pd.scene).length === 1);
});
