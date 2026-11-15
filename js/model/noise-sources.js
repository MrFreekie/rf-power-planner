// Noise sources as their own scene category (item 34 and 34a). Pure functions, no DOM, no imports.
//
//   scene.noiseSources: [{ id, name, kind, enabled, pos: {x, y, z}, ...parameters }]   (at most NOISE_SOURCE_LIMITS.max)
//   kind is a NOISE_CATALOGUE id. Every parameter below starts from the catalogue default and can be overridden per source:
//     broadband (type 'broadband'):  fieldDbuvmAt10m (dBuV/m, 120 kHz quasi-peak at 10 m; for an impulsive source the PEAK), tiltDbPerDecade
//                                    (about 600 MHz), bandMinMHz, bandMaxMHz (outside it the field falls 40 dB per decade, ASSUMED)
//     narrowband (type 'narrowband'): freqMHz, erpDbm (while transmitting, effective radiated power), bwKHz (occupied bandwidth, default 12.5)
//     time behaviour: continuous (always on), impulsive (pulseWidthMs, repHz), intermittent (dutyCycle, onS, holdS), pulsed-tdma (pulseWidthMs, repHz)
//     video-wall: reflectorId links the source to scene.reflectors[].noise (the wall block stays the single source of truth, ledwall.js, and its
//                 power is summed in result.wallNoise, NOT again here; enabled:false mutes that wall).
//
// ALL CATALOGUE FIGURES ARE PLANNING VALUES. Confidence flags per figure: S = from a rule or class limit that was seen (PMR446 0.5 W ERP, GSM 900 class 4
// 2 W peak with 1 in 8 slots at 217 Hz, GSM 1800 1 W, LTE class 3 23 dBm, DECT 250 mW peak, EN 55032 class limits), I = inferred or typical
// engineering value, U = unverified guess. No product is named: use measurements of the real source (spectrum analyser with max hold) when you have them.
//
// Formulas (each from a standard relation):
//   Broadband field to power (the same chain as ledwall.js): E(d) = E10 + 20 log10(10 / d_eff) (far-field 1/d);
//     S = E^2 / Z0 with Z0 = 377 ohm: dBW/m2 = E(dBuV/m) - 120 - 10 log10(377);  A_e = lambda^2 G / (4 pi);  P = S + A_e + 10 log10(B / 120 kHz)
//     minus 3 dB (random polarisation against a linear antenna, ASSUMED). d_eff = max(d, 1 m) for a small source (NOISE_NEAR_CLAMP_M).
//   Narrowband: Friis, P_rx = ERP - FSPL(d, f) + G_rx - 3 dB, FSPL = 20 log10(4 pi d / lambda).
//   Receiver selectivity for an off-channel carrier (ASSUMED, flag U): 0 dB inside the channel (|df| <= B/2), else min(90, 20 + 20 log10(|df| / (B/2))) dB.
//   Average power of a gated source: P_avg = P_peak + 10 log10(duty), duty = pulseWidth x repHz (impulsive, TDMA) or dutyCycle (intermittent).
//   The average figure is what raises the noise floor; the peak figure is what a squelch or a meter sees during a pulse or a key-up.

