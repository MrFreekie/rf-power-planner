import test from 'node:test';
import assert from 'node:assert/strict';
import { RX_PRESETS, RX_DEFAULTS, DIVERSITY_PRESETS, SPACING_RULES, IM3_SLOPE, IIP3_MINUS_P1DB_DB } from '../js/model/rx-params.js';

const rxIds = ['mic-receiver-typical', 'iem-bodypack-typical', 'budget-receiver', 'rx-vhf-typical', 'rx-2g4-typical', 'rx-5g8-typical'];

// Bessel J0 by power series (accurate for |x| < 8).
function j0(x) { let t = 1, s = 1; for (let k = 1; k < 40; k++) { t *= -(x * x) / (4 * k * k); s += t; } return s; }
const L = (x) => 10 * Math.log10(x);

test('rx presets exist, frozen, labelled illustrative', () => {
  assert.deepEqual(Object.keys(RX_PRESETS).sort(), [...rxIds].sort());
  for (const id of rxIds) {
    assert.equal(RX_PRESETS[id].id, id);
    assert.equal(RX_PRESETS[id].illustrative, true);
    assert.ok(Object.isFrozen(RX_PRESETS[id]));
  }
  assert.equal(RX_DEFAULTS, RX_PRESETS['iem-bodypack-typical']);
});

test('level ordering: AGC top < P1dB < max input; IIP3 about P1dB + 10', () => {
  for (const id of rxIds) {
    const p = RX_PRESETS[id];
    assert.ok(p.sensitivityDbm + p.agcRangeDb < p.p1dBDbm, id + ' AGC top below P1dB');
    assert.ok(p.p1dBDbm < p.maxInputDbm, id + ' P1dB below max input');
    assert.ok(Math.abs(p.iip3Dbm - p.p1dBDbm - IIP3_MINUS_P1DB_DB) < 1.5, id + ' IIP3 ~ P1dB + 9.6');
    assert.ok(p.maxInputDbm <= 0 && p.maxInputDbm >= -30);
    assert.ok(p.noiseFigureDb >= 3 && p.noiseFigureDb <= 15);
    assert.ok(p.overloadHysteresisDb >= 1 && p.overloadHysteresisDb <= 6);
    assert.ok(p.agcRangeDb >= 40 && p.agcRangeDb <= 90);
  }
});

test('budget receiver is the least linear', () => {
  const b = RX_PRESETS['budget-receiver'], m = RX_PRESETS['mic-receiver-typical'], i = RX_PRESETS['iem-bodypack-typical'];
  assert.ok(b.p1dBDbm < i.p1dBDbm && i.p1dBDbm < m.p1dBDbm);
  assert.ok(b.iip3Dbm < i.iip3Dbm && i.iip3Dbm < m.iip3Dbm);
  assert.ok(b.noiseFigureDb > m.noiseFigureDb);
});

test('IM3 hand values (3:1 slope)', () => {
  assert.equal(IM3_SLOPE, 3);
  const m = RX_PRESETS['mic-receiver-typical'];
  const im3 = (p) => 3 * p - 2 * m.iip3Dbm;
  assert.equal(im3(-30), -74);
  assert.equal(im3(-27) - im3(-30), 9);
  // IM3 reaches the noise floor (-174 + 10log10(200e3) + NF) at Pin = (N + 2 IIP3) / 3
  const n = -174 + L(200e3) + m.noiseFigureDb;
  assert.ok(Math.abs((n + 2 * m.iip3Dbm) / 3 - (-43)) < 0.1);
});

test('diversity presets', () => {
  assert.deepEqual(Object.keys(DIVERSITY_PRESETS).sort(), ['ratio', 'switching', 'true']);
  for (const [id, d] of Object.entries(DIVERSITY_PRESETS)) {
    assert.equal(d.id, id);
    assert.ok(d.illustrative && Object.isFrozen(d));
    assert.ok(typeof d.modeDescription === 'string' && d.modeDescription.length > 20);
    assert.ok(d.hysteresisDb >= 0 && d.hysteresisDb <= 6);
    assert.ok(d.switchMs >= 0 && d.switchMs <= 10);
    assert.ok(d.gainAt1pctDb > d.gainAt10pctDb);
  }
  const { switching: s, true: t, ratio: r } = DIVERSITY_PRESETS;
  assert.ok(s.gainAt1pctDb < t.gainAt1pctDb && t.gainAt1pctDb < r.gainAt1pctDb);
  assert.ok(s.switchMs > t.switchMs && t.switchMs >= r.switchMs);
  assert.equal(r.hysteresisDb, 0);
});

