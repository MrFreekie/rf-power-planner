// Hostile or corrupt scene files must be refused (or loaded safely), never hang, throw out of the loader, or reach Object.prototype.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene, serialize, deserialize, syncScene, validateScene } from '../js/model/scene.js';
import { parseSceneText } from '../js/io.js';
import { addReceiverFor, addLink } from '../js/actions.js';
import { createStore } from '../js/store.js';
import { adoptRack, addRackSplitter, addRackCombiner } from '../js/actionsRack.js';

const base = () => { const st = createStore(createDefaultScene()); addLink(st, 'mic'); addLink(st, 'iem'); adoptRack(st); addRackSplitter(st); addRackCombiner(st); return JSON.parse(serialize(st.getScene())); };
const load = (o) => parseSceneText(JSON.stringify(o));
const timed = (fn) => { const t = Date.now(); const r = fn(); assert.ok(Date.now() - t < 2000, 'took too long'); return r; };

test('hostile rack values never throw out of the loader and never hang', () => {
  const evil = [null, 'x', 1e308, -1, NaN, [], {}, [[]], { __proto__: { polluted: 1 } }, '__proto__', true, 'a'.repeat(100000)];
  const paths = [
    (s, v) => { s.rack = v; }, (s, v) => { s.rack.antennas = v; }, (s, v) => { s.rack.splitters = v; }, (s, v) => { s.rack.receivers = v; },
    (s, v) => { s.rack.transmitters = v; }, (s, v) => { s.rack.combiners = v; },
    (s, v) => { s.rack.splitters[0].fromSplitter = v; }, (s, v) => { s.rack.splitters[0].ports = v; }, (s, v) => { s.rack.receivers[0].loopFrom = v; },
    (s, v) => { s.rack.receivers[0].loopLossDb = v; }, (s, v) => { s.rack.combiners[0].fanout = v; }, (s, v) => { s.rack.combiners[0].cable = v; },
    (s, v) => { s.links[0].txOf = v; }, (s, v) => { s.rack.transmitters[0].channels = v; }, (s, v) => { s.rack.transmitters[0].channels[0].isolatorDb = v; },
    (s, v) => { s.rack.antennas[0].zones = v; }, (s, v) => { s.rack.antennas[0].chain = v; },
  ];
  for (const p of paths) for (const v of evil) {
    const s = base();
    try { p(s, v); } catch { continue; }
    const r = timed(() => load(s));
    assert.equal(typeof r.ok, 'boolean');
    if (r.ok) timed(() => syncScene(structuredClone(r.scene)));
  }
  assert.equal({}.polluted, undefined);
});

test('splitter cycles, receiver loop rings and txOf loops are refused or neutralised', () => {
  const s = base();
  s.rack.splitters.push({ ...s.rack.splitters[0], id: 'spB', name: 'B', fromSplitter: s.rack.splitters[0].id });
  s.rack.splitters[0].fromSplitter = 'spB';
  assert.equal(timed(() => load(s)).ok, false);
  const t = base(); t.links[0].txOf = t.links[1].id; t.links[1].txOf = t.links[0].id;
  const r = timed(() => load(t)); if (r.ok) timed(() => syncScene(r.scene));
  const u = base(); u.links[0].txOf = u.links[0].id;
  const r2 = timed(() => load(u)); assert.ok(!r2.ok || r2.scene.links[0].txOf === undefined, 'a link cannot be its own transmitter source');
  if (r.ok) assert.ok(r.scene.links.filter((l) => l.txOf !== undefined).length < 2, 'a txOf loop is broken on load');
});

test('oversized rack arrays are refused', () => {
  const s = base();
  s.rack.antennas = Array.from({ length: 5000 }, (_, i) => ({ ...s.rack.antennas[0], id: `a${i}` }));
  assert.equal(timed(() => load(s)).ok, false);
  const c = base(); c.rack.combiners[0].fanout = { type: 'passive', outputs: Array.from({ length: 5000 }, () => ({ antennaId: null })) };
  assert.equal(timed(() => load(c)).ok, false);
});

test('prototype keys in a scene file are dropped', () => {
  const text = JSON.stringify(base()).replace('"rack":{', '"rack":{"__proto__":{"polluted":1},');
  timed(() => parseSceneText(text)); assert.equal({}.polluted, undefined);
});

test('a scene built to the link limit still saves and reloads (rack limits cover every link)', () => {
  const st = createStore(createDefaultScene());
  for (let i = 0; i < 31; i++) { addLink(st, 'mic'); addLink(st, 'iem'); }
  adoptRack(st);
  const r = parseSceneText(serialize(st.getScene()));
  assert.ok(r.ok, r.error);
  assert.equal(r.scene.links.length, st.getScene().links.length);
});

test('share links: garbage, truncated and oversized tokens fail cleanly', async () => {
  const { decodeScene, encodeScene, parseHash, SIZE_MAX } = await import('../js/share.js');
  const good = await encodeScene(createDefaultScene());
  const token = typeof good === 'string' ? good : good.token ?? String(good);
  const junk = ['', 'A', '!!!!', '%00%ff', 'x'.repeat(SIZE_MAX + 10), token.slice(0, Math.floor(token.length / 2)), token + 'AAAA', '__proto__', 'e30', 'W10', 'bnVsbA'];
  for (const j of junk) {
    const t = Date.now();
    let r; try { r = await decodeScene(j); } catch (e) { r = { ok: false, error: String(e) }; }
    assert.ok(Date.now() - t < 2000);
    assert.ok(r === undefined || typeof r === 'object' || typeof r === 'string');
  }
  for (const h of ['', '#', '#share=', '#example=../../etc/passwd', '#example=<script>', '#' + 'a'.repeat(100000)]) {
    const p = parseHash(h);
    assert.ok(p === null || typeof p === 'object');
    if (p && p.example) assert.match(p.example, /^[A-Za-z0-9_-]+$/);
  }
});
