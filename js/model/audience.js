// Audience areas: a crowd as a lossy absorbing layer from the floor up to head height (group e). Pure functions, no DOM.
//
// scene.audience = [{ id, name?, x, y, width, depth, kind: 'standing'|'seated', densityPerM2: 0.1..5, headM?: number }]
// (x, y) = minimum corner of the rectangle in scene metres (same axes as platforms); the crowd stands on the ground, headM is the
// head height above the ground (default standing 1.75 m, seated 1.2 m, ASSUMED anthropometry, the same as crowd.js).
//
// This is the rectangle form of the crowd zones in crowd.js and uses the same rule, constants and ramp (ASSUMED slope, see CROWD_CAVEAT):
//   loss(dB) = min( k x D x L , 26 ) x s,  k = 0.9 dB per metre per person/m2 (CROWD_DENSITY_TO_K)
// L = the length (m) of the ray inside the rectangle (plan view). s = the clearance factor of crowd.js: 1 below head height, falling
// linearly to 0 at 0.6 F1 above it (first Fresnel zone radius at the chord). Here s is integrated exactly along a sloping chord, so a
// ray that crosses head height inside the area counts the part below fully and the part just above partly; without a frequency
// (older callers) the ramp has zero width and the rule is the hard cut at head height. The cap (26 dB, the largest single-body shadow
// measured at 900 MHz, Badi et al.) applies per path. A floor reflection travels through the crowd on both legs, so it is attenuated by
// the same rule: no separate term. Overlapping rectangles add (document: do not overlap). When a scene also has crowd zones the two
// stack but rf.js caps their sum at the same 26 dB.

import { CROWD_DENSITY_TO_K, CROWD_MAX_LOSS_DB, CROWD_DEFAULTS, CROWD_RAMP_FRACTION, fresnelF1 } from './crowd.js';

export const AUDIENCE_KINDS = Object.freeze(['standing', 'seated']);
export const AUDIENCE_HEAD_M = Object.freeze({ standing: CROWD_DEFAULTS.standing.headHeightM, seated: CROWD_DEFAULTS.seated.headHeightM }); // 1.75 / 1.2 m
export const AUDIENCE_DENSITY_LIMITS = Object.freeze([0.1, 5]);
export const AUDIENCE_DB_PER_M_PER_PERSON = CROWD_DENSITY_TO_K; // 0.9, ASSUMED (no published per-metre crowd figure at UHF)
export const AUDIENCE_MAX_LOSS_DB = CROWD_MAX_LOSS_DB;          // 26 dB cap per path (single-body worst case, Badi 2022)
export const AUDIENCE_MAX = 30;                  // max areas (SCENE_LIMITS)
/**
 * Density presets (persons per m2). Ids are kept for saved scenes. Sourced: the Green Guide recommended maximum standing density
 * 4.0 per m2 (SGSA, via a University of Greenwich egress study) and about 4.7 per m2 observed in and around Wembley (G. K. Still);
 * flag S. The others are planning values, flag U.
 */
export const AUDIENCE_DENSITY_PRESETS = Object.freeze([
  { id: 'sparse', label: 'Sparse', densityPerM2: 0.5, flag: 'U' },
  { id: 'seated', label: 'Seated (theatre / arena)', densityPerM2: 2, flag: 'U' },
  { id: 'standing', label: 'Standing, normal', densityPerM2: 2, flag: 'U' },
  { id: 'dense', label: 'Dense', densityPerM2: 3.5, flag: 'U' },
  { id: 'green-guide', label: 'Green Guide maximum standing (limit)', densityPerM2: 4.0, flag: 'S' },
  { id: 'pit', label: 'Front-of-stage pit (observed)', densityPerM2: 4.7, flag: 'S' },
  { id: 'max', label: 'Absolute maximum', densityPerM2: 5, flag: 'U' },
]);

export const audienceHeadM = (a) => (Number.isFinite(a && a.headM) ? a.headM : AUDIENCE_HEAD_M[(a && a.kind) === 'seated' ? 'seated' : 'standing']);
/** Loss rate (dB per metre of path inside the crowd) of an audience area. */
export const audienceDbPerM = (a) => AUDIENCE_DB_PER_M_PER_PERSON * Math.max(0, Math.min(AUDIENCE_DENSITY_LIMITS[1], (a && a.densityPerM2) || 0));

