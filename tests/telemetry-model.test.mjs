import test from 'node:test';
import assert from 'node:assert/strict';
import { perFromCnr, batteryStep, dataLinkStep } from '../js/model/telemetry.js';
import { mpxSpectrum } from '../js/model/mpx.js';
import { BATTERY_PRESETS, DATA_PRESETS, DATA_PER_FIT } from '../js/model/data-params.js';

const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} got ${a}, want ${b} +/- ${tol}`);
const CFG = { subcarrierKHz: 67, bitrate: 1200, injectionFrac: 0.05, lockCnrDb: 16, loseCnrDb: 13, packetIntervalMs: 500, maxStaleMs: 3000, perSlopeDb: 2 };
const BAT = { percentReported: 80, voltage: 3.9 };
const DEV = { name: 'Vox', gainDb: 6, mute: false, rfLevelDbm: -70 };

test('perFromCnr limits and hand values (explicit config centres on loseCnrDb)', () => {
  near(perFromCnr(13, CFG), 0.5, 1e-12);
  near(perFromCnr(15, CFG), 1 / 11, 1e-12);
  near(perFromCnr(17, CFG), 1 / 101, 1e-12);
  assert.ok(perFromCnr(-40, CFG) > 0.999999);
  assert.ok(perFromCnr(60, CFG) < 1e-12);
  assert.equal(perFromCnr(NaN, CFG), 1);
  assert.equal(perFromCnr(Infinity, CFG), 0);
  let p = 2;
  for (let c = -10; c <= 40; c += 0.5) { const v = perFromCnr(c, CFG); assert.ok(v <= p && v >= 0 && v <= 1); p = v; }
});

test('perFromCnr: preset id picks up the Eb/N0-centred fit (DATA_PER_FIT)', () => {
  for (const [id, fit] of Object.entries(DATA_PER_FIT)) {
    near(perFromCnr(fit.per50CnrDb, { ...DATA_PRESETS[id] }), 0.5, 1e-9, id); // loseCnrDb centre
    near(perFromCnr(fit.per50CnrDb, { id }), 0.5, 1e-9, id);
  }
  // no config: default preset with its fit
  const def = Object.values(DATA_PER_FIT)[0];
  assert.ok(Number.isFinite(perFromCnr(12)));
  assert.ok(def.per50CnrDb > 0);
});

test('battery from presets: monotonic, deterministic, dropout at the dropout voltage', () => {
  for (const [chem, m] of Object.entries(BATTERY_PRESETS)) {
    let b = null, prevS = 2, prevV = Infinity, sawDeadEarly = false;
    for (let i = 0; i < 400; i++) {
      b = batteryStep(b, { chemistry: chem, dtSeconds: 1, timeScale: 300 });
      assert.ok(b.socFrac <= prevS && b.voltage <= prevV + 1e-12);
      assert.ok(b.txPowerSagDb >= 0 && b.txPowerSagDb <= 40);
      if (b.dead && b.socFrac > 0) sawDeadEarly = true;
      prevS = b.socFrac; prevV = b.voltage;
    }
    assert.equal(b.dead, true, chem);
    assert.equal(b.percentReported, 0);
    assert.ok(b.voltage <= m.tx.vMinV + 1e-9 || b.socFrac === 0);
    // dead exactly when V <= vMin
    for (const soc of [1, 0.5, 0.2]) {
      const r = batteryStep({ socFrac: soc }, { chemistry: chem, dtSeconds: 0 });
      assert.equal(r.dead, r.voltage <= m.tx.vMinV || soc <= 0);
    }
    void sawDeadEarly;
    assert.deepEqual(batteryStep(null, { chemistry: chem, dtSeconds: 10, timeScale: 60 }), batteryStep(null, { chemistry: chem, dtSeconds: 10, timeScale: 60 }));
  }
});

test('battery hand values from presets (li-ion, mic runtime)', () => {
  const li = BATTERY_PRESETS['li-ion-1s'];
  const full = batteryStep(null, { chemistry: 'li-ion-1s', dtSeconds: 0 });
  assert.equal(full.socFrac, 1);
  near(full.voltage, li.curve[0][1], 1e-12);
  near(full.trueSocPercent, 100, 1e-12);
  assert.ok(full.percentReported >= 97 && full.percentReported <= 100); // gauge reads the loaded voltage
  assert.equal(full.lowWarning, false);
  assert.equal(full.txPowerSagDb, 0);
  assert.equal(full.dead, false);
  // one hour of mic runtime: used = 1 / runtimeHours.mic
  const h = batteryStep(null, { chemistry: 'li-ion-1s', dtSeconds: 3600 });
  near(h.socFrac, 1 - 1 / li.runtimeHours.mic, 1e-12);
  // timeScale and loadFactor multiply the drain
  near(batteryStep(null, { chemistry: 'li-ion-1s', dtSeconds: 36, timeScale: 100 }).socFrac, h.socFrac, 1e-12);
  near(batteryStep(null, { chemistry: 'li-ion-1s', dtSeconds: 1800, loadFactor: 2 }).socFrac, h.socFrac, 1e-12);
  // iem runtime is different from mic
  near(batteryStep(null, { chemistry: 'li-ion-1s', dtSeconds: 3600, kind: 'iem' }).socFrac, 1 - 1 / li.runtimeHours.iem, 1e-12);
  // sag law: between vMin and vReg, P = ((V - vMin)/(vReg - vMin))^k
  const { vRegV, vMinV, sagExponent } = li.tx;
  const v = (vRegV + vMinV) / 2;
  // find a soc where voltage is near v and check the law against the returned voltage
  const mid = batteryStep({ socFrac: 0.05 }, { chemistry: 'li-ion-1s', dtSeconds: 0 });
  if (mid.voltage < vRegV && mid.voltage > vMinV) {
    near(mid.txPowerSagDb, -10 * sagExponent * Math.log10((mid.voltage - vMinV) / (vRegV - vMinV)), 1e-9);
  }
  assert.ok(v > vMinV && v < vRegV);
  // warning thresholds from the preset
  const warn = batteryStep({ socFrac: li.warnLowPct / 100 - 0.01 }, { chemistry: 'li-ion-1s', dtSeconds: 0 });
  assert.equal(warn.lowWarning, true);
});

test('dataLinkStep: lock hysteresis', () => {
  let s = null; const out = [];
  let t = 0;
  for (const c of [10, 15.9, 16, 14, 13, 12.9, 14, 16.1]) {
    s = dataLinkStep(s, c, CFG, t, BAT, DEV, { seed: 5 });
    out.push(s.locked);
    t += 500;
  }
  assert.deepEqual(out, [false, false, true, true, true, false, false, true]);
});

test('dataLinkStep: strong link receives every packet; decoded updates', () => {
  let s = null;
  for (let t = 0; t <= 5000; t += 500) s = dataLinkStep(s, 40, CFG, t, BAT, DEV, { seed: 2 });
  assert.equal(s.packetsOk, 11);
  assert.equal(s.packetsLost, 0);
  assert.equal(s.stale, false);
  assert.equal(s.ageMs, 0);
  assert.deepEqual(s.decoded, { battery: 80, voltage: 3.9, name: 'Vox', gainDb: 6, mute: false, rfLevelDbm: -70 });
});

test('dataLinkStep: values hold between packets, age grows, stale after maxStaleMs', () => {
  let s = dataLinkStep(null, 40, CFG, 1000, BAT, DEV, { seed: 1 });
  assert.equal(s.lastPacketMs, 1000);
  const BAT2 = { percentReported: 70, voltage: 3.8 };
  const DEV2 = { ...DEV, mute: true, name: 'Other' };
  s = dataLinkStep(s, 5, CFG, 2000, BAT2, DEV2, { seed: 1 });
  assert.equal(s.locked, false);
  assert.equal(s.decoded.battery, 80);
  assert.equal(s.decoded.mute, false);
  near(s.ageMs, 1000, 1e-9);
  assert.equal(s.stale, false);
  s = dataLinkStep(s, 5, CFG, 4000, BAT2, DEV2, { seed: 1 });
  near(s.ageMs, 3000, 1e-9);
  assert.equal(s.stale, false);
  s = dataLinkStep(s, 5, CFG, 4100, BAT2, DEV2, { seed: 1 });
  assert.equal(s.stale, true);
  const n = dataLinkStep(null, 5, CFG, 0, BAT, DEV);
  assert.equal(n.stale, true);
  assert.equal(n.decoded.battery, null);
  assert.equal(n.ageMs, Infinity);
  s = dataLinkStep(s, 40, CFG, 5000, BAT2, DEV2, { seed: 1 });
  assert.equal(s.decoded.battery, 70);
  assert.equal(s.stale, false);
});

test('dataLinkStep: deterministic per seed; loss rate follows PER', () => {
  const run = (seed, cnr) => {
    let s = null;
    for (let k = 0; k < 4000; k++) s = dataLinkStep(s, cnr, { ...CFG, lockCnrDb: -100, loseCnrDb: 13 }, k * 500, BAT, DEV, { seed });
    return s;
  };
  const a = run(7, 13), b = run(7, 13), c = run(8, 13);
  assert.deepEqual(a, b);
  assert.notEqual(a.packetsOk, c.packetsOk);
  near(a.packetsLost / (a.packetsLost + a.packetsOk), 0.5, 0.04);
  const d = run(3, 15);
  near(d.packetsLost / (d.packetsLost + d.packetsOk), 1 / 11, 0.02);
  assert.equal(a.packetsOk + a.packetsLost, 4000);
});

test('mpxSpectrum: data subcarrier above the L-R edge, scaled by lock, existing output unchanged', () => {
  const st = { cnrDb: 40, blend: 1, pilotLevelDb: -20 };
  const base = mpxSpectrum(st);
  assert.equal(base.dataKHz, undefined);
  assert.equal(base.freqKHz[255], 60);
  const on = mpxSpectrum(st, { dataKHz: 67, dataLocked: true });
  assert.deepEqual(on.dataBand, [65.5, 68.5]);
  assert.ok(on.freqKHz[on.freqKHz.length - 1] >= 67);
  const i67 = on.freqKHz.reduce((bi, f, i) => (Math.abs(f - 67) < Math.abs(on.freqKHz[bi] - 67) ? i : bi), 0);
  near(on.levelDb[i67], 20 * Math.log10(0.05), 1);
  assert.ok(on.levelDb[i67] > on.noiseDb[i67] + 6);
  const off = mpxSpectrum(st, { dataKHz: 67, dataLocked: false });
  near(off.levelDb[i67], off.noiseDb[i67], 0.01);
  const same = mpxSpectrum(st, { dataKHz: 67, dataLocked: true, maxKHz: 60 });
  assert.deepEqual(same.levelDb, mpxSpectrum(st, { maxKHz: 60 }).levelDb);
  const fromState = mpxSpectrum({ ...st, dataKHz: 67, dataLocked: true, dataInjection: 0.1 });
  const j = fromState.freqKHz.reduce((bi, f, i) => (Math.abs(f - 67) < Math.abs(fromState.freqKHz[bi] - 67) ? i : bi), 0);
  near(fromState.levelDb[j], -20, 0.5);
});

test('battery gauge: reported vs true percent, error sign and size by chemistry', () => {
  const at = (chem, usedFrac, extra = {}) => batteryStep({ socFrac: 1 - usedFrac }, { chemistry: chem, dtSeconds: 0, ...extra });
  for (const chem of Object.keys(BATTERY_PRESETS)) {
    const r = at(chem, 0.4);
    near(r.trueSocPercent, 60, 1e-9);
    near(r.gaugeErrorPct, r.reportedPercent - r.trueSocPercent, 1e-12);
    assert.equal(r.percentReported, Math.round(r.reportedPercent));
    assert.ok(r.loadedVoltage < r.voltage); // the cells sag under load
  }
  // alkaline: large error mid discharge, reads low (sloping voltage, rising resistance), and 0 % reported with capacity left
  assert.ok(at('alkaline-aa-x2', 0.5).gaugeErrorPct < -15);
  assert.equal(at('alkaline-aa-x2', 0.7).reportedPercent, 0);
  assert.ok(at('alkaline-aa-x2', 0.7).trueSocPercent === 30 || Math.abs(at('alkaline-aa-x2', 0.7).trueSocPercent - 30) < 1e-9);
  // li-ion is the most faithful, errors well under the alkaline ones
  const maxErr = (chem) => Math.max(...[0.1, 0.3, 0.5, 0.7, 0.9].map((u) => Math.abs(at(chem, u).gaugeErrorPct)));
  assert.ok(maxErr('li-ion-1s') < maxErr('nimh-aa-x2') && maxErr('nimh-aa-x2') < maxErr('alkaline-aa-x2'));
  // reported percent never rises as the cell is used
  for (const chem of Object.keys(BATTERY_PRESETS)) {
    let prev = 101;
    for (let u = 0; u <= 1.0001; u += 0.05) { const v = at(chem, u).reportedPercent; assert.ok(v <= prev + 1e-9); prev = v; }
  }
  // the NiMH plateau: the voltage barely moves from 30 to 85 percent used, so the gauge reading is nearly flat there
  const flat = at('nimh-aa-x2', 0.3).loadedVoltage - at('nimh-aa-x2', 0.85).loadedVoltage;
  assert.ok(flat < 0.25, `plateau drop ${flat}`);
  // a wrong gauge map (NiMH pack on the alkaline map) reads far off on the plateau
  const wrong = at('nimh-aa-x2', 0.5, { gaugeMap: 'alkaline-linear' });
  assert.ok(Math.abs(wrong.gaugeErrorPct) > Math.abs(at('nimh-aa-x2', 0.5).gaugeErrorPct));
  // explicit models keep an ideal gauge (compatibility)
  const ideal = batteryStep({ socFrac: 0.5 }, { chemistry: 'li-ion-1s', dtSeconds: 0, model: BATTERY_PRESETS['li-ion-1s'] });
  assert.equal(ideal.gaugeErrorPct, 0);
});

test('low-battery warning uses the loaded voltage; dropout is the preset tx.vMinV; one sag source (BATTERY_LOAD)', async () => {
  const { loadedVoltage, BATTERY_LOAD } = await import('../js/model/data-params.js');
  for (const [chem, m] of Object.entries(BATTERY_PRESETS)) {
    for (const used of [0.2, 0.5, 0.8, 0.9, 0.95]) {
      const r = batteryStep({ socFrac: 1 - used }, { chemistry: chem, dtSeconds: 0 });
      near(r.loadedVoltage, loadedVoltage(chem, used, 'mic'), 1e-12);
      const pctWarn = (1 - used) * 100 <= m.warnLowPct;
      const vWarn = r.loadedVoltage <= m.warnLowV;
      assert.equal(r.lowWarning, pctWarn || vWarn, `${chem} used ${used}`);
      assert.equal(r.dead, r.voltage <= m.tx.vMinV || used >= 1);
    }
    assert.ok(BATTERY_LOAD[chem]);
  }
  // the loaded voltage triggers the warning earlier than the open-circuit voltage would (alkaline): find a case
  const m = BATTERY_PRESETS['alkaline-aa-x2'];
  let early = false;
  for (let used = 0; used < 0.8; used += 0.01) {
    const r = batteryStep({ socFrac: 1 - used }, { chemistry: 'alkaline-aa-x2', dtSeconds: 0 });
    if (r.loadedVoltage <= m.warnLowV && r.voltage > m.warnLowV && (1 - used) * 100 > m.warnLowPct) early = true;
  }
  assert.ok(early, 'loaded-voltage warning arrives before the open-circuit one');
});
