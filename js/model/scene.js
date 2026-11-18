// Scene schema: defaults, validation, (de)serialisation, ids. Pure module (no DOM).

export const SCHEMA_VERSION = 2; // 2: optional scene.venue (underlay). Version 1 files open with no venue; older apps refuse version 2.

const POWER_UNITS = ['dBm', 'dBW', 'mW'];
const LENGTH_UNITS = ['m', 'ft'];
const MODELS = ['two-ray', 'free-space'];
const POLARISATIONS = ['vertical', 'horizontal'];
const LINK_KINDS = ['mic', 'iem', 'p2p'];
const ANTENNA_TYPES = ['dipole', 'quarterwave', 'paddle', 'helical', 'cardioid', 'omni', 'logperiodic', 'body', 'helical-cp', 'yagi', 'custom'];
const AUDIO_SOURCES = ['speech', 'tone', 'pink', 'stereo-demo', 'off', ...AUDIO_SOURCE_IDS.filter((id) => !['tone', 'pink'].includes(id))]; // legacy meter names plus the global catalogue ids
export const RX_PRESET_IDS = Object.keys(RX_PRESETS); // includes the analogue FM equipment presets (fm-presets.js)
export const DIVERSITY_MODES = ['switching', 'true', 'ratio'];
export const defaultRxPreset = (kind) => (kind === 'iem' ? 'iem-bodypack-typical' : 'mic-receiver-typical');
/**
 * Default second antenna: 0.6 m (about one UHF wavelength) to the stage-left of antenna A.
 * `antenna: null` means "same as antenna A" (it follows any change made to A); an object overrides it.
 */
export const defaultDiversity = (pos, _antennaA) => ({
  enabled: false, mode: 'switching',
  antennaB: { pos: { x: Math.round((pos.x - 0.6) * 1000) / 1000, y: pos.y, z: pos.z }, antenna: null, chain: null, orientation: null },
  hysteresisDb: 3, switchMs: 30,
});
import { AUDIO_SOURCE_IDS, TONE_HZ_LIMITS } from './audio-source.js';
import { validateVenue, packUnderlay, unpackUnderlay } from './venue-underlay.js';
import { MATERIAL_TRANSMISSION } from './zones-params.js';
import { EXTRA_CHAIN_KINDS, CHAIN_PRESETS, DC_MODES, FILTER_TYPES } from './chain-presets.js';
import { allowedPolarisations, isCircularType, defaultPolarisation, SURFACES, MATERIALS, GROUND_PLANE_GAIN_DBI, ANTENNA_POLARISATIONS, ANTENNA_CONTACT_LOSS_DB, ANTENNA_DAMPNESS_LOSS_DB } from './library.js';
import { EXTERNAL_NOISE_FIGURE_600MHZ_DB, INTERFERENCE_LEVELS, RX_PRESETS } from './rx-params.js';
import { FM_TX_PRESET_IDS } from './fm-presets.js';
import { CEILING_MATERIALS, CEILING_LIMITS } from './ceiling.js';
import { WALL_NOISE_PRESETS, WALL_NOISE_LIMITS, WALL_CONSTRUCTIONS } from './ledwall.js';
import { validatePerson, prunePeople, PEOPLE_LIMITS, linkOwners } from './people.js';
import { validateNoiseSource, wallNoiseSourcesFromReflectors, NOISE_SOURCE_LIMITS } from './noise-sources.js';
import { AUDIENCE_KINDS, AUDIENCE_DENSITY_LIMITS, AUDIENCE_MAX } from './audience.js';
import { CROWD_MODES, CROWD_LIMITS } from './crowd.js';
import { ANTENNA_BANDS } from './antenna-band.js';
import { TV_BLOCK_LEVEL_LIMITS } from './spectrum-map.js';
import { compileRack, validateRack } from './rack.js';
import { validateLocks } from './lock.js';
import { MEASUREMENT_LIMITS, validateMeasurement, CALIBRATION_FIELDS, WALL_ADJUST_BY_MATERIAL } from './measurement-schema.js';

// Stage and platform limits. Item pos.z everywhere stays the height above the LOCAL floor (deck or platform top).
export const STAGE_LIMITS = Object.freeze({ size: [0.5, 500], heightM: [0, 20] });
export const PLATFORM_LIMITS = Object.freeze({ max: 50, size: [0.1, 500], coord: [-500, 1000], topM: [0.05, 30], rotationDeg: [-180, 180] });
/** Material ids a platform top may use: floor surfaces and wall materials of the library. */
export const PLATFORM_MATERIALS = Object.freeze([...new Set([...Object.keys(SURFACES), ...Object.keys(MATERIALS)])]);

/** A raised platform: a rectangle whose top surface is topM metres above the ground. (x, y) = min corner of the UNROTATED box; optional rotationDeg (-180..180, azimuth convention, about the centre; unset = 0, see floor.js). */
/** An overhead panel (horizontal reflector, ceiling.js). */
export function createOverheadPanel(overrides = {}) {
  return { id: newId('ovh'), name: 'Overhead panel', x: 0, y: 0, width: 4, depth: 4, heightM: 5, material: 'metal', lossDb: 0, ...overrides };
}

/** A ceiling (scene.ceiling). */
export function createCeiling(overrides = {}) {
  return { enabled: true, heightM: 5, material: 'metal', ...overrides };
}

/** An audience area (crowd absorption layer, audience.js). */
export function createAudience(overrides = {}) {
  return { id: newId('aud'), name: 'Audience', x: 0, y: 0, width: 6, depth: 4, kind: 'standing', densityPerM2: 2, ...overrides };
}

/** A crowd zone (polygon absorption, crowd.js). Default: a 6 x 4 m standing crowd. Optional fields: densityPerM2, headHeightM, kDbPerM, lMaxDb. */
export function createCrowd(overrides = {}) {
  return { id: newId('crowd'), name: 'Crowd', mode: 'standing', polygon: [{ x: 0, y: 2 }, { x: 6, y: 2 }, { x: 6, y: 6 }, { x: 0, y: 6 }], ...overrides };
}

export function createPlatform(overrides = {}) {
  return { id: newId('plat'), name: 'Riser', x: 0, y: 0, width: 2, depth: 2, topM: 0.4, material: 'wood', ...overrides };
}

/** Reference thickness in metres at which a material table loss applies (null for unknown materials). */
export function referenceThicknessM(materialId) {
  const r = MATERIAL_TRANSMISSION[materialId];
  return r ? r.refThicknessM : null;
}

export const defaultInterferer = () => ({ enabled: false, levelDbm: -70, hasPilot: false, offsetKHz: 0 });
export const DATA_PRESET_IDS = ['narrow-telemetry', 'rds-like'];
export const BATTERY_CHEMISTRY_IDS = ['alkaline-aa-x2', 'nimh-aa-x2', 'li-ion-1s'];
export const MODULATION_TYPES = ['analog-fm', 'digital'];
export const FIXED_ORDERS = [null, 2, 4, 16, 64, 256];
export const defaultTelemetry = () => ({
  enabled: true, preset: 'narrow-telemetry',
  battery: { chemistry: 'alkaline-aa-x2', startPercent: 100, timeScale: 60, running: false },
  deviceName: 'Lead Vox', gainDb: 0,
});
export const defaultModulation = () => ({
  type: 'analog-fm',
  digital: { preset: 'mic-qpsk-fixed', fixedOrder: null, overrides: {} },
});
export const IMD_PRESET_IDS = ['mic-rack-typical', 'iem-combiner-no-isolation', 'iem-combiner-isolated', 'pim-corroded-connector'];
export const IMD_COMBINER_TYPES = ['none', 'hybrid', 'isolated'];
export const IMD_PIM_PRESETS = ['none', 'good', 'corroded'];

/** One intermodulation-demo transmitter (a draggable scene object; its id is its selection id). */
export function createImdTransmitter(overrides = {}) {
  return {
    id: newId('imdtx'), name: 'Mic', freqMHz: 606.1, powerDbm: 14, pos: { x: 3, y: 3, z: 1.5 },
    antenna: { type: 'body', gainDbi: -3, orientation: { az: 0, el: 90 }, polarisation: 'vertical' }, ...overrides,
  };
}

/** The default four-mic UHF plan, one mic near the receive antenna. Used when the demo is first switched on. */
export function defaultImdTransmitters() {
  const plan = [[606.1, 3, 2.5, 'Mic A'], [606.575, 4.5, 6, 'Mic B'], [607.35, 7, 3, 'Mic C'], [608.9, 9.4, 6, 'Mic D (near the antenna)']];
  return plan.map(([f, x, y, name]) => createImdTransmitter({ name, freqMHz: f, pos: { x, y, z: 1.5 } }));
}

/** Default intermodulation setup: disabled, no transmitters yet (setImdEnabled fills in defaultImdTransmitters on first use). */
export function createDefaultImd() {
  return {
    enabled: false, preset: 'mic-rack-typical',
    transmitters: [],
    rxAntennaPos: { x: 10, y: 6.5, z: 2.5 },
    rxAntenna: { type: 'paddle', gainDbi: 2, orientation: { az: 270, el: 0 } },
    combiner: { type: 'none', isolationDb: 0, lossDb: 0 },
    pim: { preset: 'none', levelDbc: null },
    channelBwKHz: 200, wantedFreqMHz: null,
  };
}

export const DEFAULT_MPX_PRESET = 'iem-typical';
export const defaultMpx = (kind) => ({ enabled: kind === 'iem', preset: DEFAULT_MPX_PRESET, overrides: {}, pilotSquelch: false });
const CHAIN_KINDS = ['cable', 'booster', 'filter', 'connector', 'attenuator', 'splitter', 'combiner', ...EXTRA_CHAIN_KINDS];

let idCounter = 0;
/** Short unique id, e.g. newId('link') -> 'link_k3f9a2'. */
export function newId(prefix = 'id') {
  idCounter = (idCounter + 1) % 1679616;
  const rnd = Math.floor(Math.random() * 46656).toString(36).padStart(3, '0');
  return `${prefix}_${Date.now().toString(36).slice(-4)}${idCounter.toString(36)}${rnd}`;
}

export function createChainItem(kind, overrides = {}) {
  const item = buildChainItem(kind, overrides);
  if (typeof item.id !== 'string' || !item.id) item.id = newId('ci');
  return item;
}

