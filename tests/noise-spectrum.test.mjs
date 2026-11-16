import test from 'node:test';
import assert from 'node:assert/strict';
import { noiseActivity, noiseBursts, classifyNoiseWave, keyedState, NOISE_FLASH_S } from '../js/view/noiseWaves.js';
import { drawNoiseBurst } from '../js/view/spectra.js';
import { createNoiseSource } from '../js/model/noise-sources.js';

const src = (kind, o = {}) => createNoiseSource(kind, o);

test('noiseActivity: keyed sources are 1 while on and 0 in the gap, steady sources always 1', () => {
  const cfg = classifyNoiseWave(src('ptt-pmr446'));
  const s = src('ptt-pmr446');
  let on = 0, off = 0;
  for (let t = 0; t < 40; t += 0.25) { const a = noiseActivity(cfg, s.id, t); assert.ok(a === 0 || a === 1); a ? on++ : off++; assert.equal(a === 1, keyedState(cfg, s.id, t).on); }
  assert.ok(on > 0 && off > 0, 'both states occur');
  assert.equal(noiseActivity(classifyNoiseWave(src('led-light-pwm')), 'x', 3.3), 1);
  assert.equal(noiseActivity(null, 'x', 1), 0);
});

test('noiseActivity: a pulse source flashes at each ring birth and falls back to zero', () => {
  const s = src('pyro-trigger'), cfg = classifyNoiseWave(s);
  assert.equal(cfg.mode, 'occasional');
  const vals = []; for (let t = 0; t < 30; t += 0.01) vals.push(noiseActivity(cfg, s.id, t));
  assert.ok(vals.some((v) => v > 0.9), 'reaches full strength');
  assert.ok(vals.some((v) => v === 0), 'drops to zero between flashes');
  assert.ok(NOISE_FLASH_S > 0 && NOISE_FLASH_S < cfg.period);
});

const fakeResult = (peak, floor = -100, inChannel = true) => ({ cascade: { noiseFloorDbm: floor }, noiseSources: { floorBeforeDbm: floor, sources: [{ id: 'n1', inChannel, peakDbm: peak, averageDbm: peak - 10 }] } });

test('noiseBursts: rise follows activity; off sources add nothing; quiet and muted sources are ignored', () => {
  const s = { ...src('ptt-pmr446'), id: 'n1' };
  const scene = { noiseSources: [s] };
  const cfg = classifyNoiseWave(s);
  let tOn = null, tOff = null;
  for (let t = 0; t < 40 && (tOn === null || tOff === null); t += 0.25) { if (keyedState(cfg, s.id, t).on) tOn ??= t; else tOff ??= t; }
  const on = noiseBursts(scene, fakeResult(-70), tOn), off = noiseBursts(scene, fakeResult(-70), tOff);
  assert.ok(on.any && off.any);
  assert.ok(on.riseDb > 20 && Math.abs(on.addedDbm + 70) < 0.01);
  assert.equal(off.riseDb, 0);
  assert.equal(noiseBursts(scene, fakeResult(-70, -100, false), tOn).any, true, 'an off-channel source still counts: its peak already includes the receiver selectivity');
  assert.equal(noiseBursts(scene, fakeResult(-150), tOn).any, false, 'far under the floor');
  assert.equal(noiseBursts({ noiseSources: [{ ...s, enabled: false }] }, fakeResult(-70), tOn).any, false, 'muted');
  assert.equal(noiseBursts(scene, null, 0).any, false);
});

test('drawNoiseBurst draws only when there is a noise source; on and off give different labels', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, k) => (k === 'canvas' ? {} : (...a) => { calls.push([k, a]); }), set: () => true });
  const f = { L: 10, pw: 200, T: 0, ph: 100, Y: (v) => 100 + v, X: (v) => v };
  const th = { warnText: '#a60', fail: '#c00', ink: '#000', paper: '#fff', inkSoft: '#555' };
  drawNoiseBurst(ctx, th, f, { noiseDbm: -100 }, {}, 0, 1);
  assert.equal(calls.length, 0);
  const text = (inp) => { calls.length = 0; drawNoiseBurst(ctx, th, f, { noiseDbm: -100 }, inp, 0, 1); return calls.filter((c) => c[0] === 'fillText' || c[0] === 'strokeText').map((c) => c[1][0]).join('|'); };
  assert.match(text({ noise: { any: true, riseDb: 12, sources: [{ name: 'Crew PTT', activity: 1 }] } }), /noise source on: \+12 dB \(Crew PTT\)/);
  assert.match(text({ noise: { any: true, riseDb: 0, sources: [{ name: 'Crew PTT', activity: 0 }] } }), /noise source off/);
});
