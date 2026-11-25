import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES, buildExample } from '../js/examples.js';
import { createStore } from '../js/store.js';
import { solveLink } from '../js/model/rf.js';
import { validateScene } from '../js/model/scene.js';
import { adoptRack } from '../js/actionsRack.js';

// Devices are independent and paired by frequency once a rack exists. Adopting must not move any number in any example.
test('adopting the rack changes no link margin in any example, and every receiver channel is matched to its mic', () => {
  let checked = 0;
  for (const e of EXAMPLES) {
    const built = buildExample(e.id), scene = built && built.scene ? built.scene : built;
    if (!scene || !(scene.links || []).some((l) => l.kind === 'mic')) continue;
    const s = createStore(structuredClone(scene)), before = new Map();
    for (const l of s.getScene().links) { try { const r = solveLink(s.getScene(), l); before.set(l.id, r && r.marginDb); } catch { before.set(l.id, undefined); } }
    adoptRack(s);
    const sc = s.getScene();
    assert.ok(sc.rack && sc.rack.byFreq === true, `${e.id}: rack is frequency-matched`);
    for (const l of sc.links) {
      const was = before.get(l.id); if (!Number.isFinite(was)) continue;
      const now = solveLink(sc, l).marginDb;
      assert.ok(Math.abs(now - was) < 0.05, `${e.id} ${l.name}: margin ${was} -> ${now}`);
    }
    for (const l of sc.links.filter((q) => q.kind === 'mic' && q.txOf === undefined)) assert.ok(sc.rack.receivers.some((r) => r.channels.some((c) => c.linkId === l.id)), `${e.id} ${l.name} has a receiver on its frequency`);
    assert.ok(validateScene(sc).ok, `${e.id}: ${validateScene(sc).errors.join('; ')}`);
    checked++;
  }
  assert.ok(checked >= 20, `checked ${checked} examples`);
});
