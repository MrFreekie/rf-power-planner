// Multi-antenna IEM zone parameters: wall transmission loss, distribution (splitters, boosters) and coverage criteria.
// Pure constants and tiny pure helpers (no DOM, no state), all frozen. Units: m, MHz, dB, dBm.
//
// Everything here is GENERIC and ILLUSTRATIVE. Real walls vary widely with construction, moisture, rebar and
// openings, and splitters and amplifiers vary by product. Measure on site for critical coverage.
//
// Sources (derivations in docs/PHYSICS-ZONES.md):
//  - ITU-R P.2040 (effects of building materials and structures on radiowave propagation above about 100 MHz):
//    permittivity and conductivity of concrete, brick, plasterboard, glass, wood, and the resulting attenuation.
//  - ITU-R P.1238 (indoor propagation) for typical floor and wall penetration allowances.
//  - Standard microwave texts (Pozar) for power splitters: ideal split loss 10 log10(N), insertion loss, isolation.
//  - Coherence length of a modulated carrier: c / B (standard signal-theory relation).

import { WALL_LOSS_BY_FREQ, wallLossDb as libraryWallLossDb } from './library.js';

export const TRANSMISSION_REFERENCE_MHZ = 600;
export const SPEED_OF_LIGHT_M_S = 299792458;

// Through-wall (transmission) loss at 600 MHz for a reference thickness, with a frequency exponent.
//   L(f) = L600 * (f / 600)^freqExponent                 (dB, f in MHz)
//   L(t, f) = (interfaceDb + absorptionDbPerM * t) * (f / 600)^freqExponent   (dB; affine in thickness, approx)
// Values include both interfaces and absorption (approx; measured walls with rebar, wet masonry or foil-backed board
// are higher). Reflection from the wall is handled separately by the reflector model.
// Thickness law (approx): L(t) = interfaceDb + absorptionDbPerM * t, with interfaceDb the loss of the two surfaces (reflection
// plus mismatch, independent of thickness) and absorptionDbPerM = (L_ref - interfaceDb) / t_ref. At t = t_ref the table value
// is returned exactly; at t -> 0 only the interface loss remains (a very thin sheet is not lossless). Frequency scaling
// multiplies the whole sum.
const row = (name, refThicknessM, lossDb600, freqExponent, note, interfaceDb = 0) => Object.freeze({
  name, refThicknessM, lossDb600, lossDb: lossDb600, refMHz: 600, freqExponent, note,
  interfaceDb, absorptionDbPerM: (lossDb600 - interfaceDb) / refThicknessM
});

export const MATERIAL_TRANSMISSION = Object.freeze({
  drywall: row('Drywall / plasterboard stud wall', 0.1, 3, 0.4, 'approx: 2 to 3 layers of board on studs; P.2040 plasterboard', 1),
  brick: row('Brick', 0.1, 5, 0.7, 'approx: single leaf; P.2040 brick', 1.5),
  concrete: row('Concrete, thin', 0.1, 8, 0.6, 'approx: P.2040 concrete absorption about 2 to 3 dB per 100 mm plus interfaces, plus moisture and rebar', 2.5),
  'concrete-thick': row('Concrete, thick', 0.3, 18, 0.6, 'approx', 2.5),
  'concrete-reinforced': row('Concrete, reinforced', 0.2, 20, 0.6, 'approx: rebar mesh adds reflection and screening', 6),
  glass: row('Glass, single pane', 0.01, 2, 0.3, 'approx: P.2040 glass', 1),
  'glass-lowe': row('Glass, metal-coated (low-E)', 0.024, 20, 0.2, 'approx: the metallic coating dominates', 18),
  wood: row('Wood door / stage flat', 0.04, 2.5, 0.4, 'approx: P.2040 wood', 1),
  drapes: row('Drapes / curtain', 0.02, 3, 0.3, 'approx', 1),
  metal: row('Metal sheet', 0.001, 60, 0, 'approx: practically a screen; real leakage comes from gaps and joints', 60),
  grass: row('Soil / earth bank', 0.5, 10, 0.5, 'approx', 2)
});

// dB at 600 MHz and the reference thickness, by material id (ids match MATERIALS in library.js, plus variants).
export const TRANSMISSION_LOSS_DB = Object.freeze(Object.fromEntries(Object.entries(MATERIAL_TRANSMISSION).map(([id, r]) => [id, r.lossDb600])));

/**
 * Frequency scale factor of a wall's loss relative to 600 MHz (1 at 600 MHz). Materials in library.js WALL_LOSS_BY_FREQ (points at
 * 200, 600, 900, 2400, 5800 MHz, log-frequency interpolation, flat outside) use the ratio of the library values, whose equivalent
 * exponents are 0.2-0.45 (a single 0.4-0.7 power law over-predicted at 5.8 GHz: 0.1 m concrete 31 dB, library 21 dB). Others
 * use the row's freqExponent.
 */
export function wallFreqScale(id, freqMHz) {
  const r = MATERIAL_TRANSMISSION[id];
  if (!r) return 1;
  if (WALL_LOSS_BY_FREQ[id]) {
    const ref = libraryWallLossDb(id, TRANSMISSION_REFERENCE_MHZ);
    return ref > 0 ? libraryWallLossDb(id, freqMHz) / ref : 1;
  }
  return Math.pow(freqMHz / TRANSMISSION_REFERENCE_MHZ, r.freqExponent);
}

