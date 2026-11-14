import test from 'node:test';
import assert from 'node:assert/strict';
import { audioSpectrum, rfSpectrum, besselJ, carsonBwKhz } from '../js/model/spectrum-views.js';
import { emphasisMagnitudeDb } from '../js/model/audio-processing.js';

const near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, `${m || ''} ${a} vs ${b} (tol ${tol})`);

test('Bessel J: hand values J0(2.4048) = 0, J1(1) = 0.4400505857, J0(0) = 1 (tol 1e-6)', () => {
  near(besselJ(0, 2.404826), 0, 1e-6);
  near(besselJ(1, 1), 0.4400505857, 1e-9);
  near(besselJ(0, 0), 1, 1e-12);
  near(besselJ(2, 8), -0.1129917, 1e-6);
});

test('Carson: 2 (40 + 15) = 110 kHz; 2 (24 + 15) = 78 kHz', () => {
  assert.equal(carsonBwKhz(40, 15), 110);
  const a = rfSpectrum({ carrierMHz: 600, rxLevelDbm: -60, mode: 'fm', devKhz: 40, audioMaxKhz: 15, noiseFloorDbm: -100 });
  assert.equal(a.bwKhz, 110);
  assert.equal(rfSpectrum({ carrierMHz: 600, rxLevelDbm: -60, devKhz: 24, noiseFloorDbm: -100 }).bwKhz, 78);
});

test('window edges, default span, bins, margin', () => {
  const r = rfSpectrum({ carrierMHz: 600, rxLevelDbm: -60, noiseFloorDbm: -100, channelBwKhz: 200 });
  near(r.window.lowMHz, 599.9, 1e-9);
  near(r.window.highMHz, 600.1, 1e-9);
  assert.equal(r.freqsMHz.length, 256);
  assert.equal(r.levelsDbm.length, 256);
  near(r.freqsMHz[255] - r.freqsMHz[0], 0.8, 1e-9); // 4 x 200 kHz
  near(r.freqsMHz[0] + r.freqsMHz[255], 1200, 1e-9); // centred on the carrier
  assert.equal(r.marginToNoiseDb, 40);
  assert.equal(r.carrierLevelDbm, -60);
  assert.equal(r.clipsAtFilter, false); // 110 kHz inside 200
  const wide = rfSpectrum({ carrierMHz: 600, rxLevelDbm: -60, noiseFloorDbm: -100, devKhz: 75, audioMaxKhz: 15, channelBwKhz: 200 });
  assert.equal(wide.bwKhz, 180);
  assert.equal(wide.clipsAtFilter, false);
  assert.equal(rfSpectrum({ carrierMHz: 600, rxLevelDbm: -60, noiseFloorDbm: -100, devKhz: 100, channelBwKhz: 200 }).clipsAtFilter, true); // 230 > 200
  assert.equal(rfSpectrum({ carrierMHz: 600, rxLevelDbm: -60, noiseFloorDbm: -100, mode: 'digital', occupiedBwKhz: 300, channelBwKhz: 200 }).clipsAtFilter, true);
});

