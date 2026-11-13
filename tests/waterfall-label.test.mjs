import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene } from '../js/model/scene.js';
import { solveLink } from '../js/model/rf.js';

const fsplStep = (r) => r.waterfall.find((s) => s.label.startsWith('Free-space loss'));

test('the free-space loss step shows the path distance in the scene length unit', () => {
  const s = createDefaultScene();
  const link = s.links[0];
  const r = solveLink(s, link);
  assert.equal(fsplStep(r).label, `Free-space loss (${r.distanceM.toFixed(2)} m)`);
  s.units.length = 'ft';
  const r2 = solveLink(s, link);
  assert.equal(fsplStep(r2).label, `Free-space loss (${(r2.distanceM / 0.3048).toFixed(1)} ft)`);
  assert.equal(fsplStep(r2).deltaDb, fsplStep(r).deltaDb, 'the loss value itself is unchanged');
});
