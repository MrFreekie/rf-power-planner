import test from 'node:test';
import assert from 'node:assert/strict';
import * as rf from '../js/model/rf.js';
import * as u from '../js/model/units.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);

// ---- hand-built scene helpers (independent of scene.js)
const omni = { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 0 } };
function mkScene({ model = 'two-ray', floor = 'wood', pol = 'vertical', reflectors = [], fade = 0, body = 0 } = {}) {
  return { version: 1, units: { power: 'dBm', length: 'm' }, stage: { width: 12, depth: 8 },
    environment: { floor, polarisation: pol, model, fadeMarginDb: fade, bodyLossDb: body }, reflectors, links: [] };
}
function mkLink({ tx = { x: 0, y: 0, z: 1.5 }, rx = { x: 0, y: 10, z: 1.5 }, f = 600, p = 10, txAnt = omni, rxAnt = omni,
  chain = [], kind = 'mic', sens = -90, rxBody = 0 } = {}) {
  return { id: 'l1', name: 'L1', kind, freqMHz: f,
    tx: { id: 't', name: 'tx', powerDbm: p, pos: tx, antenna: txAnt },
    rx: { id: 'r', name: 'rx', pos: rx, antenna: rxAnt, sensitivityDbm: sens, bodyLossDb: rxBody }, chain };
}

// ---- basics
test('distance3D 3-4-12 triple = 13 m (exact)', () => {
  near(rf.distance3D({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 12 }), 13, 1e-12);
});
test('wavelengthM(300 MHz) = 0.99931 m (+/-1e-5)', () => {
  near(rf.wavelengthM(300), 0.9993082, 1e-5);
});
test('FSPL 600 MHz / 10 m = 48.01 dB (hand: 20log10(4*pi*10/0.499654)), +/-0.01', () => {
  near(rf.fsplDb(10, 600), 48.009, 0.01);
});
test('FSPL doubles distance -> +6.02 dB, doubles freq -> +6.02 dB (+/-1e-4)', () => {
  near(rf.fsplDb(20, 600) - rf.fsplDb(10, 600), 6.0206, 1e-4);
  near(rf.fsplDb(10, 1200) - rf.fsplDb(10, 600), 6.0206, 1e-4);
});

// ---- cables / chain
test('cable loss at a table point: LMR-400 600 MHz 10.8 dB/100m x 50 m = 5.4 dB', () => {
  near(rf.cableLossDb('lmr-400', 50, 600), 5.4, 1e-9);
});
test('cable loss log-log midpoint: sqrt(6.1*8.7)=7.285 dB/100m at 200*sqrt2 MHz (+/-1e-3)', () => {
  near(rf.cableLossDb('lmr-400', 100, 200 * Math.SQRT2), Math.sqrt(6.1 * 8.7), 1e-3);
});
test('cable loss is monotonic in frequency and linear in length', () => {
  assert.ok(rf.cableLossDb('rg58', 10, 700) > rf.cableLossDb('rg58', 10, 500));
  near(rf.cableLossDb('rg58', 20, 700), 2 * rf.cableLossDb('rg58', 10, 700), 1e-9);
});
test('cable extrapolates below/above the table smoothly (positive, increasing)', () => {
  assert.ok(rf.cableLossDb('rg58', 100, 50) > 0);
  assert.ok(rf.cableLossDb('rg58', 100, 50) < rf.cableLossDb('rg58', 100, 100));
  assert.ok(rf.cableLossDb('rg58', 100, 3000) > rf.cableLossDb('rg58', 100, 2400));
});
test('splitter 4 ports + 1 dB IL = 10log10(4)+1 = 7.0206 dB; booster +10 dB = -10 loss', () => {
  near(rf.chainLossDb([{ kind: 'splitter', ports: 4, insertionLossDb: 1 }], 600), 7.0206, 1e-4);
  near(rf.chainLossDb([{ kind: 'booster', gainDb: 10 }], 600), -10, 1e-12);
});
test('chain sums: cable 50 m LMR-400 + 2 dB filter + 10 dB booster = -2.6 dB (+/-1e-9)', () => {
  near(rf.chainLossDb([{ kind: 'cable', cableType: 'lmr-400', lengthM: 50 }, { kind: 'filter', lossDb: 2 },
    { kind: 'booster', gainDb: 10 }], 600), 5.4 + 2 - 10, 1e-9);
});
test('freqLossOverrideDbPer100m overrides library: 5 dB/100m x 20 m = 1 dB', () => {
  near(rf.chainLossDb([{ kind: 'cable', cableType: 'rg58', lengthM: 20, freqLossOverrideDbPer100m: 5 }], 600), 1, 1e-12);
});

