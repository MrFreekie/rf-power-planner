// Venue UI: dialog controller behaviour and the plan drawing step. Synthetic fixtures only (real venue files are private).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStore } from '../js/store.js';
import { setVenue, removeVenue, setVenueLayerHidden } from '../js/actions.js';
import { parseVenueText, venueSummary } from '../js/model/venue-underlay.js';
import { createVenueController, venueButtonLabel, importMessage, MAX_VENUE_FILE_BYTES, MSG } from '../js/ui/venue.js';
import { drawVenue, hasVisibleVenue, frameOf, FALLBACK_GREYS } from '../js/view/venueDraw.js';
import { createViewport } from '../js/view/viewport.js';

const FIXTURE = [
  '"; LengthUnit", "m"',
  '"Label", "Wall 01"', '0, 0, 0', '10, 0, 0',
  '"Label", "Wall 02"', '0, 5, 4', '10, 5, 4',
  '"Label", "Seats 1"', '-2, -2, 1', '-2, 2, 1', '2, 2, 1',
  'garbage line',
].join('\r\n');

const deps = { parseVenueText, venueSummary, setVenue, removeVenue, setVenueLayerHidden };
const fileOf = (text, size) => ({ size: size ?? text.length, text: async () => text });
function ctlWith(opts = {}) {
  const store = createStore();
  return { store, ctl: createVenueController({ store, deps, ...opts }) };
}

test('import shows the layer list, counts and a status message', async () => {
  const { store, ctl } = ctlWith();
  assert.equal(ctl.label(), 'Venue');
  assert.equal(ctl.state().hasVenue, false);
  const r = await ctl.importFile(fileOf(FIXTURE));
  assert.equal(r.ok, true);
  const s = ctl.state();
  assert.equal(s.hasVenue, true);
  assert.deepEqual(s.layers.map((l) => l.name), ['Wall', 'Seats']);
  assert.equal(s.message.kind, 'status');
  assert.match(s.message.text, /^Imported 5 lines in 2 layers\. 1 line of the file could not be read and was left out\.$/);
  assert.equal(s.label, 'Venue: 2 of 2 layers on');
  assert.ok(store.getScene().venue);
});

test('unticking a layer flips only that layer and updates the button label', async () => {
  const { store, ctl } = ctlWith();
  await ctl.importFile(fileOf(FIXTURE));
  ctl.setLayerHidden('Seats', true);
  assert.equal(ctl.label(), 'Venue: 1 of 2 layers on');
  assert.deepEqual(ctl.layers().map((l) => l.visible), [true, false]);
  assert.equal(store.getScene().venue.layers[0].hidden, false);
  ctl.setLayerHidden('Seats', false);
  assert.equal(ctl.label(), 'Venue: 2 of 2 layers on');
});

test('label is singular for one layer', () => {
  assert.equal(venueButtonLabel({ layers: [{ name: 'A', hidden: false, shades: [] }] }, venueSummary), 'Venue: 1 of 1 layer on');
  assert.equal(venueButtonLabel(null), 'Venue');
});

test('replace swaps everything including hidden flags; remove clears', async () => {
  const { store, ctl } = ctlWith();
  await ctl.importFile(fileOf(FIXTURE));
  ctl.setLayerHidden('Wall', true);
  await ctl.importFile(fileOf('"; LengthUnit", "m"\n"Label", "Roof 1"\n0,0,0\n1,1,1\n'));
  assert.deepEqual(ctl.layers(), [{ name: 'Roof', lines: 1, visible: true }]);
  assert.match(ctl.state().message.text, /^Imported 1 line in 1 layer\.$/);
  ctl.remove();
  assert.equal(store.getScene().venue, undefined);
  assert.equal(ctl.state().hasVenue, false);
  assert.equal(ctl.label(), 'Venue');
});

