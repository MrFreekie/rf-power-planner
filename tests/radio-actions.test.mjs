import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExample } from '../js/examples.js';
import { createStore } from '../js/store.js';
import { validateScene } from '../js/model/scene.js';
import { checkIntermod } from '../js/model/coordination.js';
import { addPerson, setTxFmPreset } from '../js/actions.js';
import { adoptRack, addRackSplitter, setSplitterInput, connectChannel, addRackCombiner, connectTxChannel } from '../js/actionsRack.js';
import { addRadioChannels, duplicateRadioLink, moveRadioItem, setChannelFeed, feedValue } from '../js/actionsRadio.js';

const mk = () => createStore(buildExample('band-four-piece-people').scene);
const chan = (sc, id) => { for (const r of sc.rack.receivers) for (const c of r.channels) if (c.linkId === id) return { r, c }; return null; };
const tchan = (sc, id) => { for (const r of sc.rack.transmitters) for (const c of r.channels) if (c.linkId === id) return { r, c }; return null; };

test('addRadioChannels: four mics on the same splitter, no new antennas, clean frequencies, one undo step', () => {
  const s = mk(); adoptRack(s);
  const mics = s.getScene().links.filter((l) => l.kind === 'mic');
  const ant = s.getScene().rack.antennas.find((a) => a.role !== 'tx');
  const sp = addRackSplitter(s); setSplitterInput(s, sp, 'A', ant.id);
  connectChannel(s, mics.at(-1).id, { splitterId: sp });
  setTxFmPreset(s, mics.at(-1).id, 'sennheiser-skm5200ii');
  const before = s.getScene(), nAnt = before.rack.antennas.length, nLinks = before.links.length;
  const ids = addRadioChannels(s, 'mic', { count: 4 });
  const sc = s.getScene();
  assert.equal(ids.length, 4); assert.equal(sc.links.length, nLinks + 4);
  assert.equal(sc.rack.antennas.length, nAnt, 'no antenna per new mic');
  for (const id of ids) {
    assert.equal(chan(sc, id).c.splitterId, sp);
    assert.equal(sc.links.find((l) => l.id === id).tx.fmPreset, 'sennheiser-skm5200ii', 'gear copied from the reference');
  }
  const freqs = sc.links.filter((l) => l.kind !== 'p2p' && l.txOf === undefined).map((l) => l.freqMHz);
  assert.equal(new Set(freqs).size, freqs.length);
  const newF = ids.map((id) => sc.links.find((l) => l.id === id).freqMHz);
  assert.ok(!checkIntermod(freqs, { guardKHz: 199 }).conflicts.some((c) => newF.some((f) => Math.abs(c.fMHz - f) < 0.199)), 'new channels clear of third-order products');
  assert.deepEqual(validateScene(sc).errors, [], 'scene still valid');
  s.undo();
  assert.equal(s.getScene().links.length, nLinks, 'one undo removes all four');
});

test('addRadioChannels: into a chosen receiver unit, and onto a person (main, then extras)', () => {
  const s = mk(); adoptRack(s);
  const unit = s.getScene().rack.receivers[0];
  const pid = addPerson(s, { name: 'Singer' });
  const ids = addRadioChannels(s, 'mic', { count: 2, unitId: unit.id, personId: pid });
  const sc = s.getScene(), p = sc.people.find((x) => x.id === pid);
  assert.equal(chan(sc, ids[0]).r.id, unit.id); assert.equal(chan(sc, ids[1]).r.id, unit.id);
  assert.equal(p.micLinkId, ids[0]); assert.deepEqual(p.extraLinkIds, [ids[1]]);
});

test('addRadioChannels: IEMs share the combiner of the reference channel', () => {
  const s = mk(); adoptRack(s);
  const iem = s.getScene().links.filter((l) => l.kind === 'iem' && l.txOf === undefined).at(-1);
  const cb = addRackCombiner(s); connectTxChannel(s, iem.id, { combinerId: cb });
  const nAnt = s.getScene().rack.antennas.length;
  const [id] = addRadioChannels(s, 'iem', {});
  const sc = s.getScene();
  assert.equal(tchan(sc, id).c.combinerId, cb);
  assert.equal(sc.rack.antennas.length, nAnt);
});

