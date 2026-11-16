// GUI for the per-material wall calibration candidate and for the per-channel TV block levels on the spectrum map.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene, createDefaultLink } from '../js/model/scene.js';
import { predictAt, suggestCalibration } from '../js/model/measurements.js';
import { createStore } from '../js/store.js';
import { cardViews, calibrationNotes } from '../js/ui/measureUi.js';
import { mountMeasure } from '../js/view/measureDialog.js';
import { buildMap, mapTable, mountSpectrumMap, infoFor, hitAt, drawMap, tvHoverText } from '../js/view/spectrumMap.js';
import { tvBlockLevelDbm } from '../js/model/spectrum-map.js';

function fakeCtx() { const calls = []; return new Proxy({ calls }, { get(t, k) { if (k in t) return t[k]; if (k === 'measureText') return () => ({ width: 50 }); return (...a) => { calls.push([k, ...a]); }; }, set() { return true; } }); }
const th = { ink: '#000', inkSoft: '#555', paper: '#fff', grid: '#ddd', blue: '#46c', fail: '#c00', warnText: '#a50', font: 'sans-serif', inkRgb: '0,0,0' };
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
    focus() { this.focused++; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }),
    showModal() { this.open = true; }, close() { if (this.open) { this.open = false; this.fire('close'); } },
  });
  return { createElement: mk, createTextNode: (t) => ({ textContent: t, find: () => [] }), body: mk('body'), documentElement: mk('html') };
}
const byText = (root, text) => root.find((n) => n.tag === 'button' && n.textContent === text)[0];

// ---- scene with a brick wall at x=15 and a glass wall at x=30
const omni = () => ({ type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 }, polarisation: 'vertical' });
function room(byMat) {
  const s = createDefaultScene(); s.environment.externalNoise = 0; s.environment.model = 'free-space'; s.environment.bodyLossDb = 0;
  const l = createDefaultLink('p2p'); s.links = [l]; l.freqMHz = 606.1; l.tx.powerDbm = 10; l.chain = [];
  l.tx.pos = { x: 0, y: 0, z: 1.5 }; l.rx.pos = { x: 10, y: 0, z: 1.5 }; l.tx.antenna = omni(); l.rx.antenna = omni();
  s.reflectors = [
    { id: 'wb', name: 'Brick wall', p1: { x: 15, y: -20 }, p2: { x: 15, y: 20 }, zMin: 0, zMax: 4, material: 'brick' },
    { id: 'wg', name: 'Glass wall', p1: { x: 30, y: -20 }, p2: { x: 30, y: 20 }, zMin: 0, zMax: 4, material: 'glass' },
  ];
  if (byMat) s.environment.wallLossAdjustByMaterialDb = byMat;
  return s;
}
function measured(xs) {
  const truth = room({ brick: 8, glass: 3 }), model = room(); const id = model.links[0].id; truth.links[0].id = id;
  model.measurements = xs.map((x, i) => ({ id: `m${i}`, linkId: id, x, y: 0, rxDbm: predictAt(truth, id, { x, y: 0 }) }));
  return model;
}
const MANY = [8, 12, 18, 22, 26, 33, 38, 43, 48, 52];
const FEW = [8, 12, 18, 22, 26, 33, 38, 43];

test('cardViews: per-material candidate has rows and readable text, never [object Object]', () => {
  const sug = suggestCalibration(measured(MANY)), cards = cardViews(sug), v = cards.find((c) => c.id === 'wall-loss-by-material');
  assert.ok(v && v.perMaterial && v.applicable && v.isBest);
  assert.deepEqual(v.materials.map((r) => r.material).sort(), ['brick', 'glass']);
  for (const r of v.materials) { assert.ok(Number.isFinite(r.current) && Number.isFinite(r.fitted) && r.readings >= 3); }
  assert.doesNotMatch(JSON.stringify(cards.map((c) => [c.change, c.rms, c.improvement, c.reason])), /object Object|NaN/);
  assert.match(v.change, /brick .*→.* dB/); assert.equal(v.lowConfidence, '');
  const n = calibrationNotes(sug, sug.n);
  assert.doesNotMatch(n.headline, /object Object|NaN/); assert.match(n.headline, /brick/);
  assert.ok(n.notes.length >= 1 && n.notes.every((t) => typeof t === 'string'));
});
test('single-number candidates render exactly as before', () => {
  const s = measured(MANY); s.reflectors = [s.reflectors[0]]; // one material: per-material candidate not applicable
  const cards = cardViews(suggestCalibration(s)), w = cards.find((c) => c.id === 'wall-loss');
  assert.match(w.change, /^Extra loss per wall crossed: -?\d+\.\d dB → -?\d+\.\d dB$/);
  assert.equal(w.perMaterial, false); assert.deepEqual(w.materials, []); assert.equal(w.lowConfidence, '');
  const pm = cards.find((c) => c.id === 'wall-loss-by-material'); assert.equal(pm.applicable, false); assert.ok(pm.reason);
});
test('low confidence is stated in words', () => {
  const sug = suggestCalibration(measured(FEW)), v = cardViews(sug).find((c) => c.id === 'wall-loss-by-material');
  if (v && v.applicable && sug.candidates.find((c) => c.id === v.id).confidence === 'low') assert.match(v.lowConfidence, /Low confidence/);
  else assert.equal(v.lowConfidence, '');
  const fake = { ...sug, candidates: sug.candidates.map((c) => (c.id === 'wall-loss-by-material' ? { ...c, confidence: 'low' } : c)) };
  assert.match(cardViews(fake).find((c) => c.id === 'wall-loss-by-material').lowConfidence, /Low confidence/);
});

