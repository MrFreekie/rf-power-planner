// Coverage grid, zone statistics and deterministic fix suggestions for multi-antenna IEM links.
// Pure module (no DOM). Scene shape: link.branches[] (optional, a link without it is one branch) and scene.zones[].

import { branchesOf, prepareBranches, evalPrepared, wavelengthM } from './rf.js';

let ZP = {};
try { ZP = await import('./zones-params.js'); } catch { ZP = {}; }

export const COARSE_CELL_M = 1; // first (quick) pass
export const MAX_GRID_CELLS = 4e6; // upper bound on nx * ny (about 20 MB of grids); a larger area gets a coarser cell instead
export const FINE_CELL_M = 0.25; // fine pass at UHF (half a wavelength is 0.25 m at 600 MHz)
export const DEFAULT_PASS_FRACTION = 0.95;

/**
 * Requirement for a zone. Returns { squelchThresholdDbm, marginDb, appliedMarginDb, requiredDbm }.
 *  squelchThresholdDbm: link.rx.squelch.thresholdDbm when the squelch is enabled, else the sensitivity.
 *  marginDb: zone.requiredMarginDb when set, otherwise the coverage preset (fade margin + body shadow + crowd, from
 *     requiredLevelDbm in zones-params.js; 15 dB for the default 'moving-bodypack').
 *  The grid levels already have environment.fadeMarginDb subtracted (prepareBranches). To avoid counting it twice the
 *  LARGER of the zone margin and the environment fade margin applies once: appliedMarginDb = max(0, marginDb - envFade)
 *  is what is added on top of the grid levels. requiredDbm = squelchThresholdDbm + marginDb (as seen without env fade).
 */
export function zoneRequirement(scene, link, zone) {
  const rx = link.rx || {};
  const sq = rx.squelch;
  const squelchThresholdDbm = sq && sq.enabled !== false && Number.isFinite(sq.thresholdDbm) ? sq.thresholdDbm : rx.sensitivityDbm;
  let marginDb;
  if (zone && Number.isFinite(zone.requiredMarginDb)) marginDb = zone.requiredMarginDb;
  else if (ZP.requiredLevelDbm) marginDb = ZP.requiredLevelDbm(squelchThresholdDbm) - squelchThresholdDbm;
  else marginDb = 15;
  const envFade = (scene.environment && scene.environment.fadeMarginDb) || 0;
  return { squelchThresholdDbm, marginDb, appliedMarginDb: Math.max(0, marginDb - envFade), requiredDbm: squelchThresholdDbm + marginDb };
}

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

function findLink(scene, linkId) {
  return (scene.links || []).find((l) => l.id === linkId) || null;
}

/** Default grid bounds: the stage rectangle united with every zone polygon. */
export function defaultBounds(scene) {
  const st = scene.stage || { width: 12, depth: 8 };
  let x0 = 0, y0 = 0, x1 = st.width, y1 = st.depth;
  for (const z of scene.zones || []) {
    for (const p of z.polygon || []) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
  }
  return { x0, y0, x1, y1 };
}

/**
 * coverageGrid(scene, linkId, { cellM, pass, bounds, rxHeight, mode = 'coherent', budgetMs, resume })
 *   -> { x0, y0, nx, ny, cellM, rxHeight, mode, levelDbm: Float32Array, dominantBranch: Uint8Array,
 *        done, cursor, progress, undersampled, lambdaM }
 * Cell size: opts.cellM, else pass 'coarse' = 1 m (first pass) or 'fine' (default) = 0.25 m. undersampled is true when
 * cellM > lambda / 4: multipath nulls repeat every half wavelength, so the grid then samples only a subset of them and
 * pass fractions are estimates, not measurements.
 * Cell (i, j) is centred at (x0 + (i + 0.5) cellM, y0 + (j + 0.5) cellM) and stored at index j * nx + i (row major).
 * Branch geometry (splitter loss, chain loss/phase, per-branch link objects) is prepared once per call and one rx
 * point object is reused for every cell. With budgetMs the loop stops once that many ms have elapsed and returns the
 * partial grid with done = false; pass it back as `resume` to continue where it stopped (same scene and options).
 * Unfilled cells hold -Infinity.
 */
