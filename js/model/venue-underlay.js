// Venue underlay: an optional grey plan drawing of a venue, imported from an SU4SV text file (SketchUp to Soundvision
// converter, metres). Pure functions, no DOM. Only the plan (x, y) is kept; z only chooses one of four grey steps.
//
// In-memory underlay:  { layers: [{ name, hidden, shades: [{ step: 0..3, edges: [x1,y1,x2,y2, ...] }] }] }
//   edges are whole centimetres in venue coordinates (venue origin = front-centre edge of the stage, +y toward the audience).
// Saved underlay:      the same, with each shade { step, packed: "dx,dy jx,jy,dx,dy ..." } (packUnderlay / unpackUnderlay).
//
// Mapping to internal scene metres (fixed anchor, no offset or rotation): x = anchor.x + vx, y = anchor.y + vy with
// anchor = { x: stage.width / 2, y: stage.depth }.

export const VENUE_LIMITS = Object.freeze({
  maxFileBytes: 8 * 1024 * 1024,
  maxLayers: 300,
  maxLines: 60000,
  maxNameChars: 80,
  maxShadesPerLayer: 4,
  maxCoordCm: 10000000, // saved-file bound: 100 km
  maxVertexM: 100000, // a vertex 100 km or more from the origin is a bad line
  maxLineChars: 2000, // a longer text line cannot be a vertex or a label (stops regex work and memory on hostile input)
  hardFactor: 4, // parsing stops, with the 'too big' message, at this multiple of maxLines / maxLayers (bounds memory)
});

export const VENUE_GREYS = Object.freeze({
  light: Object.freeze(['#8c8c8c', '#a6a6a6', '#c0c0c0', '#d8d8d8']), // step 0 (lowest) darkest
  dark: Object.freeze(['#d8d8d8', '#c0c0c0', '#a6a6a6', '#8c8c8c']), // reversed: lowest lightest, highest dimmest
});

const NUM = '-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?';
const VERTEX_RE = new RegExp(`^(${NUM})\\s*,\\s*(${NUM})\\s*,\\s*(${NUM})$`);
const UNIT_RE = /^"; LengthUnit"\s*,\s*"([^"]*)"/;
const LABEL_RE = /^"Label"\s*,\s*"(.*)"$/;

const fmt = (n) => n.toLocaleString('en-GB');
const MSG_NO_UNIT = 'This file does not say what its length unit is, so it does not look like an SU4SV export. Export it again from SketchUp with SU4SV, in metres.';
const MSG_NO_LINES = 'No lines could be read from this file. It should be a text file written by SU4SV, in metres.';
export const VENUE_TOO_BIG_MESSAGE = 'This file is larger than 8 MB, which is too much for a venue. Simplify the model in SketchUp and export it again.';
export const VENUE_TOO_MANY_MESSAGE = 'This venue has far more lines or layers than can be kept. Simplify the model in SketchUp, for example by hiding or deleting detail the drawing does not need, and export it again.';
export const VENUE_UNREADABLE_MESSAGE = 'This file could not be read.';
export const VENUE_SAVED_UNREADABLE_MESSAGE = 'The venue lines could not be read';

function layerName(label) {
  let n = label.replace(/[\s_]+\d+$/, '').trim();
  if (!n) n = label.trim();
  n = n.slice(0, VENUE_LIMITS.maxNameChars).trim();
  return n || 'Unnamed';
}

/**
 * parseVenueText(text) -> { ok: true, underlay, edges, badLines, blocks } | { ok: false, message }. Never throws.
 * edges = lines kept after de-duplication; blocks = label blocks that held at least two points.
 */
