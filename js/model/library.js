// js/model/library.js
// Static physical data for the RF Power Planner. Pure module: no DOM, no globals.
// Units: MHz, dB, dBi, metres, degrees, S/m.
//
// Sources (values are rounded; `// approx` marks values interpolated or recalled
// from public datasheets and not re-verified line by line):
//  - Cables: Times Microwave LMR datasheets (LMR-195/240/400/600), Belden 9913 /
//    8214 / 8259 (RG58) / 8267 (RG213) datasheets, Pasternack RG174/RG58/RG213
//    datasheets. Datasheets quote dB/100 ft; converted here x3.2808 to dB/100 m.
//  - Permittivity/conductivity: ITU-R P.2040-3 Table 3 (building materials, value
//    at roughly 0.5-2.4 GHz; sigma = c*f_GHz^d evaluated near 1 GHz) and
//    ITU-R P.527-6 (ground). Carpet, grass and drape values are approx.
//  - Antenna patterns: analytic approximations of typical published manufacturer
//    patterns (Shure UA874/PA805/PA805Z/HA-8089, Sennheiser A 1031-U / A 2003-UHF,
//    RF Venue Diversity Fin, generic half-wave dipole theory).
//
// Pattern angle convention for the helper below: azDeg / elDeg are the OFFSETS of
// the direction of interest from the antenna boresight (0,0 = boresight), azimuth
// positive clockwise from above, elevation positive up. Table index i of a 361
// array corresponds to an offset of (i - 180) degrees.

const DEG = Math.PI / 180;

/** Normalise an angle in degrees to [-180, 180]. */
function wrap180(a) {
  let x = ((a + 180) % 360 + 360) % 360 - 180;
  if (x === -180 && a > 0) x = 180;
  return x;
}

// ---------------------------------------------------------------------------
// CABLES  (attenuation in dB per 100 m, matched 50 ohm, 20 C)
// Frequencies: 100, 200, 400, 600, 900, 1800, 2400 MHz.
// ---------------------------------------------------------------------------
const F = [100, 200, 400, 600, 900, 1800, 2400];
function tab(vals) { return F.map((f, i) => [f, vals[i]]); }

export const CABLES = {
  // Pasternack/Belden 8259 RG58/U. 100 ft: 4.5/6.6/9.8/12.5/16.5/26/32 approx
  rg58: { name: 'RG58 (solid PE)', velocityFactor: 0.66,
    attenDbPer100m: tab([15.4, 22.6, 33.5, 42.5, 55.5, 88, 108]) }, // approx
  // Belden 8267 RG213. 100 ft: 2.0/2.9/4.3/5.6/7.2/11.6/14.2 approx
  rg213: { name: 'RG213 (Belden 8267)', velocityFactor: 0.66,
    attenDbPer100m: tab([6.8, 9.8, 14.4, 18.4, 24.0, 38.5, 47.0]) }, // approx
  // Pasternack RG174: very lossy mini coax
  rg174: { name: 'RG174', velocityFactor: 0.66,
    attenDbPer100m: tab([29.0, 42.0, 62.0, 77.0, 97.0, 142.0, 168.0]) }, // approx
  // Times Microwave LMR-195 datasheet (900 MHz: 10.7 dB/100 ft, 2400: 19 dB/100 ft)
  'lmr-195': { name: 'LMR-195 (Times Microwave)', velocityFactor: 0.80,
    attenDbPer100m: tab([12.5, 17.8, 25.6, 31.5, 35.1, 51.5, 62.5]) },
  // Times Microwave LMR-240 datasheet (900 MHz: 6.9 dB/100 ft approx)
  'lmr-240': { name: 'LMR-240 (Times Microwave)', velocityFactor: 0.84,
    attenDbPer100m: tab([8.0, 11.5, 16.5, 20.2, 24.9, 36.1, 42.6]) }, // approx
  // Times Microwave LMR-400 datasheet (900 MHz: 3.9 dB/100 ft, 2400: 6.6 dB/100 ft)
  'lmr-400': { name: 'LMR-400 (Times Microwave)', velocityFactor: 0.85,
    attenDbPer100m: tab([4.3, 6.1, 8.7, 10.8, 13.2, 19.2, 22.2]) },
  // Times Microwave LMR-600 datasheet (900 MHz: 2.5 dB/100 ft, 2400: 4.3 dB/100 ft)
  'lmr-600': { name: 'LMR-600 (Times Microwave)', velocityFactor: 0.87,
    attenDbPer100m: tab([2.7, 3.8, 5.5, 6.8, 8.3, 12.2, 14.2]) },
  // Belden 9913 low-loss RG8 type (air-spaced PE)
  'belden-9913': { name: 'Belden 9913', velocityFactor: 0.84,
    attenDbPer100m: tab([4.6, 6.6, 9.5, 11.8, 14.5, 21.5, 25.0]) }, // approx
  // Belden 8214 RG8/foam
  'belden-8214': { name: 'Belden 8214 (RG8 foam)', velocityFactor: 0.78,
    attenDbPer100m: tab([7.5, 10.8, 15.8, 19.8, 25.0, 38.5, 45.5]) }, // approx
};

