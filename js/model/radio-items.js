// Radio items list data (pure, no DOM): what the list shows at a glance and the checks it adds to the rack warnings.
//   signalFlow(link, result)              -> the link as a few signal-path stages (delta dB and level after each), read from solveLink's waterfall
//   statusOf(result, warnings)            -> 'ok' | 'warn' | 'fail' for one list item
//   bandOf(link)                          -> { id, label, inWindow, onGrid } : the model's tuning range holding the frequency, or the plain band
//   nextFreeFrequency(scene, opts)        -> { freqMHz, level, clearanceKHz, window } : the next frequency clear of the show's third-order products
//   radioChecks(scene)                    -> [{ key, level, text }] in the rackWarnings format (unconnected antennas, tuning range, long cable runs)
import { FM_PRESETS, fmTuningCheck } from './fm-presets.js';
import { BANDS } from './library.js';
import { chainItemLossDb } from './rf.js';
import { ACTIVE_CHAIN_KINDS } from './chain-presets.js';
import { deriveRack, channelRoute } from './rack.js';
import { COORDINATION_DEFAULTS } from './coordination.js';

const fin = (x) => Number.isFinite(x);

// ------------------------------------------------------------------ signal flow

/** Category of a chain item, for grouping neighbours into one stage of the strip. */
function chainCat(it) {
  if (!it) return 'other';
  if (it.kind === 'cable') return 'cable';
  if (it.kind === 'booster') return 'booster';
  if (it.kind === 'splitter' || it.kind === 'activesplitter') return 'splitter';
  if (it.kind === 'combiner' || it.kind === 'activecombiner') return 'combiner';
  if (it.kind === 'filter') return 'filter';
  if (it.kind === 'rof') return 'fibre';
  if (it.kind === 'attenuator' && fin(it.reverseIsolationDb)) return 'isolator';
  if (it.kind === 'attenuator' && /loop-through/i.test(String(it.name || ''))) return 'loop';
  if (it.kind === 'attenuator') return 'pad';
  return 'other';
}
const CAT_LABEL = { cable: 'Cable', booster: 'Booster', splitter: 'Splitter', combiner: 'Combiner', filter: 'Filter', fibre: 'Fibre', isolator: 'Isolator', loop: 'Loop-through', pad: 'Pad', other: 'Other', junction: 'Cable' };

/** Group consecutive waterfall steps of chain items by category: [{ key, label, deltaDb, n }]. */
function groupChain(items, steps, txSide = false) {
  const out = [];
  let combined = !txSide; // on the IEM transmit side the first splitter-type item is the combiner (the rack builds it from a splitter/combiner preset)
  steps.forEach((s, i) => {
    const it = items[i];
    let cat = it ? chainCat(it) : 'junction';
    if (!combined && (cat === 'splitter' || cat === 'combiner')) { cat = 'combiner'; combined = true; } // a step past the items is the 75/50 ohm junction, counted with the cables
    const label = cat === 'other' || cat === 'pad' ? s.label : CAT_LABEL[cat];
    const last = out[out.length - 1];
    if (last && (last.cat === cat || (cat === 'junction' && last.cat === 'cable'))) { last.deltaDb += s.deltaDb; last.n += 1; return; }
    out.push({ cat: cat === 'junction' ? 'cable' : cat, label, deltaDb: s.deltaDb, n: 1 });
  });
  return out;
}

/**
 * signalFlow(link, result) -> { kind, stages: [{ key, label, deltaDb, levelDbm }], rxPowerDbm, inputPowerDbm, marginDb, status } or null.
 * Stages, mic:  Pack (Tx power) > Tx antenna > Air > Rx antenna > cable / booster / splitter ... > Receiver (input).
 *         IEM:  Tx (power) > isolator / combiner / cable ... > Tx antenna > Air > Bodypack antenna (> its own chain) > Bodypack.
 * "Air" is every step between the two antennas (free space, walls, multipath, body, polarisation, fade margin), so the level after
 * the receive antenna is the link's rxPowerDbm and the last stage is inputPowerDbm, the same numbers the Budgets panel shows.
 */
