// Enlarged spectrum dialog: table alternatives, open/close/focus return/live update under a minimal fake DOM, wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createZoom, decimate } from '../js/view/spectraZoom.js';
import { spectrumTable } from '../js/view/spectra.js';

function fakeDoc() {
  const mk = (tag) => ({
    tag, children: [], attrs: {}, listeners: {}, className: '', _text: '', open: false, focused: 0, removed: false,
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
    set textContent(v) { this._text = v; this.children = []; },
    append(...c) { this.children.push(...c); }, remove() { this.removed = true; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    fire(t, ev = {}) { for (const f of this.listeners[t] || []) f({ target: this, preventDefault() {}, ...ev }); },
    focus() { this.focused++; }, getBoundingClientRect: () => ({ left: 0, width: 800 }),
    showModal() { this.open = true; }, close() { if (this.open) { this.open = false; this.fire('close'); } },
  });
  return { createElement: mk, body: mk('body') };
}
const mkZoom = () => {
  const doc = fakeDoc(), log = { hosts: 0, invalid: 0, draws: [] };
  const z = createZoom({
    doc,
    hostFactory: (c, draw) => { log.hosts++; log.draw = draw; return { invalidate() { log.invalid++; }, destroy() {} }; },
    describe: (id) => ({ title: `T-${id}`, summary: log.sum || 'S0' }),
    table: () => ({ caption: 'c', cols: ['a', 'b'], rows: [['1', '2']] }),
    draw: (...a) => log.draws.push(a),
  });
  return { z, doc, log };
};

test('open shows a modal dialog with title, summary and label; Close and Escape return focus to the plot', () => {
  const { z, log } = mkZoom(), plot = fakeDoc().createElement('canvas');
  z.open('rf', plot);
  assert.equal(z.isOpen(), true); assert.equal(z.title.textContent, 'T-rf'); assert.equal(z.summary.textContent, 'S0');
  assert.match(z.canvas.getAttribute('aria-label'), /T-rf, enlarged\. S0/); assert.equal(z.closeBtn.focused, 1);
  z.closeBtn.fire('click'); assert.equal(z.isOpen(), false); assert.equal(plot.focused, 1);
  z.open('audio', plot); z.dialog.close(); // Escape: the native close event
  assert.equal(plot.focused, 2); assert.equal(z.isOpen(), false); assert.equal(log.hosts, 1, 'one canvas host is reused');
  z.open('mpx', plot); z.dialog.fire('click', { target: z.dialog }); assert.equal(z.isOpen(), false, 'backdrop click closes');
});

test('the dialog follows live changes: summary, aria-label, table and redraw', () => {
  const { z, log } = mkZoom(); z.open('rf', null);
  const before = log.invalid; log.sum = 'S1'; z.update();
  assert.equal(z.summary.textContent, 'S1'); assert.match(z.canvas.getAttribute('aria-label'), /S1/); assert.ok(log.invalid > before);
  z.details.open = true; z.details.fire('toggle'); assert.match(z.details.textContent, /Table of values/); assert.ok(z.details.textContent.includes('c'));
  log.draw({}, 800, 400, {}); assert.equal(log.draws[0][0], 'rf'); assert.equal(log.draws[0][2], 800, 'draws at the large size');
  z.close(); const n = log.invalid; z.update(); assert.equal(log.invalid, n, 'a closed dialog does no work');
});

test('table alternatives for every spectrum and decimation', () => {
  assert.deepEqual(decimate(5), [0, 1, 2, 3, 4]); const d = decimate(1000); assert.equal(d.length, 61); assert.equal(d[60], 999);
  const rf = spectrumTable('rf', { inp: { carrierMHz: 600, subcarriers: [{ name: 'tone', offsetKhz: 32, levelDbm: -70 }] }, s: { freqsMHz: [599.9, 600, 600.1], levelsDbm: [-90, -40, -90], noiseDbm: -100 } });
  assert.equal(rf.rows[1][0], '0 kHz'); assert.ok(rf.rows.some((r) => /tone/.test(r[0]))); assert.match(rf.caption, /600 MHz/);
  const f = Array.from({ length: 200 }, (_, i) => 20 * 10 ** (i / 66)), au = spectrumTable('audio', { a: { freqsHz: f, levelsDb: f.map(() => -30), floorDb: -90 } });
  assert.equal(au.rows.length, 11); assert.deepEqual(au.cols, ['Band', 'Level']);
  const st = spectrumTable('audio', { a: { freqsHz: f, levelsDb: f.map(() => -30), levelsDbR: f.map(() => -32), floorDb: -90 } }); assert.deepEqual(st.cols, ['Band', 'Left', 'Right']);
  const mono = spectrumTable('mpx', { m: { freqKhz: [0, 1, 2], levelDb: [-10, -20, -30] } }); assert.equal(mono.rows.length, 3);
  assert.equal(spectrumTable('mpx', null), null);
});

test('wiring: plots are labelled buttons that open the dialog; the redraw follows the live signals', () => {
  const rd = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const src = rd('js/view/spectra.js'), z = rd('js/view/spectraZoom.js');
  assert.ok(src.includes("role: 'button', 'aria-label': `Enlarge ${sp.label}`")); assert.ok(src.includes('title: `Click or press Enter'));
  assert.ok(src.includes("e.key === 'Enter' || e.key === ' '")); assert.ok(src.includes("addEventListener('click', () => openZoom"));
  assert.ok(src.includes('if (zoom.isOpen())')); assert.ok(z.includes('showModal()')); assert.ok(z.includes("addEventListener('close'"));
  assert.match(rd('css/style.css'), /\.spectrum-dialog \{ width: 90vw/);
});
