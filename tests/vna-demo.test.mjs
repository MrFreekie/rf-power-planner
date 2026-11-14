// VNA lab model: hand-computed anchors, bounded and monotonic properties, fault library, distance to fault, no NaN anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../js/model/vna-demo.js';
import { CHAIN_PRESETS } from '../js/model/chain-presets.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);
const sweep = (a = 100, b = 1000, n = 1001) => V.buildSweep({ startMHz: a, stopMHz: b, points: n });
const dB = (c) => V.magDb(c);
const finiteC = (c) => Number.isFinite(c.re) && Number.isFinite(c.im);
const CAL = { calibration: { state: 'good' } };

// ---------------------------------------------------------------- standard definitions (hand-computed)
test('VSWR 2:1 -> |gamma| = 1/3, return loss 9.54 dB (tolerance 0.005 dB)', () => {
  near(V.gammaMagFromVswr(2), 1 / 3, 1e-12);
  near(V.returnLossDbFromGamma(1 / 3), 9.5424, 0.005);          // 20 log10(3)
  near(V.vswrFromGamma(1 / 3), 2, 1e-12);
});
test('VSWR 5:1 -> mismatch loss 2.55 dB (-10 log10(1 - (2/3)^2) = 2.553, tolerance 0.005 dB)', () => {
  near(V.mismatchLossDbFromGamma(V.gammaMagFromVswr(5)), 2.5527, 0.005);
});
test('Gamma <-> Z round trip and anchors (25 ohm -> -1/3, 100 ohm -> +1/3, open, short)', () => {
  near(V.gammaFromZ({ re: 25, im: 0 }).re, -1 / 3, 1e-12);
  near(V.gammaFromZ({ re: 100, im: 0 }).re, 1 / 3, 1e-12);
  near(V.gammaFromZ({ re: 0, im: 0 }).re, -1, 1e-12);
  assert.equal(V.gammaFromZ({ re: Infinity, im: 0 }).re, 1);
  const z = V.zFromGamma(V.gammaFromZ({ re: 30, im: 40 }));
  near(z.re, 30, 1e-9); near(z.im, 40, 1e-9);
  assert.ok(Number.isFinite(V.zFromGamma({ re: 1, im: 0 }).re));
  const sp = V.smithPoint({ re: 0, im: 0 });
  near(sp.zNorm.re, 1, 1e-12); near(sp.zNorm.im, 0, 1e-12);
});
test('Matched load: S11 at the floor (-120 dB), no NaN', () => {
  const sw = sweep(100, 1000, 101);
  const r = V.measure({ sweep: sw, dut: { type: 'load' }, ...CAL });
  for (const g of r.s11) { assert.ok(V.cAbs(g) < 1e-9); assert.equal(dB(g), -120); assert.equal(V.returnLossDbFromGamma(g), 120); }
});
test('buildSweep clamps and orders; presets resolve', () => {
  const s = V.buildSweep({ startMHz: 1000, stopMHz: 100, points: 5 });
  assert.equal(s.startMHz, 100); assert.equal(s.fMHz.length, 5); near(s.fMHz[4], 1000, 1e-9);
  assert.equal(V.buildSweep({ points: 1e9 }).points, V.SWEEP_MAX_POINTS);
  assert.equal(V.buildSweep({ points: -3 }).points, V.SWEEP_MIN_POINTS);
  const e = V.buildSweep({ startMHz: 500, stopMHz: 500 });
  assert.ok(e.stopMHz > e.startMHz);
  const p = V.buildSweep({ preset: 'ism-2400' });
  assert.equal(p.startMHz, 2300);
  const nan = V.buildSweep({ startMHz: NaN, stopMHz: NaN, points: NaN });
  assert.ok(nan.fMHz.every(Number.isFinite));
});

