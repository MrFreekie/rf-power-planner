// Scenario A/B compare. Pure part: snapshotScene / compareSnapshots (no DOM). DOM part: mountCompare.
//   snapshotScene(scene, linkId?) -> { scene, linkId, name, kind, metrics } | { error }
//   compareSnapshots(a, b, units?) -> [{ key, label, unit, a, b, diff, fa, fb, fdiff, better }]
import { solveLink } from '../model/rf.js';
import { formatPower, formatLength, formatDb } from '../model/units.js';

const fin = Number.isFinite;

/** The key numbers for one link. snrDb is the signal-to-noise at the point the cascade is judged (antenna for mics, bodypack for IEMs). */
export function linkMetrics(scene, link, solved = null) {
  const r = solved || solveLink(scene, link);
  const c = r.cascade || null;
  let snrDb = null;
  if (c) {
    if (link.kind === 'iem') snrDb = r.inputPowerDbm - (c.kTBDbm + c.receiverNfDb);
    else snrDb = r.rxPowerDbm - c.noiseFloorDbm;
  }
  return {
    distanceM: r.distanceM,
    rxPowerDbm: r.rxPowerDbm,
    inputPowerDbm: r.inputPowerDbm,
    marginDb: r.marginDb,
    snrDb,
    // net end to end change from transmitter output to receiver input: what the waterfall adds up to
    waterfallTotalDb: r.inputPowerDbm - link.tx.powerDbm,
    systemNfDb: c ? c.systemNfDb : null,
    status: r.status,
  };
}

/** Capture the scene (deep copy) with its metrics. Never throws. */
export function snapshotScene(scene, linkId) {
  const copy = structuredClone(scene);
  const link = copy.links.find((l) => l.id === linkId) || copy.links[0];
  if (!link) return { error: 'The scene has no link.' };
  try {
    return { scene: copy, linkId: link.id, name: link.name, kind: link.kind, units: copy.units, metrics: linkMetrics(copy, link) };
  } catch (e) {
    return { error: `Could not solve the link: ${e.message}` };
  }
}

// higher: true = a larger value is better for the planner (more margin etc.); null = neutral
const ROWS = [
  { key: 'distanceM', label: 'Distance', unit: 'm', higher: null },
  { key: 'rxPowerDbm', label: 'Rx power', unit: 'dBm', higher: true },
  { key: 'inputPowerDbm', label: 'Input power', unit: 'dBm', higher: true },
  { key: 'marginDb', label: 'Margin', unit: 'dB', higher: true },
  { key: 'snrDb', label: 'SNR', unit: 'dB', higher: true },
  { key: 'waterfallTotalDb', label: 'Waterfall total (Tx to receiver)', unit: 'dB', higher: true },
  { key: 'systemNfDb', label: 'System NF', unit: 'dB', higher: false },
];

/** Difference rows (B minus A). `better` is 'a' | 'b' | null with a 0.05 dB dead band. */
export function compareSnapshots(a, b, units = { power: 'dBm', length: 'm' }) {
  const rows = ROWS.map((d) => {
    const va = a.metrics[d.key], vb = b.metrics[d.key];
    const diff = fin(va) && fin(vb) ? vb - va : null;
    let fa = '-', fb = '-', fdiff = '-';
    if (d.unit === 'm') { fa = fin(va) ? formatLength(va, units.length) : '-'; fb = fin(vb) ? formatLength(vb, units.length) : '-'; fdiff = diff === null ? '-' : signed(formatLength(Math.abs(diff), units.length), diff); }
    else if (d.unit === 'dBm') { fa = fin(va) ? formatPower(va, units.power) : '-'; fb = fin(vb) ? formatPower(vb, units.power) : '-'; fdiff = diff === null ? '-' : `${diff >= 0 ? '+' : '-'}${Math.abs(diff).toFixed(1)} dB`; }
    else { fa = fin(va) ? formatDb(va) : '-'; fb = fin(vb) ? formatDb(vb) : '-'; fdiff = diff === null ? '-' : `${diff >= 0 ? '+' : '-'}${Math.abs(diff).toFixed(1)} dB`; }
    let better = null;
    if (d.higher !== null && diff !== null && Math.abs(diff) >= 0.05) better = (diff > 0) === d.higher ? 'b' : 'a';
    return { key: d.key, label: d.label, unit: d.unit, a: va, b: vb, diff, fa, fb, fdiff, better };
  });
  rows.push({ key: 'status', label: 'Status', unit: '', a: a.metrics.status, b: b.metrics.status, diff: null, fa: String(a.metrics.status).toUpperCase(), fb: String(b.metrics.status).toUpperCase(), fdiff: a.metrics.status === b.metrics.status ? 'same' : 'changed', better: null });
  return rows;
}

