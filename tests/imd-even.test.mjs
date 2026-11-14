// Even-order intermodulation (item 23): product list, level laws, filters, landing, radiated harmonics, validation, examples.
// IIP2 / IIP4 / harmonic levels are assumed planning numbers (flag U).
import test from 'node:test';
import assert from 'node:assert/strict';
import { evenOrderFrequencies, evenOrderProducts, radiatedHarmonics, IIP2_PRESETS, DEFAULT_IIP2_DBM } from '../js/model/imd-even.js';
import { evenOrderImd, imdSummary, noiseFloor } from '../js/model/imd.js';
import { createDefaultScene, validateScene } from '../js/model/scene.js';
import { evenScene, EXAMPLES } from '../js/examples.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);
const f1 = (x) => x.toFixed(1);
const find = (list, label) => list.find((p) => p.label === label);

test('product list for two tones: order 2 = f1+f2, f2-f1, 2f1, 2f2; order 4 adds 2f1+2f2, 2f2-2f1, 3f1-f2, 3f2-f1, 4f1, 4f2', () => {
  const p = evenOrderFrequencies([500, 700]);
  const f = (order) => p.filter((x) => x.order === order).map((x) => x.fMHz).sort((a, b) => a - b);
  assert.deepEqual(f(2), [200, 1000, 1200, 1400]);
  assert.deepEqual(f(4), [400, 800, 1600, 2000, 2400, 2800]);
  assert.equal(p.length, 4 + 6);
  assert.deepEqual(evenOrderFrequencies([600], [2]).map((x) => x.fMHz), [1200]);
});

test('hand values: equal -20 dBm tones, IIP2 +30: f1+f2 = f2-f1 = -70 dBm (2 Pin - IIP2); second harmonic 6 dB lower; 2:1 slope', () => {
  const tones = [{ freqMHz: 500, levelDbm: -20 }, { freqMHz: 700, levelDbm: -20 }];
  const p = evenOrderProducts(tones, { iip2Dbm: 30, orders: [2] });
  near(find(p, 'f1+f2').levelDbm, -70, 1e-9); near(find(p, 'f2-f1').levelDbm, -70, 1e-9);
  near(find(p, '2f1').levelDbm, -76.02, 0.01);
  const up = evenOrderProducts(tones.map((t) => ({ ...t, levelDbm: t.levelDbm + 10 })), { iip2Dbm: 30, orders: [2] });
  near(find(up, 'f1+f2').levelDbm - find(p, 'f1+f2').levelDbm, 20, 1e-9); // 2 dB per dB
  const hi = evenOrderProducts(tones, { iip2Dbm: 40, orders: [2] });
  near(find(p, 'f1+f2').levelDbm - find(hi, 'f1+f2').levelDbm, 10, 1e-9);
});

test('fourth order: 2f1+2f2 with -20 dBm tones and IIP4 = IIP2 + 15 = 45: 4 x -20 - 3 x 45 = -215 dBm', () => {
  const p = evenOrderProducts([{ freqMHz: 500, levelDbm: -20 }, { freqMHz: 700, levelDbm: -20 }], { iip2Dbm: 30, orders: [4] });
  near(find(p, '2f1+2f2').levelDbm, -215, 1e-9);
  near(evenOrderProducts([{ freqMHz: 500, levelDbm: -20 }, { freqMHz: 700, levelDbm: -20 }], { iip2Dbm: 30, iip4Dbm: 60, orders: [4] }).find((x) => x.label === '2f1+2f2').levelDbm, -260, 1e-9);
});

