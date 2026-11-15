// Pure helpers for the chain item editor: preset dropdown options, S/I/U confidence flags and labels.
import { CHAIN_PRESETS } from '../model/chain-presets.js';

export const FLAG_TEXT = Object.freeze({
  S: 'S: stated in a source seen',
  I: 'I: inferred or a generic engineering value',
  U: 'U: unverified, check the datasheet',
});

export const DC_MODE_LABELS = Object.freeze({ pass: 'Passes DC', block: 'Blocks DC', short: 'Shorts DC (DC return)' });
export const FILTER_TYPE_LABELS = Object.freeze({ bandpass: 'Band-pass', notch: 'Notch' });

/** Options for the preset dropdown: a blank prompt then every preset id with its label. Pure. */
export function presetOptions() {
  return [['', 'Add from preset...']].concat(Object.entries(CHAIN_PRESETS).map(([id, p]) => [id, p.label]));
}

/** The S/I/U flag of a figure on a preset-made item, or null. Pure. */
export function presetFlag(item, field) {
  const pr = item && item.presetId ? CHAIN_PRESETS[item.presetId] : null;
  const f = pr && pr.flags ? pr.flags[field] : null;
  return f === 'S' || f === 'I' || f === 'U' ? f : null;
}

/** Item kinds that carry DC or isolation figures (for tests). */
export function chainKindFields(kind) {
  return { coupler: ['couplingDb', 'excessLossDb', 'isolationDb', 'maxInputDbm'], biastee: ['lossDb', 'dcSupplyV', 'dcSupplyMa', 'maxInputDbm'],
    dcblock: ['lossDb', 'dcMode', 'maxInputDbm'], activesplitter: ['ports', 'gainDb', 'nfDb', 'iip3Dbm', 'op1dBDbm', 'isolationDb', 'dcNeedV', 'dcNeedMa'],
    activecombiner: ['ports', 'gainDb', 'nfDb', 'iip3Dbm', 'op1dBDbm', 'isolationDb', 'dcNeedV', 'dcNeedMa'] }[kind] || [];
}
