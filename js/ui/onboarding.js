// First-visit "Start here" panel. Pure helpers (storage injected) plus mountWelcome().
export const WELCOME_KEY = 'rf-power-planner.welcome.v1';

export const WELCOME_STEPS = Object.freeze([
  { title: 'Read the two views', text: 'The Plan view is the stage seen from above; the Side view is a vertical slice along the line from transmitter to receiver. Both are drawn to scale, with the thin lines showing the direct and reflected radio paths.' },
  { title: 'Drag things around', text: 'Drag the microphone, the receive antenna or a wall in either view. The numbers update live, and Undo (Ctrl+Z) takes back any move.' },
  { title: 'Fine-tune in the inspector', text: 'Click an item to select it. The Inspector lists its power, antenna, cables, boosters and height as typed values, so you can set exact numbers.' },
  { title: 'Try an example', text: 'The Examples menu in the toolbar loads ready-made situations (long cable, dead spots, intermodulation) with a short note on what to look for.' },
  { title: 'Walk the stage', text: 'Press Walk and the transmitter strolls across the stage while the meters and timeline show where the signal dips or drops out. Remember: these are planning estimates, not a site survey.' },
]);

export function defaultStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/** True until the welcome panel has been dismissed once. Storage trouble counts as "not seen" (the panel is harmless). */
export function shouldShowWelcome(storage = defaultStorage()) {
  try { return !(storage && storage.getItem(WELCOME_KEY) === '1'); } catch { return true; }
}
export function markWelcomeSeen(storage = defaultStorage()) {
  try { if (storage) storage.setItem(WELCOME_KEY, '1'); return true; } catch { return false; }
}
export function resetWelcome(storage = defaultStorage()) {
  try { if (storage) storage.removeItem(WELCOME_KEY); return true; } catch { return false; }
}

/**
 * mountWelcome({ container, openButton?, storage? }) -> { open, close, isOpen }
 * Shown on first visit; "Got it" remembers the dismissal; the Help button re-opens it.
 */
export function mountWelcome({ container, openButton, storage = defaultStorage() }) {
  container.textContent = '';
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', 'Start here');
  const head = document.createElement('div');
  head.className = 'ob-welcome-head';
  const h = document.createElement('h2');
  h.id = 'welcome-title';
  h.textContent = 'Start here';
  const close = document.createElement('button');
  close.type = 'button'; close.id = 'welcome-close'; close.textContent = 'Got it';
  close.title = 'Hide this guide. The Help button brings it back.';
  head.append(h, close);
  const intro = document.createElement('p');
  intro.className = 'ob-welcome-intro';
  intro.textContent = 'RF Bench shows how strong a wireless microphone or in-ear-monitor signal is at its receiver, and how much spare level ("margin") you have before it drops out.';
  const ol = document.createElement('ol');
  ol.className = 'ob-steps';
  for (const s of WELCOME_STEPS) {
    const li = document.createElement('li');
    const b = document.createElement('strong');
    b.textContent = s.title + '. ';
    li.append(b, document.createTextNode(s.text));
    ol.append(li);
  }
  container.append(head, intro, ol);

  const isOpen = () => !container.hidden;
  function open({ focus = false } = {}) {
    container.hidden = false;
    if (openButton) openButton.setAttribute('aria-expanded', 'true');
    if (focus) { container.tabIndex = -1; container.focus({ preventScroll: false }); }
  }
  function dismiss() {
    container.hidden = true;
    if (openButton) { openButton.setAttribute('aria-expanded', 'false'); }
    markWelcomeSeen(storage);
  }
  close.addEventListener('click', () => { dismiss(); if (openButton) openButton.focus(); });
  container.addEventListener('keydown', (e) => { if (e.key === 'Escape') { dismiss(); if (openButton) openButton.focus(); } });
  if (openButton) openButton.addEventListener('click', () => { if (isOpen()) dismiss(); else open({ focus: true }); });

  if (shouldShowWelcome(storage)) open(); else dismiss();
  return { open, close: dismiss, isOpen };
}
