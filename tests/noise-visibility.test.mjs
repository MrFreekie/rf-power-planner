// Noise-wave visibility, ripple note, command palette control entries and the narrow-screen toolbar order.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyNoiseWave, waveRings, drawNoiseWaves, NOISE_RING_STYLE, MIN_REACH_PX } from '../js/view/noiseWaves.js';
import { rippleNote, NOISE_NOTE } from '../js/view/ripples.js';
import { collectControlItems, CONTROL_ENTRIES, rankItems } from '../js/ui/commandPalette.js';
import { createNoiseSource } from '../js/model/noise-sources.js';

const css = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');

test('keyed rings leave a clear gap in every off period (at least one second without a ring)', () => {
  for (const kind of ['ptt-business-uhf', 'ptt-pmr446', 'dect-comms']) {
    const cfg = classifyNoiseWave(createNoiseSource(kind)), cyc = cfg.onS + cfg.offS;
    let clear = 0;
    for (let t = 0; t < cyc; t += 0.05) if (waveRings(cfg, 'x', t).length === 0) clear += 0.05;
    assert.ok(clear >= 0.9, `${kind}: ${clear.toFixed(2)} s clear per cycle`);
    let on = 0; for (let t = 0; t < cyc; t += 0.05) if (waveRings(cfg, 'x', t).length > 0) on += 0.05;
    assert.ok(on >= cfg.onS, `${kind}: rings while on`);
  }
});

test('noise rings are dashed with a halo, drawn thicker than a hairline, and reach at least MIN_REACH_PX on screen', () => {
  assert.ok(NOISE_RING_STYLE.width >= 1.5 && NOISE_RING_STYLE.dash.length === 2 && NOISE_RING_STYLE.haloWidth > NOISE_RING_STYLE.width);
  const radii = [], dashes = [], styles = [];
  const ctx = new Proxy({}, { get: (_, k) => (k === 'arc' ? (x, y, r) => radii.push(r) : k === 'setLineDash' ? (d) => dashes.push(d.join()) : () => {}), set: (_, k, v) => { if (k === 'strokeStyle') styles.push(v); return true; } });
  const vp = { pxPerM: 2, worldToScreen: (x, y) => ({ x: x * 2, y: y * 2 }) }; // 5 m would be 10 px: the minimum reach must kick in
  const scene = { noiseSources: [createNoiseSource('led-light-pwm', { pos: { x: 100, y: 100, z: 1 } })] };
  drawNoiseWaves(ctx, { ink: '#000', inkSoft: '#555', paper: '#fff' }, vp, scene, 800, 600, { settings: { on: true } });
  assert.ok(Math.max(...radii) > 10 * 2 && Math.max(...radii) <= MIN_REACH_PX);
  assert.ok(dashes.includes(NOISE_RING_STYLE.dash.join()) && dashes.includes(''));
  assert.ok(styles.includes('#555') && styles.includes('#fff'), 'greyscale ring over a paper halo');
});

test('print: nothing is drawn when ripples are switched off for the snapshot', () => {
  let strokes = 0; const ctx = new Proxy({}, { get: (_, k) => (k === 'stroke' ? () => { strokes++; } : () => {}), set: () => true });
  const scene = { noiseSources: [createNoiseSource('led-light-pwm', { pos: { x: 5, y: 5, z: 1 } })] };
  assert.equal(drawNoiseWaves(ctx, {}, { pxPerM: 20, worldToScreen: (x, y) => ({ x, y }) }, scene, 800, 600, { settings: { on: false } }), 0);
  assert.equal(strokes, 0);
});

test('ripple controls note mentions the dashed noise rings only when noise sources exist', () => {
  assert.match(NOISE_NOTE, /Dashed rings: noise sources \(keyed ones only while on\)/);
  assert.equal(rippleNote({ on: true, field: false }, false, true), NOISE_NOTE);
  assert.equal(rippleNote({ on: true, field: false }, false, false), '');
  assert.equal(rippleNote({ on: false, field: false }, false, true), '');
  assert.match(rippleNote({ on: true, field: true }, false, true), /^Field:/);
  assert.match(rippleNote({ on: true, field: false }, true, true), /^Reduced motion/);
});

