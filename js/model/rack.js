// Receive rack (pure): the radio items of a job as a categorised list that the link maths is compiled from.
//   scene.rack (optional) = { antennas:[{id,name,pos,antenna}], splitters:[{id,name,type:'passive'|'active',antA,antB}],
//                             receivers:[{id,name,channels:[{id,linkId,splitterId?,antA?,antB?}]}] }
// A channel is one mic link on one receiver channel. Its receive antenna A (and B) comes from its splitter's inputs, else from its own antA/antB.
// compileRack(scene) copies the antennas into each channel link (rx.pos, rx.antenna, rx.diversity.antennaB) and puts one splitter item,
// sized to the channels on it, at the antenna end of the chain. With no scene.rack the links are used as they are.
// deriveRack(scene) describes the current links as a rack (no change to the scene) so the list can show and adopt them.
// scene.js imports this file, so the chain-item builders come in as `mk` (no import back, the module graph has no cycles).

export const RACK_LIMITS = Object.freeze({ maxAntennas: 32, maxSplitters: 16, maxReceivers: 32, maxChannels: 8, maxTransmitters: 32, maxCombiners: 16 });
const RACK_COMBINER = Object.freeze({ passive: 'splitter-2', active: 'active-combiner-8' });
const RACK_SPLITTER = Object.freeze({ passive: 'splitter-2', active: 'active-splitter-4' });
const isRackItem = (it) => !!it && it.rackSplitter === true;

/** deriveRack(scene) -> a rack describing the mic links as they are now (shared antennas become one splitter, antenna B an antenna of its own). */
export function deriveRack(scene) {
  const links = ((scene && scene.links) || []).filter((l) => l && l.kind === 'mic');
  const rack = { antennas: [], splitters: [], receivers: [] };
  const sources = links.filter((l) => l.rx.sharedAntennaOf === undefined);
  const groups = sources.map((s) => [s, ...links.filter((l) => l.rx.sharedAntennaOf === s.id)]);
  const multi = groups.filter((g) => g.length > 1).length > 1;
  let gi = 0, ri = 0;
  for (const g of groups) {
    const src = g[0], b = src.rx.diversity && src.rx.diversity.enabled ? src.rx.diversity.antennaB : null;
    const shared = g.length > 1, n = shared ? ++gi : 0, tag = shared && multi ? String(n) : '';
    const aId = `ra_${src.id}`, bId = `rb_${src.id}`;
    rack.antennas.push({ id: aId, name: `Rx Antenna ${tag}${b || shared ? 'A' : ''}`.trim(), pos: structuredClone(src.rx.pos), antenna: structuredClone(src.rx.antenna) });
    if (b) rack.antennas.push({ id: bId, name: `Rx Antenna ${tag}B`, pos: structuredClone(b.pos), antenna: structuredClone(b.antenna || src.rx.antenna) });
    let spId = null;
    if (shared) {
      const item = (src.chain || []).find((it) => it && (it.presetId === 'splitter-2' || it.presetId === 'active-splitter-4'));
      spId = `rs_${src.id}`;
      rack.splitters.push({ id: spId, name: `Split ${n}`, type: item && item.presetId === 'active-splitter-4' ? 'active' : 'passive', antA: aId, antB: b ? bId : null });
    }
    for (const l of g) {
      ri += 1;
      rack.receivers.push({ id: `rr_${l.id}`, name: `Rx ${ri}`, channels: [{ id: `rc_${l.id}`, linkId: l.id, splitterId: spId, ...(spId ? {} : { antA: aId, antB: b ? bId : null }) }] });
    }
  }
  rack.transmitters = []; rack.combiners = [];
  ((scene && scene.links) || []).filter((l) => l && l.kind === 'iem').forEach((l, i) => {
    rack.antennas.push({ id: `ta_${l.id}`, role: 'tx', name: `Tx Antenna ${i + 1}`, pos: structuredClone(l.tx.pos), antenna: structuredClone(l.tx.antenna) });
    rack.transmitters.push({ id: `rt_${l.id}`, name: `IEM Tx ${i + 1}`, channels: [{ id: `tc_${l.id}`, linkId: l.id, combinerId: null, antennaId: `ta_${l.id}` }] });
  });
  return rack;
}

/** Antenna ids and splitter that a channel resolves to: { splitter, antA, antB } (objects or null). */
export function channelRoute(rack, ch) {
  const ant = (id) => (rack.antennas || []).find((a) => a.id === id) || null;
  const sp = ch.splitterId ? (rack.splitters || []).find((s) => s.id === ch.splitterId) || null : null;
  return { splitter: sp, antA: ant(sp ? sp.antA : ch.antA), antB: ant(sp ? sp.antB : ch.antB) };
}

