// Analogue FM equipment presets (js/model/fm-presets.js): data, flags, wiring into validation / cascade / overload / squelch / intermod.
// Hand values: kTB(200 kHz) = -174 + 10 log10(200000) = -120.99 dBm. Tolerances: 0.05 dB for arithmetic on these values, 0.1 dB for
// implied CNR (rounded to whole dB in the data).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FM_PRESETS, FM_PRESET_IDS, FM_RX_PRESET_IDS, FM_TX_PRESET_IDS, FM_CONFIDENCE_LEVELS, FM_PRESET_DISCLAIMER,
  listFmPresets, getFmPreset, isAssumed, fmTuningCheck, fmNoiseFloorDbm, fmPowerOption, fmLowIntermodDb, applyFmPreset,
} from '../js/model/fm-presets.js';
import { RX_PRESETS, impliedRequiredCnrDb } from '../js/model/rx-params.js';
import { createDefaultScene, createDefaultLink, createImdTransmitter, validateScene, syncScene, RX_PRESET_IDS } from '../js/model/scene.js';
import { solveLink } from '../js/model/rf.js';
import { overloadStep } from '../js/model/overload.js';
import { squelchState } from '../js/model/squelch.js';
import { noiseFloor, txReverseImd } from '../js/model/imd.js';
import { EXAMPLES, buildExample } from '../js/examples.js';

const KTB_200K = -174 + 10 * Math.log10(200000);

function sceneWith(link) {
  const s = createDefaultScene();
  s.environment.externalNoise = 0;
  s.links = [link];
  return syncScene(s);
}
function baseLink() {
  const l = createDefaultLink('mic');
  l.freqMHz = 590;
  l.chain = [];
  l.tx.pos = { x: 2, y: 6, z: 1.5 };
  l.rx.pos = { x: 11, y: 6, z: 2 };
  return l;
}

test('registry: five presets, roles, frozen, disclaimer and per-parameter confidence', () => {
  assert.deepEqual([...FM_PRESET_IDS].slice(0, 5), ['sennheiser-skm5200ii', 'sennheiser-em3732ii', 'shure-ur2', 'shure-ur1', 'shure-ur4d']);
  assert.equal(FM_PRESET_IDS.length, 22);
  assert.equal(FM_TX_PRESET_IDS.length, 14);
  assert.equal(FM_RX_PRESET_IDS.length, 8);
  assert.equal(new Set(FM_PRESET_IDS).size, 22);
  assert.equal(listFmPresets().length, 22);
  assert.equal(listFmPresets({ role: 'tx' }).length, 14);
  assert.equal(listFmPresets({ role: 'rx' }).length, 8);
  assert.equal(getFmPreset('nope'), null);
  assert.match(FM_PRESET_DISCLAIMER, /based on published specs; some figures assumed/i);
  for (const id of FM_PRESET_IDS) {
    const p = FM_PRESETS[id];
    assert.ok(Object.isFrozen(p) && Object.isFrozen(p.params) && Object.isFrozen(p.confidence), id);
    for (const k of ['id', 'label', 'manufacturer', 'model', 'role', 'caveat']) assert.equal(typeof p[k], 'string', `${id}.${k}`);
    assert.ok(p.sources.length >= 1);
    for (const t of p.sources) assert.doesNotMatch(t, /docs\/|research|EQUIPMENT|\.md/i, 'sources are titles only, no private paths');
    assert.doesNotMatch(p.caveat, /docs\/|EQUIPMENT/);
    assert.ok(!p.caveat.includes('\n'));
    // every parameter has a valid confidence flag
    for (const k of Object.keys(p.params)) assert.ok(FM_CONFIDENCE_LEVELS.includes(p.confidence[k]), `${id}.${k} confidence`);
    for (const v of Object.values(p.confidence)) assert.ok(FM_CONFIDENCE_LEVELS.includes(v));
  }
});

test('Sennheiser SKM 5200-II class transmitter: powers, deviation, windows, low-intermod flagged as assumed', () => {
  const p = FM_PRESETS['sennheiser-skm5200ii'];
  assert.deepEqual(p.params.powerOptions.map((o) => o.label), ['10 mW', '10 mW low-intermod mode', '50 mW']);
  // 10 mW = 10 dBm exactly, 50 mW = 10 log10(50) = 16.99 dBm (tolerance 0.01 dB)
  assert.equal(p.params.powerOptions[0].powerDbm, 10);
  assert.ok(Math.abs(p.params.powerOptions[2].powerDbm - 10 * Math.log10(50)) < 0.01);
  assert.equal(p.params.deviationKhz, 40);
  assert.equal(p.params.peakDeviationKhz, 56);
  assert.equal(p.params.tuningStepKhz, 5);
  assert.equal(p.params.switchingBandwidthMHz, 184);
  assert.deepEqual(p.params.tuningWindows.map((w) => [w.id, w.fromMHz, w.toMHz]), [['L', 470, 638], ['N-US', 614, 698], ['N', 614, 798]]);
  assert.equal(p.params.occupiedBwKhz, 400);
  assert.equal(isAssumed(p.id, 'occupiedBwKhz'), true);
  assert.equal(isAssumed(p.id, 'lowIntermod'), true);   // the 30 % claim is not independently verified
  assert.equal(isAssumed(p.id, 'tuningStepKhz'), false);
  assert.equal(isAssumed('nope', 'x'), true);
});