export function signalFlow(link, result) {
  if (!link || !result || !Array.isArray(result.waterfall) || !result.waterfall.length) return null;
  const wf = result.waterfall.filter((s) => !s.note), iem = link.kind === 'iem';
  const txI = wf.findIndex((s) => s.label === 'Tx antenna gain'), rxI = wf.findIndex((s) => s.label === 'Rx antenna gain');
  if (txI < 1 || rxI < txI) return null;
  const chain = Array.isArray(link.chain) ? link.chain : [], rxChain = iem && Array.isArray(link.rx && link.rx.chain) ? link.rx.chain : [];
  const stages = [];
  let level = wf[0].valueDbm;
  const push = (key, label, delta) => { level += delta; stages.push({ key, label, deltaDb: delta, levelDbm: level }); };
  stages.push({ key: 'tx', label: iem ? 'Tx' : 'Pack', deltaDb: 0, levelDbm: level });
  if (iem) groupChain(chain, wf.slice(1, txI), true).forEach((g, i) => push(`txc${i}`, g.label, g.deltaDb));
  push('txant', 'Tx ant', wf[txI].deltaDb);
  // everything between the antennas, and the post-antenna losses that are not chain items, is the air path
  const tailN = (iem ? rxChain.length : chain.length) + (wf[wf.length - 1].label.startsWith('Cable impedance junctions') ? 1 : 0);
  const tailStart = Math.max(rxI + 1, wf.length - tailN);
  let air = 0;
  for (let i = txI + 1; i < tailStart; i++) if (i !== rxI) air += wf[i].deltaDb;
  push('air', 'Air', air);
  push('rxant', iem ? 'Pack ant' : 'Rx ant', wf[rxI].deltaDb);
  groupChain(iem ? rxChain : chain, wf.slice(tailStart)).forEach((g, i) => push(`rxc${i}`, g.label, g.deltaDb));
  stages.push({ key: 'rx', label: iem ? 'Bodypack' : 'Receiver', deltaDb: 0, levelDbm: fin(result.inputPowerDbm) ? result.inputPowerDbm : level });
  return { kind: link.kind, stages, rxPowerDbm: result.rxPowerDbm, inputPowerDbm: result.inputPowerDbm, marginDb: result.marginDb, status: result.status };
}

/** statusOf(result?, warnings?) -> 'fail' when the link fails, 'warn' for a marginal link or any warning, else 'ok'. Info notes do not count. */
export function statusOf(result, warnings) {
  if (result && result.status === 'fail') return 'fail';
  if ((result && result.status === 'marginal') || (warnings || []).some((w) => w && w.level === 'warn')) return 'warn';
  return 'ok';
}

// ------------------------------------------------------------------ band and tuning range

/** bandOf(link) -> { id, label, inWindow, onGrid }: the transmitter model's tuning range when one is chosen, else the allocation band from the library. */
export function bandOf(link) {
  const f = link && link.freqMHz, id = link && link.tx && link.tx.fmPreset, p = id && FM_PRESETS[id];
  if (p && Array.isArray(p.params && p.params.tuningWindows) && p.params.tuningWindows.length) {
    const t = fmTuningCheck(id, f), w = p.params.tuningWindows.find((x) => x.id === t.window);
    return w ? { id: w.id, label: w.label || `${w.id} ${w.fromMHz}-${w.toMHz} MHz`, inWindow: true, onGrid: t.onGrid } : { id: null, label: 'outside the model\'s tuning range', inWindow: false, onGrid: false };
  }
  const b = BANDS.find((x) => f >= x.fromMHz && f <= x.toMHz);
  return { id: b ? b.id : null, label: b ? `${b.fromMHz}-${b.toMHz} MHz` : 'no listed band', inWindow: true, onGrid: true };
}

// ------------------------------------------------------------------ next free frequency

const txLinks = (scene) => ((scene && scene.links) || []).filter((l) => l.kind !== 'p2p' && l.txOf === undefined && fin(l.freqMHz));

