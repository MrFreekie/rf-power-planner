// Scenario compare. Hand anchors: free space, doubling the distance costs 20 log10(2) = 6.02 dB; a 6 dB pad ahead of the receiver costs 6 dB of input level.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene, createDefaultLink, createChainItem, createReflector, createImdTransmitter } from '../js/model/scene.js';
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
test('re-solve work is capped at 40 per link; a link that exhausts its own budget is truncated and not exact', () => {
  const a = base(), b = structuredClone(a);
  b.links[0].chain = Array.from({ length: 45 }, (_, i) => createChainItem('attenuator', { lossDb: 1, id: `p${i}` }));
  const d = diffScenes(a, b);
  assert.equal(d.resolves, MAX_RESOLVES); assert.equal(d.links[0].attribution.truncated, true); assert.equal(d.links[0].attribution.exact, false);
  assert.match(headline(d)[0], /approximate/);
});
test('the budget is per link: two links that each change 45 chain items both get the full 40 re-solves', () => {
  const a = base(); const l2 = structuredClone(a.links[0]); l2.id = 'L2'; l2.name = 'Mic 2'; a.links.push(l2);
  const b = structuredClone(a);
  for (const l of b.links) l.chain = Array.from({ length: 45 }, (_, i) => createChainItem('attenuator', { lossDb: 1, id: `${l.id}p${i}` }));
  const d = diffScenes(a, b);
  assert.equal(d.resolves, 2 * MAX_RESOLVES); assert.ok(d.links.every((l) => l.attribution.truncated && l.attribution.contributions.length === MAX_RESOLVES));
});
test('scene-level changes are reverted together in one re-solve first; they are split only when that group matters', () => {
  const a = base(), b = structuredClone(a);
  b.links[0].tx.powerDbm += 3;
  b.reflectors = Array.from({ length: 12 }, (_, i) => createReflector({ id: `w${i}`, name: `W${i}`, p1: { x: 3, y: 5 + i }, p2: { x: 7, y: 5 + i } }));
  const free = diffScenes(a, b); // free-space model: reflectors cannot matter
  assert.equal(free.resolves, 2, 'one for the power change, one for the whole reflector group');
  assert.equal(free.links[0].attribution.contributions.length, 1);
  const a2 = base(); a2.environment.model = 'two-ray'; const b2 = structuredClone(a2); b2.reflectors = b.reflectors; b2.environment.floor = 'concrete';
  const two = diffScenes(a2, b2);
  if (Math.abs(two.links[0].deltas.marginDb) >= 0.05) assert.ok(two.resolves > 1 && two.resolves <= 1 + 13, `split after the group matters: ${two.resolves}`);
});
test('keys that cannot change RF (name, audioSource) cost no re-solve and are not blamed', () => {
  const a = base(), b = structuredClone(a); a.name = 'Show A'; b.name = 'Show B'; b.audioSource = { kind: 'tone', toneHz: 440 }; b.links[0].tx.powerDbm += 3;
  const d = diffScenes(a, b);
  assert.equal(d.resolves, 1); assert.equal(d.links[0].attribution.contributions.length, 1);
});
test('intermodulation conflicts are counted once and reported in one scene-level sentence, not one per link', () => {
  const a = base(); const l2 = structuredClone(a.links[0]); l2.id = 'L2'; l2.name = 'Mic 2'; l2.freqMHz = 607.5; a.links.push(l2);
  const f = a.links[0].freqMHz, b = structuredClone(a);
  b.imd.enabled = true; b.imd.wantedFreqMHz = f;
  b.imd.transmitters = [0, 0.2, 0.4].map((o, i) => createImdTransmitter({ id: `t${i}`, freqMHz: f + o, powerDbm: 20, pos: { x: b.imd.rxAntennaPos.x - 0.5, y: b.imd.rxAntennaPos.y, z: 2 } })); // close and strong: third-order products 4 and 10 dB under the wanted tone (hand-run)
  const d = diffScenes(a, b);
  assert.equal(d.summary.imd.from, 0); assert.ok(d.summary.imd.to > 0, `to ${d.summary.imd.to}`);
  const s = headline(d).filter((x) => /ntermodulation/.test(x));
  assert.equal(s.length, 1); assert.match(s[0], /^Intermodulation conflicts go from 0 to \d+\.$/);
});
test('the same object short-circuits with no changes and every delta zero', () => {
  const a = base(), d = diffScenes(a, a);
  assert.equal(d.summary.changeCount, 0); assert.equal(d.resolves, 0); assert.equal(d.links[0].deltas.marginDb, 0);
  assert.deepEqual(headline(d), ['No differences.']);
});
test('the venue underlay is not compared and not cloned', () => {
  const a = base(), b = structuredClone(a); a.venue = { name: 'big', layers: [] }; b.venue = { name: 'other', layers: [{ n: 1 }] }; b.links[0].tx.powerDbm += 3;
  const d = diffScenes(a, b);
  assert.ok(!d.items.other.some((x) => /venue/i.test(x.label + x.path)), 'venue is not listed'); assert.equal(d.resolves, 1);
});
test('headline: when the budget ran out with nothing attributed it says the attribution was limited, not "a change elsewhere"', () => {
  const diff = {
    summary: { added: [], removed: [], notes: [], imd: { from: 0, to: 0 } },
    links: [{ name: 'Mic 1', fields: [], deltas: { marginDb: -3, statusFrom: 'pass', statusTo: 'pass', imd: { from: 0, to: 0 }, warningsAdded: [] }, resultA: { marginDb: 10 }, resultB: { marginDb: 7 }, attribution: { contributions: [], truncated: true, exact: false } }],
    items: { reflectors: { added: [], removed: [], changed: [] }, zones: { added: [], removed: [], changed: [] }, noiseSources: { added: [], removed: [], changed: [] }, people: { added: [], removed: [], changed: [] }, platforms: { added: [], removed: [], changed: [] }, measurements: { added: [], removed: [], changed: [] }, environment: [] },
  };
  const h = headline(diff)[0];
  assert.match(h, /attribution was limited/); assert.doesNotMatch(h, /elsewhere in the scene/);
});