test('Sennheiser EM 3732-II class receiver: published rejection figures, derived sensitivity flagged assumed', () => {
  const p = FM_PRESETS['sennheiser-em3732ii'];
  assert.deepEqual(p.params.adjacentChannelRejectionDb, [{ offsetKhz: 400, db: 75 }, { offsetKhz: 800, db: 80 }]);
  assert.equal(p.params.intermodRejectionMinDb, 80);
  assert.equal(p.params.blockingRejectionMinDb, 80);
  assert.equal(isAssumed(p.id, 'adjacentChannelRejectionDb'), false);
  // Derived sensitivity: kTB(200 kHz) -120.99 + NF 9 + 13 dB CNR = -98.99, stored as -99 (tolerance 0.05 dB)
  assert.ok(Math.abs(fmNoiseFloorDbm(p.id) - (KTB_200K + 9)) < 1e-9);
  assert.ok(Math.abs(p.params.sensitivityDbm - (KTB_200K + 9 + 13)) < 0.05);
  assert.equal(isAssumed(p.id, 'sensitivityDbm'), true);
  assert.equal(isAssumed(p.id, 'noiseFigureDb'), true);
});

test('Shure UR4D / UR1 / UR2: sensitivity mapping, input range, deviation, step, bands', () => {
  const rx = FM_PRESETS['shure-ur4d'].params;
  assert.equal(rx.thresholdSensitivityDbm, -107);      // 12 dB SINAD
  assert.equal(rx.sensitivityDbm, -102);               // 30 dB SINAD used as the planner figure
  assert.deepEqual(rx.ratedInputRangeDbm, { min: -95, max: -30 });
  assert.equal(rx.maxInputDbm, -20);
  assert.equal(rx.p1dBDbm, -25);                       // overload LED level
  assert.equal(rx.imageRejectionDb, 110);
  assert.equal(rx.spuriousRejectionDb, 90);
  assert.deepEqual(rx.antennaInput, { connector: 'BNC', impedanceOhm: 50, dcBiasV: 12.2 });
  assert.equal(rx.deviationKhz, 45);
  assert.equal(rx.tuningStepKhz, 25);
  assert.equal(rx.tuningWindowMaxMHz, 60);
  assert.equal(rx.diversityMode, 'switching');
  assert.equal(isAssumed('shure-ur4d', 'diversityMode'), true);
  assert.equal(isAssumed('shure-ur4d', 'squelch'), true);
  assert.equal(isAssumed('shure-ur4d', 'thresholdSensitivityDbm'), false);
  assert.equal(isAssumed('shure-ur4d', 'ratedInputRangeDbm'), false);
  assert.equal(isAssumed('shure-ur4d', 'tuningWindows'), true);   // band names and edges are not confirmed
  // both sensitivities are consistent with one NF 6 dB receiver: CNR 13 dB (30 dB SINAD) and 8 dB (12 dB SINAD, FM threshold)
  const nf = rx.noiseFigureDb;
  assert.ok(Math.abs(impliedRequiredCnrDb(-102, nf, 200) - 13) < 0.1);
  assert.ok(Math.abs(impliedRequiredCnrDb(-107, nf, 200) - 8) < 0.1);
  for (const id of ['shure-ur1', 'shure-ur2']) {
    const t = FM_PRESETS[id].params;
    assert.deepEqual(t.powerOptions.map((o) => Math.round(10 ** (o.powerDbm / 10))), [10, 50, 100]);
    assert.equal(t.deviationKhz, 45);
    assert.equal(isAssumed(id, 'powerOptions'), true);    // per-band mapping uncertain
    assert.equal(t.lowIntermod.available, false);
  }
});

test('receiver presets register as RX_PRESETS and satisfy the planner level rules', () => {
  for (const id of FM_RX_PRESET_IDS) {
    const r = RX_PRESETS[id];
    assert.ok(r && Object.isFrozen(r), id);
    assert.ok(RX_PRESET_IDS.includes(id));
    assert.equal(r.fmPreset, true);
    assert.ok(Math.abs(impliedRequiredCnrDb(r.sensitivityDbm, r.noiseFigureDb, r.channelBwKhz) - r.requiredCnrDb) < 0.1, id);
    assert.ok(r.sensitivityDbm + r.agcRangeDb <= r.p1dBDbm, id + ' AGC top at or below P1dB');
    assert.ok(r.p1dBDbm <= r.maxInputDbm, id);
    assert.ok(Math.abs(r.iip3Dbm - r.p1dBDbm - 9.6) < 1.5, id);
  }
  // Shure: AGC ceiling = top of the rated input range (-30 dBm), hot threshold = P1dB - margin = -30 dBm
  const u = RX_PRESETS['shure-ur4d'];
  assert.equal(u.sensitivityDbm + u.agcRangeDb, -30);
  assert.equal(u.p1dBDbm - u.hotMarginDb, -30);
});