/** The tuning window (kHz, step) to search: the reference model's range holding the reference frequency, else the band holding it. */
function searchWindow(ref, presetId, refMHz) {
  const p = presetId && FM_PRESETS[presetId];
  const ws = p && p.params && Array.isArray(p.params.tuningWindows) ? p.params.tuningWindows : [];
  if (ws.length) {
    const w = ws.find((x) => refMHz >= x.fromMHz && refMHz <= x.toMHz) || ws[0];
    return { fromMHz: w.fromMHz, toMHz: w.toMHz, stepKHz: Math.max(5, p.params.tuningStepKhz || 25), label: w.label || w.id };
  }
  const b = BANDS.find((x) => refMHz >= x.fromMHz && refMHz <= x.toMHz) || BANDS[0];
  return { fromMHz: b.fromMHz, toMHz: b.toMHz, stepKHz: COORDINATION_DEFAULTS.rasterKHz, label: b.name };
}

const sortedInts = (arr) => Int32Array.from(arr).sort();
function nearest(sorted, v) { // distance from v to the nearest value of a sorted array (Infinity when empty)
  let lo = 0, hi = sorted.length - 1, best = Infinity;
  while (lo <= hi) { const m = (lo + hi) >> 1, d = sorted[m] - v; if (Math.abs(d) < best) best = Math.abs(d); if (d < 0) lo = m + 1; else if (d > 0) hi = m - 1; else return 0; }
  return best;
}

/**
 * nextFreeFrequency(scene, { kind?, refLinkId?, presetId?, nearMHz?, minSpacingKHz?, levels? }) -> { freqMHz, level, clearanceKHz, window }.
 * nearMHz: retune one link (pass the scene without it and its own frequency): the nearest clean frequency either side of it is returned.
 * Searches upward on the model's tuning step from the highest frequency of the same kind (then downward from it) for a
 * frequency at least minSpacingKHz (300) from every transmitter in the show whose third-order products (2f1-f2, f1+f2-f3, old and new)
 * stay clear of every channel by the first clearance level that works (400, 300, 250, 200 kHz, as the Coordination panel).
 * level: 'clean' (third-order clear), 'spacing' (only the spacing could be kept) or 'none' (the range is full: the next step is returned).
 */