export const NOISE_BEHAVIOURS = Object.freeze(['continuous', 'impulsive', 'intermittent', 'pulsed-tdma']);
export const NOISE_SOURCE_LIMITS = Object.freeze({
  max: 64, coord: [-5000, 5000], zM: [-10, 200], fieldDbuvm: [-20, 140], tiltDbPerDecade: [-60, 60], bandMHz: [0.1, 100000], erpDbm: [-40, 70],
  bwKHz: [0.1, 100000], dutyCycle: [0, 1], pulseWidthMs: [0.001, 10000], repHz: [0.001, 100000], timeS: [0, 3600], antennaGainDbi: [-20, 30],
});
export const NOISE_NEAR_CLAMP_M = 1;
export const NOISE_REF_BW_KHZ = 120;
export const NOISE_POLARISATION_LOSS_DB = 3;
export const NOISE_SELECTIVITY_CAP_DB = 90;
const Z0_DB = 10 * Math.log10(377);
const C = 299792458;
const num = (v, d) => (Number.isFinite(v) ? v : d);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// id -> { label, behaviour, params (defaults), flags (param -> S/I/U), note, group }
const E = (label, behaviour, params, flags, note, group = 'other') => Object.freeze({ label, behaviour, params: Object.freeze(params), flags: Object.freeze(flags), note, group });
const BB = (field, tilt = -20, lo = 30, hi = 1000) => ({ type: 'broadband', fieldDbuvmAt10m: field, tiltDbPerDecade: tilt, bandMinMHz: lo, bandMaxMHz: hi });
export const NOISE_CATALOGUE = Object.freeze({
  'video-wall': E('Video / LED wall', 'continuous', { ...BB(47, 0, 30, 1000) }, { fieldDbuvmAt10m: 'I' }, 'Class A limit at 10 m (47 dBuV/m above 230 MHz). The wall block on a reflector (ledwall.js) is the source of truth; this entry mirrors it.', 'display'),
  'led-light-pwm': E('LED light or tape with PWM dimming', 'continuous', { ...BB(38, -20) }, { fieldDbuvmAt10m: 'U' }, 'Switching driver plus PWM edges: broadband hash falling with frequency. Camera lights and cheap LED tape are the usual offenders.', 'lighting'),
  'switch-mode-psu': E('Switch-mode power supply or laptop charger', 'continuous', { ...BB(32, -20) }, { fieldDbuvmAt10m: 'U' }, 'Class B limit class of noise at its harmonic comb; worse when cheap or damaged.', 'power'),
  'generator-inverter': E('Generator or inverter (van, tour power)', 'continuous', { ...BB(45, -30, 30, 500) }, { fieldDbuvmAt10m: 'U' }, 'Alternator and inverter switching: strongest at VHF, falling above 500 MHz.', 'power'),
  'speedlight-flash': E('Camera speedlight / flash', 'impulsive', { ...BB(70, -20), pulseWidthMs: 1, repHz: 3 }, { fieldDbuvmAt10m: 'U', pulseWidthMs: 'I', repHz: 'I' }, 'A discharge and trigger spark: a broadband click about 1 ms long, a few per second at the photo pit (peak figure).', 'camera'),
  'flash-trigger-radio': E('Flash / camera radio trigger (2.4 GHz)', 'intermittent', { type: 'narrowband', freqMHz: 2440, erpDbm: 10, bwKHz: 1000, dutyCycle: 0.02, onS: 0.2, holdS: 0 }, { erpDbm: 'I', dutyCycle: 'U' }, 'A short 2.4 GHz packet per frame; far above UHF mics but inside Wi-Fi and 2.4 GHz mic systems.', 'camera'),
  'dimmer-triac': E('Triac / SCR dimmer on a stage circuit', 'impulsive', { ...BB(45, -40, 0.15, 300), pulseWidthMs: 0.1, repHz: 120 }, { fieldDbuvmAt10m: 'U', repHz: 'S' }, 'Two chops per mains cycle (100 or 120 Hz). Strong at LF and VHF, weak at UHF; it comes in through the audio cable and mains rather than the air.', 'lighting'),
  'motor-hoist': E('Brushed motor, winch or chain hoist (arcing)', 'impulsive', { ...BB(50, -30, 30, 800), pulseWidthMs: 0.05, repHz: 1000 }, { fieldDbuvmAt10m: 'U' }, 'Brush arcing: dense broadband clicks while it runs.', 'power'),
  'ptt-pmr446': E('PTT handheld, PMR446 (0.5 W)', 'intermittent', { type: 'narrowband', freqMHz: 446.1, erpDbm: 27, bwKHz: 12.5, dutyCycle: 0.3, onS: 5, holdS: 0.5 }, { freqMHz: 'S', erpDbm: 'S', dutyCycle: 'U' }, 'Licence-free 0.5 W ERP limit. Crew keys it for a few seconds at a time.', 'radio'),
  'ptt-business-uhf': E('PTT handheld, business UHF (about 2 W)', 'intermittent', { type: 'narrowband', freqMHz: 462.5, erpDbm: 33, bwKHz: 12.5, dutyCycle: 0.3, onS: 5, holdS: 0.5 }, { freqMHz: 'U', erpDbm: 'I', dutyCycle: 'U' }, 'Handhelds are 1 to 5 W: 2 W assumed. The frequency is a placeholder: use the crew allocation.', 'radio'),
  'ptt-vhf-crew': E('PTT handheld, VHF crew radio (about 2 W)', 'intermittent', { type: 'narrowband', freqMHz: 155, erpDbm: 33, bwKHz: 12.5, dutyCycle: 0.3, onS: 5, holdS: 0.5 }, { freqMHz: 'U', erpDbm: 'I', dutyCycle: 'U' }, 'The harmonics at 2x and 3x of 155 MHz land near 310 and 465 MHz: check against the channel plan.', 'radio'),
  'gsm-phone-900': E('GSM 900 phone (TDMA burst)', 'pulsed-tdma', { type: 'narrowband', freqMHz: 897.5, erpDbm: 33, bwKHz: 200, pulseWidthMs: 0.577, repHz: 216.7 }, { erpDbm: 'S', pulseWidthMs: 'S', repHz: 'S' }, '2 W peak (class 4), one slot in eight every 4.615 ms: the 217 Hz buzz in audio cables and mic preamps (demodulated by the first transistor).', 'phone'),
  'gsm-phone-1800': E('GSM 1800 phone (TDMA burst)', 'pulsed-tdma', { type: 'narrowband', freqMHz: 1747.5, erpDbm: 30, bwKHz: 200, pulseWidthMs: 0.577, repHz: 216.7 }, { erpDbm: 'S', pulseWidthMs: 'S', repHz: 'S' }, '1 W peak, same 217 Hz frame.', 'phone'),
  'lte-phone': E('LTE phone (uplink)', 'intermittent', { type: 'narrowband', freqMHz: 800, erpDbm: 23, bwKHz: 5000, dutyCycle: 0.3, onS: 2, holdS: 0 }, { erpDbm: 'S', dutyCycle: 'U' }, 'Maximum power class 3 is 23 dBm; a live stream or a bonded cellular backpack is much busier than a phone in a pocket.', 'phone'),
  'dect-comms': E('DECT-type wireless comms / intercom (1.9 GHz)', 'pulsed-tdma', { type: 'narrowband', freqMHz: 1890, erpDbm: 24, bwKHz: 1728, pulseWidthMs: 0.417, repHz: 100 }, { erpDbm: 'S', pulseWidthMs: 'S', repHz: 'S' }, '250 mW peak, a 10 ms frame of 24 slots; a 100 Hz buzz for one slot per frame (a full duplex call uses two).', 'radio'),
  'wifi-ap': E('Wi-Fi access point or hotspot (2.4 GHz)', 'intermittent', { type: 'narrowband', freqMHz: 2437, erpDbm: 20, bwKHz: 20000, dutyCycle: 0.1, onS: 0.01, holdS: 0 }, { erpDbm: 'I', dutyCycle: 'U' }, '100 mW class bursts. Overlaps 2.4 GHz mics and IEMs.', 'radio'),
  bluetooth: E('Bluetooth device', 'intermittent', { type: 'narrowband', freqMHz: 2441, erpDbm: 4, bwKHz: 1000, dutyCycle: 0.3, onS: 0.005, holdS: 0 }, { erpDbm: 'I', dutyCycle: 'U' }, 'Class 2 about 2.5 mW, hopping over 79 channels (treated as one in-band carrier).', 'radio'),
  'microwave-oven': E('Microwave oven leakage (2.45 GHz)', 'continuous', { type: 'narrowband', freqMHz: 2450, erpDbm: 0, bwKHz: 30000 }, { erpDbm: 'U' }, 'A leaking door seal; a catering trailer beside the stage.', 'power'),
  'pyro-trigger': E('Pyro / cue trigger radio (433 MHz)', 'intermittent', { type: 'narrowband', freqMHz: 433.9, erpDbm: 10, bwKHz: 25, dutyCycle: 0.001, onS: 0.1, holdS: 0 }, { freqMHz: 'I', erpDbm: 'I', dutyCycle: 'U' }, 'Short command bursts.', 'radio'),
  'cofdm-camera-tx': E('Camera-mounted COFDM video transmitter (2.3 GHz band)', 'continuous', { type: 'narrowband', freqMHz: 2300, erpDbm: 27, bwKHz: 8000, dutyCycle: 1 }, { freqMHz: 'U', erpDbm: 'I', bwKHz: 'I' }, 'About 10 mW to 2 W, 1.2 to 1.3, 2 to 2.5 and 7 GHz bands: far above UHF mics, near 2.4 GHz systems. Check the regional ENG allocation.', 'eng'),
  'led-camera-light': E('On-camera LED light (PWM dimming)', 'continuous', { ...BB(38, -20) }, { fieldDbuvmAt10m: 'U' }, 'The same noise class as led-light-pwm, at a camera: close to the pit.', 'eng'),
});
export const NOISE_KIND_IDS = Object.freeze(Object.keys(NOISE_CATALOGUE));

