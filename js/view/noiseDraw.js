// Noise source icons on the plan. Shape tells the type (radio waves for a narrowband carrier, a zigzag for broadband hash, a pulse train for
// clicks), the label gives the name, and a muted source is dashed and says "off". Greyscale-safe: no colour carries meaning.
import { NOISE_CATALOGUE } from '../model/noise-sources.js';
import { haloText } from './util.js';

/** Icon family of a kind: 'radio' | 'hash' | 'pulse'. Pure. */
export function noiseGlyph(kind) {
  const d = NOISE_CATALOGUE[kind];
  if (!d) return 'hash';
  if (d.params.type === 'narrowband') return 'radio';
  return d.behaviour === 'impulsive' ? 'pulse' : 'hash';
}

function glyph(ctx, g, x, y, r) {
  ctx.beginPath();
  if (g === 'radio') {
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    for (const k of [1, 2]) { ctx.moveTo(x + 2 + k * 3.5, y); ctx.arc(x, y, 2 + k * 3.5, -0.9, 0.9); ctx.moveTo(x - 2 - k * 3.5, y); ctx.arc(x, y, 2 + k * 3.5, Math.PI - 0.9, Math.PI + 0.9); }
  } else if (g === 'pulse') {
    ctx.moveTo(x - r, y + 4); ctx.lineTo(x - r + 3, y + 4); ctx.lineTo(x - r + 3, y - 5); ctx.lineTo(x - r + 5, y - 5); ctx.lineTo(x - r + 5, y + 4);
    ctx.lineTo(x + 1, y + 4); ctx.lineTo(x + 1, y - 5); ctx.lineTo(x + 3, y - 5); ctx.lineTo(x + 3, y + 4); ctx.lineTo(x + r, y + 4);
  } else {
    ctx.moveTo(x - r, y + 3); ctx.lineTo(x - r / 2, y - 5); ctx.lineTo(x, y + 4); ctx.lineTo(x + r / 2, y - 5); ctx.lineTo(x + r, y + 3);
  }
  ctx.stroke();
}

/** Draw every free-standing noise source; pushes a { kind: 'noise' } handle for each. Sources linked to a wall are drawn by the wall itself. */
export function drawNoiseSources(ctx, th, vp, scene, sel, handles, hoverKey, w) {
  const rects = [];
  for (const s of scene.noiseSources || []) {
    if (s.reflectorId || !s.pos) continue;
    const p = vp.worldToScreen(s.pos.x, s.pos.y), selected = sel === s.id, off = s.enabled === false, hot = hoverKey === 'noise:' + s.id, r = 13;
    ctx.save();
    ctx.lineWidth = selected ? 2 : 1.4; ctx.strokeStyle = th.ink; ctx.fillStyle = th.paper;
    if (off) ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y); ctx.closePath(); // diamond frame
    ctx.fill(); if (hot) { ctx.fillStyle = th.paper2 || th.paper; ctx.fill(); } ctx.stroke();
    ctx.setLineDash([]); ctx.lineWidth = 1.3;
    glyph(ctx, noiseGlyph(s.kind), p.x, p.y, 7);
    if (selected) { ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
    if (w >= 520 || selected) { haloText(ctx, th, `${s.name}${off ? ' (off)' : ''}`, p.x, p.y + r + 14, { align: 'center', color: selected ? th.ink : th.inkSoft, weight: selected ? '600' : '' }); rects.push({ x: p.x - 50, y: p.y + r + 2, w: 100, h: 16 }); }
    handles.push({ kind: 'noise', itemId: s.id, sx: p.x, sy: p.y, r: 16, wx: s.pos.x, wy: s.pos.y });
  }
  return rects;
}
