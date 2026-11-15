// Walk-test calibration GUI: delta words and colours, summary and card text, cached compare, chart layout, place mode, report data, dialog flows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../js/examples.js';
import { createStore } from '../js/store.js';
import { deltaView, markerLabel, summaryText, tableRows, cardViews, calibrationNotes, chartLayout, cachedCompare, reportMeasurements, resetCompareCache, deltaColor } from '../js/ui/measureUi.js';
import { startPlace, pickPlace, cancelPlace, isPlacing } from '../js/view/placeMode.js';
import { mountMeasure, drawChart } from '../js/view/measureDialog.js';
import { drawMeasurementsPlan } from '../js/view/measureDraw.js';
import { compareMeasurements, suggestCalibration } from '../js/model/measurements.js';
import { buildReportData } from '../js/reportData.js';

const ex = (id) => EXAMPLES.find((e) => e.id === id).build().scene;
function fakeCtx() { const calls = []; return new Proxy({ calls }, { get(t, k) { if (k in t) return t[k]; if (k === 'measureText') return () => ({ width: 50 }); return (...a) => { calls.push([k, ...a]); }; }, set() { return true; } }); }
const th = { ink: '#000', inkSoft: '#555', paper: '#fff', grid: '#ddd', blue: '#46c', fail: '#c00', pass: '#080', font: 'sans-serif', inkRgb: '0,0,0', dark: false };
function fakeDoc() {
  const mk = (tag) => ({
    tag, children: [], attrs: {}, listeners: {}, className: '', _text: '', open: false, focused: 0, style: {}, disabled: false, checked: false, value: '', dataset: {},
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
    set textContent(v) { this._text = v; this.children = []; },
    append(...c) { this.children.push(...c); }, remove() {},
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    fire(t, ev = {}) { for (const f of this.listeners[t] || []) f({ target: this, preventDefault() {}, stopImmediatePropagation() {}, ...ev }); },
    find(pred, out = []) { if (pred(this)) out.push(this); this.children.forEach((c) => c.find && c.find(pred, out)); return out; },
    focus() { this.focused++; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 214 }),
    showModal() { this.open = true; }, close() { if (this.open) { this.open = false; this.fire('close'); } },
  });
  return { createElement: mk, createTextNode: (t) => ({ textContent: t, find: () => [] }), body: mk('body'), documentElement: mk('html') };
}
const byText = (root, text) => root.find((n) => n.tag === 'button' && n.textContent === text)[0];
const mount = (id) => {
  const doc = fakeDoc(), button = doc.createElement('button'), store = createStore(ex(id));
  const m = mountMeasure({ doc, button, store, hostFactory: () => ({ invalidate() {}, destroy() {} }) });
  return { doc, button, store, m, root: m.zoom.dialog };
};

