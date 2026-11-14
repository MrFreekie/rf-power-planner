// Venue underlay: the "Venue" button and its native <dialog> (import an SU4SV text file, per-layer checkboxes).
// The logic lives in createVenueController (no DOM, injected deps) so Node can test it; mountVenue() is the thin DOM part.
//   createVenueController({ store, deps, isLocked? }) -> { state(), importFile(file), remove(), setLayerHidden(name, hidden), label() }
//   deps = { parseVenueText, venueSummary, setVenue, removeVenue, setVenueLayerHidden }  (model + actions; actions take the store first)
// The venue never changes scale, extent or page size: nothing here touches the viewport.

export const MAX_VENUE_FILE_BYTES = 8 * 1024 * 1024;
export const MSG = Object.freeze({
  tooBig: 'This file is larger than 8 MB, which is too much for a venue. Simplify the model in SketchUp and export it again.',
  unreadable: 'This file could not be read.',
  locked: 'The scene is read-only, so the venue cannot be changed.',
  hint: 'An optional grey drawing of the venue from an SU4SV text file (the SketchUp to Soundvision converter), in metres. Only the plan is kept, darker where it is lower. It never changes the scale of the drawing.',
  shareNote: 'The venue is not included in share links (too long). It is kept in saved scene files and in this browser.',
});

const nf = (n) => Number(n).toLocaleString('en-GB');
const plural = (n, one, many) => (n === 1 ? one : many);

/** Button label from the model summary: "Venue" until imported, then "Venue: 3 of 5 layers on". */
export function venueButtonLabel(venue, summaryFn) {
  if (!venue || !Array.isArray(venue.layers) || !venue.layers.length) return 'Venue';
  let s = null;
  try { s = summaryFn ? summaryFn(venue) : null; } catch { s = null; }
  const total = s && Number.isFinite(s.layers) ? s.layers : venue.layers.length;
  const on = s && Number.isFinite(s.visibleLayers) ? s.visibleLayers : venue.layers.filter((l) => !l.hidden).length;
  return `Venue: ${on} of ${total} ${plural(total, 'layer', 'layers')} on`;
}

/** Success sentence after an import. */
export function importMessage(lines, layers, badLines) {
  let m = `Imported ${nf(lines)} ${plural(lines, 'line', 'lines')} in ${nf(layers)} ${plural(layers, 'layer', 'layers')}.`;
  if (badLines > 0) m += ` ${nf(badLines)} ${plural(badLines, 'line', 'lines')} of the file could not be read and ${plural(badLines, 'was', 'were')} left out.`;
  return m;
}

/** Layer rows for the checkbox list: name, line count (from the shade edges), visible flag. */
export function layerRows(venue) {
  if (!venue || !Array.isArray(venue.layers)) return [];
  return venue.layers.map((l) => {
    let lines = 0;
    for (const s of l.shades || []) lines += Math.floor(((s && s.edges && s.edges.length) || 0) / 4);
    return { name: l.name, lines, visible: !l.hidden };
  });
}

async function readText(file) {
  if (file && typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = () => reject(fr.error); fr.readAsText(file);
  });
}

export function createVenueController({ store, deps, isLocked = () => false }) {
  let message = { kind: '', text: '' };
  const locked = () => { try { return !!isLocked(); } catch { return false; } };
  const venue = () => store.getScene().venue || null;
  const err = (text) => { message = { kind: 'error', text }; return { ok: false, message: text }; };
  return {
    isLocked: locked,
    venue,
    label: () => venueButtonLabel(venue(), deps.venueSummary),
    layers: () => layerRows(venue()),
    totalLines: () => layerRows(venue()).reduce((a, r) => a + r.lines, 0),
    state() {
      const v = venue();
      return { message: { ...message }, locked: locked(), hasVenue: !!(v && v.layers && v.layers.length), layers: layerRows(v), label: venueButtonLabel(v, deps.venueSummary) };
    },
    clearMessage() { message = { kind: '', text: '' }; },
    /** Size gate first (before reading), then parse, then replace the venue. Never throws. */
    async importFile(file) {
      if (locked()) return err(MSG.locked);
      if (!file) return err(MSG.unreadable);
      if (Number.isFinite(file.size) && file.size > MAX_VENUE_FILE_BYTES) return err(MSG.tooBig);
      let text;
      try { text = await readText(file); } catch { return err(MSG.unreadable); }
      let res;
      try { res = deps.parseVenueText(text); } catch { return err(MSG.unreadable); }
      if (!res || !res.ok) return err((res && res.message) || MSG.unreadable);
      try { if (deps.setVenue(store, res.underlay) === false) return err(MSG.unreadable); } catch { return err(MSG.unreadable); }
      const ok = importMessage(res.edges, res.underlay.layers.length, res.badLines || 0);
      message = { kind: 'status', text: ok };
      return { ok: true, message: ok };
    },
    remove() {
      if (locked()) return err(MSG.locked);
      deps.removeVenue(store);
      message = { kind: 'status', text: 'The venue was removed.' };
      return { ok: true };
    },
    setLayerHidden(name, hidden) {
      if (locked()) return err(MSG.locked);
      deps.setVenueLayerHidden(store, name, !!hidden);
      message = { kind: '', text: '' };
      return { ok: true };
    },
  };
}

