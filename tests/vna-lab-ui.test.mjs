// VNA lab: controller (js/ui/vnaState.js), drawing on a fake context, wiring and the keyboard marker handling.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../js/ui/vnaState.js';
import * as V from '../js/model/vna-demo.js';
import { drawRect, drawSmith, drawDtf } from '../js/view/vnaPlots.js';

function fakeCtx() {
  const calls = [];
  return new Proxy({ calls }, { get(t, k) { if (k in t) return t[k]; if (k === 'measureText') return () => ({ width: 10 }); return (...a) => { calls.push([k, ...a]); }; }, set(t, k, v) { t[k] = v; return true; } });
}
const th = { paper: '#fff', paper2: '#eee', ink: '#000', inkSoft: '#555', grid: '#ddd', gridMajor: '#bbb', blue: '#00f', fail: '#f00', pass: '#0a0', marginal: '#fa0', warnText: '#a60', mono: '#999', font: 'sans-serif' };
const texts = (c) => c.calls.filter((x) => x[0] === 'fillText' || x[0] === 'strokeText').map((x) => String(x[1]));
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('every device computes and offers faults plus the measurement mistakes', () => {
  const P = S.defaultState();
  for (const d of ['antenna', 'cable', 'chain', 'standard']) {
    P.device = d; const c = S.compute(P);
    assert.equal(c.traces.rlDb.length, P.sweep.points);
    assert.ok(c.dtf.dtf.distanceM.length > 10);
    assert.ok(S.faultChoices(P).some(([dev]) => dev === 'measurement'), d);
  }
  P.device = 'chain'; assert.ok(S.compute(P).res.s21, 'a chain is a two-port');
  P.device = 'antenna'; assert.equal(S.compute(P).res.s21, null);
});

