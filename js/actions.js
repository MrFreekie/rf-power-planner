// Scene mutations. Every action takes the store first and goes through store.update,
// so undo/redo and subscribers behave uniformly. Pure of the DOM.
import { buildExample } from './examples.js';
import { IMD_PRESETS, COMBINER_PRESETS } from './model/imd-params.js';
import { startWalk, stopWalk } from './walk.js';
import { effectiveAntennaB } from './model/diversity.js';
import { createDefaultScene, createDefaultLink, createChainItem, createReflector, createBranch, createZone, createPlatform, STAGE_LIMITS, PLATFORM_LIMITS, PLATFORM_MATERIALS, createImdTransmitter, defaultImdTransmitters, newId, SCENE_LIMITS } from './model/scene.js';
import { applyFmPreset } from './model/fm-presets.js';
import { validateVenue } from './model/venue-underlay.js';
import { SURFACES } from './model/library.js';

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
  if (kind !== 'mic' && kind !== 'iem') return false;
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
