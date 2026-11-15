// Review-batch examples (EXAMPLES-REVIEW section 7): every figure quoted in a note is recomputed from the model.
// Tolerance: figures are compared as text rounded to the digits the note prints (0.1 dB, 0.05 dB where two decimals are printed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewScene, sosReport, EXAMPLES, buildExample } from '../js/examples.js';
import { solveLink, chainLossDb } from '../js/model/rf.js';
import { validateScene } from '../js/model/scene.js';
import { coverageGrid, zoneStats, zoneRequirement } from '../js/model/coverage.js';
import { resolveAudioBandwidthHz, monoBasebandSpectrum } from '../js/model/spectrum-views.js';
import { noiseFloor, imdSummary } from '../js/model/imd.js';
import { p2pScene } from '../js/examples.js';
import { GROUND_PLANE_GAIN_DBI } from '../js/model/library.js';

const f1 = (x) => x.toFixed(1);
const note = (id) => EXAMPLES.find((e) => e.id === id).note;
const has = (id, ...vals) => vals.forEach((v) => assert.ok(note(id).includes(v), `${id}: "${v}" not in note`));
const solve = (s) => solveLink(s, s.links[0]);
const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} got ${a}, expected ${b} +/- ${tol}`);
const IDS = ['splitter-two-way-receiver', 'coupler-monitor-tap', 'lna-no-filter', 'filter-before-booster', 'pad-on-iem-transmitter', 'bias-tee-booster-up-the-mast', 'bias-tee-into-dcblock', 'body-contact-sweaty-bodypack', 'tilted-whip-vs-vertical', 'circular-polarisation-wanted-mic', 'ground-plane-quarterwave', 'coverage-modes-compare', 'external-noise-urban-vs-quiet', 'audio-bandwidth-iem-vs-mic', 'imd-iem-8-with-fifth-order', 'p2p-ground-reflection'];

test('all review examples exist, validate, solve, and name their category with at most four sentences', () => {
  for (const id of IDS) {
    const ex = buildExample(id);
    assert.ok(ex, id);
    assert.deepEqual(validateScene(ex.scene), { ok: true, errors: [] }, id);
    assert.ok(Number.isFinite(solve(ex.scene).inputPowerDbm), id);
    assert.match(ex.note, /^(Best practice|Less ideal|Problem|Compare|Narrow-band mic|Understand)/, id);
    assert.ok(ex.note.split('. ').length <= 4, id);
  }
});

test('splitter: 3.5 dB split, noise figure and margin worse than none, active splitter between', () => {
  const p = solve(reviewScene('splitter-two-way-receiver')), n = solve(reviewScene('splitter-two-way-receiver', { part: 'none' })), a = solve(reviewScene('splitter-two-way-receiver', { part: 'active' }));
  near(chainLossDb(reviewScene('splitter-two-way-receiver').links[0].chain, 606.1) - chainLossDb(reviewScene('splitter-two-way-receiver', { part: 'none' }).links[0].chain, 606.1), 3.5, 0.02); // 3 dB split + 0.5 dB excess, preset
  near(n.marginDb - p.marginDb, 3.5, 0.02);
  has('splitter-two-way-receiver', '3.5 dB', f1(p.cascade.systemNfDb), f1(n.cascade.systemNfDb), f1(n.marginDb), f1(p.marginDb), f1(a.cascade.systemNfDb), f1(a.marginDb));
  assert.ok(a.marginDb > p.marginDb && a.marginDb < n.marginDb);
});

test('coupler: tap is power minus 20 dB, through loss 0.15 dB', () => {
  const s = reviewScene('coupler-monitor-tap'), n = reviewScene('coupler-monitor-tap', { part: 'none' });
  const tap = s.links[0].tx.powerDbm - 20;
  near(tap, -3, 1e-9);
  const through = chainLossDb(s.links[0].chain, 606.1) - chainLossDb(n.links[0].chain, 606.1);
  near(through, 0.1 + 10 * Math.log10(1 / (1 - 0.01)), 1e-6); // excess 0.1 dB + 0.0436 dB main-line loss of a 20 dB coupler
  has('coupler-monitor-tap', f1(tap), '0.15 dB', f1(solve(n).marginDb - solve(s).marginDb));
});

test('filter before booster: hot without it, ok with it, filter costs its passband loss', () => {
  const a = sosReport(reviewScene('lna-no-filter')).antennas[0], b = sosReport(reviewScene('filter-before-booster')).antennas[0];
  assert.equal(a.level, 'hot'); assert.equal(b.level, 'ok'); assert.equal(b.desenseDb, 0);
  near(a.atRxInputDbm - b.atRxInputDbm, 41.5, 0.05); // rejection 40 + loss 1.5
  near(a.wantedMarginDb - b.wantedMarginDb, 1.5, 0.05);
  has('lna-no-filter', f1(a.distanceM), f1(a.atAntennaDbm), f1(a.atRxInputDbm), f1(a.headroomDb), f1(a.desenseDb), f1(a.wantedMarginDb));
  has('filter-before-booster', f1(b.atRxInputDbm), f1(b.headroomDb), f1(b.wantedMarginDb), f1(a.wantedMarginDb));
});

test('pad on the IEM transmitter: 1.6:1 at the PA, 6 dB of margin, margin leaves room for a 20 dB test (lesson 39)', () => {
  const s = reviewScene('pad-on-iem-transmitter'), r = solve(s);
  const bare = reviewScene('pad-on-iem-transmitter'); bare.links[0].chain = bare.links[0].chain.filter((c) => c.kind !== 'attenuator');
  const rb = solve(bare);
  near(rb.marginDb - r.marginDb, 6, 1e-9);
  assert.ok(r.marginDb > 30);
  has('pad-on-iem-transmitter', f1(r.antennaMismatch.tx.vswr), f1(rb.antennaMismatch.tx.reflectedAtPaDbm), f1(r.antennaMismatch.tx.reflectedAtPaDbm), f1(r.antennaMismatch.tx.vswrAtPa), f1(r.marginDb), f1(rb.marginDb));
});

test('bias tee: no DC warning, and a DC block ahead of it leaves the booster unpowered with a warning', () => {
  const ok = solve(reviewScene('bias-tee-booster-up-the-mast')), bl = solve(reviewScene('bias-tee-booster-up-the-mast', { block: true }));
  assert.equal(ok.warnings.filter((w) => /bias/i.test(w)).length, 0);
  assert.equal(bl.warnings.filter((w) => /needs 12 V bias/.test(w)).length, 1);
  has('bias-tee-booster-up-the-mast', f1(ok.cascade.systemNfDb), '45 m', '12 dB');
  const bare = solve(reviewScene('splitter-two-way-receiver', { part: 'none' }));
  has('bias-tee-booster-up-the-mast', f1(bare.cascade.systemNfDb));
  has('bias-tee-into-dcblock', f1(bl.marginDb), f1(ok.marginDb));
  near(-(chainLossDb(reviewScene('bias-tee-booster-up-the-mast').links[0].chain, 606.1)), 6.5, 0.05); // net gain printed as 6.5 dB
});

test('sweaty bodypack: skin 6 dB + wet 3 dB = 9 dB, replaces the scene body loss', () => {
  const w = solve(reviewScene('body-contact-sweaty-bodypack')), d = solve(reviewScene('body-contact-sweaty-bodypack', { contact: 'free', dampness: 'dry' }));
  near(d.marginDb - w.marginDb, 9, 1e-9);
  const sd = solve(reviewScene('body-contact-sweaty-bodypack', { contact: 'skin', dampness: 'dry' }));
  near(d.marginDb - sd.marginDb, 6, 1e-9);
  has('body-contact-sweaty-bodypack', '9.0 dB', f1(w.marginDb), f1(d.marginDb), '2.5 dB');
});

test('tilt: polarisation loss follows -20 log cos(tilt) with the 15 dB floor', () => {
  const loss = (t) => solve(reviewScene('tilted-whip-vs-vertical', { tiltDeg: t })).polarisation?.lossDb ?? 0;
  near(loss(0), 0, 1e-9);
  // PLF = cos^2(t) (1 - X) + X with X = 10^-1.5 (the model's cross-polar floor): hand check at 45 degrees = 0.5158 -> 2.875 dB (tests/antenna-orientation)
  near(loss(45), -10 * Math.log10(0.5 * (1 - 10 ** -1.5) + 10 ** -1.5), 0.01);
  near(loss(90), 15, 1e-6);
  has('tilted-whip-vs-vertical', f1(loss(60)), f1(loss(45)), f1(loss(85)), f1(loss(90)), f1(solve(reviewScene('tilted-whip-vs-vertical', { tiltDeg: 0 })).marginDb), f1(solve(reviewScene('tilted-whip-vs-vertical')).marginDb));
});

test('circular wanted mic: 3.01 dB constant against 15 dB for a linear receive antenna', () => {
  const c = solve(reviewScene('circular-polarisation-wanted-mic')), v = solve(reviewScene('circular-polarisation-wanted-mic', { rx: 'vertical' }));
  near(c.polarisation.lossDb, 10 * Math.log10(2), 0.01); near(v.polarisation.lossDb, 15, 1e-6);
  has('circular-polarisation-wanted-mic', f1(v.polarisation.lossDb), c.polarisation.lossDb.toFixed(2));
});

test('ground plane: -1 dBi free cable, +3 dBi rack panel (4 dB), warning only without a plane', () => {
  const g = (gp) => solve(reviewScene('ground-plane-quarterwave', gp ? { groundPlane: gp } : {}));
  near(g('rack').marginDb - g().marginDb, GROUND_PLANE_GAIN_DBI.rack - GROUND_PLANE_GAIN_DBI.none, 1e-9);
  assert.equal(g().warnings.filter((w) => /no ground plane/.test(w)).length, 1);
  assert.equal(g('rack').warnings.filter((w) => /no ground plane/.test(w)).length, 0);
  has('ground-plane-quarterwave', '-1 dBi', '+3 dBi', '4.0 dB', f1(g('rack').marginDb), f1(g().marginDb));
});

test('coverage modes: coherent has deep nulls, power and best do not', () => {
  const st = (mode) => { const s = reviewScene('coverage-modes-compare', { mode }); const g = coverageGrid(s, s.links[0].id, { mode, cellM: 0.25 }); const z = s.zones[0]; const rq = zoneRequirement(s, s.links[0], z); return zoneStats(g, z, rq.squelchThresholdDbm, rq.appliedMarginDb); };
  const c = st('coherent'), p = st('power'), b = st('best');
  assert.ok(c.minDbm < p.minDbm - 25 && p.passFraction === 1);
  has('coverage-modes-compare', f1(c.minDbm), f1(p.minDbm), f1(b.minDbm), '1.5 m');
});

test('external noise: urban costs margin only when the receiver is quiet', () => {
  const m = (noise, lna = true) => { const s = reviewScene('external-noise-urban-vs-quiet', { noise }); if (!lna) s.links[0].chain = s.links[0].chain.filter((c) => c.kind !== 'booster'); return solve(s); };
  const u = m('urban'), n0 = m(0), bare = m('urban', false), bare0 = m(0, false);
  has('external-noise-urban-vs-quiet', f1(u.cascade.noiseFloorDbm), f1(n0.cascade.noiseFloorDbm), f1(n0.marginDb - u.marginDb), f1(u.marginDb), f1(n0.marginDb), f1(bare.cascade.systemNfDb), f1(bare0.marginDb - bare.marginDb), f1(u.cascade.systemNfDb));
  assert.ok(n0.marginDb - u.marginDb > 10 * (bare0.marginDb - bare.marginDb));
});

test('audio bandwidth: ceiling and the gap to the control tone', () => {
  const ceil = (o) => { const s = reviewScene('audio-bandwidth-iem-vs-mic', o); const a = resolveAudioBandwidthHz({ link: s.links[0], kind: 'mic' }); return { a, sp: monoBasebandSpectrum({ kind: 'mic', audioBandwidthHz: a.hz }) }; };
  const n = ceil({}), d = ceil({ audioBandwidthHz: null });
  assert.equal(n.a.source, 'link'); assert.equal(d.a.source, 'assumed-mono');
  const gap = (x) => x.sp.bands.gap[1] - x.sp.bands.gap[0];
  has('audio-bandwidth-iem-vs-mic', f1(n.a.hz / 1000), f1(gap(n)), f1(d.a.hz / 1000 === 18 ? gap(d) : NaN), f1(n.sp.bands.gap[1]), '15 kHz', '19 kHz');
  assert.equal(resolveAudioBandwidthHz({ link: { kind: 'iem', mpx: { enabled: true }, tx: {} }, kind: 'iem' }).hz, 15000);
});

test('fifth order: hit count grows with channels, the level stays far below thermal and the rise is transmitter noise', () => {
  const sc5 = reviewScene('imd-iem-8-with-fifth-order'), sc8 = reviewScene('imd-iem-8-with-fifth-order', { channels: 8 });
  const m5 = imdSummary(sc5), m8 = imdSummary(sc8), n5 = noiseFloor(sc5, sc5.imd.rxAntennaPos);
  assert.equal(m5.inChannelThirdOrderCount, 0); assert.equal(m8.inChannelThirdOrderCount, 0);
  assert.equal(m8.inChannelByOrder['5'], 158);
  assert.ok(n5.imSumDbm < n5.thermalDbm - 100);
  assert.ok(n5.txNoiseSkirtDbm > n5.imSumDbm + 100);
  has('imd-iem-8-with-fifth-order', String(m5.inChannelCount), '158', f1(n5.imSumDbm), f1(n5.thermalDbm), f1(n5.riseDb), f1(n5.txNoiseSkirtDbm));
});

test('p2p ground reflection: ripple against the direct ray over 20 to 80 m', () => {
  const at = (d, gr) => { const s = reviewScene('p2p-ground-reflection', { groundReflection: gr, distanceM: d }); return solve(s).rxPowerDbm; };
  let mn = Infinity, mx = -Infinity, dmn = 0, dmx = 0;
  for (let d = 20; d <= 80.0001; d += 0.05) { const x = at(d, true) - at(d, false); if (x < mn) { mn = x; dmn = d; } if (x > mx) { mx = x; dmx = d; } }
  const x40 = at(40, true) - at(40, false);
  has('p2p-ground-reflection', f1(-x40), f1(-mn), f1(dmn), f1(mx), f1(dmx), f1(at(150, true) - at(150, false)));
  assert.ok(mn < -10 && mx > 5);
  // vertical polarisation: the dip over 20 to 80 m is only about 1.9 dB
  const atV = (d, gr) => { const s = reviewScene('p2p-ground-reflection', { groundReflection: gr, distanceM: d }); s.links[0].tx.antenna.polarisation = 'vertical'; s.links[0].rx.antenna.polarisation = 'vertical'; return solve(s).rxPowerDbm; };
  let mv = Infinity; for (let d = 20; d <= 80.0001; d += 0.05) mv = Math.min(mv, atV(d, true) - atV(d, false));
  has('p2p-ground-reflection', f1(-mv));
  // the p2p-delay-speaker note now says what the reflection does at 150 m
  const d150 = p2pScene('delay'); d150.links[0].p2p.groundReflection = true; d150.environment.model = 'two-ray';
  const noRefl = solve(p2pScene('delay')).rxPowerDbm;
  has('p2p-delay-speaker', f1(solve(d150).rxPowerDbm - noRefl));
});
