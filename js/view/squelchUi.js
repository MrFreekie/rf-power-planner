// Shared squelch drawing helpers for the canvas views.
import { squelch } from '../squelchTracker.js';
import { haloText } from './util.js';
import { rxState } from '../rxTracker.js';

/** Current gate state for a link: { open, levelDbm, headroomDb } or null when unknown. */
export const gateOf = (linkId) => squelch.get(linkId);
export const isMuted = (linkId) => { const s = squelch.get(linkId); return !!s && !s.open; };

/** Small LED (green open, red muted) near (x, y) with an optional text label. */
export function drawSquelchLed(ctx, th, x, y, state, { label = true, align = 'left' } = {}) {
  if (!state) return;
  const col = state.open ? th.pass : th.fail;
  ctx.save();
  ctx.fillStyle = col; ctx.strokeStyle = th.ink; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
  if (label) {
    const dx = align === 'left' ? 9 : -9;
    haloText(ctx, th, state.open ? 'SQ open' : (state.reason === 'imd' ? 'MUTE imd' : 'MUTE'), x + dx, y + 4, { align, px: 11, weight: '600', color: state.open ? th.ink : th.fail });
  }
}

/** Diversity helpers shared by plan and side: { B:{pos,antenna}|null, active:'A'|'B', overload:'ok'|'hot'|'overload' }. */
export function rxInfo(link) {
  const dv = link.rx && link.rx.diversity;
  const B = dv && dv.enabled && dv.antennaB && dv.antennaB.pos ? dv.antennaB : null;
  const st = rxState.get(link.id);
  return { B, active: (B && st && st.diversity && st.diversity.active) || 'A', overload: st ? st.overload.level : 'ok', div: st ? st.diversity : null };
}

/** Ring (active antenna) with a small LED, and an amber overload halo. */
export function drawActiveRing(ctx, th, x, y, r = 15) {
  ctx.save(); ctx.strokeStyle = th.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = th.pass; ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x + r * 0.75, y - r * 0.75, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
}
export function drawOverloadHalo(ctx, th, x, y, level, r = 24) {
  if (level === 'ok') return;
  ctx.save();
  ctx.fillStyle = th.marginal; ctx.globalAlpha = level === 'overload' ? 0.45 : 0.18;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = level === 'overload' ? th.fail : th.marginal; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
  haloText(ctx, th, level === 'overload' ? 'OVERLOAD' : 'HOT', x, y - r - 4, { align: 'center', px: 11, weight: '600', color: level === 'overload' ? th.fail : '#8a6200' });
}
