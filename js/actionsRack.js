// Receive rack edits (antennas, splitters, receivers and their connections). Each runs as one undo step through store.update.
// The first edit adopts the links as they are into scene.rack (deriveRack); from then on the rack drives each mic link's receive path.
import { deriveRack, RACK_LIMITS } from './model/rack.js';
import { ANTENNAS, allowedPolarisations, defaultPolarisation } from './model/library.js';
import { newId, createChainItem, createChainItemFromPreset } from './model/scene.js';

const LEGACY_SPLIT = (it) => !!it && (it.presetId === 'splitter-2' || it.presetId === 'active-splitter-4') && !it.rackSplitter;

function adopt(d) {
  if (d.rack) return d.rack;
  const rack = deriveRack(d);
  for (const r of rack.receivers) for (const c of r.channels) {
    const l = d.links.find((q) => q.id === c.linkId); if (!l) continue;
    if (c.splitterId && l.chain && LEGACY_SPLIT(l.chain[0])) l.chain.shift(); // the rack puts its own splitter item back
    delete l.rx.sharedAntennaOf;
  }
  d.rack = rack; return rack;
}
const chan = (rack, linkId) => { for (const r of rack.receivers) for (const c of r.channels) if (c.linkId === linkId) return { r, c }; return null; };

/** adoptRack(store) -> true when the rack was created from the current links. */
export const adoptRack = (store) => store.update((d) => { if (!d.rack) adopt(d); });

/** renameRackItem(store, 'antennas'|'splitters'|'receivers', id, name) */
export function renameRackItem(store, kind, id, name) {
  const n = String(name || '').trim().slice(0, 40);
  return store.update((d) => { if (!n || !['antennas', 'splitters', 'receivers', 'transmitters', 'combiners'].includes(kind)) return; const it = adopt(d)[kind].find((x) => x.id === id); if (it) it.name = n; });
}

/** addRackAntenna(store, { name?, pos?, antenna? }) -> id (a copy of the last antenna's kind, nudged along so it can be told apart). */
export function addRackAntenna(store, partial = {}) { // partial.role 'tx' makes a transmit antenna
  let id = null;
  store.update((d) => {
    const rack = adopt(d); if (rack.antennas.length >= RACK_LIMITS.maxAntennas) return;
    const ref = [...rack.antennas].reverse().find((a) => (a.role === 'tx') === (partial.role === 'tx')) || { pos: { x: 6, y: 1, z: 2 }, antenna: { type: 'paddle', gainDbi: 2, orientation: { az: 90, el: 0 }, polarisation: 'vertical' } };
    id = newId('ra');
    rack.antennas.push({ id, ...(partial.role === 'tx' ? { role: 'tx' } : {}), name: partial.name || `Rx Antenna ${rack.antennas.length + 1}`, pos: partial.pos || { ...ref.pos, x: Math.round((ref.pos.x + 0.6) * 100) / 100 }, antenna: partial.antenna || structuredClone(ref.antenna) });
  });
  return id;
}

/** addRackSplitter(store, { type: 'passive'|'active', name? }) -> id */
export function addRackSplitter(store, { type = 'passive', name } = {}) {
  let id = null;
  store.update((d) => {
    const rack = adopt(d); if (rack.splitters.length >= RACK_LIMITS.maxSplitters) return;
    id = newId('rs'); rack.splitters.push({ id, name: name || `Split ${rack.splitters.length + 1}`, type: type === 'active' ? 'active' : 'passive', antA: null, antB: null });
  });
  return id;
}

/** setSplitterType(store, id, 'passive'|'active') */
export const setSplitterType = (store, id, type) => store.update((d) => { const s = adopt(d).splitters.find((x) => x.id === id); if (s && (type === 'passive' || type === 'active')) s.type = type; });

/** setSplitterInput(store, splitterId, 'A'|'B', antennaId|null): which antenna feeds that side of the splitter. */
export function setSplitterInput(store, splitterId, side, antennaId) {
  return store.update((d) => {
    const rack = adopt(d), s = rack.splitters.find((x) => x.id === splitterId);
    if (!s || (antennaId && !rack.antennas.some((a) => a.id === antennaId))) return;
    s[side === 'B' ? 'antB' : 'antA'] = antennaId || null;
  });
}

