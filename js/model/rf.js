// RF propagation model: Friis free space, Fresnel reflection, image-method multipath,
// coherent complex summation, cable/chain loss and link-budget waterfall.
// Pure functions, no DOM. Units: metres, MHz, dBm, dB, degrees (see docs/CONTRACT.md).
//
// Resolved contract ambiguities (design notes):
//  * reflectorCoefficient(..., incidenceDeg, ...) takes the angle from the wall NORMAL
//    (0 = normal incidence). floorReflection takes the GRAZING angle from the floor plane.
//  * `polarisation` is the polarisation of the radio wave relative to the ground. On the
//    floor, vertical = TM (parallel) Fresnel, horizontal = TE (perpendicular). On a vertical
//    wall the roles swap: vertical E is perpendicular to the plane of incidence (TE).
//  * Pattern arrays are indexed by degrees offset from boresight: arr[i] is the relative
//    gain (dB, 0 at boresight) at offset i-180, i = 0..360. azDb is the horizontal cut in
//    the antenna frame, elDb the vertical cut. Full pattern = azDb(az') + elDb(el') where
//    (az', el') is the bearing expressed in the antenna's own frame.
//  * Path.gainDb is the full end-to-end path gain (negative number): spreading loss +
//    antenna gains + reflection losses. pathLossDb is the effective path loss WITHOUT
//    antenna gains: fsplDb minus the coherent multipath effect relative to the direct ray.
//  * arrivalBearing = direction from the Rx antenna toward the last point on the path.
//  * Body loss applied = environment.bodyLossDb + rx.bodyLossDb, replaced by the antenna contact option on body antennas (bodyCouplingLossDb).

import { CABLES, ANTENNAS, GROUND_PLANE_GAIN_DBI, ANTENNA_POLARISATIONS, ANTENNA_CONTACT_LOSS_DB, ANTENNA_DAMPNESS_LOSS_DB, ANTENNA_CONTACT_LABELS, ANTENNA_DAMPNESS_LABELS, SURFACES, MATERIALS, cableDbPer100m as libraryCableDbPer100m, surfaceAt, materialAt } from './library.js';
import { formatLength } from './units.js';
import { chainCompression, stageOp1dBDbm } from './compression.js';
import { p2pGeometry, suggestedFadeMarginDb, K_STANDARD } from './p2p.js';
export { p2pGeometry, earthBulgeM, fresnelRadiusM, knifeEdgeLossDb, requiredAntennaHeightM, radioHorizonM, suggestedFadeMarginDb } from './p2p.js';
import { rofEffective, rofChainWarnings, rofBranchDelays } from './rof.js';
import { wallNoiseAt, wallConstruction } from './ledwall.js';
import { noiseSourcesAt, mutedReflectorIds, floorRiseDb } from './noise-sources.js';
export { wallNoiseAt, wallFieldDbuvm, WALL_NOISE_PRESETS, WALL_CONSTRUCTIONS, wallConstruction, meshShieldingDb } from './ledwall.js';
export { rofEffective, rofOpticalLossDb, rofIip3FromSfdr, rofBranchDelays } from './rof.js';
import { audiencePathLoss } from './audience.js';
import { crowdPathLoss, CROWD_CAVEAT } from './crowd.js';
import { CEILING_MATERIALS, overheadPlanes, overheadZoneFraction } from './ceiling.js';
import { antennaMatch, vswrThroughLoss, BAND_VSWR_WARN, BAND_VSWR_STRONG } from './antenna-band.js';
export { antennaMatch, mismatchLossDb, returnLossSweep, ANTENNA_BANDS, resolveDesignBand } from './antenna-band.js';
import { ACTIVE_CHAIN_KINDS, couplerThroughLossDb, chainDcWarnings, CHAIN_PRESETS } from './chain-presets.js';
import { hasFloorFeatures, floorHeightAt, floorSurfaceAt, absolutePos, allReflectors, chordsThrough, floorZoneFraction } from './floor.js';
import { RX_PRESETS, RX_DEFAULTS, externalNoiseFigureDb, INTERFERENCE_RISE_DB, INTERFERENCE_LEVELS, isInterferenceBand, interferenceBandOf, cascadeIip3Dbm as stagesIip3Dbm } from './rx-params.js';

let ZP = {};
try { ZP = await import('./zones-params.js'); } catch { ZP = {}; }

const C = 299792458; // m/s
const DEG = Math.PI / 180;
// Pattern floor policy: ANALYTIC patterns (dipole null, cardioid rear) are floored at -30 dB because a real antenna on a real stage
// scatters energy into nulls; directional types (paddle, helical, log-periodic) use their front-to-back figure (-25, -20, -25 dB,
// approx). TABLE patterns (library.js antennaPatternDb and custom azDb/elDb) are floored at -40 dB, the deepest value stored in any
// table. A non-finite bearing is treated as boresight (gain = gainDbi) so one bad input cannot turn a whole sweep into NaN.
const PATTERN_FLOOR_DB = -30;

// ---------------------------------------------------------------- geometry basics

export function distance3D(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y, (b.z || 0) - (a.z || 0));
}

/** Wavelength in metres: lambda = c / f. */
export function wavelengthM(freqMHz) {
  return C / (freqMHz * 1e6);
}

/** Friis free-space path loss, positive dB: FSPL = 20 log10(4 pi d / lambda). */
export const NEAR_FIELD_M = 0.1;
export function fsplDb(distanceM, freqMHz) {
  const d = Math.max(distanceM, NEAR_FIELD_M); // near-field clamp: FSPL stays positive
  return 20 * Math.log10((4 * Math.PI * d) / wavelengthM(freqMHz));
}

/** Bearing of vector (dx,dy,dz): az 0=+y, +90=+x (clockwise from above); el 0=horizontal. */
function bearingOf(dx, dy, dz) {
  return { az: Math.atan2(dx, dy) / DEG, el: Math.atan2(dz, Math.hypot(dx, dy)) / DEG };
}

function unitVec(b) {
  const a = b.az * DEG, e = b.el * DEG;
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
}

const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];

// ---------------------------------------------------------------- antennas

function readPattern(arr, deg) {
  // arr has 361 samples for offsets -180..180 degrees; linear interpolation.
  let x = deg;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  const p = x + 180;
  const i0 = Math.min(Math.floor(p), arr.length - 2);
  const f = p - i0;
  return arr[i0] * (1 - f) + arr[i0 + 1] * f;
}

const clampDb = (lin) => Math.max(20 * Math.log10(Math.max(lin, 1e-9)), PATTERN_FLOOR_DB);

// Analytic patterns. f = cos of angle from boresight, uu = component along antenna "up" axis.
function analyticRelDb(name, f, uu) {
  const psi = Math.acos(Math.max(-1, Math.min(1, f))) / DEG; // angle off boresight
  switch (name) {
    case 'dipole': {
      // Half-wave dipole with its axis along the antenna up-vector:
      // E(theta) = cos(pi/2 cos theta) / sin theta, theta measured from the axis.
      const s = Math.sqrt(Math.max(1 - uu * uu, 0));
      if (s < 1e-6) return PATTERN_FLOOR_DB;
      return clampDb(Math.abs(Math.cos((Math.PI / 2) * uu) / s));
    }
    case 'cardioid':
      return clampDb((1 + f) / 2);
    case 'paddle':
    case 'helical':
    case 'logperiodic': {
      const hpbw = name === 'paddle' ? 70 : name === 'helical' ? 60 : 65;
      const rel = -3 * Math.pow(psi / (hpbw / 2), 2); // parabolic main lobe, -3 dB at half HPBW
      return Math.max(rel, name === 'helical' ? -20 : -25);
    }
    case 'omni':
    case 'body':
    default:
      return 0;
  }
}

/**
 * Gain in dBi toward `bearing` (direction from antenna to the other end).
 * = gainDbi + relative pattern, evaluated in the antenna's own frame.
 */
/**
 * Nominal gain (dBi) of an antenna reference: gainDbi, or the library value; for a quarter-wave whip with a `groundPlane` choice
 * ('none' | 'body' | 'rack' | 'large') the ground-plane table GROUND_PLANE_GAIN_DBI (approx -1 / 1 / 3 / 5 dBi) replaces gainDbi.
 */
export function nominalGainDbi(antennaRef) {
  const a = antennaRef || {};
  if (a.type === 'quarterwave' && typeof a.groundPlane === 'string' && Object.prototype.hasOwnProperty.call(GROUND_PLANE_GAIN_DBI, a.groundPlane)) return GROUND_PLANE_GAIN_DBI[a.groundPlane];
  return a.gainDbi ?? (ANTENNAS[a.type] || {}).gainDbi ?? 0;
}

/**
 * Orthonormal antenna frame { b: boresight, r: right, u: up } in world axes (x east, y north, z up). Starts from orientation
 * {az, el}; then tiltDeg (pitch about the right axis r, positive = nose up, added on top of orientation.el) and rollDeg (rotation
 * about the boresight, positive = top tips toward r). Both default to 0; with both 0 this is exactly the orientation frame.
 * Rodrigues rotation: v' = v cos t + (k x v) sin t + k (k.v)(1 - cos t).
 */
export function antennaFrame(antennaRef) {
  const orient = (antennaRef && antennaRef.orientation) || { az: 0, el: 0 };
  let b = unitVec(orient);
  let r = [Math.cos(orient.az * DEG), -Math.sin(orient.az * DEG), 0];
  let u = [
    r[1] * b[2] - r[2] * b[1],
    r[2] * b[0] - r[0] * b[2],
    r[0] * b[1] - r[1] * b[0],
  ];
  const tilt = antennaRef && Number.isFinite(antennaRef.tiltDeg) ? antennaRef.tiltDeg : 0;
  const roll = antennaRef && Number.isFinite(antennaRef.rollDeg) ? antennaRef.rollDeg : 0;
  if (tilt !== 0) {
    const c = Math.cos(tilt * DEG), sn = Math.sin(tilt * DEG);
    const nb = [0, 1, 2].map((i) => b[i] * c + u[i] * sn);
    const nu = [0, 1, 2].map((i) => u[i] * c - b[i] * sn);
    b = nb; u = nu;
  }
  if (roll !== 0) {
    const c = Math.cos(roll * DEG), sn = Math.sin(roll * DEG);
    const nr = [0, 1, 2].map((i) => r[i] * c - u[i] * sn);
    const nu = [0, 1, 2].map((i) => u[i] * c + r[i] * sn);
    r = nr; u = nu;
  }
  return { b, r, u };
}

