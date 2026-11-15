// Review fixes in the GUI layer: measurement dialog state, spectrum map legend and debounce, plan export copy/print/memo, per-link assumptions,
// compare snapshots, cache keys that skip the venue, noise wave caches, palette delegation and source bar writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../js/examples.js';
import { createStore } from '../js/store.js';

const ex = (id) => EXAMPLES.find((e) => e.id === id).build().scene;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fakeDoc() {
  const mk = (tag) => ({
    tag, children: [], attrs: {}, listeners: {}, className: '', _text: '', open: false, focused: 0, style: {}, disabled: false, checked: false, value: '', dataset: {}, hidden: false,
    classes: new Set(), get classList() { const s = this.classes; return { add: (c) => s.add(c), remove: (c) => s.delete(c) }; },
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }, set textContent(v) { this._text = v; this.children = []; },
    append(...c) { this.children.push(...c); }, remove() {}, click() { this.fire('click'); },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    fire(t, ev = {}) { for (const f of this.listeners[t] || []) f({ target: this, preventDefault() {}, stopImmediatePropagation() {}, ...ev }); },
    find(pred, out = []) { if (pred(this)) out.push(this); this.children.forEach((c) => c.find && c.find(pred, out)); return out; },
    focus() { this.focused++; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 214 }),
    showModal() { this.open = true; }, close() { if (this.open) { this.open = false; this.fire('close'); } }, scrollIntoView() {},
  });
  return { createElement: mk, createTextNode: (t) => ({ textContent: t, find: () => [] }), body: mk('body'), documentElement: mk('html'), addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [] };
}
const byText = (root, t) => root.find((n) => n.tag === 'button' && n.textContent === t)[0];
const noHost = () => ({ invalidate() {}, destroy() {} });
/** Record the delays of timers set while fn runs (they still run). */
function recordTimers(fn) {
  const orig = globalThis.setTimeout, seen = [];
  globalThis.setTimeout = (f, ms, ...a) => { seen.push(ms); return orig(f, ms, ...a); };
  try { fn(); } finally { globalThis.setTimeout = orig; }
  return seen;
}

// ---- 1. measurement dialog ---------------------------------------------------------------------------------------------------------------------------
import { mountMeasure } from '../js/view/measureDialog.js';
function mountMeas(id = 'measurements-body-loss-high', suggest) {
  const doc = fakeDoc(), button = doc.createElement('button'), store = createStore(ex(id));
  const m = mountMeasure({ doc, button, store, hostFactory: noHost, ...(suggest ? { suggest } : {}) });
  return { doc, button, store, m, root: m.zoom.dialog };
}
test('measure: the link selector keeps its options and value across refreshes, and rebuilds only when the links change', () => {
  const { store, m, root } = mountMeas();
  store.update((s) => { const l = structuredClone(s.links[0]); l.id = 'second'; l.name = 'Second'; s.links.push(l); });
  m.open();
  const sel = root.find((n) => n.tag === 'select' && n.attrs['aria-label'] === 'Link new readings belong to')[0];
  const first = sel.children.slice(); assert.equal(first.length, 2);
  sel.value = 'second';
  m.refresh(false); m.refresh(true);
  assert.equal(sel.value, 'second'); assert.deepEqual(sel.children, first, 'same option elements, not rebuilt');
  store.update((s) => { s.links[1].name = 'Renamed'; });
  m.refresh(false);
  assert.notDeepEqual(sel.children, first); assert.equal(sel.value, 'second', 'a rebuild keeps the chosen link');
  m.destroy();
});
test('measure: a change event writes the stored (clamped) value back, and a missing measurements list does not throw', () => {
  const { store, m, root } = mountMeas();
  m.open();
  const i = root.find((n) => n.tag === 'input' && n.attrs['aria-label'] === 'Reading 1 measured level, dBm')[0];
  i.value = '9999'; i.fire('input'); i.fire('change');
  assert.equal(i.value, String(store.getScene().measurements[0].rxDbm)); assert.ok(Number(i.value) <= 60, `clamped, got ${i.value}`);
  store.update((s) => { delete s.measurements; });
  i.value = '5'; assert.doesNotThrow(() => i.fire('change'));
  m.destroy();
});

