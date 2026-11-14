// Malicious-input tests: prototype pollution, oversize data, NaN/Infinity, resource limits, venue parser DoS, unpack bombs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene, deserialize, validateScene, migrateScene, createDefaultLink, createZone, createReflector, SCENE_LIMITS, serialize } from '../js/model/scene.js';
import { parseSceneText } from '../js/io.js';
import { decodeScene, encodeScene, safeParse } from '../js/share.js';
import { parseVenueText, unpackUnderlay, validateVenue, VENUE_LIMITS } from '../js/model/venue-underlay.js';

const base = () => JSON.parse(JSON.stringify(createDefaultScene()));
const ok = (s) => validateScene(s);

test('deserialize drops __proto__ / constructor keys and does not pollute Object.prototype', () => {
  const s = base();
  const text = JSON.stringify(s).replace('"units":', '"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted2":1}},"units":');
  const r = parseSceneText(text);
  assert.equal(({}).polluted, undefined);
  assert.equal(({}).polluted2, undefined);
  assert.equal(r.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(r.scene, '__proto__'), false);
  assert.equal(r.scene.constructor, Object);
});

test('validateScene rejects own __proto__ keys at depth', () => {
  const s = base();
  s.links[0].audio = JSON.parse('{"source":"speech","gainDb":0,"__proto__":{"x":1}}');
  assert.equal(ok(s).ok, false);
});

test('share links: pollution keys stripped, oversize and garbage rejected', async () => {
  assert.equal(safeParse('{"a":{"__proto__":{"p":1}}}').a.p, undefined);
  assert.equal(({}).p, undefined);
  for (const t of ['', 'x', 'zAAAA', 'j!!!', 'jeyJ', 'z' + 'A'.repeat(70000)]) assert.equal((await decodeScene(t)).ok, false);
  const good = await decodeScene(await encodeScene(base()));
  assert.equal(good.ok, true);
});

test('share link: a deflate bomb is refused', async () => {
  const { gzipSync, deflateRawSync } = await import('node:zlib');
  void gzipSync;
  const bomb = deflateRawSync(Buffer.alloc(50 * 1024 * 1024, 32));
  assert.ok(bomb.length < 60 * 1024);
  const tok = 'z' + bomb.toString('base64url');
  const r = await decodeScene(tok);
  assert.equal(r.ok, false);
});

test('Infinity, NaN-like and out-of-range numbers are rejected', () => {
  const cases = [
    (s) => { s.links[0].freqMHz = 1e999; },
    (s) => { s.links[0].freqMHz = 1e12; },
    (s) => { s.links[0].tx.pos.x = 1e9; },
    (s) => { s.links[0].tx.powerDbm = 1e300; },
    (s) => { s.links[0].rx.squelch.hysteresisDb = 1e999; },
    (s) => { s.links[0].telemetry.battery.timeScale = 1e999; },
    (s) => { s.imd.channelBwKHz = 1e999; },
    (s) => { s.zones.push(createZone({ polygon: [{ x: 0, y: 0 }, { x: 1e9, y: 0 }, { x: 0, y: 5 }] })); },
    (s) => { s.reflectors.push(createReflector({ transmissionLossDb: 1e999 })); },
  ];
  for (const f of cases) { const s = base(); f(s); assert.equal(ok(JSON.parse(JSON.stringify(s, (k, v) => v)) && s).ok, false, f.toString()); }
  // 1e999 survives JSON text as Infinity
  const t = JSON.stringify(base()).replace('"freqMHz":600', '"freqMHz":1e999');
  assert.equal(parseSceneText(t).ok, false);
});

