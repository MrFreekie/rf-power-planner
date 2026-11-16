// Example scene builders: the review set and the noise-source set.
import { createNoiseSource, engCrewSources } from '../model/noise-sources.js';
import { createChainItem, createBranch, createZone, createChainItemFromPreset, newId } from '../model/scene.js';
import { omni, make } from './helpers.js';
import { bandScene, p2pScene } from './scenes-venue.js';
import { sosScene } from './scenes-foh.js';
import { iem8Scene } from './scenes-imd.js';

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
    case 'flash-trigger-24': return make('mic', (s, l) => { // a 2.4 GHz mic on the same channel as a camera radio flash trigger 8 m from the receive antenna
      base(s, l); l.name = '2.4 GHz mic at FOH'; l.freqMHz = 2440; l.tx.powerDbm = 10;
      s.noiseSources = [at('flash-trigger-radio', { x: 28, y: 14, z: 1.5 }, { name: 'Camera radio flash trigger' })];
    });
    case 'keyed-vs-continuous': return make('mic', (s, l) => { // a keyed PTT radio 3 m away and an LED light placed to give the same average floor rise
      base(s, l); l.name = 'Mic at FOH';
      s.noiseSources = [at('ptt-business-uhf', { x: 25, y: 10, z: 1.2 }, { name: 'Crew PTT radio' }), at('led-camera-light', { x: 16, y: 18.6, z: 1.5 }, { name: 'LED camera light' })];
    });
    case 'hoist-vs-led': return make('mic', (s, l) => { // mic transmitter off between songs; a hoist motor and an LED wall light with the same average level
      base(s, l); l.name = 'Mic at FOH (transmitter off)'; l.tx.powerDbm = -60; l.rx.squelch = { enabled: true, thresholdDbm: -90, hysteresisDb: 3 };
      s.noiseSources = [at('motor-hoist', { x: 28, y: 18, z: 1.5 }, { name: 'Chain hoist motor' }), at('led-light-pwm', { x: 17, y: 20, z: 1.5 }, { name: 'LED wall light' })];
    });
    case 'generator-van': return make('mic', (s, l) => { // a tour power generator beside the FOH position, 8 m from the receive antenna
      base(s, l); l.name = 'Mic at FOH';
      s.noiseSources = [at('generator-inverter', { x: 22, y: 18, z: 1.0 }, { name: 'Tour generator' })];
    });
    case 'pyro-trigger-433': return make('mic', (s, l) => { // a licence-free 433 MHz mic and the pyro cue trigger 0.8 MHz above it, on the stage
      base(s, l); l.name = '433 MHz mic at FOH'; l.freqMHz = 433.1; l.tx.powerDbm = 10;
      s.noiseSources = [at('pyro-trigger', { x: 3, y: 12, z: 1.2 }, { name: 'Pyro cue trigger' })];
    });
    default: return null;
  }
}