// ---- 6. cache keys skip the venue; throttle; debounced calibration -----------------------------------------------------------------------------------
import { cachedCompare, resetCompareCache, measureSignature } from '../js/ui/measureUi.js';
test('cachedCompare never serialises the venue underlay, and can be throttled during a walk', () => {
  resetCompareCache();
  let calls = 0; const s = ex('measurements-body-loss-high'); s.venue = { toJSON() { calls++; return 'xxxxxxxxxx'; } };
  const a = cachedCompare(s);
  const copy = { ...s, links: structuredClone(s.links) }; assert.equal(cachedCompare(copy), a, 'same content, new object: cache hit');
  assert.equal(calls, 0, 'the venue was not stringified'); assert.ok(!measureSignature(s).includes('xxxx'));
  const { venue, ...rest } = s; const moved = { ...structuredClone(rest) }; moved.links[0].rx.pos.x += 1;
  assert.equal(cachedCompare(moved, { throttleMs: 60000 }), a, 'throttled: previous result while the scene keeps changing');
  assert.notEqual(cachedCompare(moved), a, 'unthrottled: recomputed');
});
test('measure: the calibration fit is immediate once, then debounced about 400 ms, and ignores the venue', async () => {
  let fits = 0; const { store, m } = mountMeas('measurements-body-loss-high', () => { fits++; return null; });
  store.update((s) => { s.venue = { toJSON() { throw new Error('venue stringified'); } }; });
  m.open(); assert.equal(fits, 1);
  for (let k = 1; k <= 3; k++) store.update((s) => { s.measurements[0].rxDbm = -60 - k; });
  m.refresh(false); m.refresh(false); assert.equal(fits, 1, 'no refit while changes keep coming');
  await sleep(550); assert.equal(fits, 2, 'one refit after the pause');
  m.destroy();
});

// ---- 2. spectrum map ---------------------------------------------------------------------------------------------------------------------------------
import { buildMap, mountSpectrumMap } from '../js/view/spectrumMap.js';
import { AXIS_SEGMENTS } from '../js/model/spectrum-map.js';
test('spectrum map: the rise legend is shown only when a rise is on screen', () => {
  const sc = ex('band-four-piece-people'); let none = 0;
  for (const seg of AXIS_SEGMENTS) {
    const n = buildMap({ scene: sc, cw: 800, segId: seg.id }).noise;
    assert.equal(n.riseShown, n.rises.length > 0, `segment ${seg.id}`);
    if (!n.rises.length) none++;
  }
  assert.ok(none > 0, 'at least one segment has no TV channel with a rise');
});
test('spectrum map: store changes refresh once, 120 ms later', () => {
  const doc = fakeDoc(), button = doc.createElement('button'), store = createStore(ex('band-four-piece-people'));
  const m = mountSpectrumMap({ doc, button, store, hostFactory: noHost });
  const delays = recordTimers(() => { for (let k = 0; k < 4; k++) store.update((s) => { s.links[0].freqMHz += 0.025; }); });
  assert.deepEqual(delays.filter((d) => d === 120), [120], 'one 120 ms timer for four changes');
  m.destroy();
});

// ---- 3. plan export ----------------------------------------------------------------------------------------------------------------------------------
import { mountPlanExport, planView } from '../js/view/planExport.js';
test('plan export: csv and text are built lazily', () => {
  const v = planView(ex('band-four-piece-people'), { projectName: 'x' });
  assert.equal(typeof Object.getOwnPropertyDescriptor(v, 'csv').get, 'function'); assert.equal(typeof Object.getOwnPropertyDescriptor(v, 'text').get, 'function');
  assert.equal(v.csv, v.csv); assert.match(v.text, /Frequency plan/);
});
test('plan export: view() is memoised per scene and inputs', () => {
  const doc = fakeDoc(), store = createStore(ex('band-four-piece-people'));
  const m = mountPlanExport({ doc, button: doc.createElement('button'), store, win: {}, hostFactory: noHost });
  assert.equal(m.view(), m.view());
  const a = m.view(); m.st.date = '2030-01-01'; assert.notEqual(m.view(), a);
  const b = m.view(); store.update((s) => { s.links[0].freqMHz += 1; }); assert.notEqual(m.view(), b);
  m.destroy();
});
test('plan export: the copy fallback sits inside the dialog and focus returns to Copy; a failing print cleans up', async () => {
  const doc = fakeDoc(), button = doc.createElement('button'), store = createStore(ex('band-four-piece-people'));
  let insideDialog = null; const removed = [];
  const win = { navigator: { clipboard: { writeText: async () => { throw new Error('denied'); } } }, print() { throw new Error('no print'); }, addEventListener() {}, removeEventListener: (t) => removed.push(t) };
  const m = mountPlanExport({ doc, button, store, win, hostFactory: noHost });
  button.fire('click'); const root = m.zoom.dialog;
  doc.execCommand = () => { insideDialog = root.find((n) => n.tag === 'textarea').length > 0; return true; };
  const copy = byText(root, 'Copy text'); const before = copy.focused;
  await copy.listeners.click[0]();
  assert.equal(insideDialog, true, 'textarea was appended inside the dialog'); assert.equal(copy.focused, before + 1);
  byText(root, 'Print table').fire('click');
  assert.ok(!doc.body.classes.has('plan-print'), 'class removed after a failed print'); assert.deepEqual(removed, ['afterprint']);
  m.destroy();
});
test('plan export: typing in the name field rebuilds the table once, after a pause', () => {
  const doc = fakeDoc(), button = doc.createElement('button'), store = createStore(ex('band-four-piece-people'));
  const m = mountPlanExport({ doc, button, store, win: {}, hostFactory: noHost });
  button.fire('click'); const name = m.zoom.dialog.find((n) => n.tag === 'input' && n.attrs['aria-label'] === 'Project name')[0];
  const delays = recordTimers(() => { for (const v of ['a', 'ab', 'abc']) { name.value = v; name.fire('input'); } });
  assert.ok(delays.filter((d) => d === 150).length >= 1); assert.equal(m.st.name, 'abc');
  m.destroy();
});

