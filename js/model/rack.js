// Receive rack (pure): the radio items of a job as a categorised list that the link maths is compiled from.
//   scene.rack (optional) = { antennas:[{id,name,pos,antenna}], splitters:[{id,name,type:'passive'|'active',antA,antB}],
//                             receivers:[{id,name,channels:[{id,linkId,splitterId?,antA?,antB?}]}] }
// A channel is one mic link on one receiver channel. Its receive antenna A (and B) comes from its splitter's inputs, else from its own antA/antB.
// compileRack(scene) copies the antennas into each channel link (rx.pos, rx.antenna, rx.diversity.antennaB) and puts one splitter item,
// sized to the channels on it, at the antenna end of the chain. With no scene.rack the links are used as they are.
// deriveRack(scene) describes the current links as a rack (no change to the scene) so the list can show and adopt them.
// scene.js imports this file, so the chain-item builders come in as `mk` (no import back, the module graph has no cycles).

export const RACK_LIMITS = Object.freeze({ maxAntennas: 160, maxSplitters: 32, maxReceivers: 64, maxChannels: 8, maxTransmitters: 64, maxCombiners: 32, maxSplitterDepth: 3, maxLoopHops: 3 });
export const DEFAULT_LOOP_LOSS_DB = 2; // assumed insertion loss of one receiver RF loop-through hop (typically 1 to 3 dB; not from a datasheet)
const RACK_COMBINER = Object.freeze({ passive: 'splitter-2', active: 'active-combiner-8' });
const RACK_SPLITTER = Object.freeze({ passive: 'splitter-2', active: 'active-splitter-4' });
const passivePreset = (ports) => (ports > 4 ? 'splitter-8' : ports > 2 ? 'splitter-4' : 'splitter-2'); // the excess loss grows with the port count (0.5, 1.0, 1.5 dB)
const presetFor = (table, type, ports) => (type === 'active' ? table.active : passivePreset(ports));
/** Gain given to a transmit antenna that is a dummy load: nothing is radiated. */
export const DUMMY_LOAD_GAIN_DBI = -60;
const isRackItem = (it) => !!it && it.rackSplitter === true;

// Receiver devices own their settings and their tuned frequency (rack.byFreq): a mic pairs with a receiver channel when both are on exactly the same frequency.
// The channel keeps the receiver's own settings in channel.rx; the matched link only shows them (compileRack puts them on link.rx, edits to link.rx go back to the channel).
const RX_OWN_SKIP = new Set(['id', 'pos', 'antenna', 'name']); // the link's own end: its id, where it sits (the rack antenna), and its label
/** Two tuned frequencies are the same when they agree to well under 1 Hz (typed values are compared exactly, float noise is not). */
export const sameFreq = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 5e-7;
/** rxDevice(rx) -> the receiver-owned settings of a link end (everything but its id, place, antenna and label). */
export function rxDevice(rx) { const o = {}; for (const k of Object.keys(rx || {})) if (!RX_OWN_SKIP.has(k)) o[k] = structuredClone(rx[k]); return o; }
/** txDevice(tx) -> the transmitter-owned settings of a link end (same split as rxDevice). */
export const txDevice = rxDevice;
function projectTx(l, ch) { if (ch.tx && l.tx) for (const k of Object.keys(ch.tx)) if (!RX_OWN_SKIP.has(k)) l.tx[k] = structuredClone(ch.tx[k]); }
function projectRx(l, ch) { if (ch.rx && l.rx) for (const k of Object.keys(ch.rx)) if (!RX_OWN_SKIP.has(k)) l.rx[k] = structuredClone(ch.rx[k]); }
/**
 * matchByFrequency(rack, links): sets every receiver channel's linkId to the mic link on exactly its frequency (first channel in rack order, first link in scene order, each used once),
 * or null when none is. A channel from before frequencies were stored is tuned where its link was. Returns the set of matched link ids.
 */
export function matchByFrequency(rack, links) {
  const taken = new Set(), mics = (links || []).filter((l) => l && l.kind === 'mic' && l.txOf === undefined);
  for (const r of rack.receivers || []) for (const c of r.channels || []) {
    if (!Number.isFinite(c.freqMHz)) { const old = mics.find((q) => q.id === c.linkId); c.freqMHz = old ? old.freqMHz : 600; }
    const l = mics.find((q) => !taken.has(q.id) && sameFreq(q.freqMHz, c.freqMHz));
    c.linkId = l ? l.id : null; if (l) taken.add(l.id);
  }
  const iems = (links || []).filter((l) => l && l.kind === 'iem' && l.txOf === undefined), takenT = new Set();
  for (const t of rack.transmitters || []) for (const c of t.channels || []) {
    if (!Number.isFinite(c.freqMHz)) { const old = iems.find((q) => q.id === c.linkId); c.freqMHz = old ? old.freqMHz : 100; }
    const l = iems.find((q) => !takenT.has(q.id) && sameFreq(q.freqMHz, c.freqMHz));
    c.linkId = l ? l.id : null; if (l) takenT.add(l.id);
  }
  return taken;
}

/** deriveRack(scene) -> a rack describing the mic links as they are now (shared antennas become one splitter, antenna B an antenna of its own). */
export function deriveRack(scene) {
  const links = ((scene && scene.links) || []).filter((l) => l && l.kind === 'mic');
  const rack = { byFreq: true, antennas: [], splitters: [], receivers: [] };
  const sources = links.filter((l) => l.rx.sharedAntennaOf === undefined);
  const groups = sources.map((s) => [s, ...links.filter((l) => l.rx.sharedAntennaOf === s.id)]);
  const multi = groups.filter((g) => g.length > 1).length > 1;
  let gi = 0, ri = 0;
  for (const [k, g] of groups.entries()) {
    const src = g[0], b = src.rx.diversity && src.rx.diversity.enabled ? src.rx.diversity.antennaB : null;
    // a shared antenna is numbered among the shared ones (as its splitter); an antenna of its own by its place in the list, when there are several
    const shared = g.length > 1, n = shared ? ++gi : 0, tag = shared ? (multi ? String(n) : '') : groups.length > 1 ? String(k + 1) : '';
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
      rack.receivers.push({ id: `rr_${l.id}`, name: `Rx ${ri}`, channels: [{ id: `rc_${l.id}`, linkId: l.id, freqMHz: l.freqMHz, rx: rxDevice(l.rx), splitterId: spId, ...(spId ? {} : { antA: aId, antB: b ? bId : null }) }] });
    }
  }
  rack.transmitters = []; rack.combiners = [];
  ((scene && scene.links) || []).filter((l) => l && l.kind === 'iem' && l.txOf === undefined).forEach((l, i) => {
    rack.antennas.push({ id: `ta_${l.id}`, role: 'tx', name: `Tx Antenna ${i + 1}`, pos: structuredClone(l.tx.pos), antenna: structuredClone(l.tx.antenna) });
    rack.transmitters.push({ id: `rt_${l.id}`, name: `IEM Tx ${i + 1}`, channels: [{ id: `tc_${l.id}`, linkId: l.id, freqMHz: l.freqMHz, tx: txDevice(l.tx), combinerId: null, antennaId: `ta_${l.id}` }] });
  });
  return rack;
}

