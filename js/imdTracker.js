// Intermodulation tracker: spectrum, products, noise-floor rise, coordination check and a distance sweep for scene.imd.
//   imd.get() -> { enabled, spectrum, noise, products, coordination, sweep, computing } | null
//        noise = noiseFloor() headline plus perChannel; products = front-end + transmitter-reverse + PIM products
//        sweep = sweepDistance() for the transmitter nearest the receive antenna (receive antenna moved from 0.3 m out to 10 m)
//   imd.subscribe(cb)        cb(state) after each recomputation (and when the demo is switched off)
//   imd.install(store, squelch)   recompute after scene changes (debounced about 100 ms); the squelch tracker also gets the
//                                 noise rise at the wanted link's channel as extra desense (gate reason 'imd')
//   imd.desenseFor(link, scene)   that rise in dB (0 when the demo is off or the link's frequency is not one of the channels)
// The whole computation is a few dozen products, cheap enough to run while dragging.
import { frontEndImd, txReverseImd, pimImd, noiseFloor, coordinationCheck, spectrum, sweepDistance } from './model/imd.js';

export const DEBOUNCE_MS = 100;

function nearestTx(scene) {
  const m = scene.imd;
  const r = m.rxAntennaPos || { x: 0, y: 0, z: 1.5 };
  let best = null, bd = Infinity;
  for (const t of m.transmitters) {
    const d = Math.hypot(t.pos.x - r.x, t.pos.y - r.y, (t.pos.z || 0) - (r.z || 0));
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

/** Full analysis of scene.imd, or null when the demo is off or has no transmitters. */
export function analyse(scene) {
  const m = scene && scene.imd;
  if (!m || !m.enabled || !Array.isArray(m.transmitters) || !m.transmitters.length) return null;
  const products = [...frontEndImd(scene), ...txReverseImd(scene), ...pimImd(scene)];
  const noise = noiseFloor(scene);
  const coordination = coordinationCheck(scene);
  const spec = spectrum(scene);
  const near = nearestTx(scene);
  const sweep = near && m.transmitters.length > 1 ? sweepDistance(scene, { txId: near.id, from: 0.3, to: 10, n: 12 }) : null;
  return { enabled: true, spectrum: spec, noise, products, coordination, sweep };
}

export function createImdTracker({
  debounceMs = DEBOUNCE_MS,
  setTimeoutFn = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeoutFn = (h) => globalThis.clearTimeout(h),
} = {}) {
  let state = null;
  const subs = new Set();
  let store = null, off = null, timer = null, lastSig = null;
  let memoKey = null, memoNoise = null;

  const sigOf = (scene) => JSON.stringify([scene.imd, scene.links[0] && scene.links[0].rx && scene.links[0].rx.antenna]);
  const emit = () => { for (const cb of [...subs]) cb(state); };

  function compute() {
    timer = null;
    if (!store) return;
    const scene = store.getScene();
    try {
      const a = analyse(scene);
      state = a ? { ...a, computing: false } : null;
    } catch {
      state = null;
    }
    emit();
  }

  /** Noise rise (dB) at the channel of the link's frequency; memoised on the imd settings so drags stay cheap. */
  function desenseFor(link, scene) {
    const m = scene.imd;
    if (!m || !m.enabled || !Array.isArray(m.transmitters) || !m.transmitters.length) return 0;
    const key = sigOf(scene);
    if (key !== memoKey) {
      memoKey = key;
      try { memoNoise = noiseFloor(scene); } catch { memoNoise = null; }
    }
    if (!memoNoise) return 0;
    const f = Number.isFinite(m.wantedFreqMHz) ? m.wantedFreqMHz : link.freqMHz;
    const half = (m.channelBwKHz || 200) / 2000;
    const c = memoNoise.perChannel.find((x) => Math.abs(x.freqMHz - f) <= half);
    return c ? Math.max(0, c.riseDb) : 0;
  }

  return {
    get: () => state,
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb); },
    desenseFor,
    recomputeNow() { if (timer !== null) { clearTimeoutFn(timer); timer = null; } compute(); },
    install(theStore, squelch) {
      if (off) off();
      store = theStore;
      if (squelch) squelch.setDesenseProvider(desenseFor);
      off = store.subscribe((scene, info) => {
        if (info.type === 'selection') return;
        const sig = sigOf(scene);
        if (sig === lastSig) return;
        lastSig = sig;
        if (state) state = { ...state, computing: true };
        if (timer !== null) clearTimeoutFn(timer);
        timer = setTimeoutFn(compute, debounceMs);
      });
      lastSig = sigOf(store.getScene());
      timer = setTimeoutFn(compute, 0);
      return () => {
        if (off) off();
        off = null;
        if (timer !== null) clearTimeoutFn(timer);
        timer = null;
        if (squelch) squelch.setDesenseProvider(null);
      };
    },
  };
}

export const imd = createImdTracker();
