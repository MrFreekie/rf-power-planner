// Accessibility glue for the canvas views (no changes to index.html needed):
//  - one polite and one assertive live region, with announce() (debounced per key);
//  - announcements for squelch open/close and link pass/marginal/fail changes (state words, not colour only);
//  - landmark roles for the sidebar and timeline, a skip link, and #results made non-live (the readout changes on every
//    drag frame; the announcer below speaks only meaningful transitions).
import { squelch } from '../squelchTracker.js';
import { solveCached } from './util.js';

let live = null, alive = null, inited = false;
const timers = new Map();

function ensureRegions() {
  if (live) return;
  const mk = (kind, role) => {
    const e = document.createElement('div');
    e.className = 'sr-only'; e.id = `a11y-live-${kind}`;
    e.setAttribute('role', role); e.setAttribute('aria-live', kind); e.setAttribute('aria-atomic', 'true');
    document.body.append(e); return e;
  };
  live = mk('polite', 'status');
  alive = mk('assertive', 'alert');
}

/** Speak a message. Calls with the same key within `delay` ms collapse into the last one. */
export function announce(message, { key = message, assertive = false, delay = 0 } = {}) {
  if (typeof document === 'undefined') return;
  ensureRegions();
  clearTimeout(timers.get(key));
  const go = () => {
    timers.delete(key);
    const r = assertive ? alive : live;
    r.textContent = '';
    setTimeout(() => { r.textContent = message; }, 30); // re-set so repeated text is read again
  };
  if (delay > 0) timers.set(key, setTimeout(go, delay)); else go();
}

const REASONS = { carrier: 'signal below threshold', pilot: 'pilot lost', battery: 'transmitter battery low', digital: 'digital link down', imd: 'intermodulation noise', interferer: 'stray carrier' };

export function initA11y(store) {
  if (inited || typeof document === 'undefined') return;
  inited = true;
  ensureRegions();
  const res = document.getElementById('results');
  if (res) res.setAttribute('aria-live', 'off');
  const sb = document.getElementById('sidebar');
  if (sb && !sb.getAttribute('role')) { sb.setAttribute('role', 'complementary'); sb.setAttribute('aria-label', 'Results, meters and inspector'); }
  const tl = document.getElementById('timeline');
  if (tl && !tl.getAttribute('role')) tl.setAttribute('role', 'region');
  if (!document.getElementById('skip-link')) {
    const a = document.createElement('a');
    a.id = 'skip-link'; a.className = 'skip-link'; a.href = '#plan-canvas'; a.textContent = 'Skip to plan view';
    a.addEventListener('click', (e) => { const c = document.getElementById('plan-canvas'); if (c) { e.preventDefault(); c.focus(); } });
    document.body.prepend(a);
  }

  const nameOf = (id) => (store.getScene().links.find((l) => l.id === id) || {}).name || 'Link';
  // squelch open/close, only when the gate really flips (headroom changes are ignored)
  const lastGate = new Map();
  squelch.subscribe((id) => {
    const scene = store.getScene();
    for (const l of scene.links) {
      const s = squelch.get(l.id); if (!s) continue;
      const sig = `${s.open ? 1 : 0}`;
      const prev = lastGate.get(l.id);
      lastGate.set(l.id, sig);
      if (prev === undefined || prev === sig) continue;
      announce(s.open ? `${l.name}: squelch open, audio on` : `${l.name}: squelch closed, audio muted${s.reason && REASONS[s.reason] ? `, ${REASONS[s.reason]}` : ''}`, { key: `sq-${l.id}`, assertive: !s.open, delay: 600 });
    }
  });

  // link pass / marginal / fail
  const lastStatus = new Map();
  let t = 0;
  const check = () => {
    t = 0;
    const scene = store.getScene();
    for (const l of scene.links) {
      const r = solveCached(scene, l); if (!r) continue;
      const prev = lastStatus.get(l.id);
      lastStatus.set(l.id, r.status);
      if (prev === undefined || prev === r.status) continue;
      const word = r.status === 'pass' ? 'PASS' : r.status === 'marginal' ? 'MARGINAL' : 'FAIL';
      announce(`${nameOf(l.id)}: link ${word}, margin ${r.marginDb >= 0 ? 'plus' : 'minus'} ${Math.abs(r.marginDb).toFixed(1)} dB`, { key: `st-${l.id}`, assertive: r.status === 'fail', delay: 0 });
    }
  };
  check();
  store.subscribe(() => { clearTimeout(t); t = setTimeout(check, 700); }); // settle after a drag before speaking
}
