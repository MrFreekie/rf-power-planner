// First Fresnel zone clearance for mic, IEM and p2p paths (item 33). Hand values: lambda = c / f = 0.499654 m at 600 MHz, F1(x) = sqrt(lambda x (d - x) / d).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fresnelClearance, fresnelRadiusM, fresnelEllipsoid, fresnelForScene, FRESNEL_CLEARANCE_FRACTION } from '../js/model/fresnel.js';
import { p2pGeometry, fresnelRadiusM as p2pF1 } from '../js/model/p2p.js';
import { createDefaultScene, createAudience, createReflector, createPlatform, createCeiling, validateScene } from '../js/model/scene.js';
import { solveLink } from '../js/model/rf.js';
import { fohScene } from '../js/examples.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);
const LAM = 299792458 / 6e8;

// a 30 m path along +x at y = 5, both antennas at height h (m), 600 MHz, nothing else in the scene
function straight(h = 1.5, patch = () => {}) {
  const s = createDefaultScene(); const l = s.links[0];
  l.freqMHz = 600; s.stage = { width: 40, depth: 10, heightM: 0 };
  l.tx.pos = { x: 0, y: 5, z: h }; l.rx.pos = { x: 30, y: 5, z: h };
  patch(s, l);
  return { s, l };
}

test('F1 hand values: 600 MHz over 30 m is 1.936 m at the midpoint (about 1.9 m), 60 percent is 1.161 m, zero at the ends, and matches p2p.js', () => {
  near(fresnelRadiusM(15, 30, 600), Math.sqrt(LAM * 15 * 15 / 30), 1e-12); near(fresnelRadiusM(15, 30, 600), 1.9358, 1e-3);
  assert.equal(fresnelRadiusM(0, 30, 600), 0); assert.equal(fresnelRadiusM(30, 30, 600), 0);
  near(fresnelRadiusM(7, 30, 600), p2pF1(7, 30, 600), 1e-12);
  const e = fresnelEllipsoid(30, 600); near(e.semiMinorM, Math.sqrt(30 * LAM / 4 + LAM * LAM / 16), 1e-12); near(e.semiMinorM, 1.9398, 1e-3); near(e.semiMajorM, 15 + LAM / 4, 1e-12);
  const { s, l } = straight(1.5); const r = fresnelClearance(s, l);
  near(r.dM, 30, 1e-9); near(r.f1MidM, 1.9358, 1e-3); near(r.r60MidM, 0.6 * 1.9358, 1e-3);
});

test('floor clearance: 1.5 m antennas over 30 m give 1.5 / 1.9358 = 0.775 (clear); 1.0 m gives 0.517 (marginal, below 60 percent); 0.5 m 0.258', () => {
  const a = fresnelClearance(...Object.values(straight(1.5)));
  near(a.minFraction, 1.5 / 1.9358, 2e-3); assert.equal(a.status, 'clear'); assert.equal(a.meets60, true); assert.equal(a.worst.category, 'floor'); assert.deepEqual(a.warnings, []);
  const b = fresnelClearance(...Object.values(straight(1.0)));
  near(b.minFraction, 1.0 / 1.9358, 2e-3); assert.equal(b.status, 'marginal'); assert.equal(b.meets60, false); assert.ok(b.warnings.length === 1 && /floor/.test(b.warnings[0]));
  near(fresnelClearance(...Object.values(straight(0.5))).minFraction, 0.5 / 1.9358, 2e-3);
  assert.equal(FRESNEL_CLEARANCE_FRACTION, 0.6);
});