/** compileRack(scene): in place, no-op without scene.rack. Dangling channels are left alone; a splitter with no antenna A leaves its links' antennas untouched. */
export function compileRack(scene, mk) {
  const rack = scene && scene.rack;
  if (!rack || !Array.isArray(rack.receivers)) return scene;
  const links = scene.links || [], used = new Map();
  for (const r of rack.receivers) r.channels = (r.channels || []).filter((c) => links.some((l) => l.id === c.linkId && l.kind === 'mic')); // a link that went or changed kind leaves its channel
  rack.receivers = rack.receivers.filter((r) => r.channels.length);
  const placed = new Set(rack.receivers.flatMap((r) => r.channels.map((c) => c.linkId)));
  for (const l of links) { // a mic link added after the rack was made gets its own receiver and antenna
    if (l.kind !== 'mic' || placed.has(l.id) || rack.receivers.length >= RACK_LIMITS.maxReceivers || rack.antennas.length >= RACK_LIMITS.maxAntennas) continue;
    rack.antennas.push({ id: `ra_${l.id}`, name: `Rx antenna for ${l.name || 'mic'}`, pos: structuredClone(l.rx.pos), antenna: structuredClone(l.rx.antenna) });
    rack.receivers.push({ id: `rr_${l.id}`, name: `Rx ${rack.receivers.length + 1}`, channels: [{ id: `rc_${l.id}`, linkId: l.id, splitterId: null, antA: `ra_${l.id}`, antB: null }] });
  }
  for (const r of rack.receivers) for (const ch of r.channels || []) if (ch.splitterId) used.set(ch.splitterId, (used.get(ch.splitterId) || 0) + 1);
  for (const r of rack.receivers) for (const ch of r.channels || []) {
    const l = links.find((q) => q.id === ch.linkId);
    if (!l || l.kind !== 'mic') continue;
    delete l.rx.sharedAntennaOf; // the rack owns the sharing now
    l.chain = (l.chain || []).filter((it) => !isRackItem(it));
    const { splitter, antA, antB } = channelRoute(rack, ch);
    if (antA) { l.rx.pos = structuredClone(antA.pos); l.rx.antenna = structuredClone(antA.antenna); }
    const div = l.rx.diversity;
    if (div && antB) { div.enabled = true; div.antennaB = { ...(div.antennaB || {}), pos: structuredClone(antB.pos), antenna: structuredClone(antB.antenna) }; }
    else if (div && ch.antB === null && !splitter && div.enabled) { /* channel says no antenna B: leave the link's own setting */ }
    if (splitter) {
      const item = { ...mk.fromPreset(RACK_SPLITTER[splitter.type] || RACK_SPLITTER.passive, { ports: Math.min(Math.max(used.get(splitter.id) || 2, 2), 16) }), rackSplitter: true };
      l.chain.unshift(item);
      if (div && div.antennaB && Array.isArray(div.antennaB.chain)) div.antennaB.chain = [{ ...item }, ...div.antennaB.chain.filter((it) => !isRackItem(it))];
    } else if (div && div.antennaB && Array.isArray(div.antennaB.chain)) div.antennaB.chain = div.antennaB.chain.filter((it) => !isRackItem(it));
  }
  compileTxRack(scene, rack, links, mk);
  return scene;
}

