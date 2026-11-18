import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExample } from '../js/examples.js';
import * as A from '../js/actions.js';
import { createStore } from '../js/store.js';
import { collapsedPeople } from '../js/view/peopleDraw.js';
import { groupPoints } from '../js/ui/peopleUi.js';

const mk = () => createStore(buildExample('band-four-piece-people').scene);
const ben = (s) => s.getScene().people.find((p) => p.name === 'Ben');

test('every person who carries a pack is drawn as one bundled icon', () => {
  const s = mk(), col = collapsedPeople(s.getScene(), null);
  for (const p of s.getScene().people) assert.ok(col.has(p.id), p.name);
});

test('selecting the person or one of their packs shows the packs individually', () => {
  const s = mk(), sc = s.getScene(), b = ben(s);
  assert.ok(!collapsedPeople(sc, b.id).has(b.id));
  const mic = sc.links.find((l) => l.id === b.micLinkId);
  assert.ok(!collapsedPeople(sc, mic.tx.id).has(b.id));
  assert.ok(collapsedPeople(sc, null).has(b.id));
});

test('a person with no packs is not bundled', () => {
  const s = mk(); A.addPerson(s, { name: 'Guest', pos: { x: 3, y: 3 } });
  const g = s.getScene().people.find((p) => p.name === 'Guest');
  assert.ok(!collapsedPeople(s.getScene(), null).has(g.id));
});

test('extra packs fan out sideways instead of sitting on the first pack', () => {
  const s = mk(); A.addLink(s, 'mic'); A.addLink(s, 'iem'); A.addLink(s, 'iem');
  const sc = s.getScene(), free = sc.links.filter((l) => !sc.people.some((p) => p.micLinkId === l.id || p.iemLinkId === l.id));
  for (const l of free) assert.ok(A.assignExtraMic(s, ben(s).id, l.id));
  const pts = groupPoints(s.getScene(), ben(s)).filter((q) => q.what !== 'person');
  assert.equal(pts.length, 2 + free.length);
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) > 0.08, `pack ${i} and ${j} overlap`);
  const b0 = ben(s), before = groupPoints(s.getScene(), b0).map((q) => [q.x - b0.pos.x, q.y - b0.pos.y]);
  A.movePerson(s, b0.id, { x: b0.pos.x + 3, y: b0.pos.y - 2 });
  const b1 = ben(s), after = groupPoints(s.getScene(), b1).map((q) => [q.x - b1.pos.x, q.y - b1.pos.y]);
  before.forEach((o, i) => { assert.ok(Math.abs(o[0] - after[i][0]) < 1e-9 && Math.abs(o[1] - after[i][1]) < 1e-9); });
});
