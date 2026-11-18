// Example scene builders: second IEM transmitter on stage (SOS), front-of-house antennas and video walls.
import { solveLink, chainLossDb } from '../model/rf.js';
import { overloadStep } from '../model/overload.js';
import { RX_PRESETS } from '../model/rx-params.js';
import { imdSummary } from '../model/imd.js';
import { createDefaultLink, createChainItem, createReflector, createDefaultImd, createImdTransmitter, createCrowdRect, createChainItemFromPreset, newId } from '../model/scene.js';
import { omni, make } from './helpers.js';

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
 *   'raised': the same antennas on a truss at 5.0 m, aimed at the stage: the ray passes more than 1 m over the heads for most of the crowd.
 *   'remote': antennas at the stage side (3.0 m, 9 m from the performer, outside the crowd) with 45 m of LMR-400 back to FOH.
 *             opts.remote: 'coax' (default: a 15 dB booster at the antenna end, ahead of the cable), 'booster-at-rack' (same booster after the
 *             cable: the wrong place), 'rof' (the active RF over fibre preset, 0.05 km). The IEM transmit path never gets a booster (power limit).
 * Crowd: scene.crowds (a rectangle), 5..25 m x 8..26 m. Standing 3-5 persons per m2, seated 1-2 (opts.density default 4 standing / 1.5 seated); the
 * absorption (0.9 dB per metre per person-per-m2 below head height with the clearance ramp above it, capped at 26 dB) is an ASSUMED planning figure. Links: links[0] mic (stage
 * transmitter to FOH receiver, 606.1 MHz), links[1] IEM (FOH transmitter to the bodypack on stage, 614.0 MHz).
 */
export function fohScene(variant, { kind = 'standing', densityPerM2, remote = 'coax' } = {}) {
  if (!['low', 'raised', 'remote'].includes(variant)) return null;
  const density = densityPerM2 !== undefined ? densityPerM2 : kind === 'seated' ? 1.5 : 4;
  return make('mic', (s, l) => {
    s.stage = { width: 30, depth: 40 };
    s.environment.floor = 'wood';
    // the performer's body shadow (3 dB, assumed) is set on the mic link only: the IEM bodypack antenna is a body-type antenna that already includes its wearer
    s.crowds = [createCrowdRect({ name: kind === 'seated' ? 'Seated crowd' : 'Standing crowd', x: 5, y: 8, width: 20, depth: 18, kind, densityPerM2: density })];
    const z = variant === 'low' ? 1.2 : 5.0;
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
 * crowdLossDb (the 'Crowd absorption' step, positive), chainLossDb (net cable and booster loss, negative = gain) }.
 */
export function fohReport(scene) {
  const one = (l) => {
    const r = solveLink(scene, l);
    const a = r.waterfall.find((w) => /^Crowd absorption/.test(w.label));
    return { distanceM: r.distanceM, rxPowerDbm: r.rxPowerDbm, inputPowerDbm: r.inputPowerDbm, marginDb: r.marginDb, crowdLossDb: a ? -a.deltaDb : 0, chainLossDb: chainLossDb(l.chain, l.freqMHz) };
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
