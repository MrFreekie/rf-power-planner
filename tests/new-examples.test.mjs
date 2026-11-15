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
