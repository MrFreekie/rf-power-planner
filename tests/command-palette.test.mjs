// Command palette: fuzzy ranking, categories, recents, item collection, keyboard behaviour and ARIA wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../js/examples.js';
import { TOOLTIPS } from '../js/ui/help.js';
import { fuzzyScore, rankItems, categoryOf, loadRecents, saveRecent, exampleItems, collectToolbarItems, shortcutHint, mountPalette, RECENT_KEY } from '../js/ui/commandPalette.js';

function mkEl(tag) {
  return {
    tag, children: [], attrs: {}, listeners: {}, className: '', _text: '', open: false, focused: 0, style: {}, hidden: false, disabled: false, value: '', id: '',
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }, set textContent(v) { this._text = v; this.children = []; },
    append(...c) { this.children.push(...c); }, remove() {}, setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; }, hasAttribute(k) { return k in this.attrs; },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }, fire(t, ev = {}) { const e = { target: this, preventDefault() { e.defaultPrevented = true; }, ...ev }; for (const f of this.listeners[t] || []) f(e); return e; },
    focus() { this.focused++; if (this.ownerDoc) this.ownerDoc.activeElement = this; }, showModal() { this.open = true; }, close() { if (this.open) { this.open = false; this.fire('close'); } }, scrollIntoView() {}, click() { this.fire('click'); },
    closest() { return null; },
  };
}
function fakeDoc() {
  const doc = { listeners: {}, activeElement: null, dialogs: [] };
  doc.createElement = (t) => { const e = mkEl(t); e.ownerDoc = doc; if (t === 'dialog') doc.dialogs.push(e); return e; };
  doc.body = doc.createElement('body'); doc.getElementById = () => null;
  doc.addEventListener = (t, f) => { (doc.listeners[t] ||= []).push(f); }; doc.removeEventListener = () => {};
  doc.querySelectorAll = (sel) => (sel === 'dialog' ? doc.dialogs : []);
  doc.key = (ev) => { const e = { preventDefault() { e.defaultPrevented = true; }, target: doc.body, ...ev }; for (const f of doc.listeners.keydown || []) f(e); return e; };
  return doc;
}
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const countText = (p) => p.dlg.children.find((c) => c.className === 'cmd-count').textContent;

test('fuzzy: case-insensitive, substring beats scattered letters, all tokens needed', () => {
  assert.ok(fuzzyScore('LAB', 'Coordination lab') > fuzzyScore('coord', 'Coordination lab') - 1000);
  assert.ok(fuzzyScore('spec map', 'Spectrum map') > 0); assert.equal(fuzzyScore('zzz', 'Spectrum map'), -1);
  assert.ok(fuzzyScore('spctm', 'Spectrum map') > 0); assert.equal(fuzzyScore('lab', 'Long cable run loss'), -1); assert.equal(fuzzyScore('', 'x'), 0);
  assert.ok(fuzzyScore('map', 'Spectrum map') > fuzzyScore('map', 'Something with a mapping detail inside'));
  assert.ok(fuzzyScore('tip', 'Walk', 'move the transmitter along a path tip') > 0);
});
test('rankItems puts the best match first and recents first on an empty query', () => {
  const items = [{ id: 'a', label: 'Undo', group: 'C' }, { id: 'b', label: 'Spectrum map', group: 'C' }, { id: 'c', label: 'Coordination lab', group: 'C' }];
  assert.equal(rankItems(items, 'lab')[0].id, 'c'); assert.equal(rankItems(items, 'map')[0].id, 'b'); assert.equal(rankItems(items, 'qqq').length, 0);
  const r = rankItems(items, '', ['c']); assert.equal(r[0].id, 'c'); assert.ok(r[0].recent); assert.equal(r.length, 3);
});
test('categories come from the note prefix, every example gets one', () => {
  assert.equal(categoryOf('Best practice: x'), 'Best practice'); assert.equal(categoryOf('Less ideal fix: x'), 'Less ideal'); assert.equal(categoryOf('Problem: x'), 'Problem'); assert.equal(categoryOf('Compare: x'), 'Compare'); assert.equal(categoryOf('hello'), 'Example');
  const items = exampleItems(EXAMPLES, () => {}); assert.equal(items.length, EXAMPLES.length);
  const cats = new Set(items.map((i) => i.group)); for (const c of ['Best practice', 'Less ideal', 'Problem', 'Compare']) assert.ok(cats.has(`Example · ${c}`), c);
  assert.ok(rankItems(items, 'cable').length > 0);
});
test('recents are stored most recent first, capped, and survive broken storage', () => {
  const s = memStore(); let r = []; for (const id of ['1', '2', '3', '4', '5', '6', '7', '2']) r = saveRecent(s, id, r);
  assert.deepEqual(r, ['2', '7', '6', '5', '4', '3']); assert.deepEqual(loadRecents(s), r);
  s.setItem(RECENT_KEY, '{bad'); assert.deepEqual(loadRecents(s), []);
  assert.deepEqual(loadRecents({ getItem() { throw new Error('no'); } }), []);
  assert.doesNotThrow(() => saveRecent({ setItem() { throw new Error('full'); } }, 'x', []));
});
test('toolbar items skip hidden, disabled and the Find button; hints show shortcuts', () => {
  const mk = (id, text, extra = {}) => { const b = mkEl('button'); b.id = id; b.textContent = text; Object.assign(b, extra); return b; };
  const bs = [mk('btn-undo', 'Undo'), mk('btn-cmd', 'Find'), mk('btn-x', 'Hidden', { hidden: true }), mk('btn-y', 'Off', { disabled: true }), mk('btn-map', 'Spectrum map')];
  const items = collectToolbarItems({ querySelectorAll: () => bs });
  assert.deepEqual(items.map((i) => i.label), ['Undo', 'Spectrum map']); assert.equal(items[0].shortcut, 'Ctrl+Z'); assert.equal(shortcutHint('btn-focus'), 'F');
});
test('help text lists Ctrl+K', () => { assert.match(TOOLTIPS['btn-cmd'], /Ctrl\+K/); });

