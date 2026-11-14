// App glue: store -> toolbar, results readout, canvas views.
import { createStore } from './store.js';
import { createDefaultScene, createDefaultLink, deserialize, serialize } from './model/scene.js';
import { solveLink } from './model/rf.js';
import { SURFACES } from './model/library.js';
import { setUnits, setLinkKind, setPath, loadExample, setModulation, setCoverageMode, setImdEnabled } from './actions.js';
import { EXAMPLES } from './examples.js';
import { rxState } from './rxTracker.js';
import { telemetry } from './telemetryTracker.js';
import { digital } from './digitalTracker.js';
import { coverage } from './coverageTracker.js';
import { imd } from './imdTracker.js';
import { buildShareLink, decodeScene, parseHash } from './share.js';
import { buildReportData } from './reportData.js';
import { DIGITAL_PRESETS } from './model/digital-params.js';
import { startWalk, startMultiWalk, stopWalk, isWalking } from './walk.js';
import { planWalkAll } from './ui/walkall.js';
import { downloadScene, loadSceneFromFile } from './io.js';
import { squelch, history } from './squelchTracker.js';
import { mpx } from './mpxTracker.js';
import { formatPower, formatLength, formatDb } from './model/units.js';
import { resetScene } from './actions.js';
import { mountWelcome } from './ui/onboarding.js';
import { mountHelp } from './ui/help.js';
import { mountScenes } from './ui/scenes.js';
import { mountCompare } from './ui/compare.js';
import { mountCoordination } from './ui/coordination.js';
import { mountGlossary } from './ui/glossary.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'rf-power-planner.scene.v1';

const history_ = window.history; // the sample history module below is also called `history`
let hadStoredScene = false;
let staleCleared = false;
function loadInitialScene() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (text) { const sc = deserialize(text); hadStoredScene = true; return sc; }
  } catch {
    // Stale or corrupt saved state (old schema, hand-edited, truncated): drop it so it cannot fail again, start from the default.
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
    staleCleared = true;
  }
  return createDefaultScene();
}

let loadError = ''; // sticky until the next successful load or edit
function showError(msg) {
  const el = $('app-error');
  el.textContent = msg || '';
  el.hidden = !msg;
}

const store = createStore(loadInitialScene());
rxState.install(squelch);
telemetry.install(squelch, store);
digital.install(squelch);
coverage.install(store);
imd.install(store, squelch);
mpx.install(squelch); // MPX state + pilot squelch ride on the squelch tracker
squelch.attach(store); // before views mount so they can read the state
history.attach(store, squelch);
const activeLink = () => store.getScene().links[0];

// ---- toolbar -------------------------------------------------------------

for (const [id, s] of Object.entries(SURFACES)) {
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = s.name;
  $('floor').append(opt);
}

function setKind(kind) {
  const cur = activeLink();
  if (!cur || cur.kind === kind) return;
  setLinkKind(store, cur.id, kind);
  store.select(null);
}

$('btn-mic').addEventListener('click', () => setKind('mic'));
$('btn-iem').addEventListener('click', () => setKind('iem'));
$('btn-two-ray').addEventListener('click', () => store.update((d) => { d.environment.model = 'two-ray'; }));
$('btn-free-space').addEventListener('click', () => store.update((d) => { d.environment.model = 'free-space'; }));
$('floor').addEventListener('change', (e) => store.update((d) => { d.environment.floor = e.target.value; }));
$('freq').addEventListener('change', (e) => {
  const f = parseFloat(e.target.value);
  if (Number.isFinite(f) && f > 0) setPath(store, 'links.0.freqMHz', f);
  else e.target.value = activeLink().freqMHz;
});
for (const b of document.querySelectorAll('[data-power]')) b.addEventListener('click', () => setUnits(store, { power: b.dataset.power }));
for (const b of document.querySelectorAll('[data-length]')) b.addEventListener('click', () => setUnits(store, { length: b.dataset.length }));

