// Stage-relative display coordinates. PURE (no DOM). The scene model is unchanged: internally x = 0 is the stage's
// front-left corner and y grows toward the audience (so the plan draws y downward). People read and type stage
// coordinates instead:
//   x_disp = x - stage.width / 2     0 = centre line; the direction on the plan is unchanged (positive = right on screen)
//   y_disp = stage.depth - y         0 = front (downstage, audience-side) edge; positive = upstage (up the plan screen),
//                                    negative = in front of the stage (audience side)
// Only the UI boundary converts (inspector fields, axis labels, readouts, announcements, report text).
// Antenna azimuth is NOT converted: 0 degrees still points toward the audience, clockwise seen from above.
const clean = (v) => { const r = Math.round(v * 1e6) / 1e6; return r === 0 ? 0 : r; }; // no -0, no 0.30000000000000004

const dims = (scene) => {
  const st = (scene && scene.stage) || {};
  return { w: Number.isFinite(st.width) ? st.width : 0, d: Number.isFinite(st.depth) ? st.depth : 0 };
};

export const dispX = (scene, x) => clean(x - dims(scene).w / 2);
export const dispY = (scene, y) => clean(dims(scene).d - y);
export const internalX = (scene, xd) => clean(xd + dims(scene).w / 2);
export const internalY = (scene, yd) => clean(dims(scene).d - yd);

/** {x, y, ...} internal -> {x, y, ...} display (other fields such as z are passed through). */
export function toDisplay(scene, p) { return { ...p, x: dispX(scene, p.x), y: dispY(scene, p.y) }; }
/** Inverse of toDisplay. */
export function fromDisplay(scene, p) { return { ...p, x: internalX(scene, p.x), y: internalY(scene, p.y) }; }

/** Display-axis conversion by name, for generic field code. axis: 'x' | 'y'. */
export const dispAxis = (scene, axis, v) => (axis === 'x' ? dispX(scene, v) : axis === 'y' ? dispY(scene, v) : v);
export const internalAxis = (scene, axis, v) => (axis === 'x' ? internalX(scene, v) : axis === 'y' ? internalY(scene, v) : v);
/** A [min, max] range of internal metres -> the matching display range (y flips, so min and max swap). */
export function dispRange(scene, axis, min, max) {
  if (axis === 'x') return [dispX(scene, min), dispX(scene, max)];
  if (axis === 'y') return [dispY(scene, max), dispY(scene, min)];
  return [min, max];
}

/** 'x 1.20 m, y 3.00 m' for an internal position, in stage coordinates. lengthText(m) formats a length (default metres). */
export function describePos(scene, p, lengthText = (m) => `${m.toFixed(2)} m`) {
  const d = toDisplay(scene, p);
  return `x ${lengthText(d.x)}, y ${lengthText(d.y)}`;
}

export const COORD_HINT = 'x: 0 = stage centre line, positive to the right on the plan. y: 0 = front (downstage) edge, positive upstage (away from the audience), negative in front of the stage. Azimuth is unchanged: 0 degrees points toward the audience.';
