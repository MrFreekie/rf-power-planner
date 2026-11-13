import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMD_PRESETS, coordinationRules, COMBINER_PRESETS, TX_REVERSE_IM_CONVERSION_DB, TX_NOISE_DBC_PER_HZ, PIM_JUNCTIONS,
  imProductCount, couplingLossDb, im3TwoToneDbm, im3ThreeToneDbm, im5Dbm, txNoiseDbcPerHz, coupledNoiseDbm, pimDbc, reverseImDbm,
  THREE_TONE_EXTRA_DB
} from '../js/model/imd-params.js';
import { RX_PRESETS } from '../js/model/rx-params.js';

const L = (x) => 10 * Math.log10(x);

test('presets exist, frozen, labelled', () => {
  assert.deepEqual(Object.keys(IMD_PRESETS).sort(), ['iem-combiner-isolated', 'iem-combiner-no-isolation', 'mic-rack-typical', 'pim-corroded-connector']);
  for (const [id, p] of Object.entries(IMD_PRESETS)) {
    assert.equal(p.id, id);
    assert.ok(p.illustrative && Object.isFrozen(p));
    assert.ok(['rx-front-end', 'tx-reverse', 'pim'].includes(p.mechanism));
  }
  assert.ok(Object.isFrozen(coordinationRules) && Object.isFrozen(PIM_JUNCTIONS));
});

test('combiner and PA ordering', () => {
  const c = COMBINER_PRESETS;
  assert.ok(c.none.isolationDb < c['passive-hybrid'].isolationDb && c['passive-hybrid'].isolationDb < c['isolated-cavity'].isolationDb);
  assert.ok(c['passive-hybrid'].isolationDb >= 20 && c['passive-hybrid'].isolationDb <= 30);
  assert.ok(c['isolated-cavity'].isolationDb >= 40 && c['isolated-cavity'].isolationDb <= 60);
  assert.ok(c['passive-hybrid'].insertionLossDb >= 3 && c['passive-hybrid'].insertionLossDb < 4.5);
  const v = TX_REVERSE_IM_CONVERSION_DB;
  assert.ok(v['saturated-class-c'] < v['class-ab'] && v['class-ab'] < v['linear-class-a']);
  for (const x of Object.values(v)) assert.ok(x >= 10 && x <= 30);
});

test('rx front end preset agrees with rx-params', () => {
  const p = IMD_PRESETS['mic-rack-typical'];
  assert.equal(p.iip3Dbm, RX_PRESETS[p.rxPresetId].iip3Dbm);
  assert.equal(p.noiseFigureDb, RX_PRESETS[p.rxPresetId].noiseFigureDb);
  assert.ok(p.iip5Dbm > p.iip3Dbm);
  assert.ok(p.toneLevelDbm < RX_PRESETS[p.rxPresetId].p1dBDbm);
});

test('IM level laws: 3:1, 5:1, three-tone +6 dB', () => {
  assert.equal(im3TwoToneDbm(-35, -35, -8), -89);
  assert.equal(im3TwoToneDbm(-32, -32, -8) - im3TwoToneDbm(-35, -35, -8), 9);           // +3 dB in, +9 dB out
  assert.equal(im3TwoToneDbm(-35, -35, -8), 3 * -35 + 16);
  assert.equal(im3TwoToneDbm(-30, -40, -8), 2 * -30 + -40 + 16);                         // unequal: 2 P1 + P2
  assert.equal(im3ThreeToneDbm(-35, -35, -35, -8) - im3TwoToneDbm(-35, -35, -8), THREE_TONE_EXTRA_DB);
  assert.equal(im5Dbm(-30, -30, 6) - im5Dbm(-35, -35, 6), 25);                          // +5 dB in, +25 dB out
});

test('IM product counts', () => {
  for (const n of [2, 3, 4, 5, 8]) {
    const two = n * (n - 1), three = (n * (n - 1) * (n - 2)) / 2;
    assert.equal(imProductCount(n, 3), two + three);
    assert.equal(imProductCount(n, 3), (n * n * (n - 1)) / 2);
  }
  assert.equal(imProductCount(2, 3), 2);
  assert.equal(imProductCount(3, 3), 9);
  assert.equal(imProductCount(4, 3), 24);
  assert.equal(imProductCount(8, 3), 224);
  assert.equal(imProductCount(2, 5), 2);
  assert.equal(imProductCount(3, 5), 15);
  assert.equal(imProductCount(1, 3), 0);
  assert.equal(imProductCount(8, 5) > imProductCount(8, 3), true);
});