test('count limits: thousands of links, zones, points, transmitters and chain items are refused', () => {
  const mk = (f) => { const s = base(); f(s); return s; };
  assert.equal(ok(mk((s) => { s.links = Array.from({ length: SCENE_LIMITS.maxLinks + 1 }, () => createDefaultLink('mic')); })).ok, false);
  assert.equal(ok(mk((s) => { s.zones = Array.from({ length: SCENE_LIMITS.maxZones + 1 }, () => createZone()); })).ok, false);
  assert.equal(ok(mk((s) => { s.zones.push(createZone({ polygon: Array.from({ length: SCENE_LIMITS.maxZonePoints + 1 }, (_, i) => ({ x: i % 50, y: i % 7 })) })); })).ok, false);
  assert.equal(ok(mk((s) => { s.reflectors = Array.from({ length: SCENE_LIMITS.maxReflectors + 1 }, () => createReflector()); })).ok, false);
  assert.equal(ok(mk((s) => { s.links[0].chain = Array.from({ length: SCENE_LIMITS.maxChain + 1 }, () => ({ kind: 'filter', lossDb: 1 })); })).ok, false);
  const many = JSON.stringify({ ...base(), links: new Array(20000).fill({}) });
  assert.equal(parseSceneText(many).ok, false); // refused before per-link migration work
});

test('oversize strings, unsafe ids, deep nesting and huge text are refused', () => {
  const s = base(); s.links[0].name = 'x'.repeat(SCENE_LIMITS.maxString + 1);
  assert.equal(ok(s).ok, false);
  const t = base(); t.links[0].id = '__proto__';
  assert.equal(ok(t).ok, false);
  const u = base(); u.links[0].mpx.preset = 'constructor';
  assert.equal(ok(u).ok, false);
  const d = base(); let n = d.links[0].mpx.overrides; for (let i = 0; i < 100; i++) { n.a = {}; n = n.a; }
  assert.equal(ok(d).ok, false);
  assert.equal(parseSceneText('x'.repeat(SCENE_LIMITS.maxText + 1)).ok, false);
  assert.equal(parseSceneText('['.repeat(200000)).ok, false);
});

test('a normal default scene and a serialise round trip still validate', () => {
  const s = createDefaultScene();
  assert.equal(ok(s).ok, true);
  assert.equal(deserialize(serialize(s)).version, s.version);
  assert.equal(migrateScene(JSON.parse(serialize(s))).version, s.version);
});

// ---- venue parser ------------------------------------------------------------------------------------------------

const HDR = '"; LengthUnit","m"\n';

test('venue: very long lines do not stall the parser and count as bad lines', () => {
  const t0 = Date.now();
  const text = HDR + '"Label","A_1"\n' + '1,2,' + '3'.repeat(2000000) + '\n' + '1,1,1\n2,2,2\n' + '1,'.repeat(500000) + '\n"Label","' + 'q'.repeat(1000000) + '"\n';
  const r = parseVenueText(text);
  assert.ok(Date.now() - t0 < 3000);
  assert.equal(r.ok, true);
  assert.ok(r.badLines >= 3);
});

test('venue: regex stress strings finish quickly', () => {
  const t0 = Date.now();
  const nasty = ['1' + ' '.repeat(1500) + ',', '-' + '1'.repeat(1900) + 'e', '1.' + '1'.repeat(1900) + ',1,1x'];
  const text = HDR + '"Label","A"\n' + nasty.join('\n') + '\n';
  parseVenueText(text);
  assert.ok(Date.now() - t0 < 1000);
});

test('venue: one block with millions of points is stopped early with a clear message', () => {
  const rows = ['"Label","Big"'];
  for (let i = 0; i < 300000; i++) rows.push(`${i / 100},${(i % 977) / 10},0`);
  const r = parseVenueText(HDR + rows.join('\n'));
  assert.equal(r.ok, false);
  assert.match(r.message, /lines|layers/);
});

test('venue: too many layers stops early', () => {
  const rows = [];
  for (let i = 0; i < VENUE_LIMITS.maxLayers * VENUE_LIMITS.hardFactor + 50; i++) rows.push(`"Label","L${String.fromCharCode(65 + (i % 26))}${i}x"`, `${i},0,0`, `${i},1,0`);
  const r = parseVenueText(HDR + rows.join('\n'));
  assert.equal(r.ok, false);
});

