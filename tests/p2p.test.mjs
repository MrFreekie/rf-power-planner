// Group (h): point-to-point link kind. Hand values at 600 MHz (lambda = 299792458 / 600e6 = 0.49965 m).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as rf from '../js/model/rf.js';
import { earthBulgeM, fresnelRadiusM, radioHorizonM, knifeEdgeLossDb, knifeEdgeV, suggestedFadeMarginDb, requiredAntennaHeightM, p2pGeometry } from '../js/model/p2p.js';
import { createDefaultLink, createDefaultScene, validateScene } from '../js/model/scene.js';
import { ANTENNAS } from '../js/model/library.js';
import { p2pScene, EXAMPLES } from '../js/examples.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);
const f1 = (x) => x.toFixed(1);

test('earth bulge: 10 km path midpoint, K = 4/3: 5000*5000 / (2 * 4/3 * 6371000) = 1.4717 m (tol 1e-3)', () => {
  near(earthBulgeM(5000, 10000), 25e6 / (2 * (4 / 3) * 6371000), 1e-9);
  near(earthBulgeM(5000, 10000), 1.4717, 1e-3);
  near(earthBulgeM(0, 10000), 0, 0);
});

test('first Fresnel radius: 600 MHz, 10 km midpoint sqrt(0.49965 * 5000 * 5000 / 10000) = 35.34 m (tol 0.01)', () => {
  near(fresnelRadiusM(5000, 10000, 600), 35.34, 0.01);
  near(fresnelRadiusM(0, 10000, 600), 0, 1e-9);
});

test('radio horizon: sqrt(2KRh) for 10 m and 2 m antennas = 13.03 km + 5.83 km = 18.86 km (tol 0.05 km)', () => {
  near(radioHorizonM(10, 2) / 1000, Math.sqrt(2 * (4 / 3) * 6371000 * 10) / 1000 + Math.sqrt(2 * (4 / 3) * 6371000 * 2) / 1000, 1e-9);
  near(radioHorizonM(10, 2) / 1000, 18.86, 0.05);
});

test('knife edge anchors: v = 0 gives 6.9 dB, v = 1 about 14.2 dB, v = -0.78 and below give 0, v = -0.85 gives 0 (60 percent clearance is v = -0.85)', () => {
  near(knifeEdgeLossDb(0), 6.9 + 20 * Math.log10(Math.sqrt(1.01) - 0.1), 1e-12);
  near(knifeEdgeLossDb(0), 6.0, 0.05); // the P.526 approximation gives about 6.0 dB at the grazing edge
  near(knifeEdgeLossDb(1), 13.97, 0.05);
  assert.equal(knifeEdgeLossDb(-0.78), 0);
  assert.equal(knifeEdgeLossDb(-0.85), 0);
  assert.equal(knifeEdgeLossDb(NaN), 0);
  assert.ok(knifeEdgeLossDb(-0.5) < knifeEdgeLossDb(0) && knifeEdgeLossDb(0) < knifeEdgeLossDb(2));
  // v for a grazing edge is 0; for h = F1 at the midpoint, v = sqrt(2)
  near(knifeEdgeV(0, 5000, 10000, 600), 0, 0);
  near(knifeEdgeV(fresnelRadiusM(5000, 10000, 600), 5000, 10000, 600), Math.SQRT2, 1e-9);
});

test('required antenna height for 60 percent of F1 at 10 km: 1.4717 + 0.6 * 35.34 = 22.7 m (tol 0.05)', () => {
  near(requiredAntennaHeightM(10000, 600), 22.68, 0.05);
  const h = requiredAntennaHeightM(10000, 600);
  const g = p2pGeometry({ dM: 10000, htM: h, hrM: h, freqMHz: 600 });
  near(g.clearanceFractionMid, 0.6, 1e-3);
  assert.equal(g.meetsSixtyPercent, true);
});

test('p2pGeometry: tall masts clear the zone (no loss); low masts lose to the earth; an obstacle wins when it is the worse edge', () => {
  const clear = p2pGeometry({ dM: 1000, htM: 30, hrM: 30, freqMHz: 600 });
  assert.equal(clear.diffractionLossDb, 0); assert.equal(clear.edge, 'none'); assert.equal(clear.beyondHorizon, false);
  const low = p2pGeometry({ dM: 20000, htM: 3, hrM: 3, freqMHz: 600 });
  assert.equal(low.beyondHorizon, true); assert.equal(low.edge, 'earth'); assert.ok(low.diffractionLossDb > 6);
  const ob = p2pGeometry({ dM: 5000, htM: 20, hrM: 20, freqMHz: 600, obstacle: { distanceM: 2500, heightM: 40 } });
  assert.equal(ob.edge, 'obstacle');
  near(ob.edgeXM, 2500, 1e-9);
  const h = 40 - (20 - earthBulgeM(2500, 5000));
  near(ob.edgeHeightAboveLosM, h, 1e-9);
  near(ob.diffractionLossDb, knifeEdgeLossDb(knifeEdgeV(h, 2500, 5000, 600)), 1e-9);
  const harmless = p2pGeometry({ dM: 5000, htM: 20, hrM: 20, freqMHz: 600, obstacle: { distanceM: 2500, heightM: 2 } });
  assert.equal(harmless.diffractionLossDb, 0);
});

test('suggested fade margin: 10 dB to 10 km, then plus 10 log10(d / 10 km): 100 km gives 20 dB', () => {
  assert.equal(suggestedFadeMarginDb(500), 10); assert.equal(suggestedFadeMarginDb(10000), 10);
  near(suggestedFadeMarginDb(100000), 20, 1e-9);
});

