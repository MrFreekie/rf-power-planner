// Coordination lab model (item 29). Pure functions on top of coordination.js (search, checkIntermod) and imd.js (productFrequencies).
// Same rules as the planner: third-order products 2 fi - fj (2-tx) and fi + fj - fk (3-tx) are a conflict when they land strictly closer than
// guardKHz to the centre of any used channel; channels must be at least minSpacingKHz apart. Fifth order is information only.
// Counting rule (matches coordination.js and the IMD panel's distinct count): one hit = one distinct product frequency label of one set; the same
// frequency reached through two mechanisms (front end and transmitter reverse) is NOT counted twice (imd.js coordinationCheck counts both, see
// imdSummary.inChannelThirdOrderDistinctCount for the matching panel figure). Planning estimates only.

import { productFrequencies } from './imd.js';
import { checkIntermod, coordinateFrequencies, COORDINATION_DEFAULTS } from './coordination.js';
import { REGIONS, regionBand } from './bands.js';

const toK = (mhz) => Math.round(mhz * 1000);
const kHzBetween = (a, b) => Math.round(Math.abs(a - b) * 1e9) / 1e6; // rounded so 399.99999999 does not read as < 400
const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const guardOf = (o) => (Number.isFinite(o && o.guardKHz) ? o.guardKHz : COORDINATION_DEFAULTS.guardKHz);
const spacingOf = (o) => (Number.isFinite(o && o.minSpacingKHz) ? o.minSpacingKHz : COORDINATION_DEFAULTS.minSpacingKHz);

/**
 * planHits(freqsMHz, { guardKHz = 400, minSpacingKHz = 300, kinds?, fifth = false })
 *   -> { ok, hits2, hits3, hitsTotal, fifthOrderHits, conflicts, spacingViolations, minProductDistanceKHz, minSpacingKHz, marginKHz, guardKHz }
 * hits2 = distinct 2-transmitter third-order products (2 fi - fj) inside the guard of a used channel, hits3 = 3-transmitter ones (fi + fj - fk).
 * conflicts = checkIntermod conflicts ({ label, fMHz, kind '2-tone'|'3-tone', tones, channelIndex, offsetKHz, cross }).
 */
export function planHits(freqsMHz, opts = {}) {
  const guardKHz = guardOf(opts), minSpacingKHz = spacingOf(opts);
  const chk = checkIntermod(freqsMHz, { guardKHz, minSpacingKHz, kinds: opts.kinds, orders: opts.fifth ? [3, 5] : [3] });
  const hits2 = chk.conflicts.filter((c) => c.kind === '2-tone').length, hits3 = chk.conflicts.filter((c) => c.kind === '3-tone').length;
  return {
    ok: chk.ok, hits2, hits3, hitsTotal: hits2 + hits3, fifthOrderHits: chk.fifthOrderHits, conflicts: chk.conflicts, spacingViolations: chk.spacingViolations,
    minProductDistanceKHz: chk.minProductDistanceKHz, minSpacingKHz: chk.minSpacingKHz, marginKHz: chk.marginKHz, guardKHz,
  };
}

/** equalSpacingPlan(n, startMHz, stepKHz) -> n frequencies at equal spacing: the textbook bad plan (f1 + f3 - f2 lands on f2's neighbour grid). */
export const equalSpacingPlan = (n, startMHz, stepKHz) => Array.from({ length: Math.max(0, Math.floor(n)) }, (_, i) => Math.round((startMHz + (i * stepKHz) / 1000) * 1e6) / 1e6);

/** tvOccupiedBlocked(channels) -> [{ fromMHz, toMHz, label }] for the occupied entries of spectrum-map simulatedOccupancy(...).channels (illustrative occupancy). */
export const tvOccupiedBlocked = (channels) => asArray(channels).filter((c) => c && c.occupied).map((c) => ({ fromMHz: c.loMHz, toMHz: c.hiMHz, label: `TV ch ${c.n}` }));

/**
 * candidateFrequencies({ regionId, band, rangeIds, kind = 'mic', rasterKHz, channelBwKHz = 200, edgeGuardKHz, blocked, maxCandidates = 4000 })
 *   -> { frequenciesMHz[], total, blockedCount, thinned, segments }
 * Raster points of the band (band = [{startMHz, endMHz, rasterKHz?}] or the region ranges via bands.js regionBand), minus the region blocked ranges and the
 * extra `blocked` ranges (TV channels in use) widened by half a channel. Thinned to every k-th point when it exceeds maxCandidates.
 */