/** Splitter stages ahead of (and including) a splitter, root first: [root, ..., sp]. Stops at a cycle or the depth limit. */
export function splitterStages(rack, sp) {
  const out = [], seen = new Set();
  for (let s = sp; s && !seen.has(s.id) && out.length < RACK_LIMITS.maxSplitterDepth; s = s.fromSplitter ? (rack.splitters || []).find((x) => x.id === s.fromSplitter) : null) { seen.add(s.id); out.unshift(s); }
  return out;
}
/** Receivers a looped receiver hangs behind: { hops:[receivers whose loop-through is crossed, r first], base } (base = the receiver with its own antenna feed). */
export function loopHops(rack, r) {
  const hops = [], seen = new Set([r.id]); let cur = r;
  while (cur && cur.loopFrom && !seen.has(cur.loopFrom) && hops.length < RACK_LIMITS.maxLoopHops) {
    const up = (rack.receivers || []).find((x) => x.id === cur.loopFrom); if (!up) break;
    hops.push(cur); seen.add(up.id); cur = up;
  }
  return { hops, base: cur };
}
/** Loss of one loop-through hop into receiver r (dB, the stored figure or the assumed default). */
export const loopLossOf = (r) => (Number.isFinite(r && r.loopLossDb) && r.loopLossDb >= 0 ? r.loopLossDb : DEFAULT_LOOP_LOSS_DB);
/** Outputs of a splitter in use: channels on receivers with their own feed, plus splitters cascaded from it. */
export function splitterLoad(rack, id) {
  let n = (rack.splitters || []).filter((s) => s.fromSplitter === id).length;
  for (const r of rack.receivers || []) if (!loopHops(rack, r).hops.length) n += (r.channels || []).filter((c) => c.splitterId === id).length;
  return n;
}
/** Would feeding splitter `id` from `parentId` stay acyclic and within the stage limit? (parentId null always fits.) */
export function canFeedSplitter(rack, id, parentId) {
  if (!parentId) return true;
  const sps = rack.splitters || [];
  if (parentId === id || !sps.some((s) => s.id === id) || !sps.some((s) => s.id === parentId)) return false;
  for (let s = sps.find((x) => x.id === parentId), n = 0; s; s = sps.find((x) => x.id === s.fromSplitter), n++) if (s.id === id || n > 20) return false;
  const height = (x, d = 1) => Math.max(d, ...sps.filter((c) => c.fromSplitter === x && c.id !== id).map((c) => height(c.id, d + 1)));
  const above = splitterStages(rack, sps.find((x) => x.id === parentId)).length;
  return above + height(id) <= RACK_LIMITS.maxSplitterDepth;
}
/** Would receiver `id` looping through `fromId` stay acyclic, one-to-one and within the hop limit? */
export function canLoopReceiver(rack, id, fromId) {
  if (!fromId) return true;
  const rs = rack.receivers || [];
  if (fromId === id || !rs.some((r) => r.id === id) || !rs.some((r) => r.id === fromId)) return false;
  if (rs.some((r) => r.id !== id && r.loopFrom === fromId)) return false; // one loop output feeds one receiver
  let up = 0; for (let r = rs.find((x) => x.id === fromId); r && r.loopFrom; r = rs.find((x) => x.id === r.loopFrom)) { if (r.loopFrom === id || ++up > 20) return false; }
  let down = 0; for (let r = rs.find((x) => x.loopFrom === id); r && down < 20; r = rs.find((x) => x.loopFrom === r.id)) down++;
  return up + 1 + down <= RACK_LIMITS.maxLoopHops;
}

/** Antennas, splitter stages and loop hops that a channel resolves to: { splitter (the last stage), stages (root first), antA, antB, hops, loopLossDb }. Pass the receiver `r` to follow its loop-through. */
export function channelRoute(rack, ch, r) {
  const ant = (id) => (rack.antennas || []).find((a) => a.id === id) || null;
  let feed = ch, hops = [];
  if (r) { const lh = loopHops(rack, r); if (lh.hops.length) { hops = lh.hops; feed = (lh.base.channels || [])[0] || { splitterId: null, antA: null, antB: null }; } }
  const sp = feed.splitterId ? (rack.splitters || []).find((s) => s.id === feed.splitterId) || null : null;
  const stages = sp ? splitterStages(rack, sp) : [], root = stages[0] || null;
  return { splitter: sp, stages, antA: ant(root ? root.antA : feed.antA), antB: ant(root ? root.antB : feed.antB), hops, loopLossDb: hops.reduce((t, h) => t + loopLossOf(h), 0) };
}

/** feedAntenna(rack, linkId, which) -> the rack antenna that sets where a link's end sits ('rx' / 'rxB': the receive antennas of a mic link, 'tx': the transmit antenna of an IEM link), or null. Dragging that end on the plan must move this antenna, or the next compile puts it back. */
export function feedAntenna(rack, linkId, which) {
  if (!rack) return null;
  const ant = (id) => (rack.antennas || []).find((a) => a.id === id) || null;
  if (which === 'tx') {
    for (const t of rack.transmitters || []) for (const c of t.channels || []) {
      if (c.linkId !== linkId) continue;
      const cb = c.combinerId ? (rack.combiners || []).find((x) => x.id === c.combinerId) : null;
      return ant(cb ? cb.antennaId : c.antennaId);
    }
    return null;
  }
  for (const r of rack.receivers || []) for (const c of r.channels || []) {
    if (c.linkId !== linkId) continue;
    const route = channelRoute(rack, c, r);
    return which === 'rxB' ? route.antB : route.antA;
  }
  return null;
}

/**
 * adoptLinkEdits(prev, next): a link end that feeds from a rack antenna cannot be moved or re-aimed by editing the link, because the rack puts the antenna's place and type back
 * on every update. So when an update changed a link's end (a plan or side drag, a nudge, an inspector field) and left the rack antenna alone, the change is written to the rack
 * antenna instead. If the same update also changed the rack antenna, the rack wins. In place on `next`; no-op without a rack.
 */