test('command palette lists the audio source select and tone Hz field and focuses them', () => {
  const mk = (id, extra = {}) => ({ id, hidden: false, disabled: false, focused: 0, focus() { this.focused++; }, closest: () => null, ...extra });
  const sel = mk('audio-source'), hz = mk('audio-tone-hz');
  const doc = { getElementById: (id) => ({ 'audio-source': sel, 'audio-tone-hz': hz })[id] || null };
  const items = collectControlItems(doc);
  assert.deepEqual(items.map((i) => i.label), CONTROL_ENTRIES.map((c) => c.label));
  assert.deepEqual(items.map((i) => i.label), ['Audio source', 'Tone Hz']);
  assert.equal(rankItems(items, 'tone hz')[0].label, 'Tone Hz');
  assert.equal(rankItems(items, 'audio')[0].label, 'Audio source');
  items[1].run(); assert.equal(hz.focused, 1);
  hz.disabled = true; items[1].run(); assert.equal(sel.focused, 1, 'a disabled tone field sends focus to the source select');
  hz.disabled = false; hz.closest = () => ({}); items[1].run(); assert.equal(sel.focused, 2, 'a hidden tone field does too');
  items[0].run(); assert.equal(sel.focused, 3);
  assert.deepEqual(collectControlItems({ getElementById: () => null }), []);
});

test('narrow toolbar puts the audio source group right after the first buttons', () => {
  const m = css.match(/@media \(max-width: 800px\) \{[^@]*?#toolbar > #btn-cmd[^}]*\{ order: -2; \}\s*#toolbar > \.source-bar \{ order: -1; \}/);
  assert.ok(m, 'phone media block orders Find and Scenario first, then .source-bar');
});

import { quietSources } from '../js/view/noiseWaves.js';
test('a source far below the floor at the receiver gets one faint static dotted ring and nothing moving', () => {
  const s = createNoiseSource('led-light-pwm', { pos: { x: 100, y: 100, z: 1 } }), q1 = s.id;
  const result = { noiseSources: { floorBeforeDbm: -100, sources: [{ id: q1, averageDbm: -130 }, { id: 'other', averageDbm: -105 }] } };
  assert.deepEqual([...quietSources(result)], [q1]);
  assert.equal(quietSources({}).size, 0); assert.equal(quietSources(null).size, 0);
  const run = (res) => {
    const dashes = [], arcs = [], alphas = [];
    let cur = 1; const ctx = new Proxy({}, { get: (_, k) => (k === 'globalAlpha' ? cur : k === 'arc' ? (x, y, r) => arcs.push(r) : k === 'setLineDash' ? (d) => dashes.push(d.join()) : () => {}), set: (_, k, v) => { if (k === 'globalAlpha') { cur = v; alphas.push(v); } return true; } });
    drawNoiseWaves(ctx, { inkSoft: '#555', paper: '#fff' }, { pxPerM: 2, worldToScreen: (x, y) => ({ x, y }) }, { noiseSources: [s] }, 800, 600, { settings: { on: true } }, res);
    return { dashes, arcs, alphas };
  };
  const q = run(result);
  assert.equal(q.arcs.length, 2, 'halo and dots of one ring'); assert.ok(q.dashes.includes(NOISE_RING_STYLE.dotted.join()) && !q.dashes.includes(NOISE_RING_STYLE.dash.join()));
  assert.ok(q.alphas.every((a) => a <= 0.18 + 1e-9), JSON.stringify(q.alphas));
  const live = run({ noiseSources: { floorBeforeDbm: -100, sources: [{ id: q1, averageDbm: -95 }] } });
  assert.ok(live.arcs.length > 2 && live.dashes.includes(NOISE_RING_STYLE.dash.join()));
});
