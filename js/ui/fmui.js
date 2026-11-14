// Analogue FM equipment presets in the inspector: pure helpers (no DOM). The data lives in js/model/fm-presets.js.
// Every figure that is not 'sourced' there is shown with the word "assumed" (text, not only colour).
import { listFmPresets, getFmPreset, isAssumed, fmTuningCheck, fmPowerOption, FM_PRESET_DISCLAIMER } from '../model/fm-presets.js';
import { RX_PRESETS } from '../model/rx-params.js';

export const LOW_IM_LABEL = 'Low-intermod mode (assumed 6 dB benefit, manufacturer claims ~30% more channels)';
export { FM_PRESET_DISCLAIMER };

const mwText = (dbm) => { const mw = Math.pow(10, dbm / 10); return `${mw >= 10 ? Math.round(mw) : Math.round(mw * 10) / 10} mW`; };

/** [[value, label]] for the transmitter equipment picker; '' = custom. */
export const txPresetOptions = () => [['', 'None (custom)'], ...listFmPresets({ role: 'tx' }).filter((p) => p.role === 'tx').map((p) => [p.id, p.label])];

/** [[value, label]] for a preset's power options, e.g. ['loi-10mw', '10 mW low-intermod mode (10 dBm)']. */
export function powerOptionChoices(presetId) {
  const p = getFmPreset(presetId);
  if (!p || p.role !== 'tx') return [];
  return p.params.powerOptions.map((o) => [o.id, `${o.label} (${Math.round(o.powerDbm * 10) / 10} dBm)`]);
}

/** Id of the power option matching the link's Tx power and low-intermod flag, else 'custom'. */
export function currentPowerOption(link) {
  const id = link && link.tx && link.tx.fmPreset;
  const p = getFmPreset(id);
  if (!p || p.role !== 'tx') return '';
  const li = !!link.tx.lowIntermod;
  const exact = p.params.powerOptions.find((o) => Math.abs(o.powerDbm - link.tx.powerDbm) < 0.01 && !!o.lowIntermod === li);
  if (exact) return exact.id;
  const same = p.params.powerOptions.find((o) => Math.abs(o.powerDbm - link.tx.powerDbm) < 0.01);
  return same ? same.id : 'custom';
}

export const lowIntermodAvailable = (presetId) => { const p = getFmPreset(presetId); return !!(p && p.role === 'tx' && p.params.lowIntermod && p.params.lowIntermod.available); };

/** Text lines for the hint under the picker: disclaimer and the preset's one-line caveat. */
export function presetNotes(presetId) {
  const p = getFmPreset(presetId);
  return p ? [p.disclaimer || FM_PRESET_DISCLAIMER, p.caveat].filter(Boolean) : [];
}

const confWord = (id, param) => (isAssumed(id, param) ? 'assumed' : 'sourced');

/** Figures of a transmitter preset with their confidence: [{ label, value, assumed, word }]. */
export function txFigures(presetId, link = null) {
  const p = getFmPreset(presetId);
  if (!p || p.role !== 'tx') return [];
  const q = p.params;
  const o = link ? q.powerOptions.find((x) => x.id === currentPowerOption(link)) : fmPowerOption(presetId);
  const rows = [
    ['Power', o ? mwText(o.powerDbm) : (link ? mwText(link.tx.powerDbm) : '-'), 'powerOptions'],
    ['Deviation', `\u00b1${q.deviationKhz} kHz`, 'deviationKhz'],
    ['Occupied bandwidth', `${q.occupiedBwKhz} kHz`, 'occupiedBwKhz'],
    ['Tuning step', `${q.tuningStepKhz} kHz`, 'tuningStepKhz'],
    ['Power amplifier intermod conversion loss', `${q.paConversionDb} dB`, 'paConversionDb'],
  ];
  if (q.lowIntermod && q.lowIntermod.available) rows.push(['Low-intermod benefit', `${q.lowIntermod.extraConversionDb} dB`, 'lowIntermod']);
  return rows.map(([label, value, param]) => ({ label, value, assumed: isAssumed(presetId, param), word: confWord(presetId, param) }));
}

/** Figures of a receiver preset the planner derives from the preset (sensitivity, squelch, diversity ...). */
export function rxFigures(presetId) {
  const p = getFmPreset(presetId);
  if (!p || p.role !== 'rx') return [];
  const q = p.params;
  const rows = [
    ['Sensitivity (planner)', `${q.sensitivityDbm} dBm`, 'sensitivityDbm'],
    ['Required CNR', `${Math.round(q.requiredCnrDb * 10) / 10} dB`, 'requiredCnrDb'],
    ['Noise figure', `${q.noiseFigureDb} dB`, 'noiseFigureDb'],
    ['Squelch threshold', `${q.squelch.thresholdDbm} dBm`, 'squelch'],
    ['Diversity mode', String(q.diversityMode), 'diversityMode'],
    ['Overload (P1dB)', `${q.p1dBDbm} dBm`, 'p1dBDbm'],
  ];
  return rows.map(([label, value, param]) => ({ label, value, assumed: isAssumed(presetId, param), word: confWord(presetId, param) }));
}

/** Warn (never block) when the carrier is outside the preset's tuning window or off its step grid. Returns { text, warn } or null. */
export function tuningHint(presetId, freqMHz) {
  const p = getFmPreset(presetId);
  if (!p || p.role !== 'tx' || !Number.isFinite(freqMHz)) return null;
  const t = fmTuningCheck(presetId, freqMHz);
  const wins = (p.params.tuningWindows || []).map((w) => w.label).join(', ');
  const max = p.params.tuningWindowMaxMHz;
  if (!Array.isArray(p.params.tuningWindows) || !p.params.tuningWindows.length) return null;
  if (!t.inWindow) return { warn: true, text: `${freqMHz} MHz is outside the tuning windows of this preset (${wins}${max ? `; each about ${max} MHz wide` : ''}). The planner still uses it.` };
  if (!t.onGrid) return { warn: true, text: `${freqMHz} MHz is not on this transmitter's ${p.params.tuningStepKhz} kHz tuning grid (window ${t.window}). Real units tune in steps.` };
  return { warn: false, text: `Within tuning window ${t.window}, on the ${p.params.tuningStepKhz} kHz grid.` };
}

/** Receiver preset choices; FM entries are labelled with manufacturer and model and the "published specs" caution. */
export function rxPresetChoices() {
  return Object.entries(RX_PRESETS).map(([id, pr]) => {
    const fm = getFmPreset(id);
    if (fm && fm.role === 'rx') return [id, `${fm.manufacturer} ${fm.model} class receiver (FM): based on published specs, some figures assumed`];
    return [id, pr.label || id];
  });
}
export const isFmRxPreset = (id) => { const p = getFmPreset(id); return !!(p && p.role === 'rx'); };
