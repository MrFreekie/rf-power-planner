import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSceneLibrary, LIBRARY_KEY, LIMITS, cleanName } from '../js/ui/scenes.js';
import { snapshotScene, compareSnapshots } from '../js/ui/compare.js';
import { shouldShowWelcome, markWelcomeSeen, resetWelcome, WELCOME_KEY, WELCOME_STEPS } from '../js/ui/onboarding.js';
import { GLOSSARY, ALIASES, findTerms, termsIn, lookup, legend } from '../js/ui/glossary.js';
import { TOOLTIPS, HELP_TOPICS } from '../js/ui/help.js';
import { createDefaultScene, createChainItem } from '../js/model/scene.js';

function fakeStorage({ failWrites = false } = {}) {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem(k, v) { if (failWrites) throw new Error('quota'); m.set(k, String(v)); }, removeItem: (k) => m.delete(k), _m: m };
}

test('scene library: save, list, load round trip', () => {
  let t = 1000;
  const lib = createSceneLibrary(fakeStorage(), { now: () => t++ });
  const scene = createDefaultScene();
  const r = lib.save('  Main   stage ', scene);
  assert.equal(r.ok, true);
  assert.deepEqual(lib.list().map((x) => x.name), ['Main stage']);
  const l = lib.load(r.id);
  assert.equal(l.ok, true);
  assert.equal(l.scene.stage.width, scene.stage.width);
});

test('scene library: same name replaces, newest first, rename and delete', () => {
  let t = 1;
  const lib = createSceneLibrary(fakeStorage(), { now: () => t++ });
  const a = lib.save('A', createDefaultScene());
  const b = lib.save('B', createDefaultScene());
  assert.equal(lib.save('a', createDefaultScene()).replaced, true);
  assert.equal(lib.list().length, 2);
  assert.equal(lib.list()[0].name, 'a');
  assert.equal(lib.rename(b.id, 'a').ok, false); // duplicate name
  assert.equal(lib.rename(b.id, 'Bee').ok, true);
  assert.equal(lib.remove(a.id).ok, true);
  assert.equal(lib.remove(a.id).ok, false);
  assert.deepEqual(lib.list().map((x) => x.name), ['Bee']);
});

test('scene library: limits, empty names, storage failure never throw', () => {
  const lib = createSceneLibrary(fakeStorage());
  assert.equal(lib.save('   ', createDefaultScene()).ok, false);
  for (let i = 0; i < LIMITS.maxScenes; i++) assert.equal(lib.save(`s${i}`, createDefaultScene()).ok, true);
  assert.equal(lib.save('one too many', createDefaultScene()).ok, false);
  const big = createDefaultScene();
  big.links[0].name = 'x'.repeat(LIMITS.maxSceneBytes);
  assert.equal(createSceneLibrary(fakeStorage()).save('big', big).ok, false);
  assert.equal(createSceneLibrary(fakeStorage({ failWrites: true })).save('q', createDefaultScene()).ok, false);
  assert.equal(createSceneLibrary(null).save('q', createDefaultScene()).ok, false);
  assert.deepEqual(createSceneLibrary(null).list(), []);
  assert.equal(cleanName('x'.repeat(200)).length, LIMITS.maxNameLength);
});

test('scene library: corrupt storage and invalid scenes are handled', () => {
  const st = fakeStorage();
  st.setItem(LIBRARY_KEY, '{not json');
  const lib = createSceneLibrary(st);
  assert.deepEqual(lib.list(), []);
  assert.equal(lib.save('ok', createDefaultScene()).ok, true); // overwrites the corrupt blob
  st.setItem(LIBRARY_KEY, JSON.stringify({ v: 1, items: [{ id: 'z', name: 'bad', savedAt: 1, json: '{"version":1}' }, { id: 5 }] }));
  assert.equal(lib.list().length, 1);
  const r = lib.load('z');
  assert.equal(r.ok, false);
  assert.match(r.error, /bad/);
  assert.equal(lib.load('nope').ok, false);
});