test('FM shape: a sideband structure with Carson-edge fall-off and Bessel null of the carrier at beta 2.405', () => {
  // dev 12.024 kHz with fm 5 kHz gives beta = 2.4048: the carrier line is nulled
  const nul = rfSpectrum({ carrierMHz: 600, rxLevelDbm: -50, devKhz: 12.0241, audioMaxKhz: 15, noiseFloorDbm: -120 });
  const c = nul.sidebands.find((s) => s.offsetKhz === 0);
  assert.ok(!c || c.levelDb < -50, 'carrier null');
  const r = rfSpectrum({ carrierMHz: 600, rxLevelDbm: -50, devKhz: 40, audioMaxKhz: 15, noiseFloorDbm: -120 });
  // sidebands: symmetric, sum of line powers = 1 (all power kept in the sidebands list within the -60 dB cut)
  const total = r.sidebands.reduce((s, x) => s + 10 ** (x.levelDb / 10), 0);
  near(total, 1, 0.001, 'power conservation');
  for (const s of r.sidebands) { const m = r.sidebands.find((q) => q.offsetKhz === -s.offsetKhz); near(m.levelDb, s.levelDb, 1e-9); }
  // beta = 8: sidebands extend to about +-(beta + 1) fm = 45 kHz and are far below the peak well past the Carson edge (55 kHz)
  const lvl = (khz) => { const i = r.freqsMHz.findIndex((f) => Math.abs((f - 600) * 1000 - khz) < 2); return r.levelsDbm[i]; };
  const peak = Math.max(...r.levelsDbm);
  assert.ok(lvl(30) > peak - 25, 'inside Carson');
  assert.ok(lvl(150) < peak - 50, 'far outside Carson');
  assert.ok(lvl(80) < lvl(30) - 20, 'skirt falls beyond the Carson edge');
  // the strongest display peak is within the Carson band
  const ip = r.levelsDbm.indexOf(peak);
  assert.ok(Math.abs((r.freqsMHz[ip] - 600) * 1000) <= 55);
});

test('digital: flat top over the occupied bandwidth, level = rx + 10 log10(rbw / B); edges soft; centred', () => {
  const r = rfSpectrum({ carrierMHz: 863, rxLevelDbm: -55, mode: 'digital', occupiedBwKhz: 120, channelBwKhz: 200, noiseFloorDbm: -100 });
  assert.equal(r.bwKhz, 120);
  const want = -55 + 10 * Math.log10(r.rbwKhz / 120);
  const inside = r.levelsDbm.filter((_, i) => Math.abs((r.freqsMHz[i] - 863) * 1000) < 40);
  assert.ok(Math.max(...inside) - Math.min(...inside) < 0.5, 'flat');
  near(inside[0], want, 0.6);
  const outside = r.levelsDbm[r.freqsMHz.findIndex((f) => (f - 863) * 1000 > 90)];
  assert.ok(outside < want - 15, 'drops outside the occupied block');
  assert.equal(r.sidebands.length, 0);
  // default occupied width: 75 percent of the channel
  assert.equal(rfSpectrum({ carrierMHz: 863, rxLevelDbm: -55, mode: 'digital', channelBwKhz: 200, noiseFloorDbm: -100 }).bwKhz, 150);
});

test('noise floor: flat trace is floor + 10 log10(rbw / channel); far from the signal the display sits on it inside the window', () => {
  const r = rfSpectrum({ carrierMHz: 600, rxLevelDbm: -120, noiseFloorDbm: -100, channelBwKhz: 200 });
  near(r.noiseDbm, -100 + 10 * Math.log10(r.rbwKhz / 200), 1e-9);
  assert.equal(r.noiseChannelDbm, -100);
  const inWin = r.levelsDbm.filter((_, i) => r.freqsMHz[i] > r.window.lowMHz + 0.01 && r.freqsMHz[i] < r.window.highMHz - 0.01);
  assert.ok(inWin.length > 40);
  for (const v of inWin) near(v, r.noiseDbm, 1.3, 'ripple only');
  // outside the filter the noise is shaped down
  assert.ok(r.levelsDbm[0] < r.noiseDbm - 40);
  assert.ok(r.levelsDbm[255] < r.noiseDbm - 40);
  // the integrated noise power inside the window is about the stated channel noise (tol 1 dB)
  const binKhz = 800 / 255;
  const p = inWin.reduce((s, v) => s + 10 ** (v / 10), 0) * binKhz / r.rbwKhz;
  near(10 * Math.log10(p) - 10 * Math.log10((inWin.length * binKhz) / 200), -100, 1.3);
});

