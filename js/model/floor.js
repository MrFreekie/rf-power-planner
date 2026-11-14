// Stage deck height and raised platforms. Pure module (no DOM).
//
// scene.stage = { width, depth, heightM }   deck height above the venue ground (default 0), rectangle x 0..width, y 0..depth.
// scene.platforms = [{ id, name, x, y, width, depth, topM, material, rotationDeg? }]   rectangles, topM = top surface height
//   ABOVE GROUND (may sit on the deck: stage 1.2 and a drum riser with topM 1.6).
// ROTATION CONVENTION: (x, y) is the min-x / min-y CORNER of the UNROTATED box; the box spans x..x+width, y..y+depth. rotationDeg
//   (optional, -180..180, unset = 0) rotates the rectangle about its CENTRE (x + width/2, y + depth/2), as an azimuth: 0 = +y,
//   positive = clockwise seen from above (the antenna convention), so the box's +y side points at azimuth rotationDeg.
//   A local direction (lx, ly) maps to the world direction (lx cos t + ly sin t, -lx sin t + ly cos t); the inverse
//   (world -> local, used for every inside test, ray chord and face) is lx = dx cos t - dy sin t, ly = dx sin t + dy cos t,
//   with (dx, dy) measured from the centre. Rotation 0 takes the original code path (no arithmetic on the numbers), so
//   unrotated scenes give bit-identical results. The deck is never rotated.
// Item positions (tx, rx, antennas, branches, imd transmitters, antennaB) keep pos.z = HEIGHT ABOVE THE LOCAL FLOOR.
// Absolute height of an item = floorHeightAt(scene, x, y) + pos.z.

const EPS = 1e-9;

/** True when the scene has a raised deck or any platform; false means every floor function is the flat floor z = 0. */
export function hasFloorFeatures(scene) {
  if (!scene) return false;
  return (scene.stage && scene.stage.heightM > 0) || (Array.isArray(scene.platforms) && scene.platforms.length > 0) || stageMaterialDiffers(scene);
}

/** Optional stage.material: the deck surface when it differs from environment.floor (the venue floor). Unset = same as the venue floor. */
export function stageMaterialDiffers(scene) {
  const m = scene && scene.stage && scene.stage.material;
  return typeof m === 'string' && m !== '' && m !== (scene.environment ? scene.environment.floor : undefined);
}
/** Material of the stage deck: stage.material when set, else environment.floor. */
export function stageSurface(scene) {
  const m = scene && scene.stage && scene.stage.material;
  return typeof m === 'string' && m !== '' ? m : (scene && scene.environment ? scene.environment.floor : undefined);
}

function inRect(x, y, x0, y0, w, d) {
  return x >= x0 - EPS && x <= x0 + w + EPS && y >= y0 - EPS && y <= y0 + d + EPS;
}

/** Rotation of a platform in degrees (finite number, else 0). */
export const platformRotationDeg = (p) => (p && Number.isFinite(p.rotationDeg) ? p.rotationDeg : 0);

/** World -> local frame of a rotated rectangle: { x, y } measured from the unrotated corner. Rotation 0 returns the point unchanged. */
function toLocal(rot, cx, cy, x, y) {
  if (!rot) return { x, y };
  const t = (rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t), dx = x - cx, dy = y - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}
/** Local -> world (inverse of toLocal). */
function toWorld(rot, cx, cy, x, y) {
  if (!rot) return { x, y };
  const t = (rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t), dx = x - cx, dy = y - cy;
  return { x: cx + dx * c + dy * s, y: cy - dx * s + dy * c };
}

/** True when (x, y) lies inside platform p (rotation honoured). */
export function pointInPlatform(p, x, y) {
  const rot = platformRotationDeg(p);
  if (!rot) return inRect(x, y, p.x, p.y, p.width, p.depth);
  const q = toLocal(rot, p.x + p.width / 2, p.y + p.depth / 2, x, y);
  return inRect(q.x, q.y, p.x, p.y, p.width, p.depth);
}

/** Local floor height above ground at (x, y): the highest of the deck (inside its rectangle) and every platform containing the point; else 0. */
export function floorHeightAt(scene, x, y) {
  if (!hasFloorFeatures(scene)) return 0;
  let h = 0;
  const st = scene.stage;
  if (st && st.heightM > 0 && inRect(x, y, 0, 0, st.width, st.depth)) h = st.heightM;
  for (const p of scene.platforms || []) {
    if (p && p.topM > h && pointInPlatform(p, x, y)) h = p.topM;
  }
  return h;
}

