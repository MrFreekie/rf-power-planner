// Compare dialog helpers (pure, no DOM): in-memory snapshots (max 5, the last one mirrored to sessionStorage), a memoised throttled diff,
// delta words for the per-link table, attribution bars and item lines. The model is js/model/scene-diff.js.
import { diffScenes, headline, MARGIN_EPS_DB } from '../model/scene-diff.js';

export const MAX_SNAPSHOTS = 5, SNAP_KEY = 'rf-bench.compare.last.v1', THROTTLE_MS = 300;
const f1 = (v) => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toFixed(1) : '-');
const sgn = (v) => (!Number.isFinite(v) ? '-' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v * 10) / 10).toFixed(1));
const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

export function createSnapshots({ storage = null, now = () => new Date() } = {}) {
  let list = [], seq = 0;
  try { const raw = storage && storage.getItem(SNAP_KEY); if (raw) { const o = JSON.parse(raw); if (o && o.scene && Array.isArray(o.scene.links)) { list.push({ id: `s${++seq}`, name: String(o.name || 'Last session').slice(0, 60), time: String(o.time || ''), links: o.scene.links.length, scene: o.scene }); } } } catch { /* ignore a broken stored snapshot */ }
  const persist = () => { try { const l = list[list.length - 1]; if (storage) { if (l) storage.setItem(SNAP_KEY, JSON.stringify({ name: l.name, time: l.time, scene: l.scene })); else storage.removeItem && storage.removeItem(SNAP_KEY); } } catch { /* too large or blocked: the snapshot stays in memory */ } };
  return {
    list: () => list.slice(),
    get: (id) => list.find((s) => s.id === id) || null,
    /** take(scene, name?) -> the snapshot, dropping the oldest beyond MAX_SNAPSHOTS. */
    take(scene, name) {
      const d = now(), p = (n) => String(n).padStart(2, '0');
      const snap = { id: `s${++seq}`, name: String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60) || `Snapshot ${seq}`, time: `${p(d.getHours())}:${p(d.getMinutes())}`, links: (scene.links || []).length, scene: clone(scene) };
      list.push(snap); while (list.length > MAX_SNAPSHOTS) list.shift();
      persist(); return snap;
    },
    clear() { list = []; persist(); },
    count: () => list.length,
  };
}

// ---- memoised diff: by the identity of both scenes, then by a content key; the caller throttles recomputation for a moving scene
let memo = { a: null, b: null, val: null };
export function cachedDiff(a, b) {
  if (memo.a === a && memo.b === b && memo.val) return memo.val;
  const val = diffScenes(a, b);
  memo = { a, b, val }; return val;
}
export function resetDiffCache() { memo = { a: null, b: null, val: null }; }
/** Throttle: run fn at most every `ms` (trailing edge), returning a cancel function. Timer functions are injectable for tests. */
export function throttled(fn, ms = THROTTLE_MS, { set = setTimeout, clear = clearTimeout } = {}) {
  let t = null, last = -Infinity;
  const call = () => { t = null; last = Date.now(); fn(); };
  const run = () => { if (t) return; const wait = Math.max(0, last + ms - Date.now()); t = set(call, wait); };
  run.cancel = () => { if (t) { clear(t); t = null; } };
  return run;
}

/** Delta chip: sign and words for a margin change in dB (B minus A). */
export function deltaChip(d) {
  if (!Number.isFinite(d)) return { sign: 'ok', text: 'not solved', short: '-' };
  if (Math.abs(d) < MARGIN_EPS_DB) return { sign: 'ok', text: 'no change', short: '0.0' };
  return { sign: d > 0 ? 'pos' : 'neg', text: `${sgn(d)} dB, margin ${d > 0 ? 'better' : 'worse'}`, short: sgn(d) };
}

/** One row per matched link for the table. */
export function linkRows(diff) {
  return diff.links.map((l) => {
    const a = l.resultA, b = l.resultB, d = l.deltas;
    const pair = (x, y, unit) => (a && b ? `${f1(x)} → ${f1(y)}${unit}` : '-');
    const newW = d.warningsAdded.length ? d.warningsAdded.join('; ') : '', goneW = d.warningsRemoved.length ? d.warningsRemoved.join('; ') : '';
    return {
      id: l.id, name: l.name,
      margin: pair(a && a.marginDb, b && b.marginDb, ' dB'), chip: deltaChip(d.marginDb),
      rx: pair(a && a.rxLevelDbm, b && b.rxLevelDbm, ' dBm'), noise: pair(a && a.noiseFloorDbm, b && b.noiseFloorDbm, ' dBm'),
      status: d.statusFrom || d.statusTo ? `${d.statusFrom || '-'} → ${d.statusTo || '-'}${d.statusFrom !== d.statusTo ? ' (changed)' : ''}` : '-',
      compression: a && b ? `${f1(a.compressionDb)} → ${f1(b.compressionDb)} dB` : '-',
      newWarnings: newW || 'none', goneWarnings: goneW || 'none',
    };
  });
}

/** Attribution bars: width as a fraction of the largest contribution, with signed text. */
export function attributionView(l) {
  const at = l.attribution;
  if (!at) return null;
  const max = Math.max(0.01, ...at.contributions.map((c) => Math.abs(c.contributionDb)));
  return {
    id: l.id, name: l.name,
    bars: at.contributions.map((c) => ({ label: c.label, change: `${c.fromText} → ${c.toText}`, db: c.contributionDb, text: `${sgn(c.contributionDb)} dB`, frac: Math.abs(c.contributionDb) / max, sign: c.contributionDb >= 0 ? 'pos' : 'neg' })),
    note: at.exact ? '' : (at.truncated ? 'Approximate: only some of the changes were tested (re-solve limit reached).' : 'Approximate: the changes interact, so the bars do not add up to the total.'),
    total: `Total margin change ${sgn(at.explainedDb + at.residualDb)} dB; explained by the bars ${sgn(at.explainedDb)} dB.`,
  };
}

/** Lines for the changed-fields list of one link or the environment. */
export const fieldLines = (fields) => (fields || []).map((f) => `${f.label}: ${f.fromText} → ${f.toText}`);

const SECTION_NAMES = { reflectors: 'Reflectors and walls', people: 'People', noiseSources: 'Noise sources', zones: 'Coverage zones', measurements: 'Measurements', platforms: 'Platforms' };
/** Added/removed/changed items per section, only sections with something in them. */
export function itemSections(diff) {
  const out = [];
  for (const [k, title] of Object.entries(SECTION_NAMES)) {
    const it = diff.items[k]; if (!it) continue;
    const lines = [...it.added.map((x) => `Added: ${x.name}`), ...it.removed.map((x) => `Removed: ${x.name}`), ...it.changed.map((x) => `Changed: ${x.name} (${fieldLines(x.fields).join('; ')})`)];
    if (lines.length) out.push({ key: k, title, lines });
  }
  if (diff.items.environment.length) out.push({ key: 'environment', title: 'Environment', lines: fieldLines(diff.items.environment) });
  if (diff.items.other.length) out.push({ key: 'other', title: 'Other settings', lines: fieldLines(diff.items.other) });
  return out;
}

export { headline };