test('addRadioChannels: an IEM whose reference goes straight to an antenna is added without an antenna', () => {
  const s = mk(); adoptRack(s);
  const nAnt = s.getScene().rack.antennas.filter((a) => a.role === 'tx').length;
  const [id] = addRadioChannels(s, 'iem', {});
  const sc = s.getScene(), mine = tchan(sc, id).c;
  assert.equal(mine.combinerId, null);
  assert.ok(!mine.antennaId, 'left for the user to wire');
  assert.equal(sc.rack.antennas.filter((a) => a.role === 'tx').length, nAnt, 'no new transmit antenna');
});

test('addRadioChannels: a mic added at the top of a full band stays near the block', () => {
  const s = mk(); adoptRack(s);
  const sc0 = s.getScene(), top = Math.max(...sc0.links.filter((l) => l.kind === 'mic').map((l) => l.freqMHz));
  const [id] = addRadioChannels(s, 'mic', {});
  const f = s.getScene().links.find((l) => l.id === id).freqMHz;
  assert.ok(Math.abs(f - top) < 40, `near ${top} MHz, got ${f}`);
});

test('duplicateRadioLink copies the gear onto a new frequency; an extra receiver is not duplicated here', () => {
  const s = mk(); const l = s.getScene().links.find((q) => q.kind === 'mic');
  s.update((d) => { d.links.find((q) => q.id === l.id).tx.powerDbm = 10; });
  const id = duplicateRadioLink(s, l.id), n = s.getScene().links.find((q) => q.id === id);
  assert.ok(n); assert.equal(n.tx.powerDbm, 10); assert.notEqual(n.freqMHz, l.freqMHz); assert.notEqual(n.tx.id, l.tx.id);
  assert.equal(duplicateRadioLink(s, 'nope'), null);
});

test('moveRadioItem reorders links of one kind and rack units, without changing the maths', () => {
  const s = mk(); const ids = s.getScene().links.filter((l) => l.kind === 'mic').map((l) => l.id);
  moveRadioItem(s, 'mic', ids[1], -1);
  const now = s.getScene().links.filter((l) => l.kind === 'mic').map((l) => l.id);
  assert.deepEqual(now.slice(0, 2), [ids[1], ids[0]]);
  moveRadioItem(s, 'mic', now[0], -1); // already first: nothing happens
  assert.deepEqual(s.getScene().links.filter((l) => l.kind === 'mic').map((l) => l.id), now);
  adoptRack(s);
  const r0 = s.getScene().rack.receivers.map((r) => r.id), first = s.getScene().rack.receivers[0].channels[0].linkId;
  moveRadioItem(s, 'receiver', first, 1);
  assert.deepEqual(s.getScene().rack.receivers.map((r) => r.id).slice(0, 2), [r0[1], r0[0]]);
  const ants = s.getScene().rack.antennas.filter((a) => a.role !== 'tx').map((a) => a.id);
  moveRadioItem(s, 'antenna', ants[1], -1);
  assert.equal(s.getScene().rack.antennas.filter((a) => a.role !== 'tx')[0].id, ants[1]);
});

test('setChannelFeed switches a receiver between antennas, a splitter and a loop-through in one step', () => {
  const s = mk(); adoptRack(s);
  const [a, b] = s.getScene().links.filter((l) => l.kind === 'mic');
  const sp = addRackSplitter(s); setSplitterInput(s, sp, 'A', s.getScene().rack.antennas[0].id);
  setChannelFeed(s, b.id, `splitter:${sp}`);
  let m = chan(s.getScene(), b.id); assert.equal(feedValue(m.r, m.c), `splitter:${sp}`);
  const ra = chan(s.getScene(), a.id).r.id;
  setChannelFeed(s, b.id, `loop:${ra}`);
  m = chan(s.getScene(), b.id); assert.equal(feedValue(m.r, m.c), `loop:${ra}`);
  setChannelFeed(s, b.id, 'antennas'); // leaving the loop in one step (connectChannel alone refuses a looped receiver)
  m = chan(s.getScene(), b.id); assert.equal(feedValue(m.r, m.c), 'antennas'); assert.ok(m.c.antA);
  setChannelFeed(s, b.id, `loop:${chan(s.getScene(), b.id).r.id}`); // itself: refused
  assert.equal(feedValue(chan(s.getScene(), b.id).r), 'antennas');
});