export function antennaGainDb(antennaRef, bearing) {
  if (!bearing || !Number.isFinite(bearing.az) || !Number.isFinite(bearing.el)) return nominalGainDbi(antennaRef);
  const lib = ANTENNAS[antennaRef.type] || {};
  const gain = nominalGainDbi(antennaRef);
  const { b, r, u } = antennaFrame(antennaRef);
  const v = unitVec(bearing);
  const f = dot(v, b), rr = dot(v, r), uu = dot(v, u);
  const pat = antennaRef.patternOverride ?? lib.pattern;
  let rel;
  if (pat && typeof pat === 'object' && Array.isArray(pat.azDb)) {
    const azP = Math.atan2(rr, f) / DEG;
    const elP = Math.atan2(uu, Math.hypot(f, rr)) / DEG;
    rel = readPattern(pat.azDb, azP) + (Array.isArray(pat.elDb) ? readPattern(pat.elDb, elP) : 0);
    rel = Math.max(-40, Math.min(0, rel)); // matches antennaPatternDb in library.js
  } else {
    const name = typeof pat === 'string' ? pat : antennaRef.type;
    rel = analyticRelDb(name, f, uu);
  }
  return gain + rel;
}

// ---------------------------------------------------------------- Fresnel reflection

// Complex helpers as [re, im]
const cadd = (a, b) => [a[0] + b[0], a[1] + b[1]];
const csub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
function cdiv(a, b) {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
}
function csqrt(a) {
  const m = Math.hypot(a[0], a[1]);
  const re = Math.sqrt(Math.max((m + a[0]) / 2, 0));
  let im = Math.sqrt(Math.max((m - a[0]) / 2, 0));
  if (a[1] < 0) im = -im;
  return [re, im];
}

/**
 * Fresnel plane-wave reflection coefficient for a lossy dielectric.
 * Complex permittivity (e^{+jwt} convention): eps_c = eps_r - j 60 sigma lambda.
 * psi = grazing angle. TM (parallel/vertical pol on a floor):
 *   G = (eps_c sin psi - sqrt(eps_c - cos^2 psi)) / (eps_c sin psi + sqrt(eps_c - cos^2 psi))
 * TE (perpendicular/horizontal pol on a floor):
 *   G = (sin psi - sqrt(eps_c - cos^2 psi)) / (sin psi + sqrt(eps_c - cos^2 psi))
 * Both tend to -1 as psi -> 0 (grazing).
 */
function fresnel(epsR, sigma, grazingDeg, freqMHz, mode) {
  const psi = Math.min(Math.max(grazingDeg, 1e-4), 90) * DEG;
  const lambda = wavelengthM(freqMHz);
  const epsC = [epsR, -60 * sigma * lambda];
  const s = Math.sin(psi), c2 = Math.cos(psi) ** 2;
  const root = csqrt(csub(epsC, [c2, 0]));
  const num = mode === 'TM' ? csub(cmul(epsC, [s, 0]), root) : csub([s, 0], root);
  const den = mode === 'TM' ? cadd(cmul(epsC, [s, 0]), root) : cadd([s, 0], root);
  const g = cdiv(num, den);
  return { re: g[0], im: g[1] };
}

/**
 * Reflection coefficient for the transmit polarisation. Vertical (E in the plane of incidence on a floor) = TM and horizontal = TE
 * on a floor or ceiling (swapped on a vertical wall). Slant 45 and circular (rhcp, lhcp) are projected onto the linear components:
 * the co-polar (handedness-flipped, for circular) reflection is the average (Gamma_TE + Gamma_TM) / 2; the cross term
 * (Gamma_TE - Gamma_TM) / 2, largest near the Brewster angle, is ignored (approximate).
 */
function fresnelPol(m, grazingDeg, freqMHz, pol, wall) {
  const te = () => fresnel(m.epsR, m.sigma, grazingDeg, freqMHz, 'TE'), tm = () => fresnel(m.epsR, m.sigma, grazingDeg, freqMHz, 'TM');
  if (pol === 'horizontal') return wall ? tm() : te();
  if (pol === 'vertical' || pol === undefined || pol === null) return wall ? te() : tm();
  const a = te(), b = tm();
  return { re: (a.re + b.re) / 2, im: (a.im + b.im) / 2 };
}

// Optional library field absorbDb: extra loss per reflection (porous/absorbing finishes).
function absorb(g, m) {
  if (!m.absorbDb) return g;
  const k = Math.pow(10, -m.absorbDb / 20);
  return { re: g.re * k, im: g.im * k };
}

const FALLBACK = { epsR: 5, sigma: 0.01 }; // concrete-like, used for unknown ids

/** Floor reflection coefficient. grazingDeg measured from the floor plane. */
export function floorReflection(floorId, polarisation, grazingDeg, freqMHz) {
  const m = SURFACES[floorId] ? surfaceAt(floorId, freqMHz) : FALLBACK; // conductivity scaled with frequency (ITU-R P.2040)
  return absorb(fresnelPol(m, grazingDeg, freqMHz, polarisation, false), m);
}

/** Ceiling / overhead panel reflection coefficient (horizontal plane, like the floor: TE for horizontal, TM for vertical polarisation). grazingDeg from the plane. */
export function overheadReflection(materialId, polarisation, grazingDeg, freqMHz) {
  const m = CEILING_MATERIALS[materialId] || FALLBACK;
  return absorb(fresnelPol(m, grazingDeg, freqMHz, polarisation, false), m);
}

/** Wall reflection coefficient. incidenceDeg measured from the wall normal. */
export function reflectorCoefficient(materialId, incidenceDeg, polarisation, freqMHz) {
  const m = MATERIALS[materialId] ? materialAt(materialId, freqMHz) : FALLBACK;
  // Vertical E on a vertical wall is perpendicular to the plane of incidence -> TE.
  return absorb(fresnelPol(m, 90 - incidenceDeg, freqMHz, polarisation, true), m);
}

// ---------------------------------------------------------------- image-method path tracing

function wallFrame(w) {
  const dx = w.p2.x - w.p1.x, dy = w.p2.y - w.p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  return { tx: dx / len, ty: dy / len, nx: -dy / len, ny: dx / len, len };
}

const wallDist = (w, fr, P) => (P.x - w.p1.x) * fr.nx + (P.y - w.p1.y) * fr.ny;

function mirror(plane, P) {
  if (plane.type === 'floor' || plane.type === 'overhead') return { x: P.x, y: P.y, z: 2 * (plane.h || 0) - P.z };
  const d = wallDist(plane.w, plane.fr, P);
  return { x: P.x - 2 * d * plane.fr.nx, y: P.y - 2 * d * plane.fr.ny, z: P.z };
}

// Intersect segment A->B with a plane; returns hit point or null (must cross strictly inside,
// and within the wall's length and zMin..zMax for walls).
function hitPlane(plane, A, B) {
  let fa, fb;
  if (plane.type === 'floor' || plane.type === 'overhead') { fa = A.z - (plane.h || 0); fb = B.z - (plane.h || 0); }
  else { fa = wallDist(plane.w, plane.fr, A); fb = wallDist(plane.w, plane.fr, B); }
  if (!(fa * fb < 0)) return null;
  const t = fa / (fa - fb);
  const H = { x: A.x + t * (B.x - A.x), y: A.y + t * (B.y - A.y), z: A.z + t * (B.z - A.z) };
  if (plane.type === 'floor' || plane.type === 'overhead') { H.z = plane.h || 0; return H; }
  const s = (H.x - plane.w.p1.x) * plane.fr.tx + (H.y - plane.w.p1.y) * plane.fr.ty;
  if (s < 0 || s > plane.fr.len) return null;
  if (H.z < plane.w.zMin || H.z > plane.w.zMax) return null;
  return H;
}

// Image method for an ordered list of reflecting planes. Returns points[] or null.
function unfold(planes, tx, rx) {
  const imgs = [tx];
  for (const p of planes) imgs.push(mirror(p, imgs[imgs.length - 1]));
  const hits = new Array(planes.length);
  let target = rx;
  for (let k = planes.length - 1; k >= 0; k--) {
    const H = hitPlane(planes[k], imgs[k + 1], target);
    if (!H) return null;
    hits[k] = H;
    target = H;
  }
  return [tx, ...hits, rx];
}

function buildPath(kind, via, planes, points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += distance3D(points[i - 1], points[i]);
  const p0 = points[0], p1 = points[1];
  const pn = points[points.length - 1], pm = points[points.length - 2];
  return {
    kind,
    ...(via ? { via } : {}),
    points,
    lengthM: len,
    delayNs: (len / C) * 1e9,
    departureBearing: bearingOf(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z),
    arrivalBearing: bearingOf(pm.x - pn.x, pm.y - pn.y, pm.z - pn.z),
    reflections: planes.map((p, i) => ({ type: p.type, via: p.w ? p.w.id : p.type === 'overhead' ? p.id : undefined, point: points[i + 1] })),
  };
}

/**
 * Direct, floor, each valid single-wall bounce and floor+wall (either order) paths.
 * With environment.model === 'free-space' only the direct path is returned.
 */
// Attach the Fresnel-zone fraction (only when below 1) so solveLink can scale the path amplitude.
function withFraction(path, r) {
  if (r.fraction !== undefined && r.fraction < 1 - 1e-12) path.floorFraction = r.fraction;
  return path;
}