function compileTxRack(scene, rack, links, mk) {
  if (!Array.isArray(rack.transmitters)) rack.transmitters = [];
  if (!Array.isArray(rack.combiners)) rack.combiners = [];
  for (const t of rack.transmitters) t.channels = (t.channels || []).filter((c) => links.some((l) => l.id === c.linkId && l.kind === 'iem'));
  rack.transmitters = rack.transmitters.filter((t) => t.channels.length);
  const placed = new Set(rack.transmitters.flatMap((t) => t.channels.map((c) => c.linkId)));
  for (const l of links) {
    if (l.kind !== 'iem' || placed.has(l.id) || rack.transmitters.length >= RACK_LIMITS.maxTransmitters || rack.antennas.length >= RACK_LIMITS.maxAntennas) continue;
    rack.antennas.push({ id: `ta_${l.id}`, role: 'tx', name: `Tx antenna for ${l.name || 'IEM'}`, pos: structuredClone(l.tx.pos), antenna: structuredClone(l.tx.antenna) });
    rack.transmitters.push({ id: `rt_${l.id}`, name: `IEM Tx ${rack.transmitters.length + 1}`, channels: [{ id: `tc_${l.id}`, linkId: l.id, combinerId: null, antennaId: `ta_${l.id}` }] });
  }
  const used = new Map();
  for (const t of rack.transmitters) for (const c of t.channels) if (c.combinerId) used.set(c.combinerId, (used.get(c.combinerId) || 0) + 1);
  for (const t of rack.transmitters) for (const c of t.channels) {
    const l = links.find((q) => q.id === c.linkId); if (!l) continue;
    const cb = c.combinerId ? rack.combiners.find((x) => x.id === c.combinerId) : null;
    const ant = rack.antennas.find((a) => a.id === (cb ? cb.antennaId : c.antennaId));
    l.chain = (l.chain || []).filter((it) => !isRackItem(it));
    if (ant) { l.tx.pos = structuredClone(ant.pos); l.tx.antenna = structuredClone(ant.antenna); }
    if (cb) {
      const items = [{ ...mk.fromPreset(RACK_COMBINER[cb.type] || RACK_COMBINER.passive, { ports: Math.min(Math.max(used.get(cb.id) || 2, 2), 16) }), rackSplitter: true }];
      if (cb.cable && cb.cable.lengthM > 0) items.push({ ...mk.item('cable', { cableType: cb.cable.type || 'rg58', lengthM: cb.cable.lengthM }), rackSplitter: true });
      l.chain.unshift(...items);
    }
  }
}

/** validateRack(scene) -> error strings (empty when fine or absent). */
export function validateRack(scene) {
  const rack = scene && scene.rack, errors = [];
  if (rack === undefined) return errors;
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(rack)) return ['rack must be an object'];
  const lim = [['antennas', RACK_LIMITS.maxAntennas], ['splitters', RACK_LIMITS.maxSplitters], ['receivers', RACK_LIMITS.maxReceivers]];
  for (const [k, max] of lim) if (!Array.isArray(rack[k]) || rack[k].length > max) errors.push(`rack.${k} must be an array of at most ${max}`);
  if (errors.length) return errors;
  const ids = new Set(), safe = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) && !(v in Object.prototype);
  const num = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 10000;
  const take = (id, p) => { if (!safe(id) || ids.has(id)) errors.push(`${p}.id must be a unique short plain string`); else ids.add(id); };
  rack.antennas.forEach((a, i) => { take(a && a.id, `rack.antennas[${i}]`); if (!isObj(a.pos) || !num(a.pos.x) || !num(a.pos.y) || !num(a.pos.z)) errors.push(`rack.antennas[${i}].pos must be {x,y,z}`); if (!isObj(a.antenna)) errors.push(`rack.antennas[${i}].antenna must be an object`); });
  rack.splitters.forEach((s, i) => { take(s && s.id, `rack.splitters[${i}]`); if (s.type !== 'passive' && s.type !== 'active') errors.push(`rack.splitters[${i}].type must be passive or active`); });
  rack.receivers.forEach((r, i) => {
    take(r && r.id, `rack.receivers[${i}]`);
    if (!Array.isArray(r.channels) || r.channels.length > RACK_LIMITS.maxChannels) errors.push(`rack.receivers[${i}].channels must be an array of at most ${RACK_LIMITS.maxChannels}`);
    else r.channels.forEach((c, j) => { take(c && c.id, `rack.receivers[${i}].channels[${j}]`); if (!safe(c.linkId)) errors.push(`rack.receivers[${i}].channels[${j}].linkId invalid`); });
  });
  for (const [k, max] of [['transmitters', RACK_LIMITS.maxTransmitters], ['combiners', RACK_LIMITS.maxCombiners]]) if (rack[k] !== undefined && (!Array.isArray(rack[k]) || rack[k].length > max)) errors.push(`rack.${k} must be an array of at most ${max}`);
  if (errors.length) return errors;
  (rack.combiners || []).forEach((c, i) => { take(c && c.id, `rack.combiners[${i}]`); if (c.type !== 'passive' && c.type !== 'active') errors.push(`rack.combiners[${i}].type must be passive or active`); if (c.cable && !(num(c.cable.lengthM) && c.cable.lengthM >= 0 && safe(c.cable.type))) errors.push(`rack.combiners[${i}].cable invalid`); });
  (rack.transmitters || []).forEach((t, i) => {
    take(t && t.id, `rack.transmitters[${i}]`);
    if (!Array.isArray(t.channels) || t.channels.length > RACK_LIMITS.maxChannels) errors.push(`rack.transmitters[${i}].channels must be an array of at most ${RACK_LIMITS.maxChannels}`);
    else t.channels.forEach((c, j) => { take(c && c.id, `rack.transmitters[${i}].channels[${j}]`); if (!safe(c.linkId)) errors.push(`rack.transmitters[${i}].channels[${j}].linkId invalid`); });
  });
  return errors;
}

