// VNA lab controller: pure state, configuration and derived data (no DOM, no canvas). The view (js/view/vnaLab.js) and the tests use it.
// All physics is in js/model/vna-demo.js; this module only turns the lab's controls into a measure() config and the result into
// plot series, marker rows, tables, warnings and teaching text.
import * as V from '../model/vna-demo.js';
import { CABLES, ANTENNA_CONTACT_LABELS, ANTENNA_DAMPNESS_LABELS } from '../model/library.js';
import { CHAIN_PRESETS } from '../model/chain-presets.js';
import { ANTENNA_BANDS } from '../model/antenna-band.js';

export const DEVICES = Object.freeze([
  { id: 'antenna', label: 'Antenna' }, { id: 'cable', label: 'Cable' }, { id: 'chain', label: 'Chain (splitter, filter, pad, booster...)' }, { id: 'standard', label: 'Reference standard' },
]);
export const STANDARDS = Object.freeze([{ id: 'load', label: '50 ohm load' }, { id: 'open', label: 'Open' }, { id: 'short', label: 'Short' }]);
export const TERMINATIONS = Object.freeze([['through', 'Two-port (S21 and S11, port 2 matched)'], ['open', 'Far end open'], ['short', 'Far end shorted'], ['load', 'Far end into a 50 ohm load']]);
export const PATHS = Object.freeze([['through', 'Through path'], ['coupled', 'Coupled port'], ['isolated', 'Isolated port']]);
export const CONTACTS = Object.freeze(Object.entries(ANTENNA_CONTACT_LABELS));
export const DAMPNESS = Object.freeze(Object.entries(ANTENNA_DAMPNESS_LABELS));
export const GROUND_PLANES = Object.freeze([['large', 'Large ground plane'], ['rack', 'Rack panel'], ['body', 'Body'], ['none', 'No ground plane (free cable)']]);
export const WINDOWS = Object.freeze([['hann', 'Hann'], ['hamming', 'Hamming'], ['blackman', 'Blackman'], ['rect', 'Rectangular (sharpest, most sidelobes)']]);
export const PLOTS = Object.freeze([
  { id: 'rl', label: 'Return loss' }, { id: 'vswr', label: 'VSWR' }, { id: 'phase', label: 'S11 phase' }, { id: 's21', label: 'S21' }, { id: 'gd', label: 'Group delay' },
]);
export const CAL_STEPS = Object.freeze(['open', 'short', 'load']);
export const PARAM_LABELS = Object.freeze({
  posM: 'Position from the near end (m)', zOhm: 'Impedance there (ohm)', lengthM: 'Length of the fault (m)', seriesCpF: 'Series gap (pF)', shuntOhm: 'Shunt resistance (ohm)',
  extraDbPerMPerGHz: 'Extra loss (dB per m per GHz)', rejectionDb: 'Rejection (dB)', returnLossDb: 'Return loss (dB)', addLossDb: 'Added loss (dB)', gainLossDb: 'Gain lost (dB)',
  tiltDbPerGHz: 'Gain tilt (dB per GHz)', oscMHz: 'Oscillation at (MHz)', oscWidthMHz: 'Peak width (MHz)', oscPeakDb: 'Peak height (dB)', startMHz: 'Sweep start (MHz)', stopMHz: 'Sweep stop (MHz)',
});
export const DC_NOTE = 'DC at the VNA port can destroy it. Fit a DC block first.';

