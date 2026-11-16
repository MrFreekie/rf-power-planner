// Shared helpers for the example scenes: the base scene factory, the two-ray and same-stage geometry, the outdoor and IEM-hall layouts.
import { wallNoiseSourcesFromReflectors } from '../model/noise-sources.js';
import { createDefaultScene, createDefaultLink, createChainItem, syncScene, migrateAntennaPolarisation } from '../model/scene.js';

export const omni = (el = 90, polarisation = 'vertical') => ({ type: 'omni', gainDbi: 0, orientation: { az: 0, el }, polarisation });

/** Base scene with a single link of the given kind; `fn(scene, link)` customises it. */
export function make(kind, fn) {
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
export function twoRay(scene, link) {
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
export function sameStage(scene, link, freqMHz) {
  scene.environment.floor = 'wood';
  link.freqMHz = freqMHz;
  link.tx.antenna = omni();
  link.rx.antenna = omni();
  link.tx.pos = { x: 1, y: 4, z: 1.5 };
  link.rx.pos = { x: 11, y: 4, z: 1.0 };
  link.rx.diversity.antennaB.pos = { x: 11, y: 3.4, z: 1.0 };
  link.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 })];
}

export const SAME_STAGE_WALK = { to: { x: 1, y: 4, z: 1.5 }, speedMps: 0.8, pingPong: true };

export const ACROSS = { to: { x: 0.5, y: 6.5, z: 1.75 }, speedMps: 0.8, pingPong: true };

export function outdoorIem(scene, link) {
  scene.stage = { width: 120, depth: 80 };
  link.tx.pos = { x: 115, y: 5, z: 1.2 };
  link.rx.pos = { x: 113, y: 6, z: 1.0 };
  link.rx.diversity.antennaB.pos = { x: 112.4, y: 6, z: 1.0 };
  link.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 }), createChainItem('attenuator', { lossDb: 35 })];
  link.rx.squelch = { enabled: true, thresholdDbm: -125, hysteresisDb: 3 };
}

export function outdoorMic(scene, link) {
  scene.stage = { width: 120, depth: 80 };
  link.rx.pos = { x: 115, y: 5, z: 2.5 };
  link.rx.diversity.antennaB.pos = { x: 114.4, y: 5, z: 2.5 };
  link.tx.pos = { x: 113, y: 6, z: 1.5 };
  link.chain = [createChainItem('attenuator', { lossDb: 40 }), createChainItem('cable', { cableType: 'rg58', lengthM: 5 })];
  link.rx.squelch = { enabled: true, thresholdDbm: -104, hysteresisDb: 3 };
}

/** IEM combiner examples: a 30 x 20 m hall, transmitters together at the left, the bodypack far down the hall. */
export function iemHall(s, l, m) {
  s.stage = { width: 30, depth: 20 };
  l.rx.pos = { x: 22, y: 12, z: 1.2 };
  m.rxAntennaPos = { x: 22, y: 12, z: 1.2 };
  m.rxAntenna = { type: 'omni', gainDbi: -3, orientation: { az: 0, el: 90 } };
  m.transmitters.forEach((t, i) => { t.pos = { x: 3 + i * 0.2, y: 10, z: 1.5 }; });
}