$('btn-save').addEventListener('click', () => {
  try { downloadScene(store.getScene()); showError(''); } catch (err) { showError(`Could not save: ${err.message}`); }
});
$('btn-load').addEventListener('click', () => $('file-load').click());
$('file-load').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const res = await loadSceneFromFile(file);
  if (!res.ok) { loadError = `Could not load ${file.name}: ${res.error}`; showError(loadError); return; }
  loadError = '';
  store.setScene(res.scene);
  store.select(null);
});
let walkAll = false; // true while the running walk is the shared 'Walk all' one
function renderWalk() {
  if (!isWalking()) walkAll = false;
  $('btn-walk').setAttribute('aria-pressed', String(isWalking() && !walkAll));
  $('btn-walk').textContent = isWalking() ? 'Stop walk' : 'Walk';
  $('btn-walk-all').setAttribute('aria-pressed', String(isWalking() && walkAll));
  $('btn-walk-all').textContent = isWalking() && walkAll ? 'Stop all' : 'Walk all';
}
$('btn-walk-all').addEventListener('click', () => {
  if (isWalking()) { stopWalk(); renderWalk(); return; }
  const plan = planWalkAll(store.getScene());
  const speed = parseFloat($('walk-speed').value);
  const ctl = plan.items.length ? startMultiWalk(store, plan.items, { offset: plan.offset, speedMps: Number.isFinite(speed) && speed > 0 ? speed : undefined, onStop: renderWalk }) : null;
  if (!ctl) { showStatus('Nothing to walk: there is no microphone link or Intermod transmitter.', 4000); return; }
  walkAll = true;
  renderWalk();
});
$('btn-walk').addEventListener('click', () => {
  if (isWalking()) { stopWalk(); return; }
  const speed = parseFloat($('walk-speed').value);
  startWalk(store, activeLink().id, { to: $('walk-to').value, speedMps: Number.isFinite(speed) && speed > 0 ? speed : undefined, onStop: renderWalk });
  renderWalk();
});
for (const ex of EXAMPLES) {
  const opt = document.createElement('option');
  opt.value = ex.id;
  opt.textContent = ex.title;
  $('examples').append(opt);
}
function applyExample(id) {
  const ex = loadExample(store, id, { onStop: renderWalk });
  if (!ex) return false;
  history.clear();
  $('example-title').textContent = ex.title + '.';
  $('example-text').textContent = ex.note;
  $('example-note').hidden = false;
  renderWalk();
  return true;
}
$('examples').addEventListener('change', (e) => {
  const id = e.target.value;
  e.target.value = '';
  if (!id) return;
  applyExample(id);
});
$('example-dismiss').addEventListener('click', () => { $('example-note').hidden = true; });
for (const [id, p] of Object.entries(DIGITAL_PRESETS)) {
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = p.label || id;
  $('dig-preset').append(opt);
}
for (const b of document.querySelectorAll('[data-mod]')) b.addEventListener('click', () => setModulation(store, activeLink().id, { type: b.dataset.mod }));
$('dig-preset').addEventListener('change', (e) => setModulation(store, activeLink().id, { preset: e.target.value, fixedOrder: null }));
$('dig-order').addEventListener('change', (e) => setModulation(store, activeLink().id, { fixedOrder: e.target.value ? Number(e.target.value) : null }));
$('btn-imd').addEventListener('click', () => setImdEnabled(store, !(store.getScene().imd && store.getScene().imd.enabled)));
$('cov-mode').addEventListener('change', (e) => setCoverageMode(store, e.target.value));
// ---- share link, shared-scene confirmation, report -----------------------------------------------------------

let statusTimer = null;
function showStatus(msg, ms = 4000) {
  const el = $('share-status');
  el.textContent = msg;
  el.hidden = !msg;
  if (statusTimer) clearTimeout(statusTimer);
  if (msg) statusTimer = setTimeout(() => { el.hidden = true; }, ms);
}

$('btn-share').addEventListener('click', async () => {
  let link;
  try { link = await buildShareLink(store.getScene(), location.origin + location.pathname + location.search); } catch (err) { showError(err.message); return; }
  let copied = false;
  try { await navigator.clipboard.writeText(link.url); copied = true; } catch { /* clipboard unavailable: fall back to a prompt */ }
  if (!copied) { try { window.prompt('Copy this link', link.url); copied = true; } catch { /* ignore */ } }
  if (!copied) { showStatus('Copy this link: ' + link.url, 20000); return; }
  const note = 'The whole scene is stored in the link itself; nothing is uploaded.';
  showStatus((copied ? 'Copied. ' : '') + (link.warn ? `Long link (${(link.size / 1024).toFixed(1)} KB): some apps may cut it. ` : '') + note, 6000);
});

let pendingShared = null;
function askToLoad(text, apply) {
  pendingShared = apply;
  $('share-bar-text').textContent = text;
  $('share-bar').hidden = false;
}
$('share-load').addEventListener('click', () => { const f = pendingShared; pendingShared = null; $('share-bar').hidden = true; if (f) f(); });
$('share-ignore').addEventListener('click', () => { pendingShared = null; $('share-bar').hidden = true; });

