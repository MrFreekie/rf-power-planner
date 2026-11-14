// Programme tone against the MPX tones (items 32 and 32a): two-tone FM Bessel weights, baseband products from a memoryless nonlinearity,
// audio filter, pilot beat, decoder aliasing, tone-key harmonics, RDS/SCA neighbours, overdeviation, examples.
// Filter, PLL, window and nonlinearity figures are assumed (flag U); the Bessel weights and product frequencies are exact.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  audioFilterDb, pilotBeat, decoderAlias, twoToneFm, basebandProducts, toneKeyHarmonics, neighbourHits, overdeviation, toneMpxReport,
  TONE_MPX_ASSUMED, MPX_NEIGHBOURS, TONE_MPX_DEFAULTS,
} from '../js/model/tone-mpx.js';
import { TONE_MPX_EXAMPLES, toneMpxScene, toneMpxExampleReport, EXAMPLES } from '../js/examples.js';
import { validateScene } from '../js/model/scene.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);
const line = (r, i, j) => r.lines.find((l) => l.i === i && l.j === j);
const db = (a) => 20 * Math.log10(Math.abs(a));

test('audio filter: 0 dB to 15 kHz, 40 dB at 19 kHz (assumed), log-linear between, 60 dB per octave above, capped at 100 dB', () => {
  assert.equal(audioFilterDb(10), 0); assert.equal(audioFilterDb(15), 0);
  near(audioFilterDb(19), 40, 1e-9);
  near(audioFilterDb(17), 40 * Math.log(17 / 15) / Math.log(19 / 15), 1e-9); near(audioFilterDb(17), 21.18, 0.01);
  near(audioFilterDb(38), 100, 1e-9); near(audioFilterDb(26.870), 40 + 60 * Math.log2(26.870 / 19), 1e-9); assert.equal(audioFilterDb(100), 100);
  assert.equal(TONE_MPX_ASSUMED.filterRejectionAt19Db.flag, 'U');
});

test('two-tone FM, hand Bessel values: b1 = 1, b2 = 0.4: carrier J0(1)J0(0.4) = 0.73489, first sidebands J1(1)J0(0.4) and J0(1)J1(0.4)', () => {
  // J0(1) = 0.7651977, J1(1) = 0.4400506, J0(0.4) = 0.9603982, J1(0.4) = 0.1960266 (tables)
  const r = twoToneFm({ tone1Khz: 1, dev1Khz: 1, tone2Khz: 19, dev2Khz: 7.6 });
  near(r.beta1, 1, 1e-12); near(r.beta2, 0.4, 1e-12);
  near(r.carrierDb, db(0.7651977 * 0.9603982), 2e-4); near(r.carrierDb, -2.6755, 1e-3);
  const at = (n, m) => r.lines.find((l) => Math.abs(l.offsetKhz - (n * 1 + m * 19)) < 1e-9);
  near(at(1, 0).amp, 0.4400506 * 0.9603982, 1e-6); near(at(1, 0).levelDb, -7.484, 0.01);
  near(at(0, 1).amp, 0.7651977 * 0.1960266, 1e-6); near(at(0, 1).levelDb, -16.48, 0.01);
  near(at(1, 1).amp, 0.4400506 * 0.1960266, 1e-6);
  near(at(-1, 0).amp, -0.4400506 * 0.9603982, 1e-6); // J_-1 = -J_1: the lower first sideband has the opposite sign
});

test('two-tone FM: carrier null at b1 = 2.405, power conservation (sum of squares = 1) for an irrational tone ratio, pilot-only is single-tone FM', () => {
  assert.ok(twoToneFm({ tone1Khz: 1, dev1Khz: 2.404826, dev2Khz: 0 }).carrierDb < -90);
  const r = twoToneFm({ tone1Khz: 1.37, dev1Khz: 6, tone2Khz: 19, dev2Khz: 7.5, minDb: -300 });
  near(r.lines.reduce((s, l) => s + l.amp * l.amp, 0), 1, 1e-6);
  const single = twoToneFm({ tone1Khz: 5, dev1Khz: 10, tone2Khz: 19, dev2Khz: 0 }); // b1 = 2: J0(2) = 0.2238908, J1(2) = 0.5767248
  near(single.lines.find((l) => Math.abs(l.offsetKhz - 5) < 1e-9).amp, 0.5767248, 1e-6); near(single.carrierDb, db(0.2238908), 1e-4);
  // the headline case, 1 kHz at 30 kHz deviation (b1 = 30) and the 10 percent pilot (7.5 kHz, b2 = 0.395): b1 and b2 and a wide spread of lines
  const h = twoToneFm({ tone1Khz: 1, dev1Khz: 30, tone2Khz: 19, dev2Khz: 7.5 });
  near(h.beta1, 30, 1e-12); near(h.beta2, 7.5 / 19, 1e-12); assert.ok(h.lines.length > 100); near(h.occupiedKhz, 102, 4);
  // the 19 kHz pilot at a ratio of exactly 19: lines at the same offset add coherently and the merged entry is reported
  assert.ok(h.lines.some((l) => l.coincident && l.coincident.length > 1));
});

