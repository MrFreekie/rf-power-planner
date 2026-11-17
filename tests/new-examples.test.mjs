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
  near(mb['Anna mic'] - ma['Anna mic'], -6.1, 0.05); near(mb['Anna IEM'] - ma['Anna IEM'], 7.9, 0.05);
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

// ---- pass 4 review: thirteen more examples (every quoted figure is re-run from the model; tolerances stated per assertion) ----
import { twoWallsScene, tvLevelsScene, TV_LEVELS_DBM, squelchPilotReport, bandSwapScene, sr2050Scene, SR2050_LEGACY_MHZ, compareChangeScene, exampleKeywords } from '../js/examples.js';
import { tvBlockLevelsOf, tvBlockLevelDbm, tvNoiseRiseDb, tvBlockLevelIsAssumed } from '../js/model/spectrum-map.js';
import { diffScenes, headline } from '../js/model/scene-diff.js';
import { FM_PRESETS } from '../js/model/fm-presets.js';
import { createStore } from '../js/store.js';
import { assignMic } from '../js/actions.js';
import { squelchState } from '../js/model/squelch.js';
import { broadbandFieldDbuvm, NOISE_CATALOGUE } from '../js/model/noise-sources.js';

const P4 = {
  'measurements-two-walls-per-material': 'Problem', 'measurements-calibrated': 'Best practice', 'measurements-wall-explains-offset': 'Problem', 'tv-per-channel-levels': 'Best practice',
  'noise-keyed-vs-continuous-spectrum': 'Compare', 'squelch-pilot-vs-flash': 'Best practice', 'band-four-piece-swap-person': 'Best practice', 'iem-sr2050-legacy-range': 'Less ideal',
  'noise-flash-trigger-24': 'Problem', 'noise-motor-hoist-vs-led-wall-light': 'Compare', 'compare-single-change': 'Compare', 'generator-inverter-van': 'Problem', 'booster-higher-p1db': 'Less ideal',
};
const alone = (sc, i) => { const s = structuredClone(sc); s.noiseSources = [sc.noiseSources[i]]; const r = solveLink(s, s.links[0]); return { r, n: r.noiseSources, s0: r.noiseSources.sources[0] }; };
const quietMargin = (sc) => { const s = structuredClone(sc); s.noiseSources = []; return solveLink(s, s.links[0]).marginDb; };

test('pass-4 examples: thirteen exist, validate, solve, lead with their category word, at most five sentences, and carry no warning except the compression one', () => {
  assert.equal(Object.keys(P4).length, 13);
  for (const [id, cat] of Object.entries(P4)) {
    const ex = buildExample(id); assert.ok(ex, id); ok(ex.scene);
    for (const l of ex.scene.links) { const r = solveLink(ex.scene, l); assert.ok(Number.isFinite(r.marginDb), id); if (id !== 'booster-higher-p1db') assert.equal(r.warnings.length, 0, `${id}: ${r.warnings.join(' | ')}`); }
    assert.ok(ex.note.startsWith(cat + ': '), id); assert.ok(ex.note.split('. ').length <= 5, id);
    assert.equal(new Set(EXAMPLES.map((e) => e.id)).size, EXAMPLES.length, 'ids are unique');
  }
});

