import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  parseVenueText, VENUE_LIMITS, VENUE_GREYS, packUnderlay, unpackUnderlay, venueSegmentsByStep, venueSummary,
  shadeBounds, shadeStep, venueImportMessage, validateVenue,
} from '../js/model/venue-underlay.js';
import { createDefaultScene, serialize, deserialize, migrateScene, validateScene, SCHEMA_VERSION } from '../js/model/scene.js';
import { createStore } from '../js/store.js';
import { setVenue, removeVenue, setVenueLayerHidden } from '../js/actions.js';
import { encodeScene, decodeScene, buildShareLink } from '../js/share.js';
import { parseSceneText } from '../js/io.js';

// Synthetic fixtures only.
const HEAD = '"; LengthUnit", "m"\n';
const blk = (label, pts) => `"Label", "${label}"\n${pts.map((p) => p.join(', ')).join('\n')}\n`;

test('parser: units refusals', () => {
  const none = parseVenueText(blk('Wall 01', [[0, 0, 0], [1, 0, 0]]));
  assert.equal(none.ok, false);
  assert.match(none.message, /does not say what its length unit is/);
  const ft = parseVenueText('"; LengthUnit", "ft"\n' + blk('Wall 01', [[0, 0, 0], [1, 0, 0]]));
  assert.equal(ft.ok, false);
  assert.equal(ft.message, 'This venue file is in ft. Export it again from SketchUp with SU4SV, in metres.');
  assert.equal(parseVenueText('"; LengthUnit","M"\n' + blk('W', [[0, 0, 0], [1, 0, 0]])).ok, true);
  assert.equal(parseVenueText(null).ok, false);
});

test('parser: 2-point lines, closed outlines, trailing numbers, merged layers', () => {
  const r = parseVenueText(HEAD + '"; other comment"\n' + blk('Wall 01', [[0, 0, 0], [1, 0, 0]]) + blk('Wall_02', [[0, 1, 0], [1, 1, 0]])
    + blk('Seat row', [[0, 0, 1], [2, 0, 1], [2, 2, 1]]) + blk('Lonely', [[5, 5, 5]]));
  assert.equal(r.ok, true);
  assert.equal(r.badLines, 0);
  assert.deepEqual(r.underlay.layers.map((l) => l.name), ['Wall', 'Seat row']); // Wall 01 and Wall_02 merge; one-point block is nothing
  assert.equal(r.edges, 5); // 2 wall lines + closed triangle of 3
  assert.equal(r.blocks, 3);
  assert.equal(venueSummary(r.underlay).lines, 5);
  assert.ok(r.underlay.layers.every((l) => l.hidden === false));
});

test('parser: layer naming edge cases', () => {
  const r = parseVenueText(HEAD + blk('123', [[0, 0, 0], [1, 0, 0]]) + blk('x'.repeat(100) + ' 7', [[0, 0, 0], [0, 1, 0]]));
  assert.deepEqual(r.underlay.layers.map((l) => l.name), ['123', 'x'.repeat(80)]);
});

test('parser: reversed duplicate keeps one line at the lowest height; zero length dropped', () => {
  const r = parseVenueText(HEAD + blk('A', [[0, 0, 4], [1, 0, 4]]) + blk('A 2', [[1, 0, 0], [0, 0, 0]]) + blk('B', [[2, 2, 0], [2.001, 2.001, 0]]));
  assert.equal(r.ok, true);
  assert.equal(r.edges, 1);
  assert.equal(r.underlay.layers.length, 1);
  // drawn direction of the first copy is kept
  assert.deepEqual(r.underlay.layers[0].shades[0].edges, [0, 0, 100, 0]);
});

test('parser: bad lines counted, BOM and CRLF accepted', () => {
  const text = '﻿' + HEAD.replace('\n', '\r\n') + '1, 2, 3\r\n' + '"Label", "Wall 01"\r\n' + '0, 0, 0\r\nnonsense\r\n1e999, 0, 0\r\n200000, 0, 0\r\n1, 0, 0\r\n'
    + '"Label" broken\r\n9, 9, 9\r\n';
  const r = parseVenueText(text);
  assert.equal(r.ok, true);
  assert.equal(r.badLines, 6); // vertex before label, nonsense, infinite, 200 km away, malformed label and its vertex
  assert.equal(r.edges, 1);
});

test('parser: bad line total includes the vertex after a malformed label', () => {
  const r = parseVenueText(HEAD + blk('A', [[0, 0, 0], [1, 0, 0]]) + '"Label" nope\n3, 3, 3\n');
  assert.equal(r.badLines, 2);
});

