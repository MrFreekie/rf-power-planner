// People list (item 36): a person groups the mic transmitter and the IEM bodypack receiver of their links. Pure functions, no DOM.
//
//   scene.people: [{ id, name, role, colour, pos?: {x, y}, facingDeg?, micLinkId?, iemLinkId?, micOffset?, iemOffset?, contact?, dampness? }]
//   (optional key: a scene without it is unchanged; at most PEOPLE_LIMITS.max).
//   role: one of PERSON_ROLES. colour: one of PERSON_COLOURS (a name, the GUI maps it to a swatch). pos = the person's floor point in metres.
//   facingDeg = the direction the person faces (0 = +y, 90 = +x, as every azimuth in the model).
//   micLinkId / iemLinkId: each optional, each the id of an EXISTING link of kind 'mic' / 'iem'; a link belongs to at most one person.
//   micOffset / iemOffset = { dx, dy, dz }: where the mic transmitter (link.tx.pos) and the IEM bodypack (link.rx.pos) sit relative to the person
//   when facingDeg is 0: dx to the person's right-hand side is +x, dy forward is +y (so a rotation by facingDeg is applied to (dx, dy)), dz is the
//   absolute height of the pack in metres (a handheld at hand height about 1.3 m, a bodypack at the belt about 1.0 m, the IEM pack at the other
//   hip). Moving or turning the person moves and turns both packs together and keeps these offsets.
//   contact / dampness (library keys, antenna contact and dampness) are the body coupling of the person: they are written onto the mic transmitter
//   antenna and the IEM bodypack antenna, so the loss follows the person.
//   extraLinkIds / extraOffsets (optional, backup bodypacks): extraLinkIds = [linkId, ...] of further MIC links the person carries (at most PEOPLE_LIMITS.maxExtra, never
//   the main micLinkId, each link owned once across main and extra); extraOffsets = { [linkId]: { dx, dy, dz } } the same kind of offset as micOffset. They move,
//   turn and take the contact / dampness with the person. Absent = unchanged older files.
//   Deleting a person never deletes a link. prunePeople(scene) removes references to links that no longer exist.

export const PEOPLE_LIMITS = Object.freeze({ max: 64, coord: [-5000, 5000], offsetM: [-10, 10], heightM: [0, 5], nameChars: 80, maxExtra: 4 });
export const PERSON_ROLES = Object.freeze(['singer', 'instrumentalist', 'presenter', 'crew', 'other']);
export const PERSON_COLOURS = Object.freeze(['red', 'orange', 'amber', 'green', 'teal', 'cyan', 'blue', 'indigo', 'violet', 'pink', 'brown', 'grey']);
/** Default pack offsets (metres, ASSUMED teaching figures): handheld in the right hand, bodypack at the belt, IEM pack at the other hip. */
export const DEFAULT_MIC_OFFSET = Object.freeze({ handheld: { dx: 0.25, dy: 0.25, dz: 1.3 }, bodypack: { dx: 0.15, dy: -0.05, dz: 1.0 } });
export const DEFAULT_IEM_OFFSET = Object.freeze({ dx: -0.15, dy: -0.05, dz: 1.0 });

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const DEG = Math.PI / 180;
let seq = 0;
export const newPersonId = () => `pe${Date.now().toString(36)}${(seq++).toString(36)}`;

/** createPerson(overrides): a new person with a unique id (position optional: unset means "not placed"). */
export function createPerson(overrides = {}) {
  return { id: newPersonId(), name: 'Person', role: 'singer', colour: PERSON_COLOURS[0], ...overrides };
}

/** The name shared with a person's links, for example "Anna mic" or "Anna IEM". */
export const personLinkName = (person, which) => `${person.name} ${which === 'iem' ? 'IEM' : 'mic'}`;

/** The name of the i-th extra mic link of a person (0 = the first backup): "Presenter mic 2". */
export const extraLinkName = (person, i) => `${person.name} mic ${i + 2}`;

/** Rotate a pack offset (dx, dy) of a person facing facingDeg: the offsets are stored for facing 0. */
export function rotateOffset(o, facingDeg) {
  const a = (facingDeg || 0) * DEG, c = Math.cos(a), s = Math.sin(a);
  // facing az (clockwise from +y): the person's right (+dx) is at az + 90
  return { x: o.dx * c + o.dy * s, y: -o.dx * s + o.dy * c, z: o.dz };
}

