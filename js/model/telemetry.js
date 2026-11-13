// Virtual telemetry: battery discharge and a narrow data subcarrier above the MPX band.
// Pure module (no DOM), deterministic (seeded PRNG, no Math.random).
//
// Parameters come from data-params.js when present (DATA_PRESETS / DATA_DEFAULTS); the constants
// below back-fill any missing field. Everything here is illustrative, not a product model.

let PARAMS = {};
try { PARAMS = await import('./data-params.js'); } catch { PARAMS = {}; }

const FALLBACK = {
  subcarrierKHz: 67,
  bitrate: 1200,
  injectionFrac: 0.05,
  lockCnrDb: 16,
  loseCnrDb: 13,
  packetIntervalMs: 500,
  maxStaleMs: 3000,
  perSlopeDb: 2, // dB of CNR per decade of PER
};

function baseConfig(cfg) {
  if (PARAMS.DATA_DEFAULTS && typeof PARAMS.DATA_DEFAULTS === 'object') {
    // PER fit (per50CnrDb centred on the Eb/N0 law) is merged for the default preset, or for the preset named by
    // cfg.id; a bare config that gives its own thresholds keeps its own PER centre (loseCnrDb).
    const id = (cfg && cfg.id) || (!cfg || !Object.keys(cfg).length ? PARAMS.DATA_DEFAULTS.id : null);
    const fit = id && PARAMS.DATA_PER_FIT ? PARAMS.DATA_PER_FIT[id] : null;
    return fit ? { ...PARAMS.DATA_DEFAULTS, ...fit } : PARAMS.DATA_DEFAULTS;
  }
  const p = PARAMS.DATA_PRESETS;
  if (p && typeof p === 'object') {
    const first = p.default || Object.values(p)[0];
    if (first && typeof first === 'object') return first;
  }
  return {};
}
const cfgOf = (cfg) => ({ ...FALLBACK, ...baseConfig(cfg), ...(cfg || {}) });

/**
 * Packet error rate versus CNR. Logistic in dB: per = 1 / (1 + 10^((cnr - c50) / slope)),
 * c50 = per50CnrDb (default loseCnrDb), slope = perSlopeDb (default 2 dB per decade).
 * Limits: -> 1 for very low CNR (and for non-finite CNR), -> 0 for high CNR; exactly 0.5 at c50.
 */
export function perFromCnr(cnrDb, cfg) {
  const c = cfgOf(cfg);
  if (!Number.isFinite(cnrDb)) return cnrDb > 0 ? 0 : 1;
  // Centre: the caller's own per50CnrDb, else the fit of the preset named by cfg.id, else the caller's own loseCnrDb (a bare config keeps its own thresholds),
  // else the preset's fitted per50CnrDb (centred on the Eb/N0 law), else its loseCnrDb.
  const own = cfg || {};
  const idFit = own.id && PARAMS.DATA_PER_FIT ? PARAMS.DATA_PER_FIT[own.id] : null;
  const c50 = Number.isFinite(own.per50CnrDb) ? own.per50CnrDb
    : idFit && Number.isFinite(idFit.per50CnrDb) ? idFit.per50CnrDb
      : Number.isFinite(own.loseCnrDb) ? own.loseCnrDb
      : Number.isFinite(c.per50CnrDb) ? c.per50CnrDb : c.loseCnrDb;
  const e = (cnrDb - c50) / c.perSlopeDb;
  if (e > 300) return 0;
  if (e < -300) return 1;
  return 1 / (1 + Math.pow(10, e));
}

// ---- battery -------------------------------------------------------------------------------

// Battery models come from BATTERY_PRESETS in data-params.js. EMERGENCY is used only when that file is missing
// or the chemistry id is unknown, so the module never throws.
const EMERGENCY = {
  curve: [[0, 3.1], [0.1, 2.85], [0.4, 2.5], [0.8, 2.1], [1, 1.8]],
  runtimeHours: { mic: 10, iem: 8 },
  tx: { vRegV: 2.2, vMinV: 1.9, sagExponent: 2 },
};

