// js/model/library.js
// Static physical data for the RF Bench. Pure module: no DOM, no globals.
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
// Frequencies: 100, 200, 400, 600, 900, 1800, 2400, 3500, 5000, 5800, 6000 MHz.
// Points up to 2400 MHz are datasheet or datasheet-derived (see per cable). Points from 3500 to
// 6000 MHz extend the same cable with A(f) = a sqrt(f) + b f (skin-effect plus dielectric loss),
// least-squares fitted to the 100-2400 MHz points (fit residual under 3 percent) and rounded.
// Planning estimates: the 3.5-6 GHz points are model values, not datasheet readings, except
// LMR-400 / LMR-600 where they agree with the Times Microwave 5.8 GHz figures (about 10.9 and
// 7.1 dB/100 ft) to within rounding. Below 100 MHz and above 6 GHz use cableDbPer100m(), which
// scales with sqrt(f) from the nearest end point instead of the (steeper) end-slope.
// ---------------------------------------------------------------------------
const F = [100, 200, 400, 600, 900, 1800, 2400, 3500, 5000, 5800, 6000];
function tab(vals) { return F.map((f, i) => [f, vals[i]]); }

export const CABLES = {
  // Pasternack/Belden 8259 RG58/U. 100 ft: 4.5/6.6/9.8/12.5/16.5/26/32 approx
  rg58: { name: 'RG58 (solid PE)', velocityFactor: 0.66,
    attenDbPer100m: tab([15.4, 22.6, 33.5, 42.5, 55.5, 88, 108, 139.2, 180.2, 201.1, 206.2]) }, // approx
  // Belden 8267 RG213. 100 ft: 2.0/2.9/4.3/5.6/7.2/11.6/14.2 approx
  rg213: { name: 'RG213 (Belden 8267)', velocityFactor: 0.66,
    attenDbPer100m: tab([6.8, 9.8, 14.4, 18.4, 24.0, 38.5, 47.0, 60.4, 78.1, 87.2, 89.4]) }, // approx
  // Pasternack RG174: very lossy mini coax
  rg174: { name: 'RG174', velocityFactor: 0.66,
    attenDbPer100m: tab([29.0, 42.0, 62.0, 77.0, 97.0, 142.0, 168.0, 212.3, 264.6, 290.5, 296.8]) }, // approx
  // RG316 (PTFE, SMA jumpers). Taken as 0.9 x RG174 at every frequency (approx, Pasternack RG316
  // is a little lower loss than RG174); only for short jumpers, where loss is small anyway.
  rg316: { name: 'RG316 / SMA jumper', velocityFactor: 0.69,
    attenDbPer100m: tab([26.1, 37.8, 55.8, 69.3, 87.3, 127.8, 151.2, 191.1, 238.1, 261.5, 267.1]) }, // approx
  // Times Microwave LMR-195 datasheet (900 MHz: 10.7 dB/100 ft, 2400: 19 dB/100 ft). 200-1800 MHz
  // smoothed to a continuous sqrt-like slope (earlier values had a 0.27 slope kink at 600-900 MHz).
  'lmr-195': { name: 'LMR-195 (Times Microwave)', velocityFactor: 0.80,
    attenDbPer100m: tab([12.5, 17.2, 23.7, 28.7, 35.1, 53.0, 62.5, 75.5, 90.2, 97.2, 98.8]) },
  // Times Microwave LMR-240 datasheet (900 MHz: 6.9 dB/100 ft approx)
  'lmr-240': { name: 'LMR-240 (Times Microwave)', velocityFactor: 0.84,
    attenDbPer100m: tab([8.0, 11.5, 16.5, 20.2, 24.9, 36.1, 42.6, 52.1, 63.6, 69.2, 70.5]) }, // approx
  // Times Microwave LMR-400 datasheet (900 MHz: 3.9 dB/100 ft, 2400: 6.6, 5800: about 10.9 dB/100 ft)
  'lmr-400': { name: 'LMR-400 (Times Microwave)', velocityFactor: 0.85,
    attenDbPer100m: tab([4.3, 6.1, 8.7, 10.8, 13.2, 19.2, 22.2, 27.3, 33.1, 35.9, 36.6]) },
  // Times Microwave LMR-600 datasheet (900 MHz: 2.5 dB/100 ft, 2400: 4.3, 5800: about 7.1 dB/100 ft)
  'lmr-600': { name: 'LMR-600 (Times Microwave)', velocityFactor: 0.87,
    attenDbPer100m: tab([2.7, 3.8, 5.5, 6.8, 8.3, 12.2, 14.2, 17.5, 21.3, 23.2, 23.7]) },
  // CFD-style flexible low-loss cable (Cable Free / Wireless-type "CFD-200 / CFD-400" series). Treated as the
  // same class as LMR-195 (x 0.93) and LMR-400 (x 1.0): approx, +-10 percent, use a custom override for exact data.
  'cfd-200': { name: 'CFD-200 class (about LMR-195)', velocityFactor: 0.83,
    attenDbPer100m: tab([11.6, 16.0, 22.0, 26.7, 32.6, 49.3, 58.1, 70.2, 83.9, 90.4, 91.9]) }, // approx
  'cfd-400': { name: 'CFD-400 class (about LMR-400)', velocityFactor: 0.85,
    attenDbPer100m: tab([4.3, 6.1, 8.7, 10.8, 13.2, 19.2, 22.2, 27.3, 33.1, 35.9, 36.6]) }, // approx
  // Belden 9913 low-loss RG8 type (air-spaced PE)
  'belden-9913': { name: 'Belden 9913', velocityFactor: 0.84,
    attenDbPer100m: tab([4.6, 6.6, 9.5, 11.8, 14.5, 21.5, 25.0, 31.1, 38.2, 41.7, 42.6]) }, // approx
  // Belden 8214 RG8/foam
  'belden-8214': { name: 'Belden 8214 (RG8 foam)', velocityFactor: 0.78,
    attenDbPer100m: tab([7.5, 10.8, 15.8, 19.8, 25.0, 38.5, 45.5, 57.9, 73.0, 80.6, 82.5]) }, // approx
};

