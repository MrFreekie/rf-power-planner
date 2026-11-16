// Plan drawing for crowd zones: translucent polygon tinted by mode (denser tint and dots for packed), a label with the mode and loss cap,
// corner handles. Colour is never the only cue: the label always names the mode, and dot spacing also changes with the mode.
// Handles: 'crowdBody' (polygon, drags the whole zone) and 'crowdVertex' (one corner).
import { haloText, setFont } from './util.js';
import { crowdLabel, crowdShortLabel } from '../ui/crowdUi.js';

export const CROWD_STYLE = Object.freeze({ seated: { alpha: 0.07, dot: 18 }, standing: { alpha: 0.12, dot: 12 }, packed: { alpha: 0.2, dot: 8 } });
/** rgba() of the theme blue token (hex) at alpha a; falls back to the ink colour. Pure. */
export function crowdTint(th, a) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(th.blue || '');
  const rgb = m ? [1, 2, 3].map((i) => parseInt(m[i], 16)).join(',') : (th.inkRgb || '29,39,51');
  return `rgba(${rgb},${a})`;
}
const tint = crowdTint;

function path(ctx, pts) { ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); }

export function drawCrowds(ctx, th, vp, scene, sel, handles, w) {
  for (const c of scene.crowds || []) {
    if (!Array.isArray(c.polygon) || c.polygon.length < 3) continue;
    const mode = CROWD_STYLE[c.mode] ? c.mode : 'standing', st = CROWD_STYLE[mode], selected = sel === c.id;
    const pc = c.polygon.map((p) => vp.worldToScreen(p.x, p.y));
    const xs = pc.map((q) => q.x), ys = pc.map((q) => q.y), bx = Math.min(...xs), by = Math.min(...ys), bw = Math.max(...xs) - bx, bh = Math.max(...ys) - by;
    ctx.save();
    path(ctx, pc); ctx.fillStyle = tint(th, st.alpha); ctx.fill();
    ctx.save(); path(ctx, pc); ctx.clip();
    ctx.fillStyle = th.inkSoft;
    for (let y = by + st.dot / 2; y < by + bh; y += st.dot) for (let x = bx + st.dot / 2; x < bx + bw; x += st.dot) ctx.fillRect(Math.round(x), Math.round(y), 1.8, 1.8);
    ctx.restore();
    path(ctx, pc); ctx.setLineDash(mode === 'seated' ? [6, 3] : mode === 'standing' ? [2, 3] : []); ctx.strokeStyle = th.ink; ctx.lineWidth = selected ? 2.4 : 1.2; ctx.stroke();
    ctx.restore();
    const cen = { x: bx + bw / 2, y: by + bh / 2 };
    const full = crowdLabel(c);
    setFont(ctx, th, 12, '600');
    const text = bw > ctx.measureText(full).width + 8 || selected ? full : bw > 70 ? crowdShortLabel(c) : '';
    if (text) haloText(ctx, th, text, cen.x, cen.y + 4, { align: 'center', px: 12, weight: '600' });
    handles.push({ kind: 'crowdBody', itemId: c.id, poly: pc, sx: cen.x, sy: cen.y, r: 0, wx: c.polygon[0].x, wy: c.polygon[0].y });
    if (selected) pc.forEach((s2, i) => {
      ctx.fillStyle = th.ink; ctx.strokeStyle = th.ink; ctx.lineWidth = 1.2;
      ctx.fillRect(s2.x - 4, s2.y - 4, 8, 8);
      handles.push({ kind: 'crowdVertex', corner: i, itemId: c.id, sx: s2.x, sy: s2.y, r: 11, pri: 1, wx: c.polygon[i].x, wy: c.polygon[i].y });
    });
  }
}
