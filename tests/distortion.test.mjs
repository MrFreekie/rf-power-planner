// Overload distortion simulation (spectrum-views.js). Tolerances stated per test. All shapes are illustrative; the tests pin the
// hand-computed relations the code documents.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  audioSpectrum, rfSpectrum, monoBasebandSpectrum, distortionFromLink, clipFractionFromOverdrive, distortMpxSpectrum, clipSamples,
} from '../js/model/spectrum-views.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (tol ${tol})`);
const pw = (db) => 10 ** (db / 10);

test('no distortion: outputs are unchanged (deep equal) for null, undefined and inactive descriptors', () => {
  const inactive = distortionFromLink({ overload: { level: 'ok', compressionDb: 0, distortionPct: 0.01, desenseDb: 0 } });
  assert.equal(inactive.active, false);
  assert.equal(inactive.source, 'none');
  for (const d of [undefined, null, inactive, { active: false, thdPercent: 20 }]) {
    assert.deepEqual(audioSpectrum({ kind: 'iem', stereo: true, distortion: d }), audioSpectrum({ kind: 'iem', stereo: true }));
    const r = { carrierMHz: 600, rxLevelDbm: -50, noiseFloorDbm: -100 };
    assert.deepEqual(rfSpectrum({ ...r, distortion: d }), rfSpectrum(r));
    assert.deepEqual(monoBasebandSpectrum({ kind: 'mic', distortion: d }), monoBasebandSpectrum({ kind: 'mic' }));
  }
});

test('descriptor: hand-computed mapping, tolerance 0.01 percent / 0.05 dB', () => {
  // c = 1 dB -> thd = (1 - 10^-0.05)/3 = 3.6 percent (0.10875 / 3 = 3.625)
  const d = distortionFromLink({ overload: { level: 'hot', compressionDb: 1, distortionPct: 4, desenseDb: 2 } });
  assert.equal(d.active, true);
  assert.equal(d.source, 'rx-front-end');
  near(d.thdPercent, (1 - 10 ** (-0.05)) / 3 * 100, 0.01);
  // p = 0.04 -> r = 0.04/sqrt(0.9984)
  near(d.imd3Dbc, 20 * Math.log10(0.04 / Math.sqrt(0.9984)), 0.05);
  assert.equal(d.desenseDb, 2);
  const tx = distortionFromLink({ txClipFraction: 0.1 });
  assert.equal(tx.source, 'tx-limiter');
  assert.equal(tx.clipKind, 'hard');
  near(tx.thdPercent, 15, 1e-9);
  near(tx.imd3Dbc, 20 * Math.log10(0.15), 1e-9);
  const both = distortionFromLink({ overload: { level: 'overload', compressionDb: 3 }, txClipFraction: 0.1 });
  assert.equal(both.source, 'both');
  assert.equal(both.severity, 'red');
  assert.ok(both.thdPercent > tx.thdPercent);
});

test('clip fraction from overdrive: 0 at 0 dB, monotonic, erfc check at 6 dB', () => {
  assert.equal(clipFractionFromOverdrive(0), 0);
  assert.equal(clipFractionFromOverdrive(-5), 0);
  // 6 dB: k = 3/1.9953 = 1.5036; erfc(1.0632) ~ 0.1327 ; minus erfc(2.1213) = 0.0027 -> 0.130
  near(clipFractionFromOverdrive(6), 0.130, 0.004);
  let prev = 0;
  for (let od = 0; od <= 30; od += 1) { const c = clipFractionFromOverdrive(od); assert.ok(c >= prev); prev = c; }
});

test('audioSpectrum: harmonic line at k f0 has the documented power (soft clip, weights k^-1.5), tolerance 1e-6 relative', () => {
  const base = audioSpectrum({ kind: 'mic', nBins: 2049 });
  const thd = 0.1;
  const d = { active: true, source: 'rx-front-end', thdPercent: 10, imd3Dbc: -120, clipKind: 'soft' };
  const a = audioSpectrum({ kind: 'mic', nBins: 2049, distortion: d });
  assert.ok(a.harmonics.length >= 2);
  const f0 = base.peakHz, ref = Math.max(...base.levelsDb);
  const kMax = Math.min(12, Math.floor(20000 / f0));
  let norm = 0; for (let k = 2; k <= kMax; k++) norm += k ** -3;
  norm = Math.sqrt(norm);
  const floorPow = pw(20 * Math.log10(thd) - 40 + ref);
  for (const h of a.harmonics) {
    const i = Math.round(h.k * f0 / 20000 * 2048);
    const expLine = pw(ref + 20 * Math.log10(thd * h.k ** -1.5 / norm));
    const added = pw(a.levelsDb[i]) - pw(base.levelsDb[i]);
    near(added / (expLine + floorPow), 1, 1e-6, `k=${h.k}`);
    near(h.freqHz, h.k * f0, 20000 / 2048, 'at k f0');
  }
  assert.equal(a.peakHz, base.peakHz);
});

