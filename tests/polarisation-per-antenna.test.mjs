// Polarisation is per antenna only: migration of environment.polarisation, always-on mismatch, circular physics, helical-cp type.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as rf from '../js/model/rf.js';
import { ANTENNAS, allowedPolarisations, isCircularType, defaultPolarisation } from '../js/model/library.js';
import { createDefaultScene, createDefaultLink, createBranch, migrateScene, validateScene } from '../js/model/scene.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);
const ant = (o = {}) => ({ type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 }, ...o });
const hz = { az: 0, el: 0 }, back = { az: 180, el: 0 };
const loss = (a, b, o) => rf.polarisationLossDb(a, b, hz, back, o);

test('new scenes carry no environment.polarisation and every default antenna is explicitly vertical', () => {
  const s = createDefaultScene();
  assert.equal('polarisation' in s.environment, false);
  assert.equal(s.links[0].tx.antenna.polarisation, 'vertical');
  assert.equal(s.links[0].rx.antenna.polarisation, 'vertical');
  assert.equal(createBranch().antenna.polarisation, 'vertical');
  assert.equal(validateScene(s).ok, true);
});

test('migration: a legacy environment.polarisation is copied onto every antenna without one (Tx, Rx, B, branches), then dropped', () => {
  const s = createDefaultScene();
  s.links[0] = createDefaultLink('iem');
  s.environment.polarisation = 'horizontal';
  delete s.links[0].tx.antenna.polarisation; delete s.links[0].rx.antenna.polarisation;
  s.links[0].rx.diversity.antennaB.antenna = ant({ type: 'paddle' });
  s.links[0].branches = [createBranch(), createBranch({ antenna: ant({ type: 'paddle', polarisation: 'slant45' }) }), createBranch({ antenna: { ...ant({ type: 'paddle' }) } })];
  s.links[0].branches.forEach((b, i) => { if (i > 0 && i < 2) return; if (i === 0) { delete b.antenna.polarisation; return; } if (b.antenna.polarisation === undefined) delete b.antenna.polarisation; });
  const m = migrateScene(s);
  assert.equal('polarisation' in m.environment, false);
  assert.equal(m.links[0].tx.antenna.polarisation, 'horizontal');
  assert.equal(m.links[0].rx.antenna.polarisation, 'horizontal');
  assert.equal(m.links[0].rx.diversity.antennaB.antenna.polarisation, 'horizontal');
  assert.equal(m.links[0].branches[1].antenna.polarisation, 'slant45'); // an explicit value is kept
  assert.equal(m.links[0].branches[2].antenna.polarisation, 'horizontal');
  // no legacy value: vertical, and a circular type gets rhcp
  const t = createDefaultScene(); delete t.links[0].tx.antenna.polarisation;
  t.links[0].rx.antenna = ant({ type: 'helical-cp', gainDbi: 8 });
  const n = migrateScene(t);
  assert.equal(n.links[0].tx.antenna.polarisation, 'vertical');
  assert.equal(n.links[0].rx.antenna.polarisation, 'rhcp');
  assert.equal(validateScene(m).ok && validateScene(n).ok, true);
});

test('helical-cp library type and validation: circular types take rhcp/lhcp only, linear types take vertical/horizontal/slant45 only', () => {
  assert.equal(ANTENNAS['helical-cp'].circular, true);
  assert.equal(ANTENNAS['helical-cp'].gainDbi, 9);
  assert.deepEqual(ANTENNAS['helical-cp'].bandMHz, [450, 960]);
  assert.equal(ANTENNAS['helical-cp'].confidence.gainDbi, 'I');
  assert.deepEqual([...allowedPolarisations('helical-cp')], ['rhcp', 'lhcp']);
  assert.deepEqual([...allowedPolarisations('paddle')], ['vertical', 'horizontal', 'slant45']);
  assert.equal(isCircularType('helical'), false);
  assert.equal(defaultPolarisation('helical-cp'), 'rhcp');
  const s = createDefaultScene();
  s.links[0].rx.antenna = ant({ type: 'helical-cp', gainDbi: 8, polarisation: 'lhcp' });
  assert.equal(validateScene(s).ok, true, validateScene(s).errors.join(';'));
  s.links[0].rx.antenna.polarisation = 'vertical';
  assert.equal(validateScene(s).ok, false);
  s.links[0].rx.antenna = ant({ type: 'paddle', polarisation: 'rhcp' });
  assert.equal(validateScene(s).ok, false);
});

