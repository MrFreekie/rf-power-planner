// Coverage tracker: computes the multi-antenna coverage map and zone statistics without blocking the UI.
//   coverage.get(linkId) -> { grid, zones:[{zoneId, stats, requirement}], computing, progress, mode, cellM, thresholdDbm, rxHeight,
//                             undersampled, fineCoverage: 'full'|'zones-only'|'none', fineGrid } | null
//   grid is always the whole-venue map (the 1 m pass, replaced by the 0.25 m pass when the venue is at most 600 m2);
//   for larger venues the fine pass covers only the zones (plus 1 m) and is exposed as fineGrid, from which the zone
//   statistics are then taken.
//   coverage.subscribe(cb)     cb(linkId) after every published slice (partial grids included while computing)
//   coverage.install(store)    follow a store; scene changes are debounced (about 120 ms), then a coarse pass (1 m cells)
//                              and a fine pass (0.5 m cells) run in slices of about 8 ms per animation frame
//   coverage.recomputeNow()    skip the debounce (tests, mode switches)
// The grid is that of coverage.js (levelDbm, dominantBranch, x0, y0, nx, ny, cellM, done). A link is analysed when it is an
// IEM link or the scene defines zones. Zone statistics use zoneRequirement(): the squelch threshold (or the sensitivity when the
// squelch is off) plus the zone's margin; a zone passes when passFraction >= zone.passAreaFraction (default 0.95).
import { coverageGrid, zoneStats, zoneRequirement, defaultBounds, COARSE_CELL_M, FINE_CELL_M } from './model/coverage.js';

export const DEBOUNCE_MS = 120;
export const BUDGET_MS = 8;
export const FULL_FINE_MAX_AREA_M2 = 600; // above this the 0.25 m pass covers only the zones (plus a margin)
export const ZONE_MARGIN_M = 1;

