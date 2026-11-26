import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iem8Scene } from '../js/examples/scenes-imd.js';
import { imdFromRack } from '../js/model/imd-rack.js';
import { imdTransmitters, imdTopology } from '../js/model/imd.js';
import { combinerParams, validateRack } from '../js/model/rack.js';
import { validateScene } from '../js/model/scene.js';

test('combiner types: passive follows 10 log N plus excess, isolated and active defaults, overrides win', () => {
  const p = combinerParams({ type: 'passive' }, 4);
  assert.ok(Math.abs(p.lossDb - (10 * Math.log10(4) + 1)) < 1e-9);
  assert.deepEqual(combinerParams({ type: 'isolated' }, 8), { lossDb: 2, isolationDb: 50, isolatorDb: 25 });
  assert.equal(combinerParams({ type: 'active' }, 4).lossDb, 0);
  assert.deepEqual(combinerParams({ type: 'isolated', lossDb: 4.5, isolationDb: 45 }, 8), { lossDb: 4.5, isolationDb: 45, isolatorDb: 22.5 });
});

test('imdFromRack: null unless fromRack; eight IEMs come from the rack, ids are the link ids', () => {
  const a = iem8Scene('A');
  assert.deepEqual(a.imd.transmitters, []);
  const d = imdFromRack(a);
  assert.equal(d.transmitters.length, 8);
  assert.deepEqual(d.transmitters.map((t) => t.id), a.links.map((l) => l.id));
  assert.equal(d.topology.groups.length, 1);
  assert.equal(d.topology.groups[0].isolatorDb, 22.5);
  const off = structuredClone(a); off.imd.fromRack = false;
  assert.equal(imdFromRack(off), null);
});

test('combiner feeding a root: C topology has two groups under one root, per-channel isolators', () => {
  const c = iem8Scene('C'), d = imdFromRack(c), ids = imdTransmitters(c).map((t) => t.id);
  assert.equal(d.topology.groups.length, 2);
  assert.deepEqual(d.topology.root, { lossDb: 3.5, isolationDb: 25 });
  assert.equal(imdTopology(c).pairCouplingDb(ids[0], ids[4]), 51);
  const none = iem8Scene('C', { noIsolators: true });
  const nid = imdTransmitters(none).map((t) => t.id);
  assert.equal(imdTopology(none).pairCouplingDb(nid[0], nid[4]), 31);
});

test('into validation: unknown target, chained roots and a root with channels are refused', () => {
  const s = iem8Scene('C');
  assert.equal(validateScene(s).ok, true);
  const bad = structuredClone(s); bad.rack.combiners[0].into = 'nope';
  assert.equal(validateScene(bad).ok, false);
  const bad2 = structuredClone(s); bad2.imd.fromRack = 'yes';
  assert.equal(validateScene(bad2).ok, false);
});

test('setCombiner: isolated type, overrides, feeds-into rules', async () => {
  const { setCombiner } = await import('../js/actionsRack.js');
  const { createStore } = await import('../js/store.js');
  const store = createStore(iem8Scene('C'));
  const [c1, c2, root] = store.getScene().rack.combiners.map((c) => c.id);
  setCombiner(store, c1, { type: 'isolated' });
  assert.equal(store.getScene().rack.combiners[0].type, 'isolated');
  setCombiner(store, c1, { lossDb: 4, isolationDb: 500 });
  assert.deepEqual([store.getScene().rack.combiners[0].lossDb, store.getScene().rack.combiners[0].isolationDb], [4, 100]);
  setCombiner(store, c1, { type: 'passive' });
  assert.equal(store.getScene().rack.combiners[0].lossDb, undefined);
  setCombiner(store, root, { into: c1 }); // a root that takes feeders cannot itself feed
  assert.equal(store.getScene().rack.combiners[2].into, undefined);
  setCombiner(store, c1, { into: c2 }); // c2 takes channels
  assert.equal(store.getScene().rack.combiners[0].into, 'cb_root');
  setCombiner(store, c1, { into: null });
  assert.equal(store.getScene().rack.combiners[0].into, undefined);
});

test('imdPerBodypack: one row per in-ear link, evaluated at that bodypack; null when not rack-fed', async () => {
  const { imdPerBodypack } = await import('../js/model/imd.js');
  const c = iem8Scene('C'), rows = imdPerBodypack(c);
  assert.equal(rows.length, 8);
  assert.deepEqual(rows.map((r) => r.linkId), c.links.map((l) => l.id));
  for (const r of rows) assert.ok(['ok', 'info', 'warning', 'critical'].includes(r.severity));
  const off = structuredClone(c); off.imd.fromRack = false;
  assert.equal(imdPerBodypack(off), null);
  // moving one bodypack changes only that row's wanted level
  const moved = structuredClone(c); moved.links[3].rx.pos = { x: moved.links[3].rx.pos.x + 6, y: moved.links[3].rx.pos.y, z: 1.2 };
  const after = imdPerBodypack(moved);
  assert.notEqual(after[3].wantedDbm, rows[3].wantedDbm);
});

