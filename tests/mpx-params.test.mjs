import test from 'node:test';
import assert from 'node:assert/strict';
import { MPX_DEFAULTS, MPX_PRESETS, MPX_STRUCTURE, MPX_RANGES, THERMAL_NOISE_DBM_PER_HZ } from '../js/model/mpx-params.js';

const ids = ['broadcast-like', 'iem-typical', 'iem-wideband'];

test('presets exist and defaults equal iem-typical', () => {
  assert.deepEqual(Object.keys(MPX_PRESETS).sort(), [...ids].sort());
  assert.deepEqual({ ...MPX_DEFAULTS }, { ...MPX_PRESETS['iem-typical'] });
  for (const id of ids) assert.equal(MPX_PRESETS[id].id, id);
});

test('multiplex structure', () => {
  assert.equal(MPX_STRUCTURE.pilotHz * 2, MPX_STRUCTURE.subcarrierHz);
  assert.equal(MPX_STRUCTURE.subcarrierHz - MPX_STRUCTURE.lPlusRHighHz, MPX_STRUCTURE.lMinusRLowHz);
  assert.equal(MPX_STRUCTURE.subcarrierHz + MPX_STRUCTURE.lPlusRHighHz, MPX_STRUCTURE.lMinusRHighHz);
  assert.ok(MPX_STRUCTURE.pilotInjectionFrac >= 0.08 && MPX_STRUCTURE.pilotInjectionFrac <= 0.10);
  assert.ok(MPX_STRUCTURE.lPlusRHighHz < MPX_STRUCTURE.pilotHz); // pilot sits in the gap
  assert.ok(MPX_STRUCTURE.pilotHz < MPX_STRUCTURE.lMinusRLowHz);
  assert.ok(Math.abs(THERMAL_NOISE_DBM_PER_HZ + 174) < 0.1);
});

test('threshold ordering in every preset', () => {
  for (const id of ids) {
    const p = MPX_PRESETS[id];
    assert.ok(p.thresholdCnrDb >= 10 && p.thresholdCnrDb <= 12, id + ' threshold 10..12');
    assert.ok(p.thresholdCnrDb <= p.pilotLoseCnrDb, id + ' threshold <= pilot lose');
    assert.ok(p.pilotLoseCnrDb < p.pilotDetectCnrDb, id + ' pilot hysteresis');
    assert.ok(p.pilotDetectCnrDb <= p.blendEndCnrDb, id + ' pilot detect <= blend end');
    assert.ok(p.blendEndCnrDb < p.blendStartCnrDb, id + ' blend end < start');
    assert.ok(p.blendStartCnrDb - p.blendEndCnrDb >= 3, id + ' blend wide enough to be smooth');
  }
});

test('values within physical ranges', () => {
  for (const id of ids) {
    const p = MPX_PRESETS[id];
    assert.ok(p.channelBwKhz >= 100 && p.channelBwKhz <= 300);
    assert.ok(p.noiseFigureDb >= 3 && p.noiseFigureDb <= 15);
    assert.ok(p.stereoPenaltyDb >= 20 && p.stereoPenaltyDb <= 23);
    assert.ok(p.audioBwKhz >= 10 && p.audioBwKhz <= 20);
    // Carson bandwidth must fit the channel
    assert.ok(2 * (p.peakDeviationKhz + p.audioBwKhz) <= p.channelBwKhz); // Carson
    assert.ok(p.illustrative === true);
    for (const k of Object.keys(MPX_RANGES)) {
      assert.ok(p[k] >= MPX_RANGES[k][0] && p[k] <= MPX_RANGES[k][1], id + ' ' + k);
    }
  }
});

test('wideband has more bandwidth and noise than typical', () => {
  assert.ok(MPX_PRESETS['iem-wideband'].channelBwKhz > MPX_PRESETS['iem-typical'].channelBwKhz);
  assert.ok(MPX_PRESETS['broadcast-like'].blendEndCnrDb > MPX_PRESETS['iem-typical'].blendEndCnrDb); // conservative
});

test('presets are frozen', () => {
  assert.throws(() => { 'use strict'; MPX_PRESETS['iem-typical'].channelBwKhz = 1; }, TypeError);
});

import { fmImprovementDb } from '../js/model/mpx-params.js';
import { noiseFloorDbm, mpxState } from '../js/model/mpx.js';

test('alias fields agree with primary fields and the formula', () => {
  for (const id of ids) {
    const p = MPX_PRESETS[id];
    assert.equal(p.bandwidthHz, p.channelBwKhz * 1000);
    assert.equal(p.pilotHysteresisDb, p.pilotDetectCnrDb - p.pilotLoseCnrDb);
    assert.ok(Math.abs(p.fmImprovementDb - fmImprovementDb(p.peakDeviationKhz, p.audioBwKhz, p.channelBwKhz)) < 0.06);
    assert.ok(p.fmImprovementDb > 15 && p.fmImprovementDb < 35);
  }
});

test('fm improvement hand values', () => {
  // beta 5, B = 200 kHz, W = 15 kHz: 10log10(1.5*25*13.333) = 26.99 dB
  assert.ok(Math.abs(fmImprovementDb(75, 15, 200) - 26.99) < 0.01);
  // Carson bandwidth 180 kHz gives 3 b^2 (b+1) = 450 -> 26.53 dB
  assert.ok(Math.abs(fmImprovementDb(75, 15, 180) - 26.53) < 0.01);
});

test('noise floor and state use the preset (integration with mpx.js)', () => {
  assert.ok(Math.abs(noiseFloorDbm(MPX_PRESETS['iem-typical']) - (-112.99)) < 0.01);
  assert.ok(Math.abs(noiseFloorDbm(MPX_PRESETS['iem-wideband']) - (-110.23)) < 0.01);
  const hi = mpxState(-60, MPX_PRESETS['iem-typical']);
  assert.equal(hi.mode, 'stereo');
  const lo = mpxState(-100, MPX_PRESETS['iem-typical'], hi);
  assert.equal(lo.mode, 'mono');
  assert.equal(lo.blend, 0);
});

import { INTERFERER_PARAMS, captureSuppressionDb } from '../js/model/mpx-params.js';

test('capture ratio and suppression law', () => {
  for (const id of ids) { const p = MPX_PRESETS[id]; assert.ok(p.captureRatioDb >= 1 && p.captureRatioDb <= 3, id); }
  assert.ok(MPX_PRESETS['broadcast-like'].captureRatioDb <= MPX_PRESETS['iem-typical'].captureRatioDb);
  const r = INTERFERER_PARAMS.captureRatioDb;
  assert.ok(r.good < r.typical && r.typical < r.poor);
  assert.equal(captureSuppressionDb(0), 0);
  assert.equal(captureSuppressionDb(3, 3), 30);
  assert.equal(captureSuppressionDb(-3, 3), -30);
  assert.equal(captureSuppressionDb(13, 3), 40);
  let prev = -Infinity;
  for (let c = -30; c <= 30; c += 0.5) { const v = captureSuppressionDb(c, 2); assert.ok(v >= prev); prev = v; }
  assert.equal(INTERFERER_PARAMS.strayCarrier.carrierSquelchOpens, true);
  assert.equal(INTERFERER_PARAMS.strayCarrier.pilotSquelchOpensWhenInterfererCaptures, false);
  assert.ok(Object.isFrozen(INTERFERER_PARAMS.strayCarrier));
});