test('compare: identical scenes differ by zero, booster adds its gain', () => {
  const base = createDefaultScene();
  const a = snapshotScene(base);
  const same = compareSnapshots(a, snapshotScene(base));
  assert.ok(same.every((r) => r.diff === null || Math.abs(r.diff) < 1e-9));
  const boosted = structuredClone(base);
  boosted.links[0].chain.unshift(createChainItem('booster', { gainDb: 12, nfDb: 2 }));
  const b = snapshotScene(boosted);
  const rows = Object.fromEntries(compareSnapshots(a, b).map((r) => [r.key, r]));
  assert.ok(rows.marginDb.diff > 0, 'booster before the cable improves the margin');
  assert.equal(rows.marginDb.better, 'b');
  assert.ok(Math.abs(rows.rxPowerDbm.diff) < 1e-9, 'antenna level unchanged');
  assert.ok(rows.waterfallTotalDb.diff > 5, 'end-to-end total gains');
  assert.match(rows.marginDb.fdiff, /^\+\d+\.\d dB$/);
});

test('compare: distance row neutral and snapshot is a deep copy', () => {
  const sc = createDefaultScene();
  const a = snapshotScene(sc);
  sc.links[0].tx.pos.x += 3;
  const b = snapshotScene(sc);
  assert.notEqual(a.scene.links[0].tx.pos.x, sc.links[0].tx.pos.x);
  const rows = Object.fromEntries(compareSnapshots(a, b).map((r) => [r.key, r]));
  assert.equal(rows.distanceM.better, null);
  assert.ok(rows.distanceM.diff !== 0);
});

test('welcome: remembered via storage, tolerant of storage errors', () => {
  const st = fakeStorage();
  assert.equal(shouldShowWelcome(st), true);
  assert.equal(markWelcomeSeen(st), true);
  assert.equal(st.getItem(WELCOME_KEY), '1');
  assert.equal(shouldShowWelcome(st), false);
  resetWelcome(st);
  assert.equal(shouldShowWelcome(st), true);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(shouldShowWelcome(broken), true);
  assert.equal(markWelcomeSeen(broken), false);
  assert.ok(WELCOME_STEPS.length >= 4 && WELCOME_STEPS.length <= 5);
});

test('glossary: finder is whole-word and case-sensitive', () => {
  assert.deepEqual(termsIn('Rx power in dBm and dB per 100 m'), ['Rx', 'dBm', 'dB']);
  assert.deepEqual(termsIn('dBmx dBmW per perfect'), []);
  assert.deepEqual(termsIn('TX -> RX'), ['TX', 'RX']);
  assert.equal(lookup('TX'), GLOSSARY.Tx);
  assert.deepEqual(termsIn('Es/N0 and 16-QAM, 3 dB'), ['Es/N0', 'QAM', 'dB']);
  assert.deepEqual(termsIn('RG58 cable via N-type'), ['RG58', 'N-type']);
  assert.deepEqual(findTerms('IM3 and IM5').map((t) => t.term), ['IM3', 'IM5']);
});

test('glossary: every entry is complete and the required terms exist', () => {
  for (const [k, g] of Object.entries(GLOSSARY)) assert.ok(g.full && g.meaning && g.meaning.length > 20, k);
  for (const t of ['RF', 'IEM', 'Tx', 'Rx', 'dBm', 'dBW', 'dB', 'dBi', 'EIRP', 'FSPL', 'SNR', 'CNR', 'NF', 'IIP3', 'IM3', 'P1dB', 'PIM', 'MPX', 'FM', 'QAM', 'BER', 'EVM', 'MER', 'FEC', 'PER', 'VSWR', 'LNA', 'UHF', 'PLL', 'AGC', 'ERP', 'TV', 'SMA', 'BNC', 'N-type', 'LOS', 'Fresnel', 'diversity', 'squelch']) {
    assert.ok(GLOSSARY[t], t);
  }
  for (const [alias, key] of Object.entries(ALIASES)) assert.ok(GLOSSARY[key], alias);
});

