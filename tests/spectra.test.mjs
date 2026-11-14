// Bottom-bar spectrum views: layout logic, pure helpers, the MPX spectrum move and the drawing against the real model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spectraLayout, TABS_BELOW_PX, SPECTRA, nearestIndex, niceTicks, rfInputs, audioInputs, linkDeviationKhz, audioSummary, rfSummary, mpxSummary, drawMpx, drawAudio, drawRf, AUDIO_BANDS, AUDIO_BINS, audioAxis, bandLabel, hzText, nearestBand, pickLabels, logResample } from '../js/view/spectra.js';
import { audioSpectrum, rfSpectrum } from '../js/model/spectrum-views.js';
import { createDefaultScene } from '../js/model/scene.js';
import { solveLink } from '../js/model/rf.js';
import { HELP_SIDEBAR_IDS, HELP_TOPICS } from '../js/ui/help.js';

function fakeCtx() {
  const calls = [];
  const c = new Proxy({ calls }, { get(t, k) { if (k in t) return t[k]; if (k === 'measureText') return () => ({ width: 10 }); return (...a) => { calls.push([k, ...a]); }; }, set(t, k, v) { t[k] = v; return true; } });
  return c;
}
const th = { paper: '#fff', paper2: '#eee', ink: '#000', inkSoft: '#555', grid: '#ddd', blue: '#00f', fail: '#f00', pass: '#0a0', marginal: '#fa0', warnText: '#a60', mono: '#999', font: 'sans-serif' };

test('layout: three spectra, tabs below the threshold, row above', () => {
  assert.deepEqual(SPECTRA.map((s) => s.label), ['Audio spectrum', 'MPX spectrum', 'RF spectrum']);
  assert.equal(spectraLayout(TABS_BELOW_PX - 1), 'tabs');
  assert.equal(spectraLayout(TABS_BELOW_PX), 'row');
  assert.equal(spectraLayout(1000), 'row');
  assert.equal(spectraLayout(0), 'row'); // unmeasured: keep the full row
});

test('helpers: nearestIndex, niceTicks', () => {
  assert.equal(nearestIndex([], 1), -1);
  assert.equal(nearestIndex([0, 1, 2, 3], 1.4), 1);
  assert.equal(nearestIndex([0, 1, 2, 3], 9), 3);
  assert.deepEqual(niceTicks(0, 20, 4), [0, 5, 10, 15, 20]);
  assert.deepEqual(niceTicks(-300, 300, 6), [-300, -200, -100, 0, 100, 200, 300]);
});

test('inputs: deviation from the preset, solved level and noise floor, stereo only with MPX on', () => {
  const sc = createDefaultScene(), link = sc.links[0];
  const r = solveLink(sc, link);
  const inp = rfInputs(sc, link, r, 1.5);
  assert.equal(inp.rxLevelDbm, r.inputPowerDbm);
  assert.equal(inp.noiseFloorDbm, r.cascade.noiseFloorDbm);
  assert.equal(inp.channelBwKhz, r.cascade.bandwidthKHz);
  assert.equal(inp.carrierMHz, link.freqMHz);
  assert.equal(inp.mode, 'fm'); assert.equal(inp.t, 1.5);
  assert.equal(rfInputs(sc, link, null, 0), null);
  assert.equal(linkDeviationKhz({ kind: 'mic' }), 40);
  assert.equal(linkDeviationKhz({ kind: 'iem' }), 48);
  assert.equal(linkDeviationKhz({ kind: 'mic', rx: { rxPreset: 'shure-ur4d' } }), 45);
  assert.equal(audioInputs({ kind: 'mic' }, null, 0).stereo, false);
  assert.equal(audioInputs({ kind: 'iem', mpx: { enabled: true } }, { mode: 'stereo' }, 0).stereo, true);
  assert.equal(audioInputs({ kind: 'iem', mpx: { enabled: true } }, { mode: 'mono' }, 0).stereo, false);
  assert.equal(audioInputs({ kind: 'iem' }, null, 0).kind, 'iem');
});