// Antiderivative of the clearance factor s(z) (1 below h, linear to 0 at h + T, 0 above): S(z) = integral of s from 0 to z.
function clearanceIntegral(z, h, T) {
  if (z <= h) return z;
  if (T > 0 && z < h + T) { const c = z - h; return h + c - (c * c) / (2 * T); }
  return h + Math.max(T, 0) / 2;
}

/**
 * audienceChords(scene, A, B, opts?) -> [{ id, lengthM, inAreaM, clearance, lossDb }]: for each audience rectangle the length of the
 * segment A-B inside the rectangle (inAreaM, plan clip, 3D length) and its clearance-weighted length (lengthM = the length below head
 * height plus the ramp share above it), with its uncapped loss k x lengthM. opts = { freqMHz, beforeM, totalM }: the frequency and
 * the position of this segment on the whole path (for the Fresnel radius); without freqMHz the ramp has zero width.
 */
export function audienceChords(scene, A, B, opts = {}) {
  const list = scene && scene.audience;
  if (!Array.isArray(list) || !list.length) return [];
  const dx = B.x - A.x, dy = B.y - A.y, az = A.z || 0, dz = (B.z || 0) - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-12) return [];
  const freq = Number.isFinite(opts.freqMHz) && opts.freqMHz > 0 ? opts.freqMHz : null;
  const before = Number.isFinite(opts.beforeM) ? opts.beforeM : 0;
  const total = Number.isFinite(opts.totalM) && opts.totalM > 0 ? opts.totalM : before + len;
  const out = [];
  for (const a of list) {
    if (!a || !(a.width > 0) || !(a.depth > 0)) continue;
    let t0 = 0, t1 = 1, ok = true;
    for (const [o, d, lo, hi] of [[A.x, dx, a.x, a.x + a.width], [A.y, dy, a.y, a.y + a.depth]]) {
      if (Math.abs(d) < 1e-15) { if (o < lo || o > hi) { ok = false; break; } continue; }
      let ta = (lo - o) / d, tb = (hi - o) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 >= t1) { ok = false; break; }
    }
    if (!ok) continue;
    const h = audienceHeadM(a);
    const tm = (t0 + t1) / 2, d1 = before + tm * len;
    const T = freq ? CROWD_RAMP_FRACTION * fresnelF1(freq, d1, total - d1) : 0;
    const z0 = az + t0 * dz, z1 = az + t1 * dz;
    // fraction of the chord weighted by s: exact for a straight sloping chord
    const frac = Math.abs(z1 - z0) < 1e-12 ? (z0 <= h ? 1 : T > 0 && z0 < h + T ? 1 - (z0 - h) / T : 0)
      : (clearanceIntegral(z1, h, T) - clearanceIntegral(z0, h, T)) / (z1 - z0);
    const inAreaM = (t1 - t0) * len;
    const lengthM = inAreaM * Math.max(0, Math.min(1, frac));
    if (lengthM > 1e-9) out.push({ id: a.id, lengthM, inAreaM, clearance: lengthM / inAreaM, lossDb: lengthM * audienceDbPerM(a) });
  }
  return out;
}

/**
 * Total audience loss (dB) along the polyline `points`, capped at AUDIENCE_MAX_LOSS_DB. Returns { lossDb, chords }. With freqMHz the
 * clearance ramp of crowd.js applies; as in crowd.js the cap is applied to the loss before the clearance weighting, so a ray partly
 * above the heads keeps the same share of the capped loss: lossDb = min(sum k L_in, cap) x (sum k L / sum k L_in).
 */
export function audiencePathLoss(scene, points, freqMHz) {
  const chords = [];
  const legLen = [];
  let totalM = 0;
  for (let i = 1; i < points.length; i++) { const a = points[i - 1], b = points[i]; const l = Math.hypot(b.x - a.x, b.y - a.y, (b.z || 0) - (a.z || 0)); legLen.push(l); totalM += l; }
  let weighted = 0, raw = 0, beforeM = 0;
  const list = (scene && scene.audience) || [];
  for (let i = 1; i < points.length; i++) {
    for (const c of audienceChords(scene, points[i - 1], points[i], { freqMHz, beforeM, totalM })) {
      const a = list.find((x) => x && x.id === c.id);
      weighted += c.lossDb; raw += c.inAreaM * audienceDbPerM(a);
      chords.push({ ...c, leg: i - 1 });
    }
    beforeM += legLen[i - 1];
  }
  const lossDb = raw > 0 ? Math.min(raw, AUDIENCE_MAX_LOSS_DB) * (weighted / raw) : 0;
  return { lossDb, chords };
}
