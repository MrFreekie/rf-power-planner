// Pure geometry for rotated platforms (plan and side views). A platform {x, y, width, depth, rotationDeg} is the box whose min
// corner is (x, y), rotated about its own centre. Convention (same as js/model/floor.js and antenna azimuth): local +y maps to
// azimuth rotationDeg, i.e. world offset of local (dx, dy) is (dx*cos + dy*sin, -dx*sin + dy*cos).
const RAD = Math.PI / 180;
const rot = (p) => (p && Number.isFinite(p.rotationDeg) ? p.rotationDeg : 0);
export const platformCentre = (p) => ({ x: p.x + p.width / 2, y: p.y + p.depth / 2 });

/** Local offset from the centre -> world point. */
function toWorld(p, dx, dy) {
  const c0 = platformCentre(p), t = rot(p) * RAD, c = Math.cos(t), s = Math.sin(t);
  return { x: c0.x + dx * c + dy * s, y: c0.y - dx * s + dy * c };
}
/** World point -> local offset from the centre. */
export function worldToLocal(p, x, y) {
  const c0 = platformCentre(p), t = rot(p) * RAD, c = Math.cos(t), s = Math.sin(t), dx = x - c0.x, dy = y - c0.y;
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

/** The 4 world corners in order (min,min), (max,min), (max,max), (min,max) of the unrotated box (matches platformBoxes().corners). */
export function platformCorners(p) {
  const hw = p.width / 2, hd = p.depth / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([dx, dy]) => toWorld(p, dx, dy));
}

/**
 * Resize by dragging a corner (index as in platformCorners) to the world point `ptr`; the opposite corner stays fixed in the world.
 * Returns the new {x, y, width, depth} (rotationDeg is unchanged). Sizes are at least `minSize`. snap(v) optionally rounds sizes.
 */
export function resizeFromCorner(p, corner, ptr, { minSize = 0.2, snap = (v) => v } = {}) {
  const hw = p.width / 2, hd = p.depth / 2;
  const opp = [[hw, hd], [-hw, hd], [-hw, -hd], [hw, -hd]][corner];
  const F = toWorld(p, opp[0], opp[1]);
  // the pointer in the (unchanged) local axes anchored at the fixed corner
  const t = rot(p) * RAD, c = Math.cos(t), s = Math.sin(t);
  const ex = { x: c, y: -s }, ey = { x: s, y: c };
  const dx = ptr.x - F.x, dy = ptr.y - F.y;
  const lx = dx * ex.x + dy * ex.y, ly = dx * ey.x + dy * ey.y;
  const w = Math.max(minSize, snap(Math.abs(lx))), d = Math.max(minSize, snap(Math.abs(ly)));
  const sx = lx >= 0 ? 1 : -1, sy = ly >= 0 ? 1 : -1; // which side of the fixed corner the pointer is on
  const centre = { x: F.x + (ex.x * sx * w + ey.x * sy * d) / 2, y: F.y + (ex.y * sx * w + ey.y * sy * d) / 2 };
  return { x: centre.x - w / 2, y: centre.y - d / 2, width: w, depth: d };
}

/** Azimuth (degrees, 0 = +y, clockwise) of the pointer as seen from the platform centre, optionally snapped to `snapDeg`. Result in [0, 360). */
export function rotationFromPointer(p, ptr, snapDeg = 0) {
  const c0 = platformCentre(p);
  let a = Math.atan2(ptr.x - c0.x, ptr.y - c0.y) / RAD;
  if (snapDeg > 0) a = Math.round(a / snapDeg) * snapDeg;
  return ((Math.round(a * 100) / 100) % 360 + 360) % 360;
}

/** Where the rotation handle sits in world space: beyond the middle of the local +y edge, `extra` metres out. */
export function rotationHandleWorld(p, extra = 0) { return toWorld(p, 0, p.depth / 2 + extra); }

/**
 * Parameter span [t0, t1] where the line S + t*u (u a unit vector in the plan, t = metres along the side-view slice) is inside the
 * rotated rectangle, or null. Used by the side view to draw the platform's chord instead of its bounding box.
 */
export function chordSpan(p, S, u) {
  const a = worldToLocal(p, S.x, S.y);
  const t = rot(p) * RAD, c = Math.cos(t), s = Math.sin(t);
  const d = { x: u.x * c - u.y * s, y: u.x * s + u.y * c };
  const hw = p.width / 2, hd = p.depth / 2;
  let t0 = -Infinity, t1 = Infinity;
  for (const [o, dir, lo, hi] of [[a.x, d.x, -hw, hw], [a.y, d.y, -hd, hd]]) {
    if (Math.abs(dir) < 1e-9) { if (o < lo || o > hi) return null; continue; }
    const q0 = (lo - o) / dir, q1 = (hi - o) / dir;
    t0 = Math.max(t0, Math.min(q0, q1)); t1 = Math.min(t1, Math.max(q0, q1));
  }
  return t1 > t0 ? [t0, t1] : null;
}
