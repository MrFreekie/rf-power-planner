// Walk-test measurements: the stored shape and its validation. No imports (scene.js uses it), pure.
//   scene.measurements: optional array (at most 200) of { id, linkId, x, y, z?, rxDbm, note?, t? }
//   x, y, z = the receiver position of the reading, metres (z omitted: the link's own receiver height); rxDbm = the level read at the receiver input, dBm;
//   t = optional time of the reading (seconds, any origin); note = free text.
export const MEASUREMENT_LIMITS = Object.freeze({ max: 200, coordM: 10000, zM: [-100, 1000], dbm: [-200, 60], noteChars: 200, idChars: 64 });

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** validateMeasurement(m, path, errors): pushes plain error strings. */
export function validateMeasurement(m, path, errors) {
  const L = MEASUREMENT_LIMITS;
  if (m === null || typeof m !== 'object' || Array.isArray(m)) { errors.push(`${path} must be an object`); return; }
  if (typeof m.id !== 'string' || !m.id || m.id.length > L.idChars) errors.push(`${path}.id must be a non-empty string of at most ${L.idChars} characters`);
  if (typeof m.linkId !== 'string' || !m.linkId || m.linkId.length > L.idChars) errors.push(`${path}.linkId must be a non-empty string of at most ${L.idChars} characters`);
  for (const k of ['x', 'y']) if (!(isNum(m[k]) && Math.abs(m[k]) <= L.coordM)) errors.push(`${path}.${k} must be a number within +-${L.coordM} m`);
  if (m.z !== undefined && !(isNum(m.z) && m.z >= L.zM[0] && m.z <= L.zM[1])) errors.push(`${path}.z must be a number between ${L.zM[0]} and ${L.zM[1]} m`);
  if (!(isNum(m.rxDbm) && m.rxDbm >= L.dbm[0] && m.rxDbm <= L.dbm[1])) errors.push(`${path}.rxDbm must be a number between ${L.dbm[0]} and ${L.dbm[1]} dBm`);
  if (m.note !== undefined && !(typeof m.note === 'string' && m.note.length <= L.noteChars)) errors.push(`${path}.note must be text of at most ${L.noteChars} characters`);
  if (m.t !== undefined && !isNum(m.t)) errors.push(`${path}.t must be a number`);
}

/** Limits of the two calibration fields on the environment (both optional). */
export const CALIBRATION_FIELDS = Object.freeze({
  'environment.bodyLossDb': Object.freeze({ min: 0, max: 30 }),
  'environment.xpdDb': Object.freeze({ min: 5, max: 30 }),
  'environment.wallLossAdjustDb': Object.freeze({ min: -10, max: 30 }),
});

/** Optional environment.wallLossAdjustByMaterialDb = { material: dB } (a walk-test fit per wall material; replaces the single wallLossAdjustDb for that material). Same dB range as the single figure. */
export const WALL_ADJUST_BY_MATERIAL = Object.freeze({ min: -10, max: 30, maxMaterials: 32 });
