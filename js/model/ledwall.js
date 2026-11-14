// Video (LED) wall as a broadband noise source (item 25). Pure functions, no DOM, no imports.
//
//   scene.reflectors[i].noise = { preset?: 'off'|'class-b'|'class-a'|'noisy'|'custom', levelDbuvmAt10m?: number, tiltDbPerDecade?: number,
//                                 rearLossDb?: number (default 8), heightM?: number (default zMax - zMin), facing?: 'left'|'right' (default 'left'),
//                                 bandMinMHz?: number (default 30), bandMaxMHz?: number (default 1000) }
// The wall is the reflector segment p1 -> p2 from zMin to zMin + heightM. It radiates on its FRONT side, the side to the LEFT of the travel
// direction p1 -> p2 (facing 'left') or the right; the rear side gets rearLossDb more loss. A video wall is also a reflector: give the reflector
// material 'metal' (aluminium cabinets and steel frame: near total reflection, 60 dB transmission loss), so it causes strong multipath.
//
// Field strength at 10 m (dBuV/m, quasi-peak in 120 kHz, the EN 55032 / CISPR 32 measurement distance and bandwidth). PRESET VALUES ARE
// LIMITS (ceilings), flag I: a compliant product measures at or below them, often 10 to 20 dB below. 'class-b' 30 dBuV/m 30-230 MHz and 37 dBuV/m
// 230-1000 MHz (residential), 'class-a' 40 and 47 (commercial, industrial; the usual class of a rental LED wall), 'noisy' = class A + 15 dB (U:
// budget panels, poor cabling, a guess). 'custom' or a given levelDbuvmAt10m: that level at 600 MHz, plus tiltDbPerDecade x log10(f / 600).
// Outside bandMinMHz..bandMaxMHz the field falls 40 dB per decade (ASSUMED roll-off).
//
// Conversion to the receiver (all standard):
//   E(d) = E10 + 20 log10(10 / d_eff)                        field strength falls as 1/d (far field)
//   S = E^2 / Z0, Z0 = 377 ohm  ->  dBW/m2 = E(dBuV/m) - 120 - 10 log10(377)   power density
//   A_e = lambda^2 G / (4 pi)                                 effective aperture of the receive antenna (gain G toward the wall)
//   P = S + A_e, plus 10 log10(B / 120 kHz) to move from the 120 kHz measurement bandwidth to the channel (broadband noise),
//   minus 3 dB for a random-polarised source against a linear antenna (ASSUMED)
// d_eff = max(distance from the receive antenna to the nearest point of the wall rectangle, WALL_NEAR_CLAMP_M = 3 m): inside about 3 m of a large
// panel the wall is an extended source, the 1/d law does not hold and the level is held at its 3 m value (ASSUMED). The wall's own radiation
// pattern is cosine-like: 10 log10(max(cos(angle from the wall normal), 0.1)) dB on the front side, -rearLossDb behind.

export const WALL_NOISE_PRESETS = Object.freeze({
  off: { label: 'Off (no noise modelled)', lowDbuvm: -Infinity, highDbuvm: -Infinity, flag: 'S' },
  'class-b': { label: 'Quiet: EMC class B limit (30 / 37 dBuV/m at 10 m)', lowDbuvm: 30, highDbuvm: 37, flag: 'I' },
  'class-a': { label: 'Typical: EMC class A limit (40 / 47 dBuV/m at 10 m)', lowDbuvm: 40, highDbuvm: 47, flag: 'I' },
  noisy: { label: 'Noisy: class A + 15 dB (budget panels, poor cabling)', lowDbuvm: 55, highDbuvm: 62, flag: 'U' },
  custom: { label: 'Custom level (dBuV/m at 10 m, 600 MHz) and tilt', lowDbuvm: null, highDbuvm: null, flag: 'U' },
});
export const WALL_NOISE_LIMITS = Object.freeze({ levelDbuvmAt10m: [-20, 120], tiltDbPerDecade: [-60, 60], rearLossDb: [0, 60], heightM: [0.1, 50], bandMHz: [1, 100000] });
export const WALL_NEAR_CLAMP_M = 3;
export const WALL_REF_BW_KHZ = 120;
export const WALL_POLARISATION_LOSS_DB = 3;
export const WALL_REAR_LOSS_DB = 8;
export const WALL_FREE_SPACE_Z0_DB = 10 * Math.log10(377);

const C = 299792458;
const num = (v, d) => (Number.isFinite(v) ? v : d);

