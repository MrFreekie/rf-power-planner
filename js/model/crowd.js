// Crowd (audience) absorption zones: a polygon in plan view with a mode, applied per ray as an excess loss. Pure functions, no DOM.
//
// scene.crowds = [{ id, name?, polygon: [{x, y}, ...], mode: 'seated'|'standing'|'packed', densityPerM2?, headHeightM?, kDbPerM?, lMaxDb? }]
// (x, y) in scene metres, the same axes as zones and platforms. Optional field: scenes without it load and solve exactly as before.
// Older scenes held rectangular audience areas in scene.audience; migrateScene turns each into a crowd zone (scene.js).
//
// Model (an engineering estimate, not a measurement; see CROWD_CAVEAT):
//   L_dB = s * min( k * d_in , L_max )                                       (saturating per-metre excess loss)
//   d_in  = length (m) of the ray inside the polygon (3D length of the part of the segment whose plan position is inside)
//   k     = kDbPerM override, else 0.9 * densityPerM2 when a density is given, else the mode default (1.8 / 2.7 / 4.0 dB per m)  [ASSUMED]
//   L_max = lMaxDb override (capped at 26 dB, the largest single-body shadow loss measured at 900 MHz, Badi et al.) else mode default 15 / 20 / 22 dB [INFERRED]
//   s     = clearance factor from the height of the ray above head height c = z - h_head (z at the middle of the chord):
//           s = 1 for c <= 0, s = 0 for c >= 0.6 F1, linear in between (Fresnel zone ramp, INFERRED)
//   F1    = sqrt( lambda d1 d2 / (d1 + d2) )   first Fresnel zone radius (Fresnel), d1 and d2 = path distance from the chord to the two ends
//   h_head = 1.2 m seated, 1.75 m standing and packed (ASSUMED anthropometry), or headHeightM
// No frequency term: the same loss is used at every frequency (no data supports one between 470 and 900 MHz).
// A chord with a partial overlap is handled per chord: a crowd's loss over a whole path is
//   L = min( sum k d_i , L_max ) * ( sum s_i k d_i / sum k d_i )
// which equals the formula above for one chord. A floor reflection that passes the crowd twice therefore cannot exceed L_max for that crowd.
// Several crowds add; the total on one path is capped at CROWD_MAX_LOSS_DB (26 dB: more than one body's worst shadow is not supported by evidence).
// Wearer body effect (ECC 286) is a separate step in the link budget and is never touched here. Calibration (measurements.js) fits wall, body and
// polarisation offsets on top of this model: if a crowd was in the room during a walk test, the fit may absorb some of its loss.

export const CROWD_MODES = Object.freeze(['seated', 'standing', 'packed']);
export const CROWD_MAX = 30;            // max crowds in a scene (also SCENE_LIMITS.maxCrowds)
export const CROWD_POINTS_MAX = 64;     // max polygon points per crowd (also SCENE_LIMITS.maxCrowdPoints)
export const CROWD_MAX_LOSS_DB = 26;    // upper bound for any L_max and for the total on one path (Badi 2022, single body, 900 MHz, max)
export const CROWD_RAMP_FRACTION = 0.6; // s falls to 0 at c = 0.6 F1

/** Defaults per mode. k and lMax are slider ranges (low, high) around the default. */
export const CROWD_DEFAULTS = Object.freeze({
  seated: Object.freeze({ densityPerM2: 2, kDbPerM: 1.8, lMaxDb: 15, headHeightM: 1.2, kRange: [1.0, 2.7], lMaxRange: [10, 20] }),
  standing: Object.freeze({ densityPerM2: 3, kDbPerM: 2.7, lMaxDb: 20, headHeightM: 1.75, kRange: [1.5, 4.0], lMaxRange: [12, 26] }),
  packed: Object.freeze({ densityPerM2: 5, kDbPerM: 4.0, lMaxDb: 22, headHeightM: 1.75, kRange: [2.5, 6.0], lMaxRange: [15, 26] }),
});
/**
 * Density presets (persons per m2) for the crowd form. Sourced: the Green Guide recommended maximum standing density 4.0 per m2 (SGSA, via a
 * University of Greenwich egress study) and about 4.7 per m2 observed in and around Wembley (G. K. Still); flag S. The others are planning values, flag U.
 */
