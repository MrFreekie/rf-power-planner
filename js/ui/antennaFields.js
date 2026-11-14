// Labels and small pure helpers for the antenna orientation fields (tilt, roll, polarisation, ground plane).
export const POLARISATION_LABELS = Object.freeze({
  vertical: 'Vertical', horizontal: 'Horizontal', slant45: 'Slant 45°', rhcp: 'Circular, right hand (RHCP)', lhcp: 'Circular, left hand (LHCP)',
});

export const POLARISATION_HINT = 'Linear to circular costs about 3 dB. A circular reflection reverses its sense, so a reflected wave can arrive cross-polarised.';

export const ORIENTATION_HINT = 'Horizontal and slant polarisation lie along the antenna\'s right axis, so set the azimuth across the path (not along it) for a horizontal element. Tilt pitches the nose up; roll turns the antenna about its aim.';

/** Tilt (deg) from a pointer position relative to the antenna: dy up is positive. Result clamped to -90..90 and rounded to 1 deg. Pure. */
export function tiltFromPointer(dxPx, dyUpPx) {
  if (!Number.isFinite(dxPx) || !Number.isFinite(dyUpPx) || (dxPx === 0 && dyUpPx === 0)) return null;
  const deg = Math.atan2(dyUpPx, Math.abs(dxPx)) * 180 / Math.PI;
  return Math.max(-90, Math.min(90, Math.round(deg)));
}