function buildChainItem(kind, overrides) {
  switch (kind) {
    case 'cable': return { kind, cableType: 'rg58', lengthM: 10, ...overrides };
    case 'booster': return { kind, gainDb: 10, nfDb: 3, ...overrides };
    case 'filter': return { kind, lossDb: 1, ...overrides };
    case 'connector': return { kind, lossDb: 0.2, ...overrides };
    case 'attenuator': return { kind, lossDb: 3, ...overrides };
    case 'splitter':
    case 'combiner': return { kind, ports: 4, insertionLossDb: 1, ...overrides }; // excess loss only (assumed 1 dB); the 10log10(N) split loss is added in chainItemLossDb
    case 'rof': return { kind, gainDb: -25, nfDb: 30, sfdrDbHz23: 100, fibreKm: 0.1, ...overrides };
    case 'coupler': return { kind, couplingDb: 10, excessLossDb: 0.1, ...overrides };
    case 'biastee': return { kind, lossDb: 0.6, dcSupplyV: 12, ...overrides };
    case 'dcblock': return { kind, lossDb: 0.3, dcMode: 'block', ...overrides };
    case 'activesplitter':
    case 'activecombiner': return { kind, ports: 4, gainDb: 0, nfDb: 8, ...overrides };
    default: throw new Error(`Unknown chain item kind: ${kind}`);
  }
}

/**
 * createChainItemFromPreset(presetId, overrides) -> chain item with the preset figures (chain-presets.js, each flagged S/I/U) and
 * `presetId` recorded. Throws for an unknown id.
 */
export function createChainItemFromPreset(presetId, overrides = {}) {
  const pr = CHAIN_PRESETS[presetId];
  if (!pr) throw new Error(`Unknown chain preset: ${presetId}`);
  return createChainItem(pr.kind, { ...pr.item, presetId, ...overrides });
}

/** Build a default link of the given kind ('mic' or 'iem'). */
export const COVERAGE_MODES = ['coherent', 'power', 'best'];
export const DEFAULT_ZONE_MARGIN_DB = 10;
export const DEFAULT_PASS_AREA_FRACTION = 0.95;

/** Build a default link of the given kind ('mic' or 'iem'). IEM links carry branches (antenna 0 mirrors tx/chain). */
export function createDefaultLink(kind = 'mic') {
  const link = buildDefaultLink(kind);
  syncBranches(link);
  return link;
}

/**
 * Branches (IEM only): several transmit antennas fed from one transmitter through a splitter.
 * Branch 0 always mirrors the legacy fields (link.tx.pos, link.tx.antenna, link.chain), so rf.solveLink keeps working on
 * single-antenna scenes unchanged. The mirroring is done in exactly one place, syncBranches, which runs inside migrateScene,
 * createDefaultLink and every store.update. Edit antenna 0 through the legacy fields (or actions.updateBranch, which writes them).
 * Mic links have no branches.
 */
export function syncBranches(link) {
  if (!link || typeof link !== 'object') return link;
  if (link.kind !== 'iem') { delete link.branches; return link; }
  if (!link.tx || !link.tx.pos || !link.tx.antenna || !Array.isArray(link.chain)) return link;
  const mirror = (b) => ({ ...b, chain: structuredClone(link.chain), antenna: structuredClone(link.tx.antenna), pos: structuredClone(link.tx.pos) });
  if (!Array.isArray(link.branches) || !link.branches.length || !link.branches[0] || typeof link.branches[0] !== 'object') {
    link.branches = [mirror({ id: newId('br'), name: 'Antenna 1' })];
  } else {
    link.branches[0] = mirror(link.branches[0]);
  }
  const seen = new Set();
  link.branches.forEach((b, i) => {
    if (!b || typeof b !== 'object') return;
    if (typeof b.id !== 'string' || !b.id || seen.has(b.id)) b.id = newId('br');
    seen.add(b.id);
    if (typeof b.name !== 'string') b.name = `Antenna ${i + 1}`;
    if (Array.isArray(b.chain)) for (const c of b.chain) if (c && typeof c === 'object' && (typeof c.id !== 'string' || !c.id)) c.id = newId('ci');
  });
  return link;
}

/**
 * Shared receive antenna (mic links only): a link with rx.sharedAntennaOf = <another link id> uses that link's receive antenna, through a splitter.
 * The follower's rx.pos and rx.antenna are copied from the source on every store.update (the source wins; move the source receiver to move both).
 * A dangling, self, chained or non-mic reference is dropped. Run in place; called by syncScene.
 */
export function syncSharedAntennas(scene) {
  const links = scene && Array.isArray(scene.links) ? scene.links : [];
  for (const l of links) {
    if (!l || !l.rx || l.rx.sharedAntennaOf === undefined) continue;
    const src = links.find((q) => q && q.id === l.rx.sharedAntennaOf);
    if (!src || src === l || l.kind !== 'mic' || src.kind !== 'mic' || (src.rx && src.rx.sharedAntennaOf !== undefined)) { delete l.rx.sharedAntennaOf; continue; }
    l.rx.pos = structuredClone(src.rx.pos);
    l.rx.antenna = structuredClone(src.rx.antenna);
  }
  return scene;
}

/**
 * One transmitter heard by several receivers (mic links only): a link with txOf = <another link id> is an extra receiver for that link's
 * transmitter. It takes the frequency and the whole transmitter from the primary link each sync and keeps its own receiver, antenna and path.
 */
export function syncSharedTx(scene) {
  const links = scene && Array.isArray(scene.links) ? scene.links : [];
  for (const l of links) {
    if (!l || l.txOf === undefined) continue;
    const src = links.find((q) => q && q.id === l.txOf);
    if (!src || src === l || (l.kind !== 'mic' && l.kind !== 'iem') || src.kind !== l.kind || src.txOf !== undefined || !src.tx) { delete l.txOf; continue; }
    const own = l.tx && l.tx.id; l.freqMHz = src.freqMHz; l.tx = structuredClone(src.tx); if (own) l.tx.id = own; // the id stays unique
    if (l.kind === 'iem') l.chain = structuredClone(src.chain || []); // an extra bodypack hears the same rack-side path (combiner, cable, antenna)
  }
  return scene;
}

/** Run syncBranches over every link of a scene (in place), then the shared receive antennas. */
export function syncScene(scene) {
  syncSharedTx(scene);
  compileRack(scene, { fromPreset: createChainItemFromPreset, item: createChainItem });
  syncSharedTx(scene); // again, so an extra bodypack takes the rack-side chain just compiled
  // (compileRack runs before the branch mirrors so an IEM antenna from the rack is copied into them
  if (scene && Array.isArray(scene.links)) for (const l of scene.links) syncBranches(l);
  syncSharedAntennas(scene);
  return scene;
}

export function createBranch(overrides = {}) {
  return {
    id: newId('br'), name: 'Antenna', chain: [createChainItem('cable', { cableType: 'rg58', lengthM: 10 })],
    antenna: { type: 'paddle', gainDbi: 2, orientation: { az: 90, el: 0 }, polarisation: 'vertical' }, pos: { x: 6, y: 1, z: 2 }, ...overrides,
  };
}

export function createZone(overrides = {}) {
  return {
    id: newId('zone'), name: 'Zone', polygon: [{ x: 2, y: 2 }, { x: 6, y: 2 }, { x: 6, y: 5 }, { x: 2, y: 5 }],
    zMin: 0, zMax: 2, requiredMarginDb: DEFAULT_ZONE_MARGIN_DB, passAreaFraction: DEFAULT_PASS_AREA_FRACTION, ...overrides,
  };
}

/** A point-to-point audio link: fixed Tx and Rx 1 km apart, directional antennas aimed at each other, no body loss, 100 mW. Figures illustrative. */
function buildP2pLink() {
  const yagi = (az) => ({ type: 'yagi', gainDbi: 10, orientation: { az, el: 0 }, polarisation: 'vertical' });
  return {
    id: newId('link'), name: 'P2P 1', kind: 'p2p', freqMHz: 600,
    tx: { id: newId('tx'), name: 'Link transmitter', powerDbm: 20, pos: { x: 100, y: 100, z: 6 }, antenna: yagi(90) },
    rx: {
      id: newId('rx'), name: 'Link receiver', pos: { x: 1100, y: 100, z: 6 }, antenna: yagi(270), sensitivityDbm: -95, bodyLossDb: 0,
      squelch: { enabled: true, thresholdDbm: -90, hysteresisDb: 3 }, rxPreset: 'mic-receiver-typical', overload: {},
      diversity: defaultDiversity({ x: 1100, y: 100, z: 6 }, { type: 'yagi', gainDbi: 10, orientation: { az: 270, el: 0 } }),
    },
    audio: { source: 'speech', gainDb: 0 },
    mpx: defaultMpx('mic'),
    interferer: defaultInterferer(),
    telemetry: defaultTelemetry(),
    modulation: defaultModulation(),
    p2p: { kFactor: 4 / 3 },
    chain: [],
  };
}

function buildDefaultLink(kind) {
  if (kind === 'p2p') return buildP2pLink();
  if (kind === 'iem') {
    return {
      id: newId('link'), name: 'IEM 1', kind: 'iem', freqMHz: 600,
      tx: {
        id: newId('tx'), name: 'IEM transmitter', powerDbm: 17, pos: { x: 11, y: 0.5, z: 1.2 },
        antenna: { type: 'paddle', gainDbi: 2, orientation: { az: 90, el: 0 }, polarisation: 'vertical' },
      },
      rx: {
        id: newId('rx'), name: 'Bodypack', pos: { x: 4, y: 3, z: 1.0 },
        antenna: { type: 'body', gainDbi: -3, orientation: { az: 0, el: 90 }, polarisation: 'vertical' },
        sensitivityDbm: -90, bodyLossDb: 0,
        squelch: { enabled: true, thresholdDbm: -85, hysteresisDb: 3 },
        rxPreset: 'iem-bodypack-typical', overload: {},
        diversity: defaultDiversity({ x: 4, y: 3, z: 1.0 }, { type: 'body', gainDbi: -3, orientation: { az: 0, el: 90 } }),
      },
      audio: { source: 'speech', gainDb: 0 },
      mpx: defaultMpx('iem'),
      interferer: defaultInterferer(),
      telemetry: defaultTelemetry(),
      modulation: defaultModulation(),
      // iem: transmitter -> chain -> tx antenna
      chain: [createChainItem('cable', { cableType: 'rg58', lengthM: 15 })],
    };
  }
  return {
    id: newId('link'), name: 'Mic 1', kind: 'mic', freqMHz: 600,
    tx: {
      id: newId('tx'), name: 'Handheld mic', powerDbm: 14, pos: { x: 4, y: 3, z: 1.5 },
      antenna: { type: 'body', gainDbi: -3, orientation: { az: 0, el: 90 }, polarisation: 'vertical' },
    },
    rx: {
      id: newId('rx'), name: 'UHF receiver', pos: { x: 10, y: 6.5, z: 2.5 },
      antenna: { type: 'paddle', gainDbi: 2, orientation: { az: 270, el: 0 }, polarisation: 'vertical' },
      sensitivityDbm: -95, bodyLossDb: 0,
      squelch: { enabled: true, thresholdDbm: -90, hysteresisDb: 3 },
      rxPreset: 'mic-receiver-typical', overload: {},
      diversity: defaultDiversity({ x: 10, y: 6.5, z: 2.5 }, { type: 'paddle', gainDbi: 2, orientation: { az: 270, el: 0 } }),
    },
    audio: { source: 'speech', gainDb: 0 },
    mpx: defaultMpx('mic'),
    interferer: defaultInterferer(),
    telemetry: defaultTelemetry(),
    modulation: defaultModulation(),
    // mic: Rx antenna -> receiver
    chain: [createChainItem('cable', { cableType: 'rg58', lengthM: 15 })],
  };
}