test('audience heads: a standing crowd (1.75 m) across a 1.5 m path puts the centre line 0.25 m inside it: fraction -0.25 / F1(x), blocked; raised to 2.5 m it clears by 0.75 m', () => {
  const add = (s) => { s.audience = [createAudience({ id: 'a1', x: 10, y: 0, width: 10, depth: 10, kind: 'standing', densityPerM2: 2 })]; };
  const r = fresnelClearance(...Object.values(straight(1.5, add)));
  const c = r.categories.audience; near(c.clearanceM, -0.25, 1e-9); near(c.minFraction, -0.25 / fresnelRadiusM(c.xM, 30, 600), 1e-9);
  assert.equal(c.blocked, true); assert.equal(r.status, 'blocked'); assert.equal(c.alreadyModelled, true); assert.ok(r.warnings.some((w) => /audience/.test(w) && /already in the link budget/.test(w)));
  assert.ok(c.edgeLossDb > 0 && c.edgeLossDb < 30);
  const seated = fresnelClearance(...Object.values(straight(1.5, (s) => { s.audience = [createAudience({ x: 10, y: 0, width: 10, depth: 10, kind: 'seated' })]; })));
  assert.ok(seated.categories.audience.minFraction > 0); // seated heads 1.2 m: the path is 0.3 m above
  const hi = fresnelClearance(...Object.values(straight(2.5, add)));
  assert.ok(hi.categories.audience.clearanceM >= 0.74 && hi.categories.audience.clearanceM <= 0.76 + 1e-9, String(hi.categories.audience.clearanceM)); // 2.5 - 1.75, over the middle of the crowd
});

test('walls and platforms: a wall 1 m beside the path leaves 1 / 1.9358 = 0.517; a platform (FOH desk) top at 1.2 m under a 1.5 m path leaves 0.3 m; named desk is category foh', () => {
  const w = fresnelClearance(...Object.values(straight(1.5, (s) => { s.reflectors = [createReflector({ id: 'w', name: 'Side wall', p1: { x: -5, y: 6 }, p2: { x: 40, y: 6 }, zMin: 0, zMax: 4 })]; })));
  near(w.categories.wall.minFraction, 1 / 1.9358, 2e-3); assert.equal(w.categories.wall.alreadyModelled, true); assert.equal(w.status, 'marginal');
  const p = fresnelClearance(...Object.values(straight(1.5, (s) => { s.platforms = [createPlatform({ id: 'p1', name: 'FOH desk', x: 12, y: 3, width: 6, depth: 4, topM: 1.2 })]; })));
  near(p.categories.foh.clearanceM, 0.3, 1e-9); assert.equal(p.categories.platform, undefined);
  const q = fresnelClearance(...Object.values(straight(1.5, (s) => { s.platforms = [createPlatform({ id: 'p2', name: 'Riser', x: 12, y: 3, width: 6, depth: 4, topM: 1.2 })]; })));
  assert.ok(q.categories.platform);
  const rot = fresnelClearance(...Object.values(straight(1.5, (s) => { s.platforms = [createPlatform({ id: 'p3', name: 'Riser', x: 12, y: 3, width: 6, depth: 4, topM: 2.0, rotationDeg: 90 })]; })));
  assert.equal(rot.categories.platform.blocked, true); // rotation about the centre: the 6 x 4 box becomes 4 x 6 around (15, 5); the path still crosses it
});

test('stage lip: the deck is a box; a path from the deck to the floor beyond clears its edge by the geometry, and a deck above the path blocks it', () => {
  const r = fresnelClearance(...Object.values(straight(1.5, (s, l) => { s.stage = { width: 12, depth: 10, heightM: 1.0 }; l.tx.pos = { x: 6, y: 5, z: 1.5 }; l.rx.pos = { x: 30, y: 5, z: 1.5 }; })));
  assert.ok(r.categories.stage); assert.equal(r.categories.stage.name, 'Stage deck');
  assert.ok(r.categories.stage.clearanceM > 0.9 && r.categories.stage.minFraction > 0); // tx is 2.5 m absolute over a 1.0 m deck, the lip at x = 12
  const bad = fresnelClearance(...Object.values(straight(0.2, (s) => { s.stage = { width: 12, depth: 10, heightM: 1.0 }; })));
  assert.equal(bad.categories.stage.blocked, true);
});