test('landing and severity: wanted channel critical, a named band warning, near DC warning, floor makes weak ones harmless', () => {
  const tones = [{ freqMHz: 190, levelDbm: -20 }, { freqMHz: 475, levelDbm: -20 }];
  const p = evenOrderProducts(tones, { iip2Dbm: 30, orders: [2], wanted: { freqMHz: 665, bwKHz: 200 }, bands: [{ name: 'VHF', loMHz: 174, hiMHz: 216 }], noiseFloorDbm: -113 });
  const s = find(p, 'f1+f2');
  assert.equal(s.fMHz, 665); assert.equal(s.landsIn, 'wanted channel'); assert.equal(s.severity, 'critical');
  assert.equal(find(p, 'f2-f1').landsIn, null);
  const close = evenOrderProducts([{ freqMHz: 600, levelDbm: -20 }, { freqMHz: 602, levelDbm: -20 }], { orders: [2] });
  assert.equal(find(close, 'f2-f1').landsIn, 'near DC'); assert.equal(find(close, 'f2-f1').severity, 'warning');
  const weak = evenOrderProducts([{ freqMHz: 600, levelDbm: -80 }, { freqMHz: 700, levelDbm: -80 }], { orders: [2], wanted: { freqMHz: 1300, bwKHz: 200 }, noiseFloorDbm: -113 });
  assert.equal(find(weak, 'f1+f2').severity, 'harmless'); assert.equal(find(weak, 'f1+f2').landsIn, 'wanted channel');
});

test('filters: filterBefore cuts out-of-band tones (a product loses the rejection once per tone term), filterAfter cuts products out of band', () => {
  const tones = [{ freqMHz: 190, levelDbm: -20 }, { freqMHz: 475, levelDbm: -20 }];
  const base = find(evenOrderProducts(tones, { orders: [2] }), 'f1+f2').levelDbm;
  const before = find(evenOrderProducts(tones, { orders: [2], filterBefore: { passLoMHz: 470, passHiMHz: 698, rejectionDb: 60 } }), 'f1+f2').levelDbm;
  near(base - before, 60, 1e-9); // only the VHF tone is removed: -60 dB
  const after = find(evenOrderProducts(tones, { orders: [2], filterAfter: { passLoMHz: 470, passHiMHz: 698 } }), 'f2-f1');
  near(after.filteredDb, 40, 0); // default rejection 40 dB; 285 MHz is outside
  assert.equal(find(evenOrderProducts(tones, { orders: [2], filterAfter: { passLoMHz: 470, passHiMHz: 698 } }), 'f1+f2').filteredDb, 0); // 665 MHz inside
});

test('radiated second harmonic: carrier - 50 dBc - 6.02 dB (twice the frequency in free space); a 60 dB low-pass removes 60 dB more', () => {
  const [h] = radiatedHarmonics([{ freqMHz: 902, carrierDbm: -18 }], { bands: [{ name: 'IEM 1.8 GHz', loMHz: 1785, hiMHz: 1805 }] });
  near(h.levelDbm, -18 - 50 - 6.0206, 1e-3); assert.equal(h.fMHz, 1804); assert.equal(h.landsIn, 'IEM 1.8 GHz'); assert.equal(h.severity, 'warning');
  near(radiatedHarmonics([{ freqMHz: 902, carrierDbm: -18, filterDb: 60 }])[0].levelDbm, h.levelDbm - 60, 1e-9);
});

test('presets are flagged assumed; defaults documented', () => {
  for (const p of Object.values(IIP2_PRESETS)) assert.equal(p.flag, 'U');
  assert.equal(DEFAULT_IIP2_DBM, 30);
  assert.ok(IIP2_PRESETS['direct-conversion'].iip2Dbm < IIP2_PRESETS['wideband-booster'].iip2Dbm);
});