/** External RF noise preset for NEW scenes. Older scenes and share links without the field stay unset (= Off) so their numbers do not change. */
export const DEFAULT_EXTERNAL_NOISE = 'urban';

export function createDefaultScene() {
  return {
    version: SCHEMA_VERSION,
    units: { power: 'dBm', length: 'm' },
    stage: { width: 12, depth: 8, heightM: 0 },
    platforms: [],
    environment: { floor: 'wood', model: 'two-ray', fadeMarginDb: 0, bodyLossDb: 0, externalNoise: DEFAULT_EXTERNAL_NOISE },
    reflectors: [],
    zones: [],
    coverage: { mode: 'power' },
    imd: createDefaultImd(),
    links: [createDefaultLink('mic')],
  };
}

export function createReflector(overrides = {}) {
  return {
    id: newId('refl'), name: 'Wall', material: 'concrete',
    p1: { x: 0, y: 8 }, p2: { x: 12, y: 8 }, zMin: 0, zMax: 4, ...overrides,
  };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const inRange = (v, lo, hi) => isNum(v) && v >= lo && v <= hi;

/**
 * Hard limits on what a loaded scene (file, share link, browser storage) may contain. They bound memory and CPU so that a
 * hostile or corrupt scene cannot hang the tab: the solver loops are driven by these counts or by the stage/zone extent.
 */
export const SCENE_LIMITS = Object.freeze({
  maxText: 4 * 1024 * 1024, // characters of scene JSON that deserialize() will parse
  maxDepth: 24, maxNodes: 200000, maxString: 1000, // generic shape guard (the venue underlay is checked on its own)
  maxLinks: 64, maxPeople: 64, maxReflectors: 500, maxZones: 100, maxZonePoints: 500, maxImdTransmitters: 16, maxImdGroups: 8, maxChain: 32, maxBranches: 16, maxTvBlockLevels: 70, maxWallAdjustMaterials: 32, maxCrowds: 30, maxCrowdPoints: 64,
  coordM: 10000, zoneCoordM: 2000, zM: 1000, maxFreqMHz: 1e6, maxDb: 1000, maxIdChars: 64,
});
const SL = SCENE_LIMITS;
/** Name rules (reflector 40 characters, person and noise source 80): a string, control characters removed, trimmed, cut to the limit. */
export const NAME_LIMITS = Object.freeze({ reflector: 40, person: PEOPLE_LIMITS.nameChars, noiseSource: 80 });
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
/** sanitizeName(value, max, fallback) -> a clean name; a non-string or an empty result gives the fallback. Names that are already clean come back unchanged. */
export function sanitizeName(v, max, fallback) {
  if (typeof v !== 'string') return fallback;
  const t = v.replace(CONTROL_RE, '').trim().slice(0, max).trim();
  return t.length ? t : fallback;
}
const nameErrors = (v, max, path, errors) => {
  if (v === undefined) return;
  if (typeof v !== 'string') errors.push(`${path}.name must be a string`);
  else if (v.length > max) errors.push(`${path}.name must be at most ${max} characters`);
  else if (CONTROL_RE.test(v)) { CONTROL_RE.lastIndex = 0; errors.push(`${path}.name must not contain control characters`); }
  CONTROL_RE.lastIndex = 0;
};
const ID_RE = /^[A-Za-z0-9_.:-]+$/;
/** A key or id that is safe to use as a lookup key: short, plain characters, and not an Object.prototype name. */
export const isSafeId = (v) => typeof v === 'string' && v.length >= 1 && v.length <= SL.maxIdChars && ID_RE.test(v) && !(v in Object.prototype);
const isFreq = (v) => v > 0 && v <= SL.maxFreqMHz;
const isDbPos = (v) => isNum(v) && v >= 0 && v <= SL.maxDb;

/** Generic shape guard: depth, node count, string length and prototype-pollution keys. Skips the venue (validateVenue checks it). */
function checkShape(scene, errors) {
  let nodes = 0;
  const walk = (v, depth, path) => {
    if (typeof v === 'string') {
      if (v.length > SL.maxString) { errors.push(`${path} is too long (${v.length} characters, limit ${SL.maxString})`); return false; }
      return true;
    }
    if (v === null || typeof v !== 'object') return true;
    if (depth > SL.maxDepth) { errors.push('scene is nested too deeply'); return false; }
    if (++nodes > SL.maxNodes) { errors.push('scene has too many values'); return false; }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) if (!walk(v[i], depth + 1, `${path}[${i}]`)) return false;
      return true;
    }
    for (const k of Object.keys(v)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') { errors.push(`${path} has a key that is not allowed`); return false; }
      if (depth === 0 && k === 'venue') continue;
      if (!walk(v[k], depth + 1, `${path}.${k.slice(0, 40)}`)) return false;
    }
    return true;
  };
  walk(scene, 0, 'scene');
}

/** Optional analogue-FM transmitter fields: fmPreset (a tx id of fm-presets.js) and lowIntermod (boolean). */
function checkFmTx(t, path, errors) {
  if (t.audioBandwidthHz !== undefined && !inRange(t.audioBandwidthHz, 1000, 22000)) errors.push(`${path}.audioBandwidthHz must be between 1000 and 22000`);
  if (t.fmPreset !== undefined && !FM_TX_PRESET_IDS.includes(t.fmPreset)) errors.push(`${path}.fmPreset invalid`);
  if (t.lowIntermod !== undefined && typeof t.lowIntermod !== 'boolean') errors.push(`${path}.lowIntermod must be a boolean`);
}

function checkPos(p, path, errors, keys = ['x', 'y', 'z'], xyLimit = SL.coordM) {
  if (!isObj(p)) { errors.push(`${path} must be an object`); return; }
  for (const k of keys) {
    const lim = k === 'z' ? SL.zM : k === 'az' || k === 'el' ? 3600 : xyLimit;
    if (!isNum(p[k])) errors.push(`${path}.${k} must be a finite number`);
    else if (Math.abs(p[k]) > lim) errors.push(`${path}.${k} is out of range (limit ${lim})`);
  }
}

function checkCount(arr, max, path, errors) {
  if (arr.length > max) { errors.push(`${path} has more than ${max} entries`); return false; }
  return true;
}

/** Chain items: kind plus optional safe id and cable type; numeric fields, when present, must be finite and bounded. */
function checkChainItem(c, path, errors) {
  if (!isObj(c) || !CHAIN_KINDS.includes(c.kind)) { errors.push(`${path}.kind invalid`); return; }
  if (c.id !== undefined && !isSafeId(c.id)) errors.push(`${path}.id must be a short plain string`);
  if (c.cableType !== undefined && !isSafeId(c.cableType)) errors.push(`${path}.cableType invalid`);
  for (const k of ['lengthM', 'gainDb', 'nfDb', 'lossDb', 'insertionLossDb', 'ports', 'couplingDb', 'excessLossDb', 'isolationDb', 'rejectionDb', 'iip3Dbm', 'oip3Dbm', 'op1dBDbm', 'maxInputDbm', 'dcSupplyV', 'dcSupplyMa', 'dcNeedV', 'dcNeedMa', 'powerV', 'powerMa', 'passLoMHz', 'passHiMHz', 'reverseIsolationDb', 'sfdrDbHz23', 'fibreKm', 'fibreLossDbPerKm', 'connectorLossDb', 'bwMinMHz', 'bwMaxMHz']) {
    if (c[k] !== undefined && !(isNum(c[k]) && Math.abs(c[k]) <= SL.coordM)) errors.push(`${path}.${k} must be a bounded number`);
  }
  if (c.fibreKm !== undefined && !(isNum(c.fibreKm) && c.fibreKm >= 0 && c.fibreKm <= 100)) errors.push(`${path}.fibreKm must be between 0 and 100`);
  if (c.fibreLossDbPerKm !== undefined && !(isNum(c.fibreLossDbPerKm) && c.fibreLossDbPerKm >= 0 && c.fibreLossDbPerKm <= 10)) errors.push(`${path}.fibreLossDbPerKm must be between 0 and 10`);
  if (c.dcMode !== undefined && !DC_MODES.includes(c.dcMode)) errors.push(`${path}.dcMode invalid`);
  if (c.filterType !== undefined && !FILTER_TYPES.includes(c.filterType)) errors.push(`${path}.filterType invalid`);
  if (c.noDc !== undefined && typeof c.noDc !== 'boolean') errors.push(`${path}.noDc must be true or false`);
  if (c.presetId !== undefined && !(isSafeId(c.presetId) && Object.prototype.hasOwnProperty.call(CHAIN_PRESETS, c.presetId))) errors.push(`${path}.presetId invalid`);
}

function checkImdTopology(t, path, errors) {
  if (!isObj(t)) { errors.push(`${path} must be an object`); return; }
  const dbOk = (v) => v === undefined || (isNum(v) && v >= 0 && v <= SL.maxDb);
  if (!Array.isArray(t.groups)) { errors.push(`${path}.groups must be an array`); return; }
  if (!checkCount(t.groups, SL.maxImdGroups, `${path}.groups`, errors)) return;
  t.groups.forEach((g, i) => {
    const p = `${path}.groups[${i}]`;
    if (!isObj(g) || !isSafeId(g.id)) { errors.push(`${p}.id must be a short plain string`); return; }
    if (!Array.isArray(g.members) || g.members.length > SL.maxImdTransmitters || !g.members.every(isSafeId)) errors.push(`${p}.members must be a list of ids (max ${SL.maxImdTransmitters})`);
    if (!dbOk(g.lossDb) || !dbOk(g.isolationDb) || !dbOk(g.isolatorDb)) errors.push(`${p}: lossDb, isolationDb, isolatorDb must be numbers >= 0`);
    if (g.underRoot !== undefined && typeof g.underRoot !== 'boolean') errors.push(`${p}.underRoot must be true or false`);
  });
  if (t.root !== undefined && t.root !== null && !(isObj(t.root) && dbOk(t.root.lossDb) && dbOk(t.root.isolationDb))) errors.push(`${path}.root must be {lossDb >= 0, isolationDb >= 0} or absent`);
}