// ---- reflection coefficients
test('floor reflection -> -1 at grazing (0.01 deg), both polarisations (+/-0.01)', () => {
  for (const pol of ['vertical', 'horizontal']) {
    const g = rf.floorReflection('wood', pol, 0.01, 600);
    near(g.re, -1, 0.01, pol); near(g.im, 0, 0.01, pol);
  }
});
test('floor TM has Brewster dip near grazing atan(1/sqrt(3.66))=27.6 deg (|G|<0.1), TE does not', () => {
  const tm = rf.floorReflection('wood', 'vertical', 27.6, 600);
  const te = rf.floorReflection('wood', 'horizontal', 27.6, 600);
  assert.ok(Math.hypot(tm.re, tm.im) < 0.1, `TM ${Math.hypot(tm.re, tm.im)}`);
  assert.ok(Math.hypot(te.re, te.im) > 0.3);
});
test('normal incidence on glass: |G| = (sqrt(e)-1)/(sqrt(e)+1) = 0.4285 (+/-0.01)', () => {
  const g = rf.reflectorCoefficient('glass', 0, 'vertical', 600);
  near(Math.hypot(g.re, g.im), (Math.sqrt(6.27) - 1) / (Math.sqrt(6.27) + 1), 0.01);
});
test('metal wall |G| ~ 1 at all incidence angles (+/-0.005); drapes absorb (|G| < 0.5)', () => {
  for (const a of [0, 30, 60, 85]) {
    const g = rf.reflectorCoefficient('metal', a, 'vertical', 600);
    near(Math.hypot(g.re, g.im), 1, 0.005, `angle ${a}`);
  }
  const d = rf.reflectorCoefficient('drapes', 20, 'vertical', 600);
  assert.ok(Math.hypot(d.re, d.im) < 0.5);
});

// ---- antennas
test('omni gain is 0 dBi in all directions', () => {
  for (const b of [{ az: 0, el: 0 }, { az: 123, el: 40 }, { az: -90, el: -20 }]) near(rf.antennaGainDb(omni, b), 0, 1e-9);
});
test('paddle: boresight = 7 dBi; behind = 7-18 = -11 dBi; follows orientation az (+/-0.05)', () => {
  const pad = { type: 'paddle', gainDbi: 7, orientation: { az: 90, el: 0 } }; // pointing +x
  near(rf.antennaGainDb(pad, { az: 90, el: 0 }), 7, 0.05);
  near(rf.antennaGainDb(pad, { az: -90, el: 0 }), -11, 0.05);
  assert.ok(rf.antennaGainDb(pad, { az: 0, el: 0 }) < 7 - 3); // 90 deg off is well down
});
test('paddle HPBW: table lobe -12*(a/75)^2 at 37.5 deg = -3 dB (+/-0.2)', () => {
  const pad = { type: 'paddle', gainDbi: 7, orientation: { az: 0, el: 0 } };
  near(rf.antennaGainDb(pad, { az: 37.5, el: 0 }), 7 - 3, 0.2);
});
test('dipole: broadside = gainDbi, along axis (el 90) is >= 30 dB down', () => {
  const dp = { type: 'dipole', gainDbi: 2.15, orientation: { az: 0, el: 0 } };
  near(rf.antennaGainDb(dp, { az: 77, el: 0 }), 2.15, 1e-6);
  assert.ok(rf.antennaGainDb(dp, { az: 0, el: 90 }) < 2.15 - 30);
});
test('tilted antenna: bearing evaluated in antenna frame (el 30 boresight sees full gain at el 30)', () => {
  const pad = { type: 'paddle', gainDbi: 7, orientation: { az: 0, el: 30 } };
  near(rf.antennaGainDb(pad, { az: 0, el: 30 }), 7, 0.05);
  assert.ok(rf.antennaGainDb(pad, { az: 0, el: 0 }) < 7);
});

