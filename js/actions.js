// Scene mutations. Every action takes the store first and goes through store.update,
// so undo/redo and subscribers behave uniformly. Pure of the DOM.
import { AUDIO_SOURCE_IDS, TONE_HZ_LIMITS } from './model/audio-source.js';
import { buildExample } from './examples.js';
import { IMD_PRESETS, COMBINER_PRESETS } from './model/imd-params.js';
import { startWalk, stopWalk } from './walk.js';
import { effectiveAntennaB } from './model/diversity.js';
import { createDefaultScene, createDefaultLink, createChainItem, createReflector, createBranch, createZone, createPlatform, STAGE_LIMITS, PLATFORM_LIMITS, PLATFORM_MATERIALS, createImdTransmitter, defaultImdTransmitters, newId, SCENE_LIMITS } from './model/scene.js';
import { applyFmPreset } from './model/fm-presets.js';
import { DEFAULT_MIC_OFFSET, DEFAULT_IEM_OFFSET, PEOPLE_LIMITS, PERSON_ROLES, PERSON_COLOURS, createPerson, personLinkName, extraLinkName, personPackPositions, offsetFromPack, linkOwners, prunePeople } from './model/people.js';
import { validateVenue } from './model/venue-underlay.js';
import { SURFACES, ANTENNAS, GROUND_PLANE_GAIN_DBI, allowedPolarisations, defaultPolarisation, ANTENNA_CONTACT_LOSS_DB, ANTENNA_DAMPNESS_LOSS_DB } from './model/library.js';

const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);

function parsePath(path) {
  const parts = Array.isArray(path) ? path.map(String) : String(path).split('.');
  if (!parts.length || parts.some((p) => p === '' || UNSAFE.has(p))) return null;
  return parts;
}

/** Set a value at a dotted path inside `root` (array indexes allowed). Returns false if the path does not exist. */
function setIn(root, path, value) {
  const parts = parsePath(path);
  if (!parts) return false;
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur === null || typeof cur !== 'object') return false;
    cur = cur[parts[i]];
  }
  if (cur === null || typeof cur !== 'object') return false;
  const last = parts[parts.length - 1];
  if (Array.isArray(cur) && !/^\d+$/.test(last)) return false;
  cur[last] = value;
  return true;
}

const opts = (o) => (o && o.coalesce ? { coalesce: o.coalesce } : {});
const findLink = (scene, id) => scene.links.find((l) => l.id === id);

/** setPath(store, 'links.0.tx.powerDbm', 12, { coalesce: 'tx-power' }) -> true if the scene changed. */
export function setPath(store, path, value, { coalesce } = {}) {
  return store.update((d) => { setIn(d, path, value); }, opts({ coalesce }));
}

/** Like setPath but relative to the link with the given id, e.g. 'tx.antenna.gainDbi'. */
export function setLinkField(store, linkId, path, value, o = {}) {
  return store.update((d) => {
    const link = findLink(d, linkId);
    if (link) setIn(link, path, value);
  }, opts(o));
}

/**
 * The chain an edit targets: the link chain ('main', default) or, on a mic link whose antenna B has its own cable run,
 * the antenna B chain ('antennaB'). Returns null when the target does not exist (antenna B shares the main chain).
 */
function targetChain(link, target, create = false) {
  if (target === 'rx') { // IEM bodypack side: items between the bodypack antenna and the bodypack (link.rx.chain, created on first add)
    if (link.kind !== 'iem' || !link.rx) return null;
    if (!Array.isArray(link.rx.chain) && create) link.rx.chain = [];
    return Array.isArray(link.rx.chain) ? link.rx.chain : null;
  }
  if (target === 'antennaB') {
    const ab = link.rx && link.rx.diversity && link.rx.diversity.antennaB;
    return ab && Array.isArray(ab.chain) ? ab.chain : null;
  }
  return link.chain;
}

/**
 * Insert a chain item (a plain object with `kind`, or a kind string). Assigns an id when missing. Returns the new id (null when the
 * target chain does not exist). opts = { target: 'main' | 'antennaB' } selects the chain; the default is the main link chain.
 */
export function addChainItem(store, linkId, item, index, opts = {}) {
  const made = typeof item === 'string' ? createChainItem(item) : createChainItem(item.kind, item);
  let ok = false;
  store.update((d) => {
    const link = findLink(d, linkId);
    const chain = link && targetChain(link, opts.target, true);
    if (!chain || chain.length >= SCENE_LIMITS.maxChain) return; // at the limit: no change (a loaded scene may not exceed it)
    const i = Number.isInteger(index) ? Math.max(0, Math.min(chain.length, index)) : chain.length;
    chain.splice(i, 0, made);
    ok = true;
  });
  return ok ? made.id : null;
}

export function removeChainItem(store, linkId, itemId, opts = {}) {
  return store.update((d) => {
    const link = findLink(d, linkId);
    const chain = link && targetChain(link, opts.target);
    if (!chain) return;
    const i = chain.findIndex((c) => c.id === itemId);
    if (i >= 0) chain.splice(i, 1);
  });
}

/** Move an item by `delta` positions (clamped to the chain ends). opts.target as for addChainItem. */
export function moveChainItem(store, linkId, itemId, delta, opts = {}) {
  return store.update((d) => {
    const link = findLink(d, linkId);
    const chain = link && targetChain(link, opts.target);
    if (!chain) return;
    const i = chain.findIndex((c) => c.id === itemId);
    if (i < 0) return;
    const j = Math.max(0, Math.min(chain.length - 1, i + Math.trunc(delta)));
    if (j === i) return;
    const [it] = chain.splice(i, 1);
    chain.splice(j, 0, it);
  });
}

/**
 * setAntennaBChainMode(store, linkId, 'same' | 'own'). 'own' gives receive antenna B its own cable run, starting as a deep copy of the
 * main chain with fresh item ids (so editing B never touches A); 'same' returns to sharing link.chain (stored as null).
 * Has no effect on IEM links, whose chain is on the transmit side.
 */
export function setAntennaBChainMode(store, linkId, mode) {
  if (mode !== 'same' && mode !== 'own') return false;
  return store.update((d) => {
    const link = findLink(d, linkId);
    const ab = link && link.rx && link.rx.diversity && link.rx.diversity.antennaB;
    if (!ab) return;
    if (mode === 'same') ab.chain = null;
    else if (!Array.isArray(ab.chain)) ab.chain = link.chain.map((c) => ({ ...structuredClone(c), id: newId('ci') }));
  });
}

const POWER = ['dBm', 'dBW', 'mW'];
const LENGTH = ['m', 'ft'];

/** setUnits(store, { power?: 'dBm'|'dBW'|'mW', length?: 'm'|'ft' }); invalid values are ignored. */
export function setUnits(store, partial = {}) {
  return store.update((d) => {
    if (POWER.includes(partial.power)) d.units.power = partial.power;
    if (LENGTH.includes(partial.length)) d.units.length = partial.length;
  });
}

