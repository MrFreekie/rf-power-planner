// Intermodulation demo panel: spectrum analyser plot with carriers and IM3/IM5 markers, noise-floor numbers,
// distance sweep and coordination table. Reads imd.get() (js/imdTracker.js); draws only.
import { createCanvasHost, activeLink, setFont, haloText } from './util.js';
import { imd } from '../imdTracker.js';
import { formatPower } from '../model/units.js';

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
  const h2 = el('h2', null, 'Intermodulation');
  const msg = el('p', 'hint', 'The intermod demo is off. Switch on Intermod in the toolbar to see carriers, products and the noise floor.');
  const body = el('div');
  const legend = el('div', 'imd-legend');
  const spec = el('canvas', 'imd-spec'); spec.setAttribute('role', 'img');
  const nums = el('dl', 'mpx-nums imd-nums');
  const nEls = {};
  for (const [k, label] of [['th', 'Thermal floor'], ['im', 'IM sum'], ['sk', 'TX noise skirt'], ['de', 'Desense'], ['tot', 'Total floor'], ['rise', 'Rise']]) {
    const d = el('div'); d.append(el('dt', null, label)); const dd = el('dd', null, '-'); d.append(dd); nums.append(d); nEls[k] = dd;
  }
  const sweepH = el('h3', 'cv-sug-h', 'Distance sweep (receive antenna moved away from the nearest transmitter)');
  const sweep = el('canvas', 'imd-sweep'); sweep.setAttribute('role', 'img');
  const slopes = el('p', 'hint imd-slopes');
  const coordH = el('h3', 'cv-sug-h', 'Coordination check');
  const tableWrap = el('div', 'cv-table-wrap');
  const table = el('table', 'cv-table');
  table.innerHTML = '<thead><tr><th scope="col">Product</th><th scope="col">Lands on</th><th class="num" scope="col">Offset</th><th class="num" scope="col">C/I</th><th scope="col">Severity</th></tr></thead><tbody></tbody>';
  const tbody = table.querySelector('tbody');
  tableWrap.append(table);
  const note = el('p', 'hint', 'Two strong carriers mix in a non-linear stage and create products at 2f1 - f2 and similar frequencies. When a product lands on a wanted channel it raises that channel’s noise floor or becomes a tone you can hear. Moving transmitters apart, adding isolation, or choosing different frequencies lowers the products. Values are illustrative.');
  body.append(legend, spec, nums, sweepH, sweep, slopes, coordH, tableWrap, note);
  container.append(h2, msg, body);

  // legend (DOM, so it wraps on phones)
  const addLeg = (swatch, text) => { const s = el('span', 'imd-leg'); s.append(swatch, document.createTextNode(text)); legend.append(s); };
  const sw = (color, shape) => { const e = el('span', `imd-sw imd-sw-${shape}`); e.style.setProperty('--c', color); return e; };
  addLeg(sw('#1d2733', 'bar'), 'Carrier');
  addLeg(sw(MECH_COLORS['front-end'], 'tri'), 'IM3 / IM5 front end');
  addLeg(sw(MECH_COLORS['tx-reverse'], 'dia'), 'TX reverse');
  addLeg(sw(MECH_COLORS.pim, 'sq'), 'PIM');
  addLeg(sw('#c0392b', 'ring'), 'Hits a channel');
  addLeg(sw('#5b6673', 'dash'), 'Noise floor');

  let state = null, link = null, scene = null;

  function draw(ctx, w, h, th) {
    if (!state) return;
    const s = state.spectrum;
    const unit = scene.units.power;
    const L = 40, R = 10, T = 14, B = 26;
    const pw = w - L - R, ph = h - T - B;
    const f0 = s.freqMHz[0], f1 = s.freqMHz[s.freqMHz.length - 1];
    const { lo, hi } = spectrumRange(s);
    const X = (f) => L + ((f - f0) / (f1 - f0)) * pw;
    const Y = (v) => T + ph - ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * ph;
    ctx.fillStyle = th.paper2; ctx.fillRect(L, T, pw, ph);
    setFont(ctx, th, 11); ctx.fillStyle = th.inkSoft; ctx.textAlign = 'right';
    for (let v = lo; v <= hi; v += 10) { const y = Math.round(Y(v)) + 0.5; ctx.strokeStyle = th.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.fillText(String(unit === 'dBW' ? v - 30 : v), L - 4, y + 4); }
    const span = f1 - f0, step = span > 8 ? 2 : span > 4 ? 1 : 0.5;
    ctx.textAlign = 'center';
    for (let f = Math.ceil(f0 / step) * step; f <= f1; f += step) { const x = Math.round(X(f)) + 0.5; ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke(); ctx.fillStyle = th.inkSoft; ctx.fillText(f.toFixed(step < 1 ? 1 : 0), x, h - 12); }
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
    trace(s.im3FrontEndDbm, MECH_COLORS['front-end'], 1.4, []);
    trace(s.im5FrontEndDbm, MECH_COLORS['front-end'], 1.2, [3, 3]);
    trace(s.txReverseDbm, MECH_COLORS['tx-reverse'], 1.4, []);
    trace(s.pimDbm, MECH_COLORS.pim, 1.4, []);
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
    const txs = scene.imd.transmitters;
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
      const mech = mechanismOf(m.kind), x = X(m.fMHz), y = Y(m.levelDbm), c = MECH_COLORS[mech] || th.ink;
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

  function drawSweep(ctx, w, h, th) {
    const sp = state && state.sweep;
    if (!sp || !sp.distanceM.length) { if (state) haloText(ctx, th, 'Needs at least two transmitters', w / 2, h / 2, { align: 'center', color: th.inkSoft }); return; }
    const unit = scene.units.power;
    const L = 40, R = 10, T = 8, gap = 26;
    const h1 = Math.round((h - T - 36 - gap) * 0.62), h2 = h - T - 36 - gap - h1;
    const pw = w - L - R, d0 = sp.distanceM[0], d1 = sp.distanceM[sp.distanceM.length - 1];
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
    for (let d = Math.ceil(d0); d <= d1; d += 2) ctx.fillText(String(d), X(d), h - 16);
    ctx.fillText('receive antenna distance from the nearest transmitter (m)', L + pw / 2, h - 3);
    const line = (arr, y, color, wd, dash) => {
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = wd; ctx.setLineDash(dash); ctx.beginPath(); let on = false;
      arr.forEach((v, i) => { if (!(v > NONE_DBM)) { on = false; return; } const px = X(sp.distanceM[i]), py = y(v); if (on) ctx.lineTo(px, py); else ctx.moveTo(px, py); on = true; });
      ctx.stroke(); ctx.restore();
    };
    ctx.save(); ctx.beginPath(); ctx.rect(L, T, pw, h - T); ctx.clip();
    line(sp.worstFrontEndDbm, Y1, MECH_COLORS['front-end'], 1.6, []);
    line(sp.worstReverseDbm, Y1, MECH_COLORS['tx-reverse'], 1.6, []);
    line(sp.worstPimDbm, Y1, MECH_COLORS.pim, 1.6, []);
    line(sp.worstProductDbm, Y1, th.ink, 2.2, []);
    const ty = Math.round(Y1(sp.thermalDbm)) + 0.5;
    ctx.save(); ctx.strokeStyle = th.inkSoft; ctx.setLineDash([5, 3]); ctx.beginPath(); ctx.moveTo(L, ty); ctx.lineTo(L + pw, ty); ctx.stroke(); ctx.restore();
    line(sp.riseDb, Y2, th.ink, 2, []);
    // live marker: current distance between the nearest transmitter and the receive antenna
    const r = scene.imd.rxAntennaPos || { x: 0, y: 0, z: 1.5 };
    let best = Infinity;
    for (const t of scene.imd.transmitters) best = Math.min(best, Math.hypot(t.pos.x - r.x, t.pos.y - r.y, (t.pos.z || 0) - (r.z || 0)));
    if (Number.isFinite(best) && best >= d0 && best <= d1) {
      const mx = Math.round(X(best)) + 0.5;
      ctx.strokeStyle = th.fail; ctx.lineWidth = 1.5; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(mx, T); ctx.lineTo(mx, h - 36); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
    haloText(ctx, th, 'thermal', L + pw - 4, ty - 3, { align: 'right', px: 11, color: th.inkSoft });
    if (Number.isFinite(best) && best >= d0 && best <= d1) haloText(ctx, th, `now ${best.toFixed(1)} m`, Math.min(X(best) + 6, L + pw - 50), T + h1 + gap - 4, { px: 11, weight: '600', color: th.fail });
  }

  const sHost = createCanvasHost(spec, draw);
  const wHost = createCanvasHost(sweep, drawSweep);
  spec.style.height = '250px'; sweep.style.height = '260px';

  function render() {
    scene = store.getScene();
    link = activeLink(scene, store.getSelection());
    state = imd.get();
    const on = !!state;
    msg.hidden = on; body.hidden = !on;
    if (!on) return;
    const unit = scene.units.power, n = state.noise;
    nEls.th.textContent = fmtDbm(n.thermalDbm, unit); nEls.im.textContent = fmtDbm(n.imSumDbm, unit);
    nEls.sk.textContent = fmtDbm(n.txNoiseSkirtDbm, unit); nEls.de.textContent = `${n.desenseDb.toFixed(1)} dB`;
    nEls.tot.textContent = fmtDbm(n.totalDbm, unit); nEls.rise.textContent = `+${n.riseDb.toFixed(1)} dB`;
    spec.setAttribute('aria-label', `Intermod spectrum with ${scene.imd.transmitters.length} carriers. Noise floor rise ${n.riseDb.toFixed(1)} dB. ${state.coordination.length} products land on wanted channels.`);
    const sp = state.sweep;
    const parts = [];
    if (sp) {
      for (const [name, arr] of [['worst product', sp.worstProductDbm], ['front-end IM3', sp.worstFrontEndDbm], ['transmitter reverse', sp.worstReverseDbm], ['PIM', sp.worstPimDbm]]) {
        const sl = slopePerHalving(sp.distanceM, arr);
        if (Number.isFinite(sl) && Math.abs(sl) >= 1.5) parts.push(`${name}: ${sl >= 0 ? '+' : '−'}${Math.abs(sl).toFixed(0)} dB per halving of distance`);
      }
    }
    slopes.textContent = parts.length ? parts.join('; ') + '.' : '';
    tbody.textContent = '';
    const byId = new Map(scene.imd.transmitters.map((t) => [t.id, t]));
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
    sHost.invalidate(); wHost.invalidate();
  }

  const u1 = imd.subscribe(render);
  const u2 = store.subscribe(() => render());
  render();
  return { destroy() { u1(); u2(); sHost.destroy(); wHost.destroy(); container.textContent = ''; } };
}
