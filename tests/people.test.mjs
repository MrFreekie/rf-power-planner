// People model (item 36): scene.people, validation, migration and the actions. Hand-computed anchors: a person at (10, 5) facing 0 with a pack
// offset (dx 0.25, dy 0.25, dz 1.3) puts the pack at (10.25, 5.25, 1.3); facing 90 degrees (towards +x) rotates the same offset to
// (10 + 0.25, 5 - 0.25) (the person's right is -y when they face +x). Tolerance 1e-9 m (pure trigonometry).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene, createDefaultLink, validateScene, migrateScene, SCENE_LIMITS } from '../js/model/scene.js';
import { solveLink } from '../js/model/rf.js';
import * as A from '../js/actions.js';
import { PEOPLE_LIMITS, personPackPositions, rotateOffset, offsetFromPack, prunePeople, createPerson, linkOwners } from '../js/model/people.js';
import { bandPeopleScene, EXAMPLES, buildExample } from '../js/examples.js';

const near = (a, b, tol = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} got ${a}, expected ${b}`);
function twoLinkStore() {
  const sc = createDefaultScene();
  const iem = createDefaultLink('iem');
  sc.links.push(iem);
  sc.links[0].tx.pos = { x: 10.25, y: 5.25, z: 1.3 }; iem.rx.pos = { x: 9.85, y: 4.95, z: 1.0 };
  return createStore(sc);
}

test('rotateOffset anchors: facing 0 unchanged, facing 90 maps (dx, dy) to (dy, -dx), and offsetFromPack inverts it', () => {
  const o = { dx: 0.25, dy: 0.25, dz: 1.3 };
  const r0 = rotateOffset(o, 0); near(r0.x, 0.25); near(r0.y, 0.25); near(r0.z, 1.3);
  const r90 = rotateOffset(o, 90); near(r90.x, 0.25); near(r90.y, -0.25);
  const r90b = rotateOffset({ dx: 1, dy: 0, dz: 1 }, 90); near(r90b.x, 0); near(r90b.y, -1);
  const person = { pos: { x: 3, y: 4 }, facingDeg: 37 };
  const r = rotateOffset(o, 37), back = offsetFromPack(person, { x: 3 + r.x, y: 4 + r.y, z: r.z });
  near(back.dx, 0.25, 1e-9); near(back.dy, 0.25, 1e-9); near(back.dz, 1.3);
});

test('addPerson, assignMic, assignIem: offsets from the packs, names follow the person, unplaced person stands at the first pack', () => {
  const st = twoLinkStore();
  const id = A.addPerson(st, { name: 'Anna', pos: { x: 10, y: 5 } });
  assert.ok(id);
  const mic = st.getScene().links[0].id, iem = st.getScene().links[1].id;
  assert.equal(A.assignMic(st, id, mic), true); assert.equal(A.assignIem(st, id, iem), true);
  const p = st.getScene().people[0];
  near(p.micOffset.dx, 0.25); near(p.micOffset.dy, 0.25); near(p.micOffset.dz, 1.3);
  near(p.iemOffset.dx, -0.15); near(p.iemOffset.dy, -0.05); near(p.iemOffset.dz, 1.0);
  assert.equal(st.getScene().links[0].name, 'Anna mic'); assert.equal(st.getScene().links[1].name, 'Anna IEM');
  assert.deepEqual(validateScene(st.getScene()), { ok: true, errors: [] });
  // wrong kind refused
  assert.equal(A.assignIem(st, id, mic), false);
  // an unplaced person stands where the first assigned pack is
  const st2 = twoLinkStore(); const id2 = A.addPerson(st2, { name: 'Bo' });
  A.assignMic(st2, id2, st2.getScene().links[0].id);
  near(st2.getScene().people[0].pos.x, 10.25); near(st2.getScene().people[0].micOffset.dz, 1.3);
});

test('movePerson keeps offsets; movePeople moves a group by the same step; facing turns packs and antenna azimuths', () => {
  const st = twoLinkStore(); const id = A.addPerson(st, { name: 'Anna', pos: { x: 10, y: 5 } });
  A.assignMic(st, id, st.getScene().links[0].id); A.assignIem(st, id, st.getScene().links[1].id);
  const id2 = A.addPerson(st, { name: 'Ben', pos: { x: 2, y: 2 } });
  A.movePerson(st, id, { x: 20, y: 8 });
  let s = st.getScene();
  near(s.links[0].tx.pos.x, 20.25); near(s.links[0].tx.pos.y, 8.25); near(s.links[0].tx.pos.z, 1.3);
  near(s.links[1].rx.pos.x, 19.85); near(s.links[1].rx.pos.y, 7.95);
  A.movePeople(st, [id, id2], { dx: -1, dy: 1 });
  s = st.getScene();
  near(s.people[0].pos.x, 19); near(s.people[0].pos.y, 9); near(s.people[1].pos.x, 1); near(s.links[0].tx.pos.x, 19.25); near(s.links[0].tx.pos.y, 9.25);
  const az0 = s.links[0].tx.antenna.orientation.az;
  A.updatePerson(st, id, { facingDeg: 90 });
  s = st.getScene();
  near(s.links[0].tx.pos.x, 19.25); near(s.links[0].tx.pos.y, 8.75); // rotated (0.25, 0.25) -> (0.25, -0.25) about (19, 9)
  near(((s.links[0].tx.antenna.orientation.az - az0 + 540) % 360) - 180, 90);
  near(personPackPositions(s.people[0]).mic.y, 8.75);
});

test('assign rules: second owner needs swap; swap gives the other person the previous link; null unassigns; remove keeps links', () => {
  const sc = createDefaultScene(); sc.links.push(createDefaultLink('mic'));
  const st = createStore(sc);
  const a = A.addPerson(st, { name: 'A', pos: { x: 1, y: 1 } }), b = A.addPerson(st, { name: 'B', pos: { x: 5, y: 5 } });
  const l0 = st.getScene().links[0].id, l1 = st.getScene().links[1].id;
  A.assignMic(st, a, l0); A.assignMic(st, b, l1);
  assert.equal(A.assignMic(st, a, l1), false);
  assert.equal(A.assignMic(st, a, l1, { swap: true }), true);
  let s = st.getScene();
  assert.equal(s.people[0].micLinkId, l1); assert.equal(s.people[1].micLinkId, l0);
  assert.equal(s.links[0].name, 'B mic'); assert.equal(s.links[1].name, 'A mic');
  assert.deepEqual(validateScene(s), { ok: true, errors: [] });
  A.assignMic(st, a, null);
  assert.equal(st.getScene().people[0].micLinkId, undefined);
  A.removePerson(st, b);
  assert.equal(st.getScene().people.length, 1); assert.equal(st.getScene().links.length, 2);
  // rename renames automatic link names only
  A.assignMic(st, a, l1); st.update((d) => { d.links[1].name = 'Lead vocal'; });
  A.updatePerson(st, a, { name: 'Alice' });
  assert.equal(st.getScene().links[1].name, 'Lead vocal');
});

test('contact and dampness follow the person onto both pack antennas (wet skin 9 dB)', () => {
  const st = twoLinkStore(); const id = A.addPerson(st, { name: 'A', pos: { x: 10, y: 5 } });
  A.assignMic(st, id, st.getScene().links[0].id);
  const before = solveLink(st.getScene(), st.getScene().links[0]).marginDb;
  A.updatePerson(st, id, { contact: 'skin', dampness: 'wet' });
  const s = st.getScene();
  assert.equal(s.links[0].tx.antenna.contact, 'skin'); assert.equal(s.links[0].tx.antenna.dampness, 'wet');
  near(before - solveLink(s, s.links[0]).marginDb, 9, 1e-9);
});

test('validation: caps, bad ids, dangling and wrong-kind links, duplicate owners; old files without people unchanged; migrate prunes', () => {
  const sc = createDefaultScene();
  assert.equal(sc.people, undefined);
  assert.deepEqual(validateScene(sc), { ok: true, errors: [] });
  const link = sc.links[0].id;
  const bad = (mut) => { const s = structuredClone(sc); s.people = [createPerson({ name: 'A', id: 'p1' })]; mut(s.people[0], s); return validateScene(s); };
  assert.equal(bad(() => {}).ok, true);
  assert.equal(bad((p) => { p.micLinkId = 'nope'; }).ok, false);
  assert.equal(bad((p) => { p.iemLinkId = link; }).ok, false); // a mic link as IEM
  assert.equal(bad((p) => { p.role = 'king'; }).ok, false);
  assert.equal(bad((p) => { p.name = ''; }).ok, false);
  assert.equal(bad((p) => { p.colour = 'puce'; }).ok, false);
  assert.equal(bad((p) => { p.pos = { x: NaN, y: 1 }; }).ok, false);
  assert.equal(bad((p) => { p.micOffset = { dx: 0, dy: 0, dz: 1 }; }).ok, false); // offset without a position
  assert.equal(bad((p) => { p.id = '__proto__'; }).ok, false);
  const dup = structuredClone(sc); dup.people = [createPerson({ name: 'A', id: 'p1', micLinkId: link }), createPerson({ name: 'B', id: 'p2', micLinkId: link })];
  assert.equal(validateScene(dup).ok, false);
  const many = structuredClone(sc); many.people = Array.from({ length: PEOPLE_LIMITS.max + 1 }, (_, i) => createPerson({ id: `p${i}` }));
  assert.equal(validateScene(many).ok, false);
  assert.throws(() => migrateScene(many));
  assert.equal(SCENE_LIMITS.maxPeople, PEOPLE_LIMITS.max);
  const dangling = structuredClone(sc); dangling.people = [createPerson({ name: 'A', id: 'p1', micLinkId: 'gone', iemLinkId: link })];
  const m = migrateScene(dangling);
  assert.equal(m.people[0].micLinkId, undefined); assert.equal(m.people[0].iemLinkId, undefined);
  assert.equal(validateScene(m).ok, true);
  const dup2 = prunePeople({ links: sc.links, people: [createPerson({ id: 'a', micLinkId: link }), createPerson({ id: 'b', micLinkId: link })] });
  assert.equal(dup2.people[1].micLinkId, undefined);
  // addPerson stops at the cap
  const st = createStore(createDefaultScene());
  for (let i = 0; i < PEOPLE_LIMITS.max; i++) assert.ok(A.addPerson(st));
  assert.equal(A.addPerson(st), null);
  // pruneScenePeople after a link is deleted
  const st3 = twoLinkStore(); const pid = A.addPerson(st3, { name: 'A', pos: { x: 1, y: 1 } });
  A.assignIem(st3, pid, st3.getScene().links[1].id);
  st3.update((d) => { d.links.pop(); });
  A.pruneScenePeople(st3);
  assert.equal(st3.getScene().people[0].iemLinkId, undefined);
});

test('four-piece band example: every person has a mic and an IEM, links are named after them, figures in the note come from the model', () => {
  const s = bandPeopleScene();
  assert.deepEqual(validateScene(s), { ok: true, errors: [] });
  assert.equal(s.people.length, 4); assert.equal(s.links.length, 8);
  for (const p of s.people) {
    assert.equal(s.links.find((l) => l.id === p.micLinkId).name, `${p.name} mic`); assert.equal(s.links.find((l) => l.id === p.iemLinkId).name, `${p.name} IEM`);
    const at = personPackPositions(p);
    const mic = s.links.find((l) => l.id === p.micLinkId), iem = s.links.find((l) => l.id === p.iemLinkId);
    near(at.mic.x, mic.tx.pos.x, 1e-9); near(at.mic.y, mic.tx.pos.y, 1e-9); near(at.iem.x, iem.rx.pos.x, 1e-9);
  }
  const ms = s.links.map((l) => ({ n: l.name, m: solveLink(s, l).marginDb }));
  const lo = ms.reduce((a, b) => (b.m < a.m ? b : a)), hi = ms.reduce((a, b) => (b.m > a.m ? b : a));
  const note = EXAMPLES.find((e) => e.id === 'band-four-piece-people').note;
  for (const v of [lo.n, hi.n, lo.m.toFixed(1), hi.m.toFixed(1)]) assert.ok(note.includes(v), v);
  assert.ok(note.split('. ').length <= 4);
  assert.ok(buildExample('band-four-piece-people'));
  // IEM carrier frequencies all differ from the mic frequencies
  assert.equal(new Set(s.links.map((l) => l.freqMHz)).size, 8);
});

test('names: sanitizeName and migrate strip control characters, trim and cut; clean names and older files are unchanged; validation rejects bad names', async () => {
  const { sanitizeName, NAME_LIMITS } = await import('../js/model/scene.js');
  assert.equal(sanitizeName('  Wall\u0000 \u001f A  ', 40, 'x'), 'Wall  A');
  assert.equal(sanitizeName('Left wall', 40, 'x'), 'Left wall');
  assert.equal(sanitizeName('a'.repeat(60), 40, 'x'), 'a'.repeat(40));
  assert.equal(sanitizeName('\u0007  ', 40, 'Reflector'), 'Reflector');
  assert.equal(sanitizeName(42, 40, 'Reflector'), 'Reflector');
  const sc = createDefaultScene();
  const r = { id: 'r1', name: '  Back\u0000wall  ', material: 'brick', p1: { x: 0, y: 0 }, p2: { x: 3, y: 0 }, zMin: 0, zMax: 3 };
  const bad = structuredClone(sc); bad.reflectors = [{ ...r }];
  assert.equal(validateScene(bad).ok, false);
  const m = migrateScene(bad);
  assert.equal(m.reflectors[0].name, 'Backwall'); assert.equal(validateScene(m).ok, true);
  const good = structuredClone(sc); good.reflectors = [{ ...r, name: 'Back wall' }];
  assert.equal(migrateScene(good).reflectors[0].name, 'Back wall');
  const noName = structuredClone(sc); noName.reflectors = [{ ...r }]; delete noName.reflectors[0].name;
  assert.equal(migrateScene(noName).reflectors[0].name, undefined);
  const long = structuredClone(sc); long.reflectors = [{ ...r, name: 'x'.repeat(NAME_LIMITS.reflector + 1) }];
  assert.equal(validateScene(long).ok, false); assert.equal(migrateScene(long).reflectors[0].name.length, 40);
  const obj = structuredClone(sc); obj.reflectors = [{ ...r, name: { evil: 1 } }];
  assert.equal(validateScene(obj).ok, false); assert.equal(migrateScene(obj).reflectors[0].name, 'Reflector');
  const pe = structuredClone(sc); pe.people = [createPerson({ id: 'p1', name: 'Al\u0001ice ' })];
  assert.equal(validateScene(pe).ok, false); assert.equal(migrateScene(pe).people[0].name, 'Alice');
  const { createNoiseSource } = await import('../js/model/noise-sources.js');
  const ns = structuredClone(sc); ns.noiseSources = [createNoiseSource('led-light-pwm', { id: 'n1', name: ' Hum\u0000mer ' })];
  assert.equal(validateScene(ns).ok, false); assert.equal(migrateScene(ns).noiseSources[0].name, 'Hummer');
  const nsLong = structuredClone(sc); nsLong.noiseSources = [createNoiseSource('led-light-pwm', { id: 'n1', name: 'y'.repeat(81) })];
  assert.equal(validateScene(nsLong).ok, false);
});

// ---- extra (backup) mic links: person.extraLinkIds / extraOffsets ------------------------------------------------
function threeLinkStore() {
  const sc = createDefaultScene();
  const iem = createDefaultLink('iem'), spare = createDefaultLink('mic');
  sc.links.push(iem, spare);
  sc.links[0].tx.pos = { x: 10.25, y: 5.25, z: 1.3 }; iem.rx.pos = { x: 9.85, y: 4.95, z: 1.0 }; spare.tx.pos = { x: 9.85, y: 4.95, z: 1.0 };
  return createStore(sc);
}

test('extra mic: assignExtraMic stores the offset, names the link, refuses repeats and wrong kinds, removeExtraMic keeps the link', () => {
  const st = threeLinkStore(); const id = A.addPerson(st, { name: 'Pat', pos: { x: 10, y: 5 } });
  const [m, i, sp] = st.getScene().links;
  A.assignMic(st, id, m.id); A.assignIem(st, id, i.id);
  assert.equal(A.assignExtraMic(st, id, i.id), false, 'an IEM link cannot be a backup mic');
  assert.equal(A.assignExtraMic(st, id, m.id), false, 'the main mic is not an extra');
  assert.equal(A.assignExtraMic(st, id, sp.id), true);
  assert.equal(A.assignExtraMic(st, id, sp.id), false, 'not twice');
  let s = st.getScene(), p = s.people[0];
  assert.deepEqual(p.extraLinkIds, [sp.id]);
  near(p.extraOffsets[sp.id].dx, -0.15); near(p.extraOffsets[sp.id].dy, -0.05); near(p.extraOffsets[sp.id].dz, 1.0); // hand: (9.85, 4.95) - (10, 5)
  assert.equal(s.links[2].name, 'Pat mic 2');
  assert.deepEqual(validateScene(s), { ok: true, errors: [] });
  assert.equal(A.peopleLinkOwners(s).get(sp.id).extra, true);
  A.removeExtraMic(st, id, sp.id);
  s = st.getScene();
  assert.equal(s.people[0].extraLinkIds, undefined); assert.equal(s.people[0].extraOffsets, undefined);
  assert.equal(s.links.length, 3);
  assert.equal(A.peopleLinkOwners(s).has(sp.id), false);
});

test('extra mic: move, group move, facing and contact apply to it', () => {
  const st = threeLinkStore(); const id = A.addPerson(st, { name: 'Pat', pos: { x: 10, y: 5 } });
  const [m, i, sp] = st.getScene().links;
  A.assignMic(st, id, m.id); A.assignIem(st, id, i.id); A.assignExtraMic(st, id, sp.id);
  A.movePerson(st, id, { x: 20, y: 8 });
  let s = st.getScene();
  near(s.links[2].tx.pos.x, 19.85); near(s.links[2].tx.pos.y, 7.95); near(s.links[2].tx.pos.z, 1.0);
  A.movePeople(st, [id], { dx: -1, dy: 1 });
  s = st.getScene(); near(s.links[2].tx.pos.x, 18.85); near(s.links[2].tx.pos.y, 8.95);
  const az0 = s.links[2].tx.antenna.orientation.az;
  A.updatePerson(st, id, { facingDeg: 90 });
  s = st.getScene();
  // offset (-0.15, -0.05) rotated by 90 degrees about (19, 9): (dy, -dx) = (-0.05, 0.15)
  near(s.links[2].tx.pos.x, 19 - 0.05); near(s.links[2].tx.pos.y, 9 + 0.15);
  near(((s.links[2].tx.antenna.orientation.az - az0 + 540) % 360) - 180, 90);
  A.updatePerson(st, id, { contact: 'skin', dampness: 'wet' });
  s = st.getScene();
  assert.equal(s.links[2].tx.antenna.contact, 'skin'); assert.equal(s.links[2].tx.antenna.dampness, 'wet');
  assert.equal(s.links[0].tx.antenna.contact, 'skin');
  A.updatePerson(st, id, { name: 'Patricia' });
  assert.equal(st.getScene().links[2].name, 'Patricia mic 2');
});

test('extra mic: second owners need swap, a main mic can be demoted by assigning it elsewhere, cap of maxExtra', () => {
  const st = threeLinkStore();
  const a = A.addPerson(st, { name: 'Ann', pos: { x: 1, y: 1 } }), b = A.addPerson(st, { name: 'Bob', pos: { x: 5, y: 5 } });
  const [m, , sp] = st.getScene().links;
  A.assignExtraMic(st, a, sp.id);
  assert.equal(A.assignExtraMic(st, b, sp.id), false);
  assert.equal(A.assignMic(st, b, sp.id), false, 'a backup of Ann cannot become Bob main without a swap');
  assert.equal(A.assignExtraMic(st, b, sp.id, { swap: true }), true);
  let s = st.getScene();
  assert.equal(s.people[0].extraLinkIds, undefined); assert.deepEqual(s.people[1].extraLinkIds, [sp.id]);
  assert.equal(A.assignMic(st, b, sp.id), true, 'own backup promoted to main');
  s = st.getScene(); assert.equal(s.people[1].micLinkId, sp.id); assert.equal(s.people[1].extraLinkIds, undefined);
  void m;
  // cap
  const sc = createDefaultScene(); sc.links = []; for (let k = 0; k < PEOPLE_LIMITS.maxExtra + 2; k++) sc.links.push(createDefaultLink('mic'));
  const st2 = createStore(sc); const p = A.addPerson(st2, { name: 'Cap', pos: { x: 0, y: 0 } });
  const res = st2.getScene().links.map((l) => A.assignExtraMic(st2, p, l.id));
  assert.equal(res.filter(Boolean).length, PEOPLE_LIMITS.maxExtra);
});

test('extra mic: validation errors, migrate prunes dangling and duplicate entries, older files without the fields are unchanged', () => {
  const st = threeLinkStore(); const id = A.addPerson(st, { name: 'Pat', pos: { x: 10, y: 5 } });
  const [m, i, sp] = st.getScene().links;
  A.assignMic(st, id, m.id); A.assignExtraMic(st, id, sp.id);
  const good = st.getScene();
  const bad = (fn) => { const s = structuredClone(good); fn(s); return validateScene(s).errors.join(';'); };
  assert.match(bad((s) => { s.people[0].extraLinkIds = ['nope']; }), /extraLinkIds\[0\] does not match/);
  assert.match(bad((s) => { s.links.find((l) => l.id === i.id).kind = 'p2p'; s.people[0].extraLinkIds = [i.id]; }), /must be a mic or IEM link/);
  assert.match(bad((s) => { s.people[0].extraLinkIds = [m.id]; }), /repeats a link/);
  assert.match(bad((s) => { s.people[0].extraLinkIds = 'x'; }), /must be an array/);
  assert.match(bad((s) => { s.people[0].extraLinkIds = new Array(PEOPLE_LIMITS.maxExtra + 1).fill(sp.id); }), /at most/);
  assert.match(bad((s) => { s.people[0].extraOffsets[sp.id].dx = 99; }), /extraOffsets\[/);
  assert.match(bad((s) => { s.people[0].extraOffsets = { zzz: { dx: 0, dy: 0, dz: 1 } }; }), /not in extraLinkIds/);
  assert.match(bad((s) => { s.people.push(createPerson({ name: 'Two', extraLinkIds: [sp.id] })); }), /already assigned to another person/);
  // migrate: dangling, wrong kind, duplicate and over-cap entries are dropped, offsets of dropped ones too
  const dirty = structuredClone(good); dirty.links.find((l) => l.id === i.id).kind = 'p2p';
  dirty.people[0].extraLinkIds = ['gone', i.id, sp.id, sp.id, m.id];
  dirty.people[0].extraOffsets = { gone: { dx: 0, dy: 0, dz: 1 }, [sp.id]: dirty.people[0].extraOffsets[sp.id] };
  const mig = migrateScene(dirty);
  assert.deepEqual(mig.people[0].extraLinkIds, [sp.id]);
  assert.deepEqual(Object.keys(mig.people[0].extraOffsets), [sp.id]);
  assert.deepEqual(validateScene(mig), { ok: true, errors: [] });
  const lone = structuredClone(good); lone.links = lone.links.filter((l) => l.id !== sp.id);
  const m2 = migrateScene(lone);
  assert.equal(m2.people[0].extraLinkIds, undefined); assert.equal(m2.people[0].extraOffsets, undefined);
  // older files: people without the new fields round-trip unchanged
  const old = bandPeopleScene();
  assert.ok(old.people.every((p) => p.extraLinkIds === undefined && p.extraOffsets === undefined));
  assert.deepEqual(migrateScene(structuredClone(old)).people, old.people);
});

test('an IEM bodypack assigned to a person already on the plan jumps to them', () => {
  const st = twoLinkStore();
  st.update((d) => { d.links[1].rx.pos = { x: -9, y: 30, z: 1.0 }; });
  const id = A.addPerson(st, { name: 'Dee', pos: { x: 4, y: 4 } });
  assert.equal(A.assignIem(st, id, st.getScene().links[1].id), true);
  const r = st.getScene().links[1].rx.pos;
  assert.ok(Math.hypot(r.x - 4, r.y - 4) < 0.5, JSON.stringify(r));
  assert.deepEqual(st.getScene().people[0].pos, { x: 4, y: 4 });
});

test('swap follows the jump rule for the displaced owner too; re-assigning the same link returns true and does not move the pack', () => {
  const sc = createDefaultScene(), l2 = createDefaultLink('mic'); sc.links.push(l2);
  const [m1, m2] = sc.links; m1.tx.pos = { x: 2, y: 2, z: 1.3 }; m2.tx.pos = { x: 30, y: 30, z: 1.3 };
  const st = createStore(sc);
  const pa = A.addPerson(st, { name: 'Ann', pos: { x: 2, y: 2 } }), pb = A.addPerson(st, { name: 'Bob', pos: { x: 30, y: 30 } });
  assert.ok(A.assignMic(st, pa, m1.id) && A.assignMic(st, pb, m2.id));
  const at = (id) => st.getScene().links.find((l) => l.id === id).tx.pos;
  const before = JSON.stringify(at(m1.id));
  assert.equal(A.assignMic(st, pa, m1.id), true, 'same link again is a success'); assert.equal(JSON.stringify(at(m1.id)), before, 'and the pack did not move');
  assert.equal(A.assignMic(st, pa, m2.id, { swap: true }), true);
  const people = st.getScene().people, ann = people.find((p) => p.id === pa), bob = people.find((p) => p.id === pb);
  assert.equal(ann.micLinkId, m2.id); assert.equal(bob.micLinkId, m1.id);
  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  assert.ok(dist(at(m2.id), ann.pos) <= 1.5, 'the new link jumps to Ann');
  assert.ok(dist(at(m1.id), bob.pos) <= 1.5, `the displaced owner Bob gets the link at his body, not 28 m away (${dist(at(m1.id), bob.pos).toFixed(1)} m)`);
  assert.ok(validateScene(st.getScene()).ok);
});

test('one person can carry several mics and several IEM bodypacks', () => {
  const sc = createDefaultScene(); sc.links = [createDefaultLink('mic'), createDefaultLink('mic'), createDefaultLink('iem'), createDefaultLink('iem'), createDefaultLink('iem')];
  const st = createStore(sc), id = A.addPerson(st, { name: 'Sam', pos: { x: 1, y: 1 } });
  const [m1, m2, i1, i2, i3] = st.getScene().links;
  assert.ok(A.assignMic(st, id, m1.id)); assert.ok(A.assignIem(st, id, i1.id));
  assert.ok(A.assignExtraMic(st, id, m2.id)); assert.ok(A.assignExtraMic(st, id, i2.id)); assert.ok(A.assignExtraMic(st, id, i3.id));
  const s = st.getScene(), p = s.people[0];
  assert.deepEqual(validateScene(s), { ok: true, errors: [] });
  assert.deepEqual(p.extraLinkIds, [m2.id, i2.id, i3.id]);
  const ow = linkOwners(s.people, s.links);
  assert.equal(ow.get(i2.id).which, 'iem'); assert.equal(ow.get(m2.id).which, 'mic');
  const byId = (x) => s.links.find((l) => l.id === x);
  assert.equal(byId(m2.id).name, 'Sam mic 2'); assert.equal(byId(i2.id).name, 'Sam IEM 2'); assert.equal(byId(i3.id).name, 'Sam IEM 3');
  // the bodypack of an extra IEM moves with the person
  A.updatePerson(st, id, { facingDeg: 90 });
  const s2 = st.getScene(), pos = s2.links.find((l) => l.id === i2.id).rx.pos;
  assert.ok(Math.hypot(pos.x - 1, pos.y - 1) < 1.5);
  // the same IEM cannot be both the main and an extra
  assert.equal(A.assignExtraMic(st, id, i1.id), false);
});

test('extras: renumbered after a removal, the old main takes the promoted extra place, and pruning drops extra receivers', () => {
  const sc = createDefaultScene(); sc.links = [createDefaultLink('mic'), createDefaultLink('mic'), createDefaultLink('mic')];
  const st = createStore(sc), id = A.addPerson(st, { name: 'Ann', pos: { x: 1, y: 1 } });
  const [m1, m2, m3] = st.getScene().links, nm = (x) => st.getScene().links.find((l) => l.id === x).name;
  A.assignMic(st, id, m1.id); A.assignExtraMic(st, id, m2.id); A.assignExtraMic(st, id, m3.id);
  assert.equal(nm(m3.id), 'Ann mic 3');
  A.removeExtraMic(st, id, m2.id);
  assert.equal(nm(m3.id), 'Ann mic 2');
  A.assignMic(st, id, m3.id); // promote: the old main becomes the extra
  const p = st.getScene().people[0];
  assert.equal(p.micLinkId, m3.id); assert.deepEqual(p.extraLinkIds, [m1.id]); assert.equal(nm(m1.id), 'Ann mic 2');
  const d = structuredClone(st.getScene()); d.links.find((l) => l.id === m1.id).txOf = m3.id; prunePeople(d);
  assert.equal(d.people[0].extraLinkIds, undefined);
});
