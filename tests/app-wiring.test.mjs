// Static checks on the app shell: no DOM needed. They catch the failures a browser would only show on load
// (a missing element id, a missing module, an import cycle, a stale name, a root-absolute URL).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('index.html');
const app = read('js/app.js');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const p = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const jsFiles = walk('js').filter((f) => f.endsWith('.js'));

test('every element id that app.js looks up exists in index.html', () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const used = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
  const missing = [...used].filter((id) => !ids.has(id));
  assert.deepEqual(missing, []);
});

test('index.html: local assets exist and URLs are relative (GitHub Pages sub-path)', () => {
  const refs = [...html.matchAll(/(?:href|src)="([^"#]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 0);
  for (const r of refs) {
    if (/^data:/.test(r)) continue;
    assert.ok(!r.startsWith('/') && !/^https?:/.test(r), `non-relative reference ${r}`);
    assert.ok(fs.existsSync(path.join(root, r)), `missing file ${r}`);
  }
});

test('optional panels named in app.js exist and export their mount function', async () => {
  const list = [...app.matchAll(/\['(\.\/[^']+\.js)', '(mount\w+)', '(\w+)'\]/g)];
  assert.ok(list.length >= 8, 'panel list not found');
  for (const [, p, fn, id] of list) {
    assert.ok(fs.existsSync(path.join(root, 'js', p.slice(2))), `missing module ${p}`);
    assert.match(read('js/' + p.slice(2)), new RegExp(`export (?:async )?function ${fn}\\b`), `${p} does not export ${fn}`);
    assert.ok(html.includes(`id="${id}"`), `index.html has no #${id}`);
  }
});

test('every relative import resolves, and the js/ import graph has no cycles', () => {
  const graph = new Map();
  for (const f of jsFiles) {
    const deps = [...read(f).matchAll(/(?:from|import\()\s*['"](\.[^'"]+)['"]/g)].map((m) => path.posix.join(path.posix.dirname(f), m[1]));
    for (const d of deps) assert.ok(fs.existsSync(path.join(root, d)), `${f} imports missing ${d}`);
    graph.set(f, deps);
  }
  const state = new Map();
  const visit = (n, stack) => {
    if (state.get(n) === 2) return;
    assert.notEqual(state.get(n), 1, `import cycle: ${[...stack, n].join(' > ')}`);
    state.set(n, 1);
    for (const d of graph.get(n) || []) visit(d, [...stack, n]);
    state.set(n, 2);
  };
  for (const f of graph.keys()) visit(f, []);
});

test('js/model stays pure: no DOM or storage access', () => {
  for (const f of jsFiles.filter((x) => x.startsWith('js/model/'))) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g, '""');
    assert.ok(!/\b(document|localStorage|sessionStorage|navigator|requestAnimationFrame)\b|\bwindow\s*\./.test(code), `${f} touches the DOM`);
  }
});

test('the app is called RF Bench in public files', () => {
  const files = ['README.md', 'index.html', 'package.json', ...walk('css'), ...jsFiles, ...walk('docs').filter((f) => /^docs\/[^/]+\.md$/.test(f))]
    .filter((f) => !/^docs\/(CONTRACT|CLAUDE)/.test(f));
  for (const f of files) assert.ok(!/RF Power Planner/i.test(read(f)), `${f} still says RF Power Planner`);
});

test('README documents the licence, copyright holder and the test command', () => {
  const readme = read('README.md');
  assert.match(readme, /PolyForm Noncommercial License 1\.0\.0/);
  assert.match(readme, /Mark Hughes/);
  assert.match(readme, /node --test tests\//);
  assert.match(read('LICENSE'), /Copyright \(c\) 2026 Mark Hughes/);
});

test('package.json declares ES modules and the test script', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts.test, 'node --test tests/');
  assert.deepEqual(pkg.dependencies || {}, {});
});

test('the Pages workflow publishes only an allowlist and runs the tests first', () => {
  const wf = read('.github/workflows/pages.yml');
  assert.match(wf, /node --test tests\//);
  assert.match(wf, /needs: test/);
  assert.ok(!/cp -r \.\s/.test(wf), 'must not copy the whole repo');
});