/**
 * rackSections(scene) -> the radio items in categories, as plain data for the list (works on scene.rack or, without one, on deriveRack(scene)):
 *   [{ key, title, items:[{ id, kind, text }] }] with kinds mic, antenna, splitter, receiver (one item per channel), iem, txantenna, combiner, transmitter (per channel).
 */
export function rackSections(scene) {
  const rack = scene.rack || deriveRack(scene), links = scene.links || [];
  const nameOf = (id) => { const l = links.find((q) => q.id === id); return l ? String(l.name || l.id) : '?'; };
  const an = (id) => { const a = (rack.antennas || []).find((x) => x.id === id); return a ? a.name : 'no antenna'; };
  const rxAnts = (rack.antennas || []).filter((a) => a.role !== 'tx'), txAnts = (rack.antennas || []).filter((a) => a.role === 'tx');
  const sp = (id) => (rack.splitters || []).find((x) => x.id === id), cb = (id) => (rack.combiners || []).find((x) => x.id === id);
  const sections = [];
  const mic = links.filter((l) => l.kind === 'mic');
  if (mic.length) sections.push({ key: 'mics', title: 'Microphones', items: mic.map((l) => ({ id: l.id, kind: 'mic', text: String(l.name || l.id) })) });
  if (rxAnts.length) sections.push({ key: 'rxant', title: 'Receive antennas', items: rxAnts.map((a) => {
    const to = [];
    for (const s of rack.splitters || []) { if (s.antA === a.id) to.push(`${s.name} A`); if (s.antB === a.id) to.push(`${s.name} B`); }
    for (const r of rack.receivers || []) for (const c of r.channels) if (!c.splitterId && (c.antA === a.id || c.antB === a.id)) to.push(`${r.name} (${nameOf(c.linkId)})${c.antB === a.id ? ' B' : ''}`);
    return { id: a.id, kind: 'antenna', text: `${a.name}${to.length ? ` connected to ${to.join(', ')}` : ' not connected'}` };
  }) });
  if ((rack.splitters || []).length) sections.push({ key: 'splitters', title: 'Splitters', items: rack.splitters.map((s) => {
    const n = (rack.receivers || []).reduce((t, r) => t + r.channels.filter((c) => c.splitterId === s.id).length, 0);
    return { id: s.id, kind: 'splitter', text: `${s.name} (${s.type}, ${n} output${n === 1 ? '' : 's'}): A from ${an(s.antA)}${s.antB ? `, B from ${an(s.antB)}` : ''}` };
  }) });
  if ((rack.receivers || []).length) sections.push({ key: 'receivers', title: 'Receivers', items: rack.receivers.flatMap((r) => r.channels.map((c, i) => {
    const s = c.splitterId ? sp(c.splitterId) : null;
    const to = s ? `${s.name}${s.antB ? ' A&B' : ' A'}` : `${an(c.antA)}${c.antB ? ` and ${an(c.antB)}` : ''}`;
    return { id: c.linkId, kind: 'receiver', text: `${nameOf(c.linkId)} > ${r.name}${r.channels.length > 1 ? ` channel ${i + 1}` : ''} connected to ${to}` };
  })) });
  const iem = (rack.transmitters || []);
  if (iem.length) sections.push({ key: 'iems', title: 'In-ear transmitters', items: iem.flatMap((t) => t.channels.map((c, i) => {
    const b = c.combinerId ? cb(c.combinerId) : null;
    const path = b ? `${b.name}${b.cable ? ` > ${b.cable.lengthM} m cable` : ''} > ${an(b.antennaId)}` : an(c.antennaId);
    return { id: c.linkId, kind: 'transmitter', text: `${t.name} Channel ${i + 1} (${nameOf(c.linkId)}) > ${path}` };
  })) });
  if ((rack.combiners || []).length) sections.push({ key: 'combiners', title: 'Combiners', items: rack.combiners.map((b) => ({ id: b.id, kind: 'combiner', text: `${b.name} (${b.type}) > ${b.cable ? `${b.cable.lengthM} m cable > ` : ''}${an(b.antennaId)}` })) });
  if (txAnts.length) sections.push({ key: 'txant', title: 'Transmit antennas', items: txAnts.map((a) => ({ id: a.id, kind: 'txantenna', text: a.name })) });
  return sections;
}
