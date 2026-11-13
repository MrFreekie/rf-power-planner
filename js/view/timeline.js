// Scrolling timeline: squelch ribbon, RF level lane and audio lane for the active link, with muted
// periods shaded red, open/close ticks, hover crosshair, range buttons and pause. When samples carry
// an FM stereo `mode`, a thin stereo/blend/mono lane is drawn under the audio lane.
import { createCanvasHost, activeLink, setFont, haloText, strokeHatchRect } from './util.js';
import { history } from '../history.js';
import { squelch } from '../squelchTracker.js';
import { formatPower } from '../model/units.js';

const RANGES = [[10, '10 s'], [30, '30 s'], [120, '2 min']];

/** Contiguous runs of equal `key(sample)`: [{t0, t1, value}]. Pure. */
export function runsBy(samples, key) {
  const runs = [];
  for (const s of samples) {
    const v = key(s);
    const last = runs[runs.length - 1];
    if (last && last.value === v) last.t1 = s.t;
    else {
      if (last) last.t1 = s.t; // close the previous run at the transition
      runs.push({ t0: s.t, t1: s.t, value: v });
    }
  }
  return runs;
}

/** Contiguous open/closed spans from samples: [{t0, t1, open}]. Pure. */
export function stateSpans(samples) {
  return runsBy(samples, (s) => !!s.open).map((r) => ({ t0: r.t0, t1: r.t1, open: r.value }));
}

/** Nice tick step in seconds for a window. Pure. */
export function timeStep(span) {
  return span <= 12 ? 2 : span <= 35 ? 5 : 20;
}

/** RF lane range in dBm covering samples and threshold, rounded to 10 dB, at least 30 dB tall. Pure. */
export function rfRange(samples) {
  let lo = Infinity, hi = -Infinity;
  for (const s of samples) {
    for (const v of [s.rfDbm, s.thresholdDbm]) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  }
  if (!Number.isFinite(lo)) return { min: -110, max: -20 };
  lo = Math.floor((lo - 5) / 10) * 10; hi = Math.ceil((hi + 5) / 10) * 10;
  if (hi - lo < 30) hi = lo + 30;
  return { min: lo, max: hi };
}

