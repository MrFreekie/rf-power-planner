// Pure extent of everything drawn in the plan view (never the venue underlay).
// planExtent(scene, opts) -> { x0, y0, x1, y1 } in metres, the union of the stage rectangle (with its usual
// margins) and every placed item: reflector ends, zone corners, platforms (rotated corners), Tx/Rx positions,
// diversity antenna B, extra branch antennas and intermodulation transmitters.

export const STAGE_MARGIN = { left: 1.0, top: 1.2, right: 1.0, bottom: 1.8 };
export const ITEM_MARGIN_M = 1.0;
/** Generous bound for dragging items: they may sit this far beyond the stage edges. */
export const FAR_LIMIT_M = 200;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const okPt = (p) => p && num(p.x) && num(p.y);

export function planPoints(scene) {
  const pts = [];
  const add = (p) => { if (okPt(p)) pts.push({ x: p.x, y: p.y }); };
  for (const l of (scene && scene.links) || []) {
    if (!l) continue;
    add(l.tx && l.tx.pos); add(l.rx && l.rx.pos);
    add(l.rx && l.rx.diversity && l.rx.diversity.antennaB && l.rx.diversity.antennaB.pos);
    for (const b of l.branches || []) add(b && b.pos);
  }
  for (const r of (scene && scene.reflectors) || []) if (r) { add(r.p1); add(r.p2); }
  for (const z of (scene && scene.zones) || []) for (const p of (z && z.polygon) || []) add(p);
  for (const p of (scene && scene.platforms) || []) {
    if (!p || !num(p.x) || !num(p.y) || !num(p.width) || !num(p.depth)) continue;
    const a = ((num(p.rotationDeg) ? p.rotationDeg : 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const cx = p.x + p.width / 2, cy = p.y + p.depth / 2;
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const ux = (dx * p.width) / 2, uy = (dy * p.depth) / 2;
      pts.push({ x: cx + ux * c - uy * s, y: cy + ux * s + uy * c });
    }
  }
  const imd = scene && scene.imd;
  if (imd && imd.enabled !== false) for (const t of imd.transmitters || []) add(t && t.pos);
  return pts;
}

export function planExtent(scene, opts = {}) {
  const m = opts.margin == null ? ITEM_MARGIN_M : opts.margin;
  const st = (scene && scene.stage) || { width: 12, depth: 8 };
  let x0 = -STAGE_MARGIN.left, y0 = -STAGE_MARGIN.top, x1 = st.width + STAGE_MARGIN.right, y1 = st.depth + STAGE_MARGIN.bottom;
  for (const p of planPoints(scene)) {
    if (Math.abs(p.x) > 1e5 || Math.abs(p.y) > 1e5) continue;
    x0 = Math.min(x0, p.x - m); x1 = Math.max(x1, p.x + m);
    y0 = Math.min(y0, p.y - m); y1 = Math.max(y1, p.y + m);
  }
  return { x0, y0, x1, y1 };
}

/** Clamp for dragged free items: stage bounds plus FAR_LIMIT_M on every side. */
export function farBounds(st) { return { x0: -FAR_LIMIT_M, x1: st.width + FAR_LIMIT_M, y0: -FAR_LIMIT_M, y1: st.depth + FAR_LIMIT_M }; }
