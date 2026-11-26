// Intermodulation demo panel: spectrum analyser plot with carriers and IM3/IM5 markers, noise-floor numbers,
// distance sweep and coordination table. Reads imd.get() (js/imdTracker.js); draws only.
import { setImdEnabled } from '../actions.js';
import { createCanvasHost, activeLink, setFont, haloText } from './util.js';
import { imd } from '../imdTracker.js';
import { formatPower } from '../model/units.js';
import { evenOrderImd, imdSummary, imdTransmitters } from '../model/imd.js';
import { createZoom, decimate } from './spectraZoom.js';

const MIN_SPAN = 0.04;
/** Zoom a view {a,b} (fractions 0..1 of the full axis) by `factor` (>1 zooms in) about fraction `at` of the visible part. Pure. */
export function zoomAxis(view, factor, at = 0.5) {
  const span = view.b - view.a, ns = Math.min(1, Math.max(MIN_SPAN, span / (factor > 0 ? factor : 1)));
  const k = Math.min(1, Math.max(0, at)), centre = view.a + span * k;
  const a = Math.min(1 - ns, Math.max(0, centre - ns * k));
  return { a, b: a + ns };
}
/** Pan a view by a fraction of its own span, keeping it inside 0..1. Pure. */
export function panAxis(view, frac) {
  const span = view.b - view.a, a = Math.min(1 - span, Math.max(0, view.a + frac * span));
  return { a, b: a + span };
}
/** Distinct third-order products on wanted channels (imdSummary.inChannelThirdOrderDistinctCount); falls back to the row count if the summary fails. */
export function distinctThird(scene, state) {
  try { const v = imdSummary(scene).inChannelThirdOrderDistinctCount; if (Number.isFinite(v)) return v; } catch { /* fall through */ }
  return state && state.coordination ? state.coordination.length : 0;
}
export const FULL_VIEW = Object.freeze({ a: 0, b: 1 });

export const MECH_COLORS = { 'front-end': '#4a78b5', 'tx-reverse': '#c77a1f', pim: '#7d5ba6' };
export const MECH_NAMES = { 'front-end': 'Receiver front end (over the air)', 'tx-reverse': 'Transmitter reverse intermod', pim: 'Passive intermod (PIM)' };
const NONE_DBM = -150;

/** Mechanism of a spectrum marker kind. Pure. */
export function mechanismOf(kind) {
  return kind === 'im3' || kind === 'im5' ? 'front-end' : kind;
}

/** Y range (dBm) for the spectrum: from just above the strongest carrier down to below the noise. Pure. */
export function spectrumRange(spec) {
  let hi = -Infinity, lo = Infinity;
  for (const v of spec.carriersDbm) if (v > hi) hi = v;
  for (const v of spec.noiseDbm) if (Number.isFinite(v) && v < lo) lo = v;
  if (!Number.isFinite(hi)) hi = -20;
  if (!Number.isFinite(lo)) lo = -130;
  hi = Math.ceil((hi + 5) / 10) * 10;
  lo = Math.max(Math.floor((lo - 8) / 10) * 10, NONE_DBM);
  if (hi - lo < 50) lo = hi - 50;
  return { lo, hi };
}

/** Slope in dB per halving of distance between the first and last finite points. Pure. */
export function slopePerHalving(dist, levels) {
  const idx = [];
  for (let i = 0; i < dist.length; i++) if (Number.isFinite(levels[i]) && levels[i] > NONE_DBM && dist[i] > 0) idx.push(i);
  if (idx.length < 2) return NaN;
  const a = idx[0], b = idx[idx.length - 1];
  const halvings = Math.log2(dist[b] / dist[a]);
  return halvings === 0 ? NaN : (levels[a] - levels[b]) / halvings;
}

/** Short tx label for a peak: first word of its name plus frequency. Pure. */
export function shortName(name) {
  const w = String(name || '').replace(/\(.*\)/, '').trim().split(/\s+/);
  return w.slice(0, 2).join(' ').slice(0, 9);
}

const fmtDbm = (v, unit) => (Number.isFinite(v) && v > NONE_DBM ? formatPower(v, unit) : 'none');

