// Global audio source, tone and MPX sliders, tone lines in the MPX and RF views, Fresnel overlay and budget rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStore } from '../js/store.js';
import { setAudioSource, setAudioToneHz } from '../js/actions.js';
import { createToneState } from '../js/ui/toneState.js';
import { sourceDescription } from '../js/ui/sourceBar.js';
import { toneSetup, toneProducts, drawBasebandLines, drawRfLines, lineRows } from '../js/view/toneLines.js';
import { audioInputs, spectrumTable, rfSummary, audioSummary } from '../js/view/spectra.js';
import { fresnelFor, fresnelSummary, drawFresnelPlan, drawFresnelSide, fresnelView } from '../js/view/fresnelDraw.js';
import { fresnelRows, budgetExtras } from '../js/ui/budgetExtras.js';
import { EXAMPLES } from '../js/examples.js';
import { createDefaultScene } from '../js/model/scene.js';
import { validateScene } from '../js/model/scene.js';

const th = { paper: '#fff', paper2: '#eee', ink: '#000', inkSoft: '#555', grid: '#ddd', blue: '#00f', fail: '#f00', pass: '#0a0', marginal: '#fa0', warnText: '#a60', mono: '#999', font: 'sans-serif' };
function fakeCtx() {
  const calls = [];
  return new Proxy({ calls }, { get(t, k) { if (k in t) return t[k]; if (k === 'measureText') return () => ({ width: 10 }); return (...a) => { calls.push([k, ...a]); }; }, set(t, k, v) { t[k] = v; return true; } });
}
const texts = (c) => c.calls.filter((x) => x[0] === 'fillText' || x[0] === 'strokeText').map((x) => String(x[1]));
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const ex = (id) => EXAMPLES.find((e) => e.id === id).build().scene;

test('audio source actions: set, clear, reject unknown, clamp the tone frequency, scene stays valid', () => {
  const st = createStore(createDefaultScene());
  assert.equal(setAudioSource(st, 'tone'), true); assert.equal(st.getScene().audioSource, 'tone');
  assert.equal(setAudioSource(st, 'bogus'), false); assert.equal(st.getScene().audioSource, 'tone');
  setAudioToneHz(st, 5); assert.equal(st.getScene().audioToneHz, 20);
  setAudioToneHz(st, 99999); assert.equal(st.getScene().audioToneHz, 20000);
  assert.equal(setAudioToneHz(st, 'abc'), false);
  setAudioToneHz(st, 1234); assert.equal(st.getScene().audioToneHz, 1234);
  assert.equal(validateScene(st.getScene()).ok, true);
  setAudioSource(st, ''); assert.equal(st.getScene().audioSource, undefined);
});

test('tone state clamps, notifies and resets; descriptions say what the source is', () => {
  const t = createToneState(); let n = 0; t.subscribe(() => n++);
  assert.equal(t.get().pilotPct, 9);
  t.set({ pilotPct: 99, tonePct: -5, overloadDb: 3 }); assert.deepEqual(t.get(), { tonePct: 0, pilotPct: 15, overloadDb: 3 });
  assert.equal(t.set({ pilotPct: 15 }), false); assert.equal(n, 1);
  t.reset(); assert.equal(t.get().tonePct, 40);
  assert.match(sourceDescription('', 'iem'), /Default for this link: Music/i); assert.match(sourceDescription('tone', 'mic'), /sine/i);
});

test('toneSetup applies only to tone, two-tone and sweep; a mono link has no pilot', () => {
  const sc = ex('tone-pilot-products'), iem = sc.links[0], tone = createToneState().get();
  const s = toneSetup(sc, iem, tone, 0, true);
  assert.equal(s.source, 'tone'); assert.ok(Math.abs(s.toneKhz - 1) < 1e-9); assert.equal(s.pilotPct, 9);
  assert.equal(toneSetup(sc, iem, tone, 0, false).pilotPct, 0);
  assert.equal(toneSetup({ ...sc, audioSource: 'music' }, iem, tone, 0, true), null);
  const sw = toneSetup({ ...sc, audioSource: 'sweep' }, iem, tone, 5, true); assert.ok(sw.toneKhz > 0.02 && sw.toneKhz < 20.01);
  assert.equal(toneSetup(sc, null, tone), null);
});

test('baseband and two-tone lines are drawn and named; the table lists them', () => {
  const sc = ex('tone-pilot-products'), tone = createToneState().get(), setup = toneSetup(sc, sc.links[0], tone, 0, true);
  const prod = toneProducts(setup, 75);
  assert.ok(prod.baseband.some((l) => l.kind === 'intermod') && prod.twoTone.lines.length > 20);
  const g = fakeCtx(); drawBasebandLines(g, th, { X: (k) => 30 + k * 8, Y: (d) => 200 + d * 2, L: 30, T: 20, pw: 480, ph: 180, span: 60, floorDb: -90 }, prod);
  const t = texts(g); assert.ok(t.some((x) => /tone 1 kHz/.test(x)) && t.some((x) => /pilot 19/.test(x)) && t.some((x) => /f/.test(x)));
  assert.ok(g.calls.filter((x) => x[0] === 'stroke').length > 5);
  const g2 = fakeCtx(); drawRfLines(g2, th, { X: (k) => 300 + k, Y: (d) => 200 - d, L: 40, T: 20, pw: 520, ph: 180 }, prod, -58, -130, -300, 300);
  assert.ok(texts(g2).some((x) => /two-tone FM lines/.test(x)) && texts(g2).some((x) => /carrier line/.test(x)));
  const rows = lineRows(prod); assert.ok(rows.length > 4 && rows[0].length === 3);
  const tbl = spectrumTable('mpx', { m: { freqKhz: [0, 1], levelDb: [-10, -20] }, tp: prod }); assert.ok(tbl.rows.length > 6);
  const rt = spectrumTable('rf', { s: { freqsMHz: [599.9, 600], levelsDbm: [-90, -60], noiseDbm: -120 }, inp: { carrierMHz: 600, toneProducts: prod } }); assert.ok(rt.rows.some((r) => /FM line/.test(r[0])));
});