test('measurements-two-walls-per-material: the fit is per material, with confidence, and beats one figure and body loss', () => {
  const sc = twoWallsScene('uncalibrated'), c = compareMeasurements(sc), g = suggestCalibration(sc), cand = (id) => g.candidates.find((x) => x.id === id);
  assert.equal(c.n, 14); near(c.meanDb, -7.7, 0.05); near(c.rmsDb, 8.8, 0.05);
  const pm = cand('wall-loss-by-material');
  assert.ok(pm.applicable, pm.reason); assert.equal(g.best.id, 'wall-loss-by-material'); assert.equal(pm.confidence, 'ok');
  near(pm.fitted.brick, 8, 0.3, 'brick: the truth is +8 dB'); near(pm.fitted.drywall, 3, 0.3, 'plasterboard: the truth is +3 dB'); // the 0.4 dB reading scatter bounds the error
  near(pm.afterRmsDb, 0.2, 0.05); near(cand('wall-loss').afterRmsDb, 1.3, 0.05); near(cand('body-loss').afterRmsDb, 4.2, 0.05);
  assert.deepEqual(pm.readingsPerMaterial, { brick: 11, drywall: 7 }); // hand: 4 readings behind the brick only, 7 behind both, 3 in the clear
  assert.ok(c.points.slice(0, 3).every((p) => Math.abs(p.deltaDb) <= 0.4), 'the clear-path readings match');
  assert.ok(g.notes.some((n) => /body loss/.test(n)), 'the caveat about absorbed body loss is shown');
  assert.equal(sc.reflectors.length, 2); assert.deepEqual(sc.reflectors.map((w) => w.material), ['brick', 'drywall']);
  has('measurements-two-walls-per-material', f1(-c.meanDb), f1(c.rmsDb), f1(pm.fitted.brick), f1(pm.fitted.drywall), f1(pm.afterRmsDb), f1(cand('wall-loss').afterRmsDb), f1(cand('body-loss').afterRmsDb), 'eleven readings cross the brick and seven the plasterboard', 'fourteen', '63 m', '15 m', '30 m', '0.4 dB');
});

test('measurements-calibrated: the fit is stored in the scene, the residual is under 0.5 dB and a new fit suggests nothing; the margin behind both walls falls', () => {
  const sc = twoWallsScene('calibrated'), un = twoWallsScene('uncalibrated'), c = compareMeasurements(sc), cu = compareMeasurements(un), by = sc.environment.wallLossAdjustByMaterialDb;
  near(by.brick, 8, 0.3); near(by.drywall, 3, 0.3); assert.equal(un.environment.wallLossAdjustByMaterialDb, undefined);
  assert.ok(c.rmsDb < 0.5, `rms ${c.rmsDb}`); near(c.rmsDb, 0.2, 0.05); near(cu.rmsDb, 8.8, 0.05); near(Math.abs(c.worst.deltaDb), 0.4, 0.05);
  const g = suggestCalibration(sc); assert.equal(g.best, null); assert.equal(g.needed, false); assert.equal(g.matches, true);
  const m0 = solveLink(un, un.links[0]).marginDb, m1 = solveLink(sc, sc.links[0]).marginDb;
  near(m0, 27.1, 0.05); near(m1, 16.2, 0.05); near(m0 - m1, by.brick + by.drywall, 0.01, 'the receiver at 40 m is behind both walls, so the margin drops by exactly the two adjustments');
  has('measurements-calibrated', f1(by.brick), f1(by.drywall), f1(c.rmsDb), f1(cu.rmsDb), f1(Math.abs(c.worst.deltaDb)), f1(m0), f1(m1));
});

test('measurements-wall-explains-offset: readings step at the wall; the single wall figure is the best fit and body loss is not', () => {
  const sc = twoWallsScene('one-wall'), c = compareMeasurements(sc), g = suggestCalibration(sc), cand = (id) => g.candidates.find((x) => x.id === id);
  assert.equal(c.n, 13); near(c.meanDb, -4.8, 0.05); near(c.rmsDb, 6.6, 0.05); assert.equal(sc.reflectors.length, 1);
  assert.ok(c.points.slice(0, 6).every((p) => Math.abs(p.deltaDb) <= 0.4), 'six readings before the wall match');
  assert.ok(c.points.slice(6).every((p) => p.deltaDb < -8.5 && p.deltaDb > -9.5), 'seven behind it are about 9 dB low');
  assert.equal(g.best.id, 'wall-loss'); near(g.best.fitted, 9, 0.3, 'the truth is +9 dB'); near(g.best.afterRmsDb, 0.2, 0.05); near(cand('body-loss').afterRmsDb, 4.5, 0.05);
  assert.equal(cand('wall-loss-by-material').applicable, false);
  has('measurements-wall-explains-offset', f1(-c.meanDb), f1(c.rmsDb), f1(g.best.fitted), f1(g.best.afterRmsDb), f1(cand('body-loss').afterRmsDb), 'thirteen', '30 m');
});