export function coverageGrid(scene, linkId, opts = {}) {
  const link = findLink(scene, linkId);
  if (!link) return null;
  const prev = opts.resume || null;
  const lambdaM = wavelengthM(link.freqMHz);
  const b = prev ? null : opts.bounds || defaultBounds(scene);
  let cellM = prev ? prev.cellM : Math.max(0.05, opts.cellM || (opts.pass === 'coarse' ? COARSE_CELL_M : FINE_CELL_M));
  if (!prev) {
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    if (!Number.isFinite(w) || !Number.isFinite(h)) return null; // unusable bounds: no grid
    const cells = (w / cellM) * (h / cellM);
    if (cells > MAX_GRID_CELLS) cellM *= Math.sqrt(cells / MAX_GRID_CELLS) * 1.0001; // keeps nx * ny within the cap
  }
  const x0 = prev ? prev.x0 : b.x0, y0 = prev ? prev.y0 : b.y0;
  const nx = prev ? prev.nx : Math.max(1, Math.ceil((b.x1 - b.x0) / cellM - 1e-9));
  const ny = prev ? prev.ny : Math.max(1, Math.ceil((b.y1 - b.y0) / cellM - 1e-9));
  const rxHeight = prev ? prev.rxHeight : Number.isFinite(opts.rxHeight) ? opts.rxHeight : link.rx.pos.z;
  const mode = prev ? prev.mode : opts.mode || 'coherent';
  const grid = prev || {
    x0, y0, nx, ny, cellM, rxHeight, mode, lambdaM, undersampled: cellM > lambdaM / 4,
    levelDbm: new Float32Array(nx * ny).fill(-Infinity),
    dominantBranch: new Uint8Array(nx * ny),
    done: false, cursor: 0, progress: 0,
  };
  const prep = prepareBranches(scene, link);
  const P = { x: 0, y: 0, z: rxHeight };
  const total = nx * ny;
  const t0 = now();
  const budget = Number.isFinite(opts.budgetMs) ? opts.budgetMs : Infinity;
  let k = grid.cursor;
  while (k < total) {
    P.x = x0 + ((k % nx) + 0.5) * cellM;
    P.y = y0 + (Math.floor(k / nx) + 0.5) * cellM;
    const r = evalPrepared(prep, scene, P, mode);
    grid.levelDbm[k] = r.combinedDbm;
    grid.dominantBranch[k] = r.dominantBranch;
    k++;
    if ((k & 7) === 0 && now() - t0 > budget) break;
  }
  grid.cursor = k;
  grid.done = k >= total;
  grid.progress = k / total;
  return grid;
}

/** Cell centre of index k. */
export function cellCentre(grid, k) {
  return { x: grid.x0 + ((k % grid.nx) + 0.5) * grid.cellM, y: grid.y0 + (Math.floor(k / grid.nx) + 0.5) * grid.cellM };
}

/**
 * Point in polygon, even-odd ray casting; points on an edge or vertex count as inside.
 * Polygons with fewer than 3 vertices contain nothing.
 */
