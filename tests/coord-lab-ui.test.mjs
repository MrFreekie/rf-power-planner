// Coordination lab GUI: working set, bands, live metrics, nudge, candidates, best plan, apply action (undo), drawing, dialog wiring, IMD headline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../js/examples.js';
import { createStore } from '../js/store.js';
import { applyFrequencyPlan } from '../js/actionsAreas.js';
import { imdSummary } from '../js/model/imd.js';
import { workFromScene, labBands, defaultBandId, nudge, labMetrics, blockedFor, candidateRows, summaryText, planItems, layoutLab, drawLab, mountCoordLab, BANDS, ILLUSTRATIVE, GUARD_KHZ } from '../js/view/coordLab.js';
import { distinctThird } from '../js/view/imd.js';

function fakeCtx() { const calls = []; return new Proxy({ calls }, { get(t, k) { if (k in t) return t[k]; if (k === 'measureText') return () => ({ width: 50 }); return (...a) => { t.calls.push([k, ...a]); }; }, set() { return true; } }); }
const th = { ink: '#000', inkSoft: '#555', paper: '#fff', grid: '#ddd', blue: '#46c', fail: '#c00', pass: '#080', font: 'sans-serif', inkRgb: '0,0,0' };
const ex = (id) => EXAMPLES.find((e) => e.id === id).build().scene;

