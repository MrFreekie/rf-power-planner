import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyNoiseWave, keyedState, waveRings, idPhase, drawNoiseWaves, NOISE_WAVE_MAX_SOURCES } from '../js/view/noiseWaves.js';
import { createNoiseSource } from '../js/model/noise-sources.js';

const src = (kind, o = {}) => createNoiseSource(kind, o);
const wall = (preset = 'led-wall') => ({ id: 'w1', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, noise: { preset } });

test('classification by kind', () => {
  assert.equal(classifyNoiseWave(src('led-light-pwm')).mode, 'steady');
  assert.equal(classifyNoiseWave(src('speedlight-flash')).mode, 'pulse');
  assert.equal(classifyNoiseWave(src('flash-trigger-radio')).mode, 'occasional');
  assert.equal(classifyNoiseWave(src('pyro-trigger')).mode, 'occasional');
  assert.equal(classifyNoiseWave(src('dimmer-triac')).mode, 'faint');
  assert.equal(classifyNoiseWave(src('motor-hoist')).mode, 'faint');
  const ptt = classifyNoiseWave(src('ptt-pmr446')); assert.equal(ptt.mode, 'keyed'); assert.equal(ptt.onS, 5.5, 'model on-time 5 s plus the 0.5 s hold'); assert.ok(ptt.offS >= 3);
  const dect = classifyNoiseWave(src('dect-comms')); assert.equal(dect.mode, 'keyed'); assert.equal(dect.onS, 4); assert.equal(dect.offS, 3);
  assert.equal(classifyNoiseWave(src('gsm-phone-900')).mode, 'keyed');
  assert.equal(classifyNoiseWave(src('lte-phone')).mode, 'keyed');
  assert.equal(classifyNoiseWave(src('wifi-ap')).mode, 'faint');
});

test('muted sources and walls without noise draw nothing; a live wall radiates from the wall line', () => {
  assert.equal(classifyNoiseWave(src('led-light-pwm', { enabled: false })), null);
  const vw = src('video-wall', { reflectorId: 'w1' });
  assert.equal(classifyNoiseWave(vw, wall('off')), null);
  assert.equal(classifyNoiseWave(vw, null), null);
  assert.equal(classifyNoiseWave(vw, wall()).mode, 'wall');
  assert.equal(classifyNoiseWave({ ...vw, enabled: false }, wall()), null);
});

test('steady sources always have several rings; occasional ones have at most one and sometimes none', () => {
  const st = classifyNoiseWave(src('led-light-pwm')), oc = classifyNoiseWave(src('pyro-trigger'));
  let ocWith = 0, ocWithout = 0;
  for (let t = 0; t < 60; t += 0.25) {
    assert.ok(waveRings(st, 'a', t).length >= 3);
    const n = waveRings(oc, 'b', t).length; assert.ok(n <= 1); if (n) ocWith++; else ocWithout++;
  }
  assert.ok(ocWith > 0 && ocWithout > 0);
});

test('keyed source: no ring is born in the off gap, rings born on keep travelling, and ids are not in lockstep', () => {
  const cfg = classifyNoiseWave(src('dect-comms')), id = 'ns-x';
  let sawOn = false, sawOff = false, sawEmpty = false;
  for (let t = 0; t < 40; t += 0.05) {
    const rings = waveRings(cfg, id, t);
    for (const r of rings) { // birth time of every live ring must fall in an on period
      assert.ok(keyedState(cfg, id, t - r.age + 1e-6).on, `ring born off at t=${t - r.age}`);
      assert.ok(r.f >= 0 && r.f < 1);
    }
    if (keyedState(cfg, id, t).on) sawOn = true; else { sawOff = true; if (!rings.length) sawEmpty = true; }
  }
  assert.ok(sawOn && sawOff && sawEmpty, 'visible off gap with no rings');
  // a ring is still alive just after the key goes up
  let tOff = 0; while (!(keyedState(cfg, id, tOff).on && !keyedState(cfg, id, tOff + 0.01).on)) tOff += 0.01;
  assert.ok(waveRings(cfg, id, tOff + 0.3).length > 0);
  assert.notEqual(idPhase('ptt-1'), idPhase('ptt-2'));
  const sig = (i) => Array.from({ length: 300 }, (_, k) => keyedState(cfg, i, k / 10).on ? 1 : 0).join('');
  assert.notEqual(sig('ptt-1'), sig('ptt-2'));
});

