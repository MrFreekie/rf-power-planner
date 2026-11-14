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
//  * Body loss applied = environment.bodyLossDb + rx.bodyLossDb.

import { CABLES, ANTENNAS, SURFACES, MATERIALS, cableDbPer100m as libraryCableDbPer100m, surfaceAt, materialAt } from './library.js';
import { formatLength } from './units.js';
import { hasFloorFeatures, floorHeightAt, floorSurfaceAt, absolutePos, allReflectors, chordsThrough, floorZoneFraction } from './floor.js';
import { RX_PRESETS, RX_DEFAULTS, EXTERNAL_NOISE_FIGURE_600MHZ_DB, INTERFERENCE_RISE_DB, INTERFERENCE_LEVELS, INTERFERENCE_MIN_MHZ, interferenceBandOf, cascadeIip3Dbm as stagesIip3Dbm } from './rx-params.js';

let ZP = {};
try { ZP = await import('./zones-params.js'); } catch { ZP = {}; }

const C = 299792458; // m/s
const DEG = Math.PI / 180;
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
export function fsplDb(distanceM, freqMHz) {
  const d = Math.max(distanceM, 0.1); // near-field clamp: FSPL stays positive
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
export function antennaGainDb(antennaRef, bearing) {
  const lib = ANTENNAS[antennaRef.type] || {};
  const gain = antennaRef.gainDbi ?? lib.gainDbi ?? 0;
  const orient = antennaRef.orientation || { az: 0, el: 0 };
  const b = unitVec(orient);
  const r = [Math.cos(orient.az * DEG), -Math.sin(orient.az * DEG), 0];
  const u = [
    r[1] * b[2] - r[2] * b[1],
    r[2] * b[0] - r[0] * b[2],
    r[0] * b[1] - r[1] * b[0],
  ];
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
  return absorb(fresnel(m.epsR, m.sigma, grazingDeg, freqMHz, polarisation === 'horizontal' ? 'TE' : 'TM'), m);
}

/** Wall reflection coefficient. incidenceDeg measured from the wall normal. */
export function reflectorCoefficient(materialId, incidenceDeg, polarisation, freqMHz) {
  const m = MATERIALS[materialId] ? materialAt(materialId, freqMHz) : FALLBACK;
  // Vertical E on a vertical wall is perpendicular to the plane of incidence -> TE.
  return absorb(fresnel(m.epsR, m.sigma, 90 - incidenceDeg, freqMHz, polarisation === 'horizontal' ? 'TM' : 'TE'), m);
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
  if (plane.type === 'floor') return { x: P.x, y: P.y, z: 2 * (plane.h || 0) - P.z };
  const d = wallDist(plane.w, plane.fr, P);
  return { x: P.x - 2 * d * plane.fr.nx, y: P.y - 2 * d * plane.fr.ny, z: P.z };
}

// Intersect segment A->B with a plane; returns hit point or null (must cross strictly inside,
// and within the wall's length and zMin..zMax for walls).
function hitPlane(plane, A, B) {
  let fa, fb;
  if (plane.type === 'floor') { fa = A.z - (plane.h || 0); fb = B.z - (plane.h || 0); }
  else { fa = wallDist(plane.w, plane.fr, A); fb = wallDist(plane.w, plane.fr, B); }
  if (!(fa * fb < 0)) return null;
  const t = fa / (fa - fb);
  const H = { x: A.x + t * (B.x - A.x), y: A.y + t * (B.y - A.y), z: A.z + t * (B.z - A.z) };
  if (plane.type === 'floor') { H.z = plane.h || 0; return H; }
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
    reflections: planes.map((p, i) => ({ type: p.type, via: p.w ? p.w.id : undefined, point: points[i + 1] })),
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
  return { lossDb, crossed, detail, platformLossDb, platforms };
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
      return -item.gainDb; // noise figure (nfDb) not modelled in the power budget
    case 'splitter':
    case 'combiner':
      return 10 * Math.log10(Math.max(item.ports || 1, 1)) + (item.insertionLossDb || 0);
    default: // filter, connector, attenuator
      return item.lossDb || 0;
  }
}

/** Net chain loss in dB (negative = net gain). */
export function chainLossDb(chain, freqMHz) {
  return (chain || []).reduce((s, it) => s + chainItemLossDb(it, freqMHz), 0);
}

