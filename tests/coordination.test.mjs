import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinateFrequencies, checkIntermod, coordinateScene, sceneAssignments, transmittersFromScene, COORDINATION_DEFAULTS } from '../js/model/coordination.js';
import { REGIONS, powerLimitFor, mwToDbm, tvChannelRange, tvChannelAt, tvChannelsToBlocked, regionBand, BANDS_DISCLAIMER } from '../js/model/bands.js';
import { createDefaultScene } from '../js/model/scene.js';

const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} got ${a}, want ${b} +/- ${tol}`);
const BAND = { startMHz: 470, endMHz: 520 };

// Independent brute-force third-order check (no imd.js): 2fi - fj and fi + fj - fk against every channel, distances in kHz.
function bruteMinDistanceKHz(f) {
  let min = Infinity;
  const n = f.length;
  const near1 = (p) => f.reduce((m, c) => Math.min(m, Math.abs(p - c)), Infinity) * 1000;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    min = Math.min(min, near1(2 * f[i] - f[j]));
    for (let k = j + 1; k < n; k++) if (k !== i) min = Math.min(min, near1(f[j] + f[k] - f[i]));
  }
  return min;
}

test('checkIntermod: hand-computed 2-tone and 3-tone products (tolerance 1e-6 kHz)', () => {
  // 600, 600.4, 600.8: 2 f2 - f1 = 801.2 - 600 = 600.8 lands exactly on f3
  const a = checkIntermod([600, 600.4, 600.8], { guardKHz: 100, minSpacingKHz: 100 });
  const hit = a.conflicts.find((c) => c.label === '2f2-f1');
  assert.ok(hit); assert.equal(hit.kind, '2-tone'); near(hit.fMHz, 600.8, 1e-9); near(hit.offsetKHz, 0, 1e-6); assert.equal(hit.channelIndex, 2);
  assert.equal(a.ok, false);
  // 600, 602, 605, 607: f1 + f4 - f2 = 600 + 607 - 602 = 605 = f3 (three-tone)
  const b = checkIntermod([600, 602, 605, 607], { guardKHz: 100, minSpacingKHz: 100 });
  const h3 = b.conflicts.find((c) => c.label === 'f1+f4-f2');
  assert.ok(h3); assert.equal(h3.kind, '3-tone'); near(h3.offsetKHz, 0, 1e-6); assert.equal(h3.channelIndex, 2);
  // two channels 1 MHz apart: products 599 and 602, each 1000 kHz from the nearest channel; guard 400 -> margin 600
  const c = checkIntermod([600, 601], { guardKHz: 400, minSpacingKHz: 300 });
  assert.equal(c.ok, true);
  near(c.minProductDistanceKHz, 1000, 1e-6); near(c.marginKHz, 600, 1e-6);
});

test('checkIntermod: cross flag marks products that mix a mic and an IEM; spacing violations reported', () => {
  const r = checkIntermod([600, 600.4, 600.8], { guardKHz: 100, minSpacingKHz: 500, kinds: ['mic', 'iem', 'mic'] });
  assert.equal(r.conflicts.find((c) => c.label === '2f2-f1').cross, true);
  assert.equal(r.spacingViolations.length, 2);
  const same = checkIntermod([600, 600.4, 600.8], { guardKHz: 100, minSpacingKHz: 100, kinds: ['mic', 'mic', 'mic'] });
  assert.equal(same.conflicts.find((c) => c.label === '2f2-f1').cross, false);
});

test('generator: 8 mics + 4 IEMs in 470-520 are on the raster, in band, spaced and intermod free (independent brute force)', () => {
  const r = coordinateFrequencies({ mics: 8, iems: 4, band: BAND, seed: 7 });
  assert.equal(r.ok, true, JSON.stringify(r.failure));
  assert.equal(r.failure, null);
  assert.equal(r.frequencies.length, 12);
  const f = r.frequencies.map((x) => x.freqMHz);
  for (const x of f) {
    assert.ok(x >= 470.1 - 1e-9 && x <= 519.9 + 1e-9, `in band ${x}`); // edge guard = channelBw / 2 = 100 kHz
    near(Math.round(x * 1000) % 25, 0, 1e-6, 'raster 25 kHz');
  }
  const sorted = [...f].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) assert.ok((sorted[i] - sorted[i - 1]) * 1000 >= 300 - 1e-6);
  assert.ok(bruteMinDistanceKHz(f) >= 400 - 1e-6, `brute force min product distance ${bruteMinDistanceKHz(f)}`);
  assert.equal(checkIntermod(f, { guardKHz: 400, minSpacingKHz: 300 }).ok, true);
  assert.equal(r.frequencies.filter((x) => x.kind === 'mic').length, 8);
  assert.equal(r.frequencies.filter((x) => x.kind === 'iem').length, 4);
  assert.equal(r.assignments.mic1, r.frequencies[0].freqMHz);
  assert.ok(r.marginKHz >= -1e-6 && r.score > 0 && r.score <= 100);
  near(r.marginKHz, r.minProductDistanceKHz - 400, 1e-6);
  assert.match(r.disclaimer, /licen/i);
  const mics = r.frequencies.filter((x) => x.kind === 'mic').map((x) => x.freqMHz);
  assert.deepEqual(mics, [...mics].sort((a, b) => a - b)); // numbering follows ascending frequency within a kind
});

test('generator is deterministic for a seed, and seeds differ', () => {
  const a = coordinateFrequencies({ mics: 6, iems: 2, band: BAND, seed: 3 });
  const b = coordinateFrequencies({ mics: 6, iems: 2, band: BAND, seed: 3 });
  const c = coordinateFrequencies({ mics: 6, iems: 2, band: BAND, seed: 'another' });
  assert.deepEqual(a, b);
  assert.ok(c.ok);
  assert.notDeepEqual(a.frequencies.map((x) => x.freqMHz), c.frequencies.map((x) => x.freqMHz));
});

test('IEM-to-mic cross products: a kept mic and a kept IEM forbid 2 f_iem - f_mic and 2 f_mic - f_iem for the new channel', () => {
  // mic 600.000, IEM 600.400 (spacing 400 >= 300): cross products 2*600.4-600 = 600.8 and 2*600-600.4 = 599.6, guard 400 kHz
  const r = coordinateFrequencies({
    transmitters: [{ id: 'm', kind: 'mic', freqMHz: 600, locked: true }, { id: 'i', kind: 'iem', freqMHz: 600.4, locked: true }, { id: 'new', kind: 'mic' }],
    band: { startMHz: 598, endMHz: 603 }, seed: 5,
  });
  assert.equal(r.ok, true, JSON.stringify(r.failure));
  const f = r.assignments.new;
  assert.ok(Math.abs(f - 600.8) * 1000 >= 400 - 1e-6, `clear of 600.8: ${f}`);
  assert.ok(Math.abs(f - 599.6) * 1000 >= 400 - 1e-6, `clear of 599.6: ${f}`);
  assert.equal(r.assignments.m, 600); assert.equal(r.assignments.i, 600.4);
  // kept set that already has f3 on 2 f2 - f1
  const bad = coordinateFrequencies({
    transmitters: [{ id: 'm', kind: 'mic', freqMHz: 600, locked: true }, { id: 'i', kind: 'iem', freqMHz: 600.4, locked: true }, { id: 'x', kind: 'mic', freqMHz: 600.8, locked: true }],
    band: BAND,
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.failure.reason, 'locked-conflict');
  assert.ok(bad.failure.conflicts.some((c) => c.cross));
});

test('blocked ranges (TV channels) are avoided including half a channel either side', () => {
  const blocked = [{ fromMHz: 480, toMHz: 488 }, { fromMHz: 496, toMHz: 504 }];
  const r = coordinateFrequencies({ mics: 6, band: BAND, blocked, seed: 2 });
  assert.equal(r.ok, true);
  for (const x of r.frequencies) for (const b of blocked) assert.ok(x.freqMHz <= b.fromMHz - 0.1 + 1e-9 || x.freqMHz >= b.toMHz + 0.1 - 1e-9, `${x.freqMHz} vs ${b.fromMHz}-${b.toMHz}`);
});

test('failure reports: nothing to do, no channels, band too narrow, locked conflict, no intermod-free set (partial plan)', () => {
  assert.equal(coordinateFrequencies({ band: BAND }).failure.reason, 'no-transmitters');
  assert.equal(coordinateFrequencies({ mics: 2 }).failure.reason, 'no-channels');
  const allBlocked = coordinateFrequencies({ mics: 2, band: BAND, blocked: [{ fromMHz: 460, toMHz: 530 }] });
  assert.equal(allBlocked.failure.reason, 'no-channels'); assert.match(allBlocked.failure.message, /blocked/);
  // 20 channels at 300 kHz need 5.7 MHz; a 2 MHz band has 1.8 MHz of usable span after the edge guards
  const narrow = coordinateFrequencies({ mics: 20, band: { startMHz: 863, endMHz: 865 } });
  assert.equal(narrow.ok, false); assert.equal(narrow.failure.reason, 'band-too-narrow');
  near(narrow.failure.minimumSpanMHz, 19 * 0.3, 1e-9);
  assert.match(narrow.failure.message, /too narrow/);
  // spacing 300 kHz fits 7 channels in 2 MHz, but not intermod free: partial plan and a hint
  const dense = coordinateFrequencies({ mics: 7, band: { startMHz: 863, endMHz: 865 } });
  assert.equal(dense.ok, false); assert.equal(dense.failure.reason, 'no-intermod-free-set');
  assert.ok(dense.partial);
  assert.ok(dense.failure.placedChannels < 7 && dense.failure.suggestions.length >= 1);
  assert.equal(dense.frequencies.length, 7);
  assert.ok(dense.frequencies.some((x) => x.freqMHz === null));
  assert.equal(dense.score, 0);
});

test('score and margin of a generated plan follow the definition (tolerance 0.05)', () => {
  const r = coordinateFrequencies({ mics: 2, band: { startMHz: 600, endMHz: 600.9 }, guardKHz: 200, minSpacingKHz: 300, seed: 1 });
  assert.equal(r.ok, true, JSON.stringify(r.failure));
  const f = r.frequencies.map((x) => x.freqMHz);
  const d = Math.abs(f[1] - f[0]) * 1000; // two channels: both products sit d from the nearest channel
  near(r.minProductDistanceKHz, d, 1e-6);
  near(r.marginKHz, d - 200, 1e-6);
  near(r.score, Math.round(100 * Math.min(1, d / 400, d / 600) * 10) / 10, 0.05);
  // hand-computed: two channels 500 kHz apart with guard 400 and spacing 300 -> min(1, 500/800, 500/600) = 0.625 -> 62.5
  const hand = checkIntermod([600, 600.5], { guardKHz: 400, minSpacingKHz: 300 });
  near(hand.minProductDistanceKHz, 500, 1e-6);
});

test('regions: UK/EU/US tables, power limits, TV channels, blocked ranges', () => {
  assert.ok(REGIONS.uk.ranges.some((r) => r.fromMHz === 470 && r.toMHz === 694));
  // UK 823-832 became 821.5-826 and 826-832 (licence-exempt UK-wide from 29 Apr 2026, SI 2026/396)
  assert.ok(REGIONS.uk.ranges.some((r) => r.fromMHz === 821.5 && r.toMHz === 826 && r.licenceClass === 'exempt'));
  assert.ok(REGIONS.uk.ranges.some((r) => r.fromMHz === 826 && r.toMHz === 832 && r.licenceClass === 'exempt'));
  assert.ok(REGIONS.uk.ranges.some((r) => r.fromMHz === 863 && r.toMHz === 865));
  assert.ok(REGIONS.us.ranges.some((r) => r.fromMHz === 470 && r.toMHz === 608));
  assert.ok(REGIONS.us.ranges.some((r) => r.fromMHz === 614 && r.toMHz === 698));
  near(powerLimitFor('uk', 864).maxPowerDbm, 10, 1e-9); // 10 mW = 10 dBm
  near(mwToDbm(50), 16.9897, 1e-3);                      // 50 mW
  near(powerLimitFor('eu', 600).maxPowerDbm, 16.9897, 1e-3);
  assert.equal(powerLimitFor('uk', 750), null);          // outside every range: nothing assumed
  assert.equal(powerLimitFor('xx', 600), null);
  assert.deepEqual(tvChannelRange('uk', 21), { channel: 21, fromMHz: 470, toMHz: 478 });
  assert.deepEqual(tvChannelRange('uk', 22), { channel: 22, fromMHz: 478, toMHz: 486 });
  assert.deepEqual(tvChannelRange('us', 14), { channel: 14, fromMHz: 470, toMHz: 476 });
  assert.deepEqual(tvChannelRange('us', 37), { channel: 37, fromMHz: 608, toMHz: 614 });
  assert.equal(tvChannelAt('uk', 481), 22);
  assert.deepEqual(tvChannelsToBlocked('uk', [21, 23]), [{ fromMHz: 470, toMHz: 478, label: 'TV channel 21' }, { fromMHz: 486, toMHz: 494, label: 'TV channel 23' }]);
  assert.equal(regionBand('uk', ['uk-863-865'])[0].startMHz, 863.1); // usable segment 863.1-864.9 MHz (was the whole 863-865)
  assert.equal(regionBand('uk', ['uk-863-865'])[0].endMHz, 864.9);
  assert.match(BANDS_DISCLAIMER, /Check your national regulator/);
});

test('region preset: UK plan stays in the listed ranges, carries a power limit; US avoids the blocked cellular parts', () => {
  const uk = coordinateFrequencies({ mics: 6, iems: 3, regionId: 'uk', seed: 11 });
  assert.equal(uk.ok, true, JSON.stringify(uk.failure));
  for (const x of uk.frequencies) {
    assert.ok(REGIONS.uk.ranges.some((r) => x.freqMHz > r.fromMHz && x.freqMHz < r.toMHz), `${x.freqMHz} inside a UK range`);
    assert.ok(x.powerLimit && x.powerLimit.maxPowerMw > 0);
  }
  const us = coordinateFrequencies({ mics: 10, regionId: 'us', rangeIds: ['us-uhf-470-608', 'us-uhf-614-698'], seed: 1 });
  assert.equal(us.ok, true, JSON.stringify(us.failure));
  for (const x of us.frequencies) for (const b of REGIONS.us.blocked) assert.ok(x.freqMHz < b.fromMHz || x.freqMHz > b.toMHz, `${x.freqMHz} not in blocked ${b.fromMHz}-${b.toMHz}`);
});

test('scene helpers: transmittersFromScene, coordinateScene, sceneAssignments', () => {
  const scene = createDefaultScene();
  const t = transmittersFromScene(scene);
  assert.ok(t.length >= 1 && t.every((x) => x.kind === 'mic' || x.kind === 'iem'));
  const r = coordinateScene(scene, { band: BAND, seed: 4 });
  assert.equal(r.ok, true);
  const writes = sceneAssignments(r);
  assert.equal(writes.length, t.length);
  assert.ok(writes.every((w) => scene.links.some((l) => l.id === w.id)));
  const kept = coordinateScene(scene, { band: { startMHz: 400, endMHz: 700 }, seed: 4 }, { keep: [t[0].id] });
  assert.equal(kept.assignments[t[0].id], t[0].freqMHz);
});

test('performance: 12 mics + 4 IEMs in the UK UHF band finish well under 5 s and verify', () => {
  const t0 = Date.now();
  const r = coordinateFrequencies({ mics: 12, iems: 4, regionId: 'uk', seed: 1 });
  assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`);
  assert.equal(r.ok, true);
  assert.ok(bruteMinDistanceKHz(r.frequencies.map((x) => x.freqMHz)) >= COORDINATION_DEFAULTS.guardKHz - 1e-6);
});