test('diversity gain closed forms', () => {
  const x1 = (p) => -Math.log(1 - p);
  const mrc = (p) => { let lo = 0, hi = 5; for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (1 - Math.exp(-m) * (1 + m) < p) lo = m; else hi = m; } return lo; };
  const sel = (p) => x1(Math.sqrt(p));
  assert.ok(Math.abs(L(sel(0.01)) - L(x1(0.01)) - DIVERSITY_PRESETS.true.gainAt1pctDb) < 0.1);
  assert.ok(Math.abs(L(sel(0.1)) - L(x1(0.1)) - DIVERSITY_PRESETS.true.gainAt10pctDb) < 0.1);
  assert.ok(Math.abs(L(mrc(0.01)) - L(x1(0.01)) - DIVERSITY_PRESETS.ratio.gainAt1pctDb) < 0.1);
  assert.ok(Math.abs(L(mrc(0.1)) - L(x1(0.1)) - DIVERSITY_PRESETS.ratio.gainAt10pctDb) < 0.1);
});

test('spatial correlation constants (Clarke / Jakes)', () => {
  const rho = (d) => j0(2 * Math.PI * d);
  assert.ok(Math.abs(rho(SPACING_RULES.fieldCorrelationFirstZeroLambda)) < 0.005);
  assert.equal(rho(0), 1);
  assert.ok(rho(SPACING_RULES.minUsefulSpacingLambda) ** 2 < 0.2);
  assert.ok(SPACING_RULES.minUsefulSpacingLambda < SPACING_RULES.recommendedSpacingLambda);
});

test('presets carry the keys the models read', () => {
  for (const id of rxIds) assert.equal(RX_PRESETS[id].hotMarginDb, 10);
  for (const [id, d] of Object.entries(DIVERSITY_PRESETS)) assert.equal(d.mode, id);
});

import { cascadeNfDb, impliedRequiredCnrDb, systemSensitivityDbm, cascadeIip3Dbm, CASCADE_TYPICAL, EXTERNAL_NOISE_FIGURE_600MHZ_DB } from '../js/model/rx-params.js';

test('required CNR is implied by sensitivity and NF', () => {
  for (const id of rxIds) {
    const p = RX_PRESETS[id];
    assert.ok(Math.abs(impliedRequiredCnrDb(p.sensitivityDbm, p.noiseFigureDb, p.channelBwKhz) - p.requiredCnrDb) < 0.1, id);
    if (!id.startsWith('rx-2g4') && !id.startsWith('rx-5g8')) assert.ok(p.requiredCnrDb >= CASCADE_TYPICAL.requiredCnrDb.min - 1 && p.requiredCnrDb <= CASCADE_TYPICAL.requiredCnrDb.max); // the analog-FM range; the digital ISM presets need only 14 dB
  }
});

test('Friis cascade: cable 40 dB, receiver NF 10, booster NF 2 / gain 20', () => {
  const cable = { gainDb: -40, nfDb: 40 }, rx = { gainDb: 0, nfDb: 10 }, boost = { gainDb: 20, nfDb: 2 };
  assert.ok(Math.abs(cascadeNfDb([cable, rx]) - 50.0) < 0.05);
  assert.ok(Math.abs(cascadeNfDb([boost, cable, rx]) - 30.0) < 0.05);     // booster at the antenna
  assert.ok(Math.abs(cascadeNfDb([cable, boost, rx]) - 42.2) < 0.05);     // booster at the rack
  assert.ok(Math.abs(cascadeNfDb([{ gainDb: 30, nfDb: 2 }, cable, rx]) - 20.1) < 0.05);
  // passive loss stages: NF equals loss
  assert.ok(Math.abs(cascadeNfDb([{ gainDb: -6, nfDb: 6 }]) - 6) < 1e-9);
  assert.ok(Math.abs(cascadeNfDb([{ gainDb: -3, nfDb: 3 }, { gainDb: -3, nfDb: 3 }]) - 6) < 1e-9);
  // system sensitivity at the antenna: -174 + 53.01 + NF + 26
  assert.ok(Math.abs(systemSensitivityDbm(50, 26) - (-45.0)) < 0.06);
  assert.ok(Math.abs(systemSensitivityDbm(30, 26) - (-65.0)) < 0.06);
  assert.ok(Math.abs(systemSensitivityDbm(42.2, 26) - (-52.8)) < 0.06);
  assert.equal(cascadeNfDb([]), 0);
});

test('cascade IIP3: a high-gain preamp lowers the effective intercept', () => {
  const a = cascadeIip3Dbm([{ gainDb: 20, iip3Dbm: 18 }, { gainDb: -20, iip3Dbm: 100 }, { gainDb: 0, iip3Dbm: -8 }]);
  assert.ok(a < -8 && a > -30);
  assert.ok(Math.abs(cascadeIip3Dbm([{ gainDb: 0, iip3Dbm: -8 }]) + 8) < 1e-9);
  assert.ok(cascadeIip3Dbm([{ gainDb: 0, iip3Dbm: -8 }, { gainDb: 20, iip3Dbm: 18 }]) < cascadeIip3Dbm([{ gainDb: 0, iip3Dbm: -8 }]) + 1e-9);
  for (const v of Object.values(CASCADE_TYPICAL)) if (typeof v === 'object') assert.ok(v.min <= v.typical && v.typical <= v.max && Object.isFrozen(v));
  assert.ok(EXTERNAL_NOISE_FIGURE_600MHZ_DB.quiet < EXTERNAL_NOISE_FIGURE_600MHZ_DB['noisy-venue']);
});
