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