// ---------------------------------------------------------------------------
// ANTENNA PATTERNS (relative dB, 361 points per cut)
// ---------------------------------------------------------------------------
const FLOOR_DB = -40; // deepest value stored in any table

function table(fn) {
  const out = new Array(361);
  for (let i = 0; i < 361; i++) {
    const v = Math.max(FLOOR_DB, Math.min(0, fn(i - 180)));
    out[i] = Math.round(v * 100) / 100 + 0;
  }
  return out;
}

// Gaussian-style main lobe, -3 dB at hpbw/2, with front-to-back floor.
const lobe = (hpbw, fbDb) => (a) => Math.max(-Math.abs(fbDb), -12 * Math.pow(wrap180(a) / hpbw, 2));
const flat = () => 0;

// Half-wave dipole, boresight broadside. Dipole axis lies at elevation offset +90.
// E-plane (elevation cut): F = cos(pi/2 * sin el) / cos el  (power = F^2).
function dipoleEl(el) {
  const e = el * DEG;
  const c = Math.cos(e);
  if (Math.abs(c) < 1e-6) return FLOOR_DB;
  const F2 = Math.pow(Math.cos((Math.PI / 2) * Math.sin(e)) / c, 2);
  return 10 * Math.log10(Math.max(F2, 1e-4));
}

// Cardioid in azimuth: power = ((1+cos a)/2)^2 (voltage cardioid), floored.
const cardioid = (floorDb) => (a) => Math.max(floorDb, 20 * Math.log10(Math.max((1 + Math.cos(a * DEG)) / 2, 1e-3)));

// Body-worn: torso shadow. Front 0 dB, side about -4, directly behind about -9 (approx).
const bodyAz = (a) => -9 * (1 - Math.cos(a * DEG)) / 2;
const bodyEl = (e) => -6 * Math.pow(Math.sin(e * DEG), 2);

export const ANTENNAS = {
  dipole: { name: 'Dipole (1/2 wave)', gainDbi: 2.15, patternFn: 'dipole',
    pattern: { azDb: table(flat), elDb: table(dipoleEl) } }, // gain: theory 2.15 dBi
  omni: { name: 'Omni (0 dBi reference)', gainDbi: 0, patternFn: 'omni',
    pattern: { azDb: table(flat), elDb: table(flat) } },
  // Shure PA805 / UA860 style paddle (~7 dBi, HPBW ~70-80 deg, F/B ~ 15-20 dB)
  paddle: { name: 'Paddle / directional panel', gainDbi: 7, patternFn: 'paddle',
    pattern: { azDb: table(lobe(75, 18)), elDb: table(lobe(65, 18)) } },
  // Log-periodic (Shure PA805Z2 / Sennheiser A 1031 type, 6-10 dBi, F/B ~ 20 dB)
  logperiodic: { name: 'Log-periodic (LPDA)', gainDbi: 8, patternFn: 'logperiodic',
    pattern: { azDb: table(lobe(65, 20)), elDb: table(lobe(75, 20)) } },
  // Normal-mode/axial helical (IEM). approx; circular polarisation not modelled here
  helical: { name: 'Helical', gainDbi: 5, patternFn: 'helical',
    pattern: { azDb: table(lobe(80, 15)), elDb: table(lobe(80, 15)) } }, // approx
  // Cardioid antenna / pickup pattern (approx, 3 dBi forward gain)
  cardioid: { name: 'Cardioid antenna', gainDbi: 3, patternFn: 'cardioid',
    pattern: { azDb: table(cardioid(-25)), elDb: table(lobe(120, 15)) } }, // approx
  // Body-worn bodypack or handheld mic: lossy, human body shadow (approx -3 dBi)
  body: { name: 'Body-worn / handheld (body loss)', gainDbi: -3, patternFn: 'body',
    pattern: { azDb: table(bodyAz), elDb: table(bodyEl) } }, // approx, see PHYSICS.md
  custom: { name: 'Custom (user gain, omni)', gainDbi: 0, patternFn: 'custom',
    pattern: { azDb: table(flat), elDb: table(flat) } },
};

