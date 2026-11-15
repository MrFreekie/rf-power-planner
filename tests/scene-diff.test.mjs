// Scenario compare. Hand anchors: free space, doubling the distance costs 20 log10(2) = 6.02 dB; a 6 dB pad ahead of the receiver costs 6 dB of input level.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene, createDefaultLink, createChainItem, createReflector } from '../js/model/scene.js';
import { diffScenes, headline, MAX_RESOLVES } from '../js/model/scene-diff.js';

const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} got ${a}, expected ${b} +- ${tol}`);
function base() {
  const s = createDefaultScene(); s.environment.model = 'free-space'; s.environment.externalNoise = 0;
  const l = createDefaultLink('mic'); l.id = 'L1'; l.name = 'Mic 1'; l.chain = []; l.freqMHz = 606.1;
  l.tx.pos = { x: 0, y: 0, z: 1.5 }; l.rx.pos = { x: 10, y: 0, z: 1.5 }; s.links = [l];
  return s;
}

test('moving the receiver 10 m to 20 m in free space costs 6.02 dB and the move is blamed', () => {
  const a = base(), b = structuredClone(a); b.links[0].rx.pos.x = 20;
  const d = diffScenes(a, b), l = d.links[0];
  near(l.deltas.marginDb, -6.02, 0.05); near(l.deltas.inputPowerDbm, -6.02, 0.05); near(l.deltas.rxLevelDbm, -6.02, 0.05);
  assert.equal(l.fields.length, 1); assert.equal(l.fields[0].label, 'Mic 1: receiver position'); assert.equal(l.fields[0].fromText, '(x 10)');
  assert.equal(l.attribution.contributions.length, 1); near(l.attribution.contributions[0].contributionDb, -6.02, 0.05); assert.equal(l.attribution.exact, true);
  const h = headline(d); assert.match(h[0], /^Mic 1 margin falls 6\.0 dB \(from .* to .* dB\), mainly because Mic 1: receiver position changed from \(x 10\) to \(x 20\)\.$/);
});
test('adding a 6 dB pad lowers the input level by 6.0 dB and the pad is named', () => {
  const a = base(), b = structuredClone(a); b.links[0].chain = [createChainItem('attenuator', { lossDb: 6, id: 'pad1' })];
  const d = diffScenes(a, b), l = d.links[0];
  near(l.deltas.inputPowerDbm, -6, 0.01); near(l.deltas.marginDb, -6, 0.5, 'margin also pays the noise figure of the pad');
  assert.ok(l.fields[0].label.includes('attenuator') && l.fields[0].kind === 'added');
  assert.ok(l.attribution.contributions[0].label.includes('attenuator'));
});
test('two interacting or separate changes: contributions are listed, and an exact sum is flagged exact', () => {
  const a = base(), b = structuredClone(a); b.links[0].rx.pos.x = 20; b.links[0].tx.powerDbm += 3;
  const l = diffScenes(a, b).links[0];
  assert.equal(l.attribution.contributions.length, 2); near(l.deltas.marginDb, -6.02 + 3, 0.05);
  assert.equal(l.attribution.contributions[0].label, 'Mic 1: receiver position'); near(l.attribution.contributions[1].contributionDb, 3, 0.05); assert.ok(l.attribution.exact);
  assert.match(headline(diffScenes(a, b))[0], /\(1 other change also counted\)/);
});
test('scene level changes (environment, reflector) are attributed to the link and listed under items', () => {
  const a = base(); a.environment.model = 'two-ray'; const b = structuredClone(a); b.environment.floor = 'concrete'; b.reflectors.push(createReflector({ id: 'W1', name: 'Back wall' }));
  const d = diffScenes(a, b);
  assert.equal(d.items.environment.length, 1); assert.equal(d.items.environment[0].label, 'Environment floor material'); assert.equal(d.items.environment[0].toText, 'concrete');
  assert.deepEqual(d.items.reflectors.added, [{ id: 'W1', name: 'Back wall' }]);
  assert.ok(headline(d).includes('Reflectors: 1 added.'));
});
test('added and removed links, unmatched ids, status change', () => {
  const a = base(), b = structuredClone(a); b.links.push({ ...structuredClone(a.links[0]), id: 'L2', name: 'Mic 2' }); b.links.shift();
  const d = diffScenes(a, b);
  assert.deepEqual(d.summary.added.map((x) => x.name), ['Mic 2']); assert.deepEqual(d.summary.removed.map((x) => x.name), ['Mic 1']); assert.equal(d.links.length, 0);
  const h = headline(d); assert.ok(h.includes('Mic 2 was added.') && h.includes('Mic 1 was removed.'));
  const a2 = base(), b2 = structuredClone(a2); b2.links[0].rx.pos.x = 10000;
  assert.match(headline(diffScenes(a2, b2)).join(' '), /status goes from \w+ to fail/);
});
test('identical, empty, NaN and malformed scenes are handled', () => {
  const a = base();
  assert.deepEqual(headline(diffScenes(a, structuredClone(a))), ['No differences.']);
  assert.equal(diffScenes(a, a).summary.changeCount, 0);
  const e = diffScenes({ links: [] }, { links: [] }); assert.equal(e.summary.linksA, 0); assert.deepEqual(headline(e), ['No differences.']);
  assert.doesNotThrow(() => diffScenes(null, undefined)); assert.doesNotThrow(() => headline(null));
  const n = structuredClone(a); n.links[0].tx.powerDbm = NaN; const d = diffScenes(a, n);
  assert.equal(d.links[0].deltas.marginDb, null); assert.ok(d.links[0].fields[0].toText === 'not a number'); assert.doesNotThrow(() => headline(d));
  const nn = structuredClone(a); nn.links[0].tx.powerDbm = NaN; assert.equal(diffScenes(nn, structuredClone(nn)).summary.changeCount, 0, 'NaN equals NaN');
});
test('older scene versions are migrated before comparing', () => {
  const a = base(); const old = structuredClone(a); old.version = 1; delete old.venue;
  const d = diffScenes(old, a); assert.equal(d.summary.changeCount, 0, JSON.stringify(d.items.other));
  assert.ok(diffScenes({ version: 9999, links: [] }, a).summary.notes.length > 0);
});
test('re-solve work is capped at 40', () => {
  const a = base(), b = structuredClone(a);
  b.links[0].chain = Array.from({ length: 30 }, (_, i) => createChainItem('attenuator', { lossDb: 1, id: `p${i}` }));
  b.reflectors = Array.from({ length: 30 }, (_, i) => createReflector({ id: `w${i}`, name: `W${i}`, p1: { x: 3, y: 5 + i }, p2: { x: 7, y: 5 + i } }));
  const d = diffScenes(a, b);
  assert.ok(d.resolves <= MAX_RESOLVES && d.resolves === MAX_RESOLVES); assert.equal(d.links[0].attribution.truncated, true); assert.equal(d.links[0].attribution.exact, false);
  assert.match(headline(d)[0], /approximate/);
});
