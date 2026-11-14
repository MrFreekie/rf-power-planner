// Group (i): antenna design band, VSWR, return loss, mismatch loss, Tx reflected power, filter band, six examples.
import test from 'node:test';
import assert from 'node:assert/strict';
import { antennaMatch, vswrThroughLoss, returnLossSweep, MAX_MISMATCH_DB, MIN_FRACTIONAL_BW } from '../js/model/antenna-band.js';
import { solveLink, filterStopbandExtraDb } from '../js/model/rf.js';
import { bandScene, EXAMPLES, getExample } from '../js/examples.js';
import { createDefaultScene, validateScene } from '../js/model/scene.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);
const f1 = (x) => x.toFixed(1), f2 = (x) => x.toFixed(2);
const band = (lo, hi, extra = {}) => ({ designBand: { loMHz: lo, hiMHz: hi, ...extra } });

test('no designBand: matched, zero loss, existing scenes unchanged', () => {
  const m = antennaMatch({ type: 'omni' }, 600);
  assert.deepEqual([m.matched, m.vswr, m.mismatchDb, m.inBand], [true, 1, 0, true]);
  const s = createDefaultScene();
  assert.equal(solveLink(s, s.links[0]).antennaMismatch, null);
});

test('hand values: VSWR 2:1 at both band edges (RL 9.54 dB, ML 0.5115 dB), VSWR 1 at the centre', () => {
  const a = band(500, 600); // fractional width 18 percent, above the minimum
  for (const f of [500, 600]) {
    const m = antennaMatch(a, f);
    near(m.vswr, 2, 1e-9); near(m.returnLossDb, 20 * Math.log10(3), 1e-9); near(m.mismatchDb, -10 * Math.log10(8 / 9), 1e-9); assert.equal(m.inBand, true);
  }
  near(antennaMatch(a, Math.sqrt(500 * 600)).vswr, 1, 1e-9);
  assert.equal(antennaMatch(a, 450).inBand, false);
});

test('mismatch loss from VSWR anchors: 1.5 = 0.177 dB, 3 = 1.249 dB (minVswr floor), and 5:1 = 2.553 dB (not 3 dB: 3.01 dB is VSWR 5.83)', () => {
  near(antennaMatch(band(500, 600, { minVswr: 1.5 }), Math.sqrt(500 * 600)).mismatchDb, 0.1773, 1e-3);
  near(antennaMatch(band(500, 600, { minVswr: 3 }), Math.sqrt(500 * 600)).mismatchDb, 1.2494, 1e-3);
  const g = 4 / 6; near(-10 * Math.log10(1 - g * g), 2.5527, 1e-3);
});

test('far out of band the loss is capped at 30 dB; a wideband (order 3) antenna is flatter inside and steeper outside than a whip', () => {
  assert.equal(antennaMatch(band(500, 600), 5000).mismatchDb <= MAX_MISMATCH_DB + 1e-9, true);
  near(antennaMatch(band(500, 600), 10).mismatchDb, MAX_MISMATCH_DB, 1e-9);
  const narrow = band(470, 960), wide = band(470, 960, { order: 3 });
  const f = 560; // inside both, off centre
  assert.ok(antennaMatch(wide, f).mismatchDb < antennaMatch(narrow, f).mismatchDb);
  assert.ok(antennaMatch(wide, 300).mismatchDb > antennaMatch(narrow, 300).mismatchDb);
});

test('a channel-width band label is widened to the minimum fractional width (8 percent): 863-865 whip at 606 MHz is finite and not 3998:1', () => {
  assert.equal(MIN_FRACTIONAL_BW, 0.08);
  const m = antennaMatch({ designBand: 'srd-863-865' }, 864);
  near(m.vswr, 2 ** 0, 0.01); // at the centre of the channel
  const out = antennaMatch({ designBand: 'srd-863-865' }, 606.1);
  assert.ok(out.vswr > 30 && out.vswr < 60 && out.mismatchDb > 9 && out.mismatchDb < 12, `${out.vswr} ${out.mismatchDb}`);
});