// Remember the other kind's link per store so toggling back restores its edits.
const stash = new WeakMap();

/** Switch a link between 'mic' and 'iem', keeping its id and frequency and restoring earlier edits of the other kind. */
export function setLinkKind(store, linkId, kind) {
  if (kind !== 'mic' && kind !== 'iem' && kind !== 'p2p') return false;
  return store.update((d) => {
    const i = d.links.findIndex((l) => l.id === linkId);
    if (i < 0 || d.links[i].kind === kind) return;
    const cur = d.links[i];
    let map = stash.get(store);
    if (!map) { map = new Map(); stash.set(store, map); }
    map.set(`${linkId}:${cur.kind}`, structuredClone(cur));
    const prev = map.get(`${linkId}:${kind}`);
    const next = prev ? structuredClone(prev) : createDefaultLink(kind);
    next.id = cur.id;
    next.freqMHz = cur.freqMHz;
    d.links[i] = next;
  });
}

/** Add a reflector (defaults from createReflector, overridden by `reflector`). Returns the new id. */
export function addReflector(store, reflector = {}) {
  const r = createReflector(reflector);
  if (typeof r.id !== 'string' || !r.id) r.id = newId('refl');
  let ok = false;
  store.update((d) => { if (d.reflectors.length >= SCENE_LIMITS.maxReflectors) return; d.reflectors.push(r); ok = true; });
  return ok ? r.id : null;
}

export function removeReflector(store, id) {
  return store.update((d) => {
    const i = d.reflectors.findIndex((r) => r.id === id);
    if (i >= 0) d.reflectors.splice(i, 1);
    if (Array.isArray(d.noiseSources)) d.noiseSources = d.noiseSources.filter((n) => n.reflectorId !== id); // the linked video-wall source goes with its wall
  });
}

/** Replace the scene with a fresh default (undoable). Keeps the user's display units. */
export function resetScene(store) {
  const units = store.getScene().units;
  store.update(() => ({ ...createDefaultScene(), units: { ...units } }));
  store.select(null);
}

/**
 * Load an example scene (see examples.js): replaces the scene (history reset), selects the link's transmitter and,
 * unless { walk: false }, starts the example's walk. Returns the example { id, title, note, ... } or null if unknown.
 */
export function loadExample(store, id, { walk = true, onStop } = {}) {
  const ex = buildExample(id);
  if (!ex) return null;
  stopWalk();
  store.setScene(ex.scene);
  store.select(ex.selectId);
  if (walk && ex.walk && ex.scene.links[0]) startWalk(store, ex.scene.links[0].id, { ...ex.walk, onStop });
  return ex;
}

const MOD_TYPES = ['analog-fm', 'digital'];
const FIXED = [null, 2, 4, 16, 64, 256];

/**
 * setModulation(store, linkId, { type?, preset?, fixedOrder?, overrides? }): switch a link between 'analog-fm' and
 * 'digital' and choose the digital preset / fixed constellation order (null = adaptive). Invalid values are ignored.
 */
export function setModulation(store, linkId, partial = {}) {
  return store.update((d) => {
    const link = d.links.find((l) => l.id === linkId);
    if (!link) return;
    if (!link.modulation) link.modulation = { type: 'analog-fm', digital: { preset: 'mic-qpsk-fixed', fixedOrder: null, overrides: {} } };
    const m = link.modulation;
    if (MOD_TYPES.includes(partial.type)) m.type = partial.type;
    if (typeof partial.preset === 'string' && partial.preset) m.digital.preset = partial.preset;
    if (partial.fixedOrder !== undefined && FIXED.includes(partial.fixedOrder)) m.digital.fixedOrder = partial.fixedOrder;
    if (partial.overrides && typeof partial.overrides === 'object') m.digital.overrides = { ...partial.overrides };
  });
}

// ---- IEM antenna branches, coverage zones, splitter ------------------------------------------------------------
// Branch 0 mirrors the legacy link.tx.pos / link.tx.antenna / link.chain (see syncBranches in scene.js), so edits to
// branch 0 are written to those fields; the store re-mirrors them into branches[0].

const lastOf = (a) => a[a.length - 1];

/** Add a transmit antenna branch to an IEM link. Returns the new branch id (null for mic links / unknown link). */
export function addBranch(store, linkId, branch = {}) {
  const b = createBranch(branch);
  let ok = false;
  store.update((d) => {
    const link = d.links.find((l) => l.id === linkId);
    if (!link || link.kind !== 'iem' || !Array.isArray(link.branches) || link.branches.length >= SCENE_LIMITS.maxBranches) return;
    const prev = lastOf(link.branches);
    if (!branch.pos) b.pos = { x: Math.min(d.stage.width, prev.pos.x + 3), y: prev.pos.y, z: prev.pos.z };
    if (!branch.antenna) b.antenna = structuredClone(prev.antenna);
    if (!branch.name) b.name = `Antenna ${link.branches.length + 1}`;
    link.branches.push(b);
    ok = true;
  });
  return ok ? b.id : null;
}

/** Remove a branch. The last remaining branch cannot be removed. Removing branch 0 promotes branch 1 into the legacy fields. */
export function removeBranch(store, linkId, branchId) {
  return store.update((d) => {
    const link = d.links.find((l) => l.id === linkId);
    if (!link || !Array.isArray(link.branches) || link.branches.length < 2) return;
    const i = link.branches.findIndex((b) => b.id === branchId);
    if (i < 0) return;
    if (i === 0) {
      const n = link.branches[1];
      link.tx.pos = structuredClone(n.pos); link.tx.antenna = structuredClone(n.antenna); link.chain = structuredClone(n.chain);
    }
    link.branches.splice(i, 1);
  });
}

/** Move a branch's antenna to pos ({x?, y?, z?}). Use { coalesce } for drags. */
export function moveBranch(store, linkId, branchId, pos, o = {}) {
  return updateBranch(store, linkId, branchId, { pos }, o);
}

/** updateBranch(store, linkId, branchId, { name?, pos?, antenna?, chain? }, { coalesce }): pos and antenna merge, chain and name replace. */
export function updateBranch(store, linkId, branchId, patch = {}, o = {}) {
  return store.update((d) => {
    const link = d.links.find((l) => l.id === linkId);
    if (!link || !Array.isArray(link.branches)) return;
    const i = link.branches.findIndex((b) => b.id === branchId);
    if (i < 0) return;
    const b = link.branches[i];
    const tgt = i === 0 ? { pos: link.tx.pos, antenna: link.tx.antenna } : b;
    if (patch.pos) for (const k of ['x', 'y', 'z']) if (Number.isFinite(patch.pos[k])) tgt.pos[k] = patch.pos[k];
    if (patch.antenna) Object.assign(tgt.antenna, structuredClone(patch.antenna));
    if (Array.isArray(patch.chain)) {
      const chain = patch.chain.map((c) => createChainItem(c.kind, c));
      if (i === 0) link.chain = chain; else b.chain = chain;
    }
    if (typeof patch.name === 'string') b.name = patch.name;
  }, opts(o));
}

