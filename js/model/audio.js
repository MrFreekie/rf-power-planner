// Virtual audio source for the meters. Deterministic (a function of time and seed only) and pure. Levels are dBFS.

export const AUDIO_FLOOR_DB = -90;
export const AUDIO_KINDS = ['speech', 'tone', 'pink', 'stereo-demo', 'off'];

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const TAU = 2 * Math.PI;

// Deterministic hash noise in [0, 1).
function hash01(x) {
  const s = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * createAudioSource({ kind: 'speech'|'tone'|'pink'|'off', seed = 0 }) -> { kind, level(tSeconds) -> { rmsDb, peakDb } }
 *  speech: syllabic bursts (about 3-5 Hz) in phrases with pauses; RMS around -22 dBFS while talking, peaks near -6.
 *  tone:   steady -18 dBFS RMS, peak 3 dB above (sine crest).
 *  pink:   steady-ish noise at -24 dBFS RMS with a few dB of wobble, peaks about 12 dB above.
 *  off:    AUDIO_FLOOR_DB.
 * Unknown kinds behave as 'off'.
 */
export function createAudioSource({ kind = 'speech', seed = 0 } = {}) {
  let level;
  switch (kind) {
    case 'tone':
      level = () => ({ rmsDb: -18, peakDb: -18 + 3.01 });
      break;
    case 'pink':
      level = (t) => {
        const rmsDb = -24 + 1.5 * Math.sin(TAU * 0.9 * t + seed) + (hash01(Math.floor(t * 30) + seed) - 0.5) * 2;
        return { rmsDb, peakDb: Math.min(0, rmsDb + 12) };
      };
      break;
    case 'speech':
    case 'stereo-demo': // as a mono source it is speech; use createStereoSource for the decorrelated pair
      level = (t) => {
        const ts = t + seed * 7.3;
        const syll = Math.max(0, 0.6 * Math.sin(TAU * 3.1 * ts) + 0.4 * Math.sin(TAU * 4.7 * ts + 1));
        const phrase = clamp(0.5 + 0.9 * Math.sin(TAU * 0.4 * ts + seed), 0, 1);
        const g = syll * phrase; // 0..~1
        const jitter = (hash01(Math.floor(ts * 50) + seed) - 0.5) * 3;
        const rmsDb = clamp(-46 + 24 * Math.pow(g, 0.25) + jitter, -60, -10);
        const crest = 10 + 8 * hash01(Math.floor(ts * 25) + seed);
        return { rmsDb, peakDb: Math.min(-6, rmsDb + crest) };
      };
      break;
    default:
      kind = 'off';
      level = () => ({ rmsDb: AUDIO_FLOOR_DB, peakDb: AUDIO_FLOOR_DB });
  }
  return { kind, level };
}

/**
 * createStereoSource({ kind, seed }) -> { kind, l(t), r(t) }, each returning { rmsDb, peakDb }.
 *  speech / pink: left-leaning and right-leaning versions (+1.5 dB / -3 dB, then swapped), decorrelated by a seed offset.
 *  tone: L -18 dBFS, R -24 dBFS.
 *  stereo-demo: strongly decorrelated speech, L and R take turns (about 0.25 Hz) so channel separation is audible on meters.
 *  off: floor on both.
 */
export function createStereoSource({ kind = 'speech', seed = 0 } = {}) {
  const sh = (v, db) => (v <= AUDIO_FLOOR_DB ? v : Math.min(0, v + db));
  const shift = (lv, db) => ({ rmsDb: sh(lv.rmsDb, db), peakDb: sh(lv.peakDb, db) });
  if (kind === 'tone') {
    return { kind, l: () => ({ rmsDb: -18, peakDb: -15 }), r: () => ({ rmsDb: -24, peakDb: -21 }) };
  }
  if (kind === 'stereo-demo') {
    const a = createAudioSource({ kind: 'speech', seed });
    const b = createAudioSource({ kind: 'speech', seed: seed + 5 });
    const pan = (t) => 0.5 + 0.5 * Math.sin(TAU * 0.25 * t);
    const w = (p) => 20 * Math.log10(Math.max(p, 0.05)); // dB gain for pan weight p (floored at -26 dB)
    return {
      kind,
      l: (t) => shift(a.level(t), Math.min(0, w(1 - pan(t) + 0.5))),
      r: (t) => shift(b.level(t + 1.3), Math.min(0, w(pan(t) + 0.5))),
    };
  }
  const a = createAudioSource({ kind, seed });
  const b = createAudioSource({ kind, seed: seed + 3 });
  return { kind: a.kind, l: (t) => shift(a.level(t), 1.5), r: (t) => shift(b.level(t + 0.37), -3) };
}

/** gate(level, open) -> level while open, otherwise the floor for both rms and peak. */
export function gate(level, open) {
  return open ? { rmsDb: level.rmsDb, peakDb: level.peakDb } : { rmsDb: AUDIO_FLOOR_DB, peakDb: AUDIO_FLOOR_DB };
}

/** Apply a gain in dB (the floor stays the floor; levels cap at 0 dBFS). */
export function withGain(level, gainDb) {
  const g = (v) => (v <= AUDIO_FLOOR_DB ? v : Math.min(0, v + gainDb));
  return { rmsDb: g(level.rmsDb), peakDb: g(level.peakDb) };
}
