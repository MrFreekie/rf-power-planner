// Example scene builders: band and presenter people scenes, person moves and spare-pack swap.
import { solveLink } from '../model/rf.js';
import { createPerson, personLinkName, offsetFromPack, rotateOffset, personPackPositions, DEFAULT_MIC_OFFSET, DEFAULT_IEM_OFFSET } from '../model/people.js';
import { createDefaultLink, createChainItem } from '../model/scene.js';
import { make } from './helpers.js';

/**
 * Four-piece band with people (item 36): bandPeopleScene() -> a 16 x 10 m stage, four people (singer with a handheld, guitar and bass with bodypacks,
 * drummer with a bodypack), each with a mic link and an IEM link. The mic receivers sit at the front of house, the IEM transmitters on a rack at the back of the stage.
 * Frequencies are the first eight of the third-order clean IEM8 plan (illustrative). Links are named after the person ("Anna mic", "Anna IEM").
 */
export const BAND_PEOPLE = Object.freeze([
  { name: 'Anna', role: 'singer', colour: 'red', pos: { x: 8, y: 7.5 }, facingDeg: 0, handheld: true, micMHz: 606.1, iemMHz: 610.9 },
  { name: 'Ben', role: 'instrumentalist', colour: 'blue', pos: { x: 4.5, y: 6 }, facingDeg: 20, handheld: false, micMHz: 606.5, iemMHz: 614.1 },
  { name: 'Chloe', role: 'instrumentalist', colour: 'green', pos: { x: 11.5, y: 6 }, facingDeg: -20, handheld: false, micMHz: 607.3, iemMHz: 618.1 },
  { name: 'Dev', role: 'instrumentalist', colour: 'amber', pos: { x: 8, y: 3 }, facingDeg: 0, handheld: false, micMHz: 608.9, iemMHz: 623.7 },
]);
export function bandPeopleScene() {
  return make('mic', (s, l0) => {
    s.stage = { width: 16, depth: 10 }; s.environment.floor = 'wood';
    s.links = []; s.people = [];
    for (const b of BAND_PEOPLE) {
      const person = createPerson({ name: b.name, role: b.role, colour: b.colour, pos: { ...b.pos }, facingDeg: b.facingDeg });
      const mic = createDefaultLink('mic');
      mic.name = personLinkName(person, 'mic'); mic.freqMHz = b.micMHz;
      mic.rx.pos = { x: 8, y: 0.8, z: 2.0 }; mic.rx.diversity.antennaB.pos = { x: 8.6, y: 0.8, z: 2.0 };
      mic.chain = [createChainItem('cable', { cableType: 'lmr-240', lengthM: 10 })];
      const iem = createDefaultLink('iem');
      iem.name = personLinkName(person, 'iem'); iem.freqMHz = b.iemMHz;
      iem.tx.pos = { x: 8, y: 9.4, z: 2.0 }; iem.tx.powerDbm = 14;
      // place the packs on the person: the offsets are stored for facing 0 and rotated by facingDeg
      const mo = b.handheld ? DEFAULT_MIC_OFFSET.handheld : DEFAULT_MIC_OFFSET.bodypack, io = DEFAULT_IEM_OFFSET;
      const a = (b.facingDeg * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
      const abs = (o) => ({ x: b.pos.x + o.dx * c + o.dy * sn, y: b.pos.y - o.dx * sn + o.dy * c, z: o.dz });
      mic.tx.pos = abs(mo); iem.rx.pos = abs(io);
      person.micLinkId = mic.id; person.iemLinkId = iem.id;
      person.micOffset = offsetFromPack(person, mic.tx.pos); person.iemOffset = offsetFromPack(person, iem.rx.pos);
      s.links.push(mic, iem); s.people.push(person);
    }
    void l0;
  });
}

/** Move a person of a scene and carry their packs with them (pure twin of actions.movePerson): the links keep the person's stored offsets. */
export function movePersonInScene(scene, personName, pos) {
  const sc = structuredClone(scene), p = sc.people.find((x) => x.name === personName);
  p.pos = { x: pos.x, y: pos.y };
  const packs = personPackPositions(p);
  for (const l of sc.links) if (packs.extra && packs.extra[l.id]) l.tx.pos = packs.extra[l.id];
  const mic = sc.links.find((l) => l.id === p.micLinkId), iem = sc.links.find((l) => l.id === p.iemLinkId);
  if (mic && packs.mic) mic.tx.pos = packs.mic;
  if (iem && packs.iem) iem.rx.pos = packs.iem;
  return sc;
}
/** Margins of the links of a scene by name: { 'Anna mic': dB, ... }. */
export const linkMargins = (scene) => Object.fromEntries(scene.links.map((l) => [l.name, solveLink(scene, l).marginDb]));
/** The singer's walk in the four-piece band: from the start (8, 7.5) at the centre of the stage to the stage-right front corner. */
export const BAND_WALK_TO = Object.freeze({ x: 14.5, y: 8.5 });
export const bandWalkEndScene = () => movePersonInScene(bandPeopleScene(), 'Anna', BAND_WALK_TO);

/**
 * Presenter with a backup bodypack (people model): one person, a main mic bodypack on the belt (owned by the person, follows them) and a hot-spare backup
 * bodypack on the other hip on its own frequency (a second mic link, owned through person.extraLinkIds, so it follows every move and turn). FOH receivers 12 m away. Frequencies from the third-order clean IEM8 plan (illustrative).
 */
export const PRESENTER_PLAN_MHZ = Object.freeze({ main: 606.1, backup: 607.3, iem: 614.1 });
export function presenterScene() {
  return make('mic', (s) => {
    s.stage = { width: 20, depth: 14 }; s.environment.floor = 'wood';
    s.links = []; s.people = [];
    const person = createPerson({ name: 'Presenter', role: 'presenter', colour: 'teal', pos: { x: 10, y: 12 }, facingDeg: 180 });
    const rxAt = (l) => { l.rx.pos = { x: 10, y: 0.8, z: 1.5 }; l.rx.diversity.antennaB.pos = { x: 10.6, y: 0.8, z: 1.5 }; l.chain = [createChainItem('cable', { cableType: 'lmr-240', lengthM: 10 })]; };
    const abs = (o) => { const r = rotateOffset(o, person.facingDeg); return { x: person.pos.x + r.x, y: person.pos.y + r.y, z: r.z }; };
    const mic = createDefaultLink('mic'); mic.name = 'Presenter mic'; mic.freqMHz = PRESENTER_PLAN_MHZ.main; rxAt(mic); mic.tx.pos = abs(DEFAULT_MIC_OFFSET.bodypack);
    const backup = createDefaultLink('mic'); backup.name = 'Presenter backup pack'; backup.freqMHz = PRESENTER_PLAN_MHZ.backup; rxAt(backup);
    backup.tx.pos = abs({ dx: -DEFAULT_MIC_OFFSET.bodypack.dx, dy: DEFAULT_MIC_OFFSET.bodypack.dy, dz: DEFAULT_MIC_OFFSET.bodypack.dz });
    const iem = createDefaultLink('iem'); iem.name = personLinkName(person, 'iem'); iem.freqMHz = PRESENTER_PLAN_MHZ.iem;
    iem.tx.pos = { x: 10, y: 0.8, z: 2.0 }; iem.tx.powerDbm = 14; iem.rx.pos = abs(DEFAULT_IEM_OFFSET);
    person.micLinkId = mic.id; person.iemLinkId = iem.id; person.extraLinkIds = [backup.id];
    person.micOffset = offsetFromPack(person, mic.tx.pos); person.iemOffset = offsetFromPack(person, iem.rx.pos); person.extraOffsets = { [backup.id]: offsetFromPack(person, backup.tx.pos) };
    s.links.push(mic, backup, iem); s.people.push(person);
  });
}

/**
 * Four-piece band with a spare bodypack (people.js assignMic): bandSwapScene(assigned) -> bandPeopleScene() where Dev has no mic: his bodypack link ("Spare bodypack", 608.9 MHz) lies in the
 * case at the back of the stage, 8.5 m from him. assigned = true is the scene after assigning it to Dev in the people panel (the same rule as actions.assignMic): the pack jumps to his
 * belt at the standard offset, keeping its height, and the link takes his name ("Dev mic").
 */
export const BAND_SPARE_PACK_POS = Object.freeze({ x: 14, y: 9, z: 1.0 });
export function bandSwapScene(assigned = false) {
  const s = bandPeopleScene(), dev = s.people.find((p) => p.name === 'Dev'), link = s.links.find((l) => l.id === dev.micLinkId);
  link.tx.pos = { ...BAND_SPARE_PACK_POS };
  if (!assigned) { delete dev.micLinkId; delete dev.micOffset; link.name = 'Spare bodypack'; return s; }
  dev.micOffset = { dx: DEFAULT_MIC_OFFSET.bodypack.dx, dy: DEFAULT_MIC_OFFSET.bodypack.dy, dz: BAND_SPARE_PACK_POS.z };
  link.tx.pos = personPackPositions(dev).mic;
  return s;
}
