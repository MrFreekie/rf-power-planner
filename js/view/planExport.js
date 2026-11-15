// Frequency plan export pop-out: a table of every link and IMD transmitter with the coordination summary on top, a project name and date,
// Copy text, Download CSV (delimiter and optional UTF-8 BOM) and Print table. Pure helpers (planView, cellText, coordLines, todayISO, downloadName)
// are tested without a DOM; mountPlanExport() builds the dialog on createZoom. The model is js/model/plan-export.js.
import { createCanvasHost } from './util.js';
import { createZoom } from './spectraZoom.js';
import { PLAN_COLUMNS, frequencyPlanRows, frequencyPlanCsv, frequencyPlanText, planSummary, coordinationSummary } from '../model/plan-export.js';

export const DELIMITERS = Object.freeze({ comma: ',', semicolon: ';', tab: '\t' });
export const BW_NOTE = 'Analogue occupied bandwidth is inferred (Carson’s rule at the default ±40 kHz deviation and 15 kHz audio), not read from the transmitter. Digital figures come from the preset.';
const ROLE = { mic: 'Microphone', iem: 'In-ear monitor', other: 'Other' };

export function todayISO(d = new Date()) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
export const downloadName = (name, date, ext = 'csv') => `${String(name || 'frequency-plan').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'frequency-plan'}-${date || 'plan'}.${ext}`;

/** One displayed cell: words rather than codes, '-' for no value. */
export function cellText(row, key) {
  const v = row[key];
  if (key === 'role') return ROLE[v] || String(v || '-');
  if (key === 'assumptionFlag') return v === 'proven' ? 'Proven' : v === 'unproven' ? 'Unproven (assumed figures in use)' : '-';
  if (key === 'status') return v === 'pass' ? 'Pass' : v === 'marginal' ? 'Marginal' : v === 'fail' ? 'Fail' : (v ? String(v) : '-');
  if (v === null || v === undefined || v === '') return '-';
  return String(v);
}

/** coordLines(coord, rows) -> sentences for the summary block. */
export function coordLines(c, rows) {
  const name = (id) => { const r = (rows || []).find((x) => x.id === id); return r ? r.name : id; };
  const out = [];
  out.push(`${c.frequencies} frequenc${c.frequencies === 1 ? 'y' : 'ies'} in use. ${c.hitsTotal} third-order product${c.hitsTotal === 1 ? '' : 's'} land${c.hitsTotal === 1 ? 's' : ''} on a channel (${c.hits2} from two transmitters, ${c.hits3} from three transmitters).`);
  out.push(c.minSpacingKHz === null ? 'Minimum spacing: needs at least two frequencies.' : `Minimum spacing ${c.minSpacingKHz.toFixed(0)} kHz (the plan asks for ${c.requiredSpacingKHz} kHz); ${c.spacingViolations} pair${c.spacingViolations === 1 ? '' : 's'} too close.`);
  for (const o of c.overlapWarnings || []) out.push(`Overlap warning: ${name(o.a)} and ${name(o.b)} are ${o.separationKHz.toFixed(0)} kHz apart.`);
  out.push(c.ok ? 'Verdict: no coordination problem found by this planner.' : 'Verdict: this plan has coordination problems; see the lines above.');
  return out;
}

/** planView(scene, { projectName, date, delimiter, bom }) -> everything the dialog shows and exports. */
export function planView(scene, { projectName, date, delimiter = 'comma', bom = false } = {}) {
  const rows = frequencyPlanRows(scene), coord = coordinationSummary(scene), summary = planSummary(scene, { projectName, date });
  const d = DELIMITERS[delimiter] || ',';
  const header = [`Frequency plan: ${summary.projectName || 'untitled'}`, summary.date ? `Date: ${summary.date}` : '', `${summary.links} link${summary.links === 1 ? '' : 's'} (${summary.mics} mic, ${summary.iems} IEM), ${summary.imdTransmitters} IMD transmitter${summary.imdTransmitters === 1 ? '' : 's'}; TV channels ${summary.tvChannelWidthMHz} MHz wide`].filter(Boolean).join('\n');
  let csv = null, text = null; // built on first use: only Copy and Download need them
  return {
    rows, coord, summary, lines: coordLines(coord, rows),
    get csv() { if (csv === null) csv = frequencyPlanCsv(rows, { delimiter: d, bom }); return csv; },
    get text() { if (text === null) text = `${header}\n\n${frequencyPlanText(rows)}\n${coordLines(coord, rows).join('\n')}\n\n${BW_NOTE}\n`; return text; },
    table: { cols: PLAN_COLUMNS.map((c) => c.label), rows: rows.map((r) => PLAN_COLUMNS.map((c) => cellText(r, c.key))) },
  };
}