test('solveLink: the mismatch step equals -ML, the margin drops by exactly ML, warning when out of band', () => {
  const ok = bandScene('whip-wrong-band', { right: true }), bad = bandScene('whip-wrong-band');
  const a = solveLink(ok, ok.links[0]), b = solveLink(bad, bad.links[0]);
  const ml = antennaMatch(bad.links[0].rx.antenna, 830).mismatchDb;
  const step = b.waterfall.find((w) => /^Rx antenna mismatch/.test(w.label));
  near(step.deltaDb, -ml, 1e-12);
  near(a.rxPowerDbm - b.rxPowerDbm, ml, 0.01); // identical geometry, the in-band whip loses ~0
  assert.ok(b.warnings.some((w) => /cut for UHF band A/.test(w)));
  assert.equal(a.warnings.some((w) => /cut for/.test(w)), false);
});

test('Tx reflected power: PA warning without protection, silent with a 20 dB isolator, between with a 6 dB pad; hand check of the reflected level', () => {
  const g = (x) => solveLink(x, x.links[0]);
  const none = bandScene('iem-tx-wrong-band'), iso = bandScene('iem-tx-wrong-band', { isolator: true }), pad = bandScene('iem-tx-wrong-band', { pad: true });
  const m = antennaMatch(none.links[0].tx.antenna, 606.1);
  const r0 = g(none).antennaMismatch.tx;
  near(r0.reflectedAtPaDbm, 20 + 10 * Math.log10(m.gammaSq), 1e-9);
  assert.ok(g(none).warnings.some((w) => /Reflected power/.test(w)));
  assert.equal(g(iso).warnings.some((w) => /Reflected power/.test(w)), false);
  // isolator: reverse 20 dB (power) -> amplitude 10^(-20/20) = 0.1 on gamma
  const gam = Math.sqrt(m.gammaSq);
  near(g(iso).antennaMismatch.tx.vswrAtPa, (1 + 0.1 * gam) / (1 - 0.1 * gam), 1e-9);
  near(g(iso).antennaMismatch.tx.reflectedAtPaDbm, 20 - 0.5 + 10 * Math.log10(m.gammaSq) - 20, 1e-9);
  // 6 dB pad: round trip 12 dB -> amplitude 10^(-12/20)
  near(g(pad).antennaMismatch.tx.vswrAtPa, vswrThroughLoss(m.vswr, 6), 1e-9);
  assert.ok(g(pad).antennaMismatch.tx.vswrAtPa < r0.vswrAtPa && g(pad).antennaMismatch.tx.vswrAtPa > g(iso).antennaMismatch.tx.vswrAtPa);
});

test('filter passband: out-of-band adds the rejection (default 40 dB), notch inverts, no passband = unchanged', () => {
  const bp = { kind: 'filter', lossDb: 1.5, passLoMHz: 863, passHiMHz: 865 };
  assert.equal(filterStopbandExtraDb(bp, 606), 40);
  assert.equal(filterStopbandExtraDb(bp, 864), 0);
  assert.equal(filterStopbandExtraDb({ ...bp, rejectionDb: 25 }, 606), 25);
  assert.equal(filterStopbandExtraDb({ ...bp, filterType: 'notch' }, 864), 40);
  assert.equal(filterStopbandExtraDb({ kind: 'filter', lossDb: 1 }, 606), 0);
});

test('return-loss sweep: minimum VSWR at the centre, symmetric on a log-frequency axis, n limited', () => {
  const a = band(500, 600);
  const sw = returnLossSweep(a, 450, 650, 201);
  assert.equal(sw.length, 201);
  const best = sw.reduce((w, p) => (p.vswr < w.vswr ? p : w));
  near(best.fMHz, Math.sqrt(500 * 600), 1.1);
  assert.equal(returnLossSweep(a, 1, 2, 99999).length, 2001);
});

