// Show inventory (pure): one row per link with the gear on each end, plus totals of what has to be packed and who or what each link is tied to.
//   inventoryRows(scene, results?)  -> rows { id, name, kind, freqMHz, person, personId, txItem, txPowerMw, txAntenna, rxItem, rxAntenna, antennaB, chainItems,
//                                             chainLossDb, distanceM, inputPowerDbm, marginDb, status }
//   inventoryTotals(rows, scene)    -> { mics, iems, other, transmitters, receivers, antennas, cables, splitters, combiners, units, loads } (lists are [{ label, count, ... }])
//   packListText(totals)            -> the totals as plain text, for copying
//   linkCard(scene, linkId, results?) -> the selected link in words: who, what gear, where, which path, how it ended
// Equipment names come from the FM preset registry; a link with no preset is named by its kind ("Generic microphone transmitter"). No DOM, no clock.
import { FM_PRESETS, FM_TX_PRESET_IDS, FM_RX_PRESET_IDS, fmTuningCheck } from './fm-presets.js';
import { RX_PRESETS } from './rx-params.js';
import { ANTENNAS, CABLES } from './library.js';
import { chainLossDb, solveLink } from './rf.js';
import { linkOwners } from './people.js';
import { resultAt } from './assumptions-in-use.js';
import { rackLoads } from './rack.js';

const KIND_WORD = { mic: 'microphone', iem: 'in-ear', p2p: 'point-to-point' };
const kindWord = (k) => KIND_WORD[k] || String(k || 'link');
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const sig3 = (x) => (Number.isFinite(x) ? Number(x.toPrecision(3)) : null);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Device name for the transmitter end: the FM preset label when one is applied, else a generic name for the link kind. */
export function txDeviceName(link) {
  const id = link && link.tx && link.tx.fmPreset;
  return (id && FM_PRESETS[id] && FM_PRESETS[id].label.replace(/ \(FM\)$/, '')) || `Generic ${kindWord(link && link.kind)} transmitter`;
}

/** Device name for the receiver end (bodypack for an IEM, receiver for a microphone). */
export function rxDeviceName(link) {
  const id = link && link.rx && link.rx.rxPreset;
  const p = id && RX_PRESETS[id];
  const label = p && p.label ? String(p.label).replace(/ \((assumed figures|FM)\)$/, '').replace(/ \(assumed figures\)$/, '') : null;
  return label || `Generic ${link && link.kind === 'iem' ? 'bodypack' : 'receiver'}`;
}

/** Form factor of a transmitter from its model: 'handheld', 'bodypack', 'plug-on', or 'other' when no model is chosen (a generic transmitter is not guessed). */
export function txFormFactor(link) {
  const id = link && link.tx && link.tx.fmPreset, p = id && FM_PRESETS[id];
  if (!p) return 'other';
  return /handheld/i.test(p.label) ? 'handheld' : /plug-?on/i.test(p.label) ? 'plug-on' : /bodypack/i.test(p.label) ? 'bodypack' : 'other';
}

/** Antenna name from the library; a tx that is a handheld or bodypack has its body as the antenna. */
export function antennaName(ant) {
  if (!ant) return 'None';
  const a = ANTENNAS[ant.type];
  return a && a.name ? a.name : String(ant.type || 'Unknown');
}

/** Summary of the single cable chain on a link: counts of items and the cables by type with total length. */
function chainSummary(link) {
  const chain = Array.isArray(link && link.chain) ? link.chain : [];
  const cables = new Map();
  for (const it of chain) {
    if (it && it.kind === 'cable') {
      const key = it.cableType, cur = cables.get(key) || { type: key, name: (CABLES[key] && CABLES[key].name) || String(key), lengthM: 0, count: 0 };
      cur.lengthM += Number.isFinite(it.lengthM) ? it.lengthM : 0; cur.count += 1; cables.set(key, cur);
    }
  }
  return { items: chain.length, cables: [...cables.values()] };
}

