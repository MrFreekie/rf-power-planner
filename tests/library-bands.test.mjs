// Sanity and monotonicity tests for the VHF / 2.4 GHz / 5.8 GHz library extension (planning data, not hand-measured).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CABLES, ANTENNAS, BANDS, MATERIALS, SURFACES, cableDbPer100m, shortStubGainDbi, ANTENNA_VARIANTS, antennaVariantsFor,
  BODY_SHADOW_DB, bodyShadowDb, WALL_LOSS_BY_FREQ, wallLossDb, slabTransmissionLossDb, materialAt, surfaceAt,
  BAND_PROFILES, INTERFERENCE_MODEL, interferenceRiseDb,
} from '../js/model/library.js';

test('cable tables cover 100 MHz to 6 GHz and have smooth log-log slopes (no kinks)', () => {
  for (const [id, c] of Object.entries(CABLES)) {
    const t = c.attenDbPer100m;
    assert.equal(t[0][0], 100, id);
    assert.equal(t[t.length - 1][0], 6000, id);
    for (const f of [2400, 3500, 5000, 5800]) assert.ok(t.some((p) => p[0] === f), `${id} ${f}`);
    const slopes = [];
    for (let i = 1; i < t.length; i++) slopes.push(Math.log(t[i][1] / t[i - 1][1]) / Math.log(t[i][0] / t[i - 1][0]));
    for (const s of slopes) assert.ok(s > 0.4 && s < 0.85, `${id} slope ${s.toFixed(2)}`);
    for (let i = 1; i < slopes.length; i++) assert.ok(Math.abs(slopes[i] - slopes[i - 1]) < 0.2, `${id} kink at ${t[i][0]} MHz`);
    // above 2.4 GHz the slope must stay near the 0.5-0.6 of skin-effect plus dielectric loss
    for (let i = 7; i < t.length; i++) assert.ok(slopes[i - 1] < 0.75, `${id} high slope`);
  }
});

test('LMR-400 / LMR-600 at 5.8 GHz match the Times Microwave figures (about 10.9 and 7.1 dB/100 ft)', () => {
  const ft = 3.2808;
  assert.ok(Math.abs(cableDbPer100m('lmr-400', 5800) / ft - 10.9) < 0.5);
  assert.ok(Math.abs(cableDbPer100m('lmr-600', 5800) / ft - 7.1) < 0.4);
});

test('cableDbPer100m: equals the table at points, increases with frequency, sqrt(f) outside the range', () => {
  for (const [id, c] of Object.entries(CABLES)) {
    for (const [f, a] of c.attenDbPer100m) assert.ok(Math.abs(cableDbPer100m(id, f) - a) < 1e-9, id);
    let prev = 0;
    for (let f = 20; f <= 8000; f *= 1.15) { const v = cableDbPer100m(id, f); assert.ok(v > prev, `${id} ${f}`); prev = v; }
    assert.ok(Math.abs(cableDbPer100m(id, 25) / cableDbPer100m(id, 100) - 0.5) < 1e-9);
    assert.ok(Math.abs(cableDbPer100m(id, 24000) / cableDbPer100m(id, 6000) - 2) < 1e-9);
  }
  assert.throws(() => cableDbPer100m('nope', 100));
});

test('cable ranking holds from VHF to 5.8 GHz', () => {
  for (const f of [200, 900, 2400, 5800]) {
    const at = (id) => cableDbPer100m(id, f);
    assert.ok(at('lmr-600') < at('lmr-400') && at('lmr-400') < at('lmr-240') && at('lmr-240') < at('lmr-195'), String(f));
    assert.ok(at('rg213') < at('rg58') && at('rg58') < at('rg174'), String(f));
    assert.ok(at('rg316') < at('rg174'), String(f));
  }
});