function checkP2p(q, path, errors) {
  if (!isObj(q)) { errors.push(`${path} must be an object`); return; }
  if (q.kFactor !== undefined && !(isNum(q.kFactor) && q.kFactor >= 0.5 && q.kFactor <= 10)) errors.push(`${path}.kFactor must be between 0.5 and 10`);
  if (q.fadeMarginDb !== undefined && !(isNum(q.fadeMarginDb) && q.fadeMarginDb >= 0 && q.fadeMarginDb <= 60)) errors.push(`${path}.fadeMarginDb must be between 0 and 60`);
  if (q.groundReflection !== undefined && typeof q.groundReflection !== 'boolean') errors.push(`${path}.groundReflection must be true or false`);
  if (q.obstacle !== undefined && q.obstacle !== null) {
    const o = q.obstacle;
    if (!isObj(o) || !(isNum(o.distanceM) && o.distanceM > 0 && o.distanceM <= SL.coordM * 4) || !(isNum(o.heightM) && o.heightM >= -100 && o.heightM <= SL.zM)) errors.push(`${path}.obstacle must be { distanceM > 0, heightM }`);
  }
}

function checkOverheadRect(r, path, errors) {
  const [c0, c1] = CEILING_LIMITS.coord, [s0, s1] = CEILING_LIMITS.size;
  if (!isObj(r)) { errors.push(`${path} must be an object`); return; }
  for (const k of ['x', 'y']) if (!(isNum(r[k]) && r[k] >= c0 && r[k] <= c1)) errors.push(`${path}.${k} must be a number between ${c0} and ${c1}`);
  for (const k of ['width', 'depth']) if (!(isNum(r[k]) && r[k] >= s0 && r[k] <= s1)) errors.push(`${path}.${k} must be between ${s0} and ${s1}`);
}

function checkDesignBand(b, path, errors) {
  if (typeof b === 'string') { if (!Object.prototype.hasOwnProperty.call(ANTENNA_BANDS, b)) errors.push(`${path} is not a known band id`); return; }
  if (!isObj(b) || !isNum(b.loMHz) || !isNum(b.hiMHz) || !(b.loMHz > 0) || !(b.hiMHz > b.loMHz) || b.hiMHz > 100000) { errors.push(`${path} must be a band id or {loMHz < hiMHz} in MHz`); return; }
  if (b.order !== undefined && b.order !== 1 && b.order !== 3) errors.push(`${path}.order must be 1 or 3`);
  if (b.minVswr !== undefined && !(isNum(b.minVswr) && b.minVswr >= 1 && b.minVswr <= 3)) errors.push(`${path}.minVswr must be between 1 and 3`);
  if (b.label !== undefined && !(typeof b.label === 'string' && b.label.length <= 80)) errors.push(`${path}.label must be a short string`);
}

function checkAntenna(a, path, errors) {
  if (!isObj(a)) { errors.push(`${path} must be an object`); return; }
  if (!ANTENNA_TYPES.includes(a.type)) errors.push(`${path}.type invalid: ${a.type}`);
  if (!isNum(a.gainDbi)) errors.push(`${path}.gainDbi must be a finite number`);
  checkPos(a.orientation, `${path}.orientation`, errors, ['az', 'el']);
  if (a.tiltDeg !== undefined && !inRange(a.tiltDeg, -90, 90)) errors.push(`${path}.tiltDeg must be between -90 and 90`);
  if (a.rollDeg !== undefined && !inRange(a.rollDeg, -180, 180)) errors.push(`${path}.rollDeg must be between -180 and 180`);
  if (a.polarisation !== undefined) {
    if (!ANTENNA_POLARISATIONS.includes(a.polarisation)) errors.push(`${path}.polarisation invalid`);
    else if (!allowedPolarisations(a.type).includes(a.polarisation)) errors.push(`${path}.polarisation ${a.polarisation} is not allowed on a ${a.type} antenna (${allowedPolarisations(a.type).join(', ')})`);
  }
  if (a.contact !== undefined && !(typeof a.contact === 'string' && Object.prototype.hasOwnProperty.call(ANTENNA_CONTACT_LOSS_DB, a.contact))) errors.push(`${path}.contact invalid`);
  if (a.dampness !== undefined && !(typeof a.dampness === 'string' && Object.prototype.hasOwnProperty.call(ANTENNA_DAMPNESS_LOSS_DB, a.dampness))) errors.push(`${path}.dampness invalid`);
  if (a.designBand !== undefined) checkDesignBand(a.designBand, `${path}.designBand`, errors);
  if (a.groundPlane !== undefined && !Object.prototype.hasOwnProperty.call(GROUND_PLANE_GAIN_DBI, a.groundPlane)) errors.push(`${path}.groundPlane invalid`);
}