// ---- 4. per-link assumptions -------------------------------------------------------------------------------------------------------------------------
import { confidenceView } from '../js/ui/assumptionsUi.js';
import { itemsOfLink } from '../js/model/assumptions-in-use.js';
import { solveLink } from '../js/model/rf.js';
test('confidenceView scores a link on its own items, while `all` is the scene list', () => {
  const sc = ex('band-four-piece-people'), link = sc.links[1] || sc.links[0], res = solveLink(sc, link);
  const v = confidenceView(sc, link, res);
  assert.deepEqual(v.items, itemsOfLink(sc, link, res));
  assert.ok(v.items.every((i) => i.linkIds.length === 1 && i.linkIds[0] === link.id));
  assert.ok(v.all.length >= v.items.length);
});

// ---- 5. compare --------------------------------------------------------------------------------------------------------------------------------------
import { createSnapshots } from '../js/ui/compareUi.js';
import { mountCompare } from '../js/view/compareDialog.js';
test('compare: a scene that could not be restored is not snapshotted', () => {
  const snaps = createSnapshots();
  assert.equal(snaps.take({ links: [] }), null); assert.equal(snaps.take(null), null); assert.equal(snaps.count(), 0);
  assert.ok(snaps.take(ex('band-four-piece-people'))); assert.equal(snaps.count(), 1);
});
test('compare dialog: option lists are rebuilt only when structural, the same snapshot on both sides is not diffed, and an empty scene is refused', () => {
  const doc = fakeDoc(), button = doc.createElement('button'), store = createStore(ex('band-four-piece-people'));
  const m = mountCompare({ doc, button, store, hostFactory: noHost, storage: null, confirm: null, defer: (f) => f() });
  button.fire('click'); const root = m.zoom.dialog;
  byText(root, 'Take snapshot').fire('click');
  const selA = root.find((n) => n.tag === 'select')[0], opts = selA.children.slice();
  m.refresh(false); assert.deepEqual(selA.children, opts, 'no rebuild for a non-structural refresh');
  m.refresh(true); assert.notDeepEqual(selA.children, opts);
  m.st.b = m.st.a; m.compute();
  assert.equal(m.st.diff, null); assert.match(root.find((n) => n.className === 'hint').map((n) => n.textContent).join(' '), /same snapshot/);
  const empty = createStore(ex('band-four-piece-people')); empty.update((s) => { s.links = []; });
  const m2 = mountCompare({ doc: fakeDoc(), button: doc.createElement('button'), store: empty, hostFactory: noHost, storage: null, confirm: null, defer: (f) => f() });
  m2.zoom.open('compare', null); m2.refresh(true);
  byText(m2.zoom.dialog, 'Take snapshot').fire('click'); assert.equal(m2.snaps.count(), 0);
  assert.match(m2.zoom.dialog.find((n) => n.className === 'meas-status')[0].textContent, /Nothing to snapshot/);
  m.destroy(); m2.destroy();
});