/** Inverse of rotateOffset: the offset (for facing 0) of an absolute pack position relative to the person's floor point. */
export function offsetFromPack(person, pack) {
  const a = -(person.facingDeg || 0) * DEG, c = Math.cos(a), s = Math.sin(a);
  const x = pack.x - person.pos.x, y = pack.y - person.pos.y;
  return { dx: x * c + y * s, dy: -x * s + y * c, dz: isNum(pack.z) ? pack.z : 1 };
}

/** Pack positions of a person ({ mic?: {x,y,z}, iem?: {x,y,z} }), from pos, facingDeg and the offsets. Empty when the person has no position. */
export function personPackPositions(person) {
  const out = {};
  if (!person || !isObj(person.pos)) return out;
  for (const [k, off] of [['mic', person.micOffset], ['iem', person.iemOffset]]) {
    if (!isObj(off)) continue;
    const r = rotateOffset(off, person.facingDeg);
    out[k] = { x: person.pos.x + r.x, y: person.pos.y + r.y, z: r.z };
  }
  if (Array.isArray(person.extraLinkIds) && isObj(person.extraOffsets)) {
    for (const id of person.extraLinkIds) {
      const off = person.extraOffsets[id];
      if (!isObj(off)) continue;
      const r = rotateOffset(off, person.facingDeg);
      (out.extra || (out.extra = {}))[id] = { x: person.pos.x + r.x, y: person.pos.y + r.y, z: r.z };
    }
  }
  return out;
}

/** Link ids assigned across people: Map id -> { personId, which }. A duplicate keeps the first owner. */
export function linkOwners(people) {
  const m = new Map();
  for (const p of Array.isArray(people) ? people : []) {
    if (!isObj(p)) continue;
    if (p.micLinkId && !m.has(p.micLinkId)) m.set(p.micLinkId, { personId: p.id, which: 'mic' });
    if (p.iemLinkId && !m.has(p.iemLinkId)) m.set(p.iemLinkId, { personId: p.id, which: 'iem' });
    if (Array.isArray(p.extraLinkIds)) for (const id of p.extraLinkIds) if (id && !m.has(id)) m.set(id, { personId: p.id, which: 'mic', extra: true });
  }
  return m;
}

/**
 * prunePeople(scene): removes references to missing links, links of the wrong kind and second owners; drops people beyond the cap. Mutates and
 * returns the scene. The UI calls it after it deletes a link, and migrateScene calls it, so a scene never keeps a dangling reference.
 */
export function prunePeople(scene) {
  if (!scene || !Array.isArray(scene.people)) return scene;
  const kinds = new Map((scene.links || []).map((l) => [l.id, l.kind]));
  const seen = new Set();
  scene.people = scene.people.filter((p) => isObj(p)).slice(0, PEOPLE_LIMITS.max);
  for (const p of scene.people) {
    for (const [idKey, offKey, kind] of [['micLinkId', 'micOffset', 'mic'], ['iemLinkId', 'iemOffset', 'iem']]) {
      const id = p[idKey];
      if (id === undefined || id === null) { delete p[idKey]; continue; }
      if (kinds.get(id) !== kind || seen.has(id)) { delete p[idKey]; delete p[offKey]; continue; }
      seen.add(id);
    }
    if (p.extraLinkIds !== undefined) {
      const keep = [];
      for (const id of Array.isArray(p.extraLinkIds) ? p.extraLinkIds : []) {
        if (typeof id === 'string' && kinds.get(id) === 'mic' && !seen.has(id) && keep.length < PEOPLE_LIMITS.maxExtra) { keep.push(id); seen.add(id); }
      }
      if (keep.length) {
        p.extraLinkIds = keep;
        if (isObj(p.extraOffsets)) { for (const k of Object.keys(p.extraOffsets)) if (!keep.includes(k)) delete p.extraOffsets[k]; } else delete p.extraOffsets;
      } else { delete p.extraLinkIds; delete p.extraOffsets; }
    } else if (p.extraOffsets !== undefined) delete p.extraOffsets;
  }
  return scene;
}