export function adoptLinkEdits(prev, next) {
  const rack = next && next.rack;
  if (!rack || !prev || !Array.isArray(prev.links) || !Array.isArray(next.links)) return;
  const was = new Map(prev.links.map((l) => [l.id, l])), wasAnt = new Map(((prev.rack && prev.rack.antennas) || []).map((a) => [a.id, a]));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const pull = (fa, end, prevEnd) => {
    if (!fa || !end || !prevEnd) return;
    const pa = wasAnt.get(fa.id);
    if (pa && !same(pa, fa)) return; // the rack side changed in this update: it wins
    if (end.pos && typeof end.pos === 'object' && !same(end.pos, prevEnd.pos)) fa.pos = structuredClone(end.pos);
    if (end.antenna && typeof end.antenna === 'object' && !same(end.antenna, prevEnd.antenna)) fa.antenna = structuredClone(end.antenna);
  };
  const wasCh = new Map(); for (const r of (prev.rack && prev.rack.receivers) || []) for (const c of r.channels || []) wasCh.set(c.id, c);
  const wasTc = new Map(); for (const t of (prev.rack && prev.rack.transmitters) || []) for (const c of t.channels || []) wasTc.set(c.id, c);
  for (const l of next.links) {
    const p = was.get(l.id); if (!p) continue;
    if (rack.byFreq === true && l.kind === 'iem' && l.txOf === undefined && l.tx && p.tx) for (const t of rack.transmitters || []) for (const c of t.channels || []) { // a transmitter setting edited on the link is edited on its transmitter
      if (c.linkId !== l.id) continue;
      const pc = wasTc.get(c.id), c0 = (pc && pc.tx) || {};
      for (const k of Object.keys(l.tx)) if (!RX_OWN_SKIP.has(k) && !same(l.tx[k], p.tx[k]) && same(c0[k], (c.tx || {})[k])) { c.tx = c.tx || {}; c.tx[k] = structuredClone(l.tx[k]); }
    }
    if (rack.byFreq === true && l.kind === 'mic' && l.rx && p.rx) for (const r of rack.receivers || []) for (const c of r.channels || []) { // a receiver setting edited on the link is edited on its receiver
      if (c.linkId !== l.id) continue;
      const pc = wasCh.get(c.id), c0 = (pc && pc.rx) || {};
      for (const k of Object.keys(l.rx)) if (!RX_OWN_SKIP.has(k) && !same(l.rx[k], p.rx[k]) && same(c0[k], (c.rx || {})[k])) { c.rx = c.rx || {}; c.rx[k] = structuredClone(l.rx[k]); }
    }
    pull(feedAntenna(rack, l.id, 'rx'), l.rx, p.rx);
    pull(feedAntenna(rack, l.id, 'tx'), l.tx, p.tx);
    const b = l.rx && l.rx.diversity && l.rx.diversity.antennaB, pb = p.rx && p.rx.diversity && p.rx.diversity.antennaB;
    if (b && pb) pull(feedAntenna(rack, l.id, 'rxB'), b, pb);
  }
}

const freeId = (base, taken) => { let id = base, n = 2; while (taken.includes(id)) id = `${base}_${n++}`; return id; };

/** compileRack(scene): in place, no-op without scene.rack. Dangling channels are left alone; a splitter with no antenna A leaves its links' antennas untouched. */
export function compileRack(scene, mk) {
  const rack = scene && scene.rack;
  if (!rack || !Array.isArray(rack.receivers)) return scene;
  const links = scene.links || [], used = new Map();
  const zoneIds = new Set((scene.zones || []).map((z) => z.id));
  for (const a of rack.antennas || []) if (Array.isArray(a.zones)) a.zones = a.zones.filter((z) => zoneIds.has(z)); // a deleted zone leaves the list
  const byFreq = rack.byFreq === true;
  if (byFreq) matchByFrequency(rack, links); // devices are independent: a receiver channel keeps existing with no mic, and a mic with no receiver
  else for (const r of rack.receivers) r.channels = (r.channels || []).filter((c) => links.some((l) => l.id === c.linkId && l.kind === 'mic')); // a link that went or changed kind leaves its channel
  if (!byFreq) rack.receivers = rack.receivers.filter((r) => r.channels.length);
  const placed = new Set(rack.receivers.flatMap((r) => r.channels.map((c) => c.linkId)));
  for (const l of links) { // a mic link added after the rack was made gets its own receiver and antenna
    if (byFreq || l.kind !== 'mic' || placed.has(l.id) || rack.receivers.length >= RACK_LIMITS.maxReceivers || rack.antennas.length >= RACK_LIMITS.maxAntennas) continue;
    if (!rack.antennas.some((x) => x.id === `ra_${l.id}`)) rack.antennas.push({ id: `ra_${l.id}`, name: `Rx antenna for ${l.name || 'mic'}`, pos: structuredClone(l.rx.pos), antenna: structuredClone(l.rx.antenna) }); // reuse one left behind by the same link
    const rid = freeId(`rr_${l.id}`, rack.receivers.map((r) => r.id)), cid = freeId(`rc_${l.id}`, rack.receivers.flatMap((r) => r.channels.map((c) => c.id))); // a stale id of the same link is not reused
    rack.receivers.push({ id: rid, name: `Rx ${rack.receivers.length + 1}`, channels: [{ id: cid, linkId: l.id, splitterId: null, antA: `ra_${l.id}`, antB: null }] });
  }
  for (const r of rack.receivers) if (r.loopFrom && !rack.receivers.some((x) => x.id === r.loopFrom)) delete r.loopFrom; // the receiver it looped from is gone
  for (const r of rack.receivers) for (const ch of r.channels || []) {
    const l = links.find((q) => q.id === ch.linkId);
    if (!l || l.kind !== 'mic') continue;
    if (byFreq) projectRx(l, ch); // the receiver's own settings are what the link shows
    delete l.rx.sharedAntennaOf; // the rack owns the sharing now
    l.chain = (l.chain || []).filter((it) => !isRackItem(it));
    const { splitter, stages, antA, antB, hops, loopLossDb } = channelRoute(rack, ch, r);
    const run = (a, tag) => ((a && a.chain) || []).map((it) => ({ ...structuredClone(it), id: `${String(it.id || 'ci').slice(0, 24)}_${tag}${l.id.slice(0, 30)}`, rackSplitter: true })); // an antenna's own cable, booster or fibre run, in front of any splitter
    const preA = run(antA, 'a'), preB = run(antB, 'b');
    if (antA) { l.rx.pos = structuredClone(antA.pos); l.rx.antenna = structuredClone(antA.antenna); }
    const div = l.rx.diversity;
    if (div && antB) { div.enabled = true; div.antennaB = { ...(div.antennaB || {}), pos: structuredClone(antB.pos), antenna: structuredClone(antB.antenna) }; }
    else if (div && ch.antB === null && !splitter && div.enabled) { /* channel says no antenna B: leave the link's own setting */ }
    const stageItems = (pre) => stages.map((st, k) => ({ ...mk.fromPreset(presetFor(RACK_SPLITTER, st.type, Math.min(Math.max(splitterLoad(rack, st.id) || 2, st.ports || 2), 16)), { ports: Math.min(Math.max(splitterLoad(rack, st.id) || 2, st.ports || 2), 16) }), id: `${pre}${k === stages.length - 1 ? '' : k}_${l.id.slice(0, 40)}`, rackSplitter: true }));
    const items = stageItems('sp'), itemsB = stageItems('spb');
    const loop = hops.length ? [{ ...mk.item('attenuator', { lossDb: loopLossDb, name: `Receiver loop-through (${hops.length} hop${hops.length === 1 ? '' : 's'})`, assumed: hops.some((h) => !Number.isFinite(h.loopLossDb)) }), id: `lp_${l.id.slice(0, 40)}`, rackSplitter: true }] : [];
    const loopB = loop.map((it) => ({ ...it, id: `lpb_${l.id.slice(0, 40)}` }));
    const jumper = l.chain; // what is left once the rack items are out: the receiver's own leads
    l.chain = [...preA, ...items, ...loop, ...jumper];
    if (div && div.antennaB) {
      const own = Array.isArray(div.antennaB.chain) ? div.antennaB.chain.filter((it) => !isRackItem(it)) : null;
      if (antB && (preA.length || preB.length || own || loop.length)) div.antennaB.chain = [...preB, ...itemsB, ...loopB, ...(own || structuredClone(jumper))];
      else if (own) div.antennaB.chain = own;
    }
  }
  compileTxRack(scene, rack, links, mk);
  return scene;
}