export function candidateFrequencies(req = {}) {
  const region = req.regionId ? REGIONS[req.regionId] || null : null;
  const bw = Number.isFinite(req.channelBwKHz) ? req.channelBwKHz : COORDINATION_DEFAULTS.channelBwKHz;
  const raster = Number.isFinite(req.rasterKHz) ? req.rasterKHz : region ? region.rasterKHz : COORDINATION_DEFAULTS.rasterKHz;
  const edge = Number.isFinite(req.edgeGuardKHz) ? req.edgeGuardKHz : bw / 2;
  const segs = req.band ? asArray(req.band) : region ? regionBand(region.id, req.rangeIds, req.kind || 'mic', req.bandGroup || 'uhf') : [];
  const blocked = [...(region && !req.ignoreRegionBlocked ? region.blocked.filter((b) => !b.onlyOutdoor || req.outdoor) : []), ...asArray(req.blocked)]
    .map((b) => [toK(b.fromMHz) - bw / 2, toK(b.toMHz) + bw / 2]);
  const set = new Set();
  let total = 0, blockedCount = 0;
  for (const s of segs) {
    const r = Math.max(1, Math.round(s.rasterKHz || raster));
    const lo = toK(s.startMHz) + edge, hi = toK(s.endMHz) - edge;
    for (let c = Math.ceil(lo / r) * r; c <= hi; c += r) {
      total++;
      if (blocked.some(([a, b]) => c > a && c < b)) { blockedCount++; continue; }
      set.add(c);
    }
  }
  let list = [...set].sort((a, b) => a - b);
  const cap = Math.max(1, Math.floor(req.maxCandidates || 4000));
  const thinned = list.length > cap;
  if (thinned) { const k = Math.ceil(list.length / cap); list = list.filter((_, i) => i % k === 0); }
  return { frequenciesMHz: list.map((k) => k / 1000), total, blockedCount, thinned, segments: segs };
}

/**
 * evaluateCandidates({ fixedMHz | fixed: [{ id?, freqMHz, kind? }], candidatesMHz, guardKHz = 400, minSpacingKHz = 300, channelBwKHz = 200, blocked })
 *   -> [{ freqMHz, ok, hits2, hits3, hitsTotal, nearestKHz, minProductDistanceKHz, reasons: [{ code, message, ... }], explanation, rank }]
 * Each candidate is tried as one more channel next to the fixed ones. hits2 / hits3 count the third-order products of fixed + candidate that involve the
 * candidate as a tone OR land on the candidate channel, and fall strictly inside the guard of a used channel (the candidate included).
 * reason codes: 'blocked' (inside a blocked range or TV channel in use, widened by half a channel), 'spacing' (closer than minSpacingKHz to a fixed channel),
 * 'product-on-fixed' (a product made with the candidate lands on a fixed channel), 'product-on-candidate' (a product of the fixed set, or with the candidate,
 * lands on the candidate), 'duplicate' (same frequency as a fixed channel). `rank` 1 = best among the ok candidates (fewest hits is always 0 for ok, so ranked
 * by clearance: larger minProductDistanceKHz, then larger nearestKHz); null when not ok.
 */
