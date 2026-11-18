// Side-view tilt gauge: arc with 15 degree ticks, half-power beam wedge, polarisation element line. Pure geometry plus one canvas drawer.
import { antennaFrame, antennaGainDb } from '../model/rf.js';
import { DEG } from './util.js';
import { tiltGaugeTicks, tiltText, snapTilt, withPitch, pitchWord, isRingAntenna } from '../ui/antennaFields.js';

/** Bearing {az, el} (deg) of the in-slice direction at angle `theta` (deg from straight up, positive toward +s); u = slice axis in plan (x, y). */
function sliceBearing(theta, u) {
  const sv = Math.sin(theta * DEG), zv = Math.cos(theta * DEG);
  const x = sv * u.x, y = sv * u.y;
  return { az: Math.atan2(x, y) / DEG, el: Math.asin(Math.max(-1, Math.min(1, zv))) / DEG };
}

/**
 * Half-power wedge of the antenna pattern in the slice: { centre, lo, hi } as angles in degrees from straight up (+s positive), or null
 * when the pattern is wider than 180 deg (omni in this plane) or the boresight is not in the slice. Pure given the model.
 */
const wedgeCache = new Map();
export function halfPowerWedge(antenna, u) {
  // 180 pattern evaluations per call: cache by the antenna (pattern + orientation + tilt) and the slice axis, so a redraw while only the pan changes is free
  const key = `${JSON.stringify(antenna)}|${u.x.toFixed(4)}|${u.y.toFixed(4)}`;
  if (wedgeCache.has(key)) return wedgeCache.get(key);
  const w = computeWedge(antenna, u);
  if (wedgeCache.size >= 64) wedgeCache.clear();
  wedgeCache.set(key, w);
  return w;
}
function computeWedge(antenna, u) {
  const { b } = antennaFrame(antenna);
  const bs = b[0] * u.x + b[1] * u.y, bz = b[2];
  if (Math.hypot(bs, bz) < 0.2) return null; // boresight points across the slice
  const centre = Math.atan2(bs, bz) / DEG;
  const peak = antennaGainDb(antenna, sliceBearing(centre, u));
  const edge = (dir) => {
    for (let a = 1; a <= 90; a++) if (antennaGainDb(antenna, sliceBearing(centre + dir * a, u)) < peak - 3) return a;
    return null;
  };
  const lo = edge(-1), hi = edge(1);
  if (lo === null && hi === null) return null;
  return { centre, lo: lo ?? 90, hi: hi ?? 90 };
}

/**
 * Tilt (deg, snapped to `step`) whose DRAWN boresight tip (the in-slice projection of the tilted boresight, see drawTiltGauge) points at the
 * pointer. dxPx / dyUpPx = pointer minus antenna, y up. The tilt turns the nose in the vertical plane that contains the boresight, so when the
 * antenna is aimed out of the slice the drawn tip angle is NOT the tilt (a vertical whip tilts sideways to the slice): the angle is solved
 * numerically instead of assumed. When the tip can only ever be on one side of the antenna the pointer is mirrored onto that side. null at the centre.
 */
export function tiltForPointer(antenna, u, dxPx, dyUpPx, step = 1) {
  if (!Number.isFinite(dxPx) || !Number.isFinite(dyUpPx) || (dxPx === 0 && dyUpPx === 0)) return null;
  const cand = [];
  for (let t = -90; t <= 90; t += 0.5) {
    const { b } = antennaFrame(withPitch(antenna, t));
    const bs = b[0] * u.x + b[1] * u.y, bz = b[2];
    if (Math.hypot(bs, bz) >= 0.05) cand.push({ t, th: Math.atan2(bs, bz), bs });
  }
  if (!cand.length) return null;
  let phi = Math.atan2(dxPx, dyUpPx); // from straight up, + toward +s
  const eps = 1e-6;
  if (cand.every((c) => c.bs >= -eps)) phi = Math.abs(phi); else if (cand.every((c) => c.bs <= eps)) phi = -Math.abs(phi);
  let best = null, bd = Infinity;
  for (const c of cand) {
    let d = Math.abs(c.th - phi); if (d > Math.PI) d = 2 * Math.PI - d;
    if (d < bd - 1e-9) { bd = d; best = c; }
  }
  return snapTilt(best.t, step);
}

/** In-slice screen direction {dx, dy} (pixels per unit, y down) of a world direction vector, or null when it points across the slice. */
export function sliceDir(vec, u) {
  const s = vec[0] * u.x + vec[1] * u.y, z = vec[2], m = Math.hypot(s, z);
  return m < 0.15 ? null : { dx: s / m, dy: -z / m, m };
}

/** Axis of the radiating element (E field) in world axes, or null for circular polarisation. */
export function elementAxis(antenna) {
  const { r, u } = antennaFrame(antenna);
  const pol = antenna.polarisation || 'vertical';
  if (pol === 'horizontal') return r;
  if (pol === 'slant45') return [(u[0] + r[0]) * Math.SQRT1_2, (u[1] + r[1]) * Math.SQRT1_2, (u[2] + r[2]) * Math.SQRT1_2];
  if (pol === 'rhcp' || pol === 'lhcp') return null;
  return u;
}

