// Collapsible side panels: budgets (left), inspector (right), meters/timeline/spectra (bottom) and a "focus plot" toggle.
// Pure state helpers (tested) plus mountPanels(), which wires the buttons, keys, persistence and the narrow-screen re-parenting.
// State is stored per viewer in localStorage ('rf-panels.v1'); every storage access is guarded.

export const PANEL_IDS = Object.freeze(['left', 'right', 'bottom']);
export const STORE_KEY = 'rf-panels.v1';
export const WIDE_QUERY = '(min-width: 1100px)';
export const PANEL_KEYS = Object.freeze({ b: 'left', i: 'right', m: 'bottom' });
export const PANEL_TITLES = Object.freeze({ left: 'Budgets', right: 'Inspector', bottom: 'Meters, timeline and spectra' });

/** { left, right, bottom } of booleans (true = collapsed) plus focus: null | saved state. Unknown or bad input gives all open. */
export function normaliseState(raw) {
  const out = { left: false, right: false, bottom: false, focus: null };
  if (raw && typeof raw === 'object') for (const id of PANEL_IDS) if (raw[id] === true) out[id] = true;
  return out;
}

export function loadState(storage) {
  try { return normaliseState(JSON.parse(storage.getItem(STORE_KEY))); } catch { return normaliseState(null); }
}
export function saveState(storage, state) {
  try { storage.setItem(STORE_KEY, JSON.stringify({ left: !!state.left, right: !!state.right, bottom: !!state.bottom })); } catch { /* private mode or quota: the state just is not kept */ }
}

/** Toggle one panel. Leaving focus mode first (a manual toggle while focused restores the saved layout, then toggles). */
export function togglePanel(state, id) {
  if (!PANEL_IDS.includes(id)) return state;
  const base = state.focus ? { ...state.focus, focus: null } : state;
  return { ...base, focus: null, [id]: !base[id] };
}

/** Focus plot: collapse all three (remembering the layout), or restore the remembered layout. */
export function toggleFocus(state) {
  if (state.focus) return { ...state.focus, focus: null };
  if (state.left && state.right && state.bottom) return normaliseState(null); // everything already hidden by hand: show all again
  return { left: true, right: true, bottom: true, focus: { left: state.left, right: state.right, bottom: state.bottom } };
}

/** The keyboard shortcut (B, I, M, F) for an event-like object, or null. Ignores modified keys and typing in fields. */
export function shortcutFor(e) {
  if (!e || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return null;
  const t = e.target;
  const tag = t && t.tagName ? String(t.tagName).toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return null;
  const k = String(e.key || '').toLowerCase();
  if (k === 'f') return { focus: true };
  return PANEL_KEYS[k] ? { panel: PANEL_KEYS[k] } : null;
}

export function mountPanels({ doc = document, storage = (typeof localStorage !== 'undefined' ? localStorage : null), win = window } = {}) {
  let state = storage ? loadState(storage) : normaliseState(null);
  const mq = win.matchMedia(WIDE_QUERY);
  const panelEl = (id) => doc.querySelector(`[data-panel="${id}"]`);
  const announceEl = doc.getElementById('share-status');

  function apply(say) {
    for (const id of PANEL_IDS) {
      const el = panelEl(id); if (!el) continue;
      const collapsed = !!state[id];
      el.dataset.collapsed = String(collapsed);
      doc.documentElement.dataset[{ left: 'pl', right: 'pr', bottom: 'pb' }[id]] = collapsed ? 'c' : 'o';
      const body = el.querySelector(':scope > .panel-body');
      if (body) body.inert = collapsed && mq.matches; // collapsed content is not reachable by keyboard or screen reader
      for (const b of doc.querySelectorAll(`[data-toggle="${id}"]`)) b.setAttribute('aria-expanded', String(!collapsed));
    }
    const fb = doc.getElementById('btn-focus');
    if (fb) fb.setAttribute('aria-pressed', String(!!state.focus));
    doc.documentElement.dataset.focusPlot = String(!!state.focus);
    if (storage) saveState(storage, state.focus ? state.focus : state);
    // canvases follow their boxes through ResizeObserver; one resize event also covers anything listening on the window
    win.dispatchEvent(new Event('resize'));
    if (say && announceEl) { /* the aria-expanded change is announced by the button itself */ }
  }

  const toggle = (id) => { state = togglePanel(state, id); apply(); };
  const focus = () => { state = toggleFocus(state); apply(); };
  for (const b of doc.querySelectorAll('[data-toggle]')) b.addEventListener('click', () => toggle(b.dataset.toggle));
  const fb = doc.getElementById('btn-focus'); if (fb) fb.addEventListener('click', focus);
  const onKey = (e) => {
    const s = shortcutFor(e);
    if (!s || !win.matchMedia(WIDE_QUERY).matches) return;
    e.preventDefault();
    if (s.focus) focus(); else toggle(s.panel);
  };
  doc.addEventListener('keydown', onKey);

  // below 1100 px the budgets live at the top of the inspector column (as before), above they have their own panel
  function place() {
    const results = doc.getElementById('results'), wf = doc.getElementById('waterfall'), pp = doc.getElementById('paths-panel'), mp = doc.getElementById('mode-panel');
    const left = doc.getElementById('leftpanel-body'), right = doc.getElementById('sidebar-body');
    if (!results || !wf || !left || !right) return;
    if (mq.matches) { left.append(results, wf); if (pp) left.append(pp); if (mp) left.append(mp); } else { right.prepend(results); right.append(wf); if (pp) right.append(pp); if (mp) right.append(mp); }
  }
  const onMq = () => { place(); apply(); };
  if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
  place(); apply();
  return { get state() { return state; }, toggle, focus, destroy() { doc.removeEventListener('keydown', onKey); if (mq.removeEventListener) mq.removeEventListener('change', onMq); } };
}