/** Through-wall loss in dB for material id, thickness in m (default: reference thickness) and frequency in MHz. */
export function transmissionLossDb(id, thicknessM, freqMHz = TRANSMISSION_REFERENCE_MHZ) {
  const r = MATERIAL_TRANSMISSION[id];
  if (!r) return 0;
  const t = Number.isFinite(thicknessM) && thicknessM >= 0 ? thicknessM : r.refThicknessM;
  const f = Number.isFinite(freqMHz) && freqMHz > 0 ? freqMHz : TRANSMISSION_REFERENCE_MHZ;
  return (r.interfaceDb + r.absorptionDbPerM * t) * wallFreqScale(id, f);
}

// Crowd as a fading allowance (dB) for body-worn receivers in or behind an audience. Not a wall.
export const CROWD_ALLOWANCE_DB = Object.freeze({
  none: 0,
  sparse: 3,    // approx
  dense: 6,     // approx
  packed: 10    // approx: standing crowd between the antenna and the receivers
});

// Passive and active distribution. Loss figures are per output port, dB.
//   passive total loss = 10 log10(N) + insertionLossDb.
export const SPLITTER_PRESETS = Object.freeze({
  'passive-2way': Object.freeze({ id: 'passive-2way', label: 'Passive 2-way (illustrative)', illustrative: true, kind: 'passive', ports: 2, insertionLossDb: 0.3, isolationDb: 20 }),
  'passive-3way': Object.freeze({ id: 'passive-3way', label: 'Passive 3-way (illustrative)', illustrative: true, kind: 'passive', ports: 3, insertionLossDb: 0.5, isolationDb: 18 }),
  'passive-4way': Object.freeze({ id: 'passive-4way', label: 'Passive 4-way (illustrative)', illustrative: true, kind: 'passive', ports: 4, insertionLossDb: 0.6, isolationDb: 18 }),
  'passive-8way': Object.freeze({ id: 'passive-8way', label: 'Passive 8-way (illustrative)', illustrative: true, kind: 'passive', ports: 8, insertionLossDb: 1.0, isolationDb: 16 }),
  // Active distribution amplifier: net gain per port after the internal split.
  'active-4way': Object.freeze({ id: 'active-4way', label: 'Active distribution amp, 4 ports (illustrative)', illustrative: true, kind: 'active', ports: 4, gainDb: 6, noiseFigureDb: 6, maxOutputDbm: 10, isolationDb: 25 }),
  'active-8way': Object.freeze({ id: 'active-8way', label: 'Active distribution amp, 8 ports (illustrative)', illustrative: true, kind: 'active', ports: 8, gainDb: 3, noiseFigureDb: 7, maxOutputDbm: 10, isolationDb: 25 })
});

/** Per-port loss of a splitter preset in dB (negative = gain). */
export function splitterPortLossDb(preset) {
  if (!preset) return 0;
  if (preset.kind === 'active') return -preset.gainDb;
  return 10 * Math.log10(preset.ports) + preset.insertionLossDb;
}

// Relative amplitude spread of two equal-frequency antenna signals that differ by `deltaDb` in level: the
// peak-to-null swing in dB as the phase between them changes. 20 log10((1 + r) / (1 - r)), r = 10^(-deltaDb / 20).
export function combSwingDb(deltaDb) {
  const r = Math.pow(10, -Math.abs(deltaDb) / 20);
  if (r >= 1) return Infinity;
  return 20 * Math.log10((1 + r) / (1 - r));
}

/** Coherence length of a modulated signal of bandwidth bandwidthHz: c / B, metres. */
export function coherenceLengthM(bandwidthHz) {
  return SPEED_OF_LIGHT_M_S / bandwidthHz;
}

// Cable propagation delay per metre, ns, for a velocity factor.
export function cableDelayNsPerM(velocityFactor) {
  return 1e9 / (SPEED_OF_LIGHT_M_S * velocityFactor);
}

// Coverage criteria. required level = squelch threshold + fade margin (+ body shadow if not already in the antenna model).
export const COVERAGE_PRESETS = Object.freeze({
  'static-performer': Object.freeze({ id: 'static-performer', label: 'Static performer (illustrative)', illustrative: true, fadeMarginDb: 6, bodyShadowDb: 0, crowd: 'none', passAreaFraction: 0.9 }),
  'moving-bodypack': Object.freeze({ id: 'moving-bodypack', label: 'Moving, body-worn receiver (illustrative)', illustrative: true, fadeMarginDb: 15, bodyShadowDb: 0, crowd: 'none', passAreaFraction: 0.95 }),
  'critical-wide-stage': Object.freeze({ id: 'critical-wide-stage', label: 'Critical, wide stage with crowd (illustrative)', illustrative: true, fadeMarginDb: 20, bodyShadowDb: 0, crowd: 'dense', passAreaFraction: 0.98 })
});

export const COVERAGE_DEFAULTS = COVERAGE_PRESETS['moving-bodypack'];
export const BODY_SHADOW_DB = Object.freeze({ typical: 6, worst: 10 }); // approx: bodypack at the hip, receiver antenna on the body

/** Required received level, dBm = squelch threshold + fade margin + body shadow + crowd allowance. */
export function requiredLevelDbm(squelchThresholdDbm, preset = COVERAGE_DEFAULTS) {
  return squelchThresholdDbm + preset.fadeMarginDb + preset.bodyShadowDb + (CROWD_ALLOWANCE_DB[preset.crowd] || 0);
}
