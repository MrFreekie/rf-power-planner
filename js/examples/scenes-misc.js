// Example scene builders: SR 2050 legacy range and compare change.
import { applyFmPreset } from '../model/fm-presets.js';
import { createChainItem } from '../model/scene.js';
import { omni, make } from './helpers.js';

/**
 * Sennheiser SR 2050 IEM on a legacy range (fm-presets.js): sr2050Scene(powerOptionId) -> an IEM link at 826.0 MHz, inside the Dw 790-865 MHz range that only the 2019 sheet lists (the 10/2023
 * sheet has Aw+, Gw, Gw1, GBw, Bw), transmitter 'sennheiser-sr2050iem' at 'std-30mw' (default) or 'high-50mw', receiver 'sennheiser-ek2000iem', 25 m across a 40 x 20 m hall.
 */
export const SR2050_LEGACY_MHZ = 826.0;
export function sr2050Scene(powerOptionId = 'std-30mw') {
  return make('iem', (s, l) => {
    s.stage = { width: 40, depth: 20 }; s.environment.floor = 'wood'; s.environment.model = 'free-space';
    l.name = 'SR 2050 IEM, Dw range'; l.freqMHz = SR2050_LEGACY_MHZ;
    l.tx.pos = { x: 3, y: 10, z: 2.0 }; l.tx.antenna = omni(); l.rx.antenna = omni(); l.rx.pos = { x: 28, y: 10, z: 1.2 }; l.rx.diversity.antennaB.pos = { x: 28, y: 9.4, z: 1.2 };
    l.chain = [];
    Object.assign(l, applyFmPreset(l, 'sennheiser-sr2050iem', { powerOptionId }));
    Object.assign(l, applyFmPreset(l, 'sennheiser-ek2000iem'));
  });
}

/** Compare with one change: compareChangeScene(lmr) -> a 606.1 MHz mic 19 m from the receiver with 60 m of RG58 on the receive side; lmr = true swaps the one cable for LMR-400 (the only difference between the two scenes). */
export function compareChangeScene(lmr = false) {
  return make('mic', (s, l) => {
    s.stage = { width: 30, depth: 20 }; s.environment.floor = 'wood'; s.environment.model = 'free-space';
    l.name = 'Mic with a long receive cable'; l.freqMHz = 606.1; l.tx.pos = { x: 3, y: 10, z: 1.5 }; l.tx.antenna = omni(); l.rx.antenna = omni();
    l.rx.pos = { x: 22, y: 10, z: 1.2 }; l.rx.diversity.antennaB.pos = { x: 22, y: 9.4, z: 1.2 };
    l.chain = [createChainItem('cable', { cableType: lmr ? 'lmr-400' : 'rg58', lengthM: 60 })];
  });
}
