// Scenario compare (pure). diffScenes(a, b) says exactly what changed between two scenes and what each change did to every link;
// headline(diff) turns that into plain sentences.
//
// Method: both scenes are migrated first (older versions read), then compared field by field. Objects are compared key by key, arrays of
// objects that all carry a string id are matched by id (added, removed, changed), other arrays are compared as one value. x, y, z of a position
// are reported as one change ("Receiver position").
//
// Attribution ("mainly because"): for a link whose margin moved, each changed field that can influence it is reverted to its A value in a copy of B
// and the link is solved again; contributionDb = margin(B) - margin(B with that one field reverted). This is one-at-a-time attribution: when two
// changes interact (for example a longer cable and a booster) the contributions do not add up to the total, `exact` is false (residual over
// max(0.3 dB, 10 percent of the move)) and the headline says so. At most MAX_RESOLVES (40) re-solves are used PER LINK; changes beyond that are
// listed unattributed and `truncated` is true. Scene-level changes that are not the link's own (environment, reflectors, zones ...) are first reverted
// all together in ONE re-solve: if that does not move the link's margin none of them is tested again; only when it does are they split and tried one by one.
// Top-level keys that cannot change an RF result (name, audioSource, measurements, people, units, coverage, venue ...) are never reverted. The venue underlay
// (large) is left out of the compared copy altogether. diffScenes(a, a) (the same object) returns at once with no changes.

import { migrateScene } from './scene.js';
import { solveLink } from './rf.js';
import { coordinationCheck } from './imd.js';

export const MAX_RESOLVES = 40;
export const MARGIN_EPS_DB = 0.05;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (x) => (Number.isFinite(x) ? x : null);
const same = (a, b) => Object.is(a, b) || (typeof a === 'number' && typeof b === 'number' && a === b) || (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));
const clone = (x) => (x === undefined ? undefined : structuredClone(x));
const idArray = (a) => Array.isArray(a) && a.length > 0 && a.every((e) => isObj(e) && typeof e.id === 'string');
const SKIP_TOP = new Set(['version', 'venue']); // venue: a large underlay that never reaches the solver, so it is neither copied nor compared

function prepare(raw) {
  if (!isObj(raw)) return { scene: { links: [] }, note: 'not a scene object' };
  const { venue, ...rest } = raw; // the venue underlay is not cloned or compared
  try { return { scene: migrateScene(rest), note: null }; } catch (e) { return { scene: structuredClone(rest), note: `could not be migrated: ${e.message}` }; }
}

// ---------------------------------------------------------------- walking changes
function walk(a, b, segs, out) {
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { if (segs.length === 0 && SKIP_TOP.has(k)) continue; walk(a[k], b[k], [...segs, k], out); }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b) && (idArray(a) || a.length === 0) && (idArray(b) || b.length === 0) && (a.length || b.length)) {
    const ma = new Map(a.map((e) => [e.id, e])), mb = new Map(b.map((e) => [e.id, e]));
    for (const [id, ea] of ma) { if (mb.has(id)) walk(ea, mb.get(id), [...segs, { id }], out); else out.push({ segs: [...segs, { id }], from: ea, to: undefined, kind: 'removed' }); }
    for (const [id, eb] of mb) if (!ma.has(id)) out.push({ segs: [...segs, { id }], from: undefined, to: eb, kind: 'added' });
    return;
  }
  if (same(a, b)) return;
  out.push({ segs, from: a, to: b, kind: a === undefined ? 'added' : b === undefined ? 'removed' : 'changed' });
}