test('applyFmPreset: tx and rx, immutable, unknown id unchanged, round trip through JSON validates', () => {
  const l0 = baseLink();
  const snap = JSON.stringify(l0);
  const t = applyFmPreset(l0, 'sennheiser-skm5200ii', { powerOptionId: 'loi-10mw' });
  assert.equal(JSON.stringify(l0), snap);
  assert.equal(t.tx.fmPreset, 'sennheiser-skm5200ii');
  assert.equal(t.tx.powerDbm, 10);
  assert.equal(t.tx.lowIntermod, true);
  assert.equal(applyFmPreset(l0, 'sennheiser-skm5200ii', { powerOptionId: 'hi-50mw' }).tx.lowIntermod, false);
  assert.equal(applyFmPreset(l0, 'shure-ur2').tx.lowIntermod, undefined);   // not offered by the model
  assert.equal(applyFmPreset(l0, 'shure-ur2', { powerOptionId: 'hi-100mw' }).tx.powerDbm, 20);
  assert.equal(applyFmPreset(l0, 'shure-ur2', { powerOptionId: 'zzz' }).tx.powerDbm, 10);     // unknown option falls back to default
  assert.deepEqual(JSON.parse(JSON.stringify(applyFmPreset(l0, 'nope'))), JSON.parse(snap));
  const r = applyFmPreset(t, 'shure-ur4d');
  assert.equal(r.rx.rxPreset, 'shure-ur4d');
  assert.equal(r.rx.sensitivityDbm, -102);
  assert.deepEqual(r.rx.squelch, { enabled: true, thresholdDbm: -100, hysteresisDb: 3 });
  assert.equal(r.rx.diversity.enabled, true);
  assert.equal(r.rx.diversity.mode, 'switching');
  assert.deepEqual(r.rx.overload, {});
  for (const id of FM_PRESET_IDS) {
    const sc = sceneWith(applyFmPreset(baseLink(), id));
    const back = JSON.parse(JSON.stringify(sc));
    const v = validateScene(back);
    assert.equal(v.ok, true, id + ' ' + JSON.stringify(v.errors));
    assert.deepEqual(back, sc, id + ' round trip');
  }
});

test('validation: fmPreset and lowIntermod fields are optional and checked; old scenes unchanged', () => {
  assert.equal(validateScene(createDefaultScene()).ok, true);
  const sc = sceneWith(baseLink());
  sc.links[0].tx.fmPreset = 'shure-ur4d';                  // an rx id is not a tx preset
  assert.equal(validateScene(sc).ok, false);
  sc.links[0].tx.fmPreset = 'shure-ur2';
  sc.links[0].tx.lowIntermod = 'yes';
  assert.ok(validateScene(sc).errors.some((e) => /lowIntermod/.test(e)));
  sc.links[0].tx.lowIntermod = true;
  assert.equal(validateScene(sc).ok, true);
  sc.links[0].rx.rxPreset = 'not-a-preset';
  assert.equal(validateScene(sc).ok, false);
  sc.links[0].rx.rxPreset = 'sennheiser-em3732ii';
  assert.equal(validateScene(sc).ok, true);
  const im = sceneWith(baseLink());
  im.imd.transmitters = [createImdTransmitter({ fmPreset: 'bogus' })];
  assert.equal(validateScene(im).ok, false);
  im.imd.transmitters = [createImdTransmitter({ fmPreset: 'sennheiser-skm5200ii', lowIntermod: true })];
  assert.equal(validateScene(im).ok, true);
});

test('cascade and margin: the UR4D preset uses its own NF, 200 kHz and 13 dB required SNR', () => {
  const generic = sceneWith(baseLink());
  const lu = applyFmPreset(baseLink(), 'shure-ur4d');
  const ur = sceneWith(lu);
  const g = solveLink(generic, generic.links[0]);
  const u = solveLink(ur, ur.links[0]);
  assert.equal(u.cascade.receiverNfDb, 6);
  assert.equal(u.cascade.requiredSource, 'preset');
  assert.ok(Math.abs(u.cascade.requiredSnrDb - 13) < 1e-9);
  assert.ok(Math.abs(u.cascade.noiseFloorDbm - (KTB_200K + 6)) < 0.001);
  // sensitivity at the antenna = -102 dBm (no chain loss), within 0.05 dB of -101.99
  assert.ok(Math.abs(u.cascade.sensitivityAtAntennaDbm - (-101.99)) < 0.05);
  // same path, different receiver: margin changes by exactly the sensitivity difference -102 - (-95) = 7 dB (generic mic default -95)
  assert.ok(Math.abs((u.marginDb - g.marginDb) - 7) < 0.05, `delta ${u.marginDb - g.marginDb}`);
});

test('overload: UR4D flags hot from -30 dBm and overload from -25 dBm, earlier than the generic mic receiver', () => {
  const ur = RX_PRESETS['shure-ur4d'];
  const gen = RX_PRESETS['mic-receiver-typical'];
  assert.equal(overloadStep(null, -35, ur).level, 'ok');
  assert.equal(overloadStep(null, -30, ur).level, 'hot');
  assert.equal(overloadStep(null, -26, ur).level, 'hot');
  assert.equal(overloadStep(null, -25, ur).level, 'overload');
  assert.equal(overloadStep(null, -20, ur).level, 'overload');
  assert.equal(overloadStep(null, -25, gen).level, 'hot');          // generic: P1dB -18, max -10
  assert.equal(overloadStep(null, -32, gen).level, 'ok');
  assert.ok(Math.abs(overloadStep(null, -25, ur).headroomDb) < 1e-9);
  // hysteresis 3 dB: drops back to hot only below -28
  assert.equal(overloadStep('overload', -27, ur).level, 'overload');
  assert.equal(overloadStep('overload', -29, ur).level, 'hot');
});

test('squelch: applied thresholds open and close as set (assumed values)', () => {
  const l = applyFmPreset(baseLink(), 'shure-ur4d');
  assert.equal(squelchState(false, -101, l.rx.squelch).carrierOpen, false);
  assert.equal(squelchState(false, -100, l.rx.squelch).carrierOpen, true);
  assert.equal(squelchState(true, -102, l.rx.squelch).carrierOpen, true);    // hysteresis 3 dB
  assert.equal(squelchState(true, -103.5, l.rx.squelch).carrierOpen, false);
  const s = applyFmPreset(baseLink(), 'sennheiser-em3732ii');
  assert.equal(s.rx.squelch.thresholdDbm, -92);
  assert.equal(s.rx.diversity.mode, 'true');
});

