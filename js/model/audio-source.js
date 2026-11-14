// One global audio simulation source (item 31). Pure, deterministic, no DOM.
// Every audio consumer reads this catalogue so that one choice (scene.audioSource) drives the audio spectrum, the baseband / MPX programme,
// the timeline meters, overload clipping statistics and the modulation lab message:
//   audio.js (level generators, stereo pair), spectrum-views.js (audioSpectrum, monoBasebandSpectrum, clipFractionFromOverdrive,
//   distortionFromLink), mpx.js (mpxSpectrum programme option) and modulation-demo.js (message tones).
// All spectrum shapes, levels and crest factors are ILLUSTRATIVE planning shapes (flag U), not measurements of any real programme.
// The defaults reproduce the pre-catalogue behaviour exactly: a mic link defaults to 'voice', an IEM link to 'music'.

export const AUDIO_SOURCE_IDS = Object.freeze(['voice', 'singing', 'music', 'bass-heavy', 'acoustic', 'drums', 'pink', 'white', 'tone', 'two-tone', 'sweep', 'silence']);
export const DEFAULT_TONE_HZ = 1000;
export const TONE_HZ_LIMITS = Object.freeze([20, 20000]);
export const SWEEP_PERIOD_S = 20;
export const SWEEP_RANGE_HZ = Object.freeze([20, 20000]);
export const SOURCE_FLOOR_DB = -90;
export const GAUSSIAN_3SIGMA_CREST_DB = 20 * Math.log10(3); // the pre-catalogue assumption: a 3-sigma peak

