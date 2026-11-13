// Share links: the scene (and nothing else) is packed into the URL hash as  #s=<token>.
//   token = 'z' + base64url(deflate-raw(json))   when CompressionStream is available
//         = 'j' + base64url(json)                otherwise (larger, but readable anywhere)
// Decoding understands both, uses DecompressionStream when present and a small pure-JS inflate otherwise.
// Nothing from the hash is ever executed: it is parsed as JSON (prototype-pollution keys removed), migrated and validated
// like a loaded file before it can replace the scene, and the caller asks the user first.
//   encodeScene(scene) -> Promise<string>           throws ShareError('too-large') above SIZE_MAX
//   decodeScene(token) -> Promise<{ ok, scene?, error? }>   never throws
//   buildShareLink(scene, baseUrl) -> Promise<{ url, size, warn }>
//   parseHash(hash) -> { kind:'scene', token } | { kind:'example', id } | null
import { migrateScene, validateScene } from './model/scene.js';

export const SIZE_WARN = 6 * 1024; // characters of token: long links still work, but may not survive chat apps
export const SIZE_MAX = 60 * 1024;
export const MAX_JSON_BYTES = 1024 * 1024; // decompressed limit (guards against zip bombs)

export class ShareError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ---- base64url -------------------------------------------------------------------------------------------------

export function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlToBytes(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*$/.test(str) || str.length % 4 === 1) throw new ShareError('bad-encoding', 'The link is damaged (not valid base64url)');
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- stream helpers --------------------------------------------------------------------------------------------

async function pipeThrough(bytes, stream, limit = Infinity) {
  const writer = stream.writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { try { await reader.cancel(); } catch { /* ignore */ } throw new ShareError('too-large', 'The shared data is too large'); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const hasCompression = () => typeof CompressionStream === 'function';
const hasDecompression = () => typeof DecompressionStream === 'function';

// ---- pure-JS inflate (RFC 1951) -- used only when DecompressionStream is missing ------------------------------------

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function buildHuffman(lengths) {
  const count = new Uint16Array(16);
  for (const l of lengths) count[l]++;
  count[0] = 0;
  const offs = new Uint16Array(16);
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
  const symbols = new Uint16Array(lengths.length);
  lengths.forEach((l, s) => { if (l) symbols[offs[l]++] = s; });
  return { count, symbols };
}

let FIXED = null;
function fixedTables() {
  if (!FIXED) {
    const l = new Uint8Array(288);
    for (let i = 0; i < 144; i++) l[i] = 8;
    for (let i = 144; i < 256; i++) l[i] = 9;
    for (let i = 256; i < 280; i++) l[i] = 7;
    for (let i = 280; i < 288; i++) l[i] = 8;
    FIXED = { lit: buildHuffman(l), dist: buildHuffman(new Uint8Array(30).fill(5)) };
  }
  return FIXED;
}

/** Inflate raw deflate data. Throws ShareError on corrupt data or when the output would exceed `limit` bytes. */
export function inflateRaw(src, limit = MAX_JSON_BYTES) {
  let pos = 0, bitBuf = 0, bitCnt = 0;
  const out = [];
  let outLen = 0;
  const bad = () => new ShareError('corrupt', 'The link is damaged (cannot decompress)');
  const bits = (n) => {
    while (bitCnt < n) {
      if (pos >= src.length) throw bad();
      bitBuf |= src[pos++] << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  };
  const decode = (h) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const c = h.count[len];
      if (code - c < first) return h.symbols[index + (code - first)];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    throw bad();
  };
  const emit = (b) => { out.push(b); if (++outLen > limit) throw new ShareError('too-large', 'The shared data is too large'); };
  let last = 0;
  while (!last) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0;
      if (pos + 4 > src.length) throw bad();
      const len = src[pos] | (src[pos + 1] << 8);
      if (((src[pos + 2] | (src[pos + 3] << 8)) ^ 0xffff) !== len) throw bad();
      pos += 4;
      if (pos + len > src.length) throw bad();
      for (let i = 0; i < len; i++) emit(src[pos++]);
    } else if (type === 1 || type === 2) {
      let t;
      if (type === 1) t = fixedTables();
      else {
        const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
        const cl = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]] = bits(3);
        const clh = buildHuffman(cl);
        const lens = new Uint8Array(hlit + hdist);
        for (let i = 0; i < hlit + hdist;) {
          const sym = decode(clh);
          if (sym < 16) lens[i++] = sym;
          else {
            let rep, val = 0;
            if (sym === 16) { if (!i) throw bad(); val = lens[i - 1]; rep = 3 + bits(2); }
            else if (sym === 17) rep = 3 + bits(3);
            else rep = 11 + bits(7);
            if (i + rep > hlit + hdist) throw bad();
            while (rep--) lens[i++] = val;
          }
        }
        t = { lit: buildHuffman(lens.subarray(0, hlit)), dist: buildHuffman(lens.subarray(hlit)) };
      }
      for (;;) {
        const sym = decode(t.lit);
        if (sym < 256) emit(sym);
        else if (sym === 256) break;
        else {
          const li = sym - 257;
          if (li >= 29) throw bad();
          const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
          const di = decode(t.dist);
          if (di >= 30) throw bad();
          const dist = DIST_BASE[di] + bits(DIST_EXTRA[di]);
          if (dist > out.length) throw bad();
          for (let i = 0; i < len; i++) emit(out[out.length - dist]);
        }
      }
    } else throw bad();
  }
  return Uint8Array.from(out);
}