test('deltaView pairs every colour with a word and the sign', () => {
  assert.equal(deltaView(0.5).sign, 'ok'); assert.match(deltaView(0.5).word, /close/);
  assert.equal(deltaView(4).sign, 'pos'); assert.equal(deltaView(-4).sign, 'neg');
  assert.equal(deltaView(-9).size, 'large'); assert.match(deltaView(-9).label, /much weaker/);
  assert.equal(deltaView(NaN).word, 'no prediction');
  assert.match(markerLabel(-6.2), /weak/); assert.match(markerLabel(7), /strong/); assert.match(markerLabel(0.2), /ok/);
  assert.notEqual(deltaColor(4, false), deltaColor(-4, false)); assert.notEqual(deltaColor(4, true), deltaColor(4, false));
});
test('summary, rows and cards for the body-loss example', () => {
  const s = ex('measurements-body-loss-high'), c = compareMeasurements(s), sug = suggestCalibration(s);
  assert.match(summaryText(c), /12 readings/); assert.match(summaryText(null), /No measurements/);
  const rows = tableRows(s, c); assert.equal(rows.length, s.measurements.length); assert.ok(rows.every((r) => r.predictedDbm != null && r.view.label));
  const cards = cardViews(sug); assert.ok(cards.length >= 1); assert.ok(cards[0].isBest && cards[0].applicable); assert.match(cards[0].change, /→/); assert.match(cards[0].rms, /rms/);
  assert.match(calibrationNotes(sug, c.n).headline, /Best fit/);
});
test('clean match: no calibration needed', () => {
  const s = ex('measurements-clean-match'), sug = suggestCalibration(s);
  assert.match(calibrationNotes(sug, sug.n).headline, /already matches/);
  assert.ok(cardViews(sug).every((c) => !c.isBest));
});
test('too few readings carry a caution', () => {
  const s = ex('measurements-body-loss-high'); s.measurements = s.measurements.slice(0, 3);
  assert.ok(calibrationNotes(suggestCalibration(s), 3).cautions.length >= 1);
});
test('cachedCompare memoises by identity and content', () => {
  resetCompareCache();
  const s = ex('measurements-body-loss-high'), a = cachedCompare(s);
  assert.equal(cachedCompare(s), a);
  const copy = JSON.parse(JSON.stringify(s)); assert.equal(cachedCompare(copy), a);
  const c2 = JSON.parse(JSON.stringify(s)); c2.measurements[0].rxDbm -= 3; assert.notEqual(cachedCompare(c2), a);
  assert.equal(cachedCompare({ ...s, measurements: [] }), null);
});
test('chart layout orders by distance and stays inside the box', () => {
  const s = ex('measurements-body-loss-high'), c = compareMeasurements(s);
  for (const mode of ['order', 'distance']) {
    const L = chartLayout(s, c, mode, 600, 220);
    assert.equal(L.pts.length, c.n); assert.ok(L.pts.every((q) => q.x >= L.x0 - 0.5 && q.x <= L.x1 + 0.5 && q.ym >= L.y0 - 0.5 && q.ym <= L.y1 + 0.5));
    if (mode === 'distance') assert.ok(L.pts.every((q, i, a) => !i || a[i - 1].xv <= q.xv));
  }
  assert.doesNotThrow(() => drawChart(fakeCtx(), 600, 220, th, s, c, 'distance'));
  assert.doesNotThrow(() => drawChart(fakeCtx(), 600, 220, th, { links: [] }, null, 'order'));
});
test('plan markers draw labels and a legend; nothing without readings', () => {
  const s = ex('measurements-body-loss-high'), ctx = fakeCtx();
  const vp = { worldToScreen: (p) => ({ x: 100 + p.x * 20, y: 100 + p.y * 20 }) };
  assert.ok(drawMeasurementsPlan(ctx, th, vp, s, [], 800, 400));
  const texts = ctx.calls.filter((c) => c[0] === 'fillText' || c[0] === 'strokeText').map((c) => c[1]);
  assert.ok(texts.some((t) => /weak|strong|ok/.test(t))); assert.ok(texts.some((t) => /Measured/.test(t)));
  assert.equal(drawMeasurementsPlan(fakeCtx(), th, vp, { ...s, measurements: [] }, [], 800, 400), null);
});
test('place mode delivers one pick, cancel runs its callback', () => {
  let got = null, cancelled = 0;
  startPlace((w) => { got = w; }, { onCancel: () => cancelled++ });
  assert.ok(isPlacing()); assert.ok(pickPlace({ x: 1, y: 2 })); assert.deepEqual(got, { x: 1, y: 2 }); assert.ok(!isPlacing()); assert.equal(pickPlace({ x: 0, y: 0 }), false);
  startPlace(() => {}, { onCancel: () => cancelled++ }); assert.ok(cancelPlace()); assert.equal(cancelled, 1); assert.equal(cancelPlace(), false);
});
test('report data only when readings exist', () => {
  const s = ex('measurements-body-loss-high'), d = buildReportData(s, s.links[0].id, {});
  assert.ok(d.measurements && d.measurements.n === 12 && d.measurements.rows.length === 12);
  assert.equal(reportMeasurements({ ...s, measurements: [] }), null);
});
test('dialog: add, edit, clear with undo, import errors, place on plan', () => {
  const { button, store, m, root } = mount('measurements-body-loss-high');
  button.fire('click');
  assert.ok(m.zoom.isOpen()); assert.equal(button.attrs['aria-expanded'], 'true');
  const n0 = store.getScene().measurements.length;
  assert.equal(root.find((x) => x.tag === 'tr').length, n0 + 1);
  byText(root, 'Add reading').fire('click'); assert.equal(store.getScene().measurements.length, n0 + 1);
  const inp = root.find((x) => x.attrs['aria-label'] === 'Reading 1 measured level, dBm')[0]; inp.value = '-55'; inp.fire('input');
  assert.equal(store.getScene().measurements[0].rxDbm, -55);
  byText(root, 'Clear all').fire('click'); assert.ok(!store.getScene().measurements || store.getScene().measurements.length === 0);
  store.undo();
  assert.equal(store.getScene().measurements.length, n0 + 1);
  const ta = root.find((x) => x.tag === 'textarea')[0]; ta.value = 'x,y,dbm\n1,2,-60\nbad,row';
  byText(root, 'Import').fire('click');
  assert.ok(root.find((x) => x.className === 'meas-errors')[0].children.length >= 1);
  const before = store.getScene().measurements.length;
  byText(root, 'Place on plan').fire('click'); assert.ok(!m.zoom.isOpen()); assert.ok(isPlacing());
  pickPlace({ x: 3, y: 4 }); assert.ok(m.zoom.isOpen()); assert.equal(store.getScene().measurements.length, before + 1);
  m.destroy();
});
test('apply writes the fitted body loss in one undo step', () => {
  const { button, store, m, root } = mount('measurements-body-loss-high');
  button.fire('click');
  const before = store.getScene().environment.bodyLossDb, ap = root.find((x) => x.tag === 'button' && /^Apply /.test(x.textContent))[0];
  assert.ok(ap); ap.fire('click');
  assert.ok(Math.abs(store.getScene().environment.bodyLossDb - before) > 3);
  store.undo(); assert.equal(store.getScene().environment.bodyLossDb, before);
  m.destroy();
});
test('clean match shows no Apply button', () => {
  const { button, m, root } = mount('measurements-clean-match');
  button.fire('click'); assert.equal(root.find((x) => x.tag === 'button' && /^Apply /.test(x.textContent)).length, 0); m.destroy();
});