// ---------------------------------------------------------------- cables
test('open cable: |S11| ripple period = c VF /(2 L) (1 m, VF 0.66: 98.94 MHz; tolerance 1.5 percent)', () => {
  const sw = sweep(100, 1000, 1001);
  const r = V.measure({ sweep: sw, dut: { type: 'cable', cableId: 'rg58', lengthM: 1, termination: 'open' }, ...CAL });
  const per = V.rippleSpacingMHz(sw.fMHz, r.s11.map(V.cAbs));
  const want = 299792458 * 0.66 / 2 / 1e6;
  near(per, want, want * 0.015);
  near(V.cableRipplePeriodMHz(1, 0.66), 98.9376, 0.01);
  near(V.cableLengthFromRippleMHz(want, 0.66), 1, 1e-9);
});
test('cable loss follows the library table (RG213, 10 m, 900 MHz = 2.40 dB; tolerance 0.01 dB) and rises monotonically with frequency', () => {
  near(-dB(V.lineSparams({ cableId: 'rg213', lengthM: 10 }, 900).s21), 2.40, 0.01);
  let prev = 0;
  for (let f = 100; f <= 3000; f += 50) { const l = -dB(V.lineSparams({ cableId: 'rg58', lengthM: 5 }, f).s21); assert.ok(l >= prev - 1e-9); prev = l; }
});
test('cable two-port group delay = L/(c VF) (10 m, VF 0.66: 50.5 ns; tolerance 3 percent)', () => {
  const sw = sweep(100, 1000, 201);
  const r = V.measure({ sweep: sw, dut: { type: 'cable', cableId: 'rg58', lengthM: 10 }, ...CAL });
  const tr = V.traceSet(r), mid = tr.groupDelayNs[100];
  near(mid, 10 / (299792458 * 0.66) * 1e9, 50.5 * 0.03);
});
test('DTF: a known kink at 7.3 m in a 15 m cable is located within 0.15 m; the far end appears near 15 m', () => {
  const sw = sweep(100, 1000, 1001);
  const dut = { type: 'cable', cableId: 'rg58', lengthM: 15, termination: 'load' };
  const r = V.measureWithFault({ sweep: sw, dut, ...CAL }, 'cable-kink', { posM: 7.3 });
  const t = V.distanceToFault(sw.fMHz, r.result.s11, { velocityFactor: 0.66, maxDistanceM: 30 });
  const tall = t.peaks.filter((p) => p.distanceM > 2 && p.distanceM < 14).sort((a, b) => b.magnitude - a.magnitude)[0];
  near(tall.distanceM, 7.3, 0.15);
  assert.ok(t.peaks.some((p) => Math.abs(p.distanceM - 15) < 0.2));
  near(t.resolutionM, 299792458 * 0.66 / 2 / 900e6, 1e-6);
});
test('DTF: a wrong velocity factor scales the distance (cable-poor-vf: true VF 0.55 read with 0.66 gives 1.2x)', () => {
  const sw = sweep(100, 1000, 1001);
  const dut = { type: 'cable', cableId: 'rg58', lengthM: 10, termination: 'open' };
  const r = V.measureWithFault({ sweep: sw, dut, ...CAL }, 'cable-poor-vf');
  const t = V.distanceToFault(sw.fMHz, r.result.s11, { velocityFactor: 0.66, maxDistanceM: 30 });
  const far = t.peaks.filter((p) => p.distanceM > 3).sort((a, b) => b.magnitude - a.magnitude)[0];
  near(far.distanceM, 12, 0.25);
});
test('cable faults: cut -> S21 collapses; short -> S11 near -1; water -> extra loss; high loss scales; no NaN', () => {
  const f = [600, 900];
  const dut = { type: 'cable', cableId: 'rg58', lengthM: 5 };
  const ideal = V.dutSparams(dut, f);
  const cut = V.faultySparams(dut, 'cable-cut-open', f);
  assert.ok(dB(cut.s21[0]) < -30);
  const sh = V.faultySparams(dut, 'cable-short', f);
  assert.ok(dB(sh.s21[0]) < -30);
  const wet = V.faultySparams(dut, 'cable-water', f);
  assert.ok(dB(ideal.s21[1]) - dB(wet.s21[1]) > 3, 'water extra loss at 900 MHz');
  const lossy = V.faultySparams(dut, 'cable-high-loss', f);
  near(-dB(lossy.s21[1]), -dB(ideal.s21[1]) * 2.5, 0.2);
  const fig = V.faultPlannerFigures(dut, 'cable-water', {}, 900);
  assert.ok(fig.extraCableLossDb > 3 && fig.flag === 'U');
});
test('terminations: 25 and 100 ohm give RL 9.54 dB flat; reactive load is worse at low frequency; open/short at the rim', () => {
  const sw = sweep(100, 1000, 21), dut = { type: 'chain', items: [] };
  for (const id of ['term-25', 'term-100']) {
    const r = V.measureWithFault({ sweep: sw, dut, ...CAL }, id).result;
    for (const g of r.s11) near(V.returnLossDbFromGamma(g), 9.5424, 0.01, id);
  }
  const rc = V.measureWithFault({ sweep: sw, dut, ...CAL }, 'term-reactive').result;
  assert.ok(V.cAbs(rc.s11[0]) > V.cAbs(rc.s11[20]));
  for (const id of ['term-open', 'term-short']) near(V.cAbs(V.measureWithFault({ sweep: sw, dut, ...CAL }, id).result.s11[3]), 1, 1e-9);
});