/**
 * Cable attenuation in dB per 100 m at freqMHz: log-log interpolation inside the table; outside it
 * (below 100 MHz, above 6 GHz) it scales as sqrt(f) from the nearest end point (skin effect), which is
 * safer than extrapolating the end-slope (the 1.8-2.4 GHz slope overshoots by 10-20 percent at 6 GHz).
 */
export function cableDbPer100m(cableId, freqMHz) {
  const c = CABLES[cableId];
  if (!c) throw new Error(`Unknown cable type: ${cableId}`);
  const t = c.attenDbPer100m;
  const f = Math.max(1e-3, freqMHz);
  if (f <= t[0][0]) return t[0][1] * Math.sqrt(f / t[0][0]);
  const last = t[t.length - 1];
  if (f >= last[0]) return last[1] * Math.sqrt(f / last[0]);
  let i = 0;
  while (i < t.length - 2 && f > t[i + 1][0]) i++;
  const [f0, a0] = t[i], [f1, a1] = t[i + 1];
  const k = Math.log(a1 / a0) / Math.log(f1 / f0);
  return a0 * Math.pow(f / f0, k);
}

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
  grass: { name: 'Grass / soil', epsR: 15, sigma: 0.035 },   // P.2040-3 Table 3 medium dry ground at 1 GHz: a = 15, b = -0.1, c = 0.035, d = 1.63
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
  grass: { name: 'Grass / soil', epsR: 15, sigma: 0.035 },         // P.2040-3 medium dry ground at 1 GHz (as the grass surface)
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
  { id: 'vhf-174-216', name: 'VHF TV Band III 174-216 MHz (DAB III 174-240 in EU)', fromMHz: 174, toMHz: 216 },
  { id: 'ism-5800', name: '5.8 GHz ISM/SRD 5725-5875 MHz', fromMHz: 5725, toMHz: 5875 },
];

// Icon sizes in metres (contract).
export const REAL_SIZES = {
  mic: 0.25, handheldMicLength: 0.25, paddle: 0.30, dipole: 0.30, helical: 0.15,
  person: 1.75, bodypack: 0.10, receiver: 0.48, stand: 2.0,
};

// ===========================================================================
// VHF / 2.4 GHz / 5.8 GHz EXTENSION (planning estimates; see docs/PHYSICS-BANDS.md)
// ===========================================================================

