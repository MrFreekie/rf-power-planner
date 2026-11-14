// Scene mutations for audience areas, the ceiling, overhead panels, point-to-point settings and antenna design band.
// Same contract as actions.js: store first, everything through store.update, bad numbers ignored, ranges clamped.
import { createAudience, createCeiling, createOverheadPanel, PLATFORM_LIMITS } from './model/scene.js';
import { AUDIENCE_KINDS, AUDIENCE_DENSITY_LIMITS, AUDIENCE_MAX } from './model/audience.js';
import { CEILING_MATERIALS, CEILING_LIMITS } from './model/ceiling.js';
import { ANTENNA_BANDS } from './model/antenna-band.js';
import { antennaOf } from './actions.js';

const fin = Number.isFinite;
const clampTo = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const opts = (o) => (o && o.coalesce ? { coalesce: o.coalesce } : {});
const round2 = (v) => Math.round(v * 100) / 100;

// ---- audience -------------------------------------------------------------------------------------------------------

/** Density options for the dropdown plus 'custom'. Pure. */
export function densityChoiceId(presets, d) {
  const hit = presets.find((p) => Math.abs(p.densityPerM2 - d) < 1e-9 && p.id !== 'seated');
  return hit ? hit.id : 'custom';
}

/** addAudience(store, partial) -> id, null at the 30-area limit. Default 6 x 4 m standing crowd at 2 persons per m2. */
export function addAudience(store, partial = {}) {
  let id = null;
  store.update((d) => {
    if (!Array.isArray(d.audience)) d.audience = [];
    if (d.audience.length >= AUDIENCE_MAX) return;
    const a = createAudience({ name: `Audience ${d.audience.length + 1}`, x: 0, y: -6 - 1 * d.audience.length });
    applyAudience(a, partial);
    d.audience.push(a); id = a.id;
  });
  return id;
}

function applyAudience(a, p) {
  if (typeof p.name === 'string') a.name = p.name.slice(0, 80);
  for (const k of ['x', 'y']) if (fin(p[k])) a[k] = round2(clampTo(p[k], PLATFORM_LIMITS.coord));
  for (const k of ['width', 'depth']) if (fin(p[k])) a[k] = round2(clampTo(p[k], PLATFORM_LIMITS.size));
  if (AUDIENCE_KINDS.includes(p.kind)) a.kind = p.kind;
  if (fin(p.densityPerM2)) a.densityPerM2 = Math.round(clampTo(p.densityPerM2, AUDIENCE_DENSITY_LIMITS) * 100) / 100;
}

/** updateAudience(store, id, { name?, x?, y?, width?, depth?, kind?, densityPerM2? }, { coalesce }). Returns true when found. */
export function updateAudience(store, id, patch = {}, o = {}) {
  let found = false;
  store.update((d) => { const a = (d.audience || []).find((q) => q.id === id); if (!a) return; found = true; applyAudience(a, patch); }, opts(o));
  return found;
}
export function removeAudience(store, id) {
  return store.update((d) => { if (Array.isArray(d.audience)) d.audience = d.audience.filter((a) => a.id !== id); });
}

// ---- ceiling and overhead panels ------------------------------------------------------------------------------------

/** setCeiling(store, patch | null): null removes it. patch = { enabled?, heightM?, material?, lossDb? } (created when absent). */
export function setCeiling(store, patch, o = {}) {
  return store.update((d) => {
    if (patch === null) { delete d.ceiling; return; }
    if (!patch || typeof patch !== 'object') return;
    if (!d.ceiling) d.ceiling = createCeiling({ enabled: patch.enabled !== false });
    const c = d.ceiling;
    if (typeof patch.enabled === 'boolean') c.enabled = patch.enabled;
    if (fin(patch.heightM)) c.heightM = round2(clampTo(patch.heightM, CEILING_LIMITS.heightM));
    if (typeof patch.material === 'string' && CEILING_MATERIALS[patch.material]) c.material = patch.material;
    if (fin(patch.lossDb)) { if (patch.lossDb <= 0) delete c.lossDb; else c.lossDb = clampTo(patch.lossDb, CEILING_LIMITS.lossDb); }
  }, opts(o));
}