/** connectChannel(store, linkId, { splitterId?, antA?, antB? }): feed a mic link's receiver channel from a splitter, or straight from antennas. */
export function connectChannel(store, linkId, { splitterId = null, antA = null, antB = null } = {}) {
  return store.update((d) => {
    const rack = adopt(d), m = chan(rack, linkId); if (!m) return;
    if (splitterId && !rack.splitters.some((s) => s.id === splitterId)) return;
    const ok = (id) => !id || rack.antennas.some((a) => a.id === id);
    if (!ok(antA) || !ok(antB)) return;
    m.c.splitterId = splitterId || null;
    if (splitterId) { delete m.c.antA; delete m.c.antB; } else { m.c.antA = antA || (rack.antennas[0] && rack.antennas[0].id) || null; m.c.antB = antB || null; }
  });
}

/** moveChannel(store, linkId, receiverId | 'new'): put a mic link on another receiver (as a further channel) or on a new one of its own. */
export function moveChannel(store, linkId, receiverId) {
  return store.update((d) => {
    const rack = adopt(d), m = chan(rack, linkId); if (!m) return;
    let to = receiverId === 'new' ? null : rack.receivers.find((r) => r.id === receiverId);
    if (receiverId === 'new') { if (rack.receivers.length >= RACK_LIMITS.maxReceivers) return; to = { id: newId('rr'), name: `Rx ${rack.receivers.length + 1}`, channels: [] }; rack.receivers.push(to); }
    if (!to || to === m.r || to.channels.length >= RACK_LIMITS.maxChannels) return;
    m.r.channels = m.r.channels.filter((c) => c !== m.c); to.channels.push(m.c);
    if (!m.r.channels.length) rack.receivers = rack.receivers.filter((r) => r !== m.r);
  });
}

/** removeRackItem(store, 'antennas'|'splitters', id): channels on a removed splitter fall back to the antennas it fed; a removed antenna leaves its inputs empty. */
export function removeRackItem(store, kind, id) {
  return store.update((d) => {
    const rack = adopt(d);
    if (kind === 'splitters') {
      const s = rack.splitters.find((x) => x.id === id); if (!s) return;
      for (const r of rack.receivers) for (const c of r.channels) if (c.splitterId === id) { c.splitterId = null; c.antA = s.antA; c.antB = s.antB; }
      rack.splitters = rack.splitters.filter((x) => x !== s);
    } else if (kind === 'antennas') {
      if (!rack.antennas.some((a) => a.id === id) || rack.antennas.length < 2) return;
      rack.antennas = rack.antennas.filter((a) => a.id !== id);
      for (const s of rack.splitters) { if (s.antA === id) s.antA = null; if (s.antB === id) s.antB = null; }
      for (const r of rack.receivers) for (const c of r.channels) { if (c.antA === id) c.antA = null; if (c.antB === id) c.antB = null; }
      for (const cb of rack.combiners) if (cb.antennaId === id) cb.antennaId = null;
      for (const t of rack.transmitters) for (const c of t.channels) if (c.antennaId === id) c.antennaId = null;
    }
  });
}

/** setRackAntenna(store, id, { pos?, antenna? }): move or change an antenna; every link it feeds follows. */
export function setRackAntenna(store, id, patch) {
  return store.update((d) => { const a = adopt(d).antennas.find((x) => x.id === id); if (!a) return; if (patch.pos) a.pos = { ...a.pos, ...patch.pos }; if (patch.antenna) a.antenna = { ...a.antenna, ...patch.antenna }; if (patch.load !== undefined) { if (patch.load) a.load = true; else delete a.load; } });
}

const txChan = (rack, linkId) => { for (const t of rack.transmitters) for (const c of t.channels) if (c.linkId === linkId) return { r: t, c }; return null; };

/** addRackCombiner(store, { type?, name?, cableM?, cableType? }) -> id: an IEM transmit combiner, optionally with a cable run to its antenna. */
export function addRackCombiner(store, { type = 'passive', name, cableM = 0, cableType = 'rg58' } = {}) {
  let id = null;
  store.update((d) => {
    const rack = adopt(d); if (rack.combiners.length >= RACK_LIMITS.maxCombiners) return;
    id = newId('rcb');
    rack.combiners.push({ id, name: name || `Combiner ${rack.combiners.length + 1}`, type: type === 'active' ? 'active' : 'passive', antennaId: null, cable: cableM > 0 ? { type: cableType, lengthM: cableM } : null });
  });
  return id;
}

