// Antenna design band, VSWR, return loss and mismatch loss (group i). Pure functions, no DOM.
//
// Opt-in: an antenna with no `designBand` is matched (VSWR 1:1, no loss), so every existing scene is unchanged.
//   antenna.designBand = { loMHz, hiMHz, order?, minVswr?, label? }
// loMHz..hiMHz is the range over which VSWR stays at or below 2:1 (the usual definition of the usable band). order 1 = a resonant
// whip / dipole / quarter-wave (a single resonance); order 3 = a wideband paddle, helical or log-periodic design (flat inside the band,
// steeper skirts). minVswr (default 1.0 narrow, 1.3 wideband: ASSUMED) is the best match inside the band.
//
// Model (ASSUMED, approximate: a series resonator, not a measured antenna). With f0 = sqrt(lo*hi) and the detuning
//   x = (f/f0 - f0/f) / (hi/f0 - f0/hi)            (x = +-1 at the band edges, 0 at the centre)
//   X = sqrt(1/2) * |x|^order                       (normalised reactance; X^2 = 1/2 gives |gamma| = 1/3, VSWR 2:1 at the edges)
//   |gamma|^2 = X^2 / (4 + X^2)                     (reflection of a series reactance X against a matched line: gamma = jX/(2 + jX))
// then |gamma|^2 is floored at the in-band best match. Standard definitions:
//   VSWR = (1 + |gamma|) / (1 - |gamma|)                       (voltage standing-wave ratio)
//   return loss RL = -20 log10 |gamma|  (dB)
//   mismatch loss ML = -10 log10(1 - |gamma|^2) (dB)           (power not delivered: reflected, not dissipated)
// Anchors: VSWR 1.5 = 0.18 dB, 2 = 0.51 dB, 3 = 1.25 dB, 5 = 3.01 dB. Mismatch loss is capped at MAX_MISMATCH_DB (30) because a real
// antenna far out of band still radiates a little and the series model stops being meaningful.

export const MAX_MISMATCH_DB = 30;
/** A resonant (order 1) antenna is never narrower than this fractional 2:1 bandwidth (ASSUMED 8 percent; real whips are about 5 to 15 percent). */
export const MIN_FRACTIONAL_BW = 0.08;
export const BAND_VSWR_WARN = 2;     // above this at a transmitter antenna the reflected power is worth a warning
export const BAND_VSWR_STRONG = 3;   // above this the PA may fold back or be stressed (assumed threshold)

/** Named design bands (MHz). ALL ASSUMED round numbers for teaching, not product data: check the actual antenna label. */
export const ANTENNA_BANDS = Object.freeze({
  'uhf-470-520': { loMHz: 470, hiMHz: 520, label: 'UHF band A, 470-520 MHz (assumed)' },
  'uhf-520-570': { loMHz: 520, hiMHz: 570, label: 'UHF band B, 520-570 MHz (assumed)' },
  'uhf-570-608': { loMHz: 570, hiMHz: 608, label: 'UHF band C, 570-608 MHz (assumed)' },
  'uhf-600-700': { loMHz: 600, hiMHz: 700, label: 'UHF 600-700 MHz (assumed)' },
  'uhf-800': { loMHz: 790, hiMHz: 865, label: 'UHF 790-865 MHz class (assumed)' },
  'srd-863-865': { loMHz: 863, hiMHz: 865, label: '863-865 MHz (assumed; whips cut for it are narrow)' },
  'cell-1800': { loMHz: 1710, hiMHz: 1880, label: '1.8 GHz (assumed)' },
  'ism-2400': { loMHz: 2400, hiMHz: 2483.5, label: '2.4 GHz ISM (assumed)' },
  'tv-wide': { loMHz: 470, hiMHz: 960, label: 'Wideband TV/UHF, 470-960 MHz (assumed, log-periodic or paddle)', order: 3, minVswr: 1.3 },
});

