// Example scene builders: weak TV blocks and per-channel TV levels, booster overload, mode contrast, body-worn and diversity combining.
import { solveLink } from '../model/rf.js';
import { modeReport } from '../model/digital-link.js';
import { sweepLink } from '../model/diversity.js';
import { confidenceSummary } from '../model/assumptions-in-use.js';
import { createNoiseSource, noiseSourceAt } from '../model/noise-sources.js';
import { tvChannelList, tvChannelOf, TV_OCCUPIED_MHZ } from '../model/spectrum-map.js';
import { createDefaultLink, createChainItem, createDefaultImd, createImdTransmitter, createChainItemFromPreset, syncScene } from '../model/scene.js';
import { omni, make, twoRay } from './helpers.js';

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
    if (variant !== 'plain') { l.chain.push(createChainItemFromPreset('booster-12', variant === 'high-p1db' ? { op1dBDbm: 20 } : {})); l.rx.antennaBiasV = 12; } // the receiver supplies the 12 V the booster needs over the cable (no bias warning); no extra loss
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
 * Per-channel TV block levels (spectrum-map.js tvBlockLevelsDbm): tvLevelsScene(withLevels) -> two mics on UK channels 33 (570.4 MHz) and 30 (546.4 MHz), no TV noise source, and
 * (withLevels) scene.tvBlockLevelsDbm = { 30: -108, 33: -85, 34: -52 }: stand-ins for levels measured at the receive antenna with an analyser. The levels only drive the spectrum map's
 * noise-rise strip (they never reach the link budget), so the link margins are the same with or without them.
 */
export const TV_LEVELS_DBM = Object.freeze({ 30: -108, 33: -85, 34: -52 });
export function tvLevelsScene(withLevels = true) {
  const s = make('mic', (sc, l) => {
    sc.stage = { width: 30, depth: 20 }; sc.environment.floor = 'wood'; sc.environment.model = 'free-space';
    l.name = 'Mic 1 on channel 33'; l.freqMHz = WEAK_TV_FREQ_MHZ.ch33; l.tx.pos = { x: 3, y: 10, z: 1.5 }; l.tx.antenna = omni(); l.rx.antenna = omni();
    l.rx.pos = { x: 22, y: 10, z: 1.2 }; l.rx.diversity.antennaB.pos = { x: 22, y: 9.4, z: 1.2 };
    l.chain = [createChainItem('cable', { cableType: 'lmr-240', lengthM: 5 })];
  });
  const a = s.links[0], b = createDefaultLink('mic');
  b.name = 'Mic 2 on channel 30'; b.freqMHz = WEAK_TV_FREQ_MHZ.ch30; b.tx.pos = { x: 3, y: 12, z: 1.5 }; b.tx.antenna = structuredClone(a.tx.antenna); b.rx.antenna = structuredClone(a.rx.antenna);
  b.rx.pos = { x: 22, y: 11, z: 1.2 }; b.rx.diversity.antennaB.pos = { x: 22, y: 10.4, z: 1.2 }; b.chain = structuredClone(a.chain);
  s.links.push(b);
  if (withLevels) s.tvBlockLevelsDbm = { ...TV_LEVELS_DBM };
  return syncScene(s);
}