/** setSplitter(store, linkId, { preset, insertionLossDb } | null): optional splitter model for the branch feed. */
export function setSplitter(store, linkId, splitter) {
  return store.update((d) => {
    const link = d.links.find((l) => l.id === linkId);
    if (!link) return;
    if (splitter === null) { delete link.splitter; return; }
    if (splitter && typeof splitter.preset === 'string' && Number.isFinite(splitter.insertionLossDb) && splitter.insertionLossDb >= 0) {
      link.splitter = { preset: splitter.preset, insertionLossDb: splitter.insertionLossDb };
    }
  });
}

/** Add a coverage zone (rectangle by default). Returns its id. */
export function addZone(store, zone = {}) {
  const z = createZone(zone);
  let ok = false;
  store.update((d) => { if (!Array.isArray(d.zones)) d.zones = []; if (d.zones.length >= SCENE_LIMITS.maxZones) return; d.zones.push(z); ok = true; });
  return ok ? z.id : null;
}

export function removeZone(store, id) {
  return store.update((d) => {
    const i = (d.zones || []).findIndex((z) => z.id === id);
    if (i >= 0) d.zones.splice(i, 1);
  });
}

/** updateZone(store, id, { name?, zMin?, zMax?, requiredMarginDb?, polygon? }, { coalesce }) */
export function updateZone(store, id, patch = {}, o = {}) {
  return store.update((d) => {
    const z = (d.zones || []).find((x) => x.id === id);
    if (!z) return;
    if (typeof patch.name === 'string') z.name = patch.name;
    for (const k of ['zMin', 'zMax', 'requiredMarginDb']) if (Number.isFinite(patch[k])) z[k] = patch[k];
    if (Number.isFinite(patch.passAreaFraction) && patch.passAreaFraction >= 0.5 && patch.passAreaFraction <= 1) z.passAreaFraction = patch.passAreaFraction;
    if (Array.isArray(patch.polygon) && patch.polygon.length >= 3) z.polygon = patch.polygon.map((p) => ({ x: p.x, y: p.y }));
  }, opts(o));
}

/** Insert a polygon vertex (appended unless index is given). */
export function addZonePoint(store, zoneId, point, index) {
  return store.update((d) => {
    const z = (d.zones || []).find((x) => x.id === zoneId);
    if (!z || z.polygon.length >= SCENE_LIMITS.maxZonePoints || !Number.isFinite(point && point.x) || !Number.isFinite(point && point.y)) return;
    const i = Number.isInteger(index) ? Math.max(0, Math.min(z.polygon.length, index)) : z.polygon.length;
    z.polygon.splice(i, 0, { x: point.x, y: point.y });
  });
}

/** Move polygon vertex `index` to point ({x, y}). Use { coalesce } for drags. */
export function movePoint(store, zoneId, index, point, o = {}) {
  return store.update((d) => {
    const z = (d.zones || []).find((x) => x.id === zoneId);
    if (!z || !z.polygon[index]) return;
    if (Number.isFinite(point.x)) z.polygon[index].x = point.x;
    if (Number.isFinite(point.y)) z.polygon[index].y = point.y;
  }, opts(o));
}

/** Remove a polygon vertex (never below 3). */
export function removeZonePoint(store, zoneId, index) {
  return store.update((d) => {
    const z = (d.zones || []).find((x) => x.id === zoneId);
    if (z && z.polygon.length > 3 && z.polygon[index]) z.polygon.splice(index, 1);
  });
}

/** setCoverageMode(store, 'coherent' | 'power' | 'best'): how branch signals combine in the coverage map. */
export function setCoverageMode(store, mode) {
  if (!['coherent', 'power', 'best'].includes(mode)) return false;
  return store.update((d) => { d.coverage = { ...(d.coverage || {}), mode }; });
}

// ---- intermodulation demo --------------------------------------------------------------------------------------

const IMD_PRESET_IDS = ['mic-rack-typical', 'iem-combiner-no-isolation', 'iem-combiner-isolated', 'pim-corroded-connector'];
const imdOf = (d) => { if (!d.imd) d.imd = { enabled: false, preset: 'mic-rack-typical', transmitters: [], rxAntennaPos: { x: 10, y: 6.5, z: 2.5 }, combiner: { type: 'none', isolationDb: 0, lossDb: 0 }, pim: { preset: 'none', levelDbc: null }, channelBwKHz: 200, wantedFreqMHz: null }; return d.imd; };

/** Switch the demo on or off. The first time it is switched on with no transmitters, the four-mic default plan is added. */
export function setImdEnabled(store, enabled) {
  return store.update((d) => {
    const m = imdOf(d);
    m.enabled = !!enabled;
    if (m.enabled && !m.transmitters.length) m.transmitters = defaultImdTransmitters();
  });
}

/** Add a transmitter (position and frequency default to a free spot on the stage). Returns its id. */
export function addImdTransmitter(store, tx = {}) {
  const t = createImdTransmitter(tx);
  let ok = false;
  store.update((d) => {
    const m = imdOf(d);
    if (m.transmitters.length >= SCENE_LIMITS.maxImdTransmitters) return; // the product count grows as N^5
    const last = m.transmitters[m.transmitters.length - 1];
    if (!tx.freqMHz) t.freqMHz = Math.round(((last ? last.freqMHz : 606) + 0.475) * 1000) / 1000;
    if (!tx.pos) t.pos = { x: Math.min(d.stage.width, (last ? last.pos.x : 2) + 1.5), y: last ? last.pos.y : 3, z: 1.5 };
    if (!tx.name) t.name = `Mic ${m.transmitters.length + 1}`;
    m.transmitters.push(t);
    ok = true;
  });
  return ok ? t.id : null;
}

export function removeImdTransmitter(store, id) {
  return store.update((d) => {
    const m = imdOf(d);
    const i = m.transmitters.findIndex((t) => t.id === id);
    if (i >= 0) m.transmitters.splice(i, 1);
  });
}

/** Move a transmitter ({x?, y?, z?}); use { coalesce } for drags. */
export function moveImdTransmitter(store, id, pos, o = {}) {
  return updateImdTransmitter(store, id, { pos }, o);
}

/** updateImdTransmitter(store, id, { name?, freqMHz?, powerDbm?, pos?, antenna? }, { coalesce }). Invalid numbers are ignored. */
export function updateImdTransmitter(store, id, patch = {}, o = {}) {
  return store.update((d) => {
    const t = imdOf(d).transmitters.find((x) => x.id === id);
    if (!t) return;
    if (typeof patch.name === 'string') t.name = patch.name;
    if (Number.isFinite(patch.freqMHz) && patch.freqMHz > 0) t.freqMHz = patch.freqMHz;
    if (Number.isFinite(patch.powerDbm)) t.powerDbm = patch.powerDbm;
    if (patch.pos) for (const k of ['x', 'y', 'z']) if (Number.isFinite(patch.pos[k])) t.pos[k] = patch.pos[k];
    if (patch.antenna) Object.assign(t.antenna, structuredClone(patch.antenna));
  }, opts(o));
}