export function parseVenueText(text) {
  try {
    if (typeof text !== 'string') return { ok: false, message: VENUE_UNREADABLE_MESSAGE };
    if (text.length > VENUE_LIMITS.maxFileBytes) return { ok: false, message: VENUE_TOO_BIG_MESSAGE };
    const rows = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
    let unit = null;
    let badLines = 0;
    let blocks = 0;
    let keptLines = 0;
    const TOO_BIG = { tooBig: true };
    let cur = null; // current block points [{x, y, z}]; null = no current layer
    let curLabel = null;
    const layers = new Map(); // name -> { name, lines: Map(key -> {x1,y1,x2,y2,z}), order: [] }

    const addLine = (name, a, b) => {
      const x1 = Math.round(a.x * 100), y1 = Math.round(a.y * 100), x2 = Math.round(b.x * 100), y2 = Math.round(b.y * 100);
      if (x1 === x2 && y1 === y2) return;
      const z = (a.z + b.z) / 2;
      const swap = x1 > x2 || (x1 === x2 && y1 > y2);
      const key = swap ? `${x2},${y2},${x1},${y1}` : `${x1},${y1},${x2},${y2}`;
      let L = layers.get(name);
      if (!L) {
        if (layers.size >= VENUE_LIMITS.maxLayers * VENUE_LIMITS.hardFactor) throw TOO_BIG;
        L = { name, lines: new Map() }; layers.set(name, L);
      }
      const have = L.lines.get(key);
      if (have) { if (z < have.z) have.z = z; } else {
        if (++keptLines > VENUE_LIMITS.maxLines * VENUE_LIMITS.hardFactor) throw TOO_BIG;
        L.lines.set(key, { x1, y1, x2, y2, z });
      }
    };
    const endBlock = () => {
      if (cur && cur.length >= 2) {
        blocks++;
        const name = layerName(curLabel);
        if (cur.length === 2) addLine(name, cur[0], cur[1]);
        else for (let i = 0; i < cur.length; i++) addLine(name, cur[i], cur[(i + 1) % cur.length]);
      }
      cur = null; curLabel = null;
    };

    for (const raw of rows) {
      if (raw.length > VENUE_LIMITS.maxLineChars) { // cannot be a vertex or a label: skip without running any pattern on it
        if (raw.trim()) badLines++;
        continue;
      }
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('";')) {
        const m = UNIT_RE.exec(line);
        if (m && unit === null) unit = m[1];
        continue;
      }
      if (line.startsWith('"Label"')) {
        endBlock();
        const m = LABEL_RE.exec(line);
        if (!m) { badLines++; continue; }
        cur = []; curLabel = m[1];
        continue;
      }
      const v = VERTEX_RE.exec(line);
      if (!v) { badLines++; continue; }
      if (cur === null) { badLines++; continue; }
      const x = Number(v[1]), y = Number(v[2]), z = Number(v[3]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || Math.abs(x) >= VENUE_LIMITS.maxVertexM || Math.abs(y) >= VENUE_LIMITS.maxVertexM) { badLines++; continue; }
      cur.push({ x, y, z });
      if (cur.length > VENUE_LIMITS.maxLines * VENUE_LIMITS.hardFactor) throw TOO_BIG;
    }
    endBlock();

    if (unit === null) return { ok: false, message: MSG_NO_UNIT };
    if (unit.trim().toLowerCase() !== 'm') return { ok: false, message: `This venue file is in ${unit}. Export it again from SketchUp with SU4SV, in metres.` };

    const used = [...layers.values()].filter((L) => L.lines.size > 0);
    let total = 0;
    for (const L of used) total += L.lines.size;
    if (total === 0) return { ok: false, message: MSG_NO_LINES };
    if (used.length > VENUE_LIMITS.maxLayers) return { ok: false, message: `This venue has ${fmt(used.length)} layers, and the most that can be kept is ${fmt(VENUE_LIMITS.maxLayers)}. Simplify the model in SketchUp and export it again.` };
    if (total > VENUE_LIMITS.maxLines) return { ok: false, message: `This venue has ${fmt(total)} lines once duplicates are removed, and the most that can be kept is ${fmt(VENUE_LIMITS.maxLines)}. Simplify the model in SketchUp, for example by hiding or deleting detail the drawing does not need, and export it again.` };

    const heights = [];
    for (const L of used) for (const l of L.lines.values()) heights.push(l.z);
    const { lo, hi } = shadeBounds(heights);
    const underlay = {
      layers: used.map((L) => {
        const by = [[], [], [], []];
        for (const l of L.lines.values()) by[shadeStep(l.z, lo, hi)].push(l.x1, l.y1, l.x2, l.y2);
        // lines were stored normalised for the key only; the stored endpoints are in drawn direction (first seen)
        return { name: L.name, hidden: false, shades: by.map((edges, step) => ({ step, edges })).filter((s) => s.edges.length) };
      }),
    };
    return { ok: true, underlay, edges: total, badLines, blocks };
  } catch (e) {
    if (e && e.tooBig === true) return { ok: false, message: VENUE_TOO_MANY_MESSAGE };
    return { ok: false, message: VENUE_UNREADABLE_MESSAGE };
  }
}

/** lo = 2nd percentile, hi = 98th, of the sorted heights: s[min(n-1, max(0, floor(p*(n-1))))]. */
export function shadeBounds(heights) {
  const s = [...heights].sort((a, b) => a - b);
  const n = s.length;
  const at = (p) => s[Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))))];
  return n ? { lo: at(0.02), hi: at(0.98) } : { lo: 0, hi: 0 };
}