test('audioSpectrum: hard clip gives odd harmonics only; raised floor and IM skirts rise with thd; no NaN at extremes', () => {
  const d = { active: true, source: 'tx-limiter', thdPercent: 15, imd3Dbc: -16.5, clipFraction: 0.1, clipKind: 'hard' };
  const a = audioSpectrum({ kind: 'iem', stereo: true, distortion: d });
  assert.ok(a.harmonics.every((h) => h.k % 2 === 1));
  const base = audioSpectrum({ kind: 'iem', stereo: true });
  assert.ok(a.levelsDb.every((v, i) => v >= base.levelsDb[i] - 1e-9));
  assert.ok(a.levelsDbR.every((v, i) => v >= base.levelsDbR[i] - 1e-9));
  const sum = (x) => x.reduce((s, v) => s + pw(v), 0);
  let prev = sum(base.levelsDb);
  for (const thd of [1, 3, 10, 30]) {
    const cur = sum(audioSpectrum({ kind: 'iem', distortion: { active: true, thdPercent: thd, imd3Dbc: 20 * Math.log10(thd / 100) } }).levelsDb);
    assert.ok(cur > prev, `thd ${thd}`);
    prev = cur;
  }
  for (const bad of [NaN, Infinity, -Infinity, -5, 1e9]) {
    const r = audioSpectrum({ kind: 'iem', stereo: true, distortion: { active: true, thdPercent: bad, imd3Dbc: bad, clipFraction: bad, desenseDb: bad, compressionDb: bad } });
    assert.ok(r.levelsDb.every(Number.isFinite) && r.levelsDbR.every(Number.isFinite));
  }
});

test('rfSpectrum: desense raises the noise by desenseDb, IM3 shoulders appear at +-bw, tx-only leaves the RF view alone', () => {
  const p = { carrierMHz: 600, rxLevelDbm: -50, noiseFloorDbm: -100, nBins: 512, spanKhz: 800 };
  const base = rfSpectrum(p);
  const d = { active: true, source: 'rx-front-end', thdPercent: 5, imd3Dbc: -20, desenseDb: 6, rxActive: true };
  const r = rfSpectrum({ ...p, distortion: d });
  near(r.noiseDesensedDbm - r.noiseDbm, 6, 1e-9);
  assert.equal(r.noiseDbm, base.noiseDbm);
  assert.deepEqual(r.regrowth.offsetsKhz, [-base.bwKhz, base.bwKhz]);
  // far-out bin (beyond channel filter, noise dominated): rises by the desense, tolerance 0.3 dB (ripple identical, signal negligible)
  const iFar = 5;
  near(r.levelsDbm[iFar] - base.levelsDbm[iFar], 6, 0.3);
  assert.ok(r.levelsDbm.every((v, i) => v >= base.levelsDbm[i] - 1e-9));
  const txOnly = rfSpectrum({ ...p, distortion: { active: true, source: 'tx-limiter', thdPercent: 15, imd3Dbc: -16, clipFraction: 0.1, rxActive: false } });
  assert.deepEqual(txOnly, base);
  // monotonic in imd: stronger IM3 -> more total power
  const tot = (x) => x.levelsDbm.reduce((s, v) => s + pw(v), 0);
  assert.ok(tot(rfSpectrum({ ...p, distortion: { ...d, imd3Dbc: -10 } })) > tot(r));
});

