// Fast building for the Radio items list: add several mic or IEM channels in one go, duplicate one, reorder items, and pick a receiver's feed
// in one step. Each call is one undo step: the actions it reuses share one coalesce key (batch()).
import { addLink, assignMic, assignIem, assignExtraMic } from './actions.js';
import { adoptRack, rackDraft } from './actionsRack.js';
import { channelRoute, canLoopReceiver, RACK_LIMITS } from './model/rack.js';
import { nextFreeFrequency } from './model/radio-items.js';
import { newId } from './model/scene.js';
import { PEOPLE_LIMITS } from './model/people.js';

let batchN = 0;
/** batch(store) -> a store whose updates all merge into one undo step (one coalesce key per call). */
export function batch(store) {
  const key = `radio-batch-${++batchN}`;
  return { ...store, update: (fn, o = {}) => store.update(fn, { ...o, coalesce: key }) };
}

const chanOf = (units, linkId) => { for (const r of units || []) for (const c of r.channels || []) if (c.linkId === linkId) return { r, c }; return null; };
const primaries = (scene, kind) => scene.links.filter((l) => l.kind === kind && l.txOf === undefined);
const COPY_KEYS = ['modulation', 'audio', 'mpx'];

/** Copy the reference link's gear (models, power, receiver settings, modulation, its own leads) onto a new link, keeping the new link's ids, names and places. */
function copyGear(n, r) {
  const keep = (part) => ({ id: n[part].id, name: n[part].name, pos: n[part].pos });
  n.tx = { ...structuredClone(r.tx), ...keep('tx') };
  const rxB = r.rx.diversity && r.rx.diversity.antennaB && r.rx.diversity.antennaB.pos, rx0 = r.rx.pos;
  n.rx = { ...structuredClone(r.rx), ...keep('rx') }; delete n.rx.sharedAntennaOf;
  if (rxB && n.rx.diversity && n.rx.diversity.antennaB) n.rx.diversity.antennaB.pos = { x: n.rx.pos.x + rxB.x - rx0.x, y: n.rx.pos.y + rxB.y - rx0.y, z: rxB.z };
  for (const k of COPY_KEYS) if (r[k]) n[k] = structuredClone(r[k]);
  if (r.telemetry) n.telemetry = { ...structuredClone(r.telemetry), deviceName: n.telemetry && n.telemetry.deviceName };
  n.chain = (r.chain || []).filter((it) => !it.rackSplitter).map((it) => ({ ...structuredClone(it), id: newId('ci') })); // the rack adds its own items back
  if (n.kind === 'iem') delete n.branches; // rebuilt from tx and chain by syncScene
}

/** Feed the new link's rack channel like the reference one (same splitter or antennas; same combiner or antenna), in the unit asked for, and drop the antenna the rack made for it. */
function placeChannel(d, id, ref, unitId) {
  const rack = rackDraft(d), mic = d.links.find((l) => l.id === id).kind === 'mic';
  const units = mic ? rack.receivers : rack.transmitters, own = chanOf(units, id); if (!own) return;
  const target = unitId && units.find((u) => u.id === unitId && u.channels.length < RACK_LIMITS.maxChannels && u !== own.r);
  const refCh = (target && target.channels[0] && { r: target, c: target.channels[0] }) || (ref && chanOf(units, ref.id));
  if (target) { own.r.channels = own.r.channels.filter((c) => c !== own.c); target.channels.push(own.c); if (!own.r.channels.length) { if (mic) rack.receivers = rack.receivers.filter((u) => u !== own.r); else rack.transmitters = rack.transmitters.filter((u) => u !== own.r); } }
  if (refCh) {
    if (mic) {
      const rt = channelRoute(rack, refCh.c, refCh.r), sp = rt.splitter;
      if (target) { own.c.splitterId = refCh.c.splitterId || null; if (!own.c.splitterId) { own.c.antA = refCh.c.antA || null; own.c.antB = refCh.c.antB || null; } else { delete own.c.antA; delete own.c.antB; } }
      else if (sp) { own.c.splitterId = sp.id; delete own.c.antA; delete own.c.antB; }
      else { own.c.splitterId = null; own.c.antA = rt.antA ? rt.antA.id : null; own.c.antB = rt.antB ? rt.antB.id : null; }
    } else {
      // a combiner is shared; an antenna wired straight to the reference transmitter is not (two transmitters cannot share one antenna without a combiner)
      if (refCh.c.combinerId) { own.c.combinerId = refCh.c.combinerId; delete own.c.antennaId; }
      if (refCh.c.isolator) { own.c.isolator = true; if (Number.isFinite(refCh.c.isolatorDb)) own.c.isolatorDb = refCh.c.isolatorDb; }
    }
  }
  const made = `${mic ? 'ra' : 'ta'}_${id}`, still = (aid) => [...rack.receivers, ...rack.transmitters].some((u) => u.channels.some((c) => c.antA === aid || c.antB === aid || c.antennaId === aid))
    || rack.splitters.some((s) => s.antA === aid || s.antB === aid) || rack.combiners.some((c) => c.antennaId === aid || (c.fanout && c.fanout.outputs.some((o) => o && o.antennaId === aid)));
  if (refCh && !still(made)) rack.antennas = rack.antennas.filter((a) => a.id !== made);
}

/**
 * addRadioChannels(store, kind 'mic'|'iem', { count = 1, refLinkId?, unitId?, personId? }) -> ids of the new links (one undo step).
 * Each new link copies the reference link (refLinkId, else the last of its kind): models, power and receiver settings; it takes the next frequency
 * that is third-order clean against the show (inside the model's tuning range), and its rack channel is fed like the reference one (same splitter or
 * antennas, same combiner), so adding mics does not add antennas. unitId puts the first channels into that receiver or IEM transmitter unit while it has
 * room (RACK_LIMITS.maxChannels); the rest get a unit each. personId gives them to a person: the first as their main mic or IEM when they have none, the others as extras.
 */
