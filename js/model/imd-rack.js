// Intermod inputs from the rack (pure): with scene.imd.fromRack the in-ear transmitters, their antennas and the combiner network come from scene.rack, so the intermod screen and the
// rack cannot disagree. Manual scene.imd.transmitters stay as extra sources (a neighbouring venue, a transmitter that is not in the rack); they are "direct" (their own antenna).
//
// imdFromRack(scene) -> null (not a rack-fed scene) or { transmitters, topology }.
//   transmitters: one per transmitter channel paired with an IEM link and fed by an antenna: { id: the link id, name, freqMHz, powerDbm, pos, antenna, fmPreset?, lowIntermod? }.
//   topology: { groups, root? } in the shape imd.js documents. Every rack combiner with channels is a group (loss and port-to-port isolation from combinerParams; an isolated combiner carries half
//   of its isolation as a reverse isolator on every port); a combiner that feeds a root is "under the root", the root is root: { lossDb, isolationDb }. A channel's own isolator is its
//   reverse isolation (memberIsolatorDb); on a channel with no combiner it is a one-member group. A channel with no combiner and no isolator is direct.
import { feedAntenna, combinerParams, isolatorDb, ISOLATOR_LOSS_DB } from './rack.js';

export function imdFromRack(scene) {
  const rack = scene && scene.rack, m = scene && scene.imd;
  if (!rack || rack.byFreq !== true || !m || m.fromRack !== true || !Array.isArray(scene.links)) return null;
  const combiners = Array.isArray(rack.combiners) ? rack.combiners : [];
  const transmitters = [], groups = new Map(), loadOf = new Map(), feedersOf = new Map();
  for (const t of rack.transmitters || []) for (const c of t.channels || []) if (c.combinerId) loadOf.set(c.combinerId, (loadOf.get(c.combinerId) || 0) + 1);
  for (const x of combiners) if (x.into && loadOf.get(x.id)) feedersOf.set(x.into, (feedersOf.get(x.into) || 0) + 1);
  let root = null, rootId = null;
  for (const t of rack.transmitters || []) for (const c of t.channels || []) {
    const l = scene.links.find((q) => q.id === c.linkId && q.kind === 'iem');
    const ant = l ? feedAntenna(rack, l.id, 'tx') : null;
    if (!l || !ant || ant.load) continue; // not paired, or nothing radiates
    const tx = { id: l.id, name: String(l.name || l.id), freqMHz: l.freqMHz, powerDbm: l.tx.powerDbm, pos: structuredClone(ant.pos), antenna: structuredClone(ant.antenna) };
    if (l.tx.fmPreset !== undefined) tx.fmPreset = l.tx.fmPreset;
    if (l.tx.lowIntermod !== undefined) tx.lowIntermod = l.tx.lowIntermod;
    transmitters.push(tx);
    const cb = c.combinerId ? combiners.find((x) => x.id === c.combinerId) : null;
    if (cb) {
      let g = groups.get(cb.id);
      if (!g) {
        const q = combinerParams(cb, Math.max(loadOf.get(cb.id) || 2, cb.ports || 2));
        const r = cb.into ? combiners.find((x) => x.id === cb.into) : null;
        const underRoot = !!r && (rootId === null || rootId === r.id);
        if (underRoot && !root) { const rq = combinerParams(r, Math.max(feedersOf.get(r.id) || 2, r.ports || 2)); root = { lossDb: rq.lossDb, isolationDb: rq.isolationDb }; rootId = r.id; }
        g = { id: cb.id, name: cb.name || cb.id, members: [], lossDb: q.lossDb, isolationDb: q.isolationDb, isolatorDb: q.isolatorDb, underRoot, memberIsolatorDb: {} };
        groups.set(cb.id, g);
      }
      g.members.push(l.id);
      if (c.isolator) g.memberIsolatorDb[l.id] = isolatorDb(c);
    } else if (c.isolator) {
      groups.set(`iso_${l.id}`, { id: `iso_${l.id}`, name: 'Isolator', members: [l.id], lossDb: ISOLATOR_LOSS_DB, isolationDb: 0, isolatorDb: isolatorDb(c), underRoot: false, memberIsolatorDb: {} });
    }
  }
  return { transmitters, topology: { groups: [...groups.values()], ...(root ? { root } : {}) } };
}