// ---- path tracing
test('direct + floor: tx(0,0,1.5) rx(0,10,1.5) -> floor length sqrt(100+9)=10.440 m, bounce at y=5', () => {
  const ps = rf.tracePaths(mkScene(), mkLink());
  assert.deepEqual(ps.map((p) => p.kind), ['direct', 'floor']);
  near(ps[0].lengthM, 10, 1e-12);
  near(ps[1].lengthM, Math.sqrt(109), 1e-9);
  near(ps[1].points[1].y, 5, 1e-9); near(ps[1].points[1].z, 0, 1e-12);
  near(ps[1].delayNs, Math.sqrt(109) / 0.299792458, 1e-6);
});
test('bearing convention: az 0 = +y, 90 = +x; floor ray points down at both ends', () => {
  const ps = rf.tracePaths(mkScene(), mkLink({ rx: { x: 10, y: 0, z: 1.5 } }));
  near(ps[0].departureBearing.az, 90, 1e-9);
  near(ps[0].arrivalBearing.az, -90, 1e-9);
  assert.ok(ps[1].departureBearing.el < 0 && ps[1].arrivalBearing.el < 0);
});
test('single wall bounce (tx z1.5, rx z0.5): length sqrt(201), hit (5,5,1.0); floor-wall sqrt(204)', () => {
  const w = { id: 'w1', name: 'w', material: 'metal', p1: { x: 5, y: -5 }, p2: { x: 5, y: 20 }, zMin: 0, zMax: 5 };
  const ps = rf.tracePaths(mkScene({ reflectors: [w] }), mkLink({ rx: { x: 0, y: 10, z: 0.5 } }));
  const wall = ps.find((p) => p.kind === 'wall');
  assert.ok(wall); assert.equal(wall.via, 'w1');
  near(wall.lengthM, Math.sqrt(201), 1e-9);
  near(wall.points[1].x, 5, 1e-9); near(wall.points[1].y, 5, 1e-9); near(wall.points[1].z, 1.0, 1e-9);
  const fw = ps.filter((p) => p.kind === 'floor-wall');
  assert.equal(fw.length, 1);
  near(fw[0].lengthM, Math.sqrt(204), 1e-9);
  assert.equal(fw[0].points.length, 4);
});
test('wall rejected when hit is outside its length, outside zMin..zMax, or tx/rx on opposite sides', () => {
  const base = { id: 'w1', name: 'w', material: 'metal', p1: { x: 5, y: -5 }, p2: { x: 5, y: 20 }, zMin: 0, zMax: 5 };
  const count = (w, link = mkLink({ rx: { x: 0, y: 10, z: 0.5 } })) => rf.tracePaths(mkScene({ reflectors: [w] }), link).filter((p) => p.via).length;
  assert.equal(count(base), 2);
  assert.equal(count({ ...base, p1: { x: 5, y: 8 }, p2: { x: 5, y: 20 } }), 0, 'short wall');
  assert.equal(count({ ...base, zMin: 2, zMax: 5 }), 0, 'too high');
  assert.equal(count(base, mkLink({ rx: { x: 10, y: 10, z: 0.5 } })), 0, 'opposite sides');
});
test('low wall (zMax=0.7) blocks the z=0.85 wall bounce but passes floor-wall paths that hit it lower', () => {
  const w = { id: 'w1', name: 'w', material: 'metal', p1: { x: 5, y: -5 }, p2: { x: 5, y: 20 }, zMin: 0, zMax: 0.7 };
  const ps = rf.tracePaths(mkScene({ reflectors: [w] }), mkLink({ tx: { x: 0, y: 0, z: 1.5 }, rx: { x: 0, y: 10, z: 0.2 } }));
  assert.ok(!ps.some((p) => p.kind === 'wall'));
  assert.ok(ps.some((p) => p.kind === 'floor-wall'));
});
test('free-space model returns only the direct path', () => {
  const ps = rf.tracePaths(mkScene({ model: 'free-space' }), mkLink());
  assert.equal(ps.length, 1); assert.equal(ps[0].kind, 'direct');
});

