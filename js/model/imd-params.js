// Intermodulation (IMD) demonstration parameters and presets. Pure constants plus a few tiny pure helpers
// (no DOM, no state), all frozen. Units: dBm for levels, dB for ratios, dBc relative to a carrier, kHz, MHz, m.
//
// Everything here is GENERIC and ILLUSTRATIVE. Real receivers, combiners, amplifiers and connectors vary widely; passive
// intermodulation in particular changes with temperature, vibration and corrosion. Measure on site for critical rigs.
//
// Sources (derivations in docs/PHYSICS-IMD.md):
//  - Third-order intermodulation: a weakly nonlinear device y = a1 x + a3 x^3 gives 2f1-f2 and 2f2-f1 products at
//    3P - 2 IIP3 (dBm, input referred, equal tones), 3:1 slope; three-tone products f1+f2-f3 are 6 dB higher than the
//    two-tone product for equal tone levels. Fifth order: 5:1 slope. (Razavi, RF Microelectronics; Pozar, Microwave
//    Engineering; Crols and Steyaert, CMOS Wireless Transceiver Design.)
//  - Free-space coupling between antennas: 20 log10(4 pi d / lambda) minus the two antenna gains (Friis).
//  - Passive intermodulation test convention: two carriers of +43 dBm (20 W) each, PIM expressed in dBc relative to one
//    carrier (IEC 62037 series); about 3:1 power scaling (2 dB of dBc per dB of power), approx.
//  - Local-oscillator and transmitter phase-noise coupling: N = P_blocker + L(offset) + 10 log10(B) (standard
//    reciprocal-mixing relation).

export const SPEED_OF_LIGHT_M_S = 299792458;
export const THERMAL_NOISE_DBM_PER_HZ = -174;

// ---- Slopes ------------------------------------------------------------------------------------------------------
export const IM_SLOPES = Object.freeze({ third: 3, fifth: 5 });
export const THREE_TONE_EXTRA_DB = 6; // fi + fj - fk is 6 dB above 2fi - fj at equal tone levels (6 vs 3/4 a3 A^3 coefficient ratio 2)

// ---- Transmitter reverse intermodulation -------------------------------------------------------------------------
// Conversion loss of a power amplifier's reverse IM: the product 2 f_own - f_interferer at the PA output sits this many dB
// below the interferer level arriving at the PA output (at nominal own drive). Smaller number = worse. approx.
export const TX_REVERSE_IM_CONVERSION_DB = Object.freeze({
  'saturated-class-c': 10,   // approx: efficient, strongly nonlinear PA
  'class-ab': 20,            // approx
  'linear-class-a': 30       // approx
});
// Own-level dependence of the reverse product, dB per dB of own drive: 2 for an ideal cubic PA, about 1 or less when the PA
// is driven into limiting. The conversion loss above is taken at nominal power, so only deviations matter. approx.
export const TX_REVERSE_IM_OWN_SLOPE = Object.freeze({ cubic: 2, limiting: 1 });
// Extra conversion loss of the fifth-order reverse product (3 f_own - 2 f_interferer) relative to the third-order one, dB. approx.
export const TX_REVERSE_IM_5TH_EXTRA_DB = 15;
// Interferer level dependence: always 1 dB per dB (the product is linear in the interfering amplitude).
export const TX_REVERSE_IM_INTERFERER_SLOPE = 1;

// Antenna coupling. Below the near-field floor the 20 log d law stops (antennas load each other, field is reactive).
export const NEAR_FIELD_FLOOR_WAVELENGTHS = 0.5; // approx: treat distances under lambda/2 as lambda/2 (about 16 dB at 600 MHz)

export const COMBINER_PRESETS = Object.freeze({
  none: Object.freeze({ id: 'none', label: 'No combiner, separate antennas (illustrative)', illustrative: true, insertionLossDb: 0, isolationDb: 0 }),
  'passive-hybrid': Object.freeze({ id: 'passive-hybrid', label: 'Passive hybrid combiner (illustrative)', illustrative: true, insertionLossDb: 3.5, isolationDb: 25 }), // approx: 3 dB split + ~0.5 dB; isolation 20 to 30 dB
  'isolated-cavity': Object.freeze({ id: 'isolated-cavity', label: 'Circulator / cavity-isolated combiner (illustrative)', illustrative: true, insertionLossDb: 2, isolationDb: 50 }) // approx: isolation 40 to 60 dB
});

// ---- Transmitter noise skirt -------------------------------------------------------------------------------------
// Wideband noise of a transmitter relative to its carrier, dBc/Hz, at a frequency offset (approx; synthesiser phase noise
// falling to the PA/driver broadband floor).
export const TX_NOISE_DBC_PER_HZ = Object.freeze([
  Object.freeze({ offsetKhz: 200, dbcPerHz: -105 }),
  Object.freeze({ offsetKhz: 500, dbcPerHz: -118 }),
  Object.freeze({ offsetKhz: 1000, dbcPerHz: -128 }),
  Object.freeze({ offsetKhz: 5000, dbcPerHz: -140 }),
  Object.freeze({ offsetKhz: 20000, dbcPerHz: -148 })
]);