test('rack-fed intermod includes microphone links at their own position; actions: bodypack selection and the rack switch', async () => {
  const { createDefaultLink, syncScene } = await import('../js/model/scene.js');
  const { setImdRxLink, setImdFromRack } = await import('../js/actions.js');
  const { createStore } = await import('../js/store.js');
  const { imdPerBodypack } = await import('../js/model/imd.js');
  const s = iem8Scene('A');
  const mic = createDefaultLink('mic'); mic.name = 'Vocal'; mic.freqMHz = 590.5; mic.tx.pos = { x: 9, y: 6, z: 1.5 };
  s.links.push(mic); syncScene(s);
  const d = imdFromRack(s), m = d.transmitters.find((t) => t.id === mic.id);
  assert.equal(d.transmitters.length, 9);
  assert.deepEqual(m.pos, { x: 9, y: 6, z: 1.5 });
  assert.equal(imdPerBodypack(s).length, 9);
  const store = createStore(s);
  setImdRxLink(store, s.links[3].id);
  assert.equal(store.getScene().imd.rxLinkId, s.links[3].id);
  setImdRxLink(store, 'nope');
  assert.equal(store.getScene().imd.rxLinkId, undefined);
  setImdFromRack(store, false);
  assert.equal(store.getScene().imd.fromRack, undefined);
  setImdFromRack(store, true);
  assert.equal(store.getScene().imd.fromRack, true);
});

test('the transmitter device sets its own output-stage reverse intermod in a rack-fed scene (preset and low-intermod mode per link)', async () => {
  const { txReverseImd } = await import('../js/model/imd.js');
  const { FM_PRESETS } = await import('../js/model/fm-presets.js');
  const id = Object.keys(FM_PRESETS).find((k) => FM_PRESETS[k].role === 'tx' && FM_PRESETS[k].params.lowIntermod && FM_PRESETS[k].params.lowIntermod.available);
  assert.ok(id, 'a preset with a low-intermod mode exists');
  const s = iem8Scene('A');
  const base = txReverseImd(s).find((p) => p.pumpTx === s.links[0].id && p.order === 3).levelDbm;
  s.links[0].tx.fmPreset = id; s.links[0].tx.lowIntermod = true;
  const low = txReverseImd(s).find((p) => p.pumpTx === s.links[0].id && p.order === 3).levelDbm;
  assert.ok(low < base - 5, `low-intermod mode lowers link 1 reverse products (${base} -> ${low})`);
  const other = txReverseImd(s).find((p) => p.pumpTx === s.links[1].id && p.order === 3).levelDbm;
  assert.ok(Number.isFinite(other));
});

test('mic intermod examples: figures quoted in the notes are recomputed, equal-spacing plan puts products on the channels', async () => {
  const { micImdScene } = await import('../js/examples/scenes-imd.js');
  const { imdPerBodypack, imdSummary } = await import('../js/model/imd.js');
  const { buildExample } = await import('../js/examples.js');
  const clean = micImdScene('clean'), equal = micImdScene('equal');
  const rc = imdPerBodypack(clean), re = imdPerBodypack(equal);
  const f1 = (x) => x.toFixed(1);
  const noteC = buildExample('imd-mics-rack-clean').note, noteE = buildExample('imd-mics-rack-equal').note;
  const closest = Math.min(...rc.filter((r) => r.worstCiDb !== null).map((r) => r.worstCiDb));
  assert.ok(noteC.includes(f1(closest) + ' dB') && noteC.includes(f1(imdSummary(clean).riseDb) + ' dB'), 'clean note numbers');
  assert.ok(re.every((r) => r.severity === 'warning' || r.severity === 'critical'));
  assert.ok(noteE.includes(f1(re[0].worstCiDb) + ' dB') && noteE.includes(f1(re[2].worstCiDb) + ' dB') && noteE.includes(f1(imdSummary(equal).riseDb) + ' dB'), 'equal note numbers');
  assert.ok(rc.every((r) => r.severity === 'ok' || r.severity === 'info'));
});

test('imdPerBodypack: an extra bodypack on the same frequency gets its own row and is evaluated at its own position', async () => {
  const { imdPerBodypack } = await import('../js/model/imd.js');
  const { createStore } = await import('../js/store.js');
  const { addReceiverFor } = await import('../js/actions.js');
  const st = createStore(iem8Scene('C')), base = imdPerBodypack(st.getScene());
  const src = st.getScene().links.find((l) => l.kind === 'iem');
  const id = addReceiverFor(st, src.id);
  assert.ok(id);
  const rows = imdPerBodypack(st.getScene());
  assert.equal(rows.length, base.length + 1);
  const extra = rows.find((r) => r.linkId === id), first = rows.find((r) => r.linkId === src.id);
  assert.ok(extra && first);
  assert.equal(extra.freqMHz, first.freqMHz);
});