test('mono baseband and distortMpxSpectrum: IM products at 2a-b, 2b-a, b-a with documented levels', () => {
  const spec = { freqKhz: Array.from({ length: 1001 }, (_, i) => i * 0.1), levelDb: new Array(1001).fill(-120), noiseDb: new Array(1001).fill(-120) };
  const d = { active: true, source: 'rx-front-end', thdPercent: 0, imd3Dbc: -30, desenseDb: 0, compressionDb: 1 };
  const r = distortMpxSpectrum(spec, d, [{ name: 'A', freqKhz: 19, levelDb: -20 }, { name: 'B', freqKhz: 32, levelDb: -26 }]);
  const byName = Object.fromEntries(r.products.map((q) => [q.name, q]));
  near(byName['2A-B'].freqKhz, 6, 1e-9); near(byName['2A-B'].levelDb, -23 - 30, 1e-9);
  near(byName['2B-A'].freqKhz, 45, 1e-9);
  near(byName['B-A'].freqKhz, 13, 1e-9); near(byName['B-A'].levelDb, -23 - 36, 1e-9);
  const i = 60; // 6.0 kHz
  near(r.levelDb[i], -53, 0.05, 'product at its bin');
  const m = monoBasebandSpectrum({ kind: 'mic', dataConfig: { enabled: true, subcarrierKHz: 57, injectionFrac: 0.05 }, distortion: { ...d, thdPercent: 5 } });
  const m0 = monoBasebandSpectrum({ kind: 'mic', dataConfig: { enabled: true, subcarrierKHz: 57, injectionFrac: 0.05 } });
  assert.ok(m.products.length >= 1);
  assert.ok(m.levelDb.every((v, k) => v >= m0.levelDb[k] - 1e-9 && Number.isFinite(v)));
});

test('clipSamples: soft clip 3rd harmonic ~ thd; hard clip clips the requested fraction; extremes safe', () => {
  const N = 4096, cyc = 16;
  const sine = Array.from({ length: N }, (_, i) => Math.sin(2 * Math.PI * cyc * i / N));
  const amp = (x, k) => { let re = 0, im = 0; for (let i = 0; i < N; i++) { re += x[i] * Math.cos(2 * Math.PI * k * cyc * i / N); im += x[i] * Math.sin(2 * Math.PI * k * cyc * i / N); } return 2 * Math.hypot(re, im) / N; };
  const y = clipSamples(sine, { mode: 'soft', thdPercent: 2 });
  near(amp(y, 3) / amp(y, 1), 0.02, 0.002, 'third harmonic ratio (tolerance 10 percent relative)');
  assert.ok(amp(y, 2) < 1e-9); // odd symmetry: no even harmonics
  const h = clipSamples(sine, { clipFraction: 0.2 });
  const thr = Math.max(...h);
  const clipped = h.filter((v) => Math.abs(v) >= thr - 1e-12).length / N;
  near(clipped, 0.2, 0.02);
  assert.ok(thr < 1);
  assert.equal(clipSamples([], {}).length, 0);
  assert.ok(clipSamples([NaN, Infinity, 1, -2], { clipFraction: 5, thdPercent: 1e9 }).every(Number.isFinite));
  assert.deepEqual(Array.from(clipSamples([0.5, -0.25], {})), [0.5, -0.25]);
});

test('monotonic with overload: thd and imd3 rise with compression; no NaN for extreme overload inputs', () => {
  let pt = -1, pi = -Infinity;
  for (let c = 0.2; c <= 20; c += 0.4) {
    const pct = Math.min(99, 5 * c);
    const d = distortionFromLink({ overload: { level: 'overload', compressionDb: c, distortionPct: pct, desenseDb: c } });
    assert.ok(d.thdPercent >= pt && d.imd3Dbc >= pi - 1e-9);
    pt = d.thdPercent; pi = d.imd3Dbc;
  }
  for (const v of [NaN, Infinity, -Infinity, 1e12, -1e12]) {
    const d = distortionFromLink({ overload: { level: 'overload', compressionDb: v, distortionPct: v, desenseDb: v }, txOverdriveDb: v, txClipFraction: v });
    for (const k of ['thdPercent', 'imd3Dbc', 'clipFraction', 'desenseDb', 'compressionDb']) assert.ok(Number.isFinite(d[k]), `${k} for ${v}`);
    assert.ok(audioSpectrum({ distortion: d }).levelsDb.every(Number.isFinite));
    assert.ok(rfSpectrum({ carrierMHz: 600, rxLevelDbm: -40, distortion: d }).levelsDbm.every(Number.isFinite));
    assert.ok(monoBasebandSpectrum({ kind: 'iem', stereo: true, distortion: d }).levelDb.every(Number.isFinite));
  }
});