// ---- Passive intermodulation (PIM) -------------------------------------------------------------------------------
// PIM of a junction in dBc relative to one carrier at the 2 x 43 dBm test condition. Scaling: IM power 3:1, so dBc
// changes 2 dB per dB of carrier power: dBc(P) = dBcRef + 2 (P - 43) with P in dBm per carrier. approx.
export const PIM_REFERENCE_DBM = 43;
export const PIM_SLOPE = 3;
export const PIM_JUNCTIONS = Object.freeze({
  'low-pim-connector': Object.freeze({ dbcAtRef: -160, note: 'approx: specified low-PIM hardware' }),
  'good-connector': Object.freeze({ dbcAtRef: -125, note: 'approx: clean, tight, properly mated' }),
  'loose-or-dirty-connector': Object.freeze({ dbcAtRef: -105, note: 'approx' }),
  'corroded-connector': Object.freeze({ dbcAtRef: -90, note: 'approx: oxide layers form metal-oxide-metal diodes' }),
  'ferromagnetic-junction': Object.freeze({ dbcAtRef: -75, note: 'approx: steel, nickel plating; hysteresis nonlinearity' }),
  'rusty-contact': Object.freeze({ dbcAtRef: -65, note: 'approx: rusty fence or truss joints near an antenna, accidental mixer' })
});

// ---- Presets -----------------------------------------------------------------------------------------------------
// mechanism: 'rx-front-end' | 'tx-reverse' | 'pim'.
const P = (o) => Object.freeze({ illustrative: true, ...o });
export const IMD_PRESETS = Object.freeze({
  // Eight mic transmitters at mid range feeding a receiver rack with a shared antenna.
  'mic-rack-typical': P({
    id: 'mic-rack-typical',
    label: 'Mic rack, shared antenna (illustrative)',
    mechanism: 'rx-front-end',
    nCarriers: 8,
    toneLevelDbm: -35,           // approx: each transmitter at the receive antenna terminals
    rxPresetId: 'mic-receiver-typical',
    iip3Dbm: -8,                 // equals the rx-params preset
    iip5Dbm: 6,                  // approx: fifth-order intercept, typically well above IIP3
    noiseFigureDb: 8,
    channelBwKhz: 200,
    channelSpacingKhz: 400
  }),
  // Passive hybrid combiner feeding one or two antennas, no isolators.
  'iem-combiner-no-isolation': P({
    id: 'iem-combiner-no-isolation',
    label: 'IEM combiner, no isolators (illustrative)',
    mechanism: 'tx-reverse',
    combiner: 'passive-hybrid',
    txPowerDbm: 17,              // 50 mW, approx
    paType: 'class-ab',
    paConversionDb: TX_REVERSE_IM_CONVERSION_DB['class-ab'],
    antennaSpacingM: 0,          // 0 = all transmitters through one combiner output
    channelBwKhz: 200,
    channelSpacingKhz: 400
  }),
  // Circulator or cavity isolated combiner: the interferer is knocked down before it reaches the other PA.
  'iem-combiner-isolated': P({
    id: 'iem-combiner-isolated',
    label: 'IEM combiner, isolated (illustrative)',
    mechanism: 'tx-reverse',
    combiner: 'isolated-cavity',
    txPowerDbm: 17,
    paType: 'class-ab',
    paConversionDb: TX_REVERSE_IM_CONVERSION_DB['class-ab'],
    antennaSpacingM: 0,
    channelBwKhz: 200,
    channelSpacingKhz: 400
  }),
  // A corroded connector in a transmit antenna line.
  'pim-corroded-connector': P({
    id: 'pim-corroded-connector',
    label: 'Corroded connector, PIM (illustrative)',
    mechanism: 'pim',
    junction: 'corroded-connector',
    carrierDbm: 17,
    nCarriers: 2,
    slope: PIM_SLOPE,
    channelBwKhz: 200,
    channelSpacingKhz: 400
  })
});

// ---- Coordination rules ------------------------------------------------------------------------------------------
export const coordinationRules = Object.freeze({
  // Minimum centre-to-centre spacing between any two simultaneously used channels, kHz (approx).
  minChannelSpacingKhz: 300,
  // An IM product of FM signals is wider than a carrier: roughly three times the channel bandwidth. Its centre must stay
  // at least (B_wanted + B_product) / 2 = 2 B from any used channel centre. approx.
  productBandwidthFactor: 3,
  minProductClearanceInBandwidths: 2,
  // Required wanted-to-interference ratio at the receiver for clean audio, dB (approx).
  requiredCiDb: 30,
  // An IM product is tolerable when it sits this far below the receiver noise floor, dB.
  belowNoiseMarginDb: 6,
  // Guard band at the edges of a block, kHz (approx).
  edgeGuardKhz: 200,
  notes: Object.freeze([
    'Equal channel spacing is the worst case: with channels at f, f + d, f + 2d the product 2(f + d) - f lands exactly on f + 2d.',
    'Choose frequencies from an intermodulation-free set (no fi + fj - fk or 2fi - fj within the clearance of any used channel).',
    'Third-order products dominate; check fifth order only when third order is clean or levels are high.',
    'Reduce the cause as well: lower levels at the receiver (distance, pads), isolators in transmitter combiners, clean connectors.'
  ])
});

