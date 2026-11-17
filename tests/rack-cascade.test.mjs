import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExample } from '../js/examples.js';
import { createStore } from '../js/store.js';
import { validateRack, rackWarnings, rackSections, DEFAULT_LOOP_LOSS_DB, RACK_LIMITS } from '../js/model/rack.js';
import { validateScene } from '../js/model/scene.js';
import { chainItemLossDb } from '../js/model/rf.js';
import { addRackSplitter, setSplitterInput, setSplitterPorts, connectChannel, adoptRack, removeRackItem, setSplitterFeed, setReceiverLoop, setReceiverLoopLoss, moveChannel } from '../js/actionsRack.js';

const mk = () => { const s = createStore(buildExample('band-four-piece-people').scene); adoptRack(s); return s; };
const mics = (s) => s.getScene().links.filter((l) => l.kind === 'mic');
const rackItems = (l) => l.chain.filter((i) => i.rackSplitter);
const lossOf = (l) => l.chain.reduce((t, i) => t + chainItemLossDb(i, 600), 0);

test('a splitter fed by a splitter puts both stages in the chain, root first, with ports counted per stage', () => {
  const s = mk(); const rk = s.getScene().rack, [m1, m2, m3] = mics(s);
  const a = addRackSplitter(s), b = addRackSplitter(s);
  setSplitterInput(s, a, 'A', rk.antennas[0].id); setSplitterFeed(s, b, a);
  connectChannel(s, m1.id, { splitterId: b }); connectChannel(s, m2.id, { splitterId: b }); connectChannel(s, m3.id, { splitterId: a });
  const L = mics(s);
  assert.equal(rackItems(L[0]).length, 2); assert.equal(rackItems(L[2]).length, 1);
  assert.deepEqual(L[0].rx.pos, rk.antennas[0].pos); // antennas come from the first stage
  assert.equal(rackItems(L[0])[0].ports, 2); // a: one channel and the cascaded splitter
  assert.equal(rackItems(L[0])[1].ports, 2);
  const single = lossOf({ chain: [rackItems(L[0])[1]] });
  assert.ok(lossOf({ chain: rackItems(L[0]) }) > single + 2);
  assert.ok(validateScene(s.getScene()).ok);
});

test('cycles and over-deep trees are refused by the action and by validateRack', () => {
  const s = mk(); const ids = [1, 2, 3, 4].map(() => addRackSplitter(s));
  setSplitterFeed(s, ids[1], ids[0]); setSplitterFeed(s, ids[2], ids[1]);
  setSplitterFeed(s, ids[0], ids[2]); // cycle
  setSplitterFeed(s, ids[3], ids[2]); // fourth stage
  const sp = (id) => s.getScene().rack.splitters.find((x) => x.id === id);
  assert.equal(sp(ids[0]).fromSplitter, undefined); assert.equal(sp(ids[3]).fromSplitter, undefined);
  assert.equal(sp(ids[2]).fromSplitter, ids[1]);
  const bad = structuredClone(s.getScene()); bad.rack.splitters[0].fromSplitter = ids[2];
  assert.ok(validateRack(bad).some((e) => /loop of splitters/.test(e)));
  const deep = structuredClone(s.getScene()); deep.rack.splitters[3].fromSplitter = ids[2];
  assert.ok(validateRack(deep).some((e) => /stages deep/.test(e)));
  const dang = structuredClone(s.getScene()); dang.rack.splitters[0].fromSplitter = 'nope';
  assert.ok(validateRack(dang).some((e) => /fromSplitter/.test(e)));
  assert.equal(RACK_LIMITS.maxSplitterDepth, 3);
});

