import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA_PER_FIT, DATA_PRESETS, BATTERY_PRESETS, BATTERY_CHEMISTRIES, DATA_STRUCTURE } from '../js/model/data-params.js';
import { MPX_PRESETS } from '../js/model/mpx-params.js';

const L = (x) => 10 * Math.log10(x);
// Documented law: Eb/N0 (dB) = CNR + 10log10(dev_d^2 B / (2 Rb fs^2)), minus slope dB per dB below the FM threshold.
function ebn0(p, cnr, bwKhz = 200, devKhz = 75) {
  const dd = p.injectionFrac * devKhz;
  let e = cnr + L((dd * dd * bwKhz) / (2 * (p.bitrate / 1000) * p.subcarrierKHz ** 2));
  if (cnr < p.fmThresholdCnrDb) e -= p.belowThresholdSlope * (p.fmThresholdCnrDb - cnr);
  return e;
}
const per = (p, cnr) => { const ber = 0.5 * Math.exp(-Math.pow(10, ebn0(p, cnr) / 10)); return 1 - Math.pow(1 - ber, p.packetBits); };

test('data presets: structure, ordering, frozen', () => {
  assert.deepEqual(Object.keys(DATA_PRESETS).sort(), ['narrow-telemetry', 'rds-like']);
  const payload = DATA_STRUCTURE.fields.reduce((s, f) => s + f.bits, 0);
  for (const [id, p] of Object.entries(DATA_PRESETS)) {
    assert.equal(p.id, id);
    assert.ok(p.illustrative && Object.isFrozen(p));
    assert.ok(p.subcarrierKHz > DATA_STRUCTURE.minSubcarrierKhz, 'above the L-R band');
    assert.ok(p.subcarrierKHz + 2 * p.bitrate / 1000 < 100);
    assert.ok(p.fmThresholdCnrDb <= p.loseCnrDb && p.loseCnrDb < p.lockCnrDb, 'hysteresis');
    assert.ok(p.injectionFrac > 0 && p.injectionFrac <= 0.1);
    assert.ok(payload + DATA_STRUCTURE.crcBits <= p.packetBits, 'payload fits');
    assert.ok(p.packetIntervalMs >= (1000 * p.packetBits) / p.bitrate, 'packet fits its interval');
    assert.ok(p.maxStaleMs >= 3 * p.packetIntervalMs);
    assert.ok(DATA_PER_FIT[p.id].per50CnrDb < p.lockCnrDb);
  }
});

test('data link sits below stereo and near the pilot (iem-typical mpx preset)', () => {
  const m = MPX_PRESETS['iem-typical'];
  for (const p of Object.values(DATA_PRESETS)) {
    assert.ok(p.lockCnrDb < m.blendStartCnrDb);
    assert.ok(Math.abs(p.lockCnrDb - m.pilotDetectCnrDb) <= 4, p.id);
  }
  assert.ok(DATA_PRESETS['narrow-telemetry'].lockCnrDb < DATA_PRESETS['rds-like'].lockCnrDb);
});

test('PER law: monotonic, small at lock, matches per50CnrDb', () => {
  for (const p of Object.values(DATA_PRESETS)) {
    let prev = 2;
    for (let c = 0; c <= 30; c += 0.5) { const v = per(p, c); assert.ok(v <= prev + 1e-12); prev = v; }
    assert.ok(per(p, p.lockCnrDb) < 0.05, p.id + ' reliable at lock');
    assert.ok(Math.abs(per(p, DATA_PER_FIT[p.id].per50CnrDb) - 0.5) < 0.12, p.id + ' per50');
  }
  // hand value rds-like: dev_d = 2.25, k = 10log10(2.25^2*200/(2*1.1875*57^2)) = -8.84 dB; at 18 dB EbN0 = 9.16
  assert.ok(Math.abs(ebn0(DATA_PRESETS['rds-like'], 18) - 9.16) < 0.05);
});

test('batteries: curves strictly monotonic, cutoff, warnings, runtime ordering', () => {
  for (const [id, b] of Object.entries(BATTERY_PRESETS)) {
    assert.equal(b.id, id);
    assert.ok(b.illustrative && Object.isFrozen(b));
    assert.equal(b.curve[0][0], 0); assert.equal(b.curve.at(-1)[0], 1);
    assert.equal(b.curve[0][1], b.fullV); assert.equal(b.curve.at(-1)[1], b.cutoffV);
    for (let i = 1; i < b.curve.length; i++) { assert.ok(b.curve[i][0] > b.curve[i - 1][0]); assert.ok(b.curve[i][1] < b.curve[i - 1][1]); }
    for (let i = 1; i < b.socMap.length; i++) { assert.ok(b.socMap[i][0] > b.socMap[i - 1][0]); assert.ok(b.socMap[i][1] > b.socMap[i - 1][1]); }
    assert.equal(b.socMap[0][0], b.cutoffV); assert.equal(b.socMap.at(-1)[0], b.fullV);
    assert.ok(b.cutoffV < b.warnCriticalV && b.warnCriticalV < b.warnLowV && b.warnLowV < b.nominalV && b.nominalV < b.fullV);
    assert.ok(b.warnCriticalPct < b.warnLowPct);
    assert.ok(b.tx.vMinV < b.tx.vRegV && b.tx.vMinV >= b.cutoffV && b.tx.vRegV < b.nominalV + 0.8);
    assert.ok(b.runtimeHours.iem < b.runtimeHours.mic);
  }
  assert.equal(BATTERY_PRESETS['alkaline-aa-x2'].fullV, 3.1);
  assert.equal(BATTERY_PRESETS['li-ion-1s'].fullV, 4.2);
  assert.equal(BATTERY_PRESETS['li-ion-1s'].cutoffV, 3.0);
});

