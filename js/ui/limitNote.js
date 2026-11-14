// "Limit reached (N)" message for the Add buttons when an action refuses at a SCENE_LIMITS cap.
// limitText is pure; showLimit puts a short live-region note next to the button and removes it after a few seconds.
import { SCENE_LIMITS, PLATFORM_LIMITS } from '../model/scene.js';

export const LIMIT_OF = Object.freeze({
  reflector: () => SCENE_LIMITS.maxReflectors,
  zone: () => SCENE_LIMITS.maxZones,
  transmitter: () => SCENE_LIMITS.maxImdTransmitters,
  platform: () => PLATFORM_LIMITS.max,
});

/** limitText('reflector') -> 'Limit reached (500 reflectors).' */
export function limitText(what) {
  const f = LIMIT_OF[what];
  return f ? `Limit reached (${f()} ${what}s).` : 'Limit reached.';
}

/** Run an add action; select the new item, or show the limit note beside the button when the action returned nothing. */
export function addOrLimit(store, button, what, add) {
  const id = add();
  if (id) { store.select(id); return id; }
  showLimit(button, what);
  return null;
}

export function showLimit(button, what, ms = 5000) {
  if (!button || !button.parentNode) return null;
  const old = button.nextElementSibling;
  if (old && old.classList && old.classList.contains('limit-note')) old.remove();
  const span = document.createElement('span');
  span.className = 'limit-note'; span.setAttribute('role', 'status');
  button.after(span);
  setTimeout(() => { span.textContent = limitText(what); }, 30); // text added after insertion so the live region announces it
  setTimeout(() => span.remove(), ms);
  return span;
}