test('intermod: low-intermod mode lowers the transmitter-side product by exactly the preset amount', () => {
  const mk = (loi, fm = 'sennheiser-skm5200ii') => {
    const s = sceneWith(baseLink());
    s.imd.enabled = true;
    s.imd.preset = 'iem-combiner-no-isolation';
    s.imd.combiner = { type: 'hybrid', isolationDb: 25, lossDb: 3.5 };
    s.imd.transmitters = [[606.1, 3, 3], [606.5, 5, 6], [605.7, 9, 4]].map(([f, x, y]) => createImdTransmitter({ freqMHz: f, powerDbm: 10, pos: { x, y, z: 1.5 }, fmPreset: fm, lowIntermod: loi }));
    return s;
  };
  const level = (s) => txReverseImd(s).find((p) => p.order === 3 && Math.abs(p.fMHz - 605.7) < 1e-6 && p.label === '2f1-f2').levelDbm;
  const std = level(mk(false));
  const loi = level(mk(true));
  assert.ok(Math.abs((std - loi) - 6) < 1e-9, `delta ${std - loi}`);
  assert.equal(fmLowIntermodDb('sennheiser-skm5200ii', true), 6);
  assert.equal(fmLowIntermodDb('sennheiser-skm5200ii', false), 0);
  assert.equal(fmLowIntermodDb('shure-ur2', true), 0);
  // Hand value: pIn = 10 - 25 = -15 dBm, minus conversion 20 dB = -35 dBm at the PA, minus combiner loss 3.5 dB, plus the path gain
  const s = mk(false);
  const p = txReverseImd(s).find((q) => q.label === '2f1-f2' && Math.abs(q.fMHz - 605.7) < 1e-6);
  assert.ok(Math.abs(p.atPaOutDbm - (-35)) < 1e-9);
  // standard FM transmitter without preset keeps the old class-AB default (20 dB), so no change for old scenes
  const old = mk(false, null);
  assert.ok(Math.abs(level(old) - std) < 1e-9);
  // lowIntermod without an fmPreset does nothing (old behaviour)
  const noPreset = mk(true, null);
  assert.ok(Math.abs(level(noPreset) - std) < 1e-9);
  // the worst-channel noise rise falls when the mode is on
  assert.ok(noiseFloor(mk(true)).riseDb < noiseFloor(mk(false)).riseDb);
});

test('tuning check: windows and step grid', () => {
  assert.deepEqual(fmTuningCheck('shure-ur4d', 590), { inWindow: true, window: 'span', onGrid: true });
  assert.equal(fmTuningCheck('shure-ur4d', 590.0125).onGrid, false);
  assert.equal(fmTuningCheck('shure-ur4d', 500).inWindow, false);
  assert.equal(fmTuningCheck('sennheiser-skm5200ii', 500).window, 'L');
  assert.equal(fmTuningCheck('sennheiser-skm5200ii', 798).inWindow, true);
  assert.equal(fmTuningCheck('sennheiser-skm5200ii', 800).inWindow, false);
  assert.equal(fmTuningCheck('sennheiser-skm5200ii', 600.005).onGrid, true);
  assert.equal(fmTuningCheck('sennheiser-skm5200ii', 600.003).onGrid, false);
  assert.equal(fmTuningCheck('nope', 600).inWindow, false);
  assert.equal(fmPowerOption('shure-ur4d', 'x'), null);
  assert.equal(fmPowerOption('shure-ur1', 'hi-50mw').label, '50 mW (band dependent)');
});

test('example scenes: UR4D-style link', () => {
  const ex = buildExample('ur4d-style-link');
  assert.ok(ex);
  assert.equal(validateScene(ex.scene).ok, true);
  const l = ex.scene.links[0];
  assert.equal(l.rx.rxPreset, 'shure-ur4d');
  assert.equal(l.tx.fmPreset, 'shure-ur2');
  assert.ok(Math.abs(l.tx.powerDbm - 16.99) < 0.01);
  assert.equal(fmTuningCheck('shure-ur2', l.freqMHz).onGrid, true);
  const r = solveLink(ex.scene, l);
  assert.ok(Math.abs(r.marginDb - 65.5) < 0.1, `margin ${r.marginDb}`);        // note says 65.5 dB
  assert.match(ex.note, /65\.5 dB/);
  assert.match(ex.note, /assumed/);
  assert.match(ex.note, /-102 dBm at 30 dB SINAD/);
  // walking to 2.5 m: overloaded
  const near = JSON.parse(JSON.stringify(ex.scene));
  near.links[0].tx.pos.x = 14.5;
  assert.equal(overloadStep(null, solveLink(near, near.links[0]).inputPowerDbm, RX_PRESETS[l.rx.rxPreset]).level, 'overload');
  const far = solveLink(ex.scene, l).inputPowerDbm;
  assert.equal(overloadStep(null, far, RX_PRESETS[l.rx.rxPreset]).level, 'ok');
  assert.ok(ex.note.split('. ').length <= 4);
});

test('example scenes: SKM 5200-II low-intermod versus standard in the intermod demo', () => {
  const ex = buildExample('skm-low-intermod');
  assert.ok(ex);
  assert.equal(validateScene(ex.scene).ok, true);
  assert.equal(ex.scene.imd.enabled, true);
  assert.ok(ex.scene.imd.transmitters.every((t) => t.fmPreset === 'sennheiser-skm5200ii' && t.lowIntermod === false && t.powerDbm === 10));
  const std = noiseFloor(ex.scene).riseDb;
  const on = JSON.parse(JSON.stringify(ex.scene));
  on.imd.transmitters.forEach((t) => { t.lowIntermod = true; });
  const low = noiseFloor(on).riseDb;
  assert.ok(Math.abs(std - 20.3) < 0.05, `std ${std}`);
  assert.ok(Math.abs(low - 14.8) < 0.05, `low ${low}`);
  assert.ok(low < std);
  assert.match(ex.note, /20\.3 dB/);
  assert.match(ex.note, /14\.8 dB/);
  assert.match(ex.note, /assumed/);
  assert.ok(ex.note.split('. ').length <= 4);
  assert.ok(EXAMPLES.some((e) => e.id === 'ur4d-style-link') && EXAMPLES.some((e) => e.id === 'skm-low-intermod'));
});