function compileTxRack(scene, rack, links, mk) {
  if (!Array.isArray(rack.transmitters)) rack.transmitters = [];
  if (!Array.isArray(rack.combiners)) rack.combiners = [];
  const byFreq = rack.byFreq === true; // devices are independent: matchByFrequency (run for the receivers) already paired each transmitter channel with the bodypack link on its exact frequency
  if (!byFreq) {
    for (const t of rack.transmitters) t.channels = (t.channels || []).filter((c) => links.some((l) => l.id === c.linkId && l.kind === 'iem' && l.txOf === undefined));
    rack.transmitters = rack.transmitters.filter((t) => t.channels.length);
  }
  const placed = new Set(rack.transmitters.flatMap((t) => t.channels.map((c) => c.linkId)));
  for (const l of links) {
    if (byFreq || l.kind !== 'iem' || l.txOf !== undefined || placed.has(l.id) || rack.transmitters.length >= RACK_LIMITS.maxTransmitters || rack.antennas.length >= RACK_LIMITS.maxAntennas) continue;
    if (!rack.antennas.some((x) => x.id === `ta_${l.id}`)) rack.antennas.push({ id: `ta_${l.id}`, role: 'tx', name: `Tx antenna for ${l.name || 'IEM'}`, pos: structuredClone(l.tx.pos), antenna: structuredClone(l.tx.antenna) }); // an antenna left behind by a link that changed kind or was deleted is reused
    const tid = freeId(`rt_${l.id}`, rack.transmitters.map((t) => t.id)), cid = freeId(`tc_${l.id}`, rack.transmitters.flatMap((t) => t.channels.map((c) => c.id)));
    rack.transmitters.push({ id: tid, name: `IEM Tx ${rack.transmitters.length + 1}`, channels: [{ id: cid, linkId: l.id, combinerId: null, antennaId: `ta_${l.id}` }] });
  }
  const used = new Map();
  for (const t of rack.transmitters) for (const c of t.channels) if (c.combinerId) used.set(c.combinerId, (used.get(c.combinerId) || 0) + 1);
  for (const t of rack.transmitters) for (const c of t.channels) {
    const l = links.find((q) => q.id === c.linkId); if (!l) continue;
    if (byFreq) projectTx(l, c);
    const cb = c.combinerId ? rack.combiners.find((x) => x.id === c.combinerId) : null;
    const fan = cb && cb.fanout && Array.isArray(cb.fanout.outputs) ? cb.fanout : null;
    const fanOut = fan ? fan.outputs.find((o) => o && rack.antennas.some((a) => a.id === o.antennaId)) || null : null; // the output this link is solved on: the first one with an antenna
    const ant = rack.antennas.find((a) => a.id === (fan ? (fanOut && fanOut.antennaId) : cb ? cb.antennaId : c.antennaId));
    l.chain = (l.chain || []).filter((it) => !isRackItem(it));
    if (ant) { l.tx.pos = structuredClone(ant.pos); l.tx.antenna = structuredClone(ant.antenna); if (ant.load) l.tx.antenna.gainDbi = DUMMY_LOAD_GAIN_DBI; } // a 50 ohm load radiates nothing
    if (cb) {
      const items = [{ ...mk.fromPreset(presetFor(RACK_COMBINER, cb.type, Math.min(Math.max(used.get(cb.id) || 2, cb.ports || 2), 16)), { ports: Math.min(Math.max(used.get(cb.id) || 2, cb.ports || 2), 16) }), rackSplitter: true }];
      if (cb.cable && cb.cable.lengthM > 0) items.push({ ...mk.item('cable', { cableType: cb.cable.type || 'rg58', lengthM: cb.cable.lengthM }), rackSplitter: true });
      if (fan) { // combiner > (cable) > splitter > that output's own cable > antenna; every output pays the same split loss
        items.push({ ...mk.fromPreset(presetFor(RACK_SPLITTER, fan.type, Math.min(Math.max(fan.outputs.length, fan.ports || 2, 2), 16)), { ports: Math.min(Math.max(fan.outputs.length, fan.ports || 2, 2), 16) }), rackSplitter: true });
        const oc = fanOut && fanOut.cable;
        if (oc && oc.lengthM > 0) items.push({ ...mk.item('cable', { cableType: oc.type || 'rg58', lengthM: oc.lengthM }), rackSplitter: true });
      }
      l.chain.unshift(...items);
    }
    if (c.isolator) l.chain.unshift({ ...mk.item('attenuator', { lossDb: ISOLATOR_LOSS_DB, reverseIsolationDb: isolatorDb(c) }), rackSplitter: true }); // first in the chain: straight after the Tx output stage
  }
}

