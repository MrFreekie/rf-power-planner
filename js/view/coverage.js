// Coverage panel: heat-map toggles, combine mode, zone table (min / mean / % pass / worst point),
// zone editing buttons and a suggestion list with Apply buttons. The overlay itself is drawn by plan.js.
import { activeLink } from './util.js';
import { dispX, dispY } from '../ui/coords.js';
import { coverage } from '../coverageTracker.js';
import { covView, setCovView } from './coverageUi.js';
import { suggestFix } from '../model/coverage.js';
import { createChainItem } from '../model/scene.js';
import { addZone, removeZone, addZonePoint, removeZonePoint, setCoverageMode, moveBranch, updateBranch } from '../actions.js';

const MODES = [['power', 'Power sum'], ['coherent', 'Coherent'], ['best', 'Best antenna']];

/** Apply a suggestFix result through the actions. Returns true when something was dispatched. Pure apart from the store. */
export function applySuggestion(store, linkId, sug) {
  const link = store.getScene().links.find((l) => l.id === linkId);
  const br = link && (link.branches || []).find((b) => b.id === sug.branchId);
  if (!br) return false;
  if (sug.kind === 'move') return moveBranch(store, linkId, sug.branchId, { x: sug.params.x, y: sug.params.y });
  if (sug.kind === 'attenuate') return updateBranch(store, linkId, sug.branchId, { chain: [...(br.chain || []), createChainItem('attenuator', { lossDb: sug.params.lossDb })] });
  if (sug.kind === 'gain') return updateBranch(store, linkId, sug.branchId, { antenna: { gainDbi: (br.antenna.gainDbi || 0) + sug.params.gainDb } });
  return false;
}

const fmtDbm = (v) => (Number.isFinite(v) ? `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}` : '-');

