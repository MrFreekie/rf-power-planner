// Frequency plan export (pure). One row per link and per IMD transmitter, as rows, CSV and fixed-width text, plus a coordination summary.
//
// Figures and flags:
//  - tvChannel: spectrum-map.js tvChannelOf with the scene's channel width (6 or 8 MHz); null outside the TV bands.
//  - occupiedBwKHz: analogue FM = Carson's rule 2 (deviation + audio), at the default +-40 kHz and 15 kHz = 110 kHz (flag I: the per-link deviation
//    is not stored, see digital-link.js analogOccupiedBwKHz); digital = digitalProfile(cfg).occupiedBwKHz (the preset's noise bandwidth).
//  - txPowerMw = 10^(dBm/10), rounded to 3 significant figures.
//  - assumptionFlag: 'proven' or 'unproven' from assumptions-in-use.js confidenceSummary (flag U: a convention, not a standard).
//  - coordinationSummary counts distinct third-order products with coord-lab.js planHits (same counting rule as the planner).
// CSV: RFC 4180 quoting (a field with the delimiter, a quote, CR or LF is quoted and quotes are doubled). Text fields that begin with = + - @ TAB or CR
// are prefixed with an apostrophe so a spreadsheet does not run them as a formula (OWASP CSV injection guidance); numbers are written as numbers.

import { tvChannelOf, tvWidthOf, projectFrequencies, overlappingFrequencies } from './spectrum-map.js';
import { analogOccupiedBwKHz, digitalConfigOf, digitalProfile } from './digital-link.js';
import { confidenceSummary, resultAt } from './assumptions-in-use.js';
import { planHits } from './coord-lab.js';
import { solveLink } from './rf.js';
import { linkOwners } from './people.js';
import { COORDINATION_DEFAULTS } from './coordination.js';

export const PLAN_COLUMNS = Object.freeze([
  { key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }, { key: 'freqMHz', label: 'Frequency (MHz)' }, { key: 'tvChannel', label: 'TV channel' },
  { key: 'occupiedBwKHz', label: 'Occupied bandwidth (kHz)' }, { key: 'txPowerMw', label: 'Tx power (mW)' }, { key: 'rxLevelDbm', label: 'Rx level (dBm)' },
  { key: 'marginDb', label: 'Margin (dB)' }, { key: 'status', label: 'Status' }, { key: 'personName', label: 'Person' }, { key: 'assumptionFlag', label: 'Assumptions' }, { key: 'notes', label: 'Notes' },
]);

const clean = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
const sig3 = (x) => (Number.isFinite(x) ? Number(x.toPrecision(3)) : null);
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

/**
 * extraImdTransmitters(scene) -> the scene.imd transmitters that are NOT a link's own transmitter. The intermod list normally includes the wanted link's
 * transmitter (the model needs it as a source), so the same device would count twice in a frequency plan. A transmitter is the same device when its id equals
 * the link id or the link's tx id, else when it sits within 1 kHz of a link frequency (each link absorbs at most one imd transmitter).
 */
export function extraImdTransmitters(scene) {
  const links = (scene && Array.isArray(scene.links)) ? scene.links : [];
  const txs = (scene && scene.imd && Array.isArray(scene.imd.transmitters)) ? scene.imd.transmitters : [];
  const taken = new Set(), dupe = new Set();
  for (const l of links) { const k = txs.findIndex((t, i) => !taken.has(i) && t && t.id !== undefined && (t.id === l.id || (l.tx && t.id === l.tx.id))); if (k >= 0) { taken.add(k); dupe.add(txs[k]); } }
  for (const l of links) { const k = txs.findIndex((t, i) => !taken.has(i) && t && Number.isFinite(t.freqMHz) && Math.abs(t.freqMHz - l.freqMHz) <= 0.001 + 1e-9); if (k >= 0) { taken.add(k); dupe.add(txs[k]); } }
  return txs.filter((t) => !dupe.has(t));
}

/** frequencyPlanRows(scene, results?) -> rows { source 'link'|'imd', id, name, role 'mic'|'iem'|'other', freqMHz, tvChannel, occupiedBwKHz, txPowerMw, rxLevelDbm, marginDb, status, personName, assumptionFlag, notes }. */
export function frequencyPlanRows(scene, results) {
  const links = (scene && Array.isArray(scene.links)) ? scene.links : [];
  const w = tvWidthOf(scene), rows = [];
  const solved = links.map((l, i) => resultAt(results, scene, i) || solveLink(scene, l));
  const conf = new Map(confidenceSummary(scene, solved).map((c) => [c.linkId, c]));
  const owners = linkOwners(scene && scene.people, scene && scene.links), peopleById = new Map(((scene && scene.people) || []).map((p) => [p.id, p]));
  links.forEach((l, i) => {
    const res = solved[i], c = conf.get(l.id), ch = tvChannelOf(l.freqMHz, w), notes = [];
    const digital = l.modulation && l.modulation.type === 'digital';
    const bw = digital ? digitalProfile(digitalConfigOf(l)).occupiedBwKHz : analogOccupiedBwKHz();
    if (c && !c.proven && c.reasons.length) notes.push(c.reasons[0]);
    if (res && res.warnings && res.warnings.length) notes.push(clean(res.warnings[0]));
    const o = owners.get(l.id), person = o && peopleById.get(o.personId);
    rows.push({
      source: 'link', id: l.id, name: clean(l.name), role: l.kind === 'mic' || l.kind === 'iem' ? l.kind : 'other', freqMHz: l.freqMHz, tvChannel: ch ? ch.n : null,
      occupiedBwKHz: Number.isFinite(bw) ? bw : null, txPowerMw: sig3(Math.pow(10, l.tx.powerDbm / 10)), rxLevelDbm: r1(res && res.inputPowerDbm),
      marginDb: r1(res && res.marginDb), status: res ? res.status : '', personName: person ? clean(person.name) : '', assumptionFlag: c ? (c.proven ? 'proven' : 'unproven') : '', notes: notes.join(' '),
    });
  });
  for (const t of extraImdTransmitters(scene)) {
    const ch = tvChannelOf(t.freqMHz, w);
    rows.push({
      source: 'imd', id: t.id, name: clean(t.name || t.id), role: 'other', freqMHz: t.freqMHz, tvChannel: ch ? ch.n : null, occupiedBwKHz: analogOccupiedBwKHz(),
      txPowerMw: sig3(Math.pow(10, t.powerDbm / 10)), rxLevelDbm: null, marginDb: null, status: '', personName: '', assumptionFlag: '', notes: 'IMD transmitter',
    });
  }
  return rows;
}

