// First Fresnel zone clearance for mic, IEM and p2p paths (item 33). Pure functions, no DOM. MODEL ONLY: this module reads a scene and a link and
// returns a readout; it adds NO loss to solveLink (see "double counting" below).
//
// Formulas (documented, approximate):
//  * First Fresnel zone radius at distance x from the transmitter on a path of length d (Fresnel zone):  F1(x) = sqrt(lambda x (d - x) / d).
//    The zone is the prolate ellipsoid of revolution about the path with foci at the antennas: semi-major (d + lambda/2)/2, semi-minor
//    sqrt(d lambda / 4 + lambda^2 / 16) = F1(d/2) to first order.
//  * Rule of thumb (ITU-R P.530 / classic microwave planning): keep the path clear of obstacles by 60 percent of F1 for free-space loss.
//    Clearance fraction at sample x = c(x) / F1(x), with c the distance from the path centre line to the nearest point of the obstacle
//    (negative when the centre line is inside it).
//  * Knife-edge loss (informational): an obstacle that cuts the centre line (c <= 0) is a knife edge with v = (-c) sqrt(2 d / (lambda x (d - x))),
//    J(v) per ITU-R P.526 (p2p.js knifeEdgeLossDb). Reported as edgeLossDb, never added to the budget.
//
// Obstacle categories (all in scene metres, absolute heights; link positions are converted with floor.js absolutePos):
//   floor (z = 0, for p2p minus the earth bulge x (d - x) / (2 K R)), stage (the deck box, so the stage lip), platform (risers and other platform boxes,
//   rotation honoured; a platform whose name matches desk|rack|foh|console|mix is reported as 'foh'), audience (rectangle from the floor up to head
//   height), wall (scene.reflectors, vertical rectangles zMin..zMax), ceiling (the ceiling plane and overhead panels; a panel whose name matches truss is
//   reported as 'truss'; the path must stay BELOW them).
//
// Double counting (the choice, documented): the link budget already carries body and crowd shadow (audience.js, a dB per metre rule), platform
// chords (floor.js), wall transmission, and the floor bounce (two-ray). This readout is therefore a geometry DIAGNOSTIC: it flags where the 60 percent
// rule is broken and why, and quotes an indicative knife-edge figure per category with alreadyModelled true/false, but nothing here changes the link
// result. The only categories NOT already in the budget as obstructions are the ceiling and overhead panels (they are reflectors only), so a path
// forced up against them is the one case where edgeLossDb is information the budget lacks. Audience clearance is measured to head height.

import { knifeEdgeLossDb, knifeEdgeV, earthBulgeM, K_STANDARD } from './p2p.js';
import { absolutePos, platformBoxes } from './floor.js';
import { overheadPlanes } from './ceiling.js';
import { audienceHeadM } from './audience.js';

export const FRESNEL_CLEARANCE_FRACTION = 0.6;
export const FRESNEL_SAMPLES = 64;
export const FRESNEL_CATEGORIES = Object.freeze(['floor', 'stage', 'platform', 'foh', 'audience', 'wall', 'ceiling', 'truss', 'obstacle']);
const ALREADY_MODELLED = Object.freeze({ floor: true, stage: true, platform: true, foh: true, audience: true, wall: true, ceiling: false, truss: false, obstacle: true });
const C = 299792458;
const FOH_RE = /desk|rack|foh|console|mix/i, TRUSS_RE = /truss/i;

export const fresnelRadiusM = (xM, dM, freqMHz) => Math.sqrt(((C / (freqMHz * 1e6)) * Math.max(xM, 0) * Math.max(dM - xM, 0)) / Math.max(dM, 1e-9));
/** Ellipsoid semi-axes of the first Fresnel zone: { semiMajorM, semiMinorM }. */
export function fresnelEllipsoid(dM, freqMHz) {
  const lam = C / (freqMHz * 1e6);
  return { semiMajorM: (dM + lam / 2) / 2, semiMinorM: Math.sqrt((dM * lam) / 4 + (lam * lam) / 16) };
}

const clampV = (v, a, b) => Math.min(b, Math.max(a, v));

