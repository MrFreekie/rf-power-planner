// Frequency coordination generator: choose carrier frequencies for N microphones and M IEM transmitters so that no third-order
// intermodulation product lands on a used channel. Pure module (no DOM, no Math.random: output is deterministic for a seed).
//
// Physics used (same maths as imd.js, whose productFrequencies() is used for the verification pass):
//   two-tone third order   f = 2 fi - fj
//   three-tone third order f = fi + fj - fk        (i, j, k distinct)
// A product is a conflict when it falls within guardKHz of the centre of ANY used channel (strictly less than the guard).
// One shared set is used for mics and IEMs, so IEM-to-mic (and mic-to-IEM) cross products are covered: a product made of any
// mix of tones that lands on any channel counts. Channels must also be at least minSpacingKHz apart. Because 2 fi - fj sits
// |fi - fj| away from fi, an effective spacing below guardKHz is rejected by the product test itself.
//
// Search: greedy, one channel at a time, on an integer kHz grid. Adding channels only adds constraints, so a candidate that is
// rejected once is rejected for the rest of that attempt (single forward pass). The search first asks for a larger clearance
// (2x, 1.5x, 1.25x the guard) so the result has margin, then falls back to the exact guard and to ordered (compact) packing.
// Fifth-order products are not part of the pass/fail rule; their count is reported as information.
//
// Planning estimates only: check local licensing and regulations before use (see bands.js).

import { productFrequencies } from './imd.js';
import { coordinationRules } from './imd-params.js';
import { REGIONS, regionBand, powerLimitFor, BANDS_DISCLAIMER } from './bands.js';

export const COORDINATION_DEFAULTS = Object.freeze({
  channelBwKHz: 200,
  rasterKHz: 25,
  minSpacingKHz: coordinationRules.minChannelSpacingKhz,                    // 300
  guardKHz: coordinationRules.minProductClearanceInBandwidths * 200,        // 2 bandwidths = 400
  attemptsPerLevel: 4,
  clearanceLevels: Object.freeze([2, 1.5, 1.25, 1]),
  budget: 8e7,                                                              // inner-loop steps before the search gives up
  seed: 1,
});

// ---------------------------------------------------------------- helpers