test('parser: no lines and limits', () => {
  assert.match(parseVenueText(HEAD).message, /No lines could be read/);
  // layers
  let t = HEAD;
  for (let i = 0; i < 301; i++) t += blk(`L${i}a`, [[i, 0, 0], [i, 1, 0]]);
  assert.match(parseVenueText(t).message, /^This venue has 301 layers, and the most that can be kept is 300\./);
  // lines
  const rows = [HEAD + '"Label", "Big"\n'];
  for (let i = 0; i < 31000; i++) rows.push(`${i}, 0, 0\n${i}, 1, 0\n`);
  const big = parseVenueText(rows.join('') ); // one outline of 62000 points = 62000 lines
  assert.equal(big.ok, false);
  assert.match(big.message, /^This venue has 62,000 lines once duplicates are removed, and the most that can be kept is 60,000\./);
  // file size
  const huge = parseVenueText(' '.repeat(VENUE_LIMITS.maxFileBytes + 1));
  assert.match(huge.message, /larger than 8 MB/);
});

test('shading: known heights and all-equal', () => {
  const h = Array.from({ length: 101 }, (_, i) => i); // 0..100
  const { lo, hi } = shadeBounds(h);
  assert.equal(lo, 2); // floor(0.02 * 100)
  assert.equal(hi, 98);
  assert.deepEqual([0, 2, 25, 26, 50, 74, 75, 98, 100].map((z) => shadeStep(z, lo, hi)), [0, 0, 0, 1, 2, 3, 3, 3, 3]);
  assert.equal(shadeStep(5, 3, 3), 0);
  const r = parseVenueText(HEAD + blk('A', [[0, 0, 7], [1, 0, 7]]) + blk('B', [[0, 1, 7], [1, 1, 7]]));
  assert.deepEqual(r.underlay.layers.map((l) => l.shades.map((s) => s.step)), [[0], [0]]);
  // lowest line darkest, highest lightest
  const rowsG = [0, 1, 2, 3, 4].map((i) => blk(i === 0 ? 'Low' : i === 4 ? 'High' : `Mid${i}x`, [[0, i, i * 2.5], [1, i, i * 2.5]])).join('');
  const g = parseVenueText(HEAD + rowsG);
  assert.equal(g.underlay.layers[0].shades[0].step, 0); // z 0: lo = 0, hi = 7.5 (98th of 5 values is s[3])
  assert.equal(g.underlay.layers.at(-1).shades[0].step, 3); // z 10 above hi
  assert.deepEqual([...VENUE_GREYS.dark], [...VENUE_GREYS.light].reverse());
  assert.equal(VENUE_GREYS.light[0], '#8c8c8c');
});

test('import messages', () => {
  assert.equal(venueImportMessage({ ok: true, underlay: { layers: new Array(7) }, edges: 12345, badLines: 3 }), 'Imported 12,345 lines in 7 layers. 3 lines of the file could not be read and were left out.');
  assert.equal(venueImportMessage({ ok: true, underlay: { layers: [1] }, edges: 1, badLines: 0 }), 'Imported 1 line in 1 layer.');
  assert.equal(venueImportMessage({ ok: true, underlay: { layers: [1] }, edges: 1, badLines: 1 }), 'Imported 1 line in 1 layer. 1 line of the file could not be read and was left out.');
});

const sample = () => parseVenueText(HEAD + blk('Wall 01', [[0, 0, 0], [1, 0, 0], [1, 2, 0], [-3.5, 2, 0]]) + blk('Seats', [[10, 10, 2], [10, 12, 2]]) + blk('Seats 2', [[10, 12, 2], [11, 12.5, 3]])).underlay;

