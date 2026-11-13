import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene, createDefaultLink } from '../js/model/scene.js';
import { startWalk, startMultiWalk, stopWalk, isWalking } from '../js/walk.js';
import { setImdEnabled, setPath } from '../js/actions.js';
import { txReverseImd, noiseFloor } from '../js/model/imd.js';

const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} got ${a}, want ${b} +/- ${tol}`);
const NO_RAF = { raf: () => 1, caf: () => {} };

function twoMics() {
  const scene = createDefaultScene();
  const a = scene.links[0];
  const b = createDefaultLink('mic');
  a.tx.pos = { x: 2, y: 2, z: 1.5 };
  b.tx.pos = { x: 6, y: 2, z: 1.5 };
  scene.links = [a, b];
  const st = createStore(scene);
  return { st, a: a.id, b: b.id };
}

test('multi walk: each transmitter follows its own path and speed (hand-computed positions, tolerance 1e-9)', () => {
  const { st, a, b } = twoMics();
  const w = startMultiWalk(st, [
    { linkId: a, to: { x: 10, y: 2 }, speedMps: 2 },   // 8 m leg at 2 m/s
    { linkId: b, to: { x: 6, y: 8 }, speedMps: 1 },    // 6 m leg at 1 m/s
  ], { ...NO_RAF });
  assert.equal(isWalking(), true);
  w.step(1.5);
  const [la, lb] = st.getScene().links;
  near(la.tx.pos.x, 2 + 2 * 1.5, 1e-9); near(la.tx.pos.y, 2, 1e-9);
  near(lb.tx.pos.x, 6, 1e-9); near(lb.tx.pos.y, 2 + 1 * 1.5, 1e-9);
  w.step(3.5); // t = 5 s: A 10 m = 8 + 2 back -> x = 8 ; B 5 m
  near(st.getScene().links[0].tx.pos.x, 8, 1e-9);
  near(st.getScene().links[1].tx.pos.y, 7, 1e-9);
  assert.deepEqual(Object.keys(w.positions()).sort(), [`link:${a}`, `link:${b}`].sort());
  stopWalk();
  assert.equal(isWalking(), false);
});

test('multi walk: shared offset moves the group rigidly', () => {
  const { st, a, b } = twoMics();
  const sep0 = { x: 4, y: 0 };
  const w = startMultiWalk(st, [{ linkId: a }, { linkId: b }], { offset: { x: 0, y: 6 }, speedMps: 1.5, ...NO_RAF });
  w.step(2); // 3 m along +y
  const [la, lb] = st.getScene().links;
  near(la.tx.pos.y, 5, 1e-9); near(lb.tx.pos.y, 5, 1e-9);
  near(lb.tx.pos.x - la.tx.pos.x, sep0.x, 1e-9); near(lb.tx.pos.y - la.tx.pos.y, sep0.y, 1e-9);
  w.step(2); // 6 m: far end
  near(st.getScene().links[0].tx.pos.y, 8, 1e-9);
  w.step(1.9); // 8.85 m: bouncing back, 2 * 6 - 8.85 = 3.15 m from the start
  near(st.getScene().links[0].tx.pos.y, 2 + 3.15, 1e-9);
  stopWalk();
});

test('multi walk: one undo step for the whole group, and a drag of any member stops it', () => {
  const { st, a, b } = twoMics();
  const before = JSON.stringify(st.getScene().links.map((l) => l.tx.pos));
  const w = startMultiWalk(st, [{ linkId: a }, { linkId: b }], { offset: { x: 1, y: 1 }, ...NO_RAF });
  w.step(0.5); w.step(0.5); w.step(0.5);
  assert.notEqual(JSON.stringify(st.getScene().links.map((l) => l.tx.pos)), before);
  setPath(st, 'links.1.tx.pos.x', 9.9); // user drags the second mic
  assert.equal(isWalking(), false);
  st.undo(); // the drag
  st.undo(); // all walk frames of both mics in one step
  assert.equal(JSON.stringify(st.getScene().links.map((l) => l.tx.pos)), before);
});

test('multi walk: undo, a vanished target, unknown ids, and starting another walk stop or skip as documented', () => {
  const { st, a, b } = twoMics();
  const w = startMultiWalk(st, [{ linkId: a }, { linkId: 'nope' }, { imdId: 'nope' }, {}], { ...NO_RAF });
  assert.equal(w.items.length, 1); // unknown targets skipped
  w.step(0.2);
  st.undo();
  assert.equal(isWalking(), false);
  assert.equal(startMultiWalk(st, [{ linkId: 'nope' }], {}), null);
  assert.equal(startMultiWalk(st, [], {}), null);
  const w2 = startMultiWalk(st, [{ linkId: a }, { linkId: b }], { ...NO_RAF });
  w2.step(0.1);
  st.setScene(createDefaultScene()); // reset: the links are gone
  assert.equal(isWalking(), false);
  // a single walk replaces a multi walk and vice versa
  const { st: s2, a: a2 } = twoMics();
  const m = startMultiWalk(s2, [{ linkId: a2 }], { ...NO_RAF });
  const single = startWalk(s2, a2, { ...NO_RAF });
  assert.equal(m.running, false); assert.equal(single.running, true);
  const m2 = startMultiWalk(s2, [{ linkId: a2 }], { ...NO_RAF });
  assert.equal(single.running, false); assert.equal(m2.running, true);
  stopWalk();
});

test('multi walk without ping-pong finishes when every member has arrived, and calls onStop once', () => {
  const { st, a, b } = twoMics();
  let stops = 0;
  const w = startMultiWalk(st, [{ linkId: a, to: { x: 3, y: 2 } }, { linkId: b, to: { x: 6, y: 5 } }], { pingPong: false, speedMps: 1, onStop: () => { stops++; }, ...NO_RAF });
  w.step(2); // A has arrived (1 m), B at 2 of 3 m
  assert.equal(w.running, true);
  w.step(1.5);
  assert.equal(w.running, false); assert.equal(stops, 1);
  near(st.getScene().links[0].tx.pos.x, 3, 1e-9); near(st.getScene().links[1].tx.pos.y, 5, 1e-9);
});

test('multi walk of intermod-demo transmitters: reverse IM level follows the separation (6.02 dB per halving, tolerance 0.05 dB)', () => {
  const st = createStore(createDefaultScene());
  setImdEnabled(st, true);
  const txs = st.getScene().imd.transmitters;
  const [t0, t1] = txs;
  // keep it clean: only two transmitters, on the same y, 4 m apart, then walk t1 toward t0
  st.update((d) => {
    d.imd.transmitters = d.imd.transmitters.slice(0, 2);
    d.imd.transmitters[0].pos = { x: 2, y: 3, z: 1.5 };
    d.imd.transmitters[1].pos = { x: 6, y: 3, z: 1.5 };
  });
  // products generated in transmitter 0 (its radiation path to the receiver does not change while transmitter 1 walks)
  const worstRev = (scene) => Math.max(...txReverseImd(scene).filter((p) => p.order === 3 && p.pumpTx === t0.id).map((p) => p.levelDbm));
  const l4 = worstRev(st.getScene());
  const w = startMultiWalk(st, [{ imdId: t1.id, to: { x: 4, y: 3 }, speedMps: 1 }], { pingPong: false, ...NO_RAF }); // 2 m: halves the 4 m separation
  w.step(2);
  near(st.getScene().imd.transmitters[1].pos.x, 4, 1e-9);
  const l2 = worstRev(st.getScene());
  near(l2 - l4, 6.02, 0.05); // product power tracks the coupled power: +6.02 dB per halving of tx-tx distance (far field)
  assert.equal(t0.id, st.getScene().imd.transmitters[0].id);
});

test('multi walk mixes link and intermod-demo transmitters, and moving closer worsens the noise floor rise', () => {
  const st = createStore(createDefaultScene());
  setImdEnabled(st, true);
  const ids = st.getScene().imd.transmitters.map((t) => t.id);
  const linkId = st.getScene().links[0].id;
  const rise0 = noiseFloor(st.getScene()).riseDb;
  const startMic = { ...st.getScene().links[0].tx.pos };
  // the whole mic plan walks together toward the receive antenna: shared offset
  const w = startMultiWalk(st, [{ linkId }, ...ids.map((id) => ({ imdId: id }))], { offset: { x: 1, y: 0.5 }, speedMps: 1, pingPong: false, ...NO_RAF });
  assert.equal(w.items.length, 1 + ids.length);
  w.step(1.118033988749895); // |offset| = sqrt(1.25) -> arrives
  near(st.getScene().links[0].tx.pos.x, startMic.x + 1, 1e-9);
  near(st.getScene().links[0].tx.pos.y, startMic.y + 0.5, 1e-9);
  assert.equal(w.running, false);
  assert.ok(Number.isFinite(noiseFloor(st.getScene()).riseDb) && Number.isFinite(rise0));
});
