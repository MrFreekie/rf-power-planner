import test from 'node:test';
import assert from 'node:assert/strict';
import { poweringBudget, poweringLine, DEFAULT_RX_BIAS_MA } from '../js/model/powering.js';

const boost = (o = {}) => ({ kind: 'booster', dcMode: 'pass', dcNeedV: 12, dcNeedMa: 130, ...o });
test('receiver bias feeds boosters, sums draw', () => {
  const r = poweringBudget({ chain: [boost(), boost()], rx: { antennaBiasV: 12, antennaBiasMa: 200 } });
  assert.equal(r.length, 1); assert.equal(r[0].drawMa, 260); assert.equal(r[0].ok, false);
  assert.match(r[0].warnings[0], /260 mA drawn but only 200 mA/); assert.equal(poweringLine(r[0]), '260 mA of 200 mA');
});
test('default limit is flagged assumed', () => {
  const r = poweringBudget({ chain: [boost(), boost()], rx: { antennaBiasV: 12 } });
  assert.equal(r[0].supplyMa, DEFAULT_RX_BIAS_MA); assert.equal(r[0].supplyConf, 'U'); assert.equal(r[0].ok, false);
});
test('bias tee takes the loads on its antenna side; DC block cuts the line', () => {
  const tee = { kind: 'biastee', dcMode: 'pass', dcSupplyV: 12, dcSupplyMa: 350 };
  const r = poweringBudget({ chain: [boost(), tee, { kind: 'dcblock', dcMode: 'block' }, boost()], rx: { antennaBiasV: 12, antennaBiasMa: 500 } });
  assert.equal(r.length, 2); assert.equal(r[0].drawMa, 130); assert.equal(r[0].ok, true); assert.equal(r[1].source, 'Receiver antenna bias');
});
test('low supply voltage warns; unpowered load and empty input produce nothing', () => {
  const r = poweringBudget({ chain: [boost()], rx: { antennaBiasV: 5, antennaBiasMa: 500 } });
  assert.match(r[0].warnings[0], /needs 12 V but gets 5 V/);
  assert.deepEqual(poweringBudget({ chain: [boost()], rx: {} }), []);
  assert.deepEqual(poweringBudget({}), []);
});
