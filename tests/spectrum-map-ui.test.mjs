// Spectrum map GUI: axis view maths, layout, hit-testing, info panel, overlap warning, TV width action, drawing, dialog wiring (fake DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../js/examples.js';
import { createStore } from '../js/store.js';
import { createDefaultScene } from '../js/model/scene.js';
import { setTvChannelWidth } from '../js/actionsAreas.js';
import { AXIS_TOTAL_PX, AXIS_SEGMENTS } from '../js/model/spectrum-map.js';
import { mapView, fToPx, pxToF, pieces, packLanes, tickStep, buildMap, hitAt, infoFor, mapTable, drawMap, mountSpectrumMap, regionsFor, occupancyChoices, PAD, REGION_NOTE, ILLUSTRATIVE } from '../js/view/spectrumMap.js';

function fakeCtx() { const calls = []; return new Proxy({ calls }, { get(t, k) { if (k in t) return t[k]; if (k === 'measureText') return () => ({ width: 50 }); return (...a) => { t.calls.push([k, ...a]); }; }, set() { return true; } }); }
const th = { ink: '#000', inkSoft: '#555', paper: '#fff', grid: '#ddd', blue: '#46c', fail: '#c00', warnText: '#a50', font: 'sans-serif', inkRgb: '0,0,0' };
const scene = () => EXAMPLES.find((e) => e.id === 'band-four-piece-people').build().scene;

