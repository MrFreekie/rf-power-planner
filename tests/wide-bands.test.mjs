// Wider frequency support: VHF / 2.4 GHz / 5.8 GHz bands, coordination of hopping bands, interference floor, wide-band examples.
// Tolerances: FSPL 0.05 dB against FSPL = 20 log10 d + 20 log10 f - 27.55 (d in m, f in MHz); structural values 1e-9.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene, validateScene, migrateScene } from '../js/model/scene.js';
import { solveLink, interferenceRiseDb, fsplDb } from '../js/model/rf.js';
import { INTERFERENCE_RISE_DB as RISE } from '../js/model/rx-params.js';
import { regionBand, groupOfFreq, bandIIIChannelRange, bandIIIChannelsToBlocked, dabBlocksToBlocked, powerLimitFor } from '../js/model/bands.js';
import { coordinateFrequencies, bandOccupancy } from '../js/model/coordination.js';
import { buildExample } from '../js/examples.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (tol ${tol})`);

test('scene validation accepts VHF, UHF, 2.4 and 5.8 GHz carriers', () => {
  for (const f of [170, 216, 600, 2400, 5800]) {
    const s = createDefaultScene(); s.links[0].freqMHz = f;
    assert.equal(validateScene(s).ok, true, String(f));
    assert.ok(Number.isFinite(solveLink(s, s.links[0]).inputPowerDbm));
  }
});

test('fspl at 200 / 600 / 2400 MHz over 10 m matches the hand formula', () => {
  near(fsplDb(10, 200), 20 + 46.0206 - 27.5527, 0.05);
  near(fsplDb(10, 600), 20 + 55.5630 - 27.5527, 0.05);
  near(fsplDb(10, 2400), 20 + 67.6042 - 27.5527, 0.05);
});

test('interference: unset = none, applies only at 2 GHz and above, raises the floor by the table value', () => {
  assert.equal(interferenceRiseDb({}, 2400), 0);
  assert.equal(interferenceRiseDb({ interference: 'busy' }, 600), 0, 'UHF ignores it');
  assert.equal(interferenceRiseDb({ interference: 'busy' }, 2400), RISE['2g4'].busy);
  assert.equal(interferenceRiseDb({ interference: 'busy' }, 5800), 12);
  assert.equal(interferenceRiseDb({ interference: 'typical' }, 5800), 4);
  assert.equal(interferenceRiseDb({ interference: 'quiet' }, 2400), 2);
  assert.equal(interferenceRiseDb({ interference: 'bogus' }, 2400), 0);
  const mk = (itf, f) => {
    const s = createDefaultScene(); s.environment.externalNoise = 0; s.links[0].freqMHz = f;
    if (itf) s.environment.interference = itf;
    return solveLink(s, s.links[0]);
  };
  const base = mk(null, 2400);
  for (const k of ['quiet', 'typical', 'busy']) {
    const r = mk(k, 2400);
    near(r.cascade.noiseFloorDbm - base.cascade.noiseFloorDbm, RISE['2g4'][k], 1e-9, k);
    near(base.marginDb - r.marginDb, RISE['2g4'][k], 1e-9, k + ' margin');
    assert.equal(r.rxPowerDbm, base.rxPowerDbm, 'signal level unchanged');
    assert.ok(r.waterfall.some((w) => w.note && /Interference floor/.test(w.label)), 'waterfall shows it');
  }
  assert.ok(!base.waterfall.some((w) => /Interference/.test(w.label)));
  assert.equal(mk('busy', 600).cascade.noiseFloorDbm, mk(null, 600).cascade.noiseFloorDbm);
});

test('interference: validation and migration', () => {
  const s = createDefaultScene();
  assert.equal(s.environment.interference, undefined, 'new scenes leave it unset');
  s.environment.interference = 'typical';
  assert.equal(validateScene(s).ok, true);
  s.environment.interference = 'loud';
  assert.equal(validateScene(s).ok, false);
  s.environment.interference = null;
  const m = migrateScene(s);
  assert.equal(m.environment.interference, undefined);
  assert.equal(validateScene(m).ok, true);
  assert.equal(migrateScene(createDefaultScene()).environment.interference, undefined, 'old saves unchanged');
});