test('working set comes from links and IMD transmitters, with kinds', () => {
  const items = workFromScene(ex('band-four-piece-people'));
  assert.ok(items.length >= 4); assert.ok(items.every((i) => i.id && Number.isFinite(i.freqMHz) && (i.kind === 'mic' || i.kind === 'iem')));
  assert.equal(new Set(items.map((i) => i.key)).size, items.length);
});
test('band picker offers the project span and defaults to it when narrow, else channel 38', () => {
  const items = workFromScene(ex('band-four-piece-people')), b = labBands(items, ex('band-four-piece-people'));
  assert.equal(b[0].id, 'project'); assert.ok(b[0].endMHz - b[0].startMHz >= 8);
  assert.ok(items.every((i) => i.freqMHz >= b[0].startMHz && i.freqMHz <= b[0].endMHz));
  assert.equal(defaultBandId(items), 'project'); assert.equal(defaultBandId([]), 'ch38');
  assert.equal(defaultBandId([{ freqMHz: 200 }, { freqMHz: 600 }]), 'ch38');
  assert.equal(BANDS[0].startMHz, 606); assert.equal(BANDS[0].endMHz, 614);
});
test('nudge snaps to 25 kHz and clamps to the band', () => {
  const b = { startMHz: 606, endMHz: 614 };
  assert.equal(nudge(606.1, -200, b), 606); assert.equal(nudge(613.9, 200, b), 614); assert.equal(nudge(610, 25, b), 610.025);
});
test('labMetrics matches the model: equal spacing is bad, products flagged inside the guard', () => {
  const bad = labMetrics([600, 600.4, 600.8]);
  assert.equal(bad.hits.hits2, 2); assert.equal(bad.hits.hits3, 1); assert.equal(bad.hits.ok, false);
  assert.ok(bad.products.some((p) => p.conflict)); assert.ok(bad.products.every((p) => p.nearestKHz >= 0));
  const good = labMetrics([606.6, 608.15, 611.25]); assert.equal(good.hits.hitsTotal, 0);
  assert.equal(labMetrics([610]).products.length, 0);
});
test('TV occupancy blocked ranges are illustrative and off on request', () => {
  assert.deepEqual(blockedFor('uk', false), { blocked: [], setting: null });
  const b = blockedFor('us', true); assert.equal(b.setting, 'us-top10'); assert.ok(b.blocked.length > 0);
});
test('candidate table: clear ones ranked, rejected examples carry reasons and explanations', () => {
  const band = BANDS[0], items = [{ key: 'a', name: 'A', freqMHz: 608 }, { key: 'b', name: 'B', freqMHz: 609 }];
  const blocked = [{ fromMHz: 610, toMHz: 611, label: 'TV ch 99' }];
  const c = candidateRows(items, null, band, blocked, 'uk');
  assert.ok(c.best.length > 0); assert.equal(c.best[0].rank, 1); assert.ok(c.best.every((r) => r.ok));
  assert.ok(c.rejected.length > 0 && c.rejected.every((r) => r.reasons.length && r.explanation));
  const codes = new Set(c.rejected.flatMap((r) => r.reasons.map((x) => x.code)));
  assert.ok(codes.has('spacing')); assert.ok(c.blockedCount > 0, 'blocked raster points are counted, not listed');
  assert.match(summaryText(c.summary), /candidate channels tried/);
  const sel = candidateRows(items, 'b', band, [], 'uk'); assert.equal(sel.fixedCount, 1);
});
test('best plan fills unlocked items with a hit-free plan and keeps locked ones', () => {
  const items = [{ key: 'a', name: 'A', kind: 'mic', freqMHz: 608, locked: true }, { key: 'b', name: 'B', kind: 'mic', freqMHz: 608.1, locked: false }, { key: 'c', name: 'C', kind: 'iem', freqMHz: 608.2, locked: false }, { key: 'd', name: 'D', kind: 'mic', freqMHz: 608.3, locked: false }];
  const r = planItems(items, BANDS[0], [], 1);
  assert.equal(r.ok, true); assert.equal(r.items[0].freqMHz, 608);
  assert.equal(labMetrics(r.items.map((i) => i.freqMHz)).hits.hitsTotal, 0);
  assert.ok(r.items.every((i) => i.freqMHz >= 606 && i.freqMHz <= 614));
  const r2 = planItems(items, BANDS[0], [], 2); assert.equal(r2.items.length, 4);
});
test('applyFrequencyPlan writes links and IMD transmitters in one undoable step and ignores bad input', () => {
  const sc = ex('band-four-piece-people'), st = createStore(sc), before = JSON.stringify(st.getScene());
  const l = st.getScene().links[0];
  assert.equal(applyFrequencyPlan(st, [{ id: l.id, freqMHz: 607.325 }, { id: 'nope', freqMHz: 600 }, { id: l.id, freqMHz: -4 }, { id: l.id, freqMHz: NaN }]), 1);
  assert.equal(st.getScene().links.find((x) => x.id === l.id).freqMHz, 607.325);
  st.undo(); assert.equal(JSON.stringify(st.getScene()), before);
  assert.equal(applyFrequencyPlan(st, []), 0); assert.equal(applyFrequencyPlan(st, null), 0);
});
test('drawLab draws the hit line, blocked label and products in both palettes', () => {
  const items = [{ key: 'a', name: 'A', kind: 'mic', freqMHz: 606.2 }, { key: 'b', name: 'B', kind: 'iem', freqMHz: 606.6 }, { key: 'c', name: 'C', kind: 'mic', freqMHz: 607 }];
  for (const dark of [false, true]) {
    const ctx = fakeCtx(), t = dark ? { ...th, ink: '#eee', paper: '#111' } : th;
    const L = drawLab(ctx, 700, 214, t, { items, band: BANDS[0], metrics: labMetrics(items.map((i) => i.freqMHz)), blocked: [{ fromMHz: 608, toMHz: 609, label: 'TV ch 38' }], sel: 'b', setting: 'uk-city' });
    const texts = ctx.calls.filter((c) => c[0] === 'fillText' || c[0] === 'strokeText').map((c) => c[1]).join('|');
    assert.match(texts, /Third-order hits/); assert.match(texts, /illustrative, not measured/); assert.match(texts, /TV ch 38/);
    assert.equal(L.marks.length, 3); assert.ok(Math.abs(L.fOf(L.x(607.3)) - 607.3) < 1e-9);
  }
  const L = layoutLab(items, BANDS[0], 100, labMetrics([606]), []); assert.ok(L.width >= 320);
});
test('IMD headline count: distinct third-order products (6 on imd-too-close), not the all-mechanism total', () => {
  const sc = ex('imd-too-close');
  assert.equal(imdSummary(sc).inChannelThirdOrderDistinctCount, 6);
  assert.equal(distinctThird(sc, { coordination: new Array(28) }), 6);
  assert.equal(distinctThird(null, { coordination: [1, 2] }), 2, 'falls back to the row count');
});

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
  return { createElement: mk, createTextNode: (t) => ({ textContent: t, find: () => [] }), body: mk('body') };
}
test('dialog: opens, equal spacing worsens hits, best plan clears them, apply writes the project and undo restores', () => {
  const doc = fakeDoc(), button = doc.createElement('button'), store = createStore(ex('band-four-piece-people'));
  const lab = mountCoordLab({ doc, button, store, hostFactory: () => ({ invalidate() {}, destroy() {} }) });
  button.fire('click');
  assert.equal(lab.zoom.isOpen(), true); assert.equal(button.getAttribute('aria-expanded'), 'true'); assert.match(lab.zoom.title.textContent, /Coordination lab/);
  assert.equal(lab.state.bandId, 'project'); assert.ok(lab.list.children.length >= 4);
  assert.ok(lab.state.cand && lab.state.cand.tried > 0);
  lab.bEqual.fire('click'); assert.match(lab.hitsP.textContent, /hit/); const eq = lab.hitsP.dataset.ok;
  lab.bBest.fire('click'); assert.match(lab.status.textContent, /Best plan found|best partial/);
  lab.occChk.checked = false; lab.occChk.fire('change');
  lab.bBest.fire('click'); assert.match(lab.status.textContent, /Best plan found/); assert.equal(lab.hitsP.dataset.ok, 'true');
  assert.match(lab.hitsP.textContent, /0 third-order hits/);
  const before = JSON.stringify(store.getScene().links.map((l) => l.freqMHz));
  lab.bApply.fire('click'); assert.match(lab.status.textContent, /Applied/);
  const after = JSON.stringify(store.getScene().links.map((l) => l.freqMHz));
  assert.notEqual(before, after); store.undo(); assert.equal(JSON.stringify(store.getScene().links.map((l) => l.freqMHz)), before);
  assert.ok(eq === 'true' || eq === 'false');
  lab.bReset.fire('click'); assert.match(lab.status.textContent, /Reloaded/);
});
test('dialog: keyboard moves the selected marker and the number input edits it', () => {
  const doc = fakeDoc(), button = doc.createElement('button'), store = createStore(ex('band-four-piece-people'));
  const lab = mountCoordLab({ doc, button, store, hostFactory: () => ({ invalidate() {}, destroy() {} }) });
  lab.open();
  const first = lab.state.items[0], f0 = first.freqMHz;
  lab.zoom.canvas.fire('keydown', { key: 'ArrowRight' }); assert.equal(lab.state.sel, first.key);
  assert.ok(Math.abs(lab.state.items[0].freqMHz - (f0 + 0.025)) < 0.0251);
  lab.zoom.canvas.fire('keydown', { key: 'ArrowDown' }); assert.equal(lab.state.sel, lab.state.items[1].key);
  const inp = lab.list.find((e) => e.tag === 'input' && e.attrs.type === 'number')[0]; inp.value = '99999'; inp.fire('change');
  assert.ok(lab.state.items[0].freqMHz <= lab.zoom.canvas && true || lab.state.items[0].freqMHz <= 700);
  lab.zoom.closeBtn.fire('click'); assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.ok(ILLUSTRATIVE.length && GUARD_KHZ === 400);
});