/** Grey step 0 (lowest, darkest) .. 3. All-equal heights give 0. */
export function shadeStep(z, lo, hi) {
  if (hi - lo < 1e-9) return 0;
  return Math.min(3, Math.max(0, Math.floor(((z - lo) / (hi - lo)) * 4)));
}

/** venueImportMessage(result) -> "Imported 12,345 lines in 7 layers. 3 lines of the file could not be read and were left out." */
export function venueImportMessage(r) {
  if (!r || !r.ok) return (r && r.message) || VENUE_UNREADABLE_MESSAGE;
  const nl = r.underlay.layers.length;
  let m = `Imported ${fmt(r.edges)} ${r.edges === 1 ? 'line' : 'lines'} in ${fmt(nl)} ${nl === 1 ? 'layer' : 'layers'}.`;
  if (r.badLines > 0) m += ` ${fmt(r.badLines)} ${r.badLines === 1 ? 'line' : 'lines'} of the file could not be read and ${r.badLines === 1 ? 'was' : 'were'} left out.`;
  return m;
}

// ---------------------------------------------------------------- validation (in-memory form)

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** validateVenue(underlay) -> string[] of problems (empty = fine). */
export function validateVenue(u) {
  const errors = [];
  if (!isObj(u) || !Array.isArray(u.layers)) return ['venue must be { layers: [...] }'];
  if (u.layers.length > VENUE_LIMITS.maxLayers) errors.push(`venue has more than ${VENUE_LIMITS.maxLayers} layers`);
  let lines = 0;
  const names = new Set();
  for (const L of u.layers) {
    if (!isObj(L)) { errors.push('venue layer must be an object'); continue; }
    if (typeof L.name === 'string') { if (names.has(L.name)) errors.push('venue layer names must be unique'); names.add(L.name); }
    if (typeof L.name !== 'string' || L.name.length < 1 || L.name.length > VENUE_LIMITS.maxNameChars) errors.push('venue layer name must be 1 to 80 characters');
    if (typeof L.hidden !== 'boolean') errors.push('venue layer hidden must be a boolean');
    if (!Array.isArray(L.shades) || L.shades.length > VENUE_LIMITS.maxShadesPerLayer) { errors.push('venue layer shades must be an array of at most 4'); continue; }
    for (const s of L.shades) {
      if (!isObj(s) || !Number.isInteger(s.step) || s.step < 0 || s.step > 3) { errors.push('venue shade step must be an integer 0 to 3'); continue; }
      if (!Array.isArray(s.edges) || s.edges.length % 4 !== 0) { errors.push('venue shade edges must be a list of x1,y1,x2,y2 groups'); continue; }
      lines += s.edges.length / 4;
      if (lines > VENUE_LIMITS.maxLines) { errors.push(`venue has more than ${VENUE_LIMITS.maxLines} lines`); return errors; }
      for (const n of s.edges) if (!Number.isInteger(n) || Math.abs(n) > VENUE_LIMITS.maxCoordCm) { errors.push('venue coordinates must be whole centimetres within 100 km'); return errors; }
    }
  }
  return errors;
}

// ---------------------------------------------------------------- pack / unpack

/**
 * packUnderlay(underlay) -> { layers: [{ name, hidden, shades: [{ step, packed }] }] }.
 * Per shade, one token per line separated by single spaces, numbers in base 36 (signed):
 *   "dx,dy"            the line starts where the previous one ended (first line: the origin) and runs by (dx, dy);
 *   "jx,jy,dx,dy"      otherwise: jump (jx, jy) from where the previous line ended, then the line.
 */
export function packUnderlay(u) {
  return {
    layers: u.layers.map((L) => ({
      name: L.name,
      hidden: L.hidden === true,
      shades: L.shades.map((s) => {
        let px = 0, py = 0;
        const toks = [];
        for (let i = 0; i + 3 < s.edges.length; i += 4) {
          const [x1, y1, x2, y2] = [s.edges[i], s.edges[i + 1], s.edges[i + 2], s.edges[i + 3]];
          const d = `${(x2 - x1).toString(36)},${(y2 - y1).toString(36)}`;
          toks.push(x1 === px && y1 === py ? d : `${(x1 - px).toString(36)},${(y1 - py).toString(36)},${d}`);
          px = x2; py = y2;
        }
        return { step: s.step, packed: toks.join(' ') };
      }),
    })),
  };
}

const TOKEN_PART = /^-?[0-9a-z]{1,8}$/;

