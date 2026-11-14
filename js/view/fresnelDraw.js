// Fresnel zone overlay (item 33): the first zone and the 60 percent zone of the active link in the plan (lens) and in the side view (ellipse).
// State is a shared toggle (the checkbox in each pane heading); drawing reads fresnelClearance from the model and never changes the budget.
// Status is also written in words next to the zone, not by colour alone.
import { fresnelClearance } from '../model/fresnel.js';
import { haloText } from './util.js';

export const fresnelView = (() => {
  let on = false; const subs = new Set();
  return { get on() { return on; }, set(v) { v = !!v; if (v !== on) { on = v; for (const cb of [...subs]) cb(on); } }, subscribe(cb) { subs.add(cb); return () => subs.delete(cb); } };
})();

const cache = new WeakMap(); // scene -> Map(linkId + freq -> result)
export function fresnelFor(scene, link) {
  if (!scene || !link || !link.tx || !link.rx || !link.tx.pos || !link.rx.pos) return null;
  let m = cache.get(scene); if (!m) { m = new Map(); cache.set(scene, m); }
  const key = `${link.id}|${link.freqMHz}`;
  if (!m.has(key)) { try { m.set(key, fresnelClearance(scene, link)); } catch (e) { m.set(key, null); } }
  return m.get(key);
}

export const STATUS_WORD = Object.freeze({ clear: 'CLEAR', marginal: 'MARGINAL (under 60 % clear)', blocked: 'BLOCKED' });
const statusColour = (th, s) => (s === 'blocked' ? th.fail : s === 'marginal' ? th.marginal : th.pass);

/** One-line status for the overlay label and the budget panel. */
export function fresnelSummary(fr) {
  if (!fr) return '';
  const pct = Number.isFinite(fr.minFraction) ? `${Math.round(fr.minFraction * 100)} % of the first zone clear` : 'no obstacles';
  return `${STATUS_WORD[fr.status] || fr.status}: ${pct}${fr.worst ? `, worst ${fr.worst.category}${fr.worst.name ? ` (${fr.worst.name})` : ''}` : ''}`;
}

function poly(ctx, pts, toScreen) {
  ctx.beginPath();
  pts.forEach((p, i) => { const s = toScreen(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
  ctx.closePath();
}
function drawZones(ctx, th, fr, a, b, toScreen) {
  const col = statusColour(th, fr.status);
  ctx.save();
  ctx.fillStyle = th.blue; ctx.globalAlpha = 0.09; poly(ctx, a, toScreen); ctx.fill();
  ctx.globalAlpha = 0.12; poly(ctx, b, toScreen); ctx.fill(); ctx.globalAlpha = 1;
  ctx.lineWidth = 1.2; ctx.strokeStyle = th.blue; ctx.setLineDash([6, 4]); poly(ctx, a, toScreen); ctx.stroke(); // first zone, dashed
  ctx.setLineDash([]); ctx.lineWidth = 1.6; ctx.strokeStyle = col; poly(ctx, b, toScreen); ctx.stroke(); // 60 percent zone, solid in the status colour
  ctx.restore();
}
function label(ctx, th, fr, w, y) {
  const pct = Number.isFinite(fr.minFraction) ? `${Math.round(fr.minFraction * 100)} % clear` : 'no obstacles';
  const txt = `Fresnel ${({ clear: 'CLEAR', marginal: 'MARGINAL', blocked: 'BLOCKED' })[fr.status] || fr.status}: ${pct}${fr.worst ? `, ${fr.worst.category}` : ''}`;
  haloText(ctx, th, txt, w - 8, y, { align: 'right', px: 12, weight: '700', color: fr.status === 'clear' ? th.ink : th.warnText });
  if (w >= 520) haloText(ctx, th, 'dashed: first zone, solid: 60 %', w - 8, y + 14, { align: 'right', px: 11, color: th.inkSoft });
}

export function drawFresnelPlan(ctx, th, vp, scene, link, w) {
  if (!fresnelView.on) return;
  const fr = fresnelFor(scene, link); if (!fr) return;
  const { lens, lens60 } = fr.geometry.plan;
  drawZones(ctx, th, fr, lens, lens60, (p) => vp.worldToScreen(p.x, p.y));
  label(ctx, th, fr, w, 54);
}

/** geom = side view geometry (iem, D, ...): the slice axis s runs from the stationary antenna (Rx for a mic, Tx for an IEM). */
export function drawFresnelSide(ctx, th, vp, scene, link, geom, w) {
  if (!fresnelView.on) return;
  const fr = fresnelFor(scene, link); if (!fr) return;
  const L = fr.geometry.side.lengthM, sOf = (u) => (geom.iem ? u : L - u);
  drawZones(ctx, th, fr, fr.geometry.side.ellipse, fr.geometry.side.ellipse60, (p) => vp.worldToScreen(sOf(p.u), -p.z));
  label(ctx, th, fr, w, 34);
}