export const ISOLATOR_LOSS_DB = 0.5, ISOLATOR_DEFAULT_DB = 25;
/** Reverse isolation of a channel's isolator or circulator in dB (default 25, kept to 10..60). Rf.js counts it as the reverse loss of the chain item, so reflected power at the PA is cut by it. */
export const isolatorDb = (c) => (Number.isFinite(c && c.isolatorDb) ? Math.min(60, Math.max(10, c.isolatorDb)) : ISOLATOR_DEFAULT_DB);

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
    else r.channels.forEach((c, j) => { take(c && c.id, `rack.receivers[${i}].channels[${j}]`); if (!safe(c.linkId) && !(rack.byFreq === true && (c.linkId === null || c.linkId === undefined))) errors.push(`rack.receivers[${i}].channels[${j}].linkId invalid`);
      if (c.freqMHz !== undefined && !(typeof c.freqMHz === 'number' && Number.isFinite(c.freqMHz) && c.freqMHz > 0 && c.freqMHz <= 100000)) errors.push(`rack.receivers[${i}].channels[${j}].freqMHz must be a frequency in MHz`);
      if (c.rx !== undefined && !isObj(c.rx)) errors.push(`rack.receivers[${i}].channels[${j}].rx must be an object`); });
  });
  for (const [k, max] of [['transmitters', RACK_LIMITS.maxTransmitters], ['combiners', RACK_LIMITS.maxCombiners]]) if (rack[k] !== undefined && (!Array.isArray(rack[k]) || rack[k].length > max)) errors.push(`rack.${k} must be an array of at most ${max}`);
  if (errors.length) return errors;
  for (const k of ['splitters', 'combiners']) (rack[k] || []).forEach((x, i) => { if (x.ports !== undefined && !(Number.isInteger(x.ports) && x.ports >= 2 && x.ports <= 16)) errors.push(`rack.${k}[${i}].ports must be a whole number from 2 to 16`); });
  rack.antennas.forEach((a, i) => { if (a.chain !== undefined && (!Array.isArray(a.chain) || a.chain.length > 8)) errors.push(`rack.antennas[${i}].chain must be an array of at most 8 items`); if (a.zones !== undefined && (!Array.isArray(a.zones) || a.zones.length > 100 || !a.zones.every(safe))) errors.push(`rack.antennas[${i}].zones must be a list of zone ids`); });
  rack.antennas.forEach((a, i) => { if (a.load !== undefined && typeof a.load !== 'boolean') errors.push(`rack.antennas[${i}].load must be true or false`); });
  rack.splitters.forEach((s, i) => { if (s.fromSplitter !== undefined && s.fromSplitter !== null && (!safe(s.fromSplitter) || s.fromSplitter === s.id || !rack.splitters.some((x) => x.id === s.fromSplitter))) errors.push(`rack.splitters[${i}].fromSplitter must be the id of another splitter`); });
  if (!errors.length) rack.splitters.forEach((s, i) => {
    let n = 1, c = s, cyc = false;
    while (c && c.fromSplitter && n <= 64) { c = rack.splitters.find((x) => x.id === c.fromSplitter); n++; if (c === s) { cyc = true; break; } }
    if (cyc) errors.push(`rack.splitters[${i}] feeds itself through a loop of splitters`);
    else if (n > RACK_LIMITS.maxSplitterDepth) errors.push(`rack.splitters[${i}] is more than ${RACK_LIMITS.maxSplitterDepth} splitter stages deep`);
  });
  if (!errors.length) { // receive and transmit antennas are separate pools
    const tx = new Set(rack.antennas.filter((a) => a.role === 'tx').map((a) => a.id)), have = new Set(rack.antennas.map((a) => a.id));
    const bad = (id, wantTx, p) => { if (id && have.has(id) && tx.has(id) !== wantTx) errors.push(`${p} must be a ${wantTx ? 'transmit' : 'receive'} antenna`); };
    rack.splitters.forEach((s, i) => { bad(s.antA, false, `rack.splitters[${i}].antA`); bad(s.antB, false, `rack.splitters[${i}].antB`); });
    rack.receivers.forEach((r, i) => r.channels.forEach((c, j) => { bad(c.antA, false, `rack.receivers[${i}].channels[${j}].antA`); bad(c.antB, false, `rack.receivers[${i}].channels[${j}].antB`); }));
    (rack.transmitters || []).forEach((t, i) => (t.channels || []).forEach((c, j) => bad(c.antennaId, true, `rack.transmitters[${i}].channels[${j}].antennaId`)));
    (rack.combiners || []).forEach((cb, i) => { bad(cb.antennaId, true, `rack.combiners[${i}].antennaId`); if (cb.fanout && Array.isArray(cb.fanout.outputs)) cb.fanout.outputs.forEach((o, j) => o && bad(o.antennaId, true, `rack.combiners[${i}].fanout.outputs[${j}].antennaId`)); });
  }
  if (!errors.length) {
    const fed = new Set();
    rack.receivers.forEach((r, i) => {
      if (r.loopLossDb !== undefined && !(num(r.loopLossDb) && r.loopLossDb >= 0 && r.loopLossDb <= 20)) errors.push(`rack.receivers[${i}].loopLossDb must be from 0 to 20 dB`);
      if (r.loopFrom === undefined || r.loopFrom === null) return;
      if (!safe(r.loopFrom) || r.loopFrom === r.id || !rack.receivers.some((x) => x.id === r.loopFrom)) { errors.push(`rack.receivers[${i}].loopFrom must be the id of another receiver`); return; }
      if (fed.has(r.loopFrom)) errors.push(`rack.receivers[${i}].loopFrom: that receiver's loop-through already feeds another receiver`);
      fed.add(r.loopFrom);
      let n = 0, c = r, cyc = false;
      while (c && c.loopFrom && n <= 64) { c = rack.receivers.find((x) => x.id === c.loopFrom); n++; if (c === r) { cyc = true; break; } }
      if (cyc) errors.push(`rack.receivers[${i}] loops through itself`);
      else if (n > RACK_LIMITS.maxLoopHops) errors.push(`rack.receivers[${i}] is more than ${RACK_LIMITS.maxLoopHops} loop-through hops from its antenna feed`);
    });
  }
  if (errors.length) return errors;
  (rack.combiners || []).forEach((c, i) => { take(c && c.id, `rack.combiners[${i}]`); if (c.type !== 'passive' && c.type !== 'active') errors.push(`rack.combiners[${i}].type must be passive or active`); if (c.cable && !(num(c.cable.lengthM) && c.cable.lengthM >= 0 && safe(c.cable.type))) errors.push(`rack.combiners[${i}].cable invalid`);
    const f = c.fanout; if (f === undefined) return;
    if (!isObj(f) || (f.type !== 'passive' && f.type !== 'active') || !Array.isArray(f.outputs) || f.outputs.length > 16) { errors.push(`rack.combiners[${i}].fanout must be { type, outputs: [...up to 16] }`); return; }
    if (f.ports !== undefined && !(Number.isInteger(f.ports) && f.ports >= 2 && f.ports <= 16)) errors.push(`rack.combiners[${i}].fanout.ports must be a whole number from 2 to 16`);
    f.outputs.forEach((o, j) => { if (!isObj(o) || (o.antennaId !== null && !safe(o.antennaId)) || (o.cable && !(num(o.cable.lengthM) && o.cable.lengthM >= 0 && safe(o.cable.type)))) errors.push(`rack.combiners[${i}].fanout.outputs[${j}] invalid`); });
  });
  (rack.transmitters || []).forEach((t, i) => {
    take(t && t.id, `rack.transmitters[${i}]`);
    if (!Array.isArray(t.channels) || t.channels.length > RACK_LIMITS.maxChannels) errors.push(`rack.transmitters[${i}].channels must be an array of at most ${RACK_LIMITS.maxChannels}`);
    else t.channels.forEach((c, j) => { take(c && c.id, `rack.transmitters[${i}].channels[${j}]`); if (!safe(c.linkId) && !(rack.byFreq === true && (c.linkId === null || c.linkId === undefined))) errors.push(`rack.transmitters[${i}].channels[${j}].linkId invalid`);
      if (rack.byFreq === true && c.freqMHz !== undefined && !(num(c.freqMHz) && c.freqMHz > 0 && c.freqMHz <= 100000)) errors.push(`rack.transmitters[${i}].channels[${j}].freqMHz invalid`);
      if (c.isolatorDb !== undefined && !(num(c.isolatorDb) && c.isolatorDb >= 10 && c.isolatorDb <= 60)) errors.push(`rack.transmitters[${i}].channels[${j}].isolatorDb must be 10 to 60`); });
  });
  return errors;
}

