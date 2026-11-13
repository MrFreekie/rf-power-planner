// Telemetry data channel and battery parameters. Pure constants (no DOM, no state), all frozen.
// Units: kHz, bits per second, ms, volts, hours, mW, dB.
//
// Everything here is GENERIC and ILLUSTRATIVE. Real wireless microphone and in-ear-monitor systems differ:
// many carry telemetry on proprietary subcarriers, in sub-audio tones, in a digital link, or on a separate
// return link, and battery curves depend on the cell, the load and the temperature. These presets are a demo.
//
// Sources (derivations in docs/PHYSICS-DATA.md):
//  - Subcarrier above the stereo band: the RDS data subcarrier sits at 57 kHz, the third harmonic of the
//    19 kHz pilot, with 1187.5 bit/s DBPSK (IEC 62106, ITU-R BS.450 context). The "rds-like" preset borrows only
//    those textbook numbers.
//  - Data error rate: DPSK BER = (1/2) exp(-Eb/N0); noncoherent binary FSK BER = (1/2) exp(-Eb/(2 N0))
//    (Proakis, Digital Communications; Haykin, Communication Systems).
//  - FM discriminator noise density grows as f^2 (triangular noise), so a subcarrier at frequency f sees
//    noise N0 f^2 / C per Hz (Taub and Schilling, Principles of Communication Systems).
//  - Battery: manufacturer discharge curves for AA alkaline, NiMH and Li-ion cells (shape only; approx).

export const DATA_STRUCTURE = Object.freeze({
  minSubcarrierKhz: 53,        // data must sit above the L-R band (23 to 53 kHz)
  crcBits: 16,
  // Payload layout, generic. Bits per field.
  fields: Object.freeze([
    Object.freeze({ id: 'battery', bits: 8 }),
    Object.freeze({ id: 'status', bits: 8 }),
    Object.freeze({ id: 'name', bits: 42 }),   // 6 characters, 7 bits each
    Object.freeze({ id: 'gain', bits: 8 }),
    Object.freeze({ id: 'muteFlags', bits: 4 })
  ])
});

// Data-link presets. Lock and lose are CNR thresholds with hysteresis, in the IF channel bandwidth.
// Data Eb/N0 law (see docs): Eb/N0 = (dev_d^2 / 2) * CNR * B / (Rb * fs^2) with dev_d = injectionFrac * peak
// deviation, B the channel bandwidth, Rb the bit rate and fs the subcarrier frequency (same units for dev_d and fs).
// In dB: EbN0 = CNR + 10log10(dev_d^2 B / (2 Rb fs^2)). Below the FM threshold it drops a further `belowThresholdSlope`
// dB per dB of CNR lost (approx). BER from `modulation`; PER = 1 - (1 - BER)^packetBits (no error correction).
export const DATA_PRESETS = Object.freeze({
  'rds-like': Object.freeze({
    id: 'rds-like',
    label: 'RDS-like subcarrier (illustrative)',
    illustrative: true,
    subcarrierKHz: 57,           // 3 x pilot
    bitrate: 1187.5,
    modulation: 'dpsk',
    injectionFrac: 0.03,         // approx: fraction of peak deviation taken by the data subcarrier
    lockCnrDb: 18,               // approx: design value, near the pilot detect point
    loseCnrDb: 15,
    packetBits: 104,
    packetIntervalMs: 250,
    maxStaleMs: 1500,
    fmThresholdCnrDb: 11,
    belowThresholdSlope: 3
  }),
  'narrow-telemetry': Object.freeze({
    id: 'narrow-telemetry',
    label: 'Narrowband telemetry (illustrative)',
    illustrative: true,
    subcarrierKHz: 60,           // above the L-R band, clear of 57 kHz
    bitrate: 300,
    modulation: 'dpsk',
    injectionFrac: 0.04,         // approx
    lockCnrDb: 14,               // approx: lower bit rate decodes about 3 dB lower than rds-like
    loseCnrDb: 11,
    packetBits: 96,
    packetIntervalMs: 500,
    maxStaleMs: 3000,
    fmThresholdCnrDb: 11,
    belowThresholdSlope: 3
  })
});

