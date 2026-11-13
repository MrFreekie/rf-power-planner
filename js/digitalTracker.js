// Digital-link tracker (QAM, adaptive modulation, FEC cliff, concealment) for links whose modulation.type is 'digital'.
//   digital.get(linkId) -> { cnrDb, order, esN0Db, ebN0Db, preFecBer, postFecBer, evmPercent, merDb, frameErrorRate,
//                            throughputKbps, state: 'ok'|'degraded'|'concealing'|'down', muted, amcSwitched, preset, cfg } | null
//        (null for analog-fm links)
//   digital.subscribe(cb)    cb(states) when a link's state changed
//   digitalConfig(link)      merged parameters: preset, then link.modulation.digital.overrides; fixedOrder from the link
//                            when set, otherwise from the preset
// install(squelch) makes the squelch gate close with reason 'digital' while the link is down or muted.
import { digitalLinkState } from './model/digital.js';
import { DIGITAL_PRESETS, DIGITAL_DEFAULTS } from './model/digital-params.js';

const KEYS = ['cnrDb', 'order', 'state', 'muted', 'preFecBer', 'postFecBer', 'evmPercent', 'merDb', 'frameErrorRate', 'throughputKbps',
  'esN0Db', 'ebN0Db', 'amcSwitched', 'preset'];

export function digitalConfig(link) {
  const d = (link && link.modulation && link.modulation.digital) || {};
  const base = DIGITAL_PRESETS[d.preset] || DIGITAL_DEFAULTS;
  const cfg = { ...base, ...(d.overrides || {}) };
  cfg.fixedOrder = d.fixedOrder || base.fixedOrder || null;
  return cfg;
}

export const isDigital = (link) => !!(link && link.modulation && link.modulation.type === 'digital');

export function createDigitalTracker({ now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()), setIntervalFn, clearIntervalFn } = {}) {
  const states = new Map();
  const subs = new Set();
  let pending = false;
  let timer = null;

  const same = (a, b) => (a === b) || (!!a && !!b && KEYS.every((k) => Object.is(a[k], b[k])));

  /** compute(link, levelDbm) -> digital state or null (analog links). Stateful (AMC hysteresis, concealment time). */
  const compute = (link, levelDbm) => {
    if (!isDigital(link)) { if (states.delete(link.id)) pending = true; return null; }
    const prev = states.get(link.id) || null;
    const cfg = digitalConfig(link);
    const next = { ...digitalLinkState(levelDbm, cfg, prev, now()), preset: link.modulation.digital.preset, cfg };
    if (same(prev, next)) { states.set(link.id, { ...prev, badMs: next.badMs, lastMs: next.lastMs }); return prev; }
    states.set(link.id, next);
    pending = true;
    return next;
  };

  const api = {
    compute,
    config: digitalConfig,
    get: (linkId) => states.get(linkId) || null,
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb); },
    flush() {
      if (!pending) return;
      pending = false;
      for (const cb of [...subs]) cb(states);
    },
    /** While any link is concealing, concealment time advances without scene changes: refresh on a timer. */
    install(squelchTracker, { start = true } = {}) {
      squelchTracker.setDigitalProvider(compute);
      const off = squelchTracker.subscribe(() => api.flush());
      const si = setIntervalFn || globalThis.setInterval;
      if (start && typeof si === 'function') {
        timer = si(() => {
          if ([...states.values()].some((s) => s.state === 'concealing')) squelchTracker.refresh();
        }, 100);
      }
      return () => {
        squelchTracker.setDigitalProvider(null);
        off();
        if (timer !== null) (clearIntervalFn || globalThis.clearInterval)(timer);
        timer = null;
      };
    },
  };
  return api;
}

export const digital = createDigitalTracker();
