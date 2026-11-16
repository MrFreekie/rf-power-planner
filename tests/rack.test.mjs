import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExample } from '../js/examples.js';
import { createStore } from '../js/store.js';
import { deriveRack } from '../js/model/rack.js';
import { validateScene, serialize, deserialize } from '../js/model/scene.js';
import { solveLink } from '../js/model/rf.js';
import { shareRxAntenna } from '../js/actions.js';
import { addRackSplitter, setSplitterInput, connectChannel, moveChannel, adoptRack, removeRackItem, renameRackItem } from '../js/actionsRack.js';

const mk = () => createStore(buildExample('band-four-piece-people').scene);
const mics = (s) => s.getScene().links.filter((l) => l.kind === 'mic');

test('deriveRack lists a receiver and antenna per mic, and a shared antenna becomes one splitter', () => {
  const s = mk(); const [a, b] = mics(s);
  assert.equal(deriveRack(s.getScene()).receivers.length, 4);
  shareRxAntenna(s, b.id, a.id);
  const r = deriveRack(s.getScene());
  assert.equal(r.splitters.length, 1); assert.equal(r.receivers.length, 4);
  assert.equal(r.receivers.filter((x) => x.channels[0].splitterId).length, 2);
});

test('adopting keeps the maths: shared links still have one splitter item each', () => {
  const s = mk(); const [a, b] = mics(s);
  shareRxAntenna(s, b.id, a.id);
  const before = solveLink(s.getScene(), mics(s)[1]).inputPowerDbm;
  adoptRack(s);
  const sc = s.getScene();
  assert.ok(sc.rack); assert.equal(mics(s)[1].rx.sharedAntennaOf, undefined);
  for (const l of mics(s).slice(0, 2)) assert.equal(l.chain.filter((i) => /splitter/.test(i.presetId || '')).length, 1);
  assert.ok(Math.abs(solveLink(sc, mics(s)[1]).inputPowerDbm - before) < 0.01);
  assert.ok(validateScene(sc).ok, validateScene(sc).errors.join());
});

test('three mics on one splitter with A and B antennas, a fourth on a dual-channel receiver and its own splitter', () => {
  const s = mk(); adoptRack(s);
  let rk = s.getScene().rack; const [m1, m2, m3, m4] = mics(s);
  const sp1 = addRackSplitter(s), sp2 = addRackSplitter(s);
  setSplitterInput(s, sp1, 'A', rk.antennas[0].id); setSplitterInput(s, sp1, 'B', rk.antennas[1].id);
  setSplitterInput(s, sp2, 'A', rk.antennas[0].id);
  for (const l of [m1, m2, m3]) connectChannel(s, l.id, { splitterId: sp1 });
  connectChannel(s, m4.id, { splitterId: sp2 });
  moveChannel(s, m4.id, s.getScene().rack.receivers.find((r) => r.channels.some((c) => c.linkId === m3.id)).id);
  const sc = s.getScene(), L = mics(s);
  assert.equal(sc.rack.receivers.find((r) => r.channels.length === 2).channels.length, 2);
  for (const l of L.slice(0, 3)) { assert.ok(l.rx.diversity.enabled); assert.deepEqual(l.rx.pos, sc.rack.antennas[0].pos); assert.equal(l.chain[0].ports, 3); }
  assert.equal(L[3].chain[0].ports, 2);
  assert.ok(validateScene(sc).ok, validateScene(sc).errors.join());
  const back = deserialize(serialize(sc)); assert.equal(back.rack.splitters.length, 2); assert.equal(back.links[0].chain[0].rackSplitter, true);
  removeRackItem(s, 'splitters', sp1);
  assert.equal(mics(s)[0].chain.filter((i) => i.rackSplitter).length, 0);
  renameRackItem(s, 'splitters', sp2, 'Split 9'); assert.equal(s.getScene().rack.splitters[0].name, 'Split 9');
});

test('a mic added after the rack exists gets its own receiver', () => {
  const s = mk(); adoptRack(s);
  s.update((d) => { const c = structuredClone(d.links[0]); c.id = 'newmic'; c.name = 'Extra'; d.links.push(c); });
  assert.ok(s.getScene().rack.receivers.some((r) => r.channels.some((c) => c.linkId === 'newmic')));
});

import { addRackCombiner, setCombiner, connectTxChannel, moveTxChannel, addRackAntenna } from '../js/actionsRack.js';
import { chainLossDb } from '../js/model/rf.js';

