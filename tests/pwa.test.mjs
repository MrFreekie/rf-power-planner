import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { stampSw } from '../scripts/stamp-sw.mjs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const manifest = JSON.parse(read('manifest.webmanifest'));

test('manifest has the fields Chrome needs to offer install', () => {
  assert.ok(manifest.name && manifest.short_name);
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
});
test('manifest icons: 192, 512 and a maskable one, all present and relative', () => {
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  for (const i of manifest.icons) {
    assert.ok(!i.src.startsWith('/') && !/^https?:/.test(i.src), 'relative: ' + i.src);
    assert.ok(existsSync(new URL(i.src, root)), 'exists: ' + i.src);
    const b = readFileSync(new URL(i.src, root));
    assert.equal(b.readUInt32BE(16), Number(i.sizes.split('x')[0]), 'PNG width matches ' + i.src);
  }
});
test('index.html links the manifest, theme colour and apple-touch-icon with relative URLs', () => {
  const h = read('index.html');
  assert.match(h, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(h, /<meta name="theme-color" content="#[0-9a-f]{6}">/i);
  const m = h.match(/rel="apple-touch-icon" href="([^"]+)"/);
  assert.ok(m && existsSync(new URL(m[1], root)));
  assert.match(h, /manifest-src 'self'/);
  assert.match(h, /connect-src 'self'/, 'the update check fetches js/build-info.js from the same origin');
});
test('service worker uses relative URLs and a build-tied cache name', () => {
  const sw = read('sw.js');
  assert.match(sw, /'rf-bench-' \+ \(BUILD \|\| 'dev'\)/);
  assert.ok(!/['"]\/[a-z]/i.test(sw.replace(/\/\/.*$/gm, '')), 'no root-absolute URLs');
  const stamped = stampSw(sw, '20261118-abc1234', ['./', 'index.html']);
  assert.match(stamped, /const BUILD = "20261118-abc1234";/);
  assert.match(stamped, /const FILES = \["\.\/","index\.html"\];/);
});
test('service worker leaves query-string requests (update polling) to the network', () => {
  assert.match(read('sw.js'), /url\.search && req\.mode !== 'navigate'/);
});
test('app registers the worker behind feature and secure-context checks', () => {
  const a = read('js/app.js');
  assert.match(a, /'serviceWorker' in navigator/);
  assert.match(a, /register\('sw\.js'\)/);
});
test('Pages workflow ships the PWA files and stamps the worker', () => {
  const wf = read('.github/workflows/pages.yml');
  assert.match(wf, /manifest\.webmanifest/);
  assert.match(wf, /cp -r icons/);
  assert.match(wf, /stamp-sw\.mjs/);
});
