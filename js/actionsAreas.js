// Scene mutations for audience areas, the ceiling, overhead panels, point-to-point settings and antenna design band.
// Same contract as actions.js: store first, everything through store.update, bad numbers ignored, ranges clamped.
import { createAudience, createCeiling, createOverheadPanel, PLATFORM_LIMITS, isSafeId } from './model/scene.js';
import { AUDIENCE_KINDS, AUDIENCE_DENSITY_LIMITS, AUDIENCE_MAX } from './model/audience.js';
import { CEILING_MATERIALS, CEILING_LIMITS } from './model/ceiling.js';
import { ANTENNA_BANDS } from './model/antenna-band.js';
import { antennaOf } from './actions.js';
import { WALL_CONSTRUCTIONS, WALL_NOISE_LIMITS } from './model/ledwall.js';
import { MEASUREMENT_LIMITS, CALIBRATION_FIELDS, WALL_ADJUST_BY_MATERIAL } from './model/measurement-schema.js';
import { importMeasurementsCsv } from './model/measurements.js';
import { TV_BLOCK_LEVEL_LIMITS } from './model/spectrum-map.js';
import { NOISE_CATALOGUE, NOISE_SOURCE_LIMITS, createNoiseSource, engCrewSources } from './model/noise-sources.js';

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
  // A bad value must neither mutate the scene nor commit an undo step: check the value before touching the store.
  const okValue = field === 'kFactor' || field === 'fadeMarginDb' ? fin(value)
    : field === 'groundReflection' ? typeof value === 'boolean'
    : field === 'obstacleDistanceM' ? (value === null || (fin(value) && value > 0))
    : field === 'obstacleHeightM' ? fin(value) : false;
  if (!okValue) return false;
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

// ---- video wall noise and construction (reflector fields) ------------------------------------------------------------------------------------
export const WALL_NOISE_FIELDS = Object.freeze({
  preset: ['off', 'class-b', 'class-a', 'noisy', 'custom'], facing: ['left', 'right'],
});
const clampN = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
/** Set a wall field: 'construction', 'holeSizeMm' (reflector level) or a noise field (preset, levelDbuvmAt10m, tiltDbPerDecade, rearLossDb, heightM, facing). null clears an optional field. */
export function setWallField(store, reflectorId, field, value, o = {}) {
  return store.update((d) => {
    const r = (d.reflectors || []).find((x) => x.id === reflectorId);
    if (!r) return;
    if (field === 'construction') { if (value === null || value === '' || value === 'none') delete r.construction; else if (WALL_CONSTRUCTIONS[value]) r.construction = value; return; }
    if (field === 'holeSizeMm') { if (value === null) delete r.holeSizeMm; else if (Number.isFinite(value)) r.holeSizeMm = Math.min(2000, Math.max(0.01, value)); return; }
    if (!r.noise) r.noise = { preset: 'off' };
    const n = r.noise;
    if (field === 'preset') { if (WALL_NOISE_FIELDS.preset.includes(value)) { n.preset = value; if (value === 'custom') { if (!Number.isFinite(n.levelDbuvmAt10m)) n.levelDbuvmAt10m = 40; if (!Number.isFinite(n.tiltDbPerDecade)) n.tiltDbPerDecade = 0; } } return; }
    if (field === 'facing') { if (WALL_NOISE_FIELDS.facing.includes(value)) n.facing = value; return; }
    if (field === 'rearLossDb' && value === null) { delete n.rearLossDb; return; }
    const lim = { levelDbuvmAt10m: WALL_NOISE_LIMITS.levelDbuvmAt10m, tiltDbPerDecade: WALL_NOISE_LIMITS.tiltDbPerDecade, rearLossDb: WALL_NOISE_LIMITS.rearLossDb, heightM: WALL_NOISE_LIMITS.heightM }[field];
    if (lim && Number.isFinite(value)) n[field] = clampN(value, lim);
  }, o && o.coalesce ? { coalesce: o.coalesce } : {});
}