// ---- JSON hygiene ----------------------------------------------------------------------------------------------

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Parse JSON, dropping prototype-pollution keys at every depth. */
export function safeParse(text) {
  return JSON.parse(text, (key, value) => (UNSAFE_KEYS.has(key) ? undefined : value));
}

// ---- public API ------------------------------------------------------------------------------------------------

export async function encodeScene(scene) {
  const json = new TextEncoder().encode(JSON.stringify(scene));
  let token;
  if (hasCompression()) token = 'z' + bytesToB64url(await pipeThrough(json, new CompressionStream('deflate-raw')));
  else token = 'j' + bytesToB64url(json);
  if (token.length > SIZE_MAX) throw new ShareError('too-large', `The scene is too large to share as a link (${Math.round(token.length / 1024)} KB, limit ${SIZE_MAX / 1024} KB). Use Save instead.`);
  return token;
}

export async function decodeScene(token) {
  try {
    if (typeof token !== 'string' || !token) return { ok: false, error: 'The link contains no scene' };
    if (token.length > SIZE_MAX) return { ok: false, error: 'The link is too large to load' };
    const kind = token[0];
    const bytes = b64urlToBytes(token.slice(1));
    let json;
    if (kind === 'j') {
      if (bytes.length > MAX_JSON_BYTES) return { ok: false, error: 'The shared data is too large' };
      json = bytes;
    } else if (kind === 'z') {
      json = hasDecompression() ? await pipeThrough(bytes, new DecompressionStream('deflate-raw'), MAX_JSON_BYTES) : inflateRaw(bytes);
    } else return { ok: false, error: 'Unknown link format' };
    const text = new TextDecoder('utf-8', { fatal: true }).decode(json);
    let raw;
    try { raw = safeParse(text); } catch (e) { return { ok: false, error: 'The link does not contain valid scene data' }; }
    const scene = migrateScene(raw);
    const { ok, errors } = validateScene(scene);
    if (!ok) return { ok: false, error: `The shared scene is not valid: ${errors.slice(0, 3).join('; ')}` };
    return { ok: true, scene };
  } catch (e) {
    return { ok: false, error: e instanceof ShareError ? e.message : 'The link is damaged or not a scene' };
  }
}

export async function buildShareLink(scene, baseUrl = '') {
  const token = await encodeScene(scene);
  return { url: `${baseUrl}#s=${token}`, size: token.length, warn: token.length > SIZE_WARN };
}

/** Interpret a location hash. Example ids are restricted to a safe alphabet; nothing else is interpreted. */
export function parseHash(hash) {
  if (typeof hash !== 'string') return null;
  const h = hash.replace(/^#/, '');
  if (h.startsWith('s=')) return { kind: 'scene', token: h.slice(2) };
  if (h.startsWith('ex=')) {
    const id = h.slice(3);
    return /^[a-z0-9-]{1,64}$/.test(id) ? { kind: 'example', id } : null;
  }
  return null;
}