test('glossary: static HTML acronyms are all in the glossary; wrapped terms are used somewhere', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
  const allow = new Set(['JSON', 'OK', 'PASS', 'FAIL', 'HTML']); // file types and plain status words
  const acr = [...new Set(visible.match(/\b[A-Z0-9]{2,}\b/g) || [])].filter((w) => !allow.has(w) && /[A-Z]/.test(w));
  for (const w of acr) assert.ok(lookup(w), `index.html acronym ${w} missing from the glossary`);
  // vice versa: each auto-wrapped glossary term appears in the static html or in the UI source text
  const files = ['js/ui/inspector.js', 'js/ui/help.js', 'js/view/waterfall.js', 'js/view/meters.js', 'js/view/imd.js', 'js/view/digital.js', 'js/view/mpx.js', 'js/view/modLab.js', 'js/view/telemetry.js', 'js/view/diversity.js', 'js/view/coverage.js', 'js/view/timeline.js', 'js/reportData.js', 'js/model/rf.js', 'js/examples.js', 'js/model/library.js', 'js/model/digital-params.js', 'js/model/imd-params.js', 'js/model/rx-params.js', 'js/ui/coordination.js', 'js/ui/noise.js']
    .map((f) => { try { return fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'); } catch { return ''; } }).join('\n') + html;
  const reserved = new Set(['EIRP', 'ERP', 'CIR', 'PLL', 'VHF']); // defined for text users may type or future labels
  const unused = Object.keys(GLOSSARY).filter((k) => GLOSSARY[k].wrap !== false && !reserved.has(k) && !files.includes(k));
  assert.deepEqual(unused, [], 'glossary terms that appear nowhere in the UI sources');
});

test('help: topics reference only glossary terms; tooltip ids exist in index.html', () => {
  for (const [id, t] of Object.entries(HELP_TOPICS)) {
    for (const term of t.terms || []) assert.ok(lookup(term), `${id}: ${term}`);
    assert.ok(t.text.length > 40 && t.text.length < 1200, id);
  }
  assert.ok(legend(['dB', 'Tx']).includes('decibel'));
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of Object.keys(TOOLTIPS)) assert.ok(html.includes(`id="${id}"`), `tooltip id ${id} not in index.html`);
});

import { applyToScene, describeResult, parseChannels, clampCounts, runCoordination, LIMITS as COORD_LIMITS } from '../js/ui/coordination.js';
import { createImdTransmitter } from '../js/model/scene.js';

test('coordination panel: parse channels, clamp counts', () => {
  assert.deepEqual(parseChannels('24, 27 24;abc 200 31'), [24, 27, 31]);
  assert.deepEqual(clampCounts(-3, 'x'), { mics: 0, iems: 0 });
  const c = clampCounts(16, 16);
  assert.ok(c.mics + c.iems <= COORD_LIMITS.maxTotal);
});

test('coordination panel: generate for the UK, describe rows, apply to the scene', () => {
  const { result } = runCoordination({ regionId: 'uk', rangeId: 'uk-uhf-470-694', mics: 4, iems: 1, tvChannels: '', seed: 1 });
  assert.equal(result.ok, true);
  const rows = describeResult(result);
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.nearestSpacingKHz >= 300 && /MHz$/.test(r.freqText) && /mW/.test(r.limitText)));
  const scene = createDefaultScene();
  scene.imd.transmitters = [createImdTransmitter({ name: 'Extra mic' })];
  const draft = structuredClone(scene);
  const res = applyToScene(draft, result);
  const mic1 = result.frequencies.find((f) => f.id === 'mic1').freqMHz;
  assert.equal(draft.links[0].freqMHz, mic1);
  assert.equal(draft.imd.transmitters[0].freqMHz, result.frequencies.find((f) => f.id === 'mic2').freqMHz);
  assert.equal(res.applied.length, 2);
  assert.equal(res.unassigned.length, 3); // two more mics and the IEM have no transmitter in this scene
});

test('coordination panel: blocked TV channels are avoided and impossible requests report a failure', () => {
  const { result } = runCoordination({ regionId: 'uk', rangeId: 'uk-863-865', mics: 16, iems: 8, tvChannels: '', seed: 1 });
  assert.equal(result.ok, false);
  assert.ok(result.failure && result.failure.message);
  const ok = runCoordination({ regionId: 'uk', rangeId: 'uk-uhf-470-694', mics: 3, iems: 0, tvChannels: '24', seed: 1 }).result;
  assert.ok(ok.frequencies.every((f) => !(f.freqMHz >= 494 && f.freqMHz <= 502)));
});