// ---- even-order intermodulation (imd-even.js): scene.imd.iip2Dbm, iip4Dbm, bands, filterBefore, filterAfter and per-transmitter harmonics ---------------------
export const EVEN_LIMITS = Object.freeze({ iip: [-100, 200], filterRejectionDb: [0, 200], harmonicDb: [0, 200], bands: 16, mhz: [1, 100000] });
const imdIn = (d) => (d.imd && d.imd.enabled !== undefined ? d.imd : null);
/** Set iip2Dbm / iip4Dbm (null removes: the model default applies). Bad numbers are ignored, values clamped. */
export function setImdIntercept(store, field, value, o = {}) {
  if (field !== 'iip2Dbm' && field !== 'iip4Dbm') return false;
  return store.update((d) => {
    const m = imdIn(d); if (!m) return;
    if (value === null) delete m[field]; else if (fin(value)) m[field] = clampTo(value, EVEN_LIMITS.iip);
  }, opts(o));
}
/** Pre or post filter: which = 'filterBefore' | 'filterAfter'. patch = { passLoMHz, passHiMHz, rejectionDb } merged into the filter; null removes it. */
export function setImdFilter(store, which, patch, o = {}) {
  if (which !== 'filterBefore' && which !== 'filterAfter') return false;
  return store.update((d) => {
    const m = imdIn(d); if (!m) return;
    if (patch === null) { delete m[which]; return; }
    if (typeof patch !== 'object' || patch === undefined) return;
    const f = m[which] || { passLoMHz: 470, passHiMHz: 608, rejectionDb: 40 };
    if (fin(patch.passLoMHz)) f.passLoMHz = clampTo(patch.passLoMHz, EVEN_LIMITS.mhz);
    if (fin(patch.passHiMHz)) f.passHiMHz = clampTo(patch.passHiMHz, EVEN_LIMITS.mhz);
    if (fin(patch.rejectionDb)) f.rejectionDb = clampTo(patch.rejectionDb, EVEN_LIMITS.filterRejectionDb);
    if (!(f.passHiMHz > f.passLoMHz)) f.passHiMHz = Math.min(EVEN_LIMITS.mhz[1], f.passLoMHz + 1);
    m[which] = f;
  }, opts(o));
}
/** Other bands the system uses: { name, loMHz, hiMHz } (at most 16). */
export function addImdBand(store, band = {}) {
  let ok = false;
  store.update((d) => {
    const m = imdIn(d); if (!m) return;
    m.bands = Array.isArray(m.bands) ? m.bands : [];
    if (m.bands.length >= EVEN_LIMITS.bands) return;
    const lo = fin(band.loMHz) ? clampTo(band.loMHz, EVEN_LIMITS.mhz) : 1785, hi = fin(band.hiMHz) && band.hiMHz > lo ? clampTo(band.hiMHz, EVEN_LIMITS.mhz) : lo + 20;
    m.bands.push({ name: typeof band.name === 'string' && band.name ? band.name.slice(0, 80) : 'Other band', loMHz: lo, hiMHz: hi }); ok = true;
  });
  return ok;
}
export function updateImdBand(store, index, patch = {}, o = {}) {
  return store.update((d) => {
    const m = imdIn(d), b = m && Array.isArray(m.bands) ? m.bands[index] : null; if (!b) return;
    if (typeof patch.name === 'string' && patch.name) b.name = patch.name.slice(0, 80); // the same cap as addImdBand
    if (fin(patch.loMHz)) b.loMHz = clampTo(patch.loMHz, EVEN_LIMITS.mhz);
    if (fin(patch.hiMHz)) b.hiMHz = clampTo(patch.hiMHz, EVEN_LIMITS.mhz);
    if (!(b.hiMHz > b.loMHz)) b.hiMHz = Math.min(EVEN_LIMITS.mhz[1], b.loMHz + 1);
  }, opts(o));
}
export function removeImdBand(store, index) {
  return store.update((d) => { const m = imdIn(d); if (m && Array.isArray(m.bands) && m.bands[index]) { m.bands.splice(index, 1); if (!m.bands.length) delete m.bands; } });
}
/** Per-transmitter second harmonic: h2Dbc (dB below the carrier) and harmonicFilterDb (null removes). */
export function setImdHarmonic(store, txId, patch = {}, o = {}) {
  return store.update((d) => {
    const m = imdIn(d), t = m && (m.transmitters || []).find((x) => x.id === txId); if (!t) return;
    for (const k of ['h2Dbc', 'harmonicFilterDb']) { if (patch[k] === null) delete t[k]; else if (fin(patch[k])) t[k] = clampTo(patch[k], EVEN_LIMITS.harmonicDb); }
  }, opts(o));
}

