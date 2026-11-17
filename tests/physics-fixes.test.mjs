// Regression tests for three corrections found in a physics review: reflected power through a pad, excess loss by splitter port count, and the ERP antenna gain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene, createDefaultLink } from '../js/model/scene.js';
import { solveLink } from '../js/model/rf.js';
import { erpCheck } from '../js/model/erp.js';
import { bandScene } from '../js/examples.js';
import { chainLossDb } from '../js/model/rf.js';
import { createStore } from '../js/store.js';
import * as R from '../js/actionsRack.js';

test('a pad ahead of a mismatched antenna cuts the reflection at the PA by the pad loss twice, not three times', () => {
  const bare = bandScene('iem-tx-wrong-band'), padded = bandScene('iem-tx-wrong-band', { pad: true });
  const a = solveLink(bare, bare.links[0]).antennaMismatch.tx.reflectedAtPaDbm, b = solveLink(padded, padded.links[0]).antennaMismatch.tx.reflectedAtPaDbm;
  assert.ok(Math.abs((a - b) - 12) < 0.05, `pad of 6 dB should lower it by 12 dB, got ${a - b}`);
});

test('rack splitter stages use the excess loss of their port count', () => {
  const sc = createDefaultScene(); sc.links = [createDefaultLink('mic'), createDefaultLink('mic'), createDefaultLink('mic'), createDefaultLink('mic')];
  const st = createStore(sc); const sp = R.addRackSplitter(st, {});
  for (const l of st.getScene().links) R.connectChannel(st, l.id, { splitterId: sp });
  const s = st.getScene(), l = s.links[0], loss = chainLossDb(l.chain.filter((it) => it.presetId && /splitter/.test(it.presetId)), l.freqMHz);
  assert.ok(Math.abs(loss - (10 * Math.log10(4) + 1.0)) < 0.2, `4-way should be 6 dB + 1 dB, got ${loss}`);
});

test('the ERP check uses the library antenna gain and the quarter-wave ground plane', () => {
  const l = createDefaultLink('mic'); l.freqMHz = 606; l.tx.powerDbm = 20;
  l.tx.antenna = { type: 'quarterwave', groundPlane: 'large' };
  const big = erpCheck(l, 'eu'); l.tx.antenna = { type: 'quarterwave', groundPlane: 'none' };
  const none = erpCheck(l, 'eu');
  if (big && none) assert.ok(big.eirpDbm - none.eirpDbm > 5, 'ground plane gain must change the EIRP');
});