test('short stubs: efficiency penalty at VHF, none for quarter-wave', () => {
  const uhf = shortStubGainDbi(0.12, 600), vhf = shortStubGainDbi(0.12, 195);
  assert.ok(uhf - vhf > 2 && uhf - vhf < 4, `penalty ${uhf - vhf}`);
  let prev = -99;
  for (let f = 100; f <= 600; f += 25) { const g = shortStubGainDbi(0.12, f); assert.ok(g >= prev - 1e-9); prev = g; }
  assert.ok(shortStubGainDbi(0.37, 195) > shortStubGainDbi(0.12, 195) + 2);
  assert.ok(shortStubGainDbi(0.4, 195) <= 2.15);
  assert.ok(shortStubGainDbi(0.0001, 200) < -20);
});

test('antenna variants: valid base types, 361-point patterns, 0 dB at boresight, never positive', () => {
  for (const [id, v] of Object.entries(ANTENNA_VARIANTS)) {
    assert.ok(ANTENNAS[v.baseType], id);
    assert.equal(v.pattern.azDb.length, 361, id);
    assert.equal(v.pattern.elDb.length, 361, id);
    assert.equal(v.pattern.azDb[180], 0, id);
    assert.equal(v.pattern.elDb[180], 0, id);
    for (const x of [...v.pattern.azDb, ...v.pattern.elDb]) assert.ok(x <= 0 && x >= -40, id);
    assert.ok(v.bandMHz[1] > v.bandMHz[0] && Number.isFinite(v.gainDbi), id);
  }
  const g = (id) => ANTENNA_VARIANTS[id].gainDbi;
  assert.ok(g('patch-2400') > 5 && g('patch-2400') < 9);
  assert.ok(g('patch-5800') >= g('patch-2400'));
  assert.ok(g('panel-2400') > g('patch-2400'));
  assert.ok(g('vhf-stub') < g('vhf-whip') && g('vhf-whip') < g('vhf-dipole'));
  for (const id of ['vhf-body', 'body-2400', 'body-5800']) {
    assert.ok(g(id) < 0, id);
    const az = ANTENNA_VARIANTS[id].pattern.azDb;
    assert.ok(az[0] < az[270] && az[270] < az[180], `${id} body shadow grows toward the rear`);
  }
  assert.ok(ANTENNA_VARIANTS['body-5800'].pattern.azDb[0] <= ANTENNA_VARIANTS['body-2400'].pattern.azDb[0]);
  for (const id of ['patch-2400', 'patch-5800', 'vhf-yagi']) assert.ok(ANTENNA_VARIANTS[id].pattern.azDb[0] <= -12, id);
  assert.ok(ANTENNA_VARIANTS['patch-2400'].pattern.azDb[180 + 37] > -3.3);
  assert.deepEqual(antennaVariantsFor(195).sort(), Object.keys(ANTENNA_VARIANTS).filter((k) => k.startsWith('vhf')).sort());
  assert.ok(antennaVariantsFor(2440).includes('patch-2400') && !antennaVariantsFor(2440).includes('patch-5800'));
  assert.deepEqual(antennaVariantsFor(600), []);
});

test('bands: VHF and 5.8 GHz present and not overlapping others', () => {
  for (const id of ['vhf-174-216', 'ism-5800', 'ism-2400']) assert.ok(BANDS.some((b) => b.id === id), id);
  const fresh = BANDS.filter((b) => ['vhf-174-216', 'ism-5800'].includes(b.id));
  for (const a of fresh) for (const b of BANDS) {
    if (a === b) continue;
    assert.ok(a.toMHz <= b.fromMHz || b.toMHz <= a.fromMHz, `${a.id} overlaps ${b.id}`);
  }
});

