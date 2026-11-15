// Measurements pop-out (walk-test calibration): a table of readings with the model's prediction and the delta, add / place-on-plan / import,
// a summary, a measured-vs-predicted chart and calibration cards with cautions and an undoable Apply. The model lives in js/model/measurements.js;
// this file only draws and calls the actions. DOM and canvas host are injected so it runs under the tests' minimal fake DOM.
import { createCanvasHost, setFont, haloText } from './util.js';
import { createZoom } from './spectraZoom.js';
import { suggestCalibration, predictAt } from '../model/measurements.js';
import { MEASUREMENT_LIMITS } from '../model/measurement-schema.js';
import { addMeasurement, updateMeasurement, removeMeasurement, clearMeasurements, importMeasurements, applyCalibration } from '../actionsAreas.js';
import { cachedCompare, summaryText, tableRows, cardViews, calibrationNotes, chartLayout, deltaColor } from '../ui/measureUi.js';
import { startPlace } from './placeMode.js';

/** Draw the measured-vs-predicted chart. Exported for tests. */
export function drawChart(ctx, w, h, th, scene, cmp, mode) {
  ctx.fillStyle = th.paper; ctx.fillRect(0, 0, w, h);
  if (!cmp || !cmp.n) { setFont(ctx, th, 13); ctx.fillStyle = th.inkSoft; ctx.fillText('No readings to chart yet.', 16, 30); return null; }
  const L = chartLayout(scene, cmp, mode, w, h);
  ctx.strokeStyle = th.grid; ctx.lineWidth = 1; setFont(ctx, th, 12); ctx.fillStyle = th.inkSoft; ctx.textAlign = 'right';
  for (let v = L.dMin; v <= L.dMax; v += 5 * Math.max(1, Math.ceil((L.dMax - L.dMin) / 40))) { const y = L.sy(v); ctx.beginPath(); ctx.moveTo(L.x0, y); ctx.lineTo(L.x1, y); ctx.stroke(); ctx.fillText(`${v}`, L.x0 - 6, y + 4); }
  ctx.textAlign = 'left'; ctx.strokeStyle = th.ink; ctx.strokeRect(L.x0 + 0.5, L.y0 + 0.5, L.x1 - L.x0, L.y1 - L.y0);
  ctx.fillStyle = th.ink; ctx.fillText('dBm at the receiver input', 4, 14);
  ctx.textAlign = 'center'; ctx.fillText(mode === 'distance' ? 'distance from the transmitter (m)' : 'reading number (order of the table)', (L.x0 + L.x1) / 2, L.y1 + 32); ctx.textAlign = 'left';
  const xt = mode === 'distance' ? 5 : 1; ctx.fillStyle = th.inkSoft;
  for (let v = Math.ceil(L.xMin / xt) * xt; v <= L.xMax; v += Math.max(xt, Math.ceil((L.xMax - L.xMin) / 10 / xt) * xt)) { const x = L.sx(v); ctx.textAlign = 'center'; ctx.fillText(`${v}`, x, L.y1 + 16); ctx.beginPath(); ctx.moveTo(x, L.y1); ctx.lineTo(x, L.y1 + 4); ctx.stroke(); }
  ctx.textAlign = 'left';
  // predicted: a thin dark line with open squares; measured: filled circles in the delta colour; the gap is a vertical bar
  ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.beginPath(); L.pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.yp) : ctx.moveTo(q.x, q.yp))); ctx.stroke();
  for (const q of L.pts) {
    const col = deltaColor(q.p.deltaDb, th.dark);
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(q.x, q.yp); ctx.lineTo(q.x, q.ym); ctx.stroke();
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(q.x - 3, q.yp - 3, 6, 6);
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(q.x, q.ym, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = th.paper; ctx.stroke();
  }
  ctx.lineWidth = 1;
  // legend with words
  const lx = L.x1 - 300, ly = L.y0 + 6;
  ctx.fillStyle = th.paper; ctx.globalAlpha = 0.85; ctx.fillRect(lx - 4, ly - 4, 304, 38); ctx.globalAlpha = 1;
  ctx.strokeStyle = th.ink; ctx.strokeRect(lx + 3, ly + 3, 6, 6); haloText(ctx, th, 'predicted (square, line)', lx + 16, ly + 10, { px: 12 });
  ctx.fillStyle = th.ink; ctx.beginPath(); ctx.arc(lx + 6, ly + 25, 4.5, 0, Math.PI * 2); ctx.fill(); haloText(ctx, th, 'measured (dot, coloured by delta); bar = delta', lx + 16, ly + 29, { px: 12 });
  return L;
}