test('tv-per-channel-levels: scene.tvBlockLevelsDbm is set on three channels, validates, and changes the strip rise but not the link budget', () => {
  const sc = tvLevelsScene(true), plain = tvLevelsScene(false);
  assert.deepEqual(sc.tvBlockLevelsDbm, { 30: -108, 33: -85, 34: -52 }); assert.deepEqual(tvBlockLevelsOf(sc), { 30: -108, 33: -85, 34: -52 }); assert.deepEqual(TV_LEVELS_DBM, sc.tvBlockLevelsDbm);
  assert.equal(plain.tvBlockLevelsDbm, undefined);
  assert.equal(tvChannelOf(sc.links[0].freqMHz).n, 33); assert.equal(tvChannelOf(sc.links[1].freqMHz).n, 30); assert.equal(sc.links.length, 2);
  const r1 = solveLink(sc, sc.links[0]), r2 = solveLink(sc, sc.links[1]), p1 = solveLink(plain, plain.links[0]);
  near(r1.marginDb, p1.marginDb, 1e-9, 'the levels never reach the link budget'); const fl = r1.cascade.noiseFloorDbm; near(fl, -112.0, 0.05);
  const lv = tvBlockLevelsOf(sc), rise = (n, o) => tvNoiseRiseDb(fl, tvBlockLevelDbm(n, o), 8);
  near(rise(30, lv), 0.3, 0.05); near(rise(33, lv), 11.5, 0.05); near(rise(34, lv), 44.2, 0.05); // hand: ch33 -85 - 15.8 = -100.8 dBm, 10 log10(10^-10.08 + 10^-11.2) + 112 = 11.5
  for (const n of [30, 33, 34]) { assert.equal(tvBlockLevelIsAssumed(n, lv), false); assert.equal(tvBlockLevelIsAssumed(n, undefined), true); assert.ok(rise(n, undefined) > 20.5 && rise(n, undefined) < 22.0, `assumed rise ${rise(n, undefined)}`); }
  has('tv-per-channel-levels', '-108 dBm', '-85 dBm', '-52 dBm', '-112.0 dBm', '0.3, 11.5 and 44.2 dB', f1(r1.marginDb), f1(r2.marginDb), 'about 21 dB', 'TV level controls', 'does not pulse');
});

test('noise-keyed-vs-continuous-spectrum: a keyed radio and a steady light with the same average; the radio pulses, the light does not', () => {
  const sc = noiseSourceScene('keyed-vs-continuous'), a = alone(sc, 0), b = alone(sc, 1), all = solveLink(sc, sc.links[0]);
  assert.equal(a.s0.kind, 'ptt-business-uhf'); assert.equal(b.s0.kind, 'led-camera-light'); near(a.s0.duty, 0.3, 1e-12); assert.equal(b.s0.duty, 1);
  near(a.s0.averageDbm, b.s0.averageDbm, 0.3, 'about the same average'); near(a.s0.peakDbm - a.s0.averageDbm, -10 * Math.log10(0.3), 0.01); assert.equal(b.s0.peakDbm, b.s0.averageDbm);
  near(a.n.riseDb, b.n.riseDb, 0.3); assert.ok(all.noiseSources.riseDb > Math.max(a.n.riseDb, b.n.riseDb));
  assert.ok(sc.noiseSources.some((s) => NOISE_CATALOGUE[s.kind].behaviour === 'intermittent') && sc.noiseSources.some((s) => NOISE_CATALOGUE[s.kind].behaviour === 'continuous'));
  has('noise-keyed-vs-continuous-spectrum', f1(a.s0.distanceM), f1(b.s0.distanceM), f1(a.n.riseDb), f1(b.n.riseDb), f1(a.s0.averageDbm), f1(b.s0.averageDbm), f1(all.noiseSources.riseDb), f1(all.marginDb), f1(a.s0.peakDbm), f1(a.s0.peakDbm - a.s0.averageDbm), '30 percent');
});