function seedToInt(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** mulberry32 PRNG, deterministic. */
function rng(seed) {
  let a = seedToInt(seed) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const toK = (mhz) => Math.round(mhz * 1000);
const toMHz = (k) => k / 1000;
const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

// ---------------------------------------------------------------- verification (uses imd.js)

/**
 * checkIntermod(freqsMHz, { guardKHz, minSpacingKHz, kinds?, orders = [3] })
 *   -> { ok, conflicts, spacingViolations, minProductDistanceKHz, minSpacingKHz, marginKHz, fifthOrderHits }
 * conflicts: [{ label, fMHz, order, tones[], kind: '2-tone'|'3-tone'|'5th', cross: boolean, channelIndex, offsetKHz }] for every
 * third-order product within guardKHz of a channel (cross = the product mixes a mic and an IEM, needs `kinds` per frequency).
 * minProductDistanceKHz = distance from the nearest third-order product to its nearest channel (null with fewer than 2 channels).
 * marginKHz = minProductDistanceKHz - guardKHz (>= 0 when ok). fifthOrderHits counts fifth-order products inside the guard (info).
 */
export function checkIntermod(freqsMHz, opts = {}) {
  const guard = Number.isFinite(opts.guardKHz) ? opts.guardKHz : COORDINATION_DEFAULTS.guardKHz;
  const spacing = Number.isFinite(opts.minSpacingKHz) ? opts.minSpacingKHz : COORDINATION_DEFAULTS.minSpacingKHz;
  const kinds = opts.kinds || null;
  const n = freqsMHz.length;
  const conflicts = [];
  let minDist = Infinity;
  const nearest = (f) => {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.round(Math.abs(f - freqsMHz[i]) * 1e9) / 1e6; // kHz, rounded so 399.99999999 does not read as < 400
      if (d < bd) { bd = d; bi = i; }
    }
    return { i: bi, d: bd };
  };
  for (const p of productFrequencies(freqsMHz, [3])) {
    const { i, d } = nearest(p.fMHz);
    if (d < minDist) minDist = d;
    if (d < guard) {
      const cross = !!kinds && new Set(p.tones.map((t) => kinds[t])).size > 1;
      conflicts.push({
        label: p.label, fMHz: p.fMHz, order: 3, tones: p.tones, kind: p.tones.length === 2 ? '2-tone' : '3-tone',
        cross, channelIndex: i, offsetKHz: Math.round((p.fMHz - freqsMHz[i]) * 1e9) / 1e6,
      });
    }
  }
  let fifth = 0;
  if ((opts.orders || [3]).includes(5)) {
    for (const p of productFrequencies(freqsMHz, [5])) if (nearest(p.fMHz).d < guard) fifth++;
  }
  const spacingViolations = [];
  const sorted = freqsMHz.map((f, i) => ({ f, i })).sort((a, b) => a.f - b.f);
  let minSp = Infinity;
  for (let k = 1; k < sorted.length; k++) {
    const dk = Math.round((sorted[k].f - sorted[k - 1].f) * 1e9) / 1e6;
    if (dk < minSp) minSp = dk;
    if (dk < spacing - 1e-6) spacingViolations.push({ a: sorted[k - 1].i, b: sorted[k].i, spacingKHz: dk });
  }
  const minProductDistanceKHz = Number.isFinite(minDist) ? minDist : null;
  return {
    ok: conflicts.length === 0 && spacingViolations.length === 0,
    conflicts, spacingViolations, minProductDistanceKHz,
    minSpacingKHz: Number.isFinite(minSp) ? minSp : null,
    marginKHz: minProductDistanceKHz === null ? null : minProductDistanceKHz - guard,
    fifthOrderHits: fifth,
  };
}

// ---------------------------------------------------------------- candidate grid

/** Candidate channel centres in integer kHz for segments [{startMHz,endMHz,rasterKHz?}], minus blocked ranges. Sorted, unique. */
function candidateGrid(segments, { rasterKHz, edgeGuardKHz, blocked, channelBwKHz }) {
  const half = channelBwKHz / 2;
  const blk = blocked.map((b) => [toK(b.fromMHz) - half, toK(b.toMHz) + half]);
  const set = new Set();
  let blockedCount = 0, total = 0;
  for (const s of segments) {
    const r = Math.max(1, Math.round(s.rasterKHz || rasterKHz));
    const lo = toK(s.startMHz) + edgeGuardKHz, hi = toK(s.endMHz) - edgeGuardKHz;
    for (let c = Math.ceil(lo / r) * r; c <= hi; c += r) {
      total++;
      if (blk.some(([a, b]) => c > a && c < b)) { blockedCount++; continue; }
      set.add(c);
    }
  }
  return { list: [...set].sort((a, b) => a - b), total, blocked: blockedCount };
}

// ---------------------------------------------------------------- incremental engine

/**
 * One packing attempt. groups = [{ cands: int[] (already in trial order), need }]; locked = ints already placed.
 * Returns { placed: { groupIndex: int[] }, count, ok, steps }.
 */
function attempt(groups, locked, { guard, spacing, lo, hi }, budget) {
  const base = lo - guard - 2, size = hi - lo + 2 * guard + 5;
  const D = new Uint8Array(size);   // 1 where a chosen channel lies within guard (strict)
  const F = new Uint8Array(size);   // 1 where an existing product lies within guard
  const chosen = [];
  let steps = 0;
  const mark = (arr, p) => {
    const a = Math.max(0, p - guard + 1 - base), b = Math.min(size - 1, p + guard - 1 - base);
    for (let i = a; i <= b; i++) arr[i] = 1;
  };
  const inD = (p) => { const i = p - base; return i >= 0 && i < size && D[i] === 1; };
  const eachNewProduct = (c, fn) => {
    const n = chosen.length;
    for (let i = 0; i < n; i++) {
      const a = chosen[i];
      if (fn(2 * c - a) === false) return false;
      if (fn(2 * a - c) === false) return false;
    }
    for (let i = 0; i < n; i++) {
      const a = chosen[i];
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (fn(c + a - chosen[j]) === false) return false;
      }
      for (let j = i + 1; j < n; j++) if (fn(a + chosen[j] - c) === false) return false;
    }
    return true;
  };
  const valid = (c) => {
    const ci = c - base;
    if (ci < 0 || ci >= size || F[ci] === 1) return false;
    for (let i = 0; i < chosen.length; i++) if (Math.abs(c - chosen[i]) < spacing) return false;
    steps += chosen.length * chosen.length + 1;
    return eachNewProduct(c, (p) => !inD(p) && Math.abs(p - c) >= guard);
  };
  const commit = (c) => {
    eachNewProduct(c, (p) => { const i = p - base; if (i >= 0 && i < size) mark(F, p); return true; });
    mark(D, c);
    chosen.push(c);
  };
  // locked channels: no validity test (checked separately), but they constrain everything else
  for (const c of locked) commit(c);
  const placed = groups.map(() => []);
  let count = 0, ok = true;
  for (let g = 0; g < groups.length && ok; g++) {
    const grp = groups[g];
    let cur = 0;
    while (placed[g].length < grp.need) {
      let found = -1;
      while (cur < grp.cands.length) {
        const c = grp.cands[cur++];
        if (steps > budget) break;
        if (valid(c)) { found = c; break; }
      }
      if (found < 0) { ok = false; break; }
      commit(found);
      placed[g].push(found);
      count++;
    }
  }
  return { placed, count, ok, steps };
}

