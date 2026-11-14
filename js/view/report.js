// Printable stage sheet: opens an overlay with the plan and side diagrams (taken from the live canvases), the power
// budget, warnings, zone and intermod tables, assumptions and the disclaimer. "Print / Save as PDF" calls window.print();
// a print stylesheet (css/style.css, .report-*) hides everything except the sheet. "Download PNG" saves the plan view.
//   openReport({ store, getData }) -> { close() }       getData() returns buildReportData(...) output (js/reportData.js)
// Diagrams come from offscreen snapshots (js/view/snapshots.js) at a fixed size, not from the live canvases.
// Built with DOM methods only (no innerHTML), so scene text such as names cannot inject markup.

import { getSnapshot, darkPixelCount } from './snapshots.js';

const SEV_RANK = { critical: 0, warning: 1, info: 2 };

/** Warnings sorted worst first, stable otherwise. Pure. */
export function sortWarnings(warnings) {
  return (warnings || []).map((w, i) => [w, i]).sort((a, b) => (SEV_RANK[a[0].severity] ?? 3) - (SEV_RANK[b[0].severity] ?? 3) || a[1] - b[1]).map((p) => p[0]);
}

/** File-safe name: "link-budget-mic-1-2026-11-13.png". Pure. */
export function reportFileName(title, date, ext = 'png') {
  const base = String(title || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'report';
  const d = String(date || '').replace(/[^0-9-]/g, '');
  return `${base}${d ? `-${d}` : ''}.${ext}`;
}

/** Status word for the margin block. Pure. */
export function statusWord(status) {
  return { pass: 'PASS', marginal: 'MARGINAL', fail: 'FAIL' }[status] || 'UNKNOWN';
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

function table(headers, rows, cls = '') {
  const t = el('table', `report-table ${cls}`.trim());
  const thead = el('thead'); const hr = el('tr');
  headers.forEach((h) => { const th = el('th', h.num ? 'num' : '', h.label); th.scope = 'col'; hr.append(th); });
  thead.append(hr); t.append(thead);
  const tb = el('tbody');
  rows.forEach((r) => {
    const tr = el('tr');
    r.forEach((c, i) => tr.append(el('td', headers[i] && headers[i].num ? 'num' : '', c == null ? '' : String(c))));
    tb.append(tr);
  });
  t.append(tb);
  return t;
}

/** True when a canvas has no painted pixels (it was cleared by a resize and not yet redrawn). */
export function isBlankCanvas(c) {
  try {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4 * 61) if (d[i] > 0) return false;
    return true;
  } catch { return false; }
}

/** Wait for the views to repaint (they draw on animation frames), up to about 0.5 s. */
function whenPainted(ids) {
  return new Promise((resolve) => {
    let tries = 0;
    const check = () => {
      const blank = ids.some((id) => { const c = document.getElementById(id); return c && c.width && isBlankCanvas(c); });
      if (!blank || ++tries > 10) { resolve(); return; }
      setTimeout(check, 50);
    };
    requestAnimationFrame(() => setTimeout(check, 0));
    setTimeout(resolve, 1500); // hidden tab: do not wait forever
  });
}

function snapImage(kind, w, h, alt) {
  const fn = getSnapshot(kind);
  let c = null;
  try { c = fn ? fn(w, h) : null; } catch { c = null; }
  if (!c) return null;
  const dark = darkPixelCount(c);
  if (!dark) return null; // blank: never embed
  try {
    const img = el('img', 'report-img');
    img.src = c.toDataURL('image/png');
    img.alt = alt;
    img.dataset.dark = String(dark);
    return img;
  } catch { return null; }
}

function canvasImage(id, alt) {
  const c = document.getElementById(id);
  if (!c || !c.width || !c.height || isBlankCanvas(c)) return null; // never embed an unpainted canvas
  try {
    const img = el('img', 'report-img');
    img.src = c.toDataURL('image/png');
    img.alt = alt;
    return img;
  } catch { return null; } // tainted or unavailable canvas
}

function section(title, ...children) {
  const s = el('section', 'report-section');
  s.append(el('h2', null, title), ...children.filter(Boolean));
  return s;
}

function buildSheet(data) {
  const sheet = el('article', 'report-sheet');
  sheet.setAttribute('aria-label', 'Link budget report');
  const head = el('header', 'report-head');
  head.append(el('p', 'report-brand', 'RF Bench: Plan, simulate, learn.'), el('h1', null, data.title), el('p', 'report-date', `Date: ${data.date}`));
  sheet.append(head);

  if (data.margin) {
    const box = el('p', `report-status report-status-${data.margin.status}`);
    box.append(el('strong', null, `${statusWord(data.margin.status)}  `), document.createTextNode(data.margin.text));
    sheet.append(box);
  }
  sheet.append(section('Scenario', table([{ label: 'Item' }, { label: 'Value' }], (data.scenario || []).map((s) => [s.label, s.value]))));

  // diagrams
  const plan = snapImage('plan', 1100, 620, 'Plan view of the stage with the link') || canvasImage('plan-canvas', 'Plan view of the stage with the link');
  const side = snapImage('side', 1100, 380, 'Side view of the transmitter to receiver line') || canvasImage('side-canvas', 'Side view of the transmitter to receiver line');
  const diag = section('Diagrams');
  diag.classList.add('report-break');
  if (plan) { const f = el('figure'); f.append(plan, el('figcaption', null, 'Plan view (top-down, to scale).')); diag.append(f); }
  if (side) { const f = el('figure'); f.append(side, el('figcaption', null, 'Side view (vertical slice through the transmitter and receiver).')); diag.append(f); }
  if (!plan && !side) diag.append(el('p', 'report-note', 'The diagrams are not available in this browser.'));
  sheet.append(diag);

  // budget
  const wfImg = snapImage('waterfall', 720, 0, 'Power budget waterfall chart') || (() => { const c = document.querySelector('#waterfall canvas'); if (!c || !c.width || isBlankCanvas(c)) return null; try { const i = el('img', 'report-img'); i.src = c.toDataURL('image/png'); i.alt = 'Power budget waterfall chart'; return i; } catch { return null; } })();
  const budget = section('Power budget',
    wfImg,
    data.waterfall && data.waterfall.length ? table([{ label: 'Stage' }, { label: 'Level', num: true }, { label: 'Change', num: true }],
      data.waterfall.map((w) => [w.label, w.valueText, w.deltaText])) : el('p', 'report-note', 'No budget available.'));
  budget.classList.add('report-break');
  sheet.append(budget);

  // checks
  const checks = el('div', 'report-checks');
  const warns = sortWarnings(data.warnings);
  const wsec = section('Warnings');
  if (warns.length) { const ul = el('ul', 'report-warn'); warns.forEach((w) => { const li = el('li', `sev-${w.severity}`); li.append(el('strong', null, `${String(w.severity).toUpperCase()}: `), document.createTextNode(w.text)); ul.append(li); }); wsec.append(ul); }
  else wsec.append(el('p', 'report-note', 'No warnings for the current scene.'));
  checks.append(wsec);
  if (data.zones && data.zones.length) checks.append(section('Coverage zones', table([{ label: 'Zone' }, { label: 'Area passing', num: true }, { label: 'Result' }, { label: 'Weakest point' }],
    data.zones.map((z) => [z.name, `${(z.passFraction * 100).toFixed(0)} %`, z.pass ? 'PASS' : 'FAIL', z.text.replace(/^[^:]+: /, '')]))));
  if (data.intermod && data.intermod.length) checks.append(section('Intermodulation check', table([{ label: 'Product' }, { label: 'Lands on' }, { label: 'Offset', num: true }, { label: 'C/I', num: true }, { label: 'Severity' }],
    data.intermod.map((c) => [c.product, c.channel, `${c.offsetKHz.toFixed(0)} kHz`, `${c.ciDb.toFixed(1)} dB`, String(c.severity).toUpperCase()]))));
  checks.classList.add('report-break');
  sheet.append(checks);

  const ass = section('Assumptions');
  const ul = el('ul'); (data.assumptions || []).forEach((a) => ul.append(el('li', null, a))); ass.append(ul);
  ass.append(el('p', 'report-disclaimer', data.disclaimer));
  sheet.append(ass);
  return sheet;
}

let current = null;

export function openReport({ store, getData }) {
  if (current) current.close();
  let data;
  try { data = getData(); } catch (err) { data = { title: 'Report unavailable', date: '', scenario: [], assumptions: [], waterfall: [], warnings: [{ kind: 'error', severity: 'critical', text: `The report could not be built: ${err.message}` }], zones: [], intermod: [], disclaimer: '' }; }

  const prevFocus = document.activeElement;
  const overlay = el('div', 'report-overlay');
  overlay.id = 'report-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Printable link budget report');
  const bar = el('div', 'report-bar');
  const bPrint = el('button', null, 'Print / Save as PDF'); bPrint.type = 'button';
  const bPng = el('button', null, 'Download PNG of plan view'); bPng.type = 'button';
  const bClose = el('button', null, 'Close'); bClose.type = 'button';
  const hint = el('span', 'report-hint', 'In the print dialog choose "Save as PDF" as the destination.');
  bar.append(bPrint, bPng, bClose, hint);
  const status = el('p', 'report-msg'); status.setAttribute('role', 'status'); status.hidden = true;
  const holder = el('div');
  const loading = el('p', 'report-msg', 'Preparing the report...');
  holder.append(loading);
  overlay.append(bar, status, holder);
  document.body.append(overlay);
  document.body.classList.add('report-open');
  bClose.focus();

  const fill = () => { if (document.body.contains(overlay)) holder.replaceChildren(buildSheet(data)); };
  if (getSnapshot('plan')) fill(); // offscreen snapshots do not depend on the live canvases being painted
  else whenPainted(['plan-canvas', 'side-canvas']).then(fill);
  const say = (t) => { status.textContent = t; status.hidden = !t; };
  bPrint.addEventListener('click', () => { try { window.print(); } catch (err) { say(`Printing is not available: ${err.message}`); } });
  bPng.addEventListener('click', () => {
    const snap = getSnapshot('plan');
    let c = null;
    try { c = snap ? snap(1600, 900) : null; } catch { c = null; }
    if (!c || !darkPixelCount(c)) c = document.getElementById('plan-canvas');
    if (!c || !c.toBlob) { say('The plan view is not available to export.'); return; }
    c.toBlob((blob) => {
      if (!blob) { say('Could not create the image.'); return; }
      const url = URL.createObjectURL(blob);
      const a = el('a'); a.href = url; a.download = reportFileName(data.title, data.date, 'png');
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      say('Plan view image saved.');
    }, 'image/png');
  });
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') { // keep focus inside the dialog
      const f = [...overlay.querySelectorAll('button')];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey);
  function close() {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    document.body.classList.remove('report-open');
    if (prevFocus && prevFocus.focus) prevFocus.focus();
    if (current && current.close === close) current = null;
  }
  bClose.addEventListener('click', close);
  current = { close };
  return current;
}

export const mountReport = openReport;
