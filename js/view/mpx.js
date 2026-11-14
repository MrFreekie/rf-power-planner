// FM stereo (MPX) demo panel: stereo/blend/mono indicator, pilot lock LED,
// numbers, L/R audio meters and a separation bar. Draw only: state comes from js/mpxTracker.js.
// The MPX baseband spectrum now lives in the bottom bar (js/view/spectra.js, drawMpx).
import { createCanvasHost, activeLink, setFont, haloText, strokeHatchRect } from './util.js';
import { history } from '../history.js';
import { squelch } from '../squelchTracker.js';

export const SPEC_DB = { min: -90, max: 0 };
export const STEREO_BLUE = '#4a78b5';
export const MONO_GREY = '#9aa1a9';

/** Text for the stereo mode indicator. Pure. */
export function modeText(state) {
  if (!state) return '-';
  if (state.mode === 'stereo') return 'STEREO';
  if (state.mode === 'mono') return 'MONO';
  return `BLEND ${Math.round((state.blend ?? 0) * 100)}%`;
}

/** Which message to show when no spectrum applies, or '' when the panel should draw. Pure. */
export function mpxMessage(link) {
  if (!link) return 'No link selected.';
  if (link.kind !== 'iem') return 'Microphone links carry mono audio, so there is no stereo multiplex to show. Switch to an in-ear monitor link with MPX stereo enabled.';
  if (!link.mpx || !link.mpx.enabled) return 'MPX stereo is off for this link. Enable it in the inspector to see the stereo multiplex.';
  return '';
}

const fmtDb = (v, d = 1) => (Number.isFinite(v) ? `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)} dB` : '-');

