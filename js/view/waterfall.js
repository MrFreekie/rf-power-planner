// Power-budget waterfall for the selected link, drawn on a HiDPI canvas with a table underneath.
// One row per stage: label and level on a text line, a floating bar below it. Losses are hatched
// grey, gains are solid grey, the final row (receiver input) carries the pass/marginal/fail colour.
import { createCanvasHost, activeLink, solveCached, statusColor, setFont, strokeHatchRect, readTheme } from './util.js';
import { formatPower, dbmToUnit } from '../model/units.js';
import { squelch } from '../squelchTracker.js';
import { solveDiversity } from '../model/diversity.js';
import { registerSnapshot, makeSnapshotCanvas } from './snapshots.js';
import { rxState, rxConfig } from '../rxTracker.js';

const ROW_H = 44;
const TOP = 26;
const BOTTOM = 66;
const PAD_L = 10;
const PAD_R = 12;

/** Round-number axis range (dBm) that covers every stage level and the sensitivity. Pure. */
export function waterfallScale(stages, sensitivityDbm) {
  const vals = stages.map((s) => s.valueDbm).filter(Number.isFinite);
  if (Number.isFinite(sensitivityDbm)) vals.push(sensitivityDbm);
  if (!vals.length) return { min: -100, max: 20, step: 20 };
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(hi - lo, 10);
  const step = span > 100 ? 20 : span > 40 ? 10 : 5;
  return { min: Math.floor((lo - 3) / step) * step, max: Math.ceil((hi + 3) / step) * step, step };
}

/** Axis tick text in the scene's power unit. Pure. */
export function tickLabel(dbm, unit = 'dBm') {
  if (unit === 'mW') {
    const mw = Math.pow(10, dbm / 10);
    if (mw >= 1000) return `${+(mw / 1000).toPrecision(2)} W`;
    if (mw >= 1) return `${+mw.toPrecision(3)} mW`;
    if (mw >= 0.001) return `${+(mw * 1000).toPrecision(3)} µW`;
    if (mw >= 1e-6) return `${+(mw * 1e6).toPrecision(3)} nW`;
    return `${+(mw * 1e9).toPrecision(3)} pW`;
  }
  return String(Math.round(dbmToUnit(dbm, unit) * 10) / 10);
}

/** Signed delta text with a real minus sign, e.g. "+3.0 dB". Pure. */
export function deltaText(db) {
  if (!Number.isFinite(db)) return '-';
  return `${db >= 0 ? '+' : '−'}${Math.abs(db).toFixed(1)} dB`;
}

/** Shorten text with an ellipsis so it fits maxPx according to measure(text). */
export function fitText(text, maxPx, measure) {
  if (measure(text) <= maxPx) return text;
  let s = text;
  while (s.length > 1 && measure(s + '…') > maxPx) s = s.slice(0, -1);
  return s + '…';
}

/** Build the rows drawn and tabulated: the solver stages plus a final "Receiver input" row. Pure. */
export function buildRows(result, sensitivityDbm) {
  const wf = result.waterfall || [];
  const rows = wf.map((s, i) => ({
    label: s.label, valueDbm: s.valueDbm, deltaDb: s.deltaDb,
    type: i === 0 ? 'start' : s.deltaDb < 0 ? 'loss' : s.deltaDb > 0 ? 'gain' : 'zero',
  }));
  rows.push({
    label: 'Receiver input', valueDbm: result.inputPowerDbm, deltaDb: null, type: 'end',
    marginDb: result.marginDb, status: result.status, sensitivityDbm,
  });
  return rows;
}

