// Drag handle on the top edge of the bottom bar: drag (or press Up / Down) to make the meters, timeline and spectra taller or shorter. The height is kept in this browser only.
const KEY = 'rf-bottombar-h.v1', MIN_PX = 140, MAX_FRAC = 0.7, STEP_PX = 24;

/** clampBottomHeight(px, viewportHeight) -> a whole number of pixels between 140 and 70% of the window. Pure. */
export function clampBottomHeight(px, viewportH) {
  const max = Math.max(MIN_PX, Math.floor((Number.isFinite(viewportH) ? viewportH : 800) * MAX_FRAC));
  const v = Number.isFinite(px) ? Math.round(px) : MIN_PX;
  return Math.min(max, Math.max(MIN_PX, v));
}

export function mountBottomResize({ doc = document, win = window, storage = (typeof localStorage !== 'undefined' ? localStorage : null) } = {}) {
  const bar = doc.getElementById('bottombar'), grip = doc.getElementById('bottombar-grip');
  if (!bar || !grip) return null;
  const read = () => { try { const v = Number(storage && storage.getItem(KEY)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; } };
  const write = (v) => { try { if (storage) { if (v === null) storage.removeItem(KEY); else storage.setItem(KEY, String(v)); } } catch { /* private mode: the height is just not kept */ } };
  const set = (px, save) => {
    const v = clampBottomHeight(px, win.innerHeight);
    bar.style.height = `${v}px`;
    grip.setAttribute('aria-valuenow', String(v)); grip.setAttribute('aria-valuemin', String(MIN_PX)); grip.setAttribute('aria-valuemax', String(clampBottomHeight(1e6, win.innerHeight)));
    if (save) write(v);
    win.dispatchEvent(new Event('resize'));
    return v;
  };
  const reset = () => { bar.style.removeProperty('height'); write(null); grip.removeAttribute('aria-valuenow'); win.dispatchEvent(new Event('resize')); };
  const saved = read();
  if (saved) set(saved, false);
  let drag = null;
  grip.addEventListener('pointerdown', (e) => {
    drag = { y: e.clientY, h: bar.getBoundingClientRect().height };
    try { grip.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    e.preventDefault();
  });
  grip.addEventListener('pointermove', (e) => { if (drag) set(drag.h + (drag.y - e.clientY), false); });
  const end = () => { if (!drag) return; drag = null; set(bar.getBoundingClientRect().height, true); };
  grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  grip.addEventListener('dblclick', reset);
  grip.addEventListener('keydown', (e) => {
    const h = bar.getBoundingClientRect().height;
    if (e.key === 'ArrowUp') set(h + STEP_PX, true); else if (e.key === 'ArrowDown') set(h - STEP_PX, true); else if (e.key === 'Home' || e.key === 'Escape') reset(); else return;
    e.preventDefault();
  });
  win.addEventListener('resize', () => { if (bar.style.height) { const v = clampBottomHeight(parseFloat(bar.style.height), win.innerHeight); if (`${v}px` !== bar.style.height) bar.style.height = `${v}px`; } });
  return { set, reset };
}