export function mountMpx({ container, store, tracker = null }) {
  container.classList.add('mpx');
  container.textContent = '';
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const h2 = el('h2', null, 'FM stereo (MPX)');
  const msg = el('p', 'hint');
  const body = el('div', 'mpx-body');
  const top = el('div', 'mpx-top');
  const modeChip = el('span', 'chip mpx-mode');
  const led = el('span', 'mpx-led');
  const ledLabel = el('span', 'mpx-led-label', 'PILOT');
  const ledWrap = el('span', 'mpx-pilot'); ledWrap.append(led, ledLabel);
  const capChip = el('span', 'chip mpx-cap'); capChip.hidden = true;
  const reasonChip = el('span', 'chip mpx-reason'); reasonChip.hidden = true;
  top.append(modeChip, ledWrap, capChip, reasonChip);
  const nums = el('dl', 'mpx-nums');
  const numEls = {};
  for (const [k, label] of [['cnr', 'CNR'], ['sep', 'Separation'], ['snr', 'Audio SNR'], ['cir', 'C/I (stray)']]) {
    const d = el('div'); const dt = el('dt', null, label); const dd = el('dd', null, '-');
    d.append(dt, dd); nums.append(d); numEls[k] = dd;
  }
  const meters = el('canvas', 'mpx-meters'); meters.style.height = '96px';
  meters.setAttribute('role', 'img');
  meters.setAttribute('aria-label', 'Left and right audio meters with stereo separation bar');
  const cap = el('p', 'hint mpx-caption',
    'The spectrum of this multiplex is in the bottom bar (MPX spectrum). The left-minus-right (L−R) signal rides on a 38 kHz subcarrier, higher up the spectrum where FM noise is strongest, so it is the first thing to sink into the noise as the signal weakens. The 19 kHz pilot tone tells the receiver that stereo is present and gives it the phase reference to decode L−R; when the pilot is lost the receiver falls back to mono (L+R). Values are illustrative.');
  body.append(top, nums, cap, meters);
  container.append(h2, msg, body);

  let src = tracker;
  let state = null, link = null, lastSample = null;

  function pick() {
    link = activeLink(store.getScene(), store.getSelection());
    const m = mpxMessage(link);
    msg.textContent = m; msg.hidden = !m; body.hidden = !!m;
    state = link && src ? src.get(link.id) : null;
    const g = link ? history.get(link.id, 1) : [];
    lastSample = g.length ? g[g.length - 1] : null;
    if (lastSample && lastSample.mode && !state) state = lastSample;
    if (!m && !src && !state) { msg.hidden = false; msg.textContent = 'Waiting for the MPX model.'; }
    updateText();
    mHost.invalidate();
  }

  function updateText() {
    const st = state;
    modeChip.textContent = modeText(st);
    modeChip.dataset.state = st ? st.mode : 'none';
    led.dataset.state = !st ? 'none' : st.pilotLocked ? 'locked' : 'lost';
    ledLabel.textContent = !st ? 'PILOT' : st.pilotLocked ? 'PILOT LOCK' : 'PILOT LOST';
    numEls.cnr.textContent = st ? fmtDb(st.cnrDb) : '-';
    numEls.sep.textContent = st ? fmtDb(st.separationDb) : '-';
    numEls.snr.textContent = st ? fmtDb(st.audioSnrDb) : '-';
    const ifr = link && link.interferer && link.interferer.enabled ? link.interferer : null;
    const g = link ? squelch.get(link.id) : null;
    const cap = ifr && g && g.capture ? g.capture : null; // capture state lives on the squelch state
    numEls.cir.parentElement.hidden = !ifr;
    numEls.cir.textContent = cap && Number.isFinite(cap.cirDb) ? fmtDb(cap.cirDb) : '-';
    capChip.hidden = !cap;
    if (cap) {
      capChip.textContent = cap.captured === 'interferer' ? 'CAPTURED by interferer' : cap.captured === 'none' ? 'GARBLED: no capture' : 'Wanted signal captures';
      capChip.dataset.state = cap.captured === 'interferer' ? 'closed' : cap.captured === 'none' ? 'warn' : 'open';
    }
    let rtxt = '';
    if (g && !g.open && g.reason === 'pilot') rtxt = 'Squelch closed: pilot lost (pilot squelch rejects it)';
    else if (g && !g.open && g.reason === 'interferer') rtxt = 'Squelch closed: interferer';
    else if (g && g.open && cap && cap.captured === 'interferer') rtxt = 'Squelch OPEN although the audio is the interferer (carrier squelch cannot tell)';
    reasonChip.textContent = rtxt; reasonChip.hidden = !rtxt;
    reasonChip.dataset.state = g && !g.open ? 'closed' : 'warn';
  }

  function drawMeters(ctx, w, h, th) {
    if (!state) return;
    const L = 22, R = 10, x1 = w - R, bw = x1 - L;
    const aL = lastSample?.audioL ?? lastSample?.audioDb, aR = lastSample?.audioR ?? lastSample?.audioDb;
    const level = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, (v + 60) / 60)) : 0);
    [['L', aL, 6], ['R', aR, 30]].forEach(([name, v, y]) => {
      haloText(ctx, th, name, 4, y + 12, { px: 12, weight: '600' });
      ctx.fillStyle = th.paper2; ctx.fillRect(L, y, bw, 16);
      ctx.fillStyle = th.ink; ctx.fillRect(L, y, bw * level(v), 16);
      ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(L + 0.5, y + 0.5, bw - 1, 15);
      setFont(ctx, th, 11); ctx.fillStyle = th.inkSoft; ctx.textAlign = 'right';
      ctx.fillText(Number.isFinite(v) && v > -80 ? `${v.toFixed(0)} dBFS` : 'muted', x1 - 2, y + 28 - 12 + 0);
    });
    // separation bar: 0..40 dB
    const sep = Number.isFinite(state.separationDb) ? Math.min(40, Math.max(0, state.separationDb)) : 0;
    const y = 62;
    haloText(ctx, th, 'Sep', 2, y + 12, { px: 11, color: th.inkSoft });
    const sx = L + 14, sw = x1 - sx;
    ctx.fillStyle = th.paper2; ctx.fillRect(sx, y, sw, 12);
    if (state.mode === 'stereo') { ctx.fillStyle = th.blue; ctx.fillRect(sx, y, sw * sep / 40, 12); }
    else if (state.mode === 'blend') { ctx.fillStyle = th.paper; ctx.fillRect(sx, y, sw * sep / 40, 12); strokeHatchRect(ctx, sx, y, sw * sep / 40, 12, th.blue, 4); }
    else { ctx.fillStyle = th.mono; ctx.fillRect(sx, y, Math.max(2, sw * sep / 40), 12); }
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(sx + 0.5, y + 0.5, sw - 1, 11);
    setFont(ctx, th, 11); ctx.fillStyle = th.ink; ctx.textAlign = 'left';
    ctx.fillText(`separation ${sep.toFixed(0)} dB (L and R ${state.mode === 'mono' ? 'identical' : 'distinct'})`, sx, y + 26);
  }

  const mHost = createCanvasHost(meters, drawMeters);

  let u0 = () => {};
  function bindTracker(t) {
    src = t;
    u0();
    u0 = t.subscribe(() => { pick(); });
    pick();
  }
  if (src) bindTracker(src);
  else import('../mpxTracker.js').then((m) => bindTracker(m.mpx || m.default)).catch(() => { pick(); });

  const u1 = history.subscribe((id, s) => {
    if (!link || id !== link.id) return;
    lastSample = s;
    if (!src && s.mode) { state = s; updateText(); }
    mHost.invalidate();
  });
  const u2 = store.subscribe(() => pick());
  const u4 = squelch.subscribe(() => { updateText(); });
  pick();
  return { refresh: pick, destroy() { u0(); u1(); u2(); u4(); mHost.destroy(); container.textContent = ''; } };
}