/** Validate a scene. Returns { ok, errors: string[] }. Never throws. */
export function validateScene(scene) {
  const errors = [];
  if (!isObj(scene)) return { ok: false, errors: ['scene must be an object'] };
  checkShape(scene, errors);
  if (errors.length) return { ok: false, errors };
  if (scene.version !== SCHEMA_VERSION) errors.push(`version must be ${SCHEMA_VERSION}`);
  if (scene.venue !== undefined) errors.push(...validateVenue(scene.venue));
  errors.push(...validateRack(scene));
  if (scene.rack && Array.isArray(scene.rack.antennas)) scene.rack.antennas.forEach((a, i) => { if (a && Array.isArray(a.chain) && a.chain.length <= 8) a.chain.forEach((c, j) => checkChainItem(c, `rack.antennas[${i}].chain[${j}]`, errors)); });
  if (!isObj(scene.units) || !POWER_UNITS.includes(scene.units.power)) errors.push('units.power invalid');
  if (!isObj(scene.units) || !LENGTH_UNITS.includes(scene.units.length)) errors.push('units.length invalid');
  if (!isObj(scene.stage) || !(scene.stage.width > 0) || !(scene.stage.depth > 0)) {
    errors.push('stage.width and stage.depth must be positive numbers');
  } else {
    const [smin, smax] = STAGE_LIMITS.size;
    if (scene.stage.width < smin || scene.stage.width > smax || scene.stage.depth < smin || scene.stage.depth > smax) errors.push(`stage.width and stage.depth must be between ${smin} and ${smax} m`);
    if (scene.stage.material !== undefined && !(typeof scene.stage.material === 'string' && Object.prototype.hasOwnProperty.call(SURFACES, scene.stage.material))) {
      errors.push(`stage.material invalid: ${String(scene.stage.material).slice(0, 40)}`);
    }
    if (scene.stage.heightM !== undefined && !(isNum(scene.stage.heightM) && scene.stage.heightM >= STAGE_LIMITS.heightM[0] && scene.stage.heightM <= STAGE_LIMITS.heightM[1])) {
      errors.push(`stage.heightM must be between ${STAGE_LIMITS.heightM[0]} and ${STAGE_LIMITS.heightM[1]} m`);
    }
  }
  // Global audio source (audio-source.js): optional; absent means the default by link kind (mic voice, IEM music), so older files are unchanged.
  if (scene.audioSource !== undefined && scene.audioSource !== null && !(typeof scene.audioSource === 'string' && AUDIO_SOURCE_IDS.includes(scene.audioSource))) errors.push(`audioSource must be one of ${AUDIO_SOURCE_IDS.join('|')}`);
  if (scene.audioToneHz !== undefined && scene.audioToneHz !== null && !(isNum(scene.audioToneHz) && scene.audioToneHz >= TONE_HZ_LIMITS[0] && scene.audioToneHz <= TONE_HZ_LIMITS[1])) errors.push(`audioToneHz must be between ${TONE_HZ_LIMITS[0]} and ${TONE_HZ_LIMITS[1]} Hz`);
  const env = scene.environment;
  if (!isObj(env)) errors.push('environment must be an object');
  else {
    if (typeof env.floor !== 'string' || !env.floor) errors.push('environment.floor must be a string');
    if (env.polarisation !== undefined && !POLARISATIONS.includes(env.polarisation)) errors.push('environment.polarisation invalid'); // legacy: migrated onto the antennas on load
    if (!MODELS.includes(env.model)) errors.push('environment.model invalid');
    if (!isNum(env.fadeMarginDb)) errors.push('environment.fadeMarginDb must be a number');
    if (!isNum(env.bodyLossDb)) errors.push('environment.bodyLossDb must be a number');
    for (const [f, lim] of [['xpdDb', CALIBRATION_FIELDS['environment.xpdDb']], ['wallLossAdjustDb', CALIBRATION_FIELDS['environment.wallLossAdjustDb']]]) {
      if (env[f] !== undefined && !(isNum(env[f]) && env[f] >= lim.min && env[f] <= lim.max)) errors.push(`environment.${f} must be between ${lim.min} and ${lim.max}`);
    }
    if (env.wallLossAdjustByMaterialDb !== undefined) {
      const o = env.wallLossAdjustByMaterialDb, W = WALL_ADJUST_BY_MATERIAL;
      if (!isObj(o)) errors.push('environment.wallLossAdjustByMaterialDb must be an object of material to dB');
      else if (Object.keys(o).length > SL.maxWallAdjustMaterials) errors.push(`environment.wallLossAdjustByMaterialDb has more than ${SL.maxWallAdjustMaterials} materials`);
      else for (const [k, v] of Object.entries(o)) {
        if (!isSafeId(k)) errors.push(`environment.wallLossAdjustByMaterialDb has a material name that is not a short plain string`);
        else if (!(isNum(v) && v >= W.min && v <= W.max)) errors.push(`environment.wallLossAdjustByMaterialDb.${k} must be between ${W.min} and ${W.max}`);
      }
    }
    const xn = env.externalNoise;
    if (xn !== undefined && !(typeof xn === 'string' && Object.prototype.hasOwnProperty.call(EXTERNAL_NOISE_FIGURE_600MHZ_DB, xn)) && !(isNum(xn) && xn >= 0)) errors.push('environment.externalNoise must be a preset name or a number >= 0');
    const itf = env.interference;
    if (itf !== undefined && !(typeof itf === 'string' && INTERFERENCE_LEVELS.includes(itf))) errors.push(`environment.interference must be one of ${INTERFERENCE_LEVELS.join(', ')}`);
  }
  const ids = new Set();
  const checkId = (id, path) => {
    if (!isSafeId(id)) errors.push(`${path}.id must be a short plain string (letters, digits, - _ . :)`);
    else if (ids.has(id)) errors.push(`${path}.id duplicate: ${id}`);
    else ids.add(id);
  };
  if (scene.ceiling !== undefined) {
    const c = scene.ceiling, p = 'ceiling', L = CEILING_LIMITS;
    if (!isObj(c)) errors.push('ceiling must be an object');
    else {
      if (c.enabled !== undefined && typeof c.enabled !== 'boolean') errors.push(`${p}.enabled must be true or false`);
      if (!(isNum(c.heightM) && c.heightM >= L.heightM[0] && c.heightM <= L.heightM[1])) errors.push(`${p}.heightM must be between ${L.heightM[0]} and ${L.heightM[1]} m`);
      if (!(typeof c.material === 'string' && Object.prototype.hasOwnProperty.call(CEILING_MATERIALS, c.material))) errors.push(`${p}.material invalid`);
      if (c.lossDb !== undefined && !(isNum(c.lossDb) && c.lossDb >= L.lossDb[0] && c.lossDb <= L.lossDb[1])) errors.push(`${p}.lossDb must be between ${L.lossDb[0]} and ${L.lossDb[1]}`);
      if (c.extent !== undefined) checkOverheadRect(c.extent, `${p}.extent`, errors);
    }
  }
  if (scene.overheadPanels !== undefined) {
    const L = CEILING_LIMITS;
    if (!Array.isArray(scene.overheadPanels)) errors.push('overheadPanels must be an array');
    else if (scene.overheadPanels.length > L.panelsMax) errors.push(`at most ${L.panelsMax} overhead panels are supported`);
    else scene.overheadPanels.forEach((o, i) => {
      const p = `overheadPanels[${i}]`;
      if (!isObj(o) || !isSafeId(o.id)) { errors.push(`${p}.id must be a short plain string`); return; }
      if (o.name !== undefined && !(typeof o.name === 'string' && o.name.length <= 80)) errors.push(`${p}.name must be a short string`);
      checkOverheadRect(o, p, errors);
      if (!(isNum(o.heightM) && o.heightM >= L.heightM[0] && o.heightM <= L.heightM[1])) errors.push(`${p}.heightM must be between ${L.heightM[0]} and ${L.heightM[1]} m`);
      if (!(typeof o.material === 'string' && Object.prototype.hasOwnProperty.call(CEILING_MATERIALS, o.material))) errors.push(`${p}.material invalid`);
      if (o.lossDb !== undefined && !(isNum(o.lossDb) && o.lossDb >= L.lossDb[0] && o.lossDb <= L.lossDb[1])) errors.push(`${p}.lossDb must be between ${L.lossDb[0]} and ${L.lossDb[1]}`);
    });
  }
  if (scene.audience !== undefined) {
    if (!Array.isArray(scene.audience)) errors.push('audience must be an array');
    else if (scene.audience.length > AUDIENCE_MAX) errors.push(`at most ${AUDIENCE_MAX} audience areas are supported`);
    else scene.audience.forEach((a, i) => {
      const p = `audience[${i}]`;
      if (!isObj(a) || !isSafeId(a.id)) { errors.push(`${p}.id must be a short plain string`); return; }
      if (a.name !== undefined && !(typeof a.name === 'string' && a.name.length <= 80)) errors.push(`${p}.name must be a short string`);
      if (!AUDIENCE_KINDS.includes(a.kind)) errors.push(`${p}.kind must be standing or seated`);
      const [c0, c1] = PLATFORM_LIMITS.coord, [s0, s1] = PLATFORM_LIMITS.size;
      for (const k of ['x', 'y']) if (!(isNum(a[k]) && a[k] >= c0 && a[k] <= c1)) errors.push(`${p}.${k} must be a number between ${c0} and ${c1}`);
      for (const k of ['width', 'depth']) if (!(isNum(a[k]) && a[k] >= s0 && a[k] <= s1)) errors.push(`${p}.${k} must be between ${s0} and ${s1}`);
      if (!(isNum(a.densityPerM2) && a.densityPerM2 >= AUDIENCE_DENSITY_LIMITS[0] && a.densityPerM2 <= AUDIENCE_DENSITY_LIMITS[1])) errors.push(`${p}.densityPerM2 must be between ${AUDIENCE_DENSITY_LIMITS[0]} and ${AUDIENCE_DENSITY_LIMITS[1]}`);
      if (a.headM !== undefined && !(isNum(a.headM) && a.headM >= 0.3 && a.headM <= 2.5)) errors.push(`${p}.headM must be between 0.3 and 2.5`);
    });
  }
  if (scene.crowds !== undefined) { // optional crowd zones (crowd.js)
    if (!Array.isArray(scene.crowds)) errors.push('crowds must be an array');
    else if (!checkCount(scene.crowds, SL.maxCrowds, 'crowds', errors)) { /* reported */ } else scene.crowds.forEach((c, i) => {
      const p = `crowds[${i}]`;
      if (!isObj(c)) { errors.push(`${p} must be an object`); return; }
      checkId(c.id, p);
      nameErrors(c.name, CROWD_LIMITS.nameChars, p, errors);
      if (!CROWD_MODES.includes(c.mode)) errors.push(`${p}.mode must be seated, standing or packed`);
      if (!Array.isArray(c.polygon) || c.polygon.length < 3) errors.push(`${p}.polygon needs at least 3 points`);
      else if (checkCount(c.polygon, SL.maxCrowdPoints, `${p}.polygon`, errors)) c.polygon.forEach((pt, j) => checkPos(pt, `${p}.polygon[${j}]`, errors, ['x', 'y'], SL.zoneCoordM));
      for (const k of ['densityPerM2', 'headHeightM', 'kDbPerM', 'lMaxDb']) {
        const lim = CROWD_LIMITS[k];
        if (c[k] !== undefined && !(isNum(c[k]) && c[k] >= lim[0] && c[k] <= lim[1])) errors.push(`${p}.${k} must be between ${lim[0]} and ${lim[1]}`);
      }
    });
  }
  if (scene.tvChannelWidthMHz !== undefined && scene.tvChannelWidthMHz !== 6 && scene.tvChannelWidthMHz !== 8) errors.push('tvChannelWidthMHz must be 6 or 8');
  if (scene.tvBlockLevelsDbm !== undefined) { // optional per-channel TV in-block level override (spectrum-map.js), dBm at the receiver
    const L = TV_BLOCK_LEVEL_LIMITS, o = scene.tvBlockLevelsDbm;
    if (!isObj(o)) errors.push('tvBlockLevelsDbm must be an object of channel number to dBm');
    else if (Object.keys(o).length > SL.maxTvBlockLevels) errors.push(`tvBlockLevelsDbm has more than ${SL.maxTvBlockLevels} channels`);
    else for (const [k, v] of Object.entries(o)) {
      const n = Number(k);
      if (!(Number.isInteger(n) && String(n) === k && n >= L.channel[0] && n <= L.channel[1])) errors.push(`tvBlockLevelsDbm key ${k.slice(0, 20)} must be a TV channel number ${L.channel[0]} to ${L.channel[1]}`);
      else if (!(isNum(v) && v >= L.dbm[0] && v <= L.dbm[1])) errors.push(`tvBlockLevelsDbm.${k} must be between ${L.dbm[0]} and ${L.dbm[1]} dBm`);
    }
  }
  if (scene.people !== undefined) {
    if (!Array.isArray(scene.people)) errors.push('people must be an array');
    else if (scene.people.length > PEOPLE_LIMITS.max) errors.push(`at most ${PEOPLE_LIMITS.max} people are supported`);
    else {
      const seenPe = new Set(), owned = new Set();
      scene.people.forEach((pe, i) => {
        validatePerson(pe, `people[${i}]`, errors, scene);
        if (isObj(pe) && typeof pe.name === 'string' && CONTROL_RE.test(pe.name)) errors.push(`people[${i}].name must not contain control characters`);
        CONTROL_RE.lastIndex = 0;
        if (!isObj(pe)) return;
        if (typeof pe.id === 'string') { if (seenPe.has(pe.id)) errors.push(`people[${i}].id is not unique`); seenPe.add(pe.id); }
        for (const k of ['micLinkId', 'iemLinkId']) if (typeof pe[k] === 'string') { if (owned.has(pe[k])) errors.push(`people[${i}].${k} is already assigned to another person`); owned.add(pe[k]); }
        if (Array.isArray(pe.extraLinkIds)) pe.extraLinkIds.forEach((id, j) => { if (typeof id === 'string') { if (owned.has(id)) errors.push(`people[${i}].extraLinkIds[${j}] is already assigned to another person`); owned.add(id); } });
      });
    }
  }
  if (scene.measurements !== undefined) {
    if (!Array.isArray(scene.measurements)) errors.push('measurements must be an array');
    else if (scene.measurements.length > MEASUREMENT_LIMITS.max) errors.push(`at most ${MEASUREMENT_LIMITS.max} measurements are supported`);
    else {
      const seenM = new Set();
      scene.measurements.forEach((m, i) => {
        validateMeasurement(m, `measurements[${i}]`, errors);
        if (m && typeof m.id === 'string') { if (seenM.has(m.id)) errors.push(`measurements[${i}].id is not unique`); seenM.add(m.id); }
      });
    }
  }
  if (scene.noiseSources !== undefined) {
    if (!Array.isArray(scene.noiseSources)) errors.push('noiseSources must be an array');
    else if (scene.noiseSources.length > NOISE_SOURCE_LIMITS.max) errors.push(`at most ${NOISE_SOURCE_LIMITS.max} noise sources are supported`);
    else {
      const seenNs = new Set();
      scene.noiseSources.forEach((n, i) => {
        validateNoiseSource(n, `noiseSources[${i}]`, errors);
        if (isObj(n)) nameErrors(n.name, NAME_LIMITS.noiseSource, `noiseSources[${i}]`, errors);
        if (isObj(n) && typeof n.id === 'string') { if (seenNs.has(n.id)) errors.push(`noiseSources[${i}].id is not unique`); seenNs.add(n.id); }
      });
    }
  }
  if (scene.platforms !== undefined) {
    if (!Array.isArray(scene.platforms)) errors.push('platforms must be an array');
    else if (scene.platforms.length > PLATFORM_LIMITS.max) errors.push(`at most ${PLATFORM_LIMITS.max} platforms are supported`);
    else scene.platforms.forEach((pl, i) => {
      const p = `platforms[${i}]`;
      if (!isObj(pl)) { errors.push(`${p} must be an object`); return; }
      checkId(pl.id, p);
      const [c0, c1] = PLATFORM_LIMITS.coord, [s0, s1] = PLATFORM_LIMITS.size, [t0, t1] = PLATFORM_LIMITS.topM;
      if (!isNum(pl.x) || pl.x < c0 || pl.x > c1 || !isNum(pl.y) || pl.y < c0 || pl.y > c1) errors.push(`${p}.x and ${p}.y must be numbers between ${c0} and ${c1}`);
      if (!isNum(pl.width) || pl.width < s0 || pl.width > s1 || !isNum(pl.depth) || pl.depth < s0 || pl.depth > s1) errors.push(`${p}.width and ${p}.depth must be between ${s0} and ${s1} m`);
      if (!isNum(pl.topM) || pl.topM < t0 || pl.topM > t1) errors.push(`${p}.topM must be between ${t0} and ${t1} m`);
      if (!PLATFORM_MATERIALS.includes(pl.material)) errors.push(`${p}.material invalid: ${pl.material}`);
      if (pl.rotationDeg !== undefined && !(isNum(pl.rotationDeg) && pl.rotationDeg >= PLATFORM_LIMITS.rotationDeg[0] && pl.rotationDeg <= PLATFORM_LIMITS.rotationDeg[1])) errors.push(`${p}.rotationDeg must be a number between ${PLATFORM_LIMITS.rotationDeg[0]} and ${PLATFORM_LIMITS.rotationDeg[1]}`);
      if (pl.name !== undefined && typeof pl.name !== 'string') errors.push(`${p}.name must be a string`);
    });
  }
  if (scene.zones !== undefined) {
    if (!Array.isArray(scene.zones)) errors.push('zones must be an array');
    else if (!checkCount(scene.zones, SL.maxZones, 'zones', errors)) { /* reported */ } else scene.zones.forEach((z, i) => {
      const p = `zones[${i}]`;
      if (!isObj(z)) { errors.push(`${p} must be an object`); return; }
      checkId(z.id, p);
      if (!Array.isArray(z.polygon) || z.polygon.length < 3) errors.push(`${p}.polygon needs at least 3 points`);
      else if (checkCount(z.polygon, SL.maxZonePoints, `${p}.polygon`, errors)) z.polygon.forEach((pt, j) => checkPos(pt, `${p}.polygon[${j}]`, errors, ['x', 'y'], SL.zoneCoordM));
      if (!inRange(z.zMin, -SL.zM, SL.zM) || !inRange(z.zMax, -SL.zM, SL.zM) || z.zMax <= z.zMin) errors.push(`${p}: zMax must exceed zMin`);
      if (!inRange(z.requiredMarginDb, -SL.maxDb, SL.maxDb)) errors.push(`${p}.requiredMarginDb must be a number`);
      if (z.passAreaFraction !== undefined && !(z.passAreaFraction >= 0.5 && z.passAreaFraction <= 1)) errors.push(`${p}.passAreaFraction must be between 0.5 and 1`);
    });
  }
  if (scene.imd !== undefined) {
    const m = scene.imd;
    if (!isObj(m)) errors.push('imd must be an object');
    else {
      if (typeof m.enabled !== 'boolean') errors.push('imd.enabled must be a boolean');
      if (typeof m.preset !== 'string' || !IMD_PRESET_IDS.includes(m.preset)) errors.push('imd.preset invalid');
      if (!Array.isArray(m.transmitters)) errors.push('imd.transmitters must be an array');
      else if (!checkCount(m.transmitters, SL.maxImdTransmitters, 'imd.transmitters', errors)) { /* reported */ } else m.transmitters.forEach((t, i) => {
        const p = `imd.transmitters[${i}]`;
        if (!isObj(t)) { errors.push(`${p} must be an object`); return; }
        checkId(t.id, p);
        if (!isFreq(t.freqMHz)) errors.push(`${p}.freqMHz must be positive`);
        if (!inRange(t.powerDbm, -SL.maxDb, SL.maxDb)) errors.push(`${p}.powerDbm must be a number`);
        checkPos(t.pos, `${p}.pos`, errors);
        checkAntenna(t.antenna, `${p}.antenna`, errors);
        checkFmTx(t, p, errors);
        for (const k of ['h2Dbc', 'harmonicFilterDb']) if (t[k] !== undefined && !inRange(t[k], 0, 200)) errors.push(`${p}.${k} must be between 0 and 200`);
      });
      for (const k of ['iip2Dbm', 'iip4Dbm']) if (m[k] !== undefined && !inRange(m[k], -100, 200)) errors.push(`imd.${k} must be between -100 and 200`);
      if (m.bands !== undefined) {
        if (!Array.isArray(m.bands) || m.bands.length > 16) errors.push('imd.bands must be an array of at most 16 {name, loMHz, hiMHz}');
        else m.bands.forEach((b, i) => { if (!isObj(b) || typeof b.name !== 'string' || b.name.length > 80 || !isFreq(b.loMHz) || !isFreq(b.hiMHz) || b.hiMHz <= b.loMHz) errors.push(`imd.bands[${i}] must be {name, loMHz, hiMHz} with hiMHz > loMHz`); });
      }
      for (const k of ['filterBefore', 'filterAfter']) {
        const f = m[k];
        if (f !== undefined && (!isObj(f) || !isFreq(f.passLoMHz) || !isFreq(f.passHiMHz) || f.passHiMHz <= f.passLoMHz || (f.rejectionDb !== undefined && !inRange(f.rejectionDb, 0, 200)))) errors.push(`imd.${k} must be {passLoMHz, passHiMHz, rejectionDb?}`);
      }
      checkPos(m.rxAntennaPos, 'imd.rxAntennaPos', errors);
      if (m.rxAntenna !== undefined) checkAntenna(m.rxAntenna, 'imd.rxAntenna', errors);
      const c = m.combiner;
      if (m.topology !== undefined) checkImdTopology(m.topology, 'imd.topology', errors);
      if (!isObj(c) || !IMD_COMBINER_TYPES.includes(c.type) || !isDbPos(c.isolationDb) || !isDbPos(c.lossDb)) errors.push('imd.combiner must be {type: none|hybrid|isolated, isolationDb >= 0, lossDb >= 0}');
      const q = m.pim;
      if (!isObj(q) || !IMD_PIM_PRESETS.includes(q.preset) || (q.levelDbc !== null && !inRange(q.levelDbc, -SL.maxDb, SL.maxDb))) errors.push('imd.pim must be {preset: none|good|corroded, levelDbc: number|null}');
      if (!(m.channelBwKHz > 0 && m.channelBwKHz <= 1e6)) errors.push('imd.channelBwKHz must be positive');
      if (m.wantedFreqMHz !== null && !isFreq(m.wantedFreqMHz)) errors.push('imd.wantedFreqMHz must be null or positive');
    }
  }
  if (scene.coverage !== undefined && (!isObj(scene.coverage) || !COVERAGE_MODES.includes(scene.coverage.mode))) {
    errors.push(`coverage.mode must be one of ${COVERAGE_MODES.join(', ')}`);
  }
  if (!Array.isArray(scene.reflectors)) errors.push('reflectors must be an array');
  else if (!checkCount(scene.reflectors, SL.maxReflectors, 'reflectors', errors)) { /* reported */ } else scene.reflectors.forEach((r, i) => {
    const p = `reflectors[${i}]`;
    if (!isObj(r)) { errors.push(`${p} must be an object`); return; }
    checkId(r.id, p);
    nameErrors(r.name, NAME_LIMITS.reflector, p, errors);
    if (!isSafeId(r.material)) errors.push(`${p}.material must be a short plain string`);
    checkPos(r.p1, `${p}.p1`, errors, ['x', 'y']);
    checkPos(r.p2, `${p}.p2`, errors, ['x', 'y']);
    if (!inRange(r.zMin, -SL.zM, SL.zM) || !inRange(r.zMax, -SL.zM, SL.zM) || r.zMax <= r.zMin) errors.push(`${p}: zMax must exceed zMin`);
    if (r.transmissionLossDb !== undefined && !isDbPos(r.transmissionLossDb)) errors.push(`${p}.transmissionLossDb must be a number >= 0`);
    if (r.thicknessFactor !== undefined && !isDbPos(r.thicknessFactor)) errors.push(`${p}.thicknessFactor must be a number >= 0`);
    if (r.thicknessM !== undefined && !isDbPos(r.thicknessM)) errors.push(`${p}.thicknessM must be a number >= 0`);
    if (r.construction !== undefined && !(typeof r.construction === 'string' && Object.prototype.hasOwnProperty.call(WALL_CONSTRUCTIONS, r.construction))) errors.push(`${p}.construction must be one of ${Object.keys(WALL_CONSTRUCTIONS).join(', ')}`);
    if (r.holeSizeMm !== undefined && !inRange(r.holeSizeMm, 0.01, 2000)) errors.push(`${p}.holeSizeMm must be between 0.01 and 2000`);
    if (r.noise !== undefined) {
      const n = r.noise, W = WALL_NOISE_LIMITS;
      if (!isObj(n)) errors.push(`${p}.noise must be an object`);
      else {
        if (n.preset !== undefined && !(typeof n.preset === 'string' && Object.prototype.hasOwnProperty.call(WALL_NOISE_PRESETS, n.preset))) errors.push(`${p}.noise.preset must be one of ${Object.keys(WALL_NOISE_PRESETS).join(', ')}`);
        if (n.levelDbuvmAt10m !== undefined && !inRange(n.levelDbuvmAt10m, ...W.levelDbuvmAt10m)) errors.push(`${p}.noise.levelDbuvmAt10m must be between ${W.levelDbuvmAt10m.join(' and ')}`);
        if (n.tiltDbPerDecade !== undefined && !inRange(n.tiltDbPerDecade, ...W.tiltDbPerDecade)) errors.push(`${p}.noise.tiltDbPerDecade must be between ${W.tiltDbPerDecade.join(' and ')}`);
        if (n.rearLossDb !== undefined && !inRange(n.rearLossDb, ...W.rearLossDb)) errors.push(`${p}.noise.rearLossDb must be between ${W.rearLossDb.join(' and ')}`);
        if (n.heightM !== undefined && !inRange(n.heightM, ...W.heightM)) errors.push(`${p}.noise.heightM must be between ${W.heightM.join(' and ')}`);
        for (const k of ['bandMinMHz', 'bandMaxMHz']) if (n[k] !== undefined && !inRange(n[k], ...W.bandMHz)) errors.push(`${p}.noise.${k} must be between ${W.bandMHz.join(' and ')}`);
        if (n.facing !== undefined && n.facing !== 'left' && n.facing !== 'right') errors.push(`${p}.noise.facing must be 'left' or 'right'`);
      }
    }
  });
  if (!Array.isArray(scene.links)) errors.push('links must be an array');
  else if (!checkCount(scene.links, SL.maxLinks, 'links', errors)) { /* reported */ } else scene.links.forEach((l, i) => {
    const p = `links[${i}]`;
    if (!isObj(l)) { errors.push(`${p} must be an object`); return; }
    checkId(l.id, p);
    if (!LINK_KINDS.includes(l.kind)) errors.push(`${p}.kind invalid`);
    if (!isFreq(l.freqMHz)) errors.push(`${p}.freqMHz must be positive`);
    if (l.audio !== undefined && (!isObj(l.audio) || !AUDIO_SOURCES.includes(l.audio.source) || !inRange(l.audio.gainDb, -SL.maxDb, SL.maxDb))) {
      errors.push(`${p}.audio must be {source: ${AUDIO_SOURCES.join('|')}, gainDb: number}`);
    }
    if (l.mpx !== undefined) {
      const m = l.mpx;
      if (!isObj(m) || typeof m.enabled !== 'boolean' || !isSafeId(m.preset)
        || !isObj(m.overrides) || typeof m.pilotSquelch !== 'boolean') {
        errors.push(`${p}.mpx must be {enabled:boolean, preset:string, overrides:object, pilotSquelch:boolean}`);
      }
    }
    if (l.telemetry !== undefined) {
      const t = l.telemetry, b = isObj(t) ? t.battery : null;
      if (!isObj(t) || typeof t.enabled !== 'boolean' || !isSafeId(t.preset) || typeof t.deviceName !== 'string'
        || !inRange(t.gainDb, -SL.maxDb, SL.maxDb) || !isObj(b) || !BATTERY_CHEMISTRY_IDS.includes(b.chemistry)
        || !(b.startPercent >= 0 && b.startPercent <= 100) || !(b.timeScale >= 0 && b.timeScale <= 1e9) || typeof b.running !== 'boolean') {
        errors.push(`${p}.telemetry must be {enabled, preset, battery:{chemistry, startPercent 0-100, timeScale >= 0, running}, deviceName, gainDb}`);
      }
    }
    if (l.modulation !== undefined) {
      const m = l.modulation, d = isObj(m) ? m.digital : null;
      if (!isObj(m) || !MODULATION_TYPES.includes(m.type) || !isObj(d) || !isSafeId(d.preset)
        || !FIXED_ORDERS.includes(d.fixedOrder) || !isObj(d.overrides)) {
        errors.push(`${p}.modulation must be {type: analog-fm|digital, digital:{preset, fixedOrder: null|2|4|16|64|256, overrides}}`);
      }
    }
    if (l.p2p !== undefined) checkP2p(l.p2p, `${p}.p2p`, errors);
    if (l.kind === 'mic' && l.branches !== undefined) errors.push(`${p}: mic links have a single antenna (no branches)`);
    if (l.splitter !== undefined && (!isObj(l.splitter) || !isSafeId(l.splitter.preset) || !isDbPos(l.splitter.insertionLossDb))) {
      errors.push(`${p}.splitter must be {preset: string, insertionLossDb >= 0}`);
    }
    if (l.branches !== undefined && l.kind === 'iem') {
      if (!Array.isArray(l.branches) || !l.branches.length) errors.push(`${p}.branches must be a non-empty array`);
      else if (l.branches.length > SL.maxBranches) errors.push(`${p}.branches has more than ${SL.maxBranches} entries`);
      else {
        const bids = new Set();
        l.branches.forEach((b, k) => {
          const bp = `${p}.branches[${k}]`;
          if (!isObj(b)) { errors.push(`${bp} must be an object`); return; }
          if (!isSafeId(b.id) || bids.has(b.id)) errors.push(`${bp}.id must be a unique short plain string`);
          else bids.add(b.id);
          checkPos(b.pos, `${bp}.pos`, errors);
          checkAntenna(b.antenna, `${bp}.antenna`, errors);
          if (!Array.isArray(b.chain)) errors.push(`${bp}.chain must be an array`);
          else if (b.chain.length > SL.maxChain) errors.push(`${bp}.chain has more than ${SL.maxChain} entries`);
          else b.chain.forEach((c, m) => checkChainItem(c, `${bp}.chain[${m}]`, errors));
        });
      }
    }
    if (l.interferer !== undefined) {
      const f = l.interferer;
      if (!isObj(f) || typeof f.enabled !== 'boolean' || !inRange(f.levelDbm, -SL.maxDb, SL.maxDb) || typeof f.hasPilot !== 'boolean' || !inRange(f.offsetKHz, -1e6, 1e6)) {
        errors.push(`${p}.interferer must be {enabled:boolean, levelDbm:number, hasPilot:boolean, offsetKHz:number}`);
      }
    }
    if (!isObj(l.tx)) errors.push(`${p}.tx must be an object`);
    else {
      checkId(l.tx.id, `${p}.tx`);
      if (!inRange(l.tx.powerDbm, -SL.maxDb, SL.maxDb)) errors.push(`${p}.tx.powerDbm must be a number`);
      checkPos(l.tx.pos, `${p}.tx.pos`, errors);
      checkAntenna(l.tx.antenna, `${p}.tx.antenna`, errors);
      checkFmTx(l.tx, `${p}.tx`, errors);
    }
    if (!isObj(l.rx)) errors.push(`${p}.rx must be an object`);
    else {
      checkId(l.rx.id, `${p}.rx`);
      if (!inRange(l.rx.sensitivityDbm, -SL.maxDb, SL.maxDb)) errors.push(`${p}.rx.sensitivityDbm must be a number`);
      if (l.rx.requiredSnrDb !== undefined && !inRange(l.rx.requiredSnrDb, -SL.maxDb, SL.maxDb)) errors.push(`${p}.rx.requiredSnrDb must be a number`);
      if (!inRange(l.rx.bodyLossDb, -SL.maxDb, SL.maxDb)) errors.push(`${p}.rx.bodyLossDb must be a number`);
      for (const k of ['antennaBiasV', 'antennaBiasMa']) if (l.rx[k] !== undefined && !inRange(l.rx[k], 0, 1000)) errors.push(`${p}.rx.${k} must be between 0 and 1000`);
      if (l.rx.squelch !== undefined) { // optional on load; migrateScene fills it in
        const q = l.rx.squelch;
        if (!isObj(q) || typeof q.enabled !== 'boolean' || !inRange(q.thresholdDbm, -SL.maxDb, SL.maxDb) || !isDbPos(q.hysteresisDb)) {
          errors.push(`${p}.rx.squelch must be {enabled:boolean, thresholdDbm:number, hysteresisDb:number >= 0}`);
        }
      }
      if (l.rx.rxPreset !== undefined && !RX_PRESET_IDS.includes(l.rx.rxPreset)) errors.push(`${p}.rx.rxPreset invalid`);
      if (l.txOf !== undefined && !(isSafeId(l.txOf) && l.txOf !== l.id)) errors.push(`${p}.txOf must be the id of another link`);
      if (l.rx.sharedAntennaOf !== undefined && !(isSafeId(l.rx.sharedAntennaOf) && l.rx.sharedAntennaOf !== l.id)) errors.push(`${p}.rx.sharedAntennaOf must be the id of another link`);
      if (l.rx.overload !== undefined) {
        const o = l.rx.overload;
        if (!isObj(o) || (o.maxInputDbm !== undefined && !isNum(o.maxInputDbm)) || (o.p1dBDbm !== undefined && !isNum(o.p1dBDbm))) {
          errors.push(`${p}.rx.overload must be an object with optional numeric maxInputDbm and p1dBDbm`);
        }
      }
      if (l.rx.diversity !== undefined) {
        const d = l.rx.diversity;
        const b = isObj(d) ? d.antennaB : null;
        if (!isObj(d) || typeof d.enabled !== 'boolean' || !DIVERSITY_MODES.includes(d.mode) || !isNum(d.hysteresisDb) || !(d.switchMs >= 0 && d.switchMs <= 1e6)
          || !isObj(b) || !isObj(b.pos) || !isNum(b.pos.x) || !isNum(b.pos.y) || !isNum(b.pos.z)) {
          errors.push(`${p}.rx.diversity must be {enabled, mode: ${DIVERSITY_MODES.join('|')}, antennaB:{pos,antenna}, hysteresisDb, switchMs}`);
        } else {
          if (b.antenna != null) checkAntenna(b.antenna, `${p}.rx.diversity.antennaB.antenna`, errors);
          if (b.orientation !== undefined && b.orientation !== null) {
            const o = b.orientation;
            if (!isObj(o) || !isNum(o.az) || !isNum(o.el) || o.az < 0 || o.az > 360 || o.el < -90 || o.el > 90) {
              errors.push(`${p}.rx.diversity.antennaB.orientation must be null or {az: 0..360, el: -90..90}`);
            }
          }
          if (b.chain !== undefined && b.chain !== null) {
            if (!Array.isArray(b.chain)) errors.push(`${p}.rx.diversity.antennaB.chain must be null or an array`);
            else if (b.chain.length > SL.maxChain) errors.push(`${p}.rx.diversity.antennaB.chain has more than ${SL.maxChain} entries`);
            else b.chain.forEach((c, m) => checkChainItem(c, `${p}.rx.diversity.antennaB.chain[${m}]`, errors));
          }
        }
      }
      checkPos(l.rx.pos, `${p}.rx.pos`, errors);
      checkAntenna(l.rx.antenna, `${p}.rx.antenna`, errors);
    }
    if (!Array.isArray(l.chain)) errors.push(`${p}.chain must be an array`);
    else if (l.chain.length > SL.maxChain) errors.push(`${p}.chain has more than ${SL.maxChain} entries`);
    else l.chain.forEach((c, j) => checkChainItem(c, `${p}.chain[${j}]`, errors)); // id is optional on load (older scenes); migrateScene fills it in
  });
  validateLocks(scene, errors);
  return { ok: errors.length === 0, errors };
}

