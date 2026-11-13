// RF level and virtual audio meters for the active link, with peak hold, threshold tick and MUTE chip.
import { createCanvasHost, activeLink, setFont, haloText } from './util.js';
import { history } from '../history.js';
import { squelch } from '../squelchTracker.js';
import { formatPower } from '../model/units.js';
import { rxState, rxConfig } from '../rxTracker.js';

const LATCH_S = 2.5;

export const RF_RANGE = { min: -110, max: 0 };
export const AUDIO_RANGE = { min: -60, max: 0 };
const HOLD_S = 1.2;
const FALL_DB_PER_S = 20;

/** Fraction 0..1 of a value inside a range. Pure. */
export function frac(v, { min, max }) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, (v - min) / (max - min)));
}

/** Peak-hold update: returns the new {v, t}. Holds for HOLD_S, then falls at a fixed rate. Pure. */
export function peakHold(peak, value, now, range) {
  const v = Number.isFinite(value) ? value : -Infinity;
  if (!peak || v >= peak.v) return { v, t: now };
  const held = now - peak.t;
  if (held <= HOLD_S) return peak;
  const fallen = Math.max(peak.v - FALL_DB_PER_S * (held - HOLD_S), range.min);
  return fallen <= v ? { v, t: now } : { v: fallen, t: peak.t };
}

