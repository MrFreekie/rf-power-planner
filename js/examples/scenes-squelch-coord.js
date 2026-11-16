// Example scene builders: squelch burst and pilot squelch, coordination frequency plans.
import { solveLink } from '../model/rf.js';
import { squelchState } from '../model/squelch.js';
import { mpxState } from '../model/mpx.js';
import { createNoiseSource, noiseEvents } from '../model/noise-sources.js';
import { createChainItem } from '../model/scene.js';
import { omni, make } from './helpers.js';
import { imdScene } from './scenes-imd.js';

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

/**
 * Squelch with a pilot (squelch.js, mpx.js): squelchPilotScene() -> the geometry of squelchBurstScene as an IEM link (transmitter off, a speedlight 21.9 m from the pack, carrier squelch -90 dBm)
 * with pilot squelch switched on. A flash carries no 19 kHz pilot, so the pilot never locks and the gate stays shut at the flash peak, where the carrier squelch alone opens.
 */
export function squelchPilotScene() {
  return make('iem', (s, l) => {
    s.stage = { width: 30, depth: 20 }; s.environment.floor = 'wood'; s.environment.model = 'free-space';
    l.name = 'IEM pack (transmitter off)'; l.freqMHz = 606.1; l.tx.pos = { x: 3, y: 10, z: 1.5 }; l.tx.powerDbm = -60; l.tx.antenna = omni(); l.rx.antenna = omni();
    l.rx.pos = { x: 22, y: 10, z: 1.2 }; l.rx.diversity.antennaB.pos = { x: 22, y: 9.4, z: 1.2 };
    l.chain = [];
    l.rx.squelch = { enabled: true, thresholdDbm: -90, hysteresisDb: 3 };
    l.mpx.pilotSquelch = true;
    s.noiseSources = [createNoiseSource('speedlight-flash', { name: 'Photographer speedlight', pos: { x: 0.5, y: 14, z: 1.5 } })];
  });
}
/** squelchPilotReport() -> the flash peak and average at the pack, and the gate with carrier squelch alone and with the pilot required (the flash has no pilot: pilotPresent false). */
export function squelchPilotReport() {
  const sc = squelchPilotScene(), l = sc.links[0], r = solveLink(sc, l), n = r.noiseSources, src = n.sources[0];
  const floor = n.floorBeforeDbm, sum = (a, b) => 10 * Math.log10(Math.pow(10, a / 10) + Math.pow(10, b / 10)), burst = sum(floor, src.peakDbm), idle = sum(floor, src.averageDbm);
  const locked = mpxState(burst, { pilotSquelchEnabled: true }, null, { pilotPresent: false }).pilotLocked;
  const carrierOnly = squelchState(false, burst, l.rx.squelch), withPilot = squelchState(false, burst, l.rx.squelch, { pilotRequired: !!l.mpx.pilotSquelch, pilotLocked: locked });
  return { scene: sc, floorDbm: floor, peakDbm: src.peakDbm, avgDbm: src.averageDbm, burstLevelDbm: burst, idleLevelDbm: idle, thresholdDbm: l.rx.squelch.thresholdDbm, pilotLocked: locked, carrierOnly, withPilot, events: noiseEvents(sc.noiseSources[0], 10).length };
}
