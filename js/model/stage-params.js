// Stage height and raised-platform parameters: deck heights, platform bodies, riser faces, deck surfaces.
// Pure constants and small pure helpers (no DOM, no state), all frozen. Units: m, MHz, dB.
//
// Everything here is GENERIC and ILLUSTRATIVE. Real stage decks and risers vary widely in construction (hollow frame, filled
// timber, steel truss, concrete podium), fixings, skirting and cabling. Measure on site for critical rigs.
//
// Sources (derivations in docs/PHYSICS-STAGE.md):
//  - Two-ray ground reflection with antenna heights measured above the local reflecting plane; path difference
//    D = sqrt(d^2 + (ht + hr)^2) - sqrt(d^2 + (ht - hr)^2), about 2 ht hr / d for d >> ht, hr (standard radio-propagation
//    texts; ITU-R P.527 for ground reflection).
//  - Building material permittivity and conductivity: ITU-R P.2040 (wood, plasterboard, concrete).
//  - Fresnel zone radius r = sqrt(lambda d1 d2 / (d1 + d2)) (standard; knife-edge geometry, ITU-R P.526).

export const SPEED_OF_LIGHT_M_S = 299792458;

// Deck heights above the audience / lower floor. Typical modular deck heights come in fixed steps. approx.
export const DECK_HEIGHT_RANGE_M = Object.freeze({ min: 0, typical: 1.0, max: 2.0 });
export const DECK_HEIGHT_STEPS_M = Object.freeze([0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.5, 2.0]);

// Stage size presets (width x depth in metres, default deck height). Illustrative.
export const STAGE_SIZE_PRESETS = Object.freeze({
  'club-small': Object.freeze({ id: 'club-small', label: 'Small club (illustrative)', illustrative: true, width: 5, depth: 3.5, deckHeightM: 0.6 }),
  'club-large': Object.freeze({ id: 'club-large', label: 'Large club (illustrative)', illustrative: true, width: 8, depth: 6, deckHeightM: 1.0 }),
  'theatre-mid': Object.freeze({ id: 'theatre-mid', label: 'Mid theatre (illustrative)', illustrative: true, width: 12, depth: 8, deckHeightM: 1.2 }),
  'arena-main': Object.freeze({ id: 'arena-main', label: 'Arena main stage (illustrative)', illustrative: true, width: 20, depth: 14, deckHeightM: 1.5 })
});

// Deck floor materials mapped to the SURFACES ids of the library (the reflecting top of the deck).
export const DECK_SURFACE_ID = Object.freeze({
  wood: 'wood',                 // plywood or floorboards (P.2040 floorboard)
  steel: 'metal',               // steel or aluminium deck plate
  'carpet-covered': 'carpet',   // carpet on the deck: absorbs a little at grazing incidence
  concrete: 'concrete',
  glass: 'glass'
});

// Platform body through-loss (a ray that crosses the platform volume, for example from an audience-floor receiver to a
// transmitter low on the deck). Affine in the path length through the body:
//   L(l, f) = (interfaceDb + absorptionDbPerM * l) * (f / 600)^freqExponent, capped at maxLossDb.
// The body of a stage deck is mostly a hollow frame, so the loss is the two skins plus a modest allowance for legs, bracing and
// cables; filled risers and solid podiums are far lossier. All approx.
export const PLATFORM_BODY = Object.freeze({
  'stage-deck-wood-frame': Object.freeze({
    id: 'stage-deck-wood-frame', label: 'Stage deck, wood on frame (hollow)', illustrative: true,
    interfaceDb: 3, absorptionDbPerM: 1, freqExponent: 0.3, maxLossDb: 20, faceMaterial: 'wood',
    note: 'approx: two plywood skins about 1.5 dB each, legs and bracing as a light allowance per metre'
  }),
  'solid-riser': Object.freeze({
    id: 'solid-riser', label: 'Solid riser (filled timber / foam block)', illustrative: true,
    interfaceDb: 3, absorptionDbPerM: 8, freqExponent: 0.4, maxLossDb: 40, faceMaterial: 'wood',
    note: 'approx: dry wood absorbs about 5 dB/m at 600 MHz (P.2040), moisture and fixings add'
  }),
  'steel-truss-deck': Object.freeze({
    id: 'steel-truss-deck', label: 'Steel truss deck', illustrative: true,
    interfaceDb: 4, absorptionDbPerM: 3, freqExponent: 0.2, maxLossDb: 30, faceMaterial: 'drapes',
    note: 'approx: dense metal members shadow part of the aperture; typically skirted with cloth'
  }),
  'steel-plate-deck': Object.freeze({
    id: 'steel-plate-deck', label: 'Steel or aluminium plate deck', illustrative: true,
    interfaceDb: 30, absorptionDbPerM: 0, freqExponent: 0, maxLossDb: 60, faceMaterial: 'metal',
    note: 'approx: a continuous metal skin is a screen; leakage is through joints'
  }),
  concrete: Object.freeze({
    id: 'concrete', label: 'Concrete podium', illustrative: true,
    interfaceDb: 2.5, absorptionDbPerM: 55, freqExponent: 0.6, maxLossDb: 60, faceMaterial: 'concrete',
    note: 'approx: matches MATERIAL_TRANSMISSION concrete in zones-params.js'
  })
});
export const PLATFORM_BODY_DEFAULT = 'stage-deck-wood-frame';