/** Choose a preset; it also sets the combiner and PIM the preset implies (a later setImdCombiner / setImdPim overrides them). */
export function setImdPreset(store, preset) {
  if (!IMD_PRESET_IDS.includes(preset)) return false;
  return store.update((d) => {
    const m = imdOf(d);
    m.preset = preset;
    const p = IMD_PRESETS[preset] || {};
    const type = p.combiner === 'passive-hybrid' ? 'hybrid' : p.combiner === 'isolated-cavity' ? 'isolated' : 'none';
    const c = COMBINER_PRESETS[p.combiner] || COMBINER_PRESETS.none;
    m.combiner = { type, isolationDb: c.isolationDb, lossDb: c.insertionLossDb };
    m.pim = { preset: p.junction === 'corroded-connector' ? 'corroded' : 'none', levelDbc: null };
  });
}

/** setImdCombiner(store, { type?: 'none'|'hybrid'|'isolated', isolationDb?, lossDb? }) */
export function setImdCombiner(store, partial = {}) {
  return store.update((d) => {
    const c = imdOf(d).combiner;
    if (['none', 'hybrid', 'isolated'].includes(partial.type)) c.type = partial.type;
    if (Number.isFinite(partial.isolationDb) && partial.isolationDb >= 0) c.isolationDb = partial.isolationDb;
    if (Number.isFinite(partial.lossDb) && partial.lossDb >= 0) c.lossDb = partial.lossDb;
  });
}

/** setImdPim(store, { preset?: 'none'|'good'|'corroded', levelDbc?: number|null }) */
export function setImdPim(store, partial = {}) {
  return store.update((d) => {
    const q = imdOf(d).pim;
    if (['none', 'good', 'corroded'].includes(partial.preset)) q.preset = partial.preset;
    if (partial.levelDbc === null || Number.isFinite(partial.levelDbc)) q.levelDbc = partial.levelDbc;
  });
}

/** setInterferer(store, linkId, { enabled?, levelDbm?, hasPilot?, offsetKHz? }): a stray carrier at the receiver input. */
export function setInterferer(store, linkId, partial = {}) {
  return store.update((d) => {
    const link = d.links.find((l) => l.id === linkId);
    if (!link) return;
    if (!link.interferer) link.interferer = { enabled: false, levelDbm: -70, hasPilot: false, offsetKHz: 0 };
    const f = link.interferer;
    if (typeof partial.enabled === 'boolean') f.enabled = partial.enabled;
    if (Number.isFinite(partial.levelDbm)) f.levelDbm = partial.levelDbm;
    if (typeof partial.hasPilot === 'boolean') f.hasPilot = partial.hasPilot;
    if (Number.isFinite(partial.offsetKHz)) f.offsetKHz = partial.offsetKHz;
  });
}

/** setRequiredSnr(store, linkId, db | null): SNR the receiver needs at its input; null returns to the value implied by the sensitivity. */
export function setRequiredSnr(store, linkId, db) {
  return store.update((d) => {
    const link = d.links.find((l) => l.id === linkId);
    if (!link) return;
    if (db === null) delete link.rx.requiredSnrDb;
    else if (Number.isFinite(db)) link.rx.requiredSnrDb = db;
  });
}

/**
 * setAntennaBOrientation(store, linkId, { az?, el? } | null, { coalesce }): aim receive antenna B independently of A.
 * null returns to "same direction as A". Missing az or el keep the current effective value; az wraps to 0..360, el is clamped to -90..90.
 */
export function setAntennaBOrientation(store, linkId, orientation, o = {}) {
  return store.update((d) => {
    const link = findLink(d, linkId);
    const ab = link && link.rx && link.rx.diversity && link.rx.diversity.antennaB;
    if (!ab) return;
    if (orientation === null) { ab.orientation = null; return; }
    if (!orientation || typeof orientation !== 'object') return;
    const cur = effectiveAntennaB(link).orientation;
    const az = Number.isFinite(orientation.az) ? orientation.az : cur.az;
    const el = Number.isFinite(orientation.el) ? orientation.el : cur.el;
    ab.orientation = { az: ((az % 360) + 360) % 360, el: Math.max(-90, Math.min(90, el)) };
  }, opts(o));
}

// ---- antenna orientation details: tilt, roll, polarisation, ground plane, contact, dampness --------------------------

export const ANTENNA_FIELDS = Object.freeze(['tiltDeg', 'rollDeg', 'polarisation', 'groundPlane', 'contact', 'dampness']);

/** The antenna object a target names: 'tx' | 'rx' | 'antennaB' (its own antenna, only when set) | { branch: id }. Null when absent. */
export function antennaOf(link, target) {
  if (!link) return null;
  if (target === 'tx') return link.tx && link.tx.antenna;
  if (target === 'rx') return link.rx && link.rx.antenna;
  if (target === 'antennaB') return (link.rx && link.rx.diversity && link.rx.diversity.antennaB && link.rx.diversity.antennaB.antenna) || null;
  if (target && target.branch && Array.isArray(link.branches)) {
    const i = link.branches.findIndex((b) => b.id === target.branch);
    if (i < 0) return null;
    return i === 0 ? link.tx.antenna : link.branches[i].antenna; // branch 0 mirrors tx
  }
  return null;
}

/**
 * setAntennaField(store, linkId, target, field, value, { coalesce }): write one optional antenna field, or delete it when the value
 * is the default (tilt or roll 0 / null, polarisation / groundPlane null or '', contact 'free', dampness 'dry'). Invalid values are
 * ignored. Tilt is clamped to -90..90, roll to -180..180. Setting groundPlane also sets gainDbi from GROUND_PLANE_GAIN_DBI; clearing it
 * restores the library gain. groundPlane applies to quarter-wave antennas only. Returns true when the scene changed.
 */
export function setAntennaField(store, linkId, target, field, value, o = {}) {
  if (!ANTENNA_FIELDS.includes(field)) return false;
  let changed = false;
  store.update((d) => {
    const a = antennaOf(findLink(d, linkId), target);
    if (!a) return;
    const none = value === null || value === undefined || value === '';
    if (field === 'tiltDeg' || field === 'rollDeg') {
      const lim = field === 'tiltDeg' ? 90 : 180;
      if (none || value === 0) { if (field in a) { delete a[field]; changed = true; } return; }
      if (!Number.isFinite(value)) return;
      a[field] = Math.max(-lim, Math.min(lim, value)); changed = true; return;
    }
    if (field === 'groundPlane') {
      if (a.type !== 'quarterwave') return;
      if (none) { delete a.groundPlane; if (ANTENNAS.quarterwave) a.gainDbi = ANTENNAS.quarterwave.gainDbi; changed = true; return; }
      if (!Object.prototype.hasOwnProperty.call(GROUND_PLANE_GAIN_DBI, value)) return;
      a.groundPlane = value; a.gainDbi = GROUND_PLANE_GAIN_DBI[value]; changed = true; return;
    }
    if (field === 'polarisation') { // always explicit: null or '' means the default for this antenna type; a value illegal for the type is ignored
      if (none) { a.polarisation = defaultPolarisation(a.type); changed = true; return; }
      if (!allowedPolarisations(a.type).includes(value)) return;
      a.polarisation = value; changed = true; return;
    }
    const ok = Object.prototype.hasOwnProperty.call(field === 'contact' ? ANTENNA_CONTACT_LOSS_DB : ANTENNA_DAMPNESS_LOSS_DB, value);
    const dflt = none || (field === 'contact' && value === 'free') || (field === 'dampness' && value === 'dry');
    if (dflt) { if (field in a) { delete a[field]; changed = true; } return; }
    if (!ok) return;
    a[field] = value; changed = true;
  }, opts(o));
  return changed;
}