/**
 * ENG crew group (item 34a): camera transmitter, two PTT radios, an LED light and a van generator around a centre point (the crew at the barrier).
 * Each entry is a separate, separately mutable source. Offsets in metres from the centre: all assumed positions.
 */
export const ENG_CREW_GROUP = Object.freeze([
  { kind: 'cofdm-camera-tx', name: 'ENG camera transmitter', dx: 0, dy: 0, dz: 1.8 },
  { kind: 'ptt-business-uhf', name: 'ENG PTT radio (producer)', dx: -1.5, dy: 0.5, dz: 1.2 },
  { kind: 'ptt-business-uhf', name: 'ENG PTT radio (engineer)', dx: 1.5, dy: -0.5, dz: 1.2 },
  { kind: 'led-camera-light', name: 'ENG camera LED light', dx: 0.3, dy: 0.3, dz: 2.0 },
  { kind: 'generator-inverter', name: 'ENG van generator', dx: -8, dy: -4, dz: 1.0 },
]);

let seq = 0;
const newNsId = () => `ns${Date.now().toString(36)}${(seq++).toString(36)}`;

/** createNoiseSource(kind, overrides) -> source with the catalogue defaults copied in. */
export function createNoiseSource(kind, overrides = {}) {
  const def = NOISE_CATALOGUE[kind];
  if (!def) throw new Error(`Unknown noise source kind: ${kind}`);
  return { id: newNsId(), name: def.label, kind, enabled: true, pos: { x: 5, y: 5, z: 1.5 }, ...structuredClone(def.params), ...overrides };
}

