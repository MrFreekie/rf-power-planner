// Point-to-point link geometry: earth curvature, Fresnel clearance, single knife edge (group h). Pure functions, no DOM.
//
//   link.p2p = { kFactor?: number (default 4/3), obstacle?: { distanceM, heightM }, groundReflection?: boolean, fadeMarginDb?: number }
// A link of kind 'p2p' is a fixed point-to-point audio link over distances of tens of metres to many kilometres. Heights are above a
// common flat datum (the ground at both ends, pos.z plus the platform or deck height). Propagation is free space (direct ray) plus one
// diffraction term; the flat-earth two-ray ground reflection is OFF unless link.p2p.groundReflection is true (it is only valid for short paths).
//
// Formulas (all approximate, documented):
//  * Earth bulge at distance x from one end of a path of length d (effective earth radius K R, ITU-R P.834 K = 4/3 standard atmosphere,
//    R = 6371 km):                    h_b(x) = x (d - x) / (2 K R)
//  * First Fresnel zone radius (Fresnel zone):   F1(x) = sqrt(lambda x (d - x) / d)
//  * Clearance above the earth-curved surface at x: c(x) = h_los(x) - h_b(x), h_los = straight line between the antenna heights.
//    Rule of thumb: keep c(x) >= 0.6 F1(x) (60 percent clearance rule) for free-space loss.
//  * Single knife edge (ITU-R P.526 approximation): v = h sqrt(2 d / (lambda x (d - x))), h = height of the edge ABOVE the line of
//    sight (positive when it blocks), J(v) = 6.9 + 20 log10( sqrt((v - 0.1)^2 + 1) + v - 0.1 ) dB for v > -0.78, else 0. The loss is
//    applied for the worst of: the earth bulge (as an edge at the point of smallest clearance) or the user obstacle, ONE edge only
//    (multiple edges, terrain profile, rain and ducting are not modelled).
//  * Radio horizon: d = sqrt(2 K R h1) + sqrt(2 K R h2).
//  * Suggested fade margin: ASSUMED 10 dB (flag U) up to 10 km, plus 10 log10(d / 10 km) beyond; UHF is mostly clear-air multipath, rain matters above about 10 GHz.

export const EARTH_RADIUS_M = 6371000;
export const K_STANDARD = 4 / 3;
export const CLEARANCE_FRACTION = 0.6;

const C = 299792458;
export const earthBulgeM = (x, d, K = K_STANDARD) => (x * (d - x)) / (2 * K * EARTH_RADIUS_M);
export const fresnelRadiusM = (x, d, freqMHz) => Math.sqrt(((C / (freqMHz * 1e6)) * Math.max(x, 0) * Math.max(d - x, 0)) / Math.max(d, 1e-9));
export const radioHorizonM = (h1, h2, K = K_STANDARD) => Math.sqrt(2 * K * EARTH_RADIUS_M * Math.max(h1, 0)) + Math.sqrt(2 * K * EARTH_RADIUS_M * Math.max(h2, 0));

/** Knife-edge diffraction loss (dB) for the Fresnel-Kirchhoff parameter v (ITU-R P.526 approximation), 0 for v <= -0.78. */
export function knifeEdgeLossDb(v) {
  if (!(v > -0.78)) return 0;
  return 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) * (v - 0.1) + 1) + v - 0.1);
}
export const knifeEdgeV = (hAboveLosM, x, d, freqMHz) => hAboveLosM * Math.sqrt((2 * d) / ((C / (freqMHz * 1e6)) * Math.max(x * (d - x), 1e-9)));

/** Suggested fade margin (dB) for a path of d metres. ASSUMED. */
export const suggestedFadeMarginDb = (dM) => 10 + (dM > 10000 ? 10 * Math.log10(dM / 10000) : 0);

/**
 * requiredAntennaHeightM(dM, freqMHz, { K, fraction = 0.6 }) -> the height (m) of both antennas (equal) that gives `fraction` of the first
 * Fresnel zone clear at the midpoint over the curved earth: h = h_b(d/2) + fraction F1(d/2).
 */
export function requiredAntennaHeightM(dM, freqMHz, { K = K_STANDARD, fraction = CLEARANCE_FRACTION } = {}) {
  return earthBulgeM(dM / 2, dM, K) + fraction * fresnelRadiusM(dM / 2, dM, freqMHz);
}

/**
 * p2pGeometry({ dM, htM, hrM, freqMHz, K, obstacle }) -> {
 *   dM, K, bulgeMidM, f1MidM, clearanceMidM, clearanceFractionMid (clearance / F1 at the midpoint),
 *   minClearanceFraction, worstXM (point of smallest clearance / F1), horizonM, beyondHorizon,
 *   edge: 'none' | 'earth' | 'obstacle', edgeXM, edgeHeightAboveLosM, v, diffractionLossDb, meetsSixtyPercent }
 * dM is the horizontal distance; obstacle = { distanceM from the transmitter, heightM above the datum } or null.
 */
export function p2pGeometry({ dM, htM, hrM, freqMHz, K = K_STANDARD, obstacle = null }) {
  const d = Math.max(dM, 1e-6);
  const los = (x) => htM + ((hrM - htM) * x) / d;
  const N = 200;
  let minFrac = Infinity, worstX = d / 2, earthEdge = { v: -Infinity, x: d / 2, h: 0 };
  for (let i = 1; i < N; i++) {
    const x = (d * i) / N;
    const c = los(x) - earthBulgeM(x, d, K);
    const f1 = Math.max(fresnelRadiusM(x, d, freqMHz), 1e-9);
    if (c / f1 < minFrac) { minFrac = c / f1; worstX = x; }
    const v = knifeEdgeV(-c, x, d, freqMHz); // edge height above the line of sight = -clearance
    if (v > earthEdge.v) earthEdge = { v, x, h: -c };
  }
  let edge = { kind: 'earth', ...earthEdge };
  if (obstacle && Number.isFinite(obstacle.distanceM) && Number.isFinite(obstacle.heightM) && obstacle.distanceM > 0 && obstacle.distanceM < d) {
    const x = obstacle.distanceM;
    const h = obstacle.heightM - (los(x) - earthBulgeM(x, d, K)); // obstacle height above the line of sight, measured on the curved-earth reference
    const v = knifeEdgeV(h, x, d, freqMHz);
    const cFrac = (los(x) - earthBulgeM(x, d, K) - obstacle.heightM) / Math.max(fresnelRadiusM(x, d, freqMHz), 1e-9);
    if (cFrac < minFrac) { minFrac = cFrac; worstX = x; }
    if (v > edge.v) edge = { kind: 'obstacle', v, x, h };
  }
  const loss = knifeEdgeLossDb(edge.v);
  const mid = d / 2;
  const horizon = radioHorizonM(htM, hrM, K);
  return {
    dM: d, K, bulgeMidM: earthBulgeM(mid, d, K), f1MidM: fresnelRadiusM(mid, d, freqMHz),
    clearanceMidM: los(mid) - earthBulgeM(mid, d, K), clearanceFractionMid: (los(mid) - earthBulgeM(mid, d, K)) / Math.max(fresnelRadiusM(mid, d, freqMHz), 1e-9),
    minClearanceFraction: minFrac, worstXM: worstX, horizonM: horizon, beyondHorizon: d > horizon,
    edge: loss > 0.05 || edge.kind === 'obstacle' && edge.v > -0.78 ? edge.kind : 'none', edgeXM: edge.x, edgeHeightAboveLosM: edge.h, v: edge.v,
    diffractionLossDb: loss, meetsSixtyPercent: minFrac >= CLEARANCE_FRACTION,
  };
}