test('four IEM channels on two transmitters through combiners, one with a cable run to its own antenna', () => {
  const s = mk(); adoptRack(s);
  const iems = () => s.getScene().links.filter((l) => l.kind === 'iem');
  const [i1, i2, i3, i4] = iems();
  const antB = addRackAntenna(s, { role: 'tx', name: 'Tx Antenna B' });
  const cb1 = addRackCombiner(s), cb2 = addRackCombiner(s, { cableM: 15 });
  setCombiner(s, cb1, { antennaId: s.getScene().rack.antennas.find((a) => a.role === 'tx').id }); setCombiner(s, cb2, { antennaId: antB });
  connectTxChannel(s, i1.id, { combinerId: cb1 }); connectTxChannel(s, i2.id, { combinerId: cb1 });
  connectTxChannel(s, i3.id, { combinerId: cb2 }); connectTxChannel(s, i4.id, { combinerId: cb2 });
  moveTxChannel(s, i2.id, s.getScene().rack.transmitters.find((t) => t.channels[0].linkId === i1.id).id);
  const sc = s.getScene(), L = iems();
  assert.equal(sc.rack.transmitters.find((t) => t.channels.length === 2).channels.length, 2);
  assert.equal(L[0].chain[0].ports, 2); assert.ok(L[2].chain.some((c) => c.kind === 'cable' && c.rackSplitter && c.lengthM === 15));
  assert.deepEqual(L[2].tx.pos, sc.rack.antennas.find((a) => a.id === antB).pos);
  assert.deepEqual(L[0].branches[0].pos, L[0].tx.pos);
  assert.ok(chainLossDb(L[2].chain, L[2].freqMHz) > chainLossDb(L[0].chain, L[0].freqMHz));
  assert.ok(validateScene(sc).ok, validateScene(sc).errors.join());
});

import { rackSections } from '../js/model/rack.js';
test('rackSections writes the connections in words, before and after adopting', () => {
  const s = mk(); const [a, b] = mics(s); shareRxAntenna(s, b.id, a.id);
  let sec = rackSections(s.getScene());
  assert.ok(sec.find((x) => x.key === 'receivers').items.some((i) => /> Rx 2 connected to Split 1 A$/.test(i.text)));
  adoptRack(s);
  const txt = rackSections(s.getScene()).flatMap((x) => x.items.map((i) => i.text));
  assert.ok(txt.some((t) => /^IEM Tx 1 Channel 1/.test(t)));
  assert.ok(txt.some((t) => /Rx Antenna A connected to Split 1 A/.test(t)));
});

import { rackWarnings, rackLoads } from '../js/model/rack.js';
import { setRackAntenna, setSplitterPorts } from '../js/actionsRack.js';

test('warns about an IEM with no antenna, accepts a dummy load, and counts loads for unused ports', () => {
  const s = mk(); adoptRack(s);
  const i1 = s.getScene().links.find((l) => l.kind === 'iem');
  connectTxChannel(s, i1.id, { antennaId: null });
  s.update((d) => { d.rack.transmitters[0].channels[0].antennaId = null; });
  assert.ok(rackWarnings(s.getScene()).some((w) => w.level === 'warn' && w.key === `transmitter:${i1.id}`));
  const txa = s.getScene().rack.antennas.find((a) => a.role === 'tx');
  setRackAntenna(s, txa.id, { load: true }); connectTxChannel(s, i1.id, { antennaId: txa.id });
  assert.ok(!rackWarnings(s.getScene()).some((w) => w.level === 'warn'));
  assert.equal(s.getScene().links.find((l) => l.id === i1.id).tx.antenna.gainDbi, -60);
  assert.equal(rackLoads(s.getScene()).dummyLoads, 1);
  const cb = addRackCombiner(s); setCombiner(s, cb, { ports: 4, antennaId: txa.id });
  connectTxChannel(s, i1.id, { combinerId: cb });
  const f = rackWarnings(s.getScene()).find((w) => w.key === `combiner:${cb}`);
  assert.ok(f && f.level === 'info' && /3 unused inputs/.test(f.text));
  assert.equal(rackLoads(s.getScene()).freePorts, 3);
  assert.equal(s.getScene().links.find((l) => l.id === i1.id).chain[0].ports, 4);
  assert.ok(validateScene(s.getScene()).ok, validateScene(s.getScene()).errors.join());
});