/** engCrewSources(centre = {x, y, z}) -> the crew group as an array of sources placed around the centre. */
export function engCrewSources(centre = { x: 5, y: 5, z: 0 }) {
  return ENG_CREW_GROUP.map((m) => createNoiseSource(m.kind, { name: m.name, pos: { x: centre.x + m.dx, y: centre.y + m.dy, z: (centre.z || 0) + m.dz } }));
}

/** The effective parameters of a source: catalogue defaults overridden by the source's own fields. */
function params(src) {
  const def = NOISE_CATALOGUE[src.kind];
  return { ...(def ? def.params : {}), ...src, behaviour: def ? def.behaviour : 'continuous' };
}

/** Duty factor (0..1) of the time behaviour. */
export function dutyOf(src) {
  const p = params(src);
  switch (p.behaviour) {
    case 'continuous': return 1;
    case 'impulsive': case 'pulsed-tdma': return Math.min(1, Math.max(num(p.pulseWidthMs, 1) * 1e-3 * num(p.repHz, 1), 1e-9));
    default: return Math.min(1, Math.max(num(p.dutyCycle, 1), 1e-9));
  }
}

/** Off-channel selectivity (dB) of a receiver of bandwidth bwKHz for a carrier offsetMHz away (ASSUMED, flag U): 0 inside the channel. */
export function selectivityDb(offsetMHz, bwKHz) {
  const half = Math.max(bwKHz, 1e-6) / 2000; // MHz
  const o = Math.abs(offsetMHz);
  return o <= half ? 0 : Math.min(NOISE_SELECTIVITY_CAP_DB, 20 + 20 * Math.log10(o / half));
}