/** Merge x, y, z leaf changes of one position into a single change. */
function groupPositions(changes) {
  const out = [], groups = new Map();
  for (const c of changes) {
    const last = c.segs[c.segs.length - 1], parent = c.segs.slice(0, -1), pk = parent.map(segKey).join('.');
    if (c.kind === 'changed' && (last === 'x' || last === 'y' || last === 'z') && /(^|\.)(pos|p1|p2|rxAntennaPos)$/.test(pk)) {
      let g = groups.get(pk);
      if (!g) { g = { segs: parent, ops: [], from: {}, to: {}, kind: 'changed', grouped: true }; groups.set(pk, g); out.push(g); }
      g.ops.push({ segs: c.segs, from: c.from }); g.from[last] = c.from; g.to[last] = c.to;
    } else out.push(c);
  }
  for (const c of out) if (!c.ops) c.ops = [{ segs: c.segs, from: c.from }];
  return out;
}
const segKey = (s) => (typeof s === 'string' ? s : `[${s.id}]`);
const pathOf = (segs) => segs.map(segKey).join('.').replace(/\.\[/g, '[');

// ---------------------------------------------------------------- labels
const KEY_LABELS = {
  powerDbm: 'transmit power (dBm)', freqMHz: 'frequency (MHz)', gainDbi: 'antenna gain (dBi)', polarisation: 'polarisation', lossDb: 'loss (dB)', lengthM: 'length (m)', cableType: 'cable type',
  gainDb: 'gain (dB)', nfDb: 'noise figure (dB)', bodyLossDb: 'body loss (dB)', sensitivityDbm: 'sensitivity (dBm)', floor: 'floor material', model: 'propagation model', fadeMarginDb: 'fade margin (dB)',
  externalNoise: 'external noise', interference: 'interference level', xpdDb: 'cross-polar floor (dB)', wallLossAdjustDb: 'extra wall loss (dB)', material: 'material', name: 'name', enabled: 'on or off',
  thresholdDbm: 'squelch threshold (dBm)', hysteresisDb: 'hysteresis (dB)', mode: 'mode', width: 'width (m)', depth: 'depth (m)', heightM: 'height (m)', zMin: 'bottom height (m)', zMax: 'top height (m)',
  tvChannelWidthMHz: 'TV channel width (MHz)', rxDbm: 'measured level (dBm)', op1dBDbm: 'output P1dB (dBm)', iip3Dbm: 'input IP3 (dBm)', type: 'type', kind: 'kind', preset: 'preset', rxPreset: 'receiver preset',
  az: 'azimuth (deg)', el: 'elevation (deg)', note: 'note',
};
const SECTION = { links: 'Link', environment: 'Environment', reflectors: 'Reflector', zones: 'Zone', people: 'Person', noiseSources: 'Noise source', measurements: 'Measurement', platforms: 'Platform', stage: 'Stage', imd: 'IMD', coverage: 'Coverage' };
const human = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
const resolve = (scene, segs) => { let cur = scene; for (const s of segs) { if (cur == null) return undefined; cur = typeof s === 'string' ? cur[s] : (Array.isArray(cur) ? cur.find((e) => e && e.id === s.id) : undefined); } return cur; };

function labelOf(c, A, B) {
  const segs = c.segs, top = segs[0];
  const nameOf = (item, fb) => (item && typeof item.name === 'string' && item.name ? item.name : fb);
  const elem = (arrKey, id) => resolve(B, [arrKey, { id }]) || resolve(A, [arrKey, { id }]);
  let who = SECTION[top] || human(top);
  let rest = segs.slice(1);
  if (top === 'links' && rest[0] && typeof rest[0] === 'object') { who = nameOf(elem('links', rest[0].id), rest[0].id); rest = rest.slice(1); }
  else if (rest[0] && typeof rest[0] === 'object') { who = `${who} "${nameOf(elem(top, rest[0].id), rest[0].id)}"`; rest = rest.slice(1); }
  if (c.kind === 'added' || c.kind === 'removed') {
    if (rest.length === 0) return `${who} ${c.kind}`;
  }
  const parts = [];
  for (let i = 0; i < rest.length; i++) {
    const s = rest[i];
    if (typeof s === 'object') {
      const base = segs.slice(0, segs.length - rest.length + i);
      const item = resolve(B, [...base, s]) || resolve(A, [...base, s]);
      parts.push(`${item && item.kind ? item.kind : 'item'}${item && item.name ? ` "${item.name}"` : ''}`);
    } else if (s === 'tx' || s === 'rx') parts.push(s === 'tx' ? 'transmitter' : 'receiver');
    else if (s === 'pos') parts.push('position');
    else if (s === 'p1' || s === 'p2') parts.push(s === 'p1' ? 'start point' : 'end point');
    else if (s === 'antenna') parts.push('antenna');
    else if (s === 'chain') parts.push('cable chain');
    else if (s === 'antennaB') parts.push('diversity antenna B');
    else if (s === 'diversity') parts.push('diversity');
    else if (s === 'orientation') parts.push('orientation');
    else if (c.grouped && (s === 'x' || s === 'y' || s === 'z')) { /* grouped */ }
    else parts.push(KEY_LABELS[s] || human(s));
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  return top === 'links' ? (text ? `${who}: ${text}` : who) : (text ? `${who} ${text}` : who);
}

const fmtNum = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000));
export function formatValue(v) {
  if (v === undefined) return 'not set';
  if (v === null) return 'none';
  if (typeof v === 'number') return Number.isFinite(v) ? fmtNum(v) : 'not a number';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'string') return v;
  if (isObj(v) && Object.keys(v).every((k) => ['x', 'y', 'z'].includes(k))) return `(${Object.keys(v).sort().map((k) => `${k} ${fmtNum(v[k])}`).join(', ')})`;
  if (isObj(v) && typeof v.name === 'string') return `"${v.name}"`;
  return '(changed)';
}
const publicChange = (c, A, B) => ({ path: pathOf(c.segs), label: labelOf(c, A, B), from: c.from, to: c.to, fromText: formatValue(c.from), toText: formatValue(c.to), kind: c.kind });