test('calibration: incomplete steps give raw readings and a warning; complete steps calibrate', () => {
  const P = S.defaultState(); P.device = 'standard';
  assert.equal(S.effectiveCalState(P), 'good');
  S.calReset(P); S.calMeasure(P, 'open');
  assert.equal(S.effectiveCalState(P), 'none');
  const c = S.compute(P);
  assert.ok(c.warnings.some((w) => /incomplete \(1 of 3/.test(w.text)));
  assert.ok(Math.min(...c.traces.rlDb) < 60, 'the raw VNA does not show a perfect load');
  S.calMeasure(P, 'short'); S.calMeasure(P, 'load');
  assert.equal(S.effectiveCalState(P), 'good');
  assert.ok(S.compute(P).traces.rlDb.every((v) => v > 80), 'a calibrated load is a perfect match');
  P.cal.scenario = 'extraCable'; assert.ok(S.compute(P).warnings.some((w) => /extra cable/.test(w.text)));
});

test('port extension by the extra cable delay removes the phase rotation', () => {
  const P = S.defaultState(); P.device = 'standard'; P.standard = 'open'; P.cal.scenario = 'extraCable'; P.cal.extraLengthM = 1;
  const worst = (c) => Math.max(...c.traces.s11PhaseDeg.map(Math.abs));
  const before = worst(S.compute(P));
  P.portExtensionNs = S.extensionForExtraCable(P);
  assert.ok(worst(S.compute(P)) < before / 5);
});

test('faults: the card data, DC warnings, the ideal overlay and the planted distance', () => {
  const P = S.defaultState(); P.device = 'cable'; P.cable.termination = 'through'; P.fault = { id: 'cable-kink', params: { posM: 2 } };
  const c = S.compute(P);
  assert.ok(c.faultApplicable && c.fault.cause && c.fault.symptom && c.fault.cure && c.fault.link);
  assert.ok(c.memory && /ideal/.test(c.memory.label), 'ideal overlay as the memory trace');
  assert.ok(c.dtf.dtf.peaks.some((p) => Math.abs(p.distanceM - 2) < 0.15), 'the DTF peaks at the planted position');
  assert.match(S.faultPositionNote(P, c), /2\.00 m/);
  P.fault = { id: 'meas-dc-live', params: {} };
  const d = S.compute(P);
  assert.ok(d.warnings.some((w) => w.level === 'danger' && /DC/.test(w.text)), 'DC faults are shown as danger');
  P.device = 'antenna'; P.fault = { id: 'ant-broken-short', params: {} };
  assert.ok(S.compute(P).faultApplicable);
  P.device = 'cable'; P.fault = { id: 'ant-hand', params: {} };
  assert.equal(S.compute(P).faultApplicable, false, 'an antenna fault does not apply to a cable');
});

test('hand and wet antennas show the radiation efficiency next to the return loss', () => {
  const P = S.defaultState(); P.antenna.contact = 'skin'; P.antenna.dampness = 'wet'; S.addMarker(P, 600);
  const c = S.compute(P), P0 = S.defaultState(); S.addMarker(P0, 600);
  assert.ok(S.markerRows(P, c)[0].efficiencyDb < -5);
  assert.ok(c.warnings.some((w) => /efficiency/.test(w.text)));
  assert.ok(S.markerTableRows(P, c)[0].efficiency.includes('dB'));
  assert.equal(S.markerRows(P0, S.compute(P0))[0].efficiencyDb, null);
});

test('markers: at most four, clamped to the sweep, keyboard handling', async () => {
  const { handlePlotKey } = await import('../js/view/vnaLab.js');
  const P = S.defaultState(), c = S.compute(P);
  for (let i = 0; i < 6; i++) S.addMarker(P, 100 + i * 100);
  assert.equal(P.markers.length, V.MAX_MARKERS);
  S.setMarker(P, 0, 99999); assert.equal(P.markers[0].fMHz, P.sweep.stopMHz);
  S.selectMarker(P, 1); const f0 = P.markers[1].fMHz;
  assert.ok(handlePlotKey(P, 'ArrowRight', false, c)); assert.ok(P.markers[1].fMHz > f0);
  const f1 = P.markers[1].fMHz; handlePlotKey(P, 'ArrowLeft', true, c); assert.ok(f1 - P.markers[1].fMHz > 5 * (f1 - f0) - 1e-9);
  handlePlotKey(P, 'n', false, c); assert.ok(Math.abs(P.markers[1].fMHz - V.markerSearch(c.traces.fMHz, c.traces.s11Db, 'min').fMHz) < 1e-9);
  assert.ok(handlePlotKey(P, '3', false, c)); assert.equal(P.active, 2);
  assert.ok(handlePlotKey(P, 'Delete', false, c)); assert.equal(P.markers.length, 3);
  assert.equal(handlePlotKey(P, 'q', false, c), false);
  S.setSweepPreset(P, 'ism-2400'); assert.ok(P.markers.every((m) => m.fMHz >= 2300 && m.fMHz <= 2600), 'markers follow the sweep');
});

test('sweep presets cover the UHF mic bands, 1.8 GHz and 2.4 GHz', () => {
  const P = S.defaultState();
  for (const id of ['uhf-470-520', 'uhf-570-608', 'cell-1800', 'ism-2400']) { S.setSweepPreset(P, id); assert.ok(S.compute(P).traces.fMHz[0] >= V.SWEEP_PRESETS[id].startMHz - 1e-9); }
  S.sweepAroundAntenna(P); assert.equal(P.sweep.preset, 'custom');
});

test('drawing: every plot with memory and markers, the Smith chart and distance to fault run on a fake context', () => {
  const P = S.defaultState(); P.device = 'cable'; P.cable.termination = 'through'; P.fault = { id: 'cable-kink', params: {} }; S.addMarker(P, 600);
  const c = S.compute(P);
  for (const p of S.PLOTS) {
    const g = fakeCtx(); drawRect(g, 500, 300, th, S.plotSpec(c.traces, c.memory.traces, p.id), { markers: P.markers, active: 0 });
    assert.ok(g.calls.some((x) => x[0] === 'stroke'), p.id);
  }
  const oc = S.compute(S.defaultState());
  const g2 = fakeCtx(); drawRect(g2, 500, 300, th, S.plotSpec(oc.traces, null, 's21'), {});
  assert.ok(texts(g2).some((t) => /one-port/.test(t)), 'S21 explains why there is no trace');
  const g3 = fakeCtx(); drawSmith(g3, 300, 300, th, c.traces, c.memory.traces, { markers: P.markers, active: 0 });
  assert.ok(texts(g3).some((t) => /Smith chart/.test(t)));
  const g4 = fakeCtx(); drawDtf(g4, 500, 200, th, c.dtf, { faultM: 2.5 });
  assert.ok(texts(g4).some((t) => /planted fault 2\.50 m/.test(t)));
});

test('table alternatives exist for every plot', () => {
  const P = S.defaultState(); P.device = 'cable'; P.cable.termination = 'through'; const c = S.compute(P);
  assert.ok(S.plotTable(S.plotSpec(c.traces, null, 'rl')).length > 50);
  assert.ok(S.smithTable(c.traces).length > 20 && S.dtfTable(c.dtf).length > 20);
  const src = read('js/view/vnaLab.js');
  for (const k of ["'rect'", "'smith'", "'dtf'"]) assert.ok(src.includes(`tableBlock(${k}`), k);
});

test('wiring: toolbar button, section, safety notes from the model, focus trap and Escape', () => {
  const html = read('index.html'), src = read('js/view/vnaLab.js'), app = read('js/app.js');
  assert.match(html, /id="btn-vnalab"[^>]*aria-controls="vnalab"/); assert.match(html, /<section id="vnalab" hidden>/);
  assert.match(app, /mountVnaLab/);
  assert.match(src, /e\.key === 'Escape'/); assert.match(src, /e\.key === 'Tab'/); assert.match(src, /aria-modal/);
  assert.ok(src.includes('V.VNA_CAUTIONS'), 'the safety notes come from the model');
});