function signed(text, diff) {
  if (Math.abs(diff) < 0.005) return text.replace(/^/, '');
  return (diff > 0 ? '+' : '-') + text;
}

/**
 * mountCompare({ container, store })
 * Flow: "Set A" captures the current scene; keep editing; the table shows A against the live scene (B).
 */
export function mountCompare({ container, store }) {
  container.textContent = '';
  const summary = document.createElement('summary');
  summary.textContent = 'Compare A / B';
  const body = document.createElement('div');
  body.className = 'ob-body';
  if (container.tagName === 'DETAILS') container.append(summary, body); else { summary.className = 'ob-summary'; container.append(summary, body); }

  const intro = document.createElement('p');
  intro.className = 'hint';
  intro.textContent = 'Press "Set A" to remember the current scene, then change something (add a booster, move the antenna, swap the cable). The table compares your remembered scene A with the scene as it is now (B).';
  const row = document.createElement('div');
  row.className = 'ob-row';
  const mk = (text, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.title = title; b.addEventListener('click', fn); return b; };
  const setA = mk('Set A = current', 'Remember the current scene as scenario A', () => { snapA = snapshotScene(store.getScene(), store.getScene().links[0] && store.getScene().links[0].id); render(); });
  const restore = mk('Restore A', 'Put scenario A back as the current scene (Undo returns to where you were)', () => { if (snapA && snapA.scene) { store.setScene(structuredClone(snapA.scene), { resetHistory: false }); store.select(null); } });
  const clear = mk('Clear', 'Forget scenario A', () => { snapA = null; render(); });
  row.append(setA, restore, clear);
  const out = document.createElement('div');
  out.className = 'ob-compare';
  out.setAttribute('aria-live', 'polite');
  body.append(intro, row, out);

  let snapA = null;

  function render() {
    restore.disabled = clear.disabled = !snapA || !!snapA.error;
    out.textContent = '';
    if (!snapA) return;
    if (snapA.error) { const p = document.createElement('p'); p.className = 'hint'; p.dataset.bad = 'true'; p.textContent = snapA.error; out.append(p); return; }
    const scene = store.getScene();
    const bSnap = snapshotScene(scene, snapA.linkId);
    if (bSnap.error) { const p = document.createElement('p'); p.className = 'hint'; p.dataset.bad = 'true'; p.textContent = bSnap.error; out.append(p); return; }
    const rows = compareSnapshots(snapA, bSnap, scene.units);
    const table = document.createElement('table');
    table.className = 'ob-table';
    const cap = document.createElement('caption');
    cap.className = 'sr-only';
    cap.textContent = 'Scenario A against the current scene B; the last column is B minus A.';
    const head = document.createElement('thead');
    head.innerHTML = '<tr><th scope="col">Result</th><th scope="col" class="num">A (saved)</th><th scope="col" class="num">B (now)</th><th scope="col" class="num">B - A</th></tr>';
    const tb = document.createElement('tbody');
    for (const r of rows) {
      const tr = document.createElement('tr');
      const th = document.createElement('th'); th.scope = 'row'; th.textContent = r.label;
      const tds = [r.fa, r.fb, r.fdiff].map((t) => { const td = document.createElement('td'); td.className = 'num'; td.textContent = t; return td; });
      if (r.better === 'b') tds[2].dataset.better = 'b';
      if (r.better === 'a') tds[2].dataset.better = 'a';
      if (r.key === 'status') { tds[0].dataset.status = String(r.a); tds[1].dataset.status = String(r.b); }
      tr.append(th, ...tds);
      tb.append(tr);
    }
    table.append(cap, head, tb);
    const same = rows.every((r) => r.diff === null || Math.abs(r.diff) < 0.05);
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = same ? 'B is the same as A so far: change something to see the difference.' : 'Green = B is better than A, red = B is worse. Differences are B minus A, in dB.';
    out.append(table, note);
  }

  const unsub = store.subscribe((_s, info) => { if (info.type !== 'selection') render(); });
  render();
  return { render, destroy() { unsub(); container.textContent = ''; } };
}