/** Material id of the floor surface at (x, y): the platform that supplies the floor height, else environment.floor. */
export function floorSurfaceAt(scene, x, y) {
  const base = scene && scene.environment ? scene.environment.floor : undefined;
  if (!hasFloorFeatures(scene)) return base;
  let h = 0, mat = base;
  const st = scene.stage;
  if (st && inRect(x, y, 0, 0, st.width, st.depth)) mat = stageSurface(scene);
  if (st && st.heightM > 0 && inRect(x, y, 0, 0, st.width, st.depth)) h = st.heightM;
  for (const p of scene.platforms || []) {
    if (p && p.topM > h && pointInPlatform(p, x, y)) { h = p.topM; mat = p.material || base; }
  }
  return mat;
}

const absPos = (scene, pos) => (pos ? { ...pos, z: floorHeightAt(scene, pos.x, pos.y) + (pos.z || 0) } : pos);

/** Absolute copy of a position object (z = local floor + z). Flat scene: the same object. */
export function absolutePos(scene, pos) {
  return hasFloorFeatures(scene) ? absPos(scene, pos) : pos;
}

const ABSOLUTE = new WeakSet(); // scenes already converted
const CACHE = new WeakMap();

/**
 * withAbsoluteHeights(scene) -> a scene whose positioned items (link tx/rx, rx.diversity.antennaB, branches, imd transmitters
 * and rxAntennaPos) have z = local floor height + z. Cached per scene object; idempotent (an absolute scene returns itself);
 * a scene with no deck height and no platforms is returned UNCHANGED (same object, no work), so existing results are
 * numerically identical. The solvers convert tx/rx positions themselves (solveLink), so callers normally pass the ordinary
 * scene; this helper is for consumers that want absolute coordinates (drawing, export).
 */
export function withAbsoluteHeights(scene) {
  if (!hasFloorFeatures(scene) || ABSOLUTE.has(scene)) return scene;
  const hit = CACHE.get(scene);
  if (hit) return hit;
  const out = JSON.parse(JSON.stringify(scene));
  for (const l of out.links || []) {
    if (l.tx) l.tx.pos = absPos(scene, l.tx.pos);
    if (l.rx) {
      l.rx.pos = absPos(scene, l.rx.pos);
      const b = l.rx.diversity && l.rx.diversity.antennaB;
      if (b && b.pos) b.pos = absPos(scene, b.pos);
    }
    for (const br of l.branches || []) if (br.pos) br.pos = absPos(scene, br.pos);
  }
  if (out.imd) {
    for (const t of out.imd.transmitters || []) if (t.pos) t.pos = absPos(scene, t.pos);
    if (out.imd.rxAntennaPos) out.imd.rxAntennaPos = absPos(scene, out.imd.rxAntennaPos);
  }
  ABSOLUTE.add(out);
  CACHE.set(scene, out);
  return out;
}

/**
 * platformBoxes(scene) -> [{ id, kind: 'platform' | 'deck', x0, y0, x1, y1, zBottom: 0, zTop, material, rotationDeg, cx, cy, lx0, ly0, lx1, ly1, corners }]
 * Solid bodies that obstruct radio paths: every platform from ground (0) to topM, and the deck from 0 to stage.heightM.
 * x0..y1 = the WORLD axis-aligned bounding box (equal to the box itself when rotationDeg is 0); lx0..ly1 = the unrotated local
 * bounds, (cx, cy) the rotation centre, corners = the 4 world corners in order (lx0,ly0), (lx1,ly0), (lx1,ly1), (lx0,ly1).
 */
export function platformBoxes(scene) {
  if (!hasFloorFeatures(scene)) return [];
  const out = [];
  const st = scene.stage;
  const mat = scene.environment ? scene.environment.floor : undefined;
  const deckMat = stageSurface(scene);
  const box = (id, kind, x, y, w, d, zTop, material, rot) => {
    const cx = x + w / 2, cy = y + d / 2;
    const corners = [[x, y], [x + w, y], [x + w, y + d], [x, y + d]].map(([px, py]) => toWorld(rot, cx, cy, px, py));
    const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
    return {
      id, kind, x0: rot ? Math.min(...xs) : x, y0: rot ? Math.min(...ys) : y, x1: rot ? Math.max(...xs) : x + w, y1: rot ? Math.max(...ys) : y + d,
      zBottom: 0, zTop, material, rotationDeg: rot, cx, cy, lx0: x, ly0: y, lx1: x + w, ly1: y + d, corners,
    };
  };
  if (st && st.heightM > 0) out.push(box('stage-deck', 'deck', 0, 0, st.width, st.depth, st.heightM, deckMat, 0));
  for (const p of scene.platforms || []) {
    if (p && p.topM > 0) out.push(box(p.id, 'platform', p.x, p.y, p.width, p.depth, p.topM, p.material || mat, platformRotationDeg(p)));
  }
  return out;
}