test('ceiling and truss: a 3.0 m ceiling over a 2.5 m path leaves 0.5 / 1.9358 = 0.258 (marginal, not in the link budget); a 2.0 m ceiling blocks with J(v) = 16.7 dB at the first sample', () => {
  const lo = fresnelClearance(...Object.values(straight(2.5, (s) => { s.ceiling = createCeiling({ heightM: 3.0 }); })));
  near(lo.categories.ceiling.minFraction, 0.5 / 1.9358, 2e-3); assert.equal(lo.categories.ceiling.alreadyModelled, false); assert.ok(lo.warnings.some((w) => /Not in the link budget/.test(w)));
  const bl = fresnelClearance(...Object.values(straight(2.5, (s) => { s.ceiling = createCeiling({ heightM: 2.0 }); })));
  assert.equal(bl.categories.ceiling.blocked, true); assert.equal(bl.status, 'blocked');
  // first sample x = 30/64 = 0.46875 m: F1 = sqrt(lambda x (d - x) / d) = 0.4805, fraction -0.5 / 0.4805 = -1.0406, v = sqrt 2 x 1.0406 = 1.4717, J = 6.9 + 20 log10(sqrt((v - 0.1)^2 + 1) + v - 0.1)
  const v = Math.SQRT2 * 0.5 / Math.sqrt(LAM * 0.46875 * (30 - 0.46875) / 30); const j = 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1);
  near(bl.categories.ceiling.edgeLossDb, j, 1e-6); near(j, 16.65, 0.1);
  const truss = fresnelClearance(...Object.values(straight(2.5, (s) => { s.overheadPanels = [{ id: 'tr', name: 'Truss', x: 5, y: 0, width: 20, depth: 10, heightM: 2.9, material: 'metal', lossDb: 0 }]; })));
  assert.ok(truss.categories.truss); near(truss.categories.truss.clearanceM, 0.4, 1e-9);
});

test('p2p: floor clearance subtracts the earth bulge: mid-path 6 m masts over 1 km give (6 - 0.01472) / 11.177 = 0.536, the same as p2p.js', () => {
  const s = createDefaultScene(); s.links = [createDefaultScene().links[0]]; // placeholder, replaced below
  const p = createDefaultScene(); const pl = p.links[0]; pl.kind = 'p2p'; pl.freqMHz = 600; pl.p2p = { kFactor: 4 / 3 };
  pl.tx.pos = { x: 0, y: 0, z: 6 }; pl.rx.pos = { x: 1000, y: 0, z: 6 }; p.stage = { width: 20, depth: 10, heightM: 0 };
  const r = fresnelClearance(p, pl);
  const g = p2pGeometry({ dM: 1000, htM: 6, hrM: 6, freqMHz: 600 });
  near(r.categories.floor.minFraction, g.clearanceFractionMid, 2e-3); near(r.categories.floor.minFraction, (6 - 250000 / (2 * (4 / 3) * 6371000)) / 11.177, 2e-3);
  assert.equal(r.status, 'marginal'); assert.ok(r.f1MidM > 11.1 && r.f1MidM < 11.2);
  assert.equal(s.links.length, 1);
});

test('geometry for drawing: the plan lens is F1 wide each side of the centre line, the side ellipse is symmetric about the path, 60 percent version scaled by 0.6', () => {
  const { s, l } = straight(1.5); const r = fresnelClearance(s, l);
  const lens = r.geometry.plan.lens; assert.equal(lens.length, 50);
  assert.deepEqual(r.geometry.plan.centre, [{ x: 0, y: 5 }, { x: 30, y: 5 }]);
  const mid = lens[12]; near(mid.x, 15, 1e-9); near(Math.abs(mid.y - 5), r.f1MidM, 1e-9); // a horizontal path: offsets are in y
  const el = r.geometry.side.ellipse; near(el[12].z, 1.5 + r.f1MidM, 1e-9); near(el[el.length - 1 - 12].z, 1.5 - r.f1MidM, 1e-9); near(el[12].u, 15, 1e-9);
  near(r.geometry.plan.lens60[12].y - 5, 0.6 * (lens[12].y - 5), 1e-9); near(r.geometry.side.ellipse60[12].z - 1.5, 0.6 * (el[12].z - 1.5), 1e-9);
  near(r.ellipsoid.semiMinor60M, 0.6 * r.ellipsoid.semiMinorM, 1e-12); assert.deepEqual(r.ellipsoid.axis, { x: 1, y: 0, z: 0 });
  // a sloped path: the vertical-plane normal is perpendicular to the path (dot product zero)
  const sl = straight(1.5, (sc, lk) => { lk.rx.pos = { x: 30, y: 5, z: 9.5 }; }); const rs = fresnelClearance(sl.s, sl.l);
  const e = rs.geometry.side.ellipse, k = 12, L = rs.geometry.side.lengthM; const top = e[k], c = { u: (k / 24) * L, z: 1.5 + (k / 24) * 8 };
  near((top.u - c.u) * L + (top.z - c.z) * 8, 0, 1e-9); // direction (L, 8)
  near(Math.hypot(top.u - c.u, top.z - c.z), fresnelRadiusM((k / 24) * rs.dM, rs.dM, 600), 1e-9);
  const v = straight(1.5, (sc, lk) => { lk.rx.pos = { x: 0, y: 5, z: 8.5 }; }); const rv = fresnelClearance(v.s, v.l); assert.ok(rv.geometry.side.ellipse.every((p) => Number.isFinite(p.u) && Number.isFinite(p.z)));
});

