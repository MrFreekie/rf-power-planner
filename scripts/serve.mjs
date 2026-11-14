// Tiny static file server for local development: node scripts/serve.mjs [port]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] || 8080);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

// Never served, even locally: dot-folders and dot-files (.git, .claude), private notes and private test data.
const DENIED = ['docs/lessons', 'docs/research', 'docs/agents', 'docs/contract.md', 'tests/private-venues', 'claude.md', 'claude.local.md'];
export function isDenied(rel) {
  const p = rel.split(sep).filter(Boolean).join('/').toLowerCase();
  if (p.split('/').some((seg) => seg.startsWith('.'))) return true;
  return DENIED.some((d) => p === d || p.startsWith(d + '/'));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(root, normalize(p));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end('Forbidden'); return; }
    if (isDenied(file.slice(root.length))) { res.writeHead(404).end('Not found'); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
});
if (isMain) server.listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}/`)); // loopback only, never the LAN