// ---------------------------------------------------------------- request normalisation

/** Transmitters of a scene for coordination: source 'links' (default: every link, kind mic|iem) or 'imd' (scene.imd.transmitters, treated as mics). */
export function transmittersFromScene(scene, { source = 'links' } = {}) {
  if (source === 'imd') {
    return ((scene && scene.imd && scene.imd.transmitters) || []).map((t) => ({ id: t.id, name: t.name || t.id, kind: 'mic', freqMHz: t.freqMHz, source: 'imd' }));
  }
  return ((scene && scene.links) || []).map((l) => ({
    id: l.id, name: l.name || l.id, kind: l.kind === 'iem' ? 'iem' : 'mic', freqMHz: l.freqMHz, txId: l.tx && l.tx.id, source: 'link',
  }));
}

function normaliseTransmitters(req) {
  if (Array.isArray(req.transmitters)) {
    return req.transmitters.map((t, i) => ({
      id: t.id ?? `${t.kind === 'iem' ? 'iem' : 'mic'}${i + 1}`,
      name: t.name || t.id || `${t.kind === 'iem' ? 'IEM' : 'Mic'} ${i + 1}`,
      kind: t.kind === 'iem' ? 'iem' : 'mic',
      locked: !!t.locked && Number.isFinite(t.freqMHz),
      freqMHz: Number.isFinite(t.freqMHz) ? t.freqMHz : null,
      ...(t.txId !== undefined ? { txId: t.txId } : {}), ...(t.source ? { source: t.source } : {}),
    }));
  }
  const out = [];
  for (let i = 0; i < Math.max(0, Math.floor(req.mics || 0)); i++) out.push({ id: `mic${i + 1}`, name: `Mic ${i + 1}`, kind: 'mic', locked: false, freqMHz: null });
  for (let i = 0; i < Math.max(0, Math.floor(req.iems || 0)); i++) out.push({ id: `iem${i + 1}`, name: `IEM ${i + 1}`, kind: 'iem', locked: false, freqMHz: null });
  return out;
}

const scoreOf = (minProd, minSp, guard, spacing) => {
  const a = minProd === null ? 1 : minProd / (2 * guard);
  const b = minSp === null ? 1 : minSp / (2 * spacing);
  return Math.round(100 * Math.max(0, Math.min(1, a, b)) * 10) / 10;
};

// ---------------------------------------------------------------- public API

/**
 * coordinateFrequencies(req) -> Result
 * req (all optional except a way to say how many transmitters and where):
 *   mics, iems            counts, or
 *   transmitters          [{ id?, name?, kind: 'mic'|'iem', freqMHz?, locked? }]  locked + freqMHz keeps that frequency
 *   regionId              'uk' | 'eu' | 'us' (bands.js): supplies the band, raster, spacing, default blocked ranges
 *   band, iemBand         { startMHz, endMHz, rasterKHz? } or an array of them; iemBand defaults to band. Without band, regionId's ranges.
 *   rangeIds              limit a region to some of its range ids
 *   blocked               [{ fromMHz, toMHz, label? }] extra blocked ranges (TV channels in use, see tvChannelsToBlocked)
 *   minSpacingKHz (300), guardKHz (400), channelBwKHz (200), rasterKHz (25), edgeGuardKHz (channelBw / 2)
 *   seed (1), attemptsPerLevel (4), budget
 * Result = { ok, partial, frequencies: [{ id, name, kind, freqMHz, locked, powerLimit }], assignments: { id: freqMHz },
 *   guardKHz, minSpacingKHz, marginKHz, minProductDistanceKHz, minChannelSpacingKHz, score (0..100), conflicts, spacingViolations,
 *   fifthOrderHits, failure: null | { reason, message, ... }, notes[], disclaimer, seed, regionId }
 * score = 100 * min(1, minProductDistance / (2 guard), minChannelSpacing / (2 minSpacing)); marginKHz = minProductDistance - guard.
 * failure.reason: 'no-transmitters' | 'no-channels' | 'band-too-narrow' | 'locked-conflict' | 'no-intermod-free-set' | 'search-budget'.
 * On failure `frequencies` holds the best partial plan (partial: true, freqMHz null for the transmitters that could not be placed).
 */
