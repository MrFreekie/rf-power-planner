// Example scenes: each builds a complete scene plus a short explanation. Pure (no DOM).
//   EXAMPLES: [{ id, title, note, build() -> { scene, walk?: { to, speedMps, pingPong }, select? } }]
//   getExample(id), buildExample(id) -> { id, title, note, scene, walk, selectId }
import { applyFmPreset } from './model/fm-presets.js';
import { solveLink, chainLossDb } from './model/rf.js';
import { overloadStep } from './model/overload.js';
import { modeReport } from './model/digital-link.js';
import { sweepLink } from './model/diversity.js';
import { confidenceSummary } from './model/assumptions-in-use.js';
import { squelchState } from './model/squelch.js';
import { RX_PRESETS } from './model/rx-params.js';
import { imdSummary, evenOrderImd } from './model/imd.js';
import { toneMpxReport } from './model/tone-mpx.js';
import { createPerson, personLinkName, offsetFromPack, rotateOffset, personPackPositions, DEFAULT_MIC_OFFSET, DEFAULT_IEM_OFFSET } from './model/people.js';
import { wallNoiseSourcesFromReflectors, createNoiseSource, engCrewSources, noiseSourceAt, noiseEvents } from './model/noise-sources.js';
import { tvChannelList, tvChannelOf, TV_OCCUPIED_MHZ } from './model/spectrum-map.js';
import { createDefaultScene, createDefaultLink, createChainItem, createReflector, createBranch, createZone, createDefaultImd, createImdTransmitter, createPlatform, createAudience, createCeiling, createChainItemFromPreset, newId, syncScene, migrateAntennaPolarisation } from './model/scene.js';

const omni = (el = 90, polarisation = 'vertical') => ({ type: 'omni', gainDbi: 0, orientation: { az: 0, el }, polarisation });

/** Base scene with a single link of the given kind; `fn(scene, link)` customises it. */
function make(kind, fn) {
  const scene = createDefaultScene();
  scene.environment.externalNoise = 0; // examples quote margins without external noise; a note or fn may set it on purpose
  scene.links = [createDefaultLink(kind)];
  fn(scene, scene.links[0]);
  if (scene.stage.heightM === undefined) scene.stage.heightM = 0;
  migrateAntennaPolarisation(scene); // every link antenna carries an explicit polarisation
  const wallSources = wallNoiseSourcesFromReflectors(scene); // a video wall is also a noise source (item 34), as migrateScene would add it
  if (wallSources.length) scene.noiseSources = [...(scene.noiseSources || []), ...wallSources];
  return syncScene(scene);
}

/** Two-ray geometry used by several examples: omni antennas over a hard floor, horizontal polarisation (set per antenna). */
function twoRay(scene, link) {
  scene.environment.floor = 'concrete';
  link.name = 'Mic 1';
  link.tx.antenna = omni(90, 'horizontal'); // horizontal polarisation: TE reflections, the fades differ from vertical
  link.rx.antenna = omni(90, 'horizontal');
  link.rx.pos = { x: 11, y: 6.5, z: 1.0 };
  link.tx.pos = { x: 8, y: 6.5, z: 1.75 };
  link.rx.squelch = { enabled: true, thresholdDbm: -42, hysteresisDb: 2 };
  link.rx.diversity.antennaB = { pos: { x: 11, y: 6.5, z: 1.4 }, antenna: null, chain: null, orientation: null }; // antenna null = same as antenna A, chain null = same cable run as A
}


/** Same stage, same 10 m link, same omni antennas and 5 m of RG58 on the receive side: only the carrier frequency differs. */
function sameStage(scene, link, freqMHz) {
  scene.environment.floor = 'wood';
  link.freqMHz = freqMHz;
  link.tx.antenna = omni();
  link.rx.antenna = omni();
  link.tx.pos = { x: 1, y: 4, z: 1.5 };
  link.rx.pos = { x: 11, y: 4, z: 1.0 };
  link.rx.diversity.antennaB.pos = { x: 11, y: 3.4, z: 1.0 };
  link.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 })];
}

const SAME_STAGE_WALK = { to: { x: 1, y: 4, z: 1.5 }, speedMps: 0.8, pingPong: true };

const ACROSS = { to: { x: 0.5, y: 6.5, z: 1.75 }, speedMps: 0.8, pingPong: true };

function outdoorIem(scene, link) {
  scene.stage = { width: 120, depth: 80 };
  link.tx.pos = { x: 115, y: 5, z: 1.2 };
  link.rx.pos = { x: 113, y: 6, z: 1.0 };
  link.rx.diversity.antennaB.pos = { x: 112.4, y: 6, z: 1.0 };
  link.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 }), createChainItem('attenuator', { lossDb: 35 })];
  link.rx.squelch = { enabled: true, thresholdDbm: -125, hysteresisDb: 3 };
}

function outdoorMic(scene, link) {
  scene.stage = { width: 120, depth: 80 };
  link.rx.pos = { x: 115, y: 5, z: 2.5 };
  link.rx.diversity.antennaB.pos = { x: 114.4, y: 5, z: 2.5 };
  link.tx.pos = { x: 113, y: 6, z: 1.5 };
  link.chain = [createChainItem('attenuator', { lossDb: 40 }), createChainItem('cable', { cableType: 'rg58', lengthM: 5 })];
  link.rx.squelch = { enabled: true, thresholdDbm: -104, hysteresisDb: 3 };
}

/** IEM combiner examples: a 30 x 20 m hall, transmitters together at the left, the bodypack far down the hall. */
function iemHall(s, l, m) {
  s.stage = { width: 30, depth: 20 };
  l.rx.pos = { x: 22, y: 12, z: 1.2 };
  m.rxAntennaPos = { x: 22, y: 12, z: 1.2 };
  m.rxAntenna = { type: 'omni', gainDbi: -3, orientation: { az: 0, el: 90 } };
  m.transmitters.forEach((t, i) => { t.pos = { x: 3 + i * 0.2, y: 10, z: 1.5 }; });
}

/**
 * Antenna band mismatch examples (group i). bandScene(id, opts) builds the six scenes; every design band and loss is an ASSUMED round
 * number for teaching (antenna-band.js), not product data. The notes quote figures recomputed in tests/antenna-band.test.mjs.
 *   'whip-wrong-band':    mic at 830 MHz, receive whip cut for 470-520 (opts.right = true: a whip cut for 790-865 instead)
 *   'uhf-vs-2g4':         600 MHz mic with a 2.4 GHz receive antenna (opts.reverse: a 2.4 GHz link with a UHF 600-700 antenna)
 *   'iem-tx-wrong-band':  606.1 MHz IEM Tx into an antenna cut for 863-865: reflected power; opts.isolator = 0.5 dB / 20 dB isolator, opts.pad = 6 dB pad
 *   'wideband-vs-whips':  830 MHz mic, wideband receive antenna (470-960) against a whip cut for 470-520
 *   'whip-trim':          606 MHz mic, whip cut for 570-608 (opts.trimmed = true: cut for 596-616)
 *   'filter-wrong-band':  IEM at 606.1 MHz through a bandpass filter for 863-865 in the transmit chain (opts.right = a 590-640 filter)
 */
export const BAND_EXAMPLE_FREQ_MHZ = { 'whip-wrong-band': 830, 'uhf-vs-2g4': 600, 'iem-tx-wrong-band': 606.1, 'wideband-vs-whips': 830, 'whip-trim': 606, 'filter-wrong-band': 606.1 };
export function bandScene(id, { right = false, reverse = false, isolator = false, pad = false, trimmed = false } = {}) {
  const hall = (s, l, f) => {
    s.stage = { width: 30, depth: 20 };
    s.environment.floor = 'wood';
    l.freqMHz = f;
    l.tx.pos = { x: 3, y: 10, z: 1.5 };
    l.rx.pos = { x: 13, y: 10, z: 1.2 };
    l.rx.diversity.antennaB.pos = { x: 13, y: 9.4, z: 1.2 };
  };
  const whip = (band) => ({ type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 }, designBand: band });
  switch (id) {
    case 'whip-wrong-band': return make('mic', (s, l) => { hall(s, l, 830); l.tx.antenna = omni(); l.rx.antenna = whip(right ? 'uhf-800' : 'uhf-470-520'); l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 })]; });
    case 'uhf-vs-2g4': return make('mic', (s, l) => {
      hall(s, l, reverse ? 2440 : 600); l.tx.antenna = omni();
      l.rx.antenna = whip(reverse ? 'uhf-600-700' : 'ism-2400');
      l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 2 })];
    });
    case 'iem-tx-wrong-band': return make('iem', (s, l) => {
      hall(s, l, 606.1); l.tx.powerDbm = 20; // 100 mW
      l.tx.antenna = whip('srd-863-865'); l.rx.antenna = { type: 'body', gainDbi: -3, orientation: { az: 0, el: 90 } };
      l.chain = [];
      if (isolator) l.chain.push(createChainItem('attenuator', { lossDb: 0.5, reverseIsolationDb: 20 }));
      if (pad) l.chain.push(createChainItem('attenuator', { lossDb: 6 }));
    });
    case 'wideband-vs-whips': return make('mic', (s, l) => { hall(s, l, 830); l.tx.antenna = omni(); l.rx.antenna = whip('tv-wide'); l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 })]; });
    case 'whip-trim': return make('mic', (s, l) => { hall(s, l, 606); l.tx.antenna = omni(); l.rx.antenna = whip(trimmed ? { loMHz: 596, hiMHz: 616, label: 'trimmed whip 596-616 MHz (assumed)' } : 'uhf-570-608'); l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 })]; });
    case 'filter-wrong-band': return make('iem', (s, l) => {
      hall(s, l, 606.1); l.tx.powerDbm = 20; l.tx.antenna = omni(); l.rx.antenna = { type: 'body', gainDbi: -3, orientation: { az: 0, el: 90 } };
      l.chain = [createChainItem('filter', right ? { lossDb: 1.5, filterType: 'bandpass', passLoMHz: 590, passHiMHz: 640, rejectionDb: 40 } : { lossDb: 1.5, filterType: 'bandpass', passLoMHz: 863, passHiMHz: 865, rejectionDb: 40 })];
    });
    default: return null;
  }
}

/**
 * Audience example (group e): a handheld microphone on stage, the receive antenna across a standing crowd at the back of a 20 x 40 m
 * room. opts.rxZ = receive antenna height (1.5 m default = head height, below the 1.7 m heads: the ray runs through the crowd;
 * 2.5 m = raised, mostly above it); opts.densityPerM2 (default 2, ASSUMED absorption model of audience.js); opts.kind 'standing'|'seated'.
 */
export function audienceScene({ rxZ = 1.5, densityPerM2 = 2, kind = 'standing', withAudience = true } = {}) {
  return make('mic', (s, l) => {
    s.stage = { width: 20, depth: 40 };
    s.environment.floor = 'wood';
    l.freqMHz = 606;
    l.tx.antenna = omni(); l.rx.antenna = omni();
    l.tx.pos = { x: 10, y: 5, z: 1.5 };
    l.rx.pos = { x: 10, y: 35, z: rxZ };
    l.rx.diversity.antennaB.pos = { x: 10.6, y: 35, z: rxZ };
    l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 })];
    if (withAudience) s.audience = [createAudience({ name: 'Standing area', x: 4, y: 10, width: 12, depth: 20, kind, densityPerM2 })];
  });
}

/**
 * Ceiling examples (group f): the same 606 MHz handheld link under three kinds of roof. ceilingScene(id, { withCeiling = true }).
 *   'tent': a metal-roofed shed / tent frame, roof 5 m, link 15 m, antennas at head height.
 *   'arena': an arena roof at 15 m (metal), receive antenna flown at 12 m over the audience, transmitter on stage at 1.6 m, 30 m.
 *   'club': a low plasterboard club ceiling at 2.8 m, 12 m link.
 */
export function ceilingScene(id, { withCeiling = true } = {}) {
  const cfg = {
    tent: { h: 5, mat: 'metal', d: 15, txz: 1.6, rxz: 1.2, w: 24 },
    arena: { h: 15, mat: 'metal', d: 30, txz: 1.6, rxz: 12, w: 40 },
    club: { h: 2.8, mat: 'plasterboard', d: 12, txz: 1.6, rxz: 1.2, w: 20 },
  }[id];
  if (!cfg) return null;
  return make('mic', (s, l) => {
    s.stage = { width: cfg.w, depth: 20 };
    s.environment.floor = 'concrete';
    l.freqMHz = 606;
    l.tx.antenna = omni(); l.rx.antenna = omni();
    l.tx.pos = { x: 2, y: 10, z: cfg.txz };
    l.rx.pos = { x: 2 + cfg.d, y: 10, z: cfg.rxz };
    l.rx.diversity.antennaB.pos = { x: 2 + cfg.d, y: 9.4, z: cfg.rxz };
    l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 })];
    if (withCeiling) s.ceiling = createCeiling({ heightM: cfg.h, material: cfg.mat });
  });
}

/**
 * RF over fibre examples (group g). rofScene(variant, { fibreKm }): a 606 MHz microphone received through a 300 m run from the antenna
 * head to the receiver rack: 'coax' = RG213 coax (assumed loss from the cable table), 'passive' = chain preset rof-passive-1km at
 * fibreKm, 'active' = rof-active-lna at fibreKm. All RoF figures are ASSUMED placeholders (UNVERIFIED presets).
 * rofBranchScene({ fibreKmB }): an IEM with two antenna branches, fibre 0.1 km and fibreKmB (0.6 default): delay mismatch warning.
 */
export function rofScene(variant, { fibreKm = 0.3 } = {}) {
  return make('mic', (s, l) => {
    s.stage = { width: 60, depth: 20 };
    s.environment.floor = 'concrete';
    l.freqMHz = 606;
    l.tx.antenna = omni(); l.rx.antenna = omni();
    l.tx.pos = { x: 55, y: 10, z: 1.5 };
    l.rx.pos = { x: 45, y: 10, z: 3 };
    l.rx.diversity.antennaB.pos = { x: 45, y: 9.4, z: 3 };
    l.chain = variant === 'coax' ? [createChainItem('cable', { cableType: 'rg213', lengthM: fibreKm * 1000 })]
      : [createChainItemFromPreset(variant === 'active' ? 'rof-active-lna' : 'rof-passive-1km', { fibreKm })];
  });
}
export function rofBranchScene({ fibreKmB = 0.6 } = {}) {
  return make('iem', (s, l) => {
    s.stage = { width: 40, depth: 20 };
    l.freqMHz = 606.1;
    l.tx.pos = { x: 2, y: 10, z: 2.5 };
    l.rx.pos = { x: 25, y: 10, z: 1.2 };
    l.tx.pos = { x: 2, y: 4, z: 2.5 };
    l.chain = [createChainItemFromPreset('rof-passive-1km', { fibreKm: 0.1 })]; // branch 1 mirrors the link transmitter and chain
    l.branches = [
      createBranch({ name: 'Antenna 1', pos: { x: 2, y: 4, z: 2.5 }, chain: [createChainItemFromPreset('rof-passive-1km', { fibreKm: 0.1 })] }),
      createBranch({ name: 'Antenna 2', pos: { x: 2, y: 16, z: 2.5 }, chain: [createChainItemFromPreset('rof-passive-1km', { fibreKm: fibreKmB })] }),
    ];
  });
}

/**
 * Point-to-point link examples (group h). p2pScene(id, opts); all positions in metres on a flat datum, antennas aimed at each other.
 *   'snake':   a wireless snake send across a field: 1.2 km, yagis on 6 m masts, 606 MHz (opts.mastM changes both heights).
 *   'delay':   FOH to a stage-left delay speaker: 150 m, paddles at 3 m.
 *   'truck':   broadcast truck to a remote camera: 8 km, yagis at 12 m and 6 m, with a hill (opts.hill = false removes it).
 *   'bodypack': two bodypacks as a wireless line feed: 60 m, whips (body type) at 1.5 m, nobody wearing them (no body loss).
 */
export function p2pScene(id, { mastM, hill = true } = {}) {
  const cfg = {
    snake: { f: 606, d: 1200, ht: 6, hr: 6, ant: 'yagi', pw: 20, obstacle: null },
    delay: { f: 606, d: 150, ht: 3, hr: 3, ant: 'paddle', pw: 17, obstacle: null },
    truck: { f: 606, d: 8000, ht: 12, hr: 6, ant: 'yagi', pw: 30, obstacle: hill ? { distanceM: 3000, heightM: 30 } : null },
    bodypack: { f: 606, d: 60, ht: 1.5, hr: 1.5, ant: 'body', pw: 10, obstacle: null },
  }[id];
  if (!cfg) return null;
  return make('p2p', (s, l) => {
    s.stage = { width: 500, depth: 500 };
    s.environment.model = 'free-space';
    s.environment.floor = 'grass';
    l.freqMHz = cfg.f;
    const ht = mastM !== undefined ? mastM : cfg.ht, hr = mastM !== undefined ? mastM : cfg.hr;
    l.tx.pos = { x: 100, y: 100, z: ht }; l.rx.pos = { x: 100 + cfg.d, y: 100, z: hr };
    l.rx.diversity.antennaB.pos = { x: 100 + cfg.d, y: 99.4, z: hr };
    l.tx.powerDbm = cfg.pw;
    const ant = (az) => ({ type: cfg.ant, gainDbi: ANTENNAS_GAIN[cfg.ant], orientation: cfg.ant === 'body' ? { az: 0, el: 90 } : { az, el: 0 }, polarisation: 'vertical' });
    l.tx.antenna = ant(90); l.rx.antenna = ant(270);
    l.rx.bodyLossDb = 0;
    l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 10 })];
    if (cfg.obstacle) l.p2p = { kFactor: 4 / 3, obstacle: cfg.obstacle, fadeMarginDb: 10 };
    else l.p2p = { kFactor: 4 / 3, fadeMarginDb: 10 };
  });
}
/**
 * Side-of-stage mix position (a 4 x 3 m area at x 0..4, y 0..3; the stage is towards +y): one IEM transmitter and a diversity pair of mic
 * receive antennas a few metres apart. sosScene(id) builds three scenes, all free-space so the coupling is Friis plus the antenna patterns:
 *   'too-close':   IEM paddle 0.5 m from the mic receive paddle, facing each other, same polarisation, a booster on the mic side, 20 dBm.
 *   'crossed-pol': 3.3 m apart, IEM vertical, mic antennas slant 45 degrees, both paddles aimed at the stage so each sits in the other's side
 *                  lobe, a rack screen in between (wood-class, assumed), no booster, 17 dBm.
 *   'best':        IEM paddle on a stand at the stage-side edge aiming at the stage, mic paddles forward and high on a stand (remote, 15 m of
 *                  cable) with the IEM antenna behind them, a 604-608 MHz bandpass filter (40 dB rejection, assumed) on the mic path, 10 dBm.
 * The wanted mic (606.1 MHz, 14 dBm, on stage) and the IEM link (614.0 MHz) are links[0] and links[1]; scene.imd holds the IEM and the mic as
 * the two tones for the products. Receiver figures are the illustrative 'mic-receiver-typical' preset (P1dB -18, max input -10, IIP3 -8 dBm).
 */
export function sosScene(id) {
  const paddle = (az, polarisation) => ({ type: 'paddle', gainDbi: 7, orientation: { az, el: 0 }, polarisation });
  const cfg = {
    'too-close': { iemPos: { x: 1.5, y: 1.5, z: 1.5 }, iemAnt: paddle(90, 'vertical'), pw: 20,
      rxA: { x: 2.0, y: 1.5, z: 1.5 }, rxB: { x: 2.0, y: 2.2, z: 1.5 }, rxAz: 270, rxPol: 'vertical',
      chain: () => [createChainItem('booster', { gainDb: 12, nfDb: 4 }), createChainItem('cable', { cableType: 'rg58', lengthM: 3 })], wall: false },
    'crossed-pol': { iemPos: { x: 3.5, y: 1.0, z: 1.5 }, iemAnt: paddle(0, 'vertical'), pw: 17,
      rxA: { x: 0.2, y: 0.5, z: 1.5 }, rxB: { x: 0.2, y: 1.4, z: 1.5 }, rxAz: 0, rxPol: 'slant45',
      chain: () => [createChainItem('cable', { cableType: 'rg58', lengthM: 3 })], wall: true },
    best: { iemPos: { x: 3.5, y: 2.8, z: 1.8 }, iemAnt: paddle(0, 'vertical'), pw: 10,
      rxA: { x: -7.0, y: 0.8, z: 3.0 }, rxB: { x: -6.0, y: 0.8, z: 3.0 }, rxAz: 0, rxPol: 'slant45',
      chain: () => [createChainItem('filter', { lossDb: 1.5, filterType: 'bandpass', passLoMHz: 604, passHiMHz: 608, rejectionDb: 40 }), createChainItem('cable', { cableType: 'lmr-240', lengthM: 15 })], wall: false },
  }[id];
  if (!cfg) return null;
  return make('mic', (s, l) => {
    s.stage = { width: 20, depth: 14 };
    const P = (q) => ({ ...q, x: q.x + 8 }); // the mix position is at x 8..12 so the remote antennas stay on the plan
    s.environment.model = 'free-space';
    l.name = 'Wanted mic'; l.freqMHz = 606.1;
    l.tx.pos = P({ x: 4, y: 10, z: 1.5 }); l.tx.powerDbm = 14;
    const rxAnt = () => paddle(cfg.rxAz, cfg.rxPol);
    l.rx.pos = P(cfg.rxA); l.rx.antenna = rxAnt();
    l.rx.diversity.enabled = true; l.rx.diversity.antennaB.pos = P(cfg.rxB);
    l.chain = cfg.chain();
    const iem = createDefaultLink('iem');
    iem.name = 'IEM'; iem.freqMHz = 614.0;
    iem.tx.pos = P(cfg.iemPos); iem.tx.powerDbm = cfg.pw; iem.tx.antenna = structuredClone(cfg.iemAnt);
    iem.rx.pos = P({ x: 7, y: 10, z: 1.5 });
    s.links.push(iem);
    if (cfg.wall) s.reflectors = [createReflector({ name: 'Rack screen', material: 'wood', p1: { x: 9.7, y: 0.2 }, p2: { x: 9.7, y: 1.7 }, zMin: 0, zMax: 2 })];
    const m = createDefaultImd();
    m.enabled = true; m.iip3Dbm = RX_PRESETS['mic-receiver-typical'].iip3Dbm;
    m.rxAntennaPos = P(cfg.rxA); m.rxAntenna = rxAnt(); m.rxChain = structuredClone(l.chain);
    m.transmitters = [
      createImdTransmitter({ name: 'IEM transmitter', freqMHz: 614.0, powerDbm: cfg.pw, pos: P(cfg.iemPos), antenna: structuredClone(cfg.iemAnt) }),
      createImdTransmitter({ name: 'Wanted mic', freqMHz: 606.1, powerDbm: 14, pos: P({ x: 4, y: 10, z: 1.5 }), antenna: omni(90) }),
    ];
    s.imd = m;
  });
}