// ---- Small pure helpers (used by the demonstration and tests) ----------------------------------------------------
/** Number of intermodulation products of the given odd order (3, 5, ...) that can land near the carrier band, for N distinct
 *  tones: integer vectors a with sum a_i = 1 and sum |a_i| = order, no tone appearing with both signs.
 *  Third order: N(N-1) two-tone (2fi - fj) + N(N-1)(N-2)/2 three-tone (fi + fj - fk) = N^2 (N-1) / 2. */
export function imProductCount(n, order) {
  if (!(n >= 1) || order % 2 === 0 || order < 3) return 0;
  const pos = (order + 1) / 2, neg = (order - 1) / 2;
  // Distribute `pos` positive units and `neg` negative units over n tones; each tone takes only one sign.
  const rec = (i, p, q) => {
    if (i === n) return p === 0 && q === 0 ? 1 : 0;
    let total = rec(i + 1, p, q); // tone unused
    for (let k = 1; k <= p; k++) total += rec(i + 1, p - k, q);
    for (let k = 1; k <= q; k++) total += rec(i + 1, p, q - k);
    return total;
  };
  return rec(0, pos, neg);
}

/** Free-space coupling loss between two antennas, dB (positive): 20 log10(4 pi d / lambda) - gains, with a near-field floor. */
export function couplingLossDb(distanceM, freqMHz, gainTxDbi = 0, gainRxDbi = 0) {
  const lambda = SPEED_OF_LIGHT_M_S / (freqMHz * 1e6);
  const d = Math.max(distanceM, NEAR_FIELD_FLOOR_WAVELENGTHS * lambda);
  return 20 * Math.log10((4 * Math.PI * d) / lambda) - gainTxDbi - gainRxDbi;
}

/** Third-order two-tone product level, dBm: 2 P1 + P2 - 2 IIP3 (input referred). Equal tones: 3 P - 2 IIP3. */
export function im3TwoToneDbm(p1Dbm, p2Dbm, iip3Dbm) { return 2 * p1Dbm + p2Dbm - 2 * iip3Dbm; }
/** Third-order three-tone product level, dBm: P1 + P2 + P3 - 2 IIP3 + 6 dB. */
export function im3ThreeToneDbm(p1Dbm, p2Dbm, p3Dbm, iip3Dbm) { return p1Dbm + p2Dbm + p3Dbm - 2 * iip3Dbm + THREE_TONE_EXTRA_DB; }
/** Fifth-order 3 f1 - 2 f2 product level, dBm: 3 P1 + 2 P2 - 4 IIP5. */
export function im5Dbm(p1Dbm, p2Dbm, iip5Dbm) { return 3 * p1Dbm + 2 * p2Dbm - 4 * iip5Dbm; }

/** Transmitter noise floor in dBc/Hz at an offset (kHz), log-frequency interpolated, clamped at the ends. */
export function txNoiseDbcPerHz(offsetKhz) {
  const t = TX_NOISE_DBC_PER_HZ;
  if (offsetKhz <= t[0].offsetKhz) return t[0].dbcPerHz;
  for (let i = 1; i < t.length; i++) {
    if (offsetKhz <= t[i].offsetKhz) {
      const a = t[i - 1], b = t[i];
      const u = Math.log(offsetKhz / a.offsetKhz) / Math.log(b.offsetKhz / a.offsetKhz);
      return a.dbcPerHz + u * (b.dbcPerHz - a.dbcPerHz);
    }
  }
  return t[t.length - 1].dbcPerHz;
}

/** Coupled transmitter noise in a receiver of bandwidth B (Hz): P_at_rx + L(offset) + 10 log10(B), dBm. */
export function coupledNoiseDbm(txPowerAtRxDbm, offsetKhz, bandwidthHz) {
  return txPowerAtRxDbm + txNoiseDbcPerHz(offsetKhz) + 10 * Math.log10(bandwidthHz);
}

/** PIM level in dBc for a junction at a given per-carrier power (dBm): dBcRef + (slope - 1) (P - 43). */
export function pimDbc(junctionId, carrierDbm) {
  const j = PIM_JUNCTIONS[junctionId];
  if (!j) return NaN;
  return j.dbcAtRef + (PIM_SLOPE - 1) * (carrierDbm - PIM_REFERENCE_DBM);
}

/** Reverse IM product at a PA output, dBm: interferer at the PA output - conversion loss. */
export function reverseImDbm(interfererAtPaDbm, conversionDb) { return interfererAtPaDbm - conversionDb; }