test('the mismatch is always computed (no opt-in): vertical Tx with a slant Rx shows 2.875 dB; info at 3 dB, warning at 10 dB', () => {
  const s = createDefaultScene();
  s.environment.model = 'free-space';
  const l = s.links[0];
  l.tx.antenna = ant({ polarisation: 'vertical' }); l.rx.antenna = ant({ polarisation: 'slant45' });
  const r = rf.solveLink(s, l);
  const st = r.waterfall.find((w) => w.label === 'Polarisation mismatch');
  near(st.deltaDb, -2.875, 0.01);
  assert.equal(r.polarisation.severity, 'ok'); // below 3 dB
  l.rx.antenna = ant({ polarisation: 'rhcp' });
  assert.equal(rf.solveLink(s, l).polarisation.severity, 'info');
  assert.ok(rf.solveLink(s, l).warnings.some((w) => /^Note: polarisation mismatch costs 3\.0 dB/.test(w)));
  l.rx.antenna = ant({ polarisation: 'horizontal' });
  const h = rf.solveLink(s, l);
  assert.equal(h.polarisation.severity, 'warning');
  assert.ok(h.warnings.some((w) => /Polarisation mismatch costs 15\.0 dB/.test(w)));
  near(rf.DEFAULT_XPD_DB, 15, 0);
});

test('circular physics: linear to circular 3.01 dB at any angle, same sense 0, opposite sense 20 dB (axial ratio), each reflection flips the sense', () => {
  near(rf.DEFAULT_CIRCULAR_XPD_DB, 20, 0);
  for (const roll of [0, 30, 77, 123]) near(loss(ant({ polarisation: 'rhcp' }), ant({ polarisation: 'vertical', rollDeg: roll })), 3.0103, 1e-3);
  for (const roll of [0, 45, 90]) near(loss(ant({ polarisation: 'lhcp', rollDeg: roll }), ant({ polarisation: 'horizontal' })), 3.0103, 1e-3);
  near(loss(ant({ polarisation: 'rhcp' }), ant({ polarisation: 'rhcp' })), 0, 1e-9);
  near(loss(ant({ polarisation: 'rhcp' }), ant({ polarisation: 'lhcp' })), 20, 1e-6);
  const a = ant({ polarisation: 'rhcp' });
  near(rf.polarisationLossDb(a, a, hz, back, { reflections: 1 }), 20, 1e-6); // odd bounce: opposite sense
  near(rf.polarisationLossDb(a, a, hz, back, { reflections: 2 }), 0, 1e-9);  // even bounce restores it
});

test('a circular pair rejects the floor bounce (20 dB in the polarisation term); a vertical pair has none (image-method E vector)', () => {
  const mk = (p) => {
    const s = createDefaultScene();
    s.environment.floor = 'concrete'; s.environment.model = 'two-ray';
    const l = s.links[0];
    l.tx.pos = { x: 1, y: 4, z: 1.5 }; l.rx.pos = { x: 9, y: 4, z: 1.2 };
    l.tx.antenna = ant({ polarisation: p }); l.rx.antenna = ant({ polarisation: p });
    return rf.solveLink(s, l);
  };
  const lin = mk('vertical'), cir = mk('rhcp');
  near(lin.paths.find((p) => p.kind === 'floor').polarisationLossDb || 0, 0, 1e-6);
  near(cir.paths.find((p) => p.kind === 'floor').polarisationLossDb, 20, 1e-6);
  const ripple = (r) => Math.abs(r.waterfall.find((w) => /Multipath/.test(w.label))?.deltaDb ?? 0);
  assert.ok(ripple(cir) < ripple(lin) + 1e-9);
});

test('the reflection coefficient follows the TRANSMIT antenna polarisation; slant and circular use the TE/TM average', () => {
  const mk = (tp, rp) => {
    const s = createDefaultScene();
    s.environment.floor = 'concrete';
    const l = s.links[0];
    l.tx.pos = { x: 1, y: 4, z: 1.5 }; l.rx.pos = { x: 9, y: 4, z: 1.5 };
    l.tx.antenna = ant({ polarisation: tp }); l.rx.antenna = ant({ polarisation: rp });
    return rf.solveLink(s, l);
  };
  assert.equal(mk('vertical', 'vertical').polarisation.txPolarisation, 'vertical');
  assert.equal(mk('horizontal', 'horizontal').polarisation.txPolarisation, 'horizontal');
  const gv = mk('vertical', 'vertical').paths.find((p) => p.kind === 'floor').gainDb;
  const gh = mk('horizontal', 'horizontal').paths.find((p) => p.kind === 'floor').gainDb;
  assert.ok(Math.abs(gv - gh) > 1, `${gv} ${gh}`);
  // same Tx, different Rx: same reflection factor, the floor ray differs only by the polarisation term (vertical to slant45 = 2.875 dB)
  const a = mk('vertical', 'vertical').paths.find((p) => p.kind === 'floor').gainDb, b = mk('vertical', 'slant45').paths.find((p) => p.kind === 'floor').gainDb;
  near(a - b, 2.875, 0.05);
  const te = rf.floorReflection('concrete', 'horizontal', 20, 600), tm = rf.floorReflection('concrete', 'vertical', 20, 600), c = rf.floorReflection('concrete', 'rhcp', 20, 600);
  near(c.re, (te.re + tm.re) / 2, 1e-12); near(c.im, (te.im + tm.im) / 2, 1e-12);
  assert.equal(rf.wavePolarisation({}, { tx: { antenna: { polarisation: 'lhcp' } } }), 'lhcp');
  assert.equal(rf.wavePolarisation({ environment: { polarisation: 'horizontal' } }, { tx: { antenna: {} } }), 'horizontal'); // legacy fallback only
});
