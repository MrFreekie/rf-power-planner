// The paths table lives in the left budget panel, not in the inspector.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathRows } from '../js/ui/fields.js';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('paths table: in #leftpanel-body after the power budget, collapsible, gone from the inspector', () => {
  const html = read('index.html');
  const left = html.indexOf('id="leftpanel-body"'), right = html.indexOf('id="sidebar-body"'), at = html.indexOf('id="paths-panel"');
  assert.ok(left > 0 && at > left && at < right, 'paths-panel sits inside the left panel');
  assert.ok(html.indexOf('id="waterfall"') < at, 'under the power budget');
  assert.match(html, /<details id="paths-panel"[^>]*>\s*<summary id="paths-summary">/);
  assert.ok(!read('js/ui/inspector.js').includes("'paths-table'"), 'inspector no longer builds the table');
  assert.ok(read('js/app.js').includes('renderPaths(r, scene)'), 'app renders the rows');
});

test('paths rows: readable names for ceiling, panel and floor + ceiling, units follow the scene', () => {
  const r = { paths: [{ kind: 'direct', lengthM: 10, delayNs: 33.4, relDb: 0 }, { kind: 'ceiling', lengthM: 12, delayNs: 40, relDb: -7.2 }, { kind: 'panel', lengthM: 12, delayNs: 40, relDb: -9 }, { kind: 'floor-ceiling', lengthM: 14, delayNs: 46, relDb: -11 }] };
  const m = pathRows(r, {}, 'm'), ft = pathRows(r, {}, 'ft');
  assert.deepEqual(m.map((x) => x.kind), ['direct', 'ceiling', 'overhead panel', 'floor + ceiling']);
  assert.notEqual(m[0].length, ft[0].length);
  assert.equal(m[1].relDb, '-7.2');
});
