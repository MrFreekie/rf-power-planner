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
/** Gain given to a transmit antenna that is a dummy load: nothing is radiated. */
export const DUMMY_LOAD_GAIN_DBI = -60;
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
  const zoneIds = new Set((scene.zones || []).map((z) => z.id));
  for (const a of rack.antennas || []) if (Array.isArray(a.zones)) a.zones = a.zones.filter((z) => zoneIds.has(z)); // a deleted zone leaves the list
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
    const run = (a, tag) => ((a && a.chain) || []).map((it) => ({ ...structuredClone(it), id: `${String(it.id || 'ci').slice(0, 24)}_${tag}${l.id.slice(0, 30)}`, rackSplitter: true })); // an antenna's own cable, booster or fibre run, in front of any splitter
    const preA = run(antA, 'a'), preB = run(antB, 'b');
    if (antA) { l.rx.pos = structuredClone(antA.pos); l.rx.antenna = structuredClone(antA.antenna); }
    const div = l.rx.diversity;
    if (div && antB) { div.enabled = true; div.antennaB = { ...(div.antennaB || {}), pos: structuredClone(antB.pos), antenna: structuredClone(antB.antenna) }; }
    else if (div && ch.antB === null && !splitter && div.enabled) { /* channel says no antenna B: leave the link's own setting */ }
    const item = splitter ? { ...mk.fromPreset(RACK_SPLITTER[splitter.type] || RACK_SPLITTER.passive, { ports: Math.min(Math.max(used.get(splitter.id) || 2, splitter.ports || 2), 16) }), id: `sp_${l.id.slice(0, 40)}`, rackSplitter: true } : null;
    const jumper = l.chain; // what is left once the rack items are out: the receiver's own leads
    l.chain = [...preA, ...(item ? [item] : []), ...jumper];
    if (div && div.antennaB) {
      const own = Array.isArray(div.antennaB.chain) ? div.antennaB.chain.filter((it) => !isRackItem(it)) : null;
      if (antB && (preA.length || preB.length || own)) div.antennaB.chain = [...preB, ...(item ? [{ ...item, id: `spb_${l.id.slice(0, 40)}` }] : []), ...(own || structuredClone(jumper))];
      else if (own) div.antennaB.chain = own;
    }
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
    if (ant) { l.tx.pos = structuredClone(ant.pos); l.tx.antenna = structuredClone(ant.antenna); if (ant.load) l.tx.antenna.gainDbi = DUMMY_LOAD_GAIN_DBI; } // a 50 ohm load radiates nothing
    if (cb) {
      const items = [{ ...mk.fromPreset(RACK_COMBINER[cb.type] || RACK_COMBINER.passive, { ports: Math.min(Math.max(used.get(cb.id) || 2, cb.ports || 2), 16) }), rackSplitter: true }];
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
  for (const k of ['splitters', 'combiners']) (rack[k] || []).forEach((x, i) => { if (x.ports !== undefined && !(Number.isInteger(x.ports) && x.ports >= 2 && x.ports <= 16)) errors.push(`rack.${k}[${i}].ports must be a whole number from 2 to 16`); });
  rack.antennas.forEach((a, i) => { if (a.chain !== undefined && (!Array.isArray(a.chain) || a.chain.length > 8)) errors.push(`rack.antennas[${i}].chain must be an array of at most 8 items`); if (a.zones !== undefined && (!Array.isArray(a.zones) || a.zones.length > 100 || !a.zones.every(safe))) errors.push(`rack.antennas[${i}].zones must be a list of zone ids`); });
  rack.antennas.forEach((a, i) => { if (a.load !== undefined && typeof a.load !== 'boolean') errors.push(`rack.antennas[${i}].load must be true or false`); });
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
  const iemLinks = links.filter((l) => l.kind === 'iem');
  if (iemLinks.length) sections.push({ key: 'bodypacks', title: 'In-ear bodypacks', items: iemLinks.map((l) => ({ id: l.id, kind: 'bodypack', text: `${l.name || l.id} bodypack` })) });
  if ((rack.combiners || []).length) sections.push({ key: 'combiners', title: 'Combiners', items: rack.combiners.map((b) => ({ id: b.id, kind: 'combiner', text: `${b.name} (${b.type}) > ${b.cable ? `${b.cable.lengthM} m cable > ` : ''}${an(b.antennaId)}` })) });
  if (txAnts.length) sections.push({ key: 'txant', title: 'Transmit antennas', items: txAnts.map((a) => ({ id: a.id, kind: 'txantenna', text: a.load ? `${a.name} (50 ohm dummy load)` : a.name })) });
  return sections;
}