/** setAntennaType(store, linkId, target, type): change the model, take its library gain and drop a ground plane that no longer applies. */
export function setAntennaType(store, linkId, target, type) {
  if (!ANTENNAS[type]) return false;
  let changed = false;
  store.update((d) => {
    const a = antennaOf(findLink(d, linkId), target);
    if (!a) return;
    a.type = type; a.gainDbi = ANTENNAS[type].gainDbi;
    if (type !== 'quarterwave') delete a.groundPlane;
    if (!allowedPolarisations(type).includes(a.polarisation)) a.polarisation = defaultPolarisation(type); // linear <-> circular
    changed = true;
  });
  return changed;
}

// ---- stage size, deck height and raised platforms ---------------------------------------------------------------
// pos.z of every item is the height above the LOCAL floor (the deck, or the top of the platform it stands on).

const clampTo = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const fin = Number.isFinite;

/** setStage(store, { width?, depth?, heightM?, material? }, { coalesce }): material = a SURFACES id for the deck, '' = same as the venue floor; values are clamped to 0.5..500 m (size) and 0..20 m (deck height). */
export function setStage(store, partial = {}, o = {}) {
  return store.update((d) => {
    if (fin(partial.width)) d.stage.width = clampTo(partial.width, STAGE_LIMITS.size);
    if (fin(partial.depth)) d.stage.depth = clampTo(partial.depth, STAGE_LIMITS.size);
    if (fin(partial.heightM)) d.stage.heightM = clampTo(partial.heightM, STAGE_LIMITS.heightM);
    else if (!fin(d.stage.heightM)) d.stage.heightM = 0;
    if ('material' in partial) {
      if (typeof partial.material === 'string' && Object.prototype.hasOwnProperty.call(SURFACES, partial.material)) d.stage.material = partial.material;
      else delete d.stage.material; // '' or unknown = same as the venue floor
    }
  }, opts(o));
}

/**
 * addPlatform(store, partial?) -> id (null at the 50-platform limit). Default: 2 x 2 m wooden riser on the stage,
 * 0.4 m above the deck, offset a little from the previous one so new platforms do not hide each other.
 */
export function addPlatform(store, partial = {}) {
  let id = null;
  store.update((d) => {
    if (!Array.isArray(d.platforms)) d.platforms = [];
    if (d.platforms.length >= PLATFORM_LIMITS.max) return;
    const n = d.platforms.length;
    const base = createPlatform({
      name: `Platform ${n + 1}`,
      x: Math.max(0, (d.stage.width - 2) / 2 + 0.5 * n), y: Math.max(0, (d.stage.depth - 2) / 2 + 0.5 * n),
      topM: (d.stage.heightM || 0) + 0.4,
    });
    const p = { ...base };
    if (typeof partial.name === 'string') p.name = partial.name;
    if (typeof partial.id === 'string' && partial.id && !d.platforms.some((x) => x.id === partial.id)) p.id = partial.id;
    for (const k of ['x', 'y']) if (fin(partial[k])) p[k] = clampTo(partial[k], PLATFORM_LIMITS.coord);
    for (const k of ['width', 'depth']) if (fin(partial[k])) p[k] = clampTo(partial[k], PLATFORM_LIMITS.size);
    if (fin(partial.topM)) p.topM = clampTo(partial.topM, PLATFORM_LIMITS.topM);
    if (PLATFORM_MATERIALS.includes(partial.material)) p.material = partial.material;
    d.platforms.push(p);
    id = p.id;
  });
  return id;
}

/** updatePlatform(store, id, { name?, material?, x?, y?, width?, depth?, topM? }, { coalesce }): numbers are clamped, bad values ignored. */
export function updatePlatform(store, id, partial = {}, o = {}) {
  return store.update((d) => {
    const p = (d.platforms || []).find((x) => x.id === id);
    if (!p) return;
    if (typeof partial.name === 'string') p.name = partial.name;
    if (PLATFORM_MATERIALS.includes(partial.material)) p.material = partial.material;
    for (const k of ['x', 'y']) if (fin(partial[k])) p[k] = clampTo(partial[k], PLATFORM_LIMITS.coord);
    for (const k of ['width', 'depth']) if (fin(partial[k])) p[k] = clampTo(partial[k], PLATFORM_LIMITS.size);
    if (fin(partial.topM)) p.topM = clampTo(partial.topM, PLATFORM_LIMITS.topM);
    if (fin(partial.rotationDeg)) { // wrapped into (-180, 180]; 0 is stored as unset so unrotated platforms stay identical to old saves
      const w = ((((partial.rotationDeg + 180) % 360) + 360) % 360) - 180, r = w === -180 ? 180 : w;
      if (r === 0) delete p.rotationDeg; else p.rotationDeg = r;
    }
  }, opts(o));
}

export function removePlatform(store, id) {
  const r = store.update((d) => {
    const i = (d.platforms || []).findIndex((x) => x.id === id);
    if (i >= 0) d.platforms.splice(i, 1);
  });
  if (store.getSelection() === id) store.select(null);
  return r;
}

/** movePlatform(store, id, { x?, y? }, { coalesce }): moves the corner (x, y) of the platform; drags pass a coalesce key. */
export function movePlatform(store, id, pos = {}, o = {}) {
  return updatePlatform(store, id, { x: pos.x, y: pos.y }, o);
}

/** resizePlatform(store, id, { width?, depth? }, { coalesce }) */
export function resizePlatform(store, id, size = {}, o = {}) {
  return updatePlatform(store, id, { width: size.width, depth: size.depth }, o);
}

// ---- FM equipment presets (one undoable step each) ----

/** Apply (or clear with null/'') a transmitter equipment preset on a link. opts: { powerOptionId, lowIntermod }. */
export function setTxFmPreset(store, linkId, presetId, o = {}) {
  return store.update((d) => {
    const i = d.links.findIndex((l) => l.id === linkId);
    if (i < 0) return;
    if (!presetId) { delete d.links[i].tx.fmPreset; delete d.links[i].tx.lowIntermod; return; }
    const l = applyFmPreset(d.links[i], presetId, o);
    if (l.tx.fmPreset !== presetId) return;
    d.links[i].tx = l.tx;
  });
}

