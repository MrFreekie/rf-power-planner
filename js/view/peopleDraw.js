// People groups: a dashed outline around a person's floor point and their packs (plan), a bracket and name label (side view).
// The outline is a shape plus a text label, so identity never depends on colour. The grip at the top of the outline drags the whole group.
import { groupPoints, groupCircle, personOfLink } from '../ui/peopleUi.js';
import { haloText, setFont } from './util.js';
import { placeLabel } from '../ui/antennaFields.js';

const TAG = { red: '#c0392b', orange: '#d9741a', amber: '#c99a00', green: '#2e8b57', teal: '#1f8a8a', cyan: '#2a9dc4', blue: '#2f5fb3', indigo: '#4b4bb0', violet: '#7b4bb0', pink: '#c2517d', brown: '#7a5230', grey: '#777777' };
export const personTag = (c) => TAG[c] || TAG.grey;
const ROLE_MARK = { singer: 'S', instrumentalist: 'I', presenter: 'P', crew: 'C', other: 'O' };
export const roleMark = (r) => ROLE_MARK[r] || 'O';

/** Draw every placed person on the plan. Pushes a { kind: 'person' } handle per person. Returns the label rectangles drawn. */
export function drawPeoplePlan(ctx, th, vp, scene, sel, handles, hoverKey, w, placed = []) {
  const rects = [];
  for (const person of scene.people || []) {
    const pts = groupPoints(scene, person);
    if (!pts) continue;
    const c = groupCircle(pts, 0.45), cs = vp.worldToScreen(c.x, c.y), rpx = Math.max(18, c.r * vp.pxPerM);
    const selected = sel === person.id, hot = hoverKey === 'person:' + person.id;
    ctx.save();
    ctx.strokeStyle = selected ? th.ink : th.inkSoft; ctx.lineWidth = selected ? 1.8 : 1.2; ctx.setLineDash(selected ? [2, 3] : [6, 4]);
    ctx.beginPath(); ctx.arc(cs.x, cs.y, rpx, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    // person floor point with a leader to each pack
    const pp = vp.worldToScreen(person.pos.x, person.pos.y);
    ctx.lineWidth = 1; ctx.strokeStyle = th.inkSoft;
    for (const q of pts) { if (q.what === 'person') continue; const s = vp.worldToScreen(q.x, q.y); ctx.beginPath(); ctx.moveTo(pp.x, pp.y); ctx.lineTo(s.x, s.y); ctx.stroke(); }
    ctx.fillStyle = th.paper; ctx.strokeStyle = th.ink; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(pp.x, pp.y - 4); ctx.lineTo(pp.x + 4, pp.y); ctx.lineTo(pp.x, pp.y + 4); ctx.lineTo(pp.x - 4, pp.y); ctx.closePath(); ctx.fill(); ctx.stroke();
    // grip: square at the top of the outline
    const gx = cs.x, gy = cs.y - rpx;
    ctx.fillStyle = hot || selected ? th.ink : th.paper; ctx.lineWidth = 1.6; ctx.strokeStyle = th.ink;
    ctx.beginPath(); ctx.rect(gx - 5, gy - 5, 10, 10); ctx.fill(); ctx.stroke();
    ctx.restore();
    // label: tag dot, role letter and name, to the right of the grip
    const text = `${roleMark(person.role)} ${person.name}`;
    if (w >= 420 || selected) {
      setFont(ctx, th, 12, selected ? '600' : '');
      const tw = Math.ceil(ctx.measureText(text).width);
      const box = placeLabel({ x: gx, y: gy }, { w: tw + 24, h: 18 }, placed, { w: w || 10000, h: 10000 });
      ctx.fillStyle = personTag(person.colour); ctx.strokeStyle = th.ink; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(box.x + 7, box.y + 9, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      haloText(ctx, th, text, box.x + 15, box.y + 13, { color: selected ? th.ink : th.inkSoft, weight: selected ? '600' : '' });
      rects.push(box); placed.push(box);
    }
    handles.push({ kind: 'person', itemId: person.id, sx: gx, sy: gy, r: 16, wx: person.pos.x, wy: person.pos.y, pri: 1 });
  }
  return rects;
}

/** Side view: a bracket and name label above the head of the person who carries the pack drawn at (sx, headY). */
export function drawPersonSide(ctx, th, scene, link, role, sx, floorY, headY, leftEnd = true, owners = null) {
  const o = personOfLink(scene, link.id, owners);
  if (!o) return null;
  const hasPerson = (role === 'tx') === (link.kind !== 'iem');
  if (!hasPerson) return null;
  ctx.save();
  ctx.strokeStyle = th.inkSoft; ctx.lineWidth = 1; ctx.setLineDash([5, 3]);
  const top = Math.min(floorY, headY) - 18, hw = 14;
  ctx.beginPath(); ctx.moveTo(sx - hw, floorY); ctx.lineTo(sx - hw, top); ctx.lineTo(sx + hw, top); ctx.lineTo(sx + hw, floorY); ctx.stroke();
  ctx.restore();
  const text = `${roleMark(o.person.role)} ${o.person.name} (${o.which === 'iem' ? (o.extra ? `IEM ${o.extraIndex + 2}` : 'IEM') : o.extra ? `mic ${o.extraIndex + 2}` : 'mic'})`;
  haloText(ctx, th, text, sx + (leftEnd ? hw + 5 : -hw - 5), floorY - 6, { align: leftEnd ? 'left' : 'right', color: th.inkSoft });
  return { x: sx, y: floorY - 20, w: 120, h: 18 };
}
