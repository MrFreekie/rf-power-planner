// Shared MPX (FM stereo multiplex) tracker for the GUI.
//   mpx.get(linkId)       -> { enabled, preset, cnrDb, blend, mode, separationDb, pilotLocked, pilotLevelDb,
//                              audioSnrDb, lrLeak, levelDbm, cfg } | null  (null when the link has MPX switched off or is unknown)
//   mpx.subscribe(cb)     cb(states) when any link's MPX state changed; returns unsubscribe
//   mpx.config(link)      the merged parameter set for a link (defaults + preset + overrides, with unit adapters)
// app.js wires it in with squelch.setMpxProvider(mpx.compute); the squelch tracker calls compute() with each
// link's receiver input level, so MPX and the pilot-squelch gate always agree.
import { mpxState } from './model/mpx.js';
import { MPX_DEFAULTS, MPX_PRESETS, MPX_STRUCTURE } from './model/mpx-params.js';

const KEYS = ['cnrDb', 'blend', 'mode', 'pilotLocked', 'pilotLevelDb', 'separationDb', 'audioSnrDb', 'lrLeak', 'levelDbm', 'preset'];

/** Parameter set for mpxState: library defaults, the link's preset, then its overrides; plus adapters for naming differences. */
export function mpxConfig(link, presets = MPX_PRESETS, defaults = MPX_DEFAULTS) {
  const m = (link && link.mpx) || {};
  const base = (presets && presets[m.preset]) || defaults || {};
  const c = { ...defaults, ...base, ...(m.overrides || {}) };
  if (c.bandwidthHz === undefined && Number.isFinite(c.channelBwKhz)) c.bandwidthHz = c.channelBwKhz * 1000;
  if (c.pilotHysteresisDb === undefined && Number.isFinite(c.pilotDetectCnrDb) && Number.isFinite(c.pilotLoseCnrDb)) {
    c.pilotHysteresisDb = Math.max(0, c.pilotDetectCnrDb - c.pilotLoseCnrDb);
  }
  if (c.pilotInjection === undefined) c.pilotInjection = (MPX_STRUCTURE && MPX_STRUCTURE.pilotInjectionFrac) || 0.09;
  return c;
}

export function createMpxTracker({ stateFn = mpxState, configFn = mpxConfig } = {}) {
  const states = new Map();
  const subs = new Set();
  let pending = false;

  const same = (a, b) => (a === b) || (!!a && !!b && KEYS.every((k) => Object.is(a[k], b[k])));

  /** compute(link, levelDbm) -> mpx state or null. Stateful (pilot hysteresis); use as the squelch tracker's provider. */
  const compute = (link, levelDbm) => {
    const prev = states.get(link.id) || null;
    let next = null;
    // MPX/pilot features belong to analog-FM links only; digital links simply have none.
    if (link.mpx && link.mpx.enabled && !(link.modulation && link.modulation.type === 'digital')) {
      const cfg = configFn(link);
      next = { ...stateFn(levelDbm, cfg, prev), enabled: true, preset: link.mpx.preset, levelDbm, cfg };
    }
    if (!same(prev, next)) {
      if (next) states.set(link.id, next); else states.delete(link.id);
      pending = true;
    } else if (next) states.set(link.id, prev);
    return next;
  };

  return {
    compute,
    config: configFn,
    get: (linkId) => states.get(linkId) || null,
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb); },
    /** Called by the squelch tracker's owner after a recompute; fires subscribers once if anything changed. */
    flush() {
      if (!pending) return;
      pending = false;
      for (const cb of [...subs]) cb(states);
    },
    /** Hook this tracker into a squelch tracker. Returns a function that undoes it. */
    install(squelchTracker) {
      squelchTracker.setMpxProvider(compute);
      const off = squelchTracker.subscribe(() => this.flush());
      return () => { squelchTracker.setMpxProvider(null); off(); };
    },
  };
}

export const mpx = createMpxTracker();