export function pointInPolygon(pt, poly) {
  const n = poly ? poly.length : 0;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = poly[i], b = poly[j];
    // on-segment test
    const cross = (pt.x - a.x) * (b.y - a.y) - (pt.y - a.y) * (b.x - a.x);
    if (Math.abs(cross) < 1e-9 &&
        pt.x >= Math.min(a.x, b.x) - 1e-9 && pt.x <= Math.max(a.x, b.x) + 1e-9 &&
        pt.y >= Math.min(a.y, b.y) - 1e-9 && pt.y <= Math.max(a.y, b.y) + 1e-9) return true;
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * zoneStats(grid, zone, thresholdDbm, marginDb = zone.requiredMarginDb ?? 0)
 *   -> { minDbm, meanDbm (power mean), p5Dbm, passFraction, allCellsPass, worstPoint: {x, y}, pass, cells }
 * Cells whose centre lies in the zone polygon (edges inclusive) are used; a cell passes when level >= threshold + margin.
 * pass = passFraction >= (zone.passAreaFraction ?? 0.95); allCellsPass = every cell passes (the strict rule). If no cell centre falls inside (zone smaller than a cell), the cell nearest the polygon
 * centroid stands in. An empty or invalid polygon gives cells = 0, pass = false and NaN levels.
 */
export function zoneStats(grid, zone, thresholdDbm, marginDb) {
  const margin = Number.isFinite(marginDb) ? marginDb : Number.isFinite(zone.requiredMarginDb) ? zone.requiredMarginDb : 0;
  const poly = zone.polygon || [];
  const idx = [];
  if (poly.length >= 3) {
    // restrict to the polygon bounding box
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const p of poly) { bx0 = Math.min(bx0, p.x); by0 = Math.min(by0, p.y); bx1 = Math.max(bx1, p.x); by1 = Math.max(by1, p.y); }
    const i0 = Math.max(0, Math.floor((bx0 - grid.x0) / grid.cellM) - 1), i1 = Math.min(grid.nx - 1, Math.ceil((bx1 - grid.x0) / grid.cellM) + 1);
    const j0 = Math.max(0, Math.floor((by0 - grid.y0) / grid.cellM) - 1), j1 = Math.min(grid.ny - 1, Math.ceil((by1 - grid.y0) / grid.cellM) + 1);
    const pt = { x: 0, y: 0 };
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        pt.x = grid.x0 + (i + 0.5) * grid.cellM; pt.y = grid.y0 + (j + 0.5) * grid.cellM;
        if (pointInPolygon(pt, poly)) idx.push(j * grid.nx + i);
      }
    }
    if (!idx.length) {
      const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length, cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
      const i = Math.min(grid.nx - 1, Math.max(0, Math.floor((cx - grid.x0) / grid.cellM)));
      const j = Math.min(grid.ny - 1, Math.max(0, Math.floor((cy - grid.y0) / grid.cellM)));
      idx.push(j * grid.nx + i);
    }
  }
  if (!idx.length) return { minDbm: NaN, meanDbm: NaN, p5Dbm: NaN, passFraction: 0, allCellsPass: false, worstPoint: null, pass: false, cells: 0 };
  const need = thresholdDbm + margin;
  let min = Infinity, worst = idx[0], sumP = 0, pass = 0;
  const vals = new Array(idx.length);
  for (let n = 0; n < idx.length; n++) {
    const v = grid.levelDbm[idx[n]];
    vals[n] = v;
    if (v < min) { min = v; worst = idx[n]; }
    sumP += Math.pow(10, v / 10);
    if (v >= need) pass++;
  }
  vals.sort((a, b) => a - b);
  const q = 0.05 * (vals.length - 1), lo = Math.floor(q), hi = Math.ceil(q);
  const p5 = vals[lo] + (vals[hi] - vals[lo]) * (q - lo);
  return {
    minDbm: min, meanDbm: 10 * Math.log10(sumP / idx.length), p5Dbm: p5,
    passFraction: pass / idx.length, worstPoint: cellCentre(grid, worst), cells: idx.length,
    allCellsPass: pass === idx.length,
    pass: pass / idx.length >= (Number.isFinite(zone.passAreaFraction) ? zone.passAreaFraction : DEFAULT_PASS_FRACTION),
  };
}

// ---- suggestions ---------------------------------------------------------------------------

const clone = (o) => JSON.parse(JSON.stringify(o));

// A copy of the scene whose link has an explicit branches[] (so edits have somewhere to live).
function materialise(scene, linkId) {
  const sc = clone(scene);
  const link = findLink(sc, linkId);
  link.branches = clone(branchesOf(link));
  return { sc, link };
}

function evaluate(scene, linkId, opts) {
  const grid = coverageGrid(scene, linkId, opts);
  const link = findLink(scene, linkId);
  const out = {};
  for (const z of scene.zones || []) {
    const rq = zoneRequirement(scene, link, z);
    out[z.id] = zoneStats(grid, z, rq.squelchThresholdDbm, rq.appliedMarginDb);
  }
  return out;
}

/**
 * suggestFix(scene, linkId, zoneId, { cellM = 0.75, rxHeight, mode }) -> ranked suggestions (best first).
 * Candidates (brute force, deterministic):
 *   move   branch k toward the zone's worst point by 0.5, 1.0 ... 3.0 m (best step per branch kept);
 *   attenuate  add 3 or 6 dB attenuator to branch k (balances a dominant branch that nulls the others);
 *   gain   raise branch k antenna gain by 3 or 6 dB (best per branch kept).
 * Each: { kind, branchIndex, branchId, description, params, deltaMinDb, deltaPassFraction (target zone),
 *         others: [{ zoneId, deltaPassFraction }], score }.
 * score = deltaPassFraction + 0.001 deltaMinDb - harm to other zones (sum of negative deltas, weight 0.5).
 * Only suggestions with score > 0 are returned, sorted by score then kind and branch index.
 */