export function mountCoverage({ container, store }) {
  container.classList.add('coverage-panel');
  container.textContent = '';
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const h2 = el('h2', null, 'Coverage and zones');
  const controls = el('div', 'cv-controls');
  const modeSel = el('select'); modeSel.setAttribute('aria-label', 'Coverage combine mode');
  for (const [v, t] of MODES) { const o = el('option', null, t); o.value = v; modeSel.append(o); }
  modeSel.addEventListener('change', () => setCoverageMode(store, modeSel.value));
  const mkCheck = (label, key) => {
    const l = el('label', 'cv-check'); const c = el('input'); c.type = 'checkbox'; c.checked = !!covView[key];
    c.addEventListener('change', () => setCovView({ [key]: c.checked }));
    l.append(c, document.createTextNode(` ${label}`));
    return [l, c];
  };
  const [lHeat, cHeat] = mkCheck('Heat map', 'show');
  const [lTint, cTint] = mkCheck('Tint by antenna', 'tint');
  const [lZones, cZones] = mkCheck('Zones', 'zones');
  const modeLabel = el('label', null, 'Combine '); modeLabel.append(modeSel);
  controls.append(modeLabel, lHeat, lTint, lZones);
  const prog = el('p', 'hint cv-prog');
  const tableWrap = el('div', 'cv-table-wrap');
  const table = el('table', 'cv-table');
  table.innerHTML = '<thead><tr><th scope="col">Zone</th><th scope="col" class="num">Min</th><th scope="col" class="num">Mean</th><th scope="col" class="num">Pass</th><th scope="col">Worst</th><th scope="col">Result</th></tr></thead><tbody></tbody>';
  const tbody = table.querySelector('tbody');
  tableWrap.append(table);
  const actions = el('div', 'cv-actions');
  const bAdd = el('button', null, 'Add zone'); bAdd.type = 'button';
  const bVert = el('button', null, 'Add vertex'); bVert.type = 'button';
  const bUnvert = el('button', null, 'Remove vertex'); bUnvert.type = 'button';
  const bDel = el('button', 'danger', 'Remove zone'); bDel.type = 'button';
  actions.append(bAdd, bVert, bUnvert, bDel);
  const hint = el('p', 'hint', 'Select a zone (click its row or its outline in the plan) to edit it. Drag its square corner handles in the plan view. Dead areas are outlined on the heat map. Levels are dBm at the receiver input, in the selected combine mode.');
  const sugHead = el('h3', 'cv-sug-h', 'Suggestions');
  const sugList = el('ol', 'cv-sug');
  const sugNote = el('p', 'hint');
  container.append(h2, controls, prog, tableWrap, actions, hint, sugHead, sugNote, sugList);

  let suggestFor = null, suggestions = [];

  const selectedZone = () => (store.getScene().zones || []).find((z) => z.id === store.getSelection());
  bAdd.addEventListener('click', () => { const id = addZone(store); if (id) store.select(id); });
  bDel.addEventListener('click', () => { const z = selectedZone(); if (z) { removeZone(store, z.id); store.select(null); } });
  bVert.addEventListener('click', () => {
    const z = selectedZone(); if (!z) return;
    const a = z.polygon[z.polygon.length - 1], b = z.polygon[0];
    addZonePoint(store, z.id, { x: (a.x + b.x) / 2 + 0.5, y: (a.y + b.y) / 2 + 0.5 }, z.polygon.length);
  });
  bUnvert.addEventListener('click', () => { const z = selectedZone(); if (z) removeZonePoint(store, z.id, z.polygon.length - 1); });

  function runSuggest(zone, link) {
    suggestFor = zone.id;
    sugNote.textContent = 'Working out suggestions...';
    setTimeout(() => {
      try {
        const sc = store.getScene();
        suggestions = suggestFix(sc, link.id, zone.id, { mode: sc.coverage?.mode || 'coherent' });
        sugNote.textContent = suggestions.length ? `Ranked fixes for ${zone.name}:` : `No simple fix found for ${zone.name}.`;
      } catch { suggestions = []; sugNote.textContent = 'Could not compute suggestions.'; }
      render();
    }, 20);
  }

  function render() {
    const scene = store.getScene();
    const link = activeLink(scene, store.getSelection());
    cHeat.checked = !!covView.show; cTint.checked = !!covView.tint; cZones.checked = !!covView.zones;
    modeSel.value = scene.coverage?.mode || 'power';
    const cov = link ? coverage.get(link.id) : null;
    prog.textContent = !link ? 'No link.' : !cov ? 'Coverage is computed for in-ear monitor links and for scenes with zones.' : cov.computing ? `Computing coverage ${Math.round((cov.progress || 0) * 100)}%...` : `Coverage grid ${cov.cellM} m cells, receiver height ${Number.isFinite(cov.rxHeight) ? cov.rxHeight.toFixed(2) : '-'} m above the floor${cov.undersampled ? ' (coarse: estimates only)' : ''}${cov.fineCoverage === 'zones-only' ? ', fine pass in zones only' : ''}.`;
    const sel = store.getSelection();
    tbody.textContent = '';
    const zones = scene.zones || [];
    if (!zones.length) { const tr = el('tr'); const td = el('td', null, 'No zones yet. Add a zone to check coverage in an area.'); td.colSpan = 6; tr.append(td); tbody.append(tr); }
    for (const z of zones) {
      const r = cov && cov.zones ? cov.zones.find((q) => q.zoneId === z.id) : null;
      const st = r && r.stats;
      const tr = el('tr'); tr.dataset.selected = String(sel === z.id); tr.tabIndex = 0;
      const pick = () => store.select(z.id);
      tr.addEventListener('click', pick); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      const res = el('td'); const chip = el('span', 'chip', st ? (st.pass ? 'PASS' : 'FAIL') : '...');
      chip.dataset.state = st ? (st.pass ? 'open' : 'closed') : 'none'; res.append(chip);
      tr.append(el('td', null, z.name), el('td', 'num', st ? fmtDbm(st.minDbm) : '-'), el('td', 'num', st ? fmtDbm(st.meanDbm) : '-'),
        el('td', 'num', st ? `${Math.round(st.passFraction * 100)}%` : '-'),
        el('td', null, st && st.worstPoint ? `${dispX(scene, st.worstPoint.x).toFixed(1)}, ${dispY(scene, st.worstPoint.y).toFixed(1)}` : '-'), res);
      tbody.append(tr);
      if (st && !st.pass && link && link.kind === 'iem') {
        const tr2 = el('tr', 'cv-sugrow'); const td = el('td'); td.colSpan = 6;
        const b = el('button', null, 'Suggest fixes'); b.type = 'button'; b.addEventListener('click', () => runSuggest(z, link));
        td.append(b); tr2.append(td); tbody.append(tr2);
      }
    }
    const z = selectedZone();
    bVert.disabled = !z; bUnvert.disabled = !z || z.polygon.length <= 3; bDel.disabled = !z;
    sugList.textContent = '';
    sugHead.hidden = sugList.hidden = sugNote.hidden = !suggestFor;
    if (suggestFor) {
      for (const s of suggestions) {
        const li = el('li');
        const dp = Math.round(s.deltaPassFraction * 100);
        li.append(el('span', null, `${s.description} (pass ${dp >= 0 ? '+' : ''}${dp} points, min ${s.deltaMinDb >= 0 ? '+' : ''}${s.deltaMinDb.toFixed(1)} dB) `));
        const ap = el('button', null, 'Apply'); ap.type = 'button';
        ap.addEventListener('click', () => { applySuggestion(store, link.id, s); suggestions = []; suggestFor = null; render(); });
        li.append(ap); sugList.append(li);
      }
    }
  }

  const u1 = coverage.subscribe(() => render());
  const u2 = store.subscribe(() => render());
  render();
  return { destroy() { u1(); u2(); container.textContent = ''; } };
}