export function evaluateCandidates(req = {}) {
  const guard = guardOf(req), spacing = spacingOf(req);
  const bw = Number.isFinite(req.channelBwKHz) ? req.channelBwKHz : COORDINATION_DEFAULTS.channelBwKHz;
  const fixed = Array.isArray(req.fixed) ? req.fixed.map((f, i) => ({ id: f.id ?? `fixed${i + 1}`, freqMHz: f.freqMHz })) : asArray(req.fixedMHz).map((f, i) => ({ id: `fixed${i + 1}`, freqMHz: f }));
  const fMHz = fixed.map((f) => f.freqMHz);
  const blocked = asArray(req.blocked);
  const rows = asArray(req.candidatesMHz).map((c) => {
    const set = [...fMHz, c], ci = set.length - 1;
    const reasons = [];
    const b = blocked.find((x) => c > x.fromMHz - bw / 2000 && c < x.toMHz + bw / 2000);
    if (b) reasons.push({ code: 'blocked', label: b.label || null, message: `Inside a blocked range${b.label ? ` (${b.label})` : ''}: ${b.fromMHz}-${b.toMHz} MHz plus half a channel.` });
    let nearestKHz = null, nearestId = null;
    fixed.forEach((f) => { const d = kHzBetween(c, f.freqMHz); if (nearestKHz === null || d < nearestKHz) { nearestKHz = d; nearestId = f.id; } });
    if (nearestKHz === 0) reasons.push({ code: 'duplicate', with: nearestId, message: `Same frequency as ${nearestId}.` });
    else if (nearestKHz !== null && nearestKHz < spacing) reasons.push({ code: 'spacing', with: nearestId, spacingKHz: nearestKHz, message: `${nearestKHz} kHz from ${nearestId}, closer than the ${spacing} kHz minimum spacing.` });
    let hits2 = 0, hits3 = 0, minDist = null;
    const onFixed = [], onCand = [];
    if (set.length >= 2) {
      for (const p of productFrequencies(set, [3])) {
        let bi = -1, bd = Infinity;
        set.forEach((f, i) => { const d = kHzBetween(p.fMHz, f); if (d < bd) { bd = d; bi = i; } });
        if (p.tones.includes(ci) || bi === ci) { if (minDist === null || bd < minDist) minDist = bd; }
        if (bd >= guard) continue;
        if (!(p.tones.includes(ci) || bi === ci)) continue; // an existing conflict between fixed channels is not the candidate's fault
        if (p.tones.length === 2) hits2++; else hits3++;
        const item = { label: p.label, fMHz: p.fMHz, kind: p.tones.length === 2 ? '2-tone' : '3-tone', offsetKHz: Math.round((p.fMHz - set[bi]) * 1e6) / 1e3 };
        if (bi === ci) onCand.push(item); else onFixed.push({ ...item, channel: fixed[bi].id });
      }
    }
    if (onCand.length) reasons.push({ code: 'product-on-candidate', products: onCand, message: `${onCand.length} third-order product(s) land on this channel, for example ${onCand[0].label} at ${onCand[0].fMHz.toFixed(3)} MHz (${Math.abs(onCand[0].offsetKHz)} kHz off centre).` });
    if (onFixed.length) reasons.push({ code: 'product-on-fixed', products: onFixed, message: `${onFixed.length} product(s) made with this channel land on ${[...new Set(onFixed.map((x) => x.channel))].join(', ')}, for example ${onFixed[0].label} at ${onFixed[0].fMHz.toFixed(3)} MHz.` });
    const ok = reasons.length === 0;
    return {
      freqMHz: c, ok, hits2, hits3, hitsTotal: hits2 + hits3, nearestKHz, minProductDistanceKHz: minDist, reasons, rank: null,
      explanation: ok ? 'Clear: no third-order product lands on any channel and spacing is respected.' : `${reasons.map((r) => r.message).join(' ')} (In product labels f1..f${ci} are the fixed channels in order and f${ci + 1} is this candidate.)`,
    };
  });
  const good = rows.filter((r) => r.ok).sort((a, b) => (b.minProductDistanceKHz ?? 1e9) - (a.minProductDistanceKHz ?? 1e9) || (b.nearestKHz ?? 1e9) - (a.nearestKHz ?? 1e9) || a.freqMHz - b.freqMHz);
  good.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

/** bestCandidates(rows, n = 5) -> the n best ok rows from evaluateCandidates, best first. */
export const bestCandidates = (rows, n = 5) => rows.filter((r) => r.ok).sort((a, b) => a.rank - b.rank).slice(0, n);

/**
 * bestPlan({ fixed: [{ id, freqMHz, kind? }] (kept), mics, iems | need (counts of new), ...coordinateFrequencies options (regionId, band, blocked, seed, ...) })
 *   -> coordinateFrequencies result + { lab: { hits2, hits3, ..., planHits of the final set }, candidates: { total, blockedCount, thinned } }
 * Wraps the planner's search (same engine, same verification) with the fixed channels locked, and adds the lab's hit counts for the final set.
 */
export function bestPlan(req = {}) {
  const fixed = asArray(req.fixed).map((f, i) => ({ id: f.id ?? `fixed${i + 1}`, name: f.name, kind: f.kind === 'iem' ? 'iem' : 'mic', freqMHz: f.freqMHz, locked: true }));
  const free = [];
  for (let i = 0; i < Math.max(0, Math.floor(req.mics || 0)); i++) free.push({ id: `mic${i + 1}`, name: `Mic ${i + 1}`, kind: 'mic' });
  for (let i = 0; i < Math.max(0, Math.floor(req.iems || 0)); i++) free.push({ id: `iem${i + 1}`, name: `IEM ${i + 1}`, kind: 'iem' });
  const { fixed: _f, mics: _m, iems: _i, ...rest } = req;
  const res = coordinateFrequencies({ ...rest, transmitters: [...fixed, ...free] });
  const used = res.frequencies.map((f) => f.freqMHz).filter((f) => f !== null);
  const cand = candidateFrequencies({ ...rest, kind: 'mic' });
  return { ...res, lab: planHits(used, { guardKHz: res.guardKHz, minSpacingKHz: res.minSpacingKHz, fifth: true }), candidates: { total: cand.total, blockedCount: cand.blockedCount, thinned: cand.thinned, count: cand.frequenciesMHz.length } };
}

/** failureSummary(rows) -> { total, ok, byReason: { code: count } }: why the candidate list is short (a row with several reasons counts for each). */
export function failureSummary(rows) {
  const byReason = {};
  rows.forEach((r) => r.reasons.forEach((x) => { byReason[x.code] = (byReason[x.code] || 0) + 1; }));
  return { total: rows.length, ok: rows.filter((r) => r.ok).length, byReason };
}