const FORMULA_START = /^[=+\-@\t\r]/;
/** csvCell(value, delimiter) -> one escaped cell. Exported for tests. */
export function csvCell(v, delimiter = ',') {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return (s.includes(delimiter) || /["\r\n]/.test(s)) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** frequencyPlanCsv(rows, { delimiter = ',', bom = false, header = true }) -> CSV text with CRLF line ends. */
export function frequencyPlanCsv(rows, { delimiter = ',', bom = false, header = true } = {}) {
  const d = typeof delimiter === 'string' && delimiter.length === 1 && !/["\r\n]/.test(delimiter) ? delimiter : ',';
  const lines = [];
  if (header) lines.push(PLAN_COLUMNS.map((c) => csvCell(c.label, d)).join(d));
  for (const r of rows || []) lines.push(PLAN_COLUMNS.map((c) => csvCell(r[c.key], d)).join(d));
  return (bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
}

/** frequencyPlanText(rows) -> fixed-width plain text, columns padded to the widest cell. */
export function frequencyPlanText(rows) {
  const cols = PLAN_COLUMNS.filter((c) => c.key !== 'notes'), cell = (r, c) => { const v = r[c.key]; return v === null || v === undefined ? '-' : String(v).replace(/\s+/g, ' '); };
  const widths = cols.map((c) => Math.max(c.label.length, ...(rows || []).map((r) => cell(r, c).length)));
  const line = (vals) => vals.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd();
  const out = [line(cols.map((c) => c.label)), line(widths.map((n) => '-'.repeat(n)))];
  for (const r of rows || []) out.push(line(cols.map((c) => cell(r, c))));
  return out.join('\n') + '\n';
}

/** planSummary(scene, { projectName, date }) -> header { projectName, date, tvChannelWidthMHz, links, mics, iems, other, imdTransmitters, people }. The date is passed in (this module never reads the clock). */
export function planSummary(scene, { projectName, date } = {}) {
  const links = (scene && scene.links) || [];
  return {
    projectName: clean(projectName !== undefined ? projectName : (scene && scene.name)), date: clean(date), tvChannelWidthMHz: tvWidthOf(scene), links: links.length,
    mics: links.filter((l) => l.kind === 'mic').length, iems: links.filter((l) => l.kind === 'iem').length, other: links.filter((l) => l.kind !== 'mic' && l.kind !== 'iem').length,
    imdTransmitters: extraImdTransmitters(scene).length, people: ((scene && scene.people) || []).length,
  };
}

/**
 * coordinationSummary(scene, opts?) -> { frequencies, hits2, hits3, hitsTotal, distinctProducts (labels), minSpacingKHz (smallest actual spacing, null for < 2),
 *   requiredSpacingKHz, spacingViolations, overlapWarnings [{a, b, separationKHz}], ok }. Links and IMD transmitters are the frequencies in use.
 */
export function coordinationSummary(scene, opts = {}) {
  const extra = new Set(extraImdTransmitters(scene).map((t) => t.id));
  const items = projectFrequencies(scene).filter((f) => f.source !== 'noise' && (f.source !== 'imd' || extra.has(f.id))); // a link's own transmitter in the imd list is one frequency, not two
  const freqs = items.map((f) => f.freqMHz);
  const sorted = [...freqs].sort((a, b) => a - b);
  let minSpacingKHz = null;
  for (let i = 1; i < sorted.length; i++) { const d = Math.round((sorted[i] - sorted[i - 1]) * 1e6) / 1e3; if (minSpacingKHz === null || d < minSpacingKHz) minSpacingKHz = d; }
  const requiredSpacingKHz = Number.isFinite(opts.minSpacingKHz) ? opts.minSpacingKHz : COORDINATION_DEFAULTS.minSpacingKHz; // the rule asked for, NOT the measured minimum (planHits echoes the measured one)
  const overlapWarnings = overlappingFrequencies(items, opts.minSpacingKHz || 200);
  if (freqs.length < 2) return { frequencies: freqs.length, hits2: 0, hits3: 0, hitsTotal: 0, distinctProducts: [], minSpacingKHz, requiredSpacingKHz, spacingViolations: 0, overlapWarnings, ok: true };
  const h = planHits(freqs, opts);
  const distinct = [...new Set(h.conflicts.map((c) => c.label))];
  const viol = Array.isArray(h.spacingViolations) ? h.spacingViolations.length : (h.spacingViolations || 0);
  return { frequencies: freqs.length, hits2: h.hits2, hits3: h.hits3, hitsTotal: h.hitsTotal, distinctProducts: distinct, minSpacingKHz, requiredSpacingKHz, spacingViolations: viol, overlapWarnings, ok: h.ok && overlapWarnings.length === 0 };
}
