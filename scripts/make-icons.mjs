// Writes the app icons (PNG) into icons/ from the header logo, with no dependencies.
// Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const BG = [0x17, 0x36, 0x5d], FG = [0x8f, 0xd0, 0xff];

// The logo is drawn in a 32 x 32 box (see the brandbar in index.html).
const quad = (p0, c, p1, n = 24) => Array.from({ length: n + 1 }, (_, i) => {
  const t = i / n, u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]];
});
const wave = [
  ...quad([3, 18], [7.5, 6], [12, 18]), ...quad([12, 18], [16.5, 30], [21, 18]), ...quad([21, 18], [25.5, 6], [29, 18]),
];
const line = [[6, 26], [26, 26]];

function distSeg(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}
const distPoly = (px, py, pts) => { let d = Infinity; for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, distSeg(px, py, pts[i], pts[i + 1])); return d; };
// Distance to the outline of the rounded rect (x 1..31, corner radius 5).
function distFrame(px, py) {
  const cx = Math.min(Math.max(px, 6), 26), cy = Math.min(Math.max(py, 6), 26);
  if ((px < 6 || px > 26) && (py < 6 || py > 26)) return Math.abs(Math.hypot(px - cx, py - cy) - 5);
  return Math.min(Math.abs(px - 1), Math.abs(px - 31), Math.abs(py - 1), Math.abs(py - 31));
}
const inkAt = (x, y, frame) => (frame && distFrame(x, y) <= 0.8) || distPoly(x, y, wave) <= 1.1 || distPoly(x, y, line) <= 1.1;

// scale: logo size as a fraction of the icon. A maskable icon fills the whole square and keeps the logo in the safe zone.
function render(size, scale, maskable) {
  const px = Buffer.alloc(size * size * 4), SS = 3;
  const box = size * scale, off = (size - box) / 2, k = 32 / box;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let ink = 0, bg = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const X = x + (sx + 0.5) / SS, Y = y + (sy + 0.5) / SS;
      if (inkAt((X - off) * k, (Y - off) * k, !maskable)) ink++;
      const r = size * 0.18, ccx = Math.min(Math.max(X, r), size - r), ccy = Math.min(Math.max(Y, r), size - r);
      if (maskable || Math.hypot(X - ccx, Y - ccy) <= r) bg++;
    }
    const n = SS * SS, i = (y * size + x) * 4, f = ink / n;
    px[i] = Math.round(BG[0] * (1 - f) + FG[0] * f); px[i + 1] = Math.round(BG[1] * (1 - f) + FG[1] * f);
    px[i + 2] = Math.round(BG[2] * (1 - f) + FG[2] * f); px[i + 3] = Math.round(255 * bg / n);
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
export function png(size, pixels) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export const ICONS = [
  ['icon-192.png', 192, 0.8, false], ['icon-512.png', 512, 0.8, false],
  ['icon-maskable-512.png', 512, 0.6, true], ['apple-touch-icon.png', 180, 0.8, true],
];
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dir = fileURLToPath(new URL('../icons/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  for (const [name, size, scale, maskable] of ICONS) { writeFileSync(dir + name, png(size, render(size, scale, maskable))); console.log('wrote icons/' + name); }
}
