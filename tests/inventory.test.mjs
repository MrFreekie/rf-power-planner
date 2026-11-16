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