// Battery presets. curve: [fraction of capacity used (0..1), terminal voltage under a light load] with strictly
// increasing used-fraction and strictly decreasing voltage (the NiMH plateau is gently sloped, not flat).
// socMap: [voltage, percent] strictly increasing in both, used by a simple gauge. gaugeErrorPct is the approximate
// error of a voltage-only gauge. runtimeHours: typical figures (approx) for a mic transmitter and an IEM bodypack.
// tx: transmit-power law  P = Pnom                                 for V >= vRegV
//                         P = Pnom * ((V - vMinV)/(vRegV - vMinV))^sagExponent   for vMinV < V < vRegV
//                         P = 0 (dropout)                          for V <= vMinV.
export const BATTERY_PRESETS = Object.freeze({
  'alkaline-aa-x2': Object.freeze({
    id: 'alkaline-aa-x2',
    label: '2 x AA alkaline (illustrative)',
    illustrative: true,
    cells: 2,
    fullV: 3.1,
    nominalV: 2.7,               // approx
    cutoffV: 1.8,                // 0.9 V per cell
    curve: Object.freeze([[0, 3.1], [0.1, 2.85], [0.2, 2.72], [0.4, 2.5], [0.6, 2.3], [0.8, 2.1], [0.9, 1.95], [1, 1.8]]),
    socMap: Object.freeze([[1.8, 0], [1.95, 10], [2.1, 20], [2.3, 40], [2.5, 60], [2.72, 80], [2.85, 90], [3.1, 100]]),
    gaugeErrorPct: 25,           // approx: sloping curve, resistance rises with use, load and temperature move it
    warnLowPct: 25,
    warnCriticalPct: 10,
    warnLowV: 2.2,
    warnCriticalV: 2.0,
    runtimeHours: Object.freeze({ mic: 10, iem: 8 }),   // approx
    tx: Object.freeze({ vRegV: 2.2, vMinV: 1.9, sagExponent: 2 })
  }),
  'nimh-aa-x2': Object.freeze({
    id: 'nimh-aa-x2',
    label: '2 x AA NiMH (illustrative)',
    illustrative: true,
    cells: 2,
    fullV: 2.8,
    nominalV: 2.4,
    cutoffV: 1.8,
    curve: Object.freeze([[0, 2.8], [0.05, 2.62], [0.1, 2.52], [0.3, 2.46], [0.6, 2.4], [0.85, 2.34], [0.92, 2.28], [0.96, 2.16], [0.985, 2.0], [1, 1.8]]),
    socMap: Object.freeze([[1.8, 0], [2.0, 1.5], [2.16, 4], [2.28, 8], [2.34, 15], [2.4, 40], [2.46, 70], [2.52, 90], [2.62, 95], [2.8, 100]]),
    gaugeErrorPct: 30,           // approx: a flat plateau makes voltage nearly useless between 15 and 90 %
    warnLowPct: 20,
    warnCriticalPct: 8,
    warnLowV: 2.3,
    warnCriticalV: 2.16,
    runtimeHours: Object.freeze({ mic: 8, iem: 6.5 }),  // approx
    tx: Object.freeze({ vRegV: 2.3, vMinV: 2.0, sagExponent: 2 })
  }),
  'li-ion-1s': Object.freeze({
    id: 'li-ion-1s',
    label: '1S Li-ion (illustrative)',
    illustrative: true,
    cells: 1,
    fullV: 4.2,
    nominalV: 3.7,
    cutoffV: 3.0,
    curve: Object.freeze([[0, 4.2], [0.05, 4.05], [0.1, 3.95], [0.3, 3.82], [0.5, 3.72], [0.7, 3.6], [0.9, 3.42], [0.95, 3.3], [0.98, 3.12], [1, 3.0]]),
    socMap: Object.freeze([[3.0, 0], [3.12, 2], [3.3, 5], [3.42, 10], [3.6, 30], [3.72, 50], [3.82, 70], [3.95, 90], [4.05, 95], [4.2, 100]]),
    gaugeErrorPct: 8,            // approx: monotonic and steeper, still load and temperature dependent
    warnLowPct: 20,
    warnCriticalPct: 8,
    warnLowV: 3.5,
    warnCriticalV: 3.3,
    runtimeHours: Object.freeze({ mic: 12, iem: 10 }),  // approx
    tx: Object.freeze({ vRegV: 3.4, vMinV: 3.1, sagExponent: 2 })
  })
});

export const DATA_DEFAULTS = DATA_PRESETS['narrow-telemetry'];
export const BATTERY_DEFAULTS = BATTERY_PRESETS['alkaline-aa-x2'];

// The same battery data in the form the telemetry model reads: curve = [state of charge 0..1, volts] ascending in
// charge (0 = empty), vRegulated = voltage below which a regulated transmitter starts to lose power,
// runtimeHours = mic transmitter figure.
export const BATTERY_CHEMISTRIES = Object.freeze(Object.fromEntries(Object.values(BATTERY_PRESETS).map((b) => [b.id, Object.freeze({
  runtimeHours: b.runtimeHours.mic,
  vRegulated: b.tx.vRegV,
  vDropout: b.tx.vMinV,
  curve: Object.freeze(b.curve.map(([used, v]) => Object.freeze([Math.round((1 - used) * 1e6) / 1e6, v])).reverse())
})])));

