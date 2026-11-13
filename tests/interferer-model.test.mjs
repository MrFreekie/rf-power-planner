import test from 'node:test';
import assert from 'node:assert/strict';
import { captureState, CLEAN_CIR_DB, DEFAULT_CAPTURE_RATIO_DB } from '../js/model/interferer.js';
import { INTERFERER_PARAMS } from '../js/model/mpx-params.js';
import { mpxState } from '../js/model/mpx.js';

const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} got ${a}, want ${b} +/- ${tol}`);
const CFG = {
  bandwidthHz: 200000, noiseFigureDb: 8, thresholdCnrDb: 12, blendStartCnrDb: 30, blendEndCnrDb: 18,
  pilotDetectCnrDb: 14, pilotHysteresisDb: 2, pilotInjection: 0.1, fmImprovementDb: 26.5, stereoPenaltyDb: 22,
  maxSeparationDb: 40, pilotSquelchEnabled: true,
};
const smooth = (t) => t * t * (3 - 2 * t);

test('captureState: who captures, C/I, quality from the capture suppression (hand-checked)', () => {
  let c = captureState(-60, -80);
  assert.equal(c.captured, 'wanted');
  near(c.cirDb, 20, 1e-12);
  near(c.audioQuality, 1, 1e-12);
  assert.equal(c.carrierLevelDbm, -60);
  c = captureState(-60, -50);
  assert.equal(c.captured, 'interferer');
  near(c.cirDb, -10, 1e-12);
  assert.equal(c.audioQuality, 0);
  assert.ok(c.suppressionDb < 0);
  assert.equal(c.carrierLevelDbm, -50); // carrier squelch sees the stronger carrier
  c = captureState(-60, -61); // 1 dB apart: neither captures; suppression 10 dB (3 dB capture ratio): still garbled
  assert.equal(c.captured, 'none');
  near(c.suppressionDb, 10, 1e-12);
  assert.equal(c.audioQuality, 0);
  // suppression law: 30 dB at the capture ratio, linear below it, 1 dB per dB above
  near(captureState(-58, -60).suppressionDb, 20, 1e-12); // cir 2 -> 20 dB
  near(captureState(-58, -60).audioQuality, 0.5, 1e-12); // smoothstep(0.5)
  near(captureState(-57, -60).suppressionDb, 30, 1e-12); // exactly the capture ratio
  near(captureState(-57, -60).audioQuality, 1, 1e-12); // clean right at the capture ratio (no longer 0.17)
  near(captureState(-50, -60).suppressionDb, 37, 1e-12);
  assert.equal(captureState(-63, -60).captured, 'interferer'); // -3 dB: inclusive
  // capture ratio from the parameters: default typical 3 dB; 1.5 dB (good receiver) and 6 dB (poor) shift the boundaries
  assert.equal(DEFAULT_CAPTURE_RATIO_DB, INTERFERER_PARAMS.captureRatioDb.typical);
  assert.equal(captureState(-58.4, -60, { captureRatioDb: 1.5 }).captured, 'wanted');
  assert.equal(captureState(-58.4, -60, { captureRatioDb: 6 }).captured, 'none');
  near(captureState(-58.5, -60, { captureRatioDb: 1.5 }).suppressionDb, 30, 1e-9);
  assert.equal(CLEAN_CIR_DB, INTERFERER_PARAMS.cleanCiDb);
  // monotonic quality in C/I
  let q = -1;
  for (let cir = -10; cir <= 30; cir += 0.5) { const v = captureState(-60 + cir, -60).audioQuality; assert.ok(v >= q); q = v; }
  const none = captureState(-60, undefined);
  assert.equal(none.captured, 'wanted'); assert.equal(none.audioQuality, 1);
});

test('mpxState with a stronger pilotless interferer: carrier squelch open, pilot lost, mono, muted, garbled', () => {
  const clean = mpxState(-60, CFG, null);
  assert.equal(clean.mode, 'stereo');
  assert.equal(clean.pilotLocked, true);
  assert.equal(clean.muted, false);
  assert.equal('captured' in clean, false); // no interferer: result shape unchanged
  const bad = mpxState(-60, CFG, { pilotLocked: true }, { interferer: { dbm: -50 } });
  assert.equal(bad.captured, 'interferer');
  assert.equal(bad.carrierLevelDbm, -50);
  assert.ok(bad.cnrDb > clean.cnrDb); // the demodulator sees the stronger carrier (carrier squelch opens)
  assert.equal(bad.pilotLocked, false);
  assert.equal(bad.mode, 'mono');
  assert.equal(bad.muted, true); // pilot squelch
  assert.equal(bad.audioQuality, 0);
  assert.ok(bad.audioSnrDb <= bad.cirDb + 20 + 1e-9 && bad.audioSnrDb < clean.audioSnrDb - 20);
  // same, but the interferer has a pilot of its own and captures: pilot present, audio is the wrong program
  const withPilot = mpxState(-60, CFG, null, { interferer: { dbm: -50, pilotPresent: true } });
  assert.equal(withPilot.pilotLocked, true);
  assert.equal(withPilot.audioQuality, 0);
  // wanted captures a weaker pilotless interferer: stereo kept, audio limited by C/I
  const ok = mpxState(-50, CFG, null, { interferer: { dbm: -70 } });
  assert.equal(ok.captured, 'wanted');
  assert.equal(ok.pilotLocked, true);
  assert.equal(ok.mode, 'stereo');
  assert.equal(ok.audioQuality, 1);
  near(ok.audioSnrDb, Math.min(mpxState(-50, CFG, null).audioSnrDb, 20 + 20), 1e-9);
  // beat (within 3 dB): neither captures, pilot lost, quality very low
  const beat = mpxState(-60, CFG, null, { interferer: { dbm: -61 } });
  assert.equal(beat.captured, 'none');
  assert.equal(beat.pilotLocked, false);
  assert.equal(beat.audioQuality, 0);
  // pilot squelch off: not muted, but still mono
  const nosq = mpxState(-60, { ...CFG, pilotSquelchEnabled: false }, null, { interferer: { dbm: -50 } });
  assert.equal(nosq.muted, false);
  assert.equal(nosq.mode, 'mono');
  // an interferer without a level is ignored
  assert.deepEqual(mpxState(-60, CFG, null, { interferer: {} }), clean);
});

test('mpxState takes the capture ratio from the configuration (preset captureRatioDb)', () => {
  // 4 dB C/I: captured by the wanted with the default 3 dB ratio, a garbled beat when the receiver needs 6 dB
  const typical = mpxState(-56, { ...CFG, captureRatioDb: 3 }, null, { interferer: { dbm: -60 } });
  assert.equal(typical.captured, 'wanted');
  const poor = mpxState(-56, { ...CFG, captureRatioDb: 6 }, null, { interferer: { dbm: -60 } });
  assert.equal(poor.captured, 'none');
  assert.equal(poor.pilotLocked, false);
  // an explicit interferer value wins over the preset
  assert.equal(mpxState(-56, { ...CFG, captureRatioDb: 6 }, null, { interferer: { dbm: -60, captureRatioDb: 3 } }).captured, 'wanted');
  // quality at the capture ratio is already clean
  near(mpxState(-57, { ...CFG, captureRatioDb: 3 }, null, { interferer: { dbm: -60 } }).audioQuality, 1, 1e-12);
});