/** Outputs of a splitter or inputs of a combiner that nothing is plugged into: [{ id, kind, name, free }] (only where `ports` was set above the number in use). */
function freePorts(rack) {
  const out = [];
  const usedBy = (key, id) => [...(rack.receivers || []), ...(rack.transmitters || [])].reduce((n, r) => n + r.channels.filter((c) => c[key] === id).length, 0);
  for (const s of rack.splitters || []) { const free = (s.ports || 0) - usedBy('splitterId', s.id); if (free > 0) out.push({ id: s.id, kind: 'splitter', name: s.name, free }); }
  for (const c of rack.combiners || []) { const free = (c.ports || 0) - usedBy('combinerId', c.id); if (free > 0) out.push({ id: c.id, kind: 'combiner', name: c.name, free }); }
  return out;
}

/** rackWarnings(scene) -> [{ key, level: 'warn'|'info', text }] ; key is "<kind>:<id>" of the list item it belongs to. */
export function rackWarnings(scene) {
  const rack = scene.rack || deriveRack(scene), links = scene.links || [], w = [];
  const nm = (id) => { const l = links.find((q) => q.id === id); return l ? String(l.name || l.id) : '?'; };
  const ant = (id) => (rack.antennas || []).find((a) => a.id === id);
  const open = 'it can be damaged transmitting into an open output. Connect an antenna or fit a 50 ohm load';
  for (const t of rack.transmitters || []) for (const c of t.channels) {
    if (!c.combinerId && !ant(c.antennaId)) w.push({ key: `transmitter:${c.linkId}`, level: 'warn', text: `${nm(c.linkId)} has no antenna or load: ${open}.` });
  }
  for (const b of rack.combiners || []) {
    const n = (rack.transmitters || []).reduce((k, t) => k + t.channels.filter((c) => c.combinerId === b.id).length, 0);
    if (n && !ant(b.antennaId)) w.push({ key: `combiner:${b.id}`, level: 'warn', text: `${b.name} output has no antenna or load: ${open}.` });
  }
  const zones = scene.zones || [], rxAnt = (rack.antennas || []).filter((a) => a.role !== 'tx');
  if (zones.length && scene.rack) {
    for (const z of zones) if (!rxAnt.some((a) => (a.zones || []).includes(z.id))) w.push({ key: `zone:${z.id}`, level: 'info', text: `Zone ${z.name || z.id} has no receive antenna serving it.` });
    for (const a of rxAnt) if (!(a.zones || []).length) w.push({ key: `antenna:${a.id}`, level: 'info', text: `${a.name} serves no zone.` });
  }
  for (const f of freePorts(rack)) w.push({ key: `${f.kind}:${f.id}`, level: 'info', text: `${f.name} has ${f.free} unused ${f.kind === 'combiner' ? 'input' : 'output'}${f.free === 1 ? '' : 's'}: fit a 50 ohm load on ${f.free === 1 ? 'it' : 'each'} (1 W is plenty for an IEM, 2 W gives margin).` });
  return w;
}

/** rackLoads(scene) -> { dummyLoads, freePorts, total } : 50 ohm terminations to pack (transmit antennas that are loads, plus one per unused port). */
export function rackLoads(scene) {
  const rack = scene && scene.rack; if (!rack) return { dummyLoads: 0, freePorts: 0, total: 0 };
  const d = (rack.antennas || []).filter((a) => a.load).length, p = freePorts(rack).reduce((n, f) => n + f.free, 0);
  return { dummyLoads: d, freePorts: p, total: d + p };
}
