// Chain checks that need the cable library (pure, no DOM). rf.js imports this file, so it must not import rf.js.
import { CABLES } from './library.js';

/** Reference impedance of the radio chain (transmitters, receivers, antennas and most pro-audio coax). */
export const SYSTEM_OHM = 50;
/**
 * Mismatch loss of one 50/75 ohm junction: |gamma| = (75-50)/(75+50) = 0.2, loss = -10 log10(1 - 0.04) = 0.18 dB (VSWR 1.5:1).
 * Two junctions (both ends of the run) cost about 0.2 to 0.5 dB depending on cable length and phase: ASSUMED, not added to the budget.
 */
export const MISMATCH_75_50_DB = 0.18;

/** Characteristic impedance of a cable type in ohms (50 unless the library entry says otherwise); 50 for an unknown or custom type. */
export function cableImpedanceOhm(cableId) {
  const c = CABLES[cableId];
  return c && Number.isFinite(c.impedanceOhm) ? c.impedanceOhm : SYSTEM_OHM;
}

/** Mismatch loss (dB) of one junction between impedances a and b (ohms). */
export function junctionMismatchDb(a, b) {
  const g = (a - b) / (a + b);
  return -10 * Math.log10(1 - g * g);
}

/** chainImpedanceWarnings(chain) -> string[]: one line per cable in the chain whose impedance is not 50 ohm. Warns only. */
export function chainImpedanceWarnings(chain) {
  const out = [];
  for (const it of Array.isArray(chain) ? chain : []) {
    if (!it || it.kind !== 'cable') continue;
    const z = cableImpedanceOhm(it.cableType);
    if (z === SYSTEM_OHM) continue;
    const name = (CABLES[it.cableType] && CABLES[it.cableType].name) || it.cableType;
    out.push(`${name} is a ${z} ohm cable in a ${SYSTEM_OHM} ohm chain: each end is a ${z}/${SYSTEM_OHM} ohm step (VSWR about ${(Math.max(z, SYSTEM_OHM) / Math.min(z, SYSTEM_OHM)).toFixed(1)}:1, about ${junctionMismatchDb(z, SYSTEM_OHM).toFixed(2)} dB each). Expect roughly 0.2 to 0.5 dB extra loss (assumed, not in the budget) and reflections: use ${SYSTEM_OHM} ohm cable, or matching pads.`);
  }
  return out;
}