/**
 * rackSections(scene) -> the radio items in categories, as plain data for the list (works on scene.rack or, without one, on deriveRack(scene)):
 * formOf(link) -> 'handheld' | 'bodypack' | 'plug-on' | other: splits the microphones into one category each (omit it for a single list).
 *   [{ key, title, items:[{ id, kind, text }] }] with kinds mic, antenna, splitter, receiver (one item per channel), transmitter (per channel), combiner, txantenna, bodypack,
 *   in signal order: microphones, receive antennas, splitters, receivers; then IEM transmitters, combiners, transmit antennas, bodypacks.
 */
const fmtF = (f) => (Number.isFinite(f) ? String(Math.round(f * 1e4) / 1e4) : '?');
/** The id a receiver channel's list item and warnings go by: its mic's id while paired (so the mic's own rows follow it), else its own channel id. */
export const channelItemId = (c) => c.linkId || c.id;

export function rackSections(scene, formOf) {
  const rack = scene.rack || deriveRack(scene), links = scene.links || [];
  const nameOf = (id) => { const l = links.find((q) => q.id === id); return l ? String(l.name || l.id) : '?'; };
  const an = (id) => { const a = (rack.antennas || []).find((x) => x.id === id); return a ? a.name : 'no antenna'; };
  const rxAnts = (rack.antennas || []).filter((a) => a.role !== 'tx'), txAnts = (rack.antennas || []).filter((a) => a.role === 'tx');
  const sp = (id) => (rack.splitters || []).find((x) => x.id === id), cb = (id) => (rack.combiners || []).find((x) => x.id === id);
  const chanName = (c) => (c.linkId ? nameOf(c.linkId) : `${fmtF(c.freqMHz)} MHz`);
  const sections = [];
  const mic = links.filter((l) => l.kind === 'mic' && l.txOf === undefined); // an extra receiver of a mic has no transmitter item of its own
  const heard = new Set((rack.receivers || []).flatMap((r) => r.channels.map((c) => c.linkId)).filter(Boolean));
  const byFreq = rack.byFreq === true;
  const micItems = (list) => list.map((l) => ({ id: l.id, kind: 'mic', matched: !byFreq || heard.has(l.id), text: `${String(l.name || l.id)}${byFreq && !heard.has(l.id) ? ' (no receiver on this frequency)' : ''}` }));
  if (mic.length && typeof formOf !== 'function') sections.push({ key: 'mics', title: 'Microphones', items: micItems(mic) });
  else for (const [f, title] of [['handheld', 'Handheld microphones'], ['bodypack', 'Bodypack transmitters'], ['plug-on', 'Plug-on transmitters'], ['other', 'Other microphones (no model chosen)']]) {
    const group = mic.filter((l) => (['handheld', 'bodypack', 'plug-on'].includes(formOf(l)) ? formOf(l) : 'other') === f);
    if (group.length) sections.push({ key: `mics-${f}`, title, items: micItems(group) });
  }
  if (rxAnts.length) sections.push({ key: 'rxant', title: 'Receive antennas', items: rxAnts.map((a) => {
    const to = [];
    for (const s of rack.splitters || []) { if (s.fromSplitter) continue; if (s.antA === a.id) to.push(`${s.name} A`); if (s.antB === a.id) to.push(`${s.name} B`); }
    for (const r of rack.receivers || []) for (const c of r.channels) if (!c.splitterId && !r.loopFrom && (c.antA === a.id || c.antB === a.id)) to.push(`${r.name} (${chanName(c)})${c.antB === a.id ? ' B' : ''}`);
    return { id: a.id, kind: 'antenna', text: `${a.name}${to.length ? ` connected to ${to.join(', ')}` : ' not connected'}` };
  }) });
  if ((rack.splitters || []).length) sections.push({ key: 'splitters', title: 'Splitters', items: rack.splitters.map((s) => {
    const n = splitterLoad(rack, s.id), par = s.fromSplitter ? sp(s.fromSplitter) : null;
    return { id: s.id, kind: 'splitter', text: `${s.name} (${s.type}, ${n} output${n === 1 ? '' : 's'}): ${par ? `fed from ${par.name}` : `A from ${an(s.antA)}${s.antB ? `, B from ${an(s.antB)}` : ''}`}` };
  }) });
  if ((rack.receivers || []).length) sections.push({ key: 'receivers', title: 'Receivers', items: rack.receivers.flatMap((r) => r.channels.map((c, i) => {
    const lh = loopHops(rack, r), up = lh.hops.length ? rack.receivers.find((x) => x.id === r.loopFrom) : null;
    const s = !up && c.splitterId ? sp(c.splitterId) : null;
    const to = up ? `the loop-through of ${up.name} (${lh.hops.length} hop${lh.hops.length === 1 ? '' : 's'}, ${lh.hops.reduce((t, h) => t + loopLossOf(h), 0)} dB${lh.hops.some((h) => !Number.isFinite(h.loopLossDb)) ? ' assumed' : ''})` : s ? `${s.name}${s.antB ? ' A&B' : ' A'}` : `${an(c.antA)}${c.antB ? ` and ${an(c.antB)}` : ''}`;
    return { id: channelItemId(c), channelId: c.id, linkId: c.linkId || null, freqMHz: c.freqMHz, matched: !!c.linkId, kind: 'receiver', text: `${c.linkId ? nameOf(c.linkId) : `${fmtF(c.freqMHz)} MHz, no mic on this frequency`} > ${r.name}${r.channels.length > 1 ? ` channel ${i + 1}` : ''} connected to ${to}` };
  })) });
  const iem = (rack.transmitters || []);
  if (iem.length) sections.push({ key: 'iems', title: 'In-ear transmitters', items: iem.flatMap((t) => t.channels.map((c, i) => {
    const b = c.combinerId ? cb(c.combinerId) : null;
    const fo = b && b.fanout && Array.isArray(b.fanout.outputs) ? b.fanout.outputs : null;
    const tail = fo ? `splitter > ${fo.map((o) => `${o.cable ? `${o.cable.lengthM} m cable > ` : ''}${an(o.antennaId)}`).join(' and ') || 'no antenna'}` : an(b ? b.antennaId : c.antennaId);
    const path = b ? `${b.name}${b.cable ? ` > ${b.cable.lengthM} m cable` : ''} > ${tail}` : tail;
    return { id: channelItemId(c), channelId: c.id, linkId: c.linkId || null, freqMHz: c.freqMHz, matched: !!c.linkId, kind: 'transmitter', text: `${t.name} Channel ${i + 1} (${c.linkId ? nameOf(c.linkId) : `${fmtF(c.freqMHz)} MHz, no bodypack on this frequency`}) > ${c.isolator ? `isolator (${ISOLATOR_LOSS_DB} dB loss, ${isolatorDb(c)} dB isolation) > ` : ''}${path}` };
  })) });
  if ((rack.combiners || []).length) sections.push({ key: 'combiners', title: 'Combiners', items: rack.combiners.map((b) => ({ id: b.id, kind: 'combiner', text: `${b.name} (${b.type}) > ${b.cable ? `${b.cable.lengthM} m cable > ` : ''}${b.fanout && Array.isArray(b.fanout.outputs) ? `splitter > ${b.fanout.outputs.map((o) => `${o.cable ? `${o.cable.lengthM} m cable > ` : ''}${an(o.antennaId)}`).join(' and ') || 'no antenna'}` : an(b.antennaId)}` })) });
  if (txAnts.length) sections.push({ key: 'txant', title: 'Transmit antennas', items: txAnts.map((a) => ({ id: a.id, kind: 'txantenna', text: a.load ? `${a.name} (50 ohm dummy load)` : a.name })) });
  const iemLinks = links.filter((l) => l.kind === 'iem'), hearsTx = new Set((rack.transmitters || []).flatMap((t) => t.channels.map((c) => c.linkId)).filter(Boolean));
  if (iemLinks.length) sections.push({ key: 'bodypacks', title: 'In-ear bodypacks', items: iemLinks.map((l) => { const own = l.txOf === undefined, lone = byFreq && own && !hearsTx.has(l.id); return { id: l.id, kind: 'bodypack', matched: !lone, text: `${l.name || l.id} bodypack${lone ? ' (no transmitter on this frequency)' : ''}` }; }) });
  return sections;
}

