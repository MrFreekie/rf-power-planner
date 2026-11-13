// Pure maths for the ripple overlay (no DOM). Distances in metres, angles in degrees unless noted.
// The rings are a visual aid: their SPACING is the true wavelength, their MOTION is not real RF speed.

export const C_M_S = 299792458;
export const MIN_SPACING_PX = 8;     // below this the rings are drawn every N wavelengths
export const ALPHA_RANGE_DB = 36;    // dynamic range mapped to ring opacity
export const MAX_ALPHA = 0.8;        // the strongest visible ring is not saturated
export const BASE_RINGS_PER_S = 0.6; // visual speed at 1x

export const wavelengthM = (freqMHz) => C_M_S / (freqMHz * 1e6);

/** Ring spacing: the true wavelength, or a whole multiple of it when it would be under minPx on screen. */
export function ringSpacing(lambdaM, pxPerM, minPx = MIN_SPACING_PX) {
  const px = lambdaM * pxPerM;
  const multiple = px >= minPx || !(px > 0) ? 1 : Math.ceil(minPx / px - 1e-9);
  return { spacingM: lambdaM * multiple, multiple };
}

/** Advance the 0..1 ring phase by dtSeconds at ringsPerSecond. */
export function advancePhase(phase, dtSeconds, ringsPerSecond) {
  const p = (phase + dtSeconds * ringsPerSecond) % 1;
  return p < 0 ? p + 1 : p;
}

/** Radius in metres of the first ring for a given phase (0..1). Later rings add k * spacing. */
export const ringOffsetM = (phase, spacingM) => (((phase % 1) + 1) % 1) * spacingM;
export const ringRadiusM = (k, phase, spacingM) => ringOffsetM(phase, spacingM) + k * spacingM;

/** Number of rings needed to reach maxRadiusM, capped. */
export function ringCount(maxRadiusM, phase, spacingM, cap = 60) {
  const first = ringOffsetM(phase, spacingM);
  if (!(spacingM > 0) || maxRadiusM <= first) return 0;
  return Math.min(cap, Math.floor((maxRadiusM - first) / spacingM) + 1);
}

/** Path-loss term in dB relative to the reference distance (spreading loss only, 20 log10). */
export function spreadingRelDb(distM, refDistM) {
  return -20 * Math.log10(Math.max(distM, refDistM) / refDistM);
}

/** Ring opacity from pattern gain (dB below the antenna maximum, <= 0), distance, and extra loss. */
export function ringAlpha(patternRelDb, distM, refDistM, extraLossDb = 0, rangeDb = ALPHA_RANGE_DB, maxAlpha = MAX_ALPHA) {
  const rel = patternRelDb + spreadingRelDb(distM, refDistM) - extraLossDb;
  const k = 1 + rel / rangeDb;
  return k <= 0 ? 0 : (k >= 1 ? 1 : k) * maxAlpha;
}

/** Quantise an opacity 0..maxAlpha into one of n buckets (0 = invisible). */
export function alphaBucket(alpha, n = 6, maxAlpha = MAX_ALPHA) {
  if (!(alpha > 0.02)) return 0;
  return Math.min(n, Math.max(1, Math.ceil((alpha / maxAlpha) * n)));
}

/** Relative pattern table (dB below the maximum) from absolute gains. Writes into `out` and returns it. */
export function relativeTable(gains, out) {
  let max = -Infinity;
  for (let i = 0; i < gains.length; i++) if (gains[i] > max) max = gains[i];
  const o = out || new Float32Array(gains.length);
  for (let i = 0; i < gains.length; i++) o[i] = gains[i] - max;
  return o;
}

/** Table index (0..n-1) for an angle in degrees. */
export function angleIndex(deg, n) {
  const a = (((deg % 360) + 360) % 360) / 360;
  return Math.floor(a * n + 0.5) % n;
}

/** Does a ring front sit within `px` pixels of a point at distM? Returns 0..1 closeness (1 = on the ring). */
export function ringArrival(distM, phase, spacingM, pxPerM, px = 6) {
  const s = (distM - ringOffsetM(phase, spacingM)) / spacingM;
  const frac = s - Math.floor(s);
  const dpx = Math.min(frac, 1 - frac) * spacingM * pxPerM;
  return dpx >= px ? 0 : 1 - dpx / px;
}

/**
 * Coherent field relative to the direct wave alone, in dB (clamped to [floorDb, +12]).
 * sources: flat array [x, y, z, amp, phaseRad, ...] with the DIRECT source first. Amplitude falls as 1/d.
 * Observation point (px, py, pz) in metres; k = 2 pi / lambda. Side view uses x = s, y = height, z = 0.
 */
export function fieldRelDb(sources, k, px, py, pz = 0, floorDb = -40) {
  let re = 0, im = 0, dre = 0;
  for (let i = 0; i < sources.length; i += 5) {
    const dx = px - sources[i], dy = py - sources[i + 1], dz = pz - sources[i + 2];
    const d = Math.max(Math.hypot(dx, dy, dz), 0.3);
    const a = sources[i + 3] / d, ph = sources[i + 4] - k * d;
    re += a * Math.cos(ph); im += a * Math.sin(ph);
    if (i === 0) dre = a;
  }
  const total = Math.hypot(re, im);
  const db = 20 * Math.log10(Math.max(total, 1e-12) / Math.max(dre, 1e-12));
  return db < floorDb ? floorDb : db > 12 ? 12 : db;
}

/** Map a relative field level (dB) to a cell opacity: nulls are clear, constructive peaks are dark. */
export function fieldAlpha(relDb, floorDb = -25, maxAlpha = 0.65) {
  const k = (relDb - floorDb) / (6 - floorDb);
  return (k <= 0 ? 0 : k >= 1 ? 1 : k) * maxAlpha;
}