export function inventoryRows(scene, results) {
  const links = (scene && Array.isArray(scene.links)) ? scene.links : [];
  const owners = linkOwners(scene && scene.people, scene && scene.links), people = new Map(((scene && scene.people) || []).map((p) => [p.id, p]));
  return links.map((l, i) => {
    const res = resultAt(results, scene, i) || solveLink(scene, l);
    const o = owners.get(l.id), person = o && people.get(o.personId);
    const div = l.rx && l.rx.diversity;
    const hasB = !!(div && div.enabled && div.antennaB);
    let loss = null; try { loss = r1(chainLossDb(l.chain, l.freqMHz)); } catch { loss = null; }
    const extraRx = l.txOf !== undefined, src = extraRx && links.find((q) => q.id === l.txOf), listensTo = src ? String(src.name || src.id) : null; // an extra receiver of another mic's transmitter
    return {
      id: l.id, name: String(l.name || ''), kind: l.kind, freqMHz: l.freqMHz,
      extraRx, listensTo,
      person: person ? person.name : null, personId: person ? person.id : null,
      // an extra receiver has no transmitter of its own: the columns say whose it listens to instead of repeating that transmitter
      txItem: extraRx ? `Listens to ${listensTo || 'another transmitter'}` : txDeviceName(l), txPowerMw: extraRx ? null : sig3(Math.pow(10, l.tx.powerDbm / 10)), txAntenna: extraRx ? null : antennaName(l.tx.antenna),
      sharesAntennaWith: (() => { const src = l.rx.sharedAntennaOf && links.find((q) => q.id === l.rx.sharedAntennaOf); return src ? String(src.name || src.id) : null; })(),
      rxItem: rxDeviceName(l), rxAntenna: antennaName(l.rx.antenna), antennaB: hasB ? antennaName(div.antennaB.antenna || l.rx.antenna) : null,
      chainItems: chainSummary(l).items, chainLossDb: loss,
      distanceM: res ? r1(res.distanceM) : null, inputPowerDbm: r1(res && res.inputPowerDbm), marginDb: r1(res && res.marginDb), status: res ? res.status : null,
    };
  });
}

