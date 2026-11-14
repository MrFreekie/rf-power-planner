// VNA lab: an educational overlay with a virtual 50 ohm vector network analyser (NanoVNA style).
// Physics lives in js/model/vna-demo.js; the controller (state, config, series, tables) in js/ui/vnaState.js; canvas drawing in ./vnaPlots.js.
// Lazy-loaded by app.js, like the Modulation lab: focus trap, Escape closes, focus returns to the button.
import { createCanvasHost } from './util.js';
import { drawRect, drawSmith, drawDtf } from './vnaPlots.js';
import * as V from '../model/vna-demo.js';
import * as S from '../ui/vnaState.js';

export function mountVnaLab({ container, store, openButton }) {
  const doc = container.ownerDocument;
  const el = (tag, cls, text, attrs) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const P = S.defaultState();
  S.addMarker(P, 600);
  let C = S.compute(P), open = false, lastFocus = null, raf = 0, geo = { rect: null };
  const syncs = []; // functions that copy P into the controls
  const tableOpen = new Set();

  // ---- skeleton -----------------------------------------------------------------------------------------------------------------------
  container.textContent = '';
  container.classList.add('vnalab');
  container.setAttribute('role', 'dialog'); container.setAttribute('aria-modal', 'true'); container.setAttribute('aria-label', 'VNA lab');
  const closeBtn = el('button', 'vl-close', 'Close', { type: 'button', 'aria-label': 'Close the VNA lab' });
  const bar = el('div', 'vl-bar'); bar.append(el('h2', 'vl-title', 'VNA lab'), el('span', 'vl-illus', 'A virtual 50 ohm network analyser. Illustrative teaching model, not a measurement of any product.'), closeBtn);
  const safety = el('section', 'vl-safety', null, { 'aria-label': 'Safety notes' });
  safety.append(el('h3', null, 'Safety'));
  const sl = el('ul'); for (const t of V.VNA_CAUTIONS) sl.append(el('li', null, t)); safety.append(sl);
  const alerts = el('div', 'vl-alerts', null, { role: 'status', 'aria-live': 'polite', 'aria-label': 'Warnings from the measurement' });
  const status = el('p', 'vl-status', '', { role: 'status', 'aria-live': 'polite' });
  const controls = el('div', 'vl-controls'), main = el('div', 'vl-main');
  const body = el('div', 'vl-body'); body.append(controls, main);
  container.append(bar, safety, alerts, body);

  const group = (title, hint) => { const f = el('fieldset', 'vl-group'); f.append(el('legend', null, title)); if (hint) f.append(el('p', 'vl-hint', hint)); controls.append(f); return f; };
  function numberField(parent, label, get, set, { min, max, step = 'any', unit = '' } = {}) {
    const w = el('label', 'vl-ctl'), i = el('input', null, null, { type: 'number', step: String(step) });
    if (min != null) i.min = min; if (max != null) i.max = max;
    i.addEventListener('change', () => { const v = parseFloat(i.value); if (Number.isFinite(v)) set(v); changed(); sync(); });
    w.append(el('span', 'vl-lab', unit ? `${label} (${unit})` : label), i); parent.append(w);
    syncs.push(() => { if (doc.activeElement !== i) i.value = String(+(+get()).toFixed(4)); });
    return w;
  }
  function selectField(parent, label, options, get, set) {
    const w = el('label', 'vl-ctl'), s = el('select');
    const fill = (opts) => { s.textContent = ''; for (const o of opts) { if (o.group) { const g = el('optgroup', null, null, { label: o.group }); for (const [v, t] of o.items) g.append(el('option', null, t, { value: v })); s.append(g); } else s.append(el('option', null, o[1], { value: o[0] })); } };
    fill(options);
    s.addEventListener('change', () => { set(s.value); changed(); sync(); });
    w.append(el('span', 'vl-lab', label), s); parent.append(w);
    syncs.push(() => { s.value = get(); });
    return { w, s, fill };
  }
  const btn = (parent, label, fn, title) => { const b = el('button', null, label, { type: 'button' }); if (title) b.title = title; b.addEventListener('click', () => { fn(); changed(); sync(); }); parent.append(b); return b; };

  // ---- device -------------------------------------------------------------------------------------------------------------------------
  const gDev = group('Device under test', 'Pick what is connected to the VNA port.');
  selectField(gDev, 'Device', S.DEVICES.map((d) => [d.id, d.label]), () => P.device, (v) => { P.device = v; P.fault = { id: '', params: {} }; });
  const devBoxes = {};
  for (const d of S.DEVICES) { devBoxes[d.id] = el('div', 'vl-sub'); gDev.append(devBoxes[d.id]); }
  { const b = devBoxes.antenna;
    selectField(b, 'Antenna type', Object.entries(V.ANTENNA_DUT_TYPES).map(([id, t]) => [id, t.label]), () => P.antenna.type, (v) => { P.antenna.type = v; });
    numberField(b, 'Cut for (centre)', () => P.antenna.centreMHz, (v) => { P.antenna.centreMHz = Math.min(6000, Math.max(30, v)); }, { min: 30, max: 6000, unit: 'MHz' });
    selectField(b, 'Design band', [['auto', 'Cut for the centre frequency above'], ...S.antennaBandOptions()], () => P.antenna.band, (v) => { P.antenna.band = v; });
    selectField(b, 'Hand or body', S.CONTACTS, () => P.antenna.contact, (v) => { P.antenna.contact = v; });
    selectField(b, 'Dampness', S.DAMPNESS, () => P.antenna.dampness, (v) => { P.antenna.dampness = v; });
    selectField(b, 'Ground plane (whip)', S.GROUND_PLANES, () => P.antenna.groundPlane, (v) => { P.antenna.groundPlane = v; });
  }
  { const b = devBoxes.cable;
    selectField(b, 'Cable type', S.cableOptions(), () => P.cable.cableId, (v) => { P.cable.cableId = v; });
    numberField(b, 'Length', () => P.cable.lengthM, (v) => { P.cable.lengthM = Math.min(V.CABLE_MAX_M, Math.max(V.CABLE_MIN_M, v)); }, { min: V.CABLE_MIN_M, max: V.CABLE_MAX_M, unit: 'm' });
    selectField(b, 'Far end', S.TERMINATIONS, () => P.cable.termination, (v) => { P.cable.termination = v; });
  }
  let chainList = null;
  { const b = devBoxes.chain;
    chainList = el('ol', 'vl-chain', null, { 'aria-label': 'Chain items, nearest the VNA first' });
    const add = selectField(b, 'Add an item', S.vnaChainPresets(), () => addSel.s.value, () => {});
    const addSel = add; b.append(chainList);
    btn(b, 'Add to chain', () => { if (P.chain.items.length < 4) P.chain.items.push(addSel.s.value); }, 'Up to 4 items');
    selectField(b, 'Path (splitters, couplers)', S.PATHS, () => P.chain.path, (v) => { P.chain.path = v; });
    selectField(b, 'Far end', S.TERMINATIONS, () => P.chain.termination, (v) => { P.chain.termination = v; });
    numberField(b, 'Filter centre', () => P.chain.filterCentreMHz, (v) => { P.chain.filterCentreMHz = Math.max(30, v); }, { min: 30, unit: 'MHz' });
    numberField(b, 'Filter bandwidth', () => P.chain.filterBandwidthMHz, (v) => { P.chain.filterBandwidthMHz = Math.max(1, v); }, { min: 1, unit: 'MHz' });
  }
  selectField(devBoxes.standard, 'Standard', S.STANDARDS.map((s) => [s.id, s.label]), () => P.standard, (v) => { P.standard = v; });

  // ---- sweep ----------------------------------------------------------------------------------------------------------------------------
  const gSw = group('Sweep', 'Presets cover the UHF mic bands, 1.8 GHz and 2.4 GHz.');
  selectField(gSw, 'Preset', [...Object.entries(V.SWEEP_PRESETS).map(([id, p]) => [id, p.label]), ['custom', 'Custom']], () => P.sweep.preset, (v) => S.setSweepPreset(P, v));
  numberField(gSw, 'Start', () => P.sweep.startMHz, (v) => S.setSweepRange(P, v, P.sweep.stopMHz, P.sweep.points), { min: V.SWEEP_MIN_MHZ, max: V.SWEEP_MAX_MHZ, unit: 'MHz' });
  numberField(gSw, 'Stop', () => P.sweep.stopMHz, (v) => S.setSweepRange(P, P.sweep.startMHz, v, P.sweep.points), { min: V.SWEEP_MIN_MHZ, max: V.SWEEP_MAX_MHZ, unit: 'MHz' });
  numberField(gSw, 'Points', () => P.sweep.points, (v) => S.setSweepRange(P, P.sweep.startMHz, P.sweep.stopMHz, Math.round(v)), { min: V.SWEEP_MIN_POINTS, max: V.SWEEP_MAX_POINTS, step: 1 });
  const zoomBtn = btn(gSw, 'Zoom on the antenna band', () => S.sweepAroundAntenna(P), 'Sweep from about half to one and a half times the design band');

  // ---- calibration ----------------------------------------------------------------------------------------------------------------------
  const gCal = group('Calibration', 'Open, short and load standards at the connector. Skip it, or use the wrong plane, to see the errors.');
  selectField(gCal, 'Scenario', V.CAL_STATES.map((s) => [s, V.CAL_LABELS[s]]), () => P.cal.scenario, (v) => { P.cal.scenario = v; });
  const steps = el('div', 'vl-steps', null, { role: 'group', 'aria-label': 'Calibration steps' }), stepBtns = {};
  for (const s of S.CAL_STEPS) {
    const b = el('button', null, '', { type: 'button', 'aria-pressed': 'false' });
    b.addEventListener('click', () => { S.calMeasure(P, s); changed(); sync(); }); steps.append(b); stepBtns[s] = b;
  }
  const calStatus = el('p', 'vl-hint');
  btn(steps, 'Measure all three', () => S.calMeasureAll(P)); btn(steps, 'Reset calibration', () => S.calReset(P));
  gCal.append(steps, calStatus);
  selectField(gCal, 'Extra cable (bad plane)', S.cableOptions(), () => P.cal.extraCableId, (v) => { P.cal.extraCableId = v; });
  numberField(gCal, 'Extra cable length', () => P.cal.extraLengthM, (v) => { P.cal.extraLengthM = Math.min(V.CABLE_MAX_M, Math.max(V.CABLE_MIN_M, v)); }, { min: V.CABLE_MIN_M, max: V.CABLE_MAX_M, unit: 'm' });
  numberField(gCal, 'Port extension', () => P.portExtensionNs, (v) => { P.portExtensionNs = Math.min(200, Math.max(-200, v)); }, { min: -200, max: 200, step: 0.1, unit: 'ns' });
  btn(gCal, 'Extend by the extra cable delay', () => { P.portExtensionNs = S.extensionForExtraCable(P); }, 'Removes the extra cable phase rotation (one way delay)');

  // ---- fault picker and card ------------------------------------------------------------------------------------------------------------
  const gF = group('Fault', 'Pick a fault to see what it does to the traces. The ideal device is overlaid for comparison.');
  const faultSel = selectField(gF, 'Fault', [], () => P.fault.id, (v) => { P.fault = { id: v, params: {} }; });
  const paramBox = el('div', 'vl-sub');
  gF.append(paramBox);
  const overlay = el('label', 'vl-chk'), overlayCb = el('input', null, null, { type: 'checkbox' });
  overlayCb.addEventListener('change', () => { P.overlayIdeal = overlayCb.checked; if (P.overlayIdeal) S.clearMemory(P); changed(); sync(); });
  overlay.append(overlayCb, el('span', null, 'Overlay the ideal device (no fault) as the memory trace')); gF.append(overlay);
  const memRow = el('div', 'vl-steps'); gF.append(memRow);
  btn(memRow, 'Store this trace in memory', () => S.storeMemory(P, C)); btn(memRow, 'Clear memory', () => S.clearMemory(P));
  const card = el('section', 'vl-card', null, { 'aria-label': 'Fault card' }); gF.append(card);
  syncs.push(() => { overlayCb.checked = P.overlayIdeal; });

  function buildFaultControls() {
    const groups = S.faultChoices(P).map(([dev, items]) => ({ group: dev === 'measurement' ? 'Measurement mistakes' : dev[0].toUpperCase() + dev.slice(1) + ' faults', items }));
    faultSel.fill([['', 'None (ideal device)'], ...groups]);
    paramBox.textContent = '';
    for (const k of S.faultParamKeys(P.fault.id)) {
      const dflt = V.FAULTS[P.fault.id].params[k];
      const w = el('label', 'vl-ctl'), i = el('input', null, null, { type: 'number', step: 'any' });
      i.placeholder = dflt == null ? (k === 'posM' ? 'middle' : '') : String(dflt);
      i.value = Number.isFinite(P.fault.params[k]) ? String(P.fault.params[k]) : '';
      i.addEventListener('change', () => { const v = parseFloat(i.value); if (Number.isFinite(v)) P.fault.params[k] = v; else delete P.fault.params[k]; changed(); });
      w.append(el('span', 'vl-lab', S.PARAM_LABELS[k] || k), i); paramBox.append(w);
    }
  }
  function renderCard() {
    card.textContent = '';
    const f = C.fault;
    if (!f) { card.append(el('p', 'vl-hint', 'No fault selected: the ideal device is shown.')); return; }
    card.append(el('h3', null, f.label));
    if (!C.faultApplicable) { card.append(el('p', 'vl-bad', C.faultNote)); return; }
    const dl = el('dl');
    for (const [k, t] of [['Cause', f.cause], ['What you see', f.symptom], ['Cure', f.cure], ['In a mic or IEM link', f.link]]) { dl.append(el('dt', null, k), el('dd', null, t)); }
    card.append(dl);
    const pos = S.faultPositionNote(P, C); if (pos) card.append(el('p', 'vl-hint', pos));
    const fr = V.faultPlannerFigures(S.dutOf(P), f.id, S.faultParams(P), P.markers[P.active] ? P.markers[P.active].fMHz : (P.sweep.startMHz + P.sweep.stopMHz) / 2);
    if (fr) {
      const bits = [];
      if (fr.extraCableLossDb != null) bits.push(`extra cable loss ${S.fmtNum(fr.extraCableLossDb)} dB`);
      if (fr.antennaVswr != null) bits.push(`antenna VSWR ${S.fmtNum(fr.antennaVswr, 2)}:1, mismatch ${S.fmtNum(fr.antennaMismatchDb)} dB, extra loss ${S.fmtNum(fr.antennaExtraLossDb)} dB`);
      bits.push(`return loss ${S.fmtNum(fr.returnLossDb)} dB`);
      card.append(el('p', 'vl-hint', `Planner figures at the marker frequency: ${bits.join('; ')}.`));
    }
    card.append(el('p', 'vl-hint', 'All fault figures are assumed teaching values (flag U), not measurements.'));
  }

  // ---- main area: status, alerts, plots --------------------------------------------------------------------------------------------------
  const tabs = el('div', 'vl-tabs', null, { role: 'group', 'aria-label': 'Trace' }), tabBtns = {};
  for (const p of S.PLOTS) { const b = el('button', 'vl-tab', p.label, { type: 'button', 'aria-pressed': 'false' }); b.addEventListener('click', () => { P.plot = p.id; changed(); sync(); }); tabs.append(b); tabBtns[p.id] = b; }
  const hint = el('p', 'vl-hint', 'Plot keys: Left and Right move the active marker (Shift = 10 points), M adds a marker, Delete removes it, 1 to 4 selects, N and X jump to the minimum or maximum. You can also click or drag on the plot.', { id: 'vl-keys' });
  const rectCv = el('canvas', 'vl-canvas vl-rect', null, { tabindex: '0', role: 'application', 'aria-roledescription': 'marker plot', 'aria-describedby': 'vl-keys', 'aria-label': 'Trace plot' });
  const smithCv = el('canvas', 'vl-canvas vl-smith', null, { tabindex: '0', role: 'application', 'aria-roledescription': 'marker plot', 'aria-describedby': 'vl-keys', 'aria-label': 'Smith chart' });
  const dtfCv = el('canvas', 'vl-canvas vl-dtf', null, { role: 'img', 'aria-label': 'Distance to fault' });
  const row = el('div', 'vl-row'); row.append(rectCv, smithCv);
  const dtfCtl = el('div', 'vl-controls-row'); selectField(dtfCtl, 'DTF window', S.WINDOWS, () => P.dtfWindow, (v) => { P.dtfWindow = v; });
  const mk = el('section', 'vl-markers', null, { 'aria-label': 'Markers' });
  const mkBar = el('div', 'vl-steps'); mk.append(el('h3', null, 'Markers (up to 4)'), mkBar);
  btn(mkBar, 'Add marker', () => S.addMarker(P, P.markers.length ? undefined : 600)); btn(mkBar, 'Remove active marker', () => S.removeMarker(P));
  btn(mkBar, 'Active marker to minimum', () => S.searchMarker(P, P.active, 'min', C.traces)); btn(mkBar, 'Active marker to maximum', () => S.searchMarker(P, P.active, 'max', C.traces));
  const mkWrap = el('div', 'vl-tablewrap'), mkTable = el('table', 'vl-table'), mkHead = el('thead'), mkBody = el('tbody');
  mkTable.append(el('caption', null, 'Marker readouts'), mkHead, mkBody); mkWrap.append(mkTable); mk.append(mkWrap);
  const read = el('p', 'vl-read', '', { 'aria-live': 'polite' });
  mk.append(read);
  mkHead.innerHTML = '<tr><th scope="col">Marker</th><th scope="col">Frequency (MHz)</th><th scope="col">Return loss</th><th scope="col">VSWR</th><th scope="col">Impedance</th><th scope="col">S11 phase</th><th scope="col">S21</th><th scope="col">Delay</th><th scope="col">Radiation efficiency</th></tr>';
  let mkInputs = [];
  function buildMarkerRows() {
    mkBody.textContent = ''; mkInputs = [];
    P.markers.forEach((m, i) => {
      const tr = el('tr'), th = el('th', null, null, { scope: 'row' });
      const b = el('button', null, `Marker ${i + 1}`, { type: 'button', 'aria-pressed': String(i === P.active) }); b.addEventListener('click', () => { S.selectMarker(P, i); changed(); });
      th.append(b);
      const td = el('td'), inp = el('input', null, null, { type: 'number', step: 'any', 'aria-label': `Marker ${i + 1} frequency in MHz` });
      inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (Number.isFinite(v)) S.setMarker(P, i, v); changed(); });
      td.append(inp); tr.append(th, td); for (let k = 0; k < 7; k++) tr.append(el('td'));
      mkBody.append(tr); mkInputs.push(inp);
    });
  }

  // tables, one per plot
  function tableBlock(id, title, makeTable) {
    const d = el('details', 'vl-details'), s = el('summary', null, `Table: ${title}`), wrap = el('div', 'vl-tablewrap');
    d.append(s, wrap);
    d.addEventListener('toggle', () => { if (d.open) { tableOpen.add(id); fillTable(); } else tableOpen.delete(id); });
    const fillTable = () => { if (d.open) { wrap.textContent = ''; wrap.append(makeTable()); } };
    return { d, fill: fillTable };
  }
  function simpleTable(caption, cols, rows) {
    const t = el('table', 'vl-table'), head = el('thead'), tr = el('tr'), tb = el('tbody');
    t.append(el('caption', null, caption));
    for (const c of cols) tr.append(el('th', null, c, { scope: 'col' })); head.append(tr);
    for (const r of rows) { const x = el('tr'); for (const v of r) x.append(el('td', null, v)); tb.append(x); }
    t.append(head, tb); return t;
  }
  const tblRect = tableBlock('rect', 'selected trace against frequency', () => {
    const spec = S.plotSpec(C.traces, C.memory && C.memory.traces, P.plot);
    if (!spec.ys) return el('p', 'vl-hint', spec.note || 'No data');
    const rows = S.plotTable(spec).map((r) => [String(+r.fMHz.toFixed(3)), S.fmtNum(r.value, 2), r.mem == null ? '-' : S.fmtNum(r.mem, 2)]);
    return simpleTable(`${spec.yName}: every ${Math.max(1, Math.ceil(spec.xs.length / 101))} point(s)`, ['Frequency (MHz)', `${spec.yName} measured`, `${spec.yName} memory`], rows);
  });
  const tblSmith = tableBlock('smith', 'Smith chart (reflection and impedance)', () => simpleTable('Reflection coefficient and impedance', ['Frequency (MHz)', 'Re(S11)', 'Im(S11)', 'R (ohm)', 'X (ohm)'],
    S.smithTable(C.traces).map((r) => [String(+r.fMHz.toFixed(3)), S.fmtNum(r.re, 3), S.fmtNum(r.im, 3), S.fmtNum(r.r, 1), S.fmtNum(r.x, 1)])));
  const tblDtf = tableBlock('dtf', 'distance to fault', () => {
    const t = simpleTable('Reflection against distance', ['Distance (m)', 'Reflection (dB)'], S.dtfTable(C.dtf).map((r) => [S.fmtNum(r.distanceM, 2), S.fmtNum(r.db, 1)]));
    const w = el('div'); w.append(t, el('p', 'vl-hint', `Peaks: ${C.dtf.dtf.peaks.slice(0, 8).map((p) => `${p.distanceM.toFixed(2)} m (${S.fmtNum(20 * Math.log10(Math.max(1e-4, p.magnitude)), 1)} dB)`).join(', ') || 'none'}.`)); return w;
  });
  const how = el('section', 'vl-how'); how.append(el('h3', null, 'How to read the traces'));
  const howList = el('ul'); for (const t of [
    'Return loss (S11 dB): a deep dip is a good match. 14 dB or better (VSWR 1.5) is good, 9.5 dB (VSWR 2) is usable.',
    'A hand or wet antenna can look better on S11 because the body absorbs the power. Check the radiation efficiency next to the return loss.',
    'A cable shows ripples on S11: the spacing in MHz gives the length. The distance-to-fault trace shows the same thing as peaks at the fault distance.',
    'S21 is the loss through a two-port (cable, filter, splitter) and S21 group delay shows how much a filter smears the signal.',
    'Uncalibrated or wrong-plane results rotate on the Smith chart: calibrate at the connector you are testing.',
  ]) howList.append(el('li', null, t));
  how.append(howList);
  main.append(status, tabs, row, hint, dtfCv, dtfCtl, mk, tblRect.d, tblSmith.d, tblDtf.d, how);
  row.before(el('h3', 'vl-h', 'S11 and S21 traces'));

  // ---- canvases ---------------------------------------------------------------------------------------------------------------------------
  const memTraces = () => (C.memory ? C.memory.traces : null);
  const rectHost = createCanvasHost(rectCv, (ctx, w, h, th) => { geo.rect = drawRect(ctx, w, h, th, S.plotSpec(C.traces, memTraces(), P.plot), { markers: P.markers, active: P.active, labelMemory: C.memory ? C.memory.label : 'memory' }); });
  const smithHost = createCanvasHost(smithCv, (ctx, w, h, th) => { geo.smith = drawSmith(ctx, w, h, th, C.traces, memTraces(), { markers: P.markers, active: P.active }); });
  const dtfHost = createCanvasHost(dtfCv, (ctx, w, h, th) => {
    const note = S.faultPositionNote(P, C), pos = note && C.cfg.dut.type === 'cable' ? (Number.isFinite(P.fault.params.posM) ? P.fault.params.posM : 0.5 * C.cfg.dut.lengthM) : null;
    drawDtf(ctx, w, h, th, C.dtf, { faultM: pos });
  });
  const hosts = [rectHost, smithHost, dtfHost];
  const invalidateAll = () => hosts.forEach((h) => h.invalidate());

  function fAtRect(e) {
    const r = rectCv.getBoundingClientRect(), g = geo.rect; if (!g) return null;
    const x = Math.min(g.L + g.pw, Math.max(g.L, e.clientX - r.left));
    return g.xMin + ((x - g.L) / g.pw) * (g.xMax - g.xMin);
  }
  function fAtSmith(e) {
    const r = smithCv.getBoundingClientRect(), g = geo.smith; if (!g) return null;
    const gx = (e.clientX - r.left - g.cx) / g.R, gy = -(e.clientY - r.top - g.cy) / g.R;
    let best = 0, bd = Infinity;
    C.traces.smith.forEach((s, i) => { const d = (s.x - gx) ** 2 + (s.y - gy) ** 2; if (d < bd) { bd = d; best = i; } });
    return C.traces.fMHz[best];
  }
  function placeMarker(f) {
    if (f == null) return;
    if (P.active < 0 || !P.markers[P.active]) S.addMarker(P, f); else S.setMarker(P, P.active, f);
    changed();
  }
  for (const [cv, fn] of [[rectCv, fAtRect], [smithCv, fAtSmith]]) {
    let drag = false;
    cv.addEventListener('pointerdown', (e) => { drag = true; try { cv.setPointerCapture(e.pointerId); } catch { /* not supported */ } cv.focus(); placeMarker(fn(e)); });
    cv.addEventListener('pointermove', (e) => { if (drag) placeMarker(fn(e)); });
    cv.addEventListener('pointerup', () => { drag = false; }); cv.addEventListener('pointercancel', () => { drag = false; });
    cv.addEventListener('keydown', (e) => { if (handlePlotKey(P, e.key, e.shiftKey, C)) { e.preventDefault(); changed(); } });
  }

  // ---- update ------------------------------------------------------------------------------------------------------------------------------
  function sync() { for (const f of syncs) f(); }
  function changed() { if (raf) return; raf = (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 0))(() => { raf = 0; update(); }); }
  let lastDevice = null, lastFaultKey = '';
  function update() {
    C = S.compute(P);
    for (const [id, b] of Object.entries(devBoxes)) b.hidden = id !== P.device;
    zoomBtn.hidden = P.device !== 'antenna';
    if (lastDevice !== P.device) { lastDevice = P.device; }
    const fk = `${P.device}|${P.fault.id}|${P.chain.items.join()}`;
    if (fk !== lastFaultKey) { lastFaultKey = fk; buildFaultControls(); sync(); }
    // chain list
    chainList.textContent = '';
    P.chain.items.forEach((id, i) => {
      const li = el('li'), name = (S.vnaChainPresets().find((p) => p[0] === id) || [id, id])[1];
      li.append(el('span', null, name + ' '));
      const rm = el('button', null, 'Remove', { type: 'button', 'aria-label': `Remove ${name}` }); rm.addEventListener('click', () => { if (P.chain.items.length > 1) { P.chain.items.splice(i, 1); changed(); } });
      li.append(rm); chainList.append(li);
    });
    // calibration
    for (const s of S.CAL_STEPS) { const done = P.cal.done[s]; stepBtns[s].textContent = `${done ? 'Measured: ' : 'Measure '}${s}`; stepBtns[s].setAttribute('aria-pressed', String(done)); }
    calStatus.textContent = P.cal.scenario === 'none' ? 'Not calibrated: raw VNA readings.' : `${S.calStepsDone(P)} of 3 calibration steps done. ${S.calStepsDone(P) === 3 ? C.calLabel : 'Raw readings until all three are measured.'}`;
    // tabs
    for (const p of S.PLOTS) tabBtns[p.id].setAttribute('aria-pressed', String(P.plot === p.id));
    // status and alerts
    const sum = S.summaryText(P, C);
    status.textContent = sum; rectCv.setAttribute('aria-label', `Trace plot. ${sum}`); smithCv.setAttribute('aria-label', `Smith chart. ${sum}`);
    dtfCv.setAttribute('aria-label', `Distance to fault. Peaks at ${C.dtf.dtf.peaks.slice(0, 4).map((p) => p.distanceM.toFixed(2) + ' m').join(', ') || 'none'}.`);
    const sig = JSON.stringify(C.warnings);
    if (alerts.dataset.sig !== sig) {
      alerts.dataset.sig = sig; alerts.textContent = '';
      for (const w of C.warnings) { const d = el('p', `vl-alert vl-${w.level}`); d.append(el('strong', null, w.level === 'danger' ? 'DANGER: ' : 'Warning: '), doc.createTextNode(w.text)); if (w.level === 'danger') d.setAttribute('role', 'alert'); alerts.append(d); }
      alerts.hidden = C.warnings.length === 0;
    }
    renderCard();
    // markers
    if (mkInputs.length !== P.markers.length || mkBody.querySelectorAll('button').length !== P.markers.length) buildMarkerRows();
    const rows = S.markerTableRows(P, C), mr = S.markerRows(P, C);
    [...mkBody.children].forEach((tr, i) => {
      const r = rows[i], c = tr.children; if (!r) return;
      tr.querySelector('button').setAttribute('aria-pressed', String(i === P.active));
      if (doc.activeElement !== mkInputs[i]) mkInputs[i].value = String(+P.markers[i].fMHz.toFixed(3));
      [r.returnLoss, r.vswr, r.impedance, r.phase, r.s21, r.delay, r.efficiency].forEach((t, k) => { c[k + 2].textContent = t; });
    });
    const a = mr[P.active];
    read.textContent = a ? `Marker ${a.n}: ${a.text}${a.il ? ' ' + a.il.text : ''}${a.efficiencyDb != null ? ` Radiation efficiency ${S.fmtNum(a.efficiencyDb)} dB (power absorbed by the hand or water instead of radiated).` : ''}` : 'Add a marker to read values at a frequency.';
    read.dataset.verdict = a ? a.verdict : '';
    for (const t of [tblRect, tblSmith, tblDtf]) t.fill();
    sync(); invalidateAll();
  }

  // ---- open / close --------------------------------------------------------------------------------------------------------------------------
  function openLab() {
    if (open) return; open = true; lastFocus = doc.activeElement;
    container.hidden = false; openButton?.setAttribute('aria-expanded', 'true'); doc.body.classList.add('vnalab-open');
    update(); closeBtn.focus();
  }
  function closeLab() {
    if (!open) return; open = false; container.hidden = true; openButton?.setAttribute('aria-expanded', 'false'); doc.body.classList.remove('vnalab-open');
    (lastFocus && lastFocus.focus ? lastFocus : openButton)?.focus();
  }
  closeBtn.addEventListener('click', closeLab);
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeLab(); return; }
    if (e.key === 'Tab') { // keep focus inside the dialog
      const f = [...container.querySelectorAll('button:not([hidden]), input, select, summary, canvas[tabindex]')].filter((n) => !n.disabled && n.offsetParent !== null);
      if (!f.length) return; const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && doc.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && doc.activeElement === z) { e.preventDefault(); a.focus(); }
    }
  });
  openButton?.addEventListener('click', () => (open ? closeLab() : openLab()));
  doc.addEventListener('rf-theme', invalidateAll);
  container.hidden = true;
  buildFaultControls(); update();
  return { open: openLab, close: closeLab, isOpen: () => open, state: P, compute: () => C, destroy() { closeLab(); hosts.forEach((h) => h.destroy()); } };
}

/** Marker keys for the plot canvases (pure: returns true when the key was handled). Exported for the tests. */
export function handlePlotKey(P, key, shift, C) {
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (k === 'ArrowLeft' || k === 'ArrowRight') { if (P.active < 0) return false; S.nudgeMarker(P, P.active, (k === 'ArrowLeft' ? -1 : 1) * (shift ? 10 : 1)); return true; }
  if (k === 'm') { S.addMarker(P); return true; }
  if (k === 'Delete' || k === 'Backspace') return S.removeMarker(P);
  if (k >= '1' && k <= '4') { S.selectMarker(P, +k - 1); return true; }
  if (k === 'n' || k === 'x') { if (P.active < 0) S.addMarker(P); S.searchMarker(P, P.active, k === 'n' ? 'min' : 'max', C.traces); return true; }
  return false;
}