test('library yagi, default p2p link and validation', () => {
  assert.equal(ANTENNAS.yagi.gainDbi, 10);
  const l = createDefaultLink('p2p');
  assert.equal(l.kind, 'p2p'); assert.equal(l.tx.antenna.type, 'yagi'); assert.equal(l.p2p.kFactor, 4 / 3);
  const s = createDefaultScene(); s.links[0] = l;
  assert.equal(validateScene(s).ok, true, validateScene(s).errors.join(';'));
  for (const bad of [{ kFactor: 0.1 }, { kFactor: 50 }, { fadeMarginDb: -1 }, { fadeMarginDb: 99 }, { groundReflection: 'yes' }, { obstacle: { distanceM: -5, heightM: 3 } }, { obstacle: { distanceM: 10, heightM: NaN } }]) {
    const t = createDefaultScene(); t.links[0] = createDefaultLink('p2p'); t.links[0].p2p = { ...t.links[0].p2p, ...bad };
    assert.equal(validateScene(t).ok, false, JSON.stringify(bad));
  }
  const far = createDefaultScene(); far.links[0] = createDefaultLink('p2p'); far.links[0].rx.pos.x = 50000;
  assert.equal(validateScene(far).ok, false); // beyond the +-10000 m coordinate bound
});

test('solveLink p2p: 1.2 km link equals FSPL + antenna gains + cable + diffraction, no body loss, result.p2p filled', () => {
  const s = p2pScene('snake'), l = s.links[0], r = rf.solveLink(s, l);
  const g = r.p2p;
  assert.ok(g && g.edge === 'earth');
  const fspl = 20 * Math.log10(1200) + 20 * Math.log10(606) - 27.55;
  const cable = rf.chainItemLossDb(l.chain[0], 606);
  near(r.inputPowerDbm, 20 + 10 + 10 - fspl - g.diffractionLossDb - 10 - cable, 0.05); // the 10 dB fade margin is a waterfall step
  assert.ok(r.waterfall.some((w) => /Diffraction \(single knife edge, earth curvature\)/.test(w.label)));
  assert.equal(r.waterfall.some((w) => /Body/i.test(w.label) && w.deltaDb !== 0), false);
  assert.equal(r.paths.length, 1); assert.equal(r.paths[0].kind, 'direct');
  const gr = p2pScene('snake'); gr.links[0].p2p.groundReflection = true; gr.environment.model = 'two-ray';
  assert.ok(rf.solveLink(gr, gr.links[0]).paths.length > 1);
});

test('solveLink p2p warnings: beyond the horizon, below 60 percent clearance, short path, none for a clean link', () => {
  const t = p2pScene('truck'), rt = rf.solveLink(t, t.links[0]);
  assert.equal(rt.p2p.edge, 'obstacle');
  assert.ok(rt.warnings.some((w) => /First Fresnel zone clearance/.test(w)));
  const b = p2pScene('bodypack'), rb = rf.solveLink(b, b.links[0]);
  assert.ok(rb.warnings.some((w) => /under 100 m/.test(w)));
  const d = p2pScene('delay'), rd = rf.solveLink(d, d.links[0]);
  assert.equal(rd.warnings.some((w) => /First Fresnel|horizon|under 100 m/.test(w)), false);
  assert.equal(rd.p2p.meetsSixtyPercent, true);
  const far = p2pScene('snake'); far.links[0].rx.pos.x = 100 + 40000; far.links[0].tx.pos.z = 3; far.links[0].rx.pos.z = 3;
  assert.ok(rf.solveLink(far, far.links[0]).warnings.some((w) => /horizon/i.test(w)));
});

test('mic and IEM links have no p2p result and are unchanged', () => {
  const s = createDefaultScene(), r = rf.solveLink(s, s.links[0]);
  assert.equal(r.p2p == null, true);
});

test('the p2p examples quote the model', () => {
  const note = (id) => EXAMPLES.find((e) => e.id === id).note;
  const run = (id, o) => { const s = p2pScene(id, o); const r = rf.solveLink(s, s.links[0]); assert.equal(validateScene(s).ok, true); return r; };
  const a = run('snake'), a2 = run('snake', { mastM: 2 });
  for (const v of [f1(a.rxPowerDbm), f1(a.marginDb), f1(a.p2p.diffractionLossDb), String(Math.round(a.p2p.minClearanceFraction * 100)), f1(a2.p2p.diffractionLossDb), String(Math.round(a2.p2p.minClearanceFraction * 100))]) assert.ok(note('p2p-wireless-snake').includes(v), v);
  const d = run('delay');
  for (const v of [f1(d.rxPowerDbm), f1(d.marginDb), String(Math.round(d.p2p.minClearanceFraction * 100))]) assert.ok(note('p2p-delay-speaker').includes(v), v);
  const t = run('truck'), t2 = run('truck', { hill: false });
  for (const v of [f1(t.rxPowerDbm), f1(t.marginDb), f1(t.p2p.diffractionLossDb)]) assert.ok(note('p2p-truck-hill').includes(v), v);
  for (const v of [f1(t2.rxPowerDbm), f1(t2.p2p.diffractionLossDb)]) assert.ok(note('p2p-truck-hill').includes(v), v);
  const b = run('bodypack');
  for (const v of [f1(b.rxPowerDbm), f1(b.marginDb), String(Math.round(b.p2p.minClearanceFraction * 100))]) assert.ok(note('p2p-bodypack-line-feed').includes(v), v);
  for (const id of ['p2p-wireless-snake', 'p2p-delay-speaker', 'p2p-truck-hill', 'p2p-bodypack-line-feed']) assert.ok(note(id).split('. ').length <= 4, id);
});