test('baseband, linear: with only the first-order term the MPX tones just add: two lines, no products', () => {
  const r = basebandProducts({ toneKhz: 1, tonePct: 30, pilotPct: 9, maxOrder: 1 });
  assert.equal(r.lines.length, 2);
  near(line(r, 1, 0).amp, 0.3, 1e-12); near(line(r, 0, 1).amp, 0.09, 1e-12);
  near(line(r, 1, 0).levelDb, db(0.3), 1e-9); near(line(r, 0, 1).levelDb, db(0.09), 1e-9);
});

test('baseband cubic, hand values: tone 0.3 alone, d = 1: f1 = 0.3 - a^3/4 + 2 a^5 / 15 x 10/16 = 0.2934525, 3f1 = -a^3/12 + 2 a^5 / 15 x 5/16 = -0.00214875, 5f1 = 2 a^5 / 15 / 16', () => {
  const r = basebandProducts({ toneKhz: 1, tonePct: 30, pilotPct: 0, overloadDb: 0, asymmetry: 0 });
  near(line(r, 1, 0).amp, 0.2934525, 1e-9); near(line(r, 3, 0).amp, -0.00214875, 1e-9); near(line(r, 5, 0).amp, 2 * 0.3 ** 5 / 15 / 16, 1e-12);
  near(line(r, 3, 0).levelDb, db(0.00214875), 1e-9); near(line(r, 3, 0).fKhz, 3, 1e-12);
  assert.equal(line(r, 2, 0), undefined); // no even-order products with asymmetry 0
});

test('baseband intermodulation, hand values at order 3 (a1 = 0.3, a2 = 0.09, d = 1): 2f2+f1 = -a1 a2^2/4 at 39 kHz, 2f1+f2 = -a1^2 a2/4 at 21 kHz, 3f2 = -a2^3/12 at 57 kHz', () => {
  const r = basebandProducts({ toneKhz: 1, tonePct: 30, pilotPct: 9, overloadDb: 0, asymmetry: 0, maxOrder: 3 });
  near(line(r, 1, 2).amp, -0.3 * 0.09 ** 2 / 4, 1e-12); near(line(r, 1, 2).fKhz, 39, 1e-12); near(line(r, 1, 2).levelDb, -64.33, 0.01);
  near(Math.abs(line(r, 2, 1).amp), 0.3 ** 2 * 0.09 / 4, 1e-12); near(line(r, 2, 1).fKhz, 21, 1e-12); near(line(r, 2, 1).levelDb, -53.87, 0.01);
  near(line(r, -2, 1).fKhz, 17, 1e-12); near(line(r, -2, 1).amp, -(0.3 ** 2) * 0.09 / 4, 1e-12); // 2f1 - f2 = -17 kHz folds to 17 kHz
  near(line(r, 0, 3).amp, -(0.09 ** 3) / 12, 1e-12); near(line(r, 0, 3).fKhz, 57, 1e-12);
  assert.equal(line(r, 1, 1), undefined, 'no second order products with the cubic only'); // maxOrder 3 and asymmetry 0: f1 +- f2 absent
});

test('baseband second order (asymmetry): 2f1 = h2 a1^2/2 and f2 +- f1 = h2 a1 a2 with h2 = asymmetry d / 3', () => {
  const r = basebandProducts({ toneKhz: 1, tonePct: 30, pilotPct: 9, overloadDb: 0, asymmetry: 0.6, maxOrder: 2 });
  near(line(r, 2, 0).amp, 0.2 * 0.09 / 2, 1e-12); near(line(r, 1, 1).amp, 0.2 * 0.3 * 0.09, 1e-12); near(line(r, -1, 1).amp, 0.2 * 0.3 * 0.09, 1e-12);
  near(line(r, 0, 2).fKhz, 38, 1e-12); near(line(r, 0, 2).amp, 0.2 * 0.09 ** 2 / 2, 1e-12);
});

test('baseband products grow with the overload level: the cubic terms scale as d^2 (6 dB per 3 dB... 2 dB per dB of drive on the 3f1 line)', () => {
  const lo = basebandProducts({ tonePct: 20, pilotPct: 0, overloadDb: -20, asymmetry: 0, maxOrder: 3 }), hi = basebandProducts({ tonePct: 20, pilotPct: 0, overloadDb: -14, asymmetry: 0, maxOrder: 3 });
  near(line(hi, 3, 0).levelDb - line(lo, 3, 0).levelDb, 12, 1e-6); // d^2 : 2 dB per dB, 6 dB more drive = 12 dB
});

