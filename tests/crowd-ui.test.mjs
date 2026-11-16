// Crowd zones GUI: selection lookups, plan drawing and handles, polygon edit helpers, new-crowd placement, budget and path rows, extent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '../js/store.js';
import { createDefaultScene, validateScene } from '../js/model/scene.js';
import { addCrowd, updateCrowd, moveCrowd, removeCrowd } from '../js/actionsAreas.js';
import { solveLink } from '../js/model/rf.js';
import { CROWD_CAVEAT, CROWD_POINTS_MAX } from '../js/model/crowd.js';
import { findItem, selectableIds } from '../js/view/util.js';
import { planExtent } from '../js/view/planExtent.js';
import { drawCrowds, crowdTint, CROWD_STYLE } from '../js/view/crowdDraw.js';
import {
  crowdLabel, crowdShortLabel, crowdAria, newCrowdPartial, polygonAddAfter, polygonRemoveAt, polygonSetPoint, confidenceLines,
  crowdParamText, crowdBudgetRows, crowdPathRows,
} from '../js/ui/crowdUi.js';
import { budgetExtras } from '../js/ui/budgetExtras.js';
import { limitText } from '../js/ui/limitNote.js';

function fakeCtx() { const calls = []; return new Proxy({ calls }, { get(t, k) { if (k in t) return t[k]; if (k === 'measureText') return () => ({ width: 50 }); return (...a) => { calls.push([k, ...a]); }; }, set(t, k, v) { t[k] = v; return true; } }); }
const vp = { pxPerM: 40, worldToScreen: (x, y) => ({ x: 100 + x * 40, y: 100 + y * 40 }) };
const th = { ink: '#000', inkSoft: '#555', paper: '#fff', blue: '#4a78b5', inkRgb: '1,2,3', font: 'sans-serif' };

function sceneWithCrowd() {
  const store = createStore(createDefaultScene());
  const id = addCrowd(store, newCrowdPartial(store.getScene()));
  return { store, id };
}

test('crowds are findable and selectable, and the plan extent includes their corners', () => {
  const { store, id } = sceneWithCrowd(), sc = store.getScene();
  assert.equal(findItem(sc, id).type, 'crowd');
  assert.ok(selectableIds(sc).includes(id));
  const e = planExtent(sc), far = Math.max(...sc.crowds[0].polygon.map((p) => p.y));
  assert.ok(e.y1 >= far, 'extent reaches the far crowd corner');
  assert.equal(validateScene(sc).ok, true);
});

test('new crowd is placed on the audience side, each next one further back, and fits the scene limit text', () => {
  const store = createStore(createDefaultScene()), st = store.getScene().stage;
  const a = addCrowd(store, newCrowdPartial(store.getScene())), b = addCrowd(store, newCrowdPartial(store.getScene()));
  const [A, B] = store.getScene().crowds;
  assert.ok(A.polygon.every((p) => p.y > st.depth), 'in front of the stage (y beyond the front edge)');
  assert.ok(B.polygon[0].y > A.polygon[3].y, 'second zone does not overlap the first');
  assert.notEqual(a, b);
  assert.match(limitText('crowd zone'), /30 crowd zones/);
});

test('polygon helpers: add after, remove (minimum three), set point, limits', () => {
  const sq = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }];
  const add = polygonAddAfter(sq, 0);
  assert.equal(add.length, 5); assert.deepEqual(add[1], { x: 2, y: 0 });
  assert.deepEqual(polygonAddAfter(sq, 3)[4], { x: 0, y: 1 }, 'closing edge midpoint goes at the end');
  assert.equal(polygonRemoveAt(sq, 1).length, 3);
  assert.equal(polygonRemoveAt(polygonRemoveAt(sq, 1), 0), null, 'a triangle cannot lose a corner');
  assert.deepEqual(polygonSetPoint(sq, 2, { x: 9, y: 9 })[2], { x: 9, y: 9 });
  assert.equal(sq[2].x, 4, 'input untouched');
  assert.equal(polygonAddAfter(Array.from({ length: CROWD_POINTS_MAX }, (_, i) => ({ x: i, y: i % 2 })), 0), null);
});

test('vertex edit through the action keeps the polygon valid and undoes in one step per coalesce key', () => {
  const { store, id } = sceneWithCrowd(), p0 = store.getScene().crowds[0].polygon;
  updateCrowd(store, id, { polygon: polygonSetPoint(p0, 1, { x: 20, y: 12 }) }, { coalesce: 'v' });
  updateCrowd(store, id, { polygon: polygonSetPoint(p0, 1, { x: 21, y: 12 }) }, { coalesce: 'v' });
  assert.equal(store.getScene().crowds[0].polygon[1].x, 21);
  store.undo(); assert.deepEqual(store.getScene().crowds[0].polygon, p0);
});

test('body drag steps through moveCrowd and coalesce into one undo step', () => {
  const { store, id } = sceneWithCrowd(), p0 = store.getScene().crowds[0].polygon.map((p) => ({ ...p }));
  moveCrowd(store, id, 0.5, 0, { coalesce: 'd' }); moveCrowd(store, id, 0.5, 1, { coalesce: 'd' });
  assert.ok(Math.abs(store.getScene().crowds[0].polygon[0].x - (p0[0].x + 1)) < 1e-9);
  store.undo(); assert.deepEqual(store.getScene().crowds[0].polygon, p0);
  removeCrowd(store, id); assert.equal(findItem(store.getScene(), id), null);
});

