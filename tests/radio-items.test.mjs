import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExample } from '../js/examples.js';
import { createStore } from '../js/store.js';
import { solveLink } from '../js/model/rf.js';
import { rackSections } from '../js/model/rack.js';
import { signalFlow, statusOf, bandOf, nextFreeFrequency, radioChecks, LONG_RUN_DB } from '../js/model/radio-items.js';
import { inventoryRows, inventoryTotals, packListText } from '../js/model/inventory.js';
import { checkIntermod } from '../js/model/coordination.js';
import { shareRxAntenna, addLink, setTxFmPreset } from '../js/actions.js';
import { adoptRack, addRackAntenna, addAntennaChainItem, setAntennaChainItem, addRackCombiner, connectTxChannel, addRackSplitter, setSplitterInput, connectChannel } from '../js/actionsRack.js';

const mk = () => createStore(buildExample('band-four-piece-people').scene);
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('signalFlow: a mic link ends on the receiver input and passes the receive antenna at rxPowerDbm, as the Budgets panel', () => {
  const s = mk(); adoptRack(s);
  const ant = s.getScene().rack.antennas[0].id;
  addAntennaChainItem(s, ant, { kind: 'cable' }); addAntennaChainItem(s, ant, { presetId: 'booster-12' });
  for (const l of s.getScene().links) {
    const r = solveLink(s.getScene(), l), f = signalFlow(l, r);
    assert.ok(f, l.name);
    const st = f.stages;
    assert.equal(st[0].levelDbm, l.tx.powerDbm);
    assert.ok(near(st.find((x) => x.key === 'rxant').levelDbm, r.rxPowerDbm, 1e-6), `${l.name} rx antenna level`);
    assert.ok(near(st[st.length - 1].levelDbm, r.inputPowerDbm, 1e-6), `${l.name} input level`);
    for (let i = 1; i < st.length - 1; i++) assert.ok(near(st[i].levelDbm, st[i - 1].levelDbm + st[i].deltaDb, 1e-6), `${l.name} stage ${st[i].label} adds up`);
    assert.equal(f.marginDb, r.marginDb);
  }
  const fed = s.getScene().links.find((l) => l.kind === 'mic' && l.chain.some((c) => c.kind === 'booster'));
  const labels = signalFlow(fed, solveLink(s.getScene(), fed)).stages.map((x) => x.label);
  assert.ok(labels.indexOf('Cable') < labels.indexOf('Booster'), labels.join(' > '));
});

test('signalFlow: an IEM puts its transmit chain (combiner, cable) before the transmit antenna', () => {
  const s = mk(), sc = s.getScene(), iem = sc.links.find((l) => l.kind === 'iem');
  assert.ok(iem, 'example has an IEM');
  adoptRack(s); const cb = addRackCombiner(s, { cableM: 10 });
  connectTxChannel(s, iem.id, { combinerId: cb });
  const l = s.getScene().links.find((q) => q.id === iem.id), r = solveLink(s.getScene(), l), f = signalFlow(l, r);
  const keys = f.stages.map((x) => x.label);
  assert.ok(keys.indexOf('Combiner') > 0 && keys.indexOf('Combiner') < keys.indexOf('Tx ant'), keys.join(' > '));
  assert.ok(keys.indexOf('Cable') < keys.indexOf('Tx ant'));
  assert.ok(near(f.stages[f.stages.length - 1].levelDbm, r.inputPowerDbm, 1e-6));
  assert.ok(near(f.stages.find((x) => x.key === 'rxant').levelDbm, r.rxPowerDbm, 1e-6));
});

test('statusOf: fail beats warn, info notes do not count', () => {
  assert.equal(statusOf({ status: 'fail' }, []), 'fail');
  assert.equal(statusOf({ status: 'pass' }, [{ level: 'warn' }]), 'warn');
  assert.equal(statusOf({ status: 'marginal' }, []), 'warn');
  assert.equal(statusOf({ status: 'pass' }, [{ level: 'info' }]), 'ok');
  assert.equal(statusOf(null, null), 'ok');
});

test('bandOf names the model tuning range, or the plain band without a model', () => {
  const s = mk(), l = s.getScene().links.find((q) => q.kind === 'mic');
  setTxFmPreset(s, l.id, 'sennheiser-skm5200ii');
  const m = s.getScene().links.find((q) => q.id === l.id);
  const b = bandOf({ ...m, freqMHz: 600 });
  assert.equal(b.inWindow, true); assert.equal(b.id, 'L');
  assert.equal(bandOf({ ...m, freqMHz: 900 }).inWindow, false);
  assert.match(bandOf({ kind: 'mic', freqMHz: 600, tx: {} }).label, /470-608/);
});