test('summaries state level, margin, bandwidth and the clipping warning', () => {
  const sc = createDefaultScene(), link = sc.links[0], r = solveLink(sc, link);
  const inp = rfInputs(sc, link, r, 0), s = rfSpectrum(inp);
  const txt = rfSummary(s, inp);
  assert.match(txt, /carrier only/); assert.match(txt, /dBm/); assert.match(txt, /resolution bandwidth/);
  const wide = rfSpectrum({ ...inp, devKhz: 400 });
  assert.equal(wide.clipsAtFilter, true);
  assert.match(rfSummary(wide, { ...inp, devKhz: 400 }), /clipped/);
  assert.match(rfSummary(null, inp), /not available/);
  assert.match(audioSummary(audioSpectrum(audioInputs({ kind: 'mic' }, null, 0)), audioInputs({ kind: 'mic' }, null, 0)), /simulated voice/);
  assert.match(mpxSummary({ mode: 'stereo', pilotLocked: true, cnrDb: 30 }), /STEREO, pilot locked/);
});

test('drawing: audio (mic and stereo IEM), RF (FM and digital, clipping warning) and MPX run on a fake context', () => {
  const sc = createDefaultScene(), link = sc.links[0], r = solveLink(sc, link);
  for (const k of [{ kind: 'mic' }, { kind: 'iem', stereo: true }]) {
    const inp = { ...audioInputs({ kind: k.kind, mpx: { enabled: true } }, null, 0), stereo: !!k.stereo }, a = audioSpectrum(inp);
    const c = fakeCtx(); drawAudio(c, 300, 250, th, a, inp, 100);
    assert.ok(c.calls.some((x) => x[0] === 'stroke'));
  }
  for (const mode of ['fm', 'digital']) {
    const inp = { ...rfInputs(sc, link, r, 0), mode }, s = rfSpectrum(inp);
    const c = fakeCtx(); drawRf(c, 300, 250, th, s, inp, 120);
    assert.ok(c.calls.some((x) => x[0] === 'fillText' || x[0] === 'strokeText'));
  }
  const inp = { ...rfInputs(sc, link, r, 0), devKhz: 400 };
  const c = fakeCtx(); drawRf(c, 300, 250, th, rfSpectrum(inp), inp);
  assert.ok(c.calls.some((x) => String(x[1]).includes('CLIPS AT FILTER')));
  const c2 = fakeCtx(); drawRf(c2, 300, 250, th, null, inp); assert.ok(c2.calls.some((x) => String(x[1]).includes('No received level')));
  const c3 = fakeCtx(); drawMpx(c3, 400, 250, th, { state: { mode: 'stereo', blend: 0, pilotLocked: true, cnrDb: 30, pilotLevelDb: -20 }, link: { id: 'x' } });
  assert.ok(c3.calls.some((x) => String(x[1]).includes('PILOT')));
});

test('the MPX spectrum moved: no spectrum canvas in the MPX panel, drawn in the bottom bar', () => {
  const panel = fs.readFileSync(new URL('../js/view/mpx.js', import.meta.url), 'utf8');
  assert.ok(!/mpx-spec/.test(panel) && !/mpxSpectrum/.test(panel), 'js/view/mpx.js has no spectrum canvas or drawing');
  assert.match(panel, /mpx-meters/); assert.match(panel, /mpx-pilot/); // indicators and meters stay
  const bar = fs.readFileSync(new URL('../js/view/spectra.js', import.meta.url), 'utf8');
  assert.match(bar, /mpxSpectrum\(state/);
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="bottombar"[\s\S]*id="timeline"[\s\S]*id="spectra"/);
});

test('help: the spectra panel has a What\'s this? topic', () => {
  assert.ok(HELP_SIDEBAR_IDS.includes('spectra'));
  assert.ok(HELP_TOPICS.spectra.text.length > 40);
});