/** validatePerson(p, path, errors, scene) pushes plain error strings. */
export function validatePerson(p, path, errors, scene) {
  const L = PEOPLE_LIMITS;
  if (!isObj(p)) { errors.push(`${path} must be an object`); return; }
  if (!(typeof p.id === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(p.id) && !(p.id in Object.prototype))) errors.push(`${path}.id must be a short plain string`);
  if (!(typeof p.name === 'string' && p.name.length >= 1 && p.name.length <= L.nameChars)) errors.push(`${path}.name must be 1 to ${L.nameChars} characters`);
  if (!PERSON_ROLES.includes(p.role)) errors.push(`${path}.role must be one of ${PERSON_ROLES.join(', ')}`);
  if (p.colour !== undefined && !PERSON_COLOURS.includes(p.colour)) errors.push(`${path}.colour invalid`);
  if (p.pos !== undefined && !(isObj(p.pos) && isNum(p.pos.x) && isNum(p.pos.y) && p.pos.x >= L.coord[0] && p.pos.x <= L.coord[1] && p.pos.y >= L.coord[0] && p.pos.y <= L.coord[1])) errors.push(`${path}.pos must have x and y within limits`);
  if (p.facingDeg !== undefined && !(isNum(p.facingDeg) && p.facingDeg >= -360 && p.facingDeg <= 360)) errors.push(`${path}.facingDeg must be between -360 and 360`);
  for (const k of ['micOffset', 'iemOffset']) {
    const o = p[k];
    if (o === undefined) continue;
    if (!(isObj(o) && isNum(o.dx) && isNum(o.dy) && isNum(o.dz) && Math.abs(o.dx) <= L.offsetM[1] && Math.abs(o.dy) <= L.offsetM[1] && o.dz >= L.heightM[0] && o.dz <= L.heightM[1])) errors.push(`${path}.${k} must be { dx, dy, dz } within limits`);
    else if (!isObj(p.pos)) errors.push(`${path}.${k} needs ${path}.pos`);
  }
  const links = (scene && Array.isArray(scene.links)) ? scene.links : [];
  for (const [k, kind] of [['micLinkId', 'mic'], ['iemLinkId', 'iem']]) {
    if (p[k] === undefined) continue;
    const l = links.find((x) => x.id === p[k]);
    if (!l) errors.push(`${path}.${k} does not match an existing link`);
    else if (l.kind !== kind) errors.push(`${path}.${k} must be a ${kind} link`);
    else if (l.txOf !== undefined) errors.push(`${path}.${k} must not be an extra receiver`);
  }
  if (p.extraLinkIds !== undefined) {
    if (!Array.isArray(p.extraLinkIds)) errors.push(`${path}.extraLinkIds must be an array`);
    else if (p.extraLinkIds.length > L.maxExtra) errors.push(`${path}.extraLinkIds has at most ${L.maxExtra} entries`);
    else {
      p.extraLinkIds.forEach((id, i) => {
        const l = typeof id === 'string' ? links.find((x) => x.id === id) : null;
        if (!l) errors.push(`${path}.extraLinkIds[${i}] does not match an existing link`);
        else if (l.kind !== 'mic') errors.push(`${path}.extraLinkIds[${i}] must be a mic link`);
        else if (l.txOf !== undefined) errors.push(`${path}.extraLinkIds[${i}] must not be an extra receiver`);
        else if (id === p.micLinkId || p.extraLinkIds.indexOf(id) !== i) errors.push(`${path}.extraLinkIds[${i}] repeats a link`);
      });
    }
  }
  if (p.extraOffsets !== undefined) {
    const o = p.extraOffsets;
    if (!isObj(o)) errors.push(`${path}.extraOffsets must be an object`);
    else {
      if (!isObj(p.pos) && Object.keys(o).length) errors.push(`${path}.extraOffsets needs ${path}.pos`);
      for (const [id, v] of Object.entries(o)) {
        if (!Array.isArray(p.extraLinkIds) || !p.extraLinkIds.includes(id)) errors.push(`${path}.extraOffsets has an entry for a link that is not in extraLinkIds`);
        else if (!(isObj(v) && isNum(v.dx) && isNum(v.dy) && isNum(v.dz) && Math.abs(v.dx) <= L.offsetM[1] && Math.abs(v.dy) <= L.offsetM[1] && v.dz >= L.heightM[0] && v.dz <= L.heightM[1])) errors.push(`${path}.extraOffsets[${id}] must be { dx, dy, dz } in range`);
      }
    }
  }
}