const RISERS = new WeakMap();

/**
 * risersOf(scene) -> vertical reflector segments, one per face of every platform and of the stage deck:
 * { id: '<box>:s|n|w|e', name, material, p1, p2, zMin, zMax, riser: true }. zMax = the box top; zMin = the floor height just
 * outside the face (the lower surface the face rises from, sampled 1 mm outside the face midpoint). Faces with zMax <= zMin are
 * skipped. transmissionLossDb is 0: the through-loss of a riser is the platform obstruction (chord loss) so it is not counted twice.
 * Not stored in scene.reflectors; cached per scene object.
 */
export function risersOf(scene) {
  if (!hasFloorFeatures(scene)) return [];
  const hit = RISERS.get(scene);
  if (hit) return hit;
  const out = [];
  for (const b of platformBoxes(scene)) {
    // Faces are built in the local (unrotated) frame, then rotated to world; the outward offset direction rotates with them.
    const rot = b.rotationDeg || 0;
    const W = (x, y) => toWorld(rot, b.cx, b.cy, x, y);
    const t = (rot * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t);
    const faces = [
      ['s', W(b.lx0, b.ly0), W(b.lx1, b.ly0), 0, -1],
      ['n', W(b.lx0, b.ly1), W(b.lx1, b.ly1), 0, 1],
      ['w', W(b.lx0, b.ly0), W(b.lx0, b.ly1), -1, 0],
      ['e', W(b.lx1, b.ly0), W(b.lx1, b.ly1), 1, 0],
    ];
    for (const [k, p1, p2, lox, loy] of faces) {
      const ox = rot ? lox * c + loy * sn : lox, oy = rot ? -lox * sn + loy * c : loy; // local direction -> world direction
      const mx = (p1.x + p2.x) / 2 + ox * 1e-3, my = (p1.y + p2.y) / 2 + oy * 1e-3;
      const zMin = floorHeightAt(scene, mx, my);
      if (!(b.zTop > zMin)) continue;
      const faceMat = (SP.SURFACE_RISER_FACE_MATERIAL && SP.SURFACE_RISER_FACE_MATERIAL[b.material]) || b.material;
      out.push({ id: `${b.id}:${k}`, name: `${b.id} face ${k}`, material: faceMat, p1, p2, zMin, zMax: b.zTop, riser: true, transmissionLossDb: 0 });
    }
  }
  RISERS.set(scene, out);
  return out;
}

/**
 * floorZoneFraction(scene, tx, rx, H, h, freqMHz) -> 0..1: the fraction of the first Fresnel zone around the specular point H
 * (on the floor plane of height h) that actually lies on that plane. Sampled along the path direction over +-L, with
 * L = R1 / sin(grazing) and R1 = sqrt(lambda d1 d2 / (d1 + d2)), weighted by the zone's width (1 - (s/L)^2)^0.5. A reflection
 * point beyond the edge of a deck gives a small fraction instead of a phantom full-strength reflection, and the fraction varies
 * smoothly as the receiver moves, so there is no multi-dB jump at a boundary. Flat floor: 1 (no work). The lateral edges of a
 * platform are not considered (documented limit).
 */
export function floorZoneFraction(scene, tx, rx, H, h, freqMHz) {
  if (!hasFloorFeatures(scene)) return 1;
  const ux = rx.x - tx.x, uy = rx.y - tx.y, um = Math.hypot(ux, uy);
  if (um < 1e-9) return 1;
  const d1 = Math.hypot(H.x - tx.x, H.y - tx.y, H.z - tx.z), d2 = Math.hypot(rx.x - H.x, rx.y - H.y, rx.z - H.z);
  const lambda = 299792458 / (freqMHz * 1e6);
  const R1 = Math.sqrt((lambda * d1 * d2) / Math.max(d1 + d2, 1e-9));
  const sinPsi = Math.max((tx.z - h) / Math.max(d1, 1e-9), 0.05);
  const L = R1 / sinPsi;
  const N = 41;
  let on = 0, tot = 0;
  for (let i = 0; i < N; i++) {
    const t = -1 + (2 * i) / (N - 1);
    const w = Math.sqrt(Math.max(0, 1 - t * t)) + 1e-3;
    const s = t * L;
    tot += w;
    if (Math.abs(floorHeightAt(scene, H.x + (ux / um) * s, H.y + (uy / um) * s) - h) < 1e-9) on += w;
  }
  return on / tot;
}