export function mountMeasure({ doc = document, button, store, hostFactory = (c, d) => createCanvasHost(c, d), suggest = suggestCalibration } = {}) {
  const el = (tag, cls, text, attrs) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const st = { mode: 'order', status: '', importErrors: [], focusId: null };
  let sugKey = null, sugVal = null, rowSig = null;
  const rowEls = new Map(); // id -> { pred, delta, chip, inputs }

  const scene = () => store.getScene();
  const cmpNow = () => cachedCompare(scene());
  const suggestion = () => { const s = scene(); if (!(s.measurements || []).length) return null; const k = JSON.stringify(s); if (k !== sugKey) { sugKey = k; try { sugVal = suggest(s); } catch (e) { sugVal = null; } } return sugVal; };

  const zoom = createZoom({
    doc, hostFactory: (canvas, d) => hostFactory(canvas, (ctx, w, h, th) => d(ctx, w, h, th)),
    describe: () => { const c = cmpNow(); return { title: 'Measurements', summary: summaryText(c) }; },
    table: () => {
      const s = scene(), c = cmpNow();
      return { caption: 'Measured and predicted levels', cols: ['Reading', 'Position', 'Measured dBm', 'Predicted dBm', 'Delta'], rows: tableRows(s, c).map((r) => [`${r.n}${r.note ? ` ${r.note}` : ''}`, `x ${r.x}, y ${r.y}`, r.rxDbm, r.predictedDbm == null ? '-' : r.predictedDbm.toFixed(1), r.view.label]) };
    },
    draw: (id, ctx, w, h, th) => { drawChart(ctx, w, h, th, scene(), cmpNow(), st.mode); },
    onClose: () => {},
  });
  const dlg = zoom.dialog, canvas = zoom.canvas;
  dlg.className = `${dlg.className || ''} meas-dialog`.trim();
  canvas.className = 'meas-canvas';
  canvas.setAttribute('tabindex', '0');

  const wrap = el('div', 'meas-body');
  zoom.slot.append(wrap);

  // ---- toolbar
  const bar = el('div', 'meas-bar');
  const mk = (text, title, fn, cls) => { const b = el('button', cls || null, text, { type: 'button', title }); b.addEventListener('click', fn); return b; };
  const linkSel = el('select', null, null, { 'aria-label': 'Link new readings belong to' });
  const linkLab = el('label', 'meas-link'); linkLab.append(el('span', null, 'Link '), linkSel);
  const modeSel = el('select', null, null, { 'aria-label': 'Chart x axis' });
  for (const [v, t] of [['order', 'by reading number'], ['distance', 'by distance from the transmitter']]) modeSel.append(el('option', null, t, { value: v }));
  modeSel.addEventListener('change', () => { st.mode = modeSel.value; zoom.update(); });
  const modeLab = el('label'); modeLab.append(el('span', null, 'Chart '), modeSel);
  const linkId = () => linkSel.value || (scene().links[0] || {}).id;

  const addRow = () => {
    const s = scene(), id = linkId(), l = s.links.find((x) => x.id === id);
    if (!l) { setStatus('Add a link first: a reading belongs to a link.'); return; }
    const p = { x: l.rx.pos.x, y: l.rx.pos.y, z: l.rx.pos.z };
    const pred = predictAt(s, id, p);
    const mid = addMeasurement(store, { linkId: id, x: p.x, y: p.y, rxDbm: Number.isFinite(pred) ? Math.round(pred * 10) / 10 : -60 });
    if (mid) { st.focusId = mid; setStatus('Reading added at the receiver position. Edit its position and level.'); refresh(true); } else setStatus(`No reading added (limit ${MEASUREMENT_LIMITS.max}).`);
  };
  const placeBtn = mk('Place on plan', 'Close this window and click the plan where you took a reading', () => {
    const id = linkId();
    zoom.close(false);
    startPlace((w) => {
      const s = scene(), pred = predictAt(s, id, { x: w.x, y: w.y });
      const mid = addMeasurement(store, { linkId: id, x: Math.round(w.x * 100) / 100, y: Math.round(w.y * 100) / 100, rxDbm: Number.isFinite(pred) ? Math.round(pred * 10) / 10 : -60 });
      st.focusId = mid; st.status = mid ? 'Reading placed. Enter the level you measured.' : 'No reading added.';
      reopen();
    }, { message: 'Place measurement: click the plan where you took the reading. Escape cancels.', onCancel: () => { st.status = 'Placing cancelled.'; reopen(); } });
  });
  const addBtn = mk('Add reading', 'Add a reading at the receiver position, then edit it', addRow);
  const clearBtn = mk('Clear all', 'Remove every reading (undo restores them)', () => { clearMeasurements(store); setStatus('All readings cleared. Undo restores them.'); refresh(true); });
  bar.append(addBtn, placeBtn, clearBtn, linkLab, modeLab);

  const status = el('p', 'meas-status', '', { role: 'status', 'aria-live': 'polite' });
  const setStatus = (t) => { st.status = t; status.textContent = t; };

  // ---- table
  const tableWrap = el('div', 'meas-tablewrap', null, { tabindex: '-1' });
  // ---- import
  const imp = el('details', 'meas-import'); imp.append(el('summary', null, 'Import from CSV'));
  const ta = el('textarea', 'meas-csv', null, { rows: '4', 'aria-label': 'Paste CSV readings: x, y, dBm, note', placeholder: 'x, y, dBm, note\n4.0, 2.5, -61.5, front row' });
  const fileIn = el('input', null, null, { type: 'file', accept: '.csv,text/csv,text/plain', 'aria-label': 'Choose a CSV file' });
  const replChk = el('input', null, null, { type: 'checkbox' }); const replLab = el('label'); replLab.append(replChk, el('span', null, ' Replace existing readings'));
  const impBtn = mk('Import', 'Import the pasted CSV text', () => doImport(ta.value));
  const errList = el('ul', 'meas-errors', null, { role: 'alert' });
  const impBar = el('div', 'meas-bar'); impBar.append(fileIn, replLab, impBtn); imp.append(ta, impBar, errList);
  function doImport(text) {
    if (!String(text || '').trim()) { st.importErrors = ['Nothing to import: paste CSV text or choose a file.']; renderErrors(); return; }
    const r = importMeasurements(store, text, { linkId: linkId(), replace: !!replChk.checked });
    st.importErrors = r.errors || [];
    setStatus(`${r.added} reading${r.added === 1 ? '' : 's'} imported${st.importErrors.length ? `, ${st.importErrors.length} problem${st.importErrors.length === 1 ? '' : 's'} listed below` : ''}.`);
    if (r.added) ta.value = '';
    renderErrors(); refresh(true);
  }
  function renderErrors() { errList.textContent = ''; for (const e of st.importErrors.slice(0, 30)) errList.append(el('li', null, e)); if (st.importErrors.length > 30) errList.append(el('li', null, `and ${st.importErrors.length - 30} more`)); if (st.importErrors.length) imp.open = true; }
  fileIn.addEventListener('change', () => {
    const f = fileIn.files && fileIn.files[0]; if (!f) return;
    if (f.size > 1e6) { st.importErrors = ['That file is larger than 1 MB; it was not read.']; renderErrors(); return; }
    const done = (t) => { ta.value = String(t); doImport(String(t)); fileIn.value = ''; };
    if (typeof f.text === 'function') f.text().then(done, () => { st.importErrors = ['The file could not be read.']; renderErrors(); });
    else if (typeof FileReader === 'function') { const fr = new FileReader(); fr.onload = () => done(fr.result); fr.onerror = () => { st.importErrors = ['The file could not be read.']; renderErrors(); }; fr.readAsText(f); }
  });

  // ---- calibration
  const calib = el('section', 'meas-calib', null, { 'aria-label': 'Calibration suggestions' });

  wrap.append(bar, status, tableWrap, imp, calib);

  // ---- rendering
  function buildTable() {
    const s = scene(), list = s.measurements || [];
    tableWrap.textContent = ''; rowEls.clear();
    if (!list.length) { tableWrap.append(el('p', 'hint', 'No readings yet. Use Add reading, Place on plan or Import from CSV. Each reading is the level you measured with the receiver at a known position.')); return; }
    const t = el('table', 'meas-table'), cap = el('caption', null, 'Readings: edit a value and press Tab or Enter to apply. Delta = measured minus predicted.');
    const hr = el('tr'); for (const c of ['#', 'x (m)', 'y (m)', 'Measured dBm', 'Note', 'Predicted dBm', 'Delta', '']) hr.append(el('th', null, c, { scope: 'col' }));
    const th = el('thead'); th.append(hr); const tb = el('tbody');
    list.forEach((m, i) => {
      const tr = el('tr'); const r = { inputs: {} };
      tr.append(el('th', null, String(i + 1), { scope: 'row' }));
      const num = (key, label, step) => {
        const td = el('td'), inp = el('input', 'meas-in', null, { type: 'number', step: String(step), inputmode: 'decimal', 'aria-label': `Reading ${i + 1} ${label}` });
        inp.value = String(m[key]);
        inp.addEventListener('input', () => { const v = Number(inp.value); if (inp.value !== '' && Number.isFinite(v)) updateMeasurement(store, m.id, { [key]: v }, { coalesce: `meas-${m.id}-${key}` }); });
        inp.addEventListener('change', () => { const v = Number(inp.value); if (inp.value === '' || !Number.isFinite(v)) inp.value = String(scene().measurements.find((x) => x.id === m.id)?.[key] ?? m[key]); });
        r.inputs[key] = inp; td.append(inp); tr.append(td);
      };
      num('x', 'x, metres', 0.1); num('y', 'y, metres', 0.1); num('rxDbm', 'measured level, dBm', 0.1);
      const ntd = el('td'), note = el('input', 'meas-in meas-note', null, { type: 'text', maxlength: String(MEASUREMENT_LIMITS.noteChars), 'aria-label': `Reading ${i + 1} note` });
      note.value = m.note || ''; note.addEventListener('change', () => updateMeasurement(store, m.id, { note: note.value })); r.inputs.note = note; ntd.append(note); tr.append(ntd);
      r.pred = el('td', 'num'); r.delta = el('td', 'meas-delta'); r.chip = el('span', 'meas-chip', '', { 'aria-hidden': 'true' }); r.word = el('span');
      r.delta.append(r.chip, r.word); tr.append(r.pred, r.delta);
      const rtd = el('td'), rm = el('button', 'meas-rm', 'Remove', { type: 'button', 'aria-label': `Remove reading ${i + 1}` });
      rm.addEventListener('click', () => { removeMeasurement(store, m.id); setStatus(`Reading ${i + 1} removed. Undo restores it.`); refresh(true); });
      rtd.append(rm); tr.append(rtd); tb.append(tr); rowEls.set(m.id, r);
    });
    t.append(cap, th, tb); tableWrap.append(t);
  }
  function fillComputed() {
    const s = scene(), c = cmpNow();
    for (const r of tableRows(s, c)) {
      const e = rowEls.get(r.id); if (!e) continue;
      e.pred.textContent = r.predictedDbm == null ? '-' : r.predictedDbm.toFixed(1);
      e.word.textContent = ` ${r.view.label}`;
      e.chip.className = `meas-chip meas-${r.view.sign}`;
      for (const k of ['x', 'y', 'rxDbm']) { const inp = e.inputs[k], src = (s.measurements.find((x) => x.id === r.id) || {})[k]; if (inp && doc.activeElement !== inp && src != null && inp.value !== String(src)) inp.value = String(src); }
    }
  }
  function buildCalib() {
    calib.textContent = '';
    const s = scene(), n = (s.measurements || []).length, sug = suggestion(), c = cmpNow();
    calib.append(el('h3', null, 'Calibration suggestions'));
    if (!n || !c || !c.n) { calib.append(el('p', 'hint', 'Add readings to get a calibration suggestion.')); return; }
    const notes = calibrationNotes(sug, c.n);
    calib.append(el('p', 'meas-headline', notes.headline));
    if (notes.cautions.length) { const box = el('div', 'meas-cautions', null, { role: 'note' }); box.append(el('strong', null, 'Caution')); const ul = el('ul'); for (const t of notes.cautions) ul.append(el('li', null, t)); box.append(ul); calib.append(box); }
    const wrapc = el('div', 'meas-cards');
    for (const v of cardViews(sug)) {
      const card = el('div', `meas-card${v.isBest ? ' best' : ''}${v.applicable ? '' : ' na'}`, null, { role: 'group', 'aria-label': v.label });
      card.append(el('h4', null, v.isBest ? `${v.label} (best fit)` : v.label), el('p', 'meas-change', v.change), el('p', null, v.rms), el('p', null, v.improvement));
      if (v.applicable) {
        const b = el('button', null, `Apply ${v.label}`, { type: 'button', title: 'Write this value to the environment settings; undo restores the old one' });
        b.addEventListener('click', () => { const ok = applyCalibration(store, v.candidate); setStatus(ok ? `${v.label} set to ${v.candidate.fitted.toFixed(1)} dB. Undo restores ${v.candidate.current.toFixed(1)} dB.` : 'That value could not be applied.'); refresh(true); });
        card.append(b);
      } else card.append(el('p', 'meas-reason', `Not applied: ${v.reason}`));
      wrapc.append(card);
    }
    calib.append(wrapc);
  }
  function refresh(structural) {
    if (!zoom.isOpen()) return;
    const s = scene(), list = s.measurements || [];
    const sig = list.map((m) => m.id).join('|') + '#' + s.links.map((l) => l.id).join('|');
    linkSel.textContent = ''; for (const l of s.links) linkSel.append(el('option', null, l.name || l.id, { value: l.id }));
    linkLab.hidden = s.links.length < 2;
    if (structural || sig !== rowSig) { rowSig = sig; buildTable(); }
    fillComputed(); buildCalib(); status.textContent = st.status;
    clearBtn.disabled = !list.length; zoom.update();
    if (st.focusId && rowEls.get(st.focusId)) { const i = rowEls.get(st.focusId).inputs.rxDbm; st.focusId = null; if (i && i.focus) i.focus(); }
  }
  let t = null;
  const unsub = store.subscribe(() => { if (!zoom.isOpen()) return; if (t) return; t = setTimeout(() => { t = null; refresh(false); }, 120); });
  function open(from) {
    zoom.open('meas', from || button);
    if (button && button.setAttribute) button.setAttribute('aria-expanded', 'true');
    rowSig = null; refresh(true);
  }
  function reopen() { open(button); }
  if (button) { button.addEventListener('click', () => open(button)); button.setAttribute('aria-haspopup', 'dialog'); }
  dlg.addEventListener('close', () => { if (button && button.setAttribute) button.setAttribute('aria-expanded', 'false'); });
  return { open, zoom, refresh, st, destroy() { unsub(); if (t) clearTimeout(t); zoom.destroy(); } };
}