import { validateScene, migrateScene, DEFAULT_EXTERNAL_NOISE } from '../js/model/scene.js';
import { noiseOptions, noiseValue, noiseFromChoice } from '../js/ui/noise.js';
import { solveLink } from '../js/model/rf.js';
import { EXAMPLES, buildExample } from '../js/examples.js';

test('external noise: default urban, validation, old scenes stay Off', () => {
  const sc = createDefaultScene();
  assert.equal(DEFAULT_EXTERNAL_NOISE, 'urban');
  assert.equal(sc.environment.externalNoise, 'urban');
  for (const ok of [undefined, 'quiet', 'outdoor', 'urban', 'noisy-venue', 0, 7.5]) {
    const s = structuredClone(sc); s.environment.externalNoise = ok;
    assert.equal(validateScene(s).ok, true, String(ok));
  }
  for (const bad of ['loud', -1, NaN, null, {}, '__proto__']) {
    const s = structuredClone(sc); s.environment.externalNoise = bad;
    assert.equal(validateScene(s).ok, false, String(bad));
  }
  const old = structuredClone(sc); delete old.environment.externalNoise;
  assert.equal(migrateScene(old).environment.externalNoise, undefined);
  assert.equal(solveLink(migrateScene(old), old.links[0]).cascade.externalNoiseNfDb, 0);
  assert.ok(solveLink(sc, sc.links[0]).cascade.externalNoiseNfDb > 0);
});

test('external noise selector: options carry the frequency-scaled figure', () => {
  const o = Object.fromEntries(noiseOptions('urban', 600));
  assert.match(o.off, /Off \(0 dB\)/);
  assert.equal(o.urban, 'Urban (+3.5 dB @600 MHz)');
  assert.equal(Object.fromEntries(noiseOptions('urban', 1200)).urban, 'Urban (+3.5 dB @600 MHz; +1.5 dB at 1200 MHz)');
  assert.match(Object.fromEntries(noiseOptions('urban', 470)).urban, /; \+5 dB at 470 MHz/);
  assert.ok(noiseOptions(4, 600).some(([v]) => v === 'custom'));
  assert.equal(noiseValue(undefined), 'off'); assert.equal(noiseValue(0), 'off'); assert.equal(noiseValue('quiet'), 'quiet'); assert.equal(noiseValue(2), 'custom');
  assert.equal(noiseFromChoice('off'), 0); assert.equal(noiseFromChoice('urban'), 'urban'); assert.equal(noiseFromChoice('custom'), undefined);
});

test('examples quote margins without external noise (set explicitly to Off)', () => {
  for (const ex of EXAMPLES) {
    const b = buildExample(ex.id);
    const v = b.scene.environment.externalNoise;
    assert.ok(v === 0 || v !== undefined, ex.id); // explicit, never silently the new default unless an example chose it
    assert.notEqual(v, undefined, ex.id);
  }
});

import { parseDabBlocks, parseWifiChannels, describeOccupancy, rangesFor, isHopping } from '../js/ui/coordination.js';
import { interferenceOptions, interferenceHint, interferenceApplies, interferenceValue, rxPresetOffer } from '../js/ui/noise.js';
import { planWalkAll } from '../js/ui/walkall.js';
import { createStore } from '../js/store.js';
import { addChainItem, removeChainItem, moveChainItem, setLinkKind } from '../js/actions.js';
import { startMultiWalk, stopWalk, isWalking } from '../js/walk.js';