export function nextFreeFrequency(scene, opts = {}) {
  const kind = opts.kind === 'iem' ? 'iem' : 'mic', all = txLinks(scene);
  const ref = (opts.refLinkId && all.find((l) => l.id === opts.refLinkId)) || [...all].reverse().find((l) => l.kind === kind) || all[all.length - 1] || null;
  const presetId = opts.presetId !== undefined ? opts.presetId : ref && ref.tx && ref.tx.fmPreset;
  const refMHz = fin(opts.nearMHz) ? opts.nearMHz : ref ? ref.freqMHz : 600, win = searchWindow(ref, presetId, refMHz);
  const step = win.stepKHz, lo = Math.ceil((win.fromMHz * 1000) / step) * step, hi = Math.floor((win.toMHz * 1000) / step) * step;
  const spacing = fin(opts.minSpacingKHz) ? opts.minSpacingKHz : COORDINATION_DEFAULTS.minSpacingKHz;
  const levels = Array.isArray(opts.levels) ? opts.levels : COORDINATION_DEFAULTS.clearanceLevels.map((k) => k * COORDINATION_DEFAULTS.channelBwKHz);
  const E = all.map((l) => Math.round(l.freqMHz * 1000)), Es = sortedInts(E);
  const same = fin(opts.nearMHz) ? [Math.round((opts.nearMHz * 1000) / step) * step].filter((k) => k >= lo && k <= hi) : all.filter((l) => l.kind === kind).map((l) => Math.round(l.freqMHz * 1000)).filter((k) => k >= lo && k <= hi);
  const start = same.length ? Math.max(...same) : ref && Math.round(refMHz * 1000) >= lo && Math.round(refMHz * 1000) <= hi ? Math.round((refMHz * 1000) / step) * step : lo;
  const window = { fromMHz: win.fromMHz, toMHz: win.toMHz, label: win.label };
  if (hi < lo) return { freqMHz: refMHz, level: 'none', clearanceKHz: null, window };
  // the existing third-order products near the range
  const P = [], margin = 2 * levels[0];
  for (let i = 0; i < E.length; i++) for (let j = 0; j < E.length; j++) {
    if (i === j) continue;
    const t = 2 * E[i] - E[j]; if (t >= lo - margin && t <= hi + margin) P.push(t);
    if (j > i) for (let k = 0; k < E.length; k++) { if (k === i || k === j) continue; const q = E[i] + E[j] - E[k]; if (q >= lo - margin && q <= hi + margin) P.push(q); }
  }
  const Ps = sortedInts(P);
  const cands = [];
  if (fin(opts.nearMHz)) { // retuning: nearest first, outward both ways from the current frequency
    for (let d = 0; start - d >= lo || start + d <= hi; d += step) {
      if (start + d <= hi && start + d >= lo) cands.push(start + d);
      if (d > 0 && start - d >= lo && start - d <= hi) cands.push(start - d);
    }
  } else {
    // adding: upward from the highest channel of its kind, then downward from it (the new channel stays near the block, not at the bottom of the range)
    const first = same.length || E.length ? start + step : start;
    for (let c = first; c <= hi; c += step) cands.push(c);
    for (let c = Math.min(first - step, hi); c >= lo; c -= step) cands.push(c);
  }
  const spaced = (c) => nearest(Es, c) >= spacing;
  const clean = (c, g) => { // old products clear of the new channel, and new products clear of every channel (old and new)
    if (nearest(Ps, c) < g) return false;
    const hit = (q) => nearest(Es, q) < g || Math.abs(q - c) < g;
    for (let i = 0; i < E.length; i++) {
      const f = E[i];
      if (hit(2 * c - f) || hit(2 * f - c)) return false;
      for (let j = 0; j < E.length; j++) { if (j === i) continue; const g2 = E[j]; if (hit(c + f - g2)) return false; if (j > i && hit(f + g2 - c)) return false; }
    }
    return true;
  };
  let budget = 3e7; // inner steps before falling back to spacing only (a full 64-channel show stays fast)
  const cost = Math.max(1, E.length * E.length);
  for (const g of levels) {
    for (const c of cands) {
      if (!spaced(c)) continue;
      budget -= cost; if (budget < 0) break;
      if (clean(c, g)) return { freqMHz: c / 1000, level: 'clean', clearanceKHz: g, window };
    }
    if (budget < 0) break;
  }
  const sp = cands.find(spaced);
  if (sp !== undefined) return { freqMHz: sp / 1000, level: 'spacing', clearanceKHz: null, window };
  return { freqMHz: (cands[0] !== undefined ? cands[0] : lo) / 1000, level: 'none', clearanceKHz: null, window };
}

// ------------------------------------------------------------------ build checks

export const LONG_RUN_DB = 6; // rule of thumb: more passive loss than this ahead of the first active stage costs noticeable range

/**
 * radioChecks(scene) -> [{ key, level: 'warn'|'info', text }] with the same keys as rackWarnings ("<kind>:<id>"):
 * a receive or transmit antenna nothing is connected to, a transmit antenna wired straight to more than one transmitter output,
 * a transmitter tuned outside its model's range or off its tuning step, and an antenna cable run losing more than LONG_RUN_DB before any booster
 * (at the highest frequency that antenna carries).
 */