// ---------------------------------------------------------------- chain items
const s21At = (item, f = 600, opts) => dB(V.itemSparams(item, f, opts).s21);
test('pad S21 equals its attenuation exactly (10 dB pad -> -10.000 dB, S11 = 0)', () => {
  const s = V.itemSparams({ presetId: 'pad-10' }, 600);
  near(dB(s.s21), -10, 1e-9); assert.equal(V.cAbs(s.s11), 0);
  const r = V.measure({ sweep: sweep(100, 1000, 11), dut: { type: 'chain', items: [{ presetId: 'pad-6' }, { presetId: 'pad-3' }] }, ...CAL });
  for (const s of r.s21) near(dB(s), -9, 1e-9);
});
test('splitter S21 = -10 log10(N) - excess (4-way, 0 excess: -6.0206 dB; tolerance 1e-4); isolation path; coupler through and tap', () => {
  near(s21At({ kind: 'splitter', ports: 4, insertionLossDb: 0 }), -6.0206, 1e-4);
  near(s21At({ presetId: 'splitter-8' }), -(10 * Math.log10(8) + 1.5), 1e-9);
  near(s21At({ presetId: 'splitter-2' }, 600, { path: 'isolated' }), -25, 1e-9);
  near(s21At({ presetId: 'coupler-10' }), -(0.4576 + 0.1), 0.001);          // -10 log10(0.9) = 0.4576
  near(s21At({ presetId: 'coupler-20' }, 600, { path: 'coupled' }), -20.1, 1e-9);
});
test('booster gain, bias tee and DC block insertion loss', () => {
  near(s21At({ presetId: 'booster-12' }), 12, 1e-9);
  near(s21At({ presetId: 'biastee' }), -0.6, 0.01);
  assert.ok(s21At({ presetId: 'biastee' }, 0.2) < -3, 'low-frequency roll-off below the corner');
  near(s21At({ presetId: 'dcblock' }), -0.3, 0.01);
});
test('bandpass and notch filters: passband loss, stopband rejection, passivity, Chebyshev ripple', () => {
  const bp = { kind: 'filter', filterType: 'bandpass', centreMHz: 600, bandwidthMHz: 40, lossDb: 1.5, rejectionDb: 30, order: 3 };
  near(s21At(bp, 600), -1.5, 0.05);
  near(s21At(bp, 620), -1.5 - 2.76, 0.1, 'x = 0.98 at 620 MHz: 10log10(1/(1+0.98^6)) = -2.76 dB');
  assert.ok(s21At(bp, 300) < -28);
  const nt = { kind: 'filter', filterType: 'notch', centreMHz: 600, bandwidthMHz: 10, lossDb: 0.5, rejectionDb: 30 };
  assert.ok(s21At(nt, 600) < -28); near(s21At(nt, 300), -0.5, 0.2);
  for (let f = 100; f <= 1000; f += 7) for (const it of [bp, nt, { ...bp, response: 'chebyshev', order: 4, rippleDb: 0.5 }]) {
    const s = V.itemSparams(it, f); assert.ok(V.cAbs(s.s11) ** 2 + V.cAbs(s.s21) ** 2 <= 1 + 1e-9, `passive at ${f}`);
  }
  const cheb = { ...bp, response: 'chebyshev', order: 4, rippleDb: 0.5, lossDb: 0 };
  assert.ok(s21At(cheb, 600) > -0.51 && s21At(cheb, 600) <= 0.01);
  const sw = sweep(580, 620, 201), r = V.measure({ sweep: sw, dut: { type: 'chain', items: [bp] }, ...CAL });
  assert.ok(V.traceSet(r).groupDelayNs[100] > 5, 'a narrow filter has delay of several ns');
});
test('every non-active chain preset is passive across 100-1000 MHz; active ones have finite S21', () => {
  for (const id of Object.keys(CHAIN_PRESETS)) {
    for (let f = 100; f <= 1000; f += 100) {
      const s = V.itemSparams({ presetId: id }, f);
      for (const c of [s.s11, s.s12, s.s21, s.s22]) assert.ok(finiteC(c), id);
      if (!['booster', 'activesplitter', 'activecombiner'].includes(CHAIN_PRESETS[id].kind) && CHAIN_PRESETS[id].kind !== 'rof') {
        assert.ok(V.cAbs(s.s21) <= 1 + 1e-9 && V.cAbs(s.s11) <= 1 + 1e-9, id);
      }
    }
  }
});