// ---- fmDeviationComparison ------------------------------------------------------------------------------------------
import { fmDeviationComparison, FM_DEVIATION_DEFAULT_SYSTEMS } from '../js/model/fm-deviation.js';

test('fmDeviationComparison: hand values for Carson bandwidth, index, 20 log deviation ratio, threshold', () => {
  const r = fmDeviationComparison();   // -80 dBm, NF 6, 15 kHz audio (3 kHz narrowband)
  const by = Object.fromEntries(r.systems.map((s) => [s.id, s]));
  assert.deepEqual(r.systems.map((s) => s.carsonBwKhz), [110, 120, 180, 31]);   // 2 (dev + fmax), exact
  assert.ok(Math.abs(by['skm5200ii-class'].modulationIndex - 40 / 15) < 1e-12);
  assert.equal(by['ur4d-class'].modulationIndex, 3);
  assert.equal(by['broadcast-fm'].modulationIndex, 5);
  // improvement = 10 log10(1.5 beta^2 B/W): +-40: 1.5 * 7.111 * 7.333 = 78.22 -> 18.93 dB (tolerance 0.01)
  assert.ok(Math.abs(by['skm5200ii-class'].fmImprovementDb - 10 * Math.log10(78.2222)) < 0.01);
  // audio SNR above threshold rises 20 log10(deviation ratio) at equal input level and equal audio bandwidth (tolerance 1e-9 dB, B cancels)
  assert.ok(Math.abs(by['ur4d-class'].snrVsReferenceDb - 20 * Math.log10(45 / 40)) < 1e-9);   // 1.02 dB
  assert.ok(Math.abs(by['broadcast-fm'].snrVsReferenceDb - 20 * Math.log10(75 / 40)) < 1e-9); // 5.46 dB
  // threshold CNR in the matched Carson bandwidth is 10 dB for every system; the threshold input level rises 10 log10(B ratio)
  for (const s of r.systems) assert.ok(Math.abs(s.thresholdCnrDb - 10) < 1e-9, s.id);
  assert.ok(Math.abs(by['broadcast-fm'].thresholdInputVsReferenceDb - 10 * Math.log10(180 / 110)) < 1e-9);  // 2.14 dB
  assert.ok(Math.abs(by['skm5200ii-class'].thresholdInputDbm - (-174 + 10 * Math.log10(110000) + 6 + 10)) < 1e-9);
  assert.ok(Math.abs(by['skm5200ii-class'].thresholdInputDbm - (-107.59)) < 0.01);
  // absolute audio SNR (SKM): P - (-168) - 10 log10(15000) + 1.76 + 20 log10(2.667) = 56.5 dB (tolerance 0.05)
  assert.ok(Math.abs(by['skm5200ii-class'].audioSnrDb - 56.5) < 0.05, String(by['skm5200ii-class'].audioSnrDb));
});

test('fmDeviationComparison: channel fit, adjacent channel gap, rejection, below threshold, tone-key, flags', () => {
  const r = fmDeviationComparison();
  const by = Object.fromEntries(r.systems.map((s) => [s.id, s]));
  assert.deepEqual(by['broadcast-fm'].fit.map((f) => [f.channelKhz, f.fits, f.marginKhz]), [[200, true, 20], [400, true, 220]]);
  assert.ok(Math.abs(by['broadcast-fm'].fit[0].occupancyPct - 90) < 1e-9);
  assert.deepEqual([by['skm5200ii-class'].adjacent.gapKhz, by['broadcast-fm'].adjacent.gapKhz, by['narrowband-two-way'].adjacent.gapKhz], [290, 220, 369]);
  assert.equal(by['skm5200ii-class'].adjacent.acrDb, 75);
  const wide = fmDeviationComparison({ channelBwsKhz: [150], adjacentOffsetKhz: 600 });
  assert.equal(wide.systems[2].fit[0].fits, false);          // 180 kHz in 150 kHz
  assert.equal(wide.systems[0].fit[0].fits, true);           // 110 kHz in 150 kHz
  assert.ok(Math.abs(wide.systems[0].adjacent.acrDb - 77.5) < 1e-9);   // linear in dB between 75 @400 and 80 @800
  assert.equal(fmDeviationComparison({ adjacentOffsetKhz: 200 }).systems[0].adjacent.acrDb, null);  // not specified inside 400 kHz
  assert.equal(fmDeviationComparison({ adjacentOffsetKhz: 100 }).systems[0].adjacent.overlaps, true);
  // below threshold: weak input, the audio SNR collapses and the flag is set
  const weak = fmDeviationComparison({ inputDbm: -110 });
  assert.equal(weak.systems[0].belowThreshold, true);
  assert.ok(weak.systems[0].audioSnrDb < weak.systems[0].cnrDb + weak.systems[0].fmImprovementDb);
  // tone-key above the audio widens the bandwidth: fmax = 32 kHz (illustrative value) -> Carson 2 (40 + 32) = 144
  const tk = fmDeviationComparison({ systems: [{ id: 'x', label: 'x', deviationKhz: 40, audioBwKhz: 15, toneKeyKhz: 32 }] });
  assert.equal(tk.systems[0].carsonBwKhz, 144);
  assert.equal(tk.systems[0].fmaxKhz, 32);
  // confidence flags: the UR4D deviation is sourced, everything else carries an assumed/inferred flag; frozen result; defaults not mutated
  assert.ok(!by['ur4d-class'].assumed.includes('deviationKhz'));
  assert.ok(by['skm5200ii-class'].assumed.includes('deviationKhz'));
  assert.ok(by['narrowband-two-way'].assumed.includes('audioBwKhz'));
  assert.ok(r.assumedFigures.length >= 4 && Object.isFrozen(r) && Object.isFrozen(r.systems[0]));
  assert.equal(FM_DEVIATION_DEFAULT_SYSTEMS.length, 4);
  assert.equal(fmDeviationComparison({ referenceId: 'broadcast-fm' }).systems[2].snrVsReferenceDb, 0);
});