export function addRadioChannels(store, kind, { count = 1, refLinkId, unitId, personId } = {}) {
  if (kind !== 'mic' && kind !== 'iem') return [];
  const n = Math.max(1, Math.min(16, Math.round(Number(count)) || 1)), b = batch(store), ids = [];
  adoptRack(b);
  for (let i = 0; i < n; i++) {
    const sc = store.getScene(), all = primaries(sc, kind);
    const ref = (refLinkId && sc.links.find((l) => l.id === refLinkId && l.kind === kind)) || all[all.length - 1] || null;
    const f = nextFreeFrequency(sc, { kind, refLinkId: ref ? ref.id : undefined }).freqMHz;
    const id = addLink(b, kind, { freqMHz: f }); if (!id) break;
    ids.push(id);
    b.update((d) => {
      const nl = d.links.find((l) => l.id === id), rl = ref && d.links.find((l) => l.id === ref.id);
      if (nl && rl) copyGear(nl, rl);
      placeChannel(d, id, rl, unitId);
    });
    if (personId) {
      const p = (store.getScene().people || []).find((x) => x.id === personId);
      if (p) {
        const main = kind === 'mic' ? p.micLinkId : p.iemLinkId;
        if (!main) (kind === 'mic' ? assignMic : assignIem)(b, personId, id);
        else if ((p.extraLinkIds || []).length < PEOPLE_LIMITS.maxExtra) assignExtraMic(b, personId, id);
      }
    }
  }
  return ids;
}

/** duplicateRadioLink(store, linkId) -> id of a copy of the link (same gear and feed, next clean frequency, same unit when it has room), or null. */
export function duplicateRadioLink(store, linkId) {
  const l = store.getScene().links.find((q) => q.id === linkId);
  if (!l || (l.kind !== 'mic' && l.kind !== 'iem') || l.txOf !== undefined) return null;
  return addRadioChannels(store, l.kind, { refLinkId: linkId })[0] || null;
}

const RACK_LIST = { antenna: 'antennas', txantenna: 'antennas', splitter: 'splitters', combiner: 'combiners', receiver: 'receivers', transmitter: 'transmitters' };

/**
 * moveRadioItem(store, kind, id, dir -1|1): reorder an item among its own kind in the list. Mic and bodypack items move their link in scene.links (among links
 * of the same kind); receiver and IEM transmitter channels move their whole unit; antennas move among antennas of the same role. Order only, no maths change.
 */
export function moveRadioItem(store, kind, id, dir) {
  const step = dir < 0 ? -1 : 1;
  return store.update((d) => {
    const swap = (arr, i, ok) => { let j = i + step; while (j >= 0 && j < arr.length && !ok(arr[j])) j += step; if (i < 0 || j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
    if (kind === 'mic' || kind === 'bodypack') {
      const i = d.links.findIndex((l) => l.id === id); if (i < 0) return;
      const l = d.links[i]; swap(d.links, i, (q) => q.kind === l.kind && (kind === 'bodypack' || (q.txOf === undefined) === (l.txOf === undefined)));
      return;
    }
    const key = RACK_LIST[kind]; if (!key) return;
    const rack = rackDraft(d), arr = rack[key];
    if (kind === 'receiver' || kind === 'transmitter') { const m = chanOf(arr, id); if (m) swap(arr, arr.indexOf(m.r), () => true); return; }
    const i = arr.findIndex((x) => x.id === id); if (i < 0) return;
    const tx = arr[i].role === 'tx'; swap(arr, i, (x) => (key !== 'antennas' || (x.role === 'tx') === tx));
  });
}

/**
 * setChannelFeed(store, linkId, feed): where a mic link's receiver takes its antenna signal, in one step:
 *   'antennas' (straight from antennas, keeping the ones it had), 'splitter:<id>', or 'loop:<receiverId>' (that receiver's loop-through; the whole unit follows).
 * Leaving a loop-through clears it for the unit. A loop that would make a cycle or pass RACK_LIMITS.maxLoopHops is refused.
 */
export function setChannelFeed(store, linkId, feed) {
  return store.update((d) => {
    const rack = rackDraft(d), m = chanOf(rack.receivers, linkId); if (!m) return;
    const v = String(feed || 'antennas'), firstRx = (rack.antennas.find((a) => a.role !== 'tx') || {}).id || null;
    if (v.startsWith('loop:')) { const from = v.slice(5); if (from !== m.r.id && rack.receivers.some((r) => r.id === from) && canLoopReceiver(rack, m.r.id, from)) m.r.loopFrom = from; return; }
    delete m.r.loopFrom;
    if (v.startsWith('splitter:')) { const sid = v.slice(9); if (!rack.splitters.some((s) => s.id === sid)) return; m.c.splitterId = sid; delete m.c.antA; delete m.c.antB; return; }
    const route = channelRoute(rack, m.c, m.r);
    m.c.splitterId = null; m.c.antA = m.c.antA || (route.antA && route.antA.id) || firstRx; m.c.antB = m.c.antB || null;
  });
}

/** feedValue(rack, receiver, channel) -> the setChannelFeed value describing the current feed. */
export const feedValue = (r, c) => (r && r.loopFrom ? `loop:${r.loopFrom}` : c && c.splitterId ? `splitter:${c.splitterId}` : 'antennas');
