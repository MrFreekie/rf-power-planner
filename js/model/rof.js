// RF over fibre (RoF) chain item, kind 'rof' (group g). Pure functions, no DOM.
//
// An analogue direct-detect RF-over-fibre link: antenna-side (or rack-side) module -> single-mode fibre -> module. Fields of the
// chain item (all bounded numbers; all figures ASSUMED unless a datasheet says otherwise, flag U):
//   gainDb         RF link gain BACK TO BACK (no fibre, no extra connectors): passive intensity-modulated direct-detect modules are
//                  negative (about -15 to -30 dB), modules with built-in amplifiers about 0 to +20 dB.
//   nfDb           noise figure back to back (passive about 20 to 40 dB, active about 5 to 15 dB).
//   iip3Dbm        input third-order intercept; or sfdrDbHz23 (spurious-free dynamic range in dB Hz^(2/3), good links about 95 to 110):
//                  IIP3 = 1.5 SFDR - 174 + NF  (from SFDR = 2/3 (IIP3 - (-174 + NF))).
//   fibreKm        fibre length (km); fibreLossDbPerKm default 0.35 (single mode, 1310 nm: about 0.35 to 0.4; 1550 nm about 0.2).
//   connectorLossDb  total connector and splice loss (default 1 dB, assumed).
//   bwMinMHz, bwMaxMHz  the usable RF range (outside it: warning).
// Optical budget: opticalLossDb = fibreKm x fibreLossDbPerKm + connectorLossDb. For an intensity-modulated direct-detect link the
// detected RF power goes as the square of the detected optical power, so the RF GAIN falls by 2 dB for every 1 dB of optical loss:
//   gain = gainDb - 2 x opticalLossDb
// and, in the thermal-noise-limited regime this model assumes (relative intensity noise of the laser folded into nfDb), the noise
// figure rises by the same 2 dB per optical dB: NF = nfDb + 2 x opticalLossDb. The input IIP3 stays at the modulator-limited value,
// so the effective SFDR = 2/3 (IIP3 - (-174 + NF)) falls by 2/3 x 2 = 1.33 dB per optical dB.
// Delay: group delay about 4.9 microseconds per km of fibre (group index about 1.47). Negligible for audio, but at 600 MHz one nanosecond is
// 216 degrees of phase: branches combined coherently at RF with different fibre lengths do not add in phase.
// Real products differ and need datasheets: the figures are placeholders (the presets are UNVERIFIED).

export const FIBRE_DELAY_US_PER_KM = 4.9;
export const DEFAULT_FIBRE_LOSS_DB_PER_KM = 0.35; // single mode 1310 nm, assumed
export const DEFAULT_CONNECTOR_LOSS_DB = 1;       // assumed
export const SPEED_OF_LIGHT_M_PER_NS = 0.299792458;
/** Fibre length mismatch (ns of delay) above which a coherently combined RF branch pair gets a warning (about 10 cm of fibre; 0.5 ns = 108 degrees at 600 MHz). */
export const ROF_DELAY_MISMATCH_WARN_NS = 0.5;

const num = (v, d) => (Number.isFinite(v) ? v : d);

/** Optical loss (dB) of the fibre run: fibre + connectors. */
export function rofOpticalLossDb(item) {
  return num(item.fibreKm, 0) * num(item.fibreLossDbPerKm, DEFAULT_FIBRE_LOSS_DB_PER_KM) + num(item.connectorLossDb, DEFAULT_CONNECTOR_LOSS_DB);
}

/** Input IIP3 (dBm) from an SFDR figure (dB Hz^(2/3)) and the back-to-back noise figure: 1.5 SFDR - 174 + NF. */
export const rofIip3FromSfdr = (sfdrDbHz23, nfDb) => 1.5 * sfdrDbHz23 - 174 + nfDb;

/**
 * rofEffective(item) -> { opticalLossDb, gainDb, nfDb, iip3Dbm, sfdrDbHz23, delayUs, delayNs, electricalLengthM }
 * Everything the cascade needs at the actual fibre length. iip3Dbm is the INPUT intercept (item.iip3Dbm, else from sfdrDbHz23, else +10 dBm assumed).
 */
export function rofEffective(item) {
  const opt = rofOpticalLossDb(item);
  const gainDb = num(item.gainDb, -25) - 2 * opt;
  const nf0 = num(item.nfDb, 30);
  const nfDb = nf0 + 2 * opt;
  const iip3Dbm = Number.isFinite(item.iip3Dbm) ? item.iip3Dbm : Number.isFinite(item.sfdrDbHz23) ? rofIip3FromSfdr(item.sfdrDbHz23, nf0) : 10;
  const delayUs = num(item.fibreKm, 0) * FIBRE_DELAY_US_PER_KM;
  return {
    opticalLossDb: opt, gainDb, nfDb, iip3Dbm,
    sfdrDbHz23: (2 / 3) * (iip3Dbm - (-174 + nfDb)),
    delayUs, delayNs: delayUs * 1000, electricalLengthM: delayUs * 1000 * SPEED_OF_LIGHT_M_PER_NS,
  };
}

/** Out-of-range warnings for the rof items of a chain at freqMHz, and branch delay mismatch for an array of chains. Plain strings. */
export function rofChainWarnings(chain, freqMHz) {
  const out = [];
  (chain || []).forEach((it) => {
    if (!it || it.kind !== 'rof') return;
    if (Number.isFinite(it.bwMinMHz) && freqMHz < it.bwMinMHz || Number.isFinite(it.bwMaxMHz) && freqMHz > it.bwMaxMHz) {
      out.push(`RF over fibre link is rated ${num(it.bwMinMHz, 0)}-${num(it.bwMaxMHz, Infinity)} MHz but the link is at ${freqMHz} MHz: gain and flatness are not guaranteed there.`);
    }
    const e = rofEffective(it);
    if (e.gainDb < -40) out.push(`RF over fibre link has ${e.gainDb.toFixed(0)} dB of gain with ${e.opticalLossDb.toFixed(1)} dB of optical loss (2 dB RF per 1 dB optical): shorten the fibre, remove connectors or use an active module.`);
  });
  return out;
}

/**
 * rofBranchDelays(chains) -> { delaysNs: number[], spreadNs, warn: boolean }: fibre delay of every branch (sum over its rof items) and the
 * largest difference. warn when the spread exceeds ROF_DELAY_MISMATCH_WARN_NS (only meaningful for branches combined coherently at RF).
 */
export function rofBranchDelays(chains) {
  const d = (chains || []).map((c) => (c || []).reduce((s, it) => s + (it && it.kind === 'rof' ? num(it.fibreKm, 0) * FIBRE_DELAY_US_PER_KM * 1000 : 0), 0));
  const spread = d.length ? Math.max(...d) - Math.min(...d) : 0;
  return { delaysNs: d, spreadNs: spread, warn: spread > ROF_DELAY_MISMATCH_WARN_NS };
}
