// Coordination lab pop-out (item 29): a frequency line with draggable channel markers, third-order product markers with live hit counts,
// an equal-spacing "bad plan" example, a best-plan search with apply-to-project, and a candidate table with reasons.
// Pure helpers (labBands, workFromScene, labMetrics, nudge, candidateRows, applyAssignments, drawLab) are tested without a DOM;
// mountCoordLab() builds the dialog on createZoom. Planning estimates only: nothing here is a licence or a measurement.
import { createCanvasHost, setFont, haloText, inkAlpha, strokeHatchRect } from './util.js';
import { createZoom } from './spectraZoom.js';
import { packLanes, ILLUSTRATIVE } from './spectrumMap.js';
export { ILLUSTRATIVE };
import { productFrequencies } from '../model/imd.js';
import { planHits, equalSpacingPlan, candidateFrequencies, evaluateCandidates, bestCandidates, bestPlan, failureSummary, tvOccupiedBlocked } from '../model/coord-lab.js';
import { projectFrequencies, tvWidthOf, simulatedOccupancy, hashSeed } from '../model/spectrum-map.js';
import { applyFrequencyPlan } from '../actionsAreas.js';

export const GUARD_KHZ = 400, SPACING_KHZ = 300, SNAP_KHZ = 25, MAX_ITEMS = 16, MARGIN = 28;
export const REASON_NAMES = Object.freeze({ blocked: 'blocked range', duplicate: 'same as a channel', spacing: 'too close to a channel', 'product-on-candidate': 'product lands on it', 'product-on-fixed': 'makes a product on a channel' });
export const BANDS = Object.freeze([
  { id: 'ch38', label: 'UK channel 38, 606-614 MHz', startMHz: 606, endMHz: 614, regionId: 'uk' },
  { id: 'uk-lo', label: 'UK UHF 470-606 MHz', startMHz: 470, endMHz: 606, regionId: 'uk' },
  { id: 'uk-hi', label: 'UK UHF 614-694 MHz', startMHz: 614, endMHz: 694, regionId: 'uk' },
  { id: 'us-lo', label: 'US TV channels 14-36, 470-608 MHz', startMHz: 470, endMHz: 608, regionId: 'us' },
]);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const snap = (f) => r6(Math.round((f * 1000) / SNAP_KHZ) * SNAP_KHZ / 1000);

/** Items of the working set from the project: links and Intermod transmitters with a frequency. */
export function workFromScene(scene) {
  const out = []; let n = 0;
  for (const p of projectFrequencies(scene || {})) {
    if (p.source === 'noise' || out.length >= MAX_ITEMS) continue;
    out.push({ key: `w${n++}`, id: p.id, name: p.name, kind: p.kind === 'iem' ? 'iem' : 'mic', freqMHz: p.freqMHz, locked: false });
  }
  return out;
}
/** The bands the picker offers, plus "From project" (the span of the working frequencies padded by 1 MHz, at least 8 MHz wide) when there are some. */
export function labBands(items, scene) {
  const out = BANDS.map((b) => ({ ...b }));
  const fs = (items || []).map((i) => i.freqMHz).filter(Number.isFinite);
  if (fs.length) {
    let lo = Math.floor(Math.min(...fs) - 1), hi = Math.ceil(Math.max(...fs) + 1);
    if (hi - lo < 8) { const c = (lo + hi) / 2; lo = Math.floor(c - 4); hi = lo + 8; }
    out.unshift({ id: 'project', label: `From the project, ${lo}-${hi} MHz`, startMHz: lo, endMHz: hi, regionId: tvWidthOf(scene) === 6 ? 'us' : 'uk' });
  }
  return out;
}
/** Default band id: the project's span (widened to cover every channel, however far apart) when there are working frequencies, else UK channel 38. Never moves a channel. */
export function defaultBandId(items) {
  const fs = (items || []).map((i) => i.freqMHz).filter(Number.isFinite);
  return fs.length ? 'project' : 'ch38';
}
/** Move a frequency by deltaKHz, snapped to the raster and kept inside the band. */
export const nudge = (f, deltaKHz, band) => clamp(snap(f + deltaKHz / 1000), band.startMHz, band.endMHz);