test('venue: 8 MB gate and layer name __proto__ are harmless', () => {
  assert.equal(parseVenueText('x'.repeat(VENUE_LIMITS.maxFileBytes + 1)).ok, false);
  const r = parseVenueText(HDR + '"Label","__proto__"\n0,0,0\n1,0,0\n"Label","constructor"\n0,0,0\n0,1,0\n');
  assert.equal(r.ok, true);
  assert.equal(({}).hidden, undefined);
  assert.deepEqual(r.underlay.layers.map((l) => l.name).sort(), ['__proto__', 'constructor']);
});

test('venue unpack: bombs, bad tokens and out-of-range base-36 values are rejected', () => {
  const mk = (packed, extra = {}) => ({ layers: [{ name: 'A', hidden: false, shades: [{ step: 0, packed, ...extra }] }] });
  assert.equal(unpackUnderlay(mk('zzzzzzzz,0')), null); // 36^8 cm is beyond 100 km
  assert.equal(unpackUnderlay(mk('1,1 ,2')), null);
  assert.equal(unpackUnderlay(mk('a,b,c')), null);
  assert.equal(unpackUnderlay(mk('1,1  2,2')), null);
  assert.equal(unpackUnderlay(mk('1,1,1,1,1')), null);
  assert.equal(unpackUnderlay(mk('1,-')), null);
  assert.equal(unpackUnderlay(mk('1,1 '.repeat(VENUE_LIMITS.maxLines + 5).trim())), null); // more lines than allowed
  const walk = Array.from({ length: 20 }, () => 'zzzzzz,0').join(' '); // accumulates past 100 km
  assert.equal(unpackUnderlay(mk(walk)), null);
  assert.equal(unpackUnderlay({ layers: Array.from({ length: VENUE_LIMITS.maxLayers + 1 }, () => ({ name: 'A', hidden: false, shades: [] })) }), null);
  assert.ok(unpackUnderlay(mk('1,1 2,2')));
});

test('venue in a scene file: bad packed data fails the whole load, oversize edge lists fail validation', () => {
  const s = base();
  s.venue = { layers: [{ name: 'A', hidden: false, shades: [{ step: 0, packed: 'zzzzzzzz,0' }] }] };
  assert.equal(parseSceneText(JSON.stringify(s)).ok, false);
  const e = validateVenue({ layers: [{ name: 'A', hidden: false, shades: [{ step: 0, edges: new Array(VENUE_LIMITS.maxLines * 4 + 4).fill(0) }] }] });
  assert.ok(e.length > 0);
  assert.ok(validateVenue({ layers: [{ name: 'A', hidden: false, shades: [{ step: 0, edges: [0, 0, 1e12, 0] }] }] }).length > 0);
});

// ---- caps in actions, coverage grid, dev server, saved-scene library ---------------------------------------------------

test('actions refuse to add past the scene limits', async () => {
  const A = await import('../js/actions.js');
  const { createStore } = await import('../js/store.js');
  const store = createStore(createDefaultScene());
  for (let i = 0; i < SCENE_LIMITS.maxImdTransmitters + 5; i++) A.addImdTransmitter(store);
  assert.equal(store.getScene().imd.transmitters.length, SCENE_LIMITS.maxImdTransmitters);
  assert.equal(A.addImdTransmitter(store), null);
  for (let i = 0; i < SCENE_LIMITS.maxReflectors + 3; i++) A.addReflector(store);
  assert.equal(store.getScene().reflectors.length, SCENE_LIMITS.maxReflectors);
  assert.equal(A.addReflector(store), null);
  for (let i = 0; i < SCENE_LIMITS.maxZones + 3; i++) A.addZone(store);
  assert.equal(store.getScene().zones.length, SCENE_LIMITS.maxZones);
  assert.equal(A.addZone(store), null);
  const zid = store.getScene().zones[0].id;
  for (let i = 0; i < SCENE_LIMITS.maxZonePoints + 3; i++) A.addZonePoint(store, zid, { x: i % 9, y: i % 5 });
  assert.equal(store.getScene().zones[0].polygon.length, SCENE_LIMITS.maxZonePoints);
  const lid = store.getScene().links[0].id;
  for (let i = 0; i < SCENE_LIMITS.maxChain + 3; i++) A.addChainItem(store, lid, 'filter');
  assert.equal(store.getScene().links[0].chain.length, SCENE_LIMITS.maxChain);
  assert.equal(validateScene(store.getScene()).ok, true); // everything the actions can build still loads
});