test('nextFreeFrequency picks a frequency clear of the show third-order products and inside the range', () => {
  const sc = buildExample('band-four-piece-people').scene;
  const n = nextFreeFrequency(sc, { kind: 'mic' });
  assert.equal(n.level, 'clean');
  const freqs = sc.links.filter((l) => l.kind !== 'p2p' && l.txOf === undefined).map((l) => l.freqMHz);
  const chk = checkIntermod([...freqs, n.freqMHz], { guardKHz: n.clearanceKHz - 1 });
  assert.ok(!chk.conflicts.some((c) => Math.abs(c.fMHz - n.freqMHz) < (n.clearanceKHz - 1) / 1000 || c.tones.includes(n.freqMHz)), JSON.stringify(chk.conflicts.slice(0, 3)));
  assert.ok(freqs.every((f) => Math.abs(f - n.freqMHz) >= 0.3 - 1e-9));
  assert.ok(n.freqMHz >= n.window.fromMHz && n.freqMHz <= n.window.toMHz);
  // a model with a tuning step keeps the result on its grid
  const s = mk(), l = s.getScene().links.find((q) => q.kind === 'mic');
  setTxFmPreset(s, l.id, 'sennheiser-skm5200ii');
  const g = nextFreeFrequency(s.getScene(), { kind: 'mic', refLinkId: l.id });
  assert.ok(Math.abs(((g.freqMHz - 470) * 1000) / 5 - Math.round(((g.freqMHz - 470) * 1000) / 5)) < 1e-6);
  // repeated use gives distinct, still-spaced frequencies
  const st = mk(); const got = [];
  for (let i = 0; i < 6; i++) { const f = nextFreeFrequency(st.getScene(), { kind: 'mic' }).freqMHz; got.push(f); addLink(st, 'mic', { freqMHz: f }); }
  assert.equal(new Set(got).size, 6);
  const all = st.getScene().links.filter((l) => l.kind !== 'p2p').map((l) => l.freqMHz);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(Math.abs(all[i] - all[j]) >= 0.3 - 1e-9 || !got.includes(all[i]) && !got.includes(all[j]));
});

test('nextFreeFrequency falls back to spacing only when a tiny range cannot be third-order clean', () => {
  const sc = { links: [600, 600.3, 600.6].map((f, i) => ({ id: `l${i}`, kind: 'mic', freqMHz: f, tx: {} })) };
  const n = nextFreeFrequency(sc, { kind: 'mic', levels: [400] });
  assert.ok(['clean', 'spacing'].includes(n.level));
  assert.ok(sc.links.every((l) => Math.abs(l.freqMHz - n.freqMHz) >= 0.3 - 1e-9));
  const empty = nextFreeFrequency({ links: [] }, { kind: 'iem' });
  assert.ok(Number.isFinite(empty.freqMHz));
});

test('nextFreeFrequency with nearMHz retunes to the nearest clean frequency, either side, not the bottom of the range', () => {
  const sc = buildExample('band-four-piece-people').scene;
  const l = sc.links.find((q) => q.kind === 'mic'), rest = { ...sc, links: sc.links.filter((q) => q.id !== l.id && q.txOf !== l.id) };
  const n = nextFreeFrequency(rest, { kind: 'mic', refLinkId: undefined, nearMHz: 606.2 });
  assert.equal(n.level, 'clean');
  assert.ok(Math.abs(n.freqMHz - 606.2) < 10, `stays near 606.2 MHz, got ${n.freqMHz}`);
  const freqs = rest.links.filter((q) => q.kind !== 'p2p' && q.txOf === undefined).map((q) => q.freqMHz);
  assert.ok(freqs.every((f) => Math.abs(f - n.freqMHz) >= 0.3 - 1e-9));
});

test('radioChecks: unconnected antennas, outside the tuning range, long cable run', () => {
  const s = mk(); adoptRack(s);
  const extra = addRackAntenna(s), tx = addRackAntenna(s, { role: 'tx' });
  let w = radioChecks(s.getScene());
  assert.ok(w.some((x) => x.key === `antenna:${extra}` && /not connected/.test(x.text)));
  assert.ok(w.some((x) => x.key === `txantenna:${tx}` && /not connected/.test(x.text)));
  const l = s.getScene().links.find((q) => q.kind === 'mic');
  setTxFmPreset(s, l.id, 'sennheiser-skm5200ii');
  s.update((d) => { d.links.find((q) => q.id === l.id).freqMHz = 900; });
  w = radioChecks(s.getScene());
  assert.ok(w.some((x) => x.key === `mic:${l.id}` && x.level === 'warn' && /outside the tuning range/.test(x.text)));
  const a0 = s.getScene().rack.antennas.find((a) => a.role !== 'tx').id;
  const ci = (() => { addAntennaChainItem(s, a0, { kind: 'cable' }); return s.getScene().rack.antennas.find((a) => a.id === a0).chain.at(-1).id; })();
  setAntennaChainItem(s, a0, ci, { cableType: 'rg58', lengthM: 60 });
  w = radioChecks(s.getScene());
  assert.ok(w.some((x) => x.key === `antenna:${a0}` && x.text.includes('cable run loses')), `long run over ${LONG_RUN_DB} dB`);
  addAntennaChainItem(s, a0, { presetId: 'booster-12' }); // after the cable: the loss ahead of it is the same
  s.update((d) => { const a = d.rack.antennas.find((x) => x.id === a0); a.chain.unshift(a.chain.pop()); }); // booster at the antenna end
  assert.ok(!radioChecks(s.getScene()).some((x) => x.key === `antenna:${a0}` && x.text.includes('cable run loses')));
});