// ---------------------------------------------------------------- antennas
test('antenna cut for 600 MHz: dip at 600, VSWR about 2:1 at the band edges, |S11| rises monotonically away from the dip', () => {
  const ant = { type: 'antenna', antennaType: 'quarterwave', centreMHz: 600, groundPlane: 'large' };
  const sw = sweep(500, 700, 401), r = V.measure({ sweep: sw, dut: ant, ...CAL });
  const mn = V.markerSearch(sw.fMHz, V.traceSet(r).s11Db, 'min');
  near(mn.fMHz, 600, 1.5);
  const at = (f) => V.markerReadout(r, f).s11.vswr;
  near(at(576), 2, 0.12); near(at(624), 2, 0.12);
  const mag = r.s11.map(V.cAbs), i0 = mn.index;
  for (let i = i0 + 1; i < mag.length; i++) assert.ok(mag[i] >= mag[i - 1] - 1e-12);
  for (let i = i0 - 1; i >= 0; i--) assert.ok(mag[i] >= mag[i + 1] - 1e-12);
  for (const g of r.s11) assert.ok(V.cAbs(g) <= 1);
  // phase: capacitive below the resonance, inductive above
  assert.ok(r.s11[10].im < 0 && r.s11[390].im > 0);
});
test('wrong-band antenna has no dip at the wanted frequency; wideband log-periodic is flat and shallow', () => {
  const wrong = V.antennaSparams({ antennaType: 'quarterwave', centreMHz: 2400 }, [600]).s11[0];
  assert.ok(V.vswrFromGamma(wrong) > 10);
  const lp = V.antennaSparams({ antennaType: 'logperiodic', centreMHz: 700 }, [500, 600, 700, 800, 900]).s11.map(V.vswrFromGamma);
  assert.ok(lp.every((v) => v < 2.2));
});
test('hand and wet handling: efficiency loss from the library figures, detune down, S11 magnitude lower (looks better)', () => {
  const f = [570, 585, 600, 615, 630];
  const free = V.antennaSparams({ antennaType: 'quarterwave', centreMHz: 600 }, f);
  const hand = V.antennaSparams({ antennaType: 'quarterwave', centreMHz: 600, contact: 'cupped', dampness: 'wet' }, f);
  near(hand.efficiencyDb, -11, 1e-9); assert.ok(hand.detuneFraction > 0.05);
  assert.ok(V.cAbs(hand.s11[0]) < V.cAbs(free.s11[0]));
  const gp = V.antennaSparams({ antennaType: 'quarterwave', centreMHz: 600, groundPlane: 'none' }, [600]);
  assert.ok(V.vswrFromGamma(gp.s11[0]) >= 1.75);
});
test('antenna faults: broken element moves the dip up; wrong length moves it; planner figures', () => {
  const ant = { type: 'antenna', antennaType: 'quarterwave', centreMHz: 600, groundPlane: 'large' };
  const sw = sweep(400, 900, 501);
  const dip = (id) => { const r = V.measureWithFault({ sweep: sw, dut: ant, ...CAL }, id).result; return V.markerSearch(sw.fMHz, V.traceSet(r).s11Db, 'min').fMHz; };
  assert.ok(dip('ant-broken-short') > 700);
  near(dip('ant-wrong-length'), 450, 8);
  const fig = V.faultPlannerFigures(ant, 'ant-broken-short', {}, 600);
  assert.ok(fig.antennaVswr > 3 && fig.antennaMismatchDb > 1);
  assert.ok(V.faultPlannerFigures(ant, 'ant-hand', {}, 600).antennaExtraLossDb >= 6);
});