test('measurement dialog: notes, per-material table, apply writes the map and says so', () => {
  const doc = fakeDoc(), button = doc.createElement('button'), store = createStore(measured(MANY));
  const m = mountMeasure({ doc, button, store, hostFactory: () => ({ invalidate() {}, destroy() {} }) });
  m.open();
  const root = m.zoom.dialog, text = root.textContent;
  assert.doesNotMatch(text, /object Object/);
  assert.ok(root.find((n) => n.className === 'meas-notes').length === 1); assert.match(root.find((n) => n.className === 'meas-notes')[0].textContent, /body loss/);
  const tbl = root.find((n) => n.className === 'meas-mat')[0]; assert.ok(tbl);
  const rows = tbl.find((n) => n.tag === 'tr'); assert.equal(rows.length, 3, 'header plus two materials');
  assert.match(tbl.textContent, /brick/); assert.match(tbl.textContent, /glass/);
  const apply = root.find((n) => n.tag === 'button' && /^Apply Extra loss per wall, by wall material/.test(n.textContent))[0]; assert.ok(apply);
  apply.fire('click');
  const w = store.getScene().environment.wallLossAdjustByMaterialDb; assert.ok(Math.abs(w.brick - 8) < 0.5 && Math.abs(w.glass - 3) < 0.5, JSON.stringify(w));
  assert.match(root.find((n) => n.className === 'meas-status')[0].textContent, /applied: brick/);
  m.destroy();
});

// ---- spectrum map TV levels
test('map: overrides change the rise and the legend, table and hover say assumed or set by you', () => {
  const sc = createDefaultScene(), base = buildMap({ cw: 1200, scene: sc });
  const r0 = base.noise.rises[0]; assert.ok(r0 && r0.assumed);
  assert.ok(mapTable(base).rows.some((r) => /^Noise floor rise/.test(r[0]) && /assumed block level/.test(r[2])));
  assert.match(tvHoverText(base, (r0.loMHz + r0.hiMHz) / 2), /\(assumed\)/);
  sc.tvBlockLevelsDbm = { [r0.n]: -40 };
  const m = buildMap({ cw: 1200, scene: sc }), r1 = m.noise.rises.find((r) => r.n === r0.n);
  assert.equal(r1.assumed, false); assert.equal(r1.blockDbm, -40); assert.ok(r1.riseDb > r0.riseDb + 20);
  assert.equal(m.noise.userSetCount, 1); assert.ok(m.noise.assumedCount >= 1);
  assert.ok(mapTable(m).rows.some((r) => /^Noise floor rise, TV ch/.test(r[0]) && r[0].includes(String(r0.n)) && /set by you block level -40 dBm/.test(r[2])));
  assert.match(tvHoverText(m, (r0.loMHz + r0.hiMHz) / 2), /set by you/);
  const others = m.noise.rises.filter((r) => r.n !== r0.n); assert.ok(others.every((r) => r.assumed));
  const calls = fakeCtx(); drawMap(calls, m.width, m.height, th, m, { hoverPx: (r1.px0 + r1.px1) / 2 });
  const texts = calls.calls.filter((c) => c[0] === 'fillText' || c[0] === 'strokeText').map((c) => c[1]).join('|');
  assert.match(texts, /set by you/); assert.match(texts, /assumed/);
});
test('map: a TV channel cell is a hit and its info says assumed or set by you', () => {
  const sc = createDefaultScene(), m = buildMap({ cw: 1200, scene: sc });
  const h = m.hits.find((q) => q.kind === 'tv'); assert.ok(h);
  const hit = hitAt(m, (h.x0 + h.x1) / 2, (h.y0 + h.y1) / 2); assert.equal(hit.kind, 'tv');
  assert.match(infoFor(hit, m).lines.join(' '), /assumed/);
  sc.tvBlockLevelsDbm = { [hit.n]: -55 };
  assert.match(infoFor(hit, buildMap({ cw: 1200, scene: sc })).lines.join(' '), /-55 dBm, set by you/);
});
test('map dialog: set, clear and clear all call the actions; input is labelled and range limited', () => {
  const doc = fakeDoc(), button = doc.createElement('button'), store = createStore(createDefaultScene());
  const mm = mountSpectrumMap({ doc, button, store, hostFactory: () => ({ invalidate() {}, destroy() {} }) });
  mm.open();
  const root = mm.zoom.dialog;
  const chan = root.find((e) => e.tag === 'input' && e.attrs['aria-label'] === 'TV channel number')[0];
  const dbm = root.find((e) => e.tag === 'input' && /^TV block level in dBm/.test(e.attrs['aria-label'] || ''))[0];
  assert.ok(chan && dbm); assert.equal(dbm.attrs.min, '-120'); assert.equal(dbm.attrs.max, '-10');
  const status = root.find((e) => e.className === 'map-tvstatus')[0];
  const setB = byText(root, 'Set level'), clearB = byText(root, 'Clear'), allB = byText(root, 'Clear all');
  assert.equal(allB.disabled, true);
  const legend = root.find((e) => e.className === 'map-legend')[0]; assert.match(legend.textContent, /assumed/); assert.doesNotMatch(legend.textContent, /set by you/);
  chan.value = '34'; chan.fire('change'); assert.match(status.textContent, /Channel 34: -?\d+ dBm, assumed/); assert.equal(clearB.disabled, true);
  dbm.value = '-5'; setB.fire('click'); assert.match(status.textContent, /between -120 and -10/); assert.equal(store.getScene().tvBlockLevelsDbm, undefined);
  dbm.value = '-50'; setB.fire('click');
  assert.equal(store.getScene().tvBlockLevelsDbm[34], -50); assert.match(status.textContent, /set by you/);
  assert.equal(allB.disabled, false); assert.equal(clearB.disabled, false);
  if (mm.map.noise.rises.some((r) => r.n === 34)) assert.match(legend.textContent, /set by you/);
  assert.equal(tvBlockLevelDbm(34, store.getScene().tvBlockLevelsDbm), -50);
  chan.value = '40'; chan.fire('change'); dbm.value = '-60'; setB.fire('click');
  clearB.fire('click'); assert.equal(store.getScene().tvBlockLevelsDbm[40], undefined); assert.equal(store.getScene().tvBlockLevelsDbm[34], -50);
  allB.fire('click'); assert.deepEqual(store.getScene().tvBlockLevelsDbm || {}, {}); assert.equal(allB.disabled, true);
  mm.destroy();
});
test('map dialog: clicking a TV channel selects it in the controls', () => {
  const doc = fakeDoc(), button = doc.createElement('button'), store = createStore(createDefaultScene());
  const mm = mountSpectrumMap({ doc, button, store, hostFactory: () => ({ invalidate() {}, destroy() {} }) });
  mm.open();
  const h = mm.map.hits.find((q) => q.kind === 'tv');
  mm.zoom.canvas.fire('click', { clientX: (h.x0 + h.x1) / 2, clientY: (h.y0 + h.y1) / 2 });
  assert.equal(mm.state.tvSel, h.n);
  assert.equal(mm.zoom.dialog.find((e) => e.tag === 'input' && e.attrs['aria-label'] === 'TV channel number')[0].value, String(h.n));
  assert.match(mm.zoom.dialog.find((e) => e.attrs.role === 'region')[0].textContent, new RegExp(`TV channel ${h.n}`));
  mm.destroy();
});