test('noise-motor-hoist-vs-led-wall-light: same average, the hoist peaks over the squelch and the light never does', () => {
  const sc = noiseSourceScene('hoist-vs-led'), h = alone(sc, 0), l = alone(sc, 1), q = sc.links[0].rx.squelch, floor = h.n.floorBeforeDbm;
  const sum = (x, y) => 10 * Math.log10(10 ** (x / 10) + 10 ** (y / 10));
  assert.equal(sc.links[0].tx.powerDbm, -60); assert.equal(h.s0.kind, 'motor-hoist'); assert.equal(l.s0.kind, 'led-light-pwm');
  near(h.s0.averageDbm, l.s0.averageDbm, 0.2); near(h.s0.duty, 0.05, 1e-12); near(h.s0.peakDbm - h.s0.averageDbm, 13.01, 0.01); // hand: duty 0.05 ms x 1000 Hz = 0.05, -10 log10(0.05) = 13.01 dB
  assert.equal(squelchState(false, sum(floor, h.s0.peakDbm), q).open, true); assert.equal(squelchState(false, sum(floor, h.s0.averageDbm), q).open, false);
  assert.equal(squelchState(false, sum(floor, l.s0.peakDbm), q).open, false); assert.equal(l.s0.peakDbm, l.s0.averageDbm);
  has('noise-motor-hoist-vs-led-wall-light', f1(h.s0.distanceM), f1(l.s0.distanceM), f1(h.s0.averageDbm), f1(l.s0.averageDbm), f1(h.n.riseDb), f1(l.n.riseDb), f1(h.s0.peakDbm), f1(h.s0.peakDbm - q.thresholdDbm), f1(sum(floor, l.s0.averageDbm)), f1(q.thresholdDbm - sum(floor, l.s0.averageDbm)), '1000 clicks', '-90 dBm');
});

test('noise-flash-trigger-24: a 2.4 GHz trigger in the mic channel; each packet is stronger than the mic and the margin is nearly gone', () => {
  const sc = noiseSourceScene('flash-trigger-24'), a = alone(sc, 0), r = a.r;
  assert.equal(sc.links[0].freqMHz, 2440); assert.equal(a.s0.kind, 'flash-trigger-radio'); assert.equal(a.s0.inChannel, true); near(a.s0.duty, 0.02, 1e-12);
  near(a.s0.peakDbm - a.s0.averageDbm, -10 * Math.log10(0.02), 0.01); near(a.s0.distanceM, 7.2, 0.05);
  assert.ok(a.s0.peakDbm > r.inputPowerDbm, 'the packet is stronger than the wanted signal'); assert.ok(r.marginDb < 1 && r.marginDb > 0);
  has('noise-flash-trigger-24', f1(a.s0.distanceM), f1(a.s0.peakDbm), f1(a.s0.peakDbm - r.inputPowerDbm), f1(r.inputPowerDbm), f1(a.s0.averageDbm), f1(a.n.riseDb), f1(r.marginDb), '2440.0', '2 percent', 'wifi-busy-2g4');
});

test('generator-inverter-van: continuous broadband source, the 606 MHz field and the margin before and after re-run', () => {
  const sc = noiseSourceScene('generator-van'), a = alone(sc, 0), e = broadbandFieldDbuvm(NOISE_CATALOGUE['generator-inverter'].params, 606.1);
  near(e, 45 - 30 * Math.log10(606.1 / 600) - 40 * Math.log10(606.1 / 500), 1e-9); near(e, 41.5, 0.05); // hand: 44.87 - 3.34 = 41.53
  assert.equal(a.s0.duty, 1); assert.equal(a.s0.peakDbm, a.s0.averageDbm); near(a.s0.distanceM, 8.0, 0.05);
  has('generator-inverter-van', f1(e), f1(a.s0.distanceM), f1(a.s0.averageDbm), f1(a.n.riseDb), f1(quietMargin(sc)), f1(a.r.marginDb), '500 MHz', 'does not pulse');
});

