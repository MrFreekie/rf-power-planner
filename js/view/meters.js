// RF level and virtual audio meters for the active link, with peak hold, threshold tick and MUTE chip.
import { createCanvasHost, activeLink, setFont, haloText } from './util.js';
import { history } from '../history.js';
import { squelch } from '../squelchTracker.js';
import { formatPower } from '../model/units.js';
import { rxState, rxConfig } from '../rxTracker.js';
import { setSquelchThreshold, SQUELCH_RANGE_DBM } from '../actions.js';

const LATCH_S = 2.5;

export const RF_RANGE = { min: -120, max: 0 }; // matches the squelch slider range (SQUELCH_RANGE_DBM), so a -120 dBm threshold and a transmitter-off noise floor stay on the scale
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

// ---- vertical layout and the squelch marker mapping (pure) ------------------------------------------------------------------

/** Vertical bar area inside a canvas of height h: room above for the label and value, below for the baseline. */
export function barArea(h) { const top = 38, bottom = Math.max(top + 20, h - 6); return { top, bottom }; }

/** y (px) of a level on a vertical meter: min at the bottom, max at the top. Pure. */
export function yForDbm(dbm, range, top, bottom) { return bottom - frac(dbm, range) * (bottom - top); }

/** Level (dBm) under a pointer at y, snapped to 1 dB and clamped to the squelch range. Pure. */
export function dbmForY(y, range, top, bottom) {
  const f = Math.min(1, Math.max(0, (bottom - y) / Math.max(1, bottom - top)));
  const v = Math.round(range.min + f * (range.max - range.min));
  return Math.min(SQUELCH_RANGE_DBM.max, Math.max(SQUELCH_RANGE_DBM.min, v));
}

/** Keyboard step for the squelch slider: arrows 1 dB (Shift 5 dB), Page keys 5 dB, Home and End the range ends. Returns the new dBm or null. Pure. */
export function squelchKeyStep(v, key, shift = false) {
  const cur = Number.isFinite(v) ? v : -90, big = shift ? 5 : 1;
  const clampV = (x) => Math.min(SQUELCH_RANGE_DBM.max, Math.max(SQUELCH_RANGE_DBM.min, Math.round(x)));
  switch (key) {
    case 'ArrowUp': case 'ArrowRight': return clampV(cur + big);
    case 'ArrowDown': case 'ArrowLeft': return clampV(cur - big);
    case 'PageUp': return clampV(cur + 5);
    case 'PageDown': return clampV(cur - 5);
    case 'Home': return SQUELCH_RANGE_DBM.min;
    case 'End': return SQUELCH_RANGE_DBM.max;
    default: return null;
  }
}

/** Which vertical bars to draw, left to right, from the latest history sample. Pure. */
export function barList(last) {
  const bars = [{ id: 'rf', label: 'RF' }, { id: 'audio', label: 'Audio' }];
  if (last && Number.isFinite(last.bDbm)) bars.push({ id: 'a', label: 'A' }, { id: 'b', label: 'B' });
  if (last && Number.isFinite(last.batteryPercent)) bars.push({ id: 'batt', label: 'Batt' });
  return bars;
}

