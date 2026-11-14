// Tone and MPX sliders shared by the spectra bar and the enlarged dialog: tone level (percent of peak deviation), pilot injection (percent) and
// the overload level of the limiter stage (dB re nominal). The tone frequency itself is scene.audioToneHz. UI state, not part of the scene file.
import { TONE_MPX_DEFAULTS, TONE_MPX_LIMITS } from '../model/tone-mpx.js';

export const TONE_FIELDS = Object.freeze([
  { key: 'tonePct', label: 'Tone level', unit: '% of deviation', step: 1 },
  { key: 'pilotPct', label: 'Pilot injection', unit: '%', step: 0.5 },
  { key: 'overloadDb', label: 'Overload', unit: 'dB', step: 1 },
]);

export function createToneState() {
  const v = { tonePct: TONE_MPX_DEFAULTS.tonePct, pilotPct: TONE_MPX_DEFAULTS.pilotPct, overloadDb: TONE_MPX_DEFAULTS.overloadDb };
  const subs = new Set();
  const api = {
    get: () => ({ ...v }),
    set(patch) {
      let changed = false;
      for (const k of Object.keys(v)) {
        if (patch[k] === undefined || !Number.isFinite(+patch[k])) continue;
        const [lo, hi] = TONE_MPX_LIMITS[k], n = Math.min(hi, Math.max(lo, +patch[k]));
        if (n !== v[k]) { v[k] = n; changed = true; }
      }
      if (changed) for (const cb of [...subs]) cb(api.get());
      return changed;
    },
    reset() { return api.set({ tonePct: TONE_MPX_DEFAULTS.tonePct, pilotPct: TONE_MPX_DEFAULTS.pilotPct, overloadDb: TONE_MPX_DEFAULTS.overloadDb }); },
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb); },
  };
  return api;
}
export const tone = createToneState();
