// Unit conversions and formatting. Pure, no dependencies.
// Internal units: dBm, metres. These helpers sit at the UI edge.

export const dbmToMw = (dbm) => Math.pow(10, dbm / 10);
export const mwToDbm = (mw) => 10 * Math.log10(mw);
export const dbmToW = (dbm) => Math.pow(10, dbm / 10) / 1000;
export const wToDbm = (w) => 10 * Math.log10(w * 1000);
export const dbmToDbw = (dbm) => dbm - 30;
export const dbwToDbm = (dbw) => dbw + 30;

export const FT_PER_M = 1 / 0.3048;
export const mToFt = (m) => m * FT_PER_M;
export const ftToM = (ft) => ft * 0.3048;

/** Convert a value in the given UI power unit ('dBm'|'dBW'|'mW') to dBm. */
export function powerToDbm(value, unit = 'dBm') {
  if (unit === 'dBW') return dbwToDbm(value);
  if (unit === 'mW') return mwToDbm(value);
  return value;
}

/** Convert dBm to a number in the given UI power unit. */
export function dbmToUnit(dbm, unit = 'dBm') {
  if (unit === 'dBW') return dbmToDbw(dbm);
  if (unit === 'mW') return dbmToMw(dbm);
  return dbm;
}

/** Format a dBm level in the UI power unit, e.g. "13.0 dBm", "-17.0 dBW", "20 mW". */
export function formatPower(dbm, unit = 'dBm') {
  if (!Number.isFinite(dbm)) return '-';
  if (unit === 'mW') {
    const mw = dbmToMw(dbm);
    const digits = mw >= 100 ? 0 : mw >= 10 ? 1 : mw >= 1 ? 2 : 3;
    return `${mw.toFixed(digits)} mW`;
  }
  return `${dbmToUnit(dbm, unit).toFixed(1)} ${unit === 'dBW' ? 'dBW' : 'dBm'}`;
}

/** Format a metre length in the UI length unit ('m'|'ft'). */
export function formatLength(m, unit = 'm') {
  if (!Number.isFinite(m)) return '-';
  return unit === 'ft' ? `${mToFt(m).toFixed(1)} ft` : `${m.toFixed(2)} m`;
}

/** Format a dB value with explicit sign, e.g. "+3.0 dB". */
export function formatDb(db, digits = 1) {
  if (!Number.isFinite(db)) return '-';
  return `${db >= 0 ? '+' : ''}${db.toFixed(digits)} dB`;
}