const fin = (v, d) => (Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const vnaChainPresets = () => Object.entries(CHAIN_PRESETS).filter(([, p]) => V.VNA_ITEM_KINDS.includes(p.kind)).map(([id, p]) => [id, p.label]);
export const antennaBandOptions = () => Object.entries(ANTENNA_BANDS).map(([id, b]) => [id, b.label]);
export const cableOptions = () => Object.entries(CABLES).map(([id, c]) => [id, c.label || id]);

export function defaultState() {
  return {
    device: 'antenna',
    sweep: { preset: 'default', startMHz: 100, stopMHz: 1000, points: V.SWEEP_DEFAULT_POINTS },
    antenna: { type: 'quarterwave', centreMHz: 600, band: 'auto', contact: 'free', dampness: 'dry', groundPlane: 'large' },
    cable: { cableId: 'rg58', lengthM: 5, termination: 'open' },
    chain: { items: ['pad-6'], path: 'through', termination: 'through', filterCentreMHz: 600, filterBandwidthMHz: 40 },
    standard: 'load',
    cal: { scenario: 'good', done: { open: true, short: true, load: true }, extraCableId: 'rg58', extraLengthM: 1 },
    portExtensionNs: 0,
    fault: { id: '', params: {} },
    overlayIdeal: true, memory: null,
    plot: 'rl', dtfWindow: 'hann',
    markers: [], active: -1,
  };
}

// ---- configuration --------------------------------------------------------------------------------------------------------------------
export function dutOf(P) {
  if (P.device === 'cable') {
    const c = P.cable, d = { type: 'cable', cableId: c.cableId, lengthM: clamp(fin(c.lengthM, 5), V.CABLE_MIN_M, V.CABLE_MAX_M) };
    if (c.termination !== 'through') d.termination = c.termination;
    return d;
  }
  if (P.device === 'chain') {
    const c = P.chain, items = c.items.map((id) => {
      const it = { presetId: id };
      if (CHAIN_PRESETS[id] && CHAIN_PRESETS[id].kind === 'filter') { it.centreMHz = c.filterCentreMHz; it.bandwidthMHz = c.filterBandwidthMHz; }
      return it;
    });
    const d = { type: 'chain', items, path: c.path };
    if (c.termination !== 'through') d.termination = c.termination;
    return d;
  }
  if (P.device === 'standard') return { type: P.standard };
  const a = P.antenna, d = { type: 'antenna', antennaType: a.type, centreMHz: fin(a.centreMHz, 600), contact: a.contact, dampness: a.dampness, groundPlane: a.groundPlane };
  if (a.band && a.band !== 'auto') d.designBand = a.band;
  return d;
}
export const calStepsDone = (P) => CAL_STEPS.filter((s) => P.cal.done[s]).length;
/** The calibration state the VNA is really in: a scenario other than 'none' only counts once open, short and load have all been measured. */
export function effectiveCalState(P) { return P.cal.scenario === 'none' || calStepsDone(P) < CAL_STEPS.length ? 'none' : P.cal.scenario; }
export function baseConfig(P) {
  return {
    sweep: { startMHz: P.sweep.startMHz, stopMHz: P.sweep.stopMHz, points: P.sweep.points },
    dut: dutOf(P),
    calibration: { state: effectiveCalState(P), extraCable: { cableId: P.cal.extraCableId, lengthM: clamp(fin(P.cal.extraLengthM, 1), V.CABLE_MIN_M, V.CABLE_MAX_M) } },
    portExtensionNs: clamp(fin(P.portExtensionNs, 0), -200, 200),
  };
}
/** Fault ids offered for the current device, grouped by device kind for the picker. */
export function faultChoices(P) {
  const dut = dutOf(P), groups = new Map();
  for (const id of V.faultsFor(dut)) { const f = V.FAULTS[id]; if (!groups.has(f.device)) groups.set(f.device, []); groups.get(f.device).push([id, f.label]); }
  return [...groups.entries()];
}
export const faultParamKeys = (id) => (V.FAULTS[id] ? Object.keys(V.FAULTS[id].params).filter((k) => typeof V.FAULTS[id].params[k] === 'number' || V.FAULTS[id].params[k] === null) : []);
export function faultParams(P) {
  const out = {};
  for (const [k, v] of Object.entries(P.fault.params || {})) if (Number.isFinite(v)) out[k] = v;
  return out;
}

// ---- sweep, calibration, markers ---------------------------------------------------------------------------------------------------------
export function setSweepPreset(P, id) {
  const p = V.SWEEP_PRESETS[id];
  if (p) { P.sweep.preset = id; P.sweep.startMHz = p.startMHz; P.sweep.stopMHz = p.stopMHz; } else P.sweep.preset = 'custom';
  clampMarkers(P);
}
export function setSweepRange(P, startMHz, stopMHz, points) {
  const s = V.buildSweep({ startMHz, stopMHz, points: fin(points, P.sweep.points) });
  P.sweep = { preset: 'custom', startMHz: s.startMHz, stopMHz: s.stopMHz, points: s.points };
  clampMarkers(P);
}
/** Sweep zoomed around the antenna's design band (sweepForBand). */
export function sweepAroundAntenna(P) {
  const a = P.antenna, b = a.band !== 'auto' && ANTENNA_BANDS[a.band] ? ANTENNA_BANDS[a.band] : V.antennaDesignBand(a.type, a.centreMHz);
  const s = V.sweepForBand(b.loMHz, b.hiMHz, P.sweep.points);
  P.sweep = { preset: 'custom', startMHz: +s.startMHz.toFixed(2), stopMHz: +s.stopMHz.toFixed(2), points: s.points };
  clampMarkers(P);
}
export function calMeasure(P, step) { if (CAL_STEPS.includes(step)) P.cal.done[step] = true; }
export function calReset(P) { for (const s of CAL_STEPS) P.cal.done[s] = false; }
export function calMeasureAll(P) { for (const s of CAL_STEPS) P.cal.done[s] = true; }
/** Port extension (ns) that cancels the extra cable's delay (one way). */
export function extensionForExtraCable(P) {
  const vf = (CABLES[P.cal.extraCableId] && CABLES[P.cal.extraCableId].velocityFactor) || 0.66;
  return +V.cableDelayNs(P.cal.extraLengthM, vf).toFixed(3);
}
export function clampMarkers(P) {
  const lo = P.sweep.startMHz, hi = P.sweep.stopMHz;
  P.markers = P.markers.map((m) => ({ fMHz: clamp(m.fMHz, lo, hi) }));
  if (P.active >= P.markers.length) P.active = P.markers.length - 1;
}
export function addMarker(P, fMHz) {
  if (P.markers.length >= V.MAX_MARKERS) return false;
  P.markers.push({ fMHz: clamp(fin(fMHz, (P.sweep.startMHz + P.sweep.stopMHz) / 2), P.sweep.startMHz, P.sweep.stopMHz) });
  P.active = P.markers.length - 1; return true;
}
export function removeMarker(P, i = P.active) {
  if (i < 0 || i >= P.markers.length) return false;
  P.markers.splice(i, 1); P.active = Math.min(P.active, P.markers.length - 1); if (P.active < 0 && P.markers.length) P.active = 0; return true;
}
export function selectMarker(P, i) { if (i >= 0 && i < P.markers.length) P.active = i; }
export function setMarker(P, i, fMHz) { if (P.markers[i]) P.markers[i].fMHz = clamp(fin(fMHz, P.markers[i].fMHz), P.sweep.startMHz, P.sweep.stopMHz); }
/** Move marker i by `steps` sweep points (negative = down in frequency). */
export function nudgeMarker(P, i, steps) {
  const step = (P.sweep.stopMHz - P.sweep.startMHz) / Math.max(1, P.sweep.points - 1);
  if (P.markers[i]) setMarker(P, i, P.markers[i].fMHz + steps * step);
}
/** Put a marker on the minimum or maximum of the S11 magnitude (or S21 if the plot is S21) of the measured trace. */
export function searchMarker(P, i, mode, traces, plot = P.plot) {
  const vals = plotValues(traces, plot);
  if (!vals) return null;
  const hit = V.markerSearch(traces.fMHz, vals, mode);
  if (hit && P.markers[i]) setMarker(P, i, hit.fMHz);
  return hit;
}

// ---- plot series --------------------------------------------------------------------------------------------------------------------------
const GD_CLAMP = 1e4;
export function plotValues(traces, plot) {
  if (!traces) return null;
  if (plot === 'rl') return traces.s11Db;
  if (plot === 'vswr') return traces.vswr.map((v) => Math.min(v, 10));
  if (plot === 'phase') return traces.s11PhaseDeg;
  if (plot === 's21') return traces.s21Db;
  if (plot === 'gd') return (traces.groupDelayNs || traces.s11GroupDelayNs).map((v) => clamp(v, -GD_CLAMP, GD_CLAMP));
  return null;
}
const nice = (v, step, up) => (up ? Math.ceil(v / step - 1e-9) * step : Math.floor(v / step + 1e-9) * step);
/** Everything a rectangular plot needs: title, axis names, series, memory series, reference lines and a y range. */
export function plotSpec(traces, mem, plot) {
  const ys = plotValues(traces, plot);
  const spec = { id: plot, xs: traces.fMHz, ys, mem: mem && mem.fMHz ? { xs: mem.fMHz, ys: plotValues(mem, plot) } : null, refLines: [], note: '', unit: '' };
  const hasS21 = !!traces.s21Db;
  if (plot === 'rl') { Object.assign(spec, { title: 'S11 magnitude (return loss), dip = good match', yName: 'S11 (dB)', unit: 'dB' }); spec.refLines = [{ y: -14, label: 'RL 14 dB (VSWR 1.5)' }, { y: -9.5, label: 'RL 9.5 dB (VSWR 2)' }]; }
  else if (plot === 'vswr') { Object.assign(spec, { title: 'VSWR (capped at 10)', yName: 'VSWR', unit: ':1' }); spec.refLines = [{ y: 1.5, label: 'VSWR 1.5' }, { y: 2, label: 'VSWR 2' }]; }
  else if (plot === 'phase') Object.assign(spec, { title: 'S11 phase', yName: 'phase (deg)', unit: 'deg' });
  else if (plot === 's21') { Object.assign(spec, { title: 'S21 transmission (insertion loss shows as a negative value)', yName: 'S21 (dB)', unit: 'dB' }); if (!hasS21) spec.note = 'This device is a one-port (antenna or terminated device), so there is no S21. Choose a two-port: a cable without a far-end termination or a chain.'; }
  else { Object.assign(spec, { title: hasS21 ? 'S21 group delay' : 'S11 group delay (one way, from the reflection)', yName: 'delay (ns)', unit: 'ns' }); }
  if (!ys) { spec.ys = null; return spec; }
  const all = ys.concat(spec.mem && spec.mem.ys ? spec.mem.ys : []).filter(Number.isFinite);
  let lo = Math.min(...all), hi = Math.max(...all);
  if (plot === 'rl') { hi = Math.max(5, nice(hi, 5, true)); lo = Math.max(-60, nice(Math.min(lo, -20), 10, false)); }
  else if (plot === 'vswr') { lo = 1; hi = clamp(nice(hi, 1, true), 3, 10); }
  else if (plot === 'phase') { lo = -180; hi = 180; }
  else { const pad = Math.max(1, (hi - lo) * 0.1); lo -= pad; hi += pad; if (hi - lo < 2) { lo -= 1; hi += 1; } }
  spec.yMin = lo; spec.yMax = hi;
  return spec;
}

/** Distance-to-fault data for the measured result: { dtf, vf, maxM } or null. */
export function dtfFor(P, res, memRes = null) {
  const dut = res.dut, cableId = dut.type === 'cable' ? dut.cableId : P.cal.extraCableId;
  const vf = clamp(fin(dut.velocityFactor, (CABLES[cableId] && CABLES[cableId].velocityFactor) || 0.66), 0.3, 1);
  const base = dut.type === 'cable' ? dut.lengthM : dut.type === 'chain' ? 3 : 2;
  const maxM = clamp(base * 1.4 + (effectiveCalState(P) === 'extraCable' ? P.cal.extraLengthM : 0) + 0.5, 1, 100);
  const run = (r) => V.distanceToFault(r.fMHz, r.s11, { velocityFactor: vf, window: P.dtfWindow, maxDistanceM: maxM });
  return { dtf: run(res), mem: memRes ? run(memRes) : null, vf, maxM };
}
const dtfDb = (m) => 20 * Math.log10(Math.max(1e-4, m));
export const dtfDbSeries = (d) => d.magnitude.map(dtfDb);

// ---- the whole computation ------------------------------------------------------------------------------------------------------------------
/**
 * compute(P) -> {
 *   cfg, res, ideal, traces, memory: {traces, dtf, label}|null, dtf: { dtf, mem, vf, maxM }, fault, faultApplicable, faultNote,
 *   warnings: [{ level: 'danger'|'warn'|'info', text }], cautions: [{ level, text }], info, calLabel, calNote
 * }
 */
export function compute(P) {
  const cfg = baseConfig(P);
  const ideal = V.measure(cfg);
  let res = ideal, usedCfg = cfg, fault = null, faultApplicable = false, faultWarnings = [], faultNote = '';
  if (P.fault.id && V.FAULTS[P.fault.id]) {
    const r = V.applyFault(cfg, P.fault.id, faultParams(P));
    fault = r.fault; faultApplicable = r.applicable; faultWarnings = r.warnings;
    if (r.applicable) { usedCfg = r.cfg; res = V.measure(r.cfg); } else faultNote = r.warnings[0] || 'This fault does not apply to the chosen device.';
  }
  const traces = V.traceSet(res);
  let memory = null;
  if (P.overlayIdeal && fault && faultApplicable) memory = { traces: V.traceSet(ideal), res: ideal, label: 'ideal device (no fault)' };
  else if (P.memory) memory = { traces: P.memory.traces, res: P.memory.res, label: P.memory.label || 'stored memory trace' };
  const d = dtfFor({ ...P, dtfWindow: P.dtfWindow }, res, memory && memory.res && memory.res.s11 ? memory.res : null);
  const dut = usedCfg.dut, warnings = [];
  const seen = new Set(), add = (level, text) => { if (!seen.has(text)) { seen.add(text); warnings.push({ level, text }); } };
  for (const t of faultWarnings) add('danger', t);
  const cautions = V.vnaCautions(dut);
  for (const c of cautions) if (c.level !== 'info') add(c.level, c.text);
  if (P.cal.scenario !== 'none' && calStepsDone(P) < CAL_STEPS.length && !(P.fault.id && P.fault.id.startsWith('meas-'))) add('warn', `Calibration is incomplete (${calStepsDone(P)} of 3 steps): the VNA is showing raw, uncalibrated readings. Measure open, short and load first.`);
  if (res.calState === 'none') add('warn', 'Not calibrated: a perfect load shows a poor return loss and a rotating phase because the VNA error terms are still in the result.');
  if (res.calState === 'extraCable') add('warn', 'Calibration plane is at the VNA port and an extra cable is in front of the device: phase rotates and the cable adds loss and ripple. Calibrate at the cable end or use port extension.');
  if (res.calState === 'cableAtCal') add('warn', 'The calibration was done with a cable that was then removed: the result is rotated the other way (apparent negative length).');
  const info = res.info || null;
  if (info && fin(info.efficiencyDb, 0) < -0.05) add('warn', `Radiation efficiency ${info.efficiencyDb.toFixed(1)} dB: the hand, body or water absorbs this much of the power. The return loss looks better than the free antenna because that power is absorbed instead of reflected, but the antenna radiates worse.`);
  if (res.s11.some((g) => Math.hypot(g.re, g.im) > 1.0005)) add('warn', 'S11 is above 0 dB (return loss is negative): the device returns more power than was sent, so an amplifier in it is oscillating.');
  return { cfg: usedCfg, res, ideal, traces, memory, dtf: d, fault, faultApplicable, faultNote, warnings, cautions, info, calLabel: V.CAL_LABELS[res.calState] };
}

// ---- readouts ------------------------------------------------------------------------------------------------------------------------------------
export const fmtNum = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');
export const fmtZ = (z) => (z && Number.isFinite(z.re) ? `${z.re.toFixed(1)} ${z.im < 0 ? '-' : '+'} j${Math.abs(z.im).toFixed(1)} ohm` : '-');
export const fmtF = (f) => `${(+f.toFixed(3))} MHz`;

/** One row per marker: frequency, return loss, VSWR, impedance, phase, S21, delay and the efficiency note, plus the plain-English reading. */
export function markerRows(P, c) {
  return P.markers.map((m, i) => {
    const r = V.markerReadout(c.res, m.fMHz), rl = r.s11.rlDb, ex = V.explainTrace('rl', rl);
    const eff = c.info && fin(c.info.efficiencyDb, 0) < -0.05 ? c.info.efficiencyDb : null;
    return {
      n: i + 1, fMHz: r.fMHz, rlDb: rl, vswr: r.s11.vswr, z: r.s11.zOhm, phaseDeg: r.s11.phaseDeg, mismatchDb: r.s11.mismatchDb,
      s21Db: r.s21 ? r.s21.db : null, delayNs: r.s21 ? r.s21.delayNs : null, efficiencyDb: eff, verdict: ex.verdict, text: ex.text,
      il: r.s21 ? V.explainTrace('il', Math.max(0, -r.s21.db)) : null,
    };
  });
}
export function markerTableRows(P, c) {
  return markerRows(P, c).map((r) => ({
    marker: String(r.n), frequency: fmtF(r.fMHz), returnLoss: `${fmtNum(r.rlDb)} dB`, vswr: `${r.vswr >= 99 ? '>99' : fmtNum(r.vswr, 2)}:1`, impedance: fmtZ(r.z), phase: `${fmtNum(r.phaseDeg, 0)} deg`,
    s21: r.s21Db == null ? 'none (one-port)' : `${fmtNum(r.s21Db)} dB`, delay: r.delayNs == null ? '-' : `${fmtNum(r.delayNs)} ns`, efficiency: r.efficiencyDb == null ? '-' : `${fmtNum(r.efficiencyDb)} dB`,
  }));
}
/** Decimated rows for the table alternative to the rectangular plot (at most maxRows). */
export function plotTable(spec, maxRows = 101) {
  const n = spec.xs.length, step = Math.max(1, Math.ceil(n / maxRows)), rows = [];
  if (!spec.ys) return rows;
  const memAt = (f) => (spec.mem && spec.mem.ys ? V.interpAt(spec.mem.xs, spec.mem.ys, f) : null);
  for (let i = 0; i < n; i += step) rows.push({ fMHz: spec.xs[i], value: spec.ys[i], mem: memAt(spec.xs[i]) });
  return rows;
}
export function smithTable(traces, maxRows = 51) {
  const n = traces.fMHz.length, step = Math.max(1, Math.ceil(n / maxRows)), rows = [];
  for (let i = 0; i < n; i += step) { const s = traces.smith[i]; rows.push({ fMHz: traces.fMHz[i], re: s.x, im: s.y, r: s.zOhm.re, x: s.zOhm.im }); }
  return rows;
}
export function dtfTable(d, maxRows = 51) {
  const n = d.dtf.distanceM.length, step = Math.max(1, Math.ceil(n / maxRows)), rows = [];
  for (let i = 0; i < n; i += step) rows.push({ distanceM: d.dtf.distanceM[i], db: dtfDb(d.dtf.magnitude[i]) });
  return rows;
}
/** Text for the fault location: what the DTF should show, from the planted fault position (cables only). */
export function faultPositionNote(P, c) {
  if (!c.fault || !c.faultApplicable || c.cfg.dut.type !== 'cable' || !V.FAULTS[c.fault.id].params || !('posM' in V.FAULTS[c.fault.id].params)) return '';
  const pos = fin(P.fault.params.posM, 0.5 * c.cfg.dut.lengthM);
  return `Fault planted ${pos.toFixed(2)} m from the near end; the distance-to-fault trace should peak there.`;
}
/** Short text summary of the whole measurement (aria-live status and the plot description). */
export function summaryText(P, c) {
  const s = c.traces, i = V.markerSearch(s.fMHz, s.s11Db, 'min');
  const worst = Math.min(...s.rlDb.filter(Number.isFinite));
  const parts = [`${DEVICES.find((d) => d.id === P.device).label}${c.fault && c.faultApplicable ? ` with fault: ${c.fault.label}` : ''}, sweep ${fmtF(P.sweep.startMHz)} to ${fmtF(P.sweep.stopMHz)}, ${c.calLabel}.`];
  if (i) parts.push(`Best match ${fmtNum(-i.value)} dB return loss at ${fmtF(i.fMHz)}; worst ${fmtNum(worst)} dB.`);
  if (c.res.s21) parts.push(`S21 from ${fmtNum(Math.min(...s.s21Db))} to ${fmtNum(Math.max(...s.s21Db))} dB.`);
  return parts.join(' ');
}
export function storeMemory(P, c, label = 'stored trace') { P.memory = { traces: c.traces, res: c.res, label }; P.overlayIdeal = false; }
export function clearMemory(P) { P.memory = null; }