/** Field strength (dBuV/m at 10 m) of a broadband source at freqMHz. */
export function broadbandFieldDbuvm(p, freqMHz) {
  let e = num(p.fieldDbuvmAt10m, -Infinity) + num(p.tiltDbPerDecade, 0) * Math.log10(freqMHz / 600);
  const lo = num(p.bandMinMHz, 30), hi = num(p.bandMaxMHz, 1000);
  if (freqMHz > hi) e -= 40 * Math.log10(freqMHz / hi);
  else if (freqMHz < lo) e -= 40 * Math.log10(lo / freqMHz);
  return e;
}

/**
 * noiseSourceAt(src, point, freqMHz, bwKHz, gainFn) -> { id, name, kind, behaviour, type, distanceM, duty, peakDbm, averageDbm, rawDbm, inChannel,
 *   offsetMHz, selectivityDb } at the receive antenna terminals. point = { x, y, z }; gainFn({az, el}) -> receive antenna gain (dBi) towards the source.
 * peakDbm is in the receiver bandwidth bwKHz while the source is on (a pulse or a key-up); averageDbm = peakDbm + 10 log10(duty) is the power average that
 * raises the noise floor; rawDbm is the unfiltered power of a narrowband carrier at the antenna (what the front end must survive, compare with the
 * receiver P1dB and the overload model). A source muted with enabled:false returns peak and average -Infinity.
 */
export function noiseSourceAt(src, point, freqMHz, bwKHz, gainFn = () => 0) {
  const p = params(src);
  const pos = src.pos || { x: 0, y: 0, z: 0 };
  const dx = pos.x - point.x, dy = pos.y - point.y, dz = num(pos.z, 0) - num(point.z, 0);
  const d = Math.hypot(dx, dy, dz);
  const g = gainFn({ az: (Math.atan2(dx, dy) * 180) / Math.PI, el: (Math.atan2(dz, Math.hypot(dx, dy)) * 180) / Math.PI });
  const lambda = C / (freqMHz * 1e6);
  const duty = dutyOf(src);
  const base = { id: src.id, name: src.name, kind: src.kind, behaviour: p.behaviour, type: p.type, distanceM: d, duty };
  if (src.enabled === false) return { ...base, peakDbm: -Infinity, averageDbm: -Infinity, rawDbm: -Infinity, inChannel: false, offsetMHz: 0, selectivityDb: 0, muted: true };
  if (p.type === 'narrowband') {
    const dEff = Math.max(d, NOISE_NEAR_CLAMP_M);
    const fspl = 20 * Math.log10((4 * Math.PI * dEff) / lambda);
    const raw = num(p.erpDbm, -Infinity) - fspl + g - NOISE_POLARISATION_LOSS_DB;
    const offset = num(p.freqMHz, freqMHz) - freqMHz;
    const sel = selectivityDb(offset, bwKHz);
    // a carrier wider than the receiver channel only puts the receiver-bandwidth fraction of its power in the channel
    const wide = num(p.bwKHz, 12.5), bwLoss = wide > bwKHz && Math.abs(offset) * 1000 <= (wide + bwKHz) / 2 ? 10 * Math.log10(wide / bwKHz) : 0;
    const peak = raw - sel - bwLoss;
    return { ...base, peakDbm: peak, averageDbm: peak + 10 * Math.log10(duty), rawDbm: raw, inChannel: sel === 0, offsetMHz: offset, selectivityDb: sel + bwLoss };
  }
  const dEff = Math.max(d, NOISE_NEAR_CLAMP_M);
  const e = broadbandFieldDbuvm(p, freqMHz) + 20 * Math.log10(10 / dEff);
  const peak = e - 120 - Z0_DB + 10 * Math.log10((lambda * lambda) / (4 * Math.PI)) + g + 30 + 10 * Math.log10(bwKHz / NOISE_REF_BW_KHZ) - NOISE_POLARISATION_LOSS_DB;
  return { ...base, peakDbm: peak, averageDbm: peak + 10 * Math.log10(duty), rawDbm: peak, inChannel: true, offsetMHz: 0, selectivityDb: 0 };
}

const sumDbm = (xs) => (xs.length ? 10 * Math.log10(xs.reduce((s, x) => s + Math.pow(10, x / 10), 0)) : -Infinity);
const hasWall = (s) => typeof s.reflectorId === 'string' && s.reflectorId.length > 0;