// ---- review fixes
test('cardViews: a not-applicable per-material card has no placeholder numbers', () => {
  const s = measured(MANY); s.reflectors = [s.reflectors[0]];
  const pm = cardViews(suggestCalibration(s)).find((c) => c.id === 'wall-loss-by-material');
  assert.equal(pm.applicable, false);
  assert.doesNotMatch(pm.change, /→|NaN|-\s*dB/); assert.equal(pm.rms, ''); assert.equal(pm.improvement, '');
  assert.doesNotMatch(JSON.stringify(pm.change), /- dB/);
});
test('map dialog: status message survives the refresh, level box follows the store, typed level kept, non-integer channel reported', () => {
  const doc = fakeDoc(), button = doc.createElement('button'), store = createStore(createDefaultScene());
  const mm = mountSpectrumMap({ doc, button, store, hostFactory: () => ({ invalidate() {}, destroy() {} }) });
  mm.open();
  const root = mm.zoom.dialog;
  const chan = root.find((e) => e.tag === 'input' && e.attrs['aria-label'] === 'TV channel number')[0];
  const dbm = root.find((e) => e.tag === 'input' && /^TV block level in dBm/.test(e.attrs['aria-label'] || ''))[0];
  const status = root.find((e) => e.className === 'map-tvstatus')[0];
  const setB = byText(root, 'Set level');
  chan.value = '34'; chan.fire('change'); dbm.value = '-50'; dbm.fire('input'); setB.fire('click');
  assert.match(status.textContent, /^Channel 34 set to -50 dBm by you\./);
  store.update((s) => s); // any store change: the subscription refresh must not erase the message
  mm.refresh && mm.refresh();
  assert.match(status.textContent, /^Channel 34 set to -50 dBm by you\./);
  // typed level survives a channel change
  dbm.value = '-77'; dbm.fire('input'); chan.value = '40'; chan.fire('change');
  assert.equal(dbm.value, '-77'); assert.doesNotMatch(status.textContent, /set to -50/);
  // non-integer channel is reported, not rounded
  chan.value = '7.5'; chan.fire('change');
  assert.match(status.textContent, /not a TV channel/); assert.equal(mm.state.tvSel, null);
  mm.destroy();
});
