// Directional front-to-back, DC cable drop, 75/50 ohm junction loss in the budget, tuning guard band.
import test from 'node:test';
import assert from 'node:assert/strict';
import { antennaGainDb, FRONT_TO_BACK_DB, chainLossDb, solveLink } from '../js/model/rf.js';
import { poweringBudget, cableLoopOhm, DC_LOOP_OHM_PER_100M } from '../js/model/powering.js';
import { chainJunctionLossDb } from '../js/model/chain-checks.js';
import { tuningClashes, TUNING_GUARD_KHZ } from '../js/model/rack.js';
import { createDefaultScene, createChainItem } from '../js/model/scene.js';

const near = (a, b, t) => assert.ok(Math.abs(a - b) <= t, `got ${a}, expected ${b}`);

test('analytic directional patterns: rear gain = main gain minus the front-to-back figure', () => {
  const main = (ant) => antennaGainDb(ant, { az: 0, el: 0 });
  const rear = (ant) => antennaGainDb(ant, { az: 180, el: 0 });
  for (const [name, fb] of Object.entries(FRONT_TO_BACK_DB)) {
    const ant = { type: 'paddle', gainDbi: 7, patternOverride: name };
    near(main(ant) - rear(ant), fb, 1e-9);
  }
  assert.deepEqual(FRONT_TO_BACK_DB, { paddle: 15, logperiodic: 15, helical: 13, panel: 20 });
  // omni and body are unchanged: no pattern at all
  const om = { type: 'omni', gainDbi: 0, patternOverride: 'omni' };
  near(antennaGainDb(om, { az: 180, el: 0 }), 0, 1e-9);
});

test('DC cable drop: far-end voltage = supply - I * R, with the 10 percent and minimum-voltage warnings', () => {
  const load = { kind: 'booster', dcMode: 'pass', dcNeedV: 9, dcNeedMa: 200 };
  // 100 m of RG58 (assumed 4.5 ohm loop) at 200 mA: 0.9 V drop from a 12 V supply (7.5 percent): no warning
  let r = poweringBudget({ chain: [load, { kind: 'cable', cableType: 'rg58', lengthM: 100 }], rx: { antennaBiasV: 12, antennaBiasMa: 500 } });
  near(r[0].loads[0].dropV, 0.9, 1e-9); near(r[0].loads[0].vFar, 11.1, 1e-9); assert.equal(r[0].ok, true);
  // 200 m: 1.8 V (15 percent) exceeds the 10 percent guideline but 10.2 V is still above the 9 V need
  r = poweringBudget({ chain: [load, { kind: 'cable', cableType: 'rg58', lengthM: 200 }], rx: { antennaBiasV: 12, antennaBiasMa: 500 } });
  assert.equal(r[0].ok, false); assert.match(r[0].warnings[0], /cable drop/);
  // 500 m: 4.5 V drop leaves 7.5 V, below the 9 V need
  r = poweringBudget({ chain: [load, { kind: 'cable', cableType: 'rg58', lengthM: 500 }], rx: { antennaBiasV: 12, antennaBiasMa: 500 } });
  assert.match(r[0].warnings[0], /only 7\.50 V arrives/);
  // cable on the receiver side of nothing (before the load) adds no drop
  r = poweringBudget({ chain: [{ kind: 'cable', cableType: 'rg58', lengthM: 100 }, load], rx: { antennaBiasV: 12, antennaBiasMa: 500 } });
  assert.equal(r[0].loads[0].dropV, 0);
  near(cableLoopOhm({ kind: 'cable', cableType: 'lmr-400', lengthM: 50 }), 0.5, 1e-9);
  assert.equal(cableLoopOhm({ kind: 'booster' }), 0);
  assert.ok(DC_LOOP_OHM_PER_100M.rg58 > DC_LOOP_OHM_PER_100M['lmr-400']);
});

test('75/50 ohm junctions are summed into the chain loss and the waterfall', () => {
  const rg6 = createChainItem('cable', { cableType: 'rg6', lengthM: 5 });
  const rg58 = createChainItem('cable', { cableType: 'rg58', lengthM: 5 });
  near(chainJunctionLossDb([rg6]), 2 * 0.177, 0.01);
  near(chainJunctionLossDb([rg58]), 0, 1e-12);
  near(chainJunctionLossDb([rg58, rg6, rg6, rg58]), 2 * 0.177, 0.01); // adjacent 75 ohm cables share one run
  const sum = chainLossDb([rg6], 600) - chainJunctionLossDb([rg6]);
  assert.ok(sum > 0);
  const s = createDefaultScene(); const l = s.links[0];
  l.chain = [rg58]; const base = solveLink(s, l);
  l.chain = [rg6]; const withRg6 = solveLink(s, l);
  assert.ok(withRg6.waterfall.some((w) => /impedance junctions/.test(w.label)));
  assert.ok(!base.waterfall.some((w) => /impedance junctions/.test(w.label)));
  const jun = withRg6.waterfall.find((w) => /impedance junctions/.test(w.label));
  near(jun.deltaDb, -2 * 0.177, 0.01);
});

test('tuning clashes: guard band flagged separately from overlap', () => {
  assert.equal(TUNING_GUARD_KHZ, 100);
  const s = createDefaultScene();
  const l1 = s.links[0], l2 = structuredClone(l1); l2.id = 'g2'; l2.name = 'Second';
  l1.freqMHz = 600; s.links.push(l2);
  l2.freqMHz = 600.25; // 250 kHz apart: 200 kHz bandwidth + 100 kHz guard = 300
  let t = tuningClashes(s); assert.equal(t.length, 1); assert.equal(t[0].guard, true); assert.match(t[0].text, /guard band/);
  l2.freqMHz = 600.1; t = tuningClashes(s); assert.equal(t[0].guard, false); assert.match(t[0].text, /overlap/);
  l2.freqMHz = 600.3; assert.equal(tuningClashes(s).length, 0);
  assert.equal(tuningClashes(s, undefined, 0).length, 0);
  l2.freqMHz = 600.25; assert.equal(tuningClashes(s, undefined, 0).length, 0);
});
