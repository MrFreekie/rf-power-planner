// Booster compression (js/model/compression.js) and its use in solveLink and the booster-overload examples.
// Hand anchors: OP1dB = OIP3 - 9.6 dB = 10.4 dBm for the default OIP3 20 dBm; the compression is exactly 1 dB at OP1dB + 1 dB of linear output,
// 0 dB 10 dB lower (start of the knee), then 1 dB more per dB of drive. Tolerances 1e-9 for the closed forms, 0.05 dB for example figures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compressionDb, stageOp1dBDbm, chainCompression, OP1DB_BELOW_OIP3_DB, DEFAULT_OIP3_DBM } from '../js/model/compression.js';
import { boosterOverloadReport, EXAMPLES } from '../js/examples.js';
import { validateScene } from '../js/model/scene.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (tol ${tol})`);

test('compressionDb: 0 below the knee, exactly 1 dB at OP1dB+1, then 1 dB per dB', () => {
  const op = 10.4;
  assert.equal(compressionDb(op + 1 - 10, op), 0);
  assert.equal(compressionDb(-30, op), 0);
  near(compressionDb(op + 1, op), 1, 1e-9, 'at the 1 dB point');
  near(compressionDb(op + 1 + 5, op), 6, 1e-9, '5 dB past it');
  near(compressionDb(op + 1 - 5, op), 0.25, 1e-9, 'half way up the knee is a quarter of a dB (quadratic)');
  assert.equal(compressionDb(NaN, op), 0);
});

test('stageOp1dBDbm: OIP3 20 default gives 10.4 dBm, iip3 + gain, oip3 and explicit op1dBDbm take precedence in order', () => {
  assert.equal(OP1DB_BELOW_OIP3_DB, 9.6); assert.equal(DEFAULT_OIP3_DBM, 20);
  near(stageOp1dBDbm({}, 12), 10.4, 1e-9);
  near(stageOp1dBDbm({ iip3Dbm: 8 }, 12), 20 - 9.6, 1e-9);
  near(stageOp1dBDbm({ oip3Dbm: 25 }, 12), 15.4, 1e-9);
  assert.equal(stageOp1dBDbm({ op1dBDbm: 17, iip3Dbm: 8 }, 12), 17);
});

test('chainCompression: a weak wanted signal alone is not compressed; a strong second signal compresses both equally', () => {
  const st = [{ label: 'Booster', gainDbs: [12, 12], op1dBDbm: 10.4 }];
  const alone = chainCompression([{ label: 'Booster', gainDbs: [12], op1dBDbm: 10.4 }], [{ id: 'w', levelDbm: -60, freqMHz: 606, wanted: true }]);
  assert.equal(alone.totalDb, 0); near(alone.wantedOut, -48, 1e-9);
  // strong signal at +1.9 dBm in: linear out 13.9 dBm, c = 1 + (13.9 - 11.4) = 3.5 dB
  const both = chainCompression(st, [{ id: 'w', levelDbm: -60, freqMHz: 606, wanted: true }, { id: 's', levelDbm: 1.9, freqMHz: 462 }]);
  near(both.totalDb, 3.5, 0.01, 'compression'); near(both.wantedOut, -48 - both.totalDb, 1e-6, 'wanted loses the same dB');
  assert.equal(both.stages[0].level, 'compressed'); assert.ok(both.stages[0].headroomDb < 0);
  // a passive stage (op1dBDbm null) never compresses
  assert.equal(chainCompression([{ label: 'Cable', gainDbs: [-3, -3], op1dBDbm: null }], [{ levelDbm: 30, wanted: true }, { levelDbm: 30 }]).totalDb, 0);
});

