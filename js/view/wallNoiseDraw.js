// Plan overlay of video-wall noise: the power an isotropic receive antenna would collect at each point (ledwall.js wallNoiseAt),
// shown against the receiver noise floor. Amber = at or above the floor, red = 3 dB or more above it (hatched), faint = within 10 dB below.
import { wallNoiseAt } from '../model/rf.js';

const CELL_PX = 14;
const cache = { key: '', cells: [] };

/** Cells [{x, y, level}] covering the visible world rectangle; level 0 faint, 1 at/above floor, 2 at least 3 dB above. Pure given the inputs. */
export function wallNoiseCells(scene, link, result, rect, cellM) {
  const wn = result && result.wallNoise;
  if (!wn || !Number.isFinite(wn.floorBeforeDbm) || !(scene.reflectors || []).some((r) => r.noise && r.noise.preset && r.noise.preset !== 'off')) return [];
  const f = link.freqMHz, bw = Number.isFinite(wn.bandwidthKHz) ? wn.bandwidthKHz : 120, z = (link.rx && link.rx.pos && link.rx.pos.z) || 1;
  const out = [];
  const x0 = Math.floor(rect.x0 / cellM) * cellM, y0 = Math.floor(rect.y0 / cellM) * cellM;
  for (let y = y0; y < rect.y1; y += cellM) for (let x = x0; x < rect.x1; x += cellM) {
    const n = wallNoiseAt(scene.reflectors, { x: x + cellM / 2, y: y + cellM / 2, z }, f, bw);
    const rise = n.dbm - wn.floorBeforeDbm;
    const level = rise >= 3 ? 2 : rise >= 0 ? 1 : rise >= -10 ? 0 : -1;
    if (level >= 0) out.push({ x, y, level });
  }
  return out;
}

export function drawWallNoise(ctx, th, vp, scene, link, result, w, h) {
  if (!link || !result || !result.wallNoise) return;
  const a = vp.screenToWorld(0, 0), b = vp.screenToWorld(w, h);
  const rect = { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) };
  const cellM = Math.max(0.25, CELL_PX / vp.pxPerM);
  const key = [scene.reflectors, link.freqMHz, result.wallNoise.floorBeforeDbm, cellM.toFixed(3), rect.x0.toFixed(2), rect.y0.toFixed(2), rect.x1.toFixed(2), rect.y1.toFixed(2), link.rx.pos.z].map((v) => (typeof v === 'object' ? JSON.stringify(v) : v)).join('|');
  if (cache.key !== key) { cache.key = key; cache.cells = wallNoiseCells(scene, link, result, rect, cellM); }
  if (!cache.cells.length) return;
  const s = cellM * vp.pxPerM;
  ctx.save();
  for (const c of cache.cells) {
    const p = vp.worldToScreen(c.x, c.y + cellM);
    if (c.level === 2) { ctx.fillStyle = th.fail; ctx.globalAlpha = 0.22; ctx.fillRect(p.x, p.y, s, s); ctx.globalAlpha = 0.5; ctx.fillRect(p.x + s * 0.3, p.y + s * 0.3, s * 0.4, s * 0.4); }
    else if (c.level === 1) { ctx.fillStyle = th.marginal; ctx.globalAlpha = 0.28; ctx.fillRect(p.x, p.y, s, s); }
    else { ctx.fillStyle = th.marginal; ctx.globalAlpha = 0.1; ctx.fillRect(p.x, p.y, s, s); }
  }
  ctx.restore();
  ctx.font = `600 12px ${th.font}`; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  const txt = 'Wall noise: red dot = 3+ dB above floor, amber = at floor';
  ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeStyle = th.paper; ctx.strokeText(txt, w - 8, 36); ctx.fillStyle = th.ink; ctx.fillText(txt, w - 8, 36);
}