/**
 * sosReport(scene) -> { iemFreqMHz, iemPowerDbm, antennas: [{ name, distanceM, couplingDb, atAntennaDbm, atRxInputDbm, headroomDb, level,
 *   compressionDb, desenseDb, wantedMarginDb, marginAfterDesenseDb }], worstProductDbm, wantedToProductDb, iemMarginDb }
 * couplingDb = IEM output power minus the power at the mic antenna terminals (Friis with both antenna patterns, polarisation, walls: 40 dB
 * means 40 dB of isolation). atRxInputDbm is after the mic-side chain (booster, filter, cable). headroomDb is to min(P1dB, max input).
 */
export function sosReport(scene) {
  const mic = scene.links[0], iem = scene.links[1];
  const f = iem.freqMHz;
  const cfgRx = { ...RX_PRESETS[mic.rx.rxPreset], ...(mic.rx.overload || {}), chain: mic.chain, freqMHz: f };
  const ants = [{ name: 'Mic Rx antenna A', pos: mic.rx.pos, antenna: mic.rx.antenna }, { name: 'Mic Rx antenna B', pos: mic.rx.diversity.antennaB.pos, antenna: mic.rx.diversity.antennaB.antenna || mic.rx.antenna }];
  const antennas = ants.map((a) => {
    const probe = { id: 'sos-probe', kind: 'mic', freqMHz: f, tx: { pos: iem.tx.pos, powerDbm: iem.tx.powerDbm, antenna: iem.tx.antenna }, rx: { pos: a.pos, antenna: a.antenna, bodyLossDb: 0, sensitivityDbm: -120 }, chain: mic.chain };
    const r = solveLink(scene, probe);
    const atRxInputDbm = r.rxPowerDbm - chainLossDb(mic.chain, f);
    const ov = overloadStep(null, atRxInputDbm, cfgRx);
    const wp = { ...mic, rx: { ...mic.rx, pos: a.pos, antenna: a.antenna, diversity: { ...mic.rx.diversity, enabled: false } } };
    const w = solveLink(scene, wp);
    return { name: a.name, distanceM: r.distanceM, couplingDb: iem.tx.powerDbm - r.rxPowerDbm, atAntennaDbm: r.rxPowerDbm, atRxInputDbm, headroomDb: ov.headroomDb, level: ov.level, compressionDb: ov.compressionDb, desenseDb: ov.desenseDb, wantedMarginDb: w.marginDb, marginAfterDesenseDb: w.marginDb - ov.desenseDb };
  });
  const sum = imdSummary(scene);
  const ir = solveLink(scene, iem);
  return { iemFreqMHz: f, iemPowerDbm: iem.tx.powerDbm, antennas, worstProductDbm: sum.worstProduct ? sum.worstProduct.levelDbm : null, wantedToProductDb: sum.worstWantedToProductDb, iemMarginDb: ir.marginDb };
}

/**
 * Front-of-house (FOH) mic and IEM antennas with an audience between FOH and the stage. fohScene(variant, { kind, densityPerM2, remote }):
 *   'low':    antennas at table height (1.2 m) at FOH, directional (7 dBi paddles) aimed at the stage, 26 m from the performer, over a standing crowd.
 *   'raised': the same antennas on stands or a truss at 3.0 m, aimed at the stage: the ray clears the heads for most of the crowd.
 *   'remote': antennas at the stage side (3.0 m, 9 m from the performer, outside the crowd) with 45 m of LMR-400 back to FOH.
 *             opts.remote: 'coax' (default: a 15 dB booster at the antenna end, ahead of the cable), 'booster-at-rack' (same booster after the
 *             cable: the wrong place), 'rof' (the active RF over fibre preset, 0.05 km). The IEM transmit path never gets a booster (power limit).
 * Crowd: scene.audience, 5..25 m x 8..26 m. Standing 3-5 persons per m2, seated 1-2 (opts.density default 4 standing / 1.5 seated); the
 * absorption (0.5 dB per metre per person-per-m2 below head height, capped at 30 dB) is an ASSUMED planning figure. Links: links[0] mic (stage
 * transmitter to FOH receiver, 606.1 MHz), links[1] IEM (FOH transmitter to the bodypack on stage, 614.0 MHz).
 */
export function fohScene(variant, { kind = 'standing', densityPerM2, remote = 'coax' } = {}) {
  if (!['low', 'raised', 'remote'].includes(variant)) return null;
  const density = densityPerM2 !== undefined ? densityPerM2 : kind === 'seated' ? 1.5 : 4;
  return make('mic', (s, l) => {
    s.stage = { width: 30, depth: 40 };
    s.environment.floor = 'wood';
    // the performer's body shadow (3 dB, assumed) is set on the mic link only: the IEM bodypack antenna is a body-type antenna that already includes its wearer
    s.audience = [createAudience({ name: kind === 'seated' ? 'Seated crowd' : 'Standing crowd', x: 5, y: 8, width: 20, depth: 18, kind, densityPerM2: density })];
    const z = variant === 'low' ? 1.2 : 3.0;
    const stagePos = { x: 15, y: 4, z: 1.6 };
    const at = variant === 'remote' ? { x: 6, y: 6, z: 3.0 } : { x: 15, y: 30, z };
    const az = variant === 'remote' ? Math.round((Math.atan2(stagePos.x - at.x, stagePos.y - at.y) * 180) / Math.PI) : 180;
    const pad = () => ({ type: 'paddle', gainDbi: 7, orientation: { az, el: 0 }, polarisation: 'vertical' });
    l.name = 'Mic (stage to FOH)'; l.freqMHz = 606.1;
    l.tx.pos = { ...stagePos }; l.tx.powerDbm = 14; l.tx.antenna = { type: 'quarterwave', gainDbi: 1, orientation: { az: 0, el: 90 }, polarisation: 'vertical' };
    l.rx.pos = { ...at }; l.rx.antenna = pad(); l.rx.bodyLossDb = 3;
    l.rx.diversity.enabled = true; l.rx.diversity.antennaB.pos = { x: at.x + 0.6, y: at.y, z: at.z };
    const remoteChain = () => {
      // a 12 dB pad at the receiver input: without it the booster and the active fibre leave the receiver within 1 to 3 dB of P1dB (hot)
      const pad = () => createChainItem('attenuator', { lossDb: 12 });
      if (remote === 'rof') return [createChainItemFromPreset('rof-active-lna', { fibreKm: 0.05 }), pad()];
      const boost = createChainItem('booster', { gainDb: 15, nfDb: 3 }), cab = createChainItem('cable', { cableType: 'lmr-400', lengthM: 45 });
      return remote === 'booster-at-rack' ? [cab, boost, pad()] : [boost, cab, pad()];
    };
    l.chain = variant === 'remote' ? remoteChain() : [createChainItem('cable', { cableType: 'lmr-400', lengthM: 5 })];
    const iem = createDefaultLink('iem');
    iem.name = 'IEM (FOH to stage)'; iem.freqMHz = 614.0;
    iem.tx.pos = { ...at }; iem.tx.powerDbm = 17; iem.tx.antenna = pad();
    iem.rx.pos = { x: 14, y: 4, z: 1.2 };
    iem.chain = [createChainItem('cable', { cableType: 'lmr-400', lengthM: variant === 'remote' ? 45 : 5 })];
    s.links.push(iem);
  });
}

/**
 * fohReport(scene) -> { mic, iem }, each { distanceM, rxPowerDbm (at the antenna terminals), inputPowerDbm (at the receiver input), marginDb,
 * audienceLossDb (the 'Audience absorption' step, positive), chainLossDb (net cable and booster loss, negative = gain) }.
 */
export function fohReport(scene) {
  const one = (l) => {
    const r = solveLink(scene, l);
    const a = r.waterfall.find((w) => /^Audience absorption/.test(w.label));
    return { distanceM: r.distanceM, rxPowerDbm: r.rxPowerDbm, inputPowerDbm: r.inputPowerDbm, marginDb: r.marginDb, audienceLossDb: a ? -a.deltaDb : 0, chainLossDb: chainLossDb(l.chain, l.freqMHz) };
  };
  return { mic: one(scene.links[0]), iem: one(scene.links[1]) };
}

/**
 * Video (LED) wall examples (item 25 / 25a). videoWallScene({ preset, construction, holeSizeMm, rx, txBehind }) builds one stage: a 14 m x 5 m wall
 * (reflector, material by construction, facing the audience) at y = 3 behind the band, the performer's mic 5 m in front of it, 606.1 MHz, one link.
 *   rx 'foh':  paddle (7 dBi) at FOH, 27 m from the wall, aimed at the stage (so it looks at the wall's front: the worst case for noise).
 *   rx 'near': paddle 3 m in front of the wall at the stage front, aimed at the performer.
 *   rx 'side': paddle stage left, 7 m from the wall, aimed at the performer, the wall at its side.
 *   rx 'back': paddle backstage 2.5 m BEHIND the wall (rear side of the wall, the wall is in the direct path), aimed at the performer.
 *   txBehind: the performer's transmitter is 1 m BEHIND the wall (through-wall case: the wall is in the direct path).
 * preset: noise preset ('off', 'class-b', 'class-a', 'noisy'); construction: solid-metal | solid-plastic | mesh-metal | mesh-plastic | mesh-carbon.
 * sections: an array of constructions, for example ['solid-metal', 'mesh-metal', 'mesh-carbon']: one wall section and one mic link per entry, side by side
 * 16 m apart on a wider stage, each link with its own receiver (use rx 'back' to compare through-wall loss). links[i] belongs to sections[i]; the
 * sections all use `preset`, so each receiver also hears the other two walls (that cross-talk is part of the figures).
 * All wall figures are assumed (ledwall.js).
 */
export function videoWallScene({ preset = 'class-a', construction = 'solid-metal', holeSizeMm, rx = 'foh', txBehind = false, sections } = {}) {
  const rxCfg = { foh: { pos: { x: 15, y: 30, z: 1.5 }, az: 180 }, near: { pos: { x: 15, y: 6, z: 1.5 }, az: 0 }, side: { pos: { x: 3, y: 14, z: 1.5 }, az: 116 }, back: { pos: { x: 15, y: 0.5, z: 1.5 }, az: 0 } }[rx];
  if (!rxCfg) return null;
  return make('mic', (s, l) => {
    s.stage = { width: 30, depth: 40 };
    s.environment.floor = 'wood';
    s.reflectors = [createReflector({ name: 'LED video wall', material: construction.endsWith('plastic') ? 'drywall' : 'metal', construction, ...(holeSizeMm !== undefined ? { holeSizeMm } : {}), thicknessM: 0.1,
      p1: { x: 8, y: 3 }, p2: { x: 22, y: 3 }, zMin: 0.5, zMax: 5.5, noise: { preset } })];
    l.name = 'Mic'; l.freqMHz = 606.1;
    l.tx.pos = txBehind ? { x: 15, y: 2, z: 1.6 } : { x: 15, y: 8, z: 1.6 }; l.tx.powerDbm = 14;
    l.tx.antenna = { type: 'quarterwave', gainDbi: 1, orientation: { az: 0, el: 90 }, polarisation: 'vertical' };
    l.rx.pos = { ...rxCfg.pos };
    l.rx.antenna = { type: 'paddle', gainDbi: 7, orientation: { az: rx === 'near' ? 0 : rxCfg.az, el: 0 }, polarisation: 'vertical' };
    l.rx.diversity.enabled = false;
    l.chain = [createChainItem('cable', { cableType: 'lmr-400', lengthM: 5 })];
    if (Array.isArray(sections) && sections.length > 1) {
      const wall0 = s.reflectors[0];
      s.stage = { width: 30 + 16 * (sections.length - 1), depth: 40 };
      sections.forEach((c, i) => {
        const dx = 16 * i;
        const shift = (q) => { q.x += dx; };
        if (i === 0) { wall0.construction = c; wall0.material = c.endsWith('plastic') ? 'drywall' : 'metal'; wall0.name = `LED video wall (${c})`; return; }
        const w = structuredClone(wall0); w.id = newId('refl'); w.construction = c; w.material = c.endsWith('plastic') ? 'drywall' : 'metal'; w.name = `LED video wall (${c})`;
        shift(w.p1); shift(w.p2); s.reflectors.push(w);
        const k = structuredClone(l); k.id = newId('link'); k.tx.id = newId('tx'); k.rx.id = newId('rx'); k.name = `Mic behind ${c}`;
        shift(k.tx.pos); shift(k.rx.pos); if (k.rx.diversity && k.rx.diversity.antennaB && k.rx.diversity.antennaB.pos) shift(k.rx.diversity.antennaB.pos);
        s.links.push(k);
      });
      l.name = `Mic behind ${sections[0]}`;
    }
  });
}

/** videoWallReport(scene, linkIndex = 0) -> { rxPowerDbm, marginDb, noiseDbm, riseDb, marginChangeDb, wallLossDb (direct path), floorDbm, distanceToWallM, reflectionDb } */
export function videoWallReport(scene, i = 0) {
  const l = scene.links[i], r = solveLink(scene, l);
  const w = r.wallNoise;
  const wall = r.paths.find((p) => p.kind === 'wall');
  return { rxPowerDbm: r.rxPowerDbm, marginDb: r.marginDb, noiseDbm: w ? w.dbm : -Infinity, riseDb: w ? w.riseDb : 0, marginChangeDb: w ? w.marginChangeDb : 0, floorDbm: r.cascade.noiseFloorDbm, wallLossDb: r.paths[0].wallLossDb || 0, distanceToWallM: w ? w.walls[Math.min(i, w.walls.length - 1)].distanceM : null, reflectionDb: wall ? wall.gainDb - r.paths[0].gainDb : null };
}

/**
 * Even-order intermodulation examples (item 23). evenScene(id, { fixed }) with fixed false (default) or true for the version with the fix.
 *   'wideband':   mics on 500 and 700 MHz 3 m from a receive antenna with a wideband booster (IIP2 30 dBm, assumed) ahead of a 600 MHz receiver:
 *                 the difference (200 MHz, in an assumed VHF band) and sum (1200 MHz) products; fixed: a 470-698 MHz bandpass (40 dB, assumed) after the booster.
 *   'vhf-uhf':    a 190 MHz VHF mic and a 475 MHz UHF mic into one wideband booster, receiver on 665 MHz: f1 + f2 = 665 MHz lands in the wanted channel;
 *                 fixed: a 470-698 MHz bandpass (60 dB, assumed) BEFORE the booster removes the VHF tone.
 *   'harmonic':   a 902 MHz IEM transmitter 1.5 m from a 1795 MHz IEM bodypack: its second harmonic (50 dBc, assumed) lands at 1804 MHz in the wanted channel
 *                 band; fixed: 60 dB of low-pass on the transmitter output (assumed).
 *   'narrow-uhf': two UHF mics 8.2 MHz apart into a narrow-band receiver: sum near 1220 MHz and difference 8.2 MHz fall outside everything; only IM3 matters.
 */
export function evenScene(id, { fixed = false } = {}) {
  const cfg = {
    wideband: { f: 600.1, kind: 'mic', txs: [['Mic 500', 500.0, 14], ['Mic 700', 700.0, 14]], iip2: 30, bands: [{ name: 'VHF band 174-216 MHz', loMHz: 174, hiMHz: 216 }], booster: true },
    'vhf-uhf': { f: 665.0, kind: 'mic', txs: [['VHF mic', 190.0, 14], ['UHF mic', 475.0, 14]], iip2: 30, bands: [], booster: true },
    harmonic: { f: 1795.0, kind: 'iem', txs: [['UHF IEM', 902.0, 17]], iip2: 35, bands: [{ name: 'IEM band 1785-1805 MHz', loMHz: 1785, hiMHz: 1805 }], booster: false },
    'narrow-uhf': { f: 606.1, kind: 'mic', txs: [['Mic A', 606.1, 14], ['Mic B', 614.3, 14]], iip2: 40, bands: [{ name: 'VHF band 174-216 MHz', loMHz: 174, hiMHz: 216 }], booster: false },
  }[id];
  if (!cfg) return null;
  return imdScene(cfg.kind, cfg.f, cfg.txs.map(([n, f, p]) => [n, f, p, 7.5, 6.5, 1.5]), { preset: 'mic-rack-typical' }, (s, l, m) => {
    s.environment.model = 'free-space';
    s.stage = { width: 20, depth: 14 };
    l.rx.pos = { x: 10, y: 6.5, z: 1.5 }; m.rxAntennaPos = { x: 10, y: 6.5, z: 1.5 };
    m.rxAntenna = { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 } };
    if (id === 'harmonic') m.transmitters[0].pos = { x: 8.5, y: 6.5, z: 1.5 };
    m.iip2Dbm = cfg.iip2; m.bands = cfg.bands;
    if (cfg.booster) m.rxChain = [createChainItem('booster', { gainDb: 12, nfDb: 4 })];
    if (fixed && id === 'wideband') m.filterAfter = { passLoMHz: 470, passHiMHz: 698, rejectionDb: 40 };
    if (fixed && id === 'vhf-uhf') m.filterBefore = { passLoMHz: 470, passHiMHz: 698, rejectionDb: 60 };
    if (id === 'harmonic') m.filterBefore = { passLoMHz: 1700, passHiMHz: 1900, rejectionDb: 40 }; // the 1.8 GHz bodypack never sees the 902 MHz carrier
    if (fixed && id === 'harmonic') m.transmitters[0].harmonicFilterDb = 60;
  });
}

/**
 * Programme tone against the MPX tones (item 32 and 32a). TONE_MPX_EXAMPLES: id -> { kind: 'iem'|'mic', source, toneHz, settings } where settings are the
 * toneMpxReport() slider values (tone frequency kHz, tone level percent of peak deviation, pilot injection percent, overload level dB, mono).
 * toneMpxScene(id) builds the scene (audioSource and audioToneHz set to match) and toneMpxExampleReport(id) the report the notes quote.
 *   'products':  1 kHz sine at 40 percent of 75 kHz (30 kHz, beta 30) plus the 10 percent pilot (beta 0.395): baseband products and two-tone FM sidebands.
 *   'beat':      a 19.3 kHz tone getting past the audio filter beats with the pilot at 300 Hz.
 *   'sweep':     a sweep captured at 17 kHz (the filter is only 21 dB down there, assumed).
 *   'tone-key':  mono mic, 10.9 kHz tone overloaded: the third harmonic falls at 32.7 kHz in the tone-key window.
 *   'overdev':   a 95 percent tone plus the pilot reaches 104 percent of peak deviation.
 * All filter, nonlinearity and window figures are assumed (flag U); see tone-mpx.js.
 */
export const TONE_MPX_EXAMPLES = Object.freeze({
  products: { kind: 'iem', source: 'tone', toneHz: 1000, settings: { toneKhz: 1, tonePct: 40, pilotPct: 10, overloadDb: -6 } },
  beat: { kind: 'iem', source: 'tone', toneHz: 19300, settings: { toneKhz: 19.3, tonePct: 40, pilotPct: 9, overloadDb: -6 } },
  sweep: { kind: 'iem', source: 'sweep', toneHz: 17000, settings: { toneKhz: 17, tonePct: 40, pilotPct: 9, overloadDb: -6 } },
  'tone-key': { kind: 'mic', source: 'tone', toneHz: 10900, settings: { toneKhz: 10.9, tonePct: 60, pilotPct: 9, overloadDb: 0, mono: true } },
  overdev: { kind: 'iem', source: 'tone', toneHz: 1000, settings: { toneKhz: 1, tonePct: 95, pilotPct: 9, overloadDb: 0 } },
});
export function toneMpxScene(id) {
  const c = TONE_MPX_EXAMPLES[id];
  if (!c) return null;
  const s = createDefaultScene();
  s.links = [createDefaultLink(c.kind)];
  s.links[0].audio = { source: c.source, gainDb: 0 };
  s.audioSource = c.source; s.audioToneHz = c.toneHz;
  return s;
}
export function toneMpxExampleReport(id) {
  const c = TONE_MPX_EXAMPLES[id];
  return c ? toneMpxReport(c.settings) : null;
}

const ANTENNAS_GAIN = { yagi: 10, paddle: 7, body: -3 };

const OMNI_IMD = () => ({ type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 }, polarisation: 'vertical' });

/** Intermodulation example: the link under test sits on `wantedMHz`, transmitters are [name, MHz, dBm, x, y, z]. */
function imdScene(kind, wantedMHz, txs, imdExtra, fn) {
  return make(kind, (s, l) => {
    l.freqMHz = wantedMHz;
    const m = createDefaultImd();
    m.enabled = true;
    m.rxAntennaPos = { ...l.rx.pos };
    m.rxAntenna = structuredClone(l.rx.antenna);
    m.transmitters = txs.map(([name, f, p, x, y, z]) => createImdTransmitter({ name, freqMHz: f, powerDbm: p, pos: { x, y, z }, ...(kind === 'iem' ? { antenna: OMNI_IMD() } : {}) }));
    Object.assign(m, imdExtra);
    s.imd = m;
    if (fn) fn(s, l, m);
  });
}

/** Eight coordinated IEM frequencies (MHz), third-order clean (checkIntermod) with a 400 kHz guard, spread over 606 to 630 MHz (illustrative band). */
export const IEM8_PLAN_MHZ = [606.1, 606.5, 607.3, 608.9, 610.9, 614.1, 618.1, 623.7];
const IEM8_DIRECTIONAL = () => ({ type: 'paddle', gainDbi: 7, orientation: { az: 90, el: 0 } });
const IEM8_POWER_DBM = 14; // 25 mW per transmitter

/**
 * iem8Scene(variant, opts): the eight-IEM combining comparison on one geometry (same hall, antenna position, bodypack).
 *   'A': all eight through one isolated 8-way combiner (4.5 dB through, 45 dB port isolation, ASSUMED) to one directional antenna.
 *   'B': seven through a 7-in-8-way combiner (4 dB, 45 dB) to the same directional antenna, transmitter 8 straight to an omni antenna
 *        opts.omniDistanceM (default 2.5 m) from it, in front of the antenna (omniAt 'front', in the main lobe) or beside it ('side', in a pattern null), no isolator unless opts.tx8Isolator (35 dB reverse isolation, 1 dB through).
 *   'C': two 4-way combiners (3 dB, 40 dB) joined by a passive 2-way hybrid (3.5 dB, 25 dB), one antenna. opts.split puts the closely
 *        spaced neighbours in different groups (1,3,5,7 / 2,4,6,8) instead of the clustered grouping (1-4 / 5-8); opts.noIsolators drops the
 *        20 dB reverse isolation of each transmitter's own isolator. Isolated groups: isolation = 2 x isolatorDb (two isolators in series).
 * Losses and isolations are illustrative planning numbers (assumed), not product data.
 */
