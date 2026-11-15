// Plan drawing for walk-test readings: a diamond marker per reading coloured by delta (blue stronger, orange weaker, grey close) with a text label
// ("-6.2 weak") so colour is never the only cue, plus a legend. Readings of every link are shown; the legend counts them.
import { cachedCompare, markerLabel, deltaColor, deltaView, summaryText, OK_DB } from '../ui/measureUi.js';
import { placeText, haloText, setFont } from './util.js';

export function drawMeasurementsPlan(ctx, th, vp, scene, placed, w, h) {
  const cmp = cachedCompare(scene, { throttleMs: 200 }); // a walk replaces the scene every frame: refit at most five times a second
  if (!cmp || !cmp.points.length) return null;
  const onScreen = (q) => q.x >= -20 && q.y >= -20 && q.x <= w + 20 && q.y <= h + 20;
  for (const p of cmp.points) { const q = vp.worldToScreen({ x: p.x, y: p.y }); if (onScreen(q)) placed.push({ x: q.x - 8, y: q.y - 8, w: 16, h: 16 }); } // labels avoid every marker
  for (const p of cmp.points) {
    const q = vp.worldToScreen({ x: p.x, y: p.y });
    if (q.x < -20 || q.y < -20 || q.x > w + 20 || q.y > h + 20) continue;
    const col = deltaColor(p.deltaDb, th.dark), sign = deltaView(p.deltaDb).sign, r = 7;
    ctx.beginPath(); ctx.moveTo(q.x, q.y - r); ctx.lineTo(q.x + r, q.y); ctx.lineTo(q.x, q.y + r); ctx.lineTo(q.x - r, q.y); ctx.closePath();
    ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = th.paper; ctx.stroke(); ctx.lineWidth = 1; ctx.strokeStyle = th.ink; ctx.stroke();
    if (sign === 'neg') { ctx.fillStyle = th.paper; ctx.fillRect(q.x - 3, q.y - 1, 6, 2); } // minus inside: shape cue for weaker
    else if (sign === 'pos') { ctx.fillStyle = th.paper; ctx.fillRect(q.x - 3, q.y - 1, 6, 2); ctx.fillRect(q.x - 1, q.y - 3, 2, 6); } // plus for stronger
    placeText(ctx, th, markerLabel(p.deltaDb), q.x + 10, q.y + 4, { px: 12, optional: true }, placed, { x: 0, y: 0, w, h });
  }
  drawMeasurementLegend(ctx, th, w, h, cmp);
  return cmp;
}

export function drawMeasurementLegend(ctx, th, w, h, cmp) {
  const rows = [['pos', `stronger (> +${OK_DB} dB)`, 6], ['ok', `close (within ${OK_DB} dB)`, 0], ['neg', `weaker (< −${OK_DB} dB)`, -6]];
  setFont(ctx, th, 12);
  const title = `Measured − predicted: ${cmp.n} reading${cmp.n === 1 ? '' : 's'}, rms ${cmp.rmsDb.toFixed(1)} dB`;
  const widths = rows.map((r) => ctx.measureText(r[1]).width + 24), inline = widths.reduce((a, b) => a + b, 0) + 12;
  const bw = Math.min(w - 16, Math.max(inline, ctx.measureText(title).width + 12)), bh = 40;
  const x = 8, y = Math.max(8, h - 58 - bh); // above the scale bar
  ctx.fillStyle = th.paper; ctx.globalAlpha = 0.92; ctx.fillRect(x, y, bw, bh); ctx.globalAlpha = 1; ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, bw, bh);
  haloText(ctx, th, title, x + 6, y + 15, { px: 12, weight: '600' });
  let cx = x + 6; const cy = y + 30;
  rows.forEach((r, i) => {
    const col = deltaColor(r[2], th.dark);
    ctx.beginPath(); ctx.moveTo(cx + 5, cy - 5); ctx.lineTo(cx + 10, cy); ctx.lineTo(cx + 5, cy + 5); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = th.ink; ctx.stroke();
    haloText(ctx, th, r[1], cx + 15, cy + 4, { px: 12 }); cx += widths[i];
  });
  ctx.textAlign = 'left';
}

/** Banner text drawn while "Place measurement" is active. */
export function drawPlaceBanner(ctx, th, w, message) {
  setFont(ctx, th, 13, '600');
  const tw = Math.min(w - 16, ctx.measureText(message).width + 20), x = (w - tw) / 2;
  ctx.fillStyle = th.ink; ctx.fillRect(x, 8, tw, 26);
  ctx.fillStyle = th.paper; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(message, x + 10, 26, tw - 20);
}
export { summaryText };