test('audio axis: log mapping both ways, 20 Hz to 20 kHz, one decade per 1/3 of the width', () => {
  assert.ok(Math.abs(audioAxis.toX(20) - audioAxis.min) < 1e-12 && Math.abs(audioAxis.toX(20000) - audioAxis.max) < 1e-12);
  for (const f of [20, 31.5, 100, 1000, 12345, 20000]) assert.ok(Math.abs(audioAxis.fromX(audioAxis.toX(f)) - f) < 1e-9 * f);
  const frac = (f) => (audioAxis.toX(f) - audioAxis.min) / (audioAxis.max - audioAxis.min);
  assert.ok(Math.abs(frac(200) - 1 / 3) < 1e-9 && Math.abs(frac(2000) - 2 / 3) < 1e-9); // decades are equal widths
  assert.ok(Math.abs((frac(125) - frac(63)) - (frac(1000) - frac(500))) < 0.01); // octaves are (nearly) equal widths
});

test('audio ticks: ISO octave centres and label strings', () => {
  assert.deepEqual(AUDIO_BANDS, [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
  assert.deepEqual(AUDIO_BANDS.map(bandLabel), ['31.5', '63', '125', '250', '500', '1k', '2k', '4k', '8k', '16k']);
  assert.ok(!AUDIO_BANDS.map(bandLabel).includes('31.50'));
  assert.equal(hzText(63), '63 Hz'); assert.equal(hzText(1000), '1 kHz'); assert.equal(hzText(2500), '2.5 kHz'); assert.equal(hzText(16000), '16 kHz');
  assert.equal(nearestBand(70), 63); assert.equal(nearestBand(900), 1000); assert.equal(nearestBand(20), 31.5); assert.equal(nearestBand(20000), 16000);
});

test('audio labels never overlap and fit inside the plot at 320 px wide', () => {
  for (const pw of [270, 340, 700]) {
    const xOf = (f) => ((audioAxis.toX(f) - audioAxis.min) / (audioAxis.max - audioAxis.min)) * pw;
    const wOf = (s) => s.length * 6.5;
    const chosen = pickLabels(xOf, wOf, 6, AUDIO_BANDS, 0, pw);
    assert.ok(chosen.includes(1000), '1k is always labelled');
    for (let i = 1; i < chosen.length; i++) assert.ok(xOf(chosen[i]) - xOf(chosen[i - 1]) >= (wOf(bandLabel(chosen[i])) + wOf(bandLabel(chosen[i - 1]))) / 2 + 6 - 1e-9);
    for (const f of chosen) { const x = xOf(f), w = wOf(bandLabel(f)); assert.ok(x - w / 2 >= 0 && x + w / 2 <= pw); }
    if (pw >= 700) assert.equal(chosen.length, 10);
  }
});

test('logResample: log-spaced output, keeps peaks, fills the low end by interpolation', () => {
  const freqs = Array.from({ length: 2048 }, (_, i) => (20000 * i) / 2047);
  const levels = freqs.map((f) => (Math.abs(f - 5000) < 6 ? -10 : -60 - f / 1000));
  const r = logResample(freqs, levels, 200);
  assert.equal(r.f.length, 200);
  assert.ok(Math.abs(r.f[0] - 20) < 1e-9 && Math.abs(r.f[199] - 20000) < 1e-6);
  for (let i = 1; i < 200; i++) assert.ok(Math.abs(r.f[i] / r.f[i - 1] - r.f[1] / r.f[0]) < 1e-9); // constant ratio
  assert.ok(Math.max(...r.db) >= -10, 'the narrow peak survives');
  assert.ok(r.db.every(Number.isFinite));
  assert.deepEqual(logResample([], [], 10), { f: [], db: [] });
});

test('audio panel requests enough bins for a log axis and draws the labelled octaves', () => {
  assert.ok(AUDIO_BINS >= 1024);
  assert.equal(audioInputs({ kind: 'mic' }, null, 0).nBins, AUDIO_BINS);
  const inp = audioInputs({ kind: 'mic' }, null, 0), a = audioSpectrum(inp);
  for (const w of [320, 1280]) {
    const c = fakeCtx(); drawAudio(c, w, 250, th, a, inp, 100);
    const texts = c.calls.filter((x) => x[0] === 'fillText').map((x) => x[1]);
    assert.ok(texts.includes('1k'), 'labels 1k');
    assert.ok(!texts.includes('31.50'));
  }
  assert.match(audioSummary(a, inp), /logarithmic axis/);
});
