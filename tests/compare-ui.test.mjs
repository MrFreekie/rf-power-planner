// Compare dialog: snapshots (cap, session mirror), memoised diff, throttle, delta words, attribution bars, restore as one undo step, dialog flow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene } from '../js/model/scene.js';
import { createSnapshots, cachedDiff, resetDiffCache, throttled, deltaChip, linkRows, attributionView, itemSections, headline, MAX_SNAPSHOTS, SNAP_KEY } from '../js/ui/compareUi.js';
import { restoreScene } from '../js/actions.js';
import { mountCompare } from '../js/view/compareDialog.js';

function fakeDoc() {
  const mk = (tag) => ({
    tag, children: [], attrs: {}, listeners: {}, className: '', _text: '', open: false, focused: 0, style: {}, disabled: false, checked: false, value: '', hidden: false,
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }, set textContent(v) { this._text = v; this.children = []; },
    append(...c) { this.children.push(...c); }, remove() {}, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }, fire(t, ev = {}) { for (const f of this.listeners[t] || []) f({ target: this, preventDefault() {}, ...ev }); },
    find(pred, out = []) { if (pred(this)) out.push(this); this.children.forEach((c) => c.find && c.find(pred, out)); return out; },
    focus() { this.focused++; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 214 }), showModal() { this.open = true; }, close() { if (this.open) { this.open = false; this.fire('close'); } },
  });
  return { createElement: mk, body: mk('body'), documentElement: mk('html') };
}
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const moved = (scene, x) => { const s = structuredClone(scene); s.links[0].rx.pos.x = x; return s; };
const byText = (root, t) => root.find((n) => n.tag === 'button' && n.textContent === t)[0];

test('snapshots: names, cap of five, independent copies, session mirror of the last one', () => {
  const st = memStore(), snaps = createSnapshots({ storage: st, now: () => new Date(2026, 10, 15, 9, 5) });
  const sc = createDefaultScene(); const a = snaps.take(sc, '  My   plan ');
  assert.equal(a.name, 'My plan'); assert.equal(a.time, '09:05'); assert.equal(a.links, sc.links.length);
  sc.links[0].freqMHz = 999; assert.notEqual(snaps.get(a.id).scene.links[0].freqMHz, 999);
  for (let i = 0; i < 7; i++) snaps.take(sc, `n${i}`);
  assert.equal(snaps.count(), MAX_SNAPSHOTS); assert.ok(!snaps.get(a.id)); assert.ok(st.getItem(SNAP_KEY));
  const again = createSnapshots({ storage: st }); assert.equal(again.count(), 1);
  snaps.clear(); assert.equal(snaps.count(), 0); assert.equal(st.getItem(SNAP_KEY), null);
  assert.doesNotThrow(() => createSnapshots({ storage: { getItem() { throw new Error('x'); } } }));
  assert.doesNotThrow(() => createSnapshots({ storage: { getItem: () => null, setItem() { throw new Error('full'); } } }).take(sc));
});
test('cachedDiff memoises by scene identity; throttled runs at most once per window', async () => {
  resetDiffCache();
  const a = createDefaultScene(), b = moved(a, a.links[0].rx.pos.x + 5);
  const d1 = cachedDiff(a, b); assert.equal(cachedDiff(a, b), d1); assert.notEqual(cachedDiff(a, structuredClone(b)), d1);
  let n = 0; const timers = []; const t = throttled(() => n++, 300, { set: (f, ms) => { timers.push([f, ms]); return timers.length; }, clear() {} });
  t(); t(); t(); assert.equal(timers.length, 1); timers[0][0](); assert.equal(n, 1);
});
test('a moved receiver gives words, a negative chip and attribution bars with text', () => {
  const a = createDefaultScene(), b = moved(a, a.links[0].rx.pos.x + 8), d = cachedDiff(a, b);
  const r = linkRows(d)[0]; assert.match(r.margin, /→/); assert.equal(r.chip.sign, 'neg'); assert.match(r.chip.text, /worse/);
  const at = attributionView(d.links[0]); assert.ok(at && at.bars.length >= 1); assert.match(at.bars[0].text, /dB$/); assert.ok(at.bars[0].frac <= 1 && at.bars[0].frac > 0);
  assert.match(headline(d)[0], /margin falls/);
  assert.equal(deltaChip(0).text, 'no change'); assert.equal(deltaChip(NaN).text, 'not solved'); assert.match(deltaChip(2).text, /better/);
  assert.deepEqual(itemSections(cachedDiff(a, structuredClone(a))), []);
});
test('restoreScene replaces the scene in one undo step and refuses junk', () => {
  const a = createDefaultScene(), store = createStore(a), snap = structuredClone(a);
  store.update((d) => { d.links[0].freqMHz = 700; });
  assert.ok(restoreScene(store, snap)); assert.equal(store.getScene().links[0].freqMHz, snap.links[0].freqMHz);
  store.undo(); assert.equal(store.getScene().links[0].freqMHz, 700);
  assert.equal(restoreScene(store, null), false); assert.equal(restoreScene(store, { links: [] }), false);
});
test('dialog: take, change, compare with current, restore, clear', async () => {
  const doc = fakeDoc(), button = doc.createElement('button'), store = createStore(createDefaultScene());
  const m = mountCompare({ doc, button, store, storage: memStore(), confirm: async () => true, defer: (f) => f(), hostFactory: () => ({ invalidate() {}, destroy() {} }) });
  button.fire('click'); const root = m.zoom.dialog; assert.ok(m.zoom.isOpen());
  assert.match(root.textContent, /Take a snapshot of the scene/);
  const f0 = store.getScene().links[0].rx.pos.x;
  byText(root, 'Take snapshot').fire('click'); assert.equal(m.snaps.count(), 1);
  assert.match(root.find((x) => x.className === 'meas-status')[0].textContent, /taken at/);
  store.update((d) => { d.links[0].rx.pos.x = f0 + 6; }); m.refresh(true);
  assert.ok(root.find((x) => x.className === 'cmp-head').length === 1); assert.match(root.find((x) => x.className === 'cmp-head')[0].textContent, /margin falls/);
  assert.ok(root.find((x) => x.tag === 'th' && x.attrs.scope === 'col').length >= 9); assert.ok(root.find((x) => x.className === 'cmp-bars').length >= 1);
  byText(root, 'Restore snapshot to scene').fire('click'); await new Promise((r) => setTimeout(r, 10));
  assert.equal(store.getScene().links[0].rx.pos.x, f0); store.undo(); assert.equal(store.getScene().links[0].rx.pos.x, f0 + 6);
  byText(root, 'Clear snapshots').fire('click'); assert.equal(m.snaps.count(), 0); m.destroy();
});