test('body shadowing rises with frequency; torso > hip; crowd extra positive', () => {
  for (const [id, e] of Object.entries(BODY_SHADOW_DB)) {
    for (let i = 1; i < e.points.length; i++) assert.ok(e.points[i][1] >= e.points[i - 1][1], id);
    let prev = -1;
    for (let f = 150; f <= 6000; f *= 1.2) { const v = bodyShadowDb(id, f); assert.ok(v >= prev - 1e-9 && v >= 0, `${id} ${f}`); prev = v; }
  }
  for (const f of [200, 600, 2400, 5800]) assert.ok(bodyShadowDb('torso-blocked', f) > bodyShadowDb('hip-los', f));
  assert.ok(bodyShadowDb('torso-blocked', 2400) > 12 && bodyShadowDb('torso-blocked', 2400) < 30);
  assert.equal(bodyShadowDb('unknown', 600), 0);
});

test('wall loss: rises with frequency, scales with thickness, stays above the P.2040 slab lower bound', () => {
  for (const [id, w] of Object.entries(WALL_LOSS_BY_FREQ)) {
    for (let i = 1; i < w.points.length; i++) assert.ok(w.points[i][1] >= w.points[i - 1][1], id);
    assert.ok(Math.abs(wallLossDb(id, 600, w.refThicknessM * 2) - 2 * wallLossDb(id, 600)) < 1e-9, id);
    assert.equal(wallLossDb(id, 600, 0), 0);
    if (MATERIALS[id]) for (const f of [200, 600, 900, 2400, 5800]) {
      const slab = slabTransmissionLossDb(id, w.refThicknessM, f);
      assert.ok(slab <= wallLossDb(id, f) + 1e-9, `${id} ${f}: slab ${slab.toFixed(1)} > table ${wallLossDb(id, f).toFixed(1)}`);
    }
  }
  assert.ok(wallLossDb('metal', 200) >= 30);
  assert.ok(wallLossDb('concrete', 2400) > 10 && wallLossDb('concrete', 2400) < 20);
  assert.ok(wallLossDb('drywall', 2400) > 2 && wallLossDb('drywall', 2400) < 5);
  assert.ok(wallLossDb('concrete', 5800) > wallLossDb('concrete', 2400));
  assert.equal(wallLossDb('nope', 600), 0);
});

test('slab model: concrete 0.1 m is lossier at 5.8 GHz than 600 MHz; metal screens; thin glass is nearly transparent', () => {
  assert.ok(slabTransmissionLossDb('concrete', 0.1, 5800) > slabTransmissionLossDb('concrete', 0.1, 600) + 3);
  assert.equal(slabTransmissionLossDb('metal', 0.001, 2400), 60);
  const l = slabTransmissionLossDb('glass', 0.001, 600);
  assert.ok(l >= 0 && l < 0.5);
});

test('materialAt / surfaceAt: 1 GHz values equal the library, sigma rises with f, epsR constant', () => {
  for (const id of Object.keys(MATERIALS)) {
    const a = materialAt(id, 1000);
    assert.ok(Math.abs(a.sigma - MATERIALS[id].sigma) < 1e-12, id);
    assert.equal(materialAt(id, 5800).epsR, MATERIALS[id].epsR);
    assert.ok(materialAt(id, 5800).sigma >= materialAt(id, 2400).sigma - 1e-12, id);
    assert.ok(materialAt(id, 2400).sigma >= materialAt(id, 200).sigma - 1e-12, id);
  }
  for (const id of Object.keys(SURFACES)) assert.ok(Math.abs(surfaceAt(id, 1000).sigma - SURFACES[id].sigma) < 1e-12, id);
  assert.ok(Math.abs(materialAt('concrete', 5800).sigma - 0.0326 * Math.pow(5.8, 0.8095)) < 1e-9);
  assert.equal(materialAt('nope', 1000).sigma, MATERIALS.concrete.sigma);
});

