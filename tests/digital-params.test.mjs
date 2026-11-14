import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULATIONS, REQUIRED_SNR, CODES, DIGITAL_PRESETS, DIGITAL_DEFAULTS, FEC_CLIFF } from '../js/model/digital-params.js';
import { berUncoded, constellation, digitalLinkState, amcStep, postFecBer } from '../js/model/digital.js';

const L = (x) => 10 * Math.log10(x);
const orders = [2, 4, 16, 64, 256];
// The default (first) preset is fixed QPSK, the assumed typical constellation; the higher-order QAM presets are illustrative.
const ids = ['mic-qpsk-fixed', 'iem-ofdm-like-adaptive', 'wideband-adaptive'];

test('modulation table and constellation sanity', () => {
  for (const o of orders) {
    assert.equal(MODULATIONS[o].bitsPerSymbol, Math.log2(o));
    const pts = constellation(o);
    assert.equal(pts.length, o);
    const p = pts.reduce((s, q) => s + q.i * q.i + q.q * q.q, 0) / o;
    assert.ok(Math.abs(p - 1) < 1e-9, 'unit power ' + o);
  }
});

test('required SNR: monotonic with order, Eb/N0 relation, BER 1e-6 above 1e-3', () => {
  for (let i = 1; i < orders.length; i++) {
    const a = REQUIRED_SNR[orders[i - 1]], b = REQUIRED_SNR[orders[i]];
    if (orders[i - 1] === 2) { assert.equal(a.esN0At1e3, 6.79); assert.ok(Math.abs(b.esN0At1e3 - a.esN0At1e3 - 3.01) < 1e-9); } // BPSK -> QPSK: +3 dB Es/N0, equal Eb/N0
    else assert.ok(b.esN0At1e3 > a.esN0At1e3 && b.esN0At1e6 > a.esN0At1e6 && b.ebN0At1e6 > a.ebN0At1e6);
  }
  for (const o of orders) {
    const r = REQUIRED_SNR[o], k = Math.log2(o);
    assert.ok(r.esN0At1e6 > r.esN0At3e3 && r.esN0At3e3 > r.esN0At1e3 - 1.5 && r.esN0At1e6 > r.esN0At1e3);
    assert.ok(Math.abs(r.ebN0At1e3 - (r.esN0At1e3 - L(k))) < 0.02, 'Eb = Es - 10log k, ' + o);
    assert.ok(Math.abs(r.ebN0At1e6 - (r.esN0At1e6 - L(k))) < 0.02);
    // table agrees with the BER formula in digital.js
    assert.ok(Math.abs(berUncoded(o, r.esN0At1e3) / 1e-3 - 1) < 0.05, 'ber 1e-3 ' + o);
    assert.ok(Math.abs(berUncoded(o, r.esN0At1e6) / 1e-6 - 1) < 0.1, 'ber 1e-6 ' + o);
    assert.ok(Math.abs(berUncoded(o, r.esN0At3e3) / 3e-3 - 1) < 0.05, 'ber 3e-3 ' + o);
  }
});

test('codes: rate up, tolerance down', () => {
  const k = Object.keys(CODES);
  for (let i = 1; i < k.length; i++) {
    assert.ok(CODES[k[i]].rate > CODES[k[i - 1]].rate);
    assert.ok(CODES[k[i]].preFecCliffBer < CODES[k[i - 1]].preFecCliffBer);
  }
  // all cliff points leave a positive coding gain at Eb/N0 over the Shannon-ish floor: QPSK Eb/N0 > 0 dB
  for (const c of Object.values(CODES)) {
    let lo = -10, hi = 30;
    for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (berUncoded(4, m) > c.preFecCliffBer) lo = m; else hi = m; }
    assert.ok(hi - L(2 * c.rate) > 1.5, 'Eb/N0 at cliff above 1.5 dB');
  }
});