// Normalise a preset to { runtimeHours, curve (soc -> V, ascending soc), sagDb(V), vMin, warnLowPct, warnLowV }.
// Presets list [fraction used, V]; tx law: P/Pnom = ((V - vMin)/(vReg - vMin))^k below vReg, dropout at V <= vMin.
function normaliseModel(m, kind) {
  const curve = m.curve.map(([used, v]) => [1 - used, v]).reverse();
  const rt = typeof m.runtimeHours === 'object' ? (m.runtimeHours[kind] ?? m.runtimeHours.mic) : m.runtimeHours;
  const { vRegV, vMinV, sagExponent = 2 } = m.tx;
  const sagDb = (v) => {
    if (v >= vRegV) return 0;
    const r = (v - vMinV) / (vRegV - vMinV);
    return r <= 0.0001 ? 40 : Math.min(40, -10 * sagExponent * Math.log10(r)); // power ratio = r^k
  };
  // tx.vMinV is the single dropout-voltage field (preset and model share it)
  return { runtimeHours: rt, curve, sagDb, tx: m.tx, warnLowPct: m.warnLowPct, warnLowV: m.warnLowV, id: m.id };
}

function modelOf(chemistry, kind, model) {
  if (model) return normaliseModel(model, kind);
  const all = PARAMS.BATTERY_PRESETS || {};
  const ext = all[chemistry] && all[chemistry].curve ? all[chemistry] : all['alkaline-aa-x2'];
  return normaliseModel(ext && ext.curve ? ext : EMERGENCY, kind);
}

