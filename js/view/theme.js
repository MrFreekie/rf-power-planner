// Theme state: 'auto' (follow prefers-color-scheme), 'light' or 'dark'. The choice lives on <html data-theme>,
// is persisted in localStorage (try/catch, storage may be blocked) and announced with a 'rf-theme' event on window so
// canvas hosts can redraw. Canvases read their colours from the CSS tokens (util.readTheme); report snapshots force
// the light palette via withLightTheme so printed output never depends on the on-screen theme.
const KEY = 'rf-theme.v1';
const MODES = ['auto', 'light', 'dark'];
let mode = 'auto';
let forceLight = 0;
let inited = false;

export const LIGHT_TOKENS = {
  paper: '#fbf9f3', paper2: '#f1eee4', ink: '#1d2733', inkSoft: '#5b6673',
  grid: '#e6e1d3', gridMajor: '#d2cbb7', hatch: '#d9d3c1',
  pass: '#1f7a46', marginal: '#d99a00', fail: '#c0392b',
  warnText: '#8a6200', onFail: '#ffffff', blue: '#4a78b5', mono: '#9aa1a9', inkRgb: '29,39,51',
};

export const isForcedLight = () => forceLight > 0;
export function withLightTheme(fn) {
  forceLight++;
  try { return fn(); } finally { forceLight--; }
}

export function getThemeMode() { return mode; }
/** Effective scheme right now: 'light' | 'dark'. */
export function effectiveTheme() {
  if (forceLight > 0) return 'light';
  if (mode === 'light' || mode === 'dark') return mode;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply() {
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', mode);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', effectiveTheme() === 'dark' ? '#14181d' : '#fbf9f3');
  window.dispatchEvent(new Event('rf-theme'));
  syncButton();
}

export function setThemeMode(next) {
  if (!MODES.includes(next)) return;
  mode = next;
  try { localStorage.setItem(KEY, mode); } catch { /* storage unavailable */ }
  apply();
}
export function cycleThemeMode() { setThemeMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]); }

// ---- toolbar toggle (injected, so index.html needs no change) ---------------------------------------
let btn = null;
const LABEL = { auto: 'Theme: Auto', light: 'Theme: Light', dark: 'Theme: Dark' };
function syncButton() {
  if (!btn) return;
  btn.textContent = LABEL[mode];
  btn.setAttribute('aria-label', `Colour theme: ${mode === 'auto' ? 'automatic, follows the system' : mode}. Activate to change.`);
  btn.title = 'Cycle colour theme: Auto (system), Light, Dark';
}
function mountButton() {
  const bar = document.getElementById('toolbar');
  if (!bar || btn || document.getElementById('btn-theme')) return;
  btn = document.createElement('button');
  btn.type = 'button'; btn.id = 'btn-theme';
  btn.addEventListener('click', cycleThemeMode);
  bar.append(btn);
  syncButton();
}

export function initTheme() {
  if (inited) return;
  inited = true;
  try { const v = localStorage.getItem(KEY); if (MODES.includes(v)) mode = v; } catch { /* ignore */ }
  const root = document.documentElement;
  if (mode !== 'auto') root.setAttribute('data-theme', mode);
  if (typeof matchMedia === 'function') {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (mode === 'auto') apply(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { mountButton(); apply(); }, { once: true });
  else { mountButton(); apply(); }
}