// ---- noise sources (items 34 / 34a) --------------------------------------------------------------------------------------------

const NS_NUM_LIMITS = {
  fieldDbuvmAt10m: NOISE_SOURCE_LIMITS.fieldDbuvm, tiltDbPerDecade: NOISE_SOURCE_LIMITS.tiltDbPerDecade, freqMHz: NOISE_SOURCE_LIMITS.bandMHz, erpDbm: NOISE_SOURCE_LIMITS.erpDbm,
  bwKHz: NOISE_SOURCE_LIMITS.bwKHz, dutyCycle: NOISE_SOURCE_LIMITS.dutyCycle, pulseWidthMs: NOISE_SOURCE_LIMITS.pulseWidthMs, repHz: NOISE_SOURCE_LIMITS.repHz,
  onS: NOISE_SOURCE_LIMITS.timeS, holdS: NOISE_SOURCE_LIMITS.timeS, bandMinMHz: NOISE_SOURCE_LIMITS.bandMHz, bandMaxMHz: NOISE_SOURCE_LIMITS.bandMHz,
};

/** addNoiseSource(store, kind, overrides) -> id, or null at the cap or for an unknown kind. */
export function addNoiseSource(store, kind, overrides = {}) {
  if (!NOISE_CATALOGUE[kind]) return null;
  let id = null;
  store.update((d) => {
    if (!Array.isArray(d.noiseSources)) d.noiseSources = [];
    if (d.noiseSources.length >= NOISE_SOURCE_LIMITS.max) return;
    const n = d.noiseSources.length;
    const src = createNoiseSource(kind, { pos: { x: 2 + (n % 5), y: 2 + Math.floor(n / 5), z: 1.5 } });
    // overrides go through the same checks as updateNoiseSource (clamped numbers, cleaned name, bounded position); unknown keys are dropped
    if (overrides && typeof overrides === 'object') {
      if (typeof overrides.id === 'string' && /^[\w-]{1,64}$/.test(overrides.id) && !d.noiseSources.some((x) => x.id === overrides.id)) src.id = overrides.id;
      if (typeof overrides.enabled === 'boolean') src.enabled = overrides.enabled;
      applyNoisePatch(src, overrides);
    }
    d.noiseSources.push(src); id = src.id;
  });
  return id;
}

/** addEngCrew(store, centre) -> ids of the five sources (fewer when the cap is reached). Each source is separately editable. */
export function addEngCrew(store, centre = { x: 5, y: -3, z: 0 }) {
  const ids = [];
  store.update((d) => {
    if (!Array.isArray(d.noiseSources)) d.noiseSources = [];
    for (const s of engCrewSources(centre)) { if (d.noiseSources.length >= NOISE_SOURCE_LIMITS.max) break; d.noiseSources.push(s); ids.push(s.id); }
  });
  return ids;
}