test('error messages: wrong unit, no unit, no lines, over 8 MB refused before reading, read failure', async () => {
  const { ctl } = ctlWith();
  let r = await ctl.importFile(fileOf('"; LengthUnit", "ft"\n"Label","A"\n0,0,0\n1,1,1'));
  assert.equal(r.ok, false); assert.match(r.message, /is in ft/);
  assert.equal(ctl.state().message.kind, 'error');
  r = await ctl.importFile(fileOf('"Label","A"\n0,0,0\n1,1,1'));
  assert.match(r.message, /does not say what its length unit is/);
  r = await ctl.importFile(fileOf('"; LengthUnit", "m"\n'));
  assert.match(r.message, /No lines could be read/);
  let read = false;
  r = await ctl.importFile({ size: MAX_VENUE_FILE_BYTES + 1, text: async () => { read = true; return ''; } });
  assert.equal(r.message, MSG.tooBig); assert.equal(read, false);
  r = await ctl.importFile({ size: 10, text: async () => { throw new Error('io'); } });
  assert.equal(r.message, MSG.unreadable);
  r = await ctl.importFile(null);
  assert.equal(r.message, MSG.unreadable);
});

test('a failed import keeps the venue that was already there', async () => {
  const { store, ctl } = ctlWith();
  await ctl.importFile(fileOf(FIXTURE));
  const before = store.getScene().venue;
  await ctl.importFile(fileOf('nonsense'));
  assert.equal(store.getScene().venue, before);
});

test('locked state: import, remove and toggles refuse and change nothing', async () => {
  let locked = false;
  const { store, ctl } = ctlWith({ isLocked: () => locked });
  await ctl.importFile(fileOf(FIXTURE));
  locked = true;
  const v = store.getScene().venue;
  assert.equal((await ctl.importFile(fileOf(FIXTURE))).ok, false);
  assert.equal(ctl.remove().ok, false);
  assert.equal(ctl.setLayerHidden('Wall', true).ok, false);
  assert.equal(store.getScene().venue, v);
  assert.equal(ctl.state().locked, true);
  assert.equal(ctl.state().message.text, MSG.locked);
});

test('importMessage plural forms', () => {
  assert.equal(importMessage(12345, 7, 0), 'Imported 12,345 lines in 7 layers.');
  assert.equal(importMessage(1, 1, 3), 'Imported 1 line in 1 layer. 3 lines of the file could not be read and were left out.');
});

// ---- drawing step ------------------------------------------------------------------------------

function fakeCtx() {
  const calls = [];
  const c = { calls, lineWidth: 0, strokeStyle: '' };
  for (const m of ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'setDash', 'setLineDash']) c[m] = (...a) => calls.push([m, ...a]);
  c.stroke = () => calls.push(['stroke', c.strokeStyle, c.lineWidth]);
  return c;
}
const ul = (layers) => ({ layers });
const layer = (name, steps, hidden = false) => ({ name, hidden, shades: steps.map(([step, edges]) => ({ step, edges })) });
const scene = (venue) => ({ stage: { width: 12, depth: 8 }, venue });

test('hidden layers draw nothing and do no work', () => {
  const vp = createViewport({ pxPerM: 40, origin: { x: 100, y: 100 } });
  const ctx = fakeCtx();
  let called = 0;
  const v = ul([layer('A', [[0, [0, 0, 500, 0]]], true)]);
  assert.equal(hasVisibleVenue(v), false);
  assert.equal(drawVenue(ctx, { dark: false }, vp, scene(v), 800, 600, { segments: () => { called++; return [[], [], [], []]; } }), 0);
  assert.equal(called, 0); assert.equal(ctx.calls.length, 0);
  assert.equal(drawVenue(ctx, { dark: false }, vp, scene(undefined), 800, 600), 0);
});