/** Resolve antenna.designBand (an object, or the id of an ANTENNA_BANDS entry) to { loMHz, hiMHz, order, minVswr, label } or null. */
export function resolveDesignBand(ant) {
  let b = ant && ant.designBand;
  if (typeof b === 'string') b = Object.prototype.hasOwnProperty.call(ANTENNA_BANDS, b) ? ANTENNA_BANDS[b] : null;
  if (!b || !(b.loMHz > 0) || !(b.hiMHz > b.loMHz)) return null;
  const order = b.order === 3 ? 3 : 1;
  // the matching edges (loMHz/hiMHz of the result) widen a too-narrow channel label to MIN_FRACTIONAL_BW about its geometric centre; statedLo/Hi keep the label
  const c0 = Math.sqrt(b.loMHz * b.hiMHz), k = Math.sqrt(1 + MIN_FRACTIONAL_BW);
  const wide = b.hiMHz / b.loMHz >= 1 + MIN_FRACTIONAL_BW;
  return { loMHz: wide ? b.loMHz : c0 / k, hiMHz: wide ? b.hiMHz : c0 * k, statedLoMHz: b.loMHz, statedHiMHz: b.hiMHz, order, minVswr: Number.isFinite(b.minVswr) && b.minVswr >= 1 ? b.minVswr : (order === 3 ? 1.3 : 1), label: b.label || `${b.loMHz}-${b.hiMHz} MHz` };
}

/**
 * antennaMatch(ant, fMHz) -> { matched, vswr, returnLossDb, gammaSq, mismatchDb, inBand, band }
 * matched = true (vswr 1, 0 dB) when the antenna has no design band. inBand = VSWR <= 2 (inside lo..hi, within rounding).
 */
export function antennaMatch(ant, fMHz) {
  const band = resolveDesignBand(ant);
  if (!band || !(fMHz > 0)) return { matched: true, vswr: 1, returnLossDb: Infinity, gammaSq: 0, mismatchDb: 0, inBand: true, band: null };
  const f0 = Math.sqrt(band.loMHz * band.hiMHz);
  const edge = band.hiMHz / f0 - f0 / band.hiMHz;
  const x = Math.abs(fMHz / f0 - f0 / fMHz) / edge;
  const X2 = 0.5 * Math.pow(x, 2 * band.order);
  const gmin = (band.minVswr - 1) / (band.minVswr + 1);
  let gammaSq = Math.max(X2 / (4 + X2), gmin * gmin);
  const maxG = 1 - Math.pow(10, -MAX_MISMATCH_DB / 10);
  gammaSq = Math.min(gammaSq, maxG);
  const g = Math.sqrt(gammaSq);
  const vswr = (1 + g) / (1 - g);
  return {
    matched: false, vswr, returnLossDb: g > 0 ? -20 * Math.log10(g) : Infinity, gammaSq,
    mismatchDb: -10 * Math.log10(1 - gammaSq), inBand: fMHz >= band.loMHz * 0.9999 && fMHz <= band.hiMHz * 1.0001, // 2:1 range (widened to the minimum width)
     band,
  };
}

/** Mismatch loss in dB for an antenna at fMHz (0 for an antenna without a design band). */
export const mismatchLossDb = (ant, fMHz) => antennaMatch(ant, fMHz).mismatchDb;

/** VSWR seen through a lossy line of one-way loss lossDb (the round trip is 2 x lossDb on the reflected wave): gamma' = gamma * 10^(-lossDb/10) in amplitude. */
export function vswrThroughLoss(vswr, lossDb) {
  const g = (vswr - 1) / (vswr + 1) * Math.pow(10, -Math.max(lossDb, 0) / 10);
  return (1 + g) / (1 - g);
}

/** Return-loss sweep for plotting: [{ fMHz, vswr, returnLossDb, mismatchDb }] from fLoMHz to fHiMHz, n points (default 101, max 2001). */
export function returnLossSweep(ant, fLoMHz, fHiMHz, n = 101) {
  const m = Math.max(2, Math.min(2001, Math.floor(n)));
  const out = [];
  for (let i = 0; i < m; i++) {
    const f = fLoMHz + ((fHiMHz - fLoMHz) * i) / (m - 1);
    const r = antennaMatch(ant, f);
    out.push({ fMHz: f, vswr: r.vswr, returnLossDb: r.returnLossDb, mismatchDb: r.mismatchDb });
  }
  return out;
}