export function iem8Scene(variant, { omniDistanceM = 2.5, omniAt = 'front', tx8Isolator = false, split = false, noIsolators = false } = {}) {
  return imdScene('iem', IEM8_PLAN_MHZ[0], IEM8_PLAN_MHZ.map((f, i) => [`IEM ${i + 1}`, f, IEM8_POWER_DBM, 3, 10, 1.5]), { preset: 'iem-combiner-isolated', iip3Dbm: 10 }, (s, l, m) => {
    iemHall(s, l, m);
    m.transmitters.forEach((t) => { t.pos = { x: 3, y: 10, z: 1.5 }; t.antenna = IEM8_DIRECTIONAL(); });
    const ids = m.transmitters.map((t) => t.id);
    if (variant === 'A') {
      m.combiner = { type: 'isolated', isolationDb: 45, lossDb: 4.5 };
      m.topology = { groups: [{ id: 'g1', name: '8-way combiner', members: ids, lossDb: 4.5, isolationDb: 45, isolatorDb: 22.5 }] };
    } else if (variant === 'B') {
      m.combiner = { type: 'none', isolationDb: 0, lossDb: 0 };
      const t8 = m.transmitters[7];
      t8.pos = omniAt === 'side' ? { x: 3, y: 10 + omniDistanceM, z: 1.5 } : { x: 3 + omniDistanceM, y: 10, z: 1.5 }; // 'front' = along the boresight (in the main lobe)
      t8.antenna = OMNI_IMD();
      m.topology = { groups: [{ id: 'g1', name: '7-way combiner', members: ids.slice(0, 7), lossDb: 4, isolationDb: 45, isolatorDb: 22.5 }] };
      if (tx8Isolator) m.topology.groups.push({ id: 'g2', name: 'Isolator on IEM 8', members: [ids[7]], lossDb: 1, isolationDb: 0, isolatorDb: 35 });
    } else {
      m.combiner = { type: 'none', isolationDb: 0, lossDb: 0 };
      const iso = noIsolators ? 0 : 20;
      const pick = (idx) => idx.map((i) => ids[i]);
      const a = split ? [0, 2, 4, 6] : [0, 1, 2, 3], b = split ? [1, 3, 5, 7] : [4, 5, 6, 7];
      m.topology = {
        groups: [
          { id: 'g1', name: '4-way combiner 1', members: pick(a), lossDb: 3, isolationDb: 40, isolatorDb: iso },
          { id: 'g2', name: '4-way combiner 2', members: pick(b), lossDb: 3, isolationDb: 40, isolatorDb: iso },
        ],
        root: { lossDb: 3.5, isolationDb: 25 },
      };
    }
  });
}

/**
 * Review-batch examples (chain parts, polarisation, antenna contact, noise, coverage, fifth-order plans, p2p ground reflection).
 * reviewScene(id, opts) builds the scenes; every figure quoted in a note is recomputed in tests/review-examples.test.mjs. Part losses,
 * isolations and the absorption of a wet body are assumed round numbers for teaching (chain-presets.js and library.js carry the S/I/U flags).
 *   'splitter-two-way-receiver'  opts.part = 'passive' (default) | 'active' | 'none'
 *   'coupler-monitor-tap'        opts.part = 'coupler' (default) | 'none'
 *   'lna-no-filter' / 'filter-before-booster'   the same scene as sosScene('crossed-pol'), a 20 dB LNA with or without the bandpass filter ahead of it
 *   'bias-tee-booster-up-the-mast'  opts.block = true puts a DC block between the cable and the bias tee (the 'bias-tee-into-dcblock' example)
 *   'body-contact-sweaty-bodypack'  opts.contact / opts.dampness override 'skin' / 'wet'
 *   'tilted-whip-vs-vertical'       opts.tiltDeg (default 60)
 *   'circular-polarisation-wanted-mic'  opts.rx = 'circular' (default, helical-cp) | 'vertical'
 *   'ground-plane-quarterwave'      opts.groundPlane = 'none' (default) | 'body' | 'rack' | 'large'
 *   'coverage-modes-compare'        two antennas 1.5 m apart and a front zone; opts.mode sets scene.coverage.mode (default 'power')
 *   'external-noise-urban-vs-quiet' opts.noise = 'urban' (default) | 'quiet' | 0
 *   'audio-bandwidth-iem-vs-mic'    a mic link with a user audio bandwidth (opts.audioBandwidthHz, default 9000; null = none set)
 *   'imd-iem-8-with-fifth-order'    opts.channels = how many of the eight IEM8 channels (default 5)
 *   'pad-on-iem-transmitter'        bandScene('iem-tx-wrong-band', { pad: true }): the 6 dB pad in front of a badly matched transmit antenna
 *   'p2p-ground-reflection'         p2pScene('delay') moved to 40 m (opts.distanceM), paddles horizontal, with the flat-earth ground reflection on (opts.groundReflection = false for the direct ray only)
 */
export function reviewScene(id, opts = {}) {
  const hall = (s, l, f = 606.1) => {
    s.stage = { width: 30, depth: 20 }; s.environment.floor = 'wood'; l.freqMHz = f;
    l.tx.pos = { x: 3, y: 10, z: 1.5 }; l.rx.pos = { x: 13, y: 10, z: 1.2 }; l.rx.diversity.antennaB.pos = { x: 13, y: 9.4, z: 1.2 };
    l.tx.antenna = omni(); l.rx.antenna = omni();
  };
  const rg58 = (m) => createChainItem('cable', { cableType: 'rg58', lengthM: m });
  switch (id) {
    case 'splitter-two-way-receiver': return make('mic', (s, l) => {
      hall(s, l); l.name = 'Mic to two receivers';
      const part = opts.part || 'passive';
      l.chain = part === 'none' ? [rg58(5)] : [createChainItemFromPreset(part === 'active' ? 'active-splitter-4' : 'splitter-2'), rg58(5)];
    });
    case 'coupler-monitor-tap': return make('iem', (s, l) => {
      hall(s, l, 606.1); l.name = 'IEM with monitor tap'; l.tx.powerDbm = 17;
      l.chain = opts.part === 'none' ? [rg58(3)] : [createChainItemFromPreset('coupler-20'), rg58(3)];
    });
    case 'lna-no-filter': case 'filter-before-booster': {
      const s = sosScene('crossed-pol');
      const lna = () => createChainItem('booster', { gainDb: 20, nfDb: 1, iip3Dbm: 14 });
      const filt = () => createChainItem('filter', { lossDb: 1.5, filterType: 'bandpass', passLoMHz: 604, passHiMHz: 608, rejectionDb: 40 });
      const chain = id === 'lna-no-filter' ? [lna(), rg58(3)] : [filt(), lna(), rg58(3)];
      s.links[0].chain = chain; s.imd.rxChain = structuredClone(chain);
      return s;
    }
    case 'bias-tee-booster-up-the-mast': return make('mic', (s, l) => {
      hall(s, l); l.name = 'Mic, booster up the mast';
      l.chain = [createChainItemFromPreset('booster-12'), createChainItem('cable', { cableType: 'lmr-400', lengthM: 45 }), ...(opts.block ? [createChainItemFromPreset('dcblock')] : []), createChainItemFromPreset('biastee')];
    });
    case 'body-contact-sweaty-bodypack': return make('mic', (s, l) => {
      hall(s, l); s.environment.model = 'free-space'; l.name = 'Sweaty bodypack';
      l.tx.antenna = { type: 'body', gainDbi: -3, orientation: { az: 0, el: 90 }, polarisation: 'vertical', contact: opts.contact || 'skin', dampness: opts.dampness || 'wet' };
      l.chain = [rg58(5)];
    });
    case 'tilted-whip-vs-vertical': return make('mic', (s, l) => {
      hall(s, l); s.environment.model = 'free-space'; l.name = 'Tilted bodypack whip';
      l.tx.antenna = { ...omni(), tiltDeg: opts.tiltDeg === undefined ? 60 : opts.tiltDeg }; l.chain = [rg58(5)];
    });
    case 'circular-polarisation-wanted-mic': return make('mic', (s, l) => {
      hall(s, l); s.environment.model = 'free-space'; l.name = 'Mic, whip lying down';
      l.tx.antenna = { ...omni(), tiltDeg: 90 };
      l.rx.antenna = opts.rx === 'vertical' ? omni() : { type: 'helical-cp', gainDbi: 8, orientation: { az: 180, el: 0 }, polarisation: 'rhcp' };
      l.chain = [rg58(5)];
    });
    case 'ground-plane-quarterwave': return make('mic', (s, l) => {
      hall(s, l); s.environment.model = 'free-space'; l.name = 'Quarter-wave receive whip';
      l.rx.antenna = { type: 'quarterwave', gainDbi: 1, orientation: { az: 0, el: 90 }, polarisation: 'vertical', groundPlane: opts.groundPlane || 'none' };
      l.chain = [rg58(5)];
    });
    case 'external-noise-urban-vs-quiet': return make('mic', (s, l) => {
      hall(s, l); l.name = 'Mic in a noisy city'; l.rx.pos = { x: 28, y: 10, z: 1.2 }; l.rx.diversity.antennaB.pos = { x: 28, y: 9.4, z: 1.2 };
      l.tx.powerDbm = 10; l.chain = [createChainItem('booster', { gainDb: 20, nfDb: 1 }), rg58(20)];
      s.environment.externalNoise = opts.noise === undefined ? 'urban' : opts.noise;
    });
    case 'audio-bandwidth-iem-vs-mic': return make('mic', (s, l) => {
      hall(s, l); l.name = 'Narrow-band mic'; l.chain = [rg58(5)];
      if (opts.audioBandwidthHz !== null) l.tx.audioBandwidthHz = opts.audioBandwidthHz === undefined ? 9000 : opts.audioBandwidthHz;
    });
    case 'p2p-ground-reflection': {
      const s = p2pScene('delay'), l = s.links[0], d = opts.distanceM || 40; // short enough (40 m) to sit inside the lobe structure of 3 m masts at 606 MHz
      l.rx.pos = { ...l.rx.pos, x: l.tx.pos.x + d }; l.rx.diversity.antennaB.pos = { ...l.rx.diversity.antennaB.pos, x: l.tx.pos.x + d };
      l.tx.antenna.polarisation = 'horizontal'; l.rx.antenna.polarisation = 'horizontal'; // paddles lying flat: the ground reflection is strongest for horizontal polarisation
      if (opts.groundReflection !== false) { l.p2p.groundReflection = true; s.environment.model = 'two-ray'; }
      return s;
    }
    case 'coverage-modes-compare': return make('iem', (s, l) => {
      s.stage = { width: 16, depth: 10 }; s.coverage = { mode: opts.mode || 'power' };
      l.tx.pos = { x: 7, y: 2, z: 2.5 }; l.rx.pos = { x: 8, y: 6, z: 1.5 };
      l.tx.antenna = { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 } };
      l.chain = [rg58(10)];
      l.branches = [{}, createBranch({ name: 'Antenna 2', pos: { x: 8.5, y: 2, z: 2.5 }, antenna: { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 } }, chain: [rg58(10)] })];
      s.zones = [createZone({ id: newId('zone'), name: 'Front of stage', polygon: [{ x: 3, y: 4 }, { x: 13, y: 4 }, { x: 13, y: 8 }, { x: 3, y: 8 }], zMin: 0, zMax: 2, requiredMarginDb: 10 })];
    });
    case 'imd-iem-8-with-fifth-order': {
      const n = opts.channels || 5, sc = iem8Scene('A');
      sc.imd.transmitters = sc.imd.transmitters.slice(0, n);
      sc.imd.topology.groups[0].members = sc.imd.transmitters.map((t) => t.id);
      return sc;
    }
    case 'pad-on-iem-transmitter': return bandScene('iem-tx-wrong-band', { pad: true });
    default: return null;
  }
}

/**
 * Noise-source examples (item 34 and 34a): noiseSourceScene(id, opts) builds the scenes; the figures in the notes are recomputed in
 * tests/noise-sources.test.mjs. Catalogue figures are planning values (noise-sources.js, flags S/I/U).
 *   'flash-at-pit':   mic Rx at FOH, a speedlight 2 m from the receive antenna (impulsive, peak and average).
 *   'ptt-beside-bodypack': an IEM bodypack with a business UHF PTT handheld 1.5 m away (opts.kind: 'ptt-business-uhf' | 'ptt-pmr446').
 *   'phone-buzz':     a GSM 900 phone 1 m from the mic receive antenna (pulsed TDMA, 217 Hz).
 *   'dimmer-circuit': a triac dimmer 3 m from the receive antenna (broadband, falls steeply with frequency).
 *   'eng-press-pit':  the ENG crew group at the barrier (opts.centre), mic receiver at FOH.
 */
export function noiseSourceScene(id, opts = {}) {
  const base = (s, l, kind = 'mic') => {
    s.stage = { width: 30, depth: 20 }; s.environment.floor = 'wood'; s.environment.model = 'free-space';
    l.freqMHz = 606.1; l.tx.pos = { x: 3, y: 10, z: 1.5 }; l.tx.antenna = omni(); l.rx.antenna = omni();
    l.rx.pos = { x: 22, y: 10, z: 1.2 }; l.rx.diversity.antennaB.pos = { x: 22, y: 9.4, z: 1.2 };
    l.chain = [createChainItem('cable', { cableType: 'lmr-240', lengthM: 5 })];
    void kind;
  };
  const at = (kind, pos, extra = {}) => createNoiseSource(kind, { pos, ...extra });
  switch (id) {
    case 'flash-at-pit': return make('mic', (s, l) => { base(s, l); l.name = 'Mic at FOH'; s.noiseSources = [at('speedlight-flash', { x: 20, y: 10, z: 1.5 }, { name: 'Photographer speedlight' })]; });
    case 'ptt-beside-bodypack': return make('iem', (s, l) => {
      s.stage = { width: 30, depth: 20 }; s.environment.floor = 'wood'; s.environment.model = 'free-space';
      l.name = 'IEM bodypack'; l.freqMHz = 606.1; l.tx.pos = { x: 3, y: 10, z: 1.5 }; l.tx.powerDbm = 17; l.tx.antenna = omni();
      l.rx.pos = { x: 12, y: 10, z: 1.2 }; l.rx.antenna = { type: 'body', gainDbi: -3, orientation: { az: 0, el: 90 }, polarisation: 'vertical' };
      l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 3 })];
      s.noiseSources = [at(opts.kind || 'ptt-business-uhf', { x: 13.5, y: 10, z: 1.2 }, { name: 'Crew PTT radio' })];
    });
    case 'phone-buzz': return make('mic', (s, l) => { base(s, l); l.name = 'Mic at FOH'; s.noiseSources = [at('gsm-phone-900', { x: 22, y: 11, z: 1.2 }, { name: 'Phone on the FOH desk' })]; });
    case 'dimmer-circuit': return make('mic', (s, l) => { base(s, l); l.name = 'Mic at FOH'; s.noiseSources = [at('dimmer-triac', { x: 22, y: 13, z: 1.5 }, { name: 'Dimmer rack' })]; });
    case 'eng-press-pit': return make('mic', (s, l) => {
      base(s, l); l.name = 'Mic at FOH'; s.stage = { width: 30, depth: 20 };
      s.noiseSources = engCrewSources(opts.centre || { x: 12, y: 3, z: 0 });
    });
    case 'dect-intercom': return make('mic', (s, l) => { // a 1.9 GHz wireless mic sharing the DECT band with a crew intercom beltpack 4 m from the receive antenna
      base(s, l); l.name = '1.9 GHz mic at FOH'; l.freqMHz = 1893; l.tx.powerDbm = 10;
      s.noiseSources = [at('dect-comms', { x: 22, y: 14, z: 1.2 }, { name: 'Crew DECT intercom beltpack' })];
    });
    case 'pyro-trigger-433': return make('mic', (s, l) => { // a licence-free 433 MHz mic and the pyro cue trigger 0.8 MHz above it, on the stage
      base(s, l); l.name = '433 MHz mic at FOH'; l.freqMHz = 433.1; l.tx.powerDbm = 10;
      s.noiseSources = [at('pyro-trigger', { x: 3, y: 12, z: 1.2 }, { name: 'Pyro cue trigger' })];
    });
    default: return null;
  }
}

/**
 * Working on a weak TV channel (item 22). weakTvScene(variant) -> a 30 x 20 m free-space FOH link at 570 / 546 MHz (UK 8 MHz plan) with digital TV
 * blocks modelled as in-channel noise sources (noise-sources.js 'dtv-broadcast': a 7.6 MHz flat block; a 200 kHz mic channel sees the block power minus
 * 15.8 dB). The illustrative occupancy comes from spectrum-map.js simulatedOccupancy('uk-suburban', 'weak-tv-example'): channels 33 and 34 are on air.
 * Levels at the receive antenna are tuned (ERP solved from the model) and ASSUMED (flag U), not measured: WEAK_TV_BLOCK_DBM.
 *   'on-channel'        mic on ch 33, own block -85 dBm, ch 34 neighbour off the air in the scene (the usable fallback, not a design choice)
 *   'free-gap'          mic moved to ch 30 (nearest free gap clear of ch 33 and ch 34): good practice
 *   'strong-neighbour'  mic still on ch 33 with the weak block, but ch 34 (adjacent) is a strong local signal
 *   'strong-cochannel'  mic on ch 33 and the block is strong (-45 dBm): the failure contrast
 */
export const WEAK_TV_BLOCK_DBM = Object.freeze({ weak: -85, strong: -45 });
export const WEAK_TV_FREQ_MHZ = Object.freeze({ ch33: 570.4, ch30: 546.4 }); // 0.4 MHz above the block centre: inside the flat part, away from the edges
export const WEAK_TV_US_CHANNEL = 26; // North America, 6 MHz plan: channel 26 = 542 to 548 MHz, occupied 5.38 MHz (ATSC)
export function weakTvScene(variant = 'on-channel', widthMHz = 8) {
  const us = widthMHz === 6; // the 6 MHz plan: scene.tvChannelWidthMHz = 6 and a 5.38 MHz block (only the on-channel variant is defined for it)
  const ch = (n) => tvChannelList(widthMHz).find((c) => c.n === n);
  return make('mic', (s, l) => {
    s.stage = { width: 30, depth: 20 }; s.environment.floor = 'wood'; s.environment.model = 'free-space';
    l.name = 'Mic at FOH'; l.tx.pos = { x: 3, y: 10, z: 1.5 }; l.tx.antenna = omni(); l.rx.antenna = omni();
    l.rx.pos = { x: 22, y: 10, z: 1.2 }; l.rx.diversity.antennaB.pos = { x: 22, y: 9.4, z: 1.2 };
    l.chain = [createChainItem('cable', { cableType: 'lmr-240', lengthM: 5 })];
    l.freqMHz = us ? Math.round((ch(WEAK_TV_US_CHANNEL).centreMHz + 0.4) * 10) / 10 : variant === 'free-gap' ? WEAK_TV_FREQ_MHZ.ch30 : WEAK_TV_FREQ_MHZ.ch33;
    if (us) s.tvChannelWidthMHz = 6;
    const dtv = (n, blockDbm, name, pos) => {
      const src = createNoiseSource('dtv-broadcast', { name, pos, freqMHz: ch(n).centreMHz, ...(us ? { bwKHz: TV_OCCUPIED_MHZ[6] * 1000 } : {}) });
      const raw0 = noiseSourceAt({ ...src, erpDbm: 0 }, l.rx.pos, l.freqMHz, 200, () => 0).rawDbm;
      return { ...src, erpDbm: Math.round((blockDbm - raw0) * 10) / 10 }; // ERP that puts blockDbm at the antenna terminals (Friis, -3 dB polarisation)
    };
    const own = variant === 'strong-cochannel' ? WEAK_TV_BLOCK_DBM.strong : WEAK_TV_BLOCK_DBM.weak;
    s.noiseSources = [us ? dtv(WEAK_TV_US_CHANNEL, own, `TV ch ${WEAK_TV_US_CHANNEL} (weak local)`, { x: 29, y: 10, z: 10 }) : dtv(33, own, 'TV ch 33 (weak local)', { x: 29, y: 10, z: 10 })];
    if (variant === 'strong-neighbour' && !us) s.noiseSources.push(dtv(34, WEAK_TV_BLOCK_DBM.strong, 'TV ch 34 (strong adjacent)', { x: 29, y: 16, z: 10 }));
  });
}
export function weakTvReport(variant, widthMHz = 8) {
  const sc = weakTvScene(variant, widthMHz), r = solveLink(sc, sc.links[0]);
  const ns = r.noiseSources;
  return { scene: sc, result: r, noise: ns, marginDb: r.marginDb, floorDbm: ns ? ns.floorAfterDbm : r.cascade.noiseFloorDbm, riseDb: ns ? ns.riseDb : 0, channel: tvChannelOf(sc.links[0].freqMHz, widthMHz).n };
}

/**
 * Booster overload by a strong nearby transmitter (compression.js): boosterOverloadScene(variant) -> a 606.1 MHz mic 137 m from a receive rack whose antenna
 * feeds a 12 dB booster and 20 m of LMR-240, with a business UHF handheld radio (33 dBm ERP, assumed) keyed 1 m from the receive antenna.
 * variant 'plain' = no booster, 'overloaded' = booster straight on the antenna, 'filtered' = a 600-612 MHz bandpass ahead of the booster. The booster is powered
 * by 12 V bias from the receiver (rx.antennaBiasV), so the only warnings are the compression ones. 'padded' = a 10 dB attenuator ahead of the booster (the less ideal cure).
 */