export const CROWD_DENSITY_PRESETS = Object.freeze([
  { id: 'sparse', label: 'Sparse', densityPerM2: 0.5, flag: 'U' },
  { id: 'standing', label: 'Standing, normal', densityPerM2: 2, flag: 'U' },
  { id: 'dense', label: 'Dense', densityPerM2: 3.5, flag: 'U' },
  { id: 'green-guide', label: 'Green Guide maximum standing (limit)', densityPerM2: 4.0, flag: 'S' },
  { id: 'pit', label: 'Front-of-stage pit (observed)', densityPerM2: 4.7, flag: 'S' },
  { id: 'max', label: 'Very dense (planning maximum)', densityPerM2: 5, flag: 'U' },
]);
export const CROWD_DENSITY_TO_K = 0.9; // dB per metre per (person per m2), ASSUMED
/** Accepted ranges of the optional fields (validated in scene.js, clamped in actions). */
export const CROWD_LIMITS = Object.freeze({ densityPerM2: [0.1, 8], headHeightM: [0.3, 2.5], kDbPerM: [0.1, 10], lMaxDb: [1, CROWD_MAX_LOSS_DB], nameChars: 80 });

/** Confidence labels: S = sourced, I = inferred, A = assumed. */
export const CROWD_CONFIDENCE = Object.freeze([
  { id: 'single-body-ecc286', label: 'Single body effect, ECC Report 286 coefficients (wearer, dBd)', flag: 'S' },
  { id: 'single-body-shadow', label: 'Single body shadow 9 to 26 dB at 500 to 900 MHz (Badi, SMU)', flag: 'S' },
  { id: 'lmax-bound', label: 'Loss cap upper bound 26 dB', flag: 'S' },
  { id: 'lmax-defaults', label: 'Loss cap defaults 15 / 20 / 22 dB', flag: 'I' },
  { id: 'crowd-5ghz', label: 'Crowd median 7.2 dB at 5 GHz (only direct crowd datum, wrong band)', flag: 'S' },
  { id: 'clearance', label: 'Clearance ramp with the Fresnel factor and head heights', flag: 'I' },
  { id: 'density', label: 'Density values', flag: 'A' },
  { id: 'k-slope', label: 'Slope k (dB per metre) and k = 0.9 x density', flag: 'A' },
  { id: 'above-900', label: 'Behaviour above 900 MHz', flag: 'A' },
]);
/** Caveat for the UI and docs (short). */
export const CROWD_CAVEAT = 'Crowd loss is an estimate. It saturates at roughly the loss of one body in the path (about 15-26 dB at 500-900 MHz, measured for single people). The per-metre slope is an engineering assumption: no published measurement of audience attenuation per metre at UHF exists. Treat results as a planning margin and verify with an on-site scan. Place receive antennas at least 1-2 m above the audience heads.';
/** Note for the calibration dialog when a scene has crowds. */
export const CROWD_CALIBRATION_NOTE = 'This scene has crowd zones. Readings taken with an audience in the room already include their absorption, so a fitted wall or body figure may absorb part of it: take calibration readings with the same audience state as the model.';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const C_MPS_MHZ = 299.792458; // lambda (m) = 299.792458 / f (MHz)

/** crowdParams(crowd) -> { mode, densityPerM2, kDbPerM, lMaxDb, headHeightM } with defaults and overrides resolved (invalid values fall back). */
export function crowdParams(c) {
  const mode = c && CROWD_MODES.includes(c.mode) ? c.mode : 'standing';
  const d = CROWD_DEFAULTS[mode];
  const L = CROWD_LIMITS;
  const rho = isNum(c && c.densityPerM2) ? clamp(c.densityPerM2, L.densityPerM2[0], L.densityPerM2[1]) : null;
  let k = d.kDbPerM;
  if (isNum(c && c.kDbPerM)) k = clamp(c.kDbPerM, L.kDbPerM[0], L.kDbPerM[1]);
  else if (rho !== null) k = CROWD_DENSITY_TO_K * rho;
  const lMaxDb = isNum(c && c.lMaxDb) ? clamp(c.lMaxDb, L.lMaxDb[0], L.lMaxDb[1]) : d.lMaxDb;
  const headHeightM = isNum(c && c.headHeightM) ? clamp(c.headHeightM, L.headHeightM[0], L.headHeightM[1]) : d.headHeightM;
  return { mode, densityPerM2: rho !== null ? rho : d.densityPerM2, kDbPerM: k, lMaxDb, headHeightM };
}