export function mountImd({ container, store }) {
  container.classList.add('imd');
  container.textContent = '';
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const h2 = el('h2', null, 'Intermodulation ');
  const toggle = el('button', 'imd-toggle', 'Turn on'); toggle.type = 'button'; toggle.setAttribute('aria-pressed', 'false');
  toggle.title = 'Show intermodulation: unwanted extra signals made when several transmitters mix.';
  toggle.addEventListener('click', () => setImdEnabled(store, !(store.getScene().imd && store.getScene().imd.enabled)));
  h2.append(toggle);
  const msg = el('p', 'hint', 'The intermod demo is off. Turn it on above to see carriers, products and the noise floor.');
  const body = el('div');
  const legend = el('div', 'imd-legend');
  const spec = el('canvas', 'imd-spec');
  const nums = el('dl', 'mpx-nums imd-nums');
  const nEls = {};
  for (const [k, label] of [['th', 'Thermal floor'], ['im', 'IM sum'], ['sk', 'TX noise skirt'], ['de', 'Desense'], ['tot', 'Total floor'], ['rise', 'Rise']]) {
    const d = el('div'); d.append(el('dt', null, label)); const dd = el('dd', null, '-'); d.append(dd); nums.append(d); nEls[k] = dd;
  }
  const sweepH = el('h3', 'cv-sug-h', 'Distance sweep (receive antenna moved away from the nearest transmitter)');
  const sweep = el('canvas', 'imd-sweep');
  const slopes = el('p', 'hint imd-slopes');
  const coordH = el('h3', 'cv-sug-h', 'Coordination check');
  const coordHead = el('p', 'imd-headline', '', { role: 'status' }), coordSub = el('p', 'hint imd-headline-sub', '');
  const tableWrap = el('div', 'cv-table-wrap');
  const table = el('table', 'cv-table');
  table.innerHTML = '<thead><tr><th scope="col">Product</th><th scope="col">Lands on</th><th class="num" scope="col">Offset</th><th class="num" scope="col">C/I</th><th scope="col">Severity</th></tr></thead><tbody></tbody>';
  const tbody = table.querySelector('tbody');
  tableWrap.append(table);
  const note = el('p', 'hint', 'Two strong carriers mix in a non-linear stage and create products at 2f1 - f2 and similar frequencies. When a product lands on a wanted channel it raises that channel’s noise floor or becomes a tone you can hear. Moving transmitters apart, adding isolation, or choosing different frequencies lowers the products. Values are illustrative.');
  const evenH = el('h3', 'cv-sug-h', 'Even-order products (second and fourth order)');
  const bpH = el('h4', 'imd-sub', 'At each bodypack'), bpNote = el('p', 'hint', 'Products worked out at every in-ear bodypack in turn, using its own position and antenna. Worst product landing on its own channel (not made from its own transmitter).');
  const bpWrap = el('div', 'cv-table-wrap'), bpTable = el('table', 'cv-table');
  bpTable.innerHTML = '<thead><tr><th scope="col">Bodypack</th><th class="num" scope="col">Wanted</th><th scope="col">Worst product</th><th class="num" scope="col">C/I</th><th scope="col">Severity</th></tr></thead><tbody></tbody>';
  const bpBody = bpTable.querySelector('tbody'); bpWrap.append(bpTable);
  const evenWrap = el('div', 'cv-table-wrap'), evenTable = el('table', 'cv-table');
  evenTable.innerHTML = '<caption class="hint">Products of the transmitter tones in the nonlinear stage, and radiated second harmonics. Levels are at the receiver input.</caption><thead><tr><th scope="col">Product</th><th class="num" scope="col">Frequency</th><th class="num" scope="col">Level</th><th scope="col">Lands in</th><th scope="col">Severity</th></tr></thead><tbody></tbody>';
  const evenBody = evenTable.querySelector('tbody'); evenWrap.append(evenTable);
  const evenNote = el('p', 'hint imd-even-note');
  body.append(legend, spec, nums, sweepH, sweep, slopes, coordH, coordHead, coordSub, tableWrap, bpH, bpNote, bpWrap, evenH, evenNote, evenWrap, note);
  container.append(h2, msg, body);

  // legend (DOM, so it wraps on phones)
  const addLeg = (swatch, text) => { const s = el('span', 'imd-leg'); s.append(swatch, document.createTextNode(text)); legend.append(s); };
  const sw = (color, shape) => { const e = el('span', `imd-sw imd-sw-${shape}`); e.style.setProperty('--c', color); return e; };
  addLeg(sw('var(--ink)', 'bar'), 'Carrier');
  addLeg(sw('var(--mech-fe)', 'tri'), 'IM3 / IM5 front end');
  addLeg(sw('var(--mech-tx)', 'dia'), 'TX reverse');
  addLeg(sw('var(--mech-pim)', 'sq'), 'PIM');
  addLeg(sw('var(--fail)', 'ring'), 'Hits a channel');
  addLeg(sw('var(--ink-soft)', 'dash'), 'Noise floor');

  let state = null, link = null, scene = null;

  function draw(ctx, w, h, th, view = FULL_VIEW) {
    if (!state) return;
    const s = state.spectrum;
    const unit = scene.units.power;
    const L = 40, R = 10, T = 14, B = 26;
    const pw = w - L - R, ph = h - T - B;
    const F0 = s.freqMHz[0], F1 = s.freqMHz[s.freqMHz.length - 1], f0 = F0 + (F1 - F0) * view.a, f1 = F0 + (F1 - F0) * view.b;
    const { lo, hi } = spectrumRange(s);
    const X = (f) => L + ((f - f0) / (f1 - f0)) * pw;
    const Y = (v) => T + ph - ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * ph;
    ctx.fillStyle = th.paper2; ctx.fillRect(L, T, pw, ph);
    setFont(ctx, th, 11); ctx.fillStyle = th.inkSoft; ctx.textAlign = 'right';
    for (let v = lo; v <= hi; v += 10) { const y = Math.round(Y(v)) + 0.5; ctx.strokeStyle = th.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.fillText(String(unit === 'dBW' ? v - 30 : v), L - 4, y + 4); }
    const span = f1 - f0, step = span > 8 ? 2 : span > 4 ? 1 : span > 2 ? 0.5 : span > 0.8 ? 0.2 : 0.05;
    ctx.textAlign = 'center';
    for (let f = Math.ceil(f0 / step) * step; f <= f1; f += step) { const x = Math.round(X(f)) + 0.5; ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke(); ctx.fillStyle = th.inkSoft; ctx.fillText(f.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0), x, h - 12); }
    ctx.fillText(`MHz   (dB${unit === 'dBW' ? 'W' : 'm'})`, L + pw / 2, h - 1);
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(L + 0.5, T + 0.5, pw - 1, ph - 1);
    ctx.save(); ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
    // noise floor (filled) and traces
    ctx.beginPath(); ctx.moveTo(X(f0), Y(lo));
    s.freqMHz.forEach((f, i) => ctx.lineTo(X(f), Y(s.noiseDbm[i])));
    ctx.lineTo(X(f1), Y(lo)); ctx.closePath(); ctx.fillStyle = th.inkSoft; ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1;
    const trace = (arr, color, wd, dash) => {
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = wd; ctx.setLineDash(dash); ctx.beginPath(); let on = false;
      arr.forEach((v, i) => { if (!(v > lo)) { on = false; return; } const x = X(s.freqMHz[i]), y = Y(v); if (on) ctx.lineTo(x, y); else ctx.moveTo(x, y); on = true; });
      ctx.stroke(); ctx.restore();
    };
    trace(s.noiseDbm, th.inkSoft, 1.4, [5, 3]);
    trace(s.im3FrontEndDbm, th.mech['front-end'], 1.4, []);
    trace(s.im5FrontEndDbm, th.mech['front-end'], 1.2, [3, 3]);
    trace(s.txReverseDbm, th.mech['tx-reverse'], 1.4, []);
    trace(s.pimDbm, th.mech.pim, 1.4, []);
    trace(s.carriersDbm, th.ink, 1.8, []);
    ctx.restore();
    // squelch / sensitivity line
    const thr = link ? (link.rx.squelch && link.rx.squelch.enabled !== false ? link.rx.squelch.thresholdDbm : link.rx.sensitivityDbm) : NaN;
    if (Number.isFinite(thr) && thr > lo && thr < hi) {
      ctx.save(); ctx.strokeStyle = th.fail; ctx.lineWidth = 1.4; ctx.setLineDash([8, 3, 2, 3]);
      const y = Math.round(Y(thr)) + 0.5; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.restore();
      haloText(ctx, th, `squelch ${thr} dBm`, L + pw - 4, y - 4, { align: 'right', px: 11, color: th.fail });
    }
    // carriers: labelled peaks (staggered)
    const txs = imdTransmitters(scene);
    const byId = new Map(txs.map((t) => [t.id, t]));
    const carriers = s.markers.filter((m) => m.kind === 'carrier').sort((a, b) => a.fMHz - b.fMHz);
    carriers.forEach((m, i) => {
      const x = X(m.fMHz), y = Y(m.levelDbm);
      const t = txs.find((q) => Math.abs(q.freqMHz - m.fMHz) < 1e-6);
      const y0 = T + 8 + (i % 3) * 13;
      ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.setLineDash([1, 3]); ctx.beginPath(); ctx.moveTo(x, y0 + 4); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
      haloText(ctx, th, `${t ? shortName(t.name) : 'Tx'} ${m.fMHz.toFixed(1)}`, x, y0, { align: 'center', px: 11, weight: '600' });
    });
    // product markers
    let ringLabels = 0;
    const ringSeen = new Set();
    for (const m of s.markers) {
      if (m.kind === 'carrier' || !(m.levelDbm > lo + 1)) continue;
      const mech = mechanismOf(m.kind), x = X(m.fMHz), y = Y(m.levelDbm), c = th.mech[mech] || th.ink;
      ctx.fillStyle = c; ctx.strokeStyle = th.ink; ctx.lineWidth = 0.8;
      ctx.beginPath();
      if (mech === 'front-end') { const r = m.kind === 'im3' ? 5 : 4; ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r); ctx.lineTo(x - r, y + r); ctx.closePath(); }
      else if (mech === 'tx-reverse') { ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); }
      else ctx.rect(x - 4, y - 4, 8, 8);
      ctx.fill(); ctx.stroke();
      if (m.collidesWith) {
        ctx.save(); ctx.strokeStyle = th.fail; ctx.lineWidth = 2; if (m.ownTone) ctx.setLineDash([3, 2]);
        ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        const tx = byId.get(m.collidesWith);
        const text = `${m.label} hits ${tx ? shortName(tx.name) : 'channel'}${m.ownTone ? ' (own tone)' : ''}`;
        if (ringLabels < 4 && !ringSeen.has(text)) {
          ringSeen.add(text);
          ringLabels++;
          haloText(ctx, th, text, Math.min(Math.max(x, L + 70), L + pw - 70), T + ph - 6 - (ringLabels - 1) * 13, { align: 'center', px: 11, weight: '600', color: th.fail });
        }
      }
    }
  }

  function drawSweep(ctx, w, h, th, view = FULL_VIEW) {
    const sp = state && state.sweep;
    if (!sp || !sp.distanceM.length) { if (state) haloText(ctx, th, 'Needs at least two transmitters', w / 2, h / 2, { align: 'center', color: th.inkSoft }); return; }
    const unit = scene.units.power;
    const L = 40, R = 10, T = 8, gap = 26;
    const h1 = Math.round((h - T - 36 - gap) * 0.62), h2 = h - T - 36 - gap - h1;
    const pw = w - L - R, D0 = sp.distanceM[0], D1 = sp.distanceM[sp.distanceM.length - 1], d0 = D0 + (D1 - D0) * view.a, d1 = D0 + (D1 - D0) * view.b;
    const X = (d) => L + ((d - d0) / (d1 - d0)) * pw;
    const vals = [...sp.worstProductDbm, ...sp.worstFrontEndDbm, ...sp.worstReverseDbm, ...sp.worstPimDbm, sp.thermalDbm].filter((v) => Number.isFinite(v) && v > NONE_DBM);
    let hi = Math.ceil((Math.max(...vals) + 5) / 10) * 10, lo = Math.floor((sp.thermalDbm - 8) / 10) * 10;
    if (hi - lo < 30) lo = hi - 30;
    const Y1 = (v) => T + h1 - ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * h1;
    const rmax = Math.max(10, Math.ceil(Math.max(...sp.riseDb) / 10) * 10);
    const Y2 = (v) => T + h1 + gap + h2 - (Math.min(Math.max(v, 0), rmax) / rmax) * h2;
    const frame = (y0, hh, a, b, step, fmt, label) => {
      ctx.fillStyle = th.paper2; ctx.fillRect(L, y0, pw, hh); ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(L + 0.5, y0 + 0.5, pw - 1, hh - 1);
      setFont(ctx, th, 11); ctx.fillStyle = th.inkSoft; ctx.textAlign = 'right';
      for (let v = a; v <= b; v += step) { const y = y0 + hh - ((v - a) / (b - a)) * hh; ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(L, Math.round(y) + 0.5); ctx.lineTo(L + pw, Math.round(y) + 0.5); ctx.stroke(); ctx.fillText(fmt(v), L - 4, y + 4); }
      ctx.textAlign = 'left'; ctx.fillText(label, L + 4, y0 + 12);
    };
    frame(T, h1, lo, hi, 20, (v) => String(unit === 'dBW' ? v - 30 : v), `product level (${unit === 'dBW' ? 'dBW' : 'dBm'})`);
    frame(T + h1 + gap, h2, 0, rmax, rmax > 40 ? 20 : 10, String, 'noise floor rise (dB)');
    setFont(ctx, th, 11); ctx.fillStyle = th.inkSoft; ctx.textAlign = 'center';
    const dStep = d1 - d0 > 20 ? 2 : d1 - d0 > 8 ? 1 : d1 - d0 > 3 ? 0.5 : 0.1;
    for (let d = Math.ceil(d0 / dStep) * dStep; d <= d1 + 1e-9; d += dStep) ctx.fillText(String(Math.round(d * 100) / 100), X(d), h - 16);
    ctx.fillText('receive antenna distance from the nearest transmitter (m)', L + pw / 2, h - 3);
    const line = (arr, y, color, wd, dash) => {
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = wd; ctx.setLineDash(dash); ctx.beginPath(); let on = false;
      arr.forEach((v, i) => { if (!(v > NONE_DBM)) { on = false; return; } const px = X(sp.distanceM[i]), py = y(v); if (on) ctx.lineTo(px, py); else ctx.moveTo(px, py); on = true; });
      ctx.stroke(); ctx.restore();
    };
    ctx.save(); ctx.beginPath(); ctx.rect(L, T, pw, h - T); ctx.clip();
    line(sp.worstFrontEndDbm, Y1, th.mech['front-end'], 1.6, []);
    line(sp.worstReverseDbm, Y1, th.mech['tx-reverse'], 1.6, []);
    line(sp.worstPimDbm, Y1, th.mech.pim, 1.6, []);
    line(sp.worstProductDbm, Y1, th.ink, 2.2, []);
    const ty = Math.round(Y1(sp.thermalDbm)) + 0.5;
    ctx.save(); ctx.strokeStyle = th.inkSoft; ctx.setLineDash([5, 3]); ctx.beginPath(); ctx.moveTo(L, ty); ctx.lineTo(L + pw, ty); ctx.stroke(); ctx.restore();
    line(sp.riseDb, Y2, th.ink, 2, []);
    // live marker: current distance between the nearest transmitter and the receive antenna
    const r = scene.imd.rxAntennaPos || { x: 0, y: 0, z: 1.5 };
    let best = Infinity;
    for (const t of imdTransmitters(scene)) best = Math.min(best, Math.hypot(t.pos.x - r.x, t.pos.y - r.y, (t.pos.z || 0) - (r.z || 0)));
    if (Number.isFinite(best) && best >= d0 && best <= d1) {
      const mx = Math.round(X(best)) + 0.5;
      ctx.strokeStyle = th.fail; ctx.lineWidth = 1.5; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(mx, T); ctx.lineTo(mx, h - 36); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
    haloText(ctx, th, 'thermal', L + pw - 4, ty - 3, { align: 'right', px: 11, color: th.inkSoft });
    if (Number.isFinite(best) && best >= d0 && best <= d1) haloText(ctx, th, `now ${best.toFixed(1)} m`, Math.min(X(best) + 6, L + pw - 50), T + h1 + gap - 4, { px: 11, weight: '600', color: th.fail });
  }

  const sHost = createCanvasHost(spec, (c, w, h, t) => draw(c, w, h, t));
  const wHost = createCanvasHost(sweep, (c, w, h, t) => drawSweep(c, w, h, t));
  // ---- enlarged view (same pattern as the spectra dialog) with axis zoom ----
  const views = { spectrum: { ...FULL_VIEW }, sweep: { ...FULL_VIEW } };
  const TITLES = { spectrum: 'Intermodulation spectrum', sweep: 'Intermodulation distance sweep' };
  const zoom = createZoom({
    doc: document,
    hostFactory: (canvas, d) => createCanvasHost(canvas, d),
    describe: (id) => ({ title: TITLES[id], summary: summaryOf(id) }),
    table: (id) => tableOf(id),
    draw: (id, ctx, w, h, th) => (id === 'sweep' ? drawSweep(ctx, w, h, th, views.sweep) : draw(ctx, w, h, th, views.spectrum)),
  });
  const zbar = el('div', 'imd-zoombar', null);
  zbar.setAttribute('role', 'group'); zbar.setAttribute('aria-label', 'Zoom the horizontal axis');
  const zbtn = (text, label, fn) => { const b = el('button', null, text); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.addEventListener('click', fn); zbar.append(b); return b; };
  const zread = el('span', 'hint imd-zoomread', ''); zread.setAttribute('role', 'status');
  const curId = () => zoom.state.id;
  const setView = (v) => { const id = curId(); if (!id) return; views[id] = v; zread.textContent = viewText(id); zoom.update(); };
  zbtn('Zoom in', 'Zoom in on the horizontal axis (plus key or mouse wheel)', () => setView(zoomAxis(views[curId()], 1.6)));
  zbtn('Zoom out', 'Zoom out on the horizontal axis (minus key or mouse wheel)', () => setView(zoomAxis(views[curId()], 1 / 1.6)));
  zbtn('\u2190', 'Pan left (left arrow key)', () => setView(panAxis(views[curId()], -0.25)));
  zbtn('\u2192', 'Pan right (right arrow key)', () => setView(panAxis(views[curId()], 0.25)));
  zbtn('Reset zoom', 'Show the whole axis (key 0)', () => setView({ ...FULL_VIEW }));
  zbar.append(zread);
  zoom.slot.append(zbar);
  zoom.canvas.addEventListener('wheel', (e) => { e.preventDefault(); const b = zoom.canvas.getBoundingClientRect(); const at = Math.min(1, Math.max(0, (e.clientX - b.left - 40) / Math.max(1, b.width - 50))); setView(zoomAxis(views[curId()], e.deltaY < 0 ? 1.25 : 1 / 1.25, at)); }, { passive: false });
  zoom.canvas.addEventListener('keydown', (e) => {
    const id = curId(); if (!id) return;
    if (e.key === '+' || e.key === '=') setView(zoomAxis(views[id], 1.6));
    else if (e.key === '-' || e.key === '_') setView(zoomAxis(views[id], 1 / 1.6));
    else if (e.key === '0') setView({ ...FULL_VIEW });
    else if (e.key === 'ArrowLeft') setView(panAxis(views[id], -0.25));
    else if (e.key === 'ArrowRight') setView(panAxis(views[id], 0.25));
    else return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  function viewText(id) {
    const v = views[id], full = v.a === 0 && v.b === 1;
    if (!state) return '';
    if (id === 'sweep') { const d = state.sweep?.distanceM; if (!d || !d.length) return ''; const a = d[0] + (d[d.length - 1] - d[0]) * v.a, b = d[0] + (d[d.length - 1] - d[0]) * v.b; return full ? 'Showing the whole distance range.' : `Showing ${a.toFixed(1)} to ${b.toFixed(1)} m.`; }
    const f = state.spectrum.freqMHz, a = f[0] + (f[f.length - 1] - f[0]) * v.a, b = f[0] + (f[f.length - 1] - f[0]) * v.b;
    return full ? 'Showing the whole frequency span.' : `Showing ${a.toFixed(2)} to ${b.toFixed(2)} MHz.`;
  }
  function summaryOf(id) {
    if (!state) return 'The intermod demo is off.';
    const n = state.noise, unit = scene.units.power;
    if (id === 'sweep') return `Worst product level and noise floor rise against the distance between the receive antenna and the nearest transmitter. ${slopes.textContent} ${viewText(id)}`.trim();
    return `${imdTransmitters(scene).length} carriers, noise floor rise ${n.riseDb.toFixed(1)} dB, total floor ${fmtDbm(n.totalDbm, unit)}, ${distinctThird(scene, state)} distinct third-order products land on wanted channels (${state.coordination.length} in all mechanisms and orders). ${viewText(id)}`;
  }
  function tableOf(id) {
    if (!state) return { caption: '', cols: [], rows: [] };
    const unit = scene.units.power;
    if (id === 'sweep') {
      const sp = state.sweep; if (!sp) return { caption: 'No sweep', cols: [], rows: [] };
      const idx = decimate(sp.distanceM.length, 40);
      return { caption: 'Distance sweep', cols: ['Distance (m)', `Worst product (${unit})`, 'Rise (dB)'], rows: idx.map((i) => [sp.distanceM[i].toFixed(1), fmtDbm(sp.worstProductDbm[i], unit), sp.riseDb[i].toFixed(1)]) };
    }
    const rows = state.spectrum.markers.slice().sort((a, b) => a.fMHz - b.fMHz).slice(0, 80).map((m) => [m.label || m.kind, `${m.fMHz.toFixed(3)} MHz`, fmtDbm(m.levelDbm, unit), m.collidesWith ? 'hits a wanted channel' : '']);
    return { caption: 'Carriers and products', cols: ['Marker', 'Frequency', 'Level', 'Note'], rows };
  }
  function openZoom(id) { if (!state) return; views[id] = { ...FULL_VIEW }; zread.textContent = viewText(id); zoom.open(id, id === 'sweep' ? sweep : spec); }
  for (const [cv, id, name] of [[spec, 'spectrum', 'intermodulation spectrum'], [sweep, 'sweep', 'intermodulation distance sweep']]) {
    cv.setAttribute('role', 'button'); cv.setAttribute('tabindex', '0'); cv.setAttribute('aria-haspopup', 'dialog'); cv.title = `Click or press Enter to enlarge the ${name}`; cv.style.cursor = 'zoom-in';
    cv.addEventListener('click', () => openZoom(id));
    cv.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openZoom(id); } });
  }
  sweep.setAttribute('aria-label', 'Intermod distance sweep. Press Enter to enlarge.');
  spec.style.height = '250px'; sweep.style.height = '260px';

  function render() {
    scene = store.getScene();
    link = activeLink(scene, store.getSelection());
    state = imd.get();
    const on = !!state;
    msg.hidden = on; body.hidden = !on;
    const enabled = !!(scene.imd && scene.imd.enabled); toggle.setAttribute('aria-pressed', String(enabled)); toggle.textContent = enabled ? 'Turn off' : 'Turn on';
    if (!on) return;
    const unit = scene.units.power, n = state.noise;
    nEls.th.textContent = fmtDbm(n.thermalDbm, unit); nEls.im.textContent = fmtDbm(n.imSumDbm, unit);
    nEls.sk.textContent = fmtDbm(n.txNoiseSkirtDbm, unit); nEls.de.textContent = `${n.desenseDb.toFixed(1)} dB`;
    nEls.tot.textContent = fmtDbm(n.totalDbm, unit); nEls.rise.textContent = `+${n.riseDb.toFixed(1)} dB`;
    spec.setAttribute('aria-label', `Intermod spectrum with ${imdTransmitters(scene).length} carriers. Noise floor rise ${n.riseDb.toFixed(1)} dB. ${distinctThird(scene, state)} distinct third-order products land on wanted channels. Press Enter to enlarge.`);
    const sp = state.sweep;
    const parts = [];
    if (sp) {
      for (const [name, arr] of [['worst product', sp.worstProductDbm], ['front-end IM3', sp.worstFrontEndDbm], ['transmitter reverse', sp.worstReverseDbm], ['PIM', sp.worstPimDbm]]) {
        const sl = slopePerHalving(sp.distanceM, arr);
        if (Number.isFinite(sl) && Math.abs(sl) >= 1.5) parts.push(`${name}: ${sl >= 0 ? '+' : '−'}${Math.abs(sl).toFixed(0)} dB per halving of distance`);
      }
    }
    slopes.textContent = parts.length ? parts.join('; ') + '.' : '';
    { const d3 = distinctThird(scene, state); coordHead.textContent = `${d3} distinct third-order product${d3 === 1 ? '' : 's'} land${d3 === 1 ? 's' : ''} on wanted channels.`; coordSub.textContent = `All mechanisms and orders, one row per mechanism: ${state.coordination.length} (the same frequency is counted again for each mechanism that makes it, and fifth-order products are included).`; }
    tbody.textContent = '';
    const byId = new Map(imdTransmitters(scene).map((t) => [t.id, t]));
    const rows = state.coordination.slice(0, 12);
    if (!rows.length) { const tr = el('tr'); const td = el('td', null, 'No product lands on a wanted channel.'); td.colSpan = 5; tr.append(td); tbody.append(tr); }
    for (const r of rows) {
      const tr = el('tr');
      const tx = byId.get(r.channelId);
      const chip = el('span', 'chip', r.severity.toUpperCase());
      chip.dataset.sev = r.severity;
      const sevTd = el('td'); sevTd.append(chip);
      tr.append(el('td', null, `${r.product.label} ${r.product.fMHz.toFixed(2)} MHz (${r.product.source}${r.ownTone ? ', own tone' : ''})`),
        el('td', null, tx ? shortName(tx.name) : '-'), el('td', 'num', `${r.offsetKHz.toFixed(0)} kHz`), el('td', 'num', `${r.ciDb.toFixed(1)} dB`), sevTd);
      tbody.append(tr);
    }
    if (state.coordination.length > rows.length) { const tr = el('tr'); const td = el('td', null, `+ ${state.coordination.length - rows.length} more`); td.colSpan = 5; tr.append(td); tbody.append(tr); }
    // per bodypack (rack-fed scenes)
    const bp = state.perBodypack;
    bpH.hidden = bpNote.hidden = bpWrap.hidden = !bp || !bp.length;
    bpBody.textContent = '';
    for (const r of bp || []) {
      const tr = el('tr'), chip = el('span', 'chip', r.severity === 'ok' ? 'CLEAR' : r.severity.toUpperCase()); chip.dataset.sev = r.severity === 'ok' ? 'info' : r.severity;
      const sevTd = el('td'); sevTd.append(chip);
      tr.append(el('td', null, `${shortName(r.name)} ${r.freqMHz.toFixed(3)} MHz`), el('td', 'num', Number.isFinite(r.wantedDbm) ? fmtDbm(r.wantedDbm, scene.units.power) : '-'),
        el('td', null, r.hits ? `${r.label}${r.hits > 1 ? ` (+${r.hits - 1} more)` : ''}` : 'none lands here'), el('td', 'num', r.worstCiDb === null ? '-' : `${r.worstCiDb.toFixed(1)} dB`), sevTd);
      bpBody.append(tr);
    }
    // even-order products (imd-even.js)
    evenBody.textContent = '';
    let ev = null;
    try { ev = evenOrderImd(scene); } catch { ev = null; }
    const evRows = ev ? [...ev.products, ...ev.harmonics] : [];
    evenNote.textContent = ev ? `${ev.inBandCount} in the wanted channel, ${ev.bandHitCount} in another band the system uses. IIP2 ${Number.isFinite(scene.imd.iip2Dbm) ? scene.imd.iip2Dbm : 30} dBm.` : '';
    if (!evRows.length) { const tr = el('tr'); const td = el('td', null, 'No even-order products (add a second transmitter, or check the nonlinear stage settings).'); td.colSpan = 5; tr.append(td); evenBody.append(tr); }
    for (const p of evRows.slice(0, 14)) {
      const tr = el('tr'), chip = el('span', 'chip', String(p.severity).toUpperCase()); chip.dataset.sev = p.severity === 'critical' ? 'critical' : p.severity === 'warning' ? 'warning' : 'info';
      const sevTd = el('td'); sevTd.append(chip);
      tr.append(el('td', null, `${p.label} (order ${p.order}${p.kind === 'harmonic' ? ', harmonic' : ''})`), el('td', 'num', `${p.fMHz.toFixed(2)} MHz`), el('td', 'num', fmtDbm(p.levelDbm, scene.units.power)), el('td', null, p.landsIn || 'outside every band used'), sevTd);
      evenBody.append(tr);
    }
    if (evRows.length > 14) { const tr = el('tr'); const td = el('td', null, `+ ${evRows.length - 14} more`); td.colSpan = 5; tr.append(td); evenBody.append(tr); }
    sHost.invalidate(); wHost.invalidate();
    if (zoom.isOpen()) { if (state) zoom.update(); else zoom.close(); }
  }

  const u1 = imd.subscribe(render);
  const u2 = store.subscribe(() => render());
  render();
  return { destroy() { u1(); u2(); zoom.destroy(); sHost.destroy(); wHost.destroy(); container.textContent = ''; } };
}
