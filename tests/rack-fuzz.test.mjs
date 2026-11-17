// Seeded random edit sequences over the rack and people actions: the scene must stay valid and solvable after every step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene, validateScene } from '../js/model/scene.js';
import { solveLink } from '../js/model/rf.js';
import * as A from '../js/actions.js';
import * as R from '../js/actionsRack.js';
import { rackWarnings, tuningClashes } from '../js/model/rack.js';

function run(seed0, steps) {
  let seed = seed0; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const bad = new Map();
  const st = createStore(createDefaultScene());
const log = [];
for (let n = 0; n < steps; n++) {
  const s = st.getScene(), rk = s.rack || { antennas: [], splitters: [], receivers: [], transmitters: [], combiners: [] };
  const L = s.links.map((l) => l.id), mic = s.links.filter((l) => l.kind === 'mic').map((l) => l.id), iem = s.links.filter((l) => l.kind === 'iem').map((l) => l.id);
  const ant = rk.antennas.map((a) => a.id), sp = rk.splitters.map((x) => x.id), rx = rk.receivers.map((x) => x.id), cb = rk.combiners.map((x) => x.id), tx = rk.transmitters.map((x) => x.id);
  const acts = [
    ['addLink mic', () => A.addLink(st, 'mic')], ['addLink iem', () => A.addLink(st, 'iem')],
    ['removeLink', () => A.removeLink(st, pick(L))], ['addReceiverFor', () => A.addReceiverFor(st, pick(L))],
    ['addRackAntenna', () => R.addRackAntenna(st, {})], ['addTxAntenna', () => R.addRackAntenna(st, { role: 'tx' })],
    ['addSplitter', () => R.addRackSplitter(st, {})], ['addCombiner', () => R.addRackCombiner(st, {})],
    ['removeAnt', () => R.removeRackItem(st, 'antennas', pick(ant) )], ['removeSplit', () => R.removeRackItem(st, 'splitters', pick(sp))],
    ['connectChannel', () => R.connectChannel(st, pick(mic), rnd() < .5 ? { splitterId: pick(sp) } : { antA: pick(ant), antB: rnd() < .5 ? pick(ant) : null })],
    ['moveChannel', () => R.moveChannel(st, pick(mic), rnd() < .3 ? 'new' : pick(rx))],
    ['moveTxChannel', () => R.moveTxChannel(st, pick(iem), rnd() < .3 ? 'new' : pick(tx))],
    ['connectTx', () => R.connectTxChannel(st, pick(iem), rnd() < .5 ? { combinerId: pick(cb) } : { antennaId: pick(ant) })],
    ['setSplitterInput', () => R.setSplitterInput(st, pick(sp), pick(['A', 'B']), pick(ant))],
    ['setSplitterFeed', () => R.setSplitterFeed(st, pick(sp), rnd() < .3 ? null : pick(sp))],
    ['loop', () => R.setReceiverLoop(st, pick(rx), rnd() < .2 ? null : pick(rx))],
    ['fanout', () => R.setCombinerFanout(st, pick(cb), { on: rnd() < .7 })], ['fanoutOut', () => R.setFanoutOutput(st, pick(cb), Math.floor(rnd() * 4), rnd() < .2 ? null : { antennaId: pick(ant), cableM: rnd() * 30 })],
    ['setCombiner', () => R.setCombiner(st, pick(cb), { antennaId: pick(ant), cableM: rnd() * 20 })], ['removeCombiner', () => R.removeCombiner(st, pick(cb))],
    ['isolator', () => R.setTxIsolator(st, pick(iem), rnd() < .5, 30)], ['bias', () => R.setRxBias(st, pick(mic), { on: true, volts: 12 })],
    ['chainItem', () => R.addAntennaChainItem(st, pick(ant), { kind: 'cable' })], ['zones', () => R.setAntennaZones(st, pick(ant), [])],
    ['share', () => A.shareRxAntenna(st, pick(mic), pick(mic))], ['kind', () => A.setLinkKind(st, pick(L), pick(['mic', 'iem']))],
    ['addPerson', () => { const id = A.addPerson(st, { pos: { x: 0, y: 2 } }); if (id && L.length) A.assignMic(st, id, pick(mic)); }],
    ['assignExtra', () => { const p = st.getScene().people || []; if (p.length) A.assignExtraMic(st, pick(p).id, pick(L), { swap: true }); }],
    ['undo', () => st.undo && st.undo()],
  ];
  const [name, fn] = pick(acts);
  try { fn(); } catch (e) { if (!/pick|undefined/.test(String(e.message)) || !/Cannot read/.test(String(e.message))) { const k = 'THROW ' + name + ' ' + e.message.slice(0, 80); bad.set(k, (bad.get(k) || 0) + 1); } }
  const sc = st.getScene(); const v = validateScene(sc);
  if (!v.ok) { const k = 'INVALID after ' + name + ': ' + v.errors[0].slice(0, 100); bad.set(k, (bad.get(k) || 0) + 1); }
  if (!v.ok && !globalThis.shown) { globalThis.shown = 1; const all = [...sc.rack.antennas, ...sc.rack.splitters, ...sc.rack.receivers, ...sc.rack.transmitters, ...sc.rack.combiners].map((x) => x.id); console.log('DUP', name, all.filter((x, i) => all.indexOf(x) !== i || !/^[A-Za-z0-9_.:-]{1,64}$/.test(x)), v.errors[0]); }
  { const r = sc.rack; if (r) { const role = new Map(r.antennas.map((a) => [a.id, a.role === 'tx' ? 'tx' : 'rx']));
    const flag = (m) => { const k = 'SEMANTIC ' + m + ' after ' + name; bad.set(k, (bad.get(k) || 0) + 1); };
    for (const x of r.receivers) for (const c of x.channels) for (const id of [c.antA, c.antB]) if (id && role.get(id) === 'tx') flag('rx channel on tx antenna');
    for (const x of r.splitters) for (const id of [x.antA, x.antB]) if (id && role.get(id) === 'tx') flag('splitter on tx antenna');
    for (const x of r.transmitters) for (const c of x.channels) if (c.antennaId && role.get(c.antennaId) === 'rx') flag('tx channel on rx antenna');
    for (const cb of r.combiners) { if (cb.antennaId && role.get(cb.antennaId) === 'rx') flag('combiner on rx antenna'); for (const o of (cb.fanout ? cb.fanout.outputs : [])) if (o.antennaId && role.get(o.antennaId) === 'rx') flag('fanout on rx antenna'); }
    if (![...role.values()].includes('rx') && sc.links.some((l) => l.kind === 'mic')) flag('no rx antenna left'); } }
  try { for (const l of sc.links) { const r = solveLink(sc, l); if (r && !Number.isFinite(r.marginDb) && r.status !== 'n/a') { const k = 'NaN margin after ' + name; bad.set(k, (bad.get(k) || 0) + 1); } } rackWarnings(sc, () => 200); tuningClashes(sc, () => 200); } catch (e) { const k = 'CALC THROW after ' + name + ': ' + e.message.slice(0, 80); bad.set(k, (bad.get(k) || 0) + 1); }
}
  return [...bad.keys()];
}

test('random rack and people edits keep the scene valid and solvable', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) assert.deepEqual(run(seed, 250), [], `seed ${seed}`);
});