test('NiMH has a plateau: most of the capacity lies in a narrow voltage band', () => {
  const spread = (b, a, z) => { const v = (u) => { const c = b.curve; for (let i = 1; i < c.length; i++) if (u <= c[i][0]) return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * (u - c[i - 1][0]) / (c[i][0] - c[i - 1][0]); return c.at(-1)[1]; }; return v(a) - v(z); };
  const ni = BATTERY_PRESETS['nimh-aa-x2'], al = BATTERY_PRESETS['alkaline-aa-x2'];
  assert.ok(spread(ni, 0.1, 0.85) < 0.25);                 // flat
  assert.ok(spread(al, 0.1, 0.85) > 0.6);                  // sloping
  assert.ok(spread(ni, 0.9, 1) > 0.4);                     // sharp knee
  assert.ok(ni.gaugeErrorPct >= al.gaugeErrorPct && al.gaugeErrorPct > BATTERY_PRESETS['li-ion-1s'].gaugeErrorPct);
});

test('transmit power law', () => {
  const p = (b, v, pn = 1) => v >= b.tx.vRegV ? pn : v <= b.tx.vMinV ? 0 : pn * ((v - b.tx.vMinV) / (b.tx.vRegV - b.tx.vMinV)) ** b.tx.sagExponent;
  const b = BATTERY_PRESETS['alkaline-aa-x2'];
  assert.equal(p(b, 2.5), 1);
  assert.equal(p(b, 1.9), 0);
  assert.ok(Math.abs(p(b, 2.05) - 0.25) < 1e-9);          // halfway between 1.9 and 2.2 -> (0.5)^2
});

test('BATTERY_CHEMISTRIES adapter agrees', () => {
  for (const [id, b] of Object.entries(BATTERY_PRESETS)) {
    const c = BATTERY_CHEMISTRIES[id];
    assert.equal(c.curve[0][0], 0); assert.equal(c.curve[0][1], b.cutoffV);
    assert.equal(c.curve.at(-1)[0], 1); assert.equal(c.curve.at(-1)[1], b.fullV);
    for (let i = 1; i < c.curve.length; i++) { assert.ok(c.curve[i][0] > c.curve[i - 1][0]); assert.ok(c.curve[i][1] > c.curve[i - 1][1]); }
    assert.equal(c.vRegulated, b.tx.vRegV);
  }
});

import { GAUGE_MAPS, BATTERY_LOAD, LOAD_CURRENT_MA, loadedVoltage, gaugePercent, reportedPercent } from '../js/model/data-params.js';

test('gauge maps strictly monotonic; loaded voltage below the curve and monotonic', () => {
  for (const m of Object.values(GAUGE_MAPS)) for (let i = 1; i < m.length; i++) { assert.ok(m[i][0] > m[i - 1][0]); assert.ok(m[i][1] > m[i - 1][1]); }
  for (const id of Object.keys(BATTERY_PRESETS)) {
    let prev = Infinity;
    for (let u = 0; u <= 1.0001; u += 0.05) {
      const v = loadedVoltage(id, u);
      assert.ok(v < prev + 1e-12); prev = v;
      const b = BATTERY_PRESETS[id];
      let c = b.curve.find((p) => p[0] >= u) || b.curve.at(-1);
      assert.ok(v < c[1] + 0.2);
    }
    assert.ok(loadedVoltage(id, 0.5, 'mic') < loadedVoltage(id, 0.5, 'iem'));   // mic load is the heavier one
    assert.equal(BATTERY_LOAD[id].rintOhm.empty > BATTERY_LOAD[id].rintOhm.full, true);
  }
  assert.equal(LOAD_CURRENT_MA.mic > LOAD_CURRENT_MA.iem, true);
});

test('reported versus true percent: stated error matches the model; alkaline reads pessimistic', () => {
  for (const [id, l] of Object.entries(BATTERY_LOAD)) {
    let maxErr = 0, prev = 101;
    for (let u = 0; u <= 1.0001; u += 0.05) {
      const rep = reportedPercent(id, u), truth = 100 * (1 - u);
      maxErr = Math.max(maxErr, Math.abs(rep - truth));
      assert.ok(rep <= prev + 1e-9); prev = rep;                       // reported percent never rises as the cell is used
    }
    assert.ok(Math.abs(maxErr - l.reportedErrorPct) <= 3, id + ' max error ' + maxErr.toFixed(1));
  }
  // alkaline reads 0 % while capacity remains; li-ion is the most faithful
  assert.equal(reportedPercent('alkaline-aa-x2', 0.7), 0);
  assert.ok(100 * 0.3 - reportedPercent('alkaline-aa-x2', 0.7) >= 25);
  assert.ok(BATTERY_LOAD['li-ion-1s'].reportedErrorPct < BATTERY_LOAD['nimh-aa-x2'].reportedErrorPct && BATTERY_LOAD['nimh-aa-x2'].reportedErrorPct < BATTERY_LOAD['alkaline-aa-x2'].reportedErrorPct);
  // wrong chemistry setting: NiMH on the alkaline map reads 15+ points high near the end of the plateau
  assert.ok(reportedPercent('nimh-aa-x2', 0.9, 'mic', 'alkaline-linear') - 10 > 15);
  assert.ok(Number.isNaN(gaugePercent('nothing', 2.5)));
});