test('overview view spans the model axis; zoom view fills the width', () => {
  const v = mapView(null, 400);
  assert.equal(v.segments.length, AXIS_SEGMENTS.length); assert.ok(v.width >= AXIS_TOTAL_PX + 2 * PAD);
  const z = mapView('E', 1000), s = z.segments[0];
  assert.equal(z.segId, 'E'); assert.ok(Math.abs(s.px1 - s.px0 - (1000 - 2 * PAD)) < 1e-6);
  assert.equal(mapView('nope', 500).segId, null);
});
test('fToPx and pxToF are inverse inside a segment and null in a gap', () => {
  for (const view of [mapView(null, 800), mapView('C', 900)]) {
    const f = view.segId ? 200 : 606;
    const x = fToPx(f, view); assert.ok(Math.abs(pxToF(x, view) - f) < 1e-9);
  }
  assert.equal(fToPx(300, mapView(null)), null); assert.equal(fToPx(606, mapView('C', 800)), null);
  const b = mapView(null).breaks[0]; assert.equal(pxToF((b.px0 + b.px1) / 2, mapView(null)), null);
});
test('pieces clip to visible segments and split across gaps', () => {
  const v = mapView(null);
  assert.equal(pieces(100, 180, v).length, 3, 'FM end, airband and band III start');
  assert.equal(pieces(300, 400, v).length, 0);
  assert.equal(pieces(606, 614, mapView('E', 800)).length, 1);
});
test('packLanes avoids overlap and tickStep keeps 56 px', () => {
  const it = [{ x0: 0, x1: 50 }, { x0: 10, x1: 60 }, { x0: 60, x1: 90 }];
  assert.equal(packLanes(it), 2); assert.equal(it[0].lane, 0); assert.equal(it[1].lane, 1); assert.equal(it[2].lane, 0);
  assert.ok(tickStep(4.2) * 4.2 >= 56); assert.ok(tickStep(40) * 40 >= 56);
});
test('buildMap overview has PMSE bands, TV row with zebra occupancy, Wi-Fi and strip rows, and a hit list', () => {
  const m = buildMap({ scene: scene(), cw: 400 });
  assert.ok(m.bands.some((b) => b.band.group === 'pmse'));
  assert.ok(m.tv.chans.length > 20); assert.ok(m.tv.chans.some((c) => c.occupied)); assert.equal(m.tv.occupancy.illustrative, true);
  assert.ok(m.wifi.rows.every((r) => r.name)); assert.ok(m.strip.items.length >= 2);
  assert.equal(m.hits.filter((h) => h.kind === 'segment').length, AXIS_SEGMENTS.length);
  assert.ok(m.height > 300 && m.width >= AXIS_TOTAL_PX);
  assert.equal(buildMap({ scene: scene(), cw: 400, showTv: false }).tv, null);
  assert.ok(buildMap({ scene: scene(), cw: 400, showOcc: false }).tv.chans.every((c) => !c.occupied));
});
test('hit-testing finds a band and a segment header; info shows flag and the regional note', () => {
  const m = buildMap({ scene: scene(), cw: 400 });
  const bh = m.hits.find((h) => h.kind === 'band' && h.id === 'uhf-pmse-470-606');
  const hit = hitAt(m, (bh.x0 + bh.x1) / 2, (bh.y0 + bh.y1) / 2);
  assert.equal(hit.kind, 'band');
  const info = infoFor(hit, m);
  assert.equal(info.flag, 'I'); assert.ok(info.lines.includes(REGION_NOTE));
  assert.match(info.lines.join(' '), /Regional rules differ/); assert.match(info.lines.join(' '), /Confidence flag I/);
  const sh = m.hits.find((h) => h.kind === 'segment' && h.id === 'E'); assert.equal(hitAt(m, (sh.x0 + sh.x1) / 2, 10).kind, 'segment');
  assert.equal(hitAt(m, -50, -50), null); assert.equal(infoFor(null, m), null);
});
test('region follows the TV width: UK bands for 8 MHz, US bands for 6 MHz', () => {
  const sc = scene(); sc.tvChannelWidthMHz = 6;
  const m = buildMap({ scene: sc, cw: 400 });
  assert.ok(m.bands.some((b) => b.band.region === 'us')); assert.ok(m.bands.every((b) => regionsFor(6).includes(b.band.region)));
  assert.equal(m.tvWidth, 6); assert.ok(m.tv.chans.every((c) => c.ch.n >= 14 && c.ch.n <= 51));
  assert.deepEqual(occupancyChoices(6).sort(), ['us-mid', 'us-rural', 'us-top10']);
});
test('setTvChannelWidth writes 6 or 8 through the store, ignores others, and is undoable', () => {
  const st = createStore(createDefaultScene());
  assert.equal(setTvChannelWidth(st, 6), true); assert.equal(st.getScene().tvChannelWidthMHz, 6);
  assert.equal(setTvChannelWidth(st, 7), false); assert.equal(setTvChannelWidth(st, '8'), false); assert.equal(st.getScene().tvChannelWidthMHz, 6);
  assert.equal(setTvChannelWidth(st, 8), true); assert.equal(st.getScene().tvChannelWidthMHz, 8);
  st.undo(); assert.equal(st.getScene().tvChannelWidthMHz, 6);
});
test('project frequencies become markers; close ones raise an overlap warning', () => {
  const sc = scene();
  assert.ok(sc.links.length >= 2);
  sc.links[1].freqMHz = sc.links[0].freqMHz + 0.1;
  const m = buildMap({ scene: sc, cw: 400, segId: null });
  assert.ok(m.overlaps.length >= 1); assert.ok(m.markers.some((k) => k.over));
  assert.ok(mapTable(m).rows.some((r) => /overlap warning/.test(r[2])));
  const z = buildMap({ scene: sc, cw: 800, segId: 'M' }); assert.equal(z.markers.length, 0); assert.ok(z.offAxis.length >= 1);
});
test('table alternative lists bands and labels simulated data as illustrative', () => {
  const t = mapTable(buildMap({ scene: scene(), cw: 400 }));
  assert.deepEqual(t.cols, ['Item', 'Frequency', 'Note']);
  assert.ok(t.rows.some((r) => r[0].startsWith('TV channels') && r[2].includes(ILLUSTRATIVE)));
  assert.ok(t.rows.some((r) => r[0].startsWith('Noise floor') && r[2].includes(ILLUSTRATIVE)));
});
test('drawMap draws the labels and captions in light and dark palettes without throwing', () => {
  for (const dark of [false, true]) {
    const ctx = fakeCtx(), t = dark ? { ...th, ink: '#eee', paper: '#111' } : th;
    for (const segId of [null, 'E', 'L']) { const m = buildMap({ scene: scene(), cw: 900, segId }); drawMap(ctx, m.width, m.height, t, m, { hoverPx: 100, selected: 'uhf-ch38' }); }
    const texts = ctx.calls.filter((c) => c[0] === 'fillText' || c[0] === 'strokeText').map((c) => c[1]).join('|');
    assert.match(texts, /illustrative, not measured/); assert.match(texts, /Simulated noise floor/); assert.match(texts, /DAB/);
  }
});