// ---------------------------------------------------------------- calibration, port extension, markers
test('OSL: solving the three standards recovers the error terms and any Gamma exactly (1e-9)', () => {
  const f = 433, t = V.rawErrorTerms(f);
  const m = (g) => V.applyErrorTerms(g, t);
  const cal = V.solveOSL(m({ re: 1, im: 0 }), m({ re: -1, im: 0 }), m({ re: 0, im: 0 }));
  for (const k of ['e00', 'e11', 'e10e01']) { near(cal[k].re, t[k].re, 1e-9); near(cal[k].im, t[k].im, 1e-9); }
  const g = { re: 0.3, im: -0.2 }, back = V.correctGamma(m(g), cal);
  near(back.re, g.re, 1e-9); near(back.im, g.im, 1e-9);
});
test('uncalibrated: a matched load reads only 30-45 dB return loss and an open is rotated; calibrated is exact', () => {
  const sw = sweep(100, 1000, 101);
  const raw = V.measure({ sweep: sw, dut: { type: 'load' }, calibration: { state: 'none' } });
  assert.ok(raw.s11.every((g) => { const rl = V.returnLossDbFromGamma(g); return rl > 20 && rl < 50; }));
  const rawOpen = V.measure({ sweep: sw, dut: { type: 'open' }, calibration: { state: 'none' } });
  assert.ok(Math.abs(V.phaseDeg(rawOpen.s11[100])) > 1 || V.phaseDeg(rawOpen.s11[50]) !== 0);
  const good = V.measure({ sweep: sw, dut: { type: 'open' }, ...CAL });
  for (const g of good.s11) { near(g.re, 1, 1e-9); near(g.im, 0, 1e-9); }
});
test('extra cable after calibration adds phase rotation (open + 2 m RG58: S11 delay 2L/(c VF) one way about 10.1 ns, tolerance 5 percent)', () => {
  const sw = sweep(100, 1000, 201);
  const r = V.measure({ sweep: sw, dut: { type: 'open' }, calibration: { state: 'extraCable', extraCable: { cableId: 'rg58', lengthM: 2 } } });
  const d = V.traceSet(r).s11GroupDelayNs[100], want = 2 / (299792458 * 0.66) * 1e9;
  near(d, want, want * 0.05);
  // port extension by that delay brings the delay back to about zero
  const ext = V.measure({ sweep: sw, dut: { type: 'open' }, portExtensionNs: want, calibration: { state: 'extraCable', extraCable: { cableId: 'rg58', lengthM: 2 } } });
  assert.ok(Math.abs(V.traceSet(ext).s11GroupDelayNs[100]) < 0.1 * want);
  const rm = V.measure({ sweep: sw, dut: { type: 'open' }, calibration: { state: 'cableAtCal', extraCable: { cableId: 'rg58', lengthM: 2 } } });
  assert.ok(V.traceSet(rm).s11GroupDelayNs[100] < -0.8 * want, 'cable removed after cal: opposite sign');
});
test('markers: interpolation, clamping, min/max search with window', () => {
  const f = [100, 200, 300], v = [0, 10, 0];
  near(V.interpAt(f, v, 150), 5, 1e-12); assert.equal(V.interpAt(f, v, 50), 0); assert.equal(V.interpAt(f, v, 999), 0);
  assert.equal(V.markerSearch(f, v, 'max').fMHz, 200);
  assert.equal(V.markerSearch(f, v, 'min', { loMHz: 150 }).fMHz, 300);
  assert.equal(V.markerSearch(f, v, 'min', { loMHz: 400 }), null);
  const r = V.measure({ sweep: sweep(100, 1000, 11), dut: { type: 'chain', items: [{ presetId: 'pad-10' }] }, ...CAL });
  const m = V.markerReadout(r, 550);
  near(m.s21.db, -10, 1e-9); assert.equal(V.MAX_MARKERS, 4);
});
test('group delay of an ideal delay line (30 ns) is 30 ns; unwrap handles several turns', () => {
  const f = Array.from({ length: 101 }, (_, i) => 100 + i * 9), tau = 30e-9;
  const s = f.map((x) => V.polar(1, -2 * Math.PI * x * 1e6 * tau));
  const gd = V.groupDelayNs(f, s);
  for (const g of gd) near(g, 30, 0.01);
  near(V.maxUnambiguousDelayNs(9), 55.56, 0.01);
});