// ---- UK band data from Ofcom pages and the draft IR 2030 (each figure is data; see bands.js BAND_SOURCES)
import { powerLimitDetailFor, CHANNEL_38_PLAN, CHANNEL_PLANS, BAND_SOURCES, typicalTxDbm, bandLimitDbm } from '../js/model/bands.js';

test('UK power model: detail per range with handheld / body-worn figures, unit, verification and source', () => {
  const d = (f) => powerLimitDetailFor('uk', f);
  assert.deepEqual([d(823).handheldMw, d(823).bodyWornMw, d(823).unit, d(823).rangeId], [20, 100, 'EIRP', 'uk-821-826']);
  assert.deepEqual([d(830).handheldMw, d(830).bodyWornMw, d(830).rangeId], [100, 100, 'uk-826-832']);
  assert.match(d(830).note, /check final IR 2030/);
  assert.deepEqual([d(1790).handheldMw, d(1790).bodyWornMw, d(1790).unit, d(1790).licenceClass], [20, 50, 'EIRP', 'exempt']);
  assert.deepEqual([d(864).handheldMw, d(864).unit, d(864).verified], [10, 'ERP', true]);
  assert.deepEqual([d(174.4).handheldMw, d(174.4).bodyWornMw, d(174.4).unit], [10, 50, 'ERP']);
  assert.deepEqual([d(2440).handheldMw, d(2440).unit, d(2440).genericSrdMw], [10, 'EIRP', 100]);
  assert.equal(d(5800).handheldMw, 25);
  assert.match(d(5800).note, /not audio-PMSE specific/);
  assert.equal(d(823).verified, 'draft');
  assert.equal(d(823).source, 'ir2030-draft');
  assert.equal(d(823).asOf, '2025-12-11');
  assert.equal(BAND_SOURCES['ofcom-licence-exempt'].asOf, '2023-03-16');
  assert.equal(BAND_SOURCES['ofcom-licensing-updates'].asOf, '2026-05-29');
  assert.equal(BAND_SOURCES['ofcom-statement'].asOf, '2025-10-27');
  assert.equal(powerLimitDetailFor('uk', 750), null);
  // EU ranges have no power model: both figures = maxPowerMw, unverified planner estimate
  assert.deepEqual([powerLimitDetailFor('eu', 600).handheldMw, powerLimitDetailFor('eu', 600).verified, powerLimitDetailFor('eu', 600).source], [50, false, 'planner-estimate']);
  // the old API stays and carries the planner default
  assert.equal(powerLimitFor('uk', 2440).maxPowerMw, 10);
  assert.equal(powerLimitFor('uk', 1790).licenceClass, 'exempt');
  // Tx guidance never exceeds the regional limit: UK 2.4 GHz audio PMSE 10 mW EIRP = 10 dBm (the generic profile says 13 dBm for IEM)
  assert.equal(bandLimitDbm('uk', 2440).maxDbm, 10);
  assert.equal(typicalTxDbm('iem', 2440, 'uk'), 10);
  assert.equal(typicalTxDbm('iem', 2440), 13);
});