/** The reflectors the path tracer uses: scene.reflectors plus the riser faces (not stored in the scene). */
export function allReflectors(scene) {
  const base = scene.reflectors || [];
  const r = risersOf(scene);
  return r.length ? [...base, ...r] : base;
}

// Fallback obstruction loss of a solid body, by material: dB at the interface and dB per metre of chord (approx; a hollow wooden
// deck 3 dB + 1 dB/m, the figures of stage-params.js). Used only when stage-params.js is missing; with it, platformThroughLossDb
// applies the (f / 600)^exponent frequency law and the maxLossDb cap of PLATFORM_BODY.
const FALLBACK_OBSTRUCTION = { wood: [3, 1], concrete: [2.5, 55], metal: [30, 0], default: [3, 1] }; // default = hollow wooden deck (3 dB + 1 dB/m)
let SP = {};
try { SP = await import('./stage-params.js'); } catch { SP = {}; }

/** [interfaceDb, dbPerMetre] for a material. */
export function obstructionParams(material) {
  const t = SP.PLATFORM_OBSTRUCTION || SP.PLATFORM_LOSS || null;
  const e = t && t[material];
  if (e && Number.isFinite(e.interfaceDb) && Number.isFinite(e.dbPerM)) return [e.interfaceDb, e.dbPerM];
  if (Array.isArray(e)) return e;
  return FALLBACK_OBSTRUCTION[material] || FALLBACK_OBSTRUCTION.default;
}

/**
 * chordsThrough(scene, A, B, freqMHz = 600) -> [{ id, material, lengthM, lossDb }] merged over overlapping bodies (deck + a platform on it
 * count once; loss from platformThroughLossDb of stage-params.js when present, else interface + dB/m x chord). A leg starting or ending ON a top surface is not inside (the box is shrunk by 1e-6 at the top). Loss =
 * interface + dB/m x chord for each merged chord.
 */
export function chordsThrough(scene, A, B, freqMHz = 600) {
  const boxes = platformBoxes(scene);
  if (!boxes.length) return [];
  const dx = B.x - A.x, dy = B.y - A.y, dz = (B.z || 0) - (A.z || 0);
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-12) return [];
  const spans = [];
  for (const b of boxes) {
    let t0 = 0, t1 = 1;
    // Rotated box: express the ray in the box's local frame (exact), then the usual slab test against the unrotated bounds.
    let ax = A.x, ay = A.y, ddx = dx, ddy = dy;
    if (b.rotationDeg) {
      const t = (b.rotationDeg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
      const a0 = toLocal(b.rotationDeg, b.cx, b.cy, A.x, A.y);
      ax = a0.x; ay = a0.y; ddx = dx * c - dy * s; ddy = dx * s + dy * c;
    }
    const slabs = [[ax, ddx, b.lx0, b.lx1], [ay, ddy, b.ly0, b.ly1], [A.z || 0, dz, b.zBottom, b.zTop - 1e-6]];
    let ok = true;
    for (const [a, d, lo, hi] of slabs) {
      if (Math.abs(d) < 1e-15) { if (a < lo || a > hi) { ok = false; break; } continue; }
      let ta = (lo - a) / d, tb = (hi - a) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 >= t1) { ok = false; break; }
    }
    if (ok && (t1 - t0) * len > 1e-6) spans.push({ t0, t1, id: b.id, material: b.material });
  }
  spans.sort((p, q) => p.t0 - q.t0);
  const merged = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.t0 <= last.t1 + 1e-9) last.t1 = Math.max(last.t1, s.t1);
    else merged.push({ ...s });
  }
  return merged.map((m) => {
    const lengthM = (m.t1 - m.t0) * len;
    const e = SP.PLATFORM_OBSTRUCTION && SP.PLATFORM_OBSTRUCTION[m.material];
    let lossDb;
    if (e && e.body && typeof SP.platformThroughLossDb === 'function') {
      lossDb = SP.platformThroughLossDb(e.body, lengthM, freqMHz); // stage-params: frequency exponent and cap included
    } else {
      const [iface, perM] = obstructionParams(m.material);
      lossDb = iface + perM * lengthM;
    }
    return { id: m.id, material: m.material, lengthM, lossDb };
  });
}