test('radioChecks: two IEM transmitters wired straight to one antenna need a combiner', () => {
  const s = mk(); adoptRack(s);
  assert.ok(!radioChecks(s.getScene()).some((x) => /cannot share one antenna/.test(x.text)), 'one antenna each: no warning');
  const [a, b] = s.getScene().links.filter((l) => l.kind === 'iem' && l.txOf === undefined);
  const ta = s.getScene().rack.transmitters.flatMap((t) => t.channels).find((c) => c.linkId === a.id).antennaId;
  connectTxChannel(s, b.id, { antennaId: ta });
  const w = radioChecks(s.getScene()).filter((x) => /cannot share one antenna/.test(x.text));
  assert.ok(w.some((x) => x.key === `txantenna:${ta}` && x.level === 'warn'));
  assert.ok(w.some((x) => x.key === `transmitter:${b.id}`));
  const cb = addRackCombiner(s); connectTxChannel(s, a.id, { combinerId: cb }); connectTxChannel(s, b.id, { combinerId: cb });
  s.update((d) => { d.rack.combiners.find((c) => c.id === cb).antennaId = ta; });
  assert.ok(!radioChecks(s.getScene()).some((x) => /cannot share one antenna/.test(x.text)), 'through a combiner: fine');
});

test('rackSections lists the IEM side in signal order: transmitters, combiners, transmit antennas, bodypacks', () => {
  const s = mk(); adoptRack(s); addRackCombiner(s);
  const keys = rackSections(s.getScene()).map((x) => x.key);
  const at = (k) => keys.indexOf(k);
  assert.ok(at('iems') >= 0 && at('iems') < at('combiners') && at('combiners') < at('txant') && at('txant') < at('bodypacks'), keys.join(','));
  assert.ok(at('rxant') < at('splitters') || at('splitters') < 0);
});

test('inventory with a rack counts a shared antenna, its cable run and the splitter once', () => {
  const s = mk(), [a, b] = s.getScene().links.filter((l) => l.kind === 'mic');
  shareRxAntenna(s, b.id, a.id); adoptRack(s);
  const ant = s.getScene().rack.antennas.find((x) => x.role !== 'tx');
  const sp = addRackSplitter(s); setSplitterInput(s, sp, 'A', ant.id);
  for (const l of s.getScene().links.filter((q) => q.kind === 'mic')) connectChannel(s, l.id, { splitterId: sp });
  addAntennaChainItem(s, ant.id, { kind: 'cable' });
  const sc = s.getScene(), t = inventoryTotals(inventoryRows(sc), sc);
  const nRx = sc.rack.antennas.filter((x) => x.role !== 'tx' && x.antenna.type !== 'body').length;
  const micRxAnts = t.antennas.reduce((n, x) => n + x.count, 0);
  const nTx = sc.rack.antennas.filter((x) => x.role === 'tx' && !x.load && x.antenna.type !== 'body').length;
  const handhelds = sc.links.filter((l) => l.kind === 'mic' && l.txOf === undefined && l.tx.antenna && l.tx.antenna.type !== 'body').length;
  const packs = sc.links.filter((l) => l.kind === 'iem' && l.rx.antenna && l.rx.antenna.type !== 'body').length;
  assert.equal(micRxAnts, nRx + nTx + handhelds + packs);
  const cableRuns = t.cables.reduce((n, x) => n + x.count, 0);
  const own = sc.links.reduce((n, l) => n + (l.chain || []).filter((c) => c.kind === 'cable' && !c.rackSplitter).length, 0);
  assert.ok(sc.links.filter((l) => l.kind === 'mic').every((l) => l.chain.some((c) => c.rackSplitter && c.kind === 'cable')), 'every mic carries a copy of the run');
  assert.equal(cableRuns, own + 1, 'the antenna cable run counts once, not once per mic it feeds');
  assert.equal(t.splitters.reduce((n, x) => n + x.count, 0), sc.rack.splitters.length);
  assert.equal(t.units.receivers, sc.rack.receivers.length);
  const txt = packListText(t);
  assert.match(txt, /^Pack list\n/); assert.match(txt, /Antennas: /); assert.match(txt, new RegExp(`Splitters: ${sc.rack.splitters.length} x Passive antenna splitter`));
});

test('inventory without a rack is unchanged by the rack counting', () => {
  const sc = buildExample('band-four-piece-people').scene, t = inventoryTotals(inventoryRows(sc), sc);
  assert.equal(t.units, null); assert.deepEqual(t.splitters, []); assert.deepEqual(t.combiners, []);
  const cables = sc.links.reduce((n, l) => n + (l.chain || []).filter((c) => c.kind === 'cable').length, 0);
  assert.equal(t.cables.reduce((n, x) => n + x.count, 0), cables);
});
