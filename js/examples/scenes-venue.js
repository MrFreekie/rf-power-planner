// Example scene builders: antenna band mismatch, audience, ceiling, radio-over-fibre and point-to-point links.
import { createChainItem, createBranch, createAudience, createCeiling, createChainItemFromPreset } from '../model/scene.js';
import { omni, make } from './helpers.js';
import { ANTENNAS_GAIN } from './scenes-imd.js';

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