/** Outputs of a splitter or inputs of a combiner that nothing is plugged into: [{ id, kind, name, free }] (only where `ports` was set above the number in use). */
function freePorts(rack) {
  const out = [];
  const usedBy = (key, id) => [...(rack.receivers || []), ...(rack.transmitters || [])].reduce((n, r) => n + r.channels.filter((c) => c[key] === id).length, 0);
  for (const s of rack.splitters || []) { const free = (s.ports || 0) - splitterLoad(rack, s.id); if (free > 0) out.push({ id: s.id, kind: 'splitter', name: s.name, free }); }
  for (const c of rack.combiners || []) { const free = (c.ports || 0) - usedBy('combinerId', c.id); if (free > 0) out.push({ id: c.id, kind: 'combiner', name: c.name, free }); }
  return out;
}

/** rackWarnings(scene) -> [{ key, level: 'warn'|'info', text }] ; key is "<kind>:<id>" of the list item it belongs to. */
export function rackWarnings(scene, bwOf, opts) { // opts.erpOf(link) -> { level, text } | null supplies the ERP / EIRP check (erp.js), passed in so this file keeps no imports; bwOf(link) -> occupied bandwidth in kHz, for the same-frequency / overlap check
  const rack = scene.rack || deriveRack(scene), links = scene.links || [], w = [];
  const nm = (id) => { const l = links.find((q) => q.id === id); return l ? String(l.name || l.id) : '?'; };
  const ant = (id) => (rack.antennas || []).find((a) => a.id === id);
  const open = 'it can be damaged transmitting into an open output. Connect an antenna or fit a 50 ohm load';
  for (const t of rack.transmitters || []) for (const c of t.channels) {
    if (!c.combinerId && !ant(c.antennaId)) w.push({ key: `transmitter:${channelItemId(c)}`, level: 'warn', text: `${c.linkId ? nm(c.linkId) : `The ${fmtF(c.freqMHz)} MHz transmitter`} has no antenna or load: ${open}.` });
  }
  for (const b of rack.combiners || []) {
    const n = (rack.transmitters || []).reduce((k, t) => k + t.channels.filter((c) => c.combinerId === b.id).length, 0);
    const fan = b.fanout && Array.isArray(b.fanout.outputs) ? b.fanout : null;
    if (fan) {
      if (!n) continue;
      const bare = fan.outputs.filter((o) => !o || !ant(o.antennaId)).length + (fan.outputs.length ? 0 : 1);
      if (bare) w.push({ key: `combiner:${b.id}`, level: 'warn', text: `${b.name} splitter has ${bare} output${bare === 1 ? '' : 's'} with no antenna or load: ${open}.` });
      const free = (fan.ports || 0) - fan.outputs.length;
      if (free > 0) w.push({ key: `combiner:${b.id}`, level: 'info', text: `${b.name} splitter has ${free} unused output${free === 1 ? '' : 's'}: fit a 50 ohm load on ${free === 1 ? 'it' : 'each'}.` });
    } else if (n && !ant(b.antennaId)) w.push({ key: `combiner:${b.id}`, level: 'warn', text: `${b.name} output has no antenna or load: ${open}.` });
  }
  const zones = scene.zones || [], rxAnt = (rack.antennas || []).filter((a) => a.role !== 'tx');
  if (zones.length && scene.rack) {
    for (const z of zones) if (!rxAnt.some((a) => (a.zones || []).includes(z.id))) w.push({ key: `zone:${z.id}`, level: 'info', text: `Zone ${z.name || z.id} has no receive antenna serving it.` });
    for (const a of rxAnt) if (!(a.zones || []).length) w.push({ key: `antenna:${a.id}`, level: 'info', text: `${a.name} serves no zone.` });
  }
  for (const t of tuningClashes(scene, bwOf)) for (const k of [t.a, t.b].map((id) => `${(links.find((q) => q.id === id) || {}).kind === 'iem' ? 'transmitter' : 'mic'}:${id}`)) w.push({ key: k, level: 'warn', text: t.text });
  if (opts && typeof opts.erpOf === 'function') for (const l of links) {
    if (l.kind !== 'iem' && l.kind !== 'mic') continue;
    const r = opts.erpOf(l);
    if (r && r.level) w.push({ key: `${l.kind === 'iem' ? 'transmitter' : 'mic'}:${l.id}`, level: r.level === 'info' ? 'info' : 'warn', text: `${nm(l.id)}: ${r.text}` });
  }
  for (const r of rack.receivers || []) { const lh = loopHops(rack, r); if (lh.hops.length && lh.hops.some((h) => !Number.isFinite(h.loopLossDb))) for (const c of r.channels) w.push({ key: `receiver:${channelItemId(c)}`, level: 'info', text: `${c.linkId ? nm(c.linkId) : `${fmtF(c.freqMHz)} MHz`} is fed through ${lh.hops.length} receiver loop-through hop${lh.hops.length === 1 ? '' : 's'}: the loss per hop is assumed (${DEFAULT_LOOP_LOSS_DB} dB); check the receiver data sheet.` }); }
  if (rack.byFreq === true) {
    const heard = new Set((rack.receivers || []).flatMap((r) => r.channels.map((c) => c.linkId)).filter(Boolean));
    for (const l of links) if (l.kind === 'mic' && l.txOf === undefined && !heard.has(l.id)) w.push({ key: `mic:${l.id}`, level: 'warn', text: `${nm(l.id)} has no receiver tuned to ${fmtF(l.freqMHz)} MHz: it is not heard and no link is solved for it. Add a receiver on exactly this frequency.` });
    const hearsTx = new Set((rack.transmitters || []).flatMap((t) => t.channels.map((c) => c.linkId)).filter(Boolean));
    for (const l of links) if (l.kind === 'iem' && l.txOf === undefined && !hearsTx.has(l.id)) w.push({ key: `bodypack:${l.id}`, level: 'warn', text: `${nm(l.id)} has no transmitter tuned to ${fmtF(l.freqMHz)} MHz: nothing is sent to it and no link is solved for it. Add a transmitter on exactly this frequency.` });
    for (const t of rack.transmitters || []) for (const c of t.channels) if (!c.linkId) w.push({ key: `transmitter:${c.id}`, level: 'warn', text: `${t.name} is tuned to ${fmtF(c.freqMHz)} MHz and no bodypack is on exactly that frequency.` });
    for (const r of rack.receivers || []) for (const c of r.channels) if (!c.linkId) w.push({ key: `receiver:${c.id}`, level: 'warn', text: `${r.name} is tuned to ${fmtF(c.freqMHz)} MHz and no mic is on exactly that frequency.` });
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

/**
 * tuningClashes(scene, bwOf?) -> [{ a, b, same, text }] : pairs of mic or IEM transmitters on the same frequency or closer than their occupied bandwidths allow.
 * bwOf(link) gives the occupied bandwidth in kHz (default 200). Pairs closer than (bw1+bw2)/2 overlap; pairs closer than that plus the guard are flagged with guard: true. Two links of different kinds can still clash, since they share the air.
 * The guard depends on modulation (tuningGuardKHz): analogue FM or unknown TUNING_GUARD_KHZ; digital max(50, 350 - bw) so the carrier spacing is
 * at least 350 kHz; a pair takes the larger of its two guards. An explicit guardKHz argument overrides this for every pair. The separate
 * third-order product margin is checked by the coordination tools (coordination.js, guardKHz), not here. Returns also guardKHz and digitalGuard per pair.
 */
// Analogue FM: 100 kHz beyond the occupied bandwidth, so two 200 kHz carriers sit at least 300 kHz apart (lower edge of coordinator practice,
// 300-400 kHz; Sony 375 kHz high-density plan, Wisycom 400 kHz adjacent selectivity). Also the default when the modulation is not known.
export const TUNING_GUARD_KHZ = 100;
// Digital: carrier spacing about 350 kHz, derived from Shure ULX-D / QLX-D channel counts per TV channel (ASSUMED, no datasheet figure).
export const DIGITAL_SPACING_KHZ = 350;
export const DIGITAL_GUARD_MIN_KHZ = 50; // floor: two 25 kHz tuning steps
/** tuningGuardKHz(link, bwKHz) -> guard (kHz) for one link: digital max(50, 350 - bw), otherwise TUNING_GUARD_KHZ. */
export function tuningGuardKHz(link, bwKHz) {
  if (!(link && link.modulation && link.modulation.type === 'digital')) return TUNING_GUARD_KHZ;
  const bw = Number.isFinite(bwKHz) && bwKHz > 0 ? bwKHz : 200;
  return Math.max(DIGITAL_GUARD_MIN_KHZ, DIGITAL_SPACING_KHZ - bw);
}
export function tuningClashes(scene, bwOf, guardKHz) {
  const fixed = Number.isFinite(guardKHz) && guardKHz >= 0 ? guardKHz : null;
  const bw = (l) => { const v = bwOf ? bwOf(l) : 200; return Number.isFinite(v) && v > 0 ? v : 200; };
  const isDig = (l) => !!(l.modulation && l.modulation.type === 'digital');
  const ls = ((scene && scene.links) || []).filter((l) => l.kind !== 'p2p' && l.txOf === undefined && Number.isFinite(l.freqMHz)), out = [];
  for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
    const a = ls[i], b = ls[j], dk = Math.round(Math.abs(a.freqMHz - b.freqMHz) * 1e9) / 1e6, need = (bw(a) + bw(b)) / 2;
    const guard = fixed !== null ? fixed : Math.max(tuningGuardKHz(a, need), tuningGuardKHz(b, need));
    const digitalGuard = fixed === null && [a, b].some((l) => isDig(l) && tuningGuardKHz(l, need) === guard); // the digital rule set the guard
    if (dk >= need + guard) continue;
    const inGuard = dk >= need, same = !inGuard && dk < 0.5, nm = (l) => String(l.name || l.id);
    const why = digitalGuard ? `assumed digital spacing of about ${DIGITAL_SPACING_KHZ} kHz, check the maker's coordination` : 'assumed receiver selectivity';
    out.push({ a: a.id, b: b.id, same, guard: inGuard, guardKHz: guard, digitalGuard, text: inGuard ? `${nm(a)} and ${nm(b)} are ${Math.round(dk)} kHz apart: their bandwidths do not overlap but they are inside the ${Math.round(guard)} kHz guard band (${why}), so expect desensitisation.` : same ? `${nm(a)} and ${nm(b)} are on the same frequency (${a.freqMHz} MHz): they will interfere.` : `${nm(a)} and ${nm(b)} are ${Math.round(dk)} kHz apart, inside their ${Math.round(need)} kHz combined bandwidth: they overlap.` });
  }
  return out;
}

/** unattachedAntennas(rack) -> the rack antennas that no receiver channel, splitter, transmitter channel or combiner uses. They have no link end to draw, so the plan draws them itself. */
export function unattachedAntennas(rack) {
  if (!rack || !Array.isArray(rack.antennas)) return [];
  const used = new Set();
  const add = (id) => { if (id) used.add(id); };
  // with receivers tuned by frequency, only a receiver paired with a mic has a link end on the plan; the rest (and what only they use) are drawn as free antennas so they can be seen, selected and removed
  const live = (c) => rack.byFreq !== true || !!c.linkId, liveSp = new Set();
  for (const r of rack.receivers || []) for (const c of r.channels || []) if (live(c)) { add(c.antA); add(c.antB); for (let id = c.splitterId, n = 0; id && n < 8; n++) { liveSp.add(id); const sp = (rack.splitters || []).find((x) => x.id === id); id = sp && sp.fromSplitter; } }
  for (const s of rack.splitters || []) if (rack.byFreq !== true || liveSp.has(s.id)) { add(s.antA); add(s.antB); }
  const liveCb = new Set();
  for (const t of rack.transmitters || []) for (const c of t.channels || []) if (live(c)) { add(c.antennaId); if (c.combinerId) liveCb.add(c.combinerId); }
  for (const cb of rack.combiners || []) if (rack.byFreq !== true || liveCb.has(cb.id)) { add(cb.antennaId); if (cb.fanout && Array.isArray(cb.fanout.outputs)) for (const o of cb.fanout.outputs) if (o) add(o.antennaId); }
  return rack.antennas.filter((a) => !used.has(a.id));
}