/** See migrateScene: copy environment.polarisation onto antennas without one, then drop it. Exported for tests. */
export function migrateAntennaPolarisation(s) {
  const env = isObj(s.environment) ? s.environment : null;
  const legacy = env && POLARISATIONS.includes(env.polarisation) ? env.polarisation : 'vertical';
  const fill = (a) => {
    if (!isObj(a) || a.polarisation !== undefined) return;
    a.polarisation = isCircularType(a.type) ? defaultPolarisation(a.type) : legacy;
  };
  if (Array.isArray(s.links)) for (const l of s.links) {
    if (!isObj(l)) continue;
    if (isObj(l.tx)) fill(l.tx.antenna);
    if (isObj(l.rx)) { fill(l.rx.antenna); if (isObj(l.rx.diversity) && isObj(l.rx.diversity.antennaB)) fill(l.rx.diversity.antennaB.antenna); }
    if (Array.isArray(l.branches)) for (const b of l.branches) if (isObj(b)) fill(b.antenna);
  }
  if (env) delete env.polarisation;
}

/** Migration hook: bring an older scene up to SCHEMA_VERSION. Unknown future versions throw. */
export function migrateScene(raw) {
  if (!isObj(raw)) throw new Error('Scene must be an object');
  // cheap size guards before any per-item work (validateScene repeats them for scenes that do not come through here)
  if (Array.isArray(raw.links) && raw.links.length > SL.maxLinks) throw new Error(`Scene has more than ${SL.maxLinks} links`);
  if (Array.isArray(raw.zones) && raw.zones.length > SL.maxZones) throw new Error(`Scene has more than ${SL.maxZones} zones`);
  if (Array.isArray(raw.overheadPanels) && raw.overheadPanels.length > CEILING_LIMITS.panelsMax) throw new Error(`Scene has more than ${CEILING_LIMITS.panelsMax} overhead panels`);
  if (Array.isArray(raw.audience) && raw.audience.length > AUDIENCE_MAX) throw new Error(`Scene has more than ${AUDIENCE_MAX} audience areas`);
  if (Array.isArray(raw.crowds) && raw.crowds.length > SL.maxCrowds) throw new Error(`Scene has more than ${SL.maxCrowds} crowds`);
  if (Array.isArray(raw.platforms) && raw.platforms.length > PLATFORM_LIMITS.max) throw new Error(`Scene has more than ${PLATFORM_LIMITS.max} platforms`);
  if (Array.isArray(raw.measurements) && raw.measurements.length > MEASUREMENT_LIMITS.max) throw new Error(`Scene has more than ${MEASUREMENT_LIMITS.max} measurements`);
  if (Array.isArray(raw.noiseSources) && raw.noiseSources.length > NOISE_SOURCE_LIMITS.max) throw new Error(`Scene has more than ${NOISE_SOURCE_LIMITS.max} noise sources`);
  if (Array.isArray(raw.people) && raw.people.length > PEOPLE_LIMITS.max) throw new Error(`Scene has more than ${PEOPLE_LIMITS.max} people`);
  const s = structuredClone(raw);
  if (s.version === undefined) s.version = 1; // pre-versioned files
  if (s.version > SCHEMA_VERSION) throw new Error(`Scene version ${s.version} is newer than supported ${SCHEMA_VERSION}`);
  // Version 1 -> 2: scene.venue is new. Older files have none; a saved venue (packed shades) is unpacked into memory.
  if (s.version < 2) { delete s.venue; s.version = 2; }
  if (s.venue === null) delete s.venue;
  if (s.venue !== undefined) {
    const packed = isObj(s.venue) && Array.isArray(s.venue.layers) && s.venue.layers.some((L) => isObj(L) && Array.isArray(L.shades) && L.shades.some((sh) => isObj(sh) && typeof sh.packed === 'string'));
    if (packed) {
      const u = unpackUnderlay(s.venue);
      if (!u) throw new Error('The venue lines could not be read');
      s.venue = u;
    }
  }
  // Additive change (no version bump): every chain item carries an id.
  if (Array.isArray(s.links)) {
    for (const l of s.links) {
      if (isObj(l) && isObj(l.rx)) {
        if (l.rx.rxPreset === undefined) l.rx.rxPreset = defaultRxPreset(l.kind);
        if (l.rx.overload === undefined) l.rx.overload = {};
        if (l.rx.diversity === undefined && isObj(l.rx.pos) && isObj(l.rx.antenna)) l.rx.diversity = defaultDiversity(l.rx.pos, l.rx.antenna);
        const abc = isObj(l.rx.diversity) ? l.rx.diversity.antennaB : null;
        if (isObj(abc)) {
          if (abc.orientation === undefined) abc.orientation = null;
          if (abc.chain === undefined) abc.chain = null;
          else if (Array.isArray(abc.chain)) {
            const seenB = new Set();
            for (const c of abc.chain) {
              if (!isObj(c)) continue;
              if (typeof c.id !== 'string' || !c.id || seenB.has(c.id)) c.id = newId('ci');
              seenB.add(c.id);
            }
          }
        }
        // Older scenes stored a copy of antenna A in antenna B: an identical copy now means "same as A".
        const ab = isObj(l.rx.diversity) ? l.rx.diversity.antennaB : null;
        if (isObj(ab) && isObj(ab.antenna) && isObj(l.rx.antenna) && JSON.stringify(ab.antenna) === JSON.stringify(l.rx.antenna)) ab.antenna = null;
      }
      if (isObj(l) && l.interferer === undefined) l.interferer = defaultInterferer();
      if (isObj(l) && l.telemetry === undefined) l.telemetry = defaultTelemetry();
      if (isObj(l) && l.modulation === undefined) l.modulation = defaultModulation();
      if (isObj(l) && l.mpx === undefined) l.mpx = defaultMpx(l.kind);
      if (isObj(l) && l.audio === undefined) l.audio = { source: 'speech', gainDb: 0 };
      if (isObj(l) && isObj(l.rx) && l.rx.squelch === undefined) {
        const sens = isNum(l.rx.sensitivityDbm) ? l.rx.sensitivityDbm : -95;
        l.rx.squelch = { enabled: true, thresholdDbm: sens + 5, hysteresisDb: 3 };
      }
      if (!isObj(l) || !Array.isArray(l.chain)) continue;
      const seen = new Set();
      for (const c of l.chain) {
        if (!isObj(c)) continue;
        if (typeof c.id !== 'string' || !c.id || seen.has(c.id)) c.id = newId('ci');
        seen.add(c.id);
      }
    }
  }
  // environment.interference is optional: unset = 'none' (older scenes unchanged); null is treated as unset.
  if (isObj(s.environment) && s.environment.interference === null) delete s.environment.interference;
  if (s.imd === undefined) s.imd = createDefaultImd();
  if (isObj(s.imd) && Array.isArray(s.imd.transmitters)) for (const t of s.imd.transmitters) if (isObj(t) && (typeof t.id !== 'string' || !t.id)) t.id = newId('imdtx');
  if (isObj(s.stage) && s.stage.heightM === undefined) s.stage.heightM = 0;
  if (s.platforms === undefined) s.platforms = [];
  // platform rotationDeg is optional (unset = 0): null is dropped, a finite value is wrapped into (-180, 180], anything else dropped.
  if (Array.isArray(s.platforms)) for (const pl of s.platforms) {
    if (!isObj(pl) || pl.rotationDeg === undefined) continue;
    if (!isNum(pl.rotationDeg)) delete pl.rotationDeg;
    else if (pl.rotationDeg < -180 || pl.rotationDeg > 180) { const w = ((((pl.rotationDeg + 180) % 360) + 360) % 360) - 180; pl.rotationDeg = w === -180 ? 180 : w; }
  }
  // Polarisation is per antenna only: a legacy scene-level environment.polarisation is copied onto every link antenna that has none
  // (Tx, Rx, diversity B, branches) and dropped; antennas still without one become 'vertical' (circular types 'rhcp').
  migrateAntennaPolarisation(s);
  if (s.zones === undefined) s.zones = [];
  for (const z of s.zones) if (isObj(z) && z.passAreaFraction === undefined) z.passAreaFraction = DEFAULT_PASS_AREA_FRACTION;
  if (s.coverage === undefined) s.coverage = { mode: 'power' };
  // Item 34: a video wall (reflector.noise) also appears as a noise source of kind video-wall, linked by reflectorId. The wall block is unchanged
  // and stays the single source of truth (counted once in result.wallNoise); the source gives the wall its place in the Noise sources list and a mute.
  if (Array.isArray(s.reflectors) && s.reflectors.some((r) => isObj(r) && isObj(r.noise))) {
    const add = wallNoiseSourcesFromReflectors(s);
    if (add.length && (!Array.isArray(s.noiseSources) || s.noiseSources.length + add.length <= NOISE_SOURCE_LIMITS.max)) s.noiseSources = [...(Array.isArray(s.noiseSources) ? s.noiseSources : []), ...add];
  }
  // Names (item 2): control characters removed, trimmed, cut to the limit; a name that is already clean is not touched.
  if (Array.isArray(s.reflectors)) for (const r of s.reflectors) if (isObj(r) && r.name !== undefined) { const n = sanitizeName(r.name, NAME_LIMITS.reflector, 'Reflector'); if (n !== r.name) r.name = n; }
  if (Array.isArray(s.people)) for (const pe of s.people) if (isObj(pe) && pe.name !== undefined) { const n = sanitizeName(pe.name, NAME_LIMITS.person, 'Person'); if (n !== pe.name) pe.name = n; }
  if (Array.isArray(s.noiseSources)) for (const n0 of s.noiseSources) if (isObj(n0) && n0.name !== undefined) { const n = sanitizeName(n0.name, NAME_LIMITS.noiseSource, 'Noise source'); if (n !== n0.name) n0.name = n; }
  if (Array.isArray(s.crowds)) for (const c0 of s.crowds) if (isObj(c0) && c0.name !== undefined) { const n = sanitizeName(c0.name, CROWD_LIMITS.nameChars, 'Crowd'); if (n !== c0.name) c0.name = n; }
  if (Array.isArray(s.people)) prunePeople(s); // item 36: no reference to a link that is gone, wrong or already owned
  syncScene(s);
  // while (s.version < SCHEMA_VERSION) { apply step; s.version++ }
  return s;
}

export function serialize(scene) {
  // the venue is stored packed (about 10 characters per line); in memory it stays as number arrays
  if (scene && scene.venue !== undefined && scene.venue !== null) return JSON.stringify({ ...scene, venue: packUnderlay(scene.venue) }, null, 2);
  return JSON.stringify(scene, null, 2);
}

/** Parse JSON text, migrate and validate. Throws Error with a readable message on failure. */
export function deserialize(text) {
  if (typeof text !== 'string') throw new Error('Scene text must be a string');
  if (text.length > SCENE_LIMITS.maxText) throw new Error('Scene is too large');
  let raw;
  // keys that could reach Object.prototype are dropped at every depth (a plain JSON.parse keeps an own "__proto__" key)
  try { raw = JSON.parse(text, (key, value) => (key === '__proto__' || key === 'constructor' || key === 'prototype' ? undefined : value)); } catch (e) { throw new Error(`Invalid JSON: ${e.message}`); }
  const scene = migrateScene(raw);
  const { ok, errors } = validateScene(scene);
  if (!ok) throw new Error(`Invalid scene: ${errors.join('; ')}`);
  return scene;
}