function chainLabel(item) {
  switch (item.kind) {
    case 'cable': return `Cable ${CABLES[item.cableType]?.name ?? item.cableType} ${item.lengthM} m`;
    case 'booster': return 'Booster';
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
  if (item.kind === 'booster') return { gainDb: item.gainDb, nfDb: Number.isFinite(item.nfDb) ? item.nfDb : 3 };
  const loss = chainItemLossDb(item, freqMHz);
  return { gainDb: -loss, nfDb: Math.max(0, loss) };
}

const BOLTZMANN_DBM_HZ = -174; // kT at 290 K

/** External noise figure (dB above kT) at freqMHz from environment.externalNoise (name or dB at 600 MHz); 0 when unset. */
export function externalNoiseNfDb(env, freqMHz) {
  const v = env && env.externalNoise;
  const at600 = typeof v === 'number' ? v : EXTERNAL_NOISE_FIGURE_600MHZ_DB[v];
  if (!Number.isFinite(at600) || at600 <= 0) return 0;
  return Math.max(0, at600 - 27.7 * Math.log10(freqMHz / 600));
}

/**
 * Interference floor rise (dB) from environment.interference ('none'|'quiet'|'typical'|'busy', unset = none). Only for
 * freqMHz >= 2000 (licence-exempt 2.4 / 5.8 GHz bands shared with Wi-Fi etc.); 0 below. It is a separate additive in-band noise
 * power: N_total = N_floor x 10^(rise/10), i.e. the floor moves up by `rise` dB (noise-plus-interference, treated as noise).
 */
export function interferenceRiseDb(env, freqMHz) {
  const v = env && env.interference;
  if (!(freqMHz >= INTERFERENCE_MIN_MHZ) || typeof v !== 'string' || !INTERFERENCE_LEVELS.includes(v)) return 0;
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
    const iip3Dbm = it.kind === 'booster'
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

export function solveLink(scene, link) {
  const f = link.freqMHz;
  const env = scene.environment || {};
  const pol = env.polarisation || 'vertical';
  const lambda = wavelengthM(f);
  const rawPaths = tracePaths(scene, link);

  let sumRe = 0, sumIm = 0;
  const paths = rawPaths.map((p) => {
    const gt = antennaGainDb(link.tx.antenna, p.departureBearing);
    const gr = antennaGainDb(link.rx.antenna, p.arrivalBearing);
    // Amplitude (relative to sqrt power): Friis lambda/(4 pi d) * sqrt(Gt Gr) * product of Gamma
    let amp = lambda / (4 * Math.PI * Math.max(p.lengthM, 1e-3)) * Math.pow(10, (gt + gr) / 20);
    let re = 1, im = 0;
    p.reflections.forEach((r, i) => {
      const a = p.points[i], b = p.points[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const len = Math.hypot(dx, dy, dz);
      let g;
      if (r.type === 'floor') {
        g = floorReflection(floorSurfaceAt(scene, r.point.x, r.point.y), pol, Math.asin(Math.min(Math.abs(dz) / len, 1)) / DEG, f);
      } else {
        const w = allReflectors(scene).find((x) => x.id === r.via);
        const fr = wallFrame(w);
        const cosInc = Math.min(Math.abs(dx * fr.nx + dy * fr.ny) / len, 1);
        g = reflectorCoefficient(w.material, Math.acos(cosInc) / DEG, pol, f);
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
      ...p, ...(wl.lossDb ? { wallLossDb: wl.lossDb, crossedWalls: wl.crossed, wallLossDetail: wl.detail } : {}),
      ...(wl.platformLossDb ? { platformLossDb: wl.platformLossDb, platformChords: wl.platforms } : {}),
      gainDb: db20(Math.hypot(cre, cim)), phaseRad: Math.atan2(cim, cre), _gt: gt, _gr: gr,
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
  const chainSteps = (list = chain) => list.forEach((it) => step(chainLabel(it), -chainItemLossDb(it, f)));
  const iem = link.kind === 'iem';
  // IEM only: optional link.rx.chain = items between the bodypack antenna and the bodypack (cable, LNA, filter).
  const rxChain = iem && Array.isArray(link.rx.chain) ? link.rx.chain : [];
  if (iem) chainSteps(); // transmitter -> chain -> Tx antenna
  const txOutDbm = level;
  step('Tx antenna gain', direct._gt);
  step(`Free-space loss (${formatLength(distanceM, scene && scene.units && scene.units.length)})`, -fspl);
  const directPlatformDb = direct.platformLossDb || 0;
  if (directWallDb - directPlatformDb > 1e-12) step('Wall transmission', -(directWallDb - directPlatformDb));
  if (directPlatformDb) step('Platform obstruction', -directPlatformDb);
  if (Math.abs(multipathDb) > 1e-9) step('Multipath (coherent sum)', multipathDb);
  step('Rx antenna gain', direct._gr);
  const body = (env.bodyLossDb || 0) + (link.rx.bodyLossDb || 0);
  if (body) step('Body loss', -body);
  if (env.fadeMarginDb) step('Fade margin', -env.fadeMarginDb);
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
  cascade.marginAtAntennaDb = rxPowerDbm - cascade.sensitivityAtAntennaDbm;
  const marginDb = cascade.marginAtAntennaDb;
  const status = marginDb >= 6 ? 'pass' : marginDb >= 0 ? 'marginal' : 'fail';
  paths.forEach((p) => { delete p._gt; delete p._gr; });

  return { distanceM, paths, pathLossDb, fsplDb: fspl, rxPowerDbm, waterfall: wf, inputPowerDbm, marginDb, status, cascade, requiredSnrDb: cascade.requiredSnrDb };
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
  const body = (env.bodyLossDb || 0) + (link.rx.bodyLossDb || 0) + (env.fadeMarginDb || 0);
  const lambda = wavelengthM(link.freqMHz);
  return {
    split,
    items: branches.map((br) => {
      const bl = branchLinkOf(link, br, { x: 0, y: 0, z: 0 }, split);
      bl.rx = { ...link.rx, pos: { x: 0, y: 0, z: 0 } }; // mutable rx point reused for every cell
      return {
        bl,
        off: bl.tx.powerDbm - chainLossDb(br.chain, link.freqMHz) - body,
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
