// Ceiling and overhead panels as horizontal image-method reflectors (group f). Pure functions, no DOM.
//
//   scene.ceiling = { enabled?: boolean (default true when the object exists), heightM, material, extent?: { x, y, width, depth }, lossDb? }
//   scene.overheadPanels = [{ id, name?, x, y, width, depth, heightM, material, lossDb? }]    (x, y = minimum corner, scene metres)
// Off by default: no `ceiling` and no panels = the tracer is bit-identical to the floor and wall model.
//
// Model: a horizontal plane at height H (above the ground, like the floor). The reflected ray is found by mirroring the transmitter
// across the plane (image method, the same construction as the floor with z -> 2H - z) and applies only when BOTH antennas are below
// the plane. Coefficient: Fresnel (ITU-R P.2040 style) for the material at the grazing angle, TE for horizontal and TM for vertical
// polarisation (the same assignment as the floor). A rectangular extent or panel weights the reflection by the fraction of its first
// Fresnel zone that lies on the rectangle (overheadZoneFraction, as floorZoneFraction does for decks), so the reflection fades
// smoothly at an edge instead of switching. Mesh, grating and open trusses: lossDb (dB, amplitude 10^(-lossDb/20)) is an extra
// reflection loss, ASSUMED and approximate (openings much smaller than lambda, about 0.5 m at 600 MHz, still reflect; open trusses scatter).
// Known limits (not modelled): shadowing by overhead structures, diffraction by truss members, the ceiling transmission loss.

import { MATERIALS } from './library.js';

/** Ceiling material ids -> { name, epsR, sigma, absorbDb? }. Numbers from the wall library where it has one; 'fabric' ASSUMED (a thin tent skin is mostly transparent). */
export const CEILING_MATERIALS = Object.freeze({
  metal: { name: 'Metal sheet', ...pick('metal') },
  concrete: { name: 'Concrete', ...pick('concrete') },
  plasterboard: { name: 'Plasterboard', ...pick('drywall') },
  timber: { name: 'Timber', ...pick('wood') },
  fabric: { name: 'Tent fabric (assumed)', epsR: 2, sigma: 0.002, absorbDb: 12 },
});
function pick(id) { const m = MATERIALS[id]; return { epsR: m.epsR, sigma: m.sigma, ...(m.absorbDb ? { absorbDb: m.absorbDb } : {}) }; }

export const CEILING_LIMITS = Object.freeze({ heightM: [1.5, 60], panelsMax: 30, size: [0.1, 500], coord: [-500, 1000], lossDb: [0, 60] });
export const CEILING_PANELS_MAX = CEILING_LIMITS.panelsMax;

/** The overhead reflecting planes of a scene: [{ id, h, rect|null, material, lossDb, ceiling }]; the ceiling first, then the panels. */
export function overheadPlanes(scene) {
  const out = [];
  const c = scene && scene.ceiling;
  if (c && c.enabled !== false && Number.isFinite(c.heightM) && CEILING_MATERIALS[c.material]) {
    out.push({ id: 'ceiling', h: c.heightM, rect: c.extent && c.extent.width > 0 && c.extent.depth > 0 ? { x: c.extent.x, y: c.extent.y, width: c.extent.width, depth: c.extent.depth } : null, material: c.material, lossDb: c.lossDb || 0, ceiling: true });
  }
  const list = scene && scene.overheadPanels;
  if (Array.isArray(list)) for (const p of list) {
    if (p && Number.isFinite(p.heightM) && p.width > 0 && p.depth > 0 && CEILING_MATERIALS[p.material]) out.push({ id: p.id, h: p.heightM, rect: { x: p.x, y: p.y, width: p.width, depth: p.depth }, material: p.material, lossDb: p.lossDb || 0, ceiling: false });
  }
  return out;
}

/**
 * overheadZoneFraction(plane, tx, rx, H, freqMHz) -> 0..1: the fraction of the first Fresnel zone around the specular point H
 * (on the plane at height plane.h) lying inside plane.rect, sampled along the path direction over +-L, L = R1 / sin(grazing).
 * No rect (a full ceiling): 1.
 */
export function overheadZoneFraction(plane, tx, rx, H, freqMHz) {
  const r = plane.rect;
  if (!r) return 1;
  const inside = (x, y) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.depth;
  const ux = rx.x - tx.x, uy = rx.y - tx.y, um = Math.hypot(ux, uy);
  const d1 = Math.hypot(H.x - tx.x, H.y - tx.y, H.z - tx.z), d2 = Math.hypot(rx.x - H.x, rx.y - H.y, rx.z - H.z);
  if (um < 1e-9) return inside(H.x, H.y) ? 1 : 0;
  const lambda = 299792458 / (freqMHz * 1e6);
  const R1 = Math.sqrt((lambda * d1 * d2) / Math.max(d1 + d2, 1e-9));
  const sinPsi = Math.max((plane.h - tx.z) / Math.max(d1, 1e-9), 0.05);
  const L = R1 / sinPsi;
  const N = 41;
  let on = 0, tot = 0;
  for (let i = 0; i < N; i++) {
    const t = -1 + (2 * i) / (N - 1);
    const w = Math.sqrt(Math.max(0, 1 - t * t)) + 1e-3;
    tot += w;
    if (inside(H.x + (ux / um) * t * L, H.y + (uy / um) * t * L)) on += w;
  }
  return on / tot;
}