test('band profiles: receiver numbers are self-consistent, limits present, typical power inside the limits', () => {
  for (const [id, p] of Object.entries(BAND_PROFILES)) {
    const calc = -174 + 10 * Math.log10(p.rx.channelBwKHz * 1000) + p.rx.noiseFigureDb + p.rx.requiredCnrDb;
    assert.ok(Math.abs(calc - p.rx.sensitivityDbm) <= 1.5, `${id} ${calc.toFixed(1)} vs ${p.rx.sensitivityDbm}`);
    const maxAny = Math.max(...p.limits.map((l) => l.maxDbm));
    assert.ok(p.typicalTxDbm.mic <= maxAny && p.typicalTxDbm.iem <= maxAny, id);
    assert.ok(p.limits.length >= 3 && p.limits.every((l) => l.basis && l.region));
    const e = p.externalNoiseFigureDb;
    assert.ok(e.quiet <= e.outdoor && e.outdoor <= e.urban && e.urban <= e['noisy-venue']);
  }
  assert.ok(BAND_PROFILES['vhf-174-216'].externalNoiseFigureDb.urban > 5); // man-made noise is higher at VHF than UHF
  assert.ok(BAND_PROFILES['ism-5800'].rx.noiseFigureDb >= BAND_PROFILES['ism-2400'].rx.noiseFigureDb);
  assert.ok(BAND_PROFILES['ism-5800'].rx.sensitivityDbm >= BAND_PROFILES['ism-2400'].rx.sensitivityDbm);
});

test('interference model: venue ordering, Wi-Fi channel peaks and gaps, 5.8 quieter than 2.4, bandwidth independence', () => {
  const r = (f, v, o) => interferenceRiseDb(f, v, o);
  for (const f of [2412, 2437, 2462, 2449.5, 2480, 5745, 5785, 5870]) {
    assert.ok(r(f, 'quiet').riseDb < r(f, 'typical').riseDb && r(f, 'typical').riseDb < r(f, 'busy').riseDb, String(f));
    for (const v of ['quiet', 'typical', 'busy']) {
      const x = r(f, v);
      assert.ok(x.hitProbability >= 0 && x.hitProbability <= 1 && x.riseDb >= 0 && x.eventRiseDb >= 0, `${f} ${v}`);
    }
  }
  assert.ok(r(2437, 'typical').riseDb > r(2449.5, 'typical').riseDb + 3);       // channel 6 centre vs the 1/6/11 gap
  assert.ok(r(2437, 'typical').hitProbability > 5 * r(2449.5, 'typical').hitProbability);
  for (const v of ['quiet', 'typical', 'busy']) assert.ok(r(5785, v).riseDb < r(2437, v).riseDb, v);
  assert.ok(Math.abs(r(5785, 'typical', { bwMHz: 1 }).riseDb - r(5785, 'typical', { bwMHz: 4 }).riseDb) < 0.05);
  // quiet venue is near the receiver noise floor, busy venue is a large rise
  assert.ok(r(2437, 'quiet').riseDb < 3 && r(2437, 'busy').riseDb > 12);
  // microwave oven: only in typical/busy, strongest near 2450, weak at the band edge
  assert.equal(r(2450, 'quiet').eventRiseDb, 0);
  assert.ok(r(2450, 'busy').eventRiseDb > r(2450, 'typical').eventRiseDb);
  assert.ok(r(2450, 'typical').eventRiseDb > r(2400, 'typical').eventRiseDb + 15);
  // FPV video is opt-in
  assert.ok(r(5805, 'busy', { fpv: true }).riseDb > r(5805, 'busy').riseDb + 5);
  assert.equal(r(5805, 'busy', { fpv: true }).hitProbability, 1);
  // out of band or no venue: zeros
  for (const z of [r(600, 'busy'), r(2437, 'none'), r(2437, undefined)]) assert.equal(z.riseDb, 0);
  // data shape
  for (const k of ['ism-2400', 'ism-5800']) {
    const w = INTERFERENCE_MODEL[k].wifi;
    for (const v of INTERFERENCE_MODEL.venues) assert.ok(w.avgDbmPer20MHz[v] < w.burstDbm[v] && w.utilisation[v] > 0 && w.utilisation[v] < 1);
    assert.ok(w.avgDbmPer20MHz.quiet < w.avgDbmPer20MHz.typical && w.avgDbmPer20MHz.typical < w.avgDbmPer20MHz.busy);
  }
});