export function boosterOverloadScene(variant = 'overloaded') {
  return make('mic', (s, l) => {
    s.stage = { width: 160, depth: 20 }; s.environment.floor = 'wood'; s.environment.model = 'free-space';
    l.name = 'Mic at the far end'; l.freqMHz = 606.1; l.tx.powerDbm = 10;
    l.tx.pos = { x: 3, y: 10, z: 1.5 }; l.tx.antenna = omni(); l.rx.antenna = omni();
    l.rx.pos = { x: 140, y: 10, z: 1.5 }; l.rx.diversity.antennaB.pos = { x: 140, y: 9.4, z: 1.5 };
    l.chain = [];
    if (variant === 'filtered') l.chain.push(createChainItemFromPreset('filter-bandpass', { passLoMHz: 600, passHiMHz: 612, dcMode: 'pass', noDc: false })); // a DC-passing filter, so the bias reaches the booster behind it
    if (variant === 'padded') l.chain.push(createChainItem('attenuator', { lossDb: 10 })); // a 10 dB pad ahead of the booster
    if (variant !== 'plain') { l.chain.push(createChainItemFromPreset('booster-12')); l.rx.antennaBiasV = 12; } // the receiver supplies the 12 V the booster needs over the cable (no bias warning); no extra loss
    l.chain.push(createChainItem('cable', { cableType: 'lmr-240', lengthM: 20 }));
    s.noiseSources = [createNoiseSource('ptt-business-uhf', { name: 'Crew radio 1 m from the antenna', pos: { x: 140, y: 11, z: 1.5 } })];
  });
}
export function boosterOverloadReport(variant) {
  const sc = boosterOverloadScene(variant), r = solveLink(sc, sc.links[0]), c = r.compression;
  const boost = c && c.stages.find((x) => x.op1dBDbm !== null);
  return { scene: sc, result: r, marginDb: r.marginDb, compressionDb: c ? c.totalDb : 0, interfererDbm: c ? c.strongest.rawDbm : null, boosterOutDbm: boost ? boost.linearOutDbm : null, op1dBDbm: boost ? boost.op1dBDbm : null };
}

/**
 * Analogue FM versus digital at the same receiver input level (digital-link.js): modeContrastScene(type, level) -> a 10 m mic link on 606.1 MHz with a fixed pad
 * chosen so the receiver input is exactly MODE_CONTRAST_LEVELS[level] dBm. type 'analog-fm' or 'digital' (the default digital preset, fixed QPSK 3/4, assumed).
 * 'weak' sits 1 dB under the digital frame-error cliff but only 5 dB under the FM threshold knee; 'good' is well above both.
 */
export const MODE_CONTRAST_LEVELS = Object.freeze({ weak: -107, good: -85 });
export function modeContrastScene(type = 'analog-fm', level = 'weak') {
  const build = (padDb) => make('mic', (s, l) => {
    s.stage = { width: 30, depth: 20 }; s.environment.floor = 'wood'; s.environment.model = 'free-space';
    l.name = type === 'digital' ? 'Digital mic' : 'Analogue FM mic'; l.freqMHz = 606.1;
    l.tx.pos = { x: 3, y: 10, z: 1.5 }; l.tx.antenna = omni(); l.rx.antenna = omni();
    l.rx.pos = { x: 13, y: 10, z: 1.5 }; l.rx.diversity.antennaB.pos = { x: 13, y: 9.4, z: 1.5 };
    l.chain = [createChainItem('attenuator', { lossDb: padDb })];
    l.rx.squelch = { enabled: false, thresholdDbm: -125, hysteresisDb: 3 };
    if (type === 'digital') l.modulation = { type: 'digital', digital: { preset: 'mic-qpsk-fixed', fixedOrder: null, overrides: {} } };
  });
  const probe = solveLink(build(0), build(0).links[0]);
  const pad = Math.round((probe.inputPowerDbm - MODE_CONTRAST_LEVELS[level]) * 10) / 10;
  return build(pad);
}
export function modeContrastReport(type, level) {
  const sc = modeContrastScene(type, level), l = sc.links[0], r = solveLink(sc, l);
  return { scene: sc, result: r, inputDbm: r.inputPowerDbm, ...modeReport(r.inputPowerDbm, l) };
}

/**
 * Body-worn link with a thin margin (assumptions-in-use.js): bodyWornScene(variant) -> a bodypack on a performer (10 dB body loss, assumed) with a cross-polarised
 * transmit antenna (horizontal against a vertical receive antenna, 15 dB floor, assumed), 10 dBm transmit power. variant 'thin' = receiver 70 m away, 'short' = 25 m.
 */
export function bodyWornScene(variant = 'thin') {
  return make('mic', (s, l) => {
    s.stage = { width: 120, depth: 20 }; s.environment.floor = 'wood'; s.environment.model = 'free-space'; s.environment.bodyLossDb = 10;
    l.name = variant === 'short' ? 'Bodypack, receiver 25 m away' : 'Bodypack, receiver 70 m away'; l.freqMHz = 606.1; l.tx.powerDbm = 10;
    const d = variant === 'short' ? 25 : 70;
    l.tx.pos = { x: 3, y: 10, z: 1.2 }; l.tx.antenna = omni(90, 'horizontal'); l.rx.antenna = omni(90, 'vertical');
    l.rx.pos = { x: 3 + d, y: 10, z: 1.5 }; l.rx.diversity.antennaB.pos = { x: 3 + d, y: 9.4, z: 1.5 };
  });
}
export function bodyWornReport(variant) {
  const sc = bodyWornScene(variant), c = confidenceSummary(sc)[0];
  return { scene: sc, marginDb: c.marginDb, proven: c.proven, rssDb: c.rssDb, worstCaseDb: c.worstCaseDb, assumptionIds: c.assumptionIds, reasons: c.reasons };
}

/**
 * Diversity combining with correlated and uncorrelated fades: diversityCombiningScene(variant) -> the two-ray geometry of the diversity examples (concrete floor,
 * horizontal omni antennas, mic walking 8 m to 0.5 m from the receiver, one floor reflection). 'correlated': antenna B 0.05 m (0.1 wavelength) beside A, so both
 * see the same fades; 'spaced': B 0.4 m (0.8 wavelength) above A, so its fade falls at a different distance. diversityCombiningReport(variant) sweeps the walk
 * (400 samples) with sweepLink and returns the 1 percent fade-depth gains of switching, selection ('true') and maximal-ratio combining over a single antenna.
 */
export function diversityCombiningScene(variant = 'spaced') {
  return make('mic', (s, l) => {
    twoRay(s, l);
    l.rx.diversity.enabled = true; l.rx.diversity.mode = 'true'; l.rx.diversity.hysteresisDb = 3;
    l.rx.diversity.antennaB.pos = variant === 'correlated' ? { x: 11, y: 6.55, z: 1.0 } : { x: 11, y: 6.5, z: 1.4 };
  });
}
export function diversityCombiningReport(variant) {
  const sc = diversityCombiningScene(variant), l = sc.links[0];
  const r = sweepLink(sc, l.id, { x: 8, y: 6.5, z: 1.75 }, { x: 0.5, y: 6.5, z: 1.75 }, 400);
  return {
    scene: sc, spacingLambda: r.spacingLambda, singleFadeDepthDb: r.stats.single.fadeDepthDb, ratioFadeDepthDb: r.stats.ratio.fadeDepthDb,
    gain1pctDb: { switching: r.gain1pctDb.switching, selection: r.gain1pctDb.true, ratio: r.gain1pctDb.ratio }, gainMeanDb: { switching: r.gainMeanDb.switching, selection: r.gainMeanDb.true, ratio: r.gainMeanDb.ratio },
  };
}

/**
 * Walk-test calibration (measurements.js): measurementsScene(variant) -> a mic link (free space, 10 m stage line) with 12 readings taken along a walk away from the
 * transmitter (receiver at 8 to 68 m). The readings are SYNTHETIC: solved with the true body loss plus a fixed, deterministic scatter of up to +-0.4 dB.
 * 'body-loss-high': the scene assumes 3 dB of body loss, the readings were made with 10 dB. 'clean-match': the scene assumes 6 dB and so did the readings.
 */
export const MEASUREMENT_WALK_X = Object.freeze([8, 13, 19, 26, 33, 40, 46, 52, 57, 62, 66, 70]);
export const MEASUREMENT_FEW_X = Object.freeze([32, 33, 34]); // the too-few walk: three readings within 2 m of each other
const measScatter = (i) => { const v = Math.sin((i + 1) * 12.9898) * 43758.5453; return 0.4 * (2 * (v - Math.floor(v)) - 1); };
export function measurementsScene(variant = 'body-loss-high') {
  const assumed = variant === 'clean-match' ? 6 : 3, truth = variant === 'clean-match' ? 6 : 10; // 'too-few' is the same 3 -> 10 dB story with three clustered readings
  const sc = make('mic', (s, l) => {
    s.stage = { width: 120, depth: 20 }; s.environment.floor = 'wood'; s.environment.model = 'free-space'; s.environment.bodyLossDb = assumed;
    l.name = 'Bodypack walk test'; l.freqMHz = 606.1; l.tx.powerDbm = 10;
    l.tx.pos = { x: 3, y: 10, z: 1.2 }; l.tx.antenna = omni(); l.rx.antenna = omni(); l.rx.pos = { x: 40, y: 10, z: 1.5 }; l.rx.diversity.antennaB.pos = { x: 40, y: 9.4, z: 1.5 };
  });
  const truthScene = { ...sc, environment: { ...sc.environment, bodyLossDb: truth } }, l = sc.links[0];
  sc.measurements = (variant === 'too-few' ? MEASUREMENT_FEW_X : MEASUREMENT_WALK_X).map((x, i) => {
    const copy = JSON.parse(JSON.stringify(l)); copy.rx.pos = { x, y: 10, z: 1.5 };
    const dbm = solveLink(truthScene, copy).inputPowerDbm + measScatter(i);
    return { id: `meas${i + 1}`, linkId: l.id, x, y: 10, rxDbm: Math.round(dbm * 100) / 100 };
  });
  return sc;
}

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
 * Two mics on one weak TV block (item 22 follow-up): weakTvScene('on-channel') with a second mic 1.0 MHz above the first, both inside the flat part of
 * UK channel 33 (570.4 and 571.4 MHz), and the IMD panel on with the two mics: the TV block noise is shared (same level in both 200 kHz channels), the
 * third-order products 569.4 and 572.4 MHz fall a full MHz from either channel, so the usual coordination rules still apply.
 */
export const WEAK_TV_SECOND_MIC_MHZ = 571.4;
export function weakTvTwoMicScene() {
  const s = weakTvScene('on-channel');
  const a = s.links[0], b = createDefaultLink('mic');
  b.name = 'Mic 2 at FOH'; b.freqMHz = WEAK_TV_SECOND_MIC_MHZ; b.tx.pos = { x: 3, y: 12, z: 1.5 }; b.tx.antenna = structuredClone(a.tx.antenna); b.rx.antenna = structuredClone(a.rx.antenna);
  b.rx.pos = { x: 22, y: 11, z: 1.2 }; b.rx.diversity.antennaB.pos = { x: 22, y: 10.4, z: 1.2 }; b.chain = structuredClone(a.chain);
  a.name = 'Mic 1 at FOH';
  s.links.push(b);
  const m = createDefaultImd(); m.enabled = true; m.rxAntennaPos = { ...a.rx.pos }; m.rxAntenna = structuredClone(a.rx.antenna);
  m.transmitters = [['Mic 1', a.freqMHz, a.tx.pos], ['Mic 2', b.freqMHz, b.tx.pos]].map(([name, f, pos]) => createImdTransmitter({ name, freqMHz: f, powerDbm: 14, pos: { ...pos } }));
  s.imd = m;
  return syncScene(s);
}

/**
 * Squelch noise burst: the speedlight geometry of noise-flash-at-pit, moved well away from the FOH receive antenna, and the mic transmitter off between
 * songs (carrier absent). The squelch is set at -90 dBm with 3 dB of hysteresis, above the average floor but below the peak of each flash: every flash opens
 * the gate for its 1 ms pulse (a pop or a burst of hiss), while the average noise alone never does.
 */
export function squelchBurstScene() {
  return make('mic', (s, l) => {
    s.stage = { width: 30, depth: 20 }; s.environment.floor = 'wood'; s.environment.model = 'free-space';
    l.name = 'Mic at FOH (transmitter off)'; l.freqMHz = 606.1; l.tx.pos = { x: 3, y: 10, z: 1.5 }; l.tx.powerDbm = -60; l.tx.antenna = omni(); l.rx.antenna = omni();
    l.rx.pos = { x: 22, y: 10, z: 1.2 }; l.rx.diversity.antennaB.pos = { x: 22, y: 9.4, z: 1.2 };
    l.chain = [createChainItem('cable', { cableType: 'lmr-240', lengthM: 5 })];
    l.rx.squelch = { enabled: true, thresholdDbm: -90, hysteresisDb: 3 };
    s.noiseSources = [createNoiseSource('speedlight-flash', { name: 'Photographer speedlight', pos: { x: 0.5, y: 14, z: 1.5 } })];
  });
}
/** squelchBurstReport(seconds = 10) -> the noise in the channel, the squelch states and the event timeline of the speedlight. */
export function squelchBurstReport(seconds = 10) {
  const sc = squelchBurstScene(), l = sc.links[0], r = solveLink(sc, l), n = r.noiseSources, src = n.sources[0];
  const floor = n.floorBeforeDbm, sum = (a, b) => 10 * Math.log10(Math.pow(10, a / 10) + Math.pow(10, b / 10));
  const idle = sum(floor, src.averageDbm), burst = sum(floor, src.peakDbm);
  const q = l.rx.squelch;
  const ev = noiseEvents(sc.noiseSources[0], seconds);
  return {
    scene: sc, floorDbm: floor, avgDbm: src.averageDbm, peakDbm: src.peakDbm, distanceM: src.distanceM, idleLevelDbm: idle, burstLevelDbm: burst, thresholdDbm: q.thresholdDbm,
    idleOpen: squelchState(false, idle, q).open, burstOpen: squelchState(false, burst, q).open, headroomBurstDb: burst - q.thresholdDbm, headroomIdleDb: idle - q.thresholdDbm,
    events: ev.length, openMs: ev.reduce((a, e) => a + (e.t1 - e.t0) * 1000, 0), seconds,
  };
}

/** Coordination examples as IMD scenes the lab can load: three 14 dBm mics at similar distance, the first is the wanted one. */
export const COORD_PLANS_MHZ = Object.freeze({ equal: [600.0, 600.4, 600.8], spread: [600.0, 601.0, 603.3] });
export function coordScene(which) {
  const f = COORD_PLANS_MHZ[which];
  return imdScene('mic', f[0], f.map((fm, i) => [`Mic ${i + 1}${i === 0 ? ' (wanted)' : ''}`, fm, 14, 7.5 + i * 0.3, 4, 1.5]), {}, (s, l) => {
    s.stage = { width: 14, depth: 10 }; s.environment.floor = 'wood';
    l.rx.pos = { x: 11, y: 4, z: 1.2 }; l.rx.diversity.antennaB.pos = { x: 11, y: 3.4, z: 1.2 };
    s.imd.rxAntennaPos = { ...l.rx.pos };
  });
}

