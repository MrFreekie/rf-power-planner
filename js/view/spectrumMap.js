// Spectrum map pop-out: a compressed frequency axis (VHF to 5.8 GHz, gaps replaced by break marks), shaded PMSE bands with an info panel,
// TV channels with illustrative occupancy, Wi-Fi and PMR446 channels, project frequencies with an overlap warning, a simulated noise floor
// and an AM/FM/DAB strip. The layout is pure (buildMap) so it is tested without a canvas; the DOM part reuses createZoom (native dialog).
// Everything shown here is a guide: regional rules differ and nothing is measured data.
import { createCanvasHost, setFont, haloText, inkAlpha, strokeHatchRect } from './util.js';
import { createZoom } from './spectraZoom.js';
import {
  axisLayout, BAND_CATALOGUE, STRIP_BANDS, tvChannelList, dabBlocks, wifi24Channels, wifi5Channels, pmr446Channels, simulatedOccupancy,
  simulatedNoiseFloor, applyTvNoiseRise, tvBlockLevelDbm, tvBlockLevelIsAssumed, tvBlockLevelsOf, TV_BLOCK_LEVEL_LIMITS, TV_BLOCK_DBM, projectFrequencies, overlappingFrequencies, tvWidthOf, hashSeed, OCCUPANCY_SETTINGS, bandsAt, tvChannelOf,
} from '../model/spectrum-map.js';
import { setTvChannelWidth, setTvBlockLevel, clearTvBlockLevels } from '../actionsAreas.js';

export const PAD = 14, MAX_K = 40, MIN_PX = 3, FIT_MIN_K = 0.3;
export const FLAG_TEXT = Object.freeze({
  S: 'S, stated: a defined standard or a figure read from a source.',
  I: 'I, inferred: recalled from the regulation, not read from the primary page.',
  U: 'U, unverified: likely to have changed, confirm before relying on it.',
});
export const REGION_NOTE = 'Regional rules differ and change. Check the current rules of your own regulator (for example Ofcom in the UK, the FCC in the US, ACMA in Australia) before you rely on a band.';
export const ILLUSTRATIVE = 'Illustrative, not measured';
export const ENVIRONMENTS = Object.freeze([['quiet', 'Quiet (rural)'], ['outdoor', 'Outdoor (residential)'], ['urban', 'Urban'], ['noisy-venue', 'Noisy venue']]);
export const GROUP_NAMES = Object.freeze({ pmse: 'PMSE (mics, IEM)', tv: 'TV', broadcast: 'Broadcast', srd: 'Short range / ISM', mobile: 'Mobile (no mics)', wifi: 'Wi-Fi / ISM', other: 'Other' });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const tw = (text, px = 12) => String(text).length * px * 0.58;
const fmtF = (f) => (f >= 1000 ? `${(f / 1000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} GHz` : `${+f.toFixed(4)} MHz`);

// ------------------------------------------------------------------------------------------------ pure axis view
/** mapView(segId | null, cw) -> { segId, width, k, segments: [{...segment, px0, px1, k}], breaks: [{px0, px1, fromMHz, toMHz}] }. null is the overview at scale 1 (scrolls). */
export function mapView(segId, cw = 800, fit = false) {
  const L = axisLayout();
  const s = segId ? L.segments.find((q) => q.id === segId) : null;
  if (!s) {
    const kf = (cw - 2 * PAD) / L.totalPx, k = fit && kf >= FIT_MIN_K ? Math.min(kf, 1.5) : 1; // fit only when it stays readable, else full size and scroll
    return { segId: null, k, fitted: k !== 1 || (fit && kf >= FIT_MIN_K), full: L.totalPx + 2 * PAD, width: Math.max(cw, L.totalPx * k + 2 * PAD), segments: L.segments.map((q) => ({ ...q, px0: PAD + q.x0 * k, px1: PAD + q.x1 * k, k })), breaks: L.breaks.map((b) => ({ ...b, px0: PAD + b.x0 * k, px1: PAD + b.x1 * k })) };
  }
  const k = clamp((cw - 2 * PAD) / s.widthPx, 0.3, MAX_K);
  return { segId: s.id, k, width: Math.max(cw, s.widthPx * k + 2 * PAD), segments: [{ ...s, px0: PAD, px1: PAD + s.widthPx * k, k }], breaks: [] };
}
/** Pixel of a frequency in the view, or null when it is not on a visible segment. */
export function fToPx(f, view) {
  for (const s of view.segments) if (f >= s.startMHz && f <= s.endMHz) return s.px0 + (f - s.startMHz) * s.pxPerMHz * s.k;
  return null;
}
/** Frequency at a pixel (null on a break glyph or outside). */
export function pxToF(px, view) {
  for (const s of view.segments) if (px >= s.px0 && px <= s.px1) return s.startMHz + (px - s.px0) / (s.pxPerMHz * s.k);
  return null;
}
/** The pieces (one per visible segment) of the range lo..hi: [{ px0, px1, segId }]. */
export function pieces(lo, hi, view) {
  const out = [];
  for (const s of view.segments) {
    const a = Math.max(lo, s.startMHz), b = Math.min(hi, s.endMHz);
    if (a < b) out.push({ px0: s.px0 + (a - s.startMHz) * s.pxPerMHz * s.k, px1: s.px0 + (b - s.startMHz) * s.pxPerMHz * s.k, segId: s.id });
  }
  return out;
}
/** Greedy lane packing: items {x0, x1} get .lane so that none overlap (with a 3 px gap). Returns the lane count. */
export function packLanes(items) {
  const ends = [];
  for (const it of [...items].sort((a, b) => a.x0 - b.x0 || b.x1 - a.x1)) {
    let l = ends.findIndex((e) => it.x0 >= e + 3);
    if (l < 0) { l = ends.length; ends.push(0); }
    ends[l] = Math.max(it.x1, it.x0 + MIN_PX); it.lane = l;
  }
  return ends.length;
}
/** Tick spacing in MHz that gives at least 56 px between labels. */
export function tickStep(pxPerMHz) {
  for (const s of [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100]) if (s * pxPerMHz >= 56) return s;
  return 100;
}
/** Which regions of the catalogue to show for a TV width: 8 MHz is the UK/Europe raster, 6 MHz the US one. */
export const regionsFor = (width) => (width === 6 ? ['us', 'any'] : ['uk', 'eu', 'any']);
export const regionName = (width) => (width === 6 ? 'North America (6 MHz TV)' : 'UK / Europe (8 MHz TV)');
export const defaultOccupancy = (width) => (width === 6 ? 'us-top10' : 'uk-city');
export const occupancyChoices = (width) => Object.keys(OCCUPANCY_SETTINGS).filter((k) => OCCUPANCY_SETTINGS[k].width === width);