/** Live numbers for a set of frequencies: planHits plus the third-order product list with a conflict flag (inside the guard of a channel). */
export function labMetrics(freqs, { guardKHz = GUARD_KHZ, minSpacingKHz = SPACING_KHZ } = {}) {
  const hits = planHits(freqs, { guardKHz, minSpacingKHz });
  const products = freqs.length >= 2 ? productFrequencies(freqs, [3]).map((p) => {
    let d = Infinity; for (const f of freqs) d = Math.min(d, Math.abs(p.fMHz - f) * 1000);
    return { fMHz: p.fMHz, label: p.label, tones: p.tones, nearestKHz: d, conflict: Math.round(d * 1e3) / 1e3 < guardKHz };
  }) : [];
  return { hits, products };
}
/** Occupancy-based blocked ranges (illustrative) for the region's TV raster. */
export function blockedFor(regionId, on) {
  if (!on) return { blocked: [], setting: null };
  const setting = regionId === 'us' ? 'us-top10' : 'uk-city';
  return { blocked: tvOccupiedBlocked(simulatedOccupancy(setting, hashSeed('map')).channels), setting };
}

/**
 * candidateRows(items, selKey, band, blocked, regionId) -> { best: rows, rejected: rows (one example per reason), summary, thinned, tried }
 * Candidates are tried as one more channel next to every item except the selected one.
 */
export function candidateRows(items, selKey, band, blocked, regionId) {
  const fixed = items.filter((i) => i.key !== selKey).map((i) => ({ id: i.name, freqMHz: i.freqMHz }));
  const cand = candidateFrequencies({ regionId, band: [{ startMHz: band.startMHz, endMHz: band.endMHz }], blocked, maxCandidates: 400, ignoreRegionBlocked: false });
  const rows = evaluateCandidates({ fixed, candidatesMHz: cand.frequenciesMHz, guardKHz: GUARD_KHZ, minSpacingKHz: SPACING_KHZ, blocked });
  const rejected = [], seen = new Set();
  for (const r of rows) if (!r.ok) { const c = r.reasons[0].code; if (!seen.has(c)) { seen.add(c); rejected.push(r); } }
  for (const r of rows) if (!r.ok && rejected.length < 10 && !rejected.includes(r) && rejected.length < seen.size + 4) rejected.push(r);
  return { best: bestCandidates(rows, 8), rejected, summary: failureSummary(rows), thinned: cand.thinned, tried: rows.length, blockedCount: cand.blockedCount, fixedCount: fixed.length };
}
export function summaryText(sum) {
  const parts = Object.entries(sum.byReason).map(([k, v]) => `${REASON_NAMES[k] || k}: ${v}`);
  return `${sum.total} candidate channels tried, ${sum.ok} clear.${parts.length ? ` Rejected because (a channel can have several reasons): ${parts.join(', ')}.` : ''}`;
}

/** Re-plan the unlocked items with bestPlan. Returns { items (new array), ok, message, result }. Items without a result frequency keep theirs. */
export function planItems(items, band, blocked, seed, tries = 4) {
  const locked = items.filter((i) => i.locked);
  const freeMics = items.filter((i) => !i.locked && i.kind === 'mic'), freeIems = items.filter((i) => !i.locked && i.kind === 'iem');
  let res = null;
  for (let t = 0; t < Math.max(1, tries); t++) { res = bestPlan({ fixed: locked.map((i) => ({ id: i.key, name: i.name, kind: i.kind, freqMHz: i.freqMHz })), mics: freeMics.length, iems: freeIems.length, regionId: band.regionId, band: [{ startMHz: band.startMHz, endMHz: band.endMHz }], blocked, seed: seed + t }); if (res.ok) break; }
  const q = { mic: res.frequencies.filter((f) => !f.locked && f.kind === 'mic'), iem: res.frequencies.filter((f) => !f.locked && f.kind === 'iem') };
  const out = items.map((i) => {
    if (i.locked) return { ...i };
    const r = q[i.kind].shift();
    return r && r.freqMHz !== null ? { ...i, freqMHz: r.freqMHz } : { ...i };
  });
  return { items: out, ok: !!res.ok, message: res.ok ? '' : (res.failure && res.failure.message) || 'No intermod-free plan was found in this band.', result: res };
}

