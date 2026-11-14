// Shared drawing helpers for overload distortion (see distortionFromLink in js/model/spectrum-views.js): the OVERLOAD badge,
// small product markers and the aria sentence. Colour is never the only cue: the badge carries words, markers carry labels.
import { haloText } from './util.js';

const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/** The descriptor, or null when nothing is active. Pure. */
export function activeDistortion(d) { return d && d.active ? d : null; }

/** Badge words: severity plus where the distortion comes from. Pure. */
export function badgeText(d, short = false) {
  if (!d || !d.active) return '';
  const head = d.severity === 'red' ? 'OVERLOAD' : 'NEAR OVERLOAD';
  if (short) return head;
  const src = d.source === 'rx-front-end' ? 'receiver' : d.source === 'tx-limiter' ? 'Tx limiter' : d.source === 'both' ? 'receiver and Tx limiter' : '';
  return src ? `${head} (${src})` : head;
}

/** One sentence for screen readers and captions. Pure. */
export function distortionAria(d) {
  if (!d || !d.active) return '';
  const bits = [];
  if (fin(d.compressionDb) && d.compressionDb >= 0.1) bits.push(`compression ${d.compressionDb.toFixed(1)} dB`);
  if (fin(d.thdPercent) && d.thdPercent > 0) bits.push(`distortion ${d.thdPercent < 10 ? d.thdPercent.toFixed(1) : Math.round(d.thdPercent)} percent`);
  if (fin(d.imd3Dbc) && d.imd3Dbc > -100) bits.push(`third-order products ${Math.round(d.imd3Dbc)} dBc`);
  if (fin(d.desenseDb) && d.desenseDb >= 0.5) bits.push(`noise floor raised ${d.desenseDb.toFixed(1)} dB`);
  return `${badgeText(d)}${d.severity === 'red' ? ', severe' : ', mild'}: ${bits.join(', ') || 'distortion active'}. Simulated and illustrative.`;
}

/**
 * Draw the badge at the top right of a plot box f = { L, T, pw, ph } and, under it, a one-line legend for the markers.
 * Amber and red use the theme tokens; text stays in the ink colour on a paper box so contrast holds in both themes.
 */
export function drawDistortionBadge(ctx, th, f, d, legend) {
  if (!d || !d.active) return;
  const col = d.severity === 'red' ? th.fail : th.marginal;
  const short = f.pw < 230;
  const text = badgeText(d, short);
  ctx.save();
  ctx.font = `700 12px ${th.font || 'sans-serif'}`;
  const tw = ctx.measureText(text).width, bw = tw + 14, bh = 18;
  const x = f.L + f.pw - 4 - bw, y = f.T + 4;
  ctx.fillStyle = th.paper; ctx.fillRect(x, y, bw, bh);
  ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, bw - 2, bh - 2);
  ctx.fillStyle = col; ctx.fillRect(x + 1, y + 1, 5, bh - 2); // colour chip at the left edge
  ctx.fillStyle = th.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 9, y + bh / 2 + 0.5);
  ctx.restore();
  if (legend && f.ph > 70) haloText(ctx, th, legend, f.L + f.pw - 4, y + bh + 13, { align: 'right', px: 11, color: th.inkSoft });
}

/** An upward triangle marker with an optional label above it. */
export function drawProductMarker(ctx, th, x, y, label, { color } = {}) {
  if (!fin(x) || !fin(y)) return;
  ctx.save();
  ctx.fillStyle = color || th.fail; ctx.strokeStyle = th.paper; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x - 4.5, y); ctx.lineTo(x + 4.5, y); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  if (label) haloText(ctx, th, label, x, y - 10, { align: 'center', px: 11, weight: '600', color: color || th.fail });
}