test('example figures: plain 7.6 dB, overloaded 4.1 dB with 3.5 dB compression, filtered 7.6 dB with none', () => {
  const p = boosterOverloadReport('plain'), o = boosterOverloadReport('overloaded'), f = boosterOverloadReport('filtered');
  near(p.marginDb, 7.6, 0.05); near(o.marginDb, 4.1, 0.05); near(f.marginDb, 7.6, 0.05);
  near(o.compressionDb, 3.5, 0.05); assert.equal(f.compressionDb, 0); assert.equal(p.compressionDb, 0);
  near(o.interfererDbm, 1.9, 0.05); near(o.boosterOutDbm, 13.9, 0.05); near(o.op1dBDbm, 10.4, 1e-9);
  near(f.boosterOutDbm, -17.6, 0.05);
  assert.ok(o.result.warnings.some((w) => /compression/.test(w)), 'overloaded warns');
  assert.ok(!f.result.warnings.some((w) => /compression|1 dB point/.test(w)), 'filtered does not warn');
  assert.ok(o.result.marginDb < p.result.marginDb - 3);
});

test('examples validate and the notes quote the asserted figures', () => {
  for (const id of ['booster-overloaded-by-radio', 'booster-filtered-before-radio']) {
    const ex = EXAMPLES.find((e) => e.id === id); assert.ok(ex, id);
    assert.ok(validateScene(ex.build().scene).ok, id);
    assert.match(ex.note, /^(Best practice|Less ideal|Problem|Compare):/);
    assert.ok(ex.note.split(/(?<=\.)\s/).length <= 4, `${id} at most four sentences`);
  }
  const o = EXAMPLES.find((e) => e.id === 'booster-overloaded-by-radio').note;
  for (const n of ['+1.9 dBm', '13.9 dBm', '10.4 dBm', '3.5 dB', '7.6 dB', '4.1 dB']) assert.ok(o.includes(n), n);
  const f = EXAMPLES.find((e) => e.id === 'booster-filtered-before-radio').note;
  for (const n of ['-17.6 dBm', '10.4 dBm', '7.6 dB', '4.1 dB']) assert.ok(f.includes(n), n);
});

test('older chain items without op1dBDbm and scenes without noise sources are unaffected (compression null)', () => {
  const r = boosterOverloadReport('plain').result;
  assert.equal(r.compression, null);
  const sc = boosterOverloadReport('overloaded').scene; sc.links[0].chain[0].op1dBDbm = 'x';
  assert.equal(validateScene(sc).ok, false);
});

test('chainCompression: a dropped non-finite signal does not shift the gains of the others (gain index kept)', () => {
  // Signals: muted (-Infinity), then wanted at -50 dBm, gain per signal [0, 20] dB: the wanted signal must get +20, not the muted one's 0.
  const st = [{ label: 'booster', gainDbs: [0, 20], op1dBDbm: 10 }];
  const sigs = [{ id: 'muted', levelDbm: -Infinity, freqMHz: 600 }, { id: 'wanted', levelDbm: -50, freqMHz: 600, wanted: true }];
  const r = chainCompression(st, sigs);
  near(r.stages[0].linearOutDbm, -30, 1e-9, 'linear out = -50 + 20'); // tolerance 1e-9 dB
  near(r.wantedOut, -30, 1e-9, 'wanted out');
});

test('chainCompression: a -Infinity stage gain (stop band) fully rejects the interferer instead of passing it at 0 dB', () => {
  const sigs = [{ id: 'wanted', levelDbm: -60, freqMHz: 600, wanted: true }, { id: 'radio', levelDbm: 5, freqMHz: 450 }];
  const pass = chainCompression([{ label: 'booster', gainDbs: [15, 15], op1dBDbm: 10.4 }], sigs);
  const filt = chainCompression([{ label: 'booster', gainDbs: [15, -Infinity], op1dBDbm: 10.4 }], sigs);
  assert.ok(pass.totalDb > 3, `unfiltered compresses (${pass.totalDb})`);
  assert.equal(filt.totalDb, 0);
  near(filt.stages[0].linearOutDbm, -45, 1e-9, 'only the wanted signal reaches the output'); // -60 + 15
});