export function radioChecks(scene) {
  const out = [], links = (scene && scene.links) || [];
  const nm = (l) => String(l.name || l.id);
  for (const l of links) {
    if ((l.kind !== 'mic' && l.kind !== 'iem') || l.txOf !== undefined || !l.tx || !l.tx.fmPreset || !FM_PRESETS[l.tx.fmPreset]) continue;
    const key = `${l.kind === 'iem' ? 'transmitter' : 'mic'}:${l.id}`, t = fmTuningCheck(l.tx.fmPreset, l.freqMHz), p = FM_PRESETS[l.tx.fmPreset];
    const ranges = (p.params.tuningWindows || []).map((w) => `${w.fromMHz}-${w.toMHz}`).join(', ');
    if (!Array.isArray(p.params.tuningWindows) || !p.params.tuningWindows.length) continue;
    if (!t.inWindow) out.push({ key, level: 'warn', text: `${nm(l)} is set to ${l.freqMHz} MHz, outside the tuning range of its model (${ranges} MHz): pick a frequency inside it or a model for this band.` });
    else if (!t.onGrid) out.push({ key, level: 'info', text: `${nm(l)} at ${l.freqMHz} MHz is off its model's ${p.params.tuningStepKhz} kHz tuning step: the unit will tune to the nearest step.` });
  }
  const rack = scene && scene.rack;
  if (!rack) return out;
  const r = rack.receivers || [], t = rack.transmitters || [], sp = rack.splitters || [], cb = rack.combiners || [];
  const byId = (id) => links.find((l) => l.id === id);
  // the highest frequency each receive antenna carries (the worst cable loss)
  const topMHz = new Map();
  for (const x of r) for (const c of x.channels) {
    const l = byId(c.linkId), rt = l ? channelRoute(rack, c, x) : null; if (!rt) continue;
    for (const a of [rt.antA, rt.antB]) if (a) topMHz.set(a.id, Math.max(topMHz.get(a.id) || 0, l.freqMHz));
  }
  for (const a of rack.antennas || []) {
    if (a.role === 'tx') {
      const direct = t.flatMap((x) => x.channels.filter((c) => !c.combinerId && c.antennaId === a.id));
      const viaCb = cb.filter((c) => c.antennaId === a.id || (c.fanout && (c.fanout.outputs || []).some((o) => o && o.antennaId === a.id)));
      if (!direct.length && !viaCb.length) out.push({ key: `txantenna:${a.id}`, level: 'info', text: `${a.name} is not connected: pick it on an IEM transmitter or combiner, or remove it.` });
      else if (direct.length + viaCb.length > 1) {
        const who = [...direct.map((c) => nm(byId(c.linkId) || { id: c.linkId })), ...viaCb.map((c) => c.name)];
        const text = `${a.name} is wired straight to ${who.join(', ')}: two transmitter outputs cannot share one antenna. Route them through a combiner, or give each its own antenna.`;
        out.push({ key: `txantenna:${a.id}`, level: 'warn', text });
        for (const c of direct) out.push({ key: `transmitter:${c.linkId}`, level: 'warn', text });
      }
      continue;
    }
    const used = sp.some((s) => !s.fromSplitter && (s.antA === a.id || s.antB === a.id)) || r.some((x) => !x.loopFrom && x.channels.some((c) => !c.splitterId && (c.antA === a.id || c.antB === a.id)));
    if (!used) out.push({ key: `antenna:${a.id}`, level: 'info', text: `${a.name} is not connected: feed a splitter or receiver from it, or remove it.` });
    const run = Array.isArray(a.chain) ? a.chain : [];
    if (!run.length) continue;
    const f = topMHz.get(a.id) || 600;
    let loss = 0;
    for (const it of run) { if (ACTIVE_CHAIN_KINDS.includes(it.kind)) break; try { loss += chainItemLossDb(it, f); } catch { /* an item the maths cannot price adds nothing */ } }
    if (loss > LONG_RUN_DB) out.push({ key: `antenna:${a.id}`, level: 'info', text: `${a.name}: the cable run loses ${loss.toFixed(1)} dB at ${f} MHz before any booster. Shorten it, use lower-loss cable, or fit a booster at the antenna end.` });
  }
  return out;
}

/** The rack the list shows: scene.rack, or the one derived from the links when none was saved. */
export const rackOf = (scene) => (scene && scene.rack) || deriveRack(scene);