/**
 * noiseSourcesAt(sources, point, freqMHz, bwKHz, gainFn) -> { averageDbm, peakDbm, sources: [per source], dominant }
 * averageDbm: power sum of the average figures (what raises the floor); peakDbm: power sum of the peaks (worst case, all on at once; it is an upper
 * bound when the time behaviours are independent). A source linked to a reflector wall (reflectorId) is skipped: the wall is counted once, by
 * ledwall.js in result.wallNoise.
 */
export function noiseSourcesAt(sources, point, freqMHz, bwKHz, gainFn = () => 0) {
  const per = (Array.isArray(sources) ? sources : []).filter((s) => isObj(s) && !hasWall(s)).map((s) => noiseSourceAt(s, point, freqMHz, bwKHz, gainFn));
  const live = per.filter((x) => x.averageDbm > -Infinity);
  const dom = live.reduce((a, b) => (!a || b.averageDbm > a.averageDbm ? b : a), null);
  return { averageDbm: sumDbm(live.map((x) => x.averageDbm)), peakDbm: sumDbm(live.map((x) => x.peakDbm)), sources: per, dominant: dom ? dom.id : null };
}

/** Ids of reflectors whose linked video-wall noise source is muted (enabled false): rf.js leaves their wall noise out. */
export function mutedReflectorIds(sources) {
  return new Set((Array.isArray(sources) ? sources : []).filter((s) => isObj(s) && hasWall(s) && s.enabled === false).map((s) => s.reflectorId));
}

/** Floor rise (dB) of an added noise power over a floor, both dBm. */
export function floorRiseDb(floorDbm, addedDbm) {
  if (!(addedDbm > -Infinity)) return 0;
  return 10 * Math.log10(1 + Math.pow(10, (addedDbm - floorDbm) / 10));
}

/**
 * noiseRiseVsDistance(src, distancesM, { freqMHz, bwKHz, floorDbm, gainDbi = 0 }) -> [{ distanceM, averageDbm, peakDbm, riseDb, peakRiseDb }]
 * The source sits at the origin and the receive antenna at each distance along +x (an isotropic antenna unless gainDbi): the curve behind
 * "which emitter dominates by distance".
 */
export function noiseRiseVsDistance(src, distancesM, { freqMHz, bwKHz, floorDbm, gainDbi = 0 } = {}) {
  return distancesM.map((d) => {
    const r = noiseSourceAt({ ...src, pos: { x: 0, y: 0, z: num(src.pos && src.pos.z, 1.5) } }, { x: d, y: 0, z: num(src.pos && src.pos.z, 1.5) }, freqMHz, bwKHz, () => gainDbi);
    return { distanceM: d, averageDbm: r.averageDbm, peakDbm: r.peakDbm, riseDb: floorRiseDb(floorDbm, r.averageDbm), peakRiseDb: floorRiseDb(floorDbm, r.peakDbm) };
  });
}

/**
 * noiseEvents(src, durationS, { seed = 1, maxEvents = 4000 }) -> [{ t0, t1 }] the on-intervals of the source over durationS seconds, deterministic.
 * continuous: one interval; impulsive and pulsed-tdma: a pulse every 1/repHz of length pulseWidth; intermittent: a key-up of onS plus holdS every
 * (onS + holdS) / dutyCycle seconds with a seeded start offset (the schedule is the same for the same seed: a timeline, not a statistic).
 */
export function noiseEvents(src, durationS, { seed = 1, maxEvents = 4000 } = {}) {
  const p = params(src);
  const out = [];
  const T = Math.max(0, durationS);
  if (p.behaviour === 'continuous') return T > 0 ? [{ t0: 0, t1: T }] : [];
  let u = (seed >>> 0) || 1;
  const rnd = () => { u = (Math.imul(u, 1664525) + 1013904223) >>> 0; return u / 4294967296; };
  if (p.behaviour === 'impulsive' || p.behaviour === 'pulsed-tdma') {
    const period = 1 / Math.max(num(p.repHz, 1), 1e-9), w = Math.min(num(p.pulseWidthMs, 1) * 1e-3, period);
    for (let t = rnd() * period; t < T && out.length < maxEvents; t += period) out.push({ t0: t, t1: Math.min(t + w, T) });
    return out;
  }
  const on = Math.max(num(p.onS, 1), 1e-6) + Math.max(num(p.holdS, 0), 0), duty = Math.min(Math.max(num(p.dutyCycle, 0.1), 1e-6), 1);
  const period = on / duty;
  for (let t = rnd() * Math.max(period - on, 0); t < T && out.length < maxEvents; t += period) out.push({ t0: t, t1: Math.min(t + on, T) });
  return out;
}