test('coordination panel: band groups, DAB and Band III blocking, Wi-Fi occupancy', () => {
  assert.deepEqual(parseDabBlocks('5a, 9C zz 5A'), { valid: ['5A', '9C'], ignored: ['zz'] });
  assert.deepEqual(parseWifiChannels('1 6 14 11 6', '2g4'), [1, 6, 11]);
  assert.deepEqual(parseWifiChannels('149 36 165', '5g8'), [149, 165]);
  assert.equal(isHopping('2g4'), true); assert.equal(isHopping('vhf'), false);
  assert.ok(rangesFor('eu', 'vhf').length >= 1 && rangesFor('eu', 'vhf').every((r) => r.group === 'vhf'));
  const v = runCoordination({ regionId: 'eu', rangeId: '', mics: 3, iems: 1, bandIII: '6, 9', dabBlocks: '5A', bandGroup: 'vhf', seed: 1 });
  assert.equal(v.result.ok, true);
  assert.equal(v.result.mode, 'intermod');
  for (const f of v.result.frequencies) {
    assert.ok(f.freqMHz >= 174 && f.freqMHz <= 216, String(f.freqMHz));
    assert.ok(!(f.freqMHz >= 181 && f.freqMHz < 188) && !(f.freqMHz >= 202 && f.freqMHz < 209), 'Band III channels 6 and 9 avoided');
    assert.ok(!(f.freqMHz >= 174.16 && f.freqMHz <= 175.7), 'DAB 5A avoided');
  }
  const w = runCoordination({ regionId: 'eu', mics: 2, iems: 1, bandGroup: '2g4', wifiChannels: '1, 6, 11' });
  assert.equal(w.result.mode, 'occupancy');
  assert.equal(w.result.hopping, true);
  const d = describeOccupancy(w.result);
  assert.equal(d.chips.filter((c) => c.inUse).length, 3);
  assert.equal(d.chips.length, 13);
  assert.ok(d.lines[0].includes('free'));
  const g = runCoordination({ regionId: 'eu', mics: 1, iems: 0, bandGroup: '5g8', wifiChannels: '149' });
  assert.equal(g.result.mode, 'occupancy');
  assert.equal(describeOccupancy(g.result).chips.filter((c) => c.inUse).length, 1);
});

test('interference select and receiver preset offer', () => {
  assert.equal(interferenceApplies(1999), false); assert.equal(interferenceApplies(2400), true);
  assert.deepEqual(interferenceOptions(2440).map((o) => o[1]), ['None (+0 dB)', 'Quiet (+2 dB)', 'Typical (+9 dB)', 'Busy (+20 dB)']);
  assert.deepEqual(interferenceOptions(5800).map((o) => o[1]), ['None (+0 dB)', 'Quiet (+0.6 dB)', 'Typical (+4 dB)', 'Busy (+12 dB)']);
  assert.match(interferenceHint('busy', 2440), /2\.4 GHz.*20 dB/);
  assert.equal(interferenceValue(undefined), 'none'); assert.equal(interferenceValue('bogus'), 'none');
  assert.equal(rxPresetOffer('mic', 600, undefined), null);
  assert.equal(rxPresetOffer('mic', 2440, undefined).id, 'rx-2g4-typical');
  assert.equal(rxPresetOffer('mic', 5800, 'rx-2g4-typical').buttonText, 'Use 5.8 GHz receiver preset');
  assert.equal(rxPresetOffer('iem', 200, 'iem-bodypack-typical').id, 'rx-vhf-typical');
  assert.equal(rxPresetOffer('mic', 2440, 'rx-2g4-typical'), null);
  assert.equal(rxPresetOffer('mic', 600, 'rx-2g4-typical').id, 'mic-receiver-typical'); // offered back, never forced
  assert.equal(rxPresetOffer('mic', 600, 'iem-bodypack-typical'), null); // two UHF presets: the user's own choice
});

test('walk all: plan covers mic links and imd transmitters with a shared offset', () => {
  const sc = createDefaultScene();
  assert.deepEqual(planWalkAll(sc).items, [{ linkId: sc.links[0].id }]);
  sc.imd.enabled = true;
  sc.imd.transmitters = [createImdTransmitter({ pos: { x: 2, y: 3, z: 1 } }), createImdTransmitter({ pos: { x: 3, y: 4, z: 1 } })];
  const p = planWalkAll(sc);
  assert.equal(p.items.length, 3);
  const xs = [sc.links[0].tx.pos.x, 2, 3];
  const dx = p.offset.x;
  assert.ok(xs.every((x) => x + dx >= -1e-9 && x + dx <= sc.stage.width + 1e-9), 'everyone stays on the stage');
  const iem = createDefaultScene(); setLinkKind(createStore(iem), iem.links[0].id, 'iem');
  const st = createStore(createDefaultScene()); setLinkKind(st, st.getScene().links[0].id, 'iem');
  assert.deepEqual(planWalkAll(st.getScene()).items, []);
  const store = createStore(sc);
  const ctl = startMultiWalk(store, p.items, { offset: p.offset, raf: () => 1, caf: () => {}, now: () => 0 });
  assert.ok(ctl && isWalking());
  stopWalk();
  assert.equal(isWalking(), false);
});