// distance from point p to an axis-aligned box [lo, hi] (3D); negative inside (minus the distance to the nearest face)
function boxClearance(p, lo, hi) {
  const dx = Math.max(lo[0] - p.x, 0, p.x - hi[0]), dy = Math.max(lo[1] - p.y, 0, p.y - hi[1]), dz = Math.max(lo[2] - p.z, 0, p.z - hi[2]);
  const out = Math.hypot(dx, dy, dz);
  if (out > 0) return out;
  return -Math.min(p.x - lo[0], hi[0] - p.x, p.y - lo[1], hi[1] - p.y, p.z - lo[2], hi[2] - p.z);
}
function toLocal(b, p) { // world -> the box's unrotated frame (floor.js toWorld inverted)
  if (!b.rotationDeg) return p;
  const t = (b.rotationDeg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t), dx = p.x - b.cx, dy = p.y - b.cy;
  return { x: b.cx + dx * c - dy * s, y: b.cy + dx * s + dy * c, z: p.z };
}
// Analytic crossing of the centre line A -> B with a vertical wall rectangle: { s (0..1 along the path), clearance (negative: how deep inside the wall face, m) } or null.
// Sampling alone can step over a thin wall, so the crossing is always evaluated as an extra sample (a crossed wall is blocked whatever the sample count).
function wallCrossing(A, B, p1, p2, zMin, zMax) {
  const rx = B.x - A.x, ry = B.y - A.y, wx = p2.x - p1.x, wy = p2.y - p1.y, den = rx * wy - ry * wx;
  if (Math.abs(den) < 1e-12) return null; // parallel in plan
  const qx = p1.x - A.x, qy = p1.y - A.y;
  const s = (qx * wy - qy * wx) / den, t = (qx * ry - qy * rx) / den;
  if (!(s > 0 && s < 1 && t >= 0 && t <= 1)) return null;
  const z = A.z + s * (B.z - A.z);
  if (z < zMin || z > zMax) return null;
  return { s, clearance: -Math.max(1e-6, Math.min(z - zMin, zMax - z)) };
}
function segClearance(p, a, b, zMin, zMax) { // distance to a vertical wall rectangle
  const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy;
  const t = L2 > 0 ? clampV(((p.x - a.x) * vx + (p.y - a.y) * vy) / L2, 0, 1) : 0;
  const dPlan = Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
  const dz = Math.max(zMin - p.z, 0, p.z - zMax);
  return Math.hypot(dPlan, dz);
}

/** The obstacles of a scene for the readout: [{ id, name, category, clearanceAt(p) }]. */
export function fresnelObstacles(scene, { bulgeAt } = {}) {
  const out = [];
  out.push({ id: 'floor', name: 'Floor', category: 'floor', clearanceAt: (p, x) => p.z - (bulgeAt ? bulgeAt(x) : 0) });
  for (const b of platformBoxes(scene)) {
    const category = b.kind === 'deck' ? 'stage' : FOH_RE.test(String((scene.platforms || []).find((q) => q.id === b.id)?.name || '')) ? 'foh' : 'platform';
    const name = b.kind === 'deck' ? 'Stage deck' : String((scene.platforms || []).find((q) => q.id === b.id)?.name || b.id);
    out.push({ id: b.id, name, category, clearanceAt: (p) => boxClearance(toLocal(b, p), [b.lx0, b.ly0, 0], [b.lx1, b.ly1, b.zTop]) });
  }
  for (const a of scene.audience || []) {
    if (!a || !(a.width > 0) || !(a.depth > 0)) continue;
    const head = audienceHeadM(a);
    out.push({ id: a.id, name: a.name || 'Audience', category: 'audience', clearanceAt: (p) => boxClearance(p, [a.x, a.y, 0], [a.x + a.width, a.y + a.depth, head]) });
  }
  for (const w of scene.reflectors || []) {
    if (!w || !w.p1 || !w.p2) continue;
    const zLo = Number.isFinite(w.zMin) ? w.zMin : 0, zHi = Number.isFinite(w.zMax) ? w.zMax : 4;
    out.push({ id: w.id, name: w.name || 'Wall', category: 'wall', clearanceAt: (p) => segClearance(p, w.p1, w.p2, zLo, zHi), crossingAt: (A, B) => wallCrossing(A, B, w.p1, w.p2, zLo, zHi) });
  }
  for (const pl of overheadPlanes(scene)) {
    const name = pl.id === 'ceiling' ? 'Ceiling' : String(((scene.overheadPanels || []).find((q) => q.id === pl.id) || {}).name || pl.id);
    const category = pl.id === 'ceiling' ? 'ceiling' : TRUSS_RE.test(name) ? 'truss' : 'ceiling';
    out.push({
      id: pl.id, name, category,
      clearanceAt: (p) => { // the path must stay below the plane: inside its rectangle (or with no rectangle) the clearance is vertical, outside it is the 3D distance to the rectangle
        if (!pl.rect) return pl.h - p.z;
        const dx = Math.max(pl.rect.x - p.x, 0, p.x - (pl.rect.x + pl.rect.width)), dy = Math.max(pl.rect.y - p.y, 0, p.y - (pl.rect.y + pl.rect.depth));
        return dx === 0 && dy === 0 ? pl.h - p.z : Math.hypot(dx, dy, pl.h - p.z);
      },
    });
  }
  return out;
}

