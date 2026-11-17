// ERP / EIRP check, extra cable types, 75 ohm warning, arrestor and filter presets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { erpCheck } from '../js/model/erp.js';
import { rackWarnings } from '../js/model/rack.js';
import { CABLES, cableDbPer100m } from '../js/model/library.js';
import { cableImpedanceOhm, chainImpedanceWarnings, junctionMismatchDb } from '../js/model/chain-checks.js';
import { CHAIN_PRESETS } from '../js/model/chain-presets.js';
import { createDefaultScene, createDefaultLink, createChainItem, createChainItemFromPreset, validateScene } from '../js/model/scene.js';
import * as rf from '../js/model/rf.js';

const near = (a, b, t) => assert.ok(Math.abs(a - b) <= t, `got ${a}, expected ${b}`);
const iemLink = () => { const l = createDefaultLink('iem'); l.freqMHz = 600; l.tx.powerDbm = 17; l.tx.antenna.gainDbi = 3; l.chain = []; return l; };

test('erpCheck: UK 600 MHz IEM, power minus chain loss plus gain, ERP limit with the 2.15 dB dipole offset', () => {
  const l = iemLink(); l.chain = [createChainItem('attenuator', { lossDb: 4 })];
  const r = erpCheck(l, 'uk');
  assert.ok(r);
  near(r.chainLossDb, 4, 1e-9);
  near(r.eirpDbm, 16, 1e-9); // 17 - 4 + 3
  near(r.radiatedDbm, r.unit === 'ERP' ? 16 - 2.15 : 16, 1e-9);
});

test('erpCheck: over the limit warns, a lossy chain brings it back under, null outside the ranges or without power', () => {
  const l = iemLink(); l.tx.powerDbm = 30; l.tx.antenna.gainDbi = 6;
  const hot = erpCheck(l, 'uk'); assert.equal(hot.level, 'warn'); assert.equal(hot.over, true);
  l.chain = [createChainItem('attenuator', { lossDb: 20 })];
  const cool = erpCheck(l, 'uk'); assert.notEqual(cool.level, 'warn'); assert.equal(cool.over, false);
  assert.equal(erpCheck({ ...l, freqMHz: 5 }, 'uk'), null);
  assert.equal(erpCheck({ ...l, tx: { ...l.tx, powerDbm: NaN } }, 'uk'), null);
  assert.equal(erpCheck(null, 'uk'), null);
});

test('erpCheck: a mic link ignores its (receiver side) chain; a 2.4 GHz EIRP limit counts the power', () => {
  const m = createDefaultLink('mic'); m.freqMHz = 2420; m.tx.powerDbm = 14; m.tx.antenna.gainDbi = 0;
  m.chain = [createChainItem('attenuator', { lossDb: 30 })];
  const r = erpCheck(m, 'uk'); assert.equal(r.chainLossDb, 0); near(r.radiatedDbm, 14, 1e-9);
  assert.equal(r.level, 'warn'); // 10 mW EIRP limit, 14 dBm is 25 mW
});

test('rackWarnings: erpOf is passed in and lands on the link key; absent opts changes nothing', () => {
  const s = createDefaultScene();
  s.links.push(iemLink()); s.links[s.links.length - 1].id = 'iem_x';
  const none = rackWarnings(s);
  const n = s.links.filter((q) => q.kind === 'iem' || q.kind === 'mic').length;
  const w = rackWarnings(s, undefined, { erpOf: () => ({ level: 'warn', text: 'too hot' }) });
  assert.equal(w.length, none.length + n);
  assert.ok(w.some((x) => x.key === 'transmitter:iem_x' && /too hot/.test(x.text)));
  assert.equal(rackWarnings(s, undefined, { erpOf: () => null }).length, none.length);
});

test('new cables: present, loss rises with frequency, ordered by size, extras flagged assumed', () => {
  for (const id of ['lmr-240', 'lmr-400', 'lmr-600', 'rg8x', 'hardline-half', 'rg6']) {
    assert.ok(CABLES[id], id);
    const t = CABLES[id].attenDbPer100m; assert.equal(t.length, 11);
    for (let i = 1; i < t.length; i++) assert.ok(t[i][1] > t[i - 1][1], `${id} rises`);
  }
  assert.equal(CABLES.rg8x.assumed, true);
  assert.ok(cableDbPer100m('hardline-half', 900) < cableDbPer100m('lmr-400', 900));
  assert.ok(cableDbPer100m('rg8x', 900) < cableDbPer100m('rg58', 900));
  assert.ok(cableDbPer100m('rg8x', 900) > cableDbPer100m('lmr-400', 900));
});

test('75 ohm: RG6 flagged, warning only for non-50 ohm cables, mismatch 0.18 dB per junction, scene validates', () => {
  assert.equal(cableImpedanceOhm('rg6'), 75); assert.equal(cableImpedanceOhm('rg58'), 50); assert.equal(cableImpedanceOhm('custom'), 50);
  near(junctionMismatchDb(75, 50), 0.177, 0.005);
  assert.equal(chainImpedanceWarnings([createChainItem('cable', { cableType: 'rg58' })]).length, 0);
  const w = chainImpedanceWarnings([createChainItem('cable', { cableType: 'rg6', lengthM: 5 })]);
  assert.equal(w.length, 1); assert.match(w[0], /75 ohm/); assert.match(w[0], /0\.2 to 0\.5 dB/);
  const s = createDefaultScene(); s.links[0].chain = [createChainItem('cable', { cableType: 'rg6', lengthM: 5 })];
  assert.equal(validateScene(s).ok, true);
});

test('presets: arrestors and filters flagged, DC behaviour U, small loss, filter selectivity works', () => {
  for (const id of ['surge-arrestor-dcpass', 'surge-arrestor-dcblock', 'filter-highpass', 'filter-lte-block']) assert.ok(CHAIN_PRESETS[id], id);
  assert.equal(CHAIN_PRESETS['surge-arrestor-dcpass'].flags.dcMode, 'U');
  assert.equal(CHAIN_PRESETS['surge-arrestor-dcpass'].item.dcMode, 'pass');
  assert.equal(CHAIN_PRESETS['surge-arrestor-dcblock'].item.dcMode, 'block');
  for (const id of ['surge-arrestor-dcpass', 'surge-arrestor-dcblock']) { const x = rf.chainItemLossDb(createChainItemFromPreset(id), 600); assert.ok(x >= 0.1 && x <= 0.3); }
  const hp = createChainItemFromPreset('filter-highpass');
  near(rf.chainItemLossDb(hp, 600), 0.5, 1e-9); near(rf.chainItemLossDb(hp, 100), 40.5, 1e-9);
  const lte = createChainItemFromPreset('filter-lte-block');
  near(rf.chainItemLossDb(lte, 600), 0.5, 1e-9); near(rf.chainItemLossDb(lte, 780), 40.5, 1e-9);
});

test('cable loss matches published datasheet figures within 5 percent', () => {
  const ft = 100 / 30.48; // dB per 100 ft to dB per 100 m
  const near = (got, want) => assert.ok(Math.abs(got / want - 1) < 0.05, `${got} vs ${want}`);
  near(cableDbPer100m('lmr-240', 900), 7.6 * ft);
  near(cableDbPer100m('lmr-240', 1800), 10.9 * ft);
  near(cableDbPer100m('hardline-half', 894), 6.855);
  near(cableDbPer100m('hardline-half', 1800), 10.06);
  near(cableDbPer100m('rg6', 100), 1.95 * ft);
  near(cableDbPer100m('rg6', 1000), 6.3 * ft);
  near(cableDbPer100m('rg6', 2250), 9.8 * ft);
});
