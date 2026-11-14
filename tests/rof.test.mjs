// Group (g): RF over fibre chain item. All fibre figures are assumed placeholders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rofEffective, rofOpticalLossDb, rofIip3FromSfdr, rofBranchDelays, rofChainWarnings, FIBRE_DELAY_US_PER_KM } from '../js/model/rof.js';
import { solveLink, chainItemLossDb, chainElectricalLengthM, cascadeChainIip3Dbm } from '../js/model/rf.js';
import { createChainItem, createChainItemFromPreset, createDefaultScene, validateScene } from '../js/model/scene.js';
import { CHAIN_PRESETS } from '../js/model/chain-presets.js';
import { rofScene, rofBranchScene, EXAMPLES } from '../js/examples.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);
const f1 = (x) => x.toFixed(1);

test('hand values: 0.3 km at 0.35 dB/km + 1 dB connectors = 1.105 dB optical; RF gain -25 - 2 x 1.105 = -27.21; NF 32.21; delay 1.47 us', () => {
  const it = { kind: 'rof', gainDb: -25, nfDb: 30, fibreKm: 0.3 };
  near(rofOpticalLossDb(it), 1.105, 1e-12);
  const e = rofEffective(it);
  near(e.gainDb, -27.21, 1e-12); near(e.nfDb, 32.21, 1e-12);
  near(e.delayUs, 0.3 * 4.9, 1e-12); near(e.delayNs, 1470, 1e-9);
  assert.equal(FIBRE_DELAY_US_PER_KM, 4.9);
  near(chainItemLossDb(it, 600), 27.21, 1e-12);
  near(chainElectricalLengthM([it]), 1470 * 0.299792458, 1e-6);
});

test('2 dB of RF per 1 dB of optical: 1 km of fibre (0.35 dB) changes the gain by exactly 0.7 dB and the noise figure by 0.7 dB', () => {
  const a = rofEffective({ kind: 'rof', gainDb: -20, nfDb: 25, fibreKm: 0 }), b = rofEffective({ kind: 'rof', gainDb: -20, nfDb: 25, fibreKm: 1 });
  near(a.gainDb - b.gainDb, 0.7, 1e-12); near(b.nfDb - a.nfDb, 0.7, 1e-12);
  const c = rofEffective({ kind: 'rof', gainDb: -20, nfDb: 25, fibreKm: 1, connectorLossDb: 3 });
  near(b.gainDb - c.gainDb, 4, 1e-12); // 2 dB more optical = 4 dB less RF gain
});

test('SFDR: IIP3 = 1.5 SFDR - 174 + NF (SFDR 100, NF 30: +6 dBm); an explicit IIP3 wins; effective SFDR falls 4/3 dB per optical dB', () => {
  near(rofIip3FromSfdr(100, 30), 6, 1e-12);
  near(rofEffective({ kind: 'rof', sfdrDbHz23: 100, nfDb: 30, fibreKm: 0, connectorLossDb: 0 }).iip3Dbm, 6, 1e-12);
  assert.equal(rofEffective({ kind: 'rof', iip3Dbm: -3, sfdrDbHz23: 100, nfDb: 30 }).iip3Dbm, -3);
  const e0 = rofEffective({ kind: 'rof', sfdrDbHz23: 100, nfDb: 30, connectorLossDb: 0 });
  near(e0.sfdrDbHz23, 100, 1e-9);
  const e3 = rofEffective({ kind: 'rof', sfdrDbHz23: 100, nfDb: 30, connectorLossDb: 3 });
  near(e0.sfdrDbHz23 - e3.sfdrDbHz23, (4 / 3) * 3, 1e-9);
  near(cascadeChainIip3Dbm([{ kind: 'rof', sfdrDbHz23: 100, nfDb: 30, connectorLossDb: 0 }], 1000, 600), 6, 1e-6); // the cascade uses the input IIP3
});

test('cascade through solveLink: the rof gain and NF enter the Friis noise cascade', () => {
  const s = rofScene('passive'), r = solveLink(s, s.links[0]);
  const bare = rofScene('passive'); bare.links[0].chain = [];
  const rb = solveLink(bare, bare.links[0]);
  assert.ok(r.cascade.systemNfDb > rb.cascade.systemNfDb + 15);
  const e = rofEffective(s.links[0].chain[0]);
  near(r.inputPowerDbm - rb.inputPowerDbm, e.gainDb, 1e-9);
  assert.ok(r.waterfall.some((w) => /RF over fibre 0.3 km/.test(w.label)));
});

test('bandwidth warning, very low gain warning, and branch fibre delay mismatch', () => {
  assert.equal(rofChainWarnings([{ kind: 'rof', bwMinMHz: 400, bwMaxMHz: 1000 }], 1800).length, 1);
  assert.equal(rofChainWarnings([{ kind: 'rof', bwMinMHz: 400, bwMaxMHz: 1000 }], 600).length, 0);
  assert.ok(rofChainWarnings([{ kind: 'rof', gainDb: -35, fibreKm: 5 }], 600).some((w) => /2 dB RF per 1 dB optical/.test(w)));
  const d = rofBranchDelays([[{ kind: 'rof', fibreKm: 0.1 }], [{ kind: 'rof', fibreKm: 0.6 }]]);
  near(d.spreadNs, 2450, 1e-9); assert.equal(d.warn, true);
  assert.equal(rofBranchDelays([[{ kind: 'rof', fibreKm: 0.2 }], [{ kind: 'rof', fibreKm: 0.2 }]]).warn, false);
  const b = rofBranchScene(), r = solveLink(b, b.links[0]);
  assert.ok(r.warnings.some((w) => /different fibre lengths \(delay spread 2450 ns\)/.test(w)));
  const eq = rofBranchScene({ fibreKmB: 0.1 }), re = solveLink(eq, eq.links[0]);
  assert.equal(re.warnings.some((w) => /different fibre lengths/.test(w)), false);
});

test('presets are flagged assumed and validate; the examples quote the model', () => {
  for (const id of ['rof-passive-1km', 'rof-active-lna']) {
    const p = CHAIN_PRESETS[id];
    assert.equal(p.kind, 'rof'); assert.equal(p.flags.gainDb, 'U'); assert.equal(p.flags.nfDb, 'U');
    const s = createDefaultScene(); s.links[0].chain = [createChainItemFromPreset(id)];
    assert.equal(validateScene(s).ok, true, validateScene(s).errors.join(';'));
  }
  assert.equal(createChainItem('rof').kind, 'rof');
  const bad = createDefaultScene(); bad.links[0].chain = [{ kind: 'rof', fibreKm: 1e12 }];
  assert.equal(validateScene(bad).ok, false);
  const note = (id) => EXAMPLES.find((e) => e.id === id).note;
  const res = ['coax', 'passive', 'active'].map((v) => { const s = rofScene(v); return solveLink(s, s.links[0]); });
  for (const v of [f1(res[0].inputPowerDbm), f1(res[0].marginDb), f1(res[1].inputPowerDbm), f1(res[1].cascade.systemNfDb), f1(res[2].inputPowerDbm), f1(res[2].cascade.systemNfDb)]) assert.ok(note('rof-coax-vs-fibre').includes(v), v);
  near(rofEffective(createChainItemFromPreset('rof-passive-1km', { fibreKm: 0.3 })).delayUs, 1.47, 1e-12);
  assert.ok(note('rof-branch-mismatch').includes('2450 ns'));
  for (const id of ['rof-coax-vs-fibre', 'rof-branch-mismatch']) assert.ok(note(id).split('. ').length <= 4, id);
});