/**
 * fresnelClearance(scene, link, { freqMHz, fraction = 0.6, samples = 64, tx, rx }) -> {
 *   freqMHz, lambdaM, dM, f1MidM, r60MidM, ellipsoid: { semiMajorM, semiMinorM, semiMinor60M, centre, axis },
 *   minFraction, worst: { category, id, name, fraction, clearanceM, xM } | null, status: 'clear' | 'marginal' | 'blocked', meets60, warnings: [string],
 *   categories: { [category]: { minFraction, clearanceM, xM, id, name, blocked, edgeLossDb, alreadyModelled } },
 *   obstacles: [{ id, name, category, minFraction, clearanceM, xM, blocked, edgeLossDb, alreadyModelled }],
 *   profile: [{ s, xM, uM, z, f1M, r60M, minFraction, limiting }],
 *   geometry: { A, B, plan: { centre: [{x,y}], lens: [{x,y}], lens60: [{x,y}] }, side: { lengthM, centre: [{u,z}], ellipse: [{u,z}], ellipse60: [{u,z}] } } }
 * tx and rx default to the link's antenna positions converted to absolute heights. status: 'blocked' when any centre line sample is inside an obstacle
 * (fraction < 0), 'marginal' when the smallest fraction is under `fraction` (60 percent), else 'clear'. For kind 'p2p' the floor clearance has the
 * earth bulge (K = link.p2p.kFactor or 4/3) subtracted. Nothing here is added to the link budget (see the header).
 */