export function createCoverageTracker({
  debounceMs = DEBOUNCE_MS, budgetMs = BUDGET_MS,
  now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  raf = (typeof requestAnimationFrame === 'function' ? requestAnimationFrame.bind(globalThis) : (fn) => globalThis.setTimeout(fn, 16)),
  caf = (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame.bind(globalThis) : (h) => globalThis.clearTimeout(h)),
  setTimeoutFn = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeoutFn = (h) => globalThis.clearTimeout(h),
} = {}) {
  const results = new Map();
  const subs = new Set();
  let store = null;
  let off = null;
  let debounce = null;
  let frame = null;
  let job = null; // { scene, queue:[{linkId, cellM}], grid, current }
  let generation = 0;

  const emit = (linkId) => { for (const cb of [...subs]) cb(linkId); };

  const wanted = (scene) => scene.links.filter((l) => l.kind === 'iem' || (scene.zones && scene.zones.length));

  function publish(link, scene, grid, computing, progress, withStats, extra = {}) {
    const prev = results.get(link.id);
    const thresholdDbm = zoneRequirement(scene, link, null).squelchThresholdDbm;
    let zones = prev ? prev.zones : [];
    const statsGrid = extra.fineGrid || grid;
    if (withStats) {
      zones = (scene.zones || []).map((z) => {
        const requirement = zoneRequirement(scene, link, z);
        return { zoneId: z.id, stats: zoneStats(statsGrid, z, requirement.squelchThresholdDbm, requirement.appliedMarginDb), requirement };
      });
    }
    results.set(link.id, {
      grid, zones, computing, progress, mode: grid.mode, cellM: statsGrid.cellM, thresholdDbm, rxHeight: grid.rxHeight,
      undersampled: !!statsGrid.undersampled, fineCoverage: extra.fineCoverage || (prev ? prev.fineCoverage : 'none'),
      fineGrid: extra.fineGrid || (prev ? prev.fineGrid : null),
    });
    emit(link.id);
  }

  function cancel() {
    generation++;
    if (frame !== null) caf(frame);
    frame = null;
    job = null;
  }

  function zoneBounds(scene) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const z of scene.zones || []) for (const p of z.polygon || []) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
    if (!Number.isFinite(x0)) return null;
    return { x0: x0 - ZONE_MARGIN_M, y0: y0 - ZONE_MARGIN_M, x1: x1 + ZONE_MARGIN_M, y1: y1 + ZONE_MARGIN_M };
  }

  function start() {
    cancel();
    if (!store) return;
    const scene = store.getScene();
    const links = wanted(scene);
    for (const id of [...results.keys()]) if (!links.some((l) => l.id === id)) { results.delete(id); emit(id); }
    if (!links.length) return;
    const bb = defaultBounds(scene);
    const area = (bb.x1 - bb.x0) * (bb.y1 - bb.y0);
    const coarse = Math.max(COARSE_CELL_M, Math.ceil(Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) / 120));
    const zb = zoneBounds(scene);
    let fine = 'full';
    if (area > FULL_FINE_MAX_AREA_M2) fine = zb ? 'zones-only' : 'none';
    const queue = [];
    for (const l of links) {
      queue.push({ link: l, cellM: coarse, kind: 'coarse', fine });
      if (fine === 'full') queue.push({ link: l, cellM: Math.min(FINE_CELL_M, coarse), kind: 'fine', fine });
      else if (fine === 'zones-only') queue.push({ link: l, cellM: FINE_CELL_M, kind: 'fine', fine, bounds: zb });
    }
    job = { scene, queue, grid: null, current: null, coarseGrids: new Map(), gen: generation };
    for (const l of links) { const r = results.get(l.id); if (r) { r.computing = true; r.progress = 0; } }
    schedule();
  }

  function schedule() { frame = raf(step); }

  function step() {
    frame = null;
    if (!job || job.gen !== generation) return;
    const { scene } = job;
    if (!job.current) {
      job.current = job.queue.shift();
      if (!job.current) { job = null; return; }
      job.grid = null;
    }
    const cur = job.current;
    const { link, cellM } = cur;
    try {
      const grid = coverageGrid(scene, link.id, {
        cellM, bounds: cur.bounds, mode: (scene.coverage && scene.coverage.mode) || 'power', rxHeight: link.rx.pos.z,
        budgetMs, resume: job.grid || undefined,
      });
      job.grid = grid;
      const lastForLink = !job.queue.some((q) => q.link.id === link.id);
      if (grid.done) {
        if (cur.kind === 'coarse') {
          job.coarseGrids.set(link.id, grid);
          publish(link, scene, grid, !lastForLink, 1, true, { fineCoverage: cur.fine, fineGrid: null });
        } else if (cur.fine === 'full') {
          publish(link, scene, grid, false, 1, true, { fineCoverage: 'full', fineGrid: grid });
        } else {
          publish(link, scene, job.coarseGrids.get(link.id) || grid, false, 1, true, { fineCoverage: 'zones-only', fineGrid: grid });
        }
        job.current = null;
      } else if (cur.kind === 'fine' && cur.fine === 'zones-only') {
        // keep showing the finished coarse map while the zone pass runs
        const r = results.get(link.id);
        if (r) { r.computing = true; r.progress = grid.progress; emit(link.id); }
      } else {
        publish(link, scene, grid, true, grid.progress, false, { fineCoverage: cur.fine });
      }
    } catch {
      job.current = null; // a failing link must not stall the others
    }
    if (job && (job.current || job.queue.length)) schedule(); else job = null;
  }

  function trigger() {
    if (debounce !== null) clearTimeoutFn(debounce);
    cancel(); // stop spending time on a stale scene right away
    for (const r of results.values()) r.computing = true;
    debounce = setTimeoutFn(() => { debounce = null; start(); }, debounceMs);
  }

  return {
    get: (linkId) => results.get(linkId) || null,
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb); },
    install(theStore) {
      if (off) off();
      store = theStore;
      let lastSig = null;
      // Only scene edits matter; selection changes and no-op updates do not restart the computation.
      off = store.subscribe((scene, info) => {
        if (info.type === 'selection') return;
        const sig = JSON.stringify([scene.links, scene.zones, scene.reflectors, scene.environment, scene.coverage, scene.stage]);
        if (sig === lastSig) return;
        lastSig = sig;
        trigger();
      });
      lastSig = JSON.stringify([store.getScene().links, store.getScene().zones, store.getScene().reflectors, store.getScene().environment, store.getScene().coverage, store.getScene().stage]);
      debounce = setTimeoutFn(() => { debounce = null; start(); }, 0);
      return () => { if (off) off(); off = null; if (debounce !== null) clearTimeoutFn(debounce); debounce = null; cancel(); };
    },
    recomputeNow() {
      if (debounce !== null) { clearTimeoutFn(debounce); debounce = null; }
      start();
    },
    /** True while a scene change is waiting out the debounce or a pass is running. */
    isBusy: () => debounce !== null || job !== null,
  };
}

export const coverage = createCoverageTracker();