// ---- link solving
test('free-space link: 10 dBm, 600 MHz, 10 m, omni -> rx = -38.009 dBm (+/-0.01)', () => {
  const r = rf.solveLink(mkScene({ model: 'free-space' }), mkLink());
  near(r.distanceM, 10, 1e-12);
  near(r.fsplDb, 48.009, 0.01);
  near(r.pathLossDb, 48.009, 0.01);
  near(r.rxPowerDbm, -38.009, 0.01);
  near(r.inputPowerDbm, -38.009, 0.01);
  near(r.marginDb, 90 - 38.009, 0.01);
  assert.equal(r.status, 'pass');
});
test('antenna gain at true bearing: paddle aimed at Rx +7 dBi; aimed away -11 dBi (+/-0.05)', () => {
  const sc = mkScene({ model: 'free-space' });
  const toward = rf.solveLink(sc, mkLink({ txAnt: { type: 'paddle', gainDbi: 7, orientation: { az: 0, el: 0 } } }));
  const away = rf.solveLink(sc, mkLink({ txAnt: { type: 'paddle', gainDbi: 7, orientation: { az: 180, el: 0 } } }));
  near(toward.rxPowerDbm, 10 + 7 - 48.009, 0.05);
  near(away.rxPowerDbm, 10 - 11 - 48.009, 0.05);
});
test('rx antenna gain evaluated at arrival bearing (rx paddle pointing at tx: az 180)', () => {
  const r = rf.solveLink(mkScene({ model: 'free-space' }),
    mkLink({ rxAnt: { type: 'paddle', gainDbi: 7, orientation: { az: 180, el: 0 } } }));
  near(r.rxPowerDbm, 10 + 7 - 48.009, 0.05);
});
test('two-ray far field follows plane-earth law PL = 40log d - 20log(ht hr): 112.96 dB at 1 km (+/-1 dB)', () => {
  const sc = mkScene();
  const r1 = rf.solveLink(sc, mkLink({ rx: { x: 0, y: 1000, z: 1.5 } }));
  const r2 = rf.solveLink(sc, mkLink({ rx: { x: 0, y: 2000, z: 1.5 } }));
  near(r1.pathLossDb, 120 - 20 * Math.log10(2.25), 1.0);
  near(r2.pathLossDb - r1.pathLossDb, 12.04, 0.5, 'd^4 slope = 12.04 dB per doubling');
});
test('two-ray coherent sum never exceeds +6.02 dB over direct; peaks > +4.5 dB; nulls < -8 dB (horizontal pol, d 3..60 m)', () => {
  const sc = mkScene({ pol: 'horizontal' });
  let max = -99, min = 99;
  for (let d = 3; d <= 60; d += 0.01) {
    const r = rf.solveLink(sc, mkLink({ rx: { x: 0, y: d, z: 1.5 } }));
    const gain = r.fsplDb - r.pathLossDb;
    if (gain > max) max = gain;
    if (gain < min) min = gain;
  }
  assert.ok(max <= 6.0206 + 1e-6, `max ${max}`);
  assert.ok(max > 4.5, `max ${max}`);
  assert.ok(min < -8, `min ${min}`);
});
test('metal-wall bounce relative level: -20log10(14.142/10) = -3.01 dB (|G|~1, omni, +/-0.1)', () => {
  const w = { id: 'w1', name: 'w', material: 'metal', p1: { x: 5, y: -5 }, p2: { x: 5, y: 20 }, zMin: 0, zMax: 5 };
  const r = rf.solveLink(mkScene({ reflectors: [w] }), mkLink());
  const wall = r.paths.find((p) => p.kind === 'wall');
  near(wall.relDb, -3.01, 0.1);
  assert.equal(r.paths[0].relDb, 0);
  near(r.paths[0].gainDb, -48.009, 0.01);
  assert.ok(Number.isFinite(wall.phaseRad));
});
test('coherent sum equals phasor sum of per-path gainDb/phaseRad; floor-ray phase = -2pi d/lambda + arg(G)', () => {
  const sc = mkScene({ floor: 'concrete' });
  const r = rf.solveLink(sc, mkLink({ rx: { x: 0, y: 7.3, z: 1.2 } }));
  const lam = rf.wavelengthM(600);
  let re = 0, im = 0;
  for (const p of r.paths) {
    const a = Math.pow(10, p.gainDb / 20);
    re += a * Math.cos(p.phaseRad); im += a * Math.sin(p.phaseRad);
  }
  const direct = Math.pow(10, r.paths[0].gainDb / 20);
  near(r.fsplDb - r.pathLossDb, 20 * Math.log10(Math.hypot(re, im) / direct), 1e-6);
  const fl = r.paths[1];
  const graze = Math.asin((1.5 + 1.2) / fl.lengthM) * 180 / Math.PI; // total vertical drop / path length
  const g = rf.floorReflection('concrete', 'vertical', graze, 600);
  let ph = -2 * Math.PI * fl.lengthM / lam + Math.atan2(g.im, g.re);
  ph = Math.atan2(Math.sin(ph), Math.cos(ph));
  near(fl.phaseRad, ph, 1e-9);
});