/** Power option or low-intermod change on a link's Tx preset. */
export function setTxPowerOption(store, linkId, powerOptionId) {
  const l = store.getScene().links.find((x) => x.id === linkId);
  if (!l || !l.tx.fmPreset) return false;
  return setTxFmPreset(store, linkId, l.tx.fmPreset, { powerOptionId });
}
export function setTxLowIntermod(store, linkId, on) {
  return store.update((d) => {
    const l = d.links.find((x) => x.id === linkId);
    if (l && l.tx.fmPreset) l.tx.lowIntermod = !!on;
  });
}

/** Apply an FM receiver preset (sets rxPreset, sensitivity, squelch, diversity mode). */
export function setRxFmPreset(store, linkId, presetId) {
  return store.update((d) => {
    const i = d.links.findIndex((l) => l.id === linkId);
    if (i < 0) return;
    d.links[i].rx = applyFmPreset(d.links[i], presetId).rx;
  });
}

/** Intermod-demo transmitter equipment preset and low-intermod flag. */
export function setImdTransmitterFm(store, id, { fmPreset, powerOptionId, lowIntermod } = {}) {
  return store.update((d) => {
    const t = imdOf(d).transmitters.find((x) => x.id === id);
    if (!t) return;
    if (fmPreset === '' || fmPreset === null) { delete t.fmPreset; delete t.lowIntermod; return; }
    if (fmPreset) {
      const l = applyFmPreset({ tx: { powerDbm: t.powerDbm }, rx: {} }, fmPreset, { powerOptionId, lowIntermod });
      if (l.tx.fmPreset !== fmPreset) return;
      t.fmPreset = fmPreset; t.powerDbm = l.tx.powerDbm;
      if ('lowIntermod' in l.tx) t.lowIntermod = l.tx.lowIntermod; else delete t.lowIntermod;
    } else if (lowIntermod !== undefined && t.fmPreset) t.lowIntermod = !!lowIntermod;
  });
}

// ---- venue underlay (js/model/venue-underlay.js). The underlay is replaced as a whole, never edited in place.

/** setVenue(store, underlay) -> boolean. Replaces any existing venue, hidden flags included. Undoable. */
export function setVenue(store, underlay) {
  if (validateVenue(underlay).length) return false;
  return store.update((d) => { d.venue = underlay; });
}

/** removeVenue(store) -> boolean (false when there was none). */
export function removeVenue(store) {
  if (store.getScene().venue === undefined) return false;
  return store.update((d) => { delete d.venue; });
}

/** setVenueLayerHidden(store, name, hidden) -> boolean. Flips that layer's flag only. */
export function setVenueLayerHidden(store, name, hidden) {
  const v = store.getScene().venue;
  const cur = v && v.layers.find((L) => L.name === name);
  if (!cur || cur.hidden === !!hidden) return false;
  return store.update((d) => { d.venue = { layers: v.layers.map((L) => (L.name === name ? { ...L, hidden: !!hidden } : L)) }; });
}

/**
 * Set a link's squelch threshold in dBm (snapped to 1 dB, clamped to -120..0). Ignored while the squelch is off or for a bad number.
 * Pass { coalesce } while dragging so the whole drag is one undo step.
 */
export const SQUELCH_RANGE_DBM = Object.freeze({ min: -120, max: 0 });
export function setSquelchThreshold(store, linkId, dbm, opts = {}) {
  if (!Number.isFinite(dbm)) return false;
  const v = Math.min(SQUELCH_RANGE_DBM.max, Math.max(SQUELCH_RANGE_DBM.min, Math.round(dbm)));
  let ok = false;
  store.update((d) => {
    const l = d.links.find((x) => x.id === linkId);
    if (!l || !l.rx || !l.rx.squelch || l.rx.squelch.enabled === false) return;
    l.rx.squelch.thresholdDbm = v; ok = true;
  }, opts.coalesce ? { coalesce: opts.coalesce } : {});
  return ok;
}

// ---- global audio source (item 31) ----------------------------------------------------------------------------
/** Global programme source for every link's audio views and meters. '' or null removes the field (per-link default: mic voice, IEM music). */
export function setAudioSource(store, id, o = {}) {
  if (id === '' || id === null) return store.update((d) => { delete d.audioSource; }, o.coalesce ? { coalesce: o.coalesce } : {});
  if (!AUDIO_SOURCE_IDS.includes(id)) return false;
  return store.update((d) => { d.audioSource = id; }, o.coalesce ? { coalesce: o.coalesce } : {});
}
/** Tone frequency in Hz for the tone and two-tone sources (20..20000, clamped). Non-numbers are ignored. */
export function setAudioToneHz(store, hz, o = {}) {
  if (!Number.isFinite(+hz) || hz === '' || hz === null) return false;
  const v = Math.min(TONE_HZ_LIMITS[1], Math.max(TONE_HZ_LIMITS[0], +hz));
  return store.update((d) => { d.audioToneHz = v; }, { coalesce: o.coalesce || 'audioToneHz' });
}


// ---- people (item 36) ----------------------------------------------------------------------------------------------
// A person groups the mic transmitter and the IEM bodypack of their links (model/people.js). Moving or turning a person moves both packs and
// keeps their offsets; deleting a person never deletes a link. Link names follow the person: "Anna mic", "Anna IEM".

const peopleOf = (d) => { if (!Array.isArray(d.people)) d.people = []; return d.people; };
const rotateAz = (ant, deg) => { if (ant && ant.orientation && Number.isFinite(ant.orientation.az)) ant.orientation = { ...ant.orientation, az: ((ant.orientation.az + deg + 540) % 360) - 180 }; };
const pack = (d, person) => ({ mic: person.micLinkId ? findLink(d, person.micLinkId) : null, iem: person.iemLinkId ? findLink(d, person.iemLinkId) : null });
/** The extra (backup) mic links of a person that still exist, in order. */
const extras = (d, person) => (Array.isArray(person.extraLinkIds) ? person.extraLinkIds.map((id) => findLink(d, id)).filter(Boolean) : []);

/** Write the pack positions of a person onto the linked mic transmitter and IEM bodypack. */
function placePacks(d, person) {
  const at = personPackPositions(person), { mic, iem } = pack(d, person);
  if (mic && at.mic) mic.tx.pos = { ...mic.tx.pos, ...at.mic };
  if (iem && at.iem) iem.rx.pos = { ...iem.rx.pos, ...at.iem };
  for (const l of extras(d, person)) { const pos = at.extra && at.extra[l.id]; if (pos) l.tx.pos = { ...l.tx.pos, ...pos }; }
}

/** Copy the person's body coupling (contact, dampness) onto the antennas of the packs. */
function applyCoupling(d, person) {
  const { mic, iem } = pack(d, person);
  for (const a of [mic && mic.tx.antenna, iem && iem.rx.antenna, ...extras(d, person).map((l) => l.tx.antenna)]) {
    if (!a) continue;
    for (const k of ['contact', 'dampness']) {
      if (person[k] === undefined) continue;
      if (person[k] === 'free' || person[k] === 'dry') delete a[k]; else a[k] = person[k];
    }
  }
}