/** addWallNoiseSource(store, reflectorId) -> id of the linked video-wall source (existing one if present). */
export function addWallNoiseSource(store, reflectorId) {
  let id = null;
  store.update((d) => {
    const r = (d.reflectors || []).find((x) => x.id === reflectorId);
    if (!r || !r.p1 || !r.p2) return;
    if (!Array.isArray(d.noiseSources)) d.noiseSources = [];
    const have = d.noiseSources.find((n) => n.reflectorId === reflectorId);
    if (have) { id = have.id; return; }
    if (d.noiseSources.length >= NOISE_SOURCE_LIMITS.max) return;
    const z0 = fin(r.zMin) ? r.zMin : 0, z1 = fin(r.zMax) ? r.zMax : 3;
    const src = createNoiseSource('video-wall', { id: `ns-${r.id}`.slice(0, 64), name: r.name ? `${r.name} (video wall)` : 'Video wall', reflectorId: r.id, pos: { x: (r.p1.x + r.p2.x) / 2, y: (r.p1.y + r.p2.y) / 2, z: z0 + (z1 - z0) / 2 } });
    d.noiseSources.push(src); id = src.id;
  });
  return id;
}

/**
 * updateNoiseSource(store, id, patch, { coalesce }): patch keys name, enabled, kind (resets the figures to that kind's defaults, keeps name, position, enabled),
 * pos {x, y, z}, and the numeric figures in NS_NUM_LIMITS (clamped). Unknown keys and bad numbers are ignored.
 */
export function updateNoiseSource(store, id, patch = {}, o = {}) {
  return store.update((d) => {
    const s = (d.noiseSources || []).find((x) => x.id === id);
    if (!s) return;
    if (typeof patch.enabled === 'boolean') s.enabled = patch.enabled;
    if (typeof patch.kind === 'string' && NOISE_CATALOGUE[patch.kind] && patch.kind !== s.kind && !s.reflectorId) {
      const fresh = createNoiseSource(patch.kind);
      for (const k of Object.keys(s)) if (!['id', 'name', 'enabled', 'pos'].includes(k)) delete s[k];
      Object.assign(s, { kind: patch.kind }, Object.fromEntries(Object.entries(fresh).filter(([k]) => !['id', 'name', 'enabled', 'pos', 'kind'].includes(k))));
      if (/^[A-Z]/.test(s.name) && Object.values(NOISE_CATALOGUE).some((c) => c.label === s.name)) s.name = NOISE_CATALOGUE[patch.kind].label;
    }
    applyNoisePatch(s, patch);
  }, opts(o));
}

/** The name, position and numeric parts of a noise-source patch, shared by updateNoiseSource and addNoiseSource (clamped, cleaned, unknown keys ignored). */
function applyNoisePatch(s, patch) {
  if (typeof patch.name === 'string') s.name = patch.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80) || s.name;
  if (patch.pos && typeof patch.pos === 'object') {
    if (!s.pos) s.pos = { x: 0, y: 0, z: 1.5 };
    for (const k of ['x', 'y']) if (fin(patch.pos[k])) s.pos[k] = clampTo(round2(patch.pos[k]), NOISE_SOURCE_LIMITS.coord);
    if (fin(patch.pos.z)) s.pos.z = clampTo(round2(patch.pos.z), NOISE_SOURCE_LIMITS.zM);
  }
  for (const [k, lim] of Object.entries(NS_NUM_LIMITS)) if (fin(patch[k])) s[k] = clampTo(patch[k], lim);
}

/** setReflectorName(store, id, name, { coalesce }): rename a reflector by id with the same cleaning as the other names (control characters stripped, 80 characters). The inspector field should call this instead of nameInput.renameReflector (40 characters, no control-character strip). */
export const REFLECTOR_NAME_MAX = 80;
export function setReflectorName(store, id, name, o = {}) {
  const clean = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, REFLECTOR_NAME_MAX);
  return store.update((d) => { const r = (d.reflectors || []).find((x) => x.id === id); if (r) r.name = clean; }, opts(o));
}

/** moveNoiseSource(store, id, { x, y }, { coalesce }). */
export function moveNoiseSource(store, id, pos, o = {}) { return updateNoiseSource(store, id, { pos }, o); }

