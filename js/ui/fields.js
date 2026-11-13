// Pure helpers for the inspector forms (no DOM), so they can be unit tested in Node.
import { BANDS } from '../model/library.js';
import { dbmToUnit, powerToDbm, mToFt, ftToM } from '../model/units.js';

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Parse a user-typed number. Accepts a decimal comma. Returns NaN for empty or invalid text. */
export function parseNumber(text) {
  if (typeof text === 'number') return Number.isFinite(text) ? text : NaN;
  const t = String(text ?? '').trim().replace(',', '.');
  if (t === '' || t === '-' || t === '+' || t === '.') return NaN;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}

/** Display a number with at most `maxDecimals` decimals and no trailing zeros. */
export function formatNumber(v, maxDecimals = 3) {
  if (!Number.isFinite(v)) return '';
  const f = 10 ** maxDecimals;
  return String(Math.round(v * f) / f);
}

export const lengthToUi = (m, unit) => (unit === 'ft' ? mToFt(m) : m);
export const lengthFromUi = (v, unit) => (unit === 'ft' ? ftToM(v) : v);

/** Range for a Tx power field expressed in the UI unit; internal range -20..+50 dBm. */
export function powerFieldRange(unit) {
  const lo = dbmToUnit(-20, unit), hi = dbmToUnit(50, unit);
  return { min: unit === 'mW' ? Math.round(lo * 1000) / 1000 : lo, max: hi, step: unit === 'mW' ? 1 : 0.5 };
}

/** Convert a typed value in the UI power unit to dBm, clamped to the sane Tx range. Returns NaN if unusable. */
export function powerUiToDbm(value, unit) {
  if (!Number.isFinite(value)) return NaN;
  if (unit === 'mW' && value <= 0) return NaN;
  return clamp(powerToDbm(value, unit), -20, 50);
}

/** The band id that contains freqMHz, or '' for none. */
export function bandForFreq(freqMHz) {
  const b = BANDS.find((x) => freqMHz >= x.fromMHz && freqMHz <= x.toMHz);
  return b ? b.id : '';
}
export function bandCentre(bandId) {
  const b = BANDS.find((x) => x.id === bandId);
  return b ? Math.round(((b.fromMHz + b.toMHz) / 2) * 1000) / 1000 : NaN;
}

/** Rows for the paths table. `lengthUnit` is 'm' or 'ft'. */
export function pathRows(result, scene, lengthUnit = 'm') {
  if (!result) return [];
  return result.paths.map((p) => {
    const via = p.via ? (scene.reflectors || []).find((r) => r.id === p.via)?.name : '';
    const kind = p.kind === 'floor-wall' ? 'floor + wall' : p.kind;
    return {
      kind: via ? `${kind} (${via})` : kind,
      length: formatNumber(lengthToUi(p.lengthM, lengthUnit), 2),
      delayNs: formatNumber(p.delayNs, 1),
      relDb: p.kind === 'direct' ? '0.0' : (Math.abs(p.relDb) < 0.05 ? 0 : p.relDb).toFixed(1),
    };
  });
}

/** Human description of one chain item's contribution: "loss 2.1 dB" or "gain 10.0 dB". */
export function lossText(lossDb) {
  if (!Number.isFinite(lossDb)) return '-';
  return lossDb < 0 ? `gain ${(-lossDb).toFixed(1)} dB` : `loss ${lossDb.toFixed(1)} dB`;
}