// ---------------------------------------------------------------- applying a revert
function revertOn(scene, change) {
  for (const op of change.ops) {
    let cur = scene;
    for (let i = 0; i < op.segs.length - 1; i++) {
      const s = op.segs[i];
      cur = typeof s === 'string' ? cur && cur[s] : (Array.isArray(cur) ? cur.find((e) => e && e.id === s.id) : undefined);
      if (cur == null) return false;
    }
    const last = op.segs[op.segs.length - 1], v = clone(op.from);
    if (typeof last === 'string') { if (v === undefined) delete cur[last]; else cur[last] = v; }
    else if (Array.isArray(cur)) {
      const i = cur.findIndex((e) => e && e.id === last.id);
      if (v === undefined) { if (i >= 0) cur.splice(i, 1); } else if (i >= 0) cur[i] = v; else cur.push(v);
    } else return false;
  }
  return true;
}

// ---------------------------------------------------------------- results
const imdCount = (scene) => {
  try {
    if (!scene.imd || !scene.imd.enabled || !Array.isArray(scene.imd.transmitters) || scene.imd.transmitters.length < 2) return 0;
    return coordinationCheck(scene, scene.imd.rxAntennaPos).filter((h) => h.severity === 'critical' || h.severity === 'warning').length;
  } catch { return 0; }
};
const solve = (scene, link) => { try { return solveLink(scene, link); } catch { return null; } };
const marginOf = (r) => (r ? finite(r.marginDb) : null);
const polOf = (a) => (a && typeof a.polarisation === 'string' ? a.polarisation : 'vertical');
const brief = (r, link) => (r ? { marginDb: finite(r.marginDb), rxLevelDbm: finite(r.rxPowerDbm), inputPowerDbm: finite(r.inputPowerDbm), noiseFloorDbm: finite(r.cascade && r.cascade.noiseFloorDbm), status: r.status || null,
  pol: r.polarisation ? { tx: r.polarisation.txPolarisation || null, rx: link && link.rx ? polOf(link.rx.antenna) : null, lossDb: finite(r.polarisation.lossDb) } : null, // the polarisation mismatch result of this side marginDb: finite(r.marginDb), rxLevelDbm: finite(r.rxPowerDbm), inputPowerDbm: finite(r.inputPowerDbm), noiseFloorDbm: finite(r.cascade && r.cascade.noiseFloorDbm), status: r.status || null,
  compressionDb: finite(r.compression && r.compression.worst ? r.compression.worst.compressionDb : 0), warnings: Array.isArray(r.warnings) ? r.warnings.map(String) : [] } : null);
const sub = (a, b) => (a !== null && b !== null && a !== undefined && b !== undefined ? finite(b - a) : null);