test('example scene: FM deviation comparison note matches the function', () => {
  const ex = buildExample('fm-deviation-compare');
  assert.ok(ex);
  assert.equal(validateScene(ex.scene).ok, true);
  assert.equal(ex.scene.links[0].tx.fmPreset, 'sennheiser-skm5200ii');
  assert.equal(ex.scene.links[0].rx.rxPreset, 'sennheiser-em3732ii');
  const r = fmDeviationComparison({ inputDbm: -80 });
  const [a, b, c, d] = r.systems;
  assert.match(ex.note, new RegExp(`${a.carsonBwKhz} kHz at \[+]-40`));
  assert.match(ex.note, new RegExp(`${b.carsonBwKhz} kHz at \[+]-45`));
  assert.match(ex.note, new RegExp(`${c.carsonBwKhz} kHz for \[+]-75`));
  assert.match(ex.note, new RegExp(`${d.carsonBwKhz} kHz for \[+]-12\[.]5`));
  assert.ok(ex.note.includes(`${b.snrVsReferenceDb.toFixed(1)} dB for +-45`));
  assert.ok(ex.note.includes(`${c.snrVsReferenceDb.toFixed(1)} dB for +-75`.replace('dB for +-75', 'dB for +-75')) || ex.note.includes(`and ${c.snrVsReferenceDb.toFixed(1)} dB for +-75`));
  assert.ok(ex.note.includes(`${a.thresholdInputDbm.toFixed(1)} to ${c.thresholdInputDbm.toFixed(1)} dBm`));
  assert.ok(ex.note.includes(`broadcast uses ${Math.round(c.fit[0].occupancyPct)} percent`));
  assert.ok(ex.note.includes(`${Math.round(c.adjacent.gapKhz)} to ${Math.round(a.adjacent.gapKhz)} kHz gap`));
  assert.match(ex.note, /assumed/);
  assert.ok(ex.note.split('. ').length <= 4);
});

// ---- Sennheiser G3 and 2000 series ----------------------------------------------------------------------------------
import { FM_DEVIATION_G3_SYSTEM, FM_DEVIATION_EXTENDED_SYSTEMS } from '../js/model/fm-deviation.js';

test('G3 / 2000 presets: ids, no invented products, no ew 500 IEM, no SK/SKM 2050', () => {
  const ids = FM_PRESET_IDS.filter((i) => i.startsWith('sennheiser-') && !['sennheiser-skm5200ii', 'sennheiser-em3732ii'].includes(i));
  assert.equal(ids.length, 17);
  for (const bad of ['sennheiser-sk2050', 'sennheiser-skm2050', 'sennheiser-sr500iemg3', 'sennheiser-ek500iemg3', 'sennheiser-sr500iem']) assert.ok(!FM_PRESETS[bad], bad);
  for (const p of listFmPresets()) assert.ok(!/SK 2050|SKM 2050|500 IEM/.test(p.model), p.model);
  assert.equal(FM_PRESETS['sennheiser-em2050'].model, 'EM 2050 / EM 2000');
});

