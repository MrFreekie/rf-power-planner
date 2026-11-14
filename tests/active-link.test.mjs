// The link budget readout follows the selected link, not the first link (NEXT-QUEUE item 8).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDefaultScene, createDefaultLink } from '../js/model/scene.js';
import { activeLink } from '../js/view/util.js';

test('activeLink: the selection picks its link, no selection falls back to the first', () => {
  const sc = createDefaultScene(), l2 = createDefaultLink(); l2.id = 'link-2'; l2.tx = { ...l2.tx, id: 'tx-2' }; l2.rx = { ...l2.rx, id: 'rx-2' };
  sc.links = [sc.links[0], l2];
  assert.equal(activeLink(sc, null).id, sc.links[0].id);
  assert.equal(activeLink(sc, 'rx-2').id, 'link-2');
  assert.equal(activeLink(sc, 'tx-2').id, 'link-2');
  assert.equal(activeLink(sc, sc.links[0].tx.id).id, sc.links[0].id);
});

test('app.js: renderResults and the paths table solve the active link, never links[0]', () => {
  const src = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function renderResults'), src.indexOf('function render(scene)'));
  assert.match(body, /pickActiveLink\(scene, store\.getSelection\(\)\)/);
  assert.match(body, /solveLink\(scene, link\)/);
  assert.ok(!/links\[0\]/.test(body));
  assert.ok(/store\.subscribe[\s\S]{0,200}info\.type === 'selection'\) \{ render\(scene\)/.test(src), 'a selection change re-renders the readout');
});