// ------------------------------------------------------------------------------------------------ pure layout
const ROW = 20, HEAD = 36, AXIS_Y = 40;
/**
 * buildMap(opts) -> the whole drawing as data. opts: { segId, cw, scene, showTv, showOcc, occSetting, env }.
 * Returns { view, width, height, bands, markers, overlaps, offAxis, tv, wifi, noise, strip, hits, y: {...} }.
 */
export function buildMap({ segId = null, cw = 800, fit = false, scene = null, showTv = true, showOcc = true, showRise = true, occSetting = null, env = 'quiet' } = {}) {
  const view = mapView(segId, cw, fit);
  const tvWidth = tvWidthOf(scene), regions = regionsFor(tvWidth);
  const overrides = tvBlockLevelsOf(scene);
  const out = { view, tvWidth, hits: [], y: {}, tvLevels: overrides };
  let y = AXIS_Y + 22;
  // project frequencies (markers) and their overlap warning
  const proj = projectFrequencies(scene || {});
  const overlaps = overlappingFrequencies(proj, 200);
  const over = new Set(); for (const o of overlaps) { over.add(o.a); over.add(o.b); }
  const markers = [], offAxis = [];
  for (const p of proj) {
    const px = fToPx(p.freqMHz, view);
    if (px === null) { if (!view.segId) offAxis.push(p); else if (p.segment !== view.segId) offAxis.push(p); continue; }
    const label = `${p.name} ${+p.freqMHz.toFixed(3)}`;
    markers.push({ ...p, px, label, over: over.has(p.id), x0: px - 4, x1: px + 6 + tw(label, 11) });
  }
  const mLanes = packLanes(markers);
  out.y.markers = y; out.markers = markers; out.overlaps = overlaps; out.offAxis = offAxis;
  y += Math.max(1, mLanes) * 16 + 8;
  // bands (a caption row first)
  y += 14;
  out.y.bands = y;
  const bands = [];
  for (const b of BAND_CATALOGUE) {
    if (!regions.includes(b.region)) continue;
    const ps = pieces(b.loMHz, b.hiMHz, view);
    if (!ps.length) continue;
    bands.push({ band: b, pieces: ps, x0: ps[0].px0, x1: ps[ps.length - 1].px1 });
  }
  const bLanes = packLanes(bands);
  for (const b of bands) { b.y = y + b.lane * ROW; b.h = ROW - 3; for (const p of b.pieces) out.hits.push({ kind: 'band', id: b.band.id, x0: p.px0 - 1, x1: Math.max(p.px1, p.px0 + MIN_PX) + 1, y0: b.y, y1: b.y + b.h }); }
  out.bands = bands;
  y += Math.max(1, bLanes) * ROW + 10;
  // TV channels
  out.y.tv = y;
  let tv = null;
  if (showTv) {
    const occ = showOcc ? simulatedOccupancy(occSetting && OCCUPANCY_SETTINGS[occSetting] && OCCUPANCY_SETTINGS[occSetting].width === tvWidth ? occSetting : defaultOccupancy(tvWidth), hashSeed('map')) : null;
    const byN = new Map(occ ? occ.channels.map((c) => [c.n, c]) : []);
    const chans = [];
    for (const c of tvChannelList(tvWidth)) {
      const ps = pieces(c.loMHz, c.hiMHz, view);
      if (ps.length) chans.push({ ch: c, pieces: ps, occupied: !!(byN.get(c.n) && byN.get(c.n).occupied), userSet: !tvBlockLevelIsAssumed(c.n, overrides) });
    }
    tv = { y, h: 26, chans, occupancy: occ };
    for (const c of chans) for (const p of c.pieces) out.hits.push({ kind: 'tv', id: String(c.ch.n), n: c.ch.n, x0: p.px0, x1: Math.max(p.px1, p.px0 + MIN_PX), y0: y, y1: y + 26 });
    y += 26 + 12;
  }
  out.tv = tv;
  // Wi-Fi, PMR446, DAB rows
  out.y.wifi = y;
  const wifi = { y, rows: [] };
  const addRow = (name, list) => { const items = list.map((c) => ({ c, pieces: pieces(c.loMHz, c.hiMHz, view) })).filter((i) => i.pieces.length); wifi.rows.push({ name, items, y: y + wifi.rows.length * ROW }); };
  addRow('Wi-Fi 2.4 GHz', wifi24Channels());
  addRow('Wi-Fi 5.8 GHz', wifi5Channels());
  addRow('DAB blocks', dabBlocks());
  const pmr = pmr446Channels(false).map((c) => ({ ...c, loMHz: c.centreMHz - 0.00625, hiMHz: c.centreMHz + 0.00625 }));
  addRow('PMR446', pmr);
  y += wifi.rows.length * ROW + 10;
  out.wifi = wifi;
  // noise floor plot
  out.y.noise = y;
  const NH = 100;
  const occChans = tv && tv.occupancy && showRise ? tv.occupancy.channels.filter((c) => c.occupied) : [];
  let pts = [];
  for (const s of view.segments) {
    const fs = []; const step = 6 / (s.pxPerMHz * s.k);
    for (let f = s.startMHz; f < s.endMHz; f += step) fs.push(f);
    fs.push(s.endMHz);
    for (const c of occChans) for (const f of [c.loMHz - 1e-6, c.loMHz, c.hiMHz - 1e-6, c.hiMHz]) if (f >= s.startMHz && f <= s.endMHz) fs.push(f); // crisp block edges
    fs.sort((a, b) => a - b);
    for (const q of simulatedNoiseFloor({ environment: env, bwKHz: 200, freqsMHz: fs, seed: 1 })) pts.push({ segId: s.id, px: s.px0 + (q.freqMHz - s.startMHz) * s.pxPerMHz * s.k, dbm: q.dbm, freqMHz: q.freqMHz });
  }
  pts = applyTvNoiseRise(pts, occChans, { widthMHz: tvWidth, bwKHz: 200, blockLevelsDbm: overrides });
  // one label per occupied block that is visible: the rise at the block centre
  const rises = [];
  for (const c of occChans) {
    const ps = pieces(c.loMHz, c.hiMHz, view); if (!ps.length) continue;
    const inside = pts.filter((p) => p.tvChannel === c.n); if (!inside.length) continue;
    const riseDb = inside.reduce((a, p) => a + p.riseDb, 0) / inside.length;
    rises.push({ n: c.n, loMHz: c.loMHz, hiMHz: c.hiMHz, widthMHz: tvWidth, blockDbm: tvBlockLevelDbm(c.n, overrides), assumed: tvBlockLevelIsAssumed(c.n, overrides), riseDb, px0: ps[0].px0, px1: ps[ps.length - 1].px1, topDbm: Math.max(...inside.map((p) => p.dbm)) });
  }
  let lo = Infinity, hi = -Infinity; for (const p of pts) { lo = Math.min(lo, p.dbm); hi = Math.max(hi, p.dbm); }
  if (!Number.isFinite(lo)) { lo = -121; hi = -100; }
  lo = Math.floor((lo - 2) / 5) * 5; hi = Math.max(Math.ceil((hi + 2) / 5) * 5, lo + 10);
  out.noise = { y, h: NH, pts, lo, hi, env, rises, riseShown: rises.length > 0, assumedBlockDbm: TV_BLOCK_DBM, userSetCount: rises.filter((r) => !r.assumed).length, assumedCount: rises.filter((r) => r.assumed).length };
  y += NH + 14;
  // strip
  out.y.strip = y;
  const strip = [];
  for (const b of STRIP_BANDS) { const ps = pieces(b.loMHz, b.hiMHz, view); if (ps.length) strip.push({ band: b, pieces: ps }); }
  out.strip = { y, h: 24, items: strip, belowAxis: STRIP_BANDS.filter((b) => b.hiMHz < 1) };
  y += 24 + 22;
  out.height = Math.ceil(y);
  out.width = view.width;
  // segment header hits (overview only: click to zoom)
  if (!view.segId) for (const s of view.segments) out.hits.push({ kind: 'segment', id: s.id, x0: s.px0, x1: s.px1, y0: 0, y1: AXIS_Y + 14 });
  for (const m of markers) out.hits.unshift({ kind: 'marker', id: m.id, x0: m.px - 5, x1: m.x1, y0: out.y.markers - 2, y1: out.y.markers + (m.lane + 1) * 16 });
  return out;
}