// ---- waterfall
test('mic waterfall: LMR-400 20 m (2.16 dB) + 10 dB booster after Rx antenna, body 3 dB, fade 2 dB', () => {
  const lk = mkLink({ chain: [{ kind: 'cable', cableType: 'lmr-400', lengthM: 20 }, { kind: 'booster', gainDb: 10 }], rxBody: 3 });
  const r = rf.solveLink(mkScene({ model: 'free-space', fade: 2 }), lk);
  near(r.rxPowerDbm, 10 - 48.009 - 3 - 2, 0.01);
  near(r.inputPowerDbm, r.rxPowerDbm - 2.16 + 10, 1e-9);
  const sum = r.waterfall.reduce((s, w) => s + w.deltaDb, 0);
  near(r.waterfall[0].valueDbm + sum, r.inputPowerDbm, 1e-9);
  near(r.waterfall[r.waterfall.length - 1].valueDbm, r.inputPowerDbm, 1e-9);
  assert.equal(r.waterfall[0].label, 'Tx power');
  assert.equal(r.waterfall[0].valueDbm, 10);
});
test('iem waterfall: chain precedes Tx antenna (rg58 10 m = 4.25 dB), bodypack input = rx power', () => {
  const lk = mkLink({ kind: 'iem', p: 20, chain: [{ kind: 'cable', cableType: 'rg58', lengthM: 10 }] });
  const r = rf.solveLink(mkScene({ model: 'free-space' }), lk);
  near(r.waterfall[1].valueDbm, 20 - 4.25, 1e-9);
  near(r.rxPowerDbm, 20 - 4.25 - 48.009, 0.01);
  near(r.inputPowerDbm, r.rxPowerDbm, 1e-12);
});
test('status thresholds: >=6 dB pass, 0..6 marginal, <0 fail', () => {
  const sc = mkScene({ model: 'free-space' });
  const at = (margin) => rf.solveLink(sc, mkLink({ sens: -38.009 - margin }));
  assert.equal(at(7).status, 'pass');
  assert.equal(at(3).status, 'marginal');
  assert.equal(at(-1).status, 'fail');
  near(at(3).marginDb, 3, 0.01);
});

// ---- units
test('units: 0 dBm = 1 mW, 30 dBm = 1 W, dBW offset, ft conversion, formatting', () => {
  near(u.dbmToMw(0), 1, 1e-12); near(u.dbmToW(30), 1, 1e-12); near(u.wToDbm(0.1), 20, 1e-9);
  near(u.mwToDbm(100), 20, 1e-12); near(u.dbmToDbw(30), 0, 0); near(u.dbwToDbm(-10), 20, 0);
  near(u.mToFt(1), 3.28084, 1e-5); near(u.ftToM(10), 3.048, 1e-12);
  assert.equal(u.formatPower(20, 'mW'), '100 mW');
  assert.equal(u.formatPower(13, 'dBm'), '13.0 dBm');
  assert.equal(u.formatPower(30, 'dBW'), '0.0 dBW');
  assert.equal(u.formatLength(3.048, 'ft'), '10.0 ft');
  near(u.powerToDbm(100, 'mW'), 20, 1e-12);
});

// ---- review fixes
test('FSPL clamps distance to >= 0.1 m (never negative in the near field): fspl(0.001)=fspl(0.1)=8.01 dB at 600 MHz', () => {
  near(rf.fsplDb(0.001, 600), rf.fsplDb(0.1, 600), 1e-12);
  near(rf.fsplDb(0, 600), 8.011, 0.01); // 20log10(4*pi*0.1/0.499654)
  assert.ok(rf.fsplDb(0, 600) > 0);
});
test('antennaGainDb pattern sum is clamped to -40..0 dB relative: stacked az+el nulls bottom out at gain-40', () => {
  const sum = { type: 'custom', gainDbi: 5, orientation: { az: 0, el: 0 },
    patternOverride: { azDb: new Array(361).fill(-35), elDb: new Array(361).fill(-35) } };
  near(rf.antennaGainDb(sum, { az: 10, el: 10 }), 5 - 40, 1e-9);
  const pos = { ...sum, patternOverride: { azDb: new Array(361).fill(3), elDb: new Array(361).fill(3) } };
  near(rf.antennaGainDb(pos, { az: 10, el: 10 }), 5, 1e-9);
});
