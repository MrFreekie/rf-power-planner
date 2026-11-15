// Pure helpers for the noise source GUI: catalogue options with confidence flags, behaviour text, budget and paths rows. No DOM.
import { NOISE_CATALOGUE, NOISE_KIND_IDS } from '../model/noise-sources.js';

const fin = Number.isFinite;
export const NOISE_GROUP_LABELS = Object.freeze({ display: 'Displays and lighting', lighting: 'Lighting', power: 'Power and motors', camera: 'Cameras and flash', radio: 'Radio and triggers', phone: 'Phones and data', eng: 'ENG crew', other: 'Other' });
export const BEHAVIOUR_LABELS = Object.freeze({ continuous: 'Continuous', impulsive: 'Impulsive (clicks)', intermittent: 'Intermittent (keyed or bursty)', 'pulsed-tdma': 'Pulsed TDMA (frame bursts)' });
export const FLAG_WORDS = Object.freeze({ S: 'from a rule or class limit', I: 'inferred, typical engineering value', U: 'unverified guess' });

/** The confidence summary of a kind: for example "field U" or "freq S, ERP S, duty U". Words are shown with the letters. */
export function flagText(kind) {
  const def = NOISE_CATALOGUE[kind];
  if (!def) return '';
  const names = { fieldDbuvmAt10m: 'field', freqMHz: 'frequency', erpDbm: 'ERP', dutyCycle: 'duty', pulseWidthMs: 'pulse width', repHz: 'rate', bwKHz: 'bandwidth' };
  return Object.entries(def.flags).map(([k, f]) => `${names[k] || k} ${f}`).join(', ');
}
/** Worst (least certain) flag of a kind: U beats I beats S. */
export function worstFlag(kind) {
  const f = Object.values((NOISE_CATALOGUE[kind] || { flags: {} }).flags);
  return f.includes('U') ? 'U' : f.includes('I') ? 'I' : f.includes('S') ? 'S' : '-';
}

/** Catalogue picker options grouped by catalogue group: [{ group, label, options: [[id, text]] }]. The flag letter is part of the text. */
export function catalogueOptions() {
  const groups = new Map();
  for (const id of NOISE_KIND_IDS) {
    const def = NOISE_CATALOGUE[id], g = def.group || 'other';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push([id, `${def.label} [${worstFlag(id)}]`]);
  }
  return [...groups.entries()].map(([group, options]) => ({ group, label: NOISE_GROUP_LABELS[group] || group, options }));
}

/** One-line behaviour description of a source, with its duty factor. */
export function behaviourText(src, dutyFn) {
  const def = NOISE_CATALOGUE[src.kind];
  if (!def) return 'unknown kind';
  const duty = typeof dutyFn === 'function' ? dutyFn(src) : null;
  return `${BEHAVIOUR_LABELS[def.behaviour] || def.behaviour}${fin(duty) && duty < 1 ? `, duty ${(duty * 100).toFixed(duty < 0.01 ? 2 : 1)} %` : ''}`;
}

const dbm = (v) => (fin(v) ? `${v.toFixed(1)} dBm` : 'none');

/** Budget extras rows for result.noiseSources: average versus peak, the floor rise for each, the dominant source and up to three contributors. */
export function noiseBudgetRows(ns) {
  if (!ns || !fin(ns.averageDbm)) return [];
  const rise = fin(ns.riseDb) ? ns.riseDb : 0, peakRise = fin(ns.peakRiseDb) ? ns.peakRiseDb : NaN, ch = fin(ns.marginChangeDb) ? ns.marginChangeDb : 0;
  const dom = (ns.sources || []).find((s) => s.id === ns.dominant);
  const rows = [{
    label: 'Noise sources',
    value: `average ${dbm(ns.averageDbm)}, peak ${dbm(ns.peakDbm)}; floor +${rise.toFixed(1)} dB on average${fin(peakRise) ? `, +${peakRise.toFixed(1)} dB at the peak` : ''}; margin ${ch >= 0 ? '+' : '−'}${Math.abs(ch).toFixed(1)} dB${rise >= 3 ? ' WARNING' : ''}${dom ? `. Strongest: ${dom.name}` : ''}`,
    severity: rise >= 6 ? 'warning' : rise >= 3 ? 'info' : 'ok',
  }];
  const live = (ns.sources || []).filter((s) => fin(s.averageDbm)).sort((a, b) => b.averageDbm - a.averageDbm).slice(0, 3);
  for (const s of live) rows.push({ label: `  ${s.name}`, value: `${s.distanceM.toFixed(1)} m, ${BEHAVIOUR_LABELS[s.behaviour] || s.behaviour}: average ${dbm(s.averageDbm)}, peak ${dbm(s.peakDbm)}${s.inChannel === false ? `, ${Math.abs(s.offsetMHz).toFixed(1)} MHz off channel (${s.selectivityDb.toFixed(0)} dB rejection)` : ''}`, severity: 'info' });
  return rows;
}

/** Paths-table rows for the noise sources: { kind, length, delayNs, relDb } as strings; the last column carries "avg / peak". */
export function noisePathRows(ns, fmtLen) {
  if (!ns) return [];
  return (ns.sources || []).filter((s) => fin(s.averageDbm)).sort((a, b) => b.averageDbm - a.averageDbm).slice(0, 6).map((s) => ({
    kind: `Noise: ${s.name}`, length: fmtLen ? fmtLen(s.distanceM) : `${s.distanceM.toFixed(1)} m`, delayNs: '-', relDb: `avg ${s.averageDbm.toFixed(0)} / peak ${s.peakDbm.toFixed(0)} dBm`,
  }));
}