test('transmitter reverse IM: isolation lowers products 1:1; hand values', () => {
  const tx = 17;
  const hybrid = COMBINER_PRESETS['passive-hybrid'], iso = COMBINER_PRESETS['isolated-cavity'];
  const conv = TX_REVERSE_IM_CONVERSION_DB['class-ab'];
  const pHybrid = reverseImDbm(tx - hybrid.isolationDb, conv);
  const pIso = reverseImDbm(tx - iso.isolationDb, conv);
  assert.equal(pHybrid, 17 - 25 - 20);               // -28 dBm
  assert.equal(pIso, 17 - 50 - 20);                  // -53 dBm
  assert.equal(pHybrid - tx, -45);                   // dBc
  assert.equal(pHybrid - pIso, iso.isolationDb - hybrid.isolationDb);
  // interferer level slope 1:1
  assert.equal(reverseImDbm(-5, conv) - reverseImDbm(-8, conv), 3);
  // two separate antennas 1 m apart at 600 MHz, 0 dBi: 20log(4 pi 1 / 0.4996) = 28.0 dB
  assert.ok(Math.abs(couplingLossDb(1, 600) - 28.0) < 0.1);
  assert.ok(Math.abs(couplingLossDb(2, 600) - couplingLossDb(1, 600) - 6.02) < 0.01);   // 20 log d law
  assert.ok(Math.abs(couplingLossDb(1, 600, 3, 3) - (28.0 - 6)) < 0.1);
});

test('near-field floor on coupling', () => {
  const f = couplingLossDb(0.01, 600);
  assert.ok(Math.abs(f - couplingLossDb(0.0001, 600)) < 1e-9);       // clamped
  assert.ok(f > 15 && f < 17);                                        // 20 log10(2 pi) = 15.96
});

test('transmitter noise skirt and coupled noise', () => {
  const t = TX_NOISE_DBC_PER_HZ;
  for (let i = 1; i < t.length; i++) { assert.ok(t[i].offsetKhz > t[i - 1].offsetKhz); assert.ok(t[i].dbcPerHz < t[i - 1].dbcPerHz); }
  assert.equal(txNoiseDbcPerHz(1000), -128);
  assert.equal(txNoiseDbcPerHz(1), -105);
  assert.equal(txNoiseDbcPerHz(1e6), -148);
  assert.ok(txNoiseDbcPerHz(700) < txNoiseDbcPerHz(500) && txNoiseDbcPerHz(700) > txNoiseDbcPerHz(1000));
  // -30 dBm at the receiver, 1 MHz away, 200 kHz bandwidth: -30 - 128 + 53.01 = -104.99
  const n = coupledNoiseDbm(-30, 1000, 200e3);
  assert.ok(Math.abs(n - (-104.99)) < 0.01);
  const thermal = -174 + L(200e3) + 8;                                 // -112.99
  const total = L(Math.pow(10, n / 10) + Math.pow(10, thermal / 10));
  assert.ok(Math.abs(total - thermal - 8.6) < 0.2);                    // the floor rises by about 8.6 dB
});

test('PIM law and ordering', () => {
  const order = ['low-pim-connector', 'good-connector', 'loose-or-dirty-connector', 'corroded-connector', 'ferromagnetic-junction', 'rusty-contact'];
  for (let i = 1; i < order.length; i++) assert.ok(PIM_JUNCTIONS[order[i]].dbcAtRef > PIM_JUNCTIONS[order[i - 1]].dbcAtRef);
  assert.equal(pimDbc('corroded-connector', 43), -90);
  assert.equal(pimDbc('corroded-connector', 17), -90 + 2 * (17 - 43));       // -142 dBc
  assert.equal(pimDbc('corroded-connector', 20) - pimDbc('corroded-connector', 17), 6);    // dBc rises 2 dB per dB
  // absolute product: carrier + dBc rises 3 dB per dB
  const abs = (j, p) => p + pimDbc(j, p);
  assert.equal(abs('rusty-contact', 20) - abs('rusty-contact', 17), 9);
  // rusty contact at 17 dBm: -100 dBm, above a -113 dBm noise floor
  assert.equal(abs('rusty-contact', 17), -100);
  assert.ok(isNaN(pimDbc('nothing', 17)));
});

test('coordination rules and rack hand values', () => {
  const r = coordinationRules;
  assert.ok(r.minChannelSpacingKhz >= 200 && r.minChannelSpacingKhz <= 500);
  assert.ok(r.minProductClearanceInBandwidths * IMD_PRESETS['mic-rack-typical'].channelBwKhz >= r.minChannelSpacingKhz);
  assert.equal(r.productBandwidthFactor, 3);
  assert.ok(r.requiredCiDb >= 20 && r.belowNoiseMarginDb > 0 && Array.isArray(r.notes) && Object.isFrozen(r.notes));
  // eight carriers at -35 dBm into IIP3 -8: IM3 -89 dBm (two-tone), -83 dBm (three-tone); noise floor -112.99 dBm
  const p = IMD_PRESETS['mic-rack-typical'];
  assert.equal(im3TwoToneDbm(p.toneLevelDbm, p.toneLevelDbm, p.iip3Dbm), -89);
  assert.equal(im3ThreeToneDbm(p.toneLevelDbm, p.toneLevelDbm, p.toneLevelDbm, p.iip3Dbm), -83);
  // number of products landing on 224 for eight carriers; power-summed increase over a single two-tone product is large
  assert.ok(L(imProductCount(8, 3)) > 23);
});