function deltasOf(ra, rb, imd) {
  const A = brief(ra), B = brief(rb);
  if (!A || !B) return { marginDb: null, rxLevelDbm: null, inputPowerDbm: null, noiseFloorDbm: null, compressionDb: null, statusFrom: A && A.status, statusTo: B && B.status, imd: { ...imd }, warningsAdded: [], warningsRemoved: [] };
  return {
    marginDb: sub(A.marginDb, B.marginDb), rxLevelDbm: sub(A.rxLevelDbm, B.rxLevelDbm), inputPowerDbm: sub(A.inputPowerDbm, B.inputPowerDbm), noiseFloorDbm: sub(A.noiseFloorDbm, B.noiseFloorDbm),
    compressionDb: sub(A.compressionDb, B.compressionDb), statusFrom: A.status, statusTo: B.status, imd: { ...imd },
    warningsAdded: B.warnings.filter((w) => !A.warnings.includes(w)), warningsRemoved: A.warnings.filter((w) => !B.warnings.includes(w)),
  };
}

const NON_RF_TOP = new Set(['measurements', 'people', 'units', 'coverage', 'venue', 'name', 'audioSource']);

/**
 * diffScenes(a, b) -> { summary: { linksA, linksB, added[], removed[], changed[], notes[], changeCount },
 *   links: [{ id, name, fields: [{path, label, from, to, fromText, toText, kind}], resultA, resultB, deltas, attribution }],
 *   items: { environment[], reflectors{added,removed,changed}, people{...}, noiseSources{...}, zones{...}, measurements{...}, platforms{...}, other[] },
 *   resolves }
 * deltas = B minus A: { marginDb, rxLevelDbm, inputPowerDbm, noiseFloorDbm, compressionDb, statusFrom, statusTo, imd: {from, to}, warningsAdded[], warningsRemoved[] } (null when not finite).
 * attribution = { contributions: [{path, label, from, to, contributionDb}], explainedDb, residualDb, exact, truncated } for links whose margin moved, else null.
 */
