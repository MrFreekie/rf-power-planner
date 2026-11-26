// Stamps sw.js in a built site folder with the build id and the list of files to precache.
// Run: node scripts/stamp-sw.mjs <site-dir> <build-id>
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export function listFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, base));
    else out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}
export function stampSw(source, buildId, files) {
  const id = String(buildId).replace(/[^0-9A-Za-z._-]/g, '');
  return source.replace('const BUILD = null;', `const BUILD = ${JSON.stringify(id)};`)
    .replace('const FILES = null;', `const FILES = ${JSON.stringify(files)};`);
}
if (process.argv[1] && process.argv[1].endsWith('stamp-sw.mjs')) {
  const [dir, id] = process.argv.slice(2);
  if (!dir || !id) { console.error('usage: node scripts/stamp-sw.mjs <site-dir> <build-id>'); process.exit(1); }
  const skip = new Set(['sw.js', '.nojekyll']);
  const files = ['./', ...listFiles(dir).filter((f) => !skip.has(f))];
  writeFileSync(join(dir, 'sw.js'), stampSw(readFileSync(join(dir, 'sw.js'), 'utf8'), id, files));
  console.log(`sw.js stamped: ${files.length} files, build ${id}`);
}