test('pack and unpack round trip; malformed tokens return null', () => {
  const u = sample();
  u.layers[1].hidden = true;
  const packed = packUnderlay(u);
  assert.equal(typeof packed.layers[0].shades[0].packed, 'string');
  assert.deepEqual(unpackUnderlay(JSON.parse(JSON.stringify(packed))), u);
  // continuous lines use two numbers, jumps four
  const one = { layers: [{ name: 'A', hidden: false, shades: [{ step: 0, edges: [0, 0, 36, 0, 36, 0, 36, 36, 100, 100, 101, 100] }] }] };
  assert.equal(packUnderlay(one).layers[0].shades[0].packed, '10,0 0,10 1s,1s,1,0');
  assert.deepEqual(unpackUnderlay(packUnderlay(one)), one);
  const mk = (packedText) => ({ layers: [{ name: 'A', hidden: false, shades: [{ step: 0, packed: packedText }] }] });
  for (const bad of ['1', '1,2,3', '1,2,3,4,5', 'A,1', '1,,2', '-,1', 'zzzzzzzzz,1', '1,2 ', '10,0  0,1', 'zzzzzzzz,0', '1,0 1;2']) assert.equal(unpackUnderlay(mk(bad)), null, bad);
  assert.notEqual(unpackUnderlay(mk('1,0')), null);
  assert.equal(unpackUnderlay(mk('')).layers[0].shades[0].edges.length, 0);
  for (const bad of [null, [], {}, { layers: 'x' }, { layers: [{ name: '', hidden: false, shades: [] }] }, { layers: [{ name: 'a', hidden: 'no', shades: [] }] },
    { layers: [{ name: 'a', hidden: false, shades: [{ step: 4, packed: '' }] }] }, { layers: [{ name: 'a', hidden: false, shades: [{ step: 0, packed: 5 }] }] },
    { layers: [{ name: 'x'.repeat(81), hidden: false, shades: [] }] }]) assert.equal(unpackUnderlay(bad), null);
  assert.equal(unpackUnderlay({ layers: new Array(301).fill({ name: 'a', hidden: false, shades: [] }) }), null);
  assert.equal(unpackUnderlay({ layers: [{ name: 'a', hidden: false, shades: new Array(5).fill({ step: 0, packed: '' }) }] }), null);
  assert.equal(unpackUnderlay(mk('100000,0')), null); // 60 466 176 cm is beyond the 100 km bound (10 000 000 cm)
  assert.equal(unpackUnderlay(mk(new Array(60001).fill('1,0').join(' '))), null);
  assert.deepEqual(validateVenue(u), []);
  assert.ok(validateVenue({ layers: [{ name: 'a', hidden: false, shades: [{ step: 0, edges: [1, 2, 3] }] }] }).length > 0);
});

test('venueSegmentsByStep: hidden excluded, outside dropped, partial clipped, rounding, anchor', () => {
  const u = { layers: [
    { name: 'A', hidden: false, shades: [{ step: 1, edges: [0, 0, 100, 0, 100000, 0, 100100, 0, -100, 100, 300, 100] }] },
    { name: 'H', hidden: true, shades: [{ step: 2, edges: [0, 0, 100, 0] }] },
  ] };
  const frame = { minX: 0, minY: 0, maxX: 12, maxY: 8 };
  const seg = venueSegmentsByStep(u, frame, { x: 6, y: 8 });
  assert.equal(seg.length, 4);
  assert.deepEqual(seg[2], []); // hidden layer
  assert.deepEqual(seg[0], []);
  // line 1: (6,8)-(7,8) inside (on the frame edge); line 2 starts 1000 m away: dropped; line 3 at y = 9 is outside
  assert.deepEqual(seg[1], [[6, 8, 7, 8]]);
  const clip = venueSegmentsByStep({ layers: [{ name: 'A', hidden: false, shades: [{ step: 3, edges: [-1000, -400, 1000, -400] }] }] }, frame, { x: 6, y: 8 });
  assert.deepEqual(clip[3], [[0, 4, 12, 4]]); // y = 8 - 4 = 4, clipped from x = -4 .. 16 to 0 .. 12
  const none = venueSegmentsByStep(undefined, frame, { x: 0, y: 0 });
  assert.deepEqual(none, [[], [], [], []]);
  // a hidden-everything underlay draws nothing
  assert.deepEqual(venueSegmentsByStep({ layers: [{ name: 'A', hidden: true, shades: [{ step: 0, edges: [0, 0, 1, 1] }] }] }, frame, { x: 0, y: 0 }), [[], [], [], []]);
});

test('venueSummary labels', () => {
  assert.deepEqual(venueSummary(undefined), { layers: 0, visibleLayers: 0, lines: 0, label: 'Venue' });
  const u = sample();
  assert.equal(venueSummary(u).label, 'Venue: 2 of 2 layers on');
  u.layers[0].hidden = true;
  assert.equal(venueSummary(u).label, 'Venue: 1 of 2 layers on');
  assert.equal(venueSummary({ layers: [u.layers[0]] }).label, 'Venue: 0 of 1 layer on');
});