export const EXAMPLES = [
  {
    id: 'dropout-two-ray',
    title: 'Dropout at 7 m (two-ray null)',
    note: 'Problem: the direct ray and the floor reflection arrive half a wavelength apart at about 7 m, so they partly cancel and the level falls about 9 dB below what the direct ray alone would give. The squelch closes in the dip and the audio cuts out, then returns a metre or so further on.',
    build: () => ({ scene: make('mic', twoRay), walk: ACROSS }),
  },
  {
    id: 'diversity-null',
    title: 'Diversity: walking through a null',
    note: 'Best practice: the second antenna is 0.4 m higher, so its null falls at a different distance. Whenever one antenna is in a fade the receiver uses the other, and the squelch stays open where a single antenna would drop out.',
    build: () => ({
      scene: make('mic', (s, l) => { twoRay(s, l); l.rx.diversity.enabled = true; l.rx.diversity.mode = 'true'; l.rx.diversity.hysteresisDb = 2; }),
      walk: ACROSS,
    }),
  },
  {
    id: 'diversity-modes',
    title: 'Diversity modes compared (switching vs true vs ratio)',
    note: 'Compare: switching diversity changes antenna only after a hysteresis margin, true diversity always follows the stronger antenna, and ratio combining adds both signals and gains up to 3 dB. Change the mode in the diversity panel while the mic walks to compare.',
    build: () => ({
      scene: make('mic', (s, l) => { twoRay(s, l); l.rx.diversity.enabled = true; l.rx.diversity.mode = 'switching'; l.rx.diversity.hysteresisDb = 3; }),
      walk: ACROSS,
    }),
  },
  {
    id: 'overload-at-antenna',
    title: 'RF overload: mic held at the antenna',
    note: 'Problem: a handheld transmitter 30 cm from the receive antenna delivers far more power than the receiver front end can take. Compression and intermodulation distortion appear, and the receiver can lose the signal even though it is strong.',
    build: () => ({
      scene: make('mic', (s, l) => {
        l.tx.powerDbm = 17;
        l.rx.pos = { x: 10, y: 6.5, z: 2.5 };
        l.tx.pos = { x: 9.7, y: 6.5, z: 2.5 };
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 })];
      }),
    }),
  },
  {
    id: 'overload-fix',
    title: 'Overload fix: pad and distance',
    note: 'Best practice: a 10 dB attenuator at the receiver input and two metres of separation bring the input level back inside the linear range. The same mic now sounds clean; compare the headroom with the previous example.',
    build: () => ({
      scene: make('mic', (s, l) => {
        l.tx.powerDbm = 17;
        l.rx.pos = { x: 10, y: 6.5, z: 2.5 };
        l.tx.pos = { x: 8, y: 6.5, z: 2.5 };
        l.chain = [createChainItem('attenuator', { lossDb: 10 }), createChainItem('cable', { cableType: 'rg58', lengthM: 5 })];
      }),
    }),
  },
  {
    id: 'iem-stereo-mono',
    title: 'IEM: stereo to mono',
    note: 'Compare: as the bodypack walks away the carrier-to-noise ratio falls. The stereo difference signal sits higher in the noise than the sum, so the receiver blends towards mono first, and finally loses the stereo pilot.',
    build: () => ({
      scene: make('iem', (s, l) => { outdoorIem(s, l); }),
      walk: { to: { x: 10, y: 70, z: 1.0 }, speedMps: 6, pingPong: false },
    }),
  },
  {
    id: 'pilot-vs-carrier-squelch',
    title: 'Pilot-tone squelch vs carrier squelch',
    note: 'Compare: the carrier squelch only looks at signal strength, so a weak but present carrier still opens it and you hear hiss. With pilot squelch on, the receiver also needs a locked 19 kHz pilot and mutes as soon as the pilot is lost.',
    build: () => ({
      scene: make('iem', (s, l) => { outdoorIem(s, l); l.mpx.pilotSquelch = true; }),
      walk: { to: { x: 10, y: 70, z: 1.0 }, speedMps: 6, pingPong: false },
    }),
  },
  {
    id: 'long-cable',
    title: 'Long cable run loss',
    note: 'Problem: a 100 m run of thin coax costs over forty decibels at UHF (42.5 dB for this RG58 run), which leaves only about 5 dB of margin. Try LMR-400 instead, or put a booster near the antenna: loss before the first gain stage hurts most.',
    build: () => ({
      scene: make('mic', (s, l) => {
        s.units = { power: 'dBm', length: 'ft' };
        l.tx.pos = { x: 1, y: 1, z: 1.5 };
        l.tx.powerDbm = 10;
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 100 }), createChainItem('connector', { lossDb: 0.3 })];
        l.rx.squelch = { enabled: true, thresholdDbm: -100, hysteresisDb: 3 };
      }),
    }),
  },
  {
    id: 'reflective-wall',
    title: 'Reflective wall multipath',
    note: 'Problem: a metal wall behind the receiver adds extra reflected paths. They add and cancel with the direct ray, so the level ripples as the mic moves. A dip appears each time a reflected path changes by one wavelength (0.5 m), but walking across the room changes the path difference only slowly, so along this walk the deep dips are about 2.5 m apart rather than a fraction of a wavelength.',
    build: () => ({
      scene: make('mic', (s, l) => {
        s.reflectors = [createReflector({ id: newId('refl'), name: 'Metal wall', material: 'metal', p1: { x: 0.5, y: 7.9 }, p2: { x: 11.5, y: 7.9 }, zMin: 0, zMax: 4 })];
        l.tx.pos = { x: 1, y: 3, z: 1.5 };
        l.rx.pos = { x: 10, y: 6.5, z: 2.5 };
      }),
      walk: { to: { x: 9, y: 2, z: 1.5 }, speedMps: 0.5, pingPong: true },
    }),
  },
  {
    id: 'battery-fade',
    title: 'Battery fade: TX power sag mutes the link',
    note: 'Problem: as the transmitter batteries run down their voltage falls below the regulator limit and the output power sags. The received level drops with it until the squelch closes, even though nothing has moved. Time is sped up here; pause or reset the battery in the toolbar.',
    build: () => ({
      scene: make('mic', (s, l) => {
        l.tx.pos = { x: 4, y: 3, z: 1.5 };
        l.rx.squelch = { enabled: true, thresholdDbm: -55, hysteresisDb: 3 };
        l.telemetry.battery = { chemistry: 'alkaline-aa-x2', startPercent: 40, timeScale: 1200, running: true };
      }),
    }),
  },
  {
    id: 'telemetry-before-audio',
    title: 'Telemetry drops before audio',
    note: 'Compare: the telemetry data channel needs a cleaner signal than the audio does, so battery and status readings go stale first while the audio is still usable. Walk the mic away and watch the telemetry panel before the squelch closes.',
    build: () => ({
      scene: make('mic', (s, l) => { outdoorMic(s, l); l.telemetry.preset = 'rds-like'; }),
      walk: { to: { x: 10, y: 70, z: 1.5 }, speedMps: 6, pingPong: false },
    }),
  },
  {
    id: 'digital-vs-analog',
    title: 'Digital vs analog: graceful vs cliff',
    note: 'Compare: walk away with the link in digital mode: quality stays perfect, then drops off a cliff within a few decibels. Switch the modulation to analog FM in the toolbar and repeat: the analog audio only gets gradually noisier before it finally closes.',
    build: () => ({
      scene: make('iem', (s, l) => { outdoorIem(s, l); l.modulation.type = 'digital'; l.rx.squelch.thresholdDbm = -120; }),
      walk: { to: { x: 10, y: 70, z: 1.0 }, speedMps: 6, pingPong: false },
    }),
  },
  {
    id: 'adaptive-modulation',
    title: 'Adaptive modulation: 256-QAM down to QPSK',
    note: 'Compare: close to the transmitter the link runs 256-QAM for maximum data rate. As the signal weakens the receiver steps down through 64-QAM and 16-QAM to QPSK, trading rate for robustness, and only then drops out.',
    build: () => ({
      scene: make('iem', (s, l) => {
        outdoorIem(s, l);
        l.modulation = { type: 'digital', digital: { preset: 'wideband-adaptive', fixedOrder: null, overrides: {} } };
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 }), createChainItem('attenuator', { lossDb: 25 })];
        l.rx.squelch = { enabled: true, thresholdDbm: -120, hysteresisDb: 3 };
      }),
      walk: { to: { x: 10, y: 70, z: 1.0 }, speedMps: 6, pingPong: false },
    }),
  },
  {
    id: 'digital-cuts-out',
    title: 'Why digital cuts out instead of getting noisy',
    note: 'Compare: error correction hides bit errors completely until there are too many to fix, then it fails abruptly. The receiver repeats the last frame for a moment to hide the gap and then mutes. Compare this with the slow noise build-up of the analog example.',
    build: () => ({
      scene: make('mic', (s, l) => {
        outdoorMic(s, l);
        l.modulation = { type: 'digital', digital: { preset: 'mic-qpsk-fixed', fixedOrder: null, overrides: {} } };
        l.rx.squelch = { enabled: true, thresholdDbm: -120, hysteresisDb: 3 };
      }),
      walk: { to: { x: 10, y: 70, z: 1.5 }, speedMps: 6, pingPong: false },
    }),
  },
  {
    id: 'constellation-noise',
    title: 'Constellation noise: moving the mic',
    note: 'Problem: with the constellation order held at 64-QAM, the cloud of received symbols around each ideal point grows as the mic moves away. When the clouds start to overlap the error rate climbs and the link falls over.',
    build: () => ({
      scene: make('mic', (s, l) => {
        l.modulation = { type: 'digital', digital: { preset: 'wideband-adaptive', fixedOrder: 64, overrides: {} } };
        l.tx.pos = { x: 9, y: 6, z: 1.5 };
        l.chain = [createChainItem('attenuator', { lossDb: 46 }), createChainItem('cable', { cableType: 'rg58', lengthM: 10 })];
        l.rx.squelch = { enabled: true, thresholdDbm: -120, hysteresisDb: 3 };
      }),
      walk: { to: { x: 0.5, y: 0.5, z: 1.5 }, speedMps: 0.6, pingPong: true },
    }),
  },
  {
    id: 'zones-dead-spot',
    title: 'Two antennas: covering a dead spot behind a wall',
    note: 'Problem: a heavy wall splits the venue in two. With one transmit antenna the room behind the wall is a dead spot; a second antenna on the far side, fed through a splitter from the same transmitter, covers it. Remove or move antenna 2 and watch the zone fail.',
    build: () => ({
      scene: make('iem', (s, l) => {
        s.stage = { width: 24, depth: 12 };
        s.reflectors = [createReflector({ id: newId('refl'), name: 'Dividing wall', material: 'concrete', p1: { x: 12, y: 0 }, p2: { x: 12, y: 12 }, zMin: 0, zMax: 4, transmissionLossDb: 55 })];
        l.tx.pos = { x: 3, y: 6, z: 2.5 };
        l.rx.pos = { x: 6, y: 6, z: 1.5 };
        l.chain = [createChainItem('cable', { cableType: 'lmr-400', lengthM: 10 })];
        s.zones = [createZone({ id: newId('zone'), name: 'Room behind the wall', polygon: [{ x: 14, y: 2 }, { x: 22, y: 2 }, { x: 22, y: 10 }, { x: 14, y: 10 }], zMin: 0, zMax: 2, requiredMarginDb: 10 })];
        l.branches = [{}, createBranch({ name: 'Antenna 2', pos: { x: 20, y: 6, z: 2.5 }, chain: [createChainItem('cable', { cableType: 'lmr-400', lengthM: 30 })] })];
      }),
    }),
  },
  {
    id: 'zones-long-hall',
    title: 'Long distance: antenna at the far end of a hall with a booster',
    note: 'Best practice: a long cable to a far antenna loses more than the antenna can make up, so the far end of the hall is weak. A 24 dB booster after the cable on that branch brings the far zone up to its required level (with only 20 dB, about a third of the zone still falls short). Compare the map with and without the booster in the branch chain.',
    build: () => ({
      scene: make('iem', (s, l) => {
        s.stage = { width: 60, depth: 20 };
        l.tx.pos = { x: 3, y: 10, z: 2.5 };
        l.tx.powerDbm = -14;
        l.rx.pos = { x: 30, y: 10, z: 1.5 };
        l.chain = [createChainItem('cable', { cableType: 'lmr-400', lengthM: 5 })];
        s.zones = [createZone({ id: newId('zone'), name: 'Far end', polygon: [{ x: 44, y: 4 }, { x: 58, y: 4 }, { x: 58, y: 16 }, { x: 44, y: 16 }], zMin: 0, zMax: 2, requiredMarginDb: 10 })];
        l.branches = [{}, createBranch({ name: 'Far antenna', pos: { x: 56, y: 10, z: 2.5 },
          chain: [createChainItem('cable', { cableType: 'lmr-400', lengthM: 80 }), createChainItem('booster', { gainDb: 24 })] })];
      }),
    }),
  },
  {
    id: 'zones-coherent-nulls',
    title: 'Coherent overlap nulls: two antennas too close together',
    note: 'Problem: two antennas fed from one transmitter carry the same signal. Where their waves arrive in opposite phase they cancel, giving a pattern of dead stripes. Spacing the antennas apart, or adding a small attenuator to one, reduces the depth of the nulls.',
    build: () => ({
      scene: make('iem', (s, l) => {
        s.stage = { width: 16, depth: 10 };
        s.coverage = { mode: 'coherent' };
        l.tx.pos = { x: 7, y: 2, z: 2.5 };
        l.rx.pos = { x: 8, y: 6, z: 1.5 };
        l.tx.antenna = { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 } };
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 10 })];
        l.branches = [{}, createBranch({ name: 'Antenna 2', pos: { x: 8.5, y: 2, z: 2.5 }, antenna: { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 } },
          chain: [createChainItem('cable', { cableType: 'rg58', lengthM: 10 })] })];
      }),
    }),
  },
  {
    id: 'zones-backstage-corridor',
    title: 'Zone check: backstage corridor',
    note: 'Compare: the backstage corridor needs reliable IEM coverage with 10 dB of margin. The zone table shows the worst point and the share of the corridor that passes; the suggestions list what would help most, such as moving an antenna or adding gain.',
    build: () => ({
      scene: make('iem', (s, l) => {
        s.stage = { width: 24, depth: 12 };
        s.reflectors = [createReflector({ id: newId('refl'), name: 'Backstage wall', material: 'brick', p1: { x: 0, y: 8 }, p2: { x: 24, y: 8 }, zMin: 0, zMax: 4, transmissionLossDb: 40 })];
        l.tx.pos = { x: 4, y: 4, z: 2.5 };
        l.rx.pos = { x: 12, y: 3, z: 1.5 };
        l.chain = [createChainItem('cable', { cableType: 'lmr-400', lengthM: 10 })];
        s.zones = [createZone({ id: newId('zone'), name: 'Backstage corridor', polygon: [{ x: 1, y: 9.5 }, { x: 23, y: 9.5 }, { x: 23, y: 11 }, { x: 1, y: 11 }], zMin: 0, zMax: 2, requiredMarginDb: 10 })];
        l.branches = [{}, createBranch({ name: 'Antenna 2', pos: { x: 12, y: 9, z: 2.5 }, chain: [createChainItem('cable', { cableType: 'lmr-400', lengthM: 20 })] })];
      }),
    }),
  },
  {
    id: 'imd-too-close',
    title: 'Two mics too close to the receive antenna',
    note: 'Problem: mics B and C are held next to the receive antenna, so each arrives far stronger than the wanted mic A. The level meter shows the own transmitter of the link (about -46 dBm); in the intermod panel mic A is about -40 dBm at the antenna. The receiver front end is not perfectly linear and mixes them: twice B minus C lands exactly on the channel of mic A and buries it. The squelch closes with the reason intermod.',
    build: () => ({
      scene: imdScene('mic', 605.6, [
        ['Mic A (wanted)', 605.6, 14, 2, 3, 1.5], ['Mic B', 606.0, 14, 9.5, 6.5, 2.0], ['Mic C', 606.4, 14, 9.3, 6.0, 2.0], ['Mic D', 607.2, 14, 6, 2, 1.5],
      ], {}),
    }),
  },
  {
    id: 'imd-iem-no-isolation',
    title: 'IEM combiner with no isolation',
    note: 'Problem: three IEM transmitters share a simple passive combiner with only 15 dB of isolation. Each one leaks a little of the others back into its own output stage, where the amplifier mixes them. Twice 606.0 minus 606.4 lands on 605.6, the channel of the third transmitter, as a spurious signal radiated from the antenna.',
    build: () => ({
      scene: imdScene('iem', 605.6, [
        ['IEM A (wanted)', 605.6, 10, 1.0, 1.0, 1.5], ['IEM B', 606.0, 10, 1.2, 1.0, 1.5], ['IEM C', 606.4, 10, 1.4, 1.0, 1.5],
      ], { preset: 'iem-combiner-no-isolation', iip3Dbm: 10, combiner: { type: 'hybrid', isolationDb: 15, lossDb: 3.5 } }, iemHall),
    }),
  },
  {
    id: 'imd-iem-isolators',
    title: 'IEM combiner with isolators: same transmitters',
    note: 'Best practice: the same three transmitters, now through an isolated combiner with circulators. The isolators cut each interferer by 50 dB instead of 15 before it reaches the other amplifiers. The product made in an amplifier grows one decibel per decibel of interferer (the own carrier of the transmitter is not reduced), so it falls by the 35 dB isolation difference less 1.5 dB because this combiner loses 1.5 dB less on the way out: about 33.5 dB, not 100 dB. The 3 dB per dB rule belongs to products made in the receiver, where every carrier is lowered.',
    build: () => ({
      scene: imdScene('iem', 605.6, [
        ['IEM A (wanted)', 605.6, 10, 1.0, 1.0, 1.5], ['IEM B', 606.0, 10, 1.2, 1.0, 1.5], ['IEM C', 606.4, 10, 1.4, 1.0, 1.5],
      ], { preset: 'iem-combiner-isolated', iip3Dbm: 10, combiner: { type: 'isolated', isolationDb: 50, lossDb: 2 } }, iemHall),
    }),
  },
  {
    id: 'imd-move-apart',
    title: 'Move them apart: intermods fall',
    note: 'Best practice: same four frequencies as the first intermod example, but the mics are now 8 to 9 metres from the receive antenna. The products fall three decibels for every decibel the carriers fall, so even this small increase in distance leaves the wanted channel clean. Drag a mic towards the antenna and watch it return.',
    build: () => ({
      scene: imdScene('mic', 605.6, [
        ['Mic A (wanted)', 605.6, 14, 2, 3, 1.5], ['Mic B', 606.0, 14, 2.0, 6.5, 1.5], ['Mic C', 606.4, 14, 2.5, 2.0, 1.5], ['Mic D', 607.2, 14, 3, 4, 1.5],
      ], {}),
    }),
  },
  {
    id: 'imd-iem-8-combined',
    title: 'Eight IEMs: all through one isolated 8-way combiner (A)',
    note: 'Best practice: eight coordinated IEM transmitters (606.1 to 623.7 MHz, 25 mW each, no third-order product in any channel) feed one isolated 8-way combiner (4.5 dB through, 45 dB port isolation, assumed) and one directional antenna. Every channel loses the same 4.5 dB and reaches the bodypack at about -37.3 dBm; the worst pair of transmitters is 45.0 dB apart, so the strongest product made in an output stage (2f1-f2) is only -102.3 dBm at the bodypack, -64.9 dBc. The plan is not free of fifth-order products: 158 still land in channels, but their summed level is only -244.0 dBm, and the 12.6 dB floor rise at the worst channel is wideband noise from the other transmitters, not intermod. Pros: one antenna, balanced levels; cons: 4.5 dB lost per channel, one point of failure; compare the 7 plus 1 and 4 plus 4 examples (figures illustrative).',
    build: () => ({ scene: iem8Scene('A') }),
  },
  {
    id: 'imd-iem-7-plus-1-omni',
    title: 'Seven IEMs on a directional antenna, one on an omni 2.5 m away (B)',
    note: 'Problem: the same eight frequencies: seven go through a combiner (4 dB, 45 dB isolation) to the directional antenna, the eighth goes straight to an omni antenna 2.5 m in front of it, inside the main lobe. the omni transmitter has no isolator: the field of the other seven reaches its output stage only 33.1 dB down, where it mixes; the worst product is 2f8-f1 at -91.6 dBm at the bodypack (-53.1 dBc), 10.7 dB worse than the single combiner; it lands outside the IEM band but is still radiated; the odd channel is also weaker at the bodypack (-38.5 dBm against -36.8 dBm). Fixes, all in the model: move the omni to the side of the antenna, in a pattern null (45.0 dB, -101.8 dBm), put it 6 m away (-97.8 dBm), or add an isolator (35 dB) on the omni transmitter; Pros: directional gain for seven channels, lower combiner loss; Cons: an unprotected transmitter, different coverage per channel, harder to document. Illustrative figures.',
    build: () => ({ scene: iem8Scene('B') }),
  },
  {
    id: 'imd-iem-4plus4-combined',
    title: 'Eight IEMs: two 4-way combiners and a passive 2-way to one antenna (C)',
    note: 'Less ideal: the same eight frequencies in two 4-way isolated combiners (3 dB, 40 dB, each transmitter with its own 20 dB isolator) joined by a passive 2-way hybrid (3.5 dB, 25 dB, assumed) to the same directional antenna. every channel now loses 6.5 dB, 2.0 dB more than the 8-way, so the bodypack gets -39.3 dBm; inside a group the isolation is 40.0 dB; between groups the path is 3 + 25 + 3 + 20 = 51.0 dB because each transmitter is still protected by its own isolator, and the worst product is -99.3 dBm (-59.9 dBc), 3.0 dB worse than the 8-way; take the isolators away (a plain 4-way and hybrid) and the cross-group isolation falls to 31.0 dB and the worst product rises to -90.3 dBm. Pros: modular, cheaper units, a failed module takes out four channels, not eight; Cons: more loss, more connectors, the hybrid is the weak link. Illustrative figures.',
    build: () => ({ scene: iem8Scene('C') }),
  },
  {
    id: 'band-whip-wrong-band',
    title: 'Antenna band: a whip cut for 470-520 MHz used at 830 MHz',
    note: 'Problem: the receive whip is cut for UHF band A (470-520 MHz, assumed) but the link is at 830 MHz. Its VSWR is 59.3:1, a mismatch loss of 11.9 dB (about 3.9 times less range in free space), where a whip cut for 790-865 MHz loses 0.0 dB. The swap of antennas between bands is a classic field error. Design bands and the resonance model are assumed teaching figures.',
    build: () => ({ scene: bandScene('whip-wrong-band') }),
  },
  {
    id: 'band-uhf-vs-2g4',
    title: 'Antenna band: a 2.4 GHz antenna on a 600 MHz link, and the reverse',
    note: 'Compare: a 2.4 GHz antenna on a 600 MHz microphone link has a VSWR of 1235.3:1 and loses 24.9 dB (the model caps the loss at 30 dB). The reverse, a UHF 600-700 MHz antenna on a 2440 MHz link, loses 18.1 dB at 259.2:1. A mismatched antenna reflects the power rather than burning it, but the link margin falls by the same amount. Assumed teaching model.',
    build: () => ({ scene: bandScene('uhf-vs-2g4') }),
  },
  {
    id: 'band-iem-tx-wrong-antenna',
    title: 'Antenna band: IEM transmitter into an antenna cut for 863-865 MHz',
    note: 'Problem: the 100 mW IEM transmitter at 606.1 MHz drives an antenna cut for 863-865 MHz (assumed, a whip about 8 percent wide at best): VSWR 46.2:1, 10.8 dB mismatch loss, and 92 percent of the power (19.6 dBm) returns to the output stage, which can stress the PA or trigger foldback. A 6 dB pad cuts that to 1.6 dBm (1.6:1 at the PA, the reflection crosses the pad twice); an isolator (0.5 dB forward, 20 dB reverse, assumed) gives 1.2:1 at the PA and -0.9 dBm. The real fix is the right antenna. Illustrative figures.',
    build: () => ({ scene: bandScene('iem-tx-wrong-band') }),
  },
  {
    id: 'band-wideband-vs-whips',
    title: 'Antenna band: one wideband antenna against narrow whips cut per band',
    note: 'Compare: a wideband antenna (470-960 MHz, assumed log-periodic or paddle, flat about 1.3:1) loses 0.07 dB at 830 MHz, the same link with a whip cut for 470-520 MHz loses 11.9 dB. The whip cut for 790-865 MHz is as good (0.0 dB) but only in its own band, so a wideband antenna is the safe choice when several bands are in use. The price is lower gain and a less clean pattern, assumed.',
    build: () => ({ scene: bandScene('wideband-vs-whips') }),
  },
  {
    id: 'band-whip-trim',
    title: 'Antenna band: trimming a whip, the VSWR dip and the 606 MHz channel',
    note: 'Best practice: a whip cut for 570-608 MHz (assumed) sits at the top edge of its band at 606 MHz: VSWR 1.69:1 and 0.30 dB of mismatch loss. Trimmed to resonate at 596-616 MHz the VSWR at 606 MHz is 1.0:1 and the loss 0.00 dB. A NanoVNA S11 sweep shows the dip move as the whip is cut (returnLossSweep in the model draws it). A hand or the body shifts the dip, assumed.',
    build: () => ({ scene: bandScene('whip-trim') }),
  },
  {
    id: 'band-filter-wrong-band',
    title: 'Antenna band: a 863-865 MHz bandpass filter on a 606.1 MHz channel',
    note: 'Problem: the transmit chain has a bandpass filter for 863-865 MHz (assumed 40 dB rejection) but the IEM runs at 606.1 MHz: the signal at the bodypack drops from -36.4 to -76.4 dBm and the margin from 53.6 to 13.6 dB. A filter must be chosen for the channel, like an antenna. The warning in the link says so.',
    build: () => ({ scene: bandScene('filter-wrong-band') }),
  },
  {
    id: 'audience-crowd',
    title: 'Audience: a standing crowd between the stage and a low receive antenna',
    note: 'Problem: a handheld microphone on stage and a receive antenna 1.5 m high at the back of the room, across 20 m of standing audience (2 persons per m2, heads at 1.7 m). The ray runs through the crowd below head height and loses 20.0 dB (assumed 0.5 dB per metre per person per m2), so the margin falls from 51.8 to 31.8 dB. Raising the antenna to 2.5 m puts the ray above the heads for all but 1.0 dB of its path, and at 4.7 persons per m2 the loss saturates at the 30 dB cap. Absorption figures are assumed and unverified.',
    build: () => ({ scene: audienceScene() }),
  },
  {
    id: 'ceiling-metal-roof',
    title: 'Ceiling: a metal-roofed tent or shed over a 15 m link',
    note: 'Problem: a metal roof 5 m up is a near-perfect reflector at 606 MHz. Its ray arrives only 0.9 dB below the direct ray and 1.6 m behind it, and with the floor ray the sum changes the received level by -1.6 dB (it can be a fade or a boost depending on the spot). Move the receiver a little to see the pattern change; wavelength is 0.5 m. Material and geometry are illustrative.',
    build: () => ({ scene: ceilingScene('tent') }),
  },
  {
    id: 'ceiling-arena-flown',
    title: 'Ceiling: arena roof 15 m up, receive antenna flown at 12 m',
    note: 'Less ideal: a flown antenna 3 m under a metal arena roof sits so close to its own reflection that the ceiling ray is only 0.6 dB below the direct one and 2.4 m longer. The coherent sum changes the received level by +4.5 dB at this spot (a different spot can fade). Flown antennas near roofs need height or pattern checks, not just distance. Illustrative figures.',
    build: () => ({ scene: ceilingScene('arena') }),
  },
  {
    id: 'ceiling-low-club',
    title: 'Ceiling: a low plasterboard club ceiling over a 12 m link',
    note: 'Compare: a plasterboard ceiling at 2.8 m reflects much less than metal: its ray is 9.1 dB below the direct ray and 0.3 m longer, a +1.9 dB change in the received level at this spot. Low ceilings add short-delay reflections that move the nulls closer together. Illustrative figures.',
    build: () => ({ scene: ceilingScene('club') }),
  },
  {
    id: 'rof-coax-vs-fibre',
    title: 'RF over fibre: a 300 m antenna run in coax, passive fibre and active fibre',
    note: 'Compare: the receive antenna head is 300 m from the rack. RG213 coax delivers -89.6 dBm to the receiver (margin 5.4 dB); a passive RF over fibre link (assumed -25 dB gain, 30 dB noise figure, 1.1 dB optical loss, so 2.2 dB more RF loss) gives -61.2 dBm with a system noise figure of 36.5 dB; one with built-in amplifiers gives -26.2 dBm at 12.4 dB. The fibre adds 1.47 microseconds of delay, irrelevant for audio. All fibre module figures are assumed placeholders: use a datasheet.',
    build: () => ({ scene: rofScene('passive') }),
  },
  {
    id: 'rof-branch-mismatch',
    title: 'RF over fibre: two antenna branches with different fibre lengths',
    note: 'Problem: an IEM transmitter feeds two antenna branches over passive RF over fibre, 0.1 km and 0.6 km (assumed modules). The delay spread is 2450 ns, so combined at RF the two do not add in phase (1 ns is 216 degrees at 600 MHz) and the link warns. Use equal fibre lengths on branches that are combined coherently. Figures are illustrative.',
    build: () => ({ scene: rofBranchScene() }),
  },
  {
    id: 'sos-iem-too-close',
    title: 'Side of stage: IEM antenna 0.5 m from the mic receiver antenna',
    note: 'Problem: a 100 mW IEM transmitter (20 dBm, 614.0 MHz) faces a mic receive paddle 0.5 m away with the same polarisation and a 12 dB booster behind it. Only 8.2 dB separates them, so +22.5 dBm reaches the receiver input against a -18 dBm P1dB and a -10 dBm maximum (assumed receiver figures): 40.5 dB over, desense capped at 40 dB, and the wanted mic margin falls from 41.1 dB to 1.1 dB. The IM3 product of the IEM and the mic is +27.8 dBm, so the booster makes it worse. Free-space figures; a real room adds or subtracts a few dB.',
    build: () => ({ scene: sosScene('too-close') }),
  },
  {
    id: 'sos-iem-crossed-pol',
    title: 'Side of stage: 3.3 m apart, slant mic antennas, rack in between',
    note: 'Less ideal: the IEM antenna is vertical and the mic antennas slant 45 degrees, so the wanted mic loses 3 dB of polarisation (never a null) and the IEM is only 3 dB cross-polar; they are 3.3 m apart, both paddles aimed at the stage so each sits in the other side lobe, with a rack screen (2.5 dB, assumed) between. Coupling is 59.4 dB, the IEM reaches the receiver at -43.7 dBm with 25.7 dB of headroom, and desense is 0. The wanted mic keeps 50.1 dB of margin, which already includes that 3 dB. A horizontal mic antenna would isolate 14.9 dB more but cost the wanted mic 15.0 dB, so distance and the antenna patterns do the work here.',
    build: () => ({ scene: sosScene('crossed-pol') }),
  },
  {
    id: 'sos-iem-best-practice',
    title: 'Side of stage: best practice (filter, low power, remote antennas)',
    note: 'Best practice: the IEM runs 10 mW (10 dBm) from a stand at the stage-side edge aimed at the stage, and the IEM link still has 40.8 dB of margin. The mic antennas are 10.8 m away, high and behind its beam, slant 45 degrees so the wanted mic loses only 3 dB, with a 604 to 608 MHz bandpass filter (40 dB rejection, assumed) and 15 m of cable. Coupling is 66.6 dB but only -101.1 dBm reaches the receiver input (83.1 dB of headroom, no desense) and the wanted mic keeps 44.1 dB, a margin that already includes the polarisation loss. Distance and the filter do most of the work; power only costs the IEM margin you need.',
    build: () => ({ scene: sosScene('best') }),
  },
  {
    id: 'foh-mic-iem-audience',
    title: 'FOH: low antennas behind a standing crowd',
    note: 'Problem: mic receive and IEM transmit paddles sit at table height (1.2 m) at FOH, 26 m from the performer, behind 18 m of standing crowd at 4 persons per m2 (assumed absorption 0.5 dB per metre per person per m2, capped at 30 dB). The crowd takes 30.0 dB and the performer body 3 dB on the mic link, leaving it 2.0 dB of margin (-93.0 dBm at the receiver input) and the IEM link 13.6 dB. At 3 per m2 the mic margin is 4.9 dB; a seated crowd at 1.5 per m2 leaves 22.7 dB for the mic and 30.1 dB for the IEM because the ray passes over seated heads.',
    build: () => ({ scene: fohScene('low') }),
  },
  {
    id: 'foh-raised-antennas',
    title: 'FOH: antennas raised to 3 m on stands or a truss',
    note: 'Best practice: the same paddles aimed at the stage at 3.0 m clear the heads for most of the crowd: the mic ray no longer meets any absorption and the receiver input rises to -65.5 dBm. The mic margin recovers from 2.0 dB to 29.5 dB (27.5 dB) and the IEM margin from 13.6 dB to 41.0 dB (27.4 dB); the IEM still loses 6.5 dB because the bodypack is low on the performer. Height is the cheapest fix, so raise the antennas before adding gain.',
    build: () => ({ scene: fohScene('raised') }),
  },
  {
    id: 'foh-remote-antennas',
    title: 'FOH: antennas at the stage side, 45 m of cable back to FOH',
    note: 'Best practice: the antennas move to the stage side at 3.0 m, 9 m from the performer and outside the crowd, with 45 m of LMR-400 back to FOH. A 15 dB booster at the antenna end and a 12 dB pad at the receiver input give a mic margin of 63.2 dB and an input of -31.0 dBm, 13.0 dB under P1dB (level ok); without the pad the input would be -19.0 dBm, 1.0 dB under P1dB and hot. The IEM link pays 4.9 dB of cable and has no booster (power limit), so it keeps 55.1 dB; the same booster after the cable gives 61.9 dB, and the active RF over fibre preset (assumed figures, same pad) gives 58.9 dB at -33.1 dBm. Against the low antennas that recovers 61.2 dB on the mic and 41.5 dB on the IEM.',
    build: () => ({ scene: fohScene('remote') }),
  },
  {
    id: 'video-wall-class-b',
    title: 'Video wall: EMC class B noise, FOH versus stage side',
    note: 'Problem: a 14 m LED wall behind the band radiates at the class B limit (30 / 37 dBuV/m at 10 m, a ceiling, assumed). The FOH paddle 27 m away looks straight at it: -98.3 dBm in 200 kHz lifts the floor 14.3 dB and cuts the mic margin from 34.2 dB (wall off) to 19.8 dB. A stage-side receiver sees 17.5 dB of rise but is close to the mic, so it keeps 48.9 dB. The metal wall also returns a reflection only 3.5 dB below the direct ray, so expect multipath.',
    build: () => ({ scene: videoWallScene({ preset: 'class-b', rx: 'foh' }) }),
  },
  {
    id: 'video-wall-noisy',
    title: 'Video wall: noisy budget panels',
    note: 'Problem: budget panels or poor cabling (class A plus 15 dB, assumed) put -73.3 dBm in the FOH receiver and raise the floor by 39.2 dB, so the mic margin falls to -5.0 dB and the link fails. A wall at the class A limit leaves 10.0 dB. With the receiver at the stage front, 3 m from the wall, the noisy wall still leaves only 8.2 dB, and 24.0 dB with the receiver at the stage side. A CE-marked wall can still be the loudest thing in the band.',
    build: () => ({ scene: videoWallScene({ preset: 'noisy', rx: 'foh' }) }),
  },
  {
    id: 'video-wall-fixes',
    title: 'Video wall: the fixed scene (distance, aim, cabling)',
    note: 'Best practice: this is the fixed version of video-wall-noisy, whose FOH receiver has a margin of -5.0 dB: the receiver sits at the stage side aimed at the performer with the wall off its beam, and ferrite chokes and shielded data cable bring the wall down to class B (15 dB less, assumed). The noise in the receiver is -95.0 dBm, 17.5 dB of rise, and the mic margin is 48.9 dB, 53.9 dB better. Moving the receiver alone gives 24.0 dB (28.9 dB better) and the class B wall alone 19.8 dB at FOH (24.8 dB better).',
    build: () => ({ scene: videoWallScene({ preset: 'class-b', rx: 'side' }) }),
  },
  {
    id: 'video-wall-solid-vs-mesh',
    title: 'Video wall: solid metal, mesh and carbon fibre construction',
    note: 'Compare: three wall sections side by side on one stage (solid metal, 10 mm metal mesh and carbon mesh, class A noise), each with a receiver 2.5 m behind it: the crossing loss is 40.0, 27.9 and 28.9 dB, and the noise reaching each receiver is -91.0, -72.2 and -75.1 dBm (the solid one includes the neighbouring walls leaking in), leaving margins of 16.2, -2.6 and 0.4 dB. Seen from FOH the metal and metal mesh both reflect at -3.5 dB and carbon at -9.5 dB. Holes of 100 mm (a coarse curtain) shield only 7.9 dB at 606 MHz, so a mesh wall is no free pass at UHF. All construction figures are assumed.',
    build: () => ({ scene: videoWallScene({ preset: 'class-a', rx: 'back', sections: ['solid-metal', 'mesh-metal', 'mesh-carbon'] }) }),
  },
  {
    id: 'even-wideband-booster',
    title: 'Even-order products: 500 and 700 MHz mics on a wideband booster',
    note: 'Problem: two mics on 500 and 700 MHz, 2.5 m from the receive antenna, drive a wideband booster (IIP2 +30 dBm, assumed): the sum (1200 MHz) and difference (200 MHz) products are both -88.7 dBm, 24.3 dB over the receiver noise floor, and fall 2 dB per dB of input against 3 dB for IM3. Neither lands in the 600 MHz channel, but the 200 MHz one sits in a VHF band the system also uses. A 470-698 MHz bandpass behind the booster (40 dB, assumed) takes both to -128.7 dBm, 15.7 dB under the floor.',
    build: () => ({ scene: evenScene('wideband') }),
  },
  {
    id: 'even-vhf-uhf-booster',
    title: 'Even-order products: VHF and UHF mics into one booster',
    note: 'Problem: a 190 MHz VHF mic and a 475 MHz UHF mic share one wideband booster and the receiver listens on 665 MHz: f1 + f2 is exactly 665 MHz, -76.9 dBm in the wanted channel and 36.1 dB over the floor. A 470-698 MHz bandpass in front of the booster (60 dB, assumed) removes the VHF tone before it can mix and drops the product to -136.9 dBm. Separate antennas or a filter ahead of any shared gain stage is the fix.',
    build: () => ({ scene: evenScene('vhf-uhf') }),
  },
  {
    id: 'even-second-harmonic',
    title: 'Even-order products: a 902 MHz IEM transmitter and a 1.8 GHz bodypack',
    note: 'Problem: a 902 MHz IEM transmitter 1.5 m from a 1795 MHz bodypack radiates a second harmonic 50 dB down (assumed), arriving at -74.1 dBm in the 1785-1805 MHz band, 38.9 dB over the floor. A 60 dB low-pass on the transmitter output (assumed) takes it to -134.1 dBm, 21.1 dB under the floor. The bodypack filter keeps the 902 MHz carrier itself out of the receiver, so the harmonic is the only even-order problem.',
    build: () => ({ scene: evenScene('harmonic') }),
  },
  {
    id: 'even-narrow-uhf-good',
    title: 'Even-order products: narrow-band UHF, the good case',
    note: 'Best practice: two UHF mics 8.2 MHz apart into a narrow-band receiver (IIP2 +40 dBm, assumed) give a sum near 1220 MHz and a difference of 8.2 MHz at -99.2 dBm, none in the wanted channel or any other band the system uses. Only the third-order product 2f1-f2 at -72.8 dBm matters here. Keep the wanted bands apart by more than an octave and even order products stay out of band.',
    build: () => ({ scene: evenScene('narrow-uhf') }),
  },
  {
    id: 'tone-pilot-products',
    title: 'Programme tone and the 19 kHz pilot: where the products come from',
    note: 'Problem: a 1 kHz sine at 40 percent of 75 kHz peak deviation (30 kHz, beta 30) rides with the 10 percent pilot (7.5 kHz, beta 0.395). In the baseband the two only add, but a limiter 6 dB under its nominal drive (assumed) puts products at 18 and 20 kHz (-49.5 dB), 17 and 21 kHz (-60.2 dB) and 37 and 39 kHz (-72.4 dB), and the pilot cubed lands at 57 kHz (-94.3 dB) in the RDS band. In the RF the FM itself adds sidebands at fc +- n x 1 kHz +- m x 19 kHz with weights J_n(30) J_m(0.395), filling about 102 kHz. Cures: a low-pass before the limiter, no limiting of the composite, and a pilot-notched limiter.',
    build: () => ({ scene: toneMpxScene('products') }),
  },
  {
    id: 'tone-pilot-beat',
    title: 'Programme tone near the pilot: a 19.3 kHz tone beats with it',
    note: 'Problem: a 19.3 kHz tone leaks past the 15 kHz audio low-pass, which is only 41.4 dB down there (assumed filter), leaving it 28.4 dB under the 9 percent pilot. It beats with the pilot at 300 Hz, inside the decoder loop bandwidth (assumed), wobbling the pilot phase by up to 2.2 degrees and costing stereo separation. A tone above 23 kHz would fold down through the L-R demodulator instead (25 kHz appears at 13 kHz). Keep the tone at 15 kHz or lower, steepen the filter or notch the pilot region.',
    build: () => ({ scene: toneMpxScene('beat') }),
  },
  {
    id: 'tone-sweep-pilot',
    title: 'Swept tone through the MPX: the moment it reaches the pilot',
    note: 'Problem: a swept tone passes 17 kHz where the assumed filter is only 21.2 dB down, leaving it 8.2 dB under the pilot and wobbling its phase by up to 22.8 degrees at a 2000 Hz beat. This is where the stereo decoder flickers or drops lock. The same sweep above 23 kHz folds down by 38 kHz through the L-R path. The cure is a steeper audio filter with the limiter placed after it.',
    build: () => ({ scene: toneMpxScene('sweep') }),
  },
  {
    id: 'tone-key-harmonics',
    title: 'Mono mic: a 10.9 kHz tone overloaded lands its third harmonic on the tone-key',
    note: 'Problem: a 10.9 kHz tone at 60 percent deviation with the stage at its nominal limit (0 dB) has a third harmonic at 32.7 kHz, -36.6 dB under 100 percent modulation. The assumed 32.768 kHz tone-key window is 1 kHz wide, so the harmonic sits inside it and can hold the squelch open or mute it. Tone-key frequencies are not published for real systems, so check on the bench. Cures: low-pass the audio after the limiter, back off the level, or notch the tone-key frequency.',
    build: () => ({ scene: toneMpxScene('tone-key') }),
  },
  {
    id: 'tone-overdeviation',
    title: 'Overdeviation: a loud tone plus the pilot passes 100 percent',
    note: 'Problem: a 1 kHz tone at 95 percent of peak deviation plus the 9 percent pilot sums to 104 percent, 0.3 dB over the limit, so the limiter clips (beta 71). The third harmonic sits at -28.4 dB, the J0 J0 carrier term falls to -33.9 dB as the Bessel weights spread over about 186 kHz, and products at 18 and 20 kHz reach -36.9 dB. The pilot cubed lands at 57 kHz (-86.2 dB) in the RDS band. Limit the programme before the pilot is added and keep the tone below 91 percent.',
    build: () => ({ scene: toneMpxScene('overdev') }),
  },
  {
    id: 'p2p-wireless-snake',
    title: 'Point to point: wireless snake send across a field',
    note: 'Less ideal: a 20 dBm send at 606 MHz crosses 1.2 km between two yagis on 6 m masts (assumed gain). The received power is -60.3 dBm with 30.5 dB of margin, but only 49 percent of the first Fresnel zone is clear at 0.6 km, so the earth costs 0.6 dB. On 2 m masts the clearance falls to 16 percent and the loss to 4.1 dB.',
    build: () => ({ scene: p2pScene('snake') }),
  },
  {
    id: 'p2p-delay-speaker',
    title: 'Point to point: FOH to a stage-left delay speaker',
    note: 'Best practice: a 17 dBm send at 606 MHz crosses 150 m between paddle antennas at 3 m. The received power is -50.6 dBm with 40.1 dB of margin and 70 percent of the first Fresnel zone is clear, so the 60 percent rule is met. Over a path this long the ground reflection is left off: switched on it only adds about 1.6 dB (see p2p-ground-reflection for a short path with a real ripple).',
    build: () => ({ scene: p2pScene('delay') }),
  },
  {
    id: 'p2p-truck-hill',
    title: 'Point to point: broadcast truck to a remote camera position',
    note: 'Less ideal: a 30 dBm send at 606 MHz covers 8 km between yagis at 12 m and 6 m with a 30 m hill 3 km from the truck. The hill is a single knife edge that costs 13.8 dB, leaving -80.0 dBm received and 10.8 dB of margin and the clearance is far below the 60 percent rule. Without the hill the earth alone costs 3.2 dB and the received power is -69.3 dBm.',
    build: () => ({ scene: p2pScene('truck') }),
  },
  {
    id: 'p2p-bodypack-line-feed',
    title: 'Point to point: two bodypacks as a wireless line feed',
    note: 'Less ideal: two bodypacks with whips at 1.5 m carry a line feed over 60 m at 606 MHz with 10 dBm and nobody wearing them, so there is no body loss. The received power is -78.7 dBm with 12.1 dB of margin. The path is under 100 m and only 55 percent of the first Fresnel zone is clear, so the model warns; a mic link is the better tool here.',
    build: () => ({ scene: p2pScene('bodypack') }),
  },
  {
    id: 'imd-pim',
    title: 'Rusty connector: PIM',
    note: 'Problem: two 20 W transmitters sit side by side behind an isolated combiner and the receiver is linear, which holds active intermod at the wanted channel to about -114 dBm. The product made passively by the antenna-line connector is -118 dBm for a corroded connector and -153 dBm for a good one: 35 dB apart. At this power that product stays below the noise from the transmitters themselves (about -103 dBm), so the noise rise is the same for both; passive intermod only starts to matter at much higher power, where it grows three times faster than the carriers.',
    build: () => ({
      scene: imdScene('mic', 604.0, [
        ['Receiver mic (wanted)', 604.0, 0, 24, 12, 1.5], ['High-power TX 1', 606.0, 43, 2, 10, 2.5], ['High-power TX 2', 608.0, 43, 3, 10, 2.5],
      ], { preset: 'pim-corroded-connector', iip3Dbm: 30, combiner: { type: 'isolated', isolationDb: 70, lossDb: 2 }, pim: { preset: 'corroded', levelDbc: null } }, (s, l, m) => {
        s.stage = { width: 40, depth: 20 };
        l.rx.pos = { x: 27, y: 10, z: 2.5 };
        m.rxAntennaPos = { x: 27, y: 10, z: 2.5 };
      }),
    }),
  },
  {
    id: 'imd-plan-bad',
    title: 'Intermod-free frequency plan vs a bad plan',
    note: 'Compare: four transmitters equally spaced by 400 kHz: nearly every third-order product lands on the channel of another transmitter. Retune them to 606.000, 606.500, 610.200 and 611.700 MHz: no third- or fifth-order product then lands within 500 kHz of any channel centre, so the coordination check clears and the 400 kHz clearance rule is met.',
    build: () => ({
      scene: imdScene('mic', 606.4, [
        ['Mic A', 606.0, 14, 9.0, 6.0, 1.5], ['Mic B', 606.4, 14, 9.2, 7.2, 1.5], ['Mic C', 606.8, 14, 8.8, 5.2, 1.5], ['Mic D', 607.2, 14, 9.4, 5.6, 1.5],
      ], {}),
    }),
  },
  {
    id: 'cascade-booster-antenna',
    title: 'Cascaded noise figure: booster at the antenna',
    note: 'Best practice: a 20 dB booster at the antenna comes first in the chain, so the 25.5 dB of cable loss after it adds little noise: the system noise figure is 13.9 dB and the link has 12 dB of margin. Compare with the same parts the other way round in the next example.',
    build: () => ({
      scene: make('mic', (s, l) => {
        l.tx.pos = { x: 1, y: 1, z: 1.5 };
        l.tx.powerDbm = -20;
        l.chain = [createChainItem('booster', { gainDb: 20, nfDb: 3 }), createChainItem('cable', { cableType: 'rg58', lengthM: 60 })];
        l.rx.squelch = { enabled: true, thresholdDbm: -100, hysteresisDb: 3 };
      }),
    }),
  },
  {
    id: 'cascade-booster-rack',
    title: 'Cascaded noise figure: booster at the rack',
    note: 'Less ideal: the same booster and cable, but the booster sits at the rack after the long cable. The cable loss now comes first and adds its full 25.5 dB to the noise figure, giving 28.6 dB overall. The received power is identical, but the link margin falls to about -3 dB and the link fails.',
    build: () => ({
      scene: make('mic', (s, l) => {
        l.tx.pos = { x: 1, y: 1, z: 1.5 };
        l.tx.powerDbm = -20;
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 60 }), createChainItem('booster', { gainDb: 20, nfDb: 3 })];
        l.rx.squelch = { enabled: true, thresholdDbm: -100, hysteresisDb: 3 };
      }),
    }),
  },
  {
    id: 'stray-carrier-pilot',
    title: 'Stray carrier: pilot squelch rejects it',
    note: 'Compare: an unmodulated stray carrier arrives 8 dB stronger than the wanted signal. A carrier squelch only looks at signal strength, so it opens on the stray carrier and the wanted audio is lost to capture. With pilot squelch on, the receiver also needs the wanted 19 kHz pilot, which the stray carrier does not have, so the gate stays shut.',
    build: () => ({
      scene: make('iem', (s, l) => {
        outdoorIem(s, l);
        l.rx.squelch = { enabled: true, thresholdDbm: -100, hysteresisDb: 3 };
        l.mpx.pilotSquelch = true;
        l.rx.pos = { x: 105, y: 6, z: 1.0 };
        l.interferer = { enabled: true, levelDbm: -81.5, hasPilot: false, offsetKHz: 0 };
      }),
    }),
  },
  {
    id: 'battery-gauge',
    title: 'Battery gauge: reported vs true',
    note: 'Problem: the transmitter estimates its battery from the voltage under load. With two alkaline cells that is a poor guide: at 50 % true charge the gauge reads 22 %, and at 30 % it already shows empty while the transmitter still runs at full power. Press Battery: Start to watch the reading fall long before the output power sags.',
    build: () => ({
      scene: make('mic', (s, l) => {
        l.tx.pos = { x: 4, y: 3, z: 1.5 };
        l.telemetry.battery = { chemistry: 'alkaline-aa-x2', startPercent: 50, timeScale: 600, running: false };
      }),
    }),
  },
  {
    id: 'wall-thickness',
    title: 'Wall thickness: thin vs thick concrete',
    note: 'Compare: the dividing wall is concrete, 0.1 m thick in its upper half and 0.4 m in its lower half. Wall loss grows with thickness (concrete costs 8 dB per 0.1 m), so the room behind the thin part is covered (weakest point -70 dBm against -75 dBm required) and the room behind the thick part is not (weakest -94 dBm). Change the thickness of a wall segment to see the zone result change.',
    build: () => ({
      scene: make('iem', (s, l) => {
        s.stage = { width: 24, depth: 12 };
        s.reflectors = [
          createReflector({ id: newId('refl'), name: 'Wall, thin section', material: 'concrete', p1: { x: 12, y: 6 }, p2: { x: 12, y: 12 }, zMin: 0, zMax: 4, thicknessM: 0.1 }),
          createReflector({ id: newId('refl'), name: 'Wall, thick section', material: 'concrete', p1: { x: 12, y: 0 }, p2: { x: 12, y: 6 }, zMin: 0, zMax: 4, thicknessM: 0.4 }),
        ];
        l.tx.pos = { x: 3, y: 6, z: 2.5 };
        l.rx.pos = { x: 6, y: 6, z: 1.5 };
        l.tx.powerDbm = 0;
        l.chain = [createChainItem('cable', { cableType: 'lmr-400', lengthM: 10 })];
        s.zones = [
          createZone({ id: newId('zone'), name: 'Behind the thin wall', polygon: [{ x: 14, y: 7 }, { x: 22, y: 7 }, { x: 22, y: 11 }, { x: 14, y: 11 }], zMin: 0, zMax: 2, requiredMarginDb: 10 }),
          createZone({ id: newId('zone'), name: 'Behind the thick wall', polygon: [{ x: 14, y: 1 }, { x: 22, y: 1 }, { x: 22, y: 5 }, { x: 14, y: 5 }], zMin: 0, zMax: 2, requiredMarginDb: 10 }),
        ];
      }),
    }),
  },
  {
    id: 'diversity-cable-runs',
    title: 'Diversity with different cable runs',
    note: 'Less ideal: antenna A has a short 5 m cable run (2.1 dB loss); antenna B is on a 40 m run of RG58 with a 6 dB booster at the antenna end (11.0 dB net loss). B therefore arrives about 9 dB below A, and with switching diversity the receiver stays on A and moves to B only while A is in its fade, around 7 m (A -41 dBm, B -38 dBm). Remove the booster and B is rarely chosen.',
    build: () => ({
      scene: make('mic', (s, l) => {
        twoRay(s, l);
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 })];
        l.rx.diversity.enabled = true;
        l.rx.diversity.mode = 'switching';
        l.rx.diversity.hysteresisDb = 3;
        l.rx.diversity.antennaB.chain = [createChainItem('booster', { gainDb: 6, nfDb: 3 }), createChainItem('cable', { cableType: 'rg58', lengthM: 40 })];
      }),
      walk: ACROSS,
    }),
  },
  {
    id: 'raised-stage-null',
    title: 'Raised stage: deck 1.2 m changes the dropout positions',
    note: 'Problem: the receiver antenna stands on the floor in front of the stage and the mic walks on a deck 1.2 m high. The mic is now nearly 3 m above the reflecting floor instead of 1.75 m, so the cancellation moves: the dip that sits at 6.8 m with a ground-level stage (-46 dBm) falls at about 5.1 m on the deck and is shallower (-41 dBm), so the squelch that closes at 6.8 m on the ground stays open here. Set the deck height to 0 to compare.',
    build: () => ({
      scene: make('mic', (s, l) => {
        twoRay(s, l);
        s.stage.heightM = 1.2;
        l.rx.pos = { x: 6, y: 12, z: 1.0 };
        l.tx.pos = { x: 6, y: 7.5, z: 1.75 };
        l.rx.squelch = { enabled: true, thresholdDbm: -42, hysteresisDb: 1 };
        l.rx.diversity.antennaB.pos = { x: 6, y: 12, z: 1.4 };
      }),
      walk: { to: { x: 6, y: 1, z: 1.75 }, speedMps: 0.8, pingPong: true },
    }),
  },
  {
    id: 'drum-riser',
    title: 'Drum riser on a stage: a stage on a stage',
    note: 'Less ideal: a 1.2 m deck carries a 0.4 m drum riser, and the IEM bodypack is worn on the riser while the transmit antenna stands on the deck. Heights are measured from the local floor, so the bodypack is 1.0 m above the riser top. The floor bounce now reflects from the riser instead of the deck: that ray is about 16.3 dB weaker than over a bare deck (-43.2 dB against -27.0 dB relative to the direct ray), while the total level barely moves (-36.0 dBm against -36.1 dBm).',
    build: () => ({
      scene: make('iem', (s, l) => {
        s.stage = { width: 12, depth: 8, heightM: 1.2 };
        s.environment.floor = 'wood';
        l.tx.antenna = OMNI_IMD();
        l.tx.pos = { x: 1, y: 1, z: 2.5 };
        l.rx.antenna = { type: 'omni', gainDbi: -3, orientation: { az: 0, el: 90 } };
        l.rx.pos = { x: 8, y: 4, z: 1.0 };
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 10 })];
        s.platforms = [createPlatform({ id: newId('plat'), name: 'Drum riser', x: 7, y: 3, width: 2.5, depth: 2, topM: 1.6, material: 'wood' })];
      }),
    }),
  },
  {
    id: 'audience-vs-stage',
    title: 'Receiver on the floor, mic on a raised stage with a riser',
    note: 'Compare: the receiver antenna is on the floor in front of the audience and the mic is on a 1.5 m stage. The raised stage changes the geometry: the level falls from -36.6 dBm for a ground-level stage to -38.5 dBm. A 1.4 m tall, 0.6 m deep wooden riser in front of the mic then blocks part of the direct ray and costs another 3.6 dB (-42.1 dBm); a metal one would cost 5.8 dB.',
    build: () => ({
      scene: make('mic', (s, l) => {
        s.stage = { width: 12, depth: 8, heightM: 1.5 };
        s.environment.floor = 'concrete';
        l.tx.antenna = omni();
        l.rx.antenna = omni();
        l.tx.pos = { x: 6, y: 4, z: 1.5 };
        l.rx.pos = { x: 6, y: 14, z: 1.0 };
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 10 })];
        s.platforms = [createPlatform({ id: newId('plat'), name: 'Front-of-house riser', x: 4.5, y: 5.4, width: 3, depth: 0.6, topM: 2.9, material: 'wood' })];
      }),
    }),
  },
  {
    id: 'band-vhf',
    title: 'Same stage at VHF (200 MHz)',
    note: 'Compare: the same 10 m link, with the same omni antennas and 5 m of RG58, at 200 MHz. Free-space loss is 38.5 dB (effective 39.0 dB with the floor bounce) and the cable costs only 1.1 dB, so the margin is 68.9 dB. Compare the UHF and 2.4 GHz versions of this stage.',
    build: () => ({ scene: make('mic', (s, l) => sameStage(s, l, 200)), walk: SAME_STAGE_WALK }),
  },
  {
    id: 'band-uhf',
    title: 'Same stage at UHF (600 MHz)',
    note: 'Compare: the same link at 600 MHz: free-space loss rises to 48.0 dB (effective 46.0 dB) and the cable costs 2.1 dB, so the margin is 60.8 dB. Doubling the frequency twice more would add another 12 dB of free-space loss, with antennas of equal gain.',
    build: () => ({ scene: make('mic', (s, l) => sameStage(s, l, 600)), walk: SAME_STAGE_WALK }),
  },
  {
    id: 'band-2g4',
    title: 'Same stage at 2.4 GHz',
    note: 'Compare: the same link at 2.4 GHz: free-space loss is 60.1 dB (effective 58.4 dB), 21.6 dB more than at 200 MHz, and the cable costs 5.4 dB, so the margin is 45.2 dB. The shorter wavelength also makes the multipath pattern finer as the mic moves, and the transmit power is 14 dBm in all three versions so only frequency differs; a UK audio PMSE 2.4 GHz system is limited to 10 mW EIRP (draft IR 2030), about 4 dB less.',
    build: () => ({ scene: make('mic', (s, l) => sameStage(s, l, 2400)), walk: SAME_STAGE_WALK }),
  },
  {
    id: 'wifi-busy-2g4',
    title: '2.4 GHz link in a busy Wi-Fi venue',
    note: 'Problem: a 2.4 GHz link 104 m across a venue with busy Wi-Fi, 10 dB fade margin and a 10 dBm (10 mW) transmitter, the UK audio PMSE limit (draft IR 2030). Busy Wi-Fi raises the noise floor by about 20 dB at 2.4 GHz (to -87.6 dBm), which turns an 11.2 dB margin into -8.8 dB: a fail. At 5.8 GHz the same venue would add only about 12 dB. Set the interference option to None and the same link passes; the signal level has not changed, only the noise floor.',
    build: () => ({
      scene: make('mic', (s, l) => {
        sameStage(s, l, 2400);
        s.stage = { width: 120, depth: 24 };
        l.tx.powerDbm = 10;
        l.tx.pos = { x: 8, y: 12, z: 1.5 };
        l.rx.pos = { x: 112, y: 12, z: 1.0 };
        l.rx.diversity.antennaB.pos = { x: 112, y: 11.4, z: 1.0 };
        s.environment.fadeMarginDb = 10;
        s.environment.interference = 'busy';
      }),
      walk: { to: { x: 8, y: 12, z: 1.5 }, speedMps: 2, pingPong: true },
    }),
  },
  {
    id: 'ur4d-style-link',
    title: 'Analogue FM link, UR4D-style receiver (assumed figures)',
    note: 'Best practice: a 50 mW handheld at 590 MHz feeds a receiver set up from published UR4D-class figures; the quoted -102 dBm at 30 dB SINAD is used as the sensitivity, so the margin is 65.5 dB across 15 m. Walk the transmitter towards the receiver: the input reaches -30 dBm (hot, the top of the rated range) at about 8 m and passes the -25 dBm overload level at about 3.5 m (multipath ripples move both points), where the front end is flagged overloaded even though the margin is highest. Keep transmitters well away from the receiver antennas. Based on published specs, some figures (noise figure, squelch threshold, band edges) are assumed.',
    build: () => ({
      scene: make('mic', (s, l) => {
        s.stage = { width: 20, depth: 12 };
        s.environment.floor = 'wood';
        l.freqMHz = 590;
        l.tx.antenna = omni();
        l.rx.antenna = omni();
        l.tx.pos = { x: 2, y: 6, z: 1.5 };
        l.rx.pos = { x: 17, y: 6, z: 2 };
        l.rx.diversity.antennaB.pos = { x: 17, y: 5.4, z: 2 };
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 })];
        Object.assign(l, applyFmPreset(l, 'shure-ur2', { powerOptionId: 'hi-50mw' }));
        Object.assign(l, applyFmPreset(l, 'shure-ur4d'));
      }),
      walk: { to: { x: 15, y: 6, z: 1.5 }, speedMps: 1.2, pingPong: true },
    }),
  },
  {
    id: 'skm-low-intermod',
    title: 'Four analogue FM mics, standard mode (SKM 5200-II class, assumed figures)',
    note: 'Compare: four 10 mW handhelds share a hybrid combiner with 25 dB isolation, and Mic A and Mic B beat to a product at 605.7 MHz, exactly on Mic C: the worst channel sees its noise floor rise by 20.3 dB. Switching all four to the low-intermod mode lowers the transmitter-side product by an assumed 6 dB and the worst rise to 14.8 dB. The 6 dB is an assumption standing in for a trade-report claim of about 30 percent more compatible channels. Based on published specs, some figures assumed.',
    build: () => ({
      scene: make('mic', (s) => {
        s.stage = { width: 16, depth: 10 };
        const ant = { type: 'body', gainDbi: -3, orientation: { az: 0, el: 90 } };
        const plan = [[606.1, 'Mic A', 3, 3], [606.5, 'Mic B', 5, 6], [605.7, 'Mic C', 9, 4], [607.4, 'Mic D', 6, 8]];
        s.imd = {
          enabled: true, preset: 'iem-combiner-no-isolation',
          transmitters: plan.map(([f, name, x, y]) => createImdTransmitter({ name, freqMHz: f, powerDbm: 10, pos: { x, y, z: 1.5 }, antenna: ant, fmPreset: 'sennheiser-skm5200ii', lowIntermod: false })),
          rxAntennaPos: { x: 14, y: 5, z: 2.5 }, rxAntenna: { type: 'paddle', gainDbi: 2, orientation: { az: 270, el: 0 } },
          combiner: { type: 'hybrid', isolationDb: 25, lossDb: 3.5 }, pim: { preset: 'none', levelDbc: null },
          channelBwKHz: 200, wantedFreqMHz: null,
        };
      }),
    }),
  },
  {
    id: 'fm-deviation-compare',
    title: 'FM deviation compared: +-40, +-45, +-75 and +-12.5 kHz (assumed figures)',
    note: 'Compare: the same link and the same 15 kHz audio at a -80 dBm input: Carson bandwidth is 110 kHz at +-40 kHz (SKM 5200-II class), 120 kHz at +-45 kHz (UR4D class), 180 kHz for +-75 kHz broadcast FM and 31 kHz for +-12.5 kHz narrowband two-way (3 kHz audio, so not directly comparable). Above threshold the audio SNR rises 20 log10 of the deviation ratio, 1.0 dB for +-45 and 5.5 dB for +-75 kHz against +-40 kHz, while the threshold CNR stays near 10 dB and the threshold input level rises from -107.6 to -105.4 dBm. All fit a 200 kHz channel (broadcast uses 90 percent) and leave a 220 to 290 kHz gap to a neighbour 400 kHz away, where the receiver rejection is 75 dB. Deviation of the broadcast and narrowband systems, the audio bandwidths, the receiver noise figure and the absence of a tone-key above the audio are assumed.',
    build: () => ({
      scene: make('mic', (s, l) => {
        s.stage = { width: 20, depth: 12 };
        s.environment.floor = 'wood';
        l.freqMHz = 600;
        l.tx.antenna = omni();
        l.rx.antenna = omni();
        l.tx.pos = { x: 2, y: 6, z: 1.5 };
        l.rx.pos = { x: 17, y: 6, z: 2 };
        l.rx.diversity.antennaB.pos = { x: 17, y: 5.4, z: 2 };
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 })];
        Object.assign(l, applyFmPreset(l, 'sennheiser-skm5200ii'));
        Object.assign(l, applyFmPreset(l, 'sennheiser-em3732ii'));
      }),
    }),
  },
  {
    id: 'fm-deviation-g3-vs-skm',
    title: 'Deviation compared: +-24 (G3 / 2000 class), +-40 and +-45 kHz (assumed figures)',
    note: 'Compare: three analogue FM systems carry the same 15 kHz audio at a -80 dBm input, compared at nominal deviation: the Sennheiser G3 / 2000 class at +-24 kHz needs 78 kHz of Carson bandwidth, the SKM 5200-II class at +-40 kHz needs 110 kHz and the UR4D class at +-45 kHz needs 120 kHz. Above threshold the audio SNR is 4.4 dB better at +-40 kHz and 5.5 dB better at +-45 kHz than at +-24 kHz (20 log10 of the deviation ratio), at the price of a threshold input level that rises from -109.1 to -107.6 and -107.2 dBm. All three use at most 60 percent of a 200 kHz channel and leave 322, 290 and 280 kHz to a neighbour 400 kHz away. Peak deviation of the G3 is twice its nominal figure, so its real occupied bandwidth is wider than this nominal estimate; the 15 kHz audio bandwidth, the receiver noise figure and the nominal-deviation reading are assumed.',
    build: () => ({
      scene: make('mic', (s, l) => {
        s.stage = { width: 20, depth: 12 };
        s.environment.floor = 'wood';
        l.freqMHz = 590;
        l.tx.antenna = omni();
        l.rx.antenna = omni();
        l.tx.pos = { x: 2, y: 6, z: 1.5 };
        l.rx.pos = { x: 17, y: 6, z: 2 };
        l.rx.diversity.antennaB.pos = { x: 17, y: 5.4, z: 2 };
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 })];
        Object.assign(l, applyFmPreset(l, 'sennheiser-sk300g3'));
        Object.assign(l, applyFmPreset(l, 'sennheiser-em300g3'));
      }),
    }),
  },
  {
    id: 'splitter-two-way-receiver',
    title: 'Splitter: one antenna feeding two receivers',
    note: 'Less ideal: a passive 2-way splitter lets two receivers share one antenna and costs 3.5 dB, so the chain loses 5.6 dB against 2.1 dB without it. The loss comes before the first gain stage, so the system noise figure rises from 10.1 dB to 13.6 dB and the margin falls from 59.5 dB to 56.0 dB. An active splitter (0 dB net gain, assumed 8 dB noise figure) gives 11.9 dB and 57.7 dB. Use active distribution for several receivers (figures illustrative).',
    build: () => ({ scene: reviewScene('splitter-two-way-receiver', {}) }),
  },
  {
    id: 'coupler-monitor-tap',
    title: 'Coupler: a monitoring tap on the IEM feed',
    note: 'Best practice: a 20 dB directional coupler taps the 17 dBm IEM feed for monitoring, so the tap port carries -3.0 dBm, enough for a meter or analyser, while the through path loses only 0.15 dB (margin changes by 0.1 dB). Terminate the unused port and never put bias on a line with a coupler. Figures illustrative.',
    build: () => ({ scene: reviewScene('coupler-monitor-tap', {}) }),
  },
  {
    id: 'lna-no-filter',
    title: 'LNA with no filter beside an IEM transmitter',
    note: 'Problem: a 20 dB LNA at the mic receive antenna with no filter sees the IEM transmitter 3.3 m away at -42.4 dBm and delivers -23.7 dBm to the receiver, which is hot (5.7 dB from the P1dB of -18 dBm) with 0.4 dB of desense. The wanted mic margin is 58.2 dB but the receiver works near compression. Put a bandpass filter ahead of the LNA (see filter-before-booster). Receiver figures illustrative.',
    build: () => ({ scene: reviewScene('lna-no-filter', {}) }),
  },
  {
    id: 'filter-before-booster',
    title: 'Filter before the booster',
    note: 'Best practice: the same scene with a 604 to 608 MHz bandpass (1.5 dB loss, 40 dB rejection, assumed) ahead of the LNA: the IEM carrier reaches the receiver at -65.2 dBm, 47.2 dB below the P1dB, with no desense. The filter costs the wanted mic 1.5 dB (margin 56.7 dB against 58.2 dB), a cheap price. Filter before gain.',
    build: () => ({ scene: reviewScene('filter-before-booster', {}) }),
  },
  {
    id: 'pad-on-iem-transmitter',
    title: 'Pad on an IEM transmitter with the wrong antenna',
    note: 'Less ideal: a pad as the fix. The IEM transmitter drives an antenna cut for 863 to 865 MHz at 606.1 MHz (VSWR 46.2:1), and a 6 dB pad in front of it brings the reflection at the output stage down from 19.6 dBm to 1.6 dBm (1.6:1 at the PA). The price is 6 dB of link margin (38.3 dB against 44.3 dB), which is still plenty. The real fix is the right antenna (figures illustrative, assumed band edges).',
    build: () => ({ scene: reviewScene('pad-on-iem-transmitter', {}) }),
  },
  {
    id: 'bias-tee-booster-up-the-mast',
    title: 'Bias tee: powering a booster up the mast',
    note: 'Best practice: a 12 dB booster at the antenna is powered up 45 m of LMR-400 by a bias tee at the rack, and the model raises no DC warning. The chain gains 6.5 dB net and the system noise figure is 5.2 dB against 10.1 dB for a bare RG58 run. Keep every DC block, analyser and passive splitter off the line between the tee and the booster.',
    build: () => ({ scene: reviewScene('bias-tee-booster-up-the-mast', {}) }),
  },
  {
    id: 'bias-tee-into-dcblock',
    title: 'Bias tee behind a DC block',
    note: 'Problem: the same chain with a DC block between the cable and the bias tee. The paper budget barely changes (margin 64.3 dB against 64.4 dB), but no bias reaches the booster and the model warns that it needs 12 V; a dead booster does not give its 12 dB. Take the block out or move the tee.',
    build: () => ({ scene: reviewScene('bias-tee-booster-up-the-mast', {"block": true}) }),
  },
  {
    id: 'body-contact-sweaty-bodypack',
    title: 'Sweaty bodypack: contact and dampness',
    note: 'Problem: a bodypack antenna against bare skin (6 dB, assumed) and wet with sweat (3 dB more) loses 9.0 dB, so the margin is 42.1 dB against 51.1 dB for the same pack free and dry. The contact option replaces the scene body-loss setting instead of adding to it. A layer of clothing costs 2.5 dB and dry skin 6 dB; keep the antenna off the skin and dry.',
    build: () => ({ scene: reviewScene('body-contact-sweaty-bodypack', {}) }),
  },
  {
    id: 'tilted-whip-vs-vertical',
    title: 'Tilted bodypack whip against a vertical receive antenna',
    note: 'Less ideal: a bodypack whip tilted 60 degrees from the vertical receive antenna loses 5.6 dB to polarisation mismatch (2.9 dB at 45 degrees, 14.1 dB at 85, 15.0 dB at 90 where the 15 dB cross-polar floor applies). The margin falls from 58.8 dB upright to 53.1 dB. Wear the pack upright or use a slant or circular receive antenna (see circular-polarisation-wanted-mic).',
    build: () => ({ scene: reviewScene('tilted-whip-vs-vertical', {}) }),
  },
  {
    id: 'circular-polarisation-wanted-mic',
    title: 'Circular receive antenna for a wandering mic',
    note: 'Best practice: the whip lies flat (90 degrees of tilt), which would cost 15.0 dB against a vertical receive antenna, but a circular helical antenna costs a constant 3.01 dB whatever the angle. You give up 3 dB when the mic is upright to avoid the deep mismatch when it is not. Match the receive antenna to the worst case (gain figures assumed).',
    build: () => ({ scene: reviewScene('circular-polarisation-wanted-mic', {}) }),
  },
  {
    id: 'ground-plane-quarterwave',
    title: 'Quarter-wave whip: ground plane or free cable',
    note: 'Problem: a quarter-wave whip on a free cable has no ground plane, so its gain is only -1 dBi and unpredictable (the model warns). On a rack panel it is +3 dBi, which is 4.0 dB more margin (61.8 dB against 57.8 dB); a body counts 1 dBi and a large plate 5 dBi. Mount it on a panel or a ground plate (gain figures assumed).',
    build: () => ({ scene: reviewScene('ground-plane-quarterwave', {}) }),
  },
  {
    id: 'coverage-modes-compare',
    title: 'Coverage modes: coherent, power and best',
    note: 'Compare: the same two IEM antennas 1.5 m apart over a front zone, combined three ways. Coherent adds the waves with phase, so the worst cell is -77.0 dBm in a null; power adds the powers (-43.1 dBm worst) and best takes the stronger antenna (-45.9 dBm). Plan with power or best and check the coherent nulls separately (see zones-coherent-nulls).',
    build: () => ({ scene: reviewScene('coverage-modes-compare', {}) }),
  },
  {
    id: 'external-noise-urban-vs-quiet',
    title: 'External noise: urban against quiet',
    note: 'Less ideal: a 20 dB low-noise booster at the antenna (system noise figure 2.3 dB) makes the receiver sensitive to a city: urban noise lifts the floor to -116.4 dBm against -118.7 dBm with none and costs 2.3 dB of margin (54.6 dB against 56.9 dB). Without the booster (16.6 dB noise figure) the same city costs only 0.1 dB. Gain cannot fix noise that arrives at the antenna.',
    build: () => ({ scene: reviewScene('external-noise-urban-vs-quiet', {}) }),
  },
  {
    id: 'audio-bandwidth-iem-vs-mic',
    title: 'Audio bandwidth: narrow mic against IEM',
    note: 'Compare: narrow-band mic: the transmitter audio is limited to 9.0 kHz (a user value), so the baseband view puts the ceiling at 9 kHz and leaves a 23.8 kHz gap to the 32.8 kHz control tone. A default mic assumes 18 kHz (gap 14.8 kHz) and a stereo IEM 15 kHz, 4 kHz below the 19 kHz pilot. Set the figure to the real device (design values, not measured).',
    build: () => ({ scene: reviewScene('audio-bandwidth-iem-vs-mic', {}) }),
  },
  {
    id: 'imd-iem-8-with-fifth-order',
    title: 'Fifth-order products: count against level',
    note: 'Less ideal: understand the count: five channels from the third-order clean plan still put 26 fifth-order products in channels (158 with all eight), but their summed level is only -253.5 dBm at the bodypack, far below the -111.0 dBm thermal floor. The 12.6 dB floor rise comes from the other transmitters\' wideband noise (-98.7 dBm), not from intermod. Count hits to coordinate, judge harm by level.',
    build: () => ({ scene: reviewScene('imd-iem-8-with-fifth-order', {}) }),
  },
  {
    id: 'p2p-ground-reflection',
    title: 'Point to point: ground reflection ripple',
    note: 'Problem: a 40 m link between paddles lying flat at 3 m, 606 MHz, with the ground reflection on: it costs 5.0 dB at 40 m, and over 20 to 80 m the reflected ray swings the level from 16.7 dB below the direct ray at 36.2 m to 5.8 dB above at 73.7 m. With vertical polarisation the dip is only 1.9 dB. At 150 m the reflection only adds 2.7 dB and the ripple is gone. The model warns that 40 m is under 100 m (near-field, a mic link is the better model): it is shown for the ripple.',
    build: () => ({ scene: reviewScene('p2p-ground-reflection', {}) }),
  },
  {
    id: 'band-four-piece-people',
    title: 'Four-piece band: a mic and an IEM pack per person',
    note: 'Best practice: four people each carry a mic and an IEM bodypack, and the links are named after them (Anna mic, Anna IEM). The margins run from 27.9 dB (Dev IEM, the weakest) to 47.7 dB (Ben mic); the handheld sits at 1.3 m and the bodypacks at the belt, 1.0 m. Move a person and both of their packs move together with the offsets kept, and deleting a person leaves the links in place (frequencies illustrative).',
    build: () => ({ scene: bandPeopleScene() }),
  },
  {
    id: 'noise-flash-at-pit',
    title: 'Noise: a speedlight at the photo pit',
    note: 'Problem: a photographer\'s speedlight 2 m from the FOH receive antenna is a 1 ms broadband click about 3 times a second (duty 0.3 percent, assumed): -49.9 dBm at its peak but only -75.1 dBm on average. The average lifts the floor by 36.9 dB and leaves 17.4 dB of margin, and the peak is 62.1 dB above the floor, the pop on the squelch. Keep flashes away from the antenna and use a filtered, shielded run (figures assumed).',
    build: () => ({ scene: noiseSourceScene('flash-at-pit') }),
  },
  {
    id: 'noise-ptt-beside-bodypack',
    title: 'Noise: a PTT radio beside an IEM bodypack',
    note: 'Problem: a 2 W business UHF handheld keyed 1.5 m from the IEM bodypack puts -9.1 dBm at the antenna, 83.1 dB above what the 606 MHz channel filter passes (selectivity assumed). In the channel that is -92.3 dBm while keyed and -97.5 dBm on average (30 percent duty), a 13.7 dB floor rise and 37.5 dB of margin. A 0.5 W PMR446 radio gives 7.4 dB and 43.8 dB, so keep crew radios away from bodypacks (figures assumed).',
    build: () => ({ scene: noiseSourceScene('ptt-beside-bodypack') }),
  },
  {
    id: 'noise-phone-buzz',
    title: 'Noise: a GSM phone near the FOH receiver',
    note: 'Problem: a GSM 900 phone 1 m from the receive antenna bursts 2 W (33 dBm) for 0.577 ms every 4.615 ms, the 217 Hz frame: +1.9 dBm at the antenna, -87.4 dBm in the channel at the peak and -96.4 dBm on average (duty 12.5 percent). The floor rises 15.7 dB; the audible 217 Hz buzz from an audio cable or preamp that demodulates the burst is not modelled. Put phones in flight mode or away from antennas and cables (figures assumed).',
    build: () => ({ scene: noiseSourceScene('phone-buzz') }),
  },
  {
    id: 'noise-dimmer-circuit',
    title: 'Noise: a dimmer rack near the receiver',
    note: 'Less ideal: a triac dimmer 3 m from the receive antenna chops twice per mains cycle (120 Hz, duty 1.2 percent, assumed) and is strong at VHF but weak at 606 MHz: -90.6 dBm at the peak, -109.8 dBm on average, a 4.2 dB floor rise and 50.1 dB of margin. Through the air it is a small problem at UHF; the buzz that reaches the audio comes through cables and the mains, so use balanced audio and filtered power (figures assumed).',
    build: () => ({ scene: noiseSourceScene('dimmer-circuit') }),
  },
  {
    id: 'noise-eng-press-pit',
    title: 'Noise: an ENG crew at the press pit',
    note: 'Problem: an ENG crew at the barrier (camera transmitter, two PTT radios, an LED light and a van generator, about 12 m from the FOH receiver) raises the floor by 17.6 dB together and leaves 36.7 dB of margin. The LED light dominates at -97.2 dBm, then the generator at -98.6 dBm, the PTT radios at about -108 dBm average, and the 2.3 GHz camera transmitter only -115.8 dBm because it is far out of band. Agree lights off, radios and generator away from the antennas with the press (figures assumed).',
    build: () => ({ scene: noiseSourceScene('eng-press-pit') }),
  },
  {
    id: 'tv-weak-on-channel',
    title: 'Weak TV: a mic on top of a weak local channel',
    note: 'Less ideal: a mic 0.4 MHz above the centre of UK channel 33 (566 to 574 MHz) shares the block with a weak local transmitter (-85 dBm at the antenna, assumed). The 7.6 MHz block is flat noise, so a 200 kHz mic channel sees 15.8 dB less, -100.8 dBm, which lifts the floor by 11.5 dB and leaves 43.3 dB of margin. It works as a fallback if the channel is licensed or permitted; check the local database and scan first. The occupancy is illustrative.',
    build: () => ({ scene: weakTvScene('on-channel') }),
  },
  {
    id: 'tv-weak-free-gap',
    title: 'Weak TV: the mic moved to a free gap',
    note: 'Best practice: the same mic on channel 30 (542 to 550 MHz), two channels from the nearest transmitters on 33 and 34 in the illustrative occupancy. The weak block is now 65.9 dB down (selectivity assumed), the floor rise is 0.0 dB and the margin is 55.3 dB. A free channel costs nothing: prefer it to any shared one.',
    build: () => ({ scene: weakTvScene('free-gap') }),
  },
  {
    id: 'tv-weak-strong-neighbour',
    title: 'Weak TV: weak channel with a strong adjacent block',
    note: 'Less ideal: the mic stays on weak channel 33 but channel 34 next door is strong (-45 dBm at the antenna, assumed). The adjacent block is held 51.6 dB down by the receiver selectivity (assumed), -96.6 dBm in the channel, so with the weak block the floor rises 16.9 dB and the margin falls to 38.0 dB. A real filter skirt decides this one: measure it or move away.',
    build: () => ({ scene: weakTvScene('strong-neighbour') }),
  },
  {
    id: 'tv-strong-cochannel',
    title: 'Strong TV: the failure contrast, a strong signal in the channel',
    note: 'Problem: the same mic on channel 33 where the block is strong (-45 dBm at the antenna, assumed) puts -60.8 dBm of noise in the 200 kHz channel. The floor rises 51.2 dB and only 3.7 dB of margin is left, so the link is marginal. A strong broadcast channel is not usable: pick another one.',
    build: () => ({ scene: weakTvScene('strong-cochannel') }),
  },
  {
    id: 'booster-overloaded-by-radio',
    title: 'Booster overload: a keyed crew radio 1 m from the receive antenna',
    note: 'Problem: a 12 dB booster sits straight on the receive antenna and a crew radio (33 dBm ERP, assumed) is keyed 1 m away, putting +1.9 dBm at the antenna. The booster would put out 13.9 dBm against an output 1 dB point of 10.4 dBm (OIP3 20 dBm assumed, minus 9.6 dB), so it compresses 3.5 dB and the wanted mic loses the same. The margin falls from 7.6 dB without the booster to 4.1 dB, only while the radio is keyed. A booster raises weak signals and everything strong beside them.',
    build: () => ({ scene: boosterOverloadScene('overloaded') }),
  },
  {
    id: 'booster-filtered-before-radio',
    title: 'Booster behind a bandpass filter: the radio never reaches it',
    note: 'Best practice: the same booster behind a 600 to 612 MHz bandpass filter (30 dB stopband rejection and DC-passing, both assumed) sees the crew radio at only -17.6 dBm at its output. It stays far below the 10.4 dBm output 1 dB point, so there is no compression and the margin is 7.6 dB, the same as with no radio keyed. The filter costs 1.5 dB of loss but it protects the booster from every out-of-band transmitter. Compare with the overloaded example, where the margin is 4.1 dB.',
    build: () => ({ scene: boosterOverloadScene('filtered') }),
  },
  {
    id: 'analog-fm-weak-gradual',
    title: 'Analogue FM at -107 dBm: noisy, but still there',
    note: 'Compare: at -107 dBm the receiver sees a CNR of 6.0 dB, 5.0 dB under the FM threshold knee of 11 dB (assumed). The audio is hissy at 19.5 dB SNR but the voice is still carried, and it was 51.5 dB at -85 dBm: analogue noise grows gradually as the signal falls. The FM signal takes 110 kHz of the 200 kHz channel (Carson). The next example is the digital mic at the same level.',
    build: () => ({ scene: modeContrastScene('analog-fm', 'weak') }),
  },
  {
    id: 'digital-weak-cliff',
    title: 'Digital mic at -107 dBm: the same level, the cliff',
    note: 'Compare: the same -107 dBm with a digital mic (fixed QPSK 3/4 in a 200 kHz channel, assumed) is 1.1 dB under the frame-error cliff and the audio is muted. The cliff is only 0.6 dB wide, from a frame error rate of 1e-3 at -105.6 dBm to 90 percent at -106.3 dBm, so the audio is perfect one moment and gone the next. At -85 dBm it is clean with 20.9 dB to spare. Digital is the better link until it fails, and then it fails all at once.',
    build: () => ({ scene: modeContrastScene('digital', 'weak') }),
  },
  {
    id: 'body-worn-thin-margin',
    title: 'Body-worn link with a thin margin: not proven',
    note: 'Problem: a bodypack 70 m from the receiver has 8.6 dB of margin, with 10 dB of body loss and a 15 dB cross-polar floor (horizontal against vertical antennas, which is why the model warns about polarisation) both assumed. A body-worn margin under 10 dB is not called proven, because body loss changes by several dB with posture. The assumptions could move it by about 7.1 dB (10.0 dB if every error went the wrong way). Shorten the path, align the antennas, or walk-test it.',
    build: () => ({ scene: bodyWornScene('thin') }),
  },
  {
    id: 'body-worn-proven-twin',
    title: 'The same bodypack 25 m away: a proven margin',
    note: 'Best practice: the same bodypack 25 m from the receiver has 17.5 dB of margin, over the 10 dB a body-worn link needs and over the 7.1 dB the assumptions could take off. It is called proven although the same assumed 10 dB body loss and 15 dB cross-polar floor are in it (the polarisation warning is that deliberately assumed floor, and aligning the antennas would add margin again). Compare with the 70 m case, where the margin is 8.6 dB.',
    build: () => ({ scene: bodyWornScene('short') }),
  },
  {
    id: 'diversity-correlated-antennas',
    title: 'Diversity with antennas 0.1 wavelength apart: the same fades',
    note: 'Problem: antenna B sits 0.05 m (0.1 wavelength) from antenna A, so both see the same floor-reflection fade of 8.8 dB. Switching and selection combining gain 0.0 dB at the 1 percent level because there is nothing better to switch to. Maximal-ratio combining gains only its 3.0 dB for adding two copies of the same signal. Spacing the antennas fixes the fade, not combining.',
    build: () => ({ scene: diversityCombiningScene('correlated'), walk: ACROSS }),
  },
  {
    id: 'diversity-spaced-antennas',
    title: 'Diversity with antennas 0.8 wavelength apart: combining modes compared',
    note: 'Compare: antenna B is 0.4 m (0.8 wavelength) above A, so its fade falls at a different distance. At the 1 percent level switching gains 4.9 dB, selection 6.5 dB and maximal-ratio 8.8 dB over one antenna, and the worst fade shrinks from 8.8 dB to 4.3 dB with ratio combining. Switching trails selection because it waits for a 3 dB hysteresis before it moves. Compare with the 0.1 wavelength case, where none of this is available.',
    build: () => ({ scene: diversityCombiningScene('spaced'), walk: ACROSS }),
  },
  {
    id: 'measurements-body-loss-high',
    title: 'Walk test: the readings say the body loss is higher than assumed',
    note: 'Problem: twelve synthetic readings along a 62 m walk are on average 7.0 dB weaker than the model predicts with the assumed 3 dB of body loss. The fit recovers 10.0 dB of body loss and brings the residual from 7.0 dB rms down to 0.2 dB. A wall or a cross-polar floor cannot explain a constant offset on this open path, so body loss is the one the data points to. Apply the fit, then re-check the margin.',
    build: () => ({ scene: measurementsScene('body-loss-high') }),
  },
  {
    id: 'measurements-clean-match',
    title: 'Walk test: the readings match the model',
    note: 'Best practice: twelve synthetic readings along the same walk agree with the model to 0.2 dB rms with the assumed 6 dB of body loss. No calibration is suggested, so the assumption stands for this transmitter, antenna and body position. Repeat the walk with a different performer or pack position before trusting it for others.',
    build: () => ({ scene: measurementsScene('clean-match') }),
  },
  {
    id: 'presenter-with-backup-bodypack',
    title: 'Presenter: a main bodypack and a hot-spare backup',
    note: 'Best practice: a presenter wears the main mic bodypack on the belt and a hot-spare backup on the other hip, 0.3 m apart, on a different frequency (607.3 against 606.1 MHz) so the two never share a channel. At 11 m the margins are 34.6 dB (main) and 34.0 dB (backup), and with the IEM at 614.1 MHz no third-order product comes closer than 1200 kHz to any channel. The person owns the main mic, the backup and the IEM, so moving or turning them carries all three packs with the offsets kept. Frequencies are illustrative.',
    build: () => ({ scene: presenterScene() }),
  },
  {
    id: 'two-mics-one-weak-tv-block',
    title: 'Weak TV: two mics sharing one weak block',
    note: 'Less ideal: two mics 1.0 MHz apart (570.4 and 571.4 MHz) both sit on the weak channel 33 block (-85 dBm at the antenna, assumed). The TV noise is the same in both 200 kHz channels (-100.8 dBm, floor +11.5 dB), leaving 43.3 dB and 43.4 dB of margin. Their two third-order products, 569.4 and 572.4 MHz, land 1000 kHz from the nearest channel, so the IMD panel shows no hit; a third mic still needs a coordinated frequency.',
    build: () => ({ scene: weakTvTwoMicScene() }),
  },
  {
    id: 'squelch-noise-burst',
    title: 'Squelch: a flash burst opens the gate',
    note: 'Problem: a photographer speedlight 21.9 m from the FOH antenna is a 1 ms click 3 times a second: -70.5 dBm at its peak, -95.8 dBm on average, against a floor of -112.0 dBm. With the mic transmitter off the idle level is -95.7 dBm, 5.7 dB under the -90 dBm squelch, but each flash reaches -70.5 dBm, 19.5 dB over it, so in 10 s the gate opens 30 times for 30 ms and the desk hears pops. A carrier squelch cannot tell a flash from a mic: a pilot squelch needs a locked pilot and ignores it.',
    build: () => ({ scene: squelchBurstScene() }),
  },
  {
    id: 'band-four-piece-walk',
    title: 'Four-piece band: moving the singer carries her packs',
    note: 'Compare: moving Anna from the middle of the stage (8, 7.5) to the stage-right front (14.5, 8.5), by dragging her on the plan, carries her handheld and IEM pack with her, offsets kept. Her mic margin falls from 36.8 to 30.7 dB (-6.1 dB) while her IEM rises from 36.8 to 47.7 dB (+10.9 dB) because she is nearer the IEM antenna, and the other six links do not change (0.0 dB). The scene is the start; the animated walk moves only her mic pack along that line, so her IEM pack stays behind while it runs.',
    build: () => ({ scene: bandPeopleScene(), walk: { to: { ...bandWalkEndScene().links[0].tx.pos }, speedMps: 0.8, pingPong: true } }),
  },
  {
    id: 'coord-equal-spacing',
    title: 'Coordination: three mics equally spaced by 400 kHz',
    note: 'Problem: three mics at 600.0, 600.4 and 600.8 MHz: 2f2-f1 lands on mic 3, 2f2-f3 on mic 1 and f1+f3-f2 on mic 2, three distinct third-order hits (two 2-mic, one 3-mic; the panel lists 8 products counting fifth order and the reverse path). The products reach -67.4 dBm in the channel and lift the worst floor by 45.6 dB. Load it in the coordination lab and compare it with the spread plan.',
    build: () => ({ scene: coordScene('equal') }),
  },
  {
    id: 'coord-spread-plan',
    title: 'Coordination: the same three mics on a spread plan',
    note: 'Best practice: the same mics at 600.0, 601.0 and 603.3 MHz: no third-order product comes closer than 1000 kHz to a channel (hand: 2f2-f1 = 602.0, 2f1-f2 = 599.0, f1+f3-f2 = 602.3, f2+f3-f1 = 604.3). Nothing lands in a channel, so the products add no noise; the floor still rises 9.4 dB from the transmitter noise skirts of mics about 3 m away (assumed model). The wanted mic keeps 50.9 dB of margin, the same as in the equal plan.',
    build: () => ({ scene: coordScene('spread') }),
  },
  {
    id: 'measurements-too-few-readings',
    title: 'Walk test: three readings at nearly one distance',
    note: 'Less ideal: three readings 29 to 31 m from the transmitter are 7.0 dB weaker than the model on average. The fit says 10.0 dB of body loss (0.3 dB rms left) but warns that three readings are too few and sit at nearly the same distance, so in a real venue the offset could equally be a wall or a polarisation loss. Walk a range of distances, through the wall if there is one, before applying it; the twelve-reading walk is the better test.',
    build: () => ({ scene: measurementsScene('too-few') }),
  },
  {
    id: 'tv-weak-6mhz-us-plan',
    title: 'Weak TV, North America: a mic on a 6 MHz channel',
    note: 'Less ideal: with the TV channel width set to 6 MHz a mic 0.4 MHz above the centre of channel 26 (542 to 548 MHz) shares the block with a weak local station (-85.0 dBm at the antenna, assumed). The block occupies 5.38 MHz, so a 200 kHz mic channel sees 14.3 dB less, -99.3 dBm, which is 1.5 dB more than the same power in a 7.6 MHz block; it lifts the floor by 13.0 dB and leaves 42.3 dB of margin. Check the local database and scan first; the occupancy is illustrative.',
    build: () => ({ scene: weakTvScene('on-channel', 6) }),
  },
  {
    id: 'noise-dect-intercom',
    title: 'Noise: a DECT crew intercom beside a 1.9 GHz mic',
    note: 'Problem: a DECT-type crew intercom beltpack 4.0 m from the receive antenna of a 1893 MHz mic puts -29.0 dBm at the antenna and -75.6 dBm in the 200 kHz channel at the peak (one 0.417 ms slot in every 10 ms frame, duty 4.2 percent), -89.4 dBm on average. The floor rises 21.7 dB and the margin falls to 17.8 dB, with 20.2 dB between the wanted signal and each burst; the 100 Hz buzz an audio path can demodulate is not modelled. Keep intercoms off the mic band and away from the antennas (figures assumed).',
    build: () => ({ scene: noiseSourceScene('dect-intercom') }),
  },
  {
    id: 'noise-pyro-trigger-433',
    title: 'Noise: a pyro cue trigger near a 433 MHz mic',
    note: 'Less ideal: a pyro cue trigger on 433.9 MHz sends 0.1 s command bursts (duty 0.1 percent, assumed) from 19.1 m away to the receiver of a licence-free mic on 433.1 MHz. Each burst is -81.9 dBm in the channel after 38.1 dB of assumed selectivity, 30.3 dB above the floor, but the average is -111.9 dBm, a 3.2 dB floor rise with 50.2 dB of margin left. The wanted signal is 40.3 dB above each burst so the show works, but a dropout on the cue would be heard; coordinate the trigger channel (figures assumed).',
    build: () => ({ scene: noiseSourceScene('pyro-trigger-433') }),
  },
  {
    id: 'booster-padded-before-radio',
    title: 'Booster behind a pad: the radio is tamed, the wanted signal pays',
    note: 'Less ideal: a 10 dB pad ahead of the booster cuts the keyed crew radio at the booster output from 13.9 dBm to 3.9 dBm, so the compression falls from 3.5 dB to 0.1 dB and the keyed margin rises from 4.1 dB to 7.5 dB. The pad costs the wanted mic 10 dB all the time, so with the radio off the margin is 27.5 dB instead of 37.5 dB. A bandpass filter (booster-filtered-before-radio) gives 7.6 dB keyed and 36.0 dB unkeyed, so a pad is a blunt cure (figures assumed).',
    build: () => ({ scene: boosterOverloadScene('padded') }),
  },
];

