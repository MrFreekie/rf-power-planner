// Antenna diversity panel: live A/B level bars with the active antenna marked, switch counter, mode and gain,
// and a static fade-sweep plot (Tx walking toward the receiver) showing where each antenna fades.
import { createCanvasHost, activeLink, setFont, haloText } from './util.js';
import { history } from '../history.js';
import { rxState } from '../rxTracker.js';
import { squelch } from '../squelchTracker.js';
import { sweepLink, fadeDepthStats } from '../model/diversity.js';
import { formatPower } from '../model/units.js';

const RANGE = { min: -110, max: 0 };
const frac = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, (v - RANGE.min) / (RANGE.max - RANGE.min))) : 0);

/** Antenna spacing in wavelengths. Pure. */
export function spacingWavelengths(posA, posB, freqMHz) {
  const d = Math.hypot(posA.x - posB.x, posA.y - posB.y, posA.z - posB.z);
  return d / (299.792458 / freqMHz);
}

/** Plain-language spacing advice. Pure. */
export function spacingAdvice(spacingLambda) {
  if (!Number.isFinite(spacingLambda)) return '';
  if (spacingLambda < 0.25) return `Spacing is only ${spacingLambda.toFixed(2)} wavelengths: fades on A and B are largely correlated, so diversity helps little. Move B toward half a wavelength or more.`;
  if (spacingLambda < 0.45) return `Spacing is ${spacingLambda.toFixed(2)} wavelengths: fades are partly correlated. About half a wavelength or more decorrelates them well.`;
  return `Spacing is ${spacingLambda.toFixed(2)} wavelengths: enough to decorrelate the fades.`;
}

/** The curve the receiver actually uses, per sweep sample, for the given mode. Pure. */
export function selectedCurve(sw, mode) {
  if (mode === 'ratio') return sw.combinedRatio;
  if (mode === 'true') return sw.singleBestDbm;
  return sw.aDbm.map((a, i) => (sw.activeSwitching[i] === 'B' ? sw.bDbm[i] : a));
}