/** Rename the links a person carries (only names that still equal the previous automatic name are replaced, so a typed link name is kept). */
function renameLinks(d, person, oldName) {
  const { mic, iem } = pack(d, person);
  const old = { name: oldName };
  if (mic && mic.name === personLinkName(old, 'mic')) mic.name = personLinkName(person, 'mic');
  if (iem && iem.name === personLinkName(old, 'iem')) iem.name = personLinkName(person, 'iem');
  extras(d, person).forEach((l, i) => { if (l.name === extraLinkName(old, i)) l.name = extraLinkName(person, i); });
}

/** addPerson(store, { name, role, colour, pos: {x, y}, facingDeg }) -> id, or null when the cap is reached. The colour cycles through the palette. */
export function addPerson(store, partial = {}) {
  let id = null;
  store.update((d) => {
    const list = peopleOf(d);
    if (list.length >= PEOPLE_LIMITS.max) return;
    const p = createPerson({ name: `Person ${list.length + 1}`, colour: PERSON_COLOURS[list.length % PERSON_COLOURS.length] });
    if (typeof partial.name === 'string' && partial.name.length >= 1) p.name = partial.name.slice(0, PEOPLE_LIMITS.nameChars);
    if (PERSON_ROLES.includes(partial.role)) p.role = partial.role;
    if (PERSON_COLOURS.includes(partial.colour)) p.colour = partial.colour;
    if (partial.pos && Number.isFinite(partial.pos.x) && Number.isFinite(partial.pos.y)) p.pos = { x: clampCoord(partial.pos.x), y: clampCoord(partial.pos.y) };
    if (Number.isFinite(partial.facingDeg)) p.facingDeg = Math.min(360, Math.max(-360, partial.facingDeg));
    list.push(p); id = p.id;
  });
  return id;
}

/**
 * updatePerson(store, id, { name?, role?, colour?, facingDeg?, contact?, dampness? }, { coalesce }): a new facingDeg turns the person about their floor
 * point: the pack positions rotate with them and both antenna azimuths turn by the same angle. contact / dampness are antenna contact keys
 * (library.js) and are written onto both packs. A rename also renames the links the person carries.
 */
export function updatePerson(store, id, patch = {}, o = {}) {
  return store.update((d) => {
    const p = peopleOf(d).find((x) => x.id === id);
    if (!p) return;
    const oldName = p.name;
    if (typeof patch.name === 'string' && patch.name.length >= 1) { p.name = patch.name.slice(0, PEOPLE_LIMITS.nameChars); if (p.name !== oldName) renameLinks(d, p, oldName); }
    if (PERSON_ROLES.includes(patch.role)) p.role = patch.role;
    if (PERSON_COLOURS.includes(patch.colour)) p.colour = patch.colour;
    if (patch.contact !== undefined && (patch.contact === 'free' || Object.prototype.hasOwnProperty.call(ANTENNA_CONTACT_LOSS_DB, patch.contact))) p.contact = patch.contact;
    if (patch.dampness !== undefined && (patch.dampness === 'dry' || Object.prototype.hasOwnProperty.call(ANTENNA_DAMPNESS_LOSS_DB, patch.dampness))) p.dampness = patch.dampness;
    if (patch.contact !== undefined || patch.dampness !== undefined) applyCoupling(d, p);
    if (Number.isFinite(patch.facingDeg) && Math.abs(patch.facingDeg) <= 360) {
      const delta = patch.facingDeg - (p.facingDeg || 0);
      p.facingDeg = patch.facingDeg;
      if (delta) { const { mic, iem } = pack(d, p); if (mic) rotateAz(mic.tx.antenna, delta); if (iem) rotateAz(iem.rx.antenna, delta); extras(d, p).forEach((l) => rotateAz(l.tx.antenna, delta)); placePacks(d, p); }
    }
  }, opts(o));
}

/** Remove one extra link (and its offset) from a person; removes the empty fields. */
function dropExtra(p, linkId) {
  if (!Array.isArray(p.extraLinkIds)) return;
  p.extraLinkIds = p.extraLinkIds.filter((x) => x !== linkId);
  if (p.extraOffsets) delete p.extraOffsets[linkId];
  if (!p.extraLinkIds.length) { delete p.extraLinkIds; delete p.extraOffsets; }
}

/** Pack offset of an absolute pack position, clamped to the validator limits (+-10 m, 0 to 5 m high) so a saved scene always loads. */
function packOffset(person, here) {
  const o = offsetFromPack(person, here), [lo, hi] = PEOPLE_LIMITS.offsetM, [zl, zh] = PEOPLE_LIMITS.heightM;
  const c = (v, a, b) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : 0));
  return { dx: c(o.dx, lo, hi), dy: c(o.dy, lo, hi), dz: c(o.dz, zl, zh) };
}
const clampCoord = (v) => Math.min(PEOPLE_LIMITS.coord[1], Math.max(PEOPLE_LIMITS.coord[0], v));

const NEAR_PERSON_M = 1.5;
/**
 * The offset a pack gets when it is assigned to a person already on the plan. A pack within NEAR_PERSON_M of the person stays where it is (the stored
 * offset is its current one); a pack further away JUMPS to the person at the standard body offset (handheld height 1.2 m or more, otherwise a bodypack),
 * keeping its own height. The person is the anchor: the equipment goes to whoever carries it. An unplaced person is placed at the pack instead.
 */
function assignedOffset(person, which, here) {
  const o = packOffset(person, here);
  if (Math.hypot(o.dx, o.dy) <= NEAR_PERSON_M) return o;
  const base = which === 'iem' ? DEFAULT_IEM_OFFSET : (Number.isFinite(here.z) && here.z >= 1.2 ? DEFAULT_MIC_OFFSET.handheld : DEFAULT_MIC_OFFSET.bodypack);
  return { dx: base.dx, dy: base.dy, dz: o.dz }; // o.dz is the pack height, already clamped to the validator limits
}