// Optional logistic fit of the PER law for telemetry.js (per50CnrDb, perSlopeDb). Kept out of the presets so that the
// default behaviour (centre at loseCnrDb) is unchanged; merge it in explicitly: { ...DATA_PRESETS[id], ...DATA_PER_FIT[id] }.
export const DATA_PER_FIT = Object.freeze({
  'rds-like': Object.freeze({ per50CnrDb: 15.2, perSlopeDb: 2 }),          // approx, 104-bit packets
  'narrow-telemetry': Object.freeze({ per50CnrDb: 10, perSlopeDb: 2 })     // approx, 96-bit packets, includes threshold penalty
});

// ---- Battery gauge: reported versus true percent ----------------------------------------------------------------
// Real devices estimate charge from the terminal voltage under load through a fixed map. The map cannot know the cell
// chemistry's real curve shape, the load current or the temperature, so the reported percent differs from the true
// remaining capacity. Generic illustrative maps (approx); real products differ.
export const GAUGE_MAPS = Object.freeze({
  'alkaline-linear': Object.freeze([[2.0, 0], [3.0, 100]]),     // approx: straight line, typical of a simple bar display
  'nimh-linear': Object.freeze([[2.2, 0], [2.6, 100]]),          // approx
  'li-ion-table': Object.freeze([[3.0, 0], [3.12, 2], [3.3, 5], [3.42, 10], [3.6, 30], [3.72, 50], [3.82, 70], [3.95, 90], [4.05, 95], [4.2, 100]])
});

// Pack internal resistance (ohm, fresh to depleted; rises as the cell is used) and typical load current (mA). The terminal
// voltage under load is V(used) - I R(used) (approx). Alkaline resistance grows several-fold, so the same capacity reads
// lower under load late in the discharge.
export const BATTERY_LOAD = Object.freeze({
  'alkaline-aa-x2': Object.freeze({ gaugeMap: 'alkaline-linear', rintOhm: Object.freeze({ full: 0.4, empty: 2.0 }), reportedErrorPct: 30 }),
  'nimh-aa-x2': Object.freeze({ gaugeMap: 'nimh-linear', rintOhm: Object.freeze({ full: 0.1, empty: 0.25 }), reportedErrorPct: 14 }),
  'li-ion-1s': Object.freeze({ gaugeMap: 'li-ion-table', rintOhm: Object.freeze({ full: 0.15, empty: 0.35 }), reportedErrorPct: 7 })
});
export const LOAD_CURRENT_MA = Object.freeze({ mic: 150, iem: 120 }); // approx

/** Terminal voltage under load for a battery id at a used fraction (0 = full), for 'mic' or 'iem' load. */
export function loadedVoltage(id, usedFrac, kind = 'mic') {
  const b = BATTERY_PRESETS[id], l = BATTERY_LOAD[id];
  if (!b || !l) return NaN;
  const u = Math.min(1, Math.max(0, usedFrac));
  const c = b.curve;
  let v = c[c.length - 1][1];
  if (u <= c[0][0]) v = c[0][1];
  else for (let i = 1; i < c.length; i++) if (u <= c[i][0]) { v = c[i - 1][1] + (c[i][1] - c[i - 1][1]) * (u - c[i - 1][0]) / (c[i][0] - c[i - 1][0]); break; }
  const r = l.rintOhm.full + (l.rintOhm.empty - l.rintOhm.full) * u;
  return v - (LOAD_CURRENT_MA[kind] ?? LOAD_CURRENT_MA.mic) * 1e-3 * r;
}

/** Percent reported by gauge map `mapId` for a terminal voltage (clamped 0..100). */
export function gaugePercent(mapId, voltage) {
  const m = GAUGE_MAPS[mapId];
  if (!m || !Number.isFinite(voltage)) return NaN;
  if (voltage <= m[0][0]) return 0;
  if (voltage >= m[m.length - 1][0]) return 100;
  for (let i = 1; i < m.length; i++) {
    if (voltage <= m[i][0]) return m[i - 1][1] + (m[i][1] - m[i - 1][1]) * (voltage - m[i - 1][0]) / (m[i][0] - m[i - 1][0]);
  }
  return 100;
}

/** Reported percent for a battery at a used fraction, with its own gauge map (or `mapId`). True percent = 100 (1 - used). */
export function reportedPercent(id, usedFrac, kind = 'mic', mapId) {
  const l = BATTERY_LOAD[id];
  return gaugePercent(mapId || (l && l.gaugeMap), loadedVoltage(id, usedFrac, kind));
}
