import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { createDefaultScene, createDefaultLink, validateScene } from '../js/model/scene.js';
import {
  encodeScene, decodeScene, buildShareLink, parseHash, inflateRaw, safeParse, bytesToB64url, b64urlToBytes, SIZE_WARN, SIZE_MAX,
} from '../js/share.js';
import { EXAMPLES, buildExample } from '../js/examples.js';

test('round trip: default scene, IEM scene and every example', async () => {
  const scenes = [createDefaultScene(), ...EXAMPLES.map((e) => buildExample(e.id).scene)];
  const iem = createDefaultScene();
  iem.links = [createDefaultLink('iem')];
  scenes.push(iem);
  for (const s of scenes) {
    const token = await encodeScene(s);
    assert.match(token, /^[zj][A-Za-z0-9_-]+$/);
    const r = await decodeScene(token);
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.scene, s);
  }
});

test('links are compact: the default scene and typical examples stay well under the warning size', async () => {
  const t = await encodeScene(createDefaultScene());
  assert.ok(t.length < SIZE_WARN, 'default scene token ' + t.length);
  const link = await buildShareLink(createDefaultScene(), 'https://example.org/app/');
  assert.ok(link.url.startsWith('https://example.org/app/#s=z'));
  assert.equal(link.warn, false);
  assert.equal(link.size, link.url.split('#s=')[1].length);
});

test('older scenes are migrated on load and still validate', async () => {
  const old = createDefaultScene();
  delete old.imd; delete old.zones; delete old.coverage;
  delete old.links[0].telemetry; delete old.links[0].modulation; delete old.links[0].mpx;
  const r = await decodeScene(await encodeScene(old));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(validateScene(r.scene), { ok: true, errors: [] });
  assert.ok(r.scene.links[0].telemetry);
  assert.equal(r.scene.imd.enabled, false);
});

test('corrupted, truncated and foreign input is rejected with a message, never thrown', async () => {
  const good = await encodeScene(createDefaultScene());
  const cases = ['', 'x', 'zzzz', 'z', 'z!!!!', good.slice(0, 20), good.slice(0, good.length - 30), 'z' + good.slice(1).split('').reverse().join(''),
    good.replace(/.$/, '*'), 'q' + good.slice(1), 'j' + bytesToB64url(new TextEncoder().encode('not json')), 'j' + bytesToB64url(new TextEncoder().encode('[1,2,3]')),
    'j' + bytesToB64url(new TextEncoder().encode('{"version":1}')), 'j' + bytesToB64url(new Uint8Array([0xff, 0xfe, 0xfd]))];
  for (const c of cases) {
    const r = await decodeScene(c);
    assert.equal(r.ok, false, JSON.stringify(c).slice(0, 40));
    assert.equal(typeof r.error, 'string');
  }
  assert.equal((await decodeScene(null)).ok, false);
  assert.equal((await decodeScene(42)).ok, false);
});

test('size guards: oversize tokens are refused on both ends', async () => {
  const big = createDefaultScene();
  // incompressible filler: distinct pseudo-random hex per zone name
  let seed = 1;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed.toString(16); };
  big.zones = Array.from({ length: 6000 }, (_, i) => ({ id: 'z' + i, name: rnd() + rnd() + rnd() + rnd(), polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], zMin: 0, zMax: 2, requiredMarginDb: 10 }));
  await assert.rejects(() => encodeScene(big), (e) => e.code === 'too-large');
  const r = await decodeScene('j' + 'A'.repeat(SIZE_MAX + 10));
  assert.equal(r.ok, false);
  assert.match(r.error, /too large/);
});

test('decompression bombs are stopped by the output limit', async () => {
  const bomb = zlib.deflateRawSync(Buffer.alloc(20 * 1024 * 1024, 32));
  assert.ok(bomb.length < SIZE_MAX);
  const r = await decodeScene('z' + bytesToB64url(new Uint8Array(bomb)));
  assert.equal(r.ok, false);
  assert.throws(() => inflateRaw(new Uint8Array(bomb)), (e) => e.code === 'too-large');
});

test('hostile JSON: prototype-pollution keys are dropped and nothing leaks into Object.prototype', async () => {
  const hostile = '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted2":true}},"version":1,"units":{"power":"dBm","length":"m"},"stage":{"width":12,"depth":8},"environment":{"floor":"wood","polarisation":"vertical","model":"two-ray","fadeMarginDb":0,"bodyLossDb":0},"reflectors":[],"links":[]}';
  const parsed = safeParse(hostile);
  assert.equal(Object.keys(parsed).includes('__proto__'), false);
  assert.equal(Object.keys(parsed).includes('constructor'), false);
  const r = await decodeScene('j' + bytesToB64url(new TextEncoder().encode(hostile)));
  assert.equal(r.ok, true, r.error);
  assert.equal({}.polluted, undefined);
  assert.equal({}.polluted2, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(r.scene, '__proto__'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(r.scene, 'constructor'), false);
  // script-like content is just data and fails validation or stays inert text
  const evil = createDefaultScene();
  evil.links[0].name = '<img src=x onerror=alert(1)>';
  const e = await decodeScene(await encodeScene(evil));
  assert.equal(e.ok, true);
  assert.equal(e.scene.links[0].name, '<img src=x onerror=alert(1)>'); // kept as text; the UI must render it with textContent
  const nested = JSON.parse(JSON.stringify(createDefaultScene()));
  nested.links[0].tx = { __proto__: null, id: 1 };
  assert.equal((await decodeScene('j' + bytesToB64url(new TextEncoder().encode(JSON.stringify(nested))))).ok, false);
});

test('pure-JS inflate matches zlib on text of several sizes and block types', () => {
  const samples = [
    Buffer.from(''), Buffer.from('a'), Buffer.from('hello hello hello hello'),
    Buffer.from(JSON.stringify(createDefaultScene())), Buffer.from(JSON.stringify(EXAMPLES.map((e) => buildExample(e.id).scene.links[0]))),
    Buffer.alloc(5000, 7), Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 31 + (i >> 3)) & 255)),
  ];
  for (const s of samples) {
    for (const level of [0, 1, 6, 9]) {
      const out = inflateRaw(new Uint8Array(zlib.deflateRawSync(s, { level })));
      assert.deepEqual(Buffer.from(out), s, `len ${s.length} level ${level}`);
    }
  }
  assert.throws(() => inflateRaw(new Uint8Array([0xff, 0xff, 0xff])));
  assert.throws(() => inflateRaw(new Uint8Array([])));
});

test('base64url helpers reject bad alphabets; parseHash only understands #s= and #ex=', () => {
  assert.deepEqual(Array.from(b64urlToBytes(bytesToB64url(new Uint8Array([0, 250, 251, 252, 253, 254, 255])))), [0, 250, 251, 252, 253, 254, 255]);
  assert.throws(() => b64urlToBytes('ab+/'));
  assert.throws(() => b64urlToBytes('a'));
  assert.deepEqual(parseHash('#s=zABC'), { kind: 'scene', token: 'zABC' });
  assert.deepEqual(parseHash('#ex=dropout-two-ray'), { kind: 'example', id: 'dropout-two-ray' });
  assert.equal(parseHash('#ex=../../etc'), null);
  assert.equal(parseHash('#ex=<script>'), null);
  assert.equal(parseHash('#other'), null);
  assert.equal(parseHash(''), null);
  assert.equal(parseHash(undefined), null);
});