// Search keywords for the command palette: every entry carries `keywords` (a plain lower-case string, never shown), so 'measure', 'measurement', 'walk' and 'noise'
// find the right examples even when the title does not say so. The palette should read `ex.keywords` (an empty string when absent) next to the category.
const WALK_IDS = new Set(['dropout-two-ray', 'diversity-null', 'diversity-modes', 'iem-stereo-mono', 'pilot-vs-carrier-squelch', 'reflective-wall', 'telemetry-before-audio', 'digital-vs-analog', 'adaptive-modulation', 'digital-cuts-out', 'constellation-noise', 'diversity-cable-runs', 'raised-stage-null', 'band-vhf', 'band-uhf', 'band-2g4', 'wifi-busy-2g4', 'ur4d-style-link', 'diversity-correlated-antennas', 'diversity-spaced-antennas', 'band-four-piece-walk']); // the examples whose build() returns a walk
export function exampleKeywords(ex) {
  const k = [];
  if (WALK_IDS.has(ex.id)) k.push('walk walking path moving');
  if (/^measurements-/.test(ex.id)) k.push('measure measurement measurements readings walk walk-test calibrate calibration fit');
  if (/^noise-|^video-wall|^squelch-noise|^external-noise|^tv-|radio$|^stray-carrier|^wifi-busy|^even-/.test(ex.id)) k.push('noise interference');
  if (/^noise-/.test(ex.id)) k.push('noise source emitter timing');
  if (/^coord-|^imd-/.test(ex.id)) k.push('coordination frequency plan intermod');
  return k.join(' ');
}
for (const ex of EXAMPLES) ex.keywords = exampleKeywords(ex);

export const getExample = (id) => EXAMPLES.find((e) => e.id === id) || null;

/** buildExample(id) -> { id, title, note, scene, walk, selectId } or null for an unknown id. */
export function buildExample(id) {
  const ex = getExample(id);
  if (!ex) return null;
  const { scene, walk = null } = ex.build();
  return { id: ex.id, title: ex.title, note: ex.note, scene, walk, selectId: scene.links[0] ? scene.links[0].tx.id : null };
}
