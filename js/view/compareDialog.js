// Compare pop-out: take up to five snapshots of the scene, compare one with the current scene (or another snapshot): headline sentences, a per-link
// table, attribution bars, changed fields and added/removed items. Restore puts a snapshot back as one undo step. Snapshots are UI state only.
import { createCanvasHost } from './util.js';
import { createZoom } from './spectraZoom.js';
import { restoreScene } from '../actions.js';
import { createSnapshots, cachedDiff, throttled, headline, linkRows, attributionView, fieldLines, itemSections, MAX_SNAPSHOTS, NOT_SNAPSHOTTABLE } from '../ui/compareUi.js';
import { confirmDialog } from '../ui/confirmDialog.js';

export function mountCompare({ doc = document, button, store, hostFactory = (c, d) => createCanvasHost(c, d), storage = (() => { try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; } })(), confirm = confirmDialog, defer = (fn) => setTimeout(fn, 0) } = {}) {
  const el = (tag, cls, text, attrs) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const snaps = createSnapshots({ storage });
  const st = { a: null, b: 'current', diff: null, error: '', same: false };
  const zoom = createZoom({
    doc, hostFactory: (canvas, d) => hostFactory(canvas, (ctx, w, h, th) => d(ctx, w, h, th)),
    describe: () => ({ title: 'Compare scenarios', summary: st.diff ? headline(st.diff)[0] || 'No differences.' : `${snaps.count()} snapshot${snaps.count() === 1 ? '' : 's'}.` }),
    table: () => ({ caption: 'Differences', cols: ['Sentence'], rows: st.diff ? headline(st.diff).map((t) => [t]) : [] }),
    draw: () => {},
  });
  const dlg = zoom.dialog;
  dlg.className = `${dlg.className || ''} cmp-dialog`.trim();
  zoom.canvas.hidden = true; zoom.details.hidden = true;
  const body = el('div', 'meas-body'); zoom.slot.append(body);

  // ---- snapshot controls
  const bar = el('div', 'meas-bar');
  const nameIn = el('input', null, null, { type: 'text', maxlength: '60', 'aria-label': 'Snapshot name', placeholder: 'Snapshot name (optional)' });
  const mk = (text, title, fn) => { const b = el('button', null, text, { type: 'button', title }); b.addEventListener('click', fn); return b; };
  const takeBtn = mk('Take snapshot', `Save the current scene in memory (up to ${MAX_SNAPSHOTS}; the oldest is dropped)`, () => {
    const s = snaps.take(store.getScene(), nameIn.value);
    if (!s) { say(NOT_SNAPSHOTTABLE); return; }
    nameIn.value = ''; st.a = s.id; if (st.b === st.a) st.b = 'current';
    say(`Snapshot "${s.name}" taken at ${s.time}, ${s.links} link${s.links === 1 ? '' : 's'}. ${snaps.count()} of ${MAX_SNAPSHOTS} kept.`); refresh(true);
  });
  const restoreBtn = mk('Restore snapshot to scene', 'Replace the current scene with the chosen snapshot (one undo step)', () => {
    const s = snaps.get(st.a); if (!s) return;
    const go = () => { const ok = restoreScene(store, s.scene); say(ok ? `Scene restored from "${s.name}". Undo brings the current scene back.` : 'That snapshot could not be restored.'); refresh(true); };
    if (confirm) { Promise.resolve(confirm({ title: 'Restore snapshot?', message: `Replace the current scene with "${s.name}"? Undo (Ctrl+Z) brings the current scene back.`, confirmText: 'Restore', opener: restoreBtn })).then((ok) => { if (ok) go(); }, () => {}); } else go();
  });
  const clearBtn = mk('Clear snapshots', 'Forget every snapshot (the scene is not changed)', () => { snaps.clear(); st.a = null; st.b = 'current'; st.diff = null; say('All snapshots cleared.'); refresh(true); });
  bar.append(nameIn, takeBtn, restoreBtn, clearBtn);
  const pick = el('div', 'meas-bar');
  const selA = el('select', null, null, { 'aria-label': 'Snapshot to compare' }), selB = el('select', null, null, { 'aria-label': 'Compare with' });
  const la = el('label'); la.append(el('span', null, 'Compare snapshot '), selA);
  const lb = el('label'); lb.append(el('span', null, ' with '), selB);
  pick.append(la, lb);
  selA.addEventListener('change', () => { st.a = selA.value; if (st.b === st.a) st.b = 'current'; refresh(true); });
  selB.addEventListener('change', () => { st.b = selB.value; refresh(true); });
  const status = el('p', 'meas-status', '', { role: 'status', 'aria-live': 'polite' });
  const say = (t) => { status.textContent = t; };
  const out = el('div', 'cmp-out');
  body.append(bar, pick, status, out);

  const sceneOf = (id) => (id === 'current' ? store.getScene() : (snaps.get(id) || {}).scene || null);
  const nameOf = (id) => (id === 'current' ? 'the current scene' : `"${(snaps.get(id) || {}).name}"`);

  function renderOut() {
    out.textContent = '';
    if (!snaps.count()) { out.append(el('p', 'hint', 'Take a snapshot of the scene, change something (move a receiver, add a pad), then compare. Snapshots live in memory only and are not saved in the scene file.')); return; }
    if (st.error) { out.append(el('p', 'plan-bad', st.error)); return; }
    if (st.same) { out.append(el('p', 'hint', 'Both sides are the same snapshot, so there is nothing to compare. Choose another snapshot or the current scene.')); return; }
    const d = st.diff; if (!d) { out.append(el('p', 'hint', 'Comparing…')); return; }
    const h = el('section', null, null, { 'aria-label': 'Summary' }); h.append(el('h3', null, `What changed from ${nameOf(st.a)} to ${nameOf(st.b)}`));
    const ul = el('ul', 'cmp-head'); headline(d).forEach((t) => ul.append(el('li', null, t))); h.append(ul); out.append(h);
    const rows = linkRows(d);
    if (rows.length) {
      const sec = el('section', null, null, { 'aria-label': 'Per-link results' }); sec.append(el('h3', null, 'Links'));
      const wrap = el('div', 'meas-tablewrap plan-tablewrap', null, { tabindex: '0', role: 'region', 'aria-label': 'Per-link comparison table' });
      const t = el('table', 'meas-table plan-table'); t.append(el('caption', null, 'Per link: A → B. Delta is B minus A.'));
      const hr = el('tr'); ['Link', 'Margin', 'Delta', 'Rx level', 'Noise floor', 'Status', 'Compression', 'New warnings', 'Warnings gone'].forEach((c) => hr.append(el('th', null, c, { scope: 'col' })));
      const th = el('thead'); th.append(hr); const tb = el('tbody');
      for (const r of rows) {
        const tr = el('tr'); tr.append(el('th', null, r.name, { scope: 'row' }), el('td', null, r.margin));
        const dt = el('td', 'meas-delta'); dt.append(el('span', `meas-chip meas-${r.chip.sign}`, '', { 'aria-hidden': 'true' }), el('span', null, ` ${r.chip.text}`)); tr.append(dt);
        [r.rx, r.noise, r.status, r.compression, r.newWarnings, r.goneWarnings].forEach((c) => tr.append(el('td', null, c)));
        tb.append(tr);
      }
      t.append(th, tb); wrap.append(t); sec.append(wrap); out.append(sec);
    }
    const attrs = d.links.map(attributionView).filter(Boolean);
    if (attrs.length) {
      const sec = el('section', null, null, { 'aria-label': 'Attribution' }); sec.append(el('h3', null, 'Why the margin moved (one change at a time)'));
      for (const a of attrs) {
        sec.append(el('h4', null, a.name));
        const ul2 = el('ul', 'cmp-bars');
        for (const b of a.bars) {
          const li = el('li'); const bar2 = el('span', `cmp-bar cmp-${b.sign}`, '', { 'aria-hidden': 'true' }); bar2.style.width = `${Math.max(2, Math.round(b.frac * 100))}%`;
          li.append(el('span', 'cmp-bar-text', `${b.label}: ${b.change}, ${b.text}`), el('span', 'cmp-bar-track', null, { 'aria-hidden': 'true' })); li.children[1].append(bar2); ul2.append(li);
        }
        sec.append(ul2, el('p', 'hint', a.total));
        if (a.note) sec.append(el('p', 'meas-reason', a.note));
      }
      out.append(sec);
    }
    const fl = d.links.filter((l) => l.fields.length);
    if (fl.length) {
      const sec = el('section', null, null, { 'aria-label': 'Changed fields' }); sec.append(el('h3', null, 'Changed fields'));
      for (const l of fl) { sec.append(el('h4', null, l.name)); const u = el('ul'); fieldLines(l.fields).forEach((t) => u.append(el('li', null, t))); sec.append(u); }
      out.append(sec);
    }
    const its = itemSections(d);
    if (its.length) { const sec = el('section', null, null, { 'aria-label': 'Items' }); sec.append(el('h3', null, 'Other changes')); for (const s of its) { sec.append(el('h4', null, s.title)); const u = el('ul'); s.lines.forEach((t) => u.append(el('li', null, t))); sec.append(u); } out.append(sec); }
    if (d.summary.changeCount === 0) out.append(el('p', 'hint', 'The two scenes are identical.'));
  }

  function fillSelects() {
    const list = snaps.list();
    selA.textContent = ''; selB.textContent = '';
    for (const s of list) selA.append(el('option', null, `${s.name} (${s.time}, ${s.links} link${s.links === 1 ? '' : 's'})`, { value: s.id }));
    selB.append(el('option', null, 'current scene', { value: 'current' }));
    for (const s of list) if (s.id !== st.a) selB.append(el('option', null, `snapshot ${s.name}`, { value: s.id }));
    selA.value = st.a || ''; selB.value = st.b;
    restoreBtn.disabled = !snaps.get(st.a); clearBtn.disabled = !snaps.count(); selA.disabled = selB.disabled = !snaps.count();
  }
  function compute() {
    if (!zoom.isOpen()) return;
    const a = sceneOf(st.a), b = sceneOf(st.b);
    if (!a || !b) { st.diff = null; st.same = false; renderOut(); zoom.update(); return; }
    if (a === b) { st.diff = null; st.same = true; st.error = ''; renderOut(); zoom.update(); return; } // the same object: no diff to run
    st.same = false;
    try { st.diff = cachedDiff(a, b); st.error = ''; } catch (e) { st.diff = null; st.error = 'These scenes could not be compared.'; }
    renderOut(); zoom.update();
  }
  const schedule = throttled(() => defer(compute), 300);
  function refresh(structural) {
    if (!zoom.isOpen()) return;
    if (!st.a || !snaps.get(st.a)) st.a = snaps.count() ? snaps.list()[snaps.count() - 1].id : null;
    if (st.b !== 'current' && !snaps.get(st.b)) st.b = 'current';
    if (structural) fillSelects(); // the option lists only change with the snapshots or the choice, not while the scene moves
    if (structural) { st.diff = null; renderOut(); defer(compute); } else schedule();
  }
  const unsub = store.subscribe(() => { if (zoom.isOpen() && st.b === 'current') refresh(false); });
  function open() {
    zoom.open('compare', button);
    if (button && button.setAttribute) button.setAttribute('aria-expanded', 'true');
    status.textContent = ''; refresh(true);
  }
  if (button) { button.addEventListener('click', open); button.setAttribute('aria-haspopup', 'dialog'); }
  dlg.addEventListener('close', () => { if (button && button.setAttribute) button.setAttribute('aria-expanded', 'false'); });
  return { open, zoom, st, snaps, refresh, compute, destroy() { unsub(); schedule.cancel(); zoom.destroy(); } };
}
