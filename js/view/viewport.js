// Viewport: world (metres) <-> screen (CSS px) mapping with zoom and pan.
// World x grows right, world y grows DOWN on screen (plan: y = toward audience).
// The side view uses the same class with world = (s, -z) so that z is up on screen.

export const MIN_PX_PER_M = 4;
export const MAX_PX_PER_M = 600;

/** Nice grid step in metres (1, 2, 5 x 10^n) whose on-screen size is at least targetPx. */
export function niceGridStep(pxPerM, targetPx = 50) {
  const raw = targetPx / Math.max(pxPerM, 1e-9);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw - 1e-12) return m * pow;
  return 10 * pow;
}

export function createViewport({ pxPerM = 40, origin = { x: 0, y: 0 } } = {}) {
  const vp = {
    pxPerM,
    origin: { x: origin.x, y: origin.y }, // screen position of world (0,0)

    /** worldToScreen(x, y) or worldToScreen({x, y}) -> {x, y} */
    worldToScreen(x, y) {
      if (typeof x === 'object') ({ x, y } = x);
      return { x: vp.origin.x + x * vp.pxPerM, y: vp.origin.y + y * vp.pxPerM };
    },
    screenToWorld(sx, sy) {
      if (typeof sx === 'object') ({ x: sx, y: sy } = sx);
      return { x: (sx - vp.origin.x) / vp.pxPerM, y: (sy - vp.origin.y) / vp.pxPerM };
    },
    /** Zoom by `factor` keeping the world point under screen (sx, sy) fixed. */
    zoomAt(sx, sy, factor) {
      const next = Math.min(MAX_PX_PER_M, Math.max(MIN_PX_PER_M, vp.pxPerM * factor));
      const k = next / vp.pxPerM;
      vp.origin.x = sx - (sx - vp.origin.x) * k;
      vp.origin.y = sy - (sy - vp.origin.y) * k;
      vp.pxPerM = next;
    },
    panBy(dx, dy) { vp.origin.x += dx; vp.origin.y += dy; },
    /** Fit the world rectangle into a w x h screen box (uniform scale, centred). */
    fitRect(x0, y0, x1, y1, w, h, marginPx = 0) {
      const sx = (w - 2 * marginPx) / Math.max(x1 - x0, 1e-6);
      const sy = (h - 2 * marginPx) / Math.max(y1 - y0, 1e-6);
      vp.pxPerM = Math.min(MAX_PX_PER_M, Math.max(MIN_PX_PER_M, Math.min(sx, sy)));
      vp.origin.x = w / 2 - ((x0 + x1) / 2) * vp.pxPerM;
      vp.origin.y = h / 2 - ((y0 + y1) / 2) * vp.pxPerM;
    },
    visibleBounds(w, h) {
      const a = vp.screenToWorld(0, 0), b = vp.screenToWorld(w, h);
      return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
    },
    metresToPx: (m) => m * vp.pxPerM,
    niceGridStep: (targetPx = 50) => niceGridStep(vp.pxPerM, targetPx),
  };
  return vp;
}