function assign(store, personId, linkId, which, { swap = false } = {}) {
  let ok = false;
  store.update((d) => {
    const list = peopleOf(d), p = list.find((x) => x.id === personId);
    if (!p) return;
    const idKey = which === 'iem' ? 'iemLinkId' : 'micLinkId', offKey = which === 'iem' ? 'iemOffset' : 'micOffset';
    if (linkId === null || linkId === undefined) { delete p[idKey]; delete p[offKey]; ok = true; return; }
    const link = findLink(d, linkId);
    if (!link || link.kind !== (which === 'iem' ? 'iem' : 'mic')) return;
    if (which === 'mic') { // a link that is someone's backup pack: this person's own backup is promoted, another person's needs a swap (the backup goes to the old main owner's list)
      const xo = list.find((x) => Array.isArray(x.extraLinkIds) && x.extraLinkIds.includes(linkId));
      if (xo && xo.id !== personId && !swap) return;
      if (xo) dropExtra(xo, linkId);
    }
    const owner = list.find((x) => x.id !== personId && x[idKey] === linkId);
    if (owner && !swap) return;
    const posOf = (l) => (which === 'iem' ? l.rx.pos : l.tx.pos);
    if (owner) { // swap: the other person receives this person's previous link (or none)
      const prev = p[idKey];
      delete owner[idKey]; delete owner[offKey];
      if (prev) {
        const l2 = findLink(d, prev);
        owner[idKey] = prev;
        if (l2 && owner.pos) owner[offKey] = packOffset(owner, posOf(l2));
        if (l2) l2.name = personLinkName(owner, which);
      }
      applyCoupling(d, owner); // the other person's body coupling goes onto the link they received
    }
    const here = posOf(link);
    const placed = !!p.pos; // a person already on the plan keeps their place: the pack jumps to them. An unplaced person stands where their first pack is.
    if (!placed) p.pos = { x: here.x, y: here.y };
    p[idKey] = linkId;
    p[offKey] = placed ? assignedOffset(p, which, here) : packOffset(p, here);
    if (placed) placePacks(d, p);
    link.name = personLinkName(p, which);
    applyCoupling(d, p);
    ok = true;
  });
  return ok;
}

/** assignMic(store, personId, linkId | null, { swap }) -> true when done. A link already owned by someone else needs { swap: true } (they receive this person's previous link). */
export const assignMic = (store, personId, linkId, o = {}) => assign(store, personId, linkId, 'mic', o);
/** assignIem(store, personId, linkId | null, { swap }): same for the IEM bodypack link. */
export const assignIem = (store, personId, linkId, o = {}) => assign(store, personId, linkId, 'iem', o);

/**
 * assignExtraMic(store, personId, linkId, { swap }) -> true when done: the mic link becomes a backup bodypack of the person (PEOPLE_LIMITS.maxExtra at most),
 * placed where it is now (the offset is stored), named "<Name> mic 2" and so on, and given the person's contact and dampness. A link that is the person's own
 * main or IEM link, or already a backup of the same person, is refused; one owned by another person needs { swap: true } (it is taken from them).
 */
export function assignExtraMic(store, personId, linkId, { swap = false } = {}) {
  let ok = false;
  store.update((d) => {
    const list = peopleOf(d), p = list.find((x) => x.id === personId), link = findLink(d, linkId);
    if (!p || !link || link.kind !== 'mic' || p.micLinkId === linkId) return;
    if ((p.extraLinkIds || []).includes(linkId)) return;
    if ((p.extraLinkIds || []).length >= PEOPLE_LIMITS.maxExtra) return;
    const other = list.find((x) => x.id !== personId && (x.micLinkId === linkId || (x.extraLinkIds || []).includes(linkId)));
    if (other && !swap) return;
    if (other) { if (other.micLinkId === linkId) { delete other.micLinkId; delete other.micOffset; } else dropExtra(other, linkId); }
    const here = link.tx.pos, placed = !!p.pos;
    if (!placed) p.pos = { x: here.x, y: here.y };
    p.extraLinkIds = [...(p.extraLinkIds || []), linkId];
    p.extraOffsets = { ...(p.extraOffsets || {}), [linkId]: placed ? assignedOffset(p, 'mic', here) : packOffset(p, here) };
    if (placed) placePacks(d, p);
    link.name = extraLinkName(p, p.extraLinkIds.length - 1);
    applyCoupling(d, p);
    ok = true;
  });
  return ok;
}

/** removeExtraMic(store, personId, linkId): the link stays in the scene where it is, no longer carried by the person. */
export function removeExtraMic(store, personId, linkId) {
  return store.update((d) => { const p = peopleOf(d).find((x) => x.id === personId); if (p) dropExtra(p, linkId); });
}

/** removePerson(store, id): the links stay where they are. */
export function removePerson(store, id) {
  return store.update((d) => { const i = peopleOf(d).findIndex((x) => x.id === id); if (i >= 0) d.people.splice(i, 1); });
}

/** reorderPerson(store, id, toIndex): list order (the GUI drag handle). */
export function reorderPerson(store, id, toIndex) {
  return store.update((d) => {
    const list = peopleOf(d), i = list.findIndex((x) => x.id === id);
    if (i < 0 || !Number.isInteger(toIndex)) return;
    const [p] = list.splice(i, 1);
    list.splice(Math.max(0, Math.min(list.length, toIndex)), 0, p);
  });
}

/** movePerson(store, id, { x, y }, { coalesce }): the person and both packs move together, offsets kept (packs keep their heights). */
export function movePerson(store, id, pos, o = {}) {
  return store.update((d) => {
    const p = peopleOf(d).find((x) => x.id === id);
    if (!p || !pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
    p.pos = { x: clampCoord(pos.x), y: clampCoord(pos.y) };
    placePacks(d, p);
  }, opts(o));
}

/** movePeople(store, ids, { dx, dy }, { coalesce }): move a group by the same step, every person keeping their own offsets and the group its shape. */
export function movePeople(store, ids, delta, o = {}) {
  return store.update((d) => {
    if (!delta || !Number.isFinite(delta.dx) || !Number.isFinite(delta.dy)) return;
    const set = new Set(ids || []);
    for (const p of peopleOf(d)) {
      if (!set.has(p.id) || !p.pos) continue;
      p.pos = { x: clampCoord(p.pos.x + delta.dx), y: clampCoord(p.pos.y + delta.dy) };
      placePacks(d, p);
    }
  }, opts(o));
}

/** pruneScenePeople(store): after the UI deletes a link, call this to drop the references to it (people never keep a dangling link). */
export function pruneScenePeople(store) {
  return store.update((d) => { if (Array.isArray(d.people)) prunePeople(d); });
}

/** peopleLinkOwners(scene) -> Map linkId -> { personId, which, extra? } (extra: true for a backup mic link) for the GUI dropdown (only unassigned links are offered, the rest need a swap). */
export const peopleLinkOwners = (scene) => linkOwners(scene && scene.people);

/** ensureOwnAntennaB(store, linkId) -> true when antenna B has its own antenna record afterwards (a copy of antenna A is made when it followed A), so per-antenna fields such as tilt can be set. */
export function ensureOwnAntennaB(store, linkId) {
  let ok = false;
  store.update((d) => {
    const l = findLink(d, linkId), b = l && l.rx && l.rx.diversity && l.rx.diversity.antennaB;
    if (!b) return;
    if (!b.antenna) { const { orientation, ...rest } = JSON.parse(JSON.stringify(l.rx.antenna)); b.antenna = rest; }
    ok = true;
  });
  return ok;
}

/** Replace the whole scene with a copy of `scene` (a Compare snapshot): one undo step, the walk is stopped first. Returns true when applied. */
export function restoreScene(store, scene) {
  if (!scene || !Array.isArray(scene.links) || !scene.links.length) return false;
  stopWalk();
  const copy = structuredClone(scene);
  store.update(() => copy);
  return true;
}