function tally(list, keyOf, extra) {
  const m = new Map();
  for (const x of list) { const k = keyOf(x), cur = m.get(k) || { label: k, count: 0, ...(extra ? extra() : {}) }; cur.count += 1; m.set(k, cur); }
  return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * What to pack: counts of each transmitter and receiver model, antenna type and cable type across all links (a diversity antenna B counts too).
 * With a radio rack (scene.rack) the rack's antennas, antenna cable runs, combiner cables, splitters, combiners and units are counted once each,
 * not once per link they feed; a link's own leads (chain items the rack did not put there) still count per link.
 * Extra fields: units { receivers, transmitters } (rack units, null without a rack), splitters and combiners ([{ label, count }]).
 */
export function inventoryTotals(rows, scene) {
  const links = (scene && scene.links) || [], rack = scene && scene.rack;
  const antennas = [], cableMap = new Map();
  const addCable = (type, lengthM) => { const name = (CABLES[type] && CABLES[type].name) || String(type); const cur = cableMap.get(name) || { label: name, count: 0, lengthM: 0 }; cur.count += 1; cur.lengthM = r1(cur.lengthM + (Number.isFinite(lengthM) ? lengthM : 0)); cableMap.set(name, cur); };
  const rackChan = (id) => { for (const r of (rack && rack.receivers) || []) for (const c of r.channels || []) if (c.linkId === id) return c; return null; };
  for (const l of links) {
    const iem = l.kind === 'iem';
    if (l.txOf === undefined && l.tx.antenna && l.tx.antenna.type !== 'body' && !(rack && iem)) antennas.push(antennaName(l.tx.antenna)); // a rack IEM's antenna is a rack antenna
    const fromRack = rack && l.kind === 'mic' && rackChan(l.id);
    if (!fromRack && l.rx.antenna && l.rx.antenna.type !== 'body' && !l.rx.sharedAntennaOf) antennas.push(antennaName(l.rx.antenna)); // a shared antenna is packed once, with its first link
    const div = l.rx.diversity, ch = fromRack;
    if (div && div.enabled && div.antennaB && (!ch || (!ch.splitterId && !ch.antB))) antennas.push(antennaName(div.antennaB.antenna || l.rx.antenna)); // with a rack, only a B antenna the rack does not supply
    for (const it of l.chain || []) if (it && it.kind === 'cable' && !(rack && it.rackSplitter)) addCable(it.cableType, it.lengthM);
  }
  if (rack) {
    for (const a of rack.antennas || []) {
      if (!a.load && a.antenna && a.antenna.type !== 'body') antennas.push(antennaName(a.antenna));
      for (const it of a.chain || []) if (it && it.kind === 'cable') addCable(it.cableType, it.lengthM);
    }
    for (const c of rack.combiners || []) {
      if (c.cable && c.cable.lengthM > 0) addCable(c.cable.type || 'rg58', c.cable.lengthM);
      if (c.fanout) for (const o of c.fanout.outputs || []) if (o && o.cable && o.cable.lengthM > 0) addCable(o.cable.type || 'rg58', o.cable.lengthM);
    }
  }
  const unit = (word) => (x) => `${x.type === 'active' ? 'Active' : 'Passive'} ${word}${x.ports ? ` (${x.ports} ports)` : ''}`;
  const fanouts = rack ? (rack.combiners || []).filter((c) => c.fanout).map((c) => ({ type: c.fanout.type, ports: c.fanout.ports })) : [];
  return {
    mics: rows.filter((r) => r.kind === 'mic' && !r.extraRx).length, extraReceivers: rows.filter((r) => r.extraRx).length, iems: rows.filter((r) => r.kind === 'iem').length, other: rows.filter((r) => r.kind !== 'mic' && r.kind !== 'iem').length,
    transmitters: tally(rows.filter((r) => !r.extraRx), (r) => r.txItem), receivers: tally(rows, (r) => r.rxItem), antennas: tally(antennas, (a) => a),
    loads: rackLoads(scene), cables: [...cableMap.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    units: rack ? { receivers: (rack.receivers || []).length, transmitters: (rack.transmitters || []).length } : null,
    splitters: rack ? tally([...(rack.splitters || []).map(unit('antenna splitter')), ...fanouts.map(unit('transmit splitter'))], (x) => x) : [],
    combiners: rack ? tally((rack.combiners || []).map(unit('IEM combiner')), (x) => x) : [],
  };
}

/** packListText(totals, title?) -> plain text of what to pack, one line per group, for copying into a show file or an email. */
export function packListText(totals, title = 'Pack list') {
  const t = totals || {}, lines = [title];
  const list = (xs, extra) => (xs || []).map((x) => `${x.count} x ${x.label}${extra ? extra(x) : ''}`).join('; ');
  const add = (label, xs, extra) => { if (xs && xs.length) lines.push(`${label}: ${list(xs, extra)}`); };
  add('Transmitters', t.transmitters); add('Receivers and bodypacks', t.receivers);
  if (t.units && (t.units.receivers || t.units.transmitters)) lines.push(`Rack units: ${t.units.receivers} receiver${t.units.receivers === 1 ? '' : 's'}, ${t.units.transmitters} IEM transmitter${t.units.transmitters === 1 ? '' : 's'}`);
  add('Antennas', t.antennas); add('Splitters', t.splitters); add('Combiners', t.combiners);
  add('Cables', t.cables, (x) => (x.lengthM ? ` (${x.lengthM} m in all)` : ''));
  if (t.loads && t.loads.total) lines.push(`50 ohm loads: ${t.loads.total}`);
  if (lines.length === 1) lines.push('Nothing yet.');
  return lines.join('\n');
}

/** The selected link in plain words, for the card under the inventory. Returns null for an unknown id. */
export function linkCard(scene, linkId, results) {
  const rows = inventoryRows(scene, results), r = rows.find((x) => x.id === linkId);
  if (!r) return null;
  const l = scene.links.find((x) => x.id === linkId);
  const lines = [];
  if (r.listensTo) lines.push(`Extra receiver for ${r.listensTo}: it listens to that microphone's transmitter, so frequency and transmitter follow it.`);
  lines.push(`${cap(kindWord(r.kind))} link at ${r.freqMHz} MHz${r.person ? `, worn or held by ${r.person}` : ', not assigned to a person'}.`);
  if (!r.extraRx) lines.push(`Transmitter: ${r.txItem}, ${r.txPowerMw} mW, ${r.txAntenna} antenna, at x ${r1(l.tx.pos.x)} m, y ${r1(l.tx.pos.y)} m, height ${r1(l.tx.pos.z)} m.`);
  lines.push(`Receiver: ${r.rxItem}, ${r.rxAntenna} antenna${r.antennaB ? ` plus ${r.antennaB} on antenna B` : ''}${r.sharesAntennaWith ? ` shared with ${r.sharesAntennaWith} through a splitter` : ''}, at x ${r1(l.rx.pos.x)} m, y ${r1(l.rx.pos.y)} m, height ${r1(l.rx.pos.z)} m.`);
  lines.push(r.chainItems ? `Chain: ${r.chainItems} item${r.chainItems === 1 ? '' : 's'}, net ${r.chainLossDb === null ? 'unknown' : `${r.chainLossDb} dB`} loss.` : 'Chain: nothing between the antenna and the receiver.');
  lines.push(r.status ? `Result: ${r.status}, ${r.distanceM} m, ${r.inputPowerDbm} dBm at the input, ${r.marginDb} dB margin.` : 'Result: not solved.');
  return { row: r, lines };
}

/** Which link kind a preset is for: 'iem' (in-ear transmitter or bodypack receiver) or 'mic'. The registry has no kind field, so the label decides. */
export function presetKind(id) {
  const p = FM_PRESETS[id]; if (!p) return null;
  return p.role === 'tx' ? (/IEM/.test(p.label) ? 'iem' : 'mic') : (/IEM|bodypack receiver/.test(p.label) ? 'iem' : 'mic');
}

/**
 * gearOptions(link) -> { tx: [...], rx: [...] } preset choices for the link's kind, models that tune at the link frequency first.
 * Each option: { id, label, manufacturer, model, tunes (inside a tuning window), onGrid, assumed (any figure not sourced) }. A p2p link gets none.
 */
export function gearOptions(link) {
  const kind = link && link.kind;
  if (kind !== 'mic' && kind !== 'iem') return { tx: [], rx: [] };
  const f = link.freqMHz;
  const build = (ids) => ids.filter((id) => presetKind(id) === kind).map((id) => {
    const p = FM_PRESETS[id], t = fmTuningCheck(id, f);
    return { id, label: p.label.replace(/ \(FM\)$/, ''), manufacturer: p.manufacturer, model: p.model, tunes: t.inWindow, onGrid: t.onGrid, assumed: Object.values(p.confidence || {}).some((c) => c !== 'sourced') };
  }).sort((a, b) => (b.tunes - a.tunes) || a.label.localeCompare(b.label));
  return { tx: build(FM_TX_PRESET_IDS), rx: build(FM_RX_PRESET_IDS) };
}

/** Power choices of the link's transmitter preset: [{ id, label }] (empty when no preset or a single option) and the id in use. */
export function powerChoices(link) {
  const id = link && link.tx && link.tx.fmPreset, p = id && FM_PRESETS[id];
  if (!p || p.role !== 'tx' || p.params.powerOptions.length < 2) return { options: [], current: null };
  const cur = p.params.powerOptions.find((o) => Math.abs(o.powerDbm - link.tx.powerDbm) < 0.01 && !!o.lowIntermod === !!link.tx.lowIntermod) || p.params.powerOptions.find((o) => Math.abs(o.powerDbm - link.tx.powerDbm) < 0.01);
  return { options: p.params.powerOptions.map((o) => ({ id: o.id, label: o.label })), current: cur ? cur.id : null };
}
