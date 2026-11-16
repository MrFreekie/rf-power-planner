// Crowd zones GUI helpers (pure, no DOM): labels, polygon edits, new-crowd placement and link-budget rows.
// Model: js/model/crowd.js. Every crowd figure is an estimate and is marked "assumed" wherever it is shown.
import { crowdParams, crowdSummary, CROWD_POINTS_MAX, CROWD_CONFIDENCE, polygonAreaM2 } from '../model/crowd.js';

const fin = Number.isFinite;
export const CROWD_MODE_LABELS = Object.freeze({ seated: 'Seated', standing: 'Standing', packed: 'Packed' });
export const CROWD_FLAG_WORDS = Object.freeze({ S: 'sourced', I: 'inferred', A: 'assumed' });
export const CROWD_SHORT_NOTE = 'All crowd figures are assumed estimates, not measurements.';

/** Plan label: 'Crowd 1: standing, cap 20 dB (assumed)'. */
export function crowdLabel(c) {
  const p = crowdParams(c);
  return `${c.name || 'Crowd'}: ${p.mode}, loss cap ${+p.lMaxDb.toFixed(1)} dB (assumed)`;
}
/** Short label for a small polygon: 'standing, cap 20 dB'. */
export function crowdShortLabel(c) { const p = crowdParams(c); return `${p.mode}, cap ${+p.lMaxDb.toFixed(1)} dB`; }
/** Screen-reader text for the plan description. */
export function crowdAria(c) {
  const p = crowdParams(c), n = (c.polygon || []).length;
  return `${c.name || 'Crowd'}, ${p.mode} crowd zone, ${n} corners, about ${Math.round(polygonAreaM2(c.polygon || []))} square metres, assumed loss cap ${+p.lMaxDb.toFixed(1)} dB`;
}

/** New crowd in front of the stage (audience side is y > stage depth), each new one a row further back. */
export function newCrowdPartial(scene) {
  const st = (scene && scene.stage) || { width: 12, depth: 8 };
  const n = ((scene && scene.crowds) || []).length;
  const x0 = Math.round((st.width / 2 - 3) * 10) / 10, y0 = Math.round((st.depth + 2 + 5 * n) * 10) / 10;
  return { polygon: [{ x: x0, y: y0 }, { x: x0 + 6, y: y0 }, { x: x0 + 6, y: y0 + 4 }, { x: x0, y: y0 + 4 }] };
}

/** Polygon with a point inserted after index i (at the midpoint of that edge); null at the point limit. */
export function polygonAddAfter(poly, i) {
  if (!Array.isArray(poly) || poly.length >= CROWD_POINTS_MAX) return null;
  const a = poly[i], b = poly[(i + 1) % poly.length];
  const mid = { x: Math.round(((a.x + b.x) / 2) * 100) / 100, y: Math.round(((a.y + b.y) / 2) * 100) / 100 };
  return [...poly.slice(0, i + 1), mid, ...poly.slice(i + 1)].map((p) => ({ x: p.x, y: p.y }));
}
/** Polygon without point i; null when that would leave fewer than three points. */
export function polygonRemoveAt(poly, i) {
  if (!Array.isArray(poly) || poly.length <= 3 || i < 0 || i >= poly.length) return null;
  return poly.filter((_, k) => k !== i).map((p) => ({ x: p.x, y: p.y }));
}
/** Polygon with point i replaced. */
export function polygonSetPoint(poly, i, pt) { return poly.map((p, k) => (k === i ? { x: pt.x, y: pt.y } : { x: p.x, y: p.y })); }

/** Confidence list as text lines: 'S: Single body shadow ...'. */
export function confidenceLines() { return CROWD_CONFIDENCE.map((c) => `${c.flag} (${CROWD_FLAG_WORDS[c.flag]}): ${c.label}`); }

/** Plain one-line explanation of the effective slope and cap of a crowd, for the inspector. */
export function crowdParamText(c) {
  const p = crowdParams(c);
  return `Effective loss ${p.kDbPerM.toFixed(2)} dB per metre of path inside the zone, capped at ${p.lMaxDb.toFixed(1)} dB; full effect only for antennas at or below ${p.headHeightM.toFixed(2)} m, fading out with the first Fresnel zone above that (all assumed).`;
}

/** Budget extras rows from the solver result: one row for the total and one per crowd on the path. [] when the path misses every crowd. */
export function crowdBudgetRows(result) {
  const s = crowdSummary(result);
  if (!s || !(s.lossDb > 0.005)) return [];
  const rows = [{ label: 'Crowd absorption (assumed)', value: `${s.lossDb.toFixed(1)} dB on the direct path. Estimate only: verify with an on-site scan.`, severity: s.lossDb >= 10 ? 'warning' : 'info' }];
  for (const l of s.lines) rows.push({ label: '  Crowd zone', value: l, severity: 'info' });
  return rows;
}
/** Paths-table rows: the crowd loss per zone as { kind, length, delayNs, relDb }. */
export function crowdPathRows(result, fmtLen) {
  const r = result && result.crowd;
  if (!r || !Array.isArray(r.crowds)) return [];
  return r.crowds.filter((c) => fin(c.lossDb) && c.lossDb > 0.005).map((c) => ({ kind: `Crowd: ${c.name || c.id} (assumed)`, length: fmtLen ? fmtLen(c.lengthM) : `${c.lengthM.toFixed(1)} m`, delayNs: '-', relDb: `-${c.lossDb.toFixed(1)} dB${c.capped ? ' (cap)' : ''}` }));
}