// ---- 7. noise waves ----------------------------------------------------------------------------------------------------------------------------------
import { drawNoiseWaves, resetNoiseWaveCaches } from '../js/view/noiseWaves.js';
import { createNoiseSource } from '../js/model/noise-sources.js';
test('noise waves: matchMedia once with a change listener, classification per source object, reflector map per list', () => {
  const saved = globalThis.matchMedia; let mq = 0, listener = null;
  globalThis.matchMedia = () => { mq++; return { matches: false, addEventListener: (t, f) => { listener = f; } }; };
  try {
    resetNoiseWaveCaches();
    const kindReads = { n: 0 }, src = createNoiseSource('led-light-pwm', { pos: { x: 5, y: 5, z: 1 } });
    const watched = new Proxy(src, { get(t, k) { if (k === 'kind') kindReads.n++; return t[k]; } });
    let maps = 0; const reflectors = []; const origMap = reflectors.map.bind(reflectors); reflectors.map = (f) => { maps++; return origMap(f); };
    const scene = { noiseSources: [watched], reflectors };
    const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
    const vp = { pxPerM: 20, worldToScreen: (x, y) => ({ x, y }) }, th = { ink: '#000', inkSoft: '#555', paper: '#fff' }, rip = { settings: { on: true } };
    drawNoiseWaves(ctx, th, vp, scene, 800, 600, rip); const reads = kindReads.n;
    for (let k = 0; k < 5; k++) drawNoiseWaves(ctx, th, vp, scene, 800, 600, rip);
    assert.equal(mq, 1, 'one matchMedia call'); assert.equal(kindReads.n, reads, 'classified once per source object'); assert.equal(maps, 1, 'reflector map built once');
    listener({ matches: true }); // reduced motion switched on: the next frame follows without another matchMedia call
    drawNoiseWaves(ctx, th, vp, scene, 800, 600, rip); assert.equal(mq, 1);
  } finally { globalThis.matchMedia = saved; resetNoiseWaveCaches(); }
});

// ---- 8. palette delegation ---------------------------------------------------------------------------------------------------------------------------
import { mountPalette } from '../js/ui/commandPalette.js';
test('palette: one click and one pointermove listener on the list, and a still pointer does not move the highlight', () => {
  const doc = fakeDoc(); const ran = [];
  const p = mountPalette({ doc, button: doc.createElement('button'), storage: null, getItems: () => ['a', 'b', 'c'].map((id) => ({ id, label: `Item ${id}`, group: 'Command', run: () => ran.push(id) })) });
  p.open();
  const lis = p.list.children; assert.equal(lis.length, 3);
  assert.ok(lis.every((li) => !li.listeners.click && !li.listeners.pointermove), 'no per-option listeners');
  assert.equal(p.list.listeners.click.length, 1); assert.equal(p.list.listeners.pointermove.length, 1);
  p.list.fire('pointermove', { target: lis[2], clientX: 10, clientY: 10 });
  assert.equal(lis[2].attrs['aria-selected'], 'true');
  p.input.fire('keydown', { key: 'ArrowUp' }); assert.equal(lis[1].attrs['aria-selected'], 'true');
  p.list.fire('pointermove', { target: lis[2], clientX: 10, clientY: 10 }); assert.equal(lis[1].attrs['aria-selected'], 'true', 'same position: ignored');
  p.list.fire('pointermove', { target: lis[2], clientX: 11, clientY: 10 }); assert.equal(lis[2].attrs['aria-selected'], 'true');
  p.list.fire('click', { target: lis[0] }); assert.deepEqual(ran, ['a']);
  p.destroy();
});

// ---- 8b. source bar ----------------------------------------------------------------------------------------------------------------------------------
import { mountSourceBar } from '../js/ui/sourceBar.js';
import { createToneState } from '../js/ui/toneState.js';
test('source bar: sync writes the description, title and hidden flags only when they change', () => {
  const doc = fakeDoc(), host = doc.createElement('div');
  const writes = { text: 0, title: 0, hidden: 0 };
  const origCreate = doc.createElement;
  doc.createElement = (t) => {
    const e = origCreate(t);
    let text = '', title = '', hidden = false;
    Object.defineProperty(e, 'textContent', { get: () => text + e.children.map((c) => c.textContent).join(''), set: (v) => { text = v; e.children = []; writes.text++; }, configurable: true });
    Object.defineProperty(e, 'title', { get: () => title, set: (v) => { title = v; writes.title++; }, configurable: true });
    Object.defineProperty(e, 'hidden', { get: () => hidden, set: (v) => { hidden = v; writes.hidden++; }, configurable: true });
    return e;
  };
  const store = createStore(ex('band-four-piece-people'));
  const bar = mountSourceBar({ host, store, tone: createToneState(), doc });
  const base = { ...writes };
  for (let k = 0; k < 5; k++) bar.sync();
  assert.deepEqual(writes, base, 'unchanged scene: no DOM writes');
  bar.destroy();
});