test('rf determinism: same t repeats, different t differs; mpx-free single carrier output', () => {
  const o = { carrierMHz: 600, rxLevelDbm: -70, noiseFloorDbm: -100 };
  assert.deepEqual(rfSpectrum({ ...o, t: 1.3 }), rfSpectrum({ ...o, t: 1.3 }));
  assert.notDeepEqual(rfSpectrum({ ...o, t: 1.3 }).levelsDbm, rfSpectrum({ ...o, t: 2.9 }).levelsDbm);
  assert.ok(rfSpectrum(o).notes.length >= 1);
});

test('audio: shapes, determinism, bounds', () => {
  const v = audioSpectrum({ kind: 'mic' });
  assert.equal(v.freqsHz.length, 256);
  assert.equal(v.freqsHz[255], 20000);
  assert.equal(v.levelsDbR, null);
  assert.equal(v.floorDb, -90);
  assert.ok(v.peakHz >= 80 && v.peakHz <= 3000, String(v.peakHz));
  assert.ok(v.levelsDb.every((x) => x <= 0 && x >= -90));
  const at = (s, hz) => s.levelsDb[Math.round(hz / 20000 * 255)];
  assert.ok(at(v, 300) > at(v, 15000) + 40, 'steep above 8 kHz');
  assert.ok(at(v, 6000) > at(v, 12000) + 10, 'sibilance region above the 12 kHz tail');
  assert.deepEqual(audioSpectrum({ kind: 'mic', t: 3.7 }), audioSpectrum({ kind: 'mic', t: 3.7 }));
  assert.notDeepEqual(audioSpectrum({ kind: 'mic', t: 3.7 }).levelsDb, audioSpectrum({ kind: 'mic', t: 5.1 }).levelsDb);
});

test('audio: stereo L and R differ, mono has no R; mic differs from iem; FM stereo cuts above 15 kHz', () => {
  const st = audioSpectrum({ kind: 'iem', stereo: true, t: 2 });
  assert.equal(st.levelsDbR.length, 256);
  const diff = st.levelsDb.reduce((s, x, i) => s + Math.abs(x - st.levelsDbR[i]), 0) / 256;
  assert.ok(diff > 2, 'mean |L-R| ' + diff);
  assert.ok(Math.max(...st.levelsDb.map((x, i) => Math.abs(x - st.levelsDbR[i]))) > 8, 'wide difference somewhere');
  const mono = audioSpectrum({ kind: 'iem', stereo: false, t: 2 });
  assert.equal(mono.levelsDbR, null);
  const mic = audioSpectrum({ kind: 'mic', t: 2 });
  const d2 = mic.levelsDb.reduce((s, x, i) => s + Math.abs(x - mono.levelsDb[i]), 0) / 256;
  assert.ok(d2 > 3, 'mic vs iem ' + d2);
  const at = (s, hz) => s.levelsDb[Math.round(hz / 20000 * 255)];
  assert.ok(at(st, 17000) < at(st, 12000) - 30, 'cut above 15 kHz');
  assert.ok(at(st, 16000) < at(mono, 16000) - 15, 'stereo cut deeper than mono at 16 kHz');
  assert.ok(at(st, 80) > at(st, 8000), 'strong bass');
});

test('audio: pre-emphasis boost at 10 kHz equals emphasisMagnitudeDb; de-emphasised view is flat again', () => {
  const base = audioSpectrum({ kind: 'mic', nBins: 201, t: 1 });
  for (const tau of [50, 75]) {
    const pre = audioSpectrum({ kind: 'mic', nBins: 201, t: 1, preEmphasisTauUs: tau });
    assert.equal(pre.freqsHz[100], 10000);
    near(pre.levelsDb[100] - base.levelsDb[100], emphasisMagnitudeDb(10000, tau, 'pre'), 1e-9);
    const back = audioSpectrum({ kind: 'mic', nBins: 201, t: 1, preEmphasisTauUs: tau, deEmphasised: true });
    assert.deepEqual(back.levelsDb, base.levelsDb);
  }
  // 50 us: 10 log10(1 + (10 / 3.183)^2) = 10.4 dB (hand value, tol 0.05)
  near(emphasisMagnitudeDb(10000, 50, 'pre'), 10.4, 0.05);
});