export function mountPlanExport({ doc = document, button, store, hostFactory = (c, d) => createCanvasHost(c, d), win = typeof window !== 'undefined' ? window : null, now = () => new Date() } = {}) {
  const el = (tag, cls, text, attrs) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const st = { delimiter: 'comma', bom: false, date: todayISO(now()), name: null };
  let memo = null; // planView is recomputed only when the scene object or one of its inputs changes (render, describe and the table all ask)
  const view = () => {
    const sc = store.getScene(), projectName = st.name !== null ? st.name : sc.name;
    if (memo && memo.sc === sc && memo.projectName === projectName && memo.date === st.date && memo.delimiter === st.delimiter && memo.bom === st.bom) return memo.v;
    const v = planView(sc, { projectName, date: st.date, delimiter: st.delimiter, bom: st.bom });
    memo = { sc, projectName, date: st.date, delimiter: st.delimiter, bom: st.bom, v };
    return v;
  };
  const zoom = createZoom({
    doc, hostFactory: (canvas, d) => hostFactory(canvas, (ctx, w, h, th) => d(ctx, w, h, th)),
    describe: () => { const v = view(); return { title: 'Export frequency plan', summary: `${v.rows.length} row${v.rows.length === 1 ? '' : 's'}. ${v.coord.ok ? 'No coordination problem found.' : 'Coordination problems found.'}` }; },
    table: () => ({ caption: 'Frequency plan', cols: ['Name', 'Frequency (MHz)'], rows: view().rows.map((r) => [r.name, r.freqMHz]) }),
    draw: () => {},
  });
  const dlg = zoom.dialog;
  dlg.className = `${dlg.className || ''} plan-dialog`.trim();
  zoom.canvas.hidden = true; zoom.details.hidden = true; // the table below is the content; the canvas host and its table fallback are not needed
  const body = el('div', 'plan-body'); zoom.slot.append(body);
  const sumBox = el('div', 'plan-coord', null, { role: 'group', 'aria-label': 'Coordination summary' });
  const fields = el('div', 'meas-bar');
  const nameIn = el('input', null, null, { type: 'text', maxlength: '120', 'aria-label': 'Project name' });
  const nameLab = el('label'); nameLab.append(el('span', null, 'Project '), nameIn);
  const dateIn = el('input', null, null, { type: 'text', 'aria-label': 'Date (year-month-day)', maxlength: '10', size: '11' });
  const dateLab = el('label'); dateLab.append(el('span', null, 'Date '), dateIn);
  const delSel = el('select', null, null, { 'aria-label': 'CSV delimiter' });
  for (const [k, t] of [['comma', 'Comma ,'], ['semicolon', 'Semicolon ;'], ['tab', 'Tab']]) delSel.append(el('option', null, t, { value: k }));
  const delLab = el('label'); delLab.append(el('span', null, 'Delimiter '), delSel);
  const bomChk = el('input', null, null, { type: 'checkbox' });
  const bomLab = el('label', null, null, { title: 'A byte-order mark helps Excel read accented characters' }); bomLab.append(bomChk, el('span', null, ' UTF-8 BOM (for Excel)'));
  fields.append(nameLab, dateLab, delLab, bomLab);
  const actions = el('div', 'meas-bar');
  const mk = (text, title, fn) => { const b = el('button', null, text, { type: 'button', title }); b.addEventListener('click', fn); return b; };
  const status = el('p', 'meas-status', '', { role: 'status', 'aria-live': 'polite' });
  const say = (t) => { status.textContent = t; };
  const copyBtn = mk('Copy text', 'Copy the plan as aligned plain text', async () => {
    const t = view().text;
    try { await win.navigator.clipboard.writeText(t); say('Plan copied as text.'); } catch { try { const ta = el('textarea', null, null, { 'aria-hidden': 'true', tabindex: '-1' }); ta.value = t; dlg.append(ta); /* inside the open modal dialog: outside it the page is inert and the copy is refused */ ta.select && ta.select(); const ok = doc.execCommand && doc.execCommand('copy'); ta.remove(); if (copyBtn.focus) copyBtn.focus(); say(ok ? 'Plan copied as text.' : 'Copy was blocked by the browser. Select the table and copy it by hand.'); } catch { say('Copy was blocked by the browser. Select the table and copy it by hand.'); } }
  });
  const dlBtn = mk('Download CSV', 'Save the table as a CSV file', () => {
    const v = view(), name = downloadName(v.summary.projectName, v.summary.date);
    try {
      const blob = new win.Blob([v.csv], { type: 'text/csv;charset=utf-8' }), url = win.URL.createObjectURL(blob);
      const a = doc.createElement('a'); a.href = url; a.download = name; doc.body.append(a); a.click(); a.remove();
      setTimeout(() => win.URL.revokeObjectURL(url), 2000);
      say(`Downloaded ${name} (${v.rows.length} rows, ${st.delimiter} separated${st.bom ? ', with BOM' : ''}).`);
    } catch { say('The download could not start in this browser.'); }
  });
  const printBtn = mk('Print table', 'Print only the table', () => {
    const b = doc.body, cls = b.classList;
    if (cls) cls.add('plan-print');
    const done = () => { if (cls) cls.remove('plan-print'); win.removeEventListener && win.removeEventListener('afterprint', done); };
    win.addEventListener && win.addEventListener('afterprint', done);
    try { win.print(); say('Print dialog opened.'); } catch { say('Printing is not available here.'); done(); }
    if (!win.addEventListener) done();
  });
  actions.append(copyBtn, dlBtn, printBtn);
  const note = el('p', 'hint plan-note', BW_NOTE);
  const tableWrap = el('div', 'meas-tablewrap plan-tablewrap', null, { tabindex: '0', role: 'region', 'aria-label': 'Frequency plan table' });
  const printTitle = el('p', 'plan-print-title');
  body.append(fields, actions, status, sumBox, note, printTitle, tableWrap);

  let typeTimer = null; // the table is rebuilt 150 ms after the last keystroke
  const renderSoon = () => { if (typeTimer) clearTimeout(typeTimer); typeTimer = setTimeout(() => { typeTimer = null; render(); }, 150); };
  nameIn.addEventListener('input', () => { st.name = nameIn.value; renderSoon(); });
  dateIn.addEventListener('input', () => { st.date = dateIn.value; renderSoon(); });
  delSel.addEventListener('change', () => { st.delimiter = delSel.value; });
  bomChk.addEventListener('change', () => { st.bom = !!bomChk.checked; });

  function render() {
    if (!zoom.isOpen()) return;
    const v = view();
    sumBox.textContent = '';
    sumBox.append(el('h3', null, 'Coordination summary'));
    const ul = el('ul'); v.lines.forEach((t, i) => ul.append(el('li', i === v.lines.length - 1 && !v.coord.ok ? 'plan-bad' : null, t))); sumBox.append(ul);
    printTitle.textContent = `${v.summary.projectName || 'Frequency plan'}${v.summary.date ? `, ${v.summary.date}` : ''}`;
    tableWrap.textContent = '';
    if (!v.rows.length) { tableWrap.append(el('p', 'hint', 'No links or IMD transmitters in this project yet.')); zoom.update(); return; }
    const t = el('table', 'meas-table plan-table'), cap = el('caption', null, 'Frequency plan: one row per link and per IMD transmitter');
    const hr = el('tr'); v.table.cols.forEach((c) => hr.append(el('th', null, c, { scope: 'col' })));
    const th = el('thead'); th.append(hr); const tb = el('tbody');
    v.table.rows.forEach((r) => { const tr = el('tr'); r.forEach((c, i) => tr.append(el(i === 0 ? 'th' : 'td', null, c, i === 0 ? { scope: 'row' } : undefined))); tb.append(tr); });
    t.append(cap, th, tb); tableWrap.append(t);
    zoom.update();
  }
  let timer = null;
  const unsub = store.subscribe(() => { if (!zoom.isOpen() || timer) return; timer = setTimeout(() => { timer = null; render(); }, 120); });
  function open() {
    st.date = todayISO(now()); st.name = null;
    zoom.open('plan', button);
    nameIn.value = store.getScene().name || ''; dateIn.value = st.date; delSel.value = st.delimiter; bomChk.checked = st.bom;
    if (button && button.setAttribute) button.setAttribute('aria-expanded', 'true');
    status.textContent = ''; render();
  }
  if (button) { button.addEventListener('click', open); button.setAttribute('aria-haspopup', 'dialog'); }
  dlg.addEventListener('close', () => { if (button && button.setAttribute) button.setAttribute('aria-expanded', 'false'); });
  return { open, zoom, st, render, view, destroy() { unsub(); if (timer) clearTimeout(timer); if (typeTimer) clearTimeout(typeTimer); zoom.destroy(); } };
}