export function tracePaths(scene, link) {
  // Positions are heights above the LOCAL floor (deck / platform); path points are absolute (above ground).
  const tx = absolutePos(scene, link.tx.pos), rx = absolutePos(scene, link.rx.pos);
  const paths = [buildPath('direct', null, [], [tx, rx])];
  if (scene.environment && scene.environment.model === 'free-space') return paths;

  // Floor reflection with a locally varying floor. Candidate plane heights come from up to 3 passes: start at the floor height
  // under the Tx/Rx midpoint, unfold, look up the floor height at the specular point, repeat. Near a deck edge the passes can
  // alternate between two planes, so EVERY visited plane gives a candidate path, each weighted by the fraction of its first
  // Fresnel zone that really lies on that plane (floorZoneFraction): a reflection from a deck that is not under the specular
  // point is dropped or weak, the weights vary smoothly with position (no multi-dB jump at the edge) and both planes
  // contribute near the boundary. A flat floor gives the single plane h = 0 with weight 1 and exactly the classic image formula.
  const hasFloor = hasFloorFeatures(scene);
  const floorCandidates = (seq) => {
    const fi = seq.indexOf('floor');
    const seen = [];
    const out = [];
    let h = floorHeightAt(scene, (tx.x + rx.x) / 2, (tx.y + rx.y) / 2);
    for (let it = 0; it < 3; it++) {
      if (seen.some((x) => Math.abs(x - h) < 1e-9)) break;
      seen.push(h);
      const planes = seq.map((q) => (q === 'floor' ? { type: 'floor', h } : q));
      const pts = unfold(planes, tx, rx);
      if (!pts) break;
      const H = pts[fi + 1];
      const cand = { pts, planes, h };
      if (hasFloor) {
        cand.fraction = floorZoneFraction(scene, tx, rx, H, h, link.freqMHz || 600);
        if (cand.fraction >= 1e-3) out.push(cand);
      } else out.push(cand);
      const hn = floorHeightAt(scene, H.x, H.y);
      if (Math.abs(hn - h) < 1e-9) break;
      h = hn;
    }
    return out;
  };
  for (const c of floorCandidates(['floor'])) paths.push(withFraction(buildPath('floor', null, c.planes, c.pts), c));
  for (const w of allReflectors(scene)) {
    const fr = wallFrame(w);
    if (!fr) continue;
    const wall = { type: 'wall', w, fr };
    const pts = unfold([wall], tx, rx);
    if (pts) paths.push(buildPath('wall', w.id, [wall], pts));
    if (tx.z < 0 || rx.z < 0) continue;
    for (const seq of [[wall, 'floor'], ['floor', wall]]) {
      for (const c of floorCandidates(seq)) paths.push(withFraction(buildPath('floor-wall', w.id, c.planes, c.pts), c));
    }
  }
  // Ceiling and overhead panels (opt-in, group f): single bounce each, plus floor+ceiling in both orders for the ceiling. Only when both
  // antennas are below the plane. Rectangles (panels, a ceiling extent) weight the amplitude by the Fresnel-zone fraction on the rectangle.
  const freq = link.freqMHz || 600;
  for (const op of overheadPlanes(scene)) {
    if (!(tx.z < op.h && rx.z < op.h)) continue;
    const plane = { type: 'overhead', h: op.h, id: op.id, rect: op.rect, lossDb: op.lossDb, material: op.material };
    const pts1 = unfold([plane], tx, rx);
    if (pts1) {
      const f1 = overheadZoneFraction(op, tx, rx, pts1[1], freq);
      if (f1 >= 1e-3) paths.push(withFraction(buildPath(op.ceiling ? 'ceiling' : 'panel', op.id, [plane], pts1), { fraction: f1 }));
    }
    if (op.ceiling) {
      for (const seq of [[plane, 'floor'], ['floor', plane]]) {
        for (const c of floorCandidates(seq)) {
          const hi = c.planes.indexOf(plane) + 1;
          const f2 = op.rect ? overheadZoneFraction(op, tx, rx, c.pts[hi], freq) : 1;
          const fl = (c.fraction === undefined ? 1 : c.fraction) * f2;
          if (fl >= 1e-3) paths.push(withFraction(buildPath('floor-ceiling', op.id, c.planes, c.pts), { fraction: fl }));
        }
      }
    }
  }
  return paths;
}

// ---------------------------------------------------------------- wall transmission

// Fallback transmission loss through a wall, used when zones-params.js does not supply a value.
// L(f) = L600 * (f / 600)^exponent. Approximate.
// Safety net only; kept equal to zones-params.js (dB at the reference thickness, 600 MHz, and frequency exponent).
const TRANSMISSION_FALLBACK = {
  drywall: [3, 0.4], brick: [5, 0.7], concrete: [8, 0.6], glass: [2, 0.3], wood: [2.5, 0.4],
  drapes: [3, 0.3], metal: [60, 0], grass: [10, 0.5],
};

/** Loss (dB, >= 0) for a signal passing through reflector `w` at freqMHz. w.transmissionLossDb overrides the table. */
export function wallTransmissionLossDb(w, freqMHz) {
  return wallTransmissionInfo(w, freqMHz).lossDb;
}

/**
 * wallTransmissionInfo(w, freqMHz) -> { lossDb, refThicknessM, thicknessM, thicknessFactor, source }
 * The table loss is for the material's reference thickness (refThicknessM in zones-params.js, for example 0.1 m for brick) and
 * scales linearly in dB with thickness: reflector.thicknessFactor (1 = reference) or thicknessM / refThicknessM. An explicit
 * reflector.transmissionLossDb overrides everything (source 'override'). thicknessM reports the thickness used (null when
 * the material has no reference thickness).
 */
export function wallTransmissionInfo(w, freqMHz) {
  const tbl0 = ZP.MATERIAL_TRANSMISSION || ZP.TRANSMISSION_LOSS_DB;
  const e0 = tbl0 && tbl0[w.material];
  const refThicknessM = e0 && typeof e0 === 'object' && Number.isFinite(e0.refThicknessM) ? e0.refThicknessM : null;
  const lossDb = wallTransmissionLossRaw(w, freqMHz);
  if (Number.isFinite(w.transmissionLossDb)) {
    return { lossDb, refThicknessM, thicknessM: Number.isFinite(w.thicknessM) ? w.thicknessM : refThicknessM, thicknessFactor: 1, source: 'override' };
  }
  const factor = Number.isFinite(w.thicknessFactor) ? Math.max(0, w.thicknessFactor)
    : Number.isFinite(w.thicknessM) && refThicknessM ? Math.max(0, w.thicknessM / refThicknessM) : 1;
  return { lossDb, refThicknessM, thicknessM: refThicknessM === null ? null : refThicknessM * factor, thicknessFactor: factor, source: 'table' };
}

function wallTransmissionLossRaw(w, freqMHz) {
  if (Number.isFinite(w.transmissionLossDb)) return Math.max(0, w.transmissionLossDb);
  const wc = wallConstruction(w, freqMHz);
  if (wc) return wc.transmissionLossDb; // video wall construction (ledwall.js, assumed figures)
  const tbl = ZP.MATERIAL_TRANSMISSION || ZP.TRANSMISSION_LOSS_DB;
  const e = tbl && tbl[w.material];
  // Thickness hook: reflector.thicknessFactor scales the table loss directly (1 = reference thickness); otherwise
  // reflector.thicknessM / refThicknessM when the table has a reference thickness. Loss is linear in thickness (dB).
  const thick = (ref) => (Number.isFinite(w.thicknessFactor) ? Math.max(0, w.thicknessFactor)
    : Number.isFinite(w.thicknessM) && ref > 0 ? Math.max(0, w.thicknessM / ref) : 1);
  if (typeof e === 'number') return e * Math.sqrt(freqMHz / 600) * thick(0);
  if (e && typeof e === 'object') {
    const ref = Number.isFinite(e.lossDb) ? e.lossDb : Number.isFinite(e.dbAtRef) ? e.dbAtRef : Number.isFinite(e.db) ? e.db : null;
    if (ref !== null) {
      const refMHz = e.refMHz || 600;
      const k = Number.isFinite(e.freqExponent) ? e.freqExponent : 0.5;
      const scale = ZP.wallFreqScale && refMHz === 600 ? ZP.wallFreqScale(w.material, freqMHz) : Math.pow(freqMHz / refMHz, k);
      return ref * scale * thick(e.refThicknessM);
    }
  }
  const fb = TRANSMISSION_FALLBACK[w.material] || [10, 0.5];
  return fb[0] * Math.pow(freqMHz / 600, fb[1]) * thick(0);
}

/**
 * Total transmission loss (dB) for a polyline: every leg that crosses a reflector segment within its length and
 * zMin..zMax adds that wall's loss once. Legs that merely touch the wall (reflection points) do not count.
 * Returns { lossDb, crossed: [reflectorId...], detail: [{ id, material, lossDb, refThicknessM, thicknessM, thicknessFactor, source }] }.
 */
export function pathWallLoss(scene, points, freqMHz) {
  let lossDb = 0;
  const crossed = [];
  const detail = [];
  const walls = allReflectors(scene);
  for (const w of walls) {
    const fr = wallFrame(w);
    if (!fr) continue;
    for (let i = 1; i < points.length; i++) {
      const A = points[i - 1], B = points[i];
      const fa = wallDist(w, fr, A), fb = wallDist(w, fr, B);
      if (!(fa * fb < 0) || Math.abs(fa) < 1e-7 || Math.abs(fb) < 1e-7) continue;
      const t = fa / (fa - fb);
      const hx = A.x + t * (B.x - A.x), hy = A.y + t * (B.y - A.y), hz = (A.z || 0) + t * ((B.z || 0) - (A.z || 0));
      const sPos = (hx - w.p1.x) * fr.tx + (hy - w.p1.y) * fr.ty;
      if (sPos < 0 || sPos > fr.len || hz < w.zMin || hz > w.zMax) continue;
      if (w.riser) continue; // a riser face's through-loss is the platform obstruction (chord loss below), not counted twice
      const info = wallTransmissionInfo(w, freqMHz);
      // optional calibration: environment.wallLossAdjustDb is added to every wall crossed (a walk-test fit), never taking one below 0 dB
      // optional environment.wallLossAdjustByMaterialDb = { material: dB }: a fitted figure for that wall material replaces the single figure for walls of that material
      const byMat = scene.environment && scene.environment.wallLossAdjustByMaterialDb;
      const own = byMat && typeof byMat === 'object' && Object.prototype.hasOwnProperty.call(byMat, w.material) ? byMat[w.material] : undefined;
      const adj = Number.isFinite(own) ? own : scene.environment && Number.isFinite(scene.environment.wallLossAdjustDb) ? scene.environment.wallLossAdjustDb : 0;
      if (adj) info.lossDb = Math.max(0, info.lossDb + adj);
      lossDb += info.lossDb;
      crossed.push(w.id);
      detail.push({ id: w.id, material: w.material, ...info });
    }
  }
  // Platform / deck obstruction: interface + dB per metre of chord inside each (merged) solid body, per leg.
  let platformLossDb = 0;
  const platforms = [];
  for (let i = 1; i < points.length; i++) {
    for (const c of chordsThrough(scene, points[i - 1], points[i], freqMHz)) {
      platformLossDb += c.lossDb;
      platforms.push({ ...c, leg: i - 1 });
    }
  }
  lossDb += platformLossDb;
  // Audience (crowd) absorption below head height, ASSUMED model (audience.js)
  const aud = audiencePathLoss(scene, points);
  lossDb += aud.lossDb;
  // Crowd zones (crowd.js): polygon absorption with a Fresnel clearance factor above head height, ASSUMED slope
  const crowd = crowdPathLoss(scene, points, freqMHz);
  lossDb += crowd.lossDb;
  return { lossDb, crossed, detail, platformLossDb, platforms, audienceLossDb: aud.lossDb, audienceChords: aud.chords, crowdLossDb: crowd.lossDb, crowdChords: crowd.chords, crowdDetail: crowd.crowds };
}

// ---------------------------------------------------------------- cables and chains

/** Cable loss (dB, positive) at freqMHz for lengthM: library table (100 MHz-6 GHz) log-log interpolated, sqrt(f) scaling outside it. */
export function cableLossDb(cableType, lengthM, freqMHz) {
  const cab = CABLES[cableType];
  if (!cab) throw new Error(`Unknown cable type: ${cableType}`);
  return (lengthM / 100) * libraryCableDbPer100m(cableType, freqMHz);
}

