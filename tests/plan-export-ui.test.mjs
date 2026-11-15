// Frequency plan export GUI: words for flags, coordination lines, CSV options, download and copy wiring, print class.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../js/examples.js';
import { createStore } from '../js/store.js';
import { cellText, coordLines, planView, todayISO, downloadName, mountPlanExport } from '../js/view/planExport.js';
import { PLAN_COLUMNS } from '../js/model/plan-export.js';

const ex = (id) => EXAMPLES.find((e) => e.id === id).build().scene;
function fakeDoc() {
  const mk = (tag) => ({
    tag, children: [], attrs: {}, listeners: {}, className: '', _text: '', open: false, focused: 0, style: {}, disabled: false, checked: false, value: '', dataset: {}, hidden: false,
    classes: new Set(), get classList() { const s = this.classes; return { add: (c) => s.add(c), remove: (c) => s.delete(c) }; },
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }, set textContent(v) { this._text = v; this.children = []; },
    append(...c) { this.children.push(...c); }, remove() {}, click() { this.fire('click'); },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    fire(t, ev = {}) { for (const f of this.listeners[t] || []) f({ target: this, preventDefault() {}, stopImmediatePropagation() {}, ...ev }); },
    find(pred, out = []) { if (pred(this)) out.push(this); this.children.forEach((c) => c.find && c.find(pred, out)); return out; },
    focus() { this.focused++; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 214 }),
    showModal() { this.open = true; }, close() { if (this.open) { this.open = false; this.fire('close'); } },
  });
  return { createElement: mk, body: mk('body'), documentElement: mk('html') };
}
const byText = (root, t) => root.find((n) => n.tag === 'button' && n.textContent === t)[0];

test('cells use words, not codes', () => {
  assert.equal(cellText({ assumptionFlag: 'proven' }, 'assumptionFlag'), 'Proven');
  assert.match(cellText({ assumptionFlag: 'unproven' }, 'assumptionFlag'), /^Unproven/);
  assert.equal(cellText({ role: 'iem' }, 'role'), 'In-ear monitor');
  assert.equal(cellText({ tvChannel: null }, 'tvChannel'), '-');
  assert.equal(cellText({ status: 'pass' }, 'status'), 'Pass');
});
test('planView has every column, the chosen delimiter and BOM, and the bandwidth note', () => {
  const s = ex('band-four-piece-people'), v = planView(s, { projectName: 'Show', date: '2026-11-15', delimiter: 'semicolon', bom: true });
  assert.equal(v.table.cols.length, PLAN_COLUMNS.length); assert.equal(v.table.rows.length, v.rows.length); assert.ok(v.rows.length >= 4);
  assert.ok(v.csv.startsWith('﻿')); assert.ok(v.csv.split('\r\n')[0].includes(';'));
  assert.match(v.text, /Frequency plan: Show/); assert.match(v.text, /2026-11-15/); assert.match(v.text, /inferred/);
  assert.match(v.lines[v.lines.length - 1], /^Verdict/);
  const t = planView(s, { delimiter: 'tab' }); assert.ok(!t.csv.startsWith('﻿')); assert.ok(t.csv.includes('\t'));
});
test('coordination lines name overlapping channels', () => {
  const lines = coordLines({ frequencies: 2, hitsTotal: 0, hits3: 0, hits2: 0, minSpacingKHz: 100, requiredSpacingKHz: 300, spacingViolations: 1, overlapWarnings: [{ a: 'x', b: 'y', separationKHz: 100 }], ok: false }, [{ id: 'x', name: 'Lead' }, { id: 'y', name: 'Bass' }]);
  assert.ok(lines.some((l) => /Lead and Bass are 100 kHz/.test(l))); assert.match(lines[lines.length - 1], /problems/);
});
test('date and file name helpers', () => {
  assert.equal(todayISO(new Date(2026, 10, 5)), '2026-11-05');
  assert.equal(downloadName('My Show / 1', '2026-11-15'), 'My-Show-1-2026-11-15.csv'); assert.equal(downloadName('', ''), 'frequency-plan-plan.csv');
});
test('dialog: opens, lists rows, downloads a Blob, copies, prints and announces', async () => {
  const doc = fakeDoc(), button = doc.createElement('button'), store = createStore(ex('band-four-piece-people'));
  const blobs = [], copied = []; let printed = 0, clicked = 0;
  const win = { Blob: class { constructor(p, o) { blobs.push({ text: p.join(''), type: o.type }); } }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, navigator: { clipboard: { writeText: async (t) => { copied.push(t); } } }, print: () => printed++, addEventListener() {}, removeEventListener() {} };
  const origCreate = doc.createElement; doc.createElement = (t) => { const e = origCreate(t); if (t === 'a') e.click = () => clicked++; return e; };
  const m = mountPlanExport({ doc, button, store, win, now: () => new Date(2026, 10, 15), hostFactory: () => ({ invalidate() {}, destroy() {} }) });
  button.fire('click');
  const root = m.zoom.dialog; assert.ok(m.zoom.isOpen());
  assert.equal(root.find((x) => x.tag === 'th' && x.attrs.scope === 'col').length, PLAN_COLUMNS.length);
  assert.ok(root.find((x) => x.className === 'hint plan-note')[0].textContent.includes('inferred'));
  const sel = root.find((x) => x.tag === 'select')[0]; sel.value = 'semicolon'; sel.fire('change');
  const chk = root.find((x) => x.tag === 'input' && x.attrs.type === 'checkbox')[0]; chk.checked = true; chk.fire('change');
  byText(root, 'Download CSV').fire('click');
  assert.equal(blobs.length, 1); assert.ok(blobs[0].text.startsWith('﻿')); assert.ok(blobs[0].text.includes(';')); assert.match(blobs[0].type, /text\/csv/); assert.equal(clicked, 1);
  assert.match(root.find((x) => x.className === 'meas-status')[0].textContent, /Downloaded .*2026-11-15\.csv/);
  await byText(root, 'Copy text').listeners.click[0](); assert.equal(copied.length, 1); assert.match(copied[0], /Frequency plan/);
  byText(root, 'Print table').fire('click'); assert.equal(printed, 1);
  m.destroy();
});
test('empty project opens without error', () => {
  const doc = fakeDoc(), button = doc.createElement('button'), s = ex('band-four-piece-people'); s.links = []; s.people = []; if (s.imd) s.imd.transmitters = [];
  const m = mountPlanExport({ doc, button, store: createStore(s), win: {}, hostFactory: () => ({ invalidate() {}, destroy() {} }) });
  assert.doesNotThrow(() => button.fire('click')); m.destroy();
});