test('drawCrowds draws one polygon per crowd, pushes a body handle, and corner handles only when selected', () => {
  const { store, id } = sceneWithCrowd(), sc = store.getScene();
  const h1 = [], c1 = fakeCtx();
  drawCrowds(c1, th, vp, sc, null, h1, 800);
  assert.equal(h1.filter((h) => h.kind === 'crowdBody').length, 1);
  assert.equal(h1.filter((h) => h.kind === 'crowdVertex').length, 0);
  assert.ok(c1.calls.some((c) => c[0] === 'fill'));
  const h2 = []; drawCrowds(fakeCtx(), th, vp, sc, id, h2, 800);
  assert.equal(h2.filter((h) => h.kind === 'crowdVertex').length, 4);
  assert.ok(h2.every((h) => h.itemId === id));
  assert.ok(h2.find((h) => h.kind === 'crowdBody').poly.length === 4);
  assert.deepEqual(drawCrowds(fakeCtx(), th, vp, { crowds: [{ id: 'x', polygon: [{ x: 0, y: 0 }], mode: 'seated' }] }, null, [], 800), undefined, 'degenerate polygon skipped');
});

test('mode tint uses the theme blue token with a denser tint for packed, falls back to ink', () => {
  assert.equal(crowdTint(th, 0.1), 'rgba(74,120,181,0.1)');
  assert.equal(crowdTint({ inkRgb: '1,2,3' }, 0.2), 'rgba(1,2,3,0.2)');
  assert.ok(CROWD_STYLE.seated.alpha < CROWD_STYLE.standing.alpha && CROWD_STYLE.standing.alpha < CROWD_STYLE.packed.alpha);
  assert.ok(CROWD_STYLE.packed.dot < CROWD_STYLE.seated.dot);
});

test('labels and aria text name the mode and mark the cap as assumed', () => {
  const c = { id: 'a', name: 'Pit', mode: 'packed', polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] };
  assert.match(crowdLabel(c), /Pit: packed, loss cap 22 dB \(assumed\)/);
  assert.equal(crowdShortLabel({ ...c, lMaxDb: 12 }), 'packed, cap 12 dB');
  assert.match(crowdAria(c), /packed crowd zone, 3 corners, about 50 square metres, assumed loss cap 22 dB/);
  assert.match(crowdParamText(c), /4\.00 dB per metre.*22\.0 dB.*assumed/);
});

test('confidence list carries S, I and A flags in words; caveat is the model text', () => {
  const lines = confidenceLines();
  assert.ok(lines.some((l) => l.startsWith('S (sourced)')) && lines.some((l) => l.startsWith('I (inferred)')) && lines.some((l) => l.startsWith('A (assumed)')));
  assert.ok(CROWD_CAVEAT.length > 50);
});

test('link breakdown: crowd rows appear when the path crosses a crowd, and only then', () => {
  const store = createStore(createDefaultScene()), sc0 = store.getScene(), l = sc0.links[0];
  assert.deepEqual(crowdBudgetRows(solveLink(sc0, l)), []);
  assert.deepEqual(crowdPathRows(solveLink(sc0, l), null), []);
  const tx = l.tx.pos, rx = l.rx.pos, mx = (tx.x + rx.x) / 2, my = (tx.y + rx.y) / 2;
  addCrowd(store, { polygon: [{ x: mx - 2, y: my - 2 }, { x: mx + 2, y: my - 2 }, { x: mx + 2, y: my + 2 }, { x: mx - 2, y: my + 2 }], mode: 'packed', headHeightM: 2.5 });
  const sc = store.getScene(), r = solveLink(sc, sc.links[0]);
  assert.ok(r.crowd, 'the default link crosses the zone');
  const rows = crowdBudgetRows(r);
  assert.match(rows[0].label, /assumed/i); assert.match(rows[0].value, /dB/);
  assert.ok(rows.length >= 2);
  assert.ok(budgetExtras(r, null, rows).some((x) => /Crowd absorption/.test(x.label)));
  const pr = crowdPathRows(r, (m) => `${m.toFixed(1)} m`);
  assert.match(pr[0].kind, /\(assumed\)/); assert.match(pr[0].relDb, /^-\d/);
});

test('wiring: inspector section, plan draw call, app rows, palette entry, help and css gutters exist', () => {
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const insp = read('js/ui/inspector.js'), plan = read('js/view/plan.js'), app = read('js/app.js'), help = read('js/ui/help.js'), css = read('css/style.css');
  assert.match(insp, /crowd: 'crowd'/); assert.match(insp, /Delete crowd zone/); assert.match(insp, /CROWD_CAVEAT/); assert.match(insp, /confidenceLines/);
  assert.match(plan, /drawCrowds\(/); assert.match(plan, /crowdVertex/); assert.match(plan, /moveCrowd\(/);
  assert.match(app, /crowdBudgetRows/); assert.match(app, /cmd:add-crowd/);
  assert.match(help, /crowd zone/i);
  assert.match(css, /max-width: 480px\) \{ \.insp-body \{ padding-left: 16px; padding-right: 16px; \}/);
});