/** removeNoiseSource(store, id): a linked video-wall source is muted rather than removed (its wall block stays), so the wall noise stops. */
export function removeNoiseSource(store, id) {
  return store.update((d) => {
    const i = (d.noiseSources || []).findIndex((x) => x.id === id);
    if (i < 0) return;
    const s = d.noiseSources[i];
    if (s.reflectorId) { s.enabled = false; return; }
    d.noiseSources.splice(i, 1);
  });
}

// ---- spectrum map ---------------------------------------------------------------------------------------------------

/**
 * setTvBlockLevel(store, channel, dbm): the user's own in-block TV level (dBm at the receiver) for one TV channel, scene.tvBlockLevelsDbm[channel].
 * channel must be an integer 2..69 (a numeric string of one is accepted) else nothing happens and false is returned. A finite dbm is clamped to -120..-10.
 * null, undefined, NaN or anything non-numeric removes that channel (back to the assumed level) and removes the whole map when it becomes empty.
 * A new channel beyond the 70-entry cap is refused (false). One undo step. Returns true when the call was applied.
 */
export function setTvBlockLevel(store, channel, dbm) {
  const L = TV_BLOCK_LEVEL_LIMITS, n = typeof channel === 'string' && /^\d+$/.test(channel) ? Number(channel) : channel;
  if (!Number.isInteger(n) || n < L.channel[0] || n > L.channel[1]) return false;
  const key = String(n), remove = !(typeof dbm === 'number' && fin(dbm));
  const cur = store.getScene().tvBlockLevelsDbm;
  const map = cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : null;
  if (remove && !(map && key in map)) return false;
  if (!remove && map && key in map && map[key] === clampTo(dbm, L.dbm)) return false; // unchanged: no undo step
  if (!remove && !(map && key in map) && map && Object.keys(map).length >= L.maxEntries) return false;
  store.update((d) => {
    if (remove) { delete d.tvBlockLevelsDbm[key]; if (Object.keys(d.tvBlockLevelsDbm).length === 0) delete d.tvBlockLevelsDbm; return; }
    if (!d.tvBlockLevelsDbm || typeof d.tvBlockLevelsDbm !== 'object' || Array.isArray(d.tvBlockLevelsDbm)) d.tvBlockLevelsDbm = {};
    d.tvBlockLevelsDbm[key] = clampTo(dbm, L.dbm);
  });
  return true;
}

/** clearTvBlockLevels(store): removes every user-entered TV block level (back to the assumed levels) in one undo step. Returns false when there were none. */
export function clearTvBlockLevels(store) {
  if (store.getScene().tvBlockLevelsDbm === undefined) return false; // nothing set: no undo step
  store.update((d) => { delete d.tvBlockLevelsDbm; });
  return true;
}

/** setTvChannelWidth(store, mhz): the global TV channel raster, 8 (Europe, UK, Australia; default) or 6 (North America). Anything else is ignored. */
export function setTvChannelWidth(store, mhz) {
  if (mhz !== 6 && mhz !== 8) return false;
  store.update((d) => { d.tvChannelWidthMHz = mhz; });
  return true;
}

// ---- coordination lab ---------------------------------------------------------------------------------------------------

/**
 * applyFrequencyPlan(store, assignments): assignments = [{ id, freqMHz }] for links and Intermod transmitters (matched by id). One undoable update.
 * Unknown ids and non-positive or non-finite frequencies are ignored. Returns the number of frequencies written.
 */
export function applyFrequencyPlan(store, assignments) {
  const list = (Array.isArray(assignments) ? assignments : []).filter((a) => a && typeof a.id === 'string' && Number.isFinite(a.freqMHz) && a.freqMHz > 0 && a.freqMHz < 100000);
  let n = 0;
  if (!list.length) return 0;
  store.update((d) => {
    for (const a of list) {
      const t = (d.links || []).find((l) => l.id === a.id) || ((d.imd && d.imd.transmitters) || []).find((x) => x.id === a.id);
      if (t) { t.freqMHz = Math.round(a.freqMHz * 1e6) / 1e6; n++; }
    }
  });
  return n;
}