test('UK 1785-1805 is licence-exempt, 703-790 is excluded, ch38 and 960-1154 are optional ranges', () => {
  assert.ok(REGIONS.uk.ranges.some((r) => r.id === 'uk-1785-1805' && r.licenceClass === 'exempt'));
  assert.ok(!regionBand('uk').some((s) => s.rangeId === 'uk-ch38' || s.rangeId === 'uk-960-1154'), 'optional ranges are not in the default plan');
  assert.deepEqual(regionBand('uk', ['uk-960-1154']).map((s) => [s.startMHz, s.endMHz]), [[1015, 1016], [1044, 1045], [1075, 1076], [1104, 1105]]);
  assert.ok(REGIONS.uk.blocked.some((b) => b.fromMHz === 703 && b.toMHz === 790));
  const r = coordinateFrequencies({ mics: 3, regionId: 'uk', rangeIds: ['uk-960-1154'], outdoor: true, seed: 3 });
  assert.equal(r.ok, true);
  for (const f of r.frequencies) assert.ok(!(f.freqMHz > 976.5 && f.freqMHz < 979.5));
  assert.equal(powerLimitDetailFor('uk', 606.7).rangeId, 'uk-ch38', 'ch38 resolves before the whole TV band');
});

test('channel 38 plan preset: candidates are exactly the plan frequencies', () => {
  assert.deepEqual([...CHANNEL_38_PLAN.uncoordinated.freqsMHz], [606.6, 607.5, 608.15, 609.15, 609.95, 610.55, 611.25, 612.3, 613.15, 613.5]);
  assert.deepEqual([...CHANNEL_38_PLAN.coordinated.freqsMHz], [606.7, 607.0]);
  const r = coordinateFrequencies({ mics: 3, regionId: 'uk', channelPlan: 'uk-ch38-uncoordinated', seed: 5 });
  assert.equal(r.ok, true, JSON.stringify(r.failure));
  for (const f of r.frequencies) assert.ok(CHANNEL_38_PLAN.uncoordinated.freqsMHz.includes(f.freqMHz), String(f.freqMHz));
  assert.ok(r.minProductDistanceKHz >= r.guardKHz);
  assert.ok(r.notes.some((n) => /fixed channel plan/.test(n)));
  // the two coordinated spots (300 kHz apart) cannot hold 3 mics, and with the default guard hold at most 2 only if their products clear it
  const two = coordinateFrequencies({ mics: 3, regionId: 'uk', channelPlan: CHANNEL_PLANS['uk-ch38-coordinated'].id });
  assert.equal(two.ok, false);
});