/** First Fresnel zone radius (m) at a point d1 and d2 metres from the two ends: F1 = sqrt(lambda d1 d2 / (d1 + d2)). */
export function fresnelF1(freqMHz, d1, d2) {
  const sum = d1 + d2;
  return sum > 0 && d1 > 0 && d2 > 0 ? Math.sqrt((C_MPS_MHZ / freqMHz) * d1 * d2 / sum) : 0;
}

/** Clearance factor s in [0, 1]: 1 when the ray is at or below head height, 0 at 0.6 F1 above it, linear between. */
export function crowdClearanceFactor(zRayM, headHeightM, f1M) {
  const c = zRayM - headHeightM;
  if (c <= 0) return 1;
  const top = CROWD_RAMP_FRACTION * f1M;
  if (!(top > 0) || c >= top) return 0;
  return 1 - c / top;
}

/**
 * polygonSegmentInside(polygon, A, B) -> [{ t0, t1 }]: the parameter intervals (0..1 along A->B in plan view) whose points lie inside the
 * polygon (even-odd rule, so concave polygons work). A and B need x, y. Pure plan-view geometry.
 */
export function polygonSegmentInside(polygon, A, B) {
  if (!Array.isArray(polygon) || polygon.length < 3) return [];
  const dx = B.x - A.x, dy = B.y - A.y;
  const ts = [0, 1];
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const P = polygon[i], Q = polygon[(i + 1) % n];
    const ex = Q.x - P.x, ey = Q.y - P.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue; // parallel
    const px = P.x - A.x, py = P.y - A.y;
    const t = (px * ey - py * ex) / den;
    const u = (px * dy - py * dx) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
  }
  ts.sort((a, b) => a - b);
  const out = [];
  for (let i = 1; i < ts.length; i++) {
    const t0 = ts[i - 1], t1 = ts[i];
    if (t1 - t0 < 1e-12) continue;
    const tm = (t0 + t1) / 2, mx = A.x + tm * dx, my = A.y + tm * dy;
    if (pointInPolygon(polygon, mx, my)) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.t1 - t0) < 1e-12) last.t1 = t1; else out.push({ t0, t1 });
    }
  }
  return out;
}

/** Even-odd point in polygon test. */
export function pointInPolygon(polygon, x, y) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Polygon area (m2), absolute value of the shoelace sum. */
export function polygonAreaM2(polygon) {
  let s = 0;
  for (let i = 0; i < polygon.length; i++) { const a = polygon[i], b = polygon[(i + 1) % polygon.length]; s += a.x * b.y - b.x * a.y; }
  return Math.abs(s) / 2;
}

/**
 * crowdPathLoss(scene, points, freqMHz) -> { lossDb, chords, crowds }
 *   points = the polyline of a path ({x, y, z} absolute metres: direct ray, or ray with its reflection points).
 *   chords = [{ id, name, mode, leg, lengthM, zMidM, d1M, d2M, f1M, clearance, headHeightM }] one per inside piece (inside length in 3D)
 *   crowds = [{ id, name, mode, lengthM, kDbPerM, lMaxDb, clearance (weighted), rawDb (k d before cap), lossDb, capped }] for crowds the path touches
 * lossDb is 0 and the arrays are empty for scenes without crowds.
 */