/** Topmost hit at (x, y), or null. */
export function hitAt(map, x, y) {
  return map.hits.find((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1) || null;
}

/** Info panel content for a hit: { title, lines[], flag }. */
export function infoFor(hit, map) {
  if (!hit) return null;
  if (hit.kind === 'band') {
    const b = BAND_CATALOGUE.find((q) => q.id === hit.id); if (!b) return null;
    return {
      title: b.label, flag: b.flag,
      lines: [`${fmtF(b.loMHz)} to ${fmtF(b.hiMHz)}`, `Use: ${GROUP_NAMES[b.group] || b.group}. Region: ${b.region === 'any' ? 'international' : b.region.toUpperCase()}.`, ...(b.note ? [b.note] : []), `Confidence flag ${FLAG_TEXT[b.flag] || b.flag}`, REGION_NOTE],
    };
  }
  if (hit.kind === 'marker') {
    const m = map.markers.find((q) => q.id === hit.id); if (!m) return null;
    const tvc = tvChannelOf(m.freqMHz, map.tvWidth);
    return { title: `${m.name}, ${+m.freqMHz.toFixed(4)} MHz`, flag: null, lines: [`Project ${m.source === 'imd' ? 'intermod transmitter' : m.source === 'noise' ? 'noise source' : 'link'}${m.kind ? `, ${m.kind}` : ''}.`, tvc ? `Falls in TV channel ${tvc.n} (${tvc.loMHz}-${tvc.hiMHz} MHz).` : 'Not inside a TV channel of this raster.', ...bandsAt(m.freqMHz).filter((b) => regionsFor(map.tvWidth).includes(b.region)).map((b) => `Inside: ${b.label} (flag ${b.flag}).`), REGION_NOTE] };
  }
  if (hit.kind === 'tv') {
    const n = hit.n, c = tvChannelList(map.tvWidth).find((q) => q.n === n); if (!c) return null;
    const lv = map.tvLevels || {}, set = !tvBlockLevelIsAssumed(n, lv), cell = map.tv && map.tv.chans.find((q) => q.ch.n === n);
    return { title: `TV channel ${n}, ${c.loMHz}-${c.hiMHz} MHz`, flag: null, lines: [
      `In-block level at the receiver: ${tvBlockLevelDbm(n, lv).toFixed(0)} dBm, ${set ? 'set by you' : 'assumed'}${set ? '' : ` (the map assumes about ${TV_BLOCK_DBM} dBm, +-3 dB, not measured)`}.`,
      cell && cell.occupied ? 'This channel is on air in the simulated occupancy, so the level raises the noise floor across it.' : 'This channel is not on air in the simulated occupancy, so its level has no effect on the noise floor until it is shown as on air.',
      'Use the TV level controls below to set or clear the level for this channel.'] };
  }
  return null;
}

/** Hover text for the TV block under a frequency: "TV ch 34 block -50 dBm (set by you)", or '' when none. */
export function tvHoverText(map, f) {
  if (f === null || f === undefined || !map || !map.noise) return '';
  const r = map.noise.rises.find((q) => f >= q.loMHz && f < q.hiMHz); if (!r) return '';
  return `TV ch ${r.n} block ${r.blockDbm.toFixed(0)} dBm (${r.assumed ? 'assumed' : 'set by you'}), +${r.riseDb.toFixed(0)} dB`;
}

/** Rows of the table alternative for the current map: items, range and flag. */
export function mapTable(map) {
  const rows = [];
  for (const m of map.markers) rows.push([`Project: ${m.name}`, `${+m.freqMHz.toFixed(4)} MHz`, m.over ? 'overlap warning' : (m.tvChannel ? `TV ch ${m.tvChannel}` : '')]);
  for (const p of map.offAxis) rows.push([`Project: ${p.name}`, `${+p.freqMHz.toFixed(4)} MHz`, 'not on this view (gap or other segment)']);
  for (const b of map.bands) rows.push([b.band.label, `${b.band.loMHz}-${b.band.hiMHz} MHz`, `${GROUP_NAMES[b.band.group] || b.band.group}, flag ${b.band.flag}`]);
  if (map.tv) {
    const occ = map.tv.chans.filter((c) => c.occupied).map((c) => c.ch.n);
    rows.push([`TV channels (${map.tvWidth} MHz)`, map.tv.chans.length ? `${map.tv.chans[0].ch.n}-${map.tv.chans[map.tv.chans.length - 1].ch.n}` : 'none in view', occ.length ? `${ILLUSTRATIVE}: occupied ${occ.join(', ')}` : 'no occupancy shown']);
  }
  for (const r of map.wifi.rows) if (r.items.length) rows.push([r.name, `${r.items.length} in view`, r.items.slice(0, 40).map((i) => i.c.n || i.c.id).join(' ')]);
  for (const r of map.noise.rises) rows.push([`Noise floor rise, TV ch ${r.n}`, `${r.loMHz}-${r.hiMHz} MHz (${r.widthMHz} MHz block)`, `+${r.riseDb.toFixed(0)} dB in 200 kHz; ${r.assumed ? 'assumed' : 'set by you'} block level ${r.blockDbm.toFixed(0)} dBm, ${r.assumed ? ILLUSTRATIVE.toLowerCase() : 'not verified here'}`]);
  rows.push(['Noise floor (simulated)', `${map.noise.lo} to ${map.noise.hi} dBm, 200 kHz`, `${ILLUSTRATIVE}, ${map.noise.env}`]);
  return { caption: 'Spectrum map contents in the current view', cols: ['Item', 'Frequency', 'Note'], rows };
}

// ------------------------------------------------------------------------------------------------ drawing
export function drawMap(ctx, w, h, th, map, { hoverPx = null, selected = null } = {}) {
  const view = map.view;
  ctx.fillStyle = th.paper; ctx.fillRect(0, 0, w, h);
  // axis and ticks
  ctx.strokeStyle = th.ink; ctx.lineWidth = 1;
  for (const s of view.segments) {
    ctx.beginPath(); ctx.moveTo(s.px0, AXIS_Y + 0.5); ctx.lineTo(s.px1, AXIS_Y + 0.5); ctx.stroke();
    const step = tickStep(s.pxPerMHz * s.k);
    ctx.fillStyle = th.inkSoft; setFont(ctx, th, 11); ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    for (let f = Math.ceil(s.startMHz / step) * step; f <= s.endMHz + 1e-9; f += step) {
      const x = s.px0 + (f - s.startMHz) * s.pxPerMHz * s.k;
      ctx.beginPath(); ctx.moveTo(x, AXIS_Y); ctx.lineTo(x, AXIS_Y + 5); ctx.stroke();
      if (x - 20 > s.px0 - 2 && x + 20 < s.px1 + 24) ctx.fillText(`${+f.toFixed(3)}`, x, AXIS_Y + 7);
    }
    // segment header: letter and name (clipped to the segment)
    ctx.save(); ctx.beginPath(); ctx.rect(s.px0, 0, Math.max(0, s.px1 - s.px0), AXIS_Y - 2); ctx.clip();
    ctx.fillStyle = th.ink; setFont(ctx, th, 12, 'bold'); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(s.id, s.px0 + 3, 3);
    const sw = s.px1 - s.px0 - 6, range = `${s.startMHz}-${s.endMHz} MHz`;
    ctx.fillStyle = th.inkSoft; setFont(ctx, th, 11);
    if (tw(s.id, 12) + 6 + tw(s.label, 11) <= sw) ctx.fillText(s.label, s.px0 + 3 + tw(s.id, 12) + 6, 4); // a label that does not fit is left out (the segment list and info carry it)
    if (tw(range, 11) <= sw) ctx.fillText(range, s.px0 + 3, 19); else if (tw(`${s.startMHz}`, 11) <= sw) ctx.fillText(`${s.startMHz}`, s.px0 + 3, 19);
    ctx.restore();
    if (!view.segId) { ctx.strokeStyle = th.grid; ctx.strokeRect(s.px0 + 0.5, 1.5, Math.max(0, s.px1 - s.px0 - 1), AXIS_Y - 5); ctx.strokeStyle = th.ink; }
  }
  for (const b of view.breaks) { // break glyph: two slanted strokes
    const cx = (b.px0 + b.px1) / 2;
    ctx.strokeStyle = th.ink; ctx.beginPath(); ctx.moveTo(cx - 3, AXIS_Y + 6); ctx.lineTo(cx - 1, AXIS_Y - 6); ctx.moveTo(cx + 1, AXIS_Y + 6); ctx.lineTo(cx + 3, AXIS_Y - 6); ctx.stroke();
    ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(cx, AXIS_Y + 8); ctx.lineTo(cx, map.height - 30); ctx.stroke();
  }
  // bands
  for (const b of map.bands) {
    const pmse = b.band.group === 'pmse', sel = selected === b.band.id;
    for (const p of b.pieces) {
      const x = p.px0, bw = Math.max(MIN_PX, p.px1 - p.px0);
      if (pmse) { ctx.globalAlpha = 0.22; ctx.fillStyle = th.blue; ctx.fillRect(x, b.y, bw, b.h); ctx.globalAlpha = 1; strokeHatchRect(ctx, x, b.y, bw, b.h, th.blue, 6); }
      else { ctx.fillStyle = inkAlpha(th, 0.07); ctx.fillRect(x, b.y, bw, b.h); }
      ctx.strokeStyle = sel ? th.ink : (pmse ? th.blue : th.inkSoft); ctx.lineWidth = sel ? 2 : 1; ctx.strokeRect(x + 0.5, b.y + 0.5, bw - 1, b.h - 1); ctx.lineWidth = 1;
    }
    const p0 = b.pieces[0], bw = p0.px1 - p0.px0;
    if (bw > 22) {
      ctx.save(); ctx.beginPath(); ctx.rect(p0.px0 + 1, b.y, bw - 2, b.h); ctx.clip();
      ctx.fillStyle = th.ink; setFont(ctx, th, 12); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(`${b.band.flag} ${b.band.label}`, p0.px0 + 4, b.y + b.h / 2 + 0.5);
      ctx.restore();
    } else if (bw > 8) { ctx.fillStyle = th.ink; setFont(ctx, th, 11, 'bold'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.band.flag, p0.px0 + bw / 2, b.y + b.h / 2 + 0.5); }
  }
  ctx.fillStyle = th.inkSoft; setFont(ctx, th, 11); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(`Bands for ${regionName(map.tvWidth)}. Shaded and hatched: PMSE. Letter S/I/U is the confidence flag.`, 4, map.y.bands - 2);
  // TV channels
  if (map.tv) {
    const t = map.tv;
    for (const c of t.chans) for (const p of c.pieces) {
      const bw = Math.max(MIN_PX, p.px1 - p.px0);
      if (c.occupied) { ctx.fillStyle = inkAlpha(th, 0.1); ctx.fillRect(p.px0, t.y, bw, t.h); strokeHatchRect(ctx, p.px0, t.y, bw, t.h, th.ink, 5); }
      ctx.strokeStyle = th.inkSoft; ctx.strokeRect(p.px0 + 0.5, t.y + 0.5, bw - 1, t.h - 1);
      if (c.userSet) { ctx.fillStyle = th.ink; ctx.fillRect(p.px0 + 1, t.y + 1, bw - 2, 3); } // a bar on top: the level of this channel was set by you
      if (bw > 16) { ctx.fillStyle = th.ink; setFont(ctx, th, 11); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(c.ch.n), p.px0 + bw / 2, t.y + t.h / 2 + 0.5); }
    }
    ctx.fillStyle = th.inkSoft; setFont(ctx, th, 11); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`TV channels, ${map.tvWidth} MHz raster${t.occupancy ? `. Zebra stripes: occupied in a simulated ${t.occupancy.setting} setting (${ILLUSTRATIVE.toLowerCase()})` : ''}${t.chans.some((c) => c.userSet) ? '. Bar on top: level set by you' : ''}`, 4, t.y - 3);
  }
  // Wi-Fi, DAB and PMR446 rows
  for (const r of map.wifi.rows) {
    if (!r.items.length) continue;
    ctx.fillStyle = th.inkSoft; setFont(ctx, th, 11); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const first = r.items[0].pieces[0].px0;
    ctx.strokeStyle = th.inkSoft;
    for (const it of r.items) for (const p of it.pieces) {
      const bw = Math.max(MIN_PX, p.px1 - p.px0);
      ctx.strokeRect(p.px0 + 0.5, r.y + 3.5, bw - 1, ROW - 8);
      if (bw > 14) { ctx.fillStyle = th.ink; setFont(ctx, th, 10); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(it.c.n || it.c.id), p.px0 + bw / 2, r.y + ROW / 2 - 0.5); }
    }
    ctx.fillStyle = th.inkSoft; setFont(ctx, th, 11); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    haloText(ctx, th, r.name, Math.max(first - 4, 80), r.y + ROW / 2 - 0.5, { align: 'right', baseline: 'middle', px: 11, color: th.inkSoft });
  }
  // noise floor
  const n = map.noise, ny = (d) => n.y + n.h - ((d - n.lo) / (n.hi - n.lo)) * n.h;
  ctx.strokeStyle = th.grid; ctx.lineWidth = 1; ctx.strokeRect(0.5, n.y + 0.5, w - 1, n.h);
  ctx.fillStyle = th.inkSoft; setFont(ctx, th, 11); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(`Simulated noise floor, 200 kHz, ${n.env} (${ILLUSTRATIVE.toLowerCase()}): ${n.lo} to ${n.hi} dBm${n.riseShown ? `. Amber blocks: a TV carrier on air raises the floor across its whole ${map.tvWidth} MHz channel (block level ${n.userSetCount ? `set by you on ${n.userSetCount} channel${n.userSetCount === 1 ? '' : 's'}${n.assumedCount ? `, assumed ${n.assumedBlockDbm} dBm on the rest` : ''}` : `assumed ${n.assumedBlockDbm} dBm`})` : ''}`, 4, n.y - 3);
  ctx.strokeStyle = th.ink; ctx.lineWidth = 1.5;
  let seg = null; ctx.beginPath();
  for (const p of n.pts) { if (p.segId !== seg) { ctx.moveTo(p.px, ny(p.dbm)); seg = p.segId; } else ctx.lineTo(p.px, ny(p.dbm)); }
  ctx.stroke(); ctx.lineWidth = 1;
  // TV carrier rise: tinted block over the full channel width and a label with the rise in dB
  if (n.rises.length) {
    for (const r of n.rises) {
      const bw = Math.max(MIN_PX, r.px1 - r.px0);
      ctx.globalAlpha = 0.16; ctx.fillStyle = th.marginal; ctx.fillRect(r.px0, n.y + 1, bw, n.h - 1); ctx.globalAlpha = 1;
      ctx.strokeStyle = th.marginal; ctx.setLineDash && ctx.setLineDash([3, 2]); ctx.beginPath(); ctx.moveTo(r.px0 + 0.5, n.y + 1); ctx.lineTo(r.px0 + 0.5, n.y + n.h); ctx.moveTo(r.px1 - 0.5, n.y + 1); ctx.lineTo(r.px1 - 0.5, n.y + n.h); ctx.stroke(); ctx.setLineDash && ctx.setLineDash([]);
      const label = bw >= 40 ? `ch ${r.n} +${r.riseDb.toFixed(0)} dB` : bw >= 14 ? `+${r.riseDb.toFixed(0)}` : '';
      if (label) haloText(ctx, th, label, (r.px0 + r.px1) / 2, Math.max(n.y + 10, ny(r.topDbm) - 5), { align: 'center', baseline: 'alphabetic', px: 11, color: th.warnText || th.ink });
    }
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1.5; seg = null; ctx.beginPath();
    for (const p of n.pts) { if (p.segId !== seg) { ctx.moveTo(p.px, ny(p.dbm)); seg = p.segId; } else ctx.lineTo(p.px, ny(p.dbm)); }
    ctx.stroke(); ctx.lineWidth = 1;
  }
  // strip
  const st = map.strip;
  ctx.fillStyle = th.inkSoft; setFont(ctx, th, 11); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('Broadcast context: AM (LW 0.1485-0.2835 MHz, MW 0.531-1.705 MHz) lies below this axis. FM and DAB:', 4, st.y - 3);
  for (const it of st.items) for (const p of it.pieces) {
    const bw = Math.max(MIN_PX, p.px1 - p.px0);
    ctx.fillStyle = inkAlpha(th, 0.12); ctx.fillRect(p.px0, st.y, bw, st.h); ctx.strokeStyle = th.ink; ctx.strokeRect(p.px0 + 0.5, st.y + 0.5, bw - 1, st.h - 1);
    if (bw > 40) { ctx.save(); ctx.beginPath(); ctx.rect(p.px0 + 1, st.y, bw - 2, st.h); ctx.clip(); ctx.fillStyle = th.ink; setFont(ctx, th, 12); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(it.band.label, p.px0 + 4, st.y + st.h / 2 + 0.5); ctx.restore(); }
  }
  // project markers
  for (const m of map.markers) {
    const col = m.over ? th.fail : th.ink;
    ctx.strokeStyle = col; ctx.lineWidth = m.over ? 2 : 1.25;
    ctx.beginPath(); ctx.moveTo(m.px, map.y.markers + m.lane * 16 + 12); ctx.lineTo(m.px, map.y.wifi + map.wifi.rows.length * ROW); ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(m.px, map.y.markers + m.lane * 16 + 12); ctx.lineTo(m.px - 4, map.y.markers + m.lane * 16 + 4); ctx.lineTo(m.px + 4, map.y.markers + m.lane * 16 + 4); ctx.closePath(); ctx.fill();
    haloText(ctx, th, `${m.over ? '! ' : ''}${m.label}`, m.px + 6, map.y.markers + m.lane * 16 + 11, { px: 11, color: m.over ? th.warnText || th.fail : th.ink });
  }
  // hover readout
  if (hoverPx !== null) {
    const f = pxToF(hoverPx, view);
    ctx.strokeStyle = th.inkSoft; ctx.setLineDash && ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(hoverPx + 0.5, AXIS_Y); ctx.lineTo(hoverPx + 0.5, map.height - 24); ctx.stroke(); ctx.setLineDash && ctx.setLineDash([]);
    const tvh = tvHoverText(map, f);
    haloText(ctx, th, f === null ? 'break (frequencies removed)' : fmtF(f) + (tvh ? `  ${tvh}` : ''), clamp(hoverPx + 6, 4, Math.max(4, w - (tvh ? 460 : 120))), map.height - 8, { px: 12, color: th.ink });
  }
}