// ---------------------------------------------------------------- fault library
test('fault catalogue: every fault has id, label, cause, symptom, cure and a flag; unknown and mismatched faults are reported', () => {
  assert.ok(V.FAULT_IDS.length >= 35);
  for (const id of V.FAULT_IDS) {
    const f = V.FAULTS[id];
    assert.equal(f.id, id);
    for (const k of ['label', 'cause', 'symptom', 'cure', 'link']) assert.ok(typeof f[k] === 'string' && f[k].length >= 8, `${id}.${k}`);
    assert.equal(f.flag, 'U');
  }
  assert.equal(V.applyFault({ dut: { type: 'antenna' } }, 'nope').applicable, false);
  assert.equal(V.applyFault({ dut: { type: 'antenna' } }, 'cable-kink').applicable, false);
  assert.ok(V.faultsFor({ type: 'antenna' }).includes('ant-hand'));
  assert.ok(!V.faultsFor({ type: 'antenna' }).includes('cable-kink'));
  assert.ok(V.faultsFor({ type: 'cable' }).includes('meas-no-cal'));
});
test('filter, splitter, bias tee and booster faults act as described', () => {
  const bp = { kind: 'filter', filterType: 'bandpass', centreMHz: 600, bandwidthMHz: 40, lossDb: 1.5, rejectionDb: 30 };
  const dutF = { type: 'chain', items: [bp] };
  const g = (id, f, dut = dutF, p) => dB(V.faultySparams(dut, id, [f], p).s21[0]);
  const base = dB(V.dutSparams(dutF, [600]).s21[0]);
  assert.ok(g('filter-shifted', 600) < base - 3);
  near(g('filter-high-loss', 600), base - 4, 0.1);
  assert.ok(g('filter-poor-rejection', 300) > dB(V.dutSparams(dutF, [300]).s21[0]) + 10);
  const dutS = { type: 'chain', items: [{ presetId: 'splitter-4' }] };
  assert.ok(V.returnLossDbFromGamma(V.faultySparams(dutS, 'splitter-unterminated', [600]).s11[0]) < 9);
  assert.ok(g('splitter-port-short', 600, dutS) < -30 && g('splitter-port-open', 600, dutS) < -30);
  const dutB = { type: 'chain', items: [{ presetId: 'booster-12' }] };
  near(g('booster-low-gain', 600, dutB), 4, 0.01);
  assert.ok(g('booster-tilt', 900, dutB) < 12 - 3 && g('booster-tilt', 300, dutB) > 12 + 3);
  const osc = V.faultySparams(dutB, 'booster-oscillation', [600]);
  assert.ok(V.cAbs(osc.s11[0]) > 1 && dB(osc.s21[0]) > 20);
  const bt = V.applyFault({ dut: { type: 'chain', items: [{ presetId: 'biastee' }] } }, 'biastee-dc-short');
  assert.ok(bt.applicable && bt.warnings.length === 1);
  assert.ok(V.vnaCautions({ type: 'chain', items: [{ presetId: 'biastee' }] }).some((c) => c.level === 'danger'));
});
test('measurement faults change the calibration, sweep or add a DC warning', () => {
  const cfg = { sweep: { startMHz: 400, stopMHz: 700 }, dut: { type: 'load' } };
  assert.equal(V.applyFault(cfg, 'meas-no-cal').cfg.calibration.state, 'none');
  assert.equal(V.applyFault(cfg, 'meas-wrong-plane', { lengthM: 3 }).cfg.calibration.extraCable.lengthM, 3);
  assert.equal(V.applyFault(cfg, 'meas-sweep-mismatch').cfg.sweep.startMHz, 1600);
  assert.ok(V.applyFault(cfg, 'meas-dc-live').warnings[0].includes('DC'));
  assert.equal(cfg.sweep.startMHz, 400, 'input cfg not mutated');
});
test('cautions and explanations', () => {
  assert.ok(V.vnaCautions({ type: 'antenna' }).length >= 4);
  assert.ok(V.vnaCautions({ type: 'chain', items: [{ presetId: 'booster-12' }, { presetId: 'booster-12' }, { presetId: 'booster-12' }] }).some((c) => c.text.includes('dBm into VNA')));
  assert.equal(V.explainTrace('rl', 20).verdict, 'good'); assert.equal(V.explainTrace('vswr', 2).verdict, 'ok'); assert.equal(V.explainTrace('rl', 3).verdict, 'poor');
});