test('FOH examples: low antennas behind a standing crowd are blocked, raised antennas improve it, remote antennas near the stage are clear; the budget is untouched', () => {
  const g = (id) => { const s = fohScene(id); return { s, r: fresnelClearance(s, s.links[0]) }; };
  const low = g('low'), raised = g('raised'), remote = g('remote');
  assert.equal(low.r.status, 'blocked'); assert.equal(low.r.worst.category, 'audience');
  assert.ok(raised.r.minFraction > low.r.minFraction); assert.equal(remote.r.status, 'clear');
  const before = JSON.stringify(solveLink(low.s, low.s.links[0]).rxPowerDbm); fresnelClearance(low.s, low.s.links[0]); fresnelForScene(low.s);
  assert.equal(JSON.stringify(solveLink(low.s, low.s.links[0]).rxPowerDbm), before);
  assert.deepEqual(Object.keys(fresnelForScene(low.s)), low.s.links.map((l) => l.id));
  assert.equal(validateScene(low.s).ok, true);
});

test('p2p-truck-hill: fresnel.js and p2p.js agree (hill clearance -21.13 m, -69 percent of F1, blocked, edge loss 13.8 dB); without the hill the floor fractions agree within sampling', async () => {
  const { p2pScene } = await import('../js/examples.js');
  const { solveLink } = await import('../js/model/rf.js');
  const { fresnelClearance } = await import('../js/model/fresnel.js');
  const s = p2pScene('truck'), l = s.links[0], r = solveLink(s, l).p2p, fz = fresnelClearance(s, l);
  // hand check: line of sight at 3 km = 12 + (6 - 12) x 3/8 = 9.75 m; earth bulge 3000 x 5000 / (2 x 4/3 x 6371000) = 0.883 m; clearance 9.75 - 0.883 - 30 = -21.13 m; F1 = sqrt(0.4948 x 3000 x 5000 / 8000) = 30.46 m -> -0.694
  assert.ok(Math.abs(fz.worst.fraction - r.minClearanceFraction) < 0.01, `${fz.worst.fraction} vs ${r.minClearanceFraction}`);
  assert.ok(Math.abs(fz.worst.fraction - (-0.694)) < 0.005);
  assert.equal(fz.status, 'blocked'); assert.equal(fz.worst.category, 'obstacle'); assert.equal(fz.meets60, r.meetsSixtyPercent);
  const ob = fz.obstacles.find((o) => o.category === 'obstacle');
  assert.ok(Math.abs(ob.edgeLossDb - r.diffractionLossDb) < 0.05, `${ob.edgeLossDb} vs ${r.diffractionLossDb}`);
  const s2 = p2pScene('truck', { hill: false }), r2 = solveLink(s2, s2.links[0]).p2p, fz2 = fresnelClearance(s2, s2.links[0]);
  assert.ok(!fz2.obstacles.some((o) => o.category === 'obstacle'));
  assert.ok(Math.abs(fz2.minFraction - r2.minClearanceFraction) < 0.02, `${fz2.minFraction} vs ${r2.minClearanceFraction}`);
});
