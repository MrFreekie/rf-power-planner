// Plan drawing for overhead panels (dashed outlines with a cross), plus the ceiling note.
// Both are axis-aligned rectangles with (x, y) = min corner, like platforms. Handles use kind 'areaBody' / 'areaCorner' with
// area = 'panel'. Colour is never the only cue: panel = dashes and a cross, with a text label.
import { haloText, setFont } from './util.js';

function rectPath(ctx, pc) { ctx.beginPath(); pc.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); }
const corners = (r) => [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.depth }, { x: r.x, y: r.y + r.depth }];


export function drawAreas(ctx, th, vp, scene, sel, handles, fmtLen) {
  for (const o of scene.overheadPanels || []) {
    const wc = corners(o), pc = wc.map((c) => vp.worldToScreen(c.x, c.y)), selected = sel === o.id;
    const xs = pc.map((q) => q.x), ys = pc.map((q) => q.y), bx = Math.min(...xs), by = Math.min(...ys), bw = Math.max(...xs) - bx, bh = Math.max(...ys) - by;
    ctx.save();
    rectPath(ctx, pc); ctx.setLineDash([8, 4]); ctx.strokeStyle = th.ink; ctx.lineWidth = selected ? 2.6 : 1.5; ctx.stroke();
    ctx.setLineDash([]); ctx.lineWidth = 1; ctx.strokeStyle = th.inkSoft;
    ctx.beginPath(); ctx.moveTo(pc[0].x, pc[0].y); ctx.lineTo(pc[2].x, pc[2].y); ctx.moveTo(pc[1].x, pc[1].y); ctx.lineTo(pc[3].x, pc[3].y); ctx.stroke();
    ctx.restore();
    const cen = { x: bx + bw / 2, y: by + bh / 2 };
    const label = `${o.name || 'Panel'}: ${fmtLen(o.heightM)} up`;
    setFont(ctx, th, 11, '600');
    if (bw > ctx.measureText(label).width + 8 || selected) haloText(ctx, th, label, cen.x, cen.y - 4, { align: 'center', px: 11, weight: '600' });
    handles.push({ kind: 'areaBody', area: 'panel', itemId: o.id, poly: pc, sx: cen.x, sy: cen.y, r: 0, wx: o.x, wy: o.y });
    pc.forEach((s2, i) => {
      ctx.fillStyle = selected ? th.ink : th.paper; ctx.strokeStyle = th.ink; ctx.lineWidth = 1.2;
      ctx.fillRect(s2.x - 3.5, s2.y - 3.5, 7, 7); ctx.strokeRect(s2.x - 3.5, s2.y - 3.5, 7, 7);
      handles.push({ kind: 'areaCorner', area: 'panel', corner: i, itemId: o.id, sx: s2.x, sy: s2.y, r: 10, pri: 1, wx: wc[i].x, wy: wc[i].y });
    });
  }
}