/**
 * Relative antenna gain in dB (<= 0, 0 at boresight).
 * azDeg, elDeg are OFFSETS from the boresight (see header). Separable approximation:
 * pattern = azimuth cut + elevation cut, clamped to [-40, 0] dB. Unknown ids use omni.
 */
export function antennaPatternDb(antennaId, azDeg, elDeg) {
  const a = ANTENNAS[antennaId] || ANTENNAS.omni;
  const azI = wrap180(Number.isFinite(azDeg) ? azDeg : 0) + 180;
  const elI = wrap180(Number.isFinite(elDeg) ? elDeg : 0) + 180;
  const interp = (arr, x) => {
    const i0 = Math.floor(x), i1 = Math.min(360, i0 + 1), t = x - i0;
    return arr[i0] * (1 - t) + arr[i1] * t;
  };
  const v = interp(a.pattern.azDb, azI) + interp(a.pattern.elDb, elI);
  return Math.max(FLOOR_DB, Math.min(0, v)) + 0;
}

// ---------------------------------------------------------------------------
// SURFACES (floors) and MATERIALS (reflectors): epsR, sigma [S/m]
// ITU-R P.2040-3 Table 3 evaluated near 1 GHz unless marked approx.
// Optional extra field `absorbDb` = extra loss per reflection (approx), for
// porous/absorbing finishes; rf.js may add it to the reflection magnitude.
// ---------------------------------------------------------------------------
export const SURFACES = {
  wood: { name: 'Wood stage deck', epsR: 3.66, sigma: 0.0044 },   // P.2040 floorboard
  concrete: { name: 'Concrete', epsR: 5.31, sigma: 0.0326 },       // P.2040 concrete
  grass: { name: 'Grass / soil (damp)', epsR: 15, sigma: 0.01 },   // P.527 medium dry ground, approx
  carpet: { name: 'Carpet on concrete', epsR: 3.0, sigma: 0.02, absorbDb: 2 }, // approx
  glass: { name: 'Glass', epsR: 6.27, sigma: 0.0043 },             // P.2040 glass
  metal: { name: 'Metal deck', epsR: 1, sigma: 1e7 },              // PEC-like
};

export const MATERIALS = {
  wood: { name: 'Wood', epsR: 1.99, sigma: 0.0047 },               // P.2040 wood
  concrete: { name: 'Concrete', epsR: 5.31, sigma: 0.0326 },
  brick: { name: 'Brick', epsR: 3.75, sigma: 0.038 },              // P.2040 brick
  drywall: { name: 'Drywall / plasterboard', epsR: 2.94, sigma: 0.0116 }, // P.2040 plasterboard
  glass: { name: 'Glass', epsR: 6.27, sigma: 0.0043 },
  metal: { name: 'Metal', epsR: 1, sigma: 1e7 },
  drapes: { name: 'Drapes / absorber', epsR: 1.5, sigma: 0.05, absorbDb: 8 }, // approx
  grass: { name: 'Grass / soil', epsR: 15, sigma: 0.01 },          // approx
};

// ---------------------------------------------------------------------------
// BANDS (MHz). Regional regulations differ; these are common wireless mic / IEM
// allocations (approx edges, check local regulator before use).
// ---------------------------------------------------------------------------
export const BANDS = [
  { id: 'uhf-470-608', name: 'UHF TV 470-608 MHz', fromMHz: 470, toMHz: 608 },
  { id: 'uhf-606-694', name: 'UHF TV 606-694 MHz', fromMHz: 606, toMHz: 694 },
  { id: 'uhf-694-703', name: 'UHF 694-703 MHz (EU PMSE)', fromMHz: 694, toMHz: 703 },
  { id: 'uhf-823-832', name: 'UHF 823-832 MHz (EU duplex gap)', fromMHz: 823, toMHz: 832 },
  { id: 'uhf-863-865', name: 'UHF 863-865 MHz (licence exempt)', fromMHz: 863, toMHz: 865 },
  { id: 'uhf-902-928', name: 'ISM 902-928 MHz (Americas)', fromMHz: 902, toMHz: 928 },
  { id: 'dect-1880-1900', name: 'DECT 1880-1900 MHz', fromMHz: 1880, toMHz: 1900 },
  { id: 'l-1785-1805', name: '1.8 GHz 1785-1805 MHz', fromMHz: 1785, toMHz: 1805 },
  { id: 'ism-2400', name: '2.4 GHz ISM 2400-2483.5 MHz', fromMHz: 2400, toMHz: 2483.5 },
];

// Icon sizes in metres (contract).
export const REAL_SIZES = {
  mic: 0.25, handheldMicLength: 0.25, paddle: 0.30, dipole: 0.30, helical: 0.15,
  person: 1.75, bodypack: 0.10, receiver: 0.48, stand: 2.0,
};