export function diffScenes(a, b) {
  const pa = prepare(a), pb = prepare(b), A = pa.scene, B = pb.scene;
  const notes = [pa.note && `Scene A ${pa.note}`, pb.note && `Scene B ${pb.note}`].filter(Boolean);
  const linksA = Array.isArray(A.links) ? A.links.filter(isObj) : [], linksB = Array.isArray(B.links) ? B.links.filter(isObj) : [];
  const idsA = new Set(linksA.map((l) => l.id)), idsB = new Set(linksB.map((l) => l.id));
  const nameOf = (l) => (typeof l.name === 'string' && l.name ? l.name : String(l.id));
  const added = linksB.filter((l) => !idsA.has(l.id)).map((l) => ({ id: l.id, name: nameOf(l) })), removed = linksA.filter((l) => !idsB.has(l.id)).map((l) => ({ id: l.id, name: nameOf(l) }));

  const identical = a === b; // the same object: nothing to walk or revert
  const raw = []; if (!identical) walk(A, B, [], raw);
  const imd = { from: imdCount(A), to: identical ? imdCount(A) : imdCount(B) }; // scene-level, so counted once here and not per link
  const changes = groupPositions(raw);
  const pub = new Map(changes.map((c) => [c, publicChange(c, A, B)]));
  const ownerId = (c) => (c.segs[0] === 'links' && typeof c.segs[1] === 'object' ? c.segs[1].id : null);

  const items = { environment: [], reflectors: emptyItems(), people: emptyItems(), noiseSources: emptyItems(), zones: emptyItems(), measurements: emptyItems(), platforms: emptyItems(), other: [] };
  for (const c of changes) {
    const top = c.segs[0];
    if (top === 'links') continue;
    if (top === 'environment') items.environment.push(pub.get(c));
    else if (items[top] && items[top].added) {
      const p = pub.get(c);
      if (c.segs.length === 2 && c.kind === 'added') items[top].added.push({ id: c.segs[1].id, name: c.to && c.to.name ? c.to.name : c.segs[1].id });
      else if (c.segs.length === 2 && c.kind === 'removed') items[top].removed.push({ id: c.segs[1].id, name: c.from && c.from.name ? c.from.name : c.segs[1].id });
      else { const id = typeof c.segs[1] === 'object' ? c.segs[1].id : null; let e = items[top].changed.find((x) => x.id === id); if (!e) { e = { id, name: nameFrom(A, B, top, id), fields: [] }; items[top].changed.push(e); } e.fields.push(p); }
    } else items.other.push(pub.get(c));
  }

  // per matched link
  const links = [];
  let resolves = 0;
  const attributable = changes.filter((c) => !NON_RF_TOP.has(c.segs[0]));
  const solvedPairs = [];
  for (const lb of linksB) {
    if (!idsA.has(lb.id)) continue;
    const la = linksA.find((l) => l.id === lb.id);
    const ra = solve(A, la), rb = identical ? ra : solve(B, lb);
    const deltas = deltasOf(ra, rb, imd);
    const fields = changes.filter((c) => ownerId(c) === lb.id).map((c) => pub.get(c));
    links.push({ id: lb.id, name: nameOf(lb), fields, resultA: brief(ra, la), resultB: brief(rb, lb), deltas, attribution: null });
    solvedPairs.push({ entry: links[links.length - 1], lb });
  }
  const { venue: _v, ...Bsolve } = B; // already venue-free (prepare), kept explicit: the copy for each revert never carries it
  for (const { entry, lb } of solvedPairs) {
    const d = entry.deltas.marginDb;
    if (d === null || Math.abs(d) < MARGIN_EPS_DB) continue;
    const own = attributable.filter((c) => ownerId(c) === lb.id);
    const shared = attributable.filter((c) => ownerId(c) === null && c.segs[0] !== 'links');
    const mB = entry.resultB.marginDb, contributions = [];
    let truncated = false, used = 0; // re-solve budget of THIS link
    const marginWithout = (list) => {
      if (used >= MAX_RESOLVES) { truncated = true; return undefined; }
      used++; resolves++;
      const copy = structuredClone(Bsolve);
      for (const c of list) if (!revertOn(copy, c)) return null;
      const l2 = (copy.links || []).find((l) => l && l.id === lb.id);
      return l2 ? marginOf(solve(copy, l2)) : null;
    };
    const add = (c, m2) => { const p = pub.get(c); contributions.push({ path: p.path, label: p.label, from: p.from, to: p.to, fromText: p.fromText, toText: p.toText, contributionDb: mB - m2 }); };
    for (const c of own) {
      const m2 = marginWithout([c]);
      if (m2 === undefined) break;
      if (m2 !== null) add(c, m2);
    }
    if (shared.length === 1) {
      const m2 = marginWithout(shared);
      if (m2 !== undefined && m2 !== null) add(shared[0], m2);
    } else if (shared.length > 1) {
      const all = marginWithout(shared); // one test for the whole group first
      if (all !== undefined && all !== null && Math.abs(mB - all) >= MARGIN_EPS_DB) {
        for (const c of shared) {
          const m2 = marginWithout([c]);
          if (m2 === undefined) break;
          if (m2 !== null) add(c, m2);
        }
      }
    }
    contributions.sort((x, y) => Math.abs(y.contributionDb) - Math.abs(x.contributionDb));
    const explained = contributions.reduce((s, x) => s + x.contributionDb, 0), residual = d - explained;
    entry.attribution = { contributions, explainedDb: explained, residualDb: residual, exact: !truncated && Math.abs(residual) <= Math.max(0.3, 0.1 * Math.abs(d)), truncated };
  }

  const changedIds = links.filter((l) => l.fields.length || (l.deltas.marginDb !== null && l.deltas.marginDb !== 0)).map((l) => l.id);
  return {
    summary: { linksA: linksA.length, linksB: linksB.length, added, removed, changed: changedIds, notes, changeCount: changes.length, imd }, links, items, resolves,
  };
}
const emptyItems = () => ({ added: [], removed: [], changed: [] });
const nameFrom = (A, B, top, id) => { const e = resolve(B, [top, { id }]) || resolve(A, [top, { id }]); return e && e.name ? e.name : id; };

