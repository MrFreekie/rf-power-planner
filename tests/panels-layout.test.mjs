import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normaliseState, loadState, saveState, togglePanel, toggleFocus, shortcutFor, STORE_KEY } from '../js/ui/panels.js';
import { yForDbm, dbmForY, squelchKeyStep, barArea, barList, barColumns, RF_RANGE } from '../js/view/meters.js';
import { setSquelchThreshold } from '../js/actions.js';
import { createStore } from '../js/store.js';
import { createDefaultScene } from '../js/model/scene.js';
import { slotMode } from '../js/view/spectra.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

test('panel state: defaults, toggle, focus restore', () => {
  let s = normaliseState(null);
  assert.deepEqual([s.left, s.right, s.bottom, s.focus], [false, false, false, null]);
  s = togglePanel(s, 'left'); assert.equal(s.left, true);
  s = toggleFocus(s); assert.deepEqual([s.left, s.right, s.bottom], [true, true, true]);
  s = toggleFocus(s); assert.deepEqual([s.left, s.right, s.bottom, s.focus], [true, false, false, null]);
  assert.equal(togglePanel(s, 'nope'), s);
  // toggling a panel while focused restores the saved layout first, then toggles
  let f = toggleFocus(normaliseState(null)); f = togglePanel(f, 'right');
  assert.deepEqual([f.left, f.right, f.bottom, f.focus], [false, true, false, null]);
});

test('panel state persists per viewer and survives bad storage', () => {
  const st = mem();
  saveState(st, { left: true, right: false, bottom: true });
  assert.deepEqual(JSON.parse(st.getItem(STORE_KEY)), { left: true, right: false, bottom: true });
  const l = loadState(st); assert.equal(l.left, true); assert.equal(l.bottom, true); assert.equal(l.right, false);
  assert.equal(loadState({ getItem: () => '{bad' }).left, false);
  assert.equal(loadState({ getItem: () => { throw new Error('x'); } }).right, false);
  assert.doesNotThrow(() => saveState({ setItem: () => { throw new Error('quota'); } }, { left: true }));
});

test('shortcuts B I M F, not in fields and not with modifiers', () => {
  assert.deepEqual(shortcutFor({ key: 'b', target: { tagName: 'DIV' } }), { panel: 'left' });
  assert.deepEqual(shortcutFor({ key: 'I', target: { tagName: 'BODY' } }), { panel: 'right' });
  assert.deepEqual(shortcutFor({ key: 'm', target: {} }), { panel: 'bottom' });
  assert.deepEqual(shortcutFor({ key: 'f', target: {} }), { focus: true });
  assert.equal(shortcutFor({ key: 'f', target: { tagName: 'INPUT' } }), null);
  assert.equal(shortcutFor({ key: 'f', ctrlKey: true, target: {} }), null);
  assert.equal(shortcutFor({ key: 'x', target: {} }), null);
});

test('meter mapping: dBm <-> y round trips, snaps to 1 dB and clamps', () => {
  const { top, bottom } = barArea(200);
  assert.equal(yForDbm(RF_RANGE.max, RF_RANGE, top, bottom), top);
  assert.equal(yForDbm(RF_RANGE.min, RF_RANGE, top, bottom), bottom);
  for (const v of [-100, -85, -60, -30]) assert.equal(dbmForY(yForDbm(v, RF_RANGE, top, bottom), RF_RANGE, top, bottom), v);
  assert.equal(dbmForY(-500, RF_RANGE, top, bottom), 0);
  assert.equal(dbmForY(9999, RF_RANGE, top, bottom), RF_RANGE.min);
  assert.equal(Number.isInteger(dbmForY(top + 33.3, RF_RANGE, top, bottom)), true);
});