function interp(curve, x) {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (x <= curve[i][0]) {
      const [x0, y0] = curve[i - 1], [x1, y1] = curve[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return curve[curve.length - 1][1];
}

/**
 * batteryStep(prev, { chemistry, dtSeconds, timeScale = 1, loadFactor = 1, kind = 'mic', model })
 *   -> { socFrac, voltage, percentReported, lowWarning, txPowerSagDb, dead }
 * soc falls by dt * timeScale * loadFactor / (runtimeHours * 3600). Deterministic and monotonic.
 * Chemistry data comes from BATTERY_PRESETS (`model` overrides it for tests; `kind` 'mic'|'iem' picks the runtime).
 * txPowerSagDb (>= 0): P/Pnom = ((V - vMin)/(vReg - vMin))^k, sag = -10 log10(P/Pnom), capped at 40 dB.
 * dead: the transmitter drops out at V <= vMin (the dropout voltage), or the charge is zero.
 * lowWarning: percent <= warnLowPct or LOADED voltage <= warnLowV (a real device sees the loaded voltage) when the preset has
 * them, else soc <= 0.15. Sag data has one source: BATTERY_LOAD in data-params.js.
 * Gauge: reportedPercent is what a simple voltage-based gauge shows: the LOADED terminal voltage V(used) - I R(used) (BATTERY_LOAD,
 * LOAD_CURRENT_MA in data-params.js; resistance rises with use) through the gauge map of the chemistry (`gaugeMap` option picks
 * another map, e.g. a wrong chemistry setting). trueSocPercent = 100 soc; gaugeErrorPct = reported - true (negative = reads low);
 * percentReported = round(reported) is kept for compatibility. Results also carry loadedVoltage. An explicit `model` (tests)
 * has an ideal gauge.
 * prev may be null (starts full) or an earlier result ({ socFrac }).
 */
export function batteryStep(prev, { chemistry = 'alkaline-aa-x2', dtSeconds = 0, timeScale = 1, loadFactor = 1, kind = 'mic', model, gaugeMap } = {}) {
  const m = modelOf(chemistry, kind, model);
  const start = prev && Number.isFinite(prev.socFrac) ? prev.socFrac : 1;
  const drain = (Math.max(0, dtSeconds) * Math.max(0, timeScale) * Math.max(0, loadFactor)) / (m.runtimeHours * 3600);
  const socFrac = Math.min(1, Math.max(0, start - drain));
  const voltage = interp(m.curve, socFrac);
  const sag = m.sagDb(voltage);
  const trueSocPercent = socFrac * 100;
  // Gauge: the physicist's parameter file supplies the loaded terminal voltage (V(used) - I R(used)) and the gauge map of
  // the chemistry; without it (or with an explicit `model`) the gauge is ideal.
  let reportedPercent = trueSocPercent;
  let loadedVoltage = voltage;
  if (!model && PARAMS.reportedPercent && PARAMS.BATTERY_LOAD && PARAMS.BATTERY_LOAD[m.id]) {
    loadedVoltage = PARAMS.loadedVoltage(m.id, 1 - socFrac, kind);
    reportedPercent = PARAMS.reportedPercent(m.id, 1 - socFrac, kind, gaugeMap);
    if (!Number.isFinite(reportedPercent)) reportedPercent = trueSocPercent;
  }
  const lowWarning = Number.isFinite(m.warnLowPct) || Number.isFinite(m.warnLowV)
    ? (Number.isFinite(m.warnLowPct) && socFrac * 100 <= m.warnLowPct) || (Number.isFinite(m.warnLowV) && loadedVoltage <= m.warnLowV)
    : socFrac <= 0.15;
  return {
    socFrac,
    voltage,
    percentReported: Math.round(reportedPercent),
    trueSocPercent,
    reportedPercent,
    gaugeErrorPct: reportedPercent - trueSocPercent,
    loadedVoltage,
    lowWarning,
    txPowerSagDb: sag,
    dead: voltage <= m.tx.vMinV || socFrac <= 0,
  };
}

// ---- data link -----------------------------------------------------------------------------

// Deterministic uniform [0,1) for (seed, packet slot): integer hash (mulberry32 finaliser).
function uniform(seed, slot) {
  let a = (Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(slot | 0, 0xc2b2ae35)) | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * dataLinkStep(prev, cnrDb, cfg, tMs, battery, deviceState, { seed })
 *   -> { locked, per, lastPacketMs, ageMs, stale, packetsOk, packetsLost, slot, decoded }
 * Lock has hysteresis: locks at cnr >= lockCnrDb, holds until cnr < loseCnrDb.
 * One packet is attempted per packetIntervalMs slot (slot k covers [k*interval, (k+1)*interval)). A slot is received
 * when the link is locked and uniform(seed, k) >= PER; otherwise it is lost. Decoded fields update only on reception
 * (from `battery` {percentReported, voltage} and `deviceState` {name, gainDb, mute, rfLevelDbm}); between packets they
 * hold and ageMs grows. stale = ageMs > maxStaleMs (always true before the first packet).
 */
export function dataLinkStep(prev, cnrDb, cfg, tMs, battery, deviceState, { seed = 1 } = {}) {
  const c = cfgOf(cfg);
  const level = Number.isFinite(cnrDb) ? cnrDb : -Infinity;
  const wasLocked = !!(prev && prev.locked);
  const locked = wasLocked ? level >= c.loseCnrDb : level >= c.lockCnrDb;
  const per = perFromCnr(level, cfg); // raw cfg: own thresholds / preset id decide the PER centre
  const interval = Math.max(1, c.packetIntervalMs);
  const slotNow = Math.floor(tMs / interval);
  let slot = prev && Number.isFinite(prev.slot) ? prev.slot : slotNow - 1;
  let ok = prev ? prev.packetsOk : 0;
  let lost = prev ? prev.packetsLost : 0;
  let last = prev && Number.isFinite(prev.lastPacketMs) ? prev.lastPacketMs : null;
  let decoded = prev && prev.decoded
    ? { ...prev.decoded }
    : { battery: null, voltage: null, name: null, gainDb: null, mute: null, rfLevelDbm: null };
  const from = Math.max(slot + 1, slotNow - 1000); // bound the work after a long gap
  for (let k = from; k <= slotNow; k++) {
    if (locked && uniform(seed, k) >= per) {
      ok++;
      last = k * interval;
      const d = deviceState || {};
      decoded = {
        battery: battery && Number.isFinite(battery.percentReported) ? battery.percentReported : decoded.battery,
        voltage: battery && Number.isFinite(battery.voltage) ? battery.voltage : decoded.voltage,
        name: d.name ?? decoded.name,
        gainDb: d.gainDb ?? decoded.gainDb,
        mute: d.mute ?? decoded.mute,
        rfLevelDbm: d.rfLevelDbm ?? decoded.rfLevelDbm,
      };
    } else {
      lost++;
    }
  }
  slot = Math.max(slot, slotNow);
  const ageMs = last === null ? Infinity : Math.max(0, tMs - last);
  return { locked, per, lastPacketMs: last, ageMs, stale: ageMs > c.maxStaleMs, packetsOk: ok, packetsLost: lost, slot, decoded };
}