export function coordinateFrequencies(req = {}) {
  const D = COORDINATION_DEFAULTS;
  const region = req.regionId ? REGIONS[req.regionId] || null : null;
  const channelBwKHz = Number.isFinite(req.channelBwKHz) ? req.channelBwKHz : D.channelBwKHz;
  const rasterKHz = Number.isFinite(req.rasterKHz) ? req.rasterKHz : (region ? region.rasterKHz : D.rasterKHz);
  const spacing = Number.isFinite(req.minSpacingKHz) ? req.minSpacingKHz : (region ? region.minSpacingKHz : D.minSpacingKHz);
  const guardKHz = Number.isFinite(req.guardKHz) ? req.guardKHz : D.guardKHz;
  const edgeGuardKHz = Number.isFinite(req.edgeGuardKHz) ? req.edgeGuardKHz : channelBwKHz / 2;
  const seed = req.seed ?? D.seed;
  const perLevel = Math.max(1, Math.floor(req.attemptsPerLevel || D.attemptsPerLevel));
  const budget = Number.isFinite(req.budget) ? req.budget : D.budget;
  const blocked = [...(region && !req.ignoreRegionBlocked ? region.blocked : []), ...asArray(req.blocked)];
  const notes = [];

  const tx = normaliseTransmitters(req);
  const base = {
    ok: false, partial: false, frequencies: [], assignments: {}, guardKHz, minSpacingKHz: spacing, marginKHz: null,
    minProductDistanceKHz: null, minChannelSpacingKHz: null, score: 0, conflicts: [], spacingViolations: [], fifthOrderHits: 0,
    failure: null, notes, disclaimer: BANDS_DISCLAIMER, seed, regionId: region ? region.id : null,
  };
  const fail = (reason, message, extra = {}, frequencies = []) => ({
    ...base, partial: frequencies.some((f) => f.freqMHz !== null), frequencies, failure: { reason, message, ...extra },
  });
  if (!tx.length) return fail('no-transmitters', 'Nothing to coordinate: give a number of microphones and IEMs, or a transmitter list.');

  // bands
  const bandOf = (kind) => {
    const given = kind === 'iem' && req.iemBand ? req.iemBand : req.band;
    if (given) return asArray(given);
    if (region) return regionBand(region.id, req.rangeIds, kind);
    return [];
  };
  const kinds = ['mic', 'iem'].filter((k) => tx.some((t) => t.kind === k && !t.locked));
  const needByKind = (k) => tx.filter((t) => t.kind === k && !t.locked).length;
  const grids = {};
  for (const k of kinds) {
    const segs = bandOf(k);
    if (!segs.length) return fail('no-channels', `No band given for ${k === 'iem' ? 'IEMs' : 'microphones'}. Pass a band or a regionId.`, { kind: k });
    grids[k] = { segs, ...candidateGrid(segs, { rasterKHz, edgeGuardKHz, blocked, channelBwKHz }) };
    if (!grids[k].list.length) {
      return fail('no-channels', `No channel fits for ${k === 'iem' ? 'IEMs' : 'microphones'}: the band is empty after the edge guard and blocked ranges (${grids[k].blocked} of ${grids[k].total} raster points blocked).`,
        { kind: k, rasterPoints: grids[k].total, blockedPoints: grids[k].blocked });
    }
  }

  // locked channels and their own consistency
  const lockedTx = tx.filter((t) => t.locked);
  const lockedMHz = lockedTx.map((t) => t.freqMHz);
  if (lockedMHz.length > 1) {
    const chk = checkIntermod(lockedMHz, { guardKHz, minSpacingKHz: spacing, kinds: lockedTx.map((t) => t.kind) });
    if (!chk.ok) return fail('locked-conflict', 'The frequencies you kept already conflict with each other (intermod or spacing). Unlock one of them.', { conflicts: chk.conflicts, spacingViolations: chk.spacingViolations });
  }

  // quick capacity bound: need a spacing between every pair, so the span must be at least (n - 1) * spacing for a single band
  const unlockedN = tx.length - lockedTx.length;
  const allCand = kinds.flatMap((k) => grids[k].list);
  if (unlockedN > 0) {
    const lo0 = Math.min(...allCand), hi0 = Math.max(...allCand);
    const spanKHz = hi0 - lo0;
    const unionCount = new Set(allCand).size;
    if (unionCount < tx.length || (kinds.length === 1 && spanKHz < (tx.length - 1) * spacing)) {
      return fail('band-too-narrow',
        `The usable band is too narrow for ${tx.length} channels at ${spacing} kHz spacing (needs at least ${(((tx.length - 1) * spacing) / 1000).toFixed(2)} MHz, has ${(spanKHz / 1000).toFixed(2)} MHz).`,
        { requestedChannels: tx.length, usableSpanMHz: spanKHz / 1000, minimumSpanMHz: ((tx.length - 1) * spacing) / 1000, rasterPoints: unionCount });
    }
  }

  const lockedK = lockedMHz.map(toK);
  const lo = Math.min(...allCand, ...lockedK, Infinity), hi = Math.max(...allCand, ...lockedK, -Infinity);
  const shuffled = (list, rand) => {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  // smaller candidate set first (it has fewer options)
  const order = kinds.slice().sort((a, b) => grids[a].list.length - grids[b].list.length || (a < b ? -1 : 1));

  let spent = 0, best = null, bestCount = -1;
  const run = (mult, mode, k) => {
    const rand = rng(`${seedToInt(seed)}:${mult}:${mode}:${k}`);
    const groups = order.map((kind) => ({
      kind, need: needByKind(kind),
      cands: mode === 'random' ? shuffled(grids[kind].list, rand) : mode === 'down' ? grids[kind].list.slice().reverse() : grids[kind].list.slice(),
    }));
    const res = attempt(groups, lockedK, { guard: Math.round(guardKHz * mult), spacing, lo, hi }, budget - spent);
    spent += res.steps;
    return { res, groups };
  };

  let winner = null;
  const plan = [];
  for (const mult of D.clearanceLevels) for (let k = 0; k < perLevel; k++) plan.push([mult, 'random', k]);
  plan.push([1, 'up', 0], [1, 'down', 0]);
  let levelDone = null, levelBest = null;
  for (const [mult, mode, k] of plan) {
    if (spent > budget) break;
    if (levelDone !== null && mult !== levelDone) break;  // a stricter level already worked: do not try looser ones
    const { res, groups } = run(mult, mode, k);
    if (res.count > bestCount) { bestCount = res.count; best = { res, groups }; }
    if (res.ok) {
      const freqs = [...lockedMHz];
      res.placed.forEach((p) => p.forEach((c) => freqs.push(toMHz(c))));
      const kindsArr = [...lockedTx.map((t) => t.kind), ...groups.flatMap((g, gi) => res.placed[gi].map(() => g.kind))];
      const chk = checkIntermod(freqs, { guardKHz, minSpacingKHz: spacing, kinds: kindsArr });
      if (!chk.ok) continue; // cannot happen when the engine and imd.js agree; never return an unverified plan
      const cand = { res, groups, chk };
      levelDone = mult;
      if (!levelBest || (chk.minProductDistanceKHz ?? 1e9) > (levelBest.chk.minProductDistanceKHz ?? 1e9)) levelBest = cand;
      winner = levelBest;
    }
  }

  const outRows = (placedByKind) => {
    const sortedBy = {};
    for (const k of kinds) sortedBy[k] = (placedByKind[k] || []).slice().sort((a, b) => a - b);
    const cursor = { mic: 0, iem: 0 };
    return tx.map((t) => {
      let f = t.freqMHz;
      if (!t.locked) {
        const arr = sortedBy[t.kind] || [];
        f = cursor[t.kind] < arr.length ? toMHz(arr[cursor[t.kind]++]) : null;
      }
      const pl = region && f !== null ? powerLimitFor(region.id, f) : null;
      const row = { id: t.id, name: t.name, kind: t.kind, freqMHz: f, locked: t.locked, powerLimit: pl };
      if (t.txId !== undefined) row.txId = t.txId;
      if (t.source) row.source = t.source;
      return row;
    });
  };
  const toByKind = (r, groups) => Object.fromEntries(groups.map((g, gi) => [g.kind, r.placed[gi]]));

  if (winner) {
    const frequencies = outRows(toByKind(winner.res, winner.groups));
    const used = frequencies.map((f) => f.freqMHz);
    const chk = checkIntermod(used, { guardKHz, minSpacingKHz: spacing, kinds: frequencies.map((f) => f.kind), orders: [3, 5] });
    if (winner.res && levelDone !== null && levelDone > 1) notes.push(`Found with ${levelDone}x the guard bandwidth, so there is extra clearance.`);
    if (chk.fifthOrderHits) notes.push(`${chk.fifthOrderHits} fifth-order product(s) fall inside the guard band; they are weaker than third order but check them if levels are high.`);
    notes.push('Planning estimate only: check local licensing, power limits and the TV channels in use at the venue.');
    return {
      ...base, ok: true, frequencies, assignments: Object.fromEntries(frequencies.map((f) => [f.id, f.freqMHz])),
      marginKHz: chk.marginKHz, minProductDistanceKHz: chk.minProductDistanceKHz, minChannelSpacingKHz: chk.minSpacingKHz,
      score: scoreOf(chk.minProductDistanceKHz, chk.minSpacingKHz, guardKHz, spacing), fifthOrderHits: chk.fifthOrderHits, notes,
    };
  }

  // failure: report the best partial plan and what would make it work
  const partialRows = best ? outRows(toByKind(best.res, best.groups)) : outRows({});
  const placedCount = partialRows.filter((r) => r.freqMHz !== null).length;
  const reason = spent > budget ? 'search-budget' : 'no-intermod-free-set';
  const suggestions = [];
  for (const f of [0.5, 0.25]) {
    if (guardKHz * f < rasterKHz) continue;
    const g = Math.round(guardKHz * f);
    const probe = (() => {
      const groups = order.map((kind) => ({ kind, need: needByKind(kind), cands: grids[kind].list.slice() }));
      return attempt(groups, lockedK, { guard: g, spacing, lo, hi }, Math.min(budget, 2e7));
    })();
    if (probe.ok) { suggestions.push(`A plan exists with the guard band reduced to ${g} kHz (less protection against wide FM products).`); break; }
  }
  const maxFit = best ? best.res.count + lockedTx.length : lockedTx.length;
  suggestions.push(`Try fewer transmitters (the search placed ${maxFit} of ${tx.length}), a wider band, fewer blocked ranges, or a smaller guard band.`);
  const failure = {
    reason,
    message: reason === 'search-budget'
      ? `The search stopped at its step limit after placing ${maxFit} of ${tx.length} channels. Raise the budget or relax the constraints.`
      : `No intermod-free set of ${tx.length} channels was found: the best attempt placed ${maxFit} (guard ${guardKHz} kHz, spacing ${spacing} kHz, ${allCand.length} candidate raster points).`,
    requestedChannels: tx.length, placedChannels: maxFit, candidatePoints: new Set(allCand).size, guardKHz, minSpacingKHz: spacing, suggestions,
  };
  return { ...base, partial: placedCount > 0, frequencies: partialRows, assignments: Object.fromEntries(partialRows.map((f) => [f.id, f.freqMHz])), failure, notes };
}

/** Coordinate the transmitters of a scene (links by default). `req` overrides/extends the request; `keep` = ids to lock at their current frequency. */
export function coordinateScene(scene, req = {}, { source = 'links', keep = [] } = {}) {
  const transmitters = transmittersFromScene(scene, { source }).map((t) => (keep.includes(t.id) ? { ...t, locked: true } : { ...t, freqMHz: null }));
  return coordinateFrequencies({ ...req, transmitters });
}

/**
 * sceneAssignments(result) -> [{ id, source: 'link'|'imd'|undefined, kind, freqMHz }] only for placed, non-locked rows:
 * what a GUI writes back (links: actions.setLinkField(store, id, 'freqMHz', f); imd: actions.updateImdTransmitter(store, id, { freqMHz: f })).
 */
export function sceneAssignments(result) {
  return (result.frequencies || []).filter((r) => r.freqMHz !== null && !r.locked).map((r) => ({ id: r.id, source: r.source, kind: r.kind, freqMHz: r.freqMHz }));
}