// ---- DOM ------------------------------------------------------------------------------------
function el(tag, cls, text, attrs) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/**
 * mountVenue({ button, store, isLocked? }) -> { controller, open, close, destroy }
 * The model modules are imported lazily, so a missing or broken model leaves the rest of the app alone.
 */
export async function mountVenue({ button, store, isLocked = () => false }) {
  const [model, actions] = await Promise.all([import('../model/venue-underlay.js'), import('../actions.js')]);
  const deps = {
    parseVenueText: model.parseVenueText, venueSummary: model.venueSummary,
    setVenue: actions.setVenue, removeVenue: actions.removeVenue, setVenueLayerHidden: actions.setVenueLayerHidden,
  };
  const ctl = createVenueController({ store, deps, isLocked });
  const dlg = el('dialog', 'venue-dialog', null, { 'aria-labelledby': 'venue-title' });
  dlg.id = 'venue-dialog';
  const head = el('div', 'venue-head');
  const title = el('h2', null, 'Venue', { id: 'venue-title' });
  const closeX = el('button', null, 'Close', { type: 'button' });
  head.append(title, closeX);
  const hint = el('p', 'venue-hint', MSG.hint);
  const note = el('p', 'venue-hint', MSG.shareNote);
  const file = el('input', null, null, { type: 'file', accept: '.txt,text/plain', hidden: '', id: 'venue-file', 'aria-label': 'Venue file (SU4SV text file)' });
  const importBtn = el('button', null, 'Import venue (SU4SV text file)', { type: 'button' });
  const removeBtn = el('button', 'danger', 'Remove venue', { type: 'button' });
  const actionsRow = el('div', 'venue-actions'); actionsRow.append(importBtn, removeBtn, file);
  const msgBox = el('p', 'venue-msg'); // role is set per message: alert for errors, status for successes
  const lockNote = el('p', 'venue-hint', MSG.locked); lockNote.hidden = true;
  const fs = el('fieldset', 'venue-layers'); const legend = el('legend'); fs.append(legend);
  const list = el('div', 'venue-list'); fs.append(list);
  const done = el('button', null, 'Close', { type: 'button' });
  const foot = el('div', 'venue-foot'); foot.append(done);
  dlg.append(head, hint, note, actionsRow, msgBox, lockNote, fs, foot);
  document.body.append(dlg);

  let lastKey = '';
  function render() {
    const s = ctl.state();
    button.textContent = s.label;
    button.title = s.hasVenue ? 'Show or hide venue layers, replace or remove the venue' : 'Import a venue drawing as a grey underlay';
    importBtn.textContent = s.hasVenue ? 'Replace venue (SU4SV text file)' : 'Import venue (SU4SV text file)';
    importBtn.disabled = s.locked; removeBtn.hidden = !s.hasVenue; removeBtn.disabled = s.locked;
    lockNote.hidden = !s.locked;
    msgBox.textContent = s.message.text;
    msgBox.setAttribute('role', s.message.kind === 'error' ? 'alert' : 'status');
    msgBox.dataset.kind = s.message.kind; msgBox.hidden = !s.message.text;
    fs.hidden = !s.hasVenue;
    if (s.hasVenue) {
      const total = s.layers.reduce((a, r) => a + r.lines, 0);
      legend.textContent = `Layers to show (${nf(total)} ${plural(total, 'line', 'lines')})`;
      const key = s.layers.map((r) => r.name + '|' + r.lines).join('\n') + (s.locked ? '#L' : '');
      if (key !== lastKey) { // rebuild only when the layer set changes; otherwise just sync ticks (keeps focus)
        lastKey = key; list.textContent = '';
        s.layers.forEach((r, i) => {
          const id = 'venue-layer-' + i;
          const row = el('label', 'venue-layer'); row.htmlFor = id;
          const cb = el('input', null, null, { type: 'checkbox', id }); cb.dataset.layer = r.name; cb.disabled = s.locked;
          row.append(cb, el('span', 'venue-layer-name', r.name), el('span', 'venue-layer-n', `(${nf(r.lines)} ${plural(r.lines, 'line', 'lines')})`));
          list.append(row);
        });
      }
      list.querySelectorAll('input').forEach((cb, i) => { cb.checked = !!(s.layers[i] && s.layers[i].visible); });
    } else { lastKey = ''; list.textContent = ''; }
  }
  list.addEventListener('change', (e) => {
    const cb = e.target; if (!cb || cb.type !== 'checkbox') return;
    ctl.setLayerHidden(cb.dataset.layer, !cb.checked); render();
  });
  importBtn.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0]; file.value = '';
    if (!f) return;
    await ctl.importFile(f); render();
  });
  removeBtn.addEventListener('click', () => { ctl.remove(); render(); importBtn.focus(); });
  const close = () => { if (dlg.open) dlg.close(); };
  closeX.addEventListener('click', close); done.addEventListener('click', close);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); }); // backdrop click
  dlg.addEventListener('close', () => { button.setAttribute('aria-expanded', 'false'); button.focus(); });
  function open() {
    ctl.clearMessage(); lastKey = ''; render();
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    button.setAttribute('aria-expanded', 'true');
    importBtn.focus();
  }
  button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', dlg.id);
  button.addEventListener('click', open);
  const unsub = store.subscribe((scene, info) => { if (info && info.type === 'selection') return; render(); });
  render();
  return { controller: ctl, open, close, destroy() { unsub(); dlg.remove(); } };
}
