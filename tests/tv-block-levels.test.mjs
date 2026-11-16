// setTvBlockLevel / clearTvBlockLevels actions and the scene-diff entries for tvBlockLevelsDbm and wallLossAdjustByMaterialDb.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene, createDefaultLink, validateScene } from '../js/model/scene.js';
import { setTvBlockLevel, clearTvBlockLevels } from '../js/actionsAreas.js';
import { diffScenes, headline } from '../js/model/scene-diff.js';
import { tvBlockLevelDbm } from '../js/model/spectrum-map.js';

const mk = () => createStore(createDefaultScene());

test('setTvBlockLevel sets, clamps to -120..-10, and is one undo step', () => {
  const s = mk();
  assert.equal(setTvBlockLevel(s, 21, -60), true); assert.deepEqual(s.getScene().tvBlockLevelsDbm, { 21: -60 });
  setTvBlockLevel(s, 22, 5); setTvBlockLevel(s, 23, -500);
  assert.equal(s.getScene().tvBlockLevelsDbm[22], -10); assert.equal(s.getScene().tvBlockLevelsDbm[23], -120);
  assert.equal(validateScene(s.getScene()).ok, true);
  s.undo(); assert.equal(s.getScene().tvBlockLevelsDbm[23], undefined); assert.equal(s.getScene().tvBlockLevelsDbm[22], -10);
});
test('setTvBlockLevel removes on null/undefined/NaN and drops the empty map', () => {
  for (const nothing of [null, undefined, NaN, 'x']) {
    const s = mk(); setTvBlockLevel(s, 30, -70); setTvBlockLevel(s, 31, -71);
    setTvBlockLevel(s, 30, nothing); assert.deepEqual(s.getScene().tvBlockLevelsDbm, { 31: -71 });
    setTvBlockLevel(s, 31, nothing); assert.equal('tvBlockLevelsDbm' in s.getScene(), false);
  }
  const s = mk(); assert.equal(setTvBlockLevel(s, 30, null), false); assert.equal(s.canUndo(), false, 'removing an absent channel is not an undo step');
});
test('setTvBlockLevel ignores bad channels', () => {
  const s = mk();
  for (const ch of [1, 70, 21.5, NaN, '21x', null, undefined, -3, {}]) assert.equal(setTvBlockLevel(s, ch, -60), false);
  assert.equal('tvBlockLevelsDbm' in s.getScene(), false); assert.equal(s.canUndo(), false);
  assert.equal(setTvBlockLevel(s, '21', -60), true); assert.deepEqual(s.getScene().tvBlockLevelsDbm, { 21: -60 });
});
test('setTvBlockLevel respects the 70-entry cap (still allows editing existing)', () => {
  const s = mk();
  s.update((d) => { d.tvBlockLevelsDbm = {}; for (let n = 2; n <= 69; n++) d.tvBlockLevelsDbm[n] = -80; }); // 68 entries, the cap exceeds the channel count
  assert.equal(setTvBlockLevel(s, 40, -50), true); assert.equal(s.getScene().tvBlockLevelsDbm[40], -50);
  s.update((d) => { for (let i = 0; i < 2; i++) d.tvBlockLevelsDbm['x' + i] = -80; }); // force 70 entries
  assert.equal(setTvBlockLevel(s, 40, -55), true, 'existing channel still editable');
});
test('clearTvBlockLevels clears in one undo step', () => {
  const s = mk(); assert.equal(clearTvBlockLevels(s), false);
  setTvBlockLevel(s, 21, -60); setTvBlockLevel(s, 22, -61);
  assert.equal(clearTvBlockLevels(s), true); assert.equal('tvBlockLevelsDbm' in s.getScene(), false);
  s.undo(); assert.deepEqual(s.getScene().tvBlockLevelsDbm, { 21: -60, 22: -61 });
});

function base() {
  const s = createDefaultScene(); s.environment.model = 'free-space'; s.environment.externalNoise = 0;
  const l = createDefaultLink('mic'); l.id = 'L1'; l.name = 'Mic 1'; l.chain = []; s.links = [l]; return s;
}
test('diff: TV block level change reads "assumed to" and never costs a re-solve', () => {
  const a = base(), b = structuredClone(a); b.tvBlockLevelsDbm = { 21: -60 };
  const d = diffScenes(a, b), c = d.items.other.find((x) => x.path === 'tvBlockLevelsDbm.21');
  assert.ok(c); assert.equal(c.label, 'TV block level, channel 21'); assert.equal(c.kind, 'added');
  assert.equal(`${c.label}: ${c.fromText} to ${c.toText}`, `TV block level, channel 21: ${Math.round(tvBlockLevelDbm(21) * 1000) / 1000} dBm assumed to -60 dBm`);
  assert.equal(d.resolves, 0); assert.equal(d.links[0].deltas.marginDb, 0);
  const r = diffScenes(b, a).items.other[0]; assert.equal(r.kind, 'removed'); assert.match(r.toText, /dBm assumed$/); assert.equal(r.fromText, '-60 dBm');
  b.tvBlockLevelsDbm[21] = -50; assert.equal(diffScenes(a, b).summary.changeCount, 1);
});
test('diff: per-material wall adjustment is labelled, reverts, and the link attribution names it', () => {
  const a = base(); a.environment.model = 'ray-trace';
  a.reflectors = [{ id: 'W1', kind: 'wall', name: 'Back wall', material: 'concrete', p1: { x: 5, y: -10 }, p2: { x: 5, y: 10 }, zMin: 0, zMax: 5 }];
  a.links[0].tx.pos = { x: 0, y: 0, z: 1.5 }; a.links[0].rx.pos = { x: 10, y: 0, z: 1.5 };
  const b = structuredClone(a); b.environment.wallLossAdjustByMaterialDb = { concrete: 8 };
  const d = diffScenes(a, b), e = d.items.environment.find((x) => x.path === 'environment.wallLossAdjustByMaterialDb.concrete');
  assert.ok(e); assert.equal(e.label, 'Environment extra wall loss, concrete walls (dB)'); assert.equal(e.fromText, 'not set'); assert.equal(e.toText, '8 dB');
  const l = d.links[0];
  assert.ok(Math.abs(l.deltas.marginDb) > 0.05, 'the 8 dB on the crossed wall moves the margin');
  const c = l.attribution.contributions.find((x) => x.path === e.path);
  assert.ok(c, 'attributed by reverting the one key'); assert.ok(Math.abs(c.contributionDb - l.deltas.marginDb) < 0.05);
  assert.ok(headline(d)[0].includes('extra wall loss, concrete walls'));
  assert.ok(d.resolves <= 40);
});