/** Net loss (positive dB) of one chain item; boosters return negative loss (gain). */
export function chainItemLossDb(item, freqMHz) {
  switch (item.kind) {
    case 'cable':
      if (item.freqLossOverrideDbPer100m != null) return (item.lengthM / 100) * item.freqLossOverrideDbPer100m;
      return cableLossDb(item.cableType, item.lengthM, freqMHz);
    case 'booster':
    case 'activesplitter':
    case 'activecombiner':
      return -item.gainDb; // noise figure (nfDb) not modelled in the power budget; active splitters/combiners: net distribution gain
    case 'coupler':
      return couplerThroughLossDb(item); // main-line loss of a directional coupler
    case 'rof':
      return -rofEffective(item).gainDb; // RF over fibre: back-to-back gain less 2 dB per optical dB (rof.js)
    case 'splitter':
    case 'combiner':
      return 10 * Math.log10(Math.max(item.ports || 1, 1)) + (item.insertionLossDb || 0);
    case 'filter':
      return (item.lossDb || 0) + filterStopbandExtraDb(item, freqMHz);
    default: // connector, attenuator
      return item.lossDb || 0;
  }
}

/**
 * Optional filter frequency selectivity: a filter with passLoMHz and passHiMHz adds rejectionDb (default 40, ASSUMED) outside the
 * passband (bandpass, the default type) or inside it (notch). Without those fields a filter is a flat lossDb, as before.
 */
export function filterStopbandExtraDb(item, freqMHz) {
  if (!(item && item.kind === 'filter' && item.passLoMHz > 0 && item.passHiMHz > item.passLoMHz)) return 0;
  const inside = freqMHz >= item.passLoMHz && freqMHz <= item.passHiMHz;
  const rej = Number.isFinite(item.rejectionDb) ? item.rejectionDb : 40;
  return (item.filterType === 'notch' ? inside : !inside) ? rej : 0;
}

/** Net chain loss in dB (negative = net gain). */
export function chainLossDb(chain, freqMHz) {
  return (chain || []).reduce((s, it) => s + chainItemLossDb(it, freqMHz), 0);
}

function chainLabel(item) {
  switch (item.kind) {
    case 'cable': return `Cable ${CABLES[item.cableType]?.name ?? item.cableType} ${item.lengthM} m`;
    case 'booster': return 'Booster';
    case 'activesplitter': return `Active splitter 1:${item.ports}`;
    case 'activecombiner': return `Active combiner ${item.ports}:1`;
    case 'coupler': return `Coupler ${item.couplingDb} dB`;
    case 'rof': return `RF over fibre ${Number.isFinite(item.fibreKm) ? item.fibreKm : 0} km`;
    case 'biastee': return 'Bias tee';
    case 'dcblock': return 'DC block';
    case 'splitter': return `Splitter 1:${item.ports}`;
    case 'combiner': return `Combiner ${item.ports}:1`;
    default: return item.kind[0].toUpperCase() + item.kind.slice(1);
  }
}

// ---------------------------------------------------------------- link solve

// ---------------------------------------------------------------- noise-figure cascade

/** Receiver noise figure, dB: rx.noiseFigureDb, rx.overload.noiseFigureDb, the rx preset (rx-params), else the default preset. */
export function receiverNoiseFigureDb(rx) {
  const preset = (rx && RX_PRESETS[rx.rxPreset]) || RX_DEFAULTS;
  const c = [rx && rx.noiseFigureDb, rx && rx.overload && rx.overload.noiseFigureDb, preset && preset.noiseFigureDb];
  return c.find(Number.isFinite) ?? 8;
}

/**
 * Noise figure and gain of one chain item at freqMHz: { gainDb, nfDb }.
 *  passive loss items (cable, filter, connector, attenuator): NF = loss, gain = -loss;
 *  splitter / combiner: NF = their loss (10 log10 N + insertion), gain = -loss;
 *  booster: gain = gainDb, NF = item.nfDb, or 3 dB when missing (a documented default for a low-noise preamp).
 */
export function chainItemNoise(item, freqMHz) {
  if (item.kind === 'rof') { const e = rofEffective(item); return { gainDb: e.gainDb, nfDb: e.nfDb }; }
  if (ACTIVE_CHAIN_KINDS.includes(item.kind)) return { gainDb: item.gainDb, nfDb: Number.isFinite(item.nfDb) ? item.nfDb : 3 };
  const loss = chainItemLossDb(item, freqMHz);
  return { gainDb: -loss, nfDb: Math.max(0, loss) };
}

const BOLTZMANN_DBM_HZ = -174; // kT at 290 K

/** External noise figure (dB above kT) at freqMHz from environment.externalNoise (name or dB at 600 MHz); 0 when unset. */
export function externalNoiseNfDb(env, freqMHz) {
  const v = env && env.externalNoise;
  if (typeof v === 'string') return externalNoiseFigureDb(v, freqMHz);
  const at600 = v;
  if (!Number.isFinite(at600) || at600 <= 0) return 0;
  return Math.max(0, at600 - 27.7 * Math.log10(freqMHz / 600));
}

/**
 * Interference floor rise (dB) from environment.interference ('none'|'quiet'|'typical'|'busy', unset = none). Only for
 * the licence-exempt 2.4 GHz (2400-2500) and 5.8 GHz (5725-5875) bands shared with Wi-Fi; 0 elsewhere (2.1 or 3.5 GHz included). It is a separate additive in-band noise
 * power: N_total = N_floor x 10^(rise/10), i.e. the floor moves up by `rise` dB (noise-plus-interference, treated as noise).
 */
export function interferenceRiseDb(env, freqMHz) {
  const v = env && env.interference;
  if (!isInterferenceBand(freqMHz) || typeof v !== 'string' || !INTERFERENCE_LEVELS.includes(v)) return 0;
  return INTERFERENCE_RISE_DB[interferenceBandOf(freqMHz)][v];
}

/**
 * cascadeChainIip3Dbm(chain, rxIip3Dbm, freqMHz) -> IIP3 of "chain then receiver" referred to the chain input (the antenna
 * terminals for a receive chain), dBm. One implementation shared by imd.js and overload.js: builds the stages and calls
 * cascadeIip3Dbm of rx-params.js (1/IIP3 = sum G_before_k / IIP3_k). Boosters use item.iip3Dbm, else item.oip3Dbm - gain,
 * else 20 dBm OIP3 - gain; passive items have no nonlinearity (infinite IIP3) and only add their gain.
 */
export function cascadeChainIip3Dbm(chain, rxIip3Dbm, freqMHz = 600) {
  const stages = [];
  for (const it of chain || []) {
    const { gainDb } = chainItemNoise(it, freqMHz);
    const iip3Dbm = it.kind === 'rof' ? rofEffective(it).iip3Dbm : ACTIVE_CHAIN_KINDS.includes(it.kind)
      ? (Number.isFinite(it.iip3Dbm) ? it.iip3Dbm : (Number.isFinite(it.oip3Dbm) ? it.oip3Dbm : 20) - (it.gainDb || 0))
      : Infinity;
    stages.push({ gainDb, iip3Dbm });
  }
  stages.push({ gainDb: 0, iip3Dbm: rxIip3Dbm });
  return stagesIip3Dbm(stages);
}

/**
 * cascadeNoise(link, chain, freqMHz, iem) -> { stages, systemNfDb, noiseFloorDbm, sensitivityAtAntennaDbm, marginAtAntennaDb,
 *   requiredSnrDb, kTBDbm, receiverNfDb, bandwidthKHz }
 * Friis: F_total = F1 + (F2 - 1)/G1 + (F3 - 1)/(G1 G2) + ...  stages in signal-flow order (mic: chain items then the receiver;
 * iem: the chain items only, information only). kTB uses rx.channelBwKHz (default 200 kHz).
 * requiredSnrDb source, in order: rx.requiredSnrDb (override); the receiver preset's requiredCnrDb, when the link names a preset
 * (rx.rxPreset) and its sensitivityDbm still equals the preset's (so raising the receiver NF really worsens the system
 * sensitivity, and a hand-edited sensitivity is not silently ignored); else sensitivityDbm - (kTB + receiver NF), which is what
 * the quoted sensitivity implies and gives exactly the old margin for a passive chain. requiredSource reports which one applied.
 * External noise (off by default): environment.externalNoise = 'quiet' | 'outdoor' | 'urban' | 'noisy-venue' or a number (noise
 * figure in dB above kT at 600 MHz, EXTERNAL_NOISE_FIGURE_600MHZ_DB) adds noise at the antenna, which falls with frequency
 * (man-made noise, about 27.7 dB per decade, ITU-R P.372); the antenna noise factor is F_sys + F_ext - 1.
 * noiseFloorDbm = kTB + 10 log10(F_sys + F_ext - 1) (kTB + system NF without external noise); sensitivityAtAntennaDbm =
 * noise floor + requiredSnr.
 */
export function cascadeNoise(link, chain, freqMHz, iem = false, env = {}) {
  const bw = Number.isFinite(link.rx.channelBwKHz) ? link.rx.channelBwKHz : ((RX_PRESETS[link.rx.rxPreset] || {}).channelBwKhz ?? 200); // the preset's noise bandwidth (200 kHz for the UHF presets)
  const kTB = BOLTZMANN_DBM_HZ + 10 * Math.log10(bw * 1000);
  const rxNf = receiverNoiseFigureDb(link.rx);
  const list = (chain || []).map((it) => ({ label: chainLabel(it), ...chainItemNoise(it, freqMHz) }));
  if (!iem) list.push({ label: 'Receiver', gainDb: 0, nfDb: rxNf });
  let fCum = 0, gCum = 1; // linear
  const stages = list.map((s, i) => {
    const F = Math.pow(10, s.nfDb / 10);
    fCum = i === 0 ? F : fCum + (F - 1) / gCum;
    gCum *= Math.pow(10, s.gainDb / 10);
    return { label: s.label, gainDb: s.gainDb, nfDb: s.nfDb, cumulativeNfDb: 10 * Math.log10(fCum), cumulativeGainDb: 10 * Math.log10(gCum) };
  });
  const systemNfDb = stages.length ? stages[stages.length - 1].cumulativeNfDb : 0;
  const preset = RX_PRESETS[link.rx.rxPreset];
  let required, requiredSource;
  if (Number.isFinite(link.rx.requiredSnrDb)) { required = link.rx.requiredSnrDb; requiredSource = 'override'; }
  else if (preset && Number.isFinite(preset.requiredCnrDb) && link.rx.sensitivityDbm === preset.sensitivityDbm) { required = preset.requiredCnrDb; requiredSource = 'preset'; }
  else { required = link.rx.sensitivityDbm - (kTB + rxNf); requiredSource = 'sensitivity'; }
  const ext = externalNoiseNfDb(env, freqMHz);
  const rise = iem ? 0 : interferenceRiseDb(env, freqMHz);
  const noiseFloorDbm = (ext > 0 && !iem
    ? kTB + 10 * Math.log10(Math.pow(10, systemNfDb / 10) + Math.pow(10, ext / 10) - 1)
    : kTB + systemNfDb) + rise;
  return {
    interferenceRiseDb: rise,
    stages, systemNfDb, noiseFloorDbm, kTBDbm: kTB, receiverNfDb: rxNf, bandwidthKHz: bw, requiredSnrDb: required, requiredSource,
    externalNoiseNfDb: ext, sensitivityAtAntennaDbm: noiseFloorDbm + required, marginAtAntennaDb: null,
  };
}