export function suggestFix(scene, linkId, zoneId, { cellM = 0.75, rxHeight, mode = 'coherent' } = {}) {
  // Evaluation uses zoneRequirement (squelch threshold + zone margin); a coarse cell keeps the brute force fast.
  const base0 = findLink(scene, linkId);
  const zone = (scene.zones || []).find((z) => z.id === zoneId);
  if (!base0 || !zone) return [];
  const gopts = { cellM, rxHeight, mode };
  const { sc: baseScene } = materialise(scene, linkId);
  const baseStats = evaluate(baseScene, linkId, gopts);
  const target0 = baseStats[zoneId];
  if (!target0 || !target0.worstPoint) return [];
  const wp = target0.worstPoint;
  const nBr = findLink(baseScene, linkId).branches.length;
  const results = [];

  const score = (candScene) => {
    const st = evaluate(candScene, linkId, gopts);
    const dPass = st[zoneId].passFraction - target0.passFraction;
    const dMin = st[zoneId].minDbm - target0.minDbm;
    const others = [];
    let harm = 0;
    for (const z of scene.zones || []) {
      if (z.id === zoneId) continue;
      const d = st[z.id].passFraction - baseStats[z.id].passFraction;
      others.push({ zoneId: z.id, deltaPassFraction: d });
      if (d < 0) harm += d;
    }
    return { dPass, dMin, others, score: dPass + 0.001 * dMin + 0.5 * harm };
  };
  const keepBest = (list) => {
    list.sort((a, b) => b.score - a.score || a.params.step - b.params.step);
    return list[0];
  };

  for (let k = 0; k < nBr; k++) {
    // move toward the worst point
    const moves = [];
    const b0 = findLink(baseScene, linkId).branches[k];
    const dx = wp.x - b0.pos.x, dy = wp.y - b0.pos.y, dist = Math.hypot(dx, dy);
    if (dist > 1e-6) {
      for (let step = 0.5; step <= 3.0001; step += 0.5) {
        const m = Math.min(step, dist);
        const { sc, link } = materialise(baseScene, linkId);
        link.branches[k].pos = { ...link.branches[k].pos, x: b0.pos.x + (dx / dist) * m, y: b0.pos.y + (dy / dist) * m };
        const r = score(sc);
        moves.push({
          kind: 'move', branchIndex: k, branchId: b0.id, params: { step: m, x: link.branches[k].pos.x, y: link.branches[k].pos.y },
          description: `Move ${b0.name || b0.id} ${m.toFixed(1)} m toward (${wp.x.toFixed(1)}, ${wp.y.toFixed(1)})`,
          deltaMinDb: r.dMin, deltaPassFraction: r.dPass, others: r.others, score: r.score,
        });
      }
      results.push(keepBest(moves));
    }
    // attenuator on branch k
    const atts = [];
    for (const db of [3, 6]) {
      const { sc, link } = materialise(baseScene, linkId);
      link.branches[k].chain = [...(link.branches[k].chain || []), { kind: 'attenuator', lossDb: db }];
      const r = score(sc);
      atts.push({
        kind: 'attenuate', branchIndex: k, branchId: b0.id, params: { step: db, lossDb: db },
        description: `Add a ${db} dB attenuator to ${b0.name || b0.id}`,
        deltaMinDb: r.dMin, deltaPassFraction: r.dPass, others: r.others, score: r.score,
      });
    }
    results.push(keepBest(atts));
    // antenna gain
    const gains = [];
    for (const db of [3, 6]) {
      const { sc, link } = materialise(baseScene, linkId);
      const ant = link.branches[k].antenna;
      ant.gainDbi = (Number.isFinite(ant.gainDbi) ? ant.gainDbi : 0) + db;
      const r = score(sc);
      gains.push({
        kind: 'gain', branchIndex: k, branchId: b0.id, params: { step: db, gainDb: db },
        description: `Use an antenna with ${db} dB more gain on ${b0.name || b0.id}`,
        deltaMinDb: r.dMin, deltaPassFraction: r.dPass, others: r.others, score: r.score,
      });
    }
    results.push(keepBest(gains));
  }
  const order = { move: 0, attenuate: 1, gain: 2 };
  return results.filter((r) => r && r.score > 1e-9)
    .sort((a, b) => b.score - a.score || order[a.kind] - order[b.kind] || a.branchIndex - b.branchIndex);
}