test('bands: VHF, 2.4 and 5.8 GHz ranges exist for every region; default regionBand is still UHF only', () => {
  for (const r of ['uk', 'eu', 'us']) {
    for (const g of ['vhf', '2g4', '5g8']) assert.ok(regionBand(r, null, null, g).length > 0, r + g);
    assert.ok(regionBand(r).every((b) => b.startMHz >= 470), 'default is UHF');
  }
  assert.equal(powerLimitFor('eu', 2440).powerBasis, 'EIRP');
  assert.ok(powerLimitFor('uk', 174.4) && powerLimitFor('uk', 195), 'UK VHF: 173.7-175.1 exempt, 191.9-209.8 shared (190 MHz is in neither)');
  assert.equal(groupOfFreq(200), 'vhf'); assert.equal(groupOfFreq(600), 'uhf'); assert.equal(groupOfFreq(2440), '2g4'); assert.equal(groupOfFreq(5800), '5g8');
  assert.deepEqual(bandIIIChannelRange('eu', 5), { channel: 5, fromMHz: 174, toMHz: 181 });
  assert.deepEqual(bandIIIChannelRange('us', 8), { channel: 8, fromMHz: 180, toMHz: 186 });
  assert.equal(bandIIIChannelsToBlocked('uk', [5, 6, 99]).length, 2);
  const d = dabBlocksToBlocked(['5A', 'zz']);
  assert.equal(d.length, 1);
  near(d[0].toMHz - d[0].fromMHz, 1.536, 1e-9);
});

test('coordination: VHF keeps the intermod behaviour and honours Band III exclusions', () => {
  const blocked = [...bandIIIChannelsToBlocked('eu', [5, 6, 7]), ...dabBlocksToBlocked(['10A'])]; // 174-195 MHz and DAB 10A
  const r = coordinateFrequencies({ mics: 4, regionId: 'eu', bandGroup: 'vhf', blocked });
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'intermod');
  for (const f of r.frequencies) {
    assert.ok(f.freqMHz > 195 && f.freqMHz < 216, String(f.freqMHz));
    assert.ok(!(f.freqMHz > 209.168 && f.freqMHz < 210.704), 'inside DAB 10A: ' + f.freqMHz);
  }
  assert.ok(r.minProductDistanceKHz >= r.guardKHz);
});

test('coordination: 2.4 GHz reports occupancy instead of assigning frequencies', () => {
  const r = coordinateFrequencies({ mics: 3, regionId: 'eu', bandGroup: '2g4', wifiChannels: [1, 6, 11] });
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'occupancy');
  assert.equal(r.hopping, true);
  assert.ok(r.frequencies.every((f) => f.freqMHz === null));
  assert.deepEqual(r.assignments, {});
  // channels 1, 6, 11 occupy 2402-2422, 2427-2447, 2452-2472: 60 MHz of the 83.5 MHz band, free 23.5 MHz
  near(r.occupancy.occupiedMHz, 60, 1e-9);
  near(r.occupancy.freeMHz, 23.5, 1e-9);
  near(r.occupancy.occupiedFraction, 60 / 83.5, 1e-9);
  near(r.occupancy.perSystemFreeMHz, 23.5 / 3, 1e-9);
  assert.ok(r.notes.some((n) => /hop/.test(n)));
  // auto-detected from the carrier frequencies: 2437 is the centre of Wi-Fi channel 6, 2483 lies above channel 13's span
  const auto = coordinateFrequencies({ transmitters: [{ id: 'a', kind: 'mic', freqMHz: 2437 }, { id: 'b', kind: 'iem', freqMHz: 2483 }], wifiChannels: [6] });
  assert.equal(auto.mode, 'occupancy');
  assert.equal(auto.occupancy.links[0].wifiChannel, 6);
  assert.equal(auto.occupancy.links[0].overlapsInUse, true);
  assert.equal(auto.occupancy.links[1].overlapsInUse, false);
});