export function mountWaterfall({ container, store }) {
  container.classList.add('waterfall');
  container.innerHTML = '';
  const title = document.createElement('h2');
  title.textContent = 'Power budget';
  const wrap = document.createElement('div');
  wrap.className = 'wf-canvas-wrap';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  wrap.append(canvas);
  const summary = document.createElement('p');
  summary.className = 'wf-summary';
  const table = document.createElement('table');
  table.className = 'wf-table';
  table.innerHTML = '<caption class="sr-only">Power budget stages</caption><thead><tr><th scope="col">Stage</th><th scope="col" class="num">Level</th><th scope="col" class="num">Change</th></tr></thead><tbody></tbody>';
  const tbody = table.querySelector('tbody');
  // noise-figure cascade (shown when the solver provides it)
  const nfBox = document.createElement('div');
  nfBox.className = 'wf-nf';
  nfBox.hidden = true;
  const nfHead = document.createElement('div');
  nfHead.className = 'wf-nf-head';
  const nfChip = document.createElement('span');
  nfChip.className = 'chip wf-nf-chip';
  const nfSens = document.createElement('span');
  nfSens.className = 'wf-nf-sens';
  nfHead.append(nfChip, nfSens);
  const nfTable = document.createElement('table');
  nfTable.className = 'wf-table wf-nf-table';
  nfTable.innerHTML = '<caption class="sr-only">Noise figure cascade</caption><thead><tr><th scope="col">Stage</th><th scope="col" class="num">Gain</th><th scope="col" class="num">NF</th><th scope="col" class="num">Cum. NF</th></tr></thead><tbody></tbody>';
  const nfBody = nfTable.querySelector('tbody');
  const nfNote = document.createElement('p');
  nfNote.className = 'hint wf-nf-note';
  nfBox.append(nfHead, nfTable, nfNote);
  // antenna A/B selector (only when receive diversity is on)
  const abRow = document.createElement('div');
  abRow.className = 'group wf-ab';
  abRow.setAttribute('role', 'group');
  abRow.setAttribute('aria-label', 'Receive antenna shown in the budget');
  abRow.hidden = true;
  const abBtns = ['A', 'B'].map((k) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = `Antenna ${k}`; b.setAttribute('aria-pressed', String(k === 'A'));
    b.addEventListener('click', () => { ant = k; refresh(); });
    abRow.append(b);
    return [k, b];
  });
  let ant = 'A';
  container.append(title, abRow, wrap, summary, table, nfBox);

  let rows = [];
  let sens = NaN;
  let unit = 'dBm';
  let status = null;
  let ovl = null; // { p1dBDbm, level }
  let sq = null; // { thresholdDbm, open } when the squelch is enabled

  function draw(ctx, w, h, th) {
    if (!rows.length) return;
    const { min, max, step } = waterfallScale(rows, Math.min(sq ? Math.min(sens, sq.thresholdDbm) : sens, ovl ? ovl.p1dBDbm : Infinity));
    const x0 = PAD_L, x1 = w - PAD_R;
    const X = (dbm) => x0 + ((dbm - min) / (max - min)) * (x1 - x0);
    const plotBottom = TOP + rows.length * ROW_H;

    // vertical grid and axis ticks
    setFont(ctx, th, 11);
    ctx.textBaseline = 'alphabetic';
    const tickEvery = (x1 - x0) / ((max - min) / step) < 52 ? 2 : 1;
    for (let v = min, i = 0; v <= max + 1e-9; v += step, i++) {
      const x = Math.round(X(v)) + 0.5;
      ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, TOP - 4); ctx.lineTo(x, plotBottom); ctx.stroke();
      if (i % tickEvery === 0) {
        ctx.fillStyle = th.inkSoft;
        ctx.textAlign = i === 0 ? 'left' : v >= max - 1e-9 ? 'right' : 'center';
        ctx.fillText(tickLabel(v, unit), x, TOP - 9);
      }
    }

    let prevEnd = null;
    rows.forEach((r, i) => {
      const y = TOP + i * ROW_H;
      const barY = y + 24, barH = 12;
      const isEnd = r.type === 'end';
      const level = r.valueDbm;
      const from = r.type === 'start' || isEnd ? min : prevEnd;
      const xa = X(Math.min(from, level)), xb = X(Math.max(from, level));
      const bw = Math.max(xb - xa, 2);

      // text line: label left (ellipsised), level right
      const levelTxt = formatPower(level, unit) + (r.deltaDb ? '  ' + deltaText(r.deltaDb) : '');
      setFont(ctx, th, 12, isEnd ? '600' : '');
      const levelW = ctx.measureText(levelTxt).width;
      const labelTxt = fitText(r.label, Math.max(40, x1 - x0 - levelW - 12), (t) => ctx.measureText(t).width);
      ctx.textBaseline = 'alphabetic';
      ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = th.paper;
      ctx.textAlign = 'left';
      ctx.strokeText(labelTxt, x0, y + 13);
      ctx.fillStyle = th.ink;
      ctx.fillText(labelTxt, x0, y + 13);
      ctx.textAlign = 'right';
      ctx.strokeText(levelTxt, x1, y + 13);
      ctx.fillStyle = isEnd ? statusColor(th, r.status) : th.ink;
      ctx.fillText(levelTxt, x1, y + 13);

      // bar
      if (isEnd) {
        ctx.fillStyle = statusColor(th, r.status);
        ctx.fillRect(xa, barY, bw, barH);
      } else if (r.type === 'start') {
        ctx.fillStyle = th.ink;
        ctx.fillRect(xa, barY, bw, barH);
      } else if (r.type === 'gain') {
        ctx.fillStyle = th.inkSoft;
        ctx.fillRect(xa, barY, bw, barH);
      } else {
        ctx.fillStyle = th.paper2;
        ctx.fillRect(xa, barY, bw, barH);
        strokeHatchRect(ctx, xa, barY, bw, barH, th.inkSoft, 4);
      }
      ctx.strokeStyle = th.ink; ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(xa) + 0.5, barY + 0.5, Math.max(bw - 1, 1), barH - 1);

      // connector from the end of this step to the next row
      if (i < rows.length - 1 && !isEnd) {
        const cx = Math.round(X(level)) + 0.5;
        ctx.strokeStyle = th.inkSoft; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.moveTo(cx, barY + barH); ctx.lineTo(cx, y + ROW_H + 24); ctx.stroke();
        ctx.setLineDash([]);
      }
      prevEnd = level;
    });

    // sensitivity line
    if (Number.isFinite(sens)) {
      const sx = Math.round(X(sens)) + 0.5;
      ctx.strokeStyle = th.ink; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(sx, TOP - 4); ctx.lineTo(sx, plotBottom + 4); ctx.stroke();
      ctx.setLineDash([]);
      const end = rows[rows.length - 1];
      const txt = `Sensitivity ${formatPower(sens, unit)}   Margin ${deltaText(end.marginDb)} (${String(end.status).toUpperCase()})`;
      setFont(ctx, th, 12, '600');
      const tw = ctx.measureText(txt).width;
      const tx = Math.min(Math.max(sx - tw / 2, x0), x1 - tw);
      ctx.fillStyle = statusColor(th, end.status);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(txt, tx, plotBottom + 18);
    }

    if (ovl) {
      const ox = Math.round(X(ovl.p1dBDbm)) + 0.5;
      const col = ovl.level === 'ok' ? th.inkSoft : ovl.level === 'hot' ? th.marginal : th.fail;
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash([10, 3, 2, 3]);
      ctx.beginPath(); ctx.moveTo(ox, TOP - 4); ctx.lineTo(ox, plotBottom + 4); ctx.stroke(); ctx.setLineDash([]);
      const ot = `P1dB ${formatPower(ovl.p1dBDbm, unit)}${ovl.level === 'ok' ? '' : ovl.level === 'hot' ? ' (HOT)' : ' (OVERLOAD)'}`;
      setFont(ctx, th, 12, '600'); const ow = ctx.measureText(ot).width;
      ctx.fillStyle = ovl.level === 'ok' ? th.inkSoft : ovl.level === 'hot' ? '#8a6200' : th.fail; ctx.textAlign = 'left';
      ctx.fillText(ot, Math.min(Math.max(ox - ow / 2, x0), x1 - ow), plotBottom + 54);
    }
    if (sq) {
      const qx = Math.round(X(sq.thresholdDbm)) + 0.5;
      const col = sq.open ? th.pass : th.fail;
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(qx, TOP - 4); ctx.lineTo(qx, plotBottom + 4); ctx.stroke();
      ctx.setLineDash([]);
      const qt = `Squelch ${formatPower(sq.thresholdDbm, unit)} (${sq.open ? 'open' : 'MUTE'})`;
      setFont(ctx, th, 12, '600');
      const qw = ctx.measureText(qt).width;
      ctx.fillStyle = col; ctx.textAlign = 'left';
      ctx.fillText(qt, Math.min(Math.max(qx - qw / 2, x0), x1 - qw), plotBottom + 36);
    }
  }

  const host = createCanvasHost(canvas, draw);
  const unregSnap = registerSnapshot('waterfall', (w) => {
    if (!rows.length) return null;
    const h = TOP + rows.length * ROW_H + BOTTOM;
    const { c, ctx } = makeSnapshotCanvas(w, h);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    draw(ctx, w, h, readTheme(canvas));
    return c;
  });

  function refresh() {
    const scene = store.getScene();
    const link = activeLink(scene, store.getSelection());
    const dvOn = !!(link && link.kind !== 'iem' && link.rx.diversity && link.rx.diversity.enabled && link.rx.diversity.antennaB);
    if (!dvOn) ant = 'A';
    abRow.hidden = !dvOn;
    abBtns.forEach(([k, b]) => b.setAttribute('aria-pressed', String(k === ant)));
    let result = link ? solveCached(scene, link) : null;
    let viewLink = link;
    if (dvOn && ant === 'B') {
      try { result = solveDiversity(scene, link).b; } catch { result = null; }
      const bc = link.rx.diversity.antennaB.chain;
      if (Array.isArray(bc)) viewLink = { ...link, chain: bc };
    }
    unit = scene.units?.power || 'dBm';
    if (!link || !result) {
      rows = []; sens = NaN; status = null; sq = null; ovl = null;
      tbody.innerHTML = '';
      summary.textContent = link ? 'Could not solve this link.' : 'No link in the scene.';
      canvas.style.height = '40px';
      canvas.setAttribute('aria-label', 'Power budget unavailable');
      host.invalidate();
      return;
    }
    sens = link.rx.sensitivityDbm;
    const oc = rxConfig(link), rs = rxState.get(link.id);
    ovl = { p1dBDbm: oc.p1dBDbm, level: rs ? rs.overload.level : 'ok' };
    const q = link.rx.squelch;
    const g = squelch.get(link.id);
    sq = q && q.enabled !== false && Number.isFinite(q.thresholdDbm) ? { thresholdDbm: q.thresholdDbm, open: g ? g.open : true } : null;
    rows = buildRows(result, sens);
    status = result.status;
    canvas.style.height = `${TOP + rows.length * ROW_H + BOTTOM}px`;
    const msg = `${link.name}${dvOn ? ` (antenna ${ant})` : ''}: input ${formatPower(result.inputPowerDbm, unit)}, sensitivity ${formatPower(sens, unit)}, margin ${deltaText(result.marginDb)}, ${result.status}.`;
    summary.textContent = msg + (ovl.level === 'overload' ? ' RF OVERLOAD: receiver input above P1dB.' : ovl.level === 'hot' ? ' Receiver input is HOT (close to P1dB).' : '');
    summary.dataset.status = status;
    canvas.setAttribute('aria-label', `Power budget waterfall. ${msg}`);

    renderNf(result, viewLink);
    tbody.textContent = '';
    for (const r of rows) {
      const tr = document.createElement('tr');
      const a = document.createElement('td'); a.textContent = r.label;
      const b = document.createElement('td'); b.className = 'num'; b.textContent = formatPower(r.valueDbm, unit);
      const c = document.createElement('td'); c.className = 'num';
      c.textContent = r.type === 'end' ? `margin ${deltaText(r.marginDb)}` : r.type === 'start' ? '' : deltaText(r.deltaDb);
      tr.append(a, b, c);
      if (r.type === 'end') { tr.className = 'wf-end'; tr.dataset.status = r.status; }
      tbody.append(tr);
    }
    host.invalidate();
  }

  function renderNf(result, link) {
    const c = result && result.cascade;
    nfBox.hidden = !c || !Array.isArray(c.stages) || !c.stages.length;
    if (nfBox.hidden) return;
    const f1 = (v) => `${v < 0 ? '\u2212' : ''}${Math.abs(v).toFixed(1)}`;
    nfChip.textContent = `System NF ${c.systemNfDb.toFixed(1)} dB`;
    nfSens.textContent = `Sensitivity at the antenna terminals ${formatPower(c.sensitivityAtAntennaDbm, unit)} (noise floor ${formatPower(c.noiseFloorDbm, unit)})`;
    nfBody.textContent = '';
    for (const s of c.stages) {
      const tr = document.createElement('tr');
      const cells = [s.label, `${f1(s.gainDb)} dB`, `${s.nfDb.toFixed(1)} dB`, `${s.cumulativeNfDb.toFixed(1)} dB`];
      cells.forEach((t, i) => { const td = document.createElement('td'); if (i) td.className = 'num'; td.textContent = t; tr.append(td); });
      nfBody.append(tr);
    }
    // booster placement note
    const chain = link.chain || [];
    const bi = chain.findIndex((x) => x.kind === 'booster');
    let note = '';
    if (bi >= 0 && link.kind !== 'iem') {
      const before = bi > 0 ? -c.stages[bi - 1].cumulativeGainDb : 0;
      note = before >= 1
        ? `The booster sits after ${before.toFixed(1)} dB of cable and other loss, and that loss adds straight onto the system noise figure. A booster at the antenna end (before the cable) would hide it.`
        : 'The booster is at the antenna end: its low noise figure sets the system noise figure and the cable loss after it matters much less.';
    }
    nfNote.textContent = note;
    nfNote.hidden = !note;
  }

  const unsubSq = squelch.subscribe(() => refresh());
  const unsubRx = rxState.subscribe(() => refresh());
  const unsub = store.subscribe(() => refresh());
  refresh();
  return { refresh, destroy() { unregSnap(); unsub(); unsubSq(); unsubRx(); host.destroy(); container.innerHTML = ''; } };
}
