import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene, validateScene } from '../js/model/scene.js';
import * as A from '../js/actions.js';
import { inventoryRows, inventoryTotals, linkCard } from '../js/model/inventory.js';
import { inventoryView } from '../js/ui/inventoryUi.js';
import { transmittersFromScene } from '../js/model/coordination.js';
import { linkChoices, extraChoices } from '../js/ui/peopleUi.js';
import { buildReportData } from '../js/reportData.js';

function setup() {
  const store = createStore(createDefaultScene());
  const first = store.getScene().links[0].id;
  const xid = A.addReceiverFor(store, first);
  assert.ok(xid);
  return { store, first, xid };
}

test('inventory: an extra receiver is a receiver, not a second mic or transmitter', () => {
  const { store, first, xid } = setup(), sc = store.getScene();
  const base = createDefaultScene(), t0 = inventoryTotals(inventoryRows(base), base);
  const rows = inventoryRows(sc), t = inventoryTotals(rows, sc);
  assert.equal(t.mics, t0.mics);
  assert.equal(t.extraReceivers, 1);
  assert.equal(t.transmitters.reduce((a, x) => a + x.count, 0), t0.transmitters.reduce((a, x) => a + x.count, 0));
  assert.equal(t.receivers.reduce((a, x) => a + x.count, 0), t0.receivers.reduce((a, x) => a + x.count, 0) + 1);
  const r = rows.find((x) => x.id === xid);
  assert.equal(r.extraRx, true); assert.equal(r.listensTo, sc.links.find((l) => l.id === first).name);
  assert.match(linkCard(sc, xid).lines[0], /Extra receiver for/);
  assert.match(inventoryView(sc, null).summary, /1 extra receiver/);
});

test('coordination ignores an extra receiver', () => {
  const { store } = setup(), sc = store.getScene();
  assert.equal(transmittersFromScene(sc).length, sc.links.length - 1);
});

test('an extra receiver cannot be carried by a person and is not offered', () => {
  const { store, xid } = setup();
  A.addPerson(store);
  const sc = store.getScene(), p = sc.people[0];
  assert.ok(p);
  assert.equal(A.assignMic(store, p.id, xid), false);
  assert.equal(A.assignExtraMic(store, p.id, xid), false);
  assert.ok(!linkChoices(sc, p, 'mic').some((o) => o.value === xid));
  assert.ok(!extraChoices(sc, p).some((o) => o.value === xid));
  const bad = structuredClone(sc);
  bad.people[0].micLinkId = xid;
  assert.ok(validateScene(bad).errors.some((e) => /extra receiver/.test(e)));
});

test('report names the mic an extra receiver listens to; removing the primary frees the extra', () => {
  const { store, first, xid } = setup();
  const rd = buildReportData(store.getScene(), xid);
  assert.ok(rd.scenario.some((s) => s.label === 'Extra receiver for'));
  A.removeLink(store, first);
  const x = store.getScene().links.find((l) => l.id === xid);
  assert.ok(x && x.txOf === undefined);
});