test('squelch-pilot-vs-flash: the carrier squelch opens at the flash peak, the pilot squelch stays shut because a flash has no pilot', () => {
  const r = squelchPilotReport(), b = squelchBurstReport(10);
  assert.equal(r.scene.links[0].mpx.pilotSquelch, true); assert.equal(r.scene.links[0].kind, 'iem');
  assert.equal(r.carrierOnly.open, true); assert.equal(r.pilotLocked, false); assert.equal(r.withPilot.open, false); assert.equal(r.withPilot.carrierOpen, true); assert.equal(r.withPilot.reason, 'pilot');
  assert.equal(squelchState(false, r.burstLevelDbm, { ...r.scene.links[0].rx.squelch }).open, true);
  assert.equal(squelchState(false, r.idleLevelDbm, r.scene.links[0].rx.squelch).open, false, 'the average alone never opens it');
  near(r.peakDbm, b.peakDbm, 0.05, 'same flash, same geometry as squelch-noise-burst'); assert.equal(r.events, 30);
  has('squelch-pilot-vs-flash', '-90 dBm', f1(r.peakDbm), f1(r.carrierOnly.headroomDb), '21.9 m', '30 times in 10 s', '19 kHz pilot');
  near(r.carrierOnly.headroomDb, r.burstLevelDbm - r.thresholdDbm, 1e-9);
});

test('band-four-piece-swap-person: the spare pack jumps to the person when assigned (the real assignMic and the scene twin agree)', () => {
  const a = bandSwapScene(false), b = bandSwapScene(true), dev = a.people.find((p) => p.name === 'Dev'), spare = a.links.find((l) => l.name === 'Spare bodypack');
  assert.equal(dev.micLinkId, undefined); assert.equal(a.links.length, 8); near(spare.freqMHz, 608.9, 1e-9);
  near(Math.hypot(spare.tx.pos.x - dev.pos.x, spare.tx.pos.y - dev.pos.y), 8.5, 0.05);
  const st = createStore(structuredClone(a)); assert.equal(assignMic(st, dev.id, spare.id), true);
  const real = st.getScene().links.find((l) => l.id === spare.id), twin = b.links.find((l) => l.name === 'Dev mic');
  assert.equal(real.name, 'Dev mic'); near(real.tx.pos.x, twin.tx.pos.x, 1e-9); near(real.tx.pos.y, twin.tx.pos.y, 1e-9); near(real.tx.pos.z, 1.0, 1e-9);
  near(twin.tx.pos.x - dev.pos.x, 0.15, 1e-9); near(twin.tx.pos.y - dev.pos.y, -0.05, 1e-9);
  const ma = linkMargins(a), mb = linkMargins(b); assert.deepEqual(Object.keys(mb).filter((k) => Math.abs((mb[k] ?? 0) - (ma[k] ?? 0)) > 1e-9 || !(k in ma)).sort(), ['Dev mic']);
  const sa = solveLink(a, a.links.find((l) => l.name === 'Spare bodypack')), sb = solveLink(b, b.links.find((l) => l.name === 'Dev mic'));
  near(sa.distanceM, 10.2, 0.05); near(sb.distanceM, 2.4, 0.05);
  has('band-four-piece-swap-person', f1(sa.marginDb), f1(sb.marginDb), '8.5 m', f1(sa.distanceM), f1(sb.distanceM), '608.9', '0.15 m', '0.05 m', 'seven links');
});

test('iem-sr2050-legacy-range: the frequency is inside the legacy Dw window of the preset and the 30 and 50 mW options differ by 10 log10(50/30)', () => {
  const sc = sr2050Scene('std-30mw'), hi = sr2050Scene('high-50mw'), l = sc.links[0], p = FM_PRESETS['sennheiser-sr2050iem'], win = p.params.tuningWindows.find((w) => w.id === 'Dw');
  assert.equal(l.tx.fmPreset, 'sennheiser-sr2050iem'); assert.equal(l.rx.rxPreset, 'sennheiser-ek2000iem'); assert.equal(l.freqMHz, SR2050_LEGACY_MHZ);
  assert.ok(win && /legacy/.test(win.label) && win.fromMHz <= l.freqMHz && l.freqMHz <= win.toMHz); assert.deepEqual(p.params.tuningWindows.filter((w) => /legacy/.test(w.label)).map((w) => w.id), ['Aw', 'Cw', 'Dw']);
  near(l.tx.powerDbm, 10 * Math.log10(30), 0.01); near(hi.links[0].tx.powerDbm, 10 * Math.log10(50), 0.01); // hand: 14.77 dBm and 16.99 dBm
  const m30 = solveLink(sc, l), m50 = solveLink(hi, hi.links[0]); near(m50.marginDb - m30.marginDb, 10 * Math.log10(50 / 30), 0.01); near(m30.distanceM, 25.0, 0.05);
  has('iem-sr2050-legacy-range', '826.0', f1(l.tx.powerDbm), f1(m30.marginDb), f1(m50.marginDb), f1(m50.marginDb - m30.marginDb), '25.0 m', '790 to 865', '2019', '10/2023');
});