// ------------------------------------------------------------------------------------------------ drawing
const Y = { hud: 16, markers: 30, line: 118, products: 134, blocked: 200, h: 232 };
/** Layout: x of a frequency and the marker label lanes. */
export function layoutLab(items, band, w, blockedRanges) {
  const span = band.endMHz - band.startMHz, k = (Math.max(w, 320) - 2 * MARGIN) / span;
  const x = (f) => MARGIN + (f - band.startMHz) * k;
  const marks = items.map((it, i) => ({ it, i, px: x(it.freqMHz), label: `${it.name} ${+it.freqMHz.toFixed(3)}` }));
  for (let i = marks.length - 1; i >= 0; i--) if (marks[i].it.freqMHz < band.startMHz || marks[i].it.freqMHz > band.endMHz) marks.splice(i, 1); // channels outside this band are listed below, not drawn
  marks.forEach((m) => { m.x0 = m.px - 6; m.x1 = m.px + 8 + m.label.length * 6.4; });
  const lanes = packLanes(marks);
  return { x, k, marks, lanes, fOf: (px) => band.startMHz + (px - MARGIN) / k, width: Math.max(w, 320), blocked: blockedRanges };
}
export function tickStepMHz(k) { for (const s of [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20]) if (s * k >= 60) return s; return 20; }

export function drawLab(ctx, w, h, th, { items, band, metrics, blocked, sel, setting }) {
  const L = layoutLab(items, band, w, blocked);
  ctx.fillStyle = th.paper; ctx.fillRect(0, 0, w, h);
  const hh = metrics.hits;
  haloText(ctx, th, `Third-order hits: ${hh.hits2} (two-transmitter) + ${hh.hits3} (three-transmitter) = ${hh.hitsTotal}; spacing violations: ${hh.spacingViolations.length}`, 6, Y.hud, { px: 12, weight: 'bold', color: hh.ok ? th.pass : th.fail });
  // guard zones around channels
  for (const m of L.marks) { const a = L.x(m.it.freqMHz - GUARD_KHZ / 1000), b = L.x(m.it.freqMHz + GUARD_KHZ / 1000); ctx.fillStyle = inkAlpha(th, 0.08); ctx.fillRect(a, Y.line - 8, b - a, 16 + (Y.products - Y.line) + 24); }
  // axis
  ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(MARGIN, Y.line + 0.5); ctx.lineTo(L.x(band.endMHz), Y.line + 0.5); ctx.stroke();
  const step = tickStepMHz(L.k); ctx.fillStyle = th.inkSoft; setFont(ctx, th, 11); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let f = Math.ceil(band.startMHz / step) * step; f <= band.endMHz + 1e-9; f += step) { const px = L.x(f); ctx.beginPath(); ctx.moveTo(px, Y.line); ctx.lineTo(px, Y.line + 5); ctx.stroke(); ctx.fillText(`${+f.toFixed(3)}`, px, Y.line + 7); }
  // blocked ranges (TV occupancy, illustrative)
  const by = Y.blocked;
  ctx.fillStyle = th.inkSoft; setFont(ctx, th, 11); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(setting ? `Blocked: simulated TV occupancy (${ILLUSTRATIVE.toLowerCase()})` : 'Blocked ranges: TV occupancy off', 6, by - 3);
  for (const b of L.blocked) {
    const a = Math.max(L.x(Math.max(b.fromMHz, band.startMHz)), MARGIN), c = Math.min(L.x(Math.min(b.toMHz, band.endMHz)), L.x(band.endMHz));
    if (c <= a) continue;
    ctx.fillStyle = inkAlpha(th, 0.1); ctx.fillRect(a, by, c - a, 18); strokeHatchRect(ctx, a, by, c - a, 18, th.ink, 5); ctx.strokeStyle = th.inkSoft; ctx.strokeRect(a + 0.5, by + 0.5, c - a - 1, 17);
    if (c - a > 50) { ctx.fillStyle = th.ink; setFont(ctx, th, 11); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; haloText(ctx, th, b.label || 'blocked', (a + c) / 2, by + 9, { align: 'center', baseline: 'middle', px: 11 }); }
  }
  // products
  for (const p of metrics.products) {
    if (p.fMHz < band.startMHz || p.fMHz > band.endMHz) continue;
    const px = L.x(p.fMHz);
    ctx.strokeStyle = p.conflict ? th.fail : th.inkSoft; ctx.lineWidth = p.conflict ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(px, Y.products); ctx.lineTo(px, Y.products + (p.conflict ? 30 : 14)); ctx.stroke();
  }
  ctx.lineWidth = 1; ctx.fillStyle = th.inkSoft; setFont(ctx, th, 11); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('Third-order products (red: inside the 400 kHz guard of a channel)', 6, Y.products + 44);
  // markers
  for (const m of L.marks) {
    const lane = m.lane || 0, top = Y.markers + lane * 15, isSel = sel === m.it.key;
    ctx.strokeStyle = isSel ? th.ink : th.inkSoft; ctx.lineWidth = isSel ? 2 : 1.25;
    ctx.beginPath(); ctx.moveTo(m.px, top + 10); ctx.lineTo(m.px, Y.line); ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = m.it.kind === 'iem' ? th.blue : th.ink; ctx.beginPath(); ctx.moveTo(m.px, top + 11); ctx.lineTo(m.px - 5, top + 2); ctx.lineTo(m.px + 5, top + 2); ctx.closePath(); ctx.fill();
    if (isSel) { ctx.strokeStyle = th.ink; ctx.strokeRect(m.px - 7.5, top + 0.5, 15, 12); }
    haloText(ctx, th, `${m.it.locked ? '\u{1F512} ' : ''}${m.label}`, m.px + 8, top + 10, { px: 11 });
  }
  return L;
}