/** Fraction of durationS covered by the events (the measured duty of a timeline). */
export function eventsDuty(events, durationS) {
  return durationS > 0 ? events.reduce((s, e) => s + (e.t1 - e.t0), 0) / durationS : 0;
}

/**
 * wallNoiseSourcesFromReflectors(scene) -> [source] one video-wall source (linked by reflectorId) for every reflector with a noise block that has none
 * yet. Pure: the caller (migrateScene) appends them. The wall block itself is not changed or moved: it stays the single source of truth.
 */
export function wallNoiseSourcesFromReflectors(scene) {
  const have = new Set((Array.isArray(scene.noiseSources) ? scene.noiseSources : []).filter(hasWall).map((s) => s.reflectorId));
  const out = [];
  for (const r of Array.isArray(scene.reflectors) ? scene.reflectors : []) {
    if (!isObj(r) || !isObj(r.noise) || !r.id || have.has(r.id) || !r.p1 || !r.p2) continue;
    out.push({ id: `ns-${r.id}`.slice(0, 64), name: r.name ? `${r.name} (video wall)` : 'Video wall', kind: 'video-wall', enabled: true, reflectorId: r.id,
      pos: { x: (r.p1.x + r.p2.x) / 2, y: (r.p1.y + r.p2.y) / 2, z: num(r.zMin, 0) + (num(r.zMax, 3) - num(r.zMin, 0)) / 2 } });
  }
  return out;
}

/** validateNoiseSource(src, path, errors, ids): pushes plain error strings. Used by validateScene. */
export function validateNoiseSource(s, path, errors) {
  const L = NOISE_SOURCE_LIMITS;
  const inR = (v, r) => Number.isFinite(v) && v >= r[0] && v <= r[1];
  if (!isObj(s)) { errors.push(`${path} must be an object`); return; }
  if (!(typeof s.id === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(s.id))) errors.push(`${path}.id must be a short plain string`);
  if (!(typeof s.kind === 'string' && Object.prototype.hasOwnProperty.call(NOISE_CATALOGUE, s.kind))) { errors.push(`${path}.kind invalid`); return; }
  if (s.name !== undefined && !(typeof s.name === 'string' && s.name.length <= 80)) errors.push(`${path}.name must be a short string`);
  if (s.enabled !== undefined && typeof s.enabled !== 'boolean') errors.push(`${path}.enabled must be true or false`);
  if (s.reflectorId !== undefined && !(typeof s.reflectorId === 'string' && s.reflectorId.length <= 64)) errors.push(`${path}.reflectorId must be a short string`);
  if (!isObj(s.pos) || !inR(s.pos.x, L.coord) || !inR(s.pos.y, L.coord) || !inR(s.pos.z === undefined ? 0 : s.pos.z, L.zM)) errors.push(`${path}.pos must have x, y, z within limits`);
  const chk = (k, r) => { if (s[k] !== undefined && !inR(s[k], r)) errors.push(`${path}.${k} must be between ${r[0]} and ${r[1]}`); };
  chk('fieldDbuvmAt10m', L.fieldDbuvm); chk('tiltDbPerDecade', L.tiltDbPerDecade); chk('bandMinMHz', L.bandMHz); chk('bandMaxMHz', L.bandMHz);
  chk('freqMHz', L.bandMHz); chk('erpDbm', L.erpDbm); chk('bwKHz', L.bwKHz); chk('dutyCycle', L.dutyCycle); chk('pulseWidthMs', L.pulseWidthMs);
  chk('repHz', L.repHz); chk('onS', L.timeS); chk('holdS', L.timeS);
}
