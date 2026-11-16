import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES, buildExample } from '../js/examples.js';
import { inventoryRows, inventoryTotals, linkCard, txDeviceName, rxDeviceName } from '../js/model/inventory.js';
import { inventoryView } from '../js/ui/inventoryUi.js';
import { createDefaultScene } from '../js/model/scene.js';

const people = () => buildExample('band-four-piece-people').scene;

test('one inventory row per link, in scene order, with the person when assigned', () => {
  const sc = people(), rows = inventoryRows(sc);
  assert.equal(rows.length, sc.links.length);
  assert.deepEqual(rows.map((r) => r.id), sc.links.map((l) => l.id));
  assert.equal(rows[0].person, 'Anna');
  assert.ok(rows.every((r) => r.status && Number.isFinite(r.marginDb) && r.txItem && r.rxItem));
});

test('totals count mics, IEMs and gear, and body-worn antennas are not packed', () => {
  const sc = people(), t = inventoryTotals(inventoryRows(sc), sc);
  assert.equal(t.mics, 4); assert.equal(t.iems, 4);
  assert.equal(t.transmitters.reduce((a, x) => a + x.count, 0), 8);
  assert.ok(!t.antennas.some((a) => /body/i.test(a.label)));
  assert.ok(t.cables.every((c) => c.count > 0 && c.lengthM > 0));
});

test('an FM preset names the transmitter; no preset gives a generic name by kind', () => {
  const sc = createDefaultScene(), l = sc.links[0];
  assert.match(txDeviceName(l), /^Generic /);
  assert.match(rxDeviceName(l), /receiver|bodypack|Mic|IEM/i);
});

test('linkCard describes the selected link and returns null for an unknown id', () => {
  const sc = people(), card = linkCard(sc, sc.links[0].id);
  assert.ok(card.lines.length >= 5);
  assert.match(card.lines[0], /Anna/);
  assert.equal(linkCard(sc, 'nope'), null);
});

test('inventoryView marks the link of the selected transmitter as active, and the first link when nothing is selected', () => {
  const sc = people();
  assert.equal(inventoryView(sc, null).rows.filter((r) => r.active).map((r) => r.id)[0], sc.links[0].id);
  const v = inventoryView(sc, sc.links[2].tx.id);
  assert.deepEqual(v.rows.filter((r) => r.active).map((r) => r.id), [sc.links[2].id]);
  assert.equal(v.card.row.id, sc.links[2].id);
  assert.match(v.summary, /4 mics, 4 IEMs/);
});

test('every example builds an inventory without throwing', () => {
  for (const e of EXAMPLES) { const sc = buildExample(e.id).scene; assert.doesNotThrow(() => inventoryRows(sc), e.id); }
});

import { gearOptions, powerChoices, presetKind } from '../js/model/inventory.js';
import { setTxFmPreset, setRxFmPreset } from '../js/actions.js';
import { createStore } from '../js/store.js';

test('gear options are split by link kind and models that tune at the link frequency come first', () => {
  const sc = people(), mic = sc.links.find((l) => l.kind === 'mic'), iem = sc.links.find((l) => l.kind === 'iem');
  const m = gearOptions(mic), i = gearOptions(iem);
  assert.ok(m.tx.length && m.rx.length && i.tx.length && i.rx.length);
  assert.ok(m.tx.every((o) => presetKind(o.id) === 'mic') && i.tx.every((o) => presetKind(o.id) === 'iem'));
  assert.ok(i.rx.every((o) => /iem|ek|p9ra|p10r/i.test(o.id)));
  const firstOut = m.tx.findIndex((o) => !o.tunes), lastIn = m.tx.map((o) => o.tunes).lastIndexOf(true);
  assert.ok(firstOut === -1 || lastIn < firstOut);
  assert.ok(m.tx.some((o) => o.tunes));
});

test('a p2p link has no gear options', () => {
  const l = { kind: 'p2p', freqMHz: 600 };
  assert.deepEqual(gearOptions(l), { tx: [], rx: [] });
});

test('picking a model through the actions changes the card and the power choices', () => {
  const store = createStore(people()), l0 = store.getScene().links.find((l) => l.kind === 'mic');
  const pick = gearOptions(l0).tx.find((o) => o.tunes && o.id === 'shure-ur2') || gearOptions(l0).tx.find((o) => o.tunes);
  setTxFmPreset(store, l0.id, pick.id);
  const l1 = store.getScene().links.find((l) => l.id === l0.id);
  assert.equal(l1.tx.fmPreset, pick.id);
  assert.match(txDeviceName(l1), /class/);
  assert.ok(powerChoices(l1).current);
  const rx = gearOptions(l1).rx.find((o) => o.tunes);
  setRxFmPreset(store, l0.id, rx.id);
  assert.equal(store.getScene().links.find((l) => l.id === l0.id).rx.rxPreset, rx.id);
  setTxFmPreset(store, l0.id, '');
  assert.match(txDeviceName(store.getScene().links.find((l) => l.id === l0.id)), /^Generic/);
});

import { addLink, removeLink } from '../js/actions.js';
import { validateScene } from '../js/model/scene.js';

test('addLink adds a mic or IEM at a free frequency, beside the last one, as one undo step', () => {
  const store = createStore(people()), before = store.getScene().links.length, freqs = store.getScene().links.map((l) => l.freqMHz);
  const id = addLink(store, 'mic');
  const sc = store.getScene(), l = sc.links.find((q) => q.id === id);
  assert.equal(sc.links.length, before + 1);
  assert.equal(l.kind, 'mic'); assert.equal(l.name, 'Mic 5');
  assert.ok(freqs.every((f) => Math.abs(f - l.freqMHz) >= 0.2));
  assert.deepEqual(validateScene(sc).errors || [], []);
  assert.ok(store.undo()); assert.equal(store.getScene().links.length, before);
});

test('addLink works for IEM, keeps ids unique, rejects other kinds and removeLink takes it back out', () => {
  const store = createStore(people());
  const a = addLink(store, 'iem'), b = addLink(store, 'iem');
  const ids = store.getScene().links.flatMap((l) => [l.id, l.tx.id, l.rx.id]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(store.getScene().links.find((l) => l.id === b).name, 'IEM 6');
  assert.equal(addLink(store, 'p2p'), null);
  assert.ok(removeLink(store, a));
  assert.ok(!store.getScene().links.some((l) => l.id === a));
});

test('addLink on a one-link scene starts from the defaults and stops at the link limit', () => {
  const store = createStore(createDefaultScene());
  const id = addLink(store, 'iem');
  assert.ok(id); assert.equal(store.getScene().links.length, 2);
  for (let i = 0; i < 80; i++) addLink(store, 'mic');
  assert.equal(store.getScene().links.length, 64);
  assert.equal(addLink(store, 'mic'), null);
});
