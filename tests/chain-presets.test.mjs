// Group (c): chain item presets (splitters, couplers, pads, filters, bias tee, DC block, active distribution, boosters), DC bias checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as rf from '../js/model/rf.js';
import { CHAIN_PRESETS, CHAIN_PRESET_IDS, couplerThroughLossDb, couplerTapDbm, chainDcWarnings } from '../js/model/chain-presets.js';
import { createChainItemFromPreset, createDefaultScene, validateScene } from '../js/model/scene.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);
const item = (id) => createChainItemFromPreset(id);

test('every preset: valid kind, flags S/I/U on every numeric figure, no product numbers in labels, validates in a scene', () => {
  assert.ok(CHAIN_PRESET_IDS.length >= 17);
  for (const id of CHAIN_PRESET_IDS) {
    const p = CHAIN_PRESETS[id];
    assert.ok(/^[A-Za-z0-9-]+$/.test(id));
    for (const [k, v] of Object.entries(p.item)) {
      if (typeof v === 'number') assert.ok(['S', 'I', 'U'].includes(p.flags[k]), `${id}.${k} needs an S/I/U flag`);
    }
    for (const f of Object.values(p.flags)) assert.ok(['S', 'I', 'U'].includes(f));
    assert.ok(!/\b(UA|PA|ASA|AC|ZF|ZX|VAT|SKM|ew)\s?-?\d/i.test(p.label + p.note), `${id}: no product numbers`);
    const s = createDefaultScene();
    s.links[0].chain = [item(id)];
    assert.equal(validateScene(s).ok, true, `${id}: ${validateScene(s).errors.join(';')}`);
  }
  assert.throws(() => createChainItemFromPreset('nope'));
});

test('hand-computed losses: 2-way 3.01 + 0.5, 8-way 9.03 + 1.5, coupler 10 dB through 0.458 + 0.1 and tap -10.1 dBm, 20 dB through 0.044 + 0.1', () => {
  near(rf.chainItemLossDb(item('splitter-2'), 600), 10 * Math.log10(2) + 0.5, 1e-9);
  near(rf.chainItemLossDb(item('splitter-8'), 600), 10 * Math.log10(8) + 1.5, 1e-9);
  near(couplerThroughLossDb({ couplingDb: 10, excessLossDb: 0 }), 0.4576, 1e-4);
  near(rf.chainItemLossDb(item('coupler-10'), 600), 0.4576 + 0.1, 1e-3);
  near(couplerThroughLossDb({ couplingDb: 20, excessLossDb: 0 }), 0.04365, 1e-4);
  near(couplerTapDbm(item('coupler-10'), 10), -0.1, 1e-9);
  near(rf.chainItemLossDb(item('pad-20'), 600), 20, 1e-12);
  near(rf.chainItemLossDb(item('active-splitter-4'), 600), 0, 1e-12);
  near(rf.chainItemLossDb(item('booster-12'), 600), -12, 1e-12);
});

test('cascade: a 20 dB LNA with NF 1 ahead of a poor receiver lowers the system NF; an active splitter with NF 8 / 0 dB gain keeps NF 8', () => {
  const link = { freqMHz: 600, rx: { sensitivityDbm: -90, noiseFigureDb: 10, antenna: { type: 'omni' } } };
  const lna = rf.cascadeNoise(link, [item('lna-20')], 600);
  // Friis: 1 dB (1.2589) + (10 - 1)/100 = 1.2589 + 0.0990... (F_rx = 10 -> 9/100) = 1.3489 -> 1.30 dB
  near(lna.systemNfDb, 10 * Math.log10(10 ** 0.1 + (10 - 1) / 100), 1e-9);
  const act = rf.cascadeNoise(link, [item('active-splitter-4')], 600);
  near(act.stages[0].nfDb, 8, 1e-12);
  near(act.systemNfDb, 10 * Math.log10(10 ** 0.8 + (10 - 1) / 1), 1e-9);
});

test('active items count as nonlinear stages in the IIP3 cascade; passive presets do not', () => {
  const a = rf.cascadeChainIip3Dbm([item('lna-20')], 0, 600); // chain IIP3 (input): 1/IIP3 = 1/14dBm + 20dB/0dBm
  assert.ok(a < 14);
  assert.equal(rf.cascadeChainIip3Dbm([item('pad-6')], 20, 600), 26); // pad adds 6 dB: input IIP3 = 20 + 6
});

