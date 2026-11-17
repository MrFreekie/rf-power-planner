import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExample } from '../js/examples.js';
import { createStore } from '../js/store.js';
import { rackWarnings, rackSections } from '../js/model/rack.js';
import { validateScene } from '../js/model/scene.js';
import { chainLossDb, solveLink } from '../js/model/rf.js';
import { adoptRack, addRackCombiner, setCombiner, setCombinerFanout, setFanoutOutput, setTxIsolator, connectTxChannel, addRackAntenna, removeRackItem } from '../js/actionsRack.js';

const mk = () => createStore(buildExample('band-four-piece-people').scene);
const iems = (s) => s.getScene().links.filter((l) => l.kind === 'iem');

function fanScene({ cable0 = 0, cable1 = 20 } = {}) {
  const s = mk(); adoptRack(s);
  const a0 = s.getScene().rack.antennas.find((a) => a.role === 'tx').id, a1 = addRackAntenna(s, { role: 'tx', name: 'Tx Right' });
  const cb = addRackCombiner(s); setCombinerFanout(s, cb, { on: true });
  setFanoutOutput(s, cb, 0, { antennaId: a0, cableM: cable0 }); setFanoutOutput(s, cb, 1, { antennaId: a1, cableM: cable1 });
  const [i1, i2] = iems(s); connectTxChannel(s, i1.id, { combinerId: cb }); connectTxChannel(s, i2.id, { combinerId: cb });
  return { s, cb, a0, a1, i1: i1.id };
}
const link = (s, id) => s.getScene().links.find((l) => l.id === id);

test('combiner > splitter > two antennas: split loss on the chain, the first output cable', () => {
  const { s, i1 } = fanScene({ cable0: 5 });
  const l = link(s, i1), sp = l.chain.filter((c) => c.rackSplitter && c.kind === 'splitter');
  assert.equal(sp.length, 2); assert.equal(sp[1].ports, 2);
  assert.ok(l.chain.some((c) => c.kind === 'cable' && c.lengthM === 5));
  assert.ok(!l.chain.some((c) => c.kind === 'cable' && c.lengthM === 20));
  assert.ok(validateScene(s.getScene()).ok, validateScene(s.getScene()).errors.join());
});

test('each output pays the same split loss plus its own cable: reordering outputs changes the solved cable', () => {
  const a = fanScene({ cable0: 0, cable1: 20 }), b = fanScene({ cable0: 20, cable1: 0 });
  const la = link(a.s, a.i1), lb = link(b.s, b.i1);
  const base = fanScene({ cable0: 0, cable1: 0 }), lbase = link(base.s, base.i1);
  assert.ok(chainLossDb(lb.chain, lb.freqMHz) > chainLossDb(la.chain, la.freqMHz));
  const split = chainLossDb(lbase.chain, lbase.freqMHz) - chainLossDb(la.chain, la.freqMHz);
  assert.equal(split, 0);
  // removing the first output moves the solve to the second (cable 20 m)
  setFanoutOutput(a.s, a.cb, 0, null);
  assert.ok(chainLossDb(link(a.s, a.i1).chain, la.freqMHz) > chainLossDb(la.chain, la.freqMHz));
  assert.ok(Number.isFinite(solveLink(a.s.getScene(), link(a.s, a.i1)).rxPowerDbm ?? 0));
});

test('a splitter output costs 10log10(ports) over the plain combiner path', () => {
  const { s, cb, i1 } = fanScene({ cable0: 0, cable1: 0 });
  const withFan = chainLossDb(link(s, i1).chain, link(s, i1).freqMHz);
  setCombinerFanout(s, cb, { on: false }); setCombiner(s, cb, { antennaId: s.getScene().rack.antennas.find((a) => a.role === 'tx').id });
  const without = chainLossDb(link(s, i1).chain, link(s, i1).freqMHz);
  assert.ok(withFan - without >= 3, `${withFan} vs ${without}`);
});

test('warnings cover open splitter outputs and unused splitter ports', () => {
  const { s, cb } = fanScene();
  assert.ok(!rackWarnings(s.getScene()).some((w) => w.key === `combiner:${cb}` && w.level === 'warn'));
  setFanoutOutput(s, cb, 2, { antennaId: null });
  assert.ok(rackWarnings(s.getScene()).some((w) => w.key === `combiner:${cb}` && w.level === 'warn' && /1 output with no antenna/.test(w.text)));
  setFanoutOutput(s, cb, 2, null); setCombinerFanout(s, cb, { ports: 4 });
  assert.ok(rackWarnings(s.getScene()).some((w) => w.key === `combiner:${cb}` && w.level === 'info' && /2 unused outputs/.test(w.text)));
  assert.ok(rackSections(s.getScene()).find((x) => x.key === 'combiners').items[0].text.includes(' and '));
});

test('removing a transmit antenna empties its splitter output', () => {
  const { s, cb, a1 } = fanScene();
  removeRackItem(s, 'antennas', a1);
  assert.equal(s.getScene().rack.combiners.find((c) => c.id === cb).fanout.outputs[1].antennaId, null);
  assert.ok(validateScene(s.getScene()).ok);
});

test('isolator: 0.5 dB first in the chain with reverse isolation, shown in the transmitter text', () => {
  const { s, i1 } = fanScene();
  const before = chainLossDb(link(s, i1).chain, link(s, i1).freqMHz);
  setTxIsolator(s, i1, true, 30);
  const l = link(s, i1), it = l.chain[0];
  assert.equal(it.kind, 'attenuator'); assert.equal(it.lossDb, 0.5); assert.equal(it.reverseIsolationDb, 30); assert.ok(it.rackSplitter);
  assert.ok(Math.abs(chainLossDb(l.chain, l.freqMHz) - before - 0.5) < 1e-9);
  assert.ok(rackSections(s.getScene()).find((x) => x.key === 'iems').items.some((i) => /isolator \(0\.5 dB loss, 30 dB isolation\)/.test(i.text)));
  assert.ok(validateScene(s.getScene()).ok, validateScene(s.getScene()).errors.join());
  setTxIsolator(s, i1, false);
  assert.ok(!link(s, i1).chain.some((c) => c.reverseIsolationDb));
});

test('isolator on a channel without a combiner, and isolatorDb is clamped', () => {
  const s = mk(); adoptRack(s); const [i1] = iems(s);
  setTxIsolator(s, i1.id, true, 500);
  assert.equal(s.getScene().rack.transmitters.flatMap((t) => t.channels).find((c) => c.linkId === i1.id).isolatorDb, 60);
  assert.equal(link(s, i1.id).chain[0].reverseIsolationDb, 60);
});