function applyPanel(p, patch) {
  if (typeof patch.name === 'string') p.name = patch.name.slice(0, 80);
  for (const k of ['x', 'y']) if (fin(patch[k])) p[k] = round2(clampTo(patch[k], CEILING_LIMITS.coord));
  for (const k of ['width', 'depth']) if (fin(patch[k])) p[k] = round2(clampTo(patch[k], CEILING_LIMITS.size));
  if (fin(patch.heightM)) p.heightM = round2(clampTo(patch.heightM, CEILING_LIMITS.heightM));
  if (typeof patch.material === 'string' && CEILING_MATERIALS[patch.material]) p.material = patch.material;
  if (fin(patch.lossDb)) p.lossDb = clampTo(patch.lossDb, CEILING_LIMITS.lossDb);
}

/** addOverheadPanel(store, partial) -> id, null at the limit. */
export function addOverheadPanel(store, partial = {}) {
  let id = null;
  store.update((d) => {
    if (!Array.isArray(d.overheadPanels)) d.overheadPanels = [];
    if (d.overheadPanels.length >= CEILING_LIMITS.panelsMax) return;
    const p = createOverheadPanel({ name: `Overhead panel ${d.overheadPanels.length + 1}`, x: 2 * d.overheadPanels.length, y: 0 });
    applyPanel(p, partial);
    d.overheadPanels.push(p); id = p.id;
  });
  return id;
}
export function updateOverheadPanel(store, id, patch = {}, o = {}) {
  let found = false;
  store.update((d) => { const p = (d.overheadPanels || []).find((q) => q.id === id); if (!p) return; found = true; applyPanel(p, patch); }, opts(o));
  return found;
}
export function removeOverheadPanel(store, id) {
  return store.update((d) => { if (Array.isArray(d.overheadPanels)) d.overheadPanels = d.overheadPanels.filter((p) => p.id !== id); });
}

// ---- point to point -------------------------------------------------------------------------------------------------

export const P2P_FIELDS = Object.freeze({ kFactor: [0.5, 10], fadeMarginDb: [0, 60] });

/**
 * setP2pField(store, linkId, field, value, { coalesce }): field 'kFactor' | 'fadeMarginDb' (clamped), 'groundReflection' (boolean),
 * 'obstacleDistanceM' (> 0 m) | 'obstacleHeightM' (-100..zMax). A null obstacle distance removes the obstacle.
 */
export function setP2pField(store, linkId, field, value, o = {}) {
  let changed = false;
  store.update((d) => {
    const l = d.links.find((x) => x.id === linkId);
    if (!l || l.kind !== 'p2p') return;
    if (!l.p2p) l.p2p = {};
    const q = l.p2p;
    if (field === 'kFactor' || field === 'fadeMarginDb') { if (!fin(value)) return; q[field] = clampTo(value, P2P_FIELDS[field]); changed = true; return; }
    if (field === 'groundReflection') { if (typeof value !== 'boolean') return; q.groundReflection = value; changed = true; return; }
    if (field === 'obstacleDistanceM') {
      if (value === null) { delete q.obstacle; changed = true; return; }
      if (!fin(value) || value <= 0) return;
      q.obstacle = { distanceM: Math.min(value, 40000), heightM: q.obstacle ? q.obstacle.heightM : 10 }; changed = true; return;
    }
    if (field === 'obstacleHeightM') {
      if (!fin(value)) return;
      q.obstacle = { distanceM: q.obstacle ? q.obstacle.distanceM : 100, heightM: clampTo(value, [-100, 5000]) }; changed = true;
    }
  }, opts(o));
  return changed;
}

// ---- antenna design band --------------------------------------------------------------------------------------------

/** setAntennaDesignBand(store, linkId, target, band): band = ANTENNA_BANDS id, { loMHz, hiMHz, order?, minVswr?, label? } or null (removes it). */
export function setAntennaDesignBand(store, linkId, target, band, o = {}) {
  let changed = false;
  store.update((d) => {
    const a = antennaOf(d.links.find((x) => x.id === linkId), target);
    if (!a) return;
    if (band === null || band === undefined || band === '') { if ('designBand' in a) { delete a.designBand; changed = true; } return; }
    if (typeof band === 'string') { if (!Object.prototype.hasOwnProperty.call(ANTENNA_BANDS, band)) return; a.designBand = band; changed = true; return; }
    if (band && fin(band.loMHz) && fin(band.hiMHz) && band.loMHz > 0 && band.hiMHz > band.loMHz && band.hiMHz < 100000) {
      const b = { loMHz: band.loMHz, hiMHz: band.hiMHz };
      if (band.order === 1 || band.order === 3) b.order = band.order;
      if (fin(band.minVswr) && band.minVswr >= 1) b.minVswr = band.minVswr;
      if (typeof band.label === 'string') b.label = band.label.slice(0, 80);
      a.designBand = b; changed = true;
    }
  }, opts(o));
  return changed;
}