import { addAntennaChainItem, setAntennaChainItem, setAntennaZones } from '../js/actionsRack.js';
import { createZone } from '../js/model/scene.js';

test('an antenna cable run sits in front of the splitter for every mic on it, and zones are kept only while they exist', () => {
  const s = mk(); const [a, b] = mics(s); shareRxAntenna(s, b.id, a.id); adoptRack(s);
  const ant = s.getScene().rack.antennas[0];
  addAntennaChainItem(s, ant.id, { kind: 'cable' });
  const it = s.getScene().rack.antennas[0].chain[0];
  setAntennaChainItem(s, ant.id, it.id, { lengthM: 40 });
  const [A, B] = mics(s);
  for (const l of [A, B]) { assert.equal(l.chain[0].kind, 'cable'); assert.equal(l.chain[0].lengthM, 40); assert.equal(l.chain[1].presetId, 'splitter-2'); }
  const before = solveLink(s.getScene(), A).inputPowerDbm;
  setAntennaChainItem(s, ant.id, it.id, { lengthM: 80 });
  assert.ok(solveLink(s.getScene(), mics(s)[0]).inputPowerDbm < before, 'a longer run loses more');
  assert.ok(validateScene(s.getScene()).ok, validateScene(s.getScene()).errors.join());
  s.update((d) => { d.zones = [createZone({ name: 'Front' })]; });
  const z = s.getScene().zones[0].id;
  assert.ok(rackWarnings(s.getScene()).some((w) => w.key === `zone:${z}`));
  setAntennaZones(s, ant.id, [z]);
  assert.ok(!rackWarnings(s.getScene()).some((w) => w.key === `zone:${z}`));
  s.update((d) => { d.zones = []; });
  assert.deepEqual(s.getScene().rack.antennas[0].zones, []);
});

import { assignMic, assignIem, peopleLinkOwners } from '../js/actions.js';
test('a mic and an IEM link can be given to another person and taken off them', () => {
  const s = mk(), sc = s.getScene(), [p1, p2] = sc.people, m1 = p1.micLinkId, i2 = p2.iemLinkId;
  assert.ok(assignMic(s, p2.id, m1, { swap: true }));
  assert.equal(peopleLinkOwners(s.getScene()).get(m1).personId, p2.id);
  assert.ok(assignIem(s, p1.id, i2, { swap: true }));
  assert.equal(peopleLinkOwners(s.getScene()).get(i2).personId, p1.id);
  assert.ok(assignMic(s, p2.id, null));
  assert.equal(peopleLinkOwners(s.getScene()).has(m1), false);
});

import { setRxBias } from '../js/actionsRack.js';
test('an LNA up the antenna cable warns until the receiver supplies bias, or a bias tee is added', () => {
  const s = mk(); adoptRack(s); const m = mics(s)[0], ant = s.getScene().rack.antennas[0];
  addAntennaChainItem(s, ant.id, { presetId: 'lna-20' });
  const dc = () => solveLink(s.getScene(), mics(s)[0]).warnings.filter((t) => /bias/i.test(t));
  assert.ok(dc().length, 'bias needed, none supplied');
  setRxBias(s, m.id, { on: true, volts: 12 });
  assert.equal(dc().length, 0); assert.equal(mics(s)[0].rx.antennaBiasV, 12);
  setRxBias(s, m.id, { on: false }); assert.ok(dc().length);
  addAntennaChainItem(s, ant.id, { presetId: 'biastee' });
  assert.equal(dc().length, 0, 'a bias tee in the run powers the LNA');
});

import { txFormFactor } from '../js/model/inventory.js';
import { setTxFmPreset } from '../js/actions.js';
test('microphones are split by form factor when a model is chosen', () => {
  const s = mk(), [a, b] = mics(s);
  setTxFmPreset(s, a.id, 'sennheiser-skm5200ii'); setTxFmPreset(s, b.id, 'sennheiser-skp2000');
  assert.equal(txFormFactor(mics(s)[0]), 'handheld'); assert.equal(txFormFactor(mics(s)[1]), 'plug-on');
  const keys = rackSections(s.getScene(), txFormFactor).map((x) => x.key);
  assert.ok(keys.includes('mics-handheld') && keys.includes('mics-plug-on'));
  assert.ok(rackSections(s.getScene()).some((x) => x.key === 'mics'));
});
