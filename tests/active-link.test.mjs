// Item 8: the results panel and the ripples follow the ACTIVE link, never links[0].
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EXAMPLES } from '../js/examples.js';
import { activeLink } from '../js/view/util.js';

test('activeLink follows the selection (second link selected gives the second link)', () => {
  const sc = EXAMPLES.find((e) => e.id === 'band-four-piece-people').build().scene;
  const l1 = sc.links[1];
  assert.equal(activeLink(sc, l1.tx.id).id, l1.id);
  assert.notEqual(activeLink(sc, l1.tx.id).id, sc.links[0].id);
});
test('renderResults and the ripples read the active link and not links[0]', () => {
  const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const rip = fs.readFileSync(new URL('../js/view/ripples.js', import.meta.url), 'utf8');
  const fn = app.slice(app.indexOf('function renderResults'), app.indexOf('function renderResults') + 600);
  assert.match(fn, /pickActiveLink\(scene, store\.getSelection\(\)\)/); assert.doesNotMatch(fn, /links\[0\]/);
  assert.doesNotMatch(rip, /links\[0\]/); assert.match(rip, /activeLink\(/);
});
test('imdTracker cache signature covers every link antenna, and plan reserves link status labels', () => {
  const t = fs.readFileSync(new URL('../js/imdTracker.js', import.meta.url), 'utf8');
  assert.doesNotMatch(t, /links\[0\]/); assert.match(t, /scene\.links \|\| \[\]\)\.map/);
  const plan = fs.readFileSync(new URL('../js/view/plan.js', import.meta.url), 'utf8');
  assert.match(plan, /linkLabelRects\.push/); assert.match(plan, /placedLabels = \[\.\.\.linkLabelRects\]/);
});