function mount(items) {
  const doc = fakeDoc(), button = doc.createElement('button'), ran = [], store = memStore();
  const p = mountPalette({ doc, button, storage: store, getItems: () => items.map((it) => ({ ...it, run: () => ran.push(it.id) })) });
  return { doc, button, p, ran, store };
}
const ITEMS = [{ id: 'a', label: 'Spectrum map', group: 'Command' }, { id: 'b', label: 'Coordination lab', group: 'Command', shortcut: 'L' }, { id: 'c', label: 'Measurements', group: 'Command' }];
test('Ctrl+K and / open, Escape closes and focus returns, typing filters with a live count', () => {
  const { doc, p, ran } = mount(ITEMS); const opener = doc.createElement('button'); doc.activeElement = opener;
  doc.key({ key: 'k', ctrlKey: true }); assert.ok(p.isOpen());
  assert.equal(p.input.attrs.role, 'combobox'); assert.equal(p.list.attrs.role, 'listbox');
  assert.equal(p.list.children.length, 3); assert.equal(p.input.attrs['aria-activedescendant'], 'cmd-opt-0');
  assert.ok(p.list.children.every((li) => li.attrs.role === 'option'));
  p.input.value = 'lab'; p.input.fire('input'); assert.equal(p.list.children.length, 1);
  assert.match(countText(p), /1 result$/);
  p.dlg.close(); assert.ok(!p.isOpen()); assert.ok(opener.focused >= 1);
  const e = doc.key({ key: '/' }); assert.ok(p.isOpen()); assert.ok(e.defaultPrevented); p.dlg.close();
  assert.equal(ran.length, 0);
});
test('"/" is ignored while typing or with a modal open; other shortcuts are untouched', () => {
  const { doc, p } = mount(ITEMS);
  doc.key({ key: '/', target: { tagName: 'INPUT' } }); assert.ok(!p.isOpen());
  const other = doc.createElement('dialog'); other.open = true; doc.key({ key: 'k', ctrlKey: true }); assert.ok(!p.isOpen()); other.open = false;
  const z = doc.key({ key: 'z', ctrlKey: true }); assert.ok(!z.defaultPrevented); const b = doc.key({ key: 'b' }); assert.ok(!b.defaultPrevented); assert.ok(!p.isOpen());
});
test('arrows wrap, Home/End jump, Enter runs the highlighted item and remembers it', () => {
  const { doc, p, ran, store } = mount(ITEMS); doc.key({ key: 'k', metaKey: true });
  p.input.fire('keydown', { key: 'ArrowDown' }); assert.equal(p.input.attrs['aria-activedescendant'], 'cmd-opt-1');
  p.input.fire('keydown', { key: 'End' }); assert.equal(p.input.attrs['aria-activedescendant'], 'cmd-opt-2');
  p.input.fire('keydown', { key: 'ArrowDown' }); assert.equal(p.input.attrs['aria-activedescendant'], 'cmd-opt-0');
  p.input.fire('keydown', { key: 'ArrowUp' }); p.input.fire('keydown', { key: 'Home' }); p.input.fire('keydown', { key: 'ArrowDown' });
  p.input.fire('keydown', { key: 'Enter' });
  assert.deepEqual(ran, ['b']); assert.ok(!p.isOpen()); assert.deepEqual(loadRecents(store), ['b']);
  doc.key({ key: 'k', ctrlKey: true }); assert.ok(p.list.children[0].children[1].textContent.startsWith('Recent'));
});
test('no match shows "No results" and Enter does nothing', () => {
  const { doc, p, ran } = mount(ITEMS); doc.key({ key: 'k', ctrlKey: true }); p.input.value = 'zzzz'; p.input.fire('input');
  assert.equal(p.list.children.length, 0); assert.match(countText(p), /No results/);
  p.input.fire('keydown', { key: 'Enter' }); assert.equal(ran.length, 0);
});