async function handleHash() {
  const h = parseHash(location.hash);
  if (!h) return;
  try { history_.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
  if (h.kind === 'scene') {
    const r = await decodeScene(h.token);
    if (!r.ok) { showError(`Could not open the shared link: ${r.error}`); return; }
    askToLoad('Load shared scene? It replaces your current scene (use Save first to keep it).', () => { store.setScene(r.scene); store.select(null); stopWalk(); history.clear(); });
  } else if (h.kind === 'example') {
    const known = EXAMPLES.some((e) => e.id === h.id);
    if (!known) { showError('That example link is not known.'); return; }
    if (!hadStoredScene) applyExample(h.id);
    else askToLoad('Load the example from this link? It replaces your current scene.', () => applyExample(h.id));
  }
}

function reportResults() {
  const link = activeLink();
  const id = link.id;
  return {
    squelch: squelch.get(id), rx: rxState.get(id), digital: digital.get(id), telemetry: telemetry.get(id), coverage: coverage.get(id), imd: imd.get(),
  };
}
$('btn-report').addEventListener('click', async () => {
  try {
    const mod = await import('./view/report.js');
    const open = mod.openReport || mod.mountReport;
    if (typeof open !== 'function') throw new Error('the report view is not available');
    open({ store, getData: () => buildReportData(store.getScene(), activeLink().id, reportResults()) });
  } catch (err) {
    console.error(err);
    showError(`Could not open the report: ${err.message}`);
  }
});

$('btn-batt').addEventListener('click', () => {
  const link = activeLink();
  if (link && link.telemetry) setPath(store, 'links.0.telemetry.battery.running', !link.telemetry.battery.running);
});
$('btn-batt-reset').addEventListener('click', () => {
  const link = activeLink();
  if (!link || !link.telemetry) return;
  setPath(store, 'links.0.telemetry.battery.running', false);
  telemetry.reset(link.id);
});
$('batt-scale').addEventListener('change', (e) => {
  const v = parseFloat(e.target.value);
  if (Number.isFinite(v) && v >= 1) setPath(store, 'links.0.telemetry.battery.timeScale', v);
  else e.target.value = activeLink().telemetry.battery.timeScale;
});
// Reset to the default scene (asks first; undoable) and let the autosave overwrite the stored copy.
$('btn-reset').addEventListener('click', () => {
  let ok = false;
  try { ok = window.confirm('Reset to the default scene? Your current scene is replaced. You can press Undo straight afterwards, or use Save first to keep a copy.'); } catch { ok = false; }
  if (!ok) return;
  stopWalk();
  resetScene(store);
  history.clear();
  loadError = '';
  $('example-note').hidden = true;
  renderWalk();
  showStatus('Reset to the default scene. Undo brings the previous one back.', 5000);
});
// Replace the scene with one from the saved-scenes list (undoable).
function loadSavedScene(scene, name) {
  stopWalk();
  store.setScene(scene, { resetHistory: false });
  store.select(null);
  history.clear();
  loadError = '';
  $('example-note').hidden = true;
  renderWalk();
  showStatus(`Loaded "${name}". Undo brings the previous scene back.`, 5000);
}
$('btn-undo').addEventListener('click', () => store.undo());
$('btn-redo').addEventListener('click', () => store.redo());

document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  e.preventDefault();
  if (e.shiftKey) store.redo(); else store.undo();
});

// ---- render --------------------------------------------------------------

function renderToolbar(scene) {
  const link = scene.links[0];
  const press = (id, on) => $(id).setAttribute('aria-pressed', String(on));
  press('btn-mic', link.kind === 'mic');
  press('btn-iem', link.kind === 'iem');
  press('btn-two-ray', scene.environment.model === 'two-ray');
  press('btn-free-space', scene.environment.model === 'free-space');
  for (const b of document.querySelectorAll('[data-power]')) b.setAttribute('aria-pressed', String(b.dataset.power === scene.units.power));
  for (const b of document.querySelectorAll('[data-length]')) b.setAttribute('aria-pressed', String(b.dataset.length === scene.units.length));
  if (document.activeElement !== $('freq')) $('freq').value = link.freqMHz;
  $('floor').value = scene.environment.floor;
  const mod = link.modulation || { type: 'analog-fm', digital: {} };
  for (const b of document.querySelectorAll('[data-mod]')) b.setAttribute('aria-pressed', String(b.dataset.mod === mod.type));
  $('digital-controls').hidden = mod.type !== 'digital';
  if (mod.digital) {
    $('dig-preset').value = mod.digital.preset;
    $('dig-order').value = mod.digital.fixedOrder ? String(mod.digital.fixedOrder) : '';
  }
  $('btn-imd').setAttribute('aria-pressed', String(!!(scene.imd && scene.imd.enabled)));
  if (scene.coverage) $('cov-mode').value = scene.coverage.mode;
  const tl = link.telemetry;
  $('btn-batt').hidden = $('btn-batt-reset').hidden = !tl || !tl.enabled;
  if (tl) {
    $('btn-batt').setAttribute('aria-pressed', String(tl.battery.running));
    $('btn-batt').textContent = tl.battery.running ? 'Battery: Pause' : 'Battery: Start';
    if (document.activeElement !== $('batt-scale')) $('batt-scale').value = tl.battery.timeScale;
  }
  $('btn-undo').disabled = !store.canUndo();
  $('btn-redo').disabled = !store.canRedo();
}

