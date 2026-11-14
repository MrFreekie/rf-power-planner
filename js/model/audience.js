// Audience areas: a crowd as a lossy absorbing layer from the floor up to head height (group e). Pure functions, no DOM.
//
// scene.audience = [{ id, name?, x, y, width, depth, kind: 'standing'|'seated', densityPerM2: 0.1..5, headM?: number }]
// (x, y) = minimum corner of the rectangle in scene metres (same axes as platforms); the crowd stands on the ground, headM is the
// head height above the ground (default standing 1.7 m, seated 1.2 m, ASSUMED round numbers).
//
// Physics (ASSUMED, approximate, UNVERIFIED against measurements: the human body is a lossy water-rich absorber at UHF, so a ray that
// passes through a crowd below head height loses power in proportion to the length of path inside the crowd and to the number of
// bodies per square metre). Model: excess loss = AUDIENCE_DB_PER_M_PER_PERSON x density x L, L = the length (m) of the ray inside the
// rectangle and below head height. Capped at AUDIENCE_MAX_LOSS_DB per path (the ray then diffracts over and around the heads; real
// crowds show a similar saturating behaviour). A ray above head height all the way (flown antenna, raised receiver) is not
// attenuated. A floor reflection travels through the crowd on both legs, so it is attenuated by the same rule: no separate term.
// Overlapping rectangles add (document: do not overlap). Source for the order of magnitude: published body-shadowing / crowd-attenuation
// measurements at UHF show several dB for the first rows and a saturating total (flag: check before use for real planning).
//   loss(dB) = min( k x D x L , 30 ),  k = 0.5 dB per metre per person/m2

export const AUDIENCE_KINDS = Object.freeze(['standing', 'seated']);
export const AUDIENCE_HEAD_M = Object.freeze({ standing: 1.7, seated: 1.2 });
export const AUDIENCE_DENSITY_LIMITS = Object.freeze([0.1, 5]);
export const AUDIENCE_DB_PER_M_PER_PERSON = 0.5; // ASSUMED
export const AUDIENCE_MAX_LOSS_DB = 30;          // ASSUMED cap per path
export const AUDIENCE_MAX = 30;                  // max areas (SCENE_LIMITS)
/** Density presets (persons per m2). RECALLED from crowd-safety guidance, UNVERIFIED: check the Green Guide and Fruin before shipping. */
export const AUDIENCE_DENSITY_PRESETS = Object.freeze([
  { id: 'sparse', label: 'Sparse', densityPerM2: 0.5, flag: 'U' },
  { id: 'seated', label: 'Seated (theatre / arena)', densityPerM2: 2, flag: 'U' },
  { id: 'standing', label: 'Standing, normal', densityPerM2: 2, flag: 'U' },
  { id: 'dense', label: 'Dense', densityPerM2: 3.5, flag: 'U' },
  { id: 'pit', label: 'Front-of-stage pit', densityPerM2: 4.7, flag: 'U' },
  { id: 'max', label: 'Absolute maximum', densityPerM2: 5, flag: 'U' },
]);

export const audienceHeadM = (a) => (Number.isFinite(a && a.headM) ? a.headM : AUDIENCE_HEAD_M[(a && a.kind) === 'seated' ? 'seated' : 'standing']);
/** Loss rate (dB per metre of path inside the crowd) of an audience area. */
export const audienceDbPerM = (a) => AUDIENCE_DB_PER_M_PER_PERSON * Math.max(0, Math.min(AUDIENCE_DENSITY_LIMITS[1], (a && a.densityPerM2) || 0));

/**
 * audienceChords(scene, A, B) -> [{ id, lengthM, lossDb }]: for each audience rectangle the length of the segment A-B inside the
 * rectangle and below head height (absolute heights above the ground in A.z, B.z), with its loss (uncapped per area).
 */
export function audienceChords(scene, A, B) {
  const list = scene && scene.audience;
  if (!Array.isArray(list) || !list.length) return [];
  const dx = B.x - A.x, dy = B.y - A.y, az = A.z || 0, dz = (B.z || 0) - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-12) return [];
  const out = [];
  for (const a of list) {
    if (!a || !(a.width > 0) || !(a.depth > 0)) continue;
    let t0 = 0, t1 = 1, ok = true;
    for (const [o, d, lo, hi] of [[A.x, dx, a.x, a.x + a.width], [A.y, dy, a.y, a.y + a.depth], [az, dz, -Infinity, audienceHeadM(a)]]) {
      if (Math.abs(d) < 1e-15) { if (o < lo || o > hi) { ok = false; break; } continue; }
      let ta = (lo - o) / d, tb = (hi - o) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 >= t1) { ok = false; break; }
    }
    if (!ok) continue;
    const lengthM = (t1 - t0) * len;
    if (lengthM > 1e-9) out.push({ id: a.id, lengthM, lossDb: lengthM * audienceDbPerM(a) });
  }
  return out;
}

/** Total audience loss (dB) along the polyline `points`, capped at AUDIENCE_MAX_LOSS_DB. Returns { lossDb, chords }. */
export function audiencePathLoss(scene, points) {
  const chords = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) for (const c of audienceChords(scene, points[i - 1], points[i])) { total += c.lossDb; chords.push({ ...c, leg: i - 1 }); }
  return { lossDb: Math.min(total, AUDIENCE_MAX_LOSS_DB), chords };
}