/**
 * Draw the tilt gauge for one antenna at screen point p. opts: { len, selected, active (dragging), tilt, el, flipS, u, antenna, hot }.
 * Returns { tip: {x,y}, wedge, text }: the handle position, the half-power wedge (or null) and the tilt label.
 */
export function drawTiltGauge(ctx, th, p, o) {
  const { len, selected, tilt, el = 0, u, antenna, hot, active } = o;
  const { b } = antennaFrame(antenna);
  const bs = b[0] * u.x + b[1] * u.y, bz = b[2], m = Math.hypot(bs, bz) || 1;
  const side = bs < 0 || (bs === 0 && o.flipS) ? -1 : 1; // which side of the antenna the boresight faces
  const pt = (rad, pitchDeg) => ({ x: p.x + side * Math.cos(pitchDeg * DEG) * rad, y: p.y - Math.sin(pitchDeg * DEG) * rad });
  const tip = { x: p.x + (bs / m) * len, y: p.y - (bz / m) * len };
  ctx.save();
  ctx.lineCap = 'round';
  // beam wedge from the antenna pattern
  const wedge = halfPowerWedge(antenna, u);
  if (wedge) {
    const a0 = wedge.centre - wedge.lo, a1 = wedge.centre + wedge.hi, R = len * 1.05;
    const sa = (a) => ({ x: p.x + Math.sin(a * DEG) * R, y: p.y - Math.cos(a * DEG) * R });
    ctx.beginPath(); ctx.moveTo(p.x, p.y); const e0 = sa(a0); ctx.lineTo(e0.x, e0.y);
    // arc from a0 to a1 (angles from up, clockwise on screen)
    ctx.arc(p.x, p.y, R, (a0 - 90) * DEG, (a1 - 90) * DEG); ctx.closePath();
    ctx.globalAlpha = selected ? 0.13 : 0.08; ctx.fillStyle = th.ink; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = th.inkSoft; ctx.lineWidth = 1; ctx.setLineDash([5, 3]); ctx.stroke(); ctx.setLineDash([]);
  }
  // polarisation element line through the antenna
  const ax = elementAxis(antenna), ed = ax && sliceDir(ax, u);
  if (ed) {
    const h = 20 * Math.min(1, ed.m + 0.25);
    ctx.strokeStyle = th.ink; ctx.lineWidth = 2.4; ctx.setLineDash([1, 4]);
    ctx.beginPath(); ctx.moveTo(p.x - ed.dx * h, p.y - ed.dy * h); ctx.lineTo(p.x + ed.dx * h, p.y + ed.dy * h); ctx.stroke(); ctx.setLineDash([]);
  }
  if (selected) {
    // arc gauge: pitch scale on the boresight side, ticks every 15 deg
    const R = len * 0.72;
    ctx.strokeStyle = th.inkSoft; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, R, side > 0 ? -Math.PI / 2 : Math.PI / 2, side > 0 ? Math.PI / 2 : (3 * Math.PI) / 2); ctx.stroke();
    ctx.lineWidth = 1;
    for (const t of tiltGaugeTicks()) {
      const a = pt(R, t.deg), c = pt(R + (t.major ? 9 : 5), t.deg);
      ctx.lineWidth = t.deg === 0 ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
    }
    // zero-tilt (level) reference
    const lvl = isRingAntenna(antenna) ? el : 0, z0 = pt(R + 14, lvl), zr = pt(R - 4, lvl);
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1.4; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(zr.x, zr.y); ctx.lineTo(z0.x, z0.y); ctx.stroke(); ctx.setLineDash([]);
  }
  // boresight line
  ctx.strokeStyle = th.ink; ctx.lineWidth = selected ? 1.8 : 1.1; ctx.setLineDash(selected ? [] : [3, 3]);
  ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(tip.x, tip.y); ctx.stroke(); ctx.setLineDash([]);
  if (selected) {
    // grip: a diamond with an arrow head, filled when hot or dragging
    const ang = Math.atan2(tip.y - p.y, tip.x - p.x), r = active ? 9 : 7.5;
    ctx.fillStyle = hot || active ? th.ink : th.paper; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(tip.x, tip.y - r); ctx.lineTo(tip.x + r, tip.y); ctx.lineTo(tip.x, tip.y + r); ctx.lineTo(tip.x - r, tip.y); ctx.closePath(); ctx.fill(); ctx.stroke();
    // curved arrows either side of the grip show the pitch direction
    const na = ang - Math.PI / 2, ta = { x: Math.cos(na), y: Math.sin(na) };
    ctx.beginPath(); ctx.moveTo(tip.x + ta.x * 13, tip.y + ta.y * 13); ctx.lineTo(tip.x + ta.x * 19, tip.y + ta.y * 19);
    ctx.moveTo(tip.x - ta.x * 13, tip.y - ta.y * 13); ctx.lineTo(tip.x - ta.x * 19, tip.y - ta.y * 19); ctx.stroke();
  }
  ctx.restore();
  return { tip, wedge, text: `${pitchWord(antenna)} ${tiltText(tilt)}` };
}