export function mountTimeline({ container, store }) {
  container.classList.add('timeline');
  container.textContent = '';
  const head = document.createElement('div');
  head.className = 'timeline-head';
  const h2 = document.createElement('h2'); h2.textContent = 'Timeline';
  const rangeGroup = document.createElement('div');
  rangeGroup.className = 'group'; rangeGroup.setAttribute('role', 'group'); rangeGroup.setAttribute('aria-label', 'Timeline range');
  let span = 30;
  const rbtns = RANGES.map(([sec, label]) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
    b.setAttribute('aria-pressed', String(sec === span));
    b.addEventListener('click', () => {
      span = sec;
      rbtns.forEach(([s2, bb]) => bb.setAttribute('aria-pressed', String(s2 === span)));
      host.invalidate();
    });
    rangeGroup.append(b);
    return [sec, b];
  });
  const pauseBtn = document.createElement('button');
  pauseBtn.type = 'button'; pauseBtn.textContent = 'Pause'; pauseBtn.setAttribute('aria-pressed', 'false');
  let pausedAt = null;
  pauseBtn.addEventListener('click', () => {
    pausedAt = pausedAt == null ? history.now() : null;
    pauseBtn.textContent = pausedAt == null ? 'Pause' : 'Resume';
    pauseBtn.setAttribute('aria-pressed', String(pausedAt != null));
    host.invalidate();
  });
  head.append(h2, rangeGroup, pauseBtn);
  const canvas = document.createElement('canvas');
  canvas.className = 'timeline-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Timeline of RF level, squelch state and audio level');
  container.append(head, canvas);

  let hoverX = null;
  const L = 46, R = 8;

  function draw(ctx, w, h, th) {
    const scene = store.getScene();
    const link = activeLink(scene, store.getSelection());
    const unit = scene.units?.power || 'dBm';
    if (!link) return;
    const tEnd = pausedAt ?? history.now();
    const t0 = tEnd - span;
    const samples = history.get(link.id, history.now() - t0).filter((s) => s.t <= tEnd);
    const hasDig = samples.some((s) => s.digitalState);
    const hasMode = !hasDig && samples.some((s) => s.mode);
    const X = (t) => L + ((t - t0) / span) * (w - L - R);
    const ribY = 4, ribH = 16;
    const modeH = hasMode || hasDig ? 12 : 0;
    const hasDiv = !!link.rx.diversity?.enabled && samples.some((x) => Number.isFinite(x.bDbm));
    const divH = hasDiv ? 10 : 0;
    const hasBat = samples.some((x) => Number.isFinite(x.batteryPercent));
    const batH = hasBat ? 14 : 0;
    const bottom = h - 20;
    const laneTop = ribY + ribH + 8;
    const laneH = Math.max(30, (bottom - laneTop - 8 - ((hasMode || hasDig) ? modeH + 4 : 0) - (hasDiv ? divH + 4 : 0) - (hasBat ? batH + 4 : 0)) / 2);
    const rfY0 = laneTop, auY0 = laneTop + laneH + 8, divY0 = auY0 + laneH + 4, batY0 = divY0 + (hasDiv ? divH + 4 : 0), modeY0 = batY0 + (hasBat ? batH + 4 : 0);
    const rr = rfRange(samples);
    const RFy = (v) => rfY0 + laneH - ((Math.min(Math.max(v, rr.min), rr.max) - rr.min) / (rr.max - rr.min)) * laneH;
    const AUy = (v) => auY0 + laneH - ((Math.min(Math.max(v, -60), 0) + 60) / 60) * laneH;
    const lanesBottom = auY0 + laneH;

    for (const [y0, lo, hi, lab] of [[rfY0, rr.min, rr.max, 'RF'], [auY0, -60, 0, 'Audio']]) {
      ctx.fillStyle = th.paper2; ctx.fillRect(L, y0, w - L - R, laneH);
      ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(L + 0.5, y0 + 0.5, w - L - R - 1, laneH - 1);
      setFont(ctx, th, 11); ctx.fillStyle = th.inkSoft; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
      const fmt = (v) => (lab === 'RF' ? (unit === 'mW' ? formatPower(v, 'mW').replace(' mW', '') : String(Math.round(unit === 'dBW' ? v - 30 : v))) : String(v));
      ctx.fillText(fmt(hi), L - 4, y0 + 10);
      ctx.fillText(fmt(lo), L - 4, y0 + laneH - 2);
      ctx.textAlign = 'left';
      ctx.fillText(lab === 'RF' ? `RF (${unit})` : 'Audio (dBFS)', L + 4, y0 + 11);
    }
    const step = timeStep(span);
    ctx.strokeStyle = th.grid; ctx.lineWidth = 1; ctx.fillStyle = th.inkSoft; ctx.textAlign = 'center';
    for (let a = 0; a <= span; a += step) {
      const x = Math.round(X(tEnd - a)) + 0.5;
      if (x < L || x > w - R) continue;
      ctx.beginPath(); ctx.moveTo(x, rfY0); ctx.lineTo(x, lanesBottom); ctx.stroke();
      setFont(ctx, th, 11);
      ctx.fillText(a === 0 ? 'now' : `-${a >= 60 ? `${a / 60} min` : `${a} s`}`, Math.min(Math.max(x, L + 14), w - R - 14), h - 5);
    }

    const spans = stateSpans(samples);
    ctx.save(); ctx.beginPath(); ctx.rect(L, 0, w - L - R, h); ctx.clip();

    for (const sp of spans) {
      const xa = X(sp.t0), xb = Math.max(X(sp.t1), xa + 1);
      if (!sp.open) { ctx.save(); ctx.globalAlpha = 0.16; ctx.fillStyle = th.fail; ctx.fillRect(xa, rfY0, xb - xa, lanesBottom - rfY0); ctx.restore(); }
      ctx.fillStyle = sp.open ? th.pass : th.fail; ctx.fillRect(xa, ribY, xb - xa, ribH);
      if (!sp.open && xb - xa > 38) { setFont(ctx, th, 11, '600'); ctx.fillStyle = th.onFail; ctx.textAlign = 'center'; ctx.fillText('MUTE', (xa + xb) / 2, ribY + 12); }
      if (sp !== spans[0]) {
        ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
        const x = Math.round(xa) + 0.5; ctx.beginPath(); ctx.moveTo(x, ribY + ribH); ctx.lineTo(x, lanesBottom); ctx.stroke(); ctx.setLineDash([]);
      }
    }

    for (const r of runsBy(samples, (x) => x.overloadLevel || 'ok')) {
      if (r.value === 'ok') continue;
      const xa = X(r.t0), xb = Math.max(X(r.t1), xa + 2);
      ctx.fillStyle = th.marginal; ctx.globalAlpha = r.value === 'overload' ? 0.35 : 0.15; ctx.fillRect(xa, rfY0, xb - xa, lanesBottom - rfY0); ctx.globalAlpha = 1;
      if (r.value === 'overload' && xb - xa > 30) { setFont(ctx, th, 10, '600'); ctx.fillStyle = th.warnText; ctx.textAlign = 'center'; ctx.fillText('OVERLOAD', (xa + xb) / 2, rfY0 + laneH - 4); }
    }
    if (hasDiv) { // single-antenna traces under the combined trace
      for (const [key, dash, col] of [['aDbm', [], th.inkSoft], ['bDbm', [5, 3], th.inkSoft]]) {
        ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.setLineDash(dash); ctx.beginPath();
        let st0 = false;
        for (const x of samples) { if (!Number.isFinite(x[key])) { st0 = false; continue; } const px = X(x.t), py = RFy(x[key]); if (st0) ctx.lineTo(px, py); else ctx.moveTo(px, py); st0 = true; }
        ctx.stroke(); ctx.restore();
      }
    }
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.beginPath();
    let started = false;
    for (const s of samples) {
      if (!Number.isFinite(s.rfDbm)) { started = false; continue; }
      const x = X(s.t), y = RFy(s.rfDbm); if (started) ctx.lineTo(x, y); else ctx.moveTo(x, y); started = true;
    }
    ctx.stroke();
    const thr = samples.length ? samples[samples.length - 1].thresholdDbm : NaN;
    if (Number.isFinite(thr) && link.rx.squelch?.enabled !== false) {
      ctx.save(); ctx.strokeStyle = th.fail; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      const y = Math.round(RFy(thr)) + 0.5; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke(); ctx.restore();
    }

    ctx.strokeStyle = th.inkSoft; ctx.lineWidth = 1; ctx.beginPath(); started = false;
    for (const s of samples) {
      if (!Number.isFinite(s.audioRawDb)) continue;
      const x = X(s.t), y = AUy(s.audioRawDb); if (started) ctx.lineTo(x, y); else ctx.moveTo(x, y); started = true;
    }
    ctx.stroke();
    if (samples.length) {
      ctx.fillStyle = th.ink; ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.moveTo(X(samples[0].t), lanesBottom);
      for (const s of samples) ctx.lineTo(X(s.t), AUy(s.audioDb));
      ctx.lineTo(X(samples[samples.length - 1].t), lanesBottom); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    }

    if (hasDig) {
      const names = { 2: 'BPSK', 4: 'QPSK', 16: '16Q', 64: '64Q', 256: '256Q' };
      for (const r of runsBy(samples, (s) => `${s.digitalState || ''}|${s.digitalOrder || 0}`)) {
        const [state, order] = r.value.split('|');
        const xa = X(r.t0), xb = Math.max(X(r.t1), xa + 1);
        if (state === 'ok') { ctx.fillStyle = th.pass; ctx.fillRect(xa, modeY0, xb - xa, modeH); }
        else if (state === 'degraded') { ctx.fillStyle = th.marginal; ctx.fillRect(xa, modeY0, xb - xa, modeH); }
        else if (state === 'concealing') { ctx.fillStyle = th.paper; ctx.fillRect(xa, modeY0, xb - xa, modeH); strokeHatchRect(ctx, xa, modeY0, xb - xa, modeH, th.marginal, 4); }
        else { ctx.fillStyle = th.fail; ctx.fillRect(xa, modeY0, xb - xa, modeH); }
        if (xb - xa > 34 && names[order]) { setFont(ctx, th, 10, '600'); ctx.fillStyle = state === 'down' ? th.onFail : th.ink; ctx.textAlign = 'center'; ctx.fillText(names[order], (xa + xb) / 2, modeY0 + 10); }
      }
    }
    if (hasMode) {
      for (const r of runsBy(samples, (s) => s.mode || '')) {
        const xa = X(r.t0), xb = Math.max(X(r.t1), xa + 1);
        if (r.value === 'stereo') { ctx.fillStyle = th.blue; ctx.fillRect(xa, modeY0, xb - xa, modeH); }
        else if (r.value === 'mono') { ctx.fillStyle = th.mono; ctx.fillRect(xa, modeY0, xb - xa, modeH); }
        else if (r.value === 'blend') {
          ctx.fillStyle = th.paper; ctx.fillRect(xa, modeY0, xb - xa, modeH);
          strokeHatchRect(ctx, xa, modeY0, xb - xa, modeH, th.blue, 4);
        }
      }
      ctx.fillStyle = th.fail; // pilot-lost marks
      for (const r of runsBy(samples, (s) => s.pilotLocked === false)) if (r.value) ctx.fillRect(X(r.t0), modeY0 - 3, Math.max(X(r.t1) - X(r.t0), 2), 3);
    }
    if (hasBat) {
      ctx.fillStyle = th.paper2; ctx.fillRect(L, batY0, w - L - R, batH);
      for (let i = 0; i < samples.length - 1; i++) {
        const x = samples[i], xa = X(x.t), xb = Math.max(X(samples[i + 1].t), xa + 1), pc = Math.min(100, Math.max(0, x.batteryPercent));
        ctx.fillStyle = pc <= 5 ? th.fail : pc <= 20 ? th.marginal : th.inkSoft;
        ctx.fillRect(xa, batY0 + batH * (1 - pc / 100), xb - xa, batH * pc / 100);
      }
      ctx.fillStyle = th.fail;
      for (const r of runsBy(samples, (x) => !!x.dataStale)) if (r.value) ctx.fillRect(X(r.t0), batY0 - 3, Math.max(X(r.t1) - X(r.t0), 2), 3);
    }
    if (hasDiv) {
      for (const r of runsBy(samples, (x) => x.active || 'A')) {
        const xa = X(r.t0), xb = Math.max(X(r.t1), xa + 1);
        if (r.value === 'A') { ctx.fillStyle = th.ink; ctx.fillRect(xa, divY0, xb - xa, divH); }
        else { ctx.fillStyle = th.paper; ctx.fillRect(xa, divY0, xb - xa, divH); strokeHatchRect(ctx, xa, divY0, xb - xa, divH, th.ink, 4); }
      }
      ctx.fillStyle = th.ink;
      for (const x of samples) if (x.switched) { const px = X(x.t); ctx.beginPath(); ctx.moveTo(px, divY0 - 1); ctx.lineTo(px - 3, divY0 - 6); ctx.lineTo(px + 3, divY0 - 6); ctx.closePath(); ctx.fill(); }
    }
    ctx.restore();
    if (hasBat) {
      setFont(ctx, th, 11); ctx.fillStyle = th.inkSoft; ctx.textAlign = 'right'; ctx.fillText('Batt', L - 4, batY0 + batH - 2);
      ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(L + 0.5, batY0 + 0.5, w - L - R - 1, batH - 1);
    }
    if (hasDiv) {
      setFont(ctx, th, 11); ctx.fillStyle = th.inkSoft; ctx.textAlign = 'right'; ctx.fillText('A/B', L - 4, divY0 + divH - 1);
      ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(L + 0.5, divY0 + 0.5, w - L - R - 1, divH - 1);
    }
    if (hasMode || hasDig) {
      setFont(ctx, th, 11); ctx.fillStyle = th.inkSoft; ctx.textAlign = 'right';
      ctx.fillText(hasDig ? 'Dig' : 'FM', L - 4, modeY0 + modeH - 2);
      ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(L + 0.5, modeY0 + 0.5, w - L - R - 1, modeH - 1);
    }

    if (hoverX != null && hoverX >= L && hoverX <= w - R && samples.length) {
      const tH = t0 + ((hoverX - L) / (w - L - R)) * span;
      let best = samples[0];
      for (const s of samples) if (Math.abs(s.t - tH) < Math.abs(best.t - tH)) best = s;
      const x = Math.round(hoverX) + 0.5;
      ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, ribY); ctx.lineTo(x, lanesBottom); ctx.stroke();
      const txt = `${(best.t - tEnd).toFixed(1)} s  RF ${formatPower(best.rfDbm, unit)}  audio ${best.open ? `${best.audioDb.toFixed(0)} dBFS` : 'muted'}  ${best.open ? 'OPEN' : 'MUTE'}${best.mode ? `  ${best.mode}` : ''}`;
      setFont(ctx, th, 12, '600');
      const tw = ctx.measureText(txt).width + 10;
      const bx = Math.min(Math.max(hoverX + 8, L), Math.max(L, w - R - tw));
      ctx.fillStyle = th.paper; ctx.strokeStyle = th.ink; ctx.lineWidth = 1;
      ctx.fillRect(bx, rfY0 + 16, tw, 20); ctx.strokeRect(bx + 0.5, rfY0 + 16.5, tw - 1, 19);
      ctx.fillStyle = best.open ? th.ink : th.fail; ctx.textAlign = 'left'; ctx.fillText(txt, bx + 5, rfY0 + 31);
    }
    if (pausedAt != null) haloText(ctx, th, 'PAUSED', w - R - 4, auY0 - 12, { align: 'right', weight: '600' });
  }

  const host = createCanvasHost(canvas, draw);
  canvas.addEventListener('pointermove', (e) => { hoverX = e.clientX - canvas.getBoundingClientRect().left; host.invalidate(); });
  canvas.addEventListener('pointerleave', () => { hoverX = null; host.invalidate(); });
  const u1 = history.subscribe(() => { if (pausedAt == null) host.invalidate(); });
  const u2 = store.subscribe(() => host.invalidate());
  const u3 = squelch.subscribe(() => host.invalidate());
  return { destroy() { u1(); u2(); u3(); host.destroy(); container.textContent = ''; } };
}
