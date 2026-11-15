// Command palette (Ctrl+K, "/" or the Find button): a search box over every toolbar action, example and inspector section.
// Pure helpers (fuzzyScore, rankItems, categoryOf, shortcutHint, recents, collectToolbarItems) run in Node; mountPalette() builds the dialog.
// The dialog follows the ARIA combobox + listbox pattern: the input keeps focus, aria-activedescendant names the highlighted option.

export const RECENT_KEY = 'rf-bench.palette.recent.v1';
export const MAX_RECENT = 6, MAX_SHOWN = 250;
export const SHORTCUTS = Object.freeze({ 'btn-undo': 'Ctrl+Z', 'btn-redo': 'Ctrl+Shift+Z', 'btn-panel-left': 'B', 'btn-panel-right': 'I', 'btn-panel-bottom': 'M', 'btn-focus': 'F', 'btn-cmd': 'Ctrl+K' });
const PREFIXED_GROUPS = new Set(['Scenario', 'Power units', 'Length units', 'Propagation model', 'Modulation', 'Walk', 'Battery', 'Panels', 'History']);
export const CATEGORIES = Object.freeze(['Best practice', 'Less ideal', 'Problem', 'Compare']);

/** The category an example's note starts with ("Best practice: ..."), else 'Example'. */
export function categoryOf(note) {
  const m = /^\s*(Best practice|Less ideal|Problem|Compare)\b/i.exec(String(note || ''));
  if (!m) return 'Example';
  return CATEGORIES.find((c) => c.toLowerCase() === m[1].toLowerCase());
}
export const shortcutHint = (id) => SHORTCUTS[id] || '';

/** Score one query token against a text: higher is better, -1 means no match. Substring beats word start beats scattered letters. */
function tokenScore(tok, text, scatter = true) {
  const i = text.indexOf(tok);
  if (i >= 0) return 200 - Math.min(i, 60) + (i === 0 || !/[a-z0-9]/.test(text[i - 1]) ? 60 : 0) + (text.length === tok.length ? 80 : 0);
  if (!scatter || tok.length < 4) return -1; // scattered letters only on the label, and only for longer tokens
  let p = 0, gaps = 0, last = -1;
  for (const ch of tok) {
    const j = text.indexOf(ch, p);
    if (j < 0) return -1;
    if (last >= 0 && j > last + 1) gaps += j - last - 1;
    last = j; p = j + 1;
  }
  if (gaps > tok.length * 2) return -1;
  return Math.max(1, 60 - Math.min(gaps, 55));
}
/** fuzzyScore(query, text, extra?) -> score >= 0 or -1. Every space-separated token must match the text (or the extra keywords at half weight). */
export function fuzzyScore(query, text, extra = '') {
  const toks = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return 0;
  const t = String(text || '').toLowerCase(), x = String(extra || '').toLowerCase();
  let total = 0;
  for (const tok of toks) {
    const a = tokenScore(tok, t), b = x ? tokenScore(tok, x, false) : -1;
    const s = Math.max(a, b >= 0 ? b / 2 : -1);
    if (s < 0) return -1;
    total += s;
  }
  return total - Math.min(t.length, 80) / 20;
}

/** rankItems(items, query, recents) -> items best first. Empty query: recents (most recent first), then the original order. */
export function rankItems(items, query, recents = []) {
  const q = String(query || '').trim();
  const rIdx = new Map(recents.map((id, i) => [id, i]));
  if (!q) {
    const recent = recents.map((id) => items.find((it) => it.id === id)).filter(Boolean).map((it) => ({ ...it, recent: true }));
    return [...recent, ...items.filter((it) => !rIdx.has(it.id))].slice(0, MAX_SHOWN);
  }
  const scored = [];
  items.forEach((it, order) => {
    const s = fuzzyScore(q, it.label, `${it.group || ''} ${it.keywords || ''}`);
    if (s >= 0) scored.push({ it, s: s + (rIdx.has(it.id) ? 15 - rIdx.get(it.id) : 0), order });
  });
  scored.sort((a, b) => b.s - a.s || a.order - b.order);
  return scored.slice(0, MAX_SHOWN).map((x) => x.it);
}

