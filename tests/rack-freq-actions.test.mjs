import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene, validateScene } from '../js/model/scene.js';
import { addLink, removeLink } from '../js/actions.js';
import { addTransmitter, setTxChannelFreq, removeTxChannel, adoptRack, addReceiver, setChannelFreq, removeReceiverChannel, addRackAntenna, removeRackItem } from '../js/actionsRack.js';
import { rackSections, rackWarnings, unattachedAntennas } from '../js/model/rack.js';

const chans = (sc) => sc.rack.receivers.flatMap((u) => u.channels);

test('a receiver added beside a lone mic takes its frequency and pairs with it', () => {
  const st = createStore(createDefaultScene()); adoptRack(st);
  const mic = addLink(st, 'mic');
  assert.ok(chans(st.getScene()).every((c) => c.linkId !== mic), 'a new mic starts unheard');
  const id = addReceiver(st);
  const sc = st.getScene(), c = chans(sc).find((x) => x.id === id);
  assert.equal(c.linkId, mic);
  assert.equal(c.freqMHz, sc.links.find((l) => l.id === mic).freqMHz);
  assert.deepEqual(validateScene(sc).errors, []);
});

test('retuning unpairs, removing the receiver leaves the mic, and nothing else is deleted', () => {
  const st = createStore(createDefaultScene()); adoptRack(st);
  const mic = addLink(st, 'mic'), id = addReceiver(st);
  const nLinks = st.getScene().links.length, nAnt = st.getScene().rack.antennas.length;
  assert.equal(setChannelFreq(st, id, 700.123) !== false, true);
  assert.equal(chans(st.getScene()).find((c) => c.id === id).linkId, null);
  assert.ok(rackWarnings(st.getScene()).some((w) => w.key === `mic:${mic}`), 'the unheard mic is flagged');
  assert.ok(rackWarnings(st.getScene()).some((w) => w.key === `receiver:${id}`), 'the unmatched receiver is flagged');
  const items = rackSections(st.getScene()).flatMap((s) => s.items);
  assert.ok(items.some((i) => i.kind === 'receiver' && i.id === id && !i.matched));
  removeReceiverChannel(st, id);
  assert.equal(chans(st.getScene()).some((c) => c.id === id), false);
  assert.equal(st.getScene().links.length, nLinks); assert.equal(st.getScene().rack.antennas.length, nAnt);
  assert.deepEqual(validateScene(st.getScene()).errors, []);
});

test('an antenna only an unpaired receiver uses is a free antenna that can be removed', () => {
  const st = createStore(createDefaultScene()); adoptRack(st);
  const ant = addRackAntenna(st);
  const id = addReceiver(st, { freqMHz: 650.5, antA: ant });
  assert.ok(unattachedAntennas(st.getScene().rack).some((a) => a.id === ant), 'drawn on the plan even though a receiver names it');
  const mic = addLink(st, 'mic');
  setChannelFreq(st, id, st.getScene().links.find((l) => l.id === mic).freqMHz);
  assert.equal(chans(st.getScene()).find((c) => c.id === id).linkId, mic);
  assert.equal(unattachedAntennas(st.getScene().rack).some((a) => a.id === ant), false, 'a paired receiver puts its antenna on a link end');
  removeRackItem(st, 'antennas', ant);
  assert.equal(st.getScene().rack.antennas.some((a) => a.id === ant), false);
});

test('removing every mic keeps the receivers, and every item can then be removed', () => {
  const st = createStore(createDefaultScene()); adoptRack(st);
  for (const l of [...st.getScene().links]) removeLink(st, l.id);
  assert.equal(st.getScene().links.length, 0);
  assert.ok(chans(st.getScene()).length > 0);
  for (const c of chans(st.getScene())) removeReceiverChannel(st, c.id);
  for (const a of [...st.getScene().rack.antennas]) removeRackItem(st, 'antennas', a.id);
  assert.equal(chans(st.getScene()).length, 0); assert.equal(st.getScene().rack.antennas.length, 0);
  assert.deepEqual(validateScene(st.getScene()).errors, []);
});

const tchans = (sc) => sc.rack.transmitters.flatMap((u) => u.channels);

test('an IEM transmitter pairs with the bodypack on its exact frequency, and leaves it when retuned or removed', () => {
  const st = createStore(createDefaultScene()); adoptRack(st);
  const iem = addLink(st, 'iem'), nAnt = st.getScene().rack.antennas.length;
  assert.ok(tchans(st.getScene()).every((c) => c.linkId !== iem), 'a new IEM starts unheard');
  assert.ok(rackWarnings(st.getScene()).some((w) => w.key === `bodypack:${iem}`));
  const id = addTransmitter(st);
  const c = tchans(st.getScene()).find((x) => x.id === id);
  assert.equal(c.linkId, iem); assert.equal(c.freqMHz, st.getScene().links.find((l) => l.id === iem).freqMHz);
  setTxChannelFreq(st, id, 555.5);
  assert.equal(tchans(st.getScene()).find((x) => x.id === id).linkId, null);
  assert.ok(rackSections(st.getScene()).flatMap((s) => s.items).some((i) => i.kind === 'transmitter' && i.id === id && !i.matched));
  assert.ok(rackWarnings(st.getScene()).some((w) => w.key === `transmitter:${id}`));
  removeTxChannel(st, id);
  assert.equal(tchans(st.getScene()).some((x) => x.id === id), false);
  assert.ok(st.getScene().links.some((l) => l.id === iem)); assert.equal(st.getScene().rack.antennas.length, nAnt);
  assert.deepEqual(validateScene(st.getScene()).errors, []);
});

test('removing every IEM keeps the transmitters, and they and their antennas can then all go', () => {
  const st = createStore(createDefaultScene()); adoptRack(st);
  const iem = addLink(st, 'iem'); addTransmitter(st);
  removeLink(st, iem);
  assert.ok(tchans(st.getScene()).length > 0);
  for (const c of tchans(st.getScene())) removeTxChannel(st, c.id);
  for (const a of [...st.getScene().rack.antennas]) removeRackItem(st, 'antennas', a.id);
  assert.equal(tchans(st.getScene()).length, 0);
  assert.deepEqual(validateScene(st.getScene()).errors, []);
});

test('transmitter settings live with the transmitter: an edit on the paired link goes to the device', () => {
  const st = createStore(createDefaultScene()); adoptRack(st);
  const iem = addLink(st, 'iem'), id = addTransmitter(st);
  st.update((d) => { d.links.find((l) => l.id === iem).tx.powerDbm = 7; });
  assert.equal(tchans(st.getScene()).find((c) => c.id === id).tx.powerDbm, 7);
  setTxChannelFreq(st, id, 999.1); setTxChannelFreq(st, id, st.getScene().links.find((l) => l.id === iem).freqMHz);
  assert.equal(st.getScene().links.find((l) => l.id === iem).tx.powerDbm, 7);
});