test('G3 / 2000: deviation, windows, steps, banks, power', () => {
  for (const id of ['sk100g3', 'skm100g3', 'sk300g3', 'skm300g3', 'sk500g3', 'skm500g3', 'sk2000', 'skm2000', 'skp2000', 'sr300iemg3', 'sr2050iem']) {
    const p = FM_PRESETS['sennheiser-' + id].params;
    assert.equal(p.deviationKhz, 24); assert.equal(p.peakDeviationKhz, 48); assert.equal(p.tuningStepKhz, 25);
    assert.equal(p.tuningWindowMaxMHz, id.includes('2000') || id === 'sr2050iem' ? 75 : 42);
  }
  assert.equal(FM_PRESETS['sennheiser-sk300g3'].confidence.deviationKhz, 'inferred');
  assert.equal(FM_PRESETS['sennheiser-sk500g3'].confidence.deviationKhz, 'sourced');
  assert.equal(FM_PRESETS['sennheiser-ek300iemg3'].confidence.deviationKhz, 'sourced');
  const mw = (id) => FM_PRESETS['sennheiser-' + id].params.powerOptions.map((o) => Math.round(10 ** (o.powerDbm / 10)));
  assert.deepEqual(mw('sk100g3'), [30]);
  assert.deepEqual(mw('skm100g3'), [30]);
  assert.deepEqual(mw('sk300g3'), [10, 30]);
  assert.deepEqual(mw('sk500g3'), [10, 30]);
  assert.deepEqual(mw('sk2000'), [10, 30, 50]);
  assert.deepEqual(mw('sr2050iem'), [10, 30, 50, 100]);
  assert.equal(FM_PRESETS['sennheiser-sr2050iem'].params.powerOptions[3].assumed, true);
  assert.equal(FM_PRESETS['sennheiser-skm300g3'].confidence.powerOptions, 'assumed');
  assert.equal(FM_PRESETS['sennheiser-skm500g3'].confidence.powerOptions, 'assumed');
  assert.equal(FM_PRESETS['sennheiser-sk300g3'].confidence.powerOptions, 'sourced');
  assert.equal(FM_PRESETS['sennheiser-sk2000'].params.channelsPerBank, 64);
  assert.equal(FM_PRESETS['sennheiser-sr2050iem'].params.channelsPerBank, 32);
  assert.equal(FM_PRESETS['sennheiser-em100g3'].params.channelsPerBank, 12);
  assert.equal(FM_PRESETS['sennheiser-em500g3'].params.channelsPerBank, 32);
  assert.equal(FM_PRESETS['sennheiser-sk2000'].params.frequencies, 3000);
  assert.equal(FM_PRESETS['sennheiser-sk100g3'].params.frequencies, 1680);
  const g3 = FM_PRESETS['sennheiser-em300g3'].params.tuningWindows;
  assert.deepEqual(g3.map((w) => [w.id, w.fromMHz, w.toMHz]), [['A', 516, 558], ['G', 566, 608], ['B', 626, 668], ['C', 734, 776], ['D', 780, 822], ['E', 823, 865]]);
  for (const w of g3) assert.ok(w.toMHz - w.fromMHz <= 42);
  assert.equal(FM_PRESETS['sennheiser-em300g3'].confidence.tuningWindows, 'inferred');
  assert.equal(isAssumed('sennheiser-em300g3', 'tuningWindows'), true);
  assert.ok(!g3.some((w) => w.fromMHz === 606));
  assert.ok(FM_PRESETS['sennheiser-em2050'].params.tuningWindows.some((w) => w.id === 'GBw' && w.fromMHz === 606 && w.toMHz === 678));
  assert.equal(FM_PRESETS['sennheiser-em2050'].params.tuningWindows.length, 8);
  assert.equal(FM_PRESETS['sennheiser-ek2000iem'].params.tuningWindows.length, 5);
  assert.deepEqual(fmTuningCheck('sennheiser-em300g3', 590), { inWindow: true, window: 'G', onGrid: true });
  assert.equal(fmTuningCheck('sennheiser-em300g3', 620).inWindow, false);
  assert.equal(fmTuningCheck('sennheiser-em2050', 620).window, 'Gw');
});

test('G3 / 2000 receivers: microvolt to dBm at 50 ohm, derived NF, squelch dBuV to dBm', () => {
  // 20 log10(2e-6) - 10 log10(50) + 30 = -113.98 - 16.99 + 30 = -100.97 dBm; stored to 0.1 dB (tolerance 0.05 dB)
  const exact = (uv) => 20 * Math.log10(uv * 1e-6) - 10 * Math.log10(50) + 30;
  for (const [id, uv] of [['em100g3', 2], ['em300g3', 2], ['em500g3', 2], ['em2050', 2], ['ek300iemg3', 4], ['ek2000iem', 4]]) {
    const p = FM_PRESETS['sennheiser-' + id].params;
    assert.ok(Math.abs(p.sensitivityDbm - exact(uv)) < 0.1, id);
    assert.equal(p.sensitivityUv, uv);
    assert.equal(p.sensitivityCriterion, '52 dBA rms S/N');
    assert.equal(isAssumed('sennheiser-' + id, 'sensitivityDbm'), true);
    assert.ok(Math.abs(impliedRequiredCnrDb(p.sensitivityDbm, p.noiseFigureDb, 200) - 13) < 0.1, id);
    assert.equal(p.squelch.thresholdDbm, 15 - 107);
    assert.equal(p.pilotSquelchSwitchable, true);
  }
  assert.ok(Math.abs(FM_PRESETS['sennheiser-ek300iemg3'].params.typicalSensitivityDbm - exact(1.6)) < 0.05);
  assert.equal(FM_PRESETS['sennheiser-em100g3'].params.squelchOptionsDbuv.values.join(), '5,15,25');
  assert.equal(FM_PRESETS['sennheiser-em2050'].confidence.sensitivityUv, 'assumed');
  assert.equal(FM_PRESETS['sennheiser-em500g3'].params.squelchOptionsDbuv.stepDb, 2);
  assert.equal(FM_PRESETS['sennheiser-em300g3'].confidence.squelchOptionsDbuv, 'assumed');
  assert.equal(FM_PRESETS['sennheiser-em2050'].params.diversityMode, 'true');
  assert.equal(FM_PRESETS['sennheiser-ek2000iem'].params.diversityMode, 'ratio');
  assert.equal(isAssumed('sennheiser-ek2000iem', 'diversityMode'), true);
  assert.equal(FM_PRESETS['sennheiser-em2050'].params.antennaInput.dcBiasV, 11);
});

test('G3 / 2000 receivers: rejection figures stored as data, not mapped to IIP3', () => {
  const f = (id) => { const p = FM_PRESETS['sennheiser-' + id].params; return [p.adjacentChannelRejectionMinDb, p.intermodRejectionMinDb, p.blockingRejectionMinDb]; };
  assert.deepEqual(f('em100g3'), [65, 65, 70]);
  assert.deepEqual(f('em300g3'), [75, 70, 75]);
  assert.deepEqual(f('em500g3'), [75, 70, 75]);
  assert.deepEqual(f('ek300iemg3'), [65, 70, 80]);
  assert.deepEqual(f('em2050'), [80, 75, 80]);
  assert.deepEqual(f('ek2000iem'), [80, 78, 80]);
  assert.equal(FM_PRESETS['sennheiser-em300g3'].confidence.intermodRejectionMinDb, 'assumed');
  assert.equal(FM_PRESETS['sennheiser-em100g3'].confidence.intermodRejectionMinDb, 'sourced');
  for (const id of ['em100g3', 'em2050', 'ek2000iem']) assert.equal(RX_PRESETS['sennheiser-' + id].iip3Dbm, FM_PRESETS['sennheiser-' + id].params.iip3Dbm);
});