test('squelch keyboard steps', () => {
  assert.equal(squelchKeyStep(-90, 'ArrowUp'), -89);
  assert.equal(squelchKeyStep(-90, 'ArrowDown', true), -95);
  assert.equal(squelchKeyStep(-90, 'PageUp'), -85);
  assert.equal(squelchKeyStep(-90, 'Home'), -120);
  assert.equal(squelchKeyStep(-90, 'End'), 0);
  assert.equal(squelchKeyStep(-1, 'ArrowUp', true), 0);
  assert.equal(squelchKeyStep(-90, 'x'), null);
  assert.equal(squelchKeyStep(NaN, 'ArrowUp'), -89);
});

test('bars: RF and audio always, A/B with diversity, battery with telemetry; columns fit the width', () => {
  assert.deepEqual(barList(null).map((b) => b.id), ['rf', 'audio']);
  assert.deepEqual(barList({ bDbm: -50, batteryPercent: 80 }).map((b) => b.id), ['rf', 'audio', 'a', 'b', 'batt']);
  const cols = barColumns(190, 5);
  assert.equal(cols.length, 5); assert.ok(cols[4].x + cols[4].w <= 190);
});

test('setSquelchThreshold: snaps, clamps, one undo step per drag, ignored when squelch is off', () => {
  const store = createStore(createDefaultScene());
  const id = store.getScene().links[0].id;
  assert.equal(setSquelchThreshold(store, id, -70.4, { coalesce: 'd' }), true);
  assert.equal(store.getScene().links[0].rx.squelch.thresholdDbm, -70);
  setSquelchThreshold(store, id, -60, { coalesce: 'd' }); setSquelchThreshold(store, id, -55, { coalesce: 'd' });
  store.undo(); assert.notEqual(store.getScene().links[0].rx.squelch.thresholdDbm, -55);
  assert.equal(setSquelchThreshold(store, id, NaN), false);
  setSquelchThreshold(store, id, 500); assert.equal(store.getScene().links[0].rx.squelch.thresholdDbm, 0);
  store.update((d) => { d.links[0].rx.squelch.enabled = false; });
  assert.equal(setSquelchThreshold(store, id, -80), false);
});

test('MPX slot: automatic (digital links get the digital panel), no Auto/MPX/Digital selector', () => {
  const src = fs.readFileSync(new URL('../js/view/spectra.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('slot-switch') && !src.includes("['auto', 'Auto']") && !src.includes('slotOverride'));
  assert.equal(slotMode({ modulation: { type: 'digital' } }, null), 'digital');
  assert.equal(slotMode({ modulation: { type: 'analog-fm' } }, null), 'mpx');
  assert.equal(slotMode({ modulation: { type: 'digital' } }, 'mpx'), 'mpx');
  assert.equal(slotMode(null, 'digital'), 'digital');
  assert.equal(slotMode(null, 'bad'), 'mpx');
});

test('layout markup and CSS: three panels with toggles, aria wiring, desktop grid and phone fallback', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
  for (const id of ['leftpanel', 'sidebar', 'bottombar']) assert.match(html, new RegExp(`id="${id}" data-panel=`));
  for (const k of ['left', 'right', 'bottom']) assert.match(html, new RegExp(`data-toggle="${k}" aria-expanded="true" aria-controls="[a-z-]+-body"`));
  assert.match(html, /id="btn-focus" aria-pressed="false"/);
  assert.ok(html.indexOf('id="results"') > html.indexOf('id="leftpanel"') && html.indexOf('id="results"') < html.indexOf('id="sidebar"'), 'link budget sits in the left panel');
  assert.ok(html.indexOf('id="meters"') > html.indexOf('id="bottombar"'), 'meters are in the bottom bar');
  assert.match(css, /html\[data-pl="c"\] \{ --lw: 30px; \}/);
  assert.match(css, /\[data-collapsed="true"\] > \.panel-body \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 1099px\) \{\s*\.panels-group \{ display: none; \}/);
});

test('focus with every panel already collapsed shows them all again', () => {
  const s = toggleFocus({ left: true, right: true, bottom: true, focus: null });
  assert.deepEqual([s.left, s.right, s.bottom, s.focus], [false, false, false, null]);
});