const TWO_PI = 2 * Math.PI;
const gauss = (x, c, s) => Math.exp(-0.5 * ((x - c) / s) ** 2);
const octaves = (f, f0) => Math.log2(Math.max(f, 1e-9) / f0);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
function hash01(x) { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

// ---- spectrum shapes: dB below full scale at f (Hz), time t (s), channel ch (0 = L, 1 = R) --------------------------------

// Voice: -6 dB/octave above ~250 Hz, formants, sibilance, high-pass below 90 Hz, breathing (the original voiceDb of spectrum-views.js).
function voiceDb(f, t) {
  const f0 = 130 + 18 * Math.sin(0.9 * t) + 6 * Math.sin(2.3 * t + 1); // slow pitch movement
  const shift = 1 + 0.08 * Math.sin(0.7 * t + 0.5); // formants drift a little
  let d = -26 - 6 * Math.max(0, octaves(f, 250));
  if (f < 90) d -= 24 * octaves(90, Math.max(f, 1));
  d += 7 * gauss(Math.log2(f), Math.log2(500 * shift), 0.28);
  d += 5 * gauss(Math.log2(f), Math.log2(1500 * shift), 0.28);
  d += 4 * gauss(Math.log2(f), Math.log2(2500 * shift), 0.28);
  d += 8 * gauss(Math.log2(f), Math.log2(6000), 0.32) * (0.5 + 0.5 * Math.max(0, Math.sin(1.7 * t)));
  if (f > 8000) d -= 24 * octaves(f, 8000);
  if (f < 4000) d += 3 * Math.cos(TWO_PI * f / f0) * Math.min(1, 800 / Math.max(f, 1));
  d += 3 * Math.sin(0.6 * t + 1.3);
  return d;
}

// Music for one channel: pink-like tilt, strong bass, roll-off near 17 kHz, channel-specific instruments (the original musicDb).
function musicDb(f, t, ch) {
  let d = -24 - 3 * Math.max(0, octaves(f, 100));
  d += 9 * gauss(Math.log2(f), Math.log2(70), 0.45) * (0.8 + 0.2 * Math.sin(TWO_PI * 0.45 * t + ch));
  if (f < 35) d -= 24 * octaves(35, Math.max(f, 1));
  if (ch === 0) d += 8 * gauss(Math.log2(f), Math.log2(110), 0.4) + 7 * gauss(Math.log2(f), Math.log2(800), 0.5) - 1.5 * octaves(f, 1000);
  else {
    d += 8 * gauss(Math.log2(f), Math.log2(2500), 0.5) + 10 * gauss(Math.log2(f), Math.log2(9000), 0.45) * (0.6 + 0.4 * Math.sin(TWO_PI * 0.7 * t));
    d -= 6 * gauss(Math.log2(f), Math.log2(110), 0.4) + 1.5 * octaves(f, 1000);
  }
  if (f > 16000) d -= 48 * octaves(f, 16000);
  d += 2 * Math.sin(TWO_PI * 0.2 * t + 2 * ch);
  return d;
}

/** Log sweep frequency in Hz at time t: SWEEP_RANGE_HZ over SWEEP_PERIOD_S seconds, repeating. */
export function sweepHz(t) {
  const [a, b] = SWEEP_RANGE_HZ, x = (((t % SWEEP_PERIOD_S) + SWEEP_PERIOD_S) % SWEEP_PERIOD_S) / SWEEP_PERIOD_S;
  return a * Math.pow(b / a, x);
}

/** Frequencies in Hz of the discrete lines of a line source at time t ([] for continuous sources). */
export function sourceLinesHz(id, t = 0, toneHz = DEFAULT_TONE_HZ) {
  const f = clamp(Number.isFinite(toneHz) ? toneHz : DEFAULT_TONE_HZ, TONE_HZ_LIMITS[0], TONE_HZ_LIMITS[1]);
  if (id === 'tone') return [f];
  if (id === 'sweep') return [sweepHz(t)];
  if (id === 'two-tone') return [f, 1.5 * f];
  return [];
}

// A line: top-hat one bin wide at LINE_DB, with a skirt falling to the floor over about three bins.
const LINE_DB = -18;
function lineDb(f, lines, binHz) {
  const half = binHz / 2;
  let best = SOURCE_FLOOR_DB;
  for (const fl of lines) {
    const d = Math.abs(f - fl);
    best = Math.max(best, d <= half ? LINE_DB : SOURCE_FLOOR_DB + (LINE_DB - SOURCE_FLOOR_DB) * gauss(d - half, 0, binHz));
  }
  return best;
}

const SHAPES = {
  voice: (f, t) => voiceDb(f, t),
  // singing: sustained, stronger low-mid vowels, a "singer's formant" near 3 kHz, vibrato in the harmonic comb, little sibilance
  singing: (f, t) => voiceDb(f, t) + 4 * gauss(Math.log2(f), Math.log2(450), 0.5) + 6 * gauss(Math.log2(f), Math.log2(3000), 0.25) - 3 * gauss(Math.log2(f), Math.log2(6000), 0.32) + 2,
  music: (f, t, ch) => musicDb(f, t, ch),
  // bass-heavy: music with a large bass and sub region and a duller top
  'bass-heavy': (f, t, ch) => musicDb(f, t, ch) + 10 * gauss(Math.log2(f), Math.log2(55), 0.5) + 4 * gauss(Math.log2(f), Math.log2(110), 0.5) - 3 * Math.max(0, octaves(f, 2000)) + 2,
  // acoustic: less bass, guitar body around 100-200 Hz, picking and string detail near 2.5-5 kHz, gentle fall
  acoustic: (f, t, ch) => {
    let d = -26 - 3.5 * Math.max(0, octaves(f, 200)) + 6 * gauss(Math.log2(f), Math.log2(150), 0.4) + 5 * gauss(Math.log2(f), Math.log2(2800), 0.5) + 2 * Math.sin(TWO_PI * 0.15 * t + ch);
    if (f < 60) d -= 24 * octaves(60, Math.max(f, 1));
    if (f > 16000) d -= 48 * octaves(f, 16000);
    return d;
  },
  // drums: kick (60 Hz), snare body (200 Hz) and crack (4 kHz), cymbals (8-12 kHz), pulsing at about 2 beats per second
  drums: (f, t, ch) => {
    const beat = 0.55 + 0.45 * Math.max(0, Math.sin(TWO_PI * 2 * t + ch)) ** 2;
    let d = -26 - 2 * Math.max(0, octaves(f, 400));
    d += 14 * gauss(Math.log2(f), Math.log2(60), 0.4) * beat + 8 * gauss(Math.log2(f), Math.log2(200), 0.4) + 6 * gauss(Math.log2(f), Math.log2(4000), 0.6) * (1.2 - beat) + 8 * gauss(Math.log2(f), Math.log2(10000), 0.35);
    if (f < 35) d -= 24 * octaves(35, Math.max(f, 1));
    if (f > 16000) d -= 48 * octaves(f, 16000);
    return d;
  },
  pink: (f) => -20 - 3 * octaves(Math.max(f, 20), 20) - (f > 20000 ? 48 * octaves(f, 20000) : 0), // -3 dB per octave
  white: (f) => -40 - (f > 20000 ? 48 * octaves(f, 20000) : 0), // flat per Hz
  tone: (f, t, ch, o) => lineDb(f, sourceLinesHz('tone', t, o.toneHz), o.binHz),
  'two-tone': (f, t, ch, o) => lineDb(f, sourceLinesHz('two-tone', t, o.toneHz), o.binHz) - (lineDb(f, sourceLinesHz('two-tone', t, o.toneHz), o.binHz) > SOURCE_FLOOR_DB + 60 ? 6 : 0),
  sweep: (f, t, ch, o) => lineDb(f, sourceLinesHz('sweep', t, o.toneHz), o.binHz),
  silence: () => SOURCE_FLOOR_DB,
};

/**
 * sourceSpectrumDb(id, f, t = 0, ch = 0, { toneHz, binHz }) -> dB relative to full scale at f Hz. binHz (the spectrum bin width, default
 * 50 Hz) sets the width of the line of a tone, two-tone or sweep source. Unknown ids behave as the voice.
 */
export function sourceSpectrumDb(id, f, t = 0, ch = 0, { toneHz = DEFAULT_TONE_HZ, binHz = 50 } = {}) {
  const fn = SHAPES[id] || SHAPES.voice;
  return fn(Math.max(f, 1e-3), t, ch, { toneHz, binHz: Math.max(binHz, 1e-3) });
}

// ---- level statistics and clip model --------------------------------------------------------------------------------------

// rmsDb/peakDb: dBFS while the source is active; crestDb = peakDb - rmsDb; duty = fraction of time active (phrasing); clip: statistics for overdrive.
const STATS = {
  voice: { rmsDb: -22, peakDb: -6, duty: 0.6, phraseHz: 0.4, clip: 'gaussian' },
  singing: { rmsDb: -20, peakDb: -5, duty: 0.85, phraseHz: 0.25, clip: 'gaussian' },
  music: { rmsDb: -18, peakDb: -4, duty: 1, phraseHz: 0, clip: 'gaussian' },
  'bass-heavy': { rmsDb: -16, peakDb: -4, duty: 1, phraseHz: 0, clip: 'gaussian' },
  acoustic: { rmsDb: -22, peakDb: -6, duty: 0.9, phraseHz: 0.2, clip: 'gaussian' },
  drums: { rmsDb: -20, peakDb: -1, duty: 1, phraseHz: 2, clip: 'gaussian' },
  pink: { rmsDb: -24, peakDb: -12, duty: 1, phraseHz: 0, clip: 'gaussian' },
  white: { rmsDb: -24, peakDb: -12, duty: 1, phraseHz: 0, clip: 'gaussian' },
  tone: { rmsDb: -18, peakDb: -18 + 20 * Math.log10(Math.SQRT2), duty: 1, phraseHz: 0, clip: 'sine' },
  'two-tone': { rmsDb: -18, peakDb: -18 + 20 * Math.log10(2), duty: 1, phraseHz: 0, clip: 'two-tone' },
  sweep: { rmsDb: -18, peakDb: -18 + 20 * Math.log10(Math.SQRT2), duty: 1, phraseHz: 0.05, clip: 'sine' },
  silence: { rmsDb: SOURCE_FLOOR_DB, peakDb: SOURCE_FLOOR_DB, duty: 0, phraseHz: 0, clip: 'none' },
};

const LABELS = {
  voice: ['Voice (speech)', 'Speech with phrases and pauses; energy mostly 100 Hz to 4 kHz, about 16 dB crest factor.'],
  singing: ['Singing', 'Sustained vowels with a singer\'s formant near 3 kHz and little sibilance; about 15 dB crest factor.'],
  music: ['Music (full mix)', 'Full-band mix with strong bass, pink-like tilt and a roll-off near 17 kHz; about 14 dB crest factor.'],
  'bass-heavy': ['Bass-heavy music', 'Mix with extra sub-bass and kick energy and a duller top; about 12 dB crest factor, a lot of low-frequency energy.'],
  acoustic: ['Acoustic instruments', 'Guitar-like body near 150 Hz and string detail near 3 kHz; about 16 dB crest factor.'],
  drums: ['Drums', 'Kick, snare and cymbals pulsing at about 2 beats per second; a very high crest factor (about 19 dB).'],
  pink: ['Pink noise', 'Equal energy per octave (-3 dB per octave); Gaussian, about 12 dB crest factor.'],
  white: ['White noise', 'Equal energy per Hz; Gaussian, about 12 dB crest factor.'],
  tone: ['Tone', 'One steady sine tone (frequency adjustable, default 1 kHz); crest factor 3.01 dB.'],
  'two-tone': ['Two tones', 'A tone at f and a second at 1.5 f, equal level; crest factor 6.02 dB.'],
  sweep: ['Sweep', 'A sine tone sweeping 20 Hz to 20 kHz logarithmically every 20 s; crest factor 3.01 dB.'],
  silence: ['Silence', 'No programme: shows the noise and the control tones alone.'],
};

const entry = (id) => {
  const s = STATS[id];
  return Object.freeze({
    id, label: LABELS[id][0], note: LABELS[id][1],
    rmsDb: s.rmsDb, peakDb: s.peakDb, crestDb: s.peakDb - s.rmsDb,
    phrasing: Object.freeze({ duty: s.duty, phraseHz: s.phraseHz }),
    clipModel: s.clip, lines: ['tone', 'sweep', 'two-tone'].includes(id), musicLike: ['music', 'bass-heavy', 'acoustic', 'drums', 'pink', 'white'].includes(id),
    stereoNote: id === 'music' || id === 'bass-heavy' || id === 'drums' || id === 'acoustic' ? 'L and R differ (different instruments left and right).' : id === 'tone' || id === 'two-tone' || id === 'sweep' ? 'L and R carry the same line at -18 and -24 dBFS.' : 'L and R are decorrelated copies (+1.5 dB / -3 dB).',
    flag: 'U',
  });
};
/** AUDIO_SOURCES: id -> { id, label, note, rmsDb, peakDb, crestDb, phrasing: { duty, phraseHz }, clipModel, lines, musicLike, stereoNote, flag: 'U' }. */
export const AUDIO_SOURCES = Object.freeze(Object.fromEntries(AUDIO_SOURCE_IDS.map((id) => [id, entry(id)])));
export const AUDIO_SOURCE_LABELS = Object.freeze(Object.fromEntries(AUDIO_SOURCE_IDS.map((id) => [id, AUDIO_SOURCES[id].label])));

// legacy meter names accepted wherever an id is
const ALIASES = { speech: 'voice', 'stereo-demo': 'voice', off: 'silence' };
export const isAudioSourceId = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(AUDIO_SOURCES, id);
/** normalizeAudioSource(id) -> catalogue id for an id or a legacy name ('speech', 'stereo-demo', 'off'); null if unknown. */
export function normalizeAudioSource(id) {
  if (isAudioSourceId(id)) return id;
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(ALIASES, id) ? ALIASES[id] : null;
}
/** The default source by link kind: mic -> voice, IEM -> music (what the spectra always showed), anything else -> voice. */
export const defaultAudioSource = (kind) => (kind === 'iem' ? 'music' : 'voice');
/** resolveAudioSource(scene, link) -> catalogue id: scene.audioSource when valid, else the default for link.kind (absent field = old behaviour). */
export function resolveAudioSource(scene, link) {
  const id = scene && normalizeAudioSource(scene.audioSource);
  return id || defaultAudioSource(link && link.kind);
}
/** resolveToneHz(scene) -> scene.audioToneHz clamped to 20..20000, default 1000. */
export function resolveToneHz(scene) {
  const f = scene && scene.audioToneHz;
  return Number.isFinite(f) ? clamp(f, TONE_HZ_LIMITS[0], TONE_HZ_LIMITS[1]) : DEFAULT_TONE_HZ;
}

// ---- level generators for the timeline / meters ---------------------------------------------------------------------------

/**
 * levelGenerator(id, seed = 0) -> t -> { rmsDb, peakDb } (dBFS, deterministic). 'voice' is the original speech generator (phrases of
 * syllabic bursts, RMS about -22 dBFS while talking, peaks near -6); 'tone' is -18 / -14.99; 'pink' the original pink wobble.
 */
export function levelGenerator(id, seed = 0) {
  const sid = normalizeAudioSource(id) || 'silence';
  const st = STATS[sid];
  const flat = (rms, peak) => () => ({ rmsDb: rms, peakDb: peak });
  switch (sid) {
    case 'tone': case 'sweep': return flat(st.rmsDb, st.peakDb);
    case 'two-tone': return flat(st.rmsDb, st.peakDb);
    case 'silence': return flat(SOURCE_FLOOR_DB, SOURCE_FLOOR_DB);
    case 'pink': case 'white': return (t) => {
      const rmsDb = st.rmsDb + 1.5 * Math.sin(TWO_PI * 0.9 * t + seed) + (hash01(Math.floor(t * 30) + seed) - 0.5) * 2;
      return { rmsDb, peakDb: Math.min(0, rmsDb + (st.peakDb - st.rmsDb)) };
    };
    case 'voice': return (t) => {
      const ts = t + seed * 7.3;
      const syll = Math.max(0, 0.6 * Math.sin(TWO_PI * 3.1 * ts) + 0.4 * Math.sin(TWO_PI * 4.7 * ts + 1));
      const phrase = clamp(0.5 + 0.9 * Math.sin(TWO_PI * 0.4 * ts + seed), 0, 1);
      const g = syll * phrase;
      const jitter = (hash01(Math.floor(ts * 50) + seed) - 0.5) * 3;
      const rmsDb = clamp(-46 + 24 * Math.pow(g, 0.25) + jitter, -60, -10);
      const crest = 10 + 8 * hash01(Math.floor(ts * 25) + seed);
      return { rmsDb, peakDb: Math.min(-6, rmsDb + crest) };
    };
    default: { // singing, music, bass-heavy, acoustic, drums: a slow level wobble around the stated RMS, crest from the catalogue with jitter
      const crest = st.peakDb - st.rmsDb;
      const depth = sid === 'singing' ? 4 : sid === 'drums' ? 7 : sid === 'acoustic' ? 5 : 2.5;
      const rate = st.phraseHz || 0.3;
      return (t) => {
        const ts = t + seed * 7.3;
        let beat = 0.5 + 0.5 * Math.sin(TWO_PI * rate * ts + seed);
        if (sid === 'drums') beat = Math.max(0, Math.sin(TWO_PI * 2 * ts)) ** 2;
        const rmsDb = clamp(st.rmsDb - depth + depth * 2 * beat * (sid === 'drums' ? 0.8 : 1) + (hash01(Math.floor(ts * 20) + seed) - 0.5) * 1.5, -60, -3);
        return { rmsDb, peakDb: Math.min(-1, rmsDb + crest + (hash01(Math.floor(ts * 10) + seed + 3) - 0.5) * 2) };
      };
    }
  }
}

// ---- modulation lab tones (frequencies in units of the base tone) ---------------------------------------------------------

export const MODULATION_TONES = Object.freeze({
  voice: [
    { a: 0.30, f: 0.45, ph: 0 }, { a: 0.30, f: 0.55, ph: 0.4 }, { a: 0.22, f: 1.0, ph: 1.3 }, { a: 0.22, f: 1.12, ph: 2.0 },
    { a: 0.16, f: 1.9, ph: 0.7 }, { a: 0.12, f: 2.3, ph: 2.6 }, { a: 0.08, f: 3.1, ph: 4.0 },
  ],
  singing: [{ a: 0.5, f: 1, ph: 0 }, { a: 0.3, f: 2, ph: 0.6 }, { a: 0.2, f: 3, ph: 1.4 }, { a: 0.12, f: 4, ph: 2.1 }, { a: 0.15, f: 1.5, ph: 0.3 }],
  music: [{ a: 0.40, f: 1, ph: 0 }, { a: 0.30, f: 1.25, ph: 0.8 }, { a: 0.30, f: 1.5, ph: 1.7 }, { a: 0.20, f: 2, ph: 0.3 }, { a: 0.12, f: 3, ph: 2.2 }],
  'bass-heavy': [{ a: 0.60, f: 0.5, ph: 0 }, { a: 0.30, f: 1, ph: 0.9 }, { a: 0.20, f: 1.5, ph: 1.9 }, { a: 0.10, f: 3, ph: 0.4 }],
  acoustic: [{ a: 0.35, f: 1, ph: 0 }, { a: 0.25, f: 1.5, ph: 1.1 }, { a: 0.2, f: 2.01, ph: 0.2 }, { a: 0.15, f: 3.02, ph: 2.4 }, { a: 0.1, f: 4.03, ph: 1.0 }],
  drums: [{ a: 0.5, f: 0.4, ph: 0 }, { a: 0.3, f: 0.8, ph: 0.5 }, { a: 0.3, f: 2.7, ph: 1.6 }, { a: 0.25, f: 3.9, ph: 2.8 }, { a: 0.2, f: 5.3, ph: 0.9 }],
  pink: Array.from({ length: 10 }, (_, k) => ({ a: 1 / Math.sqrt(0.3 * 1.5 ** k), f: 0.3 * 1.5 ** k + 0.013 * k, ph: 0.7 * k * k })),
  white: Array.from({ length: 10 }, (_, k) => ({ a: 0.3, f: 0.3 * 1.5 ** k + 0.013 * k, ph: 0.7 * k * k })),
  tone: [{ a: 1, f: 1, ph: 0 }],
  'two-tone': [{ a: 0.6, f: 1, ph: 0 }, { a: 0.4, f: 1.75, ph: 1.1 }],
  sweep: [{ a: 1, f: 1, ph: 0 }], // the lab's own frequency slider performs the sweep
  silence: [],
});
/** modulationTones(id) -> [{ a, f, ph }] (a relative, f in units of the base tone) for the Modulation lab; [] for silence. Unknown ids give the voice. */
export function modulationTones(id) {
  const sid = normalizeAudioSource(id);
  return (sid ? MODULATION_TONES[sid] : MODULATION_TONES.voice).map((o) => ({ ...o }));
}

// ---- programme profile for the baseband / MPX views -----------------------------------------------------------------------

/**
 * programmeProfile(id, { t, toneHz, binHz }) -> { lines: [{ fHz, relDb }] | null, relDb(fHz) -> dB relative to the source's own spectral peak
 * (0 at the peak, negative elsewhere; continuous sources only), isLine }. mpxSpectrum scales it so the peak lands at the programme level (-8 dB).
 */
export function programmeProfile(id, { t = 0, toneHz = DEFAULT_TONE_HZ } = {}) {
  const sid = normalizeAudioSource(id) || 'voice';
  if (AUDIO_SOURCES[sid].lines) {
    const fl = sourceLinesHz(sid, t, toneHz);
    return { id: sid, isLine: true, lines: fl.map((fHz) => ({ fHz, relDb: 0 })), relDb: () => -Infinity };
  }
  if (sid === 'silence') return { id: sid, isLine: false, lines: null, silent: true, relDb: () => -Infinity };
  let pk = -Infinity;
  for (let k = 0; k <= 96; k++) pk = Math.max(pk, sourceSpectrumDb(sid, 20 * Math.pow(750, k / 96), t, 0));
  return { id: sid, isLine: false, lines: null, relDb: (f) => sourceSpectrumDb(sid, Math.max(f, 20), t, 0) - pk };
}

// ---- clip statistics ------------------------------------------------------------------------------------------------------

export function erfcPos(x) { // Abramowitz and Stegun 7.1.26, x >= 0, absolute error < 1.5e-7
  const t = 1 / (1 + 0.3275911 * x);
  return t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
}

/**
 * clipFractionGaussian(overdriveDb, crestDb = 9.54) -> fraction of samples clipped when the limiter threshold sits overdriveDb below the
 * programme peak and the programme is Gaussian with a peak of crestDb above its RMS: erfc(k/sqrt2) - erfc(k0/sqrt2), k0 = 10^(crest/20),
 * k = k0 10^(-od/20). With the default 3-sigma crest this is the original model.
 */
export function clipFractionGaussian(overdriveDb, crestDb = GAUSSIAN_3SIGMA_CREST_DB) {
  if (!Number.isFinite(overdriveDb) || overdriveDb <= 0) return 0;
  const k0 = 10 ** (clamp(Number.isFinite(crestDb) ? crestDb : GAUSSIAN_3SIGMA_CREST_DB, 0.5, 40) / 20);
  const k = k0 * 10 ** (-Math.min(overdriveDb, 60) / 20);
  return Math.min(1, Math.max(0, erfcPos(k / Math.SQRT2) - erfcPos(k0 / Math.SQRT2)));
}

/** Fraction of time a sine of amplitude A spends beyond a clip level T = A 10^(-od/20): 1 - (2/pi) asin(T/A). */
export function clipFractionSine(overdriveDb) {
  if (!Number.isFinite(overdriveDb) || overdriveDb <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - (2 / Math.PI) * Math.asin(10 ** (-Math.min(overdriveDb, 60) / 20))));
}

function clipFractionTwoTone(overdriveDb) { // numeric: x = sin(th) + sin(1.5 th) over its period 4 pi, peak 2
  if (!Number.isFinite(overdriveDb) || overdriveDb <= 0) return 0;
  const T = 2 * 10 ** (-Math.min(overdriveDb, 60) / 20), N = 4000;
  let c = 0;
  for (let i = 0; i < N; i++) { const th = (4 * Math.PI * (i + 0.5)) / N; if (Math.abs(Math.sin(th) + Math.sin(1.5 * th)) > T) c++; }
  return c / N;
}

/** clipFraction(id, overdriveDb) -> fraction of samples clipped for this source (Gaussian with the source's crest factor, exact sine, numeric two-tone, 0 for silence). */
export function clipFraction(id, overdriveDb) {
  const sid = normalizeAudioSource(id) || 'voice', m = AUDIO_SOURCES[sid];
  if (m.clipModel === 'none') return 0;
  if (m.clipModel === 'sine') return clipFractionSine(overdriveDb);
  if (m.clipModel === 'two-tone') return clipFractionTwoTone(overdriveDb);
  return clipFractionGaussian(overdriveDb, m.crestDb);
}