/** setCombiner(store, id, { type?, antennaId?, cableM?, cableType? }): cableM 0 removes the cable. */
export function setCombiner(store, id, patch) {
  return store.update((d) => {
    const rack = adopt(d), c = rack.combiners.find((x) => x.id === id); if (!c) return;
    if (patch.type === 'passive' || patch.type === 'active') c.type = patch.type;
    if (patch.ports !== undefined) { const n = Math.round(Number(patch.ports)); if (n >= 2 && n <= 16) c.ports = n; else delete c.ports; }
    if (patch.antennaId !== undefined && (!patch.antennaId || rack.antennas.some((a) => a.id === patch.antennaId))) c.antennaId = patch.antennaId || null;
    if (patch.cableM !== undefined) { const m = Math.max(0, Math.min(500, Number(patch.cableM) || 0)); c.cable = m > 0 ? { type: patch.cableType || (c.cable && c.cable.type) || 'rg58', lengthM: m } : null; }
    else if (patch.cableType && c.cable) c.cable.type = patch.cableType;
  });
}

/** connectTxChannel(store, linkId, { combinerId?, antennaId? }): feed an IEM channel through a combiner, or straight to a transmit antenna. */
export function connectTxChannel(store, linkId, { combinerId = null, antennaId = null } = {}) {
  return store.update((d) => {
    const rack = adopt(d), m = txChan(rack, linkId); if (!m) return;
    if (combinerId && !rack.combiners.some((x) => x.id === combinerId)) return;
    if (antennaId && !rack.antennas.some((a) => a.id === antennaId)) return;
    m.c.combinerId = combinerId || null;
    if (combinerId) delete m.c.antennaId; else m.c.antennaId = antennaId || (rack.antennas.find((a) => a.role === 'tx') || {}).id || null;
  });
}

/** moveTxChannel(store, linkId, transmitterId | 'new'): put an IEM channel on another transmitter (a second channel) or a new one. */
export function moveTxChannel(store, linkId, transmitterId) {
  return store.update((d) => {
    const rack = adopt(d), m = txChan(rack, linkId); if (!m) return;
    let to = transmitterId === 'new' ? null : rack.transmitters.find((r) => r.id === transmitterId);
    if (transmitterId === 'new') { if (rack.transmitters.length >= RACK_LIMITS.maxTransmitters) return; to = { id: newId('rt'), name: `IEM Tx ${rack.transmitters.length + 1}`, channels: [] }; rack.transmitters.push(to); }
    if (!to || to === m.r || to.channels.length >= RACK_LIMITS.maxChannels) return;
    m.r.channels = m.r.channels.filter((c) => c !== m.c); to.channels.push(m.c);
    if (!m.r.channels.length) rack.transmitters = rack.transmitters.filter((r) => r !== m.r);
  });
}

/** removeCombiner(store, id): its channels go straight to the antenna it fed. */
export function removeCombiner(store, id) {
  return store.update((d) => {
    const rack = adopt(d), cb = rack.combiners.find((x) => x.id === id); if (!cb) return;
    for (const t of rack.transmitters) for (const c of t.channels) if (c.combinerId === id) { c.combinerId = null; c.antennaId = cb.antennaId; }
    rack.combiners = rack.combiners.filter((x) => x !== cb);
  });
}

/** setSplitterPorts(store, id, ports | null): the physical outputs of a splitter (null = as many as are used). Unused ones are reported as needing a 50 ohm load. */
export const setSplitterPorts = (store, id, ports) => store.update((d) => { const s = adopt(d).splitters.find((x) => x.id === id); if (!s) return; const n = Math.round(Number(ports)); if (n >= 2 && n <= 16) s.ports = n; else delete s.ports; });

/** addAntennaChainItem(store, antennaId, { kind?: 'cable', presetId? }): append a cable, booster, filter or fibre item to the run between a receive antenna and its splitter or receiver. */
export function addAntennaChainItem(store, antennaId, { kind = 'cable', presetId } = {}) {
  return store.update((d) => {
    const a = adopt(d).antennas.find((x) => x.id === antennaId); if (!a) return;
    a.chain = a.chain || []; if (a.chain.length >= 8) return;
    a.chain.push(presetId ? createChainItemFromPreset(presetId) : createChainItem(kind));
  });
}