export function mountDiversity({ container, store }) {
  container.classList.add('diversity');
  container.textContent = '';
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const h2 = el('h2', null, 'Antenna diversity');
  const msg = el('p', 'hint');
  const body = el('div');
  const chips = el('div', 'dv-top');
  const modeChip = el('span', 'chip'); const actChip = el('span', 'chip'); const swChip = el('span', 'dv-count');
  chips.append(modeChip, actChip, swChip);
  const bars = el('canvas', 'dv-bars'); bars.style.height = '132px'; bars.setAttribute('role', 'img');
  const stats = el('p', 'hint dv-stats');
  const sweep = el('canvas', 'dv-sweep'); sweep.style.height = '215px'; sweep.setAttribute('role', 'img');
  sweep.setAttribute('aria-label', 'Fade sweep: level of antenna A, antenna B and the combined output along the transmitter path');
  const spacing = el('p', 'hint dv-spacing');
  const cap = el('p', 'hint', 'Fades come from the direct and reflected rays cancelling at one point in space. Two antennas about half a wavelength apart see those cancellations at different places, so when A is in a null B usually is not. The receiver then uses (or blends in) the better one, and the dips on the single-antenna curve are filled in. Values are illustrative.');
  body.append(chips, bars, stats, sweep, spacing, cap);
  container.append(h2, msg, body);

  let link = null, cache = null, sweepTimer = 0, lastSweepAt = 0, last = null;

  function pick() {
    const scene = store.getScene();
    link = activeLink(scene, store.getSelection());
    const on = !!(link && link.rx.diversity && link.rx.diversity.enabled);
    msg.hidden = on; body.hidden = !on;
    msg.textContent = link ? 'Diversity is off for this link. Enable it in the inspector (Receiver section) to see antenna A and B.' : 'No link selected.';
    if (!on) return;
    const g = rxState.get(link.id);
    last = g && g.diversity;
    const d = last;
    modeChip.textContent = d ? d.mode : link.rx.diversity.mode;
    modeChip.dataset.state = 'mode';
    actChip.textContent = d ? `ACTIVE ${d.active}` : 'ACTIVE -';
    actChip.dataset.state = 'open';
    swChip.textContent = d ? `${d.switchCount} switches` : '';
    stats.textContent = d ? `A ${formatPower(d.aDbm, scene.units.power)}, B ${formatPower(d.bDbm, scene.units.power)}, combined ${formatPower(d.combinedDbm, scene.units.power)}; diversity gain ${d.gainDb >= 0 ? '+' : '−'}${Math.abs(d.gainDb).toFixed(1)} dB over the stronger antenna.` : '';
    const sp = spacingWavelengths(link.rx.pos, link.rx.diversity.antennaB?.pos || link.rx.pos, link.freqMHz);
    spacing.textContent = spacingAdvice(sp);
    bHost.invalidate();
    scheduleSweep();
  }

  function scheduleSweep() {
    if (sweepTimer) return;
    const wait = Math.max(0, 500 - (performance.now() - lastSweepAt));
    sweepTimer = setTimeout(() => { sweepTimer = 0; computeSweep(); }, wait);
  }

  function computeSweep() {
    lastSweepAt = performance.now();
    const scene = store.getScene();
    if (!link || !link.rx.diversity?.enabled) return;
    const tx = link.tx.pos, rx = link.rx.pos;
    const dx = tx.x - rx.x, dy = tx.y - rx.y, d0 = Math.hypot(dx, dy) || 1;
    const u = { x: dx / d0, y: dy / d0 };
    const far = Math.max(d0 * 1.25, 12), near = 0.8;
    const from = { x: rx.x + u.x * far, y: rx.y + u.y * far, z: tx.z };
    const to = { x: rx.x + u.x * near, y: rx.y + u.y * near, z: tx.z };
    try {
      const sw = sweepLink(scene, link.id, from, to, 260);
      const sel = selectedCurve(sw, link.rx.diversity.mode);
      const total = sw.s[sw.s.length - 1];
      cache = { sw, sel, total, far, d0, thr: link.rx.squelch?.enabled === false ? null : link.rx.squelch?.thresholdDbm,
        statA: fadeDepthStats(sw.aDbm), statS: fadeDepthStats(sel),
        meanGain: sel.reduce((acc, v, i) => acc + (v - sw.aDbm[i]), 0) / sel.length };
    } catch { cache = null; }
    sHost.invalidate();
  }

  function drawBars(ctx, w, h, th) {
    if (!link || !last) return;
    const x0 = 22, x1 = w - 10;
    const thr = link.rx.squelch?.enabled === false ? null : link.rx.squelch?.thresholdDbm;
    [['A', last.aDbm, last.cableLossADb, 6], ['B', last.bDbm, last.cableLossBDb, 68]].forEach(([name, v, cableDb, y]) => {
      const act = last.active === name;
      haloText(ctx, th, name, 4, y + 14, { px: 13, weight: '700' });
      ctx.fillStyle = th.paper2; ctx.fillRect(x0, y, x1 - x0, 18);
      ctx.fillStyle = act ? th.ink : th.inkSoft; ctx.globalAlpha = act ? 1 : 0.55; ctx.fillRect(x0, y, (x1 - x0) * frac(v), 18); ctx.globalAlpha = 1;
      ctx.strokeStyle = th.ink; ctx.lineWidth = act ? 2.5 : 1; ctx.strokeRect(x0 + 0.5, y + 0.5, x1 - x0 - 1, 17);
      if (thr != null) {
        const tx = Math.round(x0 + (x1 - x0) * frac(thr)) + 0.5;
        ctx.save(); ctx.strokeStyle = th.fail; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2]); ctx.beginPath(); ctx.moveTo(tx, y - 3); ctx.lineTo(tx, y + 21); ctx.stroke(); ctx.restore();
      }
      setFont(ctx, th, 11, act ? '700' : ''); ctx.textAlign = 'left'; ctx.fillStyle = th.ink;
      if (Number.isFinite(cableDb)) {
        const at = v + cableDb; // level at the antenna terminals = level at the receiver input plus the cable run's net loss
        setFont(ctx, th, 11); ctx.fillStyle = th.inkSoft; ctx.textAlign = 'left';
        ctx.fillText(`cable ${name}: ${cableDb >= 0 ? 'loss' : 'gain'} ${Math.abs(cableDb).toFixed(1)} dB   at antenna ${at.toFixed(1)} dBm, at receiver input ${v.toFixed(1)} dBm`, x0, y + 34);
      }
      const txt = `${v.toFixed(1)} dBm${act ? '  ◀ ACTIVE' : ''}`;
      const tw = ctx.measureText(txt).width; const bx = x0 + (x1 - x0) * frac(v);
      if (bx + 6 + tw < x1) ctx.fillText(txt, bx + 6, y + 13);
      else { ctx.fillStyle = th.paper; ctx.textAlign = 'right'; ctx.fillText(txt, Math.max(x0 + tw + 6, bx - 6), y + 13); }
    });
  }

  function drawSweep(ctx, w, h, th) {
    if (!cache) return;
    const { sw, sel, total, thr } = cache;
    const L = 36, R = 8, T = 10, B = 66;
    const pw = w - L - R, ph = h - T - B;
    let lo = Infinity, hi = -Infinity;
    for (const arr of [sw.aDbm, sw.bDbm, sel]) for (const v of arr) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (thr != null) lo = Math.min(lo, thr);
    lo = Math.floor((Math.max(lo, hi - 70) - 3) / 10) * 10; hi = Math.ceil((hi + 3) / 10) * 10;
    const X = (i) => L + ((total - sw.s[i]) / total) * pw; // distance from the receiver, increasing to the right is reversed below
    const Xd = (d) => L + (d / (total + 0.8)) * pw;
    const dist = (i) => total + 0.8 - sw.s[i];
    const Y = (v) => T + ph - ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * ph;
    ctx.fillStyle = th.paper2; ctx.fillRect(L, T, pw, ph);
    setFont(ctx, th, 11); ctx.fillStyle = th.inkSoft; ctx.textAlign = 'right';
    for (let v = lo; v <= hi; v += 10) { const y = Math.round(Y(v)) + 0.5; ctx.strokeStyle = th.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.fillText(String(v), L - 4, y + 4); }
    ctx.textAlign = 'center';
    const span = total + 0.8, step = span > 60 ? 10 : span > 25 ? 5 : 2;
    for (let d = 0; d <= span; d += step) { const x = Math.round(Xd(d)) + 0.5; ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke(); ctx.fillStyle = th.inkSoft; ctx.fillText(`${d}`, x, h - B + 14); }
    ctx.fillText('distance from receiver (m)', L + pw / 2, h - 6);
    ctx.strokeStyle = th.ink; ctx.strokeRect(L + 0.5, T + 0.5, pw - 1, ph - 1);
    ctx.save(); ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
    // fill where the combined output beats antenna A alone
    ctx.fillStyle = th.fail; ctx.globalAlpha = 0.22;
    for (let i = 0; i < sel.length - 1; i++) {
      if (sel[i] > sw.aDbm[i] + 0.05 || sel[i + 1] > sw.aDbm[i + 1] + 0.05) {
        ctx.beginPath(); ctx.moveTo(Xd(dist(i)), Y(sw.aDbm[i])); ctx.lineTo(Xd(dist(i + 1)), Y(sw.aDbm[i + 1]));
        ctx.lineTo(Xd(dist(i + 1)), Y(Math.max(sel[i + 1], sw.aDbm[i + 1]))); ctx.lineTo(Xd(dist(i)), Y(Math.max(sel[i], sw.aDbm[i]))); ctx.closePath(); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    const line = (arr, color, width, dash) => {
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.lineJoin = 'round'; ctx.beginPath();
      arr.forEach((v, i) => (i ? ctx.lineTo(Xd(dist(i)), Y(v)) : ctx.moveTo(Xd(dist(i)), Y(v)))); ctx.stroke(); ctx.restore();
    };
    line(sw.aDbm, th.inkSoft, 1.2, []);
    line(sw.bDbm, th.inkSoft, 1.2, [5, 3]);
    line(sel, th.ink, 2.2, []);
    if (thr != null) { ctx.save(); ctx.strokeStyle = th.fail; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); const y = Math.round(Y(thr)) + 0.5; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.restore(); }
    // current Tx distance marker
    const cd = Math.hypot(link.tx.pos.x - link.rx.pos.x, link.tx.pos.y - link.rx.pos.y);
    const mx = Math.round(Xd(cd)) + 0.5;
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(mx, T); ctx.lineTo(mx, T + ph); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
    // legend
    setFont(ctx, th, 11); ctx.textAlign = 'left';
    const items = [['A', th.inkSoft, []], ['B', th.inkSoft, [5, 3]], [`selected (${link.rx.diversity.mode})`, th.ink, []]];
    let lx = L + 4;
    for (const [name, col, dash] of items) {
      ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = name.startsWith('sel') ? 2.2 : 1.2; ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(lx, T + 10); ctx.lineTo(lx + 18, T + 10); ctx.stroke(); ctx.restore();
      haloText(ctx, th, name, lx + 22, T + 14, { px: 11 });
      lx += 28 + ctx.measureText(name).width;
      if (lx > w - 60) break;
    }
    haloText(ctx, th, 'filled = recovered vs A alone', L + 4, T + 28, { px: 11, color: th.fail });
    const gain = cache.statA.fadeDepthDb - cache.statS.fadeDepthDb;
    haloText(ctx, th, `fade depth A ${cache.statA.fadeDepthDb.toFixed(1)} dB, selected ${cache.statS.fadeDepthDb.toFixed(1)} dB (${gain >= 0 ? '+' : '−'}${Math.abs(gain).toFixed(1)} dB), mean gain ${cache.meanGain.toFixed(1)} dB`, L + pw / 2, h - B + 26, { align: 'center', px: 11, color: th.ink });
    const dmode = link.rx.diversity.mode;
    const g1 = cache.sw.gain1pctDb ? cache.sw.gain1pctDb[dmode] : NaN, e1 = cache.sw.expectedGain1pctDb ? cache.sw.expectedGain1pctDb[dmode] : NaN;
    const sg = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} dB` : '-');
    haloText(ctx, th, `gain at the 1% fade level: ${sg(g1)} measured, ${sg(e1)} expected for this spacing`, L + pw / 2, h - B + 40, { align: 'center', px: 11, weight: '600', color: th.ink });
  }

  const bHost = createCanvasHost(bars, drawBars);
  const sHost = createCanvasHost(sweep, drawSweep);
  const u1 = rxState.subscribe(() => pick());
  const u2 = store.subscribe(() => pick());
  const u3 = squelch.subscribe(() => bHost.invalidate());
  pick();
  return { destroy() { u1(); u2(); u3(); clearTimeout(sweepTimer); bHost.destroy(); sHost.destroy(); container.textContent = ''; } };
}
