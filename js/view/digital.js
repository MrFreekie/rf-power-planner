// Digital link panel: constellation with ideal points, EVM/MER, BER vs Eb/N0, analog vs digital quality,
// status chips, throughput and the current QAM order. Shown only for links with modulation.type === 'digital'.
import { createCanvasHost, activeLink, setFont, haloText } from './util.js';
import { digital } from '../digitalTracker.js';
import { constellation, constellationSamples, berCurve, analogVsDigitalCurve } from '../model/digital.js';

export const ORDER_NAMES = { 0: 'no carrier', 2: 'BPSK', 4: 'QPSK', 16: '16-QAM', 64: '64-QAM', 256: '256-QAM' };

/** Chip text for a digital state. Pure. */
export function stateText(state) {
  return { ok: 'OK', degraded: 'DEGRADED', concealing: 'CONCEALING', down: 'DOWN' }[state] || '-';
}

/** Decision-region boundaries per axis for an ideal constellation: midpoints between adjacent levels. Pure. */
export function decisionLines(order) {
  const levels = [...new Set(constellation(order).map((p) => +p.i.toFixed(6)))].sort((a, b) => a - b);
  const mids = [];
  for (let k = 0; k < levels.length - 1; k++) mids.push((levels[k] + levels[k + 1]) / 2);
  return { mids, bpsk: order === 2 };
}

/** Linear interpolation of ys at x over ascending xs (clamped). Pure. */
export function interp(xs, ys, x) {
  if (!xs.length) return NaN;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let i = 1;
  while (xs[i] < x) i++;
  const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[i - 1] + t * (ys[i] - ys[i - 1]);
}

const fmtBer = (v) => (v <= 1e-12 ? '<1e-12' : v.toExponential(1));
const fmtDb = (v, d = 1) => (Number.isFinite(v) ? `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)} dB` : '-');