// ---- walk-test measurements (measurements.js) ---------------------------------------------------------------------------------

let measSeq = 0;
const newMeasId = () => `m${Date.now().toString(36)}${(measSeq++).toString(36)}`;
const cleanNote = (v) => String(v).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MEASUREMENT_LIMITS.noteChars);

// A checked measurement from loose input, or null: finite x, y and level, clamped to the limits; linkId falls back to the first link.
function makeMeasurement(d, m) {
  const L = MEASUREMENT_LIMITS;
  if (!m || !fin(m.x) || !fin(m.y) || !fin(m.rxDbm)) return null;
  const links = d.links || [];
  const linkId = typeof m.linkId === 'string' && links.some((l) => l.id === m.linkId) ? m.linkId : (links[0] && links[0].id);
  if (!linkId) return null;
  const out = { id: newMeasId(), linkId, x: clampTo(round2(m.x), [-L.coordM, L.coordM]), y: clampTo(round2(m.y), [-L.coordM, L.coordM]), rxDbm: clampTo(round2(m.rxDbm), L.dbm) };
  if (fin(m.z)) out.z = clampTo(round2(m.z), L.zM);
  if (typeof m.note === 'string' && m.note) out.note = cleanNote(m.note);
  if (fin(m.t)) out.t = m.t;
  return out;
}

/** addMeasurement(store, { linkId?, x, y, z?, rxDbm, note?, t? }) -> id, or null for a bad reading, an unknown link with no link to fall back on, or the 200-point cap. */
export function addMeasurement(store, m) {
  let id = null;
  store.update((d) => {
    if (!Array.isArray(d.measurements)) d.measurements = [];
    if (d.measurements.length >= MEASUREMENT_LIMITS.max) { if (!d.measurements.length) delete d.measurements; return; }
    const made = makeMeasurement(d, m);
    if (!made) { if (!d.measurements.length) delete d.measurements; return; }
    d.measurements.push(made); id = made.id;
  });
  return id;
}

/** updateMeasurement(store, id, patch, { coalesce }): patch keys x, y, z (null removes), rxDbm, note, linkId (an existing link); bad values are ignored. */
export function updateMeasurement(store, id, patch = {}, o = {}) {
  return store.update((d) => {
    const m = (d.measurements || []).find((x) => x.id === id);
    if (!m || !patch) return;
    const L = MEASUREMENT_LIMITS;
    if (fin(patch.x)) m.x = clampTo(round2(patch.x), [-L.coordM, L.coordM]);
    if (fin(patch.y)) m.y = clampTo(round2(patch.y), [-L.coordM, L.coordM]);
    if (patch.z === null) delete m.z; else if (fin(patch.z)) m.z = clampTo(round2(patch.z), L.zM);
    if (fin(patch.rxDbm)) m.rxDbm = clampTo(round2(patch.rxDbm), L.dbm);
    if (typeof patch.note === 'string') { const n = cleanNote(patch.note); if (n) m.note = n; else delete m.note; }
    if (typeof patch.linkId === 'string' && (d.links || []).some((l) => l.id === patch.linkId)) m.linkId = patch.linkId;
  }, opts(o));
}

/** removeMeasurement(store, id). */
export function removeMeasurement(store, id) {
  return store.update((d) => {
    const i = (d.measurements || []).findIndex((x) => x.id === id);
    if (i < 0) return;
    d.measurements.splice(i, 1);
    if (!d.measurements.length) delete d.measurements;
  });
}

/** clearMeasurements(store): removes every reading. */
export function clearMeasurements(store) { return store.update((d) => { delete d.measurements; }); }