test('G3 IEM presets: pilot and sources', () => {
  assert.equal(FM_PRESETS['sennheiser-sr2050iem'].params.mpxPilotKhz, 19);
  assert.equal(FM_PRESETS['sennheiser-sr2050iem'].params.pilotDeviationKhz, 5);
  assert.equal(FM_PRESETS['sennheiser-sr2050iem'].confidence.mpxPilotKhz, 'sourced');
  assert.equal(FM_PRESETS['sennheiser-sr300iemg3'].confidence.mpxPilotKhz, 'inferred');
  assert.equal(FM_PRESETS['sennheiser-sr300iemg3'].confidence.deviationKhz, 'inferred');
  for (const p of listFmPresets()) for (const t of p.sources) assert.doesNotMatch(t, /https?:|archive[.]org|[.]pdf|[.]md/i, p.id);
});

test('G3 receiver changes the margin like its own sensitivity: -101 dBm vs the generic -95 dBm', () => {
  const generic = sceneWith(baseLink());
  const sc = sceneWith(applyFmPreset(baseLink(), 'sennheiser-em100g3'));
  const g = solveLink(generic, generic.links[0]);
  const u = solveLink(sc, sc.links[0]);
  assert.ok(Math.abs((u.marginDb - g.marginDb) - 6) < 0.05, String(u.marginDb - g.marginDb));
  assert.equal(u.cascade.receiverNfDb, 7);
  assert.equal(u.cascade.requiredSource, 'preset');
  const iem = sceneWith(applyFmPreset(baseLink(), 'sennheiser-ek300iemg3'));
  assert.ok(Math.abs((u.marginDb - solveLink(iem, iem.links[0]).marginDb) - 6) < 0.05);
  assert.equal(validateScene(iem).ok, true);
});

test('fmDeviationComparison: optional G3 +-24 kHz system, defaults unchanged', () => {
  assert.equal(FM_DEVIATION_DEFAULT_SYSTEMS.length, 4);
  assert.equal(fmDeviationComparison().systems.length, 4);
  const r = fmDeviationComparison({ includeG3: true });
  assert.equal(r.systems.length, 5);
  assert.equal(r.systems[0].id, 'sennheiser-g3-class');
  assert.equal(FM_DEVIATION_EXTENDED_SYSTEMS.length, 5);
  const g = r.systems[0];
  assert.equal(g.carsonBwKhz, 78);
  assert.ok(Math.abs(g.modulationIndex - 1.6) < 1e-12);
  assert.ok(Math.abs(g.thresholdInputDbm - (-174 + 10 * Math.log10(78000) + 6 + 10)) < 1e-9);
  const skm = r.systems.find((s) => s.id === 'skm5200ii-class');
  assert.ok(Math.abs(skm.snrVsReferenceDb - 20 * Math.log10(40 / 24)) < 1e-9);
  assert.ok(Math.abs(r.systems.find((s) => s.id === 'ur4d-class').snrVsReferenceDb - 20 * Math.log10(45 / 24)) < 1e-9);
  assert.equal(g.confidence.deviationKhz, 'sourced');
  assert.ok(g.assumed.includes('audioBwKhz'));
  assert.equal(fmDeviationComparison({ includeG3: true, systems: [FM_DEVIATION_G3_SYSTEM] }).systems.length, 1);
});

test('example scene: deviation G3 vs SKM vs UR4D, note matches the function', () => {
  const ex = buildExample('fm-deviation-g3-vs-skm');
  assert.ok(ex);
  assert.equal(validateScene(ex.scene).ok, true);
  const l = ex.scene.links[0];
  assert.equal(l.tx.fmPreset, 'sennheiser-sk300g3');
  assert.equal(l.rx.rxPreset, 'sennheiser-em300g3');
  assert.equal(fmTuningCheck('sennheiser-sk300g3', l.freqMHz).onGrid, true);
  const d = FM_DEVIATION_EXTENDED_SYSTEMS;
  const r = fmDeviationComparison({ inputDbm: -80, systems: [d[0], d[1], d[2]] });
  const [g, s, u] = r.systems;
  for (const t of [`${g.carsonBwKhz} kHz of Carson`, `+-40 kHz needs ${s.carsonBwKhz} kHz`, `+-45 kHz needs ${u.carsonBwKhz} kHz`,
    `${s.snrVsReferenceDb.toFixed(1)} dB better at +-40`, `${u.snrVsReferenceDb.toFixed(1)} dB better at +-45`,
    `from ${g.thresholdInputDbm.toFixed(1)} to ${s.thresholdInputDbm.toFixed(1)} and ${u.thresholdInputDbm.toFixed(1)} dBm`,
    `leave ${Math.round(g.adjacent.gapKhz)}, ${Math.round(s.adjacent.gapKhz)} and ${Math.round(u.adjacent.gapKhz)} kHz`]) assert.ok(ex.note.includes(t), t);
  const maxOcc = Math.max(...r.systems.map((x) => x.fit[0].occupancyPct));
  assert.ok(ex.note.includes(`at most ${Math.round(maxOcc)} percent`));
  assert.match(ex.note, /assumed/);
  assert.ok(ex.note.split('. ').length <= 4);
});
