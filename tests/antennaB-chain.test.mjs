import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene, createDefaultLink, validateScene, migrateScene, deserialize, serialize } from '../js/model/scene.js';
import { solveLink, chainLossDb } from '../js/model/rf.js';
import { solveDiversity, diversityStep } from '../js/model/diversity.js';
import { createSquelchTracker } from '../js/squelchTracker.js';
import { createRxTracker } from '../js/rxTracker.js';
import { createHistory } from '../js/history.js';
import { buildExample } from '../js/examples.js';
import * as A from '../js/actions.js';

const micScene = () => {
  const s = createDefaultScene();
  s.links[0].rx.diversity.enabled = true;
  return s;
};

test('default: antenna B follows A (chain null), old scenes migrate to null, results unchanged', () => {
  const s = micScene();
  assert.equal(s.links[0].rx.diversity.antennaB.chain, null);
  const { a, b } = solveDiversity(s, s.links[0]);
  // B differs from A only by position, never by cable: same chain loss in both waterfalls
  const cable = (r) => r.waterfall.find((w) => w.label.startsWith('Cable')).deltaDb;
  assert.equal(cable(a), cable(b));
  const old = structuredClone(s);
  delete old.links[0].rx.diversity.antennaB.chain;
  assert.equal(validateScene(old).ok, true);
  assert.equal(migrateScene(old).links[0].rx.diversity.antennaB.chain, null);
  assert.deepEqual(deserialize(serialize(s)), s);
  const before = solveLink(s, s.links[0]);
  const m = migrateScene(old);
  assert.equal(solveLink(m, m.links[0]).inputPowerDbm, before.inputPowerDbm);
});

test('own chain changes B only; A and the main chain are untouched (copy on write)', () => {
  const st = createStore(micScene());
  const id = st.getScene().links[0].id;
  const aBefore = solveDiversity(st.getScene(), st.getScene().links[0]).a.inputPowerDbm;
  const sameB = solveDiversity(st.getScene(), st.getScene().links[0]).b.inputPowerDbm;
  A.setAntennaBChainMode(st, id, 'own');
  let l = st.getScene().links[0];
  assert.ok(Array.isArray(l.rx.diversity.antennaB.chain));
  assert.deepEqual(l.rx.diversity.antennaB.chain.map((c) => [c.kind, c.cableType, c.lengthM]), l.chain.map((c) => [c.kind, c.cableType, c.lengthM]));
  assert.notEqual(l.rx.diversity.antennaB.chain[0].id, l.chain[0].id); // fresh ids
  assert.equal(solveDiversity(st.getScene(), l).b.inputPowerDbm, sameB); // identical copy changes nothing
  A.setLinkField(st, id, 'rx.diversity.antennaB.chain.0.lengthM', 45);
  l = st.getScene().links[0];
  assert.equal(l.chain[0].lengthM, 15); // main chain untouched
  assert.equal(l.rx.diversity.antennaB.chain[0].lengthM, 45);
  const r = solveDiversity(st.getScene(), l);
  assert.equal(r.a.inputPowerDbm, aBefore);
  assert.ok(r.b.inputPowerDbm < sameB - 5);
  assert.ok(r.b.cascade.systemNfDb > r.a.cascade.systemNfDb);
  assert.ok(r.b.marginDb < r.a.marginDb);
  assert.equal(solveLink(st.getScene(), l).inputPowerDbm, aBefore); // solveLink is antenna A
  A.setAntennaBChainMode(st, id, 'same');
  assert.equal(st.getScene().links[0].rx.diversity.antennaB.chain, null);
  assert.equal(solveDiversity(st.getScene(), st.getScene().links[0]).b.inputPowerDbm, sameB);
  assert.equal(A.setAntennaBChainMode(st, id, 'sideways'), false);
});

test('IEM links ignore antennaB.chain', () => {
  const s = createDefaultScene();
  s.links = [createDefaultLink('iem')];
  s.links[0].rx.diversity.enabled = true;
  const base = solveDiversity(s, s.links[0]).b.inputPowerDbm;
  s.links[0].rx.diversity.antennaB.chain = [{ id: 'x1', kind: 'attenuator', lossDb: 30 }];
  assert.equal(validateScene(s).ok, true);
  assert.equal(solveDiversity(s, s.links[0]).b.inputPowerDbm, base);
});

