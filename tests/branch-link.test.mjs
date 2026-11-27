import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExample } from '../js/examples.js';
import { solveLink, splitterLossDb } from '../js/model/rf.js';
import { coverageGrid } from '../js/model/coverage.js';

function scene(x, oneAntenna) {
  const s = buildExample('zones-dead-spot').scene, l = s.links[0];
  l.rx.pos.x = x;
  if (oneAntenna) l.branches = [];
  return { s, l };
}

test('a link with two transmit antennas is solved as the combination at the receiver: the far room passes, and one antenna does not', () => {
  const far2 = scene(18, false), far1 = scene(18, true);
  const r2 = solveLink(far2.s, far2.l), r1 = solveLink(far1.s, far1.l);
  assert.equal(r1.status, 'fail');
  assert.ok(r1.inputPowerDbm < -90);
  assert.equal(r2.status, 'pass');
  assert.ok(r2.inputPowerDbm > r1.inputPowerDbm + 40);
  assert.equal(r2.branchCombine.dominantBranch, 1);
  assert.equal(r2.branchCombine.mode, 'power');
});

test('on the near side the second antenna only costs the splitter loss; waterfall, margin and status stay consistent', () => {
  const one = scene(6, true), two = scene(6, false);
  const r1 = solveLink(one.s, one.l), r2 = solveLink(two.s, two.l);
  const split = splitterLossDb(two.l, 2);
  assert.ok(split > 3);
  assert.ok(Math.abs((r1.inputPowerDbm - r2.inputPowerDbm) - split) < 0.05, 'direct branch loses the splitter loss, the far antenna adds almost nothing');
  assert.ok(Math.abs(r2.marginDb - (r1.marginDb - split)) < 0.05);
  const last = r2.waterfall[r2.waterfall.length - 1];
  assert.equal(last.valueDbm, r2.inputPowerDbm);
  assert.equal(r1.branchCombine, undefined);
});

test('the budget level agrees with the coverage map at the same point', () => {
  const { s, l } = scene(18, false);
  const g = coverageGrid(s, l.id, { cellM: 1, rxHeight: l.rx.pos.z, mode: 'power' });
  const ix = Math.floor((18 - g.x0) / g.cellM), iy = Math.floor((l.rx.pos.y - g.y0) / g.cellM);
  const cell = g.levelDbm[iy * g.nx + ix];
  const r = solveLink(s, l);
  assert.ok(Math.abs(cell - r.inputPowerDbm) < 3, `${cell} vs ${r.inputPowerDbm}`); // the cell is the centre of a 1 m square
});