export function fresnelClearance(scene, link, { freqMHz, fraction = FRESNEL_CLEARANCE_FRACTION, samples = FRESNEL_SAMPLES, tx, rx } = {}) {
  const f = Number.isFinite(freqMHz) && freqMHz > 0 ? freqMHz : (link && Number.isFinite(link.freqMHz) && link.freqMHz > 0 ? link.freqMHz : 600);
  const A = tx || absolutePos(scene, link.tx.pos), B = rx || absolutePos(scene, link.rx.pos);
  const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z, d = Math.max(Math.hypot(dx, dy, dz), 1e-6), L = Math.hypot(dx, dy);
  const lam = C / (f * 1e6);
  const K = link && link.p2p && Number.isFinite(link.p2p.kFactor) ? link.p2p.kFactor : K_STANDARD;
  const bulgeAt = link && link.kind === 'p2p' ? (x) => earthBulgeM(x, d, K) : null;
  const obs = fresnelObstacles(scene, { bulgeAt });
  const N = Math.max(8, Math.min(512, Math.floor(Number.isFinite(samples) ? samples : FRESNEL_SAMPLES)));
  const state = obs.map((o) => ({ o, minFraction: Infinity, clearanceM: Infinity, xM: 0 }));
  const profile = [];
  // unit vectors: path direction u, and in the plan the perpendicular n (horizontal); vertical-plane normal m (perpendicular to u in the vertical plane)
  const ux = dx / d, uy = dy / d, uz = dz / d;
  const nx = L > 1e-9 ? -dy / L : 0, ny = L > 1e-9 ? dx / L : 1;
  for (let i = 1; i < N; i++) {
    const s = i / N, x = s * d, f1 = Math.max(fresnelRadiusM(x, d, f), 1e-9);
    const p = { x: A.x + dx * s, y: A.y + dy * s, z: A.z + dz * s };
    let lim = null, mn = Infinity;
    for (const st of state) {
      const c = st.o.clearanceAt(p, x), fr = c / f1;
      if (fr < st.minFraction) { st.minFraction = fr; st.clearanceM = c; st.xM = x; }
      if (fr < mn) { mn = fr; lim = st.o.id; }
    }
    profile.push({ s, xM: x, uM: s * L, z: p.z, f1M: f1, r60M: fraction * f1, minFraction: mn, limiting: lim });
  }
  // Walls: the analytic crossing of the centre line is its own sample (negative clearance, so the path is reported blocked).
  for (const st of state) {
    const cr = st.o.crossingAt && st.o.crossingAt(A, B);
    if (!cr) continue;
    const x = cr.s * d, fr = cr.clearance / Math.max(fresnelRadiusM(x, d, f), 1e-9);
    if (fr < st.minFraction) { st.minFraction = fr; st.clearanceM = cr.clearance; st.xM = x; }
  }
  // p2p only: link.p2p.obstacle { distanceM, heightM } is a knife edge (a hill) at one distance: the clearance is measured there exactly (the sampling above
  // could miss it) and is the SAME quantity p2p.js p2pGeometry uses (line of sight minus earth bulge minus the obstacle height), so both modules agree.
  const ob = link && link.kind === 'p2p' && link.p2p && link.p2p.obstacle;
  if (ob && Number.isFinite(ob.distanceM) && Number.isFinite(ob.heightM) && ob.distanceM > 0 && ob.distanceM < d) {
    const x = ob.distanceM, zLos = A.z + dz * (x / d), c = zLos - earthBulgeM(x, d, K) - ob.heightM;
    state.push({ o: { id: 'obstacle', name: 'Obstacle (hill)', category: 'obstacle' }, minFraction: c / Math.max(fresnelRadiusM(x, d, f), 1e-9), clearanceM: c, xM: x });
  }
  const results = state.map((st) => {
    const blocked = st.minFraction < 0;
    const v = blocked ? knifeEdgeV(-st.clearanceM, Math.max(st.xM, 1e-6), d, f) : -Infinity;
    return { id: st.o.id, name: st.o.name, category: st.o.category, minFraction: st.minFraction, clearanceM: st.clearanceM, xM: st.xM, blocked, edgeLossDb: blocked ? knifeEdgeLossDb(v) : 0, alreadyModelled: ALREADY_MODELLED[st.o.category] };
  });
  const categories = {};
  for (const r of results) {
    const c = categories[r.category];
    if (!c || r.minFraction < c.minFraction) categories[r.category] = { minFraction: r.minFraction, clearanceM: r.clearanceM, xM: r.xM, id: r.id, name: r.name, blocked: r.blocked, edgeLossDb: r.edgeLossDb, alreadyModelled: r.alreadyModelled };
  }
  const w = results.reduce((a, r) => (!a || r.minFraction < a.minFraction ? r : a), null);
  const minFraction = w ? w.minFraction : Infinity;
  const status = minFraction < 0 ? 'blocked' : minFraction < fraction ? 'marginal' : 'clear';
  const warnings = [];
  const mid = fresnelRadiusM(d / 2, d, f);
  for (const [cat, c] of Object.entries(categories)) {
    if (c.minFraction >= fraction) continue;
    const where = `${c.name} at ${c.xM.toFixed(1)} m from the transmitter`;
    if (c.blocked) warnings.push(`${cat}: the path is inside ${where} (clearance ${c.clearanceM.toFixed(2)} m, ${(c.minFraction * 100).toFixed(0)} percent of the first Fresnel zone).${c.alreadyModelled ? ' Its loss is already in the link budget.' : ' Not in the link budget: indicative knife-edge loss ' + c.edgeLossDb.toFixed(1) + ' dB.'}`);
    else warnings.push(`${cat}: ${where} leaves ${(c.minFraction * 100).toFixed(0)} percent of the first Fresnel zone (${c.clearanceM.toFixed(2)} m), under the ${(fraction * 100).toFixed(0)} percent rule.${c.alreadyModelled ? '' : ' Not in the link budget.'}`);
  }
  // drawing geometry
  const M = 24;
  const plan = { centre: [{ x: A.x, y: A.y }, { x: B.x, y: B.y }], lens: [], lens60: [] };
  const side = { lengthM: L, centre: [{ u: 0, z: A.z }, { u: L, z: B.z }], ellipse: [], ellipse60: [] };
  const ring = (k) => {
    const left = [], right = [], top = [], bot = [];
    for (let i = 0; i <= M; i++) {
      const s = i / M, x = s * d, r = k * fresnelRadiusM(x, d, f);
      const px = A.x + dx * s, py = A.y + dy * s, pz = A.z + dz * s;
      left.push({ x: px + nx * r, y: py + ny * r }); right.push({ x: px - nx * r, y: py - ny * r });
      top.push({ u: s * L - uz * r, z: pz + (L / d) * r }); // the normal in the vertical plane is (-uz along the plan direction, L / d up)
      bot.push({ u: s * L + uz * r, z: pz - (L / d) * r });
    }
    return { lens: [...left, ...right.reverse()], ell: [...top, ...bot.reverse()] };
  };
  const r1 = ring(1), r6 = ring(fraction);
  plan.lens = r1.lens; plan.lens60 = r6.lens; side.ellipse = r1.ell; side.ellipse60 = r6.ell;
  const ell = fresnelEllipsoid(d, f);
  return {
    freqMHz: f, lambdaM: lam, dM: d, f1MidM: mid, r60MidM: fraction * mid,
    ellipsoid: { ...ell, semiMinor60M: fraction * ell.semiMinorM, centre: { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, z: (A.z + B.z) / 2 }, axis: { x: ux, y: uy, z: uz } },
    minFraction, worst: w ? { category: w.category, id: w.id, name: w.name, fraction: w.minFraction, clearanceM: w.clearanceM, xM: w.xM } : null,
    status, meets60: minFraction >= fraction, warnings, categories, obstacles: results, profile, geometry: { A, B, plan, side },
  };
}

/** fresnelForScene(scene, opts) -> { [linkId]: fresnelClearance(...) } for every link with a transmitter and receiver position. */
export function fresnelForScene(scene, opts = {}) {
  const out = {};
  for (const l of (scene && scene.links) || []) if (l && l.tx && l.rx && l.tx.pos && l.rx.pos) out[l.id] = fresnelClearance(scene, l, opts);
  return out;
}