test('pilot beat: 19.3 kHz at 40 percent, filter 41.36 dB, margin 28.40 dB, 300 Hz beat, phase error asin(0.038) = 2.2 degrees; margin 20 log(0.09/0.01) = 19.1 dB gives asin(1/9) = 6.38 degrees', () => {
  const b = pilotBeat(19.3, { tonePct: 40, pilotPct: 9 });
  near(b.beatHz, 300, 1e-6); near(b.filterDb, 40 + 60 * Math.log2(19.3 / 19), 1e-9); near(b.marginDb, 28.40, 0.01); near(b.phaseErrorDeg, 2.18, 0.02);
  assert.equal(b.pllTracks, true); assert.equal(b.audible, true);
  const c = pilotBeat(19, { tonePct: 100, pilotPct: 9 });
  near(c.toneAfterFilterDb, -40, 1e-9); near(c.phaseErrorDeg, (Math.asin(0.01 / 0.09) * 180) / Math.PI, 1e-9); near(c.phaseErrorDeg, 6.38, 0.01);
  assert.equal(c.risk, 'high'); assert.equal(pilotBeat(5, { tonePct: 100 }).risk, 'low'); assert.equal(pilotBeat(1, { tonePct: 100 }).risk, 'low');
  assert.equal(pilotBeat(17, { tonePct: 40, pilotPct: 9 }).risk, 'medium'); // 21.2 dB filter, 8.2 dB under the pilot, 2 kHz from it
});

test('decoder aliasing: 0.03-15 kHz direct, 23-53 kHz folds about 38 kHz (21 not in L-R, 25 -> 13, 50 -> 12, 38 -> 0), the gap between is not demodulated', () => {
  assert.deepEqual(decoderAlias(10).map((a) => [a.audioKhz, a.path]), [[10, 'L+R']]);
  assert.deepEqual(decoderAlias(25).map((a) => [a.audioKhz, a.path]), [[13, 'L-R']]);
  assert.deepEqual(decoderAlias(50).map((a) => a.audioKhz), [12]); assert.deepEqual(decoderAlias(38).map((a) => a.audioKhz), [0]);
  assert.deepEqual(decoderAlias(20), []); assert.deepEqual(decoderAlias(60), []);
});

test('tone-key harmonics: 3 x 10.9 = 32.7 kHz and 3 x 11 = 33.0 kHz fall in the 32.768 +- 0.5 kHz window, 3 x 11.5 does not; hard clipping has no 4th, soft clipping does (4 x 8.192 = 32.768)', () => {
  const a = toneKeyHarmonics({ toneKhz: 10.9, levelDb: -8, thdPercent: 10 });
  assert.deepEqual(a.hits.map((h) => h.k), [3]); near(a.hits[0].fKhz, 32.7, 1e-9);
  assert.deepEqual(toneKeyHarmonics({ toneKhz: 11 }).hits.map((h) => h.k), [3]);
  assert.deepEqual(toneKeyHarmonics({ toneKhz: 11.5 }).hits, []);
  assert.deepEqual(toneKeyHarmonics({ toneKhz: 8.192, hard: true }).hits, []);
  assert.deepEqual(toneKeyHarmonics({ toneKhz: 8.192, hard: false }).hits.map((h) => h.k), [4]);
  // level: tone level + 20 log10(thd a_k), a_k a unit-norm weight: the total of all harmonics is thd (sqrt(sum a^2) = 1)
  const all = toneKeyHarmonics({ toneKhz: 1, levelDb: 0, thdPercent: 10, hard: false });
  near(Math.sqrt(all.harmonics.reduce((s, h) => s + 10 ** (h.levelDb / 10), 0)), 0.1, 1e-3);
  assert.equal(TONE_MPX_ASSUMED.toneKeyKhz.flag, 'U');
});

test('RDS and SCA neighbours: the third harmonic of the pilot (57 kHz) lands in the RDS band, 38 kHz does not', () => {
  const r = basebandProducts({ toneKhz: 1, tonePct: 30, pilotPct: 9, overloadDb: 0, asymmetry: 0, maxOrder: 3 });
  const hits = neighbourHits(r.lines.filter((l) => l.kind !== 'tone' && l.kind !== 'pilot'));
  assert.ok(hits.some((h) => h.neighbour.id === 'rds' && h.line.label === '3f2'));
  assert.ok(!hits.some((h) => h.line.fKhz === 38));
  assert.deepEqual(MPX_NEIGHBOURS.map((n) => n.centreKhz), [57, 67, 92]);
  for (const n of MPX_NEIGHBOURS) assert.equal(n.flag, 'U');
});

