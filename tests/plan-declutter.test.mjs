import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRefit, placeLabel, rectsOverlap } from '../js/view/viewport.js';
import { inventoryRows, inventoryTotals, linkCard } from '../js/model/inventory.js';
import { buildExample } from '../js/examples.js';

test('shouldRefit: a loaded scene always refits, a stage change only while the view is untouched', () => {
  assert.equal(shouldRefit({ loaded: true, userView: true }), true);
  assert.equal(shouldRefit({ stageChanged: true, userView: false }), true);
  assert.equal(shouldRefit({ stageChanged: true, userView: true }), false);
  assert.equal(shouldRefit({ p2pChanged: true, userView: true }), true);
  assert.equal(shouldRefit({ userView: false }), false);
  assert.equal(shouldRefit(), false);
});

test('placeLabel nudges a colliding label and gives up when every spot is taken', () => {
  const rects = [{ x: 0, y: 0, w: 100, h: 14 }];
  assert.equal(rectsOverlap(rects[0], { x: 50, y: 10, w: 20, h: 14 }), true);
  const r = placeLabel(rects, { x: 10, y: 2, w: 60, h: 14 });
  assert.ok(r && r.y !== 2 && !rectsOverlap(r, rects[0]));
  assert.equal(rects.length, 2);
  const tight = [{ x: 0, y: -100, w: 100, h: 300 }];
  assert.equal(placeLabel(tight, { x: 10, y: 2, w: 60, h: 14 }), null);
  assert.equal(tight.length, 1);
});

test('extra receiver rows say whom they listen to and totals ignore their transmitter columns', () => {
  const base = buildExample('band-four-piece-people').scene;
  const before = inventoryTotals(inventoryRows(base), base);
  const sc = structuredClone(base);
  const src = sc.links.find((l) => l.kind === 'mic'), extra = structuredClone(src);
  extra.id = 'extra-1'; extra.name = 'Extra rx'; extra.txOf = src.id; sc.links.push(extra);
  const rows = inventoryRows(sc), row = rows.find((r) => r.id === 'extra-1');
  assert.equal(row.extraRx, true);
  assert.equal(row.txItem, `Listens to ${src.name || src.id}`);
  assert.equal(row.txPowerMw, null); assert.equal(row.txAntenna, null);
  const tot = inventoryTotals(rows, sc);
  assert.equal(tot.extraReceivers, 1);
  assert.deepEqual(tot.transmitters, before.transmitters);
  assert.ok(!linkCard(sc, 'extra-1').lines.some((l) => l.startsWith('Transmitter:')));
});