test('IEM bodypack-side chain: add, move, remove through actions (target rx)', () => {
  const store = createStore(createDefaultScene());
  const id = store.getScene().links[0].id;
  assert.equal(addChainItem(store, id, 'cable', undefined, { target: 'rx' }), null, 'mic links have no bodypack chain');
  setLinkKind(store, id, 'iem');
  assert.equal(store.getScene().links[0].rx.chain, undefined);
  const a = addChainItem(store, id, 'booster', undefined, { target: 'rx' });
  const b = addChainItem(store, id, 'cable', undefined, { target: 'rx' });
  assert.ok(a && b);
  assert.deepEqual(store.getScene().links[0].rx.chain.map((x) => x.kind), ['booster', 'cable']);
  moveChainItem(store, id, b, -1, { target: 'rx' });
  assert.deepEqual(store.getScene().links[0].rx.chain.map((x) => x.kind), ['cable', 'booster']);
  removeChainItem(store, id, a, { target: 'rx' });
  assert.equal(store.getScene().links[0].rx.chain.length, 1);
  assert.equal(store.getScene().links[0].chain.length, 1, 'the Tx-side chain is untouched');
  store.undo(); store.undo(); store.undo();
  assert.deepEqual(store.getScene().links[0].rx.chain.map((x) => x.kind), ['booster']);
});

import { licenceInfo, verificationInfo, powerLine, limitText, txLimitHint, getCoordRegion, setCoordRegion, onCoordRegion } from '../js/ui/region.js';
import { plansFor, rangeCards, isLimitWarning } from '../js/ui/coordination.js';
import { powerLimitDetailFor } from '../js/model/bands.js';

test('regulatory presentation: licence text, verification warnings, power lines', () => {
  for (const c of ['exempt', 'shared', 'coordinated', 'high-power']) assert.ok(licenceInfo(c).label && licenceInfo(c).meaning.length > 20, c);
  assert.match(licenceInfo('exempt').meaning, /No licence needed/);
  assert.match(licenceInfo('high-power').meaning, /1 W/);
  const d = powerLimitDetailFor('uk', 174);
  assert.equal(powerLine(d), 'handheld 10 mW / body-worn 50 mW ERP');
  const v = verificationInfo(d);
  assert.equal(v.level, 'draft'); assert.equal(v.warn, true); assert.match(v.label, /Draft IR 2030/); assert.match(v.sourceText, /2025-12-11/);
  const un = verificationInfo(powerLimitDetailFor('uk', 610));
  assert.equal(un.level, 'unverified'); assert.match(un.label, /Unverified/);
  const ok = verificationInfo(powerLimitDetailFor('uk', 864));
  assert.equal(ok.level, 'verified'); assert.equal(ok.warn, false);
  assert.equal(powerLine(powerLimitDetailFor('uk', 864)), '10 mW ERP');
  assert.equal(verificationInfo(null).level, 'unverified');
});

test('result rows use the body-worn column for mics only, and mark draft or unverified figures', () => {
  assert.equal(limitText('uk', 174.2, { bodyWorn: false }), '10 mW ERP (draft)');
  assert.equal(limitText('uk', 174.2, { bodyWorn: true, kind: 'mic' }), '50 mW ERP (draft)');
  assert.equal(limitText('uk', 174.2, { bodyWorn: true, kind: 'iem' }), '10 mW ERP (draft)');
  assert.equal(limitText('uk', 864, { bodyWorn: true }), '10 mW ERP');
  assert.equal(limitText('uk', 610, { bodyWorn: true }), '10 mW ERP (unverified)');
  assert.equal(limitText('uk', 3000, {}), '-');
  const { result } = runCoordination({ regionId: 'uk', bandGroup: 'vhf', mics: 2, iems: 1, channelPlan: 'uk-vhf-200k', seed: 1 });
  const hand = describeResult(result, { regionId: 'uk', bodyWorn: false });
  const body = describeResult(result, { regionId: 'uk', bodyWorn: true });
  assert.ok(hand.every((r) => /^10 mW ERP/.test(r.limitText)));
  assert.deepEqual(body.map((r) => r.limitText.slice(0, 5)), ['50 mW', '50 mW', '10 mW']); // two mics, one IEM
});