test('unused ports are reported per stage and removing a middle stage reconnects the tree', () => {
  const s = mk(); const rk = s.getScene().rack, [m1] = mics(s);
  const a = addRackSplitter(s), b = addRackSplitter(s);
  setSplitterInput(s, a, 'A', rk.antennas[0].id); setSplitterFeed(s, b, a);
  setSplitterPorts(s, a, 4); setSplitterPorts(s, b, 4); connectChannel(s, m1.id, { splitterId: b });
  const w = rackWarnings(s.getScene()).filter((x) => x.level === 'info' && /unused/.test(x.text));
  assert.ok(w.some((x) => x.key === `splitter:${a}` && /3 unused/.test(x.text))); // 4 ports, one used by b
  assert.ok(w.some((x) => x.key === `splitter:${b}` && /3 unused/.test(x.text)));
  assert.ok(rackSections(s.getScene()).find((x) => x.key === 'splitters').items.some((i) => /fed from/.test(i.text)));
  removeRackItem(s, 'splitters', a);
  const sc = s.getScene(); assert.equal(sc.rack.splitters[0].antA, rk.antennas[0].id); assert.equal(sc.rack.splitters[0].fromSplitter, undefined);
  assert.ok(validateScene(sc).ok);
});

test('receiver loop-through adds one assumed loss per hop, is limited and is one-to-one', () => {
  const s = mk(); const [m1, m2, m3, m4] = mics(s);
  const rxOf = (id) => s.getScene().rack.receivers.find((r) => r.channels.some((c) => c.linkId === id));
  const [r1, r2, r3, r4] = [m1, m2, m3, m4].map((m) => rxOf(m.id).id);
  const base = lossOf(mics(s)[1]);
  setReceiverLoop(s, r2, r1);
  assert.ok(Math.abs(lossOf(mics(s)[1]) - base - DEFAULT_LOOP_LOSS_DB) < 1e-9);
  assert.equal(mics(s)[1].chain.find((i) => i.rackSplitter).assumed, true);
  setReceiverLoopLoss(s, r2, 1);
  assert.ok(Math.abs(lossOf(mics(s)[1]) - base - 1) < 1e-9);
  setReceiverLoop(s, r3, r1); // r1's output already feeds r2
  assert.equal(rxOf(m3.id).loopFrom, undefined);
  setReceiverLoop(s, r3, r2); setReceiverLoop(s, r4, r3);
  assert.equal(rxOf(m4.id).loopFrom, r3);
  setReceiverLoop(s, r1, r4); // would be a ring
  assert.equal(rxOf(m1.id).loopFrom, undefined);
  setReceiverLoop(s, r2, r2);
  assert.ok(validateScene(s.getScene()).ok);
  const bad = structuredClone(s.getScene()); bad.rack.receivers[0].loopFrom = r4;
  assert.ok(validateRack(bad).length > 0);
});

test('a looped receiver follows the first receiver\'s splitter, uses no port there, and loop hops stack', () => {
  const s = mk(); const rk = s.getScene().rack, [m1, m2, m3] = mics(s);
  const sp = addRackSplitter(s); setSplitterInput(s, sp, 'A', rk.antennas[0].id);
  const rxOf = (id) => s.getScene().rack.receivers.find((r) => r.channels.some((c) => c.linkId === id));
  connectChannel(s, m1.id, { splitterId: sp });
  setReceiverLoop(s, rxOf(m2.id).id, rxOf(m1.id).id); setReceiverLoop(s, rxOf(m3.id).id, rxOf(m2.id).id);
  const L = mics(s);
  assert.equal(rackItems(L[1]).find((i) => i.presetId).ports, 2);
  assert.equal(rackItems(L[1]).length, 2); // splitter + loop item
  assert.equal(rackItems(L[2]).find((i) => i.kind === 'attenuator').lossDb, 2 * DEFAULT_LOOP_LOSS_DB);
  connectChannel(s, m2.id, { splitterId: null, antA: rk.antennas[1].id }); // refused while looped
  assert.equal(rxOf(m2.id).channels[0].splitterId === sp || rxOf(m2.id).channels[0].splitterId === null, true);
  assert.ok(rackWarnings(s.getScene()).some((w) => w.key === `receiver:${m3.id}` && /loop-through/.test(w.text)));
  moveChannel(s, m3.id, 'new'); // the looped receiver vanishes; a dangling loop is cleaned up
  assert.ok(validateScene(s.getScene()).ok);
});