/**
 * cascadeNoiseIem(link, txChain, rxChain, freqMHz, env, pathGainDb) -> cascadeNoise-shaped result for an IEM link.
 * The bodypack is the receiver, so the receive-side cascade is the same as for a mic link: optional link.rx.chain items
 * (antenna cable, LNA, filter ahead of the bodypack) then the bodypack itself (Friis, as cascadeNoise). External noise
 * (environment.externalNoise) applies at the bodypack antenna like it does for a mic receiver.
 * The Tx-side chain (transmitter -> boosters/cables -> Tx antenna) is not in that cascade, but it radiates its own noise: a
 * source at 290 K through the chain of noise figure F_c and gain G_c leaves it at kTB + F_c + G_c (dBm in B). That noise
 * reaches the bodypack antenna attenuated by the whole path (pathGainDb = rx antenna level - Tx chain output level, so
 * antenna gains, fade margin and body loss are included) and adds in power to the bodypack noise floor:
 *   N_floor = 10 log10( 10^(N_rx/10) + 10^(N_tx,at rx/10) ).
 * It matters only for a high-gain, noisy booster close to the bodypack, which is when a Tx-side booster can hurt.
 * Extra fields: side 'rx', txSide { stages, systemNfDb, chainGainDb, noiseAtTxOutDbm, noiseAtRxDbm }, rxFloorDbm.
 */
export function cascadeNoiseIem(link, txChain, rxChain, freqMHz, env = {}, pathGainDb = -Infinity) {
  const rx = cascadeNoise(link, rxChain, freqMHz, false, env);
  const tx = cascadeNoise(link, txChain, freqMHz, true, env);
  const chainGainDb = tx.stages.length ? tx.stages[tx.stages.length - 1].cumulativeGainDb : 0;
  const noiseAtTxOutDbm = rx.kTBDbm + tx.systemNfDb + chainGainDb;
  const noiseAtRxDbm = noiseAtTxOutDbm + pathGainDb;
  const floor = 10 * Math.log10(Math.pow(10, rx.noiseFloorDbm / 10) + Math.pow(10, noiseAtRxDbm / 10));
  return {
    ...rx, side: 'rx', rxFloorDbm: rx.noiseFloorDbm, noiseFloorDbm: floor, sensitivityAtAntennaDbm: floor + rx.requiredSnrDb,
    txSide: { stages: tx.stages, systemNfDb: tx.systemNfDb, chainGainDb, noiseAtTxOutDbm, noiseAtRxDbm },
  };
}

const db20 = (x) => 20 * Math.log10(Math.max(x, 1e-300));

// ---------------------------------------------------------------- antenna contact and dampness (assumed loss options)

/**
 * ASSUMED, approximate extra loss and detuning (dB) at UHF when the antenna is on or near the wearer: free 0, over clothing 2.5,
 * skin contact 6, hand cupped over a handheld antenna 8 (ranges quoted as about 0 / 2-3 / 4-8 / 6-10+ dB). Dampness: dry 0,
 * damp clothing 1, sweaty or wet 3 (about 0 / 1 / 2-4 dB). Selectable options, not extra physics. Wet cable or connectors are a
 * reliability issue, not a link-budget number.
 */
export { ANTENNA_CONTACT_LOSS_DB, ANTENNA_DAMPNESS_LOSS_DB, ANTENNA_CONTACT_LABELS, ANTENNA_DAMPNESS_LABELS };

/**
 * bodyCouplingLossDb(env, txAnt, rx) -> { bodyDb, contactDb, dampnessDb, totalDb, replaced }.
 * bodyDb = environment.bodyLossDb + rx.bodyLossDb (the scene-level body setting). contactDb / dampnessDb sum the options on the Tx
 * and Rx antenna objects (antenna.contact, antenna.dampness). When a contact option is chosen on a body-worn antenna
 * (type 'body'), it REPLACES the scene-level body loss (replaced = true, bodyDb counted as 0) so the wearer is never counted twice;
 * on other antennas, and for dampness alone, the loss is added.
 */
export function bodyCouplingLossDb(env, txAnt, rx) {
  const e = env || {};
  const rxAnt = rx && rx.antenna;
  let bodyDb = (e.bodyLossDb || 0) + ((rx && rx.bodyLossDb) || 0);
  let contactDb = 0, dampnessDb = 0, replaced = false;
  for (const a of [txAnt, rxAnt]) {
    if (!a) continue;
    if (Object.prototype.hasOwnProperty.call(ANTENNA_CONTACT_LOSS_DB, a.contact)) {
      contactDb += ANTENNA_CONTACT_LOSS_DB[a.contact];
      if (a.type === 'body') replaced = true;
    }
    if (Object.prototype.hasOwnProperty.call(ANTENNA_DAMPNESS_LOSS_DB, a.dampness)) dampnessDb += ANTENNA_DAMPNESS_LOSS_DB[a.dampness];
  }
  if (replaced) bodyDb = 0;
  return { bodyDb, contactDb, dampnessDb, totalDb: bodyDb + contactDb + dampnessDb, replaced };
}

// ---------------------------------------------------------------- polarisation mismatch

/** Per-antenna polarisation ids (antenna.polarisation). Absent = the scene polarisation (environment.polarisation). */
export { ANTENNA_POLARISATIONS };
/**
 * Cross-polar discrimination (dB) floor of the linear-to-orthogonal mismatch loss. ASSUMED 15 dB (flag U): indoors multipath
 * depolarises the wave, typically 10 to 20 dB, so a perfectly cross-polarised pair is never worse than about 15 dB in practice.
 */
export const DEFAULT_XPD_DB = 15;
/** Circular-to-opposite-sense discrimination (dB), set by the axial ratio of real antennas (an ideal one would be infinite). ASSUMED 20 dB, flag I. */
export const DEFAULT_CIRCULAR_XPD_DB = 20;
/** Linear-to-circular loss (dB), at any angle, standard result: 3 dB. */
export const LINEAR_TO_CIRCULAR_DB = 3.0103;
/** Antenna types with a ring (rotationally symmetric) pattern about the element axis: their polarisation is referenced to the ground, not to the boresight. */
const RING_TYPES = ['omni', 'dipole', 'quarterwave', 'body'];

/**
 * wavePolarisation(scene, link) -> the polarisation of the radiated wave = the TRANSMIT antenna's polarisation ('vertical' when unset;
 * a legacy environment.polarisation is honoured only when the antenna sets none, and is removed by migrateScene). Decides the
 * reflection coefficients (TE or TM; slant and circular use the TE/TM average).
 */
export function wavePolarisation(scene, link) {
  const a = link && link.tx && link.tx.antenna;
  if (a && ANTENNA_POLARISATIONS.includes(a.polarisation)) return a.polarisation;
  const e = scene && scene.environment && scene.environment.polarisation;
  return e === 'horizontal' ? 'horizontal' : 'vertical';
}

/**
 * polarisationLossDb(txAnt, rxAnt, departure, arrival, { envPolarisation, reflections, xpdDb }) -> dB, >= 0.
 * Polarisation loss factor (PLF, Balanis): PLF = |e_t . e_r|^2 for unit polarisation vectors projected on the plane
 * perpendicular to the ray. Linear antenna E axis = u cos(a) + r sin(a) in its own tilted/rolled frame (a = 0 vertical, 90
 * horizontal, 45 slant). Linear-to-linear: PLF = c^2 (1 - X) + X with c the cosine of the angle between the projected axes and
 * X = 10^(-xpd/10) (so 45 deg mismatch = 3 dB, near 90 deg limited to xpdDb). Circular to linear: 3 dB. Circular to circular: 0 dB
 * co-polar, xpdDb cross-polar; every reflection flips the handedness. Reflected linear rays reuse the end bearings (the E vector
 * rotation at the reflection is ignored: approximate). Horizontal and slant axes lie along the antenna right axis (perpendicular
 * to its boresight), so aim the antenna (orientation.az) across the path for them to count. departure/arrival are bearings {az, el} from each antenna toward the path.
 */
export function polarisationLossDb(txAnt, rxAnt, departure, arrival, { envPolarisation = 'vertical', reflections = 0, xpdDb = DEFAULT_XPD_DB, circularXpdDb = DEFAULT_CIRCULAR_XPD_DB, mirrors = [] } = {}) {
  const X = Math.pow(10, -xpdDb / 10);
  const Xc = Math.pow(10, -circularXpdDb / 10);
  const polOf = (a) => (a && ANTENNA_POLARISATIONS.includes(a.polarisation) ? a.polarisation : (envPolarisation === 'horizontal' ? 'horizontal' : 'vertical'));
  const pt = polOf(txAnt), pr = polOf(rxAnt);
  const circ = (x) => x === 'rhcp' || x === 'lhcp';
  let plf;
  if (circ(pt) && circ(pr)) {
    const flipped = reflections % 2 === 1 ? (pt === 'rhcp' ? 'lhcp' : 'rhcp') : pt;
    plf = flipped === pr ? 1 : Xc;
  } else if (circ(pt) || circ(pr)) {
    plf = Math.pow(10, -LINEAR_TO_CIRCULAR_DB / 10); // any angle
  } else {
    const axis = (a, pol, bearing) => {
      // body-worn antennas store el 90 as a convention (boresight up); their polarisation axes start from the horizontal frame
      const ring = !!(a && RING_TYPES.includes(a.type));
      // ring-pattern types (omni, dipole, quarterwave, body) store el 90 or el 0 by convention: use the upright frame (el 0), tilt and roll still apply
      const f = antennaFrame(ring && a.orientation ? { ...a, orientation: { az: a.orientation.az, el: 0 } } : (a || {}));
      const ang = (pol === 'horizontal' ? 90 : pol === 'slant45' ? 45 : 0) * DEG;
      const v = unitVec(bearing);
      if (ring) {
        // E = cos(a) x (element axis projected on the wave plane) + sin(a) x (horizontal direction perpendicular to the ray, u x v)
        const d = dot(f.u, v);
        const pv = [f.u[0] - d * v[0], f.u[1] - d * v[1], f.u[2] - d * v[2]];
        const npv = Math.hypot(...pv);
        const h = [f.u[1] * v[2] - f.u[2] * v[1], f.u[2] * v[0] - f.u[0] * v[2], f.u[0] * v[1] - f.u[1] * v[0]];
        const nh = Math.hypot(...h);
        const cv = npv > 1e-9 ? Math.cos(ang) / npv : 0, ch = nh > 1e-9 ? Math.sin(ang) / nh : 0;
        return [0, 1, 2].map((i) => pv[i] * cv + h[i] * ch);
      }
      const e = [0, 1, 2].map((i) => f.u[i] * Math.cos(ang) + f.r[i] * Math.sin(ang));
      const d = dot(e, v);
      return [e[0] - d * v[0], e[1] - d * v[1], e[2] - d * v[2]];
    };
    // Image method for the E vector: the transmit polarisation vector is mirrored in each reflecting plane in order (floor and ceiling
    // flip z; a wall reflects about its normal), so a vertical antenna stays co-polar after a floor or wall bounce (the sign is in the
    // Fresnel coefficient). mirrors = [{ z: true } | { nx, ny }] from the first reflection to the last.
    let qt = axis(txAnt, pt, departure);
    for (const m of mirrors) {
      if (m.z) qt = [qt[0], qt[1], -qt[2]];
      else { const d = qt[0] * m.nx + qt[1] * m.ny; qt = [qt[0] - 2 * d * m.nx, qt[1] - 2 * d * m.ny, qt[2]]; }
    }
    const qr = axis(rxAnt, pr, arrival);
    const nt = Math.hypot(...qt), nr = Math.hypot(...qr);
    const c = nt > 1e-9 && nr > 1e-9 ? dot(qt, qr) / (nt * nr) : 0;
    plf = c * c * (1 - X) + X;
  }
  return -10 * Math.log10(Math.min(1, Math.max(plf, 1e-12)));
}