export function mountMeters({ container, store }) {
  container.classList.add('meters');
  container.textContent = '';
  const head = document.createElement('div');
  head.className = 'meters-head';
  const h2 = document.createElement('h2');
  h2.textContent = 'Meters';
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.setAttribute('role', 'status');
  head.append(h2, chip);
  const canvas = document.createElement('canvas');
  canvas.className = 'meters-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'RF level and audio level meters');
  canvas.style.height = '124px';
  const ovLed = document.createElement('span');
  ovLed.className = 'chip chip-overload'; ovLed.textContent = 'RF OVERLOAD'; ovLed.hidden = true; ovLed.setAttribute('role', 'status');
  head.append(ovLed);
  const ovText = document.createElement('p');
  ovText.className = 'hint meters-ov';
  container.append(head, canvas, ovText);
  let latchUntil = 0, latchTimer = 0;

  let rf = null, au = null;
  let last = null;
  let link = null, unit = 'dBm';
  let linkId = null;

  function pickLink() {
    const scene = store.getScene();
    link = activeLink(scene, store.getSelection());
    unit = scene.units?.power || 'dBm';
    if (link && link.id !== linkId) {
      linkId = link.id; rf = null; au = null;
      const g = history.get(link.id, 1);
      last = g.length ? g[g.length - 1] : null;
    }
  }

  function setChip() {
    const g = link ? squelch.get(link.id) : null;
    const on = link?.rx.squelch?.enabled !== false;
    const open = last ? last.open : g ? g.open : true;
    chip.dataset.state = !on ? 'off' : open ? 'open' : 'closed';
    const reason = (last && last.reason) || (g && g.reason) || null;
    const why = { pilot: 'pilot lost', battery: 'battery', digital: 'digital', imd: 'intermod noise', interferer: 'interferer' }[reason];
    chip.textContent = !on ? 'SQUELCH OFF' : open ? 'SQUELCH OPEN' : `MUTE${why ? ` (${why})` : ''}`;
    chip.hidden = !link;
  }

  function setOverload(nowS) {
    const st = link ? rxState.get(link.id) : null;
    const o = st && st.overload;
    if (o && o.level === 'overload') {
      latchUntil = nowS + LATCH_S;
      clearTimeout(latchTimer);
    }
    const on = nowS < latchUntil;
    ovLed.hidden = !on;
    if (on) { clearTimeout(latchTimer); latchTimer = setTimeout(() => { setOverload(history.now()); host.invalidate(); }, Math.max(50, (latchUntil - nowS) * 1000 + 30)); }
    if (!o) { ovText.textContent = ''; return; }
    const sg = (v, d = 1) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(d)}`;
    ovText.dataset.level = o.level;
    ovText.textContent = `Front end ${o.level === 'ok' ? 'OK' : o.level === 'hot' ? 'HOT' : 'OVERLOAD'}: headroom ${sg(o.headroomDb)} dB, compression ${o.compressionDb.toFixed(1)} dB, IM3 distortion ${o.distortionPct < 0.1 ? '<0.1' : o.distortionPct.toFixed(1)} %`;
  }

  function draw(ctx, w, h, th) {
    if (!link) return;
    const open = last ? last.open : true;
    const labelW = w < 360 ? 44 : 56, x0 = labelW + 4, x1 = w - 10;
    const bar = (y, label, value, range, peak, color, text, tick, zones, ticks2) => {
      const bh = 16;
      haloText(ctx, th, label, 2, y + 13, { px: 12, weight: '600' });
      ctx.fillStyle = th.paper2; ctx.fillRect(x0, y, x1 - x0, bh);
      if (zones) for (const [a, b, c] of zones) {
        const xa = x0 + frac(a, range) * (x1 - x0), xb = x0 + frac(b, range) * (x1 - x0);
        ctx.fillStyle = c; ctx.globalAlpha = 0.28; ctx.fillRect(xa, y, xb - xa, bh); ctx.globalAlpha = 1;
      }
      ctx.fillStyle = color; ctx.fillRect(x0, y, frac(value, range) * (x1 - x0), bh);
      ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y + 0.5, x1 - x0 - 1, bh - 1);
      if (peak && Number.isFinite(peak.v)) {
        const px = Math.round(x0 + frac(peak.v, range) * (x1 - x0)) + 0.5;
        ctx.strokeStyle = th.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px, y - 2); ctx.lineTo(px, y + bh + 2); ctx.stroke();
      }
      if (tick != null && Number.isFinite(tick)) {
        const tx = Math.round(x0 + frac(tick, range) * (x1 - x0)) + 0.5;
        ctx.save(); ctx.strokeStyle = th.fail; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2]);
        ctx.beginPath(); ctx.moveTo(tx, y - 5); ctx.lineTo(tx, y + bh + 5); ctx.stroke(); ctx.restore();
      }
      if (ticks2) for (const [v, name] of ticks2) {
        const tx = Math.round(x0 + frac(v, range) * (x1 - x0)) + 0.5;
        ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(tx, y + bh - 5); ctx.lineTo(tx, y + bh + 4); ctx.stroke();
        setFont(ctx, th, 10); ctx.fillStyle = th.inkSoft; ctx.textAlign = 'center'; ctx.fillText(name, Math.min(tx, x1 - 8), y - 3);
      }
      setFont(ctx, th, 12);
      ctx.fillStyle = th.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(text, x0, y + bh + 15);
    };
    const rfV = last ? last.rfDbm : NaN;
    const thr = link.rx.squelch?.enabled === false ? null : link.rx.squelch?.thresholdDbm;
    const oc = rxConfig(link);
    const ovPoint = Math.min(oc.p1dBDbm, oc.maxInputDbm);
    const zones = [[oc.p1dBDbm - (oc.hotMarginDb ?? 10), ovPoint, th.marginal], [ovPoint, RF_RANGE.max, th.fail]];
    const tk = [[oc.p1dBDbm, 'P1dB'], ...(oc.maxInputDbm !== oc.p1dBDbm ? [[oc.maxInputDbm, 'max']] : [])];
    const ifr = link.interferer && link.interferer.enabled ? link.interferer : null;
    const sq0 = ifr ? squelch.get(link.id) : null, ms = sq0 && sq0.capture ? sq0.capture : null;
    if (ifr) tk.push([ifr.levelDbm, 'stray']);
    bar(18, 'RF', rfV, RF_RANGE, rf, open ? th.pass : th.fail,
      `${Number.isFinite(rfV) ? formatPower(rfV, unit) : '-'}${thr != null ? `   squelch ${formatPower(thr, unit)}` : ''}${ifr ? `   stray ${formatPower(ifr.levelDbm, unit)}${ms && Number.isFinite(ms.cirDb) ? ` (C/I ${ms.cirDb >= 0 ? '+' : '\u2212'}${Math.abs(ms.cirDb).toFixed(1)} dB)` : ''}` : ''}`, thr, zones, tk);
    const aV = last ? last.audioDb : NaN;
    bar(70, 'Audio', aV, AUDIO_RANGE, au, th.ink,
      last && !last.open ? 'muted' : `${Number.isFinite(aV) ? aV.toFixed(1) : '-'} dBFS`, null);
  }

  const host = createCanvasHost(canvas, draw);

  function onSample(id, s) {
    if (!link || id !== link.id) return;
    last = s;
    rf = peakHold(rf, s.rfDbm, s.t, RF_RANGE);
    au = peakHold(au, s.open ? (s.audioPeakDb ?? s.audioDb) : -Infinity, s.t, AUDIO_RANGE);
    setChip(); setOverload(s.t);
    host.invalidate();
  }

  const u1 = history.subscribe(onSample);
  const u2 = store.subscribe(() => { pickLink(); setChip(); host.invalidate(); });
  const u3 = squelch.subscribe(() => { setChip(); setOverload(history.now()); host.invalidate(); });
  const u4 = rxState.subscribe(() => { setOverload(history.now()); host.invalidate(); });
  pickLink(); setChip(); setOverload(history.now());
  return { destroy() { u1(); u2(); u3(); u4(); clearTimeout(latchTimer); host.destroy(); container.textContent = ''; } };
}
