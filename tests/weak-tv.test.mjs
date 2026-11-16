import test from 'node:test';
import assert from 'node:assert/strict';
import { weakTvScene, weakTvReport, buildExample, WEAK_TV_BLOCK_DBM } from '../js/examples.js';
import { validateScene } from '../js/model/scene.js';
import { simulatedOccupancy, tvChannelOf, tvChannelList } from '../js/model/spectrum-map.js';
import { noiseSourceAt, createNoiseSource, floorRiseDb } from '../js/model/noise-sources.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (tol ${tol})`);
const f1 = (x) => x.toFixed(1);
const note = (id) => buildExample(id).note;
const V = ['on-channel', 'free-gap', 'strong-neighbour', 'strong-cochannel'];

test('wide block seen through a 200 kHz channel: 10 log10(7600/200) = 15.80 dB, inside the block selectivity is 0', () => {
  const src = createNoiseSource('dtv-broadcast', { freqMHz: 570, erpDbm: 20, pos: { x: 0, y: 0, z: 1.5 } });
  const at = (f) => noiseSourceAt(src, { x: 20, y: 0, z: 1.5 }, f, 200, () => 0);
  const a = at(570.4);
  near(a.rawDbm - a.peakDbm, 15.798, 0.01, 'tolerance 0.01 dB'); // hand: 10 log10(38) = 15.798
  assert.equal(a.inChannel, true);
  assert.equal(at(573.7).inChannel, true, 'channel centre 3.7 MHz from the block centre: wholly inside the 3.8 MHz half width');
  assert.equal(at(574.5).inChannel, false);
  // 8 MHz away from the block centre: 4.2 MHz beyond the edge, selectivity 20 + 20 log10(4.2 / 0.1) = 52.46 dB (assumed model)
  near(at(578).selectivityDb, 20 + 20 * Math.log10((8 - 3.8) / 0.1), 0.01);
});

test('weak TV scenes validate; channel plan and illustrative occupancy are as the notes say', () => {
  const occ = simulatedOccupancy('uk-suburban', 'weak-tv-example');
  const on = (n) => occ.channels.find((c) => c.n === n).occupied;
  assert.ok(on(33) && on(34) && !on(30) && !on(31) && !on(29), 'ch 33 and 34 on air, 29-31 free');
  const c33 = tvChannelList(8).find((c) => c.n === 33);
  assert.deepEqual([c33.loMHz, c33.hiMHz, c33.centreMHz], [566, 574, 570]);
  for (const v of V) {
    const s = weakTvScene(v);
    assert.deepEqual(validateScene(s), { ok: true, errors: [] }, v);
    const f = s.links[0].freqMHz, c = tvChannelOf(f, 8);
    assert.equal(c.n, v === 'free-gap' ? 30 : 33, v);
    assert.ok(f - c.loMHz >= 1 && c.hiMHz - f >= 1, 'inside the flat part, 1 MHz or more from the edges');
  }
});

test('on-channel: block power minus 15.8 dB, floor rise from the power sum, notes quote the model', () => {
  const r = weakTvReport('on-channel'), n = r.noise.sources[0];
  near(n.rawDbm, WEAK_TV_BLOCK_DBM.weak, 0.05);
  near(n.averageDbm, WEAK_TV_BLOCK_DBM.weak - 15.798, 0.05); // hand: -85 - 15.8 = -100.8
  near(r.riseDb, 10 * Math.log10(1 + Math.pow(10, (n.averageDbm - r.noise.floorBeforeDbm) / 10)), 0.01, 'rise = 10 log10(1 + I/N)');
  near(r.riseDb, floorRiseDb(r.noise.floorBeforeDbm, n.averageDbm), 0.01);
  for (const v of [f1(n.averageDbm), f1(r.riseDb), f1(r.marginDb), '15.8']) assert.ok(note('tv-weak-on-channel').includes(v), v);
});

test('free gap, strong neighbour, strong co-channel: ordering and quoted figures', () => {
  const R = Object.fromEntries(V.map((v) => [v, weakTvReport(v)]));
  near(R['free-gap'].riseDb, 0, 0.05);
  assert.ok(R['free-gap'].marginDb > R['on-channel'].marginDb);
  assert.ok(R['strong-neighbour'].riseDb > R['on-channel'].riseDb && R['strong-neighbour'].marginDb < R['on-channel'].marginDb);
  assert.ok(R['strong-cochannel'].marginDb < R['strong-neighbour'].marginDb);
  assert.equal(R['strong-cochannel'].result.status, 'marginal');
  const fg = R['free-gap'].noise.sources[0], nb = R['strong-neighbour'].noise.sources[1], sc = R['strong-cochannel'].noise.sources[0];
  for (const v of [f1(fg.selectivityDb), f1(R['free-gap'].riseDb), f1(R['free-gap'].marginDb)]) assert.ok(note('tv-weak-free-gap').includes(v), v);
  for (const v of [f1(nb.selectivityDb), f1(nb.averageDbm), f1(R['strong-neighbour'].riseDb), f1(R['strong-neighbour'].marginDb)]) assert.ok(note('tv-weak-strong-neighbour').includes(v), v);
  for (const v of [f1(sc.averageDbm), f1(R['strong-cochannel'].riseDb), f1(R['strong-cochannel'].marginDb)]) assert.ok(note('tv-strong-cochannel').includes(v), v);
  for (const id of ['tv-weak-on-channel', 'tv-weak-free-gap', 'tv-weak-strong-neighbour', 'tv-strong-cochannel']) {
    assert.match(note(id), /^(Best practice|Less ideal|Problem)/, id);
    assert.ok(note(id).split('. ').length <= 5, id);
  }
});
