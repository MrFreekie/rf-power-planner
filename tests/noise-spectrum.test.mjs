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

// ---- review fixes
import { noiseIsOn } from '../js/view/spectra.js';
import { readFileSync } from 'node:fs';

test('noiseBursts: a video wall (reflectorId) reaches the RF spectrum as a steady source', () => {
  const vw = { ...createNoiseSource('video-wall', { reflectorId: 'w1' }), id: 'n1' };
  const refl = { id: 'w1', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, noise: { preset: 'led-wall' } };
  const nb = noiseBursts({ noiseSources: [vw], reflectors: [refl] }, fakeResult(-80), 3);
  assert.equal(nb.any, true); assert.equal(nb.sources[0].activity, 1);
  assert.equal(noiseBursts({ noiseSources: [vw], reflectors: [] }, fakeResult(-80), 3).any, false, 'no reflector, nothing to show');
  assert.equal(noiseBursts({ noiseSources: [vw], reflectors: [{ ...refl, noise: { preset: 'off' } }] }, fakeResult(-80), 3).any, false);
});

test('noiseBursts: the quiet filter uses the peak, so a pulsed source with a low average is kept', () => {
  const s = { ...src('pyro-trigger'), id: 'n1' };
  const res = { cascade: { noiseFloorDbm: -100 }, noiseSources: { floorBeforeDbm: -100, sources: [{ id: 'n1', peakDbm: -90, averageDbm: -140 }] } };
  assert.equal(noiseBursts({ noiseSources: [s] }, res, 0).any, true);
  res.noiseSources.sources[0].peakDbm = -125;
  assert.equal(noiseBursts({ noiseSources: [s] }, res, 0).any, false, 'peak under floor - 20 dB');
  res.noiseSources.sources[0].peakDbm = NaN;
  assert.equal(noiseBursts({ noiseSources: [s] }, res, 0).any, false, 'non-finite peak');
});

test('noiseBursts: a faint source adds its average power, not the held peak', () => {
  const s = { ...src('wifi-ap'), id: 'n1' };
  const cfg = classifyNoiseWave(s);
  assert.equal(cfg.mode, 'faint');
  {
    const res = { cascade: { noiseFloorDbm: -100 }, noiseSources: { floorBeforeDbm: -100, sources: [{ id: 'n1', peakDbm: -70, averageDbm: -90 }] } };
    assert.ok(Math.abs(noiseBursts({ noiseSources: [s] }, res, 1).addedDbm + 90) < 0.01);
  }
});

test('noiseIsOn and drawNoiseBurst: on or off follows source activity, not the size of the rise', () => {
  assert.equal(noiseIsOn({ sources: [{ activity: 1 }] }), true);
  assert.equal(noiseIsOn({ sources: [{ activity: 0 }, { activity: 0.04 }] }), false);
  const calls = [];
  const ctx = new Proxy({}, { get: (_, k) => (k === 'canvas' ? {} : (...a) => { calls.push([k, a]); }), set: () => true });
  const f = { L: 10, pw: 200, T: 0, ph: 100, Y: (v) => 100 + v, X: (v) => v };
  const th = { warnText: '#a60', fail: '#c00', ink: '#000', paper: '#fff', inkSoft: '#555' };
  drawNoiseBurst(ctx, th, f, { noiseDbm: -100 }, { noise: { any: true, riseDb: 0.1, sources: [{ name: 'LED', activity: 1 }] } }, 0, 1);
  assert.match(calls.filter((c) => c[0] === 'fillText' || c[0] === 'strokeText').map((c) => c[1][0]).join('|'), /noise source on: \+0\.1 dB \(LED\)/);
});

test('spectra: pause freezes the noise clock; pause button has a changing label and no aria-pressed', () => {
  const code = readFileSync(new URL('../js/view/spectra.js', import.meta.url), 'utf8');
  assert.match(code, /noiseBursts\(scene, r, noiseT\)/);
  assert.doesNotMatch(code, /noiseBursts\(scene, r, noiseClockNow\(\)\)/);
  assert.match(code, /noiseT = noiseClockNow\(\); invalidateAll\(\)/, 'refreshed inside tick only');
  assert.doesNotMatch(code, /lastNow = lastNow/);
  assert.doesNotMatch(code, /btn-spectra-pause[^\n]*aria-pressed/);
  assert.doesNotMatch(code, /pauseBtn\.setAttribute\('aria-pressed'/);
  const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
  assert.match(css, /#toolbar > #btn-spectra-pause/);
});
