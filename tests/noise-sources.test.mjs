// Noise sources (items 34 and 34a). Hand-computed anchors, tolerances stated at each assertion.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOISE_CATALOGUE, NOISE_BEHAVIOURS, createNoiseSource, noiseSourceAt, noiseSourcesAt, selectivityDb, floorRiseDb, noiseEvents, eventsDuty, dutyOf,
  engCrewSources, mutedReflectorIds, wallNoiseSourcesFromReflectors, noiseRiseVsDistance, validateNoiseSource, NOISE_SOURCE_LIMITS,
} from '../js/model/noise-sources.js';
import { createDefaultScene, validateScene, migrateScene, createReflector } from '../js/model/scene.js';
import { solveLink } from '../js/model/rf.js';
import { noiseSourceScene, EXAMPLES, buildExample, videoWallScene } from '../js/examples.js';

const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} got ${a}, expected ${b} +/- ${tol}`);
const f1 = (x) => x.toFixed(1);
const note = (id) => EXAMPLES.find((e) => e.id === id).note;
const at = (src, pos, f, bw, g = 0) => noiseSourceAt({ ...src, pos }, { x: 0, y: 0, z: 0 }, f, bw, () => g);

test('catalogue: valid behaviours, every flag is S, I or U and names a real parameter, ENG group builds five sources', () => {
  for (const [id, e] of Object.entries(NOISE_CATALOGUE)) {
    assert.ok(NOISE_BEHAVIOURS.includes(e.behaviour), id);
    for (const [k, v] of Object.entries(e.flags)) { assert.match(v, /^[SIU]$/, `${id}.${k}`); assert.ok(k in e.params, `${id}.${k}`); }
    const src = createNoiseSource(id); assert.deepEqual(validateScene({ ...createDefaultScene(), noiseSources: [src] }), { ok: true, errors: [] }, id);
  }
  ['video-wall', 'speedlight-flash', 'ptt-pmr446', 'gsm-phone-900', 'dimmer-triac', 'cofdm-camera-tx', 'led-camera-light'].forEach((k) => assert.ok(NOISE_CATALOGUE[k], k));
  const crew = engCrewSources({ x: 10, y: 10, z: 0 });
  assert.equal(crew.length, 5); assert.equal(new Set(crew.map((c) => c.id)).size, 5);
  near(crew[0].pos.x, 10, 1e-9); near(crew[0].pos.z, 1.8, 1e-9);
});

test('narrowband Friis anchor: PMR446 0.5 W at 1 m, 446.1 MHz, isotropic: 27 - 25.44 - 3 = -1.44 dBm (tolerance 0.01 dB)', () => {
  const r = at(createNoiseSource('ptt-pmr446'), { x: 1, y: 0, z: 0 }, 446.1, 12.5);
  // FSPL = 20 log10(4 pi d / lambda), lambda = 299792458 / 446.1e6 = 0.67202 m -> 20 log10(18.700) = 25.44 dB
  near(r.rawDbm, 27 - 25.44 - 3, 0.01); assert.equal(r.inChannel, true); near(r.selectivityDb, 0, 1e-12);
  near(r.averageDbm - r.peakDbm, 10 * Math.log10(0.3), 1e-9);
});

test('broadband anchor: speedlight 70 dBuV/m at 10 m, 600 MHz, 120 kHz: -65.8 dBm peak (tolerance 0.05 dB), 1/d law, duty 0.003', () => {
  const src = createNoiseSource('speedlight-flash');
  // S = 70 - 120 - 25.76 = -75.76 dBW/m2; Ae = 10 log10(lambda^2 / 4 pi) = -17.02 dB; +30 dB for dBm; -3 dB polarisation -> -65.78
  const r10 = at({ ...src, tiltDbPerDecade: 0 }, { x: 10, y: 0, z: 0 }, 600, 120);
  near(r10.peakDbm, -65.78, 0.05);
  const r20 = at({ ...src, tiltDbPerDecade: 0 }, { x: 20, y: 0, z: 0 }, 600, 120);
  near(r10.peakDbm - r20.peakDbm, 6.02, 0.01);
  near(r10.averageDbm - r10.peakDbm, 10 * Math.log10(0.003), 1e-9);
  const wide = at({ ...src, tiltDbPerDecade: 0 }, { x: 10, y: 0, z: 0 }, 600, 1200);
  near(wide.peakDbm - r10.peakDbm, 10, 1e-9); // ten times the bandwidth
  assert.equal(dutyOf(createNoiseSource('video-wall')), 1);
});

test('time behaviours: GSM duty 0.577 ms x 216.7 Hz = 12.5 percent (-9.03 dB), selectivity 26.02 dB at two half-bandwidths, floor rise of equal powers 3.01 dB', () => {
  near(dutyOf(createNoiseSource('gsm-phone-900')), 0.125, 0.0005);
  near(10 * Math.log10(dutyOf(createNoiseSource('gsm-phone-900'))), -9.03, 0.01);
  near(selectivityDb(0.2, 200), 20 + 20 * Math.log10(2), 1e-9); near(selectivityDb(0.05, 200), 0, 0); near(selectivityDb(5000, 200), 90, 0);
  near(floorRiseDb(-100, -100), 3.0103, 1e-4); assert.equal(floorRiseDb(-100, -Infinity), 0);
  const ev = noiseEvents(createNoiseSource('gsm-phone-900'), 1, { seed: 7 });
  assert.ok(Math.abs(ev.length - 217) <= 1); near(eventsDuty(ev, 1), 0.125, 0.003);
  const ev2 = noiseEvents(createNoiseSource('gsm-phone-900'), 1, { seed: 7 }); assert.deepEqual(ev, ev2);
  const ptt = noiseEvents(createNoiseSource('ptt-pmr446'), 600, { seed: 3 });
  near(eventsDuty(ptt, 600), 0.3, 0.05); // 5.5 s on every 18.33 s
  assert.deepEqual(noiseEvents(createNoiseSource('video-wall'), 10), [{ t0: 0, t1: 10 }]);
  assert.equal(noiseEvents(createNoiseSource('video-wall'), 0).length, 0);
});

test('sources sum by power, a muted source and a wall-linked source add nothing, dominant by distance flips', () => {
  const a = createNoiseSource('led-light-pwm', { pos: { x: 5, y: 0, z: 1.5 } }), b = { ...a, id: 'b', pos: { x: 5, y: 0, z: 1.5 } };
  const one = noiseSourcesAt([a], { x: 0, y: 0, z: 1.5 }, 600, 200), two = noiseSourcesAt([a, b], { x: 0, y: 0, z: 1.5 }, 600, 200);
  near(two.averageDbm - one.averageDbm, 3.0103, 1e-4);
  assert.equal(noiseSourcesAt([{ ...a, enabled: false }], { x: 0, y: 0, z: 1.5 }, 600, 200).averageDbm, -Infinity);
  assert.equal(noiseSourcesAt([{ ...a, reflectorId: 'r1' }], { x: 0, y: 0, z: 1.5 }, 600, 200).averageDbm, -Infinity);
  assert.deepEqual([...mutedReflectorIds([{ id: 'x', reflectorId: 'r1', enabled: false }, { id: 'y', reflectorId: 'r2' }])], ['r1']);
  const curve = noiseRiseVsDistance(createNoiseSource('ptt-pmr446'), [1, 10, 100], { freqMHz: 446.1, bwKHz: 200, floorDbm: -110 });
  assert.ok(curve[0].riseDb > curve[1].riseDb && curve[1].riseDb > curve[2].riseDb);
});

test('validation: bad kind, ranges and ids rejected; cap enforced; migrate adds linked wall sources once', () => {
  const sc = createDefaultScene();
  const ok = createNoiseSource('speedlight-flash');
  const v = (mut) => { const s = structuredClone(sc); const n = structuredClone(ok); mut(n); s.noiseSources = [n]; return validateScene(s); };
  assert.equal(v(() => {}).ok, true);
  assert.equal(v((n) => { n.kind = 'nope'; }).ok, false);
  assert.equal(v((n) => { n.dutyCycle = 2; }).ok, false);
  assert.equal(v((n) => { n.pos = { x: 1e9, y: 0, z: 0 }; }).ok, false);
  assert.equal(v((n) => { n.id = 'a b'; }).ok, false);
  assert.equal(v((n) => { n.enabled = 'yes'; }).ok, false);
  const many = structuredClone(sc); many.noiseSources = Array.from({ length: NOISE_SOURCE_LIMITS.max + 1 }, (_, i) => createNoiseSource('led-light-pwm', { id: `n${i}` }));
  assert.equal(validateScene(many).ok, false); assert.throws(() => migrateScene(many));
  const errs = []; validateNoiseSource(null, 'x', errs); assert.equal(errs.length, 1);
  const wall = structuredClone(sc); wall.reflectors = [createReflector({ id: 'w1', name: 'LED', p1: { x: 1, y: 1 }, p2: { x: 5, y: 1 }, zMin: 0, zMax: 3 })]; wall.reflectors[0].noise = { preset: 'class-a' };
  const m = migrateScene(wall);
  assert.equal(m.noiseSources.length, 1); assert.equal(m.noiseSources[0].kind, 'video-wall'); assert.equal(m.noiseSources[0].reflectorId, 'w1');
  assert.equal(migrateScene(m).noiseSources.length, 1); assert.equal(wallNoiseSourcesFromReflectors(m).length, 0);
  assert.equal(validateScene(m).ok, true);
});

test('solver: result.noiseSources adds the average power to the floor; a wall counts once; muting the wall source removes its noise', () => {
  const s = noiseSourceScene('flash-at-pit'), l = s.links[0];
  const r = solveLink(s, l), n = r.noiseSources;
  const plain = structuredClone(s); delete plain.noiseSources; const r0 = solveLink(plain, plain.links[0]);
  assert.equal(r0.noiseSources, null);
  near(n.floorBeforeDbm, r0.cascade.noiseFloorDbm, 1e-9);
  near(n.floorAfterDbm, 10 * Math.log10(10 ** (n.floorBeforeDbm / 10) + 10 ** (n.averageDbm / 10)), 1e-9);
  near(r0.marginDb - r.marginDb, n.riseDb, 1e-9); near(n.marginChangeDb, -n.riseDb, 1e-9);
  assert.ok(n.peakRiseDb > n.riseDb && n.peakDbm > n.averageDbm);
  // wall: counted once through the reflector block even though a linked source exists
  const w = videoWallScene({ preset: 'class-a', rx: 'back' });
  assert.ok(w.noiseSources.some((x) => x.reflectorId));
  const rw = solveLink(w, w.links[0]);
  assert.equal(rw.noiseSources, null); assert.ok(rw.wallNoise.riseDb > 3);
  const muted = structuredClone(w); muted.noiseSources.forEach((x) => { x.enabled = false; });
  const rm = solveLink(muted, muted.links[0]);
  assert.equal(rm.wallNoise, null);
  assert.ok(rm.marginDb > rw.marginDb);
});

test('noise examples: valid, quote the model, name a category, at most four sentences', () => {
  const run = (id, o) => { const s = noiseSourceScene(id, o); assert.deepEqual(validateScene(s), { ok: true, errors: [] }, id); const r = solveLink(s, s.links[0]); return { s, r, n: r.noiseSources }; };
  const flash = run('flash-at-pit');
  const f = flash.n.sources[0];
  for (const v of [f1(f.peakDbm), f1(f.averageDbm), f1(flash.n.riseDb), f1(flash.r.marginDb), f1(flash.n.peakRiseDb), '2 m', '0.3 percent']) assert.ok(note('noise-flash-at-pit').includes(v), v);
  near(flash.n.peakRiseDb, 62.1, 0.05);
  const ptt = run('ptt-beside-bodypack'), pmr = run('ptt-beside-bodypack', { kind: 'ptt-pmr446' }), x = ptt.n.sources[0];
  for (const v of [f1(x.rawDbm), f1(x.selectivityDb), f1(x.peakDbm), f1(x.averageDbm), f1(ptt.n.riseDb), f1(ptt.r.marginDb), f1(pmr.n.riseDb), f1(pmr.r.marginDb)]) assert.ok(note('noise-ptt-beside-bodypack').includes(v), v);
  const ph = run('phone-buzz'), p = ph.n.sources[0];
  for (const v of [f1(p.rawDbm), f1(p.peakDbm), f1(p.averageDbm), f1(ph.n.riseDb), '12.5 percent', '217 Hz']) assert.ok(note('noise-phone-buzz').includes(v), v);
  const di = run('dimmer-circuit'), d = di.n.sources[0];
  for (const v of [f1(d.peakDbm), f1(d.averageDbm), f1(di.n.riseDb), f1(di.r.marginDb), '120 Hz']) assert.ok(note('noise-dimmer-circuit').includes(v), v);
  const eng = run('eng-press-pit'), by = Object.fromEntries(eng.n.sources.map((q) => [q.kind + q.name.slice(-5), q.averageDbm]));
  void by;
  const led = eng.n.sources.find((q) => q.kind === 'led-camera-light'), gen = eng.n.sources.find((q) => q.kind === 'generator-inverter'), cam = eng.n.sources.find((q) => q.kind === 'cofdm-camera-tx');
  assert.equal(eng.n.dominant, led.id);
  for (const v of [f1(eng.n.riseDb), f1(eng.r.marginDb), f1(led.averageDbm), f1(gen.averageDbm), f1(cam.averageDbm)]) assert.ok(note('noise-eng-press-pit').includes(v), v);
  for (const id of ['noise-flash-at-pit', 'noise-ptt-beside-bodypack', 'noise-phone-buzz', 'noise-dimmer-circuit', 'noise-eng-press-pit']) {
    assert.ok(buildExample(id), id); assert.match(note(id), /^(Problem|Less ideal|Best practice)/, id); assert.ok(note(id).split('. ').length <= 4, id);
  }
});