test('scene schema: version, older files open with no venue, newer refused, packed persistence', () => {
  assert.equal(SCHEMA_VERSION, 2);
  const old = JSON.parse(serialize(createDefaultScene()));
  old.version = 1;
  const m = migrateScene(old);
  assert.equal(m.version, 2);
  assert.equal(m.venue, undefined);
  assert.equal(validateScene(m).ok, true);
  assert.equal(deserialize(JSON.stringify(old)).venue, undefined);
  // a version-1 file claiming a venue cannot have one: dropped
  old.venue = { layers: [] };
  assert.equal(migrateScene(old).venue, undefined);
  // newer than supported is refused (what an older app does with a version-2 file)
  assert.throws(() => deserialize(JSON.stringify({ ...JSON.parse(serialize(createDefaultScene())), version: 3 })), /newer/);
  assert.equal(parseSceneText(JSON.stringify({ ...JSON.parse(serialize(createDefaultScene())), version: 3 })).ok, false);

  const sc = createDefaultScene();
  sc.venue = sample();
  const text = serialize(sc);
  const raw = JSON.parse(text);
  assert.equal(raw.version, 2);
  assert.equal(typeof raw.venue.layers[0].shades[0].packed, 'string');
  assert.equal(raw.venue.layers[0].shades[0].edges, undefined);
  const back = deserialize(text);
  assert.deepEqual(back.venue, sc.venue);
  assert.equal(parseSceneText(text).ok, true);
  // corrupt packed data refuses the file with the stated message
  raw.venue.layers[0].shades[0].packed = '1,2,3';
  const bad = parseSceneText(JSON.stringify(raw));
  assert.equal(bad.ok, false);
  assert.match(bad.error, /The venue lines could not be read/);
  // structurally bad venue is refused by validation
  const sc2 = createDefaultScene();
  sc2.venue = { layers: [{ name: '', hidden: false, shades: [] }] };
  assert.equal(validateScene(sc2).ok, false);
  assert.throws(() => deserialize(JSON.stringify(sc2)), /Invalid scene/);
});

test('actions: setVenue, setVenueLayerHidden, removeVenue are undoable; replacing resets hidden flags', () => {
  const st = createStore(createDefaultScene());
  const u = sample();
  assert.equal(setVenue(st, u), true);
  assert.deepEqual(st.getScene().venue, u);
  assert.equal(setVenue(st, { layers: [{ name: '', hidden: false, shades: [] }] }), false);
  assert.equal(setVenueLayerHidden(st, 'Wall', true), true);
  assert.equal(st.getScene().venue.layers[0].hidden, true);
  assert.equal(st.getScene().venue.layers[1].hidden, false);
  assert.equal(setVenueLayerHidden(st, 'Wall', true), false); // no change
  assert.equal(setVenueLayerHidden(st, 'Nope', true), false);
  st.undo();
  assert.equal(st.getScene().venue.layers[0].hidden, false);
  st.redo();
  assert.equal(setVenue(st, sample()), true);
  assert.equal(st.getScene().venue.layers[0].hidden, false);
  assert.equal(removeVenue(st), true);
  assert.equal(st.getScene().venue, undefined);
  assert.equal(removeVenue(st), false);
  st.undo();
  assert.ok(st.getScene().venue);
  // other edits leave the venue alone and do not clone it
  const ref = st.getScene().venue;
  st.update((d) => { d.stage.width = 14; });
  assert.equal(st.getScene().venue, ref);
  assert.equal(st.getScene().stage.width, 14);
  // adding a venue does not change scale-relevant scene fields
  const plain = createDefaultScene();
  const withV = { ...plain, venue: sample() };
  assert.deepEqual({ ...withV, venue: undefined }, { ...plain, venue: undefined });
});

test('share links leave the venue out and say so', async () => {
  const sc = createDefaultScene();
  sc.venue = sample();
  const token = await encodeScene(sc);
  const dec = await decodeScene(token);
  assert.equal(dec.ok, true);
  assert.equal(dec.scene.venue, undefined);
  assert.equal(dec.venueOmitted, true);
  assert.match(dec.message, /without its venue/);
  assert.equal(dec.scene.venueOmitted, undefined);
  const link = await buildShareLink(sc, 'http://x/');
  assert.equal(link.venueOmitted, true);
  assert.match(link.message, /not included in share links/);
  const plain = await decodeScene(await encodeScene(createDefaultScene()));
  assert.equal(plain.ok, true);
  assert.equal(plain.venueOmitted, undefined);
  assert.equal((await buildShareLink(createDefaultScene())).venueOmitted, undefined);
  // a hostile link cannot smuggle a venue in
  const raw = JSON.parse(serialize(createDefaultScene()));
  raw.venue = { layers: [] };
  const { bytesToB64url } = await import('../js/share.js');
  const hostile = await decodeScene('j' + bytesToB64url(new TextEncoder().encode(JSON.stringify(raw))));
  assert.equal(hostile.scene.venue, undefined);
});

test('optional: private venue files parse when present', (t) => {
  const dir = new URL('./private-venues/', import.meta.url);
  if (!fs.existsSync(dir)) { t.skip('tests/private-venues not present'); return; }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt'));
  if (!files.length) { t.skip('no files'); return; }
  for (const f of files) {
    const r = parseVenueText(fs.readFileSync(new URL(f, dir), 'utf8'));
    if (r.ok) {
      assert.ok(r.edges > 0 && r.edges <= VENUE_LIMITS.maxLines, f);
      assert.deepEqual(unpackUnderlay(JSON.parse(JSON.stringify(packUnderlay(r.underlay)))), r.underlay, f);
    } else assert.equal(typeof r.message, 'string', f);
  }
});
