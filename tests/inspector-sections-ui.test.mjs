import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LINK_DOCK_SECTIONS, VENUE_DOCK_SECTIONS } from '../js/ui/linkDock.js';
import { findItem, activeLink, selectableIds } from '../js/view/util.js';
import { createDefaultScene } from '../js/model/scene.js';
import { EXAMPLES, buildExample } from '../js/examples.js';

const src = fs.readFileSync(new URL('../js/ui/inspector.js', import.meta.url), 'utf8');
const built = new Set([...src.matchAll(/\bsection\('([A-Za-z0-9]+)'/g)].map((m) => m[1]));
const secsLine = src.split('\n').find((l) => /^\s*const secs = \[/.test(l));
const imdLine = src.split('\n').find((l) => l.includes("secs.unshift('"));

test('every section the inspector lists is one it builds', () => {
  assert.ok(secsLine, 'the section order list is still in build()');
  const listed = [...secsLine.matchAll(/'([A-Za-z0-9]+)'/g)].map((m) => m[1]);
  if (imdLine) listed.push(...[...imdLine.matchAll(/secs\.unshift\('([A-Za-z0-9]+)'\)/g)].map((m) => m[1]));
  assert.ok(listed.length >= 10);
  for (const n of listed) assert.ok(built.has(n), `section "${n}" is listed but never built`);
});

test('a listed section with no built form is skipped instead of throwing', () => {
  const line = src.split('\n').find((l) => l.includes('container.append(...secs.filter('));
  assert.ok(line, 'the undocked sections are still appended from the list');
  assert.match(line, /secs\.filter\(\(n\) => refs\[n\] &&/);
});

test('every section handed to a panel is one the inspector builds', () => {
  for (const n of [...LINK_DOCK_SECTIONS, ...VENUE_DOCK_SECTIONS]) assert.ok(built.has(n), `docked section "${n}" is never built`);
});

test('any selection, known or not, still gives the inspector a link to build for', () => {
  const scenes = [createDefaultScene(), { ...createDefaultScene(), links: [] }];
  for (const e of EXAMPLES) { const b = buildExample(e.id); scenes.push(b && b.scene ? b.scene : b); }
  for (const scene of scenes) {
    const rack = scene.rack || {};
    const rackIds = Object.values(rack).flatMap((v) => (Array.isArray(v) ? v.map((x) => x.id) : []));
    for (const id of [null, 'no-such-id', ...selectableIds(scene), ...(scene.links || []).map((l) => l.id), ...rackIds]) {
      const link = activeLink(scene, id);
      assert.ok(link && link.tx && link.rx && Array.isArray(link.chain), `no link for selection ${id}`);
      const f = findItem(scene, id);
      assert.ok(f === null || (f.item && typeof f.type === 'string'));
    }
  }
});
