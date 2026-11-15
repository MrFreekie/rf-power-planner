// Noise source GUI: catalogue options and flags, actions, budget and paths rows, plan drawing, wall link.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../js/examples.js';
import { NOISE_KIND_IDS, NOISE_CATALOGUE } from '../js/model/noise-sources.js';
import { catalogueOptions, flagText, worstFlag, behaviourText, noiseBudgetRows, noisePathRows } from '../js/ui/noiseUi.js';
import { addNoiseSource, addEngCrew, addWallNoiseSource, updateNoiseSource, removeNoiseSource, moveNoiseSource } from '../js/actionsAreas.js';
import { removeReflector, addReflector } from '../js/actions.js';
import { drawNoiseSources, noiseGlyph } from '../js/view/noiseDraw.js';
import { createStore } from '../js/store.js';
import { solveLink } from '../js/model/rf.js';
import { findItem, selectableIds } from '../js/view/util.js';
import { dutyOf } from '../js/model/noise-sources.js';

const ex = (id) => EXAMPLES.find((e) => e.id === id).build().scene;
function fakeCtx() { const calls = []; return new Proxy({ calls }, { get(t, k) { if (k in t) return t[k]; if (k === 'measureText') return () => ({ width: 50 }); return (...a) => { calls.push([k, ...a]); }; }, set(t, k, v) { t[k] = v; return true; } }); }
const vp = { pxPerM: 30, worldToScreen: (x, y) => ({ x: 100 + x * 30, y: 300 - y * 30 }) };
const th = { ink: '#000', inkSoft: '#555', paper: '#fff', font: 'sans-serif' };

test('catalogue picker lists all 21 kinds grouped, each with a flag letter', () => {
  const g = catalogueOptions(), all = g.flatMap((x) => x.options);
  assert.equal(all.length, NOISE_KIND_IDS.length); assert.ok(all.length >= 21);
  assert.ok(all.every(([, t]) => /\[(S|I|U)\]$/.test(t)));
  assert.ok(g.every((x) => x.label && x.options.length));
  assert.equal(worstFlag('ptt-pmr446'), 'U'); assert.match(flagText('gsm-phone-900'), /ERP S/);
  assert.match(behaviourText({ kind: 'gsm-phone-900' }, dutyOf), /duty 12\.5 %/);
  assert.equal(noiseGlyph('ptt-pmr446'), 'radio'); assert.equal(noiseGlyph('dimmer-triac'), 'pulse'); assert.equal(noiseGlyph('led-light-pwm'), 'hash');
});

test('actions: add, ENG crew, update with clamping, kind change, mute, remove', () => {
  const store = createStore(ex('noise-eng-press-pit'));
  const n0 = store.getScene().noiseSources.length;
  const id = addNoiseSource(store, 'ptt-pmr446'); assert.ok(id);
  assert.equal(addNoiseSource(store, 'nope'), null);
  assert.equal(addEngCrew(store, { x: 0, y: -4, z: 0 }).length, 5);
  assert.equal(store.getScene().noiseSources.length, n0 + 6);
  updateNoiseSource(store, id, { erpDbm: 999, dutyCycle: 5, name: 'Radio\u0000 A' });
  let s = store.getScene().noiseSources.find((x) => x.id === id);
  assert.equal(s.erpDbm, 70); assert.equal(s.dutyCycle, 1); assert.equal(s.name, 'Radio A');
  updateNoiseSource(store, id, { kind: 'led-light-pwm' });
  s = store.getScene().noiseSources.find((x) => x.id === id);
  assert.equal(s.kind, 'led-light-pwm'); assert.equal(s.erpDbm, undefined); assert.equal(s.type, 'broadband');
  moveNoiseSource(store, id, { x: 3, y: -2 }); assert.deepEqual([s.pos.x, store.getScene().noiseSources.find((x) => x.id === id).pos.x], [s.pos.x, 3]);
  updateNoiseSource(store, id, { enabled: false });
  assert.equal(store.getScene().noiseSources.find((x) => x.id === id).enabled, false);
  removeNoiseSource(store, id);
  assert.equal(store.getScene().noiseSources.find((x) => x.id === id), undefined);
});

test('budget and paths rows show average against peak, the strongest source and the floor rise', () => {
  const sc = ex('noise-flash-at-pit'), r = solveLink(sc, sc.links[0]);
  const rows = noiseBudgetRows(r.noiseSources);
  assert.match(rows[0].value, /average .* dBm, peak .* dBm; floor \+.* dB on average, \+.* dB at the peak/);
  assert.ok(rows.length >= 2);
  const p = noisePathRows(r.noiseSources, (m) => `${m} m`);
  assert.ok(p.length && /avg .* \/ peak .* dBm/.test(p[0].relDb) && /^Noise: /.test(p[0].kind));
  assert.deepEqual(noiseBudgetRows(null), []);
});

test('noise sources are selectable and draw on the plan with one handle each; wall-linked sources are left to the wall', () => {
  const sc = ex('noise-eng-press-pit');
  const handles = [], g = fakeCtx();
  drawNoiseSources(g, th, vp, sc, sc.noiseSources[0].id, handles, null, 800);
  const free = sc.noiseSources.filter((s) => !s.reflectorId);
  assert.equal(handles.filter((h) => h.kind === 'noise').length, free.length);
  assert.equal(g.calls.filter((c) => c[0] === 'save').length, g.calls.filter((c) => c[0] === 'restore').length);
  assert.equal(findItem(sc, sc.noiseSources[0].id).type, 'noise');
  assert.ok(selectableIds(sc).includes(sc.noiseSources[0].id));
});

test('a video wall source links to its reflector, mutes instead of deleting, and goes with the wall', () => {
  const store = createStore(ex('noise-flash-at-pit'));
  const rid = addReflector(store, { p1: { x: -3, y: 4 }, p2: { x: 3, y: 4 }, zMin: 0, zMax: 3, material: 'concrete' });
  const nid = addWallNoiseSource(store, rid);
  assert.ok(nid); assert.equal(addWallNoiseSource(store, rid), nid, 'one linked source per wall');
  removeNoiseSource(store, nid);
  const s = store.getScene().noiseSources.find((x) => x.id === nid);
  assert.ok(s && s.enabled === false, 'muted, not removed');
  updateNoiseSource(store, nid, { kind: 'led-light-pwm' });
  assert.equal(store.getScene().noiseSources.find((x) => x.id === nid).kind, 'video-wall', 'the kind of a linked source is fixed');
  removeReflector(store, rid);
  assert.equal(store.getScene().noiseSources.find((x) => x.id === nid), undefined);
  assert.ok(NOISE_CATALOGUE['video-wall']);
});