// ------------------------------------------------------------------------------------------------ DOM
export function mountSpectrumMap({ doc = document, button, store, hostFactory = (c, d) => createCanvasHost(c, d) } = {}) {
  const el = (tag, cls, text, attrs) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const st = { segId: null, fit: true, showTv: true, showOcc: true, showRise: true, tvSel: null, occ: { 6: 'us-top10', 8: 'uk-city' }, env: 'quiet', selected: null, hoverPx: null };
  let map = null, scroll = null;
  const width = () => tvWidthOf(store.getScene());
  const cw = () => (scroll && scroll.clientWidth) || 800;
  const build = () => buildMap({ segId: st.segId, cw: cw(), fit: st.fit, scene: store.getScene(), showTv: st.showTv, showOcc: st.showOcc, showRise: st.showRise, occSetting: st.occ[width()], env: st.env });
  const segLabel = (id) => { const s = axisLayout().segments.find((q) => q.id === id); return s ? `${s.id}: ${s.label}, ${s.startMHz}-${s.endMHz} MHz` : ''; };

  const zoom = createZoom({
    doc, hostFactory: (canvas, d) => hostFactory(canvas, (ctx, w, h, th) => { d(ctx, w, h, th); }),
    describe: () => {
      const m = map || build();
      const unrel = m.markers.length + m.offAxis.length;
      return {
        title: st.segId ? `Spectrum map, segment ${segLabel(st.segId)}` : 'Spectrum map, VHF to 5.8 GHz (compressed axis)',
        summary: `${m.bands.length} bands, ${m.tv ? `${m.tv.chans.length} TV channels (${m.tvWidth} MHz)${m.tv.occupancy ? `, simulated occupancy, ${ILLUSTRATIVE.toLowerCase()}` : ''}` : 'TV channels hidden'}, ${unrel} project frequenc${unrel === 1 ? 'y' : 'ies'}${m.overlaps.length ? `, ${m.overlaps.length} overlap warning${m.overlaps.length > 1 ? 's' : ''}` : ''}. Noise floor is simulated. Gaps between segments are removed.`,
      };
    },
    table: () => mapTable(map || build()),
    draw: (id, ctx, w, h, th) => { if (!map) map = build(); drawMap(ctx, w, h, th, map, { hoverPx: st.hoverPx, selected: st.selected }); },
  });
  const dlg = zoom.dialog, canvas = zoom.canvas;
  dlg.className = `${dlg.className || ''} map-dialog`.trim();
  canvas.className = 'map-canvas';
  canvas.setAttribute('aria-label', 'Spectrum map');
  scroll = el('div', 'map-scroll', null, { tabindex: '-1' });
  const parent = canvas.parentNode;
  // scroll navigation: arrow buttons, a position strip and a text cue above the map, shown only while the map is wider than the window
  const sNav = el('div', 'map-scrollnav', null, { role: 'group', 'aria-label': 'Scroll the map sideways' }); sNav.hidden = true;
  const sLeft = el('button', null, '◀', { type: 'button', 'aria-label': 'Scroll the map left', title: 'Scroll left' });
  const sRight = el('button', null, '▶', { type: 'button', 'aria-label': 'Scroll the map right', title: 'Scroll right' });
  const sPos = el('span', 'map-scrollpos', null, { 'aria-hidden': 'true' }), sThumb = el('i'); sPos.append(sThumb);
  const sTxt = el('span', 'map-scrolltxt', 'Scroll for more');
  sNav.append(sLeft, sPos, sRight, sTxt);
  const nudge = (dir) => { if (scroll) scroll.scrollBy ? scroll.scrollBy({ left: dir * Math.max(80, scroll.clientWidth * 0.6), behavior: 'auto' }) : (scroll.scrollLeft += dir * scroll.clientWidth * 0.6); syncScrollNav(); };
  sLeft.addEventListener('click', () => nudge(-1)); sRight.addEventListener('click', () => nudge(1));
  function syncScrollNav() {
    const over = !!scroll && scroll.scrollWidth > scroll.clientWidth + 2;
    sNav.hidden = !over;
    if (!over) return;
    const sw = scroll.scrollWidth, cwid = scroll.clientWidth;
    sThumb.style.left = `${(scroll.scrollLeft / sw) * 100}%`; sThumb.style.width = `${Math.max(4, (cwid / sw) * 100)}%`;
    sLeft.disabled = scroll.scrollLeft <= 1; sRight.disabled = scroll.scrollLeft + cwid >= sw - 1;
    sTxt.textContent = `Scroll for more: showing ${Math.round(scroll.scrollLeft / sw * 100)}% to ${Math.min(100, Math.round((scroll.scrollLeft + cwid) / sw * 100))}% of the map`;
  }
  if (parent && parent.insertBefore) { parent.insertBefore(sNav, canvas); parent.insertBefore(scroll, canvas); scroll.append(canvas); }
  scroll.addEventListener('scroll', syncScrollNav);

  // ---- controls
  const bar = el('div', 'map-bar');
  const nav = el('nav', 'map-crumbs', null, { 'aria-label': 'Spectrum map zoom level' });
  const back = el('button', null, 'All bands', { type: 'button', title: 'Back to the whole compressed axis (key 0 or Backspace on the map)' });
  const crumb = el('span', 'map-crumb', '', { 'aria-current': 'page' });
  nav.append(back, crumb);
  const widthBox = el('fieldset', 'map-width'); widthBox.append(el('legend', null, 'TV channel width (whole project)'));
  const radios = {};
  for (const [v, label] of [[8, '8 MHz (UK, Europe, Australia)'], [6, '6 MHz (North America)']]) {
    const lab = el('label'); const r = el('input', null, null, { type: 'radio', name: 'tv-width-map', value: String(v) });
    r.addEventListener('change', () => { setTvChannelWidth(store, v); refresh(); });
    radios[v] = r; lab.append(r, doc.createTextNode ? doc.createTextNode(` ${label}`) : el('span', null, ` ${label}`)); widthBox.append(lab);
  }
  const chk = (label, key, onch) => { const lab = el('label'); const c = el('input', null, null, { type: 'checkbox' }); c.addEventListener('change', () => { st[key] = !!c.checked; onch && onch(); refresh(); }); lab.append(c, el('span', null, ` ${label}`)); return { lab, c }; };
  const tvChk = chk('Show TV channels', 'showTv');
  const occChk = chk(`Show simulated occupancy (${ILLUSTRATIVE.toLowerCase()})`, 'showOcc');
  const riseChk = chk('Show TV carrier rise in the noise floor', 'showRise');
  const occSel = el('select', null, null, { 'aria-label': `Simulated occupancy setting, ${ILLUSTRATIVE.toLowerCase()}` });
  occSel.addEventListener('change', () => { st.occ[width()] = occSel.value; refresh(); });
  const envSel = el('select', null, null, { 'aria-label': 'Noise environment for the simulated noise floor' });
  for (const [v, t] of ENVIRONMENTS) { const o = el('option', null, t, { value: v }); envSel.append(o); }
  envSel.addEventListener('change', () => { st.env = envSel.value; refresh(); });
  const fitChk = chk('Fit the whole axis to the window when it stays readable (untick for full size and scroll)', 'fit');
  const scrollHint = el('p', 'map-scrollhint', '', { role: 'status' });
  const illus = el('p', 'map-illus', `${ILLUSTRATIVE}: TV occupancy and the noise floor are simulated to show how the tools look, not measurements of any site.`, { role: 'note' });
  bar.append(nav, widthBox, fitChk.lab, tvChk.lab, occChk.lab, occSel, riseChk.lab, envSel);
  // TV block level for one channel (dBm at the receiver): set, clear, clear all. Writes scene.tvBlockLevelsDbm through the actions.
  const LIM = TV_BLOCK_LEVEL_LIMITS;
  const tvBox = el('fieldset', 'map-tvlevel'); tvBox.append(el('legend', null, 'TV carrier level for one channel (dBm at the receiver)'));
  const tvChanIn = el('input', 'map-num', null, { type: 'number', min: String(LIM.channel[0]), max: String(LIM.channel[1]), step: '1', inputmode: 'numeric', 'aria-label': 'TV channel number' });
  const tvDbmIn = el('input', 'map-num', null, { type: 'number', min: String(LIM.dbm[0]), max: String(LIM.dbm[1]), step: '1', inputmode: 'decimal', 'aria-label': `TV block level in dBm, ${LIM.dbm[0]} to ${LIM.dbm[1]}` });
  const lab1 = el('label'); lab1.append(el('span', null, 'Channel '), tvChanIn);
  const lab2 = el('label'); lab2.append(el('span', null, 'Level, dBm '), tvDbmIn);
  const tvSet = el('button', null, 'Set level', { type: 'button', title: 'Use this level for the channel instead of the assumed one (undo restores it)' });
  const tvClear = el('button', null, 'Clear', { type: 'button', title: 'Go back to the assumed level for this channel' });
  const tvClearAll = el('button', null, 'Clear all', { type: 'button', title: 'Go back to the assumed level on every channel' });
  const tvStatus = el('p', 'map-tvstatus', '', { role: 'status', 'aria-live': 'polite' });
  tvBox.append(lab1, lab2, tvSet, tvClear, tvClearAll, tvStatus);
  const chanNow = () => { const n = Math.round(Number(tvChanIn.value)); return tvChanIn.value !== '' && Number.isInteger(n) && n >= LIM.channel[0] && n <= LIM.channel[1] ? n : null; };
  const syncTv = () => {
    const lv = tvBlockLevelsOf(store.getScene()), n = chanNow(), cnt = Object.keys(lv).length;
    tvClearAll.disabled = !cnt; tvClear.disabled = n === null || tvBlockLevelIsAssumed(n, lv);
    if (n === null) { tvStatus.textContent = `Enter a TV channel number, ${LIM.channel[0]} to ${LIM.channel[1]}, or click a channel on the map. ${cnt} channel${cnt === 1 ? '' : 's'} set by you.`; return; }
    const set = !tvBlockLevelIsAssumed(n, lv);
    tvStatus.textContent = `Channel ${n}: ${tvBlockLevelDbm(n, lv).toFixed(0)} dBm, ${set ? 'set by you' : 'assumed'}. ${cnt} channel${cnt === 1 ? '' : 's'} set by you. A level only changes the noise floor while its channel is shown as on air.`;
  };
  const selectTv = (n) => { st.tvSel = n; tvChanIn.value = n === null ? '' : String(n); tvDbmIn.value = n === null ? '' : String(Math.round(tvBlockLevelDbm(n, tvBlockLevelsOf(store.getScene())))); syncTv(); };
  tvChanIn.addEventListener('change', () => selectTv(chanNow()));
  const say = (t) => { syncTv(); tvStatus.textContent = `${t} ${tvStatus.textContent}`; };
  const doSet = () => {
    const n = chanNow(), v = Number(tvDbmIn.value);
    if (n === null) { tvStatus.textContent = `Enter a TV channel number, ${LIM.channel[0]} to ${LIM.channel[1]}.`; return; }
    if (tvDbmIn.value === '' || !Number.isFinite(v) || v < LIM.dbm[0] || v > LIM.dbm[1]) { tvStatus.textContent = `The level must be between ${LIM.dbm[0]} and ${LIM.dbm[1]} dBm.`; return; }
    setTvBlockLevel(store, n, v); refresh(); say(`Channel ${n} set to ${v} dBm by you.`);
  };
  tvSet.addEventListener('click', doSet);
  tvDbmIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSet(); } });
  tvClear.addEventListener('click', () => { const n = chanNow(); if (n === null) return; setTvBlockLevel(store, n, null); refresh(); say(`Channel ${n} is back to the assumed level.`); });
  tvClearAll.addEventListener('click', () => { clearTvBlockLevels(store); refresh(); say('All TV levels are back to the assumed ones.'); });
  const legend = el('p', 'map-legend', '', { role: 'status', 'aria-label': 'Noise floor legend' });

  const segList = el('details', 'map-list'); segList.append(el('summary', null, 'Zoom to a segment (keyboard list)'));
  const segWrap = el('div', 'map-btns'); segList.append(segWrap);
  for (const s of axisLayout().segments) {
    const b = el('button', null, `${s.id} ${s.startMHz}-${s.endMHz}`, { type: 'button', title: `Zoom to ${segLabel(s.id)}` });
    b.addEventListener('click', () => zoomTo(s.id)); segWrap.append(b);
  }
  const bandList = el('details', 'map-list'); bandList.append(el('summary', null, 'Bands in this view (keyboard list, opens the info panel)'));
  const bandWrap = el('div', 'map-btns'); bandList.append(bandWrap);
  const warn = el('p', 'map-warn', '', { role: 'status' });
  const info = el('div', 'map-info', null, { role: 'region', 'aria-label': 'Band information', 'aria-live': 'polite', tabindex: '-1' });
  const note = el('p', 'hint', 'Gaps between segments are removed and shown as // so one axis reaches 5.8 GHz. Click a segment name to zoom in, or a band for its details. Regional rules differ.');
  zoom.slot.append(bar, legend, tvBox, scrollHint, illus, warn, note, segList, bandList, info);

  function showInfo(hit) {
    info.textContent = '';
    const data = infoFor(hit, map || build());
    if (!data) { info.append(el('p', 'hint', 'Click a band or a project frequency on the map for its details.')); return; }
    st.selected = hit.kind === 'band' ? hit.id : null;
    info.append(el('h3', null, data.title));
    if (data.flag) info.append(el('p', 'map-flag', `Flag ${data.flag}`, { 'data-flag': data.flag }));
    for (const l of data.lines) info.append(el('p', null, l));
  }
  function zoomTo(id) { st.segId = id; st.hoverPx = null; if (scroll) scroll.scrollLeft = 0; refresh(); }
  back.addEventListener('click', () => zoomTo(null));

  function refresh() {
    if (!zoom.isOpen()) return;
    map = build();
    canvas.style.width = `${map.width}px`; canvas.style.height = `${map.height}px`;
    const w = map.tvWidth;
    for (const k of Object.keys(radios)) radios[k].checked = Number(k) === w;
    fitChk.c.checked = st.fit; fitChk.c.disabled = !!st.segId;
    scrollHint.textContent = map.width > cw() + 2 ? `Scroll sideways: the map is ${Math.round(map.width)} px wide and the window shows ${cw()} px. Use the zoom buttons below to jump to a segment.` : (!st.segId && map.view.k !== 1 ? `Whole axis fitted to the window (scale ${map.view.k.toFixed(2)}); untick Fit for full size.` : '');
    tvChk.c.checked = st.showTv; occChk.c.checked = st.showOcc; occChk.c.disabled = !st.showTv; riseChk.c.checked = st.showRise; riseChk.c.disabled = !st.showTv || !st.showOcc;
    const nz = map.noise;
    legend.textContent = nz.riseShown ? `Noise floor legend: the black line is the simulated floor in 200 kHz. Amber blocks are TV channels on air in the simulated occupancy: a TV carrier raises the floor across its full ${map.tvWidth} MHz channel, by ${Math.min(...nz.rises.map((r) => r.riseDb)).toFixed(0)} to ${Math.max(...nz.rises.map((r) => r.riseDb)).toFixed(0)} dB here. TV power at the receiver: ${nz.assumedCount ? `${nz.assumedCount} channel${nz.assumedCount === 1 ? '' : 's'} assumed (${nz.assumedBlockDbm} dBm, +-3 dB)` : ''}${nz.assumedCount && nz.userSetCount ? ' and ' : ''}${nz.userSetCount ? `${nz.userSetCount} channel${nz.userSetCount === 1 ? '' : 's'} set by you` : ''}. Assumed levels are illustrative, not measured.` : '';
    syncTv();
    occSel.textContent = '';
    for (const k of occupancyChoices(w)) occSel.append(el('option', null, k, { value: k }));
    occSel.value = st.occ[w]; occSel.disabled = !st.showTv || !st.showOcc;
    envSel.value = st.env;
    back.disabled = !st.segId; crumb.textContent = st.segId ? ` > ${segLabel(st.segId)}` : ' (whole axis)';
    bandWrap.textContent = '';
    for (const b of map.bands) { const bt = el('button', null, `${b.band.flag} ${b.band.label}`, { type: 'button' }); bt.addEventListener('click', () => { showInfo({ kind: 'band', id: b.band.id }); zoom.update(); }); bandWrap.append(bt); }
    warn.textContent = map.overlaps.length
      ? `Overlap warning: ${map.overlaps.map((o) => { const a = map.markers.concat(map.offAxis).find((m) => m.id === o.a), b = map.markers.concat(map.offAxis).find((m) => m.id === o.b); return `${a ? a.name : o.a} and ${b ? b.name : o.b} are ${+o.separationKHz.toFixed(1)} kHz apart`; }).join('; ')} (under 200 kHz, a coordination hint only).`
      : '';
    if (map.offAxis.length) warn.textContent += `${warn.textContent ? ' ' : ''}Not on this view: ${map.offAxis.map((p) => `${p.name} ${+p.freqMHz.toFixed(3)} MHz`).join(', ')}.`;
    syncScrollNav();
    zoom.update();
  }
  let subTimer = null; // like the other dialogs: one refresh 120 ms after the last store change
  const subOff = store.subscribe ? store.subscribe(() => { if (subTimer) return; subTimer = setTimeout(() => { subTimer = null; refresh(); }, 120); }) : null;

  // ---- pointer and keyboard on the canvas
  const local = (e) => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  canvas.addEventListener('pointermove', (e) => { const p = local(e); st.hoverPx = p.x; if (map) canvas.style.cursor = hitAt(map, p.x, p.y) ? 'pointer' : 'crosshair'; });
  canvas.addEventListener('pointerleave', () => { st.hoverPx = null; });
  const activate = (hit) => {
    if (!hit) return;
    if (hit.kind === 'segment') zoomTo(hit.id);
    else if (hit.kind === 'tv') { st.selected = null; showInfo(hit); selectTv(hit.n); zoom.update(); }
    else { showInfo(hit); zoom.update(); }
  };
  canvas.addEventListener('click', (e) => { if (!map) return; const p = local(e); activate(hitAt(map, p.x, p.y)); });
  canvas.addEventListener('keydown', (e) => {
    if (!zoom.isOpen()) return;
    if (e.key === '0' || e.key === 'Backspace') { zoomTo(null); }
    else if (e.key === 'Enter' || e.key === ' ') {
      const hv = zoom.state.hover(); if (hv === null || !map) return;
      const seg = map.view.segments.find((s) => hv >= s.px0 && hv <= s.px1);
      if (!map.view.segId && seg) zoomTo(seg.id); else { const hit = map.hits.find((h) => h.kind === 'band' && hv >= h.x0 && hv <= h.x1); if (hit) { showInfo(hit); zoom.update(); } else return; }
    } else return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  let ro = null;
  if (typeof ResizeObserver === 'function' && scroll) { ro = new ResizeObserver(() => refresh()); ro.observe(scroll); }

  function open() {
    st.segId = null; st.selected = null; info.textContent = '';
    zoom.open('map', button);
    showInfo(null); refresh();
    if (button && button.setAttribute) button.setAttribute('aria-expanded', 'true');
  }
  if (button) { button.addEventListener('click', open); button.setAttribute('aria-haspopup', 'dialog'); }
  dlg.addEventListener('close', () => { if (button && button.setAttribute) button.setAttribute('aria-expanded', 'false'); });
  return { open, zoom, state: st, refresh, zoomTo, showInfo, get map() { return map; }, destroy() { if (subOff) subOff(); if (subTimer) clearTimeout(subTimer); if (ro) ro.disconnect(); zoom.destroy(); } };
}
