// Shared, unsaved display state for the coverage overlay (not part of the scene, not in undo history).
const subs = new Set();
export const covView = {
  show: true,   // draw the heat map in the plan view
  tint: false,  // colour cells by the dominant antenna instead of by margin
  zones: true,  // draw zone polygons
};
export function setCovView(patch) {
  Object.assign(covView, patch);
  for (const cb of [...subs]) cb(covView);
}
export function subscribeCovView(cb) { subs.add(cb); return () => subs.delete(cb); }

/** Classify a level against a requirement. 'good' >= thr + margin, 'near' >= thr, else 'dead'. Pure. */
export function classify(levelDbm, thresholdDbm, marginDb) {
  if (!Number.isFinite(levelDbm)) return 'none';
  if (levelDbm >= thresholdDbm + marginDb) return 'good';
  if (levelDbm >= thresholdDbm) return 'near';
  return 'dead';
}

/** Parse '#rrggbb' or 'rgb(r, g, b)' into [r, g, b]. Pure. */
export function parseColor(c, fallback = [128, 128, 128]) {
  if (typeof c !== 'string') return fallback;
  const m = c.trim();
  if (m[0] === '#' && (m.length === 7 || m.length === 4)) {
    const h = m.length === 4 ? m.slice(1).split('').map((x) => x + x).join('') : m.slice(1);
    const n = parseInt(h, 16);
    return Number.isNaN(n) ? fallback : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const r = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(m);
  return r ? [+r[1], +r[2], +r[3]] : fallback;
}