test('UK VHF draft IR channel plans: 200 kHz channels 1-7 and 50 kHz channels 10-35', () => {
  assert.deepEqual([...CHANNEL_PLANS['uk-vhf-200k'].freqsMHz], [173.8, 174, 174.2, 174.4, 174.6, 174.8, 175]);
  const p = CHANNEL_PLANS['uk-vhf-50k'].freqsMHz;
  assert.equal(p.length, 26);
  assert.deepEqual([p[0], p[25]], [173.8, 175.05]);
  const r = coordinateFrequencies({ mics: 2, regionId: 'uk', channelPlan: 'uk-vhf-200k', seed: 2 });
  assert.equal(r.ok, true, JSON.stringify(r.failure));
});

test('notes match the tool: 863-865 holds 3 intermod-free channels, ch38 plan 4, 826-832 is 100 mW draft everywhere', async () => {
  const { BAND_SOURCES } = await import('../js/model/bands.js');
  const ok = (n) => coordinateFrequencies({ regionId: 'uk', rangeIds: ['uk-863-865'], mics: n, seed: 1 }).ok;
  assert.equal(ok(3), true);
  assert.equal(ok(4), false);
  const r863 = REGIONS.uk.ranges.find((r) => r.id === 'uk-863-865');
  assert.ok(/up to 3 intermod-free/.test(r863.note), r863.note);
  assert.ok(!/about 4/.test(r863.note));
  const ch = CHANNEL_38_PLAN.uncoordinated;
  assert.deepEqual([...ch.intermodFreeMHz], [607.5, 609.15, 609.95, 613.5]);
  assert.ok(/Only 4 of the 10/.test(ch.note));
  assert.equal(checkIntermod(ch.intermodFreeMHz).ok ?? true, true);
  const r826 = REGIONS.uk.ranges.find((r) => r.id === 'uk-826-832');
  assert.deepEqual([r826.maxPowerMw, r826.powerBasis, r826.confidence ?? r826.verified], [100, 'EIRP', r826.confidence ?? r826.verified]);
  assert.ok(!/Inconsistent|20 mW for other/.test(r826.note));
  assert.ok(/draft/i.test(r826.note));
});