test('the six examples validate, solve, and their notes quote the model', () => {
  const ids = ['band-whip-wrong-band', 'band-uhf-vs-2g4', 'band-iem-tx-wrong-antenna', 'band-wideband-vs-whips', 'band-whip-trim', 'band-filter-wrong-band'];
  for (const id of ids) {
    const e = getExample(id); assert.ok(e, id);
    assert.equal(validateScene(e.build().scene).ok, true, id);
  }
  const note = (id) => EXAMPLES.find((e) => e.id === id).note;
  const mm = (name, o) => { const sc = bandScene(name, o); const l = sc.links[0]; return { sc, l, r: solveLink(sc, l), tx: antennaMatch(l.tx.antenna, l.freqMHz), rx: antennaMatch(l.rx.antenna, l.freqMHz) }; };
  const has = (id, ...v) => v.forEach((x) => assert.ok(note(id).includes(x), `${id}: ${x}`));
  const w = mm('whip-wrong-band'), wr = mm('whip-wrong-band', { right: true });
  has('band-whip-wrong-band', f1(w.rx.vswr), f1(w.rx.mismatchDb), f1(Math.pow(10, w.rx.mismatchDb / 20)), f1(wr.rx.mismatchDb));
  const u = mm('uhf-vs-2g4'), ur = mm('uhf-vs-2g4', { reverse: true });
  has('band-uhf-vs-2g4', f1(u.rx.vswr), f1(u.rx.mismatchDb), f1(ur.rx.mismatchDb), f1(ur.rx.vswr));
  const i0 = mm('iem-tx-wrong-band'), ii = mm('iem-tx-wrong-band', { isolator: true }), ip = mm('iem-tx-wrong-band', { pad: true });
  has('band-iem-tx-wrong-antenna', f1(i0.tx.vswr), f1(i0.tx.mismatchDb), (100 * i0.tx.gammaSq).toFixed(0), f1(i0.r.antennaMismatch.tx.reflectedAtPaDbm), f1(ip.r.antennaMismatch.tx.reflectedAtPaDbm),
    f1(ip.r.antennaMismatch.tx.vswrAtPa), f1(ii.r.antennaMismatch.tx.vswrAtPa), f1(ii.r.antennaMismatch.tx.reflectedAtPaDbm));
  const wd = mm('wideband-vs-whips');
  has('band-wideband-vs-whips', f2(wd.rx.mismatchDb), f1(w.rx.mismatchDb), f1(wd.rx.vswr));
  const t0 = mm('whip-trim'), t1 = mm('whip-trim', { trimmed: true });
  has('band-whip-trim', f2(t0.rx.vswr), f2(t0.rx.mismatchDb), f1(t1.rx.vswr), f2(t1.rx.mismatchDb));
  const fw = mm('filter-wrong-band'), fr = mm('filter-wrong-band', { right: true });
  has('band-filter-wrong-band', f1(fw.r.rxPowerDbm), f1(fr.r.rxPowerDbm), f1(fw.r.marginDb), f1(fr.r.marginDb));
  assert.ok(fw.r.warnings.some((x) => /rejects this channel/.test(x)));
  for (const id of ids) assert.ok(note(id).split('. ').length <= 4, id);
});

test('scene validation of designBand and filter passband', () => {
  const s = createDefaultScene();
  s.links[0].rx.antenna.designBand = 'uhf-470-520';
  assert.equal(validateScene(s).ok, true, validateScene(s).errors.join(';'));
  s.links[0].rx.antenna.designBand = { loMHz: 470, hiMHz: 520, order: 3, minVswr: 1.3 };
  assert.equal(validateScene(s).ok, true);
  for (const bad of ['nope', { loMHz: 600, hiMHz: 500 }, { loMHz: 1, hiMHz: 2, order: 2 }, { loMHz: 1, hiMHz: 2, minVswr: 0.5 }, 5, { loMHz: NaN, hiMHz: 2 }]) {
    const t = structuredClone(s); t.links[0].rx.antenna.designBand = bad; assert.equal(validateScene(t).ok, false, JSON.stringify(bad));
  }
});