/** setAntennaChainItem(store, antennaId, itemId, patch): change lengthM, cableType, gainDb, nfDb or lossDb of one item. */
export function setAntennaChainItem(store, antennaId, itemId, patch) {
  return store.update((d) => {
    const a = adopt(d).antennas.find((x) => x.id === antennaId), it = a && (a.chain || []).find((c) => c.id === itemId); if (!it) return;
    for (const k of ['lengthM', 'gainDb', 'nfDb', 'lossDb', 'fibreKm']) if (patch[k] !== undefined && Number.isFinite(Number(patch[k]))) it[k] = Math.max(-200, Math.min(2000, Number(patch[k])));
    if (typeof patch.cableType === 'string' && /^[a-z0-9_-]{1,32}$/.test(patch.cableType)) it.cableType = patch.cableType;
  });
}

/** removeAntennaChainItem(store, antennaId, itemId) */
export const removeAntennaChainItem = (store, antennaId, itemId) => store.update((d) => { const a = adopt(d).antennas.find((x) => x.id === antennaId); if (a && a.chain) a.chain = a.chain.filter((c) => c.id !== itemId); });

/** setAntennaZones(store, antennaId, zoneIds): the coverage zones this receive antenna is meant to serve (a planning note; the maths does not use it yet). */
export const setAntennaZones = (store, antennaId, zoneIds) => store.update((d) => {
  const a = adopt(d).antennas.find((x) => x.id === antennaId); if (!a) return;
  const ok = new Set((d.zones || []).map((z) => z.id)); a.zones = [...new Set(zoneIds)].filter((z) => ok.has(z));
});

/** setRxBias(store, linkId, { on, volts?, ma? }): the receiver puts DC on its antenna input (rx.antennaBiasV, 0 = off) so a booster or active antenna up the cable is powered. */
export function setRxBias(store, linkId, { on, volts, ma } = {}) {
  return store.update((d) => {
    const l = d.links.find((q) => q.id === linkId); if (!l || l.kind === 'iem') return;
    const v = Number.isFinite(Number(volts)) && Number(volts) > 0 ? Math.min(Number(volts), 48) : (l.rx.antennaBiasV > 0 ? l.rx.antennaBiasV : 12);
    if (on !== undefined) l.rx.antennaBiasV = on ? v : 0; else if (volts !== undefined && l.rx.antennaBiasV > 0) l.rx.antennaBiasV = v;
    if (ma !== undefined) { const m = Math.max(0, Math.min(1000, Number(ma) || 0)); if (m > 0) l.rx.antennaBiasMa = m; else delete l.rx.antennaBiasMa; }
  });
}

/** setRackAntennaType(store, id, type): change the antenna model; its gain returns to the library figure and the polarisation is kept only if the new type allows it. Aim, groundplane and the rest stay. */
export function setRackAntennaType(store, id, type) {
  return store.update((d) => {
    const a = adopt(d).antennas.find((x) => x.id === id), lib = ANTENNAS[type]; if (!a || !lib) return;
    a.antenna.type = type; a.antenna.gainDbi = lib.gainDbi;
    if (!allowedPolarisations(type).includes(a.antenna.polarisation)) a.antenna.polarisation = defaultPolarisation(type);
  });
}

/** setRackAntennaAim(store, id, { az?, el?, gainDbi? }): where the antenna points (degrees) and its gain. */
export function setRackAntennaAim(store, id, { az, el, gainDbi } = {}) {
  return store.update((d) => {
    const a = adopt(d).antennas.find((x) => x.id === id); if (!a) return;
    const o = a.antenna.orientation || { az: 0, el: 0 };
    if (Number.isFinite(az)) o.az = ((az % 360) + 360) % 360;
    if (Number.isFinite(el)) o.el = Math.max(-90, Math.min(90, el));
    a.antenna.orientation = o;
    if (Number.isFinite(gainDbi)) a.antenna.gainDbi = Math.max(-30, Math.min(40, gainDbi));
  });
}