// Riser faces as reflectors: the vertical front faces reflect like walls, from the lower floor up to the deck top. The face
// material is looked up in MATERIALS. A cloth skirt (drapes) mostly absorbs instead of reflecting.
export const RISER_FACE_MATERIAL = Object.freeze(Object.fromEntries(Object.values(PLATFORM_BODY).map((b) => [b.id, b.faceMaterial])));

// Edges are modelled specularly only. The soft boundary of a shadow or reflection edge is about one first Fresnel zone wide.
export const EDGE_MODEL = Object.freeze({
  diffraction: false,
  softEdgeFresnelZones: 1,       // approx: error band around an edge, in first-Fresnel-zone radii
  typicalErrorDb: 6              // approx: error of an on/off treatment within the soft band
});

// ---- Helpers -----------------------------------------------------------------------------------------------------
/** Exact two-ray path difference, m, for antenna heights ht, hr above the reflecting plane and horizontal distance d. */
export function pathDifferenceM(ht, hr, d) {
  return Math.sqrt(d * d + (ht + hr) * (ht + hr)) - Math.sqrt(d * d + (ht - hr) * (ht - hr));
}

/** Far-field distances (m) of the first n nulls for a reflection coefficient of -1: D = k lambda, d_k = 2 ht hr / (k lambda). */
export function nullDistancesM(ht, hr, freqMHz, n = 4) {
  const lambda = SPEED_OF_LIGHT_M_S / (freqMHz * 1e6);
  const out = [];
  for (let k = 1; k <= n; k++) out.push((2 * ht * hr) / (k * lambda));
  return out;
}

/** Horizontal distance from the transmitter to the specular point over a plane: d ht / (ht + hr). */
export function specularPointM(d, ht, hr) { return (d * ht) / (ht + hr); }

/** Radius (m) of the first Fresnel zone at a point d1 from one end and d2 from the other. */
export function fresnelRadiusM(d1, d2, freqMHz) {
  const lambda = SPEED_OF_LIGHT_M_S / (freqMHz * 1e6);
  return Math.sqrt((lambda * d1 * d2) / (d1 + d2));
}

/** Through-loss (dB) of a platform body for a path of lengthM metres inside it. */
export function platformThroughLossDb(bodyId, lengthM, freqMHz = 600) {
  const b = PLATFORM_BODY[bodyId];
  if (!b) return 0;
  const f = Number.isFinite(freqMHz) && freqMHz > 0 ? freqMHz : 600;
  const l = Math.max(0, Number.isFinite(lengthM) ? lengthM : 0);
  return Math.min(b.maxLossDb, (b.interfaceDb + b.absorptionDbPerM * l) * Math.pow(f / 600, b.freqExponent));
}

/** Height (m) of the straight ray from (0, zA) to (D, zB) at horizontal distance x from A. */
export function rayHeightAt(zA, zB, D, x) { return zA + (zB - zA) * (x / D); }

// Library floor-surface ids (SURFACES) mapped to the platform body assumed under them. A platform or deck whose
// surface material is `carpet` or `wood` is taken as a hollow wood-on-frame deck; a `metal` deck as a framed steel deck
// (use 'steel-plate-deck' explicitly for a continuous metal skin); `concrete` as a solid podium.
export const SURFACE_PLATFORM_BODY = Object.freeze({
  wood: 'stage-deck-wood-frame',
  carpet: 'stage-deck-wood-frame',
  glass: 'stage-deck-wood-frame',
  metal: 'steel-truss-deck',
  concrete: 'concrete',
  grass: 'solid-riser'
});

// Obstruction table by floor material in the form the floor model reads: interface loss and dB per metre of chord at 600 MHz.
export const PLATFORM_OBSTRUCTION = Object.freeze(Object.fromEntries(Object.entries(SURFACE_PLATFORM_BODY).map(([surface, bodyId]) => {
  const b = PLATFORM_BODY[bodyId];
  return [surface, Object.freeze({ interfaceDb: b.interfaceDb, dbPerM: b.absorptionDbPerM, body: bodyId, maxLossDb: b.maxLossDb })];
})));

// Riser-face reflector material by floor surface id, as an id of MATERIALS in the library. `carpet` is not a MATERIALS id
// (it is a floor surface only); a carpeted or skirted face absorbs rather than reflects, so it maps to `drapes`.
export const SURFACE_RISER_FACE_MATERIAL = Object.freeze({
  wood: 'wood', carpet: 'drapes', glass: 'glass', metal: 'metal', concrete: 'concrete', grass: 'grass'
});
