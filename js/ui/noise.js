// External RF noise selector helpers (pure). Values: undefined/0 = Off, a preset name, or a number (dB above kT at 600 MHz).
import { EXTERNAL_NOISE_FIGURE_600MHZ_DB } from '../model/rx-params.js';
import { externalNoiseNfDb } from '../model/rf.js';

const LABELS = { quiet: 'Quiet', outdoor: 'Outdoor', urban: 'Urban', 'noisy-venue': 'Noisy venue' };
const fmt = (v) => `+${(Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '')}`;

/** Select value for a stored environment.externalNoise. */
export function noiseValue(v) {
  if (v === undefined || v === null || v === 0) return 'off';
  if (typeof v === 'string' && EXTERNAL_NOISE_FIGURE_600MHZ_DB[v] !== undefined) return v;
  return typeof v === 'number' && Number.isFinite(v) ? 'custom' : 'off';
}

/** Stored value for a select choice; undefined for 'custom' (keep what is there). */
export function noiseFromChoice(choice) {
  if (choice === 'off') return 0;
  if (EXTERNAL_NOISE_FIGURE_600MHZ_DB[choice] !== undefined) return choice;
  return undefined;
}

/** [[value, label]] with the frequency-scaled noise figure at the link frequency in each label. */
export function noiseOptions(stored, freqMHz) {
  const f = Number.isFinite(freqMHz) && freqMHz > 0 ? freqMHz : 600;
  const at = (v) => fmt(externalNoiseNfDb({ externalNoise: v }, f));
  const here = (v) => (f === 600 ? '' : `; ${at(v)} dB at ${Math.round(f * 10) / 10} MHz`);
  const opts = [['off', 'Off (0 dB)']];
  for (const [id, v] of Object.entries(EXTERNAL_NOISE_FIGURE_600MHZ_DB)) opts.push([id, `${LABELS[id] || id} (${fmt(v)} dB @600 MHz${here(id)})`]);
  if (noiseValue(stored) === 'custom') opts.push(['custom', `Custom (${fmt(stored)} dB @600 MHz${here(stored)})`]);
  return opts;
}

export const noiseHint = () => 'External RF noise (TV, radios, electronics) raises the noise floor at the receive antenna, so it lowers the SNR and margin. It is stronger at low frequencies and fades with frequency. Old scenes without this setting are treated as Off.';

// ---- interference floor (2.4 / 5.8 GHz) and receiver preset offer ------------------------------------------------------------------
import { INTERFERENCE_LEVELS, INTERFERENCE_RISE_DB, INTERFERENCE_MIN_MHZ, interferenceBandOf, RX_PRESETS, rxPresetForFreq } from '../model/rx-params.js';

const LEVEL_LABELS = { none: 'None', quiet: 'Quiet', typical: 'Typical', busy: 'Busy' };
const BAND_NAMES = { '2g4': '2.4 GHz', '5g8': '5.8 GHz' };
const r1 = (v) => String(Math.round(v * 10) / 10);

/** The interference select only applies at 2 GHz and above. */
export const interferenceApplies = (freqMHz) => Number.isFinite(freqMHz) && freqMHz >= INTERFERENCE_MIN_MHZ;
export const interferenceValue = (v) => (INTERFERENCE_LEVELS.includes(v) ? v : 'none');

/** [[value, label]] for the Interference select; the labels carry the dB rise for the band of this carrier. */
export function interferenceOptions(freqMHz) {
  const band = interferenceBandOf(freqMHz);
  return INTERFERENCE_LEVELS.map((id) => [id, `${LEVEL_LABELS[id]} (+${r1(INTERFERENCE_RISE_DB[band][id])} dB)`]);
}

/** One-line hint for the current choice. */
export function interferenceHint(stored, freqMHz) {
  if (!interferenceApplies(freqMHz)) return 'Only used for 2.4 and 5.8 GHz links.';
  const band = interferenceBandOf(freqMHz), v = interferenceValue(stored);
  const rise = INTERFERENCE_RISE_DB[band][v];
  return `${BAND_NAMES[band]} band, ${LEVEL_LABELS[v].toLowerCase()}: the noise floor rises by about ${r1(rise)} dB (Wi-Fi and Bluetooth share this band), so the margin falls by the same amount. The signal level does not change.`;
}

/** Offer (never force) the matching receiver preset when the carrier moves to or from VHF, 2.4 GHz or 5.8 GHz. Returns { id, label, buttonText } or null. */
export function rxPresetOffer(kind, freqMHz, currentId) {
  if (!Number.isFinite(freqMHz) || freqMHz <= 0) return null;
  const want = rxPresetForFreq(kind, freqMHz);
  const cur = currentId || (kind === 'iem' ? 'iem-bodypack-typical' : 'mic-receiver-typical');
  if (want === cur) return null;
  const isBand = (id) => id.startsWith('rx-');
  if (!isBand(want) && !isBand(cur)) return null; // UHF mic <-> IEM presets are the user's own choice
  const name = { 'rx-vhf-typical': 'VHF', 'rx-2g4-typical': '2.4 GHz', 'rx-5g8-typical': '5.8 GHz' }[want] || 'UHF';
  return { id: want, label: (RX_PRESETS[want] || {}).label || want, buttonText: `Use ${name} receiver preset`, text: `This carrier is in the ${name} range, but the receiver preset is "${(RX_PRESETS[cur] || {}).label || cur}".` };
}