test('scene integration: imd even products use the tone levels at the antenna, imdSummary reports the counts, validation bounds the new fields', () => {
  const s = evenScene('wideband'), e = evenOrderImd(s), sm = imdSummary(s);
  const lv = sm.perTx.map((t) => t.levelAtRxDbm - 12); // booster +12 dB: antenna terminal levels
  near(find(e.products, 'f1+f2').levelDbm, lv[0] + lv[1] - 30, 1e-6);
  near(find(e.products, 'f1+f2').aboveFloorDb, find(e.products, 'f1+f2').levelDbm - noiseFloor(s).thermalDbm, 1e-9);
  assert.equal(e.inBandCount, 0); assert.equal(e.bandHitCount, 1);
  assert.equal(sm.evenBandHitCount, 1); assert.equal(sm.evenInBandCount, 0); near(sm.worstEvenProductDbm, e.worst.levelDbm, 1e-9);
  const d = createDefaultScene(); assert.equal(evenOrderImd(d).products.length, 0);
  const mk = (patch) => { const t = evenScene('wideband'); Object.assign(t.imd, patch); return validateScene(t); };
  assert.equal(mk({}).ok, true);
  for (const bad of [{ iip2Dbm: 1e6 }, { bands: [{ name: 'x', loMHz: 5, hiMHz: 1 }] }, { bands: 'all' }, { filterAfter: { passLoMHz: 10 } }, { filterBefore: { passLoMHz: 1, passHiMHz: 2, rejectionDb: -5 } }]) assert.equal(mk(bad).ok, false, JSON.stringify(bad));
  const t = evenScene('wideband'); t.imd.transmitters[0].h2Dbc = -3; assert.equal(validateScene(t).ok, false);
});

test('the four even-order examples: with and without the fix, and the notes quote the model', () => {
  const note = (id) => EXAMPLES.find((x) => x.id === id).note;
  const rep = (id, fixed) => { const s = evenScene(id, { fixed }); return { s, e: evenOrderImd(s) }; };
  const w = rep('wideband', false), wf = rep('wideband', true);
  assert.equal(w.e.bandHitCount, 1); assert.equal(wf.e.bandHitCount, 0);
  for (const v of [f1(find(w.e.products, 'f1+f2').levelDbm), f1(find(w.e.products, 'f1+f2').aboveFloorDb), f1(find(wf.e.products, 'f1+f2').levelDbm), f1(-find(wf.e.products, 'f1+f2').aboveFloorDb)]) assert.ok(note('even-wideband-booster').includes(v), v);
  const v = rep('vhf-uhf', false), vf = rep('vhf-uhf', true);
  assert.equal(find(v.e.products, 'f1+f2').landsIn, 'wanted channel'); assert.equal(find(v.e.products, 'f1+f2').severity, 'critical'); assert.equal(find(vf.e.products, 'f1+f2').severity, 'harmless');
  for (const x of [f1(find(v.e.products, 'f1+f2').levelDbm), f1(find(v.e.products, 'f1+f2').aboveFloorDb), f1(find(vf.e.products, 'f1+f2').levelDbm)]) assert.ok(note('even-vhf-uhf-booster').includes(x), x);
  const h = rep('harmonic', false), hf = rep('harmonic', true);
  assert.equal(h.e.harmonics[0].severity, 'warning'); assert.equal(hf.e.harmonics[0].severity, 'harmless');
  for (const x of [f1(h.e.harmonics[0].levelDbm), f1(h.e.harmonics[0].aboveFloorDb), f1(hf.e.harmonics[0].levelDbm), f1(-hf.e.harmonics[0].aboveFloorDb)]) assert.ok(note('even-second-harmonic').includes(x), x);
  const n = rep('narrow-uhf', false), sm = imdSummary(n.s);
  assert.equal(n.e.inBandCount + n.e.bandHitCount, 0);
  for (const x of [f1(find(n.e.products, 'f1+f2').levelDbm), f1(sm.worstProduct.levelDbm)]) assert.ok(note('even-narrow-uhf-good').includes(x), x);
  for (const id of ['even-wideband-booster', 'even-vhf-uhf-booster', 'even-second-harmonic', 'even-narrow-uhf-good']) {
    assert.ok(note(id).split('. ').length <= 4, id);
    assert.equal(validateScene(EXAMPLES.find((x) => x.id === id).build().scene).ok, true);
  }
});