/** Log-frequency linear interpolation of [[MHz, value],...]; clamps at the ends. */
function interpLogF(points, f) {
  if (f <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (f >= last[0]) return last[1];
  let i = 0;
  while (i < points.length - 2 && f > points[i + 1][0]) i++;
  const [f0, v0] = points[i], [f1, v1] = points[i + 1];
  return v0 + (v1 - v0) * Math.log(f / f0) / Math.log(f1 / f0);
}

// ---------------------------------------------------------------------------
// Frequency dependence of permittivity / conductivity.
// ITU-R P.2040-3 Table 3: sigma = c * f_GHz^d, epsR = a * f_GHz^b (b = 0 for these materials).
// The SURFACES/MATERIALS values above are the 1 GHz values, so sigma(f) = sigma_1GHz * f_GHz^d.
// d from P.2040-3: concrete 0.8095, plasterboard 0.7076, wood 1.0718, glass 1.1925, floorboard 1.3515
// (its fit range is 50-100 GHz: approx below), brick 0 (valid 1-10 GHz), medium-dry ground 1.63 (P.2040
// valid 1-10 GHz; held flat below 1 GHz, where ground conductivity is nearly constant). Brick: P.2040 d = 0 is only
// valid 1-10 GHz; below 1 GHz a concrete-like 0.7 is used (approx) so that a 0.1 m brick wall is not over-lossy at VHF.
// Carpet, drapes: approx 0.
// Metal: constant.
// ---------------------------------------------------------------------------
export const SIGMA_FREQ_EXPONENT = {
  surfaces: { wood: 1.3515, concrete: 0.8095, grass: 1.63, carpet: 0, glass: 1.1925, metal: 0 },
  materials: { wood: 1.0718, concrete: 0.8095, brick: { hi: 0, lo: 0.7 }, drywall: 0.7076, glass: 1.1925, metal: 0, drapes: 0, grass: 1.63 },
};

// P.2040-3 permittivity exponent b (epsR = a f_GHz^b): medium dry ground -0.1. Others 0 (the tabulated materials have b = 0).
export const EPS_FREQ_EXPONENT = { surfaces: { grass: -0.1 }, materials: { grass: -0.1 } };

function atFreq(entry, d, freqMHz, groundLike, b = 0) {
  const g = Math.max(freqMHz / 1000, groundLike ? 1 : 0.1);
  const e = typeof d === 'object' && d ? (g < 1 ? d.lo : d.hi) : d;
  return { epsR: entry.epsR * Math.pow(g, b), sigma: entry.sigma * Math.pow(g, e || 0), absorbDb: entry.absorbDb || 0 };
}
/** {epsR, sigma, absorbDb} of a floor surface at freqMHz (sigma scaled by the P.2040 exponent). Unknown id -> concrete. */
export function surfaceAt(id, freqMHz) {
  const k = SURFACES[id] ? id : 'concrete';
  return atFreq(SURFACES[k], SIGMA_FREQ_EXPONENT.surfaces[k], freqMHz, k === 'grass', EPS_FREQ_EXPONENT.surfaces[k] || 0);
}
/** {epsR, sigma, absorbDb} of a wall material at freqMHz. Unknown id -> concrete. */
export function materialAt(id, freqMHz) {
  const k = MATERIALS[id] ? id : 'concrete';
  return atFreq(MATERIALS[k], SIGMA_FREQ_EXPONENT.materials[k], freqMHz, k === 'grass', EPS_FREQ_EXPONENT.materials[k] || 0);
}

/**
 * Normal-incidence transmission loss (dB) of a homogeneous slab, including multiple internal reflections.
 * A physical LOWER BOUND for a real wall (real walls add studs, rebar, moisture, air gaps, oblique incidence),
 * and it shows standing-wave ripple with thickness. Used for validation, not as the planning number.
 */
export function slabTransmissionLossDb(materialId, thicknessM, freqMHz) {
  const m = materialAt(materialId, freqMHz);
  if (m.sigma >= 1e5) return 60; // metal: practically a screen
  const f = freqMHz * 1e6, k0 = 2 * Math.PI * f / 299792458, eps0 = 8.8541878128e-12;
  const epsIm = -m.sigma / (2 * Math.PI * f * eps0);          // e^{+jwt}: eps = epsR - j sigma/(w eps0)
  const r = Math.hypot(m.epsR, epsIm), re = Math.sqrt((r + m.epsR) / 2), im = -Math.sqrt((r - m.epsR) / 2);
  const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const div = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
  const G = div([1 - re, -im], [1 + re, im]), G2 = mul(G, G);
  const mag = Math.exp(im * k0 * thicknessM), ph = -re * k0 * thicknessM;
  const e1 = [mag * Math.cos(ph), mag * Math.sin(ph)], e2 = mul(e1, e1);
  const num = mul([1 - G2[0], -G2[1]], e1), g2e2 = mul(G2, e2);
  const T = div(num, [1 - g2e2[0], -g2e2[1]]);
  return -20 * Math.log10(Math.max(Math.hypot(T[0], T[1]), 1e-6));
}

// ---------------------------------------------------------------------------
// Through-wall loss vs frequency (dB at the reference thickness). Points at 200, 600, 900, 2400, 5800 MHz.
// Planning estimates (approx): the 600 MHz values equal zones-params.js; the rise with frequency follows
// commonly quoted Wi-Fi/cellular planning ranges (drywall 3-4, glass 2-3, brick 8-10, 10 cm concrete 12-20 dB
// at 2.4-5 GHz), and always exceeds the P.2040 slab lower bound (checked in tests). Equivalent exponents
// (600 -> 5800 MHz) are about 0.23 drywall, 0.35 brick, 0.42 concrete, 0.25 glass/wood: lower than the 0.4-0.7
// used in zones-params.js, which over-predicts at 5.8 GHz (concrete 31 dB for 0.1 m).
// ---------------------------------------------------------------------------
const WP = [200, 600, 900, 2400, 5800];
const wp = (v) => WP.map((f, i) => [f, v[i]]);
export const WALL_LOSS_BY_FREQ = {
  drywall: { refThicknessM: 0.1, points: wp([2.0, 3.0, 3.2, 3.6, 5.0]) },
  brick: { refThicknessM: 0.1, points: wp([3.5, 5, 6, 8, 11]) },
  concrete: { refThicknessM: 0.1, points: wp([5, 8, 10, 14, 21]) },
  'concrete-thick': { refThicknessM: 0.3, points: wp([9, 18, 23, 34, 50]) },
  'concrete-reinforced': { refThicknessM: 0.2, points: wp([14, 20, 23, 30, 38]) },
  glass: { refThicknessM: 0.01, points: wp([1.5, 2, 2.2, 3.2, 4]) },
  'glass-lowe': { refThicknessM: 0.024, points: wp([14, 20, 21, 25, 30]) },
  wood: { refThicknessM: 0.04, points: wp([1.5, 2.5, 2.8, 3.5, 4.5]) },
  drapes: { refThicknessM: 0.02, points: wp([2.5, 3, 3, 3.5, 4]) },
  metal: { refThicknessM: 0.001, points: wp([60, 60, 60, 60, 60]) },
  grass: { refThicknessM: 0.5, points: wp([12, 12, 13, 40, 120]) }, // above the P.2040 slab bound (damp soil sigma 0.035 S/m at 1 GHz): 0.5 m of soil is practically opaque at 5.8 GHz
};
/** Wall transmission loss (dB). thicknessM defaults to the reference thickness; loss scales linearly in dB with thickness. */
export function wallLossDb(materialId, freqMHz, thicknessM) {
  const w = WALL_LOSS_BY_FREQ[materialId];
  if (!w) return 0;
  const t = Number.isFinite(thicknessM) && thicknessM >= 0 ? thicknessM : w.refThicknessM;
  return interpLogF(w.points, freqMHz) * (t / w.refThicknessM);
}

// ---------------------------------------------------------------------------
// Body shadowing (dB, extra loss on the path) vs frequency. Planning estimates (approx).
// Basis: on-body / off-body channel literature (torso shadow about 6-10 dB at VHF-UHF rising to 15-30 dB at 2.4 GHz
// and above, because the body is many wavelengths across and absorbs rather than diffracts) and the 3-10 dB
// quoted at UHF in PHYSICS.md. Do not add these on top of the 'body' antenna pattern rear shadow (double counting).
// ---------------------------------------------------------------------------
const BP = [200, 600, 900, 2400, 5800];
const bp = (v) => BP.map((f, i) => [f, v[i]]);
export const BODY_SHADOW_DB = {
  'hip-los': { label: 'Bodypack on belt, receiver in front/side (line of sight)', points: bp([2, 3, 4, 6, 8]) },
  'torso-blocked': { label: 'Receiver behind the wearer (torso in the path)', points: bp([6, 9, 10, 18, 25]) },
  'head-worn': { label: 'Head-worn / lavalier near the head', points: bp([2, 3, 3.5, 5, 6]) },
  'hand-grip': { label: 'Handheld, hand around the antenna area', points: bp([2, 4, 5, 8, 11]) },
  'crowd-packed': { label: 'Standing crowd between antenna and wearer (extra)', points: bp([4, 7, 8, 12, 16]) },
};
export function bodyShadowDb(placement, freqMHz) {
  const e = BODY_SHADOW_DB[placement];
  return e ? interpLogF(e.points, freqMHz) : 0;
}

// ---------------------------------------------------------------------------
// Electrically small stubs. A monopole/helical stub of length h has radiation resistance
// Rr = 36.5 ohm x min(1, (h / (lambda/4))^2) (quarter-wave monopole = 36.5 ohm, small-antenna square law),
// efficiency = Rr / (Rr + Rloss), and gain = 1.8 dBi (short-dipole-like directivity on a small ground,
// e.g. the body or a handheld case) + 10 log10(efficiency). Rloss lumps coil, ground-return and hand/body
// absorption, default 4 ohm (approx). This is a free-space planning estimate: it excludes body detuning.
// Examples: 0.12 m stub: 600 MHz -> +1.3 dBi, 200 MHz -> -1.4 dBi (about 2.7 dB worse than UHF);
// 0.37 m quarter-wave whip at 195 MHz -> +1.2 dBi.
// ---------------------------------------------------------------------------
export function shortStubGainDbi(lengthM, freqMHz, opts = {}) {
  const lossOhm = opts.lossOhm ?? 4, dirDbi = opts.directivityDbi ?? 1.8;
  const lambda = 299.792458 / freqMHz;
  const x = Math.min(1, lengthM / (lambda / 4));
  const rr = 36.5 * x * x;
  return dirDbi + 10 * Math.log10(rr / (rr + lossOhm));
}

// ---------------------------------------------------------------------------
// Band-specific antenna variants. `baseType` is the AntennaRef.type to use in a scene, `gainDbi` the value to put
// in AntennaRef.gainDbi, `pattern` a ready {azDb, elDb} for AntennaRef.patternOverride (relative dB, index i = i-180 deg).
// Patterns are Gaussian-lobe approximations from the stated half-power beamwidths (-3 dB at half the beamwidth).
// Gains are typical datasheet or theory values, planning estimates (approx).
// ---------------------------------------------------------------------------
const mkDir = (az, el, fb) => ({ azDb: table(lobe(az, fb)), elDb: table(lobe(el, fb)) });
const bodyPat = (rearAz, rearEl) => ({
  azDb: table((a) => -rearAz * (1 - Math.cos(a * DEG)) / 2), elDb: table((e) => -rearEl * Math.pow(Math.sin(e * DEG), 2)),
});
const omniH = () => ({ azDb: table(flat), elDb: table(dipoleEl) });
const round1 = (x) => Math.round(x * 10) / 10;
const vhfStubGain = round1(shortStubGainDbi(0.12, 195));
const vhfWhipGain = round1(shortStubGainDbi(0.37, 195));

export const ANTENNA_VARIANTS = {
  // ---- VHF 170-216 MHz (lambda 1.4-1.8 m)
  'vhf-whip': { name: 'VHF quarter-wave whip (about 0.37 m)', baseType: 'dipole', bandMHz: [170, 216], gainDbi: vhfWhipGain,
    pattern: omniH(), note: 'monopole on a small ground (body/rack), shortStubGainDbi(0.37, 195)' },
  'vhf-dipole': { name: 'VHF half-wave dipole (about 0.7 m)', baseType: 'dipole', bandMHz: [170, 216], gainDbi: 2.15,
    pattern: omniH(), note: 'theory' },
  'vhf-stub': { name: 'VHF short helical stub (about 0.12 m, handheld/bodypack)', baseType: 'dipole', bandMHz: [170, 216], gainDbi: vhfStubGain,
    pattern: omniH(), note: 'electrically small (0.08 lambda): about 2.7 dB below the same stub at 600 MHz; approx' },
  'vhf-yagi': { name: 'VHF 3-element Yagi', baseType: 'paddle', bandMHz: [170, 216], gainDbi: 7,
    pattern: mkDir(110, 66, 14), note: 'H-plane about 110, E-plane about 66 deg, F/B about 14 dB; approx, boom about 1 m' },
  'vhf-lpda': { name: 'VHF log-periodic dipole array', baseType: 'logperiodic', bandMHz: [170, 216], gainDbi: 5.5,
    pattern: mkDir(85, 65, 16), note: 'about 5-6 dBi, large (over 1 m); approx' },
  'vhf-body': { name: 'VHF body-worn bodypack whip', baseType: 'body', bandMHz: [170, 216], gainDbi: -4,
    pattern: bodyPat(6, 4), note: 'body about 1.2 wavelengths: mild shadow, about 6 dB behind; approx' },
  // ---- 2.4 GHz
  'dipole-2400': { name: '2.4 GHz rubber-duck / dipole', baseType: 'dipole', bandMHz: [2400, 2483.5], gainDbi: 2,
    pattern: omniH(), note: 'nominal 2.15 dBi, real ducks 0-2 dBi' },
  'stub-2400': { name: '2.4 GHz bodypack/handheld stub or PCB antenna', baseType: 'dipole', bandMHz: [2400, 2483.5], gainDbi: -1,
    pattern: omniH(), note: 'efficiency 50-80 percent in a plastic case; approx' },
  'patch-2400': { name: '2.4 GHz patch / paddle', baseType: 'paddle', bandMHz: [2400, 2483.5], gainDbi: 7,
    pattern: mkDir(75, 70, 20), note: 'single patch 6-8 dBi, HPBW about 70-80 deg' },
  'panel-2400': { name: '2.4 GHz panel (12 dBi)', baseType: 'paddle', bandMHz: [2400, 2483.5], gainDbi: 12,
    pattern: mkDir(50, 45, 22), note: 'patch array; approx' },
  'body-2400': { name: '2.4 GHz body-worn bodypack', baseType: 'body', bandMHz: [2400, 2483.5], gainDbi: -3,
    pattern: bodyPat(15, 8), note: 'torso shadow about 15 dB behind; includes the torso effect, do not add BODY_SHADOW torso-blocked again; approx' },
  // ---- 5.8 GHz
  'dipole-5800': { name: '5.8 GHz rubber-duck / dipole', baseType: 'dipole', bandMHz: [5725, 5875], gainDbi: 2,
    pattern: omniH(), note: 'nominal 2.15 dBi' },
  'stub-5800': { name: '5.8 GHz bodypack/handheld stub or PCB antenna', baseType: 'dipole', bandMHz: [5725, 5875], gainDbi: -1.5,
    pattern: omniH(), note: 'approx' },
  'patch-5800': { name: '5.8 GHz patch / paddle', baseType: 'paddle', bandMHz: [5725, 5875], gainDbi: 8,
    pattern: mkDir(65, 60, 20), note: 'single patch 7-9 dBi; approx' },
  'panel-5800': { name: '5.8 GHz panel (13 dBi)', baseType: 'paddle', bandMHz: [5725, 5875], gainDbi: 13,
    pattern: mkDir(40, 35, 24), note: 'patch array; approx' },
  'body-5800': { name: '5.8 GHz body-worn bodypack', baseType: 'body', bandMHz: [5725, 5875], gainDbi: -4,
    pattern: bodyPat(20, 10), note: 'torso shadow about 20 dB behind; do not add BODY_SHADOW torso-blocked again; approx' },
};

/** Ids of ANTENNA_VARIANTS whose band covers freqMHz. */
export function antennaVariantsFor(freqMHz) {
  return Object.entries(ANTENNA_VARIANTS).filter(([, v]) => freqMHz >= v.bandMHz[0] && freqMHz <= v.bandMHz[1]).map(([id]) => id);
}

// ---------------------------------------------------------------------------
// Band profiles: power limits and typical receivers. PLANNING ESTIMATES ONLY; regional rules differ and change
// (check the local regulator and licence). Powers are transmitter output unless marked EIRP.
// Receiver: sensitivity = -174 + 10 log10(B) + NF + required CNR.
// ---------------------------------------------------------------------------
export const BAND_PROFILES = {
  'vhf-174-216': {
    name: 'VHF 174-216 MHz (TV Band III; EU DAB III 174-240 overlaps)',
    limits: [
      { region: 'us', maxDbm: 17, basis: 'conducted, about 50 mW (FCC Part 74H / 15.236, VHF TV band; approx)' },
      { region: 'uk', maxDbm: 10, basis: 'ERP 10 mW licence-exempt 173.8-175.0 MHz class; other Band III by licence (approx)' },
      { region: 'eu', maxDbm: 17, basis: 'ERP about 10-50 mW, national; ETSI EN 300 422 (approx, check country)' },
    ],
    typicalTxDbm: { mic: 15, iem: 17 }, typicalEirpDbm: { mic: 12, iem: 15 },
    note: 'DAB/DVB-T Band III broadcasters (ERP up to MW) share this spectrum: coordinate against local multiplex channels (5A 174.928 MHz to 13F 239.2 MHz).',
    rx: { noiseFigureDb: 7, channelBwKHz: 200, requiredCnrDb: 23, sensitivityDbm: -91, modulation: 'analog FM' },
  },
  'ism-2400': {
    name: '2.4 GHz ISM 2400-2483.5 MHz',
    limits: [
      { region: 'eu', maxDbm: 20, basis: 'EIRP 100 mW (ETSI EN 300 328, wideband/FHSS)' },
      { region: 'uk', maxDbm: 20, basis: 'EIRP 100 mW (as EU)' },
      { region: 'us', maxDbm: 36, basis: '1 W conducted + 6 dBi antenna (FCC 15.247, FHSS/digital modulation)' },
    ],
    typicalTxDbm: { mic: 10, iem: 13 }, typicalEirpDbm: { mic: 9, iem: 14 },
    note: 'Shared with Wi-Fi, Bluetooth and microwave ovens. Digital audio; no licence in most regions.',
    rx: { noiseFigureDb: 7, channelBwKHz: 2000, requiredCnrDb: 14, sensitivityDbm: -90, modulation: 'digital GFSK-like' },
  },
  'ism-5800': {
    name: '5.8 GHz ISM/SRD 5725-5875 MHz',
    limits: [
      { region: 'eu', maxDbm: 14, basis: 'EIRP 25 mW (ERC/REC 70-03 Annex 1, EN 300 440)' },
      { region: 'uk', maxDbm: 14, basis: 'EIRP 25 mW (as EU)' },
      { region: 'us', maxDbm: 36, basis: '5.725-5.85: 1 W + 6 dBi (FCC 15.247); 5.85-5.875: 15.249, about -1 dBm EIRP (50 mV/m at 3 m)' },
    ],
    typicalTxDbm: { mic: 10, iem: 10 }, typicalEirpDbm: { mic: 8, iem: 9 },
    note: 'Few mic/IEM products; FPV video, UNII-3 Wi-Fi and point-to-point links share it. Free-space loss is 7.7 dB above 2.4 GHz for equal antennas.',
    rx: { noiseFigureDb: 9, channelBwKHz: 2000, requiredCnrDb: 14, sensitivityDbm: -88, modulation: 'digital GFSK-like' },
  },
};

// ---------------------------------------------------------------------------
// Interference-floor model for the licence-exempt bands (2.4 and 5.8 GHz). Planning estimates (approx).
// Average Wi-Fi power is the energy average the receiver would see in a 20 MHz window centred on an occupied channel
// (what a spectrum-analyser average trace shows). The rise relative to the receiver's own noise floor is
//   rise = 10 log10(1 + I/N),  I = sum of interferer mean powers inside the mic channel, N = -174 + 10 log10(B) + NF.
// Wi-Fi is flat across ~18 MHz, so I/N does not depend on the mic's bandwidth. Packet-based (digital) links should also
// use hitProbability: the chance a mic packet overlaps an interfering burst, which is what causes drop-outs.
// Wi-Fi spectral mask (IEEE 802.11 20 MHz OFDM, dBr): 0 to +-9 MHz, -20 at +-11, -28 at +-20, -40 at +-30.
// ---------------------------------------------------------------------------
export const WIFI_MASK_DBR = [[0, 0], [9, 0], [11, -20], [20, -28], [30, -40], [60, -50]];

export const INTERFERENCE_MODEL = {
  venues: ['quiet', 'typical', 'busy'],
  'ism-2400': {
    rangeMHz: [2400, 2483.5],
    wifi: {
      channels: [ // US/EU non-overlapping set; weight = relative occupancy. EU ch 13 is used less.
        { ch: 1, centerMHz: 2412, weight: 1 }, { ch: 6, centerMHz: 2437, weight: 1 }, { ch: 11, centerMHz: 2462, weight: 1 },
        { ch: 13, centerMHz: 2472, weight: 0.25 },
      ],
      avgDbmPer20MHz: { quiet: -97, typical: -87, busy: -77 },
      burstDbm: { quiet: -80, typical: -65, busy: -50 },
      utilisation: { quiet: 0.05, typical: 0.25, busy: 0.6 },
    },
    bluetooth: { // BLE advertising channels 37/38/39 at 2402/2426/2480 are busier; classic BT hops over 79 x 1 MHz
      advChannelsMHz: [2402, 2426, 2480], advFactor: 3,
      burstDbm: { quiet: -88, typical: -80, busy: -75 },
      perChannelDuty: { quiet: 0.002, typical: 0.01, busy: 0.05 },
    },
    microwaveOven: { // magnetron, on for about half of each mains cycle
      centerMHz: 2450, spectrumDbr: [[2400, -30], [2420, -20], [2430, -10], [2440, -2], [2450, 0], [2460, -2], [2470, -10], [2483.5, -25]],
      duty: 0.5, levelDbmWhileOn: { quiet: null, typical: -65, busy: -50 }, presentFraction: { quiet: 0, typical: 0.05, busy: 0.2 },
    },
  },
  'ism-5800': {
    rangeMHz: [5725, 5875],
    wifi: {
      channels: [ // UNII-3 plus neighbours; 40/80 MHz channels are treated as their 20 MHz sub-channels
        { ch: 144, centerMHz: 5720, weight: 0.5 }, { ch: 149, centerMHz: 5745, weight: 1 }, { ch: 153, centerMHz: 5765, weight: 1 },
        { ch: 157, centerMHz: 5785, weight: 1 }, { ch: 161, centerMHz: 5805, weight: 1 }, { ch: 165, centerMHz: 5825, weight: 0.5 },
        { ch: 169, centerMHz: 5845, weight: 0.25 }, { ch: 173, centerMHz: 5865, weight: 0.25 },
      ],
      avgDbmPer20MHz: { quiet: -100, typical: -90, busy: -80 },
      burstDbm: { quiet: -85, typical: -70, busy: -55 },
      utilisation: { quiet: 0.03, typical: 0.15, busy: 0.4 },
    },
    fpvVideo: { // analog FPV/video senders: continuous, about 18 MHz wide; off unless a drone or video link is present
      centersMHz: [5725, 5745, 5765, 5785, 5805, 5825, 5845, 5865], bwMHz: 18, duty: 1,
      levelDbm: { quiet: null, typical: null, busy: -70 },
    },
  },
};

const dbPow = (d) => Math.pow(10, d / 10);
function interpLin(points, x) { // piecewise linear in x, clamped
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1], [x1, y1] = points[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}
const maskDbr = (off) => interpLin(WIFI_MASK_DBR, Math.abs(off));
function bandKey(freqMHz) { return freqMHz >= 5000 ? 'ism-5800' : freqMHz >= 2000 ? 'ism-2400' : null; }

/**
 * Reference implementation of the interference floor.
 * interferenceRiseDb(freqMHz, venue, { bwMHz = 2, nfDb, fpv = false }) returns
 *   { riseDb (steady: Wi-Fi + Bluetooth, + FPV when opts.fpv),
 *     eventRiseDb (microwave oven while it runs, 2.4 GHz only),
 *     hitProbability (0..1, chance a packet overlaps a burst), noiseDbm, wifiDbm, btDbm }.
 * Venue 'none' (or anything else) or a frequency outside 2-6 GHz returns zeros.
 */
export function interferenceRiseDb(freqMHz, venue, opts = {}) {
  const key = bandKey(freqMHz), v = INTERFERENCE_MODEL.venues.includes(venue) ? venue : null;
  const zero = { riseDb: 0, eventRiseDb: 0, hitProbability: 0, noiseDbm: NaN, wifiDbm: -Infinity, btDbm: -Infinity };
  if (!key || !v) return zero;
  const m = INTERFERENCE_MODEL[key];
  const bw = opts.bwMHz ?? 2;
  const nf = opts.nfDb ?? BAND_PROFILES[key].rx.noiseFigureDb;
  const noiseDbm = -174 + 10 * Math.log10(bw * 1e6) + nf;
  let wsum = 0, hit = 1;
  for (const c of m.wifi.channels) {
    wsum += c.weight * dbPow(maskDbr(freqMHz - c.centerMHz));
    const inChannel = Math.abs(freqMHz - c.centerMHz) <= 10 + bw / 2;
    if (inChannel) hit *= 1 - Math.min(1, c.weight) * m.wifi.utilisation[v];
  }
  const wifiDbm = m.wifi.avgDbmPer20MHz[v] + 10 * Math.log10(Math.max(wsum, 1e-9)) - 10 * Math.log10(20) + 10 * Math.log10(bw);
  let iLin = dbPow(wifiDbm), btDbm = -Infinity, eventRise = 0;
  if (key === 'ism-2400') {
    const b = m.bluetooth;
    const adv = b.advChannelsMHz.some((a) => Math.abs(freqMHz - a) <= 1 + bw / 2);
    const duty = Math.min(1, b.perChannelDuty[v] * (adv ? b.advFactor : 1));
    btDbm = b.burstDbm[v] + 10 * Math.log10(duty);
    iLin += dbPow(btDbm);
    hit *= 1 - duty;
    const mw = m.microwaveOven;
    if (mw.levelDbmWhileOn[v] != null) {
      const lvl = mw.levelDbmWhileOn[v] + interpLin(mw.spectrumDbr, freqMHz) + 10 * Math.log10(Math.min(1, bw / 20));
      eventRise = 10 * Math.log10(1 + dbPow(lvl - noiseDbm));
      hit *= 1 - mw.duty * mw.presentFraction[v];
    }
  } else if (opts.fpv && m.fpvVideo.levelDbm[v] != null) {
    const f = m.fpvVideo;
    const near = f.centersMHz.some((c) => Math.abs(freqMHz - c) <= f.bwMHz / 2 + bw / 2);
    if (near) { iLin += dbPow(f.levelDbm[v] + 10 * Math.log10(Math.min(1, bw / f.bwMHz))); hit = 0; }
  }
  return { riseDb: 10 * Math.log10(1 + iLin / dbPow(noiseDbm)), eventRiseDb: eventRise, hitProbability: 1 - hit, noiseDbm, wifiDbm, btDbm };
}
