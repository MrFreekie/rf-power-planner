// Venue underlay drawing step for the plan view (js/view/plan.js). Draws the grey SU4SV venue lines under everything else.
// The venue never feeds extent, scale, auto-fit or page size: this module only reads the viewport and paints.
// Segments come from the model (venueSegmentsByStep): clipped to the frame, in internal scene metres, hidden layers excluded.
import { venueSegmentsByStep, VENUE_GREYS } from '../model/venue-underlay.js';

/** Local fallback greys (same values as the brief); the model's VENUE_GREYS wins when it is passed in. Step 0 = lowest. */
export const FALLBACK_GREYS = Object.freeze({
  light: Object.freeze(['#8c8c8c', '#a6a6a6', '#c0c0c0', '#d8d8d8']),
  dark: Object.freeze(['#d8d8d8', '#c0c0c0', '#a6a6a6', '#8c8c8c']), // reversed: lowest lightest, highest dimmest
});

/** True when the underlay has at least one visible layer with lines (otherwise skip all work). */
export function hasVisibleVenue(venue) {
  return !!(venue && Array.isArray(venue.layers) && venue.layers.some((l) => l && !l.hidden && Array.isArray(l.shades) && l.shades.some((s) => s && s.edges && s.edges.length >= 4)));
}

/** Frame = the visible drawing area in internal scene metres (a little larger than the canvas so no line stops short). */
export function frameOf(vp, w, h) {
  const b = vp.visibleBounds(w, h);
  return { minX: Math.min(b.x0, b.x1), minY: Math.min(b.y0, b.y1), maxX: Math.max(b.x0, b.x1), maxY: Math.max(b.y0, b.y1) };
}

/**
 * drawVenue(ctx, th, vp, scene, w, h, opts?) -> number of segments drawn (0 when nothing was drawn).
 *   opts.hairline  line width in CSS px (default 1 device pixel = 1 / devicePixelRatio)
 *   opts.greys     { light: [4], dark: [4] } override
 *   opts.segments  override of venueSegmentsByStep (tests)
 */
export function drawVenue(ctx, th, vp, scene, w, h, opts = {}) {
  const venue = scene && scene.venue;
  if (!hasVisibleVenue(venue)) return 0;
  const st = scene.stage;
  const anchor = { x: st.width / 2, y: st.depth };
  const frame = frameOf(vp, w, h);
  let steps;
  try { steps = (opts.segments || venueSegmentsByStep)(venue, frame, anchor); } catch (e) { console.warn('venue draw failed', e); return 0; }
  if (!Array.isArray(steps)) return 0;
  const greys = (opts.greys || VENUE_GREYS || FALLBACK_GREYS)[th && th.dark ? 'dark' : 'light'] || FALLBACK_GREYS.light;
  const lw = opts.hairline ?? 1 / ((typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  let n = 0;
  ctx.save();
  ctx.lineWidth = lw; ctx.lineCap = 'butt'; ctx.setLineDash([]);
  for (let step = 0; step < 4; step++) {
    const segs = steps[step];
    if (!segs || !segs.length) continue;
    ctx.beginPath();
    for (const s of segs) {
      const a = vp.worldToScreen(s[0], s[1]), b = vp.worldToScreen(s[2], s[3]);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); n++;
    }
    ctx.strokeStyle = greys[step]; ctx.stroke();
  }
  ctx.restore();
  return n;
}
