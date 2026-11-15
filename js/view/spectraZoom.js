// Enlarged spectrum view: a native <dialog> (showModal) with the same draw code as the small bottom-bar plot at a large size,
// the plot summary, a text table alternative and a Close button. Escape closes (native), focus returns to the plot that opened it,
// and the dialog follows the live signals: the owner calls update() on every frame.
// DOM and canvas host are injected so the logic runs under a minimal fake DOM in the tests.

let zoomSeq = 0;
export function createZoom({ doc, hostFactory, describe, table, draw, onClose }) {
  const el = (tag, cls, text, attrs) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const titleId = zoomSeq++ ? `spectrum-dialog-title-${zoomSeq}` : 'spectrum-dialog-title';
  const dlg = el('dialog', 'spectrum-dialog', null, { 'aria-labelledby': titleId });
  const head = el('div', 'spectrum-dialog-head');
  const title = el('h2', null, '', { id: titleId });
  const closeBtn = el('button', 'spectrum-dialog-close', 'Close', { type: 'button' });
  head.append(title, closeBtn);
  const slot = el('div', 'spectrum-dialog-slot');
  const canvas = el('canvas', 'spectrum-dialog-canvas', null, { role: 'img', tabindex: '0' });
  const sum = el('p', 'spectrum-dialog-sum', '', { role: 'status', 'aria-live': 'off' });
  const details = el('details', 'spectrum-dialog-table'), summary = el('summary', null, 'Table of values');
  const tableWrap = el('div', 'spectrum-dialog-tablewrap');
  details.append(summary, tableWrap);
  dlg.append(head, canvas, slot, sum, details);
  doc.body.append(dlg);

  let id = null, opener = null, host = null, hover = null, lastTable = '';
  const state = { get id() { return id; }, hover: () => hover };

  function renderTable() {
    const t = table(id);
    const sig = JSON.stringify(t);
    if (sig === lastTable) return;
    lastTable = sig; tableWrap.textContent = '';
    if (!t || !t.rows.length) { tableWrap.append(el('p', 'hint', 'No values to list.')); return; }
    const tb = el('table', 'spectrum-table'), cap = el('caption', null, t.caption), thead = el('thead'), hr = el('tr'), body = el('tbody');
    for (const c of t.cols) hr.append(el('th', null, c, { scope: 'col' }));
    thead.append(hr);
    for (const r of t.rows) { const tr = el('tr'); r.forEach((v, i) => tr.append(el(i === 0 ? 'th' : 'td', i === 0 ? null : 'num', String(v), i === 0 ? { scope: 'row' } : undefined))); body.append(tr); }
    tb.append(cap, thead, body); tableWrap.append(tb);
  }
  /** Refresh title, summary, aria-label, table and the canvas from the live model. */
  function update() {
    if (id === null || !dlg.open) return;
    const d = describe(id);
    title.textContent = d.title;
    if (sum.textContent !== d.summary) sum.textContent = d.summary;
    canvas.setAttribute('aria-label', `${d.title}, enlarged. ${d.summary}`);
    if (details.open) renderTable();
    if (host) host.invalidate();
  }
  function open(spectrumId, from) {
    if (dlg.open) close(false);
    id = spectrumId; opener = from || null; hover = null; lastTable = '';
    if (!host) host = hostFactory(canvas, (ctx, w, h, th) => draw(id, ctx, w, h, th, hover));
    dlg.showModal();
    update();
    closeBtn.focus();
  }
  function close(restore = true) {
    if (dlg.open) dlg.close();
    const o = opener; id = null; opener = null;
    if (restore && o && o.focus) o.focus();
    if (onClose) onClose();
  }
  closeBtn.addEventListener('click', () => close());
  dlg.addEventListener('close', () => { if (id !== null) { const o = opener; id = null; opener = null; if (o && o.focus) o.focus(); if (onClose) onClose(); } }); // Escape: the native close event
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); }); // a click on the backdrop
  details.addEventListener('toggle', () => { lastTable = ''; if (details.open) renderTable(); });
  canvas.addEventListener('pointermove', (e) => { const b = canvas.getBoundingClientRect(); hover = e.clientX - b.left; if (host) host.invalidate(); });
  canvas.addEventListener('pointerleave', () => { hover = null; if (host) host.invalidate(); });
  canvas.addEventListener('keydown', (e) => {
    const b = canvas.getBoundingClientRect();
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); hover = Math.min(b.width, Math.max(0, (hover ?? b.width / 2) + (e.key === 'ArrowRight' ? 16 : -16))); if (host) host.invalidate(); }
  });
  return { open, close, update, isOpen: () => !!dlg.open, dialog: dlg, canvas, slot, title, summary: sum, details, closeBtn, state, destroy() { if (dlg.open) dlg.close(); if (host) host.destroy(); dlg.remove(); } };
}

/** Decimate to at most `max` rows, keeping the first and last. */
export function decimate(n, max = 61) {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const out = [];
  for (let k = 0; k < max; k++) out.push(Math.round((k * (n - 1)) / (max - 1)));
  return out;
}