test('lines wholly outside the frame are dropped and partly inside lines are clipped', () => {
  const vp = createViewport({ pxPerM: 10, origin: { x: 0, y: 0 } }); // frame 0..80 x 0..60 m
  const ctx = fakeCtx();
  // anchor = (6, 8). Venue cm: inside line, outside line (x = +500 m), and a line that leaves the frame to the right
  const v = ul([layer('A', [[0, [0, 0, 100, 0, 50000, 0, 50100, 0, 0, 100, 20000, 100]]])]);
  const n = drawVenue(ctx, { dark: false }, vp, scene(v), 800, 600, { hairline: 1 });
  assert.equal(n, 2);
  const lines = ctx.calls.filter((c) => c[0] === 'lineTo');
  assert.equal(lines.length, 2);
  assert.ok(lines.every((c) => c[1] <= 800 + 1e-6 && c[1] >= 0), 'clipped to the frame');
});

test('shade steps map to greys; dark theme reverses them; hairline width is used', () => {
  const vp = createViewport({ pxPerM: 40, origin: { x: 100, y: 100 } });
  const v = ul([layer('A', [[0, [0, 0, 100, 0]], [3, [0, 100, 100, 100]]])]);
  const run = (dark) => { const ctx = fakeCtx(); drawVenue(ctx, { dark }, vp, scene(v), 800, 600, { hairline: 0.5 }); return ctx.calls.filter((c) => c[0] === 'stroke'); };
  const light = run(false), dark = run(true);
  assert.deepEqual(light.map((c) => c[1]), [FALLBACK_GREYS.light[0], FALLBACK_GREYS.light[3]]);
  assert.deepEqual(dark.map((c) => c[1]), [FALLBACK_GREYS.dark[0], FALLBACK_GREYS.dark[3]]);
  assert.ok(light[0][1] !== dark[0][1]);
  assert.equal(light[0][2], 0.5);
  // darker where lower in light, lighter where lower in dark
  const lum = (h) => parseInt(h.slice(1, 3), 16);
  assert.ok(lum(light[0][1]) < lum(light[1][1])); assert.ok(lum(dark[0][1]) > lum(dark[1][1]));
});

test('drawing never changes the viewport (scale, origin) and adding or hiding a venue leaves the frame alone', () => {
  const vp = createViewport({ pxPerM: 33, origin: { x: 12, y: 34 } });
  const before = JSON.stringify([vp.pxPerM, vp.origin, frameOf(vp, 800, 600)]);
  const v = ul([layer('A', [[0, [0, 0, 100000, 100000]]]), layer('B', [[1, [-500000, 0, 500000, 0]]], true)]);
  drawVenue(fakeCtx(), { dark: false }, vp, scene(v), 800, 600);
  drawVenue(fakeCtx(), { dark: true }, vp, scene(undefined), 800, 600);
  assert.equal(JSON.stringify([vp.pxPerM, vp.origin, frameOf(vp, 800, 600)]), before);
});

test('the plan fit rectangle ignores the venue (plan.js fits the stage only)', () => {
  const src = fs.readFileSync(new URL('../js/view/plan.js', import.meta.url), 'utf8');
  assert.ok(!/venue/i.test(src.replace(/drawVenue|venueDraw/g, '').replace(/\/\/.*venue.*/gi, '')), 'plan.js uses the venue only through drawVenue');
  assert.match(src, /planExtent\(store\.getScene\(\)\)/);
  const ext = fs.readFileSync(new URL('../js/view/planExtent.js', import.meta.url), 'utf8');
  assert.ok(!/venue/i.test(ext.replace(/\/\/.*venue.*/gi, '')), 'planExtent never reads the venue');
});

test('optional: private real venue files import when present', async (t) => {
  const dir = new URL('./private-venues/', import.meta.url);
  if (!fs.existsSync(dir)) return t.skip('no tests/private-venues folder');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt'));
  if (!files.length) return t.skip('no private venue files');
  for (const f of files) {
    const { ctl } = ctlWith();
    const buf = fs.readFileSync(new URL(f, dir));
    const r = await ctl.importFile({ size: buf.length, text: async () => buf.toString('utf8') });
    assert.equal(r.ok, true, f);
  }
});