export function loadRecents(storage) { try { const v = JSON.parse(storage.getItem(RECENT_KEY)); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, MAX_RECENT) : []; } catch { return []; } }
export function saveRecent(storage, id, current = loadRecents(storage)) {
  const next = [id, ...current.filter((x) => x !== id)].slice(0, MAX_RECENT);
  try { storage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* storage unavailable: recents just do not persist */ }
  return next;
}

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
/** Items from the live toolbar: every visible, enabled button with text (id, label, hint, shortcut, run). */
export function collectToolbarItems(doc) {
  const out = [];
  for (const b of doc.querySelectorAll('#toolbar button')) {
    if (!b.id || b.id === 'btn-cmd' || b.hidden || b.disabled || b.closest && b.closest('[hidden]')) continue;
    const text = clean(b.textContent);
    if (!text) continue;
    const grp = b.closest && b.closest('[role="group"]'), gl = grp && grp.getAttribute ? grp.getAttribute('aria-label') : '';
    const label = gl && PREFIXED_GROUPS.has(gl) && gl !== 'Help and reset' ? `${gl}: ${text}` : text;
    out.push({ id: `cmd:${b.id}`, label, group: 'Command', keywords: clean(b.getAttribute('title')), shortcut: shortcutHint(b.id), run: () => b.click() });
  }
  return out;
}
/** Toolbar form controls that are not buttons (audio source select, tone Hz field): choosing the entry focuses the control. */
export const CONTROL_ENTRIES = Object.freeze([
  { id: 'audio-source', label: 'Audio source', keywords: 'audio source tone two-tone sweep music speech pink noise test signal' },
  { id: 'audio-tone-hz', label: 'Tone Hz', keywords: 'tone frequency hertz audio test signal' },
]);
export function collectControlItems(doc) {
  const out = [];
  const hiddenEl = (e) => !!(e && (e.hidden || (e.closest && e.closest('[hidden]'))));
  const sel = doc.getElementById('audio-source');
  for (const c of CONTROL_ENTRIES) {
    const el = doc.getElementById(c.id);
    if (!el || hiddenEl(sel)) continue;
    out.push({ id: `ctl:${c.id}`, label: c.label, group: 'Toolbar control', keywords: c.keywords, run: () => {
      // the tone field is hidden or disabled for sources without a tone: focus the source select that enables it instead
      const target = (hiddenEl(el) || el.disabled) && sel ? sel : el;
      if (target.scrollIntoView) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      target.focus();
    } });
  }
  return out;
}
/** Inspector sections that exist in the right panel: open and focus. */
export function collectSectionItems(doc) {
  const out = [];
  const reveal = () => { const r = doc.getElementById('btn-panel-right'); if (r && r.getAttribute('aria-expanded') === 'false') r.click(); };
  for (const d of doc.querySelectorAll('#sidebar-body > details')) {
    const s = d.querySelector('summary'), label = clean(s && s.textContent);
    if (label) out.push({ id: `sec:${d.id || label}`, label: `Inspector: ${label}`, group: 'Inspector section', keywords: '', run: () => { reveal(); d.open = true; if (s && s.focus) s.focus(); if (d.scrollIntoView) d.scrollIntoView({ block: 'nearest' }); } });
  }
  for (const s of doc.querySelectorAll('#sidebar-body > section[aria-label]')) {
    const label = clean(s.getAttribute('aria-label'));
    if (!label) continue;
    out.push({ id: `sec:${s.id || label}`, label: `Inspector: ${label}`, group: 'Inspector section', keywords: '', run: () => { reveal(); if (s.setAttribute && !s.hasAttribute('tabindex')) s.setAttribute('tabindex', '-1'); if (s.focus) s.focus(); if (s.scrollIntoView) s.scrollIntoView({ block: 'nearest' }); } });
  }
  return out;
}
/** Items for the examples: grouped by the category prefix of the note. */
export function exampleItems(examples, apply) {
  return (examples || []).map((ex) => { const cat = categoryOf(ex.note); return { id: `ex:${ex.id}`, label: ex.title, group: `Example · ${cat}`, keywords: `example ${cat}`, run: () => apply(ex.id) }; });
}

