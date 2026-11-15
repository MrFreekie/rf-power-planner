// People GUI: selection lookups, dropdown choices with swap flags, group outline, both margins, plan and side drawing, pack-offset sync.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../js/examples.js';
import { findItem, selectableIds, activeLink } from '../js/view/util.js';
import { personOfLink, linkChoices, groupPoints, groupCircle, personMargins, peopleBudgetRows } from '../js/ui/peopleUi.js';
import { drawPeoplePlan, drawPersonSide, roleMark } from '../js/view/peopleDraw.js';
import { budgetExtras } from '../js/ui/budgetExtras.js';
import { solveLink } from '../js/model/rf.js';
import { createStore } from '../js/store.js';
import { movePerson, assignMic } from '../js/actions.js';

const scene = () => EXAMPLES.find((e) => e.id === 'band-four-piece-people').build().scene;
function fakeCtx() { const calls = []; return new Proxy({ calls }, { get(t, k) { if (k in t) return t[k]; if (k === 'measureText') return () => ({ width: 50 }); return (...a) => { calls.push([k, ...a]); }; }, set(t, k, v) { t[k] = v; return true; } }); }
const vp = { pxPerM: 40, worldToScreen: (x, y) => (typeof x === 'object' ? { x: 200 + x.x * 40, y: 200 - x.y * 40 } : { x: 200 + x * 40, y: 200 - y * 40 }) };
const th = { ink: '#000', inkSoft: '#555', paper: '#fff', font: 'sans-serif' };

test('people are selectable and the active link follows the person', () => {
  const sc = scene(), p = sc.people[0];
  assert.equal(findItem(sc, p.id).type, 'person');
  assert.ok(selectableIds(sc).includes(p.id));
  assert.equal(activeLink(sc, p.id).id, p.micLinkId || p.iemLinkId);
});

test('link choices offer free links plainly and other people\'s links flagged for swap', () => {
  const sc = scene(), [a, b] = sc.people;
  const ch = linkChoices(sc, a, 'mic');
  assert.equal(ch[0].value, '');
  assert.ok(ch.find((x) => x.value === a.micLinkId && !x.swap));
  const theirs = ch.find((x) => x.value === b.micLinkId);
  assert.ok(theirs && theirs.swap && /swap/.test(theirs.label));
  assert.ok(ch.every((x) => x.value === '' || sc.links.find((l) => l.id === x.value).kind === 'mic'), 'only mic links in the mic list');
  assert.ok(linkChoices(sc, a, 'iem').every((x) => x.value === '' || sc.links.find((l) => l.id === x.value).kind === 'iem'));
});

test('group points and circle enclose the packs; both margins appear side by side with words', () => {
  const sc = scene(), p = sc.people[0], pts = groupPoints(sc, p);
  assert.equal(pts[0].what, 'person'); assert.ok(pts.length >= 2);
  const c = groupCircle(pts);
  for (const q of pts) assert.ok(Math.hypot(q.x - c.x, q.y - c.y) <= c.r + 1e-9);
  const m = personMargins(sc, p, (l) => solveLink(sc, l));
  assert.equal(m.length, 2); assert.ok(m.every((r) => /dB (PASS|MARGINAL|FAIL)/.test(r.text)));
  const rows = peopleBudgetRows(sc, sc.links.find((l) => l.id === p.micLinkId), (l) => solveLink(sc, l));
  assert.equal(rows.length, 1); assert.match(rows[0].value, /Mic .* \| {2}IEM /);
  assert.equal(peopleBudgetRows(sc, { id: 'nope' }, () => null).length, 0);
  assert.ok(budgetExtras(solveLink(sc, sc.links[0]), null, rows).some((x) => x.label === p.name));
});

test('plan and side drawing run for every person and push one grip handle each', () => {
  const sc = scene(), handles = [], g = fakeCtx();
  const rects = drawPeoplePlan(g, th, vp, sc, sc.people[1].id, handles, null, 800);
  assert.equal(handles.filter((h) => h.kind === 'person').length, sc.people.length);
  assert.equal(rects.length, sc.people.length);
  assert.equal(g.calls.filter((c) => c[0] === 'save').length, g.calls.filter((c) => c[0] === 'restore').length);
  const l = sc.links.find((q) => q.id === sc.people[0].micLinkId);
  assert.ok(drawPersonSide(fakeCtx(), th, sc, l, 'tx', 100, 300, 180));
  assert.equal(drawPersonSide(fakeCtx(), th, sc, l, 'rx', 100, 300, 180), null, 'the receiver of a mic link carries no person');
  assert.equal(roleMark('crew'), 'C');
});

test('a group move keeps offsets; reassigning updates names', () => {
  const store = createStore(scene()), sc0 = store.getScene(), p = sc0.people[0], l0 = sc0.links.find((l) => l.id === p.micLinkId);
  movePerson(store, p.id, { x: p.pos.x + 1, y: p.pos.y + 0.5 });
  const l1 = store.getScene().links.find((l) => l.id === p.micLinkId);
  assert.ok(Math.abs(l1.tx.pos.x - l0.tx.pos.x - 1) < 1e-9 && Math.abs(l1.tx.pos.y - l0.tx.pos.y - 0.5) < 1e-9);
  const other = sc0.people[1];
  assert.equal(assignMic(store, p.id, other.micLinkId), false, 'a carried link needs swap');
  assert.equal(assignMic(store, p.id, other.micLinkId, { swap: true }), true);
  assert.equal(personOfLink(store.getScene(), other.micLinkId).person.id, p.id);
});