/** unpackUnderlay(packed) -> underlay, or null when anything is malformed or out of range. Never throws. */
export function unpackUnderlay(p) {
  try {
    if (!isObj(p) || !Array.isArray(p.layers) || p.layers.length > VENUE_LIMITS.maxLayers) return null;
    let lines = 0;
    const layers = [];
    for (const L of p.layers) {
      if (!isObj(L) || typeof L.name !== 'string' || L.name.length < 1 || L.name.length > VENUE_LIMITS.maxNameChars || typeof L.hidden !== 'boolean') return null;
      if (!Array.isArray(L.shades) || L.shades.length > VENUE_LIMITS.maxShadesPerLayer) return null;
      const shades = [];
      for (const s of L.shades) {
        if (!isObj(s) || !Number.isInteger(s.step) || s.step < 0 || s.step > 3 || typeof s.packed !== 'string') return null;
        const edges = [];
        let px = 0, py = 0;
        const toks = s.packed === '' ? [] : s.packed.split(' ');
        for (const t of toks) {
          const parts = t.split(',');
          if (parts.length !== 2 && parts.length !== 4) return null;
          for (const q of parts) if (!TOKEN_PART.test(q)) return null;
          const v = parts.map((q) => parseInt(q, 36));
          let x1, y1, dx, dy;
          if (v.length === 2) { x1 = px; y1 = py; dx = v[0]; dy = v[1]; } else { x1 = px + v[0]; y1 = py + v[1]; dx = v[2]; dy = v[3]; }
          const x2 = x1 + dx, y2 = y1 + dy;
          for (const n of [x1, y1, x2, y2]) if (!Number.isFinite(n) || Math.abs(n) > VENUE_LIMITS.maxCoordCm) return null;
          if (++lines > VENUE_LIMITS.maxLines) return null;
          edges.push(x1, y1, x2, y2);
          px = x2; py = y2;
        }
        shades.push({ step: s.step, edges });
      }
      layers.push({ name: L.name, hidden: L.hidden, shades });
    }
    return { layers };
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------- drawing support

// Liang-Barsky clip of a segment to the frame; returns [x1,y1,x2,y2] or null when wholly outside.
function clipLine(x1, y1, x2, y2, f) {
  const dx = x2 - x1, dy = y2 - y1;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - f.minX, f.maxX - x1, y1 - f.minY, f.maxY - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
}
const r2 = (v) => Math.round(v * 100) / 100;

/**
 * venueSegmentsByStep(underlay, frame, anchor) -> [seg[], seg[], seg[], seg[]] indexed by grey step 0..3.
 * frame = { minX, minY, maxX, maxY } and anchor = { x, y } in internal scene metres. Each seg is [x1, y1, x2, y2] in internal
 * metres, clipped to the frame and rounded to 0.01. Hidden layers and lines wholly outside the frame are left out.
 */
export function venueSegmentsByStep(u, frame, anchor) {
  const out = [[], [], [], []];
  if (!u || !Array.isArray(u.layers) || !frame || !anchor) return out;
  for (const L of u.layers) {
    if (L.hidden) continue;
    for (const s of L.shades) {
      const dst = out[s.step];
      if (!dst) continue;
      const e = s.edges;
      for (let i = 0; i + 3 < e.length; i += 4) {
        const c = clipLine(anchor.x + e[i] / 100, anchor.y + e[i + 1] / 100, anchor.x + e[i + 2] / 100, anchor.y + e[i + 3] / 100, frame);
        if (!c) continue;
        const seg = [r2(c[0]), r2(c[1]), r2(c[2]), r2(c[3])];
        if (seg[0] === seg[2] && seg[1] === seg[3]) continue;
        dst.push(seg);
      }
    }
  }
  return out;
}

/** venueSummary(underlay) -> { layers, visibleLayers, lines, label }; label is "Venue" or "Venue: 3 of 5 layers on". */
export function venueSummary(u) {
  if (!u || !Array.isArray(u.layers) || !u.layers.length) return { layers: 0, visibleLayers: 0, lines: 0, label: 'Venue' };
  const layers = u.layers.length;
  const visibleLayers = u.layers.filter((L) => !L.hidden).length;
  let lines = 0;
  for (const L of u.layers) for (const s of L.shades) lines += s.edges.length / 4;
  return { layers, visibleLayers, lines, label: `Venue: ${visibleLayers} of ${layers} ${layers === 1 ? 'layer' : 'layers'} on` };
}

/** Lines in one layer (for the "(N lines)" label). */
export function venueLayerLines(L) {
  return L && Array.isArray(L.shades) ? L.shades.reduce((n, s) => n + s.edges.length / 4, 0) : 0;
}