// ---------------------------------------------------------------- construction (item 25a)
//   reflector.construction: 'solid-metal' | 'solid-plastic' | 'mesh-metal' | 'mesh-plastic' | 'mesh-carbon'  (optional)
//   reflector.holeSizeMm (mesh only, default 10), reflector.thicknessM (scales the electronics loss of the plastic types, reference 0.1 m)
// ALL FIGURES BELOW ARE ASSUMED planning numbers (flag I for the solid-plastic loss range quoted as 3 to 10 dB, U for the rest), not measurements:
//   solid-metal   reflects like metal (Fresnel coefficient of 'metal'), transmission 40 dB, rear noise loss 25 dB (metal back and sides).
//   solid-plastic reflects partially (the electronics and PCBs behind the cabinet): extra 8 dB reflection loss on a drywall-like coefficient,
//                 transmission 6 dB x thickness / 0.1 m (modules, supplies, wiring), rear noise loss 3 dB.
//   mesh-metal    aperture shielding SE = 20 log10(lambda / (2 a)) dB for a hole of size a < lambda / 2, else 0 (Kontorovich / Bethe small-hole
//                 rule of thumb; capped at 40 dB). Transmission amplitude T = 10^(-SE/20); the reflected amplitude is sqrt(1 - T^2) (no absorption),
//                 rear noise loss 3 dB (open mesh radiates both ways).
//   mesh-plastic  nearly transparent: 2 dB x thickness / 0.1 m of electronics loss, reflection loss 15 dB, rear noise loss 0.
//   mesh-carbon   a lossy conductor: transmission 15 + 0.5 x SE dB (capped at 30), partial reflection (6 dB extra reflection loss on metal), rear loss 6.
// At 600 MHz (lambda 0.5 m) a 10 mm mesh gives SE = 20 log10(500 / 20) = 28 dB; at 2.4 GHz (lambda 125 mm) 21 dB; a 100 mm open curtain only 14 dB at
// 600 MHz and 2 dB at 2.4 GHz: holes comparable to the wavelength are not a shield.
export const WALL_CONSTRUCTIONS = Object.freeze({
  'solid-metal': { label: 'Solid metal cabinets (aluminium, steel, die-cast magnesium)', reflectionMaterial: 'metal', flag: 'U' },
  'solid-plastic': { label: 'Solid plastic / composite cabinets', reflectionMaterial: 'drywall', flag: 'I' },
  'mesh-metal': { label: 'Open blow-through mesh, metal frame and strips', reflectionMaterial: 'metal', flag: 'U' },
  'mesh-plastic': { label: 'Open blow-through mesh, plastic frame and strips', reflectionMaterial: 'drywall', flag: 'U' },
  'mesh-carbon': { label: 'Open blow-through mesh, carbon fibre frame and strips', reflectionMaterial: 'metal', flag: 'U' },
});
export const WALL_DEFAULT_HOLE_MM = 10;
export const WALL_MESH_SE_CAP_DB = 40;

/** Aperture shielding (dB) of a mesh with holes of size holeMm at freqMHz: 20 log10(lambda / (2 a)) for a < lambda / 2, else 0; capped. */
export function meshShieldingDb(holeMm, freqMHz) {
  const lambdaMm = (C / (freqMHz * 1e6)) * 1000;
  const a = Math.max(holeMm, 1e-6);
  if (a >= lambdaMm / 2) return 0;
  return Math.min(WALL_MESH_SE_CAP_DB, 20 * Math.log10(lambdaMm / (2 * a)));
}

/**
 * wallConstruction(w, freqMHz) -> { id, label, reflectionMaterial, transmissionLossDb, reflectionLossDb, rearLossDb, shieldingDb } or null when the
 * reflector has no (known) construction. transmissionLossDb: loss for a ray crossing the wall; reflectionLossDb: extra loss on a reflected ray
 * (on top of the Fresnel coefficient of reflectionMaterial).
 */
export function wallConstruction(w, freqMHz) {
  const id = w && w.construction;
  const def = id && WALL_CONSTRUCTIONS[id];
  if (!def) return null;
  const hole = num(w.holeSizeMm, WALL_DEFAULT_HOLE_MM);
  const thick = Math.max(num(w.thicknessM, 0.1), 0) / 0.1;
  const se = meshShieldingDb(hole, freqMHz);
  let tx, refl, rear;
  switch (id) {
    case 'solid-metal': tx = 40; refl = 0; rear = 25; break;
    case 'solid-plastic': tx = 6 * thick; refl = 8; rear = 3; break;
    case 'mesh-metal': {
      const T = Math.pow(10, -se / 20);
      tx = se; refl = -20 * Math.log10(Math.sqrt(Math.max(1 - T * T, 1e-6))); rear = 3; break;
    }
    case 'mesh-plastic': tx = 2 * thick; refl = 15; rear = 0; break;
    default: tx = Math.min(30, 15 + 0.5 * se); refl = 6; rear = 6; // mesh-carbon
  }
  return { id, label: def.label, reflectionMaterial: def.reflectionMaterial, transmissionLossDb: tx, reflectionLossDb: refl, rearLossDb: rear, shieldingDb: se };
}