test('max input rating: the solve warns when the level entering an item exceeds it', () => {
  const sc = { version: 1, units: { power: 'dBm', length: 'm' }, stage: { width: 12, depth: 8 }, environment: { floor: 'wood', polarisation: 'vertical', model: 'free-space', fadeMarginDb: 0, bodyLossDb: 0 }, reflectors: [], links: [] };
  const omni = { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 0 } };
  const mk = (p) => ({ id: 'l', name: 'l', kind: 'iem', freqMHz: 600, tx: { id: 't', name: 't', powerDbm: p, pos: { x: 0, y: 0, z: 1.5 }, antenna: omni }, rx: { id: 'r', name: 'r', pos: { x: 0, y: 10, z: 1.5 }, antenna: omni, sensitivityDbm: -90, bodyLossDb: 0 }, chain: [item('active-combiner-4')] });
  assert.ok(rf.solveLink(sc, mk(23)).warnings.some((w) => /above its rating/.test(w)));
  assert.ok(!rf.solveLink(sc, mk(17)).warnings.some((w) => /above its rating/.test(w)));
});

test('DC bias warnings: booster without bias; bias tee reaching a filter that shorts DC and a splitter not rated for DC; DC block cures it', () => {
  const need = chainDcWarnings([item('booster-12')]);
  assert.equal(need.length, 1);
  assert.match(need[0], /needs 12 V bias/);
  assert.deepEqual(chainDcWarnings([item('booster-12'), item('biastee')]), []);
  // bias tee then a bandpass that shorts DC: flagged
  assert.ok(chainDcWarnings([item('biastee'), item('filter-bandpass')]).some((w) => /shorts DC/.test(w)));
  // bias tee into a passive splitter (block): the splitter splits the segment, so the bias stops there, no warning
  assert.deepEqual(chainDcWarnings([item('biastee'), item('splitter-2')]), []);
  // a pad (pass) then an item rated no DC marked explicitly
  const bad = { ...item('pad-6'), noDc: true };
  assert.ok(chainDcWarnings([item('biastee'), bad]).some((w) => /not rated for DC/.test(w)));
  assert.deepEqual(chainDcWarnings([item('biastee'), item('dcblock'), bad]), []);
  // DC block between supply and booster starves the booster
  assert.ok(chainDcWarnings([item('biastee'), item('dcblock'), item('booster-12')]).some((w) => /needs 12 V/.test(w)));
  // receiver-end supply powers a booster when nothing blocks
  assert.deepEqual(chainDcWarnings([item('booster-12')], { endSupplyV: 12, endSupplyMa: 350 }), []);
  assert.ok(chainDcWarnings([item('booster-12')], { endSupplyV: 5 }).some((w) => /supply gives 5 V/.test(w)));
  assert.ok(chainDcWarnings([item('booster-12'), item('lna-20')], { endSupplyV: 12, endSupplyMa: 150 }).some((w) => /current/.test(w)));
});

test('solveLink carries the DC warnings; rx.antennaBiasV (receiver bias output) satisfies a mic-link booster', () => {
  const sc = { version: 1, units: { power: 'dBm', length: 'm' }, stage: { width: 12, depth: 8 }, environment: { floor: 'wood', polarisation: 'vertical', model: 'free-space', fadeMarginDb: 0, bodyLossDb: 0 }, reflectors: [], links: [] };
  const omni = { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 0 } };
  const mk = (extra) => ({ id: 'l', name: 'l', kind: 'mic', freqMHz: 600, tx: { id: 't', name: 't', powerDbm: 10, pos: { x: 0, y: 0, z: 1.5 }, antenna: omni }, rx: { id: 'r', name: 'r', pos: { x: 0, y: 10, z: 1.5 }, antenna: omni, sensitivityDbm: -90, bodyLossDb: 0, ...extra }, chain: [item('booster-12')] });
  assert.ok(rf.solveLink(sc, mk({})).warnings.some((w) => /needs 12 V bias/.test(w)));
  assert.ok(!rf.solveLink(sc, mk({ antennaBiasV: 12, antennaBiasMa: 350 })).warnings.some((w) => /bias/.test(w)));
});