export function crowdPathLoss(scene, points, freqMHz) {
  const list = scene && scene.crowds;
  if (!Array.isArray(list) || !list.length || !Array.isArray(points) || points.length < 2) return { lossDb: 0, chords: [], crowds: [] };
  const legLen = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) { const a = points[i - 1], b = points[i]; const l = Math.hypot(b.x - a.x, b.y - a.y, (b.z || 0) - (a.z || 0)); legLen.push(l); total += l; }
  if (!(total > 1e-12)) return { lossDb: 0, chords: [], crowds: [] };
  const chords = [], crowds = [];
  let sum = 0;
  for (const c of list) {
    if (!c || !Array.isArray(c.polygon)) continue;
    const p = crowdParams(c);
    let rawDb = 0, weighted = 0, lengthM = 0;
    const mine = [];
    let before = 0;
    for (let i = 1; i < points.length; i++) {
      const A = points[i - 1], B = points[i], len = legLen[i - 1];
      if (len > 1e-12) {
        for (const iv of polygonSegmentInside(c.polygon, A, B)) {
          const dIn = (iv.t1 - iv.t0) * len;
          if (!(dIn > 1e-9)) continue;
          const tm = (iv.t0 + iv.t1) / 2;
          const zMid = (A.z || 0) + tm * ((B.z || 0) - (A.z || 0));
          const d1 = before + tm * len, d2 = total - d1;
          const f1 = fresnelF1(freqMHz, d1, d2);
          const z0 = (A.z || 0) + iv.t0 * ((B.z || 0) - (A.z || 0)), z1 = (A.z || 0) + iv.t1 * ((B.z || 0) - (A.z || 0));
          const s = clearanceShare(z0, z1, p.headHeightM, CROWD_RAMP_FRACTION * f1); // exact share of the chord below the heads, including the ramp
          rawDb += p.kDbPerM * dIn; weighted += s * p.kDbPerM * dIn; lengthM += dIn;
          mine.push({ id: c.id, name: c.name, mode: p.mode, leg: i - 1, lengthM: dIn, zMidM: zMid, d1M: d1, d2M: d2, f1M: f1, clearance: s, headHeightM: p.headHeightM });
        }
      }
      before += len;
    }
    if (!mine.length) continue;
    const eff = rawDb > 0 ? weighted / rawDb : 0;
    const lossDb = Math.min(rawDb, p.lMaxDb) * eff;
    chords.push(...mine);
    crowds.push({ id: c.id, name: c.name, mode: p.mode, lengthM, kDbPerM: p.kDbPerM, lMaxDb: p.lMaxDb, clearance: eff, rawDb, lossDb, capped: rawDb > p.lMaxDb });
    sum += lossDb;
  }
  return { lossDb: Math.min(sum, CROWD_MAX_LOSS_DB), chords, crowds };
}

// Antiderivative of the clearance factor s(z) (1 below h, linear to 0 at h + T, 0 above): S(z) = integral of s from 0 to z.
function clearanceIntegral(z, h, T) {
  if (z <= h) return z;
  if (T > 0 && z < h + T) { const c = z - h; return h + c - (c * c) / (2 * T); }
  return h + Math.max(T, 0) / 2;
}
/** Mean clearance factor over a straight chord running from height z0 to z1 (exact, so a ray that crosses head height inside the crowd counts the part below it fully). */
function clearanceShare(z0, z1, h, T) {
  const frac = Math.abs(z1 - z0) < 1e-12 ? (z0 <= h ? 1 : T > 0 && z0 < h + T ? 1 - (z0 - h) / T : 0) : (clearanceIntegral(z1, h, T) - clearanceIntegral(z0, h, T)) / (z1 - z0);
  return Math.max(0, Math.min(1, frac));
}

/** Plain-language summary (for the assumptions panel and the summary data): one line per crowd on the path plus the caveat. */
export function crowdSummary(res) {
  const r = res && res.crowd;
  if (!r) return null;
  return { lossDb: r.lossDb, lines: r.crowds.map((c) => `${c.name || c.id}: ${c.mode}, ${c.lengthM.toFixed(1)} m in crowd, ${c.lossDb.toFixed(1)} dB${c.capped ? ' (at cap)' : ''}${c.clearance < 1 ? `, antenna height factor ${c.clearance.toFixed(2)}` : ''}`), confidence: CROWD_CONFIDENCE, caveat: CROWD_CAVEAT };
}
