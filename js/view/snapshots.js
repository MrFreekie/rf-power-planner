// Offscreen snapshots for the report: each view registers a function that renders it to a new canvas of a fixed size,
// synchronously and independent of the live pane size or visibility (no animation frame needed).
const reg = new Map();

export function registerSnapshot(kind, fn) {
  reg.set(kind, fn);
  return () => { if (reg.get(kind) === fn) reg.delete(kind); };
}
export const getSnapshot = (kind) => reg.get(kind) || null;

/** A canvas of w x h CSS px at `scale` device pixels per CSS px, with its context already scaled. */
export function makeSnapshotCanvas(w, h, scale = 2) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return { c, ctx };
}

/** Count of dark (ink) opaque pixels, sampled; 0 means the canvas is blank or paper only. */
export function darkPixelCount(canvas, step = 7) {
  try {
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * step) if (d[i + 3] > 200 && d[i] < 140 && d[i + 1] < 140 && d[i + 2] < 160) n++;
    return n;
  } catch { return 0; }
}