// ---------------------------------------------------------------- no NaN anywhere
test('no NaN or Infinity across devices, faults, calibration states and sweeps', () => {
  const duts = [
    { type: 'antenna', antennaType: 'quarterwave', centreMHz: 600 }, { type: 'antenna', antennaType: 'helical', centreMHz: 2400, contact: 'skin' },
    { type: 'cable', cableId: 'lmr-400', lengthM: 20 }, { type: 'cable', cableId: 'rg174', lengthM: 3, termination: 'open' }, { type: 'cable', cableId: 'rg58', lengthM: 1, termination: 'short' },
    { type: 'chain', items: [{ presetId: 'filter-bandpass' }, { presetId: 'splitter-4' }, { presetId: 'booster-12' }, { presetId: 'biastee' }] },
    { type: 'chain', items: [{ presetId: 'coupler-10' }, { presetId: 'filter-notch' }, { presetId: 'active-splitter-4' }, { presetId: 'dcblock' }], termination: 'open' },
    { type: 'load' }, { type: 'open' }, { type: 'short' },
  ];
  const sweeps = [{ preset: 'default' }, { preset: 'ism-2400' }, { startMHz: 0.05, stopMHz: 6000, points: 3 }, { startMHz: 600, stopMHz: 600, points: 11 }];
  const states = V.CAL_STATES;
  let n = 0;
  for (const dut of duts) for (const sw of sweeps) for (const st of states) {
    const r = V.measure({ sweep: sw, dut, calibration: { state: st, extraCable: { cableId: 'rg58', lengthM: 1 } }, portExtensionNs: 2 });
    const t = V.traceSet(r);
    for (const g of r.s11) assert.ok(finiteC(g));
    if (r.s21) for (const g of r.s21) assert.ok(finiteC(g));
    for (const k of ['s11Db', 'rlDb', 'vswr', 's11PhaseDeg', 'mismatchDb', 's11GroupDelayNs', 's21Db']) if (t[k]) for (const v of t[k]) assert.ok(Number.isFinite(v), k);
    for (const p of t.smith) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.zOhm.re));
    if (t.groupDelayNs) for (const v of t.groupDelayNs) assert.ok(Number.isFinite(v));
    n++;
  }
  assert.ok(n > 100);
});
test('every fault on every applicable device stays finite', () => {
  const duts = [
    { type: 'antenna', antennaType: 'quarterwave', centreMHz: 600 }, { type: 'cable', cableId: 'rg58', lengthM: 5 }, { type: 'cable', cableId: 'rg58', lengthM: 5, termination: 'load' },
    { type: 'chain', items: [{ presetId: 'filter-bandpass' }, { presetId: 'splitter-2' }, { presetId: 'booster-12' }, { presetId: 'biastee' }] },
  ];
  const sw = V.buildSweep({ startMHz: 100, stopMHz: 1000, points: 101 });
  let applied = 0;
  for (const dut of duts) for (const id of V.FAULT_IDS) {
    const r = V.measureWithFault({ sweep: sw, dut, calibration: { state: 'good' } }, id);
    if (!r.applicable) continue;
    applied++;
    for (const g of r.result.s11) assert.ok(finiteC(g), `${id} s11`);
    if (r.result.s21) for (const g of r.result.s21) assert.ok(finiteC(g), `${id} s21`);
    const t = V.distanceToFault(r.result.fMHz, r.result.s11, { points: 51 });
    assert.ok(t.magnitude.every(Number.isFinite), id);
  }
  assert.ok(applied > 60);
});