test('validation: chain must be null or an array of valid items; migration fills ids', () => {
  const s = micScene();
  s.links[0].rx.diversity.antennaB.chain = [{ id: 'c1', kind: 'cable', cableType: 'rg58', lengthM: 5 }];
  assert.equal(validateScene(s).ok, true);
  s.links[0].rx.diversity.antennaB.chain = [{ id: 'c1', kind: 'magic' }];
  assert.equal(validateScene(s).ok, false);
  s.links[0].rx.diversity.antennaB.chain = 'long';
  assert.equal(validateScene(s).ok, false);
  s.links[0].rx.diversity.antennaB.chain = [{ id: 7, kind: 'filter', lossDb: 1 }];
  assert.equal(validateScene(s).ok, false);
  const t = micScene();
  t.links[0].rx.diversity.antennaB.chain = [{ kind: 'filter', lossDb: 1 }, { id: 'd', kind: 'filter', lossDb: 1 }, { id: 'd', kind: 'filter', lossDb: 1 }];
  const m = migrateScene(t);
  const ids = m.links[0].rx.diversity.antennaB.chain.map((c) => c.id);
  assert.equal(new Set(ids).size, 3);
  assert.equal(validateScene(m).ok, true);
});

test('chain actions with target antennaB; main calls unchanged', () => {
  const st = createStore(micScene());
  const id = st.getScene().links[0].id;
  assert.equal(A.addChainItem(st, id, 'booster', undefined, { target: 'antennaB' }), null); // no own chain yet
  assert.equal(st.getScene().links[0].rx.diversity.antennaB.chain, null);
  A.setAntennaBChainMode(st, id, 'own');
  const b1 = A.addChainItem(st, id, { kind: 'booster', gainDb: 8 }, 0, { target: 'antennaB' });
  assert.ok(b1);
  const l = st.getScene().links[0];
  assert.deepEqual(l.rx.diversity.antennaB.chain.map((c) => c.kind), ['booster', 'cable']);
  assert.equal(l.chain.length, 1); // main untouched
  const m1 = A.addChainItem(st, id, 'filter'); // default target main
  assert.equal(st.getScene().links[0].chain.length, 2);
  assert.equal(st.getScene().links[0].rx.diversity.antennaB.chain.length, 2);
  A.moveChainItem(st, id, b1, 5, { target: 'antennaB' });
  assert.deepEqual(st.getScene().links[0].rx.diversity.antennaB.chain.map((c) => c.kind), ['cable', 'booster']);
  A.removeChainItem(st, id, b1, { target: 'antennaB' });
  assert.deepEqual(st.getScene().links[0].rx.diversity.antennaB.chain.map((c) => c.kind), ['cable']);
  A.removeChainItem(st, id, m1);
  assert.equal(st.getScene().links[0].chain.length, 1);
  assert.equal(validateScene(st.getScene()).ok, true);
});

test('rx tracker and history expose each antenna cable loss', () => {
  const st = createStore(micScene());
  const sq = createSquelchTracker(), rx = createRxTracker();
  rx.install(sq); sq.attach(st);
  const id = st.getScene().links[0].id;
  const l0 = st.getScene().links[0];
  const same = rx.get(id).diversity;
  assert.equal(same.cableLossADb, same.cableLossBDb);
  assert.ok(Math.abs(same.cableLossADb - chainLossDb(l0.chain, l0.freqMHz)) < 1e-9);
  A.setAntennaBChainMode(st, id, 'own');
  A.setLinkField(st, id, 'rx.diversity.antennaB.chain.0.lengthM', 60);
  const d = rx.get(id).diversity;
  assert.ok(d.cableLossBDb > d.cableLossADb + 10);
  const h = createHistory({ now: () => 1 });
  h.sampleOnce(st, sq, 1);
  const s = h.get(id, 5)[0];
  assert.equal(s.cableLossADb, d.cableLossADb);
  assert.equal(s.cableLossBDb, d.cableLossBDb);
});

test('example: different cable runs give B its own level, and switching moves to B only in the fade', () => {
  const ex = buildExample('diversity-cable-runs');
  assert.deepEqual(validateScene(ex.scene), { ok: true, errors: [] });
  const l = ex.scene.links[0];
  assert.ok(Math.abs(chainLossDb(l.chain, l.freqMHz) - 2.1) < 0.1);
  assert.ok(Math.abs(chainLossDb(l.rx.diversity.antennaB.chain, l.freqMHz) - 11.0) < 0.2);
  const from = { ...l.tx.pos };
  let prev = null, switches = 0, onB = 0, n = 0, aOnB = -Infinity;
  for (let i = 0; i <= 40; i++) {
    l.tx.pos = { ...from, x: from.x + (ex.walk.to.x - from.x) * (i / 40) };
    const { a, b } = solveDiversity(ex.scene, l);
    prev = diversityStep(prev, a.inputPowerDbm, b.inputPowerDbm, { mode: 'switching', hysteresisDb: 3, switchMs: 30 }, i * 1000);
    if (prev.switched) switches++;
    if (prev.active === 'B') { onB++; aOnB = Math.max(aOnB, a.inputPowerDbm - b.inputPowerDbm); }
    n++;
  }
  assert.ok(switches >= 2 && switches <= 4, 'switches ' + switches);
  assert.ok(onB > 0 && onB < n / 2, 'B used for ' + onB + ' of ' + n + ' steps');
  assert.ok(aOnB < 3, 'B is only selected while A is within the hysteresis of it');
});
