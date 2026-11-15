// Labels and small pure helpers for the antenna orientation fields (tilt, roll, polarisation, ground plane).
export const POLARISATION_LABELS = Object.freeze({
  vertical: 'Vertical', horizontal: 'Horizontal', slant45: 'Slant 45°', rhcp: 'Circular, right hand (RHCP)', lhcp: 'Circular, left hand (LHCP)',
});

export const POLARISATION_HINT = 'Linear to circular costs about 3 dB. A circular reflection reverses its sense, so a reflected wave can arrive cross-polarised.';

export const ORIENTATION_HINT = 'Horizontal and slant polarisation lie along the antenna\'s right axis, so set the azimuth across the path (not along it) for a horizontal element. Tilt pitches the nose up; roll turns the antenna about its aim.';

/** Tilt (deg) from a pointer position relative to the antenna: dy up is positive. Result clamped to -90..90 and rounded to 1 deg. Pure. */
export function tiltFromPointer(dxPx, dyUpPx, { step = 1 } = {}) {
  if (!Number.isFinite(dxPx) || !Number.isFinite(dyUpPx) || (dxPx === 0 && dyUpPx === 0)) return null;
  const deg = Math.atan2(dyUpPx, Math.abs(dxPx)) * 180 / Math.PI;
  return snapTilt(deg, step);
}

export const TILT_COARSE_STEP = 5, TILT_FINE_STEP = 1, TILT_LIMIT = 90, TILT_TICK_STEP = 15;

/** Round to a multiple of `step` degrees and clamp to the tilt limits. Pure. */
export function snapTilt(deg, step = 1) {
  if (!Number.isFinite(deg)) return 0;
  const s = step > 0 ? step : 1;
  const v = Math.round(deg / s) * s;
  return Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, v === 0 ? 0 : v));
}

/** Keyboard step: dir +1 / -1; coarse moves to the next multiple of 5 deg, fine (Shift) moves 1 deg. Clamped. Pure. */
export function stepTilt(current, dir, fine = false) {
  const cur = Number.isFinite(current) ? current : 0, d = dir < 0 ? -1 : 1;
  if (fine) return snapTilt(cur + d, 1);
  const q = cur / TILT_COARSE_STEP;
  const n = d > 0 ? Math.floor(q + 1e-9) + 1 : Math.ceil(q - 1e-9) - 1;
  return snapTilt(n * TILT_COARSE_STEP, TILT_COARSE_STEP);
}

/** Gauge tick list from -90 to +90 in 15 deg steps: { deg, major } (major at 0 and multiples of 45). Pure. */
export function tiltGaugeTicks() {
  const out = [];
  for (let d = -90; d <= 90; d += TILT_TICK_STEP) out.push({ deg: d, major: d % 45 === 0 });
  return out;
}

/** Handle length in px: scales with zoom, kept inside 56..130 px. Pure. */
export function tiltHandleLength(pxPerM) {
  const v = Number.isFinite(pxPerM) ? pxPerM * 0.8 : 70;
  return Math.max(56, Math.min(130, v));
}

export const tiltText = (deg) => `${deg > 0 ? '+' : deg < 0 ? '−' : ''}${Math.abs(Math.round(deg))}°`;

/**
 * Choose a label rectangle near `anchor` that overlaps none of the `avoid` rects ({x,y,w,h}) and stays inside `bounds` ({w,h}).
 * Tries above, below, right, left, then wider offsets. Returns { x, y, w, h, clear } (x,y = top left); falls back to the least-overlapping spot. Pure.
 */
export function placeLabel(anchor, size, avoid = [], bounds = null) {
  const { w, h } = size, gap = 10;
  const cands = [
    [-w / 2, -gap - h], [-w / 2, gap], [gap, -h / 2], [-gap - w, -h / 2],
    [gap, -gap - h], [-gap - w, -gap - h], [gap, gap], [-gap - w, gap],
    [-w / 2, -gap * 2.6 - h], [-w / 2, gap * 2.6],
  ];
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  let best = null, bestScore = Infinity;
  for (const [dx, dy] of cands) {
    let r = { x: anchor.x + dx, y: anchor.y + dy, w, h };
    if (bounds) r = { ...r, x: Math.max(2, Math.min(bounds.w - w - 2, r.x)), y: Math.max(2, Math.min(bounds.h - h - 2, r.y)) };
    const score = avoid.reduce((n, a) => n + (hit(r, a) ? 1 : 0), 0);
    if (score === 0) return { ...r, clear: true };
    if (score < bestScore) { best = r; bestScore = score; }
  }
  return { ...best, clear: false };
}