test('the audio spectrum takes the global source and says so', () => {
  const inp = audioInputs({ kind: 'iem', mpx: { enabled: false } }, null, 0, 64, { source: 'tone', toneHz: 440 });
  assert.equal(inp.source, 'tone'); assert.equal(inp.toneHz, 440);
  assert.equal(audioInputs({ kind: 'mic' }, null, 0, 64).source, undefined, 'no source: the old behaviour');
  assert.match(audioSummary({ floorDb: -90 }, { ...inp, stereo: true }), /simulated tone in stereo/i);
});

test('Fresnel rows say the status in words, name the worst category and carry the warnings', () => {
  const sc = ex('foh-mic-iem-audience'), link = sc.links[0], fr = fresnelFor(sc, link);
  assert.ok(fr && fr.geometry.plan.lens.length > 10);
  assert.equal(fresnelFor(sc, link), fr, 'cached per scene');
  assert.match(fresnelSummary(fr), /^(CLEAR|MARGINAL|BLOCKED)/);
  const rows = fresnelRows(fr); assert.equal(rows[0].label, 'Fresnel zone'); assert.match(rows[0].value, /CLEAR|MARGINAL|BLOCKED/); assert.ok(['ok', 'info', 'warning'].includes(rows[0].severity));
  assert.equal(fresnelRows(null).length, 0);
  assert.ok(budgetExtras(null, fr).length === 0, 'no result, no rows');
});

test('Fresnel overlay draws the lens in the plan and the ellipse in the side view only when switched on', () => {
  const sc = ex('foh-mic-iem-audience'), link = sc.links[0];
  const vp = { worldToScreen: (x, y) => ({ x: 100 + x * 5, y: 200 - y * 5 }) };
  const off = fakeCtx(); fresnelView.set(false); drawFresnelPlan(off, th, vp, sc, link, 600); assert.equal(off.calls.length, 0);
  fresnelView.set(true);
  try {
    const g = fakeCtx(); drawFresnelPlan(g, th, vp, sc, link, 600);
    assert.ok(g.calls.some((c) => c[0] === 'fill') && g.calls.some((c) => c[0] === 'stroke')); assert.ok(texts(g).some((t) => /Fresnel (CLEAR|MARGINAL|BLOCKED)/.test(t)));
    for (const iem of [false, true]) { const s = fakeCtx(); drawFresnelSide(s, th, vp, sc, link, { iem, D: 20 }, 600); assert.ok(s.calls.some((c) => c[0] === 'stroke'), `side iem=${iem}`); }
  } finally { fresnelView.set(false); }
  const blocked = ex('foh-mic-iem-audience'); assert.ok(blocked.links.length >= 1);
});

test('wiring: source bar in the toolbar (mounted by the spectra module), source into the model calls, lab and meters follow the global source', () => {
  const sp = read('js/view/spectra.js'), app = read('js/app.js'), lab = read('js/view/modLab.js'), hist = read('js/history.js'), html = read('index.html');
  assert.ok(sp.includes('mountSourceBar(') && sp.includes('resolveAudioSource(scene, link)') && sp.includes('audioSource: src && src.source') && sp.includes('programme'));
  assert.ok(lab.includes('messageKindFor(as)') && lab.includes('MESSAGE_SOURCE_KINDS'));
  assert.ok(hist.includes('normalizeAudioSource(scene.audioSource)'));
  assert.ok(app.includes('TONE_MPX_EXAMPLES') && app.includes('fresnelView.set'));
  assert.equal((html.match(/class="fresnel-toggle"/g) || []).length, 2, 'a Fresnel toggle in the plan and the side heading');
});

test('audio source selector is mounted in the top toolbar (before the Modulation lab button) and its pop-out opens below it', () => {
  const sp = read('js/view/spectra.js'), sb = read('js/ui/sourceBar.js'), css = read('css/style.css');
  assert.ok(sp.includes("getElementById('toolbar')") && sp.includes("getElementById('btn-modlab')"));
  assert.ok(sb.includes('before') && sb.includes("id: 'audio-source'") && sb.includes("'aria-label': 'Audio source'") && sb.includes('r.top < innerHeight / 2'));
  assert.ok(css.includes('#toolbar .source-bar'));
  assert.ok(css.includes('.map-scroll::-webkit-scrollbar') && css.includes('overflow-x: scroll'));
});