/** Column x positions: a left gutter for the RF scale, then equal columns. Pure. */
export function barColumns(w, n, gutter = 30) {
  const step = Math.floor((w - gutter - 4) / Math.max(1, n));
  const colW = Math.max(14, Math.min(40, step - 6));
  return Array.from({ length: n }, (_, i) => ({ x: gutter + i * step + Math.floor((step - colW) / 2), w: colW }));
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
  head.append(h2, chip);
  const wrap = document.createElement('div');
  wrap.className = 'meters-wrap';
  const canvas = document.createElement('canvas');
  canvas.className = 'meters-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'RF level and audio level meters');
  // draggable squelch marker on the RF bar: a real slider element so keyboard and screen readers work
  const sqH = document.createElement('div');
  sqH.className = 'meters-sq'; sqH.tabIndex = 0; sqH.setAttribute('role', 'slider');
  sqH.setAttribute('aria-orientation', 'vertical'); sqH.setAttribute('aria-label', 'Squelch threshold');
  sqH.setAttribute('aria-valuemin', String(SQUELCH_RANGE_DBM.min)); sqH.setAttribute('aria-valuemax', String(SQUELCH_RANGE_DBM.max));
  sqH.title = 'Squelch threshold: drag, or use the arrow keys (Shift for 5 dB)';
  wrap.append(canvas, sqH);
  const ovLed = document.createElement('span');
  ovLed.className = 'chip chip-overload'; ovLed.textContent = 'RF OVERLOAD'; ovLed.hidden = true; ovLed.setAttribute('role', 'status');
  head.append(ovLed);
  const ovText = document.createElement('p');
  ovText.className = 'hint meters-ov';
  container.append(head, wrap, ovText);
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

  let geom = null; // { top, bottom, cols } of the last draw, used to place the squelch marker
  function placeSq() {
    const on = !!link && link.rx.squelch?.enabled !== false && geom;
    sqH.hidden = !on;
    if (!on) return;
    const thr = link.rx.squelch.thresholdDbm;
    const col = geom.cols[0], y = yForDbm(thr, RF_RANGE, geom.top, geom.bottom);
    sqH.style.left = `${col.x - 4}px`; sqH.style.width = `${col.w + 8}px`; sqH.style.top = `${Math.round(y) - 12}px`;
    sqH.setAttribute('aria-valuenow', String(Math.round(thr)));
    sqH.setAttribute('aria-valuetext', `${formatPower(thr, unit)}`);
  }

  function draw(ctx, w, h, th) {
    if (!link) return;
    const open = last ? last.open : true;
    const { top, bottom } = barArea(h);
    const bars = barList(last);
    const cols = barColumns(w, bars.length);
    geom = { top, bottom, cols };
    const rfV = last ? last.rfDbm : NaN, aV = last ? last.audioDb : NaN;
    const thr = link.rx.squelch?.enabled === false ? null : link.rx.squelch?.thresholdDbm;
    const oc = rxConfig(link);
    const ovPoint = Math.min(oc.p1dBDbm, oc.maxInputDbm);
    const zones = [[oc.p1dBDbm - (oc.hotMarginDb ?? 10), ovPoint, th.marginal], [ovPoint, RF_RANGE.max, th.fail]];
    // RF scale in the gutter
    setFont(ctx, th, 11); ctx.fillStyle = th.inkSoft; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = RF_RANGE.min + 10; v <= RF_RANGE.max; v += 20) {
      const y = Math.round(yForDbm(v, RF_RANGE, top, bottom)) + 0.5;
      ctx.strokeStyle = th.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(28, y); ctx.lineTo(w - 2, y); ctx.stroke();
      ctx.fillText(String(v), 26, y);
    }
    ctx.textBaseline = 'alphabetic';
    const bar = (col, rng, value, peak, color, zs) => {
      ctx.fillStyle = th.paper2; ctx.fillRect(col.x, top, col.w, bottom - top);
      if (zs) for (const [lo, hi, c] of zs) {
        const ya = yForDbm(hi, rng, top, bottom), yb = yForDbm(lo, rng, top, bottom);
        ctx.fillStyle = c; ctx.globalAlpha = 0.28; ctx.fillRect(col.x, ya, col.w, yb - ya); ctx.globalAlpha = 1;
      }
      const yv = yForDbm(value, rng, top, bottom);
      if (Number.isFinite(value)) { ctx.fillStyle = color; ctx.fillRect(col.x, yv, col.w, bottom - yv); }
      ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(col.x + 0.5, top + 0.5, col.w - 1, bottom - top - 1);
      if (peak && Number.isFinite(peak.v)) {
        const py = Math.round(yForDbm(peak.v, rng, top, bottom)) + 0.5;
        ctx.strokeStyle = th.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(col.x - 2, py); ctx.lineTo(col.x + col.w + 2, py); ctx.stroke();
      }
    };
    const text = (col, label, val) => {
      const cx = col.x + col.w / 2;
      setFont(ctx, th, 12, '600'); ctx.fillStyle = th.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(label, cx, 14);
      setFont(ctx, th, 12); ctx.fillStyle = th.inkSoft; ctx.fillText(val, cx, 30);
    };
    bars.forEach((b, i) => {
      const col = cols[i];
      if (b.id === 'rf') {
        bar(col, RF_RANGE, rfV, rf, open ? th.pass : th.fail, zones);
        text(col, 'RF', Number.isFinite(rfV) ? String(Math.round(rfV)) : '-');
        if (thr != null && Number.isFinite(thr)) { // squelch tick (the draggable slider sits on top of it)
          const y = Math.round(yForDbm(thr, RF_RANGE, top, bottom)) + 0.5;
          ctx.save(); ctx.strokeStyle = th.fail; ctx.lineWidth = 2; ctx.setLineDash([4, 2]);
          ctx.beginPath(); ctx.moveTo(col.x - 4, y); ctx.lineTo(col.x + col.w + 4, y); ctx.stroke(); ctx.restore();
          ctx.fillStyle = th.fail; ctx.beginPath(); ctx.moveTo(col.x + col.w + 4, y); ctx.lineTo(col.x + col.w + 10, y - 4); ctx.lineTo(col.x + col.w + 10, y + 4); ctx.closePath(); ctx.fill();
        }
      } else if (b.id === 'audio') {
        bar(col, AUDIO_RANGE, aV, au, th.ink);
        text(col, 'Audio', last && !last.open ? 'mute' : Number.isFinite(aV) ? String(Math.round(aV)) : '-');
      } else if (b.id === 'a' || b.id === 'b') {
        const v = b.id === 'a' ? last.aDbm : last.bDbm, act = last.active === b.id.toUpperCase();
        bar(col, RF_RANGE, v, null, th.blue);
        if (act) { ctx.strokeStyle = th.ink; ctx.lineWidth = 3; ctx.strokeRect(col.x - 1, top - 1, col.w + 2, bottom - top + 2); }
        text(col, act ? `${b.label}*` : b.label, Number.isFinite(v) ? String(Math.round(v)) : '-');
      } else {
        bar(col, { min: 0, max: 100 }, last.batteryPercent, null, last.batteryPercent < 15 ? th.fail : th.pass);
        text(col, 'Batt', `${Math.round(last.batteryPercent)}%`);
      }
    });
    const ifr = link.interferer && link.interferer.enabled ? link.interferer : null;
    if (ifr && Number.isFinite(ifr.levelDbm)) { // stray carrier tick on the RF bar
      const y = Math.round(yForDbm(ifr.levelDbm, RF_RANGE, top, bottom)) + 0.5;
      ctx.save(); ctx.strokeStyle = th.warnText; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cols[0].x, y); ctx.lineTo(cols[0].x + cols[0].w, y); ctx.stroke(); ctx.restore();
    }
    const sum = `RF ${Number.isFinite(rfV) ? formatPower(rfV, unit) : 'no signal'}${thr != null ? `, squelch ${formatPower(thr, unit)}` : ', squelch off'}; audio ${open && Number.isFinite(aV) ? aV.toFixed(0) + ' dBFS' : 'muted'}${bars.some((x) => x.id === 'a') ? `; diversity A ${Math.round(last.aDbm)}, B ${Math.round(last.bDbm)}, antenna ${last.active} active` : ''}${bars.some((x) => x.id === 'batt') ? `; battery ${Math.round(last.batteryPercent)} percent` : ''}.`;
    if (sum !== lastSum) { lastSum = sum; canvas.setAttribute('aria-label', 'Vertical meters. ' + sum); }
    placeSq();
  }
  let lastSum = '';

  // squelch marker: pointer drag (one undo step per drag) and keyboard
  let dragKey = null;
  const sqY = (e) => { const r = canvas.getBoundingClientRect(); return e.clientY - r.top; };
  sqH.addEventListener('pointerdown', (e) => {
    if (!link || !geom) return;
    if (sqH.setPointerCapture) sqH.setPointerCapture(e.pointerId);
    dragKey = `squelch-drag-${Date.now()}`; e.preventDefault(); sqH.focus();
  });
  sqH.addEventListener('pointermove', (e) => {
    if (!dragKey || !link || !geom) return;
    setSquelchThreshold(store, link.id, dbmForY(sqY(e), RF_RANGE, geom.top, geom.bottom), { coalesce: dragKey });
  });
  const endDrag = () => { dragKey = null; };
  sqH.addEventListener('pointerup', endDrag); sqH.addEventListener('pointercancel', endDrag);
  sqH.addEventListener('keydown', (e) => {
    if (!link) return;
    const v = squelchKeyStep(link.rx.squelch?.thresholdDbm, e.key, e.shiftKey);
    if (v === null) return;
    e.preventDefault();
    setSquelchThreshold(store, link.id, v, { coalesce: `squelch-key-${link.id}` });
  });

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