export function mountDigital({ container, store }) {
  container.classList.add('digital');
  container.textContent = '';
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const h2 = el('h2', null, 'Digital link');
  const msg = el('p', 'hint');
  const body = el('div');
  const chips = el('div', 'dg-top');
  const stateChip = el('span', 'chip dg-state'); stateChip.setAttribute('role', 'status');
  const orderChip = el('span', 'chip'); const tput = el('span', 'dg-count');
  chips.append(stateChip, orderChip, tput);
  const nums = el('dl', 'mpx-nums');
  const numEls = {};
  for (const [k, label] of [['cnr', 'CNR'], ['evm', 'EVM'], ['mer', 'MER'], ['pre', 'BER before FEC'], ['post', 'BER after FEC'], ['fer', 'Frame errors']]) {
    const d = el('div'); d.append(el('dt', null, label)); const dd = el('dd', null, '-'); d.append(dd); nums.append(d); numEls[k] = dd;
  }
  const cons = el('canvas', 'dg-cons'); cons.setAttribute('role', 'img');
  const ber = el('canvas', 'dg-ber'); ber.setAttribute('role', 'img'); ber.setAttribute('aria-label', 'Bit error rate against Eb/N0 with the live operating point');
  const cmp = el('canvas', 'dg-cmp'); cmp.setAttribute('role', 'img'); cmp.setAttribute('aria-label', 'Analog versus digital quality against carrier to noise ratio');
  const cap = el('p', 'hint', 'Each dot is a received symbol; the crosses are where it should land. As noise grows the cloud blurs until symbols cross a decision boundary and become bit errors. Forward error correction hides those errors until it suddenly cannot, which is the cliff: analog FM fades gradually, digital stays clean and then drops. Adaptive modulation steps down to a simpler constellation to stay on the right side of the cliff. Values are illustrative.');
  const figs = el('div', 'dg-figs');
  figs.append(cons);
  body.append(chips, nums, figs, ber, cmp, cap);
  container.append(h2, msg, body);

  let link = null, st = null;

  function pick() {
    link = activeLink(store.getScene(), store.getSelection());
    const isDig = !!(link && link.modulation && link.modulation.type === 'digital');
    st = isDig ? digital.get(link.id) : null;
    msg.hidden = isDig; body.hidden = !isDig;
    msg.textContent = link ? 'This link uses analog FM. Choose Digital in the toolbar to see the constellation, bit error curve and adaptive modulation.' : 'No link selected.';
    if (!isDig) return;
    stateChip.textContent = st ? stateText(st.state) : '-';
    stateChip.dataset.state = st ? st.state : 'none';
    orderChip.textContent = st ? ORDER_NAMES[st.order] || String(st.order) : '-';
    tput.textContent = st ? `${st.throughputKbps >= 1000 ? (st.throughputKbps / 1000).toFixed(2) + ' Mb/s' : st.throughputKbps.toFixed(0) + ' kb/s'}` : '';
    if (st) {
      numEls.cnr.textContent = fmtDb(st.cnrDb); numEls.evm.textContent = `${st.evmPercent.toFixed(1)} %`; numEls.mer.textContent = fmtDb(st.merDb);
      numEls.pre.textContent = fmtBer(st.preFecBer); numEls.post.textContent = fmtBer(st.postFecBer);
      numEls.fer.textContent = st.frameErrorRate < 1e-4 ? '<0.01 %' : `${(st.frameErrorRate * 100).toFixed(st.frameErrorRate < 0.01 ? 2 : 0)} %`;
    }
    cons.setAttribute('aria-label', st ? `Constellation, ${ORDER_NAMES[st.order]}, EVM ${st.evmPercent.toFixed(1)} percent, state ${stateText(st.state)}` : 'Constellation');
    cHost.invalidate(); bHost.invalidate(); mHost.invalidate();
  }

  function drawCons(ctx, w, h, th) {
    if (!st || !st.order) { if (st) haloText(ctx, th, 'no carrier', w / 2, h / 2, { align: 'center', color: th.inkSoft }); return; }
    const size = Math.min(w, h), ox = (w - size) / 2, oy = (h - size) / 2, R = 1.7;
    const X = (i) => ox + size / 2 + (i / R) * (size / 2), Y = (q) => oy + size / 2 - (q / R) * (size / 2);
    ctx.fillStyle = th.paper2; ctx.fillRect(ox, oy, size, size);
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(ox + 0.5, oy + 0.5, size - 1, size - 1);
    // decision regions (faint) and axes
    const { mids, bpsk } = decisionLines(st.order);
    ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
    for (const m of mids) { ctx.beginPath(); ctx.moveTo(Math.round(X(m)) + 0.5, oy); ctx.lineTo(Math.round(X(m)) + 0.5, oy + size); ctx.stroke(); if (!bpsk) { ctx.beginPath(); ctx.moveTo(ox, Math.round(Y(m)) + 0.5); ctx.lineTo(ox + size, Math.round(Y(m)) + 0.5); ctx.stroke(); } }
    ctx.strokeStyle = th.gridMajor; ctx.beginPath(); ctx.moveTo(ox, Y(0)); ctx.lineTo(ox + size, Y(0)); ctx.moveTo(X(0), oy); ctx.lineTo(X(0), oy + size); ctx.stroke();
    const s = constellationSamples(st.order, Number.isFinite(st.esN0Db) ? st.esN0Db - (st.cfg?.implLossDb || 0) : -20, { n: 400, seed: 7 });
    ctx.fillStyle = th.ink; ctx.globalAlpha = 0.4;
    for (const p of s.points) { ctx.fillRect(X(p.i) - 1.3, Y(p.q) - 1.3, 2.6, 2.6); }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = th.fail; ctx.lineWidth = 1.2;
    for (const p of constellation(st.order)) { const x = X(p.i), y = Y(p.q); ctx.beginPath(); ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y + 3); ctx.moveTo(x - 3, y + 3); ctx.lineTo(x + 3, y - 3); ctx.stroke(); }
    haloText(ctx, th, `${ORDER_NAMES[st.order]}  EVM ${st.evmPercent.toFixed(1)} %  MER ${st.merDb.toFixed(1)} dB`, ox + 6, oy + 14, { px: 11, weight: '600' });
    haloText(ctx, th, 'I', ox + size - 8, Y(0) - 4, { align: 'right', px: 11, color: th.inkSoft });
    haloText(ctx, th, 'Q', X(0) + 4, oy + 26, { px: 11, color: th.inkSoft });
  }

  function plotFrame(ctx, w, h, th, { L = 40, R = 10, T = 10, B = 32 }) {
    const pw = w - L - R, ph = h - T - B;
    ctx.fillStyle = th.paper2; ctx.fillRect(L, T, pw, ph);
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(L + 0.5, T + 0.5, pw - 1, ph - 1);
    return { L, T, pw, ph };
  }

  function drawBer(ctx, w, h, th) {
    if (!st || !st.order) return;
    const f = plotFrame(ctx, w, h, th, {});
    const { L, T, pw, ph } = f, x0 = -2, x1 = 32, yLo = -8;
    const curve = berCurve(st.order, st.cfg.codeRate, x0, x1, 120, st.cfg);
    const X = (v) => L + ((v - x0) / (x1 - x0)) * pw;
    const Y = (b) => T + ph * (Math.min(Math.max(-Math.log10(Math.max(b, 1e-12)), 0), -yLo) / -yLo);
    setFont(ctx, th, 11); ctx.fillStyle = th.inkSoft; ctx.textAlign = 'right';
    for (let e = 0; e >= yLo; e -= 2) { const y = Math.round(Y(Math.pow(10, e))) + 0.5; ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.fillText(e === 0 ? '1' : `1e${e}`, L - 4, y + 4); }
    ctx.textAlign = 'center';
    for (let d = 0; d <= 30; d += 10) { const x = Math.round(X(d)) + 0.5; ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke(); ctx.fillText(String(d), x, h - 16); }
    ctx.fillText(`Eb/N0 (dB), ${ORDER_NAMES[st.order]}, code rate ${st.cfg.codeRate.toFixed(2)}`, L + pw / 2, h - 3);
    const line = (arr, col, wd, dash) => { ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = wd; ctx.setLineDash(dash); ctx.beginPath(); arr.forEach((v, i) => (i ? ctx.lineTo(X(curve.x[i]), Y(v)) : ctx.moveTo(X(curve.x[i]), Y(v)))); ctx.stroke(); ctx.restore(); };
    ctx.save(); ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
    line(curve.uncoded, th.inkSoft, 1.4, [5, 3]);
    line(curve.coded, th.ink, 2.2, []);
    ctx.restore();
    haloText(ctx, th, 'uncoded', L + 6, T + 14, { px: 11, color: th.inkSoft });
    haloText(ctx, th, 'with FEC (cliff)', L + 6, T + 28, { px: 11, weight: '600' });
    if (Number.isFinite(st.ebN0Db)) {
      const x = Math.min(Math.max(X(st.ebN0Db), L), L + pw), y = Y(st.postFecBer);
      ctx.fillStyle = th.paper; ctx.strokeStyle = th.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = th.ink; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
      haloText(ctx, th, `now ${fmtBer(st.postFecBer)}`, Math.min(x + 10, L + pw - 70), Math.max(y - 8, T + 40), { px: 11, weight: '600' });
    }
  }

  let cmpCache = null, cmpKey = '';
  function drawCmp(ctx, w, h, th) {
    if (!st) return;
    const key = JSON.stringify([st.preset, st.cfg.fixedOrder]);
    if (key !== cmpKey) { cmpKey = key; cmpCache = analogVsDigitalCurve(0, 40, 121, { digital: st.cfg }); }
    const c = cmpCache;
    const { L, T, pw, ph } = plotFrame(ctx, w, h, th, {});
    const X = (v) => L + (v / 40) * pw, Y = (q) => T + ph - (Math.min(Math.max(q, 0), 100) / 100) * ph;
    setFont(ctx, th, 11); ctx.fillStyle = th.inkSoft; ctx.textAlign = 'right';
    for (let q = 0; q <= 100; q += 50) { const y = Math.round(Y(q)) + 0.5; ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.fillText(`${q}%`, L - 4, y + 4); }
    ctx.textAlign = 'center';
    for (let d = 0; d <= 40; d += 10) { const x = Math.round(X(d)) + 0.5; ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke(); ctx.fillText(String(d), x, h - 16); }
    ctx.fillText('CNR (dB): quality of analog FM and digital', L + pw / 2, h - 3);
    const line = (arr, col, wd, dash) => { ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = wd; ctx.setLineDash(dash); ctx.beginPath(); arr.forEach((v, i) => (i ? ctx.lineTo(X(c.cnr[i]), Y(v)) : ctx.moveTo(X(c.cnr[i]), Y(v)))); ctx.stroke(); ctx.restore(); };
    line(c.analogQuality, th.inkSoft, 2, [5, 3]);
    line(c.digitalQuality, th.ink, 2.2, []);
    haloText(ctx, th, 'analog: graceful slope', L + 6, T + 14, { px: 11, color: th.inkSoft });
    haloText(ctx, th, 'digital: cliff', L + 6, T + 28, { px: 11, weight: '600' });
    if (Number.isFinite(st.cnrDb)) {
      const x = Math.min(Math.max(X(st.cnrDb), L), L + pw);
      const ya = Y(interp(c.cnr, c.analogQuality, st.cnrDb)), yd = Y(100 * (1 - st.frameErrorRate));
      ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke(); ctx.setLineDash([]);
      for (const [y, filled] of [[ya, false], [yd, true]]) { ctx.fillStyle = filled ? th.ink : th.paper; ctx.strokeStyle = th.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    }
  }

  const cHost = createCanvasHost(cons, drawCons);
  const bHost = createCanvasHost(ber, drawBer);
  const mHost = createCanvasHost(cmp, drawCmp);
  const u1 = digital.subscribe(() => pick());
  const u2 = store.subscribe(() => pick());
  pick();
  return { destroy() { u1(); u2(); cHost.destroy(); bHost.destroy(); mHost.destroy(); container.textContent = ''; } };
}