/**
 * importMeasurements(store, csvText, { linkId, replace = false }) -> { added, errors }. Parses with importMeasurementsCsv; readings with no link of their own go to
 * `linkId` (default the first link); a link column cell is matched against link ids, then link names (case-insensitive), an unknown one skips the row with an error naming the file line; `replace` clears the existing readings first. One undo step. Rows past the 200-point cap are dropped with an error.
 */
export function importMeasurements(store, text, { linkId, replace = false } = {}) {
  const parsed = importMeasurementsCsv(text);
  const errors = [...parsed.errors];
  if (!parsed.points.length) return { added: 0, errors }; // nothing parsed: never touch the store (replace would otherwise wipe the existing readings)
  const links = store.getScene().links || [];
  const byId = new Map(links.map((l) => [l.id, l]));
  const byName = new Map(); // a name is used only when it is unambiguous
  for (const l of links) { const k = String(l.name || '').trim().toLowerCase(); if (k) byName.set(k, byName.has(k) ? null : l); }
  const resolve = (cell) => byId.get(cell) || byName.get(String(cell).trim().toLowerCase()) || null;
  const fallback = (typeof linkId === 'string' && byId.get(linkId)) || links[0] || null;
  const ready = [];
  parsed.points.forEach((p, k) => {
    const lineNo = (parsed.lines && parsed.lines[k]) || k + 1;
    let target = fallback;
    if (p.linkId) {
      target = resolve(p.linkId);
      if (!target) { errors.push(`Line ${lineNo}: unknown link "${p.linkId}" (not a link id or name); row skipped.`); return; }
    }
    if (!target) { errors.push(`Line ${lineNo}: no link to attach the reading to; row skipped.`); return; }
    ready.push({ ...p, linkId: target.id });
  });
  if (!ready.length) return { added: 0, errors }; // every row was refused: leave the existing readings alone
  let added = 0;
  store.update((d) => {
    const list = replace ? [] : (Array.isArray(d.measurements) ? d.measurements : []);
    for (const p of ready) {
      if (list.length >= MEASUREMENT_LIMITS.max) { errors.push(`At most ${MEASUREMENT_LIMITS.max} readings are kept; the rest were dropped.`); break; }
      const made = makeMeasurement(d, p);
      if (!made) { errors.push('A reading was skipped: no link to attach it to.'); continue; }
      list.push(made); added++;
    }
    if (list.length) d.measurements = list; else delete d.measurements;
  });
  return { added, errors };
}

/**
 * applyCalibration(store, suggestion) -> true when a value was written. suggestion = the result of suggestCalibration (its `best` is used) or one of its candidates
 * { field, fitted }. Writes environment.bodyLossDb, xpdDb or wallLossAdjustDb, clamped to its limits, in one undo step. Any other field is refused.
 */
export function applyCalibration(store, suggestion) {
  const c = suggestion && suggestion.field ? suggestion : suggestion && suggestion.best;
  if (c && c.field === 'environment.wallLossAdjustByMaterialDb' && c.applicable !== false && c.fitted && typeof c.fitted === 'object') { // per-material figures: { material: dB }, each clamped
    const W = WALL_ADJUST_BY_MATERIAL, entries = Object.entries(c.fitted).filter(([k, v]) => isSafeId(k) && fin(v)).slice(0, W.maxMaterials);
    if (!entries.length) return false;
    return store.update((d) => { d.environment = d.environment || {}; d.environment.wallLossAdjustByMaterialDb = Object.fromEntries(entries.map(([k, v]) => [k, round2(Math.min(W.max, Math.max(W.min, v)))])); });
  }
  if (!c || typeof c.field !== 'string' || !Object.prototype.hasOwnProperty.call(CALIBRATION_FIELDS, c.field) || !fin(c.fitted) || c.applicable === false) return false;
  const lim = CALIBRATION_FIELDS[c.field], key = c.field.split('.')[1];
  return store.update((d) => { d.environment = d.environment || {}; d.environment[key] = round2(Math.min(lim.max, Math.max(lim.min, c.fitted))); });
}