// ---------------------------------------------------------------- headline
const dbText = (x) => `${(Math.round(Math.abs(x) * 10) / 10).toFixed(1)} dB`;
/** The polarisation situation of one side, in words: 'receiver antenna vertical, transmitter horizontal: cross-polarised (15.0 dB)'. */
function polText(p) {
  if (!p || !p.tx || !p.rx) return null;
  const lin = (x) => x === 'vertical' || x === 'horizontal' || x === 'slant45' || x === 'slant';
  const verdict = p.lossDb !== null && p.lossDb < 3 ? 'matched' : (lin(p.tx) && lin(p.rx) ? 'cross-polarised' : 'mismatched');
  return `receiver antenna ${p.rx}, transmitter ${p.tx}: ${verdict}${p.lossDb !== null ? ` (${p.lossDb.toFixed(1)} dB polarisation loss)` : ''}`;
}
/** headline(diff) -> array of plain sentences, most important first. */
export function headline(diff) {
  if (!diff || !diff.summary) return [];
  const out = [], s = diff.summary;
  for (const l of diff.links) {
    const d = l.deltas.marginDb;
    if (d !== null && Math.abs(d) >= MARGIN_EPS_DB) {
      let t = `${l.name} margin ${d < 0 ? 'falls' : 'rises'} ${dbText(d)} (from ${fmtNum(Math.round(l.resultA.marginDb * 10) / 10)} to ${fmtNum(Math.round(l.resultB.marginDb * 10) / 10)} dB)`;
      const at = l.attribution;
      if (at && at.contributions.length) {
        const top = at.contributions[0], others = at.contributions.length - 1;
        t += `, mainly because ${top.label} changed from ${top.fromText} to ${top.toText}`;
        if (/(^|\.)antenna\.polarisation$/.test(top.path) || /antenna polarisation$/.test(top.label)) { // say BOTH ends, so a fix and a fault read differently
          const a = polText(l.resultA && l.resultA.pol), b = polText(l.resultB && l.resultB.pol);
          if (b) t += ` (before: ${a || 'not known'}; after: ${b})`;
        }
        if (others > 0) t += ` (${others} other change${others === 1 ? '' : 's'} also counted)`;
        if (!at.exact) t += at.truncated ? '. Only some of the changes were tested, so this attribution is approximate' : '. The changes interact, so this attribution is approximate';
      } else if (at && at.truncated) t += ', but the attribution was limited (more changes than could be tested)';
      else if (l.fields.length === 0) t += ', because of a change elsewhere in the scene';
      out.push(`${t}.`);
    } else if (l.fields.length) out.push(`${l.name}: ${l.fields.length} field${l.fields.length === 1 ? '' : 's'} changed, margin unchanged.`);
    else if (d === null && (l.resultA === null || l.resultB === null)) out.push(`${l.name} could not be solved in one of the scenes.`);
    if (l.deltas.statusFrom && l.deltas.statusTo && l.deltas.statusFrom !== l.deltas.statusTo) out.push(`${l.name} status goes from ${l.deltas.statusFrom} to ${l.deltas.statusTo}.`);
    if (l.deltas.warningsAdded.length) out.push(`${l.name}: new warning: ${l.deltas.warningsAdded[0]}`);
  }
  if (s.imd && s.imd.from !== s.imd.to) out.push(`Intermodulation conflicts go from ${s.imd.from} to ${s.imd.to}.`); // one scene-level sentence, not one per link
  for (const x of s.added) out.push(`${x.name} was added.`);
  for (const x of s.removed) out.push(`${x.name} was removed.`);
  for (const k of ['reflectors', 'zones', 'noiseSources', 'people', 'platforms', 'measurements']) {
    const it = diff.items[k], bits = [];
    if (it.added.length) bits.push(`${it.added.length} added`); if (it.removed.length) bits.push(`${it.removed.length} removed`); if (it.changed.length) bits.push(`${it.changed.length} changed`);
    if (bits.length) out.push(`${k === 'noiseSources' ? 'Noise sources' : k[0].toUpperCase() + k.slice(1)}: ${bits.join(', ')}.`);
  }
  if (diff.items.environment.length) out.push(`Environment: ${diff.items.environment.slice(0, 3).map((e) => `${e.label.replace(/^Environment /, '')} ${e.fromText} to ${e.toText}`).join('; ')}${diff.items.environment.length > 3 ? '; and more' : ''}.`);
  for (const n of s.notes) out.push(n);
  if (out.length === 0) out.push('No differences.');
  return out;
}