test('overdeviation: 95 + 9 = 104 percent is over by 20 log10(100/104) = -0.341 dB, 91 percent of tone is available, 75 kHz x 40 percent = 30 kHz', () => {
  const o = overdeviation({ tonePct: 95, pilotPct: 9 });
  near(o.totalPct, 104, 1e-12); near(o.headroomDb, -0.3407, 1e-3); assert.equal(o.over, true); near(o.availableTonePct, 91, 1e-12);
  near(overdeviation({ tonePct: 40, pilotPct: 10 }).toneDevKhz, 30, 1e-12); near(overdeviation({ tonePct: 40, pilotPct: 10 }).pilotDevKhz, 7.5, 1e-12);
  assert.equal(overdeviation({ tonePct: 40 }).over, false);
});

test('report: stereo tone above 15 kHz is filtered before the nonlinearity and the FM; a mono mic report carries tone-key hits and no pilot', () => {
  const st = toneMpxReport({ toneKhz: 19.3, tonePct: 40, pilotPct: 9 });
  near(st.filter.attenuationDb, 41.36, 0.01); near(st.filter.toneAfterPct, 40 * 10 ** (-41.356 / 20), 0.01);
  const mono = toneMpxReport({ toneKhz: 10.9, tonePct: 60, pilotPct: 9, overloadDb: 0, mono: true });
  assert.equal(mono.fm.beta2, 0); assert.equal(mono.toneKey.hits.length, 1); near(mono.toneKey.hits[0].fKhz, 32.7, 1e-9);
  near(mono.toneKey.hits[0].levelDb, db(-(0.6 ** 3) / 12 + 2 * 0.6 ** 5 / 15 * 5 / 16), 1e-6); // the stage's own third harmonic, not a second model
  assert.equal(mono.products.lines.every((l) => l.j === 0), true);
  const d = toneMpxReport({}); assert.equal(d.settings.toneKhz, TONE_MPX_DEFAULTS.toneKhz);
  const ranged = toneMpxReport({ toneKhz: 1e9, tonePct: -5, pilotPct: 400, overloadDb: NaN }); assert.ok(ranged.settings.toneKhz <= 60 && ranged.settings.tonePct === 0 && ranged.settings.pilotPct === 15);
});

test('examples: five scenes with audioSource tone or sweep, and the notes quote the model', () => {
  const f1 = (x) => x.toFixed(1);
  const note = (id) => EXAMPLES.find((x) => x.id === id).note;
  const r = Object.fromEntries(Object.keys(TONE_MPX_EXAMPLES).map((k) => [k, toneMpxExampleReport(k)]));
  for (const id of ['tone-pilot-products', 'tone-pilot-beat', 'tone-sweep-pilot', 'tone-key-harmonics', 'tone-overdeviation']) {
    const e = EXAMPLES.find((x) => x.id === id); assert.ok(e, id);
    const sc = e.build().scene; assert.equal(validateScene(sc).ok, true, id);
    assert.ok(['tone', 'sweep'].includes(sc.audioSource)); assert.ok(note(id).split('. ').length <= 4, id);
  }
  assert.equal(toneMpxScene('sweep').audioSource, 'sweep'); assert.equal(toneMpxScene('tone-key').links[0].kind, 'mic');
  const p = r.products;
  for (const v of [line(p.products, -1, 1), line(p.products, 1, 1), line(p.products, -2, 1), line(p.products, 1, 2), line(p.products, 0, 3)].map((l) => f1(l.levelDb))) assert.ok(note('tone-pilot-products').includes(v), v);
  assert.ok(note('tone-pilot-products').includes(`about ${Math.round(p.fm.occupiedKhz)} kHz`)); near(p.fm.beta1, 30, 1e-12); near(p.fm.beta2, 0.395, 1e-3);
  const b = r.beat; for (const v of [f1(b.filter.attenuationDb), f1(b.beat.marginDb), f1(b.beat.phaseErrorDeg), String(Math.round(b.beat.beatHz))]) assert.ok(note('tone-pilot-beat').includes(v), v);
  const s = r.sweep; for (const v of [f1(s.filter.attenuationDb), f1(s.beat.marginDb), f1(s.beat.phaseErrorDeg), String(Math.round(s.beat.beatHz))]) assert.ok(note('tone-sweep-pilot').includes(v), v);
  const k = r['tone-key']; for (const v of [f1(k.toneKey.hits[0].levelDb), f1(k.toneKey.hits[0].fKhz)]) assert.ok(note('tone-key-harmonics').includes(v), v);
  const o = r.overdev; for (const v of [String(o.deviation.totalPct), f1(o.fm.carrierDb), f1(line(o.products, 3, 0).levelDb), f1(line(o.products, -1, 1).levelDb), f1(line(o.products, 0, 3).levelDb), String(Math.round(o.fm.occupiedKhz)), f1(-o.deviation.headroomDb).slice(0, 3)]) assert.ok(note('tone-overdeviation').includes(v), v);
});