export function mountPalette({ doc = document, button, getItems, storage = (() => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } })(), win = typeof window !== 'undefined' ? window : null } = {}) {
  const el = (tag, cls, text, attrs) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const dlg = el('dialog', 'cmd-dialog', null, { 'aria-label': 'Command palette', 'data-no-gloss': '' });
  const label = el('label', 'cmd-label', 'Find a command, example or section', { for: 'cmd-input' });
  const input = el('input', 'cmd-input', null, { id: 'cmd-input', type: 'text', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'cmd-list', 'aria-autocomplete': 'list', autocomplete: 'off', spellcheck: 'false', placeholder: 'Type to search, Enter to run' });
  const list = el('ul', 'cmd-list', null, { id: 'cmd-list', role: 'listbox', 'aria-label': 'Results' });
  const count = el('p', 'cmd-count', '', { role: 'status', 'aria-live': 'polite' });
  const hint = el('p', 'cmd-hint', 'Up and Down move, Enter runs, Escape closes. Ctrl+K or / opens this from anywhere.');
  const closeBtn = el('button', 'cmd-close', 'Close', { type: 'button' });
  const head = el('div', 'cmd-head'); head.append(label, closeBtn);
  dlg.append(head, input, count, list, hint);
  doc.body.append(dlg);

  let shown = [], active = 0, opener = null, items = [], recents = storage ? loadRecents(storage) : [];
  const optId = (i) => `cmd-opt-${i}`;
  function render() {
    list.textContent = '';
    shown = rankItems(items, input.value, recents);
    shown.forEach((it, i) => {
      const li = el('li', `cmd-opt${i === active ? ' active' : ''}`, null, { id: optId(i), role: 'option', 'aria-selected': String(i === active) });
      li.append(el('span', 'cmd-name', it.label), el('span', 'cmd-group', it.recent ? `Recent · ${it.group}` : it.group));
      if (it.shortcut) li.append(el('kbd', 'cmd-key', it.shortcut));
      li.addEventListener('click', () => { active = i; run(); });
      li.addEventListener('pointermove', () => { if (active !== i) setActive(i, false); });
      list.append(li);
    });
    if (active >= shown.length) active = Math.max(0, shown.length - 1);
    input.setAttribute('aria-activedescendant', shown.length ? optId(active) : '');
    count.textContent = shown.length ? `${shown.length} result${shown.length === 1 ? '' : 's'}` : 'No results';
    syncActive();
  }
  function syncActive(scroll = true) {
    Array.from(list.children).forEach((li, i) => { li.className = `cmd-opt${i === active ? ' active' : ''}`; li.setAttribute('aria-selected', String(i === active)); });
    input.setAttribute('aria-activedescendant', shown.length ? optId(active) : '');
    const cur = list.children[active]; if (scroll && cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }
  function setActive(i, scroll = true) { if (!shown.length) return; active = (i + shown.length) % shown.length; syncActive(scroll); }
  function run() {
    const it = shown[active]; if (!it) return;
    if (storage) recents = saveRecent(storage, it.id, recents);
    close(true);
    try { it.run(); } catch (e) { if (win && win.console) win.console.error('palette command', e); }
  }
  function close(restore = true) {
    const o = opener; opener = null;
    if (dlg.open) dlg.close();
    if (restore && o && o.focus) o.focus();
  }
  function open() {
    if (dlg.open) { input.focus(); return; }
    opener = doc.activeElement || button || null;
    try { items = getItems(); } catch { items = []; }
    recents = storage ? loadRecents(storage) : [];
    input.value = ''; active = 0;
    dlg.showModal(); render(); input.focus();
    if (button && button.setAttribute) button.setAttribute('aria-expanded', 'true');
  }
  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (k === 'Home' && !input.value) { e.preventDefault(); setActive(0); }
    else if (k === 'End' && !input.value) { e.preventDefault(); setActive(shown.length - 1); }
    else if (k === 'PageDown') { e.preventDefault(); setActive(Math.min(shown.length - 1, active + 8)); }
    else if (k === 'PageUp') { e.preventDefault(); setActive(Math.max(0, active - 8)); }
    else if (k === 'Enter') { e.preventDefault(); run(); }
  });
  closeBtn.addEventListener('click', () => close(true));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(true); });
  dlg.addEventListener('close', () => { // Escape: native close; return focus to where the palette was opened
    const o = opener; opener = null;
    if (button && button.setAttribute) button.setAttribute('aria-expanded', 'false');
    if (o && o.focus) o.focus();
  });
  if (button) { button.addEventListener('click', open); button.setAttribute('aria-haspopup', 'dialog'); }

  const typing = (t) => { const tag = t && t.tagName ? String(t.tagName).toUpperCase() : ''; return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || !!(t && t.isContentEditable); };
  const anyModal = () => [...doc.querySelectorAll('dialog')].some((d) => d !== dlg && d.open);
  const onKey = (e) => {
    if (e.defaultPrevented) return;
    const k = String(e.key || '');
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && k.toLowerCase() === 'k') { if (anyModal()) return; e.preventDefault(); if (dlg.open) close(true); else open(); return; }
    if (k === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target) && !dlg.open && !anyModal()) { e.preventDefault(); open(); }
  };
  doc.addEventListener('keydown', onKey);
  return { open, close, dlg, input, list, isOpen: () => !!dlg.open, destroy() { doc.removeEventListener('keydown', onKey); if (dlg.open) dlg.close(); dlg.remove(); } };
}