// ---- dialog wiring under a minimal fake DOM
function fakeDoc() {
  const mk = (tag) => ({
    tag, children: [], attrs: {}, listeners: {}, className: '', _text: '', open: false, focused: 0, style: {}, disabled: false, checked: false, value: '',
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
  return { createElement: mk, createTextNode: (t) => ({ textContent: t, find: () => [] }), body: mk('body') };
}
test('dialog: opens from the button, radios write the scene, segment buttons zoom, back returns, band info shows the flag', () => {
  const doc = fakeDoc(), button = doc.createElement('button'), store = createStore(scene());
  let draw = null;
  const mm = mountSpectrumMap({ doc, button, store, hostFactory: (c, d) => { draw = d; return { invalidate() {}, destroy() {} }; } });
  button.fire('click');
  assert.equal(mm.zoom.isOpen(), true); assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.match(mm.zoom.title.textContent, /Spectrum map/); assert.match(mm.zoom.summary.textContent, /illustrative, not measured/);
  const dlg = mm.zoom.dialog;
  const radio6 = dlg.find((e) => e.tag === 'input' && e.attrs.type === 'radio' && e.attrs.value === '6')[0];
  radio6.fire('change'); assert.equal(store.getScene().tvChannelWidthMHz, 6); assert.equal(mm.map.tvWidth, 6);
  const segBtn = dlg.find((e) => e.tag === 'button' && /^E 470-698/.test(e.textContent))[0];
  segBtn.fire('click'); assert.equal(mm.state.segId, 'E'); assert.match(mm.zoom.title.textContent, /segment E/);
  const back = dlg.find((e) => e.tag === 'button' && e.textContent === 'All bands')[0];
  assert.equal(back.disabled, false); back.fire('click'); assert.equal(mm.state.segId, null); assert.equal(back.disabled, true);
  const bandBtn = dlg.find((e) => e.tag === 'button' && /^[SIU] [A-Za-z]/.test(e.textContent))[0];
  bandBtn.fire('click');
  const infoText = dlg.find((e) => e.attrs.role === 'region')[0].textContent;
  assert.match(infoText, /Flag [SIU]/); assert.match(infoText, /Regional rules differ/);
  draw(fakeCtx(), 800, mm.map.height, th);
  button.focused = 0; mm.zoom.closeBtn.fire('click'); assert.equal(button.focused, 1); assert.equal(button.getAttribute('aria-expanded'), 'false');
});
test('dialog: overlap warning text appears and the 0 key returns to the overview', () => {
  const doc = fakeDoc(), button = doc.createElement('button'), sc = scene(); sc.links[1].freqMHz = sc.links[0].freqMHz + 0.05;
  const store = createStore(sc);
  const mm = mountSpectrumMap({ doc, button, store, hostFactory: () => ({ invalidate() {}, destroy() {} }) });
  mm.open();
  assert.match(mm.zoom.dialog.find((e) => e.className === 'map-warn')[0].textContent, /Overlap warning/);
  mm.zoomTo('C'); mm.zoom.canvas.fire('keydown', { key: '0' }); assert.equal(mm.state.segId, null);
});
