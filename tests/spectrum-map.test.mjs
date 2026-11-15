import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AXIS_SEGMENTS, BREAK_PX, axisLayout, AXIS_TOTAL_PX, freqToX, xToFreq, segmentAt, BAND_CATALOGUE, bandsAt, dabBlocks, wifi24Channels, wifi5Channels,
  pmr446Channels, tvChannelList, tvChannelOf, tvWidthOf, simulatedOccupancy, simulatedNoiseFloor, projectFrequencies, hashSeed,
} from '../js/model/spectrum-map.js';
import { externalNoiseFigureDb } from '../js/model/rx-params.js';
import { createDefaultScene, validateScene, migrateScene } from '../js/model/scene.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (tol ${tol})`);

test('axis: 15 segments, hand-computed widths and total', () => {
  assert.equal(AXIS_SEGMENTS.length, 15);
  const L = axisLayout();
  near(L.segments[0].widthPx, 61.5, 1e-9, 'A = 20.5 MHz x 3');
  near(L.segments[4].widthPx, 957.6, 1e-9, 'E = 228 MHz x 4.2');
  near(L.segments[7].widthPx, 70, 1e-9, 'G2 = 7 x 10');
  assert.equal(L.breaks.length, 14);
  const sum = L.segments.reduce((s, q) => s + q.widthPx, 0);
  near(L.totalPx, sum + 14 * BREAK_PX, 1e-9);
  assert.equal(AXIS_TOTAL_PX, L.totalPx);
});

test('axis: freq to x and back round-trips (tol 1e-9 MHz), gaps give null', () => {
  for (const f of [87.5, 100, 175, 446.1, 606, 614, 700, 863, 868, 1575.42, 1790, 1890, 2437, 5800, 5875]) {
    const x = freqToX(f);
    assert.ok(x !== null, `f ${f}`);
    near(xToFreq(x), f, 1e-9, `f ${f}`);
  }
  assert.equal(freqToX(300), null);
  near(freqToX(300, { clamp: true }), (axisLayout().breaks[2].x0 + axisLayout().breaks[2].x1) / 2, 1e-9);
  assert.equal(xToFreq(61.5 + 7), null, 'on a break glyph');
  near(freqToX(108) - freqToX(87.5), 61.5, 1e-9);
  assert.equal(segmentAt(606), 'E');
  assert.equal(segmentAt(900), 'H');
});

test('TV channels: 8 MHz plan hand values (ch38 606-614, ch21 470-478, ch69 854-862)', () => {
  const c = tvChannelList(8);
  assert.equal(c.length, 49);
  const g = (n) => c.find((q) => q.n === n);
  assert.deepEqual([g(38).loMHz, g(38).hiMHz, g(38).centreMHz], [606, 614, 610]);
  assert.deepEqual([g(21).loMHz, g(21).hiMHz], [470, 478]);
  assert.deepEqual([g(69).loMHz, g(69).hiMHz], [854, 862]);
  assert.equal(tvChannelOf(610, 8).n, 38);
  assert.equal(tvChannelOf(614, 8).n, 39, 'upper edge belongs to the next channel');
});

test('TV channels: 6 MHz plan hand values (ch14 470-476, ch36 602-608, ch37 608-614, ch38 614-620, ch51 692-698)', () => {
  const c = tvChannelList(6);
  const g = (n) => c.find((q) => q.n === n);
  assert.deepEqual([g(14).loMHz, g(14).hiMHz], [470, 476]);
  assert.deepEqual([g(36).loMHz, g(36).hiMHz], [602, 608]);
  assert.deepEqual([g(37).loMHz, g(37).hiMHz], [608, 614]);
  assert.equal(g(37).status, 'protected');
  assert.deepEqual([g(38).loMHz, g(38).hiMHz], [614, 620]);
  assert.deepEqual([g(51).loMHz, g(51).hiMHz], [692, 698]);
  assert.equal(tvWidthOf({}), 8);
  assert.equal(tvWidthOf({ tvChannelWidthMHz: 6 }), 6);
  assert.equal(tvWidthOf({ tvChannelWidthMHz: 7 }), 8);
});

test('DAB band III blocks: 5A 174.928, 11D 222.064, 12B 225.648, 13F 239.2 (tol 1e-6)', () => {
  const b = dabBlocks();
  const g = (id) => b.find((q) => q.id === id);
  near(g('5A').centreMHz, 174.928, 1e-6);
  near(g('11D').centreMHz, 222.064, 1e-6);
  near(g('12B').centreMHz, 225.648, 1e-6);
  near(g('13F').centreMHz, 239.2, 1e-6);
  near(g('5A').hiMHz - g('5A').loMHz, 1.536, 1e-9);
  assert.equal(b.length, 8 * 4 + 6);
});