export function solveLink(scene, link) {
  const f = link.freqMHz;
  const env = scene.environment || {};
  const pol = wavePolarisation(scene, link);
  const lambda = wavelengthM(f);
  const isP2p = link.kind === 'p2p';
  const p2pOpt = (isP2p && link.p2p) || {};
  // p2p: the direct ray only (the flat-earth ground and wall reflections are invalid over kilometres) unless link.p2p.groundReflection is set
  const rawPaths = isP2p && !p2pOpt.groundReflection ? tracePaths(scene, link).filter((q) => q.kind === 'direct') : tracePaths(scene, link);
  let p2pInfo = null;
  if (isP2p) {
    const a = absolutePos(scene, link.tx.pos), b = absolutePos(scene, link.rx.pos);
    p2pInfo = p2pGeometry({ dM: Math.hypot(b.x - a.x, b.y - a.y), htM: a.z, hrM: b.z, freqMHz: f, K: Number.isFinite(p2pOpt.kFactor) ? p2pOpt.kFactor : K_STANDARD, obstacle: p2pOpt.obstacle || null });
  }

  const usePol = true; // always computed: a missing antenna.polarisation is 'vertical'
  let sumRe = 0, sumIm = 0;
  const paths = rawPaths.map((p) => {
    const gt = antennaGainDb(link.tx.antenna, p.departureBearing);
    const gr = antennaGainDb(link.rx.antenna, p.arrivalBearing);
    // Per-antenna polarisation, always applied (the wave's polarisation is the transmit antenna's).
    const polLoss = usePol ? polarisationLossDb(link.tx.antenna, link.rx.antenna, p.departureBearing, p.arrivalBearing, { envPolarisation: pol, xpdDb: scene.environment && Number.isFinite(scene.environment.xpdDb) ? scene.environment.xpdDb : DEFAULT_XPD_DB, reflections: p.reflections.length, mirrors: p.reflections.map((r) => { if (r.type !== 'wall') return { z: true }; const w = allReflectors(scene).find((x) => x.id === r.via); const fr = wallFrame(w); return { nx: fr.nx, ny: fr.ny }; }) }) : 0;
    // Amplitude (relative to sqrt power): Friis lambda/(4 pi d) * sqrt(Gt Gr) * product of Gamma
    let amp = lambda / (4 * Math.PI * Math.max(p.lengthM, 1e-3)) * Math.pow(10, (gt + gr - polLoss) / 20);
    let re = 1, im = 0;
    p.reflections.forEach((r, i) => {
      const a = p.points[i], b = p.points[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const len = Math.hypot(dx, dy, dz);
      let g;
      if (r.type === 'overhead') {
        const op = overheadPlanes(scene).find((x) => x.id === r.via);
        g = overheadReflection(op ? op.material : 'concrete', pol, Math.asin(Math.min(Math.abs(dz) / len, 1)) / DEG, f);
        if (op && op.lossDb) { const k = Math.pow(10, -op.lossDb / 20); g = { re: g.re * k, im: g.im * k }; }
      } else if (r.type === 'floor') {
        g = floorReflection(floorSurfaceAt(scene, r.point.x, r.point.y), pol, Math.asin(Math.min(Math.abs(dz) / len, 1)) / DEG, f);
      } else {
        const w = allReflectors(scene).find((x) => x.id === r.via);
        const fr = wallFrame(w);
        const cosInc = Math.min(Math.abs(dx * fr.nx + dy * fr.ny) / len, 1);
        const wc = wallConstruction(w, f);
        g = reflectorCoefficient(wc ? wc.reflectionMaterial : w.material, Math.acos(cosInc) / DEG, pol, f);
        if (wc && wc.reflectionLossDb) { const k = Math.pow(10, -wc.reflectionLossDb / 20); g = { re: g.re * k, im: g.im * k }; }
      }
      [re, im] = [re * g.re - im * g.im, re * g.im + im * g.re];
    });
    if (p.floorFraction !== undefined) amp *= p.floorFraction; // reflection partly beyond the plane's edge (deck / platform)
    const wl = pathWallLoss(scene, p.points, f); // transmission through walls the legs cross
    if (wl.lossDb) amp *= Math.pow(10, -wl.lossDb / 20);
    const ph = -2 * Math.PI * p.lengthM / lambda; // propagation phase e^{-jkd}
    const c = Math.cos(ph), s = Math.sin(ph);
    const cre = amp * (re * c - im * s), cim = amp * (re * s + im * c);
    sumRe += cre; sumIm += cim;
    return {
      ...p, ...(wl.lossDb || wl.crossed.length ? { wallLossDb: wl.lossDb, crossedWalls: wl.crossed, wallLossDetail: wl.detail } : {}),
      ...(wl.platformLossDb ? { platformLossDb: wl.platformLossDb, platformChords: wl.platforms } : {}),
      ...(wl.audienceLossDb ? { audienceLossDb: wl.audienceLossDb, audienceChords: wl.audienceChords } : {}),
      ...(wl.crowdLossDb ? { crowdLossDb: wl.crowdLossDb, crowdChords: wl.crowdChords, crowdDetail: wl.crowdDetail } : {}),
      gainDb: db20(Math.hypot(cre, cim)), phaseRad: Math.atan2(cim, cre), _gt: gt, _gr: gr, ...(polLoss ? { polarisationLossDb: polLoss } : {}),
    };
  });

  const direct = paths[0];
  const relBase = direct.gainDb;
  paths.forEach((p) => { p.relDb = p.gainDb - relBase; });
  const distanceM = distance3D(absolutePos(scene, link.tx.pos), absolutePos(scene, link.rx.pos));
  const fspl = fsplDb(distanceM, f);
  const total = Math.hypot(sumRe, sumIm);
  const directAmp = Math.pow(10, direct.gainDb / 20);
  const multipathDb = db20(total) - db20(directAmp); // coherent sum vs direct ray alone
  const directWallDb = direct.wallLossDb || 0;
  const pathLossDb = fspl + directWallDb - multipathDb;

  // Waterfall: running level after each step.
  const wf = [];
  let level = link.tx.powerDbm;
  wf.push({ label: 'Tx power', valueDbm: level, deltaDb: 0 });
  const step = (label, delta) => { level += delta; wf.push({ label, valueDbm: level, deltaDb: delta }); };
  const chain = link.chain || [];
  const inputWarn = [];
  const chainSteps = (list = chain) => list.forEach((it) => {
    if (Number.isFinite(it.maxInputDbm) && level > it.maxInputDbm) inputWarn.push(`${chainLabel(it)} input is ${level.toFixed(1)} dBm, above its rating of ${it.maxInputDbm} dBm: add a pad or lower the Tx power.`);
    const stop = filterStopbandExtraDb(it, f);
    if (stop > 0) inputWarn.push(`${chainLabel(it)} passes ${it.passLoMHz}-${it.passHiMHz} MHz but the link is at ${f} MHz: it ${it.filterType === 'notch' ? 'notches' : 'rejects'} this channel by ${stop} dB (assumed). Use a filter for the right band.`);
    step(chainLabel(it), -chainItemLossDb(it, f));
  });
  const iem = link.kind === 'iem';
  // IEM only: optional link.rx.chain = items between the bodypack antenna and the bodypack (cable, LNA, filter).
  const rxChain = iem && Array.isArray(link.rx.chain) ? link.rx.chain : [];
  if (iem) chainSteps(); // transmitter -> chain -> Tx antenna
  const txOutDbm = level;
  step('Tx antenna gain', direct._gt);
  // Antenna band mismatch (opt-in via antenna.designBand): power not delivered to the radiating element is reflected (mismatch loss).
  const txM = antennaMatch(link.tx.antenna, f), rxM = antennaMatch(link.rx.antenna, f);
  if (txM.mismatchDb > 1e-9) step(`Tx antenna mismatch (VSWR ${txM.vswr.toFixed(1)}:1)`, -txM.mismatchDb);
  step(`Free-space loss (${formatLength(distanceM, scene && scene.units && scene.units.length)})`, -fspl);
  const directPlatformDb = direct.platformLossDb || 0;
  const directAudienceDb = direct.audienceLossDb || 0;
  const directCrowdDb = direct.crowdLossDb || 0;
  if (directWallDb - directPlatformDb - directAudienceDb - directCrowdDb > 1e-12) step('Wall transmission', -(directWallDb - directPlatformDb - directAudienceDb - directCrowdDb));
  if (directPlatformDb) step('Platform obstruction', -directPlatformDb);
  if (directAudienceDb) step('Audience absorption (assumed)', -directAudienceDb);
  if (directCrowdDb) step('Crowd absorption (assumed)', -directCrowdDb);
  if (Math.abs(multipathDb) > 1e-9) step('Multipath (coherent sum)', multipathDb);
  step('Rx antenna gain', direct._gr);
  if (isP2p && p2pInfo.diffractionLossDb > 0.05) step(`Diffraction (single knife edge, ${p2pInfo.edge === 'earth' ? 'earth curvature' : 'obstacle'})`, -p2pInfo.diffractionLossDb);
  if (rxM.mismatchDb > 1e-9) step(`Rx antenna mismatch (VSWR ${rxM.vswr.toFixed(1)}:1)`, -rxM.mismatchDb);
  if (direct.polarisationLossDb > 1e-9) step('Polarisation mismatch', -direct.polarisationLossDb);
  const coupling = bodyCouplingLossDb(env, link.tx.antenna, link.rx);
  const body = isP2p ? 0 : coupling.bodyDb; // a fixed link has no performer
  if (body) step('Body loss', -body);
  if (coupling.contactDb) step('Antenna contact (assumed)', -coupling.contactDb);
  if (coupling.dampnessDb) step('Dampness (assumed)', -coupling.dampnessDb);
  const fadeDb = isP2p && Number.isFinite(p2pOpt.fadeMarginDb) ? p2pOpt.fadeMarginDb : env.fadeMarginDb;
  if (fadeDb) step('Fade margin', -fadeDb);
  const rxPowerDbm = level;
  if (iem) chainSteps(rxChain); // bodypack antenna -> optional rx chain -> bodypack
  else chainSteps(); // Rx antenna -> chain -> receiver
  const inputPowerDbm = level;

  // Noise-figure cascade (Friis), the same for both link kinds. Mic: Rx antenna -> chain -> receiver. IEM: bodypack antenna ->
  // optional rx.chain -> bodypack, plus the noise the Tx-side chain radiates (cascadeNoiseIem). marginDb = margin at the
  // receive antenna terminals over the system sensitivity (noise floor + required SNR).
  const cascade = iem ? cascadeNoiseIem(link, chain, rxChain, f, env, rxPowerDbm - txOutDbm) : cascadeNoise(link, chain, f, false, env);
  if (cascade.interferenceRiseDb > 0) { step(`Interference floor +${cascade.interferenceRiseDb.toFixed(0)} dB (${env.interference}, note)`, 0); wf[wf.length - 1].note = true; }
  step(`System NF ${cascade.systemNfDb.toFixed(1)} dB (cascade, note)`, 0); wf[wf.length - 1].note = true;
  // Video (LED) wall noise (ledwall.js): broadband field of scene.reflectors[].noise converted to power at the receive antenna terminals, then
  // power-summed with the noise floor already in the cascade (external noise, interference, system NF). Only walls that carry a noise block count.
  const marginBeforeWallDb = rxPowerDbm - cascade.sensitivityAtAntennaDbm;
  const mutedWalls = mutedReflectorIds(scene.noiseSources);
  const wn = wallNoiseAt(mutedWalls.size ? (scene.reflectors || []).filter((r) => !mutedWalls.has(r.id)) : scene.reflectors, absolutePos(scene, link.rx.pos), f, cascade.bandwidthKHz, (b) => antennaGainDb(link.rx.antenna, b));
  let wallNoise = null;
  if (wn.walls.length) {
    const before = cascade.noiseFloorDbm;
    const after = 10 * Math.log10(Math.pow(10, before / 10) + Math.pow(10, wn.dbm / 10));
    cascade.noiseFloorDbm = after;
    cascade.sensitivityAtAntennaDbm = after + cascade.requiredSnrDb;
    wallNoise = { dbm: wn.dbm, floorBeforeDbm: before, floorAfterDbm: after, riseDb: after - before, bandwidthKHz: cascade.bandwidthKHz, walls: wn.walls, marginChangeDb: 0 };
    step(`Video wall noise ${wn.dbm.toFixed(1)} dBm in ${cascade.bandwidthKHz} kHz (floor +${wallNoise.riseDb.toFixed(1)} dB, note)`, 0); wf[wf.length - 1].note = true;
  }
  cascade.wallNoise = wallNoise;
  // Other noise sources (noise-sources.js, item 34): the AVERAGE power of every source (gated sources scaled by their duty) is power-summed into the
  // floor after the wall; the PEAK figure (pulse or key-up) is reported beside it and does not change the margin.
  const marginAfterWallDb = rxPowerDbm - cascade.sensitivityAtAntennaDbm;
  let noiseSources = null;
  const nsAt = Array.isArray(scene.noiseSources) && scene.noiseSources.length ? noiseSourcesAt(scene.noiseSources, absolutePos(scene, link.rx.pos), f, cascade.bandwidthKHz, (b) => antennaGainDb(link.rx.antenna, b)) : null;
  if (nsAt && nsAt.sources.some((x) => x.averageDbm > -Infinity)) {
    const before = cascade.noiseFloorDbm;
    const after = 10 * Math.log10(Math.pow(10, before / 10) + Math.pow(10, nsAt.averageDbm / 10));
    cascade.noiseFloorDbm = after;
    cascade.sensitivityAtAntennaDbm = after + cascade.requiredSnrDb;
    noiseSources = { averageDbm: nsAt.averageDbm, peakDbm: nsAt.peakDbm, floorBeforeDbm: before, floorAfterDbm: after, riseDb: after - before, peakRiseDb: floorRiseDb(before, nsAt.peakDbm), bandwidthKHz: cascade.bandwidthKHz, sources: nsAt.sources, dominant: nsAt.dominant, marginChangeDb: 0 };
    step(`Noise sources ${nsAt.averageDbm.toFixed(1)} dBm average, ${nsAt.peakDbm.toFixed(1)} dBm peak (floor +${noiseSources.riseDb.toFixed(1)} dB, note)`, 0); wf[wf.length - 1].note = true;
  }
  cascade.noiseSources = noiseSources;
  // Booster compression (compression.js): a strong narrowband source (a keyed radio, a transmitter) reaches the receive chain at its raw level and drives
  // an active stage towards its output P1dB; the stage then loses gain for every signal, the wanted one included. Only evaluated when such a source exists,
  // so scenes without noise sources are unchanged. The loss (dB) is taken off the margin and reported as `compression`.
  let compression = null;
  const rcvChain = iem ? rxChain : chain;
  if (nsAt && (rcvChain || []).some((it) => ACTIVE_CHAIN_KINDS.includes(it.kind))) {
    const strong = nsAt.sources.filter((x) => x.type === 'narrowband' && Number.isFinite(x.rawDbm) && x.rawDbm > -90 && !x.muted);
    if (strong.length) {
      const signals = [{ id: 'wanted', levelDbm: rxPowerDbm, freqMHz: f, wanted: true }, ...strong.map((x) => ({ id: x.id, name: x.name, levelDbm: x.rawDbm, freqMHz: f + x.offsetMHz }))];
      const stages = rcvChain.map((it) => ({
        label: chainLabel(it), gainDbs: signals.map((sg) => chainItemNoise(it, sg.freqMHz).gainDb),
        op1dBDbm: ACTIVE_CHAIN_KINDS.includes(it.kind) ? stageOp1dBDbm(it, chainItemNoise(it, f).gainDb) : null,
      }));
      const cc = chainCompression(stages, signals);
      compression = { ...cc, strongest: strong.reduce((a, x) => (x.rawDbm > a.rawDbm ? x : a)), signals: signals.map(({ id, name, levelDbm, freqMHz }) => ({ id, name, levelDbm, freqMHz })) };
      if (cc.totalDb > 0.05) { step(`Booster compression -${cc.totalDb.toFixed(1)} dB (strong signal, note)`, 0); wf[wf.length - 1].note = true; }
    }
  }
  cascade.compression = compression;
  cascade.marginAtAntennaDb = rxPowerDbm - cascade.sensitivityAtAntennaDbm - (compression ? compression.totalDb : 0);
  if (noiseSources) noiseSources.marginChangeDb = cascade.marginAtAntennaDb + (compression ? compression.totalDb : 0) - marginAfterWallDb;
  if (wallNoise) wallNoise.marginChangeDb = cascade.marginAtAntennaDb + (compression ? compression.totalDb : 0) - marginBeforeWallDb;
  const marginDb = cascade.marginAtAntennaDb;
  const status = marginDb >= 6 ? 'pass' : marginDb >= 0 ? 'marginal' : 'fail';
  paths.forEach((p) => { delete p._gt; delete p._gr; });

  // Warnings (plain text for the UI). nearField: the Friis formula is clamped at 0.1 m (FSPL stays positive) and the path amplitude
  // at 1 mm, so closer than 0.1 m the loss is NOT real physics (the antennas are in each other's near field).
  const warnings = [];
  const nearField = distanceM < NEAR_FIELD_M;
  if (nearField) warnings.push(`Antennas are ${distanceM.toFixed(2)} m apart, closer than ${NEAR_FIELD_M} m: the free-space formula does not hold in the near field, so the loss is held at its 0.1 m value.`);
  if (coupling.replaced && ((env.bodyLossDb || 0) + (link.rx.bodyLossDb || 0))) warnings.push('An antenna contact option on a body-worn antenna replaces the scene body loss setting (it is not added), so the wearer is counted once.');
  if (body && ((link.rx.antenna && link.rx.antenna.type === 'body') || (link.tx.antenna && link.tx.antenna.type === 'body'))) {
    warnings.push('A body antenna already includes the loss of the wearer (-3 dBi, weaker behind); a body loss setting on top of it counts the body twice.');
  }
  warnings.push(...inputWarn);
  if (compression && compression.totalDb > 0.05) {
    const w = compression.worst;
    warnings.push(`${w.label} is driven ${w.compressionDb >= 1 ? 'into compression' : 'towards its 1 dB point'} by ${compression.strongest.name || 'a strong signal'} (${compression.strongest.rawDbm.toFixed(1)} dBm at the antenna): ${compression.totalDb.toFixed(1)} dB less gain for the wanted signal. Put a bandpass filter ahead of the booster, move the source or the antenna, or use a booster with a higher P1dB.`);
  }
  if (wallNoise && wallNoise.riseDb >= 3) {
    const w0 = wallNoise.walls.reduce((a, b) => (b.powerDbm > a.powerDbm ? b : a));
    warnings.push(`Video wall noise ${w0.name ? `from "${w0.name}" ` : ''}raises the receiver noise floor by ${wallNoise.riseDb.toFixed(1)} dB (${wallNoise.dbm.toFixed(1)} dBm in ${wallNoise.bandwidthKHz} kHz, ${w0.distanceM.toFixed(1)} m from the wall, ${w0.side} side, wall limit assumed): move the antenna away from the wall, aim it away, or fix the panel cabling (ferrites, shielded data cable).`);
  }
  warnings.push(...rofChainWarnings(chain, f), ...(iem ? rofChainWarnings(rxChain, f) : []));
  if (Array.isArray(link.branches) && link.branches.length > 1) {
    const bd = rofBranchDelays(link.branches.map((b) => b.chain));
    if (bd.warn) warnings.push(`Branches have different fibre lengths (delay spread ${bd.spreadNs.toFixed(0)} ns): combined coherently at RF they will not add in phase (1 ns = 216 degrees at 600 MHz). Use equal fibre lengths.`);
  }
  // Reflected power returns toward the transmitter output stage through the chain (twice the one-way chain loss on the reflected wave).
  // Per item the reverse loss is reverseIsolationDb (an isolator: low forward loss, high reverse isolation) or else twice the forward loss (a reciprocal pad or cable is crossed by the reflected wave on the way back); gain stages count 0.
  const chainToAntDb = iem ? chain.reduce((sum, it) => sum + (Number.isFinite(it.reverseIsolationDb) ? Math.max(it.reverseIsolationDb, 0) : 2 * Math.max(chainItemLossDb(it, f), 0)), 0) : 0;
  const antInDbm = txOutDbm;
  const txReflectedDbm = txM.matched ? -Infinity : antInDbm + 10 * Math.log10(Math.max(txM.gammaSq, 1e-30));
  const vswrAtPa = txM.matched ? 1 : vswrThroughLoss(txM.vswr, chainToAntDb / 2);
  const reflectedAtPaDbm = txM.matched ? -Infinity : txReflectedDbm - chainToAntDb;
  for (const [side, m, a] of [['Tx', txM, link.tx.antenna], ['Rx', rxM, link.rx.antenna]]) {
    if (!m.matched && !m.inBand) warnings.push(`${side} antenna is cut for ${m.band.label} but the link is at ${f} MHz: VSWR ${m.vswr.toFixed(1)}:1, mismatch loss ${m.mismatchDb.toFixed(1)} dB. Use an antenna cut for this band.`);
  }
  if (!txM.matched && vswrAtPa > BAND_VSWR_WARN) warnings.push(`Reflected power: the Tx antenna VSWR is ${txM.vswr.toFixed(1)}:1, so ${(100 * txM.gammaSq).toFixed(0)} percent of the power (${reflectedAtPaDbm.toFixed(1)} dBm) returns to the transmitter output stage (VSWR there ${vswrAtPa.toFixed(1)}:1)${vswrAtPa > BAND_VSWR_STRONG ? ': this can stress the PA or trigger foldback. Fit the correct antenna, or an isolator or pad (a pad of N dB returns the reflection 2N dB weaker; an isolator is better).' : '. Check the antenna.'}`);
  warnings.push(...chainDcWarnings(chain, { endSupplyV: iem ? 0 : (link.rx.antennaBiasV || 0), endSupplyMa: link.rx.antennaBiasMa > 0 ? link.rx.antennaBiasMa : Infinity }));
  if (iem && rxChain.length) warnings.push(...chainDcWarnings(rxChain));
  for (const [side, a] of [['Tx', link.tx.antenna], ['Rx', link.rx.antenna]]) {
    if (a && a.type === 'quarterwave' && a.groundPlane === 'none') warnings.push(`${side} antenna is a quarter-wave whip with no ground plane (free cable): it needs a ground plane of about a quarter wave radius, so gain is only about ${GROUND_PLANE_GAIN_DBI.none} dBi and unpredictable. Use a rack panel or ground plate, or a dipole with a choke.`);
  }
  if (isP2p) {
    if (p2pInfo.beyondHorizon) warnings.push(`The path (${(p2pInfo.dM / 1000).toFixed(1)} km) is beyond the radio horizon of these antenna heights (${(p2pInfo.horizonM / 1000).toFixed(1)} km at K ${p2pInfo.K.toFixed(2)}): the earth blocks it and the knife-edge loss is only an estimate.`);
    else if (!p2pInfo.meetsSixtyPercent) warnings.push(`First Fresnel zone clearance is ${(100 * p2pInfo.minClearanceFraction).toFixed(0)} percent at its worst point (${(p2pInfo.worstXM / 1000).toFixed(2)} km from the transmitter), below the 60 percent rule: raise the antennas${p2pInfo.diffractionLossDb > 0.05 ? ` (diffraction loss ${p2pInfo.diffractionLossDb.toFixed(1)} dB)` : ''}.`);
    const sug = suggestedFadeMarginDb(p2pInfo.dM);
    if ((fadeDb || 0) < sug) warnings.push(`Fade margin is ${(fadeDb || 0).toFixed(0)} dB; about ${sug.toFixed(0)} dB is suggested for a ${(p2pInfo.dM / 1000).toFixed(1)} km path (assumed).`);
    if (p2pInfo.dM < 100) warnings.push('This point-to-point path is under 100 m: the antennas may be in each other near field and a mic or IEM link is the better model.');
  }
  const polDb = direct.polarisationLossDb || 0;
  const polarisation = { lossDb: polDb, severity: polDb >= 10 ? 'warning' : polDb >= 3 ? 'info' : 'ok', txPolarisation: pol };
  if (polDb >= 10) warnings.push(`Polarisation mismatch costs ${polDb.toFixed(1)} dB on the direct path: align the antennas or change polarisation.`);
  else if (polDb >= 3) warnings.push(`Note: polarisation mismatch costs ${polDb.toFixed(1)} dB on the direct path (circular to linear is always 3 dB).`);
  const antennaMismatch = (txM.matched && rxM.matched) ? null : {
    tx: txM.matched ? null : { vswr: txM.vswr, returnLossDb: txM.returnLossDb, mismatchDb: txM.mismatchDb, inBand: txM.inBand, reflectedDbm: txReflectedDbm, reflectedAtPaDbm, vswrAtPa },
    rx: rxM.matched ? null : { vswr: rxM.vswr, returnLossDb: rxM.returnLossDb, mismatchDb: rxM.mismatchDb, inBand: rxM.inBand },
  };
  return { distanceM, paths, pathLossDb, fsplDb: fspl, ...(directCrowdDb ? { crowd: { lossDb: directCrowdDb, chords: direct.crowdChords, crowds: direct.crowdDetail, caveat: CROWD_CAVEAT } } : {}), rxPowerDbm, antennaMismatch, polarisation, p2p: p2pInfo, wallNoise, noiseSources, compression, waterfall: wf, inputPowerDbm, marginDb, status, cascade, requiredSnrDb: cascade.requiredSnrDb, nearField, warnings };
}

// ---------------------------------------------------------------- multi-antenna (branch) IEM zones

/** Branches of a link. A link without `branches` is one branch built from tx.antenna, tx.pos and chain. */
export function branchesOf(link) {
  if (Array.isArray(link.branches) && link.branches.length) return link.branches;
  return [{ id: 'branch0', name: 'Branch 1', chain: link.chain || [], antenna: link.tx.antenna, pos: link.tx.pos }];
}

/** A plain single-antenna link for one branch toward rxPoint (shares the transmitter power). */
export function branchLinkOf(link, branch, rxPoint, powerOffsetDb = 0) {
  return {
    ...link,
    tx: { ...link.tx, powerDbm: link.tx.powerDbm - powerOffsetDb, pos: branch.pos, antenna: branch.antenna },
    rx: rxPoint ? { ...link.rx, pos: rxPoint } : link.rx,
    chain: branch.chain || [],
    branches: undefined,
  };
}

/** Splitter loss (dB) feeding N branches: 10 log10 N + insertion loss (link.splitter.insertionLossDb). Zero for one branch. */
export function splitterLossDb(link, n) {
  if (n <= 1) return 0;
  const il = link.splitter && Number.isFinite(link.splitter.insertionLossDb) ? link.splitter.insertionLossDb : 0;
  return 10 * Math.log10(n) + il;
}

/** Electrical length (m) of the cables in a chain: sum of length / velocityFactor. */
export function chainElectricalLengthM(chain) {
  let l = 0;
  for (const it of chain || []) {
    if (it.kind === 'rof') { l += rofEffective(it).electricalLengthM; continue; } // fibre group delay as an equivalent length
    if (it.kind !== 'cable') continue;
    const vf = (CABLES[it.cableType] && CABLES[it.cableType].velocityFactor) || 0.66;
    l += (it.lengthM || 0) / vf;
  }
  return l;
}

const lin2dbm = (re, im) => 10 * Math.log10(Math.max(re * re + im * im, 1e-300));

/**
 * Level at rxPoint of every branch and of the combination.
 *  mode 'coherent': complex sum of every path of every branch. Each path phasor = path amplitude (incl. antenna gains,
 *     reflections, wall transmission, chain loss, splitter loss) with phase = path phase - 2 pi L_el / lambda, where
 *     L_el is the branch cable electrical length (length / velocityFactor); all branches in phase at the splitter.
 *  mode 'power': sum of the branch powers (each branch keeps its own multipath). 'best': strongest branch.
 * Returns { combinedDbm, perBranchDbm[], dominantBranch, nullDepthDb, splitterLossDb, powerSumDbm, coherentDbm }.
 * nullDepthDb = max(0, powerSumDbm - coherentDbm): how far the coherent sum sits below the incoherent sum.
 */
export function solveBranches(scene, link, rxPoint, { mode = 'coherent' } = {}) {
  const prep = prepareBranches(scene, link);
  return evalPrepared(prep, scene, rxPoint, mode);
}

/**
 * Per-grid precomputation for solveBranches: one reusable single-antenna link per branch (splitter loss already taken
 * off the Tx power), the constant dB offset and chain phase of each branch. Reuse with evalPrepared for many rx points.
 */
export function prepareBranches(scene, link) {
  const branches = branchesOf(link);
  const split = splitterLossDb(link, branches.length);
  const env = scene.environment || {};
  const fade = env.fadeMarginDb || 0;
  // IEM links: items between the bodypack antenna and the bodypack (link.rx.chain) also attenuate the coherent sum, as in solveLink
  const rxChainLoss = link.kind === 'iem' && Array.isArray(link.rx.chain) ? chainLossDb(link.rx.chain, link.freqMHz) : 0;
  const lambda = wavelengthM(link.freqMHz);
  return {
    split,
    items: branches.map((br) => {
      const bl = branchLinkOf(link, br, { x: 0, y: 0, z: 0 }, split);
      bl.rx = { ...link.rx, pos: { x: 0, y: 0, z: 0 } }; // mutable rx point reused for every cell
      return {
        bl,
        off: bl.tx.powerDbm - chainLossDb(br.chain, link.freqMHz) - (bodyCouplingLossDb(env, bl.tx.antenna, link.rx).totalDb + fade) - rxChainLoss,
        chainPh: -2 * Math.PI * chainElectricalLengthM(br.chain) / lambda,
      };
    }),
  };
}

/** Evaluate prepared branches at rxPoint. Same result shape as solveBranches. `out` may be reused (perBranchDbm array). */
export function evalPrepared(prep, scene, rxPoint, mode = 'coherent') {
  let cRe = 0, cIm = 0, pSum = 0;
  const perBranchDbm = new Array(prep.items.length);
  for (let b = 0; b < prep.items.length; b++) {
    const it = prep.items[b];
    const pos = it.bl.rx.pos;
    pos.x = rxPoint.x; pos.y = rxPoint.y; pos.z = rxPoint.z;
    const res = solveLink(scene, it.bl);
    perBranchDbm[b] = res.inputPowerDbm;
    pSum += Math.pow(10, res.inputPowerDbm / 10);
    const paths = res.paths;
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i];
      const a = Math.pow(10, (p.gainDb + it.off) / 20), ph = p.phaseRad + it.chainPh;
      cRe += a * Math.cos(ph); cIm += a * Math.sin(ph);
    }
  }
  const coherentDbm = lin2dbm(cRe, cIm);
  const powerSumDbm = 10 * Math.log10(Math.max(pSum, 1e-300));
  let dominant = 0;
  for (let b = 1; b < perBranchDbm.length; b++) if (perBranchDbm[b] > perBranchDbm[dominant]) dominant = b;
  const combinedDbm = mode === 'power' ? powerSumDbm : mode === 'best' ? perBranchDbm[dominant] : coherentDbm;
  return {
    combinedDbm, perBranchDbm, dominantBranch: dominant,
    nullDepthDb: mode === 'coherent' ? Math.max(0, powerSumDbm - coherentDbm) : 0,
    splitterLossDb: prep.split, powerSumDbm, coherentDbm,
  };
}