test('coordination: 5.8 GHz occupancy with adjacent Wi-Fi channels merges the spans', () => {
  // channel 149 centre 5745 (5735-5755), 153 centre 5765 (5755-5775): union 5735-5775 = 40 MHz inside 5725-5875
  const w = bandOccupancy({ group: '5g8', wifiChannels: [149, 153] });
  near(w.occupiedMHz, 40, 1e-9);
  near(w.freeMHz, 110, 1e-9);
  near(w.largestFreeMHz, 100, 1e-9); // 5775-5875
});

test('wide-band examples: notes match the model', () => {
  const nums = (id) => { const e = buildExample(id); const r = solveLink(e.scene, e.scene.links[0]); return { e, r, cable: r.rxPowerDbm - r.inputPowerDbm }; };
  const v = nums('band-vhf'), u = nums('band-uhf'), g = nums('band-2g4');
  for (const x of [v, u, g]) {
    for (const t of [x.r.fsplDb, x.r.pathLossDb, x.cable, x.r.marginDb]) assert.ok(x.e.note.includes(t.toFixed(1)), `${x.e.id}: ${t.toFixed(1)}`);
  }
  near(g.r.fsplDb - v.r.fsplDb, 20 * Math.log10(12), 1e-6);
  assert.ok(g.e.note.includes((g.r.fsplDb - v.r.fsplDb).toFixed(1)));
  const w = buildExample('wifi-busy-2g4');
  const on = solveLink(w.scene, w.scene.links[0]);
  const off = structuredClone(w.scene); delete off.environment.interference;
  const base = solveLink(off, off.links[0]);
  assert.equal(w.scene.environment.interference, 'busy');
  near(base.marginDb - on.marginDb, 20, 1e-9);
  assert.equal(base.status, 'pass');
  assert.equal(on.status, 'fail');
  for (const t of [on.cascade.noiseFloorDbm, base.marginDb, on.marginDb]) assert.ok(w.note.includes(t.toFixed(1)), t.toFixed(1));
});

test('band receiver presets follow BAND_PROFILES: sensitivity = kTB + NF + CNR, noise bandwidth from the preset', async () => {
  const { RX_PRESETS, rxPresetForFreq } = await import('../js/model/rx-params.js');
  const { typicalTxDbm, bandLimitDbm } = await import('../js/model/bands.js');
  const { createDefaultLink } = await import('../js/model/scene.js');
  for (const id of ['rx-vhf-typical', 'rx-2g4-typical', 'rx-5g8-typical']) {
    const p = RX_PRESETS[id];
    near(p.sensitivityDbm, -174 + 10 * Math.log10(p.channelBwKhz * 1000) + p.noiseFigureDb + p.requiredCnrDb, 1.0, id);
  }
  assert.equal(rxPresetForFreq('mic', 200), 'rx-vhf-typical');
  assert.equal(rxPresetForFreq('iem', 600), 'iem-bodypack-typical');
  assert.equal(rxPresetForFreq('mic', 2440), 'rx-2g4-typical');
  assert.equal(rxPresetForFreq('mic', 5800), 'rx-5g8-typical');
  assert.equal(typicalTxDbm('mic', 2440), 10); assert.equal(typicalTxDbm('iem', 200), 17); assert.equal(typicalTxDbm('mic', 600), null);
  assert.equal(bandLimitDbm('eu', 2440).maxDbm, 20);
  const s = createDefaultScene(); s.environment.externalNoise = 0;
  const l = s.links[0]; l.freqMHz = 2440; l.rx.rxPreset = 'rx-2g4-typical'; l.rx.sensitivityDbm = -90;
  assert.equal(validateScene(s).ok, true);
  const c = solveLink(s, l).cascade;
  near(c.kTBDbm, -174 + 10 * Math.log10(2e6), 1e-9);
  assert.equal(c.requiredSnrDb, 14);
});