test('compare-single-change: only the cable differs, Compare credits it, and the figures re-run', () => {
  const a = compareChangeScene(false), b = compareChangeScene(true);
  b.links[0].id = a.links[0].id; b.links[0].tx.id = a.links[0].tx.id; b.links[0].rx.id = a.links[0].rx.id; b.links[0].chain[0].id = a.links[0].chain[0].id; // what the app keeps when you edit after a snapshot
  const d = diffScenes(a, b), h = headline(d).join(' '), ra = solveLink(a, a.links[0]), rb = solveLink(b, b.links[0]);
  assert.equal(d.summary.changeCount, 1, JSON.stringify(d.summary)); assert.ok(/cable/i.test(h) && /lmr-400/i.test(h), h);
  near(rb.marginDb - ra.marginDb, 23.2, 0.05); assert.ok(h.includes('23.2 dB'), h);
  has('compare-single-change', f1(ra.marginDb), f1(rb.marginDb), f1(rb.marginDb - ra.marginDb), f1(ra.cascade.noiseFloorDbm), f1(rb.cascade.noiseFloorDbm), '60 m of RG58', 'LMR-400');
});

test('booster-higher-p1db: the output 1 dB point is 20 dBm, compression 0.1 dB, keyed margin 7.6 dB, and the only warning is the near-compression one', () => {
  const h = boosterOverloadReport('high-p1db'), ov = boosterOverloadReport('overloaded'), q = (() => { const s = boosterOverloadScene('high-p1db'); s.noiseSources = []; return solveLink(s, s.links[0]).marginDb; })();
  near(h.op1dBDbm, 20, 1e-9); near(h.boosterOutDbm, ov.boosterOutDbm, 1e-9); near(h.boosterOutDbm, 13.9, 0.05); near(h.compressionDb, 0.08, 0.02); near(h.marginDb, 7.6, 0.05); near(q, 37.5, 0.05);
  assert.ok(h.compressionDb < ov.compressionDb / 10); assert.ok(h.result.warnings.length === 1 && /1 dB point/.test(h.result.warnings[0]), h.result.warnings.join(' | '));
  has('booster-higher-p1db', '20.0 dBm', '10.4 dBm', '13.9 dBm', f1(h.compressionDb), f1(h.marginDb), f1(ov.marginDb), f1(q), 'booster-filtered-before-radio');
});

test('palette keywords find the new examples by their natural words', () => {
  const kw = (id) => exampleKeywords({ id });
  for (const [id, words] of Object.entries({
    'measurements-two-walls-per-material': ['wall material fit', 'calibrate'], 'measurements-calibrated': ['calibration'], 'measurements-wall-explains-offset': ['readings'], 'tv-per-channel-levels': ['per channel', 'tv level'],
    'noise-keyed-vs-continuous-spectrum': ['pulse', 'flicker', 'noise'], 'squelch-pilot-vs-flash': ['pilot', 'flash', 'pulse'], 'band-four-piece-swap-person': ['person', 'assign'], 'iem-sr2050-legacy-range': ['sr 2050', 'legacy'],
    'noise-flash-trigger-24': ['noise', 'source'], 'noise-motor-hoist-vs-led-wall-light': ['flicker'], 'compare-single-change': ['snapshot', 'diff'], 'generator-inverter-van': ['generator', 'noise'], 'booster-higher-p1db': ['p1db', 'compression'],
  })) for (const w of words) assert.ok(kw(id).includes(w), `${id}: "${w}" not in "${kw(id)}"`);
  for (const id of Object.keys(P4)) assert.equal(EXAMPLES.find((e) => e.id === id).keywords, kw(id));
});