/** Field strength (dBuV/m at 10 m, 120 kHz) of a noise block at freqMHz; -Infinity when off. */
export function wallFieldDbuvm(noise, freqMHz) {
  if (!noise) return -Infinity;
  const hasLevel = Number.isFinite(noise.levelDbuvmAt10m);
  const preset = noise.preset || (hasLevel ? 'custom' : 'off');
  let base;
  if (preset === 'custom' || (hasLevel && !WALL_NOISE_PRESETS[preset])) base = num(noise.levelDbuvmAt10m, -Infinity);
  else {
    const p = WALL_NOISE_PRESETS[preset];
    if (!p || p.lowDbuvm === -Infinity) return -Infinity;
    base = freqMHz < 230 ? p.lowDbuvm : p.highDbuvm;
  }
  const tilt = num(noise.tiltDbPerDecade, 0);
  let e = base + tilt * Math.log10(freqMHz / 600);
  const lo = num(noise.bandMinMHz, 30), hi = num(noise.bandMaxMHz, 1000);
  if (freqMHz > hi) e -= 40 * Math.log10(freqMHz / hi);
  else if (freqMHz < lo) e -= 40 * Math.log10(lo / freqMHz);
  return e;
}

/**
 * wallNoiseAt(reflectors, point, freqMHz, bwKHz, gainFn) -> { dbm, walls: [{ id, name, preset, fieldDbuvm10m, distanceM, dEffM, side: 'front'|'rear',
 *   directionDb, antennaGainDb, powerDbm }] }
 * point = { x, y, z } of the receive antenna; gainFn({ az, el }) -> antenna gain (dBi) toward the bearing from the antenna to the wall (az 0 = +y,
 * +90 = +x, as the rest of the model); pass () => 0 for an isotropic antenna. dbm = power sum over all noisy walls at the antenna terminals
 * (-Infinity when none).
 */
export function wallNoiseAt(reflectors, point, freqMHz, bwKHz, gainFn = () => 0) {
  const walls = [];
  const lambda = C / (freqMHz * 1e6);
  for (const r of reflectors || []) {
    if (!r || !r.noise || !r.p1 || !r.p2) continue;
    const e10 = wallFieldDbuvm(r.noise, freqMHz);
    if (!(e10 > -Infinity)) continue;
    const dx = r.p2.x - r.p1.x, dy = r.p2.y - r.p1.y, L = Math.hypot(dx, dy);
    if (L < 1e-9) continue;
    const tx = dx / L, ty = dy / L;
    const sgn = r.noise.facing === 'right' ? -1 : 1;
    const nx = -ty * sgn, ny = tx * sgn; // front normal
    const t = Math.min(Math.max((point.x - r.p1.x) * tx + (point.y - r.p1.y) * ty, 0), L);
    const px = r.p1.x + tx * t, py = r.p1.y + ty * t;
    const z0 = num(r.zMin, 0), z1 = z0 + Math.max(num(r.noise.heightM, num(r.zMax, z0 + 3) - z0), 0.1);
    const pz = Math.min(Math.max(point.z, z0), z1);
    const vx = point.x - px, vy = point.y - py, vz = point.z - pz;
    const d = Math.hypot(vx, vy, vz);
    const dEff = Math.max(d, WALL_NEAR_CLAMP_M);
    const along = (point.x - r.p1.x) * nx + (point.y - r.p1.y) * ny; // signed distance from the wall plane, + = front
    const front = along >= 0;
    // direction from the wall's closest point to the receiver, against the wall normal (horizontal plane plus elevation)
    const dn = Math.abs(vx * nx + vy * ny) / Math.max(d, 1e-9);
    const con = wallConstruction(r, freqMHz);
    const directionDb = front ? 10 * Math.log10(Math.max(dn, 0.1)) : -num(r.noise.rearLossDb, con ? con.rearLossDb : WALL_REAR_LOSS_DB);
    const toWall = { x: -vx, y: -vy, z: -vz };
    const bearing = { az: (Math.atan2(toWall.x, toWall.y) * 180) / Math.PI, el: (Math.atan2(toWall.z, Math.hypot(toWall.x, toWall.y)) * 180) / Math.PI };
    const g = gainFn(bearing);
    const e = e10 + 20 * Math.log10(10 / dEff);
    const sDbwM2 = e - 120 - WALL_FREE_SPACE_Z0_DB;
    const aeDb = 10 * Math.log10((lambda * lambda) / (4 * Math.PI)) + g;
    const powerDbm = sDbwM2 + aeDb + 30 + 10 * Math.log10(bwKHz / WALL_REF_BW_KHZ) - WALL_POLARISATION_LOSS_DB + directionDb;
    walls.push({ id: r.id, name: r.name, preset: r.noise.preset || 'custom', fieldDbuvm10m: e10, distanceM: d, dEffM: dEff, side: front ? 'front' : 'rear', directionDb, antennaGainDb: g, powerDbm });
  }
  const dbm = walls.length ? 10 * Math.log10(walls.reduce((s, w) => s + Math.pow(10, w.powerDbm / 10), 0)) : -Infinity;
  return { dbm, walls };
}