test('Wi-Fi and PMR446 channels', () => {
  const w = wifi24Channels();
  assert.equal(w[0].centreMHz, 2412);
  assert.equal(w[5].centreMHz, 2437);
  assert.equal(w[12].centreMHz, 2472);
  assert.equal(w[13].centreMHz, 2484);
  assert.equal(wifi5Channels()[0].centreMHz, 5745);
  assert.equal(wifi5Channels().at(-1).centreMHz, 5885);
  const p = pmr446Channels();
  assert.equal(p.length, 8);
  near(p[0].centreMHz, 446.00625, 1e-9);
  near(p[7].centreMHz, 446.09375, 1e-9);
  assert.equal(pmr446Channels(true).length, 16);
});

test('band catalogue: entries carry S/I/U flags and bandsAt filters by region', () => {
  for (const b of BAND_CATALOGUE) { assert.ok(['S', 'I', 'U'].includes(b.flag), b.id); assert.ok(b.hiMHz > b.loMHz, b.id); }
  assert.ok(bandsAt(446.1).some((b) => b.id === 'pmr446'));
  assert.ok(bandsAt(610, 'us').some((b) => b.id === 'us-ch37'));
  assert.ok(!bandsAt(610, 'uk').some((b) => b.id === 'us-ch37'));
  assert.ok(bandsAt(2437).some((b) => b.id === 'wifi-24'));
});

test('occupancy: deterministic, UK counts in range with ch38 free, US ch37 never TV', () => {
  const a = simulatedOccupancy('uk-city', 7), b = simulatedOccupancy('uk-city', 7);
  assert.deepEqual(a, b);
  assert.ok(a.illustrative);
  for (let s = 1; s <= 30; s++) {
    const o = simulatedOccupancy('uk-city', s);
    assert.ok(o.occupiedCount >= 8 && o.occupiedCount <= 10, `city ${o.occupiedCount}`);
    assert.equal(o.channels.find((c) => c.n === 38).occupied, false);
    const r = simulatedOccupancy('uk-rural', `venue${s}`);
    assert.ok(r.occupiedCount >= 5 && r.occupiedCount <= 7);
    const us = simulatedOccupancy('us-top10', s);
    assert.ok(us.occupiedCount >= 16 && us.occupiedCount <= 20, `us ${us.occupiedCount}`); // 23 channels x 0.70..0.85 = 16.1..19.6, rounded
    assert.ok(!us.channels.some((c) => c.n === 37));
  }
  assert.equal(simulatedOccupancy('nowhere'), null);
});

test('noise floor: kTB at 200 kHz (-120.99 dBm) plus the external noise figure, texture within 0.5 dB', () => {
  const pts = simulatedNoiseFloor({ environment: 'urban', bwKHz: 200, freqsMHz: [100, 600, 2437], seed: 3 });
  for (const p of pts) near(p.dbm, -174 + 10 * Math.log10(200e3) + externalNoiseFigureDb('urban', p.freqMHz), 0.5, `f ${p.freqMHz}`);
  near(-174 + 10 * Math.log10(200e3), -120.99, 0.005);
  assert.deepEqual(pts, simulatedNoiseFloor({ environment: 'urban', bwKHz: 200, freqsMHz: [100, 600, 2437], seed: 3 }));
  const dflt = simulatedNoiseFloor();
  assert.ok(dflt.length > 100 && dflt.every((p) => Number.isFinite(p.dbm) && p.x !== null));
  assert.ok(simulatedNoiseFloor({ environment: 'urban', freqsMHz: [100], seed: 1 })[0].dbm > simulatedNoiseFloor({ environment: 'quiet', freqsMHz: [100], seed: 1 })[0].dbm);
});

test('project frequencies: links, imd transmitters and narrowband noise, with x and TV channel', () => {
  const s = createDefaultScene();
  const list = projectFrequencies(s);
  assert.ok(list.length >= 1);
  const l = list.find((q) => q.source === 'link');
  assert.ok(l);
  near(l.x, freqToX(l.freqMHz), 1e-9);
  const t = list.find((q) => q.source === 'imd');
  if (t) assert.equal(t.freqMHz, s.imd.transmitters.find((q) => q.id === t.id).freqMHz);
  s.links[0].freqMHz = 610;
  assert.equal(projectFrequencies(s).find((q) => q.id === s.links[0].id).tvChannel, 38);
  s.tvChannelWidthMHz = 6;
  assert.equal(projectFrequencies(s).find((q) => q.id === s.links[0].id).tvChannel, 37, '610 MHz is ch37 on the 6 MHz plan');
  s.links[0].freqMHz = 300;
  const g = projectFrequencies(s).find((q) => q.id === s.links[0].id);
  assert.equal(g.inGap, true);
  assert.equal(g.x, null);
  assert.ok(hashSeed('a') !== hashSeed('b'));
});

test('scene field tvChannelWidthMHz: optional 6 or 8, older files unchanged', () => {
  const s = createDefaultScene();
  assert.equal(s.tvChannelWidthMHz, undefined);
  assert.deepEqual(validateScene(s).errors, []);
  s.tvChannelWidthMHz = 6;
  assert.deepEqual(validateScene(s).errors, []);
  s.tvChannelWidthMHz = 7;
  assert.ok(validateScene(s).errors.some((e) => /tvChannelWidthMHz/.test(e)));
  assert.equal(migrateScene(createDefaultScene()).tvChannelWidthMHz, undefined);
});