// ------------------------------------------------------------------------------------------------ DOM
export function mountCoordLab({ doc = document, button, store, hostFactory = (c, d) => createCanvasHost(c, d) } = {}) {
  const el = (tag, cls, text, attrs) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const st = { items: [], bandId: 'ch38', showOcc: true, sel: null, seed: 1, drag: null, status: '', cand: null, nextKey: 0, base: [] };
  let L = null, scroll = null, ro = null, candTimer = null;
  const bands = () => labBands(st.base, store.getScene());
  const band = () => bands().find((b) => b.id === st.bandId) || BANDS[0];
  // memoised: metrics by the frequency list, blocked ranges by region and occupancy switch (describe, draw and the live text all ask each frame)
  let mKey = null, mVal = null, bKey = null, bVal = null;
  const metrics = () => { const fs = st.items.map((i) => i.freqMHz), k = fs.join('|'); if (k !== mKey) { mKey = k; mVal = labMetrics(fs); } return mVal; };
  const blockedNow = () => { const k = `${band().regionId}|${st.showOcc}`; if (k !== bKey) { bKey = k; bVal = blockedFor(band().regionId, st.showOcc); } return bVal; };
  const cw = () => (scroll && scroll.clientWidth) || 800;

  const zoom = createZoom({
    doc, hostFactory: (canvas, d) => hostFactory(canvas, (ctx, w, h, th) => d(ctx, w, h, th)),
    describe: () => { const m = metrics(), hh = m.hits; return { title: 'Coordination lab', summary: `${st.items.length} channels in ${band().label}. ${hh.hitsTotal} third-order product${hh.hitsTotal === 1 ? '' : 's'} inside the guard of a channel (${hh.hits2} two-transmitter, ${hh.hits3} three-transmitter), ${hh.spacingViolations.length} spacing violation${hh.spacingViolations.length === 1 ? '' : 's'}. Planning estimate only.` }; },
    table: () => {
      const m = metrics();
      return { caption: 'Channels and third-order products in the lab', cols: ['Item', 'Frequency MHz', 'Note'], rows: [
        ...st.items.map((i) => [i.name, i.freqMHz.toFixed(3), `${i.kind}${i.locked ? ', kept' : ''}`]),
        ...m.products.filter((p) => p.conflict).map((p) => [`Product ${p.label}`, p.fMHz.toFixed(3), `${p.nearestKHz.toFixed(0)} kHz from a channel (inside the ${GUARD_KHZ} kHz guard)`]),
      ] };
    },
    draw: (id, ctx, w, h, th) => { L = drawLab(ctx, w, h, th, { items: st.items, band: band(), metrics: metrics(), blocked: blockedNow().blocked, sel: st.sel, setting: blockedNow().setting }); },
  });
  const dlg = zoom.dialog, canvas = zoom.canvas;
  dlg.className = `${dlg.className || ''} lab-dialog`.trim();
  canvas.className = 'lab-canvas';
  scroll = el('div', 'map-scroll', null, { tabindex: '-1' });
  const parent = canvas.parentNode;
  if (parent && parent.insertBefore) { parent.insertBefore(scroll, canvas); scroll.append(canvas); }

  // ---- controls
  const bar = el('div', 'map-bar');
  const bandSel = el('select', null, null, { 'aria-label': 'Band' });
  bandSel.addEventListener('change', () => { st.bandId = bandSel.value; st.sel = null; refresh(true); });
  const occLab = el('label'), occChk = el('input', null, null, { type: 'checkbox' });
  occLab.append(occChk, el('span', null, ` Block simulated TV occupancy (${ILLUSTRATIVE.toLowerCase()})`));
  occChk.addEventListener('change', () => { st.showOcc = !!occChk.checked; refresh(true); });
  const mk = (text, title, fn) => { const b = el('button', null, text, { type: 'button', title }); b.addEventListener('click', fn); return b; };
  const bEqual = mk('Equal spacing (bad example)', 'Put every channel on an equal 400 kHz grid, the textbook plan that makes products land on channels', () => {
    const b = band(), f = equalSpacingPlan(st.items.length, snap(b.startMHz + (b.endMHz - b.startMHz) / 2 - ((st.items.length - 1) * 0.4) / 2), 400);
    st.items.forEach((it, i) => { if (!it.locked) it.freqMHz = clamp(f[i], b.startMHz, b.endMHz); });
    st.status = 'Equal spacing applied in the lab only. Watch the hit count: equal spacing makes f1 + f3 - f2 land on a channel.'; refresh(true);
  });
  const bBest = mk('Best plan', 'Search for channels with no third-order product on any channel (kept channels stay put); press again for another plan', () => {
    const r = planItems(st.items, band(), blockedNow().blocked, st.seed++);
    st.items = r.items; st.seed += 4;
    st.status = r.ok ? `Best plan found: no third-order product lands on a channel. Press again for another plan, or Apply to project.` : `${r.message} The best partial plan is shown (channels it could not place keep their old frequency). Try a wider band, keep fewer channels, or switch off the simulated TV blocking.`;
    refresh(true);
  });
  const bApply = mk('Apply to project', 'Write these frequencies to the matching links and Intermod transmitters (undo with Ctrl+Z)', () => {
    const n = applyFrequencyPlan(store, st.items.filter((i) => i.id).map((i) => ({ id: i.id, freqMHz: i.freqMHz })));
    st.status = n ? `Applied ${n} frequenc${n === 1 ? 'y' : 'ies'} to the project. Undo restores the old ones.` : 'Nothing to apply: no channel here belongs to a project link.'; refresh(false);
  });
  const bReset = mk('Reset to project', 'Reload the frequencies from the project', () => { load(); st.status = 'Reloaded from the project.'; refresh(true); });
  const bAdd = mk('Add channel', 'Add a free marker (not part of the project)', () => {
    if (st.items.length >= MAX_ITEMS) return;
    const b = band(); const used = st.items.map((i) => i.freqMHz);
    let f = snap(b.startMHz + 1); while (used.some((u) => Math.abs(u - f) < 0.3) && f < b.endMHz) f = r6(f + 0.025);
    st.items.push({ key: `w${st.nextKey++}`, id: null, name: `Extra ${st.items.filter((i) => !i.id).length + 1}`, kind: 'mic', freqMHz: Math.min(f, b.endMHz), locked: false });
    refresh(true);
  });
  bar.append(bandSel, occLab, bEqual, bBest, bApply, bReset, bAdd);
  const status = el('p', 'map-illus', '', { role: 'status' });
  const hitsP = el('p', 'lab-hits', '', { role: 'status', 'aria-live': 'polite' });
  const list = el('ul', 'lab-list', null, { 'aria-label': 'Channels in the lab' });
  const candH = el('h3', 'cv-sug-h', 'Candidate channels (one more channel next to the others)');
  const candSum = el('p', 'hint lab-candsum', '');
  const candWrap = el('div', 'spectrum-dialog-tablewrap lab-cand');
  const note = el('p', 'hint', `Drag a marker (or select it and press the left and right arrow keys, Shift for 200 kHz steps). Third-order products 2f1 - f2 and f1 + f2 - f3 that land within ${GUARD_KHZ} kHz of a channel are hits, channels closer than ${SPACING_KHZ} kHz violate spacing. A planning estimate, not a licence: ${ILLUSTRATIVE.toLowerCase()} for the TV occupancy. Regional rules differ.`);
  zoom.slot.append(bar, status, hitsP, list, candH, candSum, candWrap, note);

  function load() {
    const sc = store.getScene(); st.items = workFromScene(sc); st.base = st.items.map((i) => ({ ...i })); st.nextKey = st.items.length;
    if (!st.sel || !st.items.some((i) => i.key === st.sel)) st.sel = null;
  }
  function renderList() {
    list.textContent = '';
    for (const it of st.items) {
      const li = el('li', 'lab-row');
      const rad = el('input', null, null, { type: 'radio', name: 'lab-sel', 'aria-label': `Select ${it.name}` }); rad.checked = st.sel === it.key;
      rad.addEventListener('change', () => { st.sel = it.key; refresh(true); });
      const inp = el('input', null, null, { type: 'number', step: String(SNAP_KHZ / 1000), 'aria-label': `${it.name} frequency in MHz`, inputmode: 'decimal' }); inp.value = String(it.freqMHz);
      inp.addEventListener('change', () => { const v = Number(inp.value); if (Number.isFinite(v)) { it.freqMHz = clamp(r6(v), band().startMHz, band().endMHz); refresh(true); } });
      const lk = el('input', null, null, { type: 'checkbox', 'aria-label': `Keep ${it.name} when planning` }); lk.checked = it.locked;
      lk.addEventListener('change', () => { it.locked = !!lk.checked; refresh(false); });
      const name = el('span', 'lab-name', `${it.name} (${it.kind})`);
      li.append(rad, name, inp, el('span', null, 'MHz'), lk, el('span', null, 'keep'));
      if (!it.id) { const rm = mk('Remove', `Remove ${it.name}`, () => { st.items = st.items.filter((x) => x !== it); if (st.sel === it.key) st.sel = null; refresh(true); }); li.append(rm); }
      list.append(li);
    }
  }
  function renderCand() {
    candWrap.textContent = '';
    const c = st.cand;
    if (!c) return;
    candSum.textContent = `${summaryText(c.summary)}${c.blockedCount ? ` ${c.blockedCount} raster points are blocked (TV occupancy or region rules) and not listed.` : ''}${c.thinned ? ' (Every k-th raster point shown: the list was thinned.)' : ''} Candidates are tried next to ${c.fixedCount} other channel${c.fixedCount === 1 ? '' : 's'}${st.sel ? ' (the selected one is left out)' : ''}.`;
    const tb = el('table', 'spectrum-table'), cap = el('caption', null, 'Best clear candidates, then one example of each rejection reason'), th = el('thead'), hr = el('tr'), body = el('tbody');
    for (const t of ['MHz', 'Result', 'Why']) hr.append(el('th', null, t, { scope: 'col' }));
    th.append(hr);
    const row = (r, ok) => { const tr = el('tr'); tr.append(el('th', null, r.freqMHz.toFixed(3), { scope: 'row' }), el('td', null, ok ? `Clear, rank ${r.rank}` : r.reasons.map((x) => REASON_NAMES[x.code] || x.code).join(', ')), el('td', null, r.explanation)); body.append(tr); };
    c.best.forEach((r) => row(r, true)); c.rejected.forEach((r) => row(r, false));
    if (!c.best.length && !c.rejected.length) { const tr = el('tr'); const td = el('td', null, 'No candidate channels in this band.'); td.colSpan = 3; tr.append(td); body.append(tr); }
    tb.append(cap, th, body); candWrap.append(tb);
  }
  function refreshLive() {
    const m = metrics(), hh = m.hits;
    hitsP.textContent = `${hh.hitsTotal} third-order hit${hh.hitsTotal === 1 ? '' : 's'} (${hh.hits2} two-transmitter, ${hh.hits3} three-transmitter), ${hh.spacingViolations.length} spacing violation${hh.spacingViolations.length === 1 ? '' : 's'}${hh.ok ? ': clear' : ''}. Closest product to a channel: ${Number.isFinite(hh.minProductDistanceKHz) ? hh.minProductDistanceKHz.toFixed(0) : 'n/a'} kHz (guard ${GUARD_KHZ} kHz).`;
    hitsP.dataset.ok = hh.ok ? 'true' : 'false';
    zoom.update();
  }
  // the candidate search is the costly part: run it 150 ms after the last change, or at once (pointer up, band or lock change)
  function runCand() { candTimer = null; st.cand = candidateRows(st.items, st.sel, band(), blockedNow().blocked, band().regionId); if (zoom.isOpen()) renderCand(); }
  function scheduleCand(now) {
    if (candTimer !== null) { clearTimeout(candTimer); candTimer = null; }
    if (now) { runCand(); return; }
    candTimer = setTimeout(runCand, 150);
  }
  function refresh(recompute, now = false) {
    if (!zoom.isOpen()) return;
    const bs = bands();
    bandSel.textContent = '';
    for (const b of bs) bandSel.append(el('option', null, b.label, { value: b.id }));
    bandSel.value = bs.some((b) => b.id === st.bandId) ? st.bandId : bs[0].id;
    occChk.checked = st.showOcc;
    canvas.style.width = `${Math.max(cw(), 560)}px`; canvas.style.height = `${Y.h}px`;
    const outside = st.items.filter((i) => i.freqMHz < band().startMHz || i.freqMHz > band().endMHz).length;
    status.textContent = `${st.status}${outside ? ` ${outside} channel${outside === 1 ? ' is' : 's are'} outside this band (not drawn, still counted for products when they matter).` : ''}`.trim();
    renderList();
    if (recompute) scheduleCand(now); else renderCand();
    refreshLive();
  }

  // ---- pointer and keyboard
  const local = (e) => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  const pick = (p) => { if (!L) return null; let best = null, bd = 14; for (const m of L.marks) { const d = Math.abs(m.px - p.x); if (d < bd && p.y < Y.line + 6) { bd = d; best = m.it; } } return best; };
  canvas.addEventListener('pointerdown', (e) => {
    const p = local(e), it = pick(p); if (!it) return;
    st.sel = it.key; st.drag = it.key; if (canvas.setPointerCapture && e.pointerId !== undefined) { try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
    zoom.update();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (!st.drag || !L) { canvas.style.cursor = pick(p) ? 'grab' : 'default'; return; }
    const it = st.items.find((i) => i.key === st.drag); if (!it) return;
    it.freqMHz = clamp(snap(L.fOf(p.x)), band().startMHz, band().endMHz);
    refreshLive();
  });
  const endDrag = () => { if (!st.drag) return; st.drag = null; refresh(true, true); };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('keydown', (e) => {
    if (!zoom.isOpen() || !st.items.length) return;
    let idx = st.items.findIndex((i) => i.key === st.sel);
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + st.items.length) % st.items.length; st.sel = st.items[idx].key; refresh(true); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (idx < 0) { st.sel = st.items[0].key; idx = 0; }
      const it = st.items[idx]; it.freqMHz = nudge(it.freqMHz, (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 200 : SNAP_KHZ), band()); refresh(true);
    } else return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  if (typeof ResizeObserver === 'function' && scroll) { ro = new ResizeObserver(() => refresh(false)); ro.observe(scroll); }
  canvas.setAttribute('aria-label', 'Coordination lab frequency line. Arrow up and down select a channel, left and right move it.');

  function open() {
    load(); st.bandId = defaultBandId(st.items); st.status = ''; st.sel = null;
    zoom.open('lab', button); // channels keep their real frequencies: the band follows them, nothing is clamped on open or on a band change
    if (button && button.setAttribute) button.setAttribute('aria-expanded', 'true');
    refresh(true, true);
  }
  if (button) { button.addEventListener('click', open); button.setAttribute('aria-haspopup', 'dialog'); }
  dlg.addEventListener('close', () => { if (button && button.setAttribute) button.setAttribute('aria-expanded', 'false'); });
  return { open, zoom, state: st, refresh, occChk, bandSel, bBest, bApply, bEqual, bReset, hitsP, list, status, destroy() { if (candTimer !== null) clearTimeout(candTimer); if (ro) ro.disconnect(); zoom.destroy(); } };
}