test('deterministic', () => {
  const cfg = classifyNoiseWave(src('ptt-pmr446'));
  assert.deepEqual(waveRings(cfg, 'q', 12.34), waveRings(cfg, 'q', 12.34));
});

function fakeCtx() { const n = { arc: 0, stroke: 0, lineTo: 0 }; const c = new Proxy({}, { get: (_, k) => (k in n ? () => { n[k]++; } : () => {}), set: () => true }); return { c, n }; }
const vp = { pxPerM: 40, worldToScreen: (x, y) => (typeof x === 'object' ? { x: x.x * 40, y: x.y * 40 } : { x: x * 40, y: y * 40 }) };

test('drawNoiseWaves respects settings.on, field and the source cap', () => {
  const many = Array.from({ length: 30 }, (_, i) => src('led-light-pwm', { id: `n${i}`, pos: { x: 3 + (i % 5), y: 3 + Math.floor(i / 5), z: 1 } }));
  const scene = { noiseSources: many, reflectors: [] };
  const th = { ink: '#000', inkSoft: '#555' };
  { const { c, n } = fakeCtx(); assert.equal(drawNoiseWaves(c, th, vp, scene, 800, 600, { settings: { on: false } }), 0); assert.equal(n.stroke, 0); }
  { const { c } = fakeCtx(); assert.equal(drawNoiseWaves(c, th, vp, scene, 800, 600, { settings: { on: true, field: true } }), 0); }
  { const { c, n } = fakeCtx(); assert.equal(drawNoiseWaves(c, th, vp, scene, 800, 600, { settings: { on: true } }), NOISE_WAVE_MAX_SOURCES); assert.ok(n.stroke > 0); }
});

test('waves follow the model schedule: speedlight is a frequent train, rare sources keep a clamped real period', async () => {
  const { waveSchedule } = await import('../js/model/noise-sources.js');
  const sp = classifyNoiseWave(src('speedlight-flash')), sch = waveSchedule(src('speedlight-flash'));
  assert.equal(sch.eventsPerS, 3);
  assert.equal(sp.mode, 'pulse'); assert.ok(Math.abs(sp.period - 1 / 3) < 0.01, `period ${sp.period}`);
  let min = 99, max = 0; for (let t = 0; t < 30; t += 0.05) { const n = waveRings(sp, 'a', t).length; min = Math.min(min, n); max = Math.max(max, n); }
  assert.ok(min >= 2 && max <= 4, `rings alive ${min}..${max}`);
  for (const kind of ['pyro-trigger', 'flash-trigger-radio']) {
    const c = classifyNoiseWave(src(kind)); assert.equal(c.mode, 'occasional');
    assert.ok(c.period >= 1.5 && c.period <= 8, `${kind} period ${c.period}`);
  }
  const ptt = classifyNoiseWave(src('ptt-business-uhf')), ps = waveSchedule(src('ptt-business-uhf'));
  assert.equal(ptt.onS, Math.min(8, Math.max(1, ps.onS))); assert.equal(ptt.offS, Math.min(8, Math.max(3, ps.gapS)));
  const dect = classifyNoiseWave(src('dect-comms')); assert.match(dect.label, /call cycle.*bursts per second/);
  assert.match(sp.label, /3 pulses per second/);
  assert.equal(classifyNoiseWave(src('led-light-pwm')).onS, Infinity);
});