function renderResults(scene) {
  const link = scene.links[0];
  const status = $('r-status');
  try {
    const r = solveLink(scene, link);
    const u = scene.units;
    $('r-distance').textContent = formatLength(r.distanceM, u.length);
    $('r-rx').textContent = formatPower(r.rxPowerDbm, u.power);
    $('r-input').textContent = formatPower(r.inputPowerDbm, u.power);
    $('r-margin').textContent = formatDb(r.marginDb);
    $('r-nf').textContent = r.cascade ? formatDb(r.cascade.systemNfDb) : '-';
    $('r-floor').textContent = r.cascade ? formatPower(r.cascade.noiseFloorDbm, u.power) : '-';
    status.textContent = r.status.toUpperCase();
    status.dataset.status = r.status;
    showError(loadError);
  } catch (err) {
    for (const id of ['r-distance', 'r-rx', 'r-input', 'r-margin', 'r-nf', 'r-floor', 'r-status']) $(id).textContent = '-';
    status.dataset.status = '';
    showError(`Could not solve link: ${err.message}`);
  }
}

function render(scene) {
  renderToolbar(scene);
  renderResults(scene);
}

let lastSaved = null;
store.subscribe((scene, info) => {
  if (info.type === 'selection') return; // views handle selection themselves
  if (info.type === 'scene') loadError = '';
  render(scene);
  const text = serialize(scene);
  if (text !== lastSaved) {
    lastSaved = text;
    try { localStorage.setItem(STORAGE_KEY, text); } catch { /* ignore */ }
  }
});
render(store.getScene());

// ---- views (loaded lazily so the readout works even if a view fails) -------

try {
  const { mountViews } = await import('./view/index.js');
  mountViews({ planCanvas: $('plan-canvas'), sideCanvas: $('side-canvas'), store });
} catch (err) {
  console.error(err);
  showError(`Views failed to load: ${err.message}`);
}

// ---- phase 3 panels (optional modules; the app still works without them) -----

for (const [path, name, id] of [
  ['./ui/inspector.js', 'mountInspector', 'inspector'],
  ['./view/waterfall.js', 'mountWaterfall', 'waterfall'],
  ['./view/meters.js', 'mountMeters', 'meters'],
  ['./view/mpx.js', 'mountMpx', 'mpx'],
  ['./view/diversity.js', 'mountDiversity', 'diversity'],
  ['./view/telemetry.js', 'mountTelemetry', 'telemetry'],
  ['./view/digital.js', 'mountDigital', 'digital'],
  ['./view/coverage.js', 'mountCoverage', 'coverage'],
  ['./view/imd.js', 'mountImd', 'imd'],
  ['./view/timeline.js', 'mountTimeline', 'timeline'],
]) {
  try {
    const mod = await import(path);
    mod[name]({ container: $(id), store });
  } catch (err) {
    console.error(err);
    $(id).hidden = true;
  }
}

// ---- onboarding, saved scenes, compare, help, glossary (each optional: a failure must not break the planner) ----
for (const [name, fn] of [
  ['welcome', () => mountWelcome({ container: $('welcome'), openButton: $('btn-help') })],
  ['scenes', () => mountScenes({ container: $('scenes'), getScene: () => store.getScene(), onLoad: loadSavedScene })],
  ['compare', () => mountCompare({ container: $('compare'), store })],
  ['coordination', () => mountCoordination({ container: $('coordination'), store })],
  ['help', () => mountHelp(document)],
  ['glossary', () => mountGlossary(document.body)],
]) {
  try { fn(); } catch (err) { console.error(name, err); }
}
if (staleCleared) showStatus('Your previously saved scene could not be read, so it was discarded and the default scene is shown.', 8000);

handleHash();
window.addEventListener('hashchange', handleHash);

// Debug handle for the console.
window.rfPlanner = { store, squelch, history, mpx, rxState, telemetry, digital, coverage, imd };