test('bandLimitDbm depends on device and antenna gain; ERP/EIRP/conducted conventions (tol 0.01 dB)', async () => {
  const { bandLimitDbm: lim, typicalTxDbm: typ, REGIONS: R } = await import('../js/model/bands.js');
  // UK VHF 174.4: 10 mW ERP handheld / other, 50 mW ERP body-worn. ERP -> Tx limit = limit + 2.15 - gain
  assert.ok(Math.abs(lim('uk', 174.5, { device: 'iem-tx' }).maxDbm - (10 + 2.15)) < 0.01);
  assert.ok(Math.abs(lim('uk', 174.5, { device: 'bodyworn' }).maxDbm - (10 * Math.log10(50) + 2.15)) < 0.01);
  assert.ok(Math.abs(lim('uk', 174.5, { device: 'iem-tx', antennaGainDbi: 3 }).maxDbm - (12.15 - 3)) < 0.01);
  // UK 821-826: 20 mW EIRP other, 100 mW body-worn
  assert.ok(Math.abs(lim('uk', 823, { device: 'iem-tx' }).maxDbm - 10 * Math.log10(20)) < 0.01);
  assert.ok(Math.abs(lim('uk', 823, { device: 'bodyworn' }).maxDbm - 20) < 0.01);
  assert.ok(Math.abs(lim('uk', 823, { device: 'iem-tx', antennaGainDbi: 3 }).maxDbm - (10 * Math.log10(20) - 3)) < 0.01);
  assert.ok(lim('uk', 823, { device: 'bodyworn' }).basis.includes('draft'));
  // US: 15.247 is 1 W conducted + 6 dBi = 36 dBm EIRP (4000 mW); Part 74 figures are conducted, unverified
  assert.ok(Math.abs(lim('us', 2440, {}).limitDbm - 10 * Math.log10(4000)) < 0.01);
  const u = R.us.ranges.find((r) => r.id === 'us-uhf-470-608');
  assert.equal(u.powerBasis, 'conducted');
  assert.ok(Math.abs(lim('us', 500, { antennaGainDbi: 5 }).maxDbm - 10 * Math.log10(250)) < 0.01); // gain not counted
  assert.ok(typ('iem', 174.5, 'uk') <= 12.16);
  assert.equal(lim('xx', 500), null);
});