test('actions: IEM branches stop at the limit', async () => {
  const A = await import('../js/actions.js');
  const { createStore } = await import('../js/store.js');
  const store = createStore(createDefaultScene());
  A.setLinkKind(store, store.getScene().links[0].id, 'iem');
  const lid = store.getScene().links[0].id;
  for (let i = 0; i < SCENE_LIMITS.maxBranches + 3; i++) A.addBranch(store, lid);
  assert.equal(store.getScene().links[0].branches.length, SCENE_LIMITS.maxBranches);
});

test('coverage grid is capped in cells and survives huge or bad bounds', async () => {
  const { coverageGrid, MAX_GRID_CELLS } = await import('../js/model/coverage.js');
  const s = createDefaultScene();
  const id = s.links[0].id;
  const g = coverageGrid(s, id, { cellM: 0.25, bounds: { x0: 0, y0: 0, x1: 4000, y1: 4000 }, budgetMs: 1 });
  assert.ok(g.nx * g.ny <= MAX_GRID_CELLS * 1.01, `${g.nx * g.ny}`);
  assert.ok(g.cellM > 0.25);
  assert.equal(coverageGrid(s, id, { bounds: { x0: 0, y0: 0, x1: Infinity, y1: 5 } }), null);
  const small = coverageGrid(s, id, { cellM: 0.25, bounds: { x0: 0, y0: 0, x1: 12, y1: 8 }, budgetMs: 1 });
  assert.equal(small.cellM, 0.25); // normal venues are unchanged
});

test('dev server denies dot-folders, private notes and private test data', async () => {
  const { isDenied } = await import('../scripts/serve.mjs');
  const sep = (await import('node:path')).sep;
  const p = (x) => sep + x.split('/').join(sep);
  for (const d of ['.git/config', '.claude/launch.json', 'docs/research/EQUIPMENT.md', 'docs/lessons/a.md', 'tests/private-venues/x.txt', 'CLAUDE.md', 'docs/CONTRACT.md', '.env']) assert.equal(isDenied(p(d)), true, d);
  for (const d of ['index.html', 'js/app.js', 'css/style.css', 'docs/PHYSICS.md']) assert.equal(isDenied(p(d)), false, d);
});

test('saved-scene library drops oversize or tampered entries', async () => {
  const { createSceneLibrary, LIBRARY_KEY, LIMITS } = await import('../js/ui/scenes.js');
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  mem.set(LIBRARY_KEY, JSON.stringify({ v: 1, items: [
    { id: 'a', name: 'ok', savedAt: 1, json: serialize(createDefaultScene()) },
    { id: 'b', name: 'huge', savedAt: 2, json: 'x'.repeat(LIMITS.maxSceneBytes + 1) },
  ] }));
  const lib = createSceneLibrary(storage);
  assert.deepEqual(lib.list().map((x) => x.id), ['a']);
});

test('venue validation rejects duplicate layer names', () => {
  const L = (name) => ({ name, hidden: false, shades: [{ step: 0, edges: [0, 0, 1, 1] }] });
  assert.ok(validateVenue({ layers: [L('A'), L('A')] }).length > 0);
  assert.equal(validateVenue({ layers: [L('A'), L('B')] }).length, 0);
});
