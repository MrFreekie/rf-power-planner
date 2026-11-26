import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iem8Scene } from '../js/examples/scenes-imd.js';
import { imdFromRack } from '../js/model/imd-rack.js';
import { imdTransmitters, imdTopology } from '../js/model/imd.js';
import { combinerParams, validateRack } from '../js/model/rack.js';
import { validateScene } from '../js/model/scene.js';

test('combiner types: passive follows 10 log N plus excess, isolated and active defaults, overrides win', () => {
  const p = combinerParams({ type: 'passive' }, 4);
  assert.ok(Math.abs(p.lossDb - (10 * Math.log10(4) + 1)) < 1e-9);
  assert.deepEqual(combinerParams({ type: 'isolated' }, 8), { lossDb: 2, isolationDb: 50, isolatorDb: 25 });
  assert.equal(combinerParams({ type: 'active' }, 4).lossDb, 0);
  assert.deepEqual(combinerParams({ type: 'isolated', lossDb: 4.5, isolationDb: 45 }, 8), { lossDb: 4.5, isolationDb: 45, isolatorDb: 22.5 });
});

test('imdFromRack: null unless fromRack; eight IEMs come from the rack, ids are the link ids', () => {
  const a = iem8Scene('A');
  assert.deepEqual(a.imd.transmitters, []);
  const d = imdFromRack(a);
  assert.equal(d.transmitters.length, 8);
  assert.deepEqual(d.transmitters.map((t) => t.id), a.links.map((l) => l.id));
  assert.equal(d.topology.groups.length, 1);
  assert.equal(d.topology.groups[0].isolatorDb, 22.5);
  const off = structuredClone(a); off.imd.fromRack = false;
  assert.equal(imdFromRack(off), null);
});

test('combiner feeding a root: C topology has two groups under one root, per-channel isolators', () => {
  const c = iem8Scene('C'), d = imdFromRack(c), ids = imdTransmitters(c).map((t) => t.id);
  assert.equal(d.topology.groups.length, 2);
  assert.deepEqual(d.topology.root, { lossDb: 3.5, isolationDb: 25 });
  assert.equal(imdTopology(c).pairCouplingDb(ids[0], ids[4]), 51);
  const none = iem8Scene('C', { noIsolators: true });
  const nid = imdTransmitters(none).map((t) => t.id);
  assert.equal(imdTopology(none).pairCouplingDb(nid[0], nid[4]), 31);
});

test('into validation: unknown target, chained roots and a root with channels are refused', () => {
  const s = iem8Scene('C');
  assert.equal(validateScene(s).ok, true);
  const bad = structuredClone(s); bad.rack.combiners[0].into = 'nope';
  assert.equal(validateScene(bad).ok, false);
  const bad2 = structuredClone(s); bad2.imd.fromRack = 'yes';
  assert.equal(validateScene(bad2).ok, false);
});
