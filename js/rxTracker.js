// Shared receiver-state tracker: front-end overload and antenna diversity.
//   rxState.get(linkId) -> { overload: { level, headroomDb, compressionDb, distortionPct, agcAttenDb, desenseDb, inputDbm },
//                            cascade: { systemNfDb, noiseFloorDbm, sensitivityAtAntennaDbm, marginAtAntennaDb, requiredSnrDb } | null,
//                            diversity: { mode, active, switched, switchCount, combinedDbm, aDbm, bDbm, gainDb } | null } | null
//   rxState.subscribe(cb)   cb(states) when any link's state changed
//   rxConfig(link)          merged overload parameters (receiver preset + the link's overrides)
// app.js calls rxState.install(squelch): the squelch tracker then uses solve() below, so the squelch gate, meters
// and history all see the diversity-combined level, and overload is judged on the strongest antenna.
import { solveLink } from './model/rf.js';
import { solveDiversity, diversityStep } from './model/diversity.js';
import { overloadStep } from './model/overload.js';
import { RX_PRESETS } from './model/rx-params.js';

const OV_KEYS = ['level', 'headroomDb', 'compressionDb', 'distortionPct', 'agcAttenDb', 'desenseDb', 'inputDbm'];
const CS_KEYS = ['systemNfDb', 'noiseFloorDbm', 'sensitivityAtAntennaDbm', 'marginAtAntennaDb', 'requiredSnrDb'];
const DV_KEYS = ['mode', 'active', 'switched', 'switchCount', 'combinedDbm', 'aDbm', 'bDbm', 'gainDb'];

/** Overload parameters: the link's receiver preset overlaid with link.rx.overload (maxInputDbm, p1dBDbm). */
export function rxConfig(link) {
  const rx = (link && link.rx) || {};
  const preset = RX_PRESETS[rx.rxPreset] || RX_PRESETS['iem-bodypack-typical'];
  return { ...preset, ...(rx.overload || {}) };
}

const sameObj = (a, b, keys) => (a === b) || (!!a && !!b && keys.every((k) => Object.is(a[k], b[k])));

export function createRxTracker({ now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) } = {}) {
  const states = new Map();
  const memo = new Map(); // linkId -> { ov, div, switchCount }
  const subs = new Set();
  let pending = false;

  /** solve(scene, link) -> { levelDbm, rxPowerDbm, rx }; the squelch tracker's solver hook. */
  function solve(scene, link) {
    const m = memo.get(link.id) || { ov: null, div: null, switchCount: 0 };
    memo.set(link.id, m);
    const dv = link.rx && link.rx.diversity;
    let levelDbm, rxPowerDbm, ovInput, div = null, casc = null;
    if (dv && dv.enabled) {
      const { a, b } = solveDiversity(scene, link);
      casc = a.cascade || null;
      const A = a.inputPowerDbm, B = b.inputPowerDbm;
      const step = diversityStep(m.div, A, B, { mode: dv.mode, hysteresisDb: dv.hysteresisDb, switchMs: dv.switchMs }, now());
      m.div = step;
      if (step.switched) m.switchCount++;
      levelDbm = step.combinedDbm;
      rxPowerDbm = step.active === 'B' ? b.rxPowerDbm : a.rxPowerDbm;
      ovInput = Math.max(A, B);
      div = { mode: dv.mode, active: step.active, switched: step.switched, switchCount: m.switchCount,
        combinedDbm: step.combinedDbm, aDbm: A, bDbm: B, gainDb: step.gainDb };
    } else {
      const r = solveLink(scene, link);
      casc = r.cascade || null;
      levelDbm = r.inputPowerDbm; rxPowerDbm = r.rxPowerDbm; ovInput = levelDbm;
      m.div = null;
    }
    const ov = { ...overloadStep(m.ov, ovInput, rxConfig(link)), inputDbm: ovInput };
    m.ov = ov;
    const prev = states.get(link.id) || null;
    const cascade = casc ? Object.fromEntries(CS_KEYS.map((k) => [k, casc[k]])) : null;
    let next = { overload: ov, diversity: div, cascade };
    if (prev && sameObj(prev.overload, ov, OV_KEYS) && sameObj(prev.diversity, div, DV_KEYS) && sameObj(prev.cascade, cascade, CS_KEYS)) next = prev;
    else { states.set(link.id, next); pending = true; }
    return { levelDbm, rxPowerDbm, rx: next };
  }

  return {
    solve,
    config: rxConfig,
    get: (linkId) => states.get(linkId) || null,
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb); },
    flush() {
      if (!pending) return;
      pending = false;
      for (const cb of [...subs]) cb(states);
    },
    install(squelchTracker) {
      squelchTracker.setSolver(solve);
      const off = squelchTracker.subscribe(() => this.flush());
      return () => { squelchTracker.setSolver(null); off(); };
    },
  };
}

export const rxState = createRxTracker();