test('FEC cliff: sharp within a few dB, floor and monotonic', () => {
  const cfg = DIGITAL_PRESETS['mic-qpsk-fixed'];
  const at = (es) => postFecBer(berUncoded(4, es), cfg);
  const es0 = 6.73; // pre-FEC BER 1.5e-2 for QPSK
  assert.ok(at(es0 + 3) < 1e-8);
  assert.ok(at(es0 - 3) > 1e-3);
  let prev = 0; for (let e = 20; e >= 0; e -= 0.25) { const v = at(e); assert.ok(v >= prev - 1e-18); prev = v; }
  assert.ok(at(30) <= FEC_CLIFF.postFecFloor * 1.01);
});

test('presets: structure and threshold ordering', () => {
  assert.deepEqual(Object.keys(DIGITAL_PRESETS), ids);
  assert.equal(DIGITAL_DEFAULTS, DIGITAL_PRESETS[ids[0]]);
  assert.equal(DIGITAL_DEFAULTS.fixedOrder, 4);
  assert.deepEqual([...DIGITAL_DEFAULTS.allowedModulations], [4]);
  assert.match(DIGITAL_DEFAULTS.label, /QPSK.*assumed typical/);
  for (const id of ids.slice(1)) assert.match(DIGITAL_PRESETS[id].label, /illustrative, not typical of live-audio gear/);
  for (const id of ids) {
    const p = DIGITAL_PRESETS[id];
    assert.equal(p.id, id);
    assert.ok(p.illustrative && Object.isFrozen(p) && Object.isFrozen(p.amcThresholdsDb));
    assert.ok(p.symbolRateKSps < p.channelBwKHz && p.symbolRateKSps / p.channelBwKHz >= 0.6);
    assert.equal(p.noiseBwKHz, p.channelBwKHz);
    assert.equal(p.implLossDb, p.implementationLossDb);
    assert.ok(p.latencyMs > 0 && p.latencyMs < 20);
    assert.ok(p.amcHysteresisDb >= 1 && p.amcHysteresisDb <= 4);
    assert.ok(p.concealMaxMs > p.concealment.frameMs && p.frameBits > 100);
    assert.ok(p.concealFer > p.degradedFer);
    // thresholds strictly increase with order among allowed orders
    const allowed = p.allowedModulations;
    for (let i = 1; i < allowed.length; i++) assert.ok(p.amcThresholdsDb[allowed[i]] > p.amcThresholdsDb[allowed[i - 1]] + p.amcHysteresisDb, id + ' spacing exceeds hysteresis');
    for (const o of [4, 16, 64, 256]) if (!allowed.includes(o)) assert.equal(p.amcThresholdsDb[o], Infinity);
    for (const o of allowed) assert.ok(Math.abs(p.switchUpCnrDb[o] - p.switchDownCnrDb[o] - p.amcHysteresisDb) < 1e-9);
  }
});

test('hold thresholds match the documented formula', () => {
  for (const id of ids) {
    const p = DIGITAL_PRESETS[id];
    for (const o of p.allowedModulations) {
      let lo = -10, hi = 50;
      for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (berUncoded(o, m) > p.preFecCliffBer) lo = m; else hi = m; }
      const expect = hi + p.implementationLossDb + p.fadeMarginDb - L(p.channelBwKHz / p.symbolRateKSps);
      assert.ok(Math.abs(p.amcThresholdsDb[o] - expect) < 0.11, id + ' order ' + o + ' ' + expect.toFixed(2));
    }
  }
});

test('model integration: strong signal ok at top order, weak steps down then down', () => {
  const p = DIGITAL_PRESETS['wideband-adaptive'];
  const nf = -174 + L(p.channelBwKHz * 1000) + p.noiseFigureDb;
  let s = null;
  for (const cnr of [40, 40]) s = digitalLinkState(nf + cnr, p, s, 0);
  assert.equal(s.order, 256);
  s = digitalLinkState(nf + 25, p, s, 10);
  assert.equal(s.order, 64);
  s = digitalLinkState(nf + 12, p, s, 20);
  assert.equal(s.order, 4);
  s = digitalLinkState(nf + 3, p, s, 30);
  assert.equal(s.order, 0);
  assert.equal(amcStep(4, 15, p).order, 4);   // below the 16-QAM up threshold (hold 16.8 + 2)
  assert.equal(amcStep(4, 19, p).order, 16);
});