test('coordination panel: channel plans, optional ranges, outdoor, result notes', () => {
  assert.deepEqual(plansFor('uk', 'uhf').map((p) => p[0]), ['uk-ch38-uncoordinated', 'uk-ch38-coordinated']);
  assert.deepEqual(plansFor('uk', 'vhf').map((p) => p[0]), ['uk-vhf-200k', 'uk-vhf-50k']);
  assert.deepEqual(plansFor('eu', 'uhf'), []);
  const names = (g, r) => rangeCards('uk', g, r).map((c) => c.name);
  assert.ok(!names('uhf', '').includes('606.5-613.5 MHz'), 'optional ranges are not in the default list');
  assert.deepEqual(names('uhf', 'uk-ch38'), ['606.5-613.5 MHz']);
  assert.deepEqual(names('uhf', 'uk-960-1154'), ['960-1154 MHz']);
  const ch38 = rangeCards('uk', 'uhf', 'uk-ch38')[0];
  assert.equal(ch38.licenceClass, 'shared'); assert.equal(ch38.verification.warn, true);
  const run = runCoordination({ regionId: 'uk', bandGroup: 'uhf', mics: 3, iems: 0, channelPlan: 'uk-ch38-uncoordinated', seed: 1 });
  assert.equal(run.result.ok, true);
  const allowed = [606.6, 607.5, 608.15, 609.15, 609.95, 610.55, 611.25, 612.3, 613.15, 613.5];
  assert.ok(run.result.frequencies.every((f) => allowed.includes(f.freqMHz)));
  assert.ok(run.result.notes.some(isLimitWarning));
  const hi = runCoordination({ regionId: 'uk', rangeId: 'uk-960-1154', bandGroup: 'uhf', mics: 2, iems: 0, outdoor: true, seed: 1 });
  assert.ok(hi.result.frequencies.every((f) => f.freqMHz < 976.5 || f.freqMHz > 979.5));
  assert.equal(isLimitWarning('Planning estimate only'), false);
});

test('Tx power limit hint: UK limit text, warning when above, region shared with the panel', () => {
  const h = txLimitHint('uk', 174.2, 10, 0); // 10 dBm = 10 mW EIRP = 7.8 mW ERP
  assert.match(h.text, /United Kingdom limit for this band: 10 mW handheld \/ 50 mW body-worn ERP, draft IR 2030\./);
  assert.equal(h.over, false);
  const mid = txLimitHint('uk', 174.2, 15, 0); // 31.6 mW EIRP -> 19.2 mW ERP: above handheld, under body-worn
  assert.equal(mid.over, false); assert.match(mid.text, /only for a body-worn transmitter/);
  const over = txLimitHint('uk', 174.2, 20, 2); // 22 dBm EIRP -> 19.85 dBm ERP = 96 mW
  assert.equal(over.over, true); assert.match(over.text, /above that limit/);
  assert.equal(txLimitHint('uk', 3000, 10, 0), null);
  assert.equal(txLimitHint('uk', NaN, 10, 0), null);
  assert.equal(txLimitHint('uk', 864, 20, 0).over, true); // 100 mW EIRP = 61 mW ERP vs 10 mW
  assert.equal(getCoordRegion(), 'uk');
  let seen = null; const off = onCoordRegion((id) => { seen = id; });
  setCoordRegion('us'); assert.equal(seen, 'us'); assert.equal(getCoordRegion(), 'us');
  setCoordRegion('nowhere'); assert.equal(getCoordRegion(), 'us');
  setCoordRegion('uk'); off();
});
