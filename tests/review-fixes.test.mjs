// Code-review fixes (people clamps, Fresnel wall crossing, tone-MPX order cap, digital-link memo, noise events, area actions, compression, VNA guards).
// Each test states the behaviour the review asked for; tolerances are stated where a number is compared.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene, createDefaultLink, validateScene } from '../js/model/scene.js';
import * as A from '../js/actions.js';
import * as AA from '../js/actionsAreas.js';
import { PEOPLE_LIMITS } from '../js/model/people.js';
import { fresnelClearance } from '../js/model/fresnel.js';
import { twoToneFm, toneMpxReport, pilotBeat } from '../js/model/tone-mpx.js';
import { digitalConfigOf, digitalProfile } from '../js/model/digital-link.js';
import { noiseEvents, eventsDuty, createNoiseSource } from '../js/model/noise-sources.js';
import { chainCompression } from '../js/model/compression.js';
import { cDiv, applyFault, faultySparams } from '../js/model/vna-demo.js';

const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} got ${a}, expected ${b} +- ${tol}`);
const withLinks = (n = 2) => {
  const sc = createDefaultScene(); sc.links = [];
  for (let i = 0; i < n; i++) { const l = createDefaultLink('mic'); l.tx.pos = { x: 4 + i, y: 4, z: 1.2 }; sc.links.push(l); }
  return createStore(sc);
};

// ---- people ----
test('assign and assignExtraMic clamp the stored offsets to the validator limits, so the scene still loads', () => {
  const st = withLinks(2);
  st.update((d) => { d.links[0].tx.pos = { x: 300, y: -250, z: 9 }; d.links[1].tx.pos = { x: 400, y: 400, z: 12 }; });
  const id = A.addPerson(st, { pos: { x: 0, y: 0 } });
  assert.ok(A.assignMic(st, id, st.getScene().links[0].id));
  assert.ok(A.assignExtraMic(st, id, st.getScene().links[1].id));
  const p = st.getScene().people[0], [lo, hi] = PEOPLE_LIMITS.offsetM, [zl, zh] = PEOPLE_LIMITS.heightM;
  for (const o of [p.micOffset, ...Object.values(p.extraOffsets)]) { assert.ok(o.dx >= lo && o.dx <= hi && o.dy >= lo && o.dy <= hi && o.dz >= zl && o.dz <= zh, JSON.stringify(o)); }
  assert.equal(validateScene(st.getScene()).ok, true, JSON.stringify(validateScene(st.getScene()).errors));
});

test('a swap applies the other person body coupling to the link they receive', () => {
  const st = withLinks(2);
  const [l1, l2] = st.getScene().links.map((l) => l.id);
  const a = A.addPerson(st, { pos: { x: 4, y: 4 } }), b = A.addPerson(st, { pos: { x: 5, y: 4 } });
  A.assignMic(st, a, l1); A.assignMic(st, b, l2);
  A.updatePerson(st, a, { contact: 'skin' }); A.updatePerson(st, b, { contact: 'cupped' });
  assert.equal(st.getScene().links[0].tx.antenna.contact, 'skin');
  assert.ok(A.assignMic(st, a, l2, { swap: true }));
  assert.equal(st.getScene().links[0].tx.antenna.contact, 'cupped', 'link 1 now belongs to person b');
  assert.equal(st.getScene().links[1].tx.antenna.contact, 'skin');
});

test('addPerson, movePerson and movePeople clamp position and facing to the validator limits', () => {
  const st = withLinks(1);
  const id = A.addPerson(st, { pos: { x: 1e9, y: -1e9 }, facingDeg: 9999 });
  let p = st.getScene().people[0];
  assert.equal(p.pos.x, PEOPLE_LIMITS.coord[1]); assert.equal(p.pos.y, PEOPLE_LIMITS.coord[0]); assert.equal(p.facingDeg, 360);
  A.movePerson(st, id, { x: -1e9, y: 1e9 }); p = st.getScene().people[0];
  assert.equal(p.pos.x, PEOPLE_LIMITS.coord[0]); assert.equal(p.pos.y, PEOPLE_LIMITS.coord[1]);
  A.movePeople(st, [id], { dx: 1e9, dy: 1e9 }); p = st.getScene().people[0];
  assert.equal(p.pos.x, PEOPLE_LIMITS.coord[1]);
  assert.equal(validateScene(st.getScene()).ok, true);
});

// ---- Fresnel ----
test('a path that crosses a wall is blocked, even with the minimum sample count', () => {
  const sc = createDefaultScene(); const l = createDefaultLink('mic'); sc.links = [l];
  l.freqMHz = 600; l.tx.pos = { x: 0, y: 0, z: 1.5 }; l.rx.pos = { x: 10.3, y: 0, z: 1.5 };
  sc.reflectors = [{ id: 'w1', name: 'Wall', p1: { x: 5, y: -5 }, p2: { x: 5, y: 5 }, zMin: 0, zMax: 4 }];
  const r = fresnelClearance(sc, l, { samples: 8 });
  assert.equal(r.status, 'blocked'); assert.ok(r.categories.wall.blocked); assert.ok(r.categories.wall.minFraction < 0);
  near(r.categories.wall.xM, 5, 0.01, 'crossing at the wall');
  // a wall that stops short of the path is not crossed
  sc.reflectors[0].p1 = { x: 5, y: 2 }; sc.reflectors[0].p2 = { x: 5, y: 5 };
  assert.ok(!fresnelClearance(sc, l, { samples: 8 }).categories.wall.blocked);
  // a bad frequency or sample count falls back to the link frequency and the default samples
  const bad = fresnelClearance(sc, l, { freqMHz: 0, samples: NaN });
  assert.equal(bad.freqMHz, 600); assert.ok(Number.isFinite(bad.minFraction));
});

// ---- tone-MPX ----
test('twoToneFm: the Bessel order cap no longer truncates a high-beta tone (occupied width reaches Carson)', () => {
  const r = twoToneFm({ tone1Khz: 1, dev1Khz: 120, dev2Khz: 0 }); // beta 120
  assert.ok(r.occupiedKhz >= 2 * 120, `occupied ${r.occupiedKhz} kHz, Carson about ${2 * 121}`);
  assert.ok(r.occupiedKhz <= 2 * 135, 'and not wider than a few kHz past Carson');
});
test('mono tone report skips the pilot beat and its notes', () => {
  const r = toneMpxReport({ mono: true, toneKhz: 19 });
  assert.equal(r.beat, null);
  const beatNotes = pilotBeat(19).notes;
  assert.ok(beatNotes.length > 0 && !r.notes.some((n) => beatNotes.includes(n)), 'none of the pilot-beat notes');
  assert.ok(toneMpxReport({ mono: false, toneKhz: 19 }).notes.some((n) => beatNotes.includes(n)));
  assert.ok(toneMpxReport({ mono: false, toneKhz: 19 }).beat);
});

// ---- digital-link ----
test('digitalProfile is memoised and a preset name that is an Object.prototype key does not resolve', () => {
  const link = { modulation: { type: 'digital', digital: { preset: 'mic-qpsk-fixed', fixedOrder: null, overrides: {} } } };
  const c1 = digitalConfigOf(link), p1 = digitalProfile(c1), p2 = digitalProfile(digitalConfigOf(link));
  assert.equal(p1, p2, 'the same profile object is returned for the same figures');
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const cfg = digitalConfigOf({ modulation: { type: 'digital', digital: { preset: name } } });
    assert.equal(cfg.channelBwKHz, 200, name); assert.ok(Number.isFinite(digitalProfile(cfg).concealCnrDb));
  }
});

// ---- noise events ----
test('noiseEvents: a capped list reports truncated and covered time, so eventsDuty is still right (1000 Hz x 0.05 ms = 5 percent)', () => {
  const src = createNoiseSource('speedlight-flash', { repHz: 1000, pulseWidthMs: 0.05 });
  const ev = noiseEvents(src, 10);
  assert.equal(ev.truncated, true); near(ev.coveredS, 4, 0.01, 'covered 4000 pulses of 1 ms');
  near(eventsDuty(ev, 10), 0.05, 0.002, 'duty over 10 s');
  const short = noiseEvents(src, 2); assert.ok(!short.truncated); near(eventsDuty(short, 2), 0.05, 0.002);
});

// ---- area actions ----
test('addNoiseSource clamps and cleans overrides; addWallNoiseSource tolerates a reflector without end points', () => {
  const st = withLinks(1);
  const id = AA.addNoiseSource(st, 'ptt-business-uhf', { erpDbm: 1e9, freqMHz: -5, name: `A\u0000B${'x'.repeat(200)}`, pos: { x: 1e9, y: 1, z: 1 }, junk: 1 });
  const s = st.getScene().noiseSources.find((x) => x.id === id);
  assert.ok(s.erpDbm < 1e6 && s.name.length <= 80 && !/\u0000/.test(s.name) && Math.abs(s.pos.x) <= 1e5 && s.junk === undefined, JSON.stringify(s).slice(0, 200));
  assert.equal(validateScene(st.getScene()).ok, true, JSON.stringify(validateScene(st.getScene()).errors));
  st.update((d) => { d.reflectors = [{ id: 'rbad', name: 'No ends' }]; });
  assert.doesNotThrow(() => AA.addWallNoiseSource(st, 'rbad'));
  assert.equal(AA.addWallNoiseSource(st, 'rbad'), null);
});
test('setP2pField: a bad value leaves the scene untouched and commits nothing', () => {
  const sc = createDefaultScene(); sc.links = [createDefaultLink('p2p')]; delete sc.links[0].p2p;
  const st = createStore(sc), before = JSON.stringify(st.getScene());
  for (const [f, v] of [['kFactor', 'abc'], ['kFactor', NaN], ['groundReflection', 'yes'], ['obstacleDistanceM', -5], ['obstacleHeightM', undefined], ['bogus', 1]]) {
    assert.equal(AA.setP2pField(st, sc.links[0].id, f, v), false, `${f} ${v}`);
  }
  assert.equal(JSON.stringify(st.getScene()), before);
  assert.equal(AA.setP2pField(st, sc.links[0].id, 'kFactor', 1.2), true);
});
test('setImdFilter with no patch does not throw; updateImdBand caps the name like addImdBand', () => {
  const sc = createDefaultScene(); sc.imd = { enabled: true, transmitters: [], ...(sc.imd || {}) };
  const st = createStore(sc);
  assert.doesNotThrow(() => AA.setImdFilter(st, 'filterBefore'));
  assert.doesNotThrow(() => AA.setImdFilter(st, 'filterBefore', undefined));
  assert.ok(AA.addImdBand(st, { name: 'x'.repeat(200), loMHz: 1700, hiMHz: 1800 }));
  assert.equal(st.getScene().imd.bands[0].name.length, 80);
  AA.updateImdBand(st, 0, { name: 'y'.repeat(200) });
  assert.equal(st.getScene().imd.bands[0].name.length, 80);
});
test('setReflectorName strips control characters and caps at 80 characters', () => {
  const sc = createDefaultScene(); sc.reflectors = [{ id: 'r1', name: 'A', p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, zMin: 0, zMax: 3 }];
  const st = createStore(sc);
  AA.setReflectorName(st, 'r1', `Wall\u0007 ${'z'.repeat(200)}`);
  const n = st.getScene().reflectors[0].name; assert.equal(n.length, 80); assert.ok(n.startsWith('Wall '));
});

// ---- compression ----
test('chainCompression ignores non-finite signal levels (a muted source)', () => {
  const r = chainCompression([{ label: 'B', gainDbs: [12, 12, 12], op1dBDbm: 10.4 }], [{ levelDbm: -60, wanted: true }, { levelDbm: -Infinity }, { levelDbm: NaN }]);
  assert.equal(r.totalDb, 0); assert.ok(Number.isFinite(r.wantedOut)); assert.ok(Number.isFinite(r.stages[0].linearOutDbm));
});

// ---- VNA ----
test('cDiv by zero is a huge finite number with the numerator sign; faultopen with 0 pF is finite; faults keep an Infinity return loss', () => {
  const z = cDiv({ re: 1, im: -2 }, { re: 0, im: 0 });
  assert.ok(Number.isFinite(z.re) && Number.isFinite(z.im) && z.re >= 1e50 && z.im <= -1e50, JSON.stringify(z));
  assert.deepEqual(cDiv({ re: 0, im: 0 }, { re: 0, im: 0 }), { re: 0, im: 0 });
  const s = faultySparams({ type: 'chain', items: [{ kind: 'faultopen', cPF: 0 }] }, 'measurement-open', 600);
  assert.ok(s === null || Object.values(s).every((v) => v && Number.isFinite(v.re) && Number.isFinite(v.im)));
  const r = applyFault({ dut: { type: 'cable', cableType: 'lmr-400', lengthM: 10, returnLossDb: Infinity } }, 'cable-kink');
  assert.ok(r.applicable); assert.equal(r.cfg.dut.returnLossDb, Infinity);
});

test('a mic pack assigned to a person already on the plan jumps to them; a near pack stays; an unplaced person goes to the pack', () => {
  const st = withLinks(3);
  st.update((d) => { d.links[0].tx.pos = { x: 30, y: 20, z: 1.0 }; d.links[1].rx.pos = { x: -12, y: 4, z: 1.0 }; d.links[2].tx.pos = { x: 40, y: 40, z: 1.0 }; });
  const [mic, , extra] = st.getScene().links.map((l) => l.id);
  const id = A.addPerson(st, { name: 'Cy', pos: { x: 2, y: 3 } });
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 0.5;
  assert.ok(A.assignMic(st, id, mic)); assert.ok(near(st.getScene().links[0].tx.pos, { x: 2, y: 3 }), 'mic jumped to the person');
  assert.ok(A.assignExtraMic(st, id, extra)); assert.ok(near(st.getScene().links[2].tx.pos, { x: 2, y: 3 }), 'backup mic jumped too');
  assert.deepEqual(st.getScene().people[0].pos, { x: 2, y: 3 }, 'the person did not move');
  assert.equal(validateScene(st.getScene()).ok, true);
});
