import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene, createDefaultLink, validateScene } from '../js/model/scene.js';
import { createSquelchTracker } from '../js/squelchTracker.js';
import { createRxTracker } from '../js/rxTracker.js';
import { createMpxTracker } from '../js/mpxTracker.js';
import { createDigitalTracker, digitalConfig } from '../js/digitalTracker.js';
import { createHistory } from '../js/history.js';
import { buildExample } from '../js/examples.js';
import { setModulation, setLinkField } from '../js/actions.js';

function rig(scene) {
  let t = 0;
  const st = createStore(scene);
  const sq = createSquelchTracker();
  const rx = createRxTracker();
  const mp = createMpxTracker();
  const dg = createDigitalTracker({ now: () => t });
  rx.install(sq); mp.install(sq); dg.install(sq, { start: false });
  sq.attach(st);
  return { st, sq, mp, dg, id: scene.links[0].id, advance: (ms) => { t += ms; } };
}

const iemScene = () => {
  const s = createDefaultScene();
  s.links = [createDefaultLink('iem')];
  return s;
};

test('modulation defaults: existing and new links are analog-fm; setModulation validates input', () => {
  const l = createDefaultLink('iem');
  assert.equal(l.modulation.type, 'analog-fm');
  assert.deepEqual(l.modulation.digital, { preset: 'iem-ofdm-like-adaptive', fixedOrder: null, overrides: {} });
  const { st, id } = rig(iemScene());
  setModulation(st, id, { type: 'digital', preset: 'wideband-adaptive', fixedOrder: 64 });
  assert.deepEqual(st.getScene().links[0].modulation, { type: 'digital', digital: { preset: 'wideband-adaptive', fixedOrder: 64, overrides: {} } });
  assert.equal(setModulation(st, id, { type: 'bogus', fixedOrder: 7 }), false);
  assert.equal(validateScene(st.getScene()).ok, true);
  assert.equal(digitalConfig(st.getScene().links[0]).fixedOrder, 64);
  setModulation(st, id, { fixedOrder: null });
  assert.equal(digitalConfig(st.getScene().links[0]).fixedOrder, null);
});

test('analog features apply to analog links only; digital state to digital links only', () => {
  const { st, mp, dg, sq, id } = rig(iemScene());
  assert.ok(mp.get(id));
  assert.equal(dg.get(id), null);
  assert.equal(sq.get(id).digital, null);
  setModulation(st, id, { type: 'digital' });
  assert.equal(mp.get(id), null); // hidden, not an error
  assert.ok(dg.get(id));
  assert.equal(sq.get(id).mpx, null);
  setLinkField(st, id, 'mpx.pilotSquelch', true); // ignored for digital links
  assert.equal(sq.get(id).open, true);
  setModulation(st, id, { type: 'analog-fm' });
  assert.equal(dg.get(id), null);
  assert.ok(mp.get(id));
});

test("digital link going down closes the squelch with reason 'digital'", () => {
  const { st, sq, dg, id } = rig(iemScene());
  setModulation(st, id, { type: 'digital' });
  setLinkField(st, id, 'rx.squelch.thresholdDbm', -400); // carrier squelch stays open
  assert.equal(sq.get(id).open, true);
  assert.ok(['ok', 'degraded'].includes(dg.get(id).state));
  const p0 = st.getScene().links[0].tx.powerDbm;
  setLinkField(st, id, 'tx.powerDbm', p0 - 100);
  const s = sq.get(id);
  assert.equal(dg.get(id).state, 'down');
  assert.equal(s.open, false);
  assert.equal(s.reason, 'digital');
  setLinkField(st, id, 'tx.powerDbm', p0);
  assert.equal(sq.get(id).open, true);
  assert.equal(sq.get(id).reason, null);
});

test('adaptive modulation steps down with distance and history carries digital fields', () => {
  const ex = buildExample('adaptive-modulation');
  const { st, sq, dg, id } = rig(ex.scene);
  const from = { ...ex.scene.links[0].rx.pos };
  const orders = [];
  for (let i = 0; i <= 24; i++) {
    const f = i / 24;
    st.update((d) => { d.links[0].rx.pos = { x: from.x + (ex.walk.to.x - from.x) * f, y: from.y + (ex.walk.to.y - from.y) * f, z: from.z }; });
    orders.push(dg.get(id).order);
  }
  assert.equal(orders[0], 256);
  assert.equal(orders[orders.length - 1], 0);
  for (let i = 1; i < orders.length; i++) assert.ok(orders[i] <= orders[i - 1], 'orders never rise while walking away: ' + orders.join(','));
  assert.ok(orders.includes(64) && orders.includes(16) && orders.includes(4));
  const h = createHistory({ now: () => 1 });
  h.sampleOnce(st, sq, 1);
  const s = h.get(id, 5)[0];
  for (const k of ['digitalOrder', 'preFecBer', 'postFecBer', 'evmPercent', 'merDb', 'digitalState', 'throughputKbps']) assert.ok(k in s, k);
  assert.equal(s.digitalState, 'down');
  assert.equal(s.open, false);
  // analog link: digital fields neutral
  const a = rig(iemScene());
  const h2 = createHistory({ now: () => 1 });
  h2.sampleOnce(a.st, a.sq, 1);
  const p = h2.get(a.id, 5)[0];
  assert.equal(p.digitalOrder, 0);
  assert.equal(p.digitalState, null);
  assert.ok(Number.isNaN(p.postFecBer));
});

test('digital examples show cliff behaviour: constant order or graceful steps, then down', () => {
  for (const id of ['digital-vs-analog', 'digital-cuts-out', 'constellation-noise']) {
    const ex = buildExample(id);
    assert.equal(ex.scene.links[0].modulation.type, 'digital', id);
    const { st, dg, id: lid } = rig(ex.scene);
    const l = ex.scene.links[0];
    const key = l.kind === 'iem' ? 'rx' : 'tx';
    const from = { ...l[key].pos };
    const evm = [];
    let down = false;
    for (let i = 0; i <= 24; i++) {
      const f = i / 24;
      st.update((d) => { d.links[0][key].pos = { x: from.x + (ex.walk.to.x - from.x) * f, y: from.y + (ex.walk.to.y - from.y) * f, z: from.z }; });
      evm.push(dg.get(lid).evmPercent);
      if (dg.get(lid).state === 'down') down = true;
    }
    assert.ok(down, id + ' should reach the cliff');
    assert.ok(evm[evm.length - 1] > evm[0] * 3, id + ' EVM grows with distance');
  }
});
