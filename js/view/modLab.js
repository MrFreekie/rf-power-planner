// Modulation lab: an educational overlay with animated AM, FM, digital, stereo-FM (MPX) and radio-mic tone-key demos.
// Display maths only (js/model/modulation-demo.js); the carrier on screen is scaled down, the spectra are in real kHz.
// The overlay is lazy-loaded by app.js. Animation runs only while it is open, visible and not paused;
// with prefers-reduced-motion it starts paused (Play / Step buttons).
import { createCanvasHost, activeLink, solveCached, setFont, haloText, inkAlpha } from './util.js';
import * as M from '../model/modulation-demo.js';
import { stereoBlend, pilotStep, audioSnrDb } from '../model/mpx.js';
import * as AP from '../model/audio-processing.js';
import { fmDeviationComparison } from '../model/fm-deviation.js';
import { getFmPreset } from '../model/fm-presets.js';

const MODES = [
  { id: 'am', label: 'AM' }, { id: 'fm', label: 'FM' }, { id: 'digital', label: 'Digital' },
  { id: 'mpx', label: 'Stereo FM (MPX)' }, { id: 'ms', label: 'Mid/Side (IEM)' }, { id: 'pre', label: 'Pre-emphasis' }, { id: 'comp', label: 'Companding' }, { id: 'tone', label: 'Mic tone-key' },
];
const WIN = 4;        // seconds of display time across the time-domain canvas
const F0 = 0.5;       // base message frequency in display Hz (2 cycles per window)
const AUX = new Set(['digital', 'ms', 'pre', 'comp']);
const FC = 7;         // displayed carrier, display Hz (28 cycles per window): NOT the real carrier
const SYM_RATE = 3;   // waveform symbols per second
const CONS_RATE = 24; // constellation symbols per second (faster than the waveform so statistics build up)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');
const fmtKhz = (v) => String(Math.round(v * 100) / 100);

function niceStep(span, n) { const raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / p; return (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * p; }

export function mountModLab({ container, store, openButton }) {
  const doc = container.ownerDocument;
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => !!(mq && mq.matches);
  const el = (tag, cls, text, attrs) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

  // ---- state ----------------------------------------------------------------------------------
  const P = {
    mode: 'fm', msg: 'sine', playing: !reduced(), sweep: !reduced(),
    am: { depth: 80, fm: 3 },
    fm: { dev: 40, fm: 3, inputDbm: -80, nfDb: 6, compare: false },
    dig: { mode: 'QPSK', snr: 18, rate: 40 },
    mpx: { cnr: 38, programme: 'stereo', rds: false, leak: false, lp16: false },
    tone: { khz: M.TONE_KEY_DEFAULT_KHZ, devPct: 5, scenario: 'cycle' },
    pre: { tau: '50', on: true, brk: 'ok', level: 0, hf: 60, cnr: 22 },
    cmp: { ratio: 2, ref: -20, attack: 3, release: 100, tone: -30, noise: -60, mismatch: false, hfw: false },
    ms: { srcs: { ...M.MS_DEFAULTS.srcs }, hp: 0, width: 100, boost: 0, limit: 100, mono: false },
  };
  let time = 0, sweepPhase = 0, open = false, raf = 0, last = 0, pilotLocked = true, lastFocus = null;
  const cnt = { key: '', k: 0, n: 300, e: 0 }; // running symbol-error counter for the constellation
  const inputs = {}; // key -> { input, out, get, fmt } for syncing sliders
  let summaryText = '', gateOpenNow = false;

  // ---- DOM ----------------------------------------------------------------------------------------
  container.textContent = '';
  container.classList.add('modlab');
  container.setAttribute('role', 'dialog'); container.setAttribute('aria-modal', 'true'); container.setAttribute('aria-label', 'Modulation lab');
  const bar = el('div', 'ml-bar');
  const title = el('h2', 'ml-title', 'Modulation lab');
  const closeBtn = el('button', 'ml-close', 'Close', { type: 'button', 'aria-label': 'Close the modulation lab' });
  bar.append(title, el('span', 'ml-illus', 'Illustrative demonstration, not a link budget'), closeBtn);
  const tabs = el('div', 'ml-tabs', null, { role: 'group', 'aria-label': 'Modulation type' });
  const tabBtns = {};
  for (const m of MODES) { const b = el('button', 'ml-tab', m.label, { type: 'button', 'aria-pressed': 'false' }); b.addEventListener('click', () => setMode(m.id)); tabBtns[m.id] = b; tabs.append(b); }
  const ctlRow = el('div', 'ml-controls');
  const transport = el('div', 'ml-transport', null, { role: 'group', 'aria-label': 'Animation' });
  const playBtn = el('button', null, 'Pause', { type: 'button', 'aria-pressed': 'false' });
  const stepBtn = el('button', null, 'Step', { type: 'button', title: 'Advance the animation by a quarter of a second' });
  const sceneBtn = el('button', null, "Use this scene's numbers", { type: 'button', title: 'Pre-set deviation, input level and SNR from the selected link (read only: the scene is not changed)' });
  transport.append(playBtn, stepBtn, sceneBtn);
  const note = el('p', 'ml-note');
  const status = el('p', 'ml-status', '', { role: 'status', 'aria-live': 'polite' });
  const timeCv = el('canvas', 'ml-canvas ml-time', null, { role: 'img', tabindex: '0' });
  const row = el('div', 'ml-row');
  const specCv = el('canvas', 'ml-canvas ml-spec', null, { role: 'img', tabindex: '0' });
  const auxCv = el('canvas', 'ml-canvas ml-aux', null, { role: 'img', tabindex: '0' });
  row.append(specCv, auxCv);
  const summary = el('p', 'ml-summary');
  const msx = el('div', 'ml-msx');
  const cmp = el('div', 'ml-compare');
  const help = el('div', 'ml-help');
  const body = el('div', 'ml-body');
  body.append(tabs, ctlRow, transport, note, status, timeCv, row, summary, cmp, msx, help);
  container.append(bar, body);

  // ---- control builders -------------------------------------------------------------------------
  function slider(key, label, min, max, step, obj, prop, unit, f = (v) => fmt(v, 0), onChange) {
    const wrap = el('label', 'ml-ctl');
    const lab = el('span', 'ml-lab', label);
    const input = el('input', null, null, { type: 'range', min, max, step });
    const out = el('output', 'ml-out');
    input.value = obj[prop];
    const show = () => { out.textContent = `${f(obj[prop])}${unit ? ' ' + unit : ''}`; input.setAttribute('aria-valuetext', out.textContent); };
    show();
    input.addEventListener('input', () => { obj[prop] = +input.value; if (key === P.sweepKey) { P.sweep = false; syncSweep(); } show(); onChange?.(); changed(); });
    wrap.append(lab, input, out);
    inputs[key] = { input, show, obj, prop };
    return wrap;
  }
  function select(label, opts, obj, prop, onChange) {
    const wrap = el('label', 'ml-ctl'); const sel = el('select');
    for (const [v, t] of opts) sel.append(el('option', null, t, { value: v }));
    sel.value = obj[prop];
    sel.addEventListener('change', () => { obj[prop] = sel.value; onChange?.(); changed(); });
    wrap.append(el('span', 'ml-lab', label), sel); return wrap;
  }
  function check(label, obj, prop, onChange, key) {
    const wrap = el('label', 'ml-chk'); const c = el('input', null, null, { type: 'checkbox' }); c.checked = !!obj[prop];
    c.addEventListener('change', () => { obj[prop] = c.checked; onChange?.(); changed(); });
    wrap.append(c, el('span', null, label)); if (key) inputs[key] = { input: c, show: () => { c.checked = !!obj[prop]; } };
    return wrap;
  }
  function button(label, fn, title) { const b = el('button', null, label, { type: 'button' }); if (title) b.title = title; b.addEventListener('click', () => { fn(); changed(); }); return b; }
  let sweepCheck = null;
  const syncSweep = () => { if (sweepCheck) sweepCheck.checked = P.sweep; };
  function sweepCtl(label) {
    const w = el('label', 'ml-chk'); const c = el('input', null, null, { type: 'checkbox' }); c.checked = P.sweep;
    c.addEventListener('change', () => { P.sweep = c.checked; changed(); }); sweepCheck = c;
    w.append(c, el('span', null, label)); return w;
  }
  const msgSel = () => select('Message', M.MESSAGE_KINDS.map((k) => [k, M.MESSAGE_LABELS[k]]), P, 'msg');

  function buildControls() {
    ctlRow.textContent = ''; for (const k of Object.keys(inputs)) delete inputs[k]; sweepCheck = null;
    const add = (...n) => ctlRow.append(...n);
    if (P.mode === 'am') {
      P.sweepKey = 'am.depth';
      add(msgSel(), slider('am.depth', 'Modulation depth', 0, 120, 1, P.am, 'depth', '%'), slider('am.fm', 'Audio frequency', 0.3, 10, 0.1, P.am, 'fm', 'kHz', (v) => fmt(v, 1)), sweepCtl('Auto-sweep the depth'));
    } else if (P.mode === 'fm') {
      P.sweepKey = 'fm.dev';
      add(msgSel(), slider('fm.dev', 'Deviation', 1, 100, 0.5, P.fm, 'dev', 'kHz', (v) => '+-' + fmt(v, 1)), slider('fm.fm', 'Modulation frequency', 0.3, 15, 0.1, P.fm, 'fm', 'kHz', (v) => fmt(v, 1)), sweepCtl('Auto-sweep the deviation'),
        button('Set index to 2.405', () => { P.sweep = false; syncSweep(); P.fm.dev = clamp(+(M.BESSEL_NULL * P.fm.fm).toFixed(1), 1, 100); syncInputs(); }, 'Sets the deviation so that the modulation index is 2.405, where the carrier disappears (first zero of J0)'),
        check('Deviation compare', P.fm, 'compare', () => buildCompare()),
        slider('fm.inputDbm', 'Input level (compare table)', -100, -20, 1, P.fm, 'inputDbm', 'dBm', (v) => fmt(v, 0), () => buildCompare()));
      const pr = el('div', 'ml-presets', null, { role: 'group', 'aria-label': 'Deviation presets' });
      for (const d of M.DEVIATION_PRESETS) pr.append(button(`+-${d.devKhz} kHz`, () => { P.sweep = false; syncSweep(); P.fm.dev = d.devKhz; syncInputs(); }, d.label));
      add(pr);
    } else if (P.mode === 'digital') {
      P.sweepKey = 'dig.snr';
      add(select('Modulation', M.DIGITAL_MODES.map((m) => [m, m === '16QAM' ? '16-QAM' : m]), P.dig, 'mode'), slider('dig.snr', 'SNR (Es/N0)', -5, 35, 0.5, P.dig, 'snr', 'dB', (v) => fmt(v, 1)), slider('dig.rate', 'Symbol rate', 5, 150, 5, P.dig, 'rate', 'ksym/s'), sweepCtl('Auto-sweep the SNR'));
    } else if (P.mode === 'mpx') {
      P.sweepKey = null;
      add(select('Programme', [['stereo', 'Stereo (L and R differ)'], ['left', 'Left only'], ['right', 'Right only'], ['mono', 'Mono (L = R)']], P.mpx, 'programme'),
        slider('mpx.cnr', 'Carrier-to-noise', 5, 45, 1, P.mpx, 'cnr', 'dB'),
        check('Weak signal: blend to mono', { get weak() { return P.mpx.cnr < 20; }, set weak(v) { P.mpx.cnr = v ? 15 : 38; } }, 'weak', () => syncInputs()),
        check('RDS (57 kHz)', P.mpx, 'rds'), check('Console sends 17-20 kHz content', P.mpx, 'leak'), check('16 kHz low-pass fix', P.mpx, 'lp16'));
    } else if (P.mode === 'pre') {
      P.sweepKey = null;
      add(select('Time constant', [['50', '50 µs (EU/UK)'], ['75', '75 µs (US)']], P.pre, 'tau'),
        check('Pre-emphasis at the transmitter', P.pre, 'on'),
        select('Receiver de-emphasis', [['ok', 'Matches the transmitter'], ['missing', 'Missing'], ['wrong', 'Wrong time constant (50 vs 75)']], P.pre, 'brk'),
        slider('pre.level', 'Programme level', -12, 18, 1, P.pre, 'level', 'dB', (v) => (v > 0 ? '+' : '') + fmt(v, 0)),
        slider('pre.hf', 'HF content (cymbals)', 0, 100, 5, P.pre, 'hf', '%'),
        slider('pre.cnr', 'Signal strength (carrier-to-noise)', 5, 45, 1, P.pre, 'cnr', 'dB'));
    } else if (P.mode === 'comp') {
      P.sweepKey = null;
      add(slider('cmp.ratio', 'Ratio', 1.5, 4, 0.5, P.cmp, 'ratio', '', (v) => fmt(v, 1) + ':1'),
        slider('cmp.ref', 'Reference level', -40, 0, 1, P.cmp, 'ref', 'dB'),
        slider('cmp.attack', 'Attack', 1, 30, 1, P.cmp, 'attack', 'ms'),
        slider('cmp.release', 'Release', 20, 500, 10, P.cmp, 'release', 'ms'),
        slider('cmp.tone', 'Signal level', -60, -5, 1, P.cmp, 'tone', 'dB'),
        slider('cmp.noise', 'Channel noise floor', -90, -40, 1, P.cmp, 'noise', 'dB'),
        check('Mismatch expander', P.cmp, 'mismatch'), check('HF-weighted detector (generic)', P.cmp, 'hfw'));
    } else if (P.mode === 'ms') {
      P.sweepKey = null;
      const srcBox = el('div', 'ml-presets', null, { role: 'group', 'aria-label': 'Sources in the mix' });
      for (const src of M.MS_SOURCES) srcBox.append(check(src.label, P.ms.srcs, src.id, () => buildMsExtra()));
      add(srcBox,
        select('Side high-pass', [['0', 'Off'], ['100', '100 Hz'], ['150', '150 Hz']], P.ms, 'hp', () => { P.ms.hp = +P.ms.hp; buildMsExtra(); }),
        slider('ms.width', 'Side level (stereo width)', 0, 200, 5, P.ms, 'width', '%', undefined, () => buildMsExtra()),
        slider('ms.boost', 'Side high-frequency boost', 0, 12, 0.5, P.ms, 'boost', 'dB', (v) => fmt(v, 1), () => buildMsExtra()),
        slider('ms.limit', 'Side compressor threshold', 20, 100, 5, P.ms, 'limit', '', (v) => (v >= 100 ? 'off' : fmt(v, 0) + ' %'), () => buildMsExtra()),
        slider('mpx.cnr', 'Signal strength (carrier-to-noise)', 5, 45, 1, P.mpx, 'cnr', 'dB'),
        check('Console sends 17-20 kHz content', P.mpx, 'leak'), check('16 kHz low-pass fix', P.mpx, 'lp16'),
        check('Check in mono', P.ms, 'mono', () => buildMsExtra()));
    } else {
      P.sweepKey = null;
      add(select('Scenario', M.GATE_SCENARIOS.map((s) => [s, M.GATE_LABELS[s]]), P.tone, 'scenario'),
        slider('tone.khz', 'Tone-key frequency', 20, 45, 'any', P.tone, 'khz', 'kHz', (v) => fmt(v, 3)),
        slider('tone.devPct', 'Tone level (illustrative)', 1, 15, 0.5, P.tone, 'devPct', '% of deviation', (v) => fmt(v, 1)),
        button('Reset to 32.768 kHz', () => { P.tone.khz = M.TONE_KEY_DEFAULT_KHZ; syncInputs(); }));
    }
    sceneBtn.hidden = !(P.mode === 'fm' || P.mode === 'digital' || P.mode === 'mpx' || P.mode === 'ms' || P.mode === 'pre');
  }
  const syncInputs = () => { for (const k of Object.keys(inputs)) { const i = inputs[k]; if (i.obj) i.input.value = i.obj[i.prop]; i.show(); } };

  const NOTES = {
    am: 'The carrier on screen is drawn with about 28 cycles per window so you can see it. A real carrier here would be hundreds of MHz, millions of times faster. Above 100 % depth the envelope crosses zero and the detector output is distorted. AM is not used for wireless microphones; it is here to show the idea.',
    fm: 'The displayed carrier is scaled down (28 cycles per window); the real one is hundreds of MHz. Deviation squeezes and stretches the cycles; the instantaneous-frequency trace is in real kHz. The spectrum shows the exact Bessel sidebands for the main tone. Carson bandwidth = 2 (deviation + modulation frequency).',
    digital: 'Waveform: the carrier is scaled down to 3 cycles per symbol. The constellation runs faster than the waveform so the statistics build up. Noise is simulated (repeatable); the curve is ideal coherent-detection theory. Real systems add error correction, which moves the cliff.',
    mpx: 'Baseband (what the stereo decoder sees after the FM demodulator). In the time view 1 Hz stands for 1 kHz, so the 19 kHz pilot and 38 kHz subcarrier are in true ratio. In stereo IEM systems the 19 kHz pilot also flags stereo; a mono transmitter sends no pilot. Mic receivers are mono: a stereo IEM signal comes out as the mono sum.',
    pre: 'Pre-emphasis boosts the highs before the FM modulator and the receiver\'s de-emphasis undoes it. FM noise rises 6 dB per octave (the noise triangle), so cutting the highs back at the receiver cuts that noise while the programme returns to flat. The price is headroom: the boosted highs reach the deviation limit sooner. Time is scaled down (2 Hz stands for 1 kHz, 17 Hz for 10 kHz); noise in the time view is drawn 25 dB larger than real so you can see it.',
    comp: 'A compander squeezes the programme into a narrower dynamic range before the channel (compressor) and restores it at the receiver (expander), so channel noise is pushed down by the expander when the signal is quiet. Amplitude is drawn on a dB scale so the noise floor is visible. The detector, ratio and time constants here are generic textbook values, not any manufacturer\'s curve, and real wireless-microphone companders are proprietary and do not interoperate with this model.',
    ms: 'General engineering practice, not manufacturer-specific. A stereo IEM mix is split into M (mid) = (L+R)/2 and S (side) = (L-R)/2. M is sent as ordinary baseband (0 to 15 kHz); S is sent on the suppressed 38 kHz subcarrier (23 to 53 kHz) next to the 19 kHz pilot, and both share one deviation budget. The receiver rebuilds L = M + S and R = M - S, so a weak signal that makes S noisy makes the decoder blend toward mono. Time is scaled down; noise is drawn to the SNR shown.',
    tone: 'Analogue mic systems add a continuous ultrasonic tone above the audio before the FM modulator (reported as 32.768 kHz for Shure, medium confidence for Sennheiser). It is NOT the 19 kHz stereo pilot. The receiver opens only when the carrier is strong enough AND the tone is detected, so an interferer without the tone stays muted. All levels here are illustrative.',
  };
  const HELP = {
    am: '',
    fm: 'Confidence: the deviation figures are class values from published specs or assumed (see the table footnote); treat them as illustrative. Wider deviation gives a better SNR above threshold but needs more bandwidth, so the receiver reaches its threshold at a higher input level.',
    digital: 'Digital radio-mic systems have no analogue tone: they use preambles, sync words and addressing so that only the right link unmutes (concept only).',
    mpx: 'Confidence: broadcast FM structure is standard. Stereo IEM examples reported second-hand: Sennheiser SR 2000 pilot about 5 kHz of 24/48 kHz nominal/peak deviation, Shure PSM900 19 kHz with 34 kHz reference deviation. A mic receiver with pilot detection on stays muted on an IEM transmitter (no mic tone); IEM receivers ignore the mic tone. Audio above 15 kHz leaks into the pilot region (distortion, poor stereo image, or a mute); the usual fix is a 16 kHz low-pass on the feed.',
    pre: 'Standard: the RC networks, 50 µs (3.18 kHz corner, EU/UK) and 75 µs (2.12 kHz, US), the noise triangle and a de-emphasis noise gain of about 10 dB (50 µs) and 13 dB (75 µs) over 20 Hz to 15 kHz. Illustrative: the programme level, HF content and the deviation reference (22.5 kHz at 0 dB with a 75 kHz limit, broadcast-style numbers; wireless mics and IEMs use other deviations and their own audio processing).',
    comp: 'Standard: the idea of compress, transmit, expand, with a static law out = ref + (in - ref) / ratio. Illustrative: every number here (ratio, reference, attack, release, the HF weighting corner and boost). Level error from a mismatched expander grows away from the reference level. Noise pumping (breathing) follows the programme envelope because the expander gain tracks the signal.',
    ms: 'Confidence: the M/S split, the 38 kHz subcarrier, the 19 kHz pilot and the 22 dB stereo noise penalty are standard FM stereo practice (the penalty value is the planner\'s MPX model). The source levels, the side compressor and the deviation budget numbers are illustrative.',
    tone: 'Confidence: 32.768 kHz is crystal-derived (high for Shure, medium for Sennheiser), second-hand or manual sources. The tone deviation is not published, so the level slider is illustrative. The detector design is not verified: probably a narrow filter or PLL. In Shure systems the tone amplitude also falls with battery voltage (verified for Shure only). Sennheiser G1 had no tone; later generations do. A transmitter that is muted can drop the tone so the receiver mutes.',
  };

  // ---- actions -------------------------------------------------------------------------------------
  function setMode(m) {
    P.mode = m; for (const k of Object.keys(tabBtns)) tabBtns[k].setAttribute('aria-pressed', String(k === m));
    buildControls(); note.textContent = NOTES[m]; help.textContent = HELP[m]; help.hidden = !HELP[m];
    auxCv.hidden = !AUX.has(m); row.classList.toggle('ml-one', !AUX.has(m)); msx.hidden = !(m === 'ms' || m === 'pre' || m === 'comp'); buildMsExtra();
    cnt.key = ''; buildCompare(); changed(true);
  }
  function changed(force) { host.invalidateAll(); if (P.playing && open) kick(); if (force) { auxHost.invalidate(); } }
  function useScene() {
    try {
      const sc = store.getScene(), link = activeLink(sc, store.getSelection());
      if (!link) { status.textContent = 'No link in the scene.'; return; }
      const r = solveCached(sc, link);
      const cas = r && r.cascade, floor = cas && cas.noiseFloorDbm;
      const cnr = r && Number.isFinite(r.inputPowerDbm) && Number.isFinite(floor) ? r.inputPowerDbm - floor : null;
      const dig = link.modulation && link.modulation.type === 'digital';
      const devOf = (id) => { const q = id ? getFmPreset(id) : null; return q && q.params && Number.isFinite(q.params.deviationKhz) ? { dev: q.params.deviationKhz, label: q.label } : null; };
      const pd = devOf(link.tx && link.tx.fmPreset) || devOf(link.rx && link.rx.rxPreset), presetDev = pd ? pd.dev : null;
      const lab = M.labFromLink({ devKhz: presetDev, kind: link.kind, digital: dig, channelBwKhz: cas && cas.bandwidthKHz, cnrDb: cnr });
      P.sweep = false; syncSweep();
      if (r && Number.isFinite(r.inputPowerDbm)) P.fm.inputDbm = clamp(Math.round(r.inputPowerDbm), -100, -20);
      if (cas && Number.isFinite(cas.systemNfDb)) P.fm.nfDb = cas.systemNfDb;
      if (dig) { P.dig.snr = lab.snrDb; const o = link.modulation.digital && link.modulation.digital.fixedOrder; P.dig.mode = o === 2 ? 'BPSK' : o === 16 ? '16QAM' : 'QPSK'; }
      else P.fm.dev = lab.devKhz;
      if (cnr !== null) { P.mpx.cnr = clamp(Math.round(cnr), 5, 45); P.pre.cnr = P.mpx.cnr; }
      const want = dig ? 'digital' : (P.mode === 'ms' || P.mode === 'pre') ? P.mode : link.kind === 'iem' && link.mpx && link.mpx.enabled && P.mode === 'mpx' ? 'mpx' : P.mode === 'mpx' ? 'mpx' : P.mode === 'digital' || P.mode === 'fm' ? (dig ? 'digital' : 'fm') : 'fm';
      if (want !== P.mode) setMode(want); else { syncInputs(); buildCompare(); changed(); }
      status.textContent = `Pre-set from ${link.name || 'the selected link'}: input ${r ? fmt(r.inputPowerDbm, 1) : '-'} dBm, carrier-to-noise ${cnr === null ? '-' : fmt(cnr, 1)} dB, channel ${fmt(lab.channelKhz, 0)} kHz. ${pd ? `The deviation, +-${fmt(lab.devKhz, 0)} kHz, is the nominal figure of the ${pd.label} preset.` : 'The deviation is an illustrative class value, the scene does not store one.'}`;
    } catch (err) { console.error(err); status.textContent = 'Could not read the scene numbers.'; }
  }
  sceneBtn.addEventListener('click', useScene);
  playBtn.addEventListener('click', () => { P.playing = !P.playing; syncPlay(); if (P.playing) kick(); });
  stepBtn.addEventListener('click', () => { time += 0.25; sweepPhase += 0.25; sweepApply(); host.invalidateAll(); });
  function syncPlay() { playBtn.textContent = P.playing ? 'Pause' : 'Play'; playBtn.setAttribute('aria-pressed', String(!P.playing)); }

  function sweepApply() {
    if (!P.sweep || !P.sweepKey) return;
    const ph = 0.5 - 0.5 * Math.cos((2 * Math.PI * sweepPhase) / (P.mode === 'am' ? 14 : P.mode === 'fm' ? 22 : 26));
    if (P.mode === 'am') P.am.depth = Math.round(ph * 120);
    else if (P.mode === 'fm') P.fm.dev = +(2 + ph * 98).toFixed(1);
    else if (P.mode === 'digital') P.dig.snr = +(-2 + ph * 32).toFixed(1);
    const i = inputs[P.sweepKey]; if (i) { i.input.value = i.obj[i.prop]; i.show(); }
  }

  // ---- compare table (FM) -------------------------------------------------------------------------
  let cmpRows = null;
  function buildCompare() {
    cmp.textContent = ''; cmp.hidden = !(P.mode === 'fm' && P.fm.compare); cmpRows = null;
    if (cmp.hidden) return;
    let rows = [], foot = '';
    try {
      const res = fmDeviationComparison({ inputDbm: P.fm.inputDbm, noiseFigureDb: P.fm.nfDb, includeG3: true, includePSM: true });
      rows = res.systems.map((s) => ({ label: s.label, dev: s.deviationKhz, beta: s.modulationIndex, bw: s.carsonBwKhz, fit: s.fit.find((f) => f.channelKhz === 200) || s.fit[0], imp: s.fmImprovementDb, thr: s.thresholdInputDbm, above: s.aboveThresholdDb, snr: s.audioSnrDb, below: s.belowThreshold, conf: s.confidence }));
      foot = res.assumedFigures && res.assumedFigures.length ? 'Assumed figures: ' + res.assumedFigures.join('; ') + '.' : '';
    } catch (err) {
      rows = M.deviationRows(15).map((r) => ({ label: r.label, dev: r.devKhz, beta: r.beta, bw: r.carsonKhz, fit: { fits: r.fits200, occupancyPct: Math.round(100 * r.carsonKhz / 200) }, imp: r.improvementDb, thr: null, above: null, snr: null }));
      foot = 'Fallback maths: threshold figures not available.';
    }
    cmpRows = rows;
    const tb = el('table', 'ml-table'); tb.append(el('caption', null, `Deviation compare at ${P.fm.inputDbm} dBm input (illustrative)`));
    const head = el('tr'); for (const h of ['System', 'Index', 'Occupied (Carson)', 'In 200 kHz?', 'FM gain', 'Threshold at input', 'Margin over threshold', 'Audio SNR']) head.append(el('th', null, h, { scope: 'col' }));
    const thead = el('thead'); thead.append(head); tb.append(thead);
    const tbody = el('tbody');
    for (const r of rows) {
      const tr = el('tr'); tr.append(el('th', null, r.label, { scope: 'row' }), el('td', null, fmt(r.beta, 2)), el('td', null, `${fmt(r.bw, 0)} kHz`),
        el('td', r.fit.fits ? 'ml-ok' : 'ml-bad', `${r.fit.fits ? 'yes' : 'NO'} (${r.fit.occupancyPct}%)`), el('td', null, `${fmt(r.imp, 1)} dB`),
        el('td', null, r.thr === null || r.thr === undefined ? '-' : `${fmt(r.thr, 1)} dBm`), el('td', r.below ? 'ml-bad' : '', r.above === null || r.above === undefined ? '-' : `${r.above >= 0 ? '+' : ''}${fmt(r.above, 1)} dB${r.below ? ' (below threshold)' : ''}`), el('td', null, r.snr === null || r.snr === undefined ? '-' : `${fmt(r.snr, 1)} dB`));
      tbody.append(tr);
    }
    tb.append(tbody);
    cmp.append(el('p', 'ml-scrollhint', 'Scroll the table sideways to see all columns.'), el('div', 'ml-tablewrap'), el('p', 'ml-foot', `Wider deviation buys a better audio SNR above threshold but needs more bandwidth, and the wider noise bandwidth raises the input level where the receiver reaches threshold. ${foot}`));
    cmp.firstChild.append(tb);
  }

  // ---- drawing helpers ----------------------------------------------------------------------------
  function lane(ctx, th, y0, hh, label, w) {
    ctx.strokeStyle = th.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y0 + hh / 2); ctx.lineTo(w, y0 + hh / 2); ctx.stroke();
    ctx.strokeStyle = th.gridMajor; ctx.beginPath(); ctx.moveTo(0, y0 + hh - 0.5); ctx.lineTo(w, y0 + hh - 0.5); ctx.stroke();
    haloText(ctx, th, label, 6, y0 + 15, { px: 12, color: th.inkSoft });
  }
  function trace(ctx, w, fn, color, lw = 1.5) {
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.beginPath();
    for (let x = 0; x <= w; x += 1) { const y = fn(x); if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
  }
  const tAt = (x, w) => time + (x / w) * WIN;

  // ---- time-domain canvas ----------------------------------------------------------------------------
  function drawTime(ctx, w, h, th) {
    const t0 = performance.now();
    ctx.fillStyle = th.paper; ctx.fillRect(0, 0, w, h);
    const mode = P.mode;
    if (mode === 'am') timeAm(ctx, w, h, th);
    else if (mode === 'fm') timeFm(ctx, w, h, th);
    else if (mode === 'digital') timeDigital(ctx, w, h, th);
    else if (mode === 'mpx') timeMpx(ctx, w, h, th);
    else if (mode === 'ms') timeMs(ctx, w, h, th);
    else if (mode === 'pre') timePre(ctx, w, h, th);
    else if (mode === 'comp') timeComp(ctx, w, h, th);
    else timeTone(ctx, w, h, th);
    if (mode === 'comp') { /* lanes carry their own captions */ } else haloText(ctx, th, mode === 'ms' ? 'time scaled down (illustrative)' : mode === 'pre' ? 'time scaled down (illustrative)' : mode === 'mpx' ? 'time: audio 1 Hz stands for 1 kHz' : mode === 'tone' ? 'time scrolls left, now at the right edge' : 'scaled carrier, time scrolls left', w - 6, h - 6, { align: 'right', px: 12, color: th.inkSoft });
    timeCv.dataset.ms = (performance.now() - t0).toFixed(2);
  }
  function timeAm(ctx, w, h, th) {
    const d = P.am.depth / 100, hh = h / 3, sc = 2.2;
    const over = d > 1;
    lane(ctx, th, 0, hh, 'Audio message', w); lane(ctx, th, hh, hh, `AM signal, depth ${Math.round(d * 100)} %${over ? ' (over-modulated)' : ''}`, w); lane(ctx, th, 2 * hh, hh, 'Envelope detector output', w);
    const yc = (i) => hh * i + hh / 2, A = (hh / 2 - 6);
    trace(ctx, w, (x) => yc(0) - A * M.message(P.msg, tAt(x, w), F0), th.blue, 2);
    // envelope (signed): crossing zero = phase reversal
    for (const sgn of [1, -1]) trace(ctx, w, (x) => yc(1) - sgn * (A / sc) * (1 + d * M.message(P.msg, tAt(x, w), F0)), over ? th.fail : th.inkSoft, 1);
    trace(ctx, w, (x) => yc(1) + 4 - (A / sc) * M.amSample(P.msg, tAt(x, w), d, FC, F0), th.ink, 1.2);
    // detector output vs ideal
    ctx.setLineDash([4, 3]); trace(ctx, w, (x) => yc(2) - A * M.message(P.msg, tAt(x, w), F0) * 0.9, th.inkSoft, 1); ctx.setLineDash([]);
    trace(ctx, w, (x) => { const t = tAt(x, w); const env = M.amEnvelope(P.msg, t, d, F0); return yc(2) - A * 0.9 * clamp((env - 1) / Math.max(d, 0.3), -1.3, 1.3); }, over ? th.fail : th.pass, 2);
    if (over) haloText(ctx, th, `distortion: ${(M.amDistortion(P.msg, d, F0) * 100).toFixed(0)} % RMS error`, w - 6, 2 * hh + 15, { align: 'right', px: 12, color: th.fail });
  }
  function timeFm(ctx, w, h, th) {
    const hh = h / 3, dev = P.fm.dev, sq = M.fmSqueeze(dev), A = hh / 2 - 6, A2 = A * 0.78;
    lane(ctx, th, 0, hh, 'Audio message', w); lane(ctx, th, hh, hh, 'FM signal (displayed carrier scaled down)', w); lane(ctx, th, 2 * hh, hh, 'Instantaneous frequency (real kHz)', w);
    trace(ctx, w, (x) => hh / 2 - A * M.message(P.msg, tAt(x, w), F0), th.blue, 2);
    trace(ctx, w, (x) => hh * 1.5 + 4 - A2 * M.fmSample(P.msg, tAt(x, w), FC, sq, F0), th.ink, 1.2);
    // instantaneous frequency lane with preset markers
    const y2 = 2 * hh + hh / 2, S = (hh / 2 - 8) / 100;
    for (const kk of [40, 75]) { ctx.setLineDash([3, 4]); ctx.strokeStyle = th.grid; ctx.beginPath(); for (const sgn of [1, -1]) { ctx.moveTo(0, y2 - sgn * kk * S); ctx.lineTo(w, y2 - sgn * kk * S); } ctx.stroke(); }
    ctx.setLineDash([]); haloText(ctx, th, '+75', w - 4, y2 - 75 * S - 2, { align: 'right', px: 11, color: th.inkSoft }); haloText(ctx, th, '+40', w - 4, y2 - 40 * S - 2, { align: 'right', px: 11, color: th.inkSoft });
    trace(ctx, w, (x) => y2 - S * M.fmInstFreqKhz(P.msg, tAt(x, w), dev, F0), th.blue, 2);
    haloText(ctx, th, 'carrier centre (real: hundreds of MHz)', 6, y2 + 14, { px: 11, color: th.inkSoft });
  }
  function timeDigital(ctx, w, h, th) {
    const m = P.dig.mode, bps = M.bitsPerSymbol(m), hh = [h * 0.34, h * 0.66];
    lane(ctx, th, 0, hh[0], 'Bit stream and symbol clock', w); lane(ctx, th, hh[0], hh[1], `${m === '16QAM' ? '16-QAM' : m} signal (carrier scaled: 3 cycles per symbol)`, w);
    const ts = (x) => time * SYM_RATE + (x / w) * 8; // 8 symbols across
    const pw = w / 8;
    ctx.font = `600 13px ${th.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const k0 = Math.floor(ts(0));
    for (let k = k0; k <= k0 + 9; k++) {
      const x = ((k - ts(0)) / 8) * w;
      ctx.strokeStyle = th.gridMajor; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, h - 2); ctx.stroke(); ctx.setLineDash([]);
      if (x + pw > 0 && x < w) { const idx = M.symbolAt(m, k); ctx.fillStyle = th.ink; ctx.fillText(M.symbolBits(m, idx), x + pw / 2, hh[0] * 0.55); }
      // clock: high in the first half of each symbol
      ctx.strokeStyle = th.inkSoft; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, hh[0] - 6); ctx.lineTo(x, hh[0] - 14); ctx.lineTo(x + pw / 2, hh[0] - 14); ctx.lineTo(x + pw / 2, hh[0] - 6); ctx.lineTo(x + pw, hh[0] - 6); ctx.stroke();
    }
    const yc = hh[0] + hh[1] / 2, A = hh[1] / 2 - 10, sc = m === 'ASK' ? 1.41 : m === '16QAM' ? 1.4 : m === 'QPSK' ? 1.15 : 1;
    trace(ctx, w, (x) => yc - (A / (sc * 1.0)) * M.digitalSample(m, ts(x), 3) * (m === 'ASK' ? 0.7 : 1), th.ink, 1.4);
    haloText(ctx, th, `${bps} bit${bps > 1 ? 's' : ''} per symbol`, w - 6, hh[0] + 15, { align: 'right', px: 12, color: th.inkSoft });
  }
  function timeMpx(ctx, w, h, th) {
    const hh = h / 3, A = hh / 2 - 6, pr = P.mpx.programme;
    const l = pr === 'right' ? 0 : 1, r = pr === 'left' ? 0 : pr === 'mono' ? 1 : 0.7, fl = 1, fr = pr === 'mono' ? 1 : 1.37;
    const blend = mpxBlend(), W2 = 2, tt = (x) => time + (x / w) * W2;
    lane(ctx, th, 0, hh, 'Left audio', w); lane(ctx, th, hh, hh, 'Right audio', w); lane(ctx, th, 2 * hh, hh, 'Composite (baseband) before the FM modulator', w);
    trace(ctx, w, (x) => hh / 2 - A * l * Math.sin(2 * Math.PI * fl * tt(x)), th.blue, 2);
    trace(ctx, w, (x) => hh * 1.5 - A * r * Math.sin(2 * Math.PI * fr * tt(x)), th.mono || th.inkSoft, 2);
    trace(ctx, w, (x) => hh * 2.5 - A * 1.4 * M.mpxComposite(tt(x), { l, r, fl, fr, pilot: pilotLocked, lrScale: blend, rds: P.mpx.rds }), th.ink, 1);
  }
  function timeTone(ctx, w, h, th) {
    const hh = h / 3, A = hh / 2 - 6, sc = P.tone.scenario;
    lane(ctx, th, 0, hh, 'Carrier at the receiver (level)', w); lane(ctx, th, hh, hh, `Tone-key detector (${fmt(P.tone.khz, 3)} kHz) and threshold`, w); lane(ctx, th, 2 * hh, hh, 'Receiver audio out', w);
    let prev = false; const xs = [];
    for (let x = 0; x <= w; x += 2) { const t = time - WIN + (x / w) * WIN, inp = M.gateInputs(sc, t); prev = M.gateOpen(inp, prev); xs.push([x, inp, prev, M.noiseSquelchOpen(inp)]); }
    // lane 1: rf level area
    ctx.fillStyle = inkAlpha(th, 0.16); ctx.beginPath(); ctx.moveTo(0, hh - 4); for (const [x, i] of xs) ctx.lineTo(x, hh - 4 - (hh - 34) * i.rf); ctx.lineTo(w, hh - 4); ctx.fill();
    ctx.setLineDash([4, 3]); ctx.strokeStyle = th.inkSoft; ctx.beginPath(); ctx.moveTo(0, hh - 4 - (hh - 34) * 0.3); ctx.lineTo(w, hh - 4 - (hh - 34) * 0.3); ctx.stroke(); ctx.setLineDash([]);
    haloText(ctx, th, 'noise-squelch threshold', w - 6, hh - 4 - (hh - 34) * 0.3 - 3, { align: 'right', px: 11, color: th.inkSoft });
    // lane 2: tone detector level
    ctx.strokeStyle = th.blue; ctx.lineWidth = 2; ctx.beginPath(); xs.forEach(([x, i], n) => { const y = 2 * hh - 4 - (hh - 34) * i.tone; if (n === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke();
    ctx.setLineDash([4, 3]); ctx.strokeStyle = th.inkSoft; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 2 * hh - 4 - (hh - 34) * 0.5); ctx.lineTo(w, 2 * hh - 4 - (hh - 34) * 0.5); ctx.stroke(); ctx.setLineDash([]);
    haloText(ctx, th, 'tone threshold', w - 6, 2 * hh - 4 - (hh - 34) * 0.5 - 3, { align: 'right', px: 11, color: th.inkSoft });
    // lane 3: audio only while the gate is open; shaded when a plain noise squelch would have opened
    const yc = 2.5 * hh;
    for (let n = 0; n < xs.length - 1; n++) { const [x, , open2, ns] = xs[n]; if (ns && !open2) { ctx.fillStyle = `${th.fail}33`; ctx.fillRect(x, 2 * hh + 2, 2, hh - 4); } }
    ctx.strokeStyle = th.pass; ctx.lineWidth = 1.6; ctx.beginPath();
    xs.forEach(([x, i, op], n) => { const y = yc - (op ? A * 0.8 * Math.sin(2 * Math.PI * 1.5 * (time - WIN + (x / w) * WIN)) * (0.6 + 0.4 * Math.sin(1.1 * (time + x / w))) : 0); if (n === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
    const now = xs[xs.length - 1]; gateOpenNow = now[2];
    const msg = now[2] ? 'GATE OPEN' : now[1].tone < 0.5 && now[1].rf >= 0.3 ? 'MUTED: carrier but no tone' : 'MUTED: carrier too weak';
    haloText(ctx, th, msg, w - 6, 2 * hh + 16, { align: 'right', px: 13, weight: '600', color: now[2] ? th.pass : th.fail });
    if (now[3] && !now[2]) haloText(ctx, th, 'a plain noise squelch would have opened here (shaded)', 6, 3 * hh - 6, { px: 11, color: th.fail });
  }

  // ---- spectrum canvas ----------------------------------------------------------------------------
  function axes(ctx, th, w, h, x0, x1, unit, L = 44, B = 40, T = 8) {
    const pw = w - L - 10, ph = h - B - T, X = (v) => L + ((v - x0) / (x1 - x0)) * pw;
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, T + ph + 0.5); ctx.lineTo(L + pw, T + ph + 0.5); ctx.stroke();
    const step = niceStep(x1 - x0, w < 420 ? 4 : 8);
    setFont(ctx, th, 12); ctx.fillStyle = th.inkSoft; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    for (let v = Math.ceil(x0 / step) * step; v <= x1 + 1e-9; v += step) { const x = X(v); ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke(); ctx.fillText(fmtKhz(v), x, T + ph + 16); }
    ctx.textAlign = 'right'; ctx.fillText(unit, w - 6, h - 6);
    return { X, L, T, pw, ph, Y0: T + ph };
  }
  function drawSpec(ctx, w, h, th) {
    const t0 = performance.now();
    ctx.fillStyle = th.paper; ctx.fillRect(0, 0, w, h);
    if (P.mode === 'am') specAm(ctx, w, h, th);
    else if (P.mode === 'fm') specFm(ctx, w, h, th);
    else if (P.mode === 'digital') specDigital(ctx, w, h, th);
    else if (P.mode === 'mpx') specMpx(ctx, w, h, th);
    else if (P.mode === 'ms') specMs(ctx, w, h, th);
    else if (P.mode === 'pre') specPre(ctx, w, h, th);
    else if (P.mode === 'comp') specComp(ctx, w, h, th);
    else specTone(ctx, w, h, th);
    specCv.dataset.ms = (performance.now() - t0).toFixed(2);
  }
  function stem(ctx, a, x, amp, color, lw = 2) { const y = a.Y0 - amp * a.ph * 0.9; ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(x, a.Y0); ctx.lineTo(x, y); ctx.stroke(); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill(); }
  function bracket(ctx, th, a, k0, k1, y, color, label) {
    const xa = a.X(k0), xb = a.X(k1); ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(xa, y - 4); ctx.lineTo(xa, y + 4); ctx.moveTo(xa, y); ctx.lineTo(xb, y); ctx.moveTo(xb, y - 4); ctx.lineTo(xb, y + 4); ctx.stroke();
    if (label) haloText(ctx, th, label, (xa + xb) / 2, y - 6, { align: 'center', px: 12, color });
  }
  function specAm(ctx, w, h, th) {
    const d = P.am.depth / 100, fm = P.am.fm, bw = M.amBandwidthKhz(P.msg, fm), span = Math.max(8, bw * 0.75);
    const a = axes(ctx, th, w, h, -span, span, 'kHz from the carrier');
    for (const l of M.amSpectrum(P.msg, d, fm)) stem(ctx, a, a.X(l.khz), l.amp, l.kind === 'carrier' ? th.ink : th.blue);
    bracket(ctx, th, a, -bw / 2, bw / 2, a.T + 12, th.ink, `AM occupies ${fmt(bw, 1)} kHz (twice the top audio frequency)`);
    haloText(ctx, th, 'relative amplitude', 6, 14, { px: 11, color: th.inkSoft });
    haloText(ctx, th, `A 200 kHz channel is ${fmt(200 / bw, 0)} times wider than this.`, a.L + 6, a.Y0 - 6, { px: 12, color: th.inkSoft });
  }
  function specFm(ctx, w, h, th) {
    const dev = P.fm.dev, fm = P.fm.fm, beta = M.modIndex(dev, fm), bw = M.carsonBwKhz(dev, fm), cmpOn = P.fm.compare;
    const top = cmpOn ? 5 * 17 + 18 : 30;
    const a = axes(ctx, th, w, h, -150, 150, 'kHz from the carrier', 44, 40, top);
    // channel
    ctx.fillStyle = inkAlpha(th, 0.05); ctx.fillRect(a.X(-100), a.T, a.X(100) - a.X(-100), a.ph);
    ctx.setLineDash([5, 4]); ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.beginPath(); for (const s of [-100, 100]) { ctx.moveTo(a.X(s), 4); ctx.lineTo(a.X(s), a.Y0); } ctx.stroke(); ctx.setLineDash([]);
    haloText(ctx, th, '200 kHz channel', a.X(-100) + 4, a.Y0 - 6, { align: 'left', px: 12, color: th.inkSoft });
    const fit = M.channelFit(bw); const col = fit.status === 'pass' ? th.pass : fit.status === 'marginal' ? th.marginal : th.fail;
    const lines = M.fmSpectrum(beta, fm, { maxLines: 150 });
    for (const l of lines) if (Math.abs(l.khz) <= 150) stem(ctx, a, a.X(l.khz), l.amp, l.n === 0 || l.kind === 'carrier' ? th.ink : th.blue, w < 420 ? 1.5 : 2);
    // carrier-null marker
    const nearNull = Math.abs(beta - M.BESSEL_NULL) < 0.12;
    if (nearNull) haloText(ctx, th, 'carrier null (index 2.405)', a.X(0) + 8, a.T + top / 2 + 30, { px: 12, weight: '600', color: th.fail });
    bracket(ctx, th, a, -bw / 2, bw / 2, 24, col, `Carson ${fmt(bw, 0)} kHz = 2 x (${fmt(dev, 1)} + ${fmt(fm, 1)})   ${fit.pct}% of the channel`);
    if (cmpOn && cmpRows) cmpRows.forEach((r, i) => { const c2 = r.fit.fits ? th.pass : th.fail; bracket(ctx, th, a, -r.bw / 2, r.bw / 2, 24 + (i + 1) * 17, c2, null); haloText(ctx, th, `${r.label.replace(/^.*\(/, '(').replace(/\)$/, ')')} ${fmt(r.bw, 0)} kHz`, w - 8, 24 + (i + 1) * 17 + 4, { align: 'right', px: 11, color: c2 }); });
    haloText(ctx, th, `index ${fmt(beta, 2)}   carrier ${fmt(Math.abs(M.besselJ(0, beta)), 2)}`, a.L + 6, a.T + top - 2 + 14, { px: 12, color: th.inkSoft });
  }
  function specDigital(ctx, w, h, th) {
    const m = P.dig.mode, R = P.dig.rate, bw = M.digitalBwKhz(m, R), span = Math.max(100, Math.ceil((bw * 0.8) / 50) * 50 + 50);
    const a = axes(ctx, th, w, h, -span, span, 'kHz from the carrier');
    const Y = (db) => a.T + (-db / 50) * a.ph;
    ctx.fillStyle = inkAlpha(th, 0.05); ctx.fillRect(a.X(-100), a.T, a.X(100) - a.X(-100), a.ph);
    ctx.setLineDash([5, 4]); ctx.strokeStyle = th.ink; ctx.beginPath(); for (const s of [-100, 100]) { ctx.moveTo(a.X(s), 4); ctx.lineTo(a.X(s), a.Y0); } ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = th.blue; ctx.lineWidth = 2; ctx.beginPath();
    for (let x = a.L; x <= a.L + a.pw; x += 1) { const k = -span + ((x - a.L) / a.pw) * 2 * span, y = clamp(Y(M.digitalSpectrumDb(m, k, R)), a.T, a.Y0); if (x === a.L) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
    const fit = M.channelFit(bw), col = fit.status === 'pass' ? th.pass : fit.status === 'marginal' ? th.marginal : th.fail;
    bracket(ctx, th, a, -bw / 2, bw / 2, 16, col, `main lobe ${fmt(bw, 0)} kHz, ${fit.pct}% of 200 kHz`);
    haloText(ctx, th, 'dB below peak: 0 at top, -50 at the axis', 6, 14, { px: 11, color: th.inkSoft });
  }
  function mpxBlend() { const cnr = P.mpx.cnr, st = pilotStep(pilotLocked, cnr); pilotLocked = st.locked; const diff = P.mpx.programme === 'stereo' || P.mpx.programme === 'left' || P.mpx.programme === 'right' ? 1 : 0; return pilotLocked ? stereoBlend(cnr) * diff : 0; }
  function specMpx(ctx, w, h, th) {
    const blend = mpxBlend(), a = axes(ctx, th, w, h, 0, 64, 'kHz (baseband)', 44, 40, 18), FL = -60;
    const Y = (db) => a.T + (clamp(db, FL, 0) / FL) * a.ph;
    // FM noise: triangular, rising with frequency
    const nz = (f) => -(P.mpx.cnr + 8) + 20 * Math.log10(Math.max(f, 0.5) / 15);
    ctx.fillStyle = `${th.fail}22`; ctx.beginPath(); ctx.moveTo(a.X(0), a.Y0); for (let f = 0; f <= 64; f += 1) ctx.lineTo(a.X(f), Y(nz(f))); ctx.lineTo(a.X(64), a.Y0); ctx.fill();
    const bands = M.mpxBands({ pilot: pilotLocked, lrScale: blend, rds: P.mpx.rds, leak: P.mpx.leak });
    for (const b of bands) {
      if (b.id === 'leak') { const db = P.mpx.lp16 ? b.db - 40 : b.db; ctx.fillStyle = `${th.marginal}88`; ctx.fillRect(a.X(b.f0), Y(db), a.X(b.f1) - a.X(b.f0), a.Y0 - Y(db)); haloText(ctx, th, P.mpx.lp16 ? 'console 17-20 kHz (filtered)' : 'console 17-20 kHz', a.X(18.5), Y(db) - 4, { align: 'center', px: 11, color: th.warnText }); continue; }
      if (b.kind === 'null') { ctx.setLineDash([3, 3]); ctx.strokeStyle = th.inkSoft; ctx.beginPath(); ctx.moveTo(a.X(38), a.T + 22); ctx.lineTo(a.X(38), a.Y0); ctx.stroke(); ctx.setLineDash([]); haloText(ctx, th, '38 kHz suppressed', a.X(38) + 4, a.Y0 - 30, { px: 11, color: th.inkSoft }); continue; }
      if (b.db <= -100) continue;
      const col = b.id === 'lmr' ? th.blue : b.id === 'lpr' ? th.ink : b.id === 'rds' ? th.mono || th.inkSoft : th.pass;
      if (b.kind === 'line') { ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a.X(b.f0), a.Y0); ctx.lineTo(a.X(b.f0), Y(b.db)); ctx.stroke(); haloText(ctx, th, '19 kHz pilot', a.X(19), Y(b.db) - 5, { align: 'center', px: 12, color: th.pass }); }
      else { ctx.fillStyle = `${col}55`; ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.fillRect(a.X(b.f0), Y(b.db), a.X(b.f1) - a.X(b.f0), a.Y0 - Y(b.db)); ctx.strokeRect(a.X(b.f0), Y(b.db), a.X(b.f1) - a.X(b.f0), a.Y0 - Y(b.db)); haloText(ctx, th, b.label, (a.X(b.f0) + a.X(b.f1)) / 2, Y(b.db) - 4, { align: 'center', px: 12, color: col }); }
    }
    if (!pilotLocked) haloText(ctx, th, 'pilot lost: decoder forced to mono', a.X(19), a.Y0 - 8, { align: 'center', px: 12, weight: '600', color: th.fail });
    if (P.mpx.leak && !P.mpx.lp16) haloText(ctx, th, 'content next to the 19 kHz pilot disturbs it', a.X(32), a.T + 38, { align: 'center', px: 12, color: th.warnText });
    if (P.mpx.lp16) { ctx.strokeStyle = th.pass; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(a.X(16), a.T + 4); ctx.lineTo(a.X(16), a.Y0); ctx.stroke(); ctx.setLineDash([]); haloText(ctx, th, '16 kHz low-pass', a.X(16), a.T + 14, { align: 'center', px: 11, color: th.pass }); }
    haloText(ctx, th, 'FM noise rises with frequency', a.X(0.5), a.Y0 - 6, { align: 'left', px: 11, color: th.fail });
    mpxCaption = `${mpxMode(blend)}`;
  }
  let mpxCaption = '';
  const mpxMode = (b) => (!pilotLocked ? 'MONO (no pilot)' : b > 0.98 ? 'STEREO' : b < 0.02 ? 'MONO' : `BLEND ${Math.round(b * 100)}%`);
  function specTone(ctx, w, h, th) {
    const sc = P.tone.scenario, kHz = P.tone.khz, a = axes(ctx, th, w, h, 0, 64, 'kHz (audio plus tone, before the FM modulator)', 44, 40, 18), FL = -60;
    const Y = (db) => a.T + (clamp(db, FL, 0) / FL) * a.ph;
    const t = M.gateInputs(sc, time), isIem = sc === 'iem', isInt = sc === 'interferer';
    const audioCol = isInt ? th.fail : th.blue;
    ctx.fillStyle = `${audioCol}44`; ctx.strokeStyle = audioCol; ctx.lineWidth = 1.5; ctx.fillRect(a.X(0.05), Y(-12), a.X(15) - a.X(0.05), a.Y0 - Y(-12)); ctx.strokeRect(a.X(0.05), Y(-12), a.X(15) - a.X(0.05), a.Y0 - Y(-12));
    haloText(ctx, th, isInt ? 'interferer audio' : 'audio 50 Hz - 15 kHz', a.X(7.5), Y(-12) - 4, { align: 'center', px: 12, color: audioCol });
    // the stereo pilot marker: a different thing
    ctx.setLineDash([2, 4]); ctx.strokeStyle = th.inkSoft; ctx.beginPath(); ctx.moveTo(a.X(19), a.T + 36); ctx.lineTo(a.X(19), a.Y0); ctx.stroke(); ctx.setLineDash([]);
    haloText(ctx, th, '19 kHz = stereo pilot (a different thing)', a.X(19) + 4, a.T + 32, { px: 11, color: th.inkSoft });
    if (isIem) { // IEM: stereo MPX, 19 kHz pilot and L-R sidebands; no 32.768 kHz
      ctx.strokeStyle = th.pass; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a.X(19), a.Y0); ctx.lineTo(a.X(19), Y(-21)); ctx.stroke();
      ctx.fillStyle = `${th.blue}44`; ctx.fillRect(a.X(23), Y(-18), a.X(53) - a.X(23), a.Y0 - Y(-18));
      haloText(ctx, th, 'IEM L-R', a.X(38), Y(-18) - 4, { align: 'center', px: 12, color: th.blue });
    }
    // tone line
    const lv = 20 * Math.log10(P.tone.devPct / 100) - 6 + 20 * Math.log10(Math.max(0.02, t.tone));
    if (t.tone >= 0.05) { ctx.strokeStyle = th.pass; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a.X(kHz), a.Y0); ctx.lineTo(a.X(kHz), Y(lv)); ctx.stroke(); ctx.fillStyle = th.pass; ctx.beginPath(); ctx.arc(a.X(kHz), Y(lv), 3, 0, 7); ctx.fill(); haloText(ctx, th, `tone-key ${fmt(kHz, 3)} kHz`, a.X(kHz) + 6, Y(lv) - 6, { px: 12, weight: '600', color: th.pass }); }
    else haloText(ctx, th, `no ${fmt(kHz, 3)} kHz tone`, a.X(kHz), a.Y0 - 10, { align: 'center', px: 12, weight: '600', color: th.fail });
    // detector window
    ctx.fillStyle = `${th.marginal}33`; ctx.strokeStyle = th.marginal; ctx.lineWidth = 1; ctx.fillRect(a.X(kHz - 1.2), a.T + 44, a.X(kHz + 1.2) - a.X(kHz - 1.2), a.Y0 - a.T - 44); ctx.strokeRect(a.X(kHz - 1.2), a.T + 44, a.X(kHz + 1.2) - a.X(kHz - 1.2), a.Y0 - a.T - 44);
    haloText(ctx, th, 'detector window', a.X(kHz) + 4, a.T + 58, { px: 11, color: th.warnText });
    haloText(ctx, th, 'levels are illustrative', 6, 14, { px: 11, color: th.inkSoft });
  }

  // ---- aux canvas: constellation + BER curve (digital) ----------------------------------------------------
  function drawAux(ctx, w, h, th) {
    ctx.fillStyle = th.paper; ctx.fillRect(0, 0, w, h);
    if (P.mode === 'ms') { auxMs(ctx, w, h, th); return; }
    if (P.mode === 'pre') { auxPre(ctx, w, h, th); return; }
    if (P.mode === 'comp') { auxComp(ctx, w, h, th); return; }
    if (P.mode !== 'digital') return;
    const m = P.dig.mode, snr = P.dig.snr, pts = M.constellation(m), stack = w < 520;
    const cs = stack ? Math.min(w - 20, h * 0.56) : Math.min(h - 16, w * 0.5), cx0 = stack ? w / 2 : 8 + cs / 2, cy0 = stack ? 8 + cs / 2 : h / 2;
    const sc = (cs / 2) * 0.72;
    ctx.strokeStyle = th.gridMajor; ctx.lineWidth = 1; ctx.strokeRect(cx0 - cs / 2, cy0 - cs / 2, cs, cs); ctx.save(); ctx.beginPath(); ctx.rect(cx0 - cs / 2, cy0 - cs / 2, cs, cs); ctx.clip();
    ctx.beginPath(); ctx.moveTo(cx0 - cs / 2, cy0); ctx.lineTo(cx0 + cs / 2, cy0); ctx.moveTo(cx0, cy0 - cs / 2); ctx.lineTo(cx0, cy0 + cs / 2); ctx.stroke();
    haloText(ctx, th, 'I', cx0 + cs / 2 - 4, cy0 - 4, { align: 'right', px: 11, color: th.inkSoft }); haloText(ctx, th, 'Q', cx0 + 4, cy0 - cs / 2 + 12, { px: 11, color: th.inkSoft });
    const kNow = Math.floor(time * CONS_RATE), frac = time * CONS_RATE - kNow;
    cnt.n = 300; cnt.e = M.symbolErrors(m, kNow - 299, 300, snr); // sliding window, so it follows the SNR slider and the sweep
    const P2 = (p) => [cx0 + p[0] * sc, cy0 - p[1] * sc];
    for (let k = kNow - 120; k < kNow; k++) { const s = M.receiveSymbol(m, k, snr), q = P2(s.rx); ctx.fillStyle = s.error ? th.fail : `${th.blue}88`; ctx.beginPath(); ctx.arc(q[0], q[1], s.error ? 3 : 2.2, 0, 7); ctx.fill(); }
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1.5; for (const p of pts) { const q = P2(p); ctx.beginPath(); ctx.arc(q[0], q[1], 5, 0, 7); ctx.stroke(); }
    // the moving point: slides from the previous received point to the current one
    const prev = M.receiveSymbol(m, kNow - 1, snr), cur = M.receiveSymbol(m, kNow, snr), e = frac * frac * (3 - 2 * frac);
    const mp = P2([prev.rx[0] + (cur.rx[0] - prev.rx[0]) * e, prev.rx[1] + (cur.rx[1] - prev.rx[1]) * e]);
    ctx.fillStyle = th.ink; ctx.beginPath(); ctx.arc(mp[0], mp[1], 5.5, 0, 7); ctx.fill(); ctx.strokeStyle = th.paper; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
    const ser = cnt.n ? cnt.e / cnt.n : 0;
    haloText(ctx, th, `symbol errors ${cnt.e} in the last ${cnt.n}`, stack ? 8 : cx0 - cs / 2, stack ? h - 6 : h - 6, { px: 12, weight: '600', color: ser > 0.01 ? th.fail : th.pass });
    // BER curve
    const bx0 = stack ? 46 : cx0 + cs / 2 + 46, bx1 = w - 12, by0 = stack ? cy0 + cs / 2 + 22 : 22, by1 = stack ? h - 30 : h - 34;
    if (bx1 - bx0 < 60 || by1 - by0 < 50) return;
    const BX = (s) => bx0 + ((s + 5) / 40) * (bx1 - bx0), BY = (b) => by0 + ((-Math.log10(Math.max(b, 1e-6))) / 6) * (by1 - by0);
    ctx.strokeStyle = th.grid; ctx.lineWidth = 1; setFont(ctx, th, 11); ctx.fillStyle = th.inkSoft; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let e2 = 0; e2 <= 6; e2 += 2) { ctx.beginPath(); ctx.moveTo(bx0, BY(Math.pow(10, -e2))); ctx.lineTo(bx1, BY(Math.pow(10, -e2))); ctx.stroke(); ctx.fillText(e2 === 0 ? '1' : `1e-${e2}`, bx0 - 4, BY(Math.pow(10, -e2))); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; for (let s = 0; s <= 35; s += 10) ctx.fillText(String(s), BX(s), by1 + 14);
    haloText(ctx, th, 'BER versus SNR (dB), ideal curves', (bx0 + bx1) / 2, by0 - 8, { align: 'center', px: 11, color: th.inkSoft });
    for (const mm of M.DIGITAL_MODES) { ctx.strokeStyle = mm === m ? th.ink : th.gridMajor; ctx.lineWidth = mm === m ? 2.2 : 1; ctx.beginPath(); for (let s = -5; s <= 35; s += 0.5) { const x = BX(s), y = BY(M.theoryBer(mm, s)); if (s === -5) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke(); }
    const cliff = M.snrForBer(m, 1e-3); ctx.setLineDash([4, 3]); ctx.strokeStyle = th.fail; ctx.beginPath(); ctx.moveTo(BX(cliff), by0); ctx.lineTo(BX(cliff), by1); ctx.stroke(); ctx.setLineDash([]);
    haloText(ctx, th, `BER 1e-3 at ${fmt(cliff, 1)} dB`, BX(cliff) + 4, by0 + 12, { px: 11, color: th.fail });
    const mx = BX(clamp(snr, -5, 35)), my = BY(M.theoryBer(m, snr)); ctx.fillStyle = snr >= cliff ? th.pass : th.fail; ctx.beginPath(); ctx.arc(mx, my, 5, 0, 7); ctx.fill();
    haloText(ctx, th, `BER ${M.theoryBer(m, snr).toExponential(1)}`, clamp(mx + 8, bx0, bx1 - 70), clamp(my - 8, by0 + 24, by1), { px: 11, color: th.ink });
  }


  // ---- Mid/Side (IEM) ---------------------------------------------------------------------------------
  let msKey = '', msPk = null, msStatus = '';
  const msP = () => ({ srcs: P.ms.srcs, hp: +P.ms.hp, width: P.ms.width / 100, boost: P.ms.boost, limit: P.ms.limit / 100 });
  function msPeaksNow() { const k = JSON.stringify([P.ms]); if (k !== msKey) { msKey = k; msPk = M.msPeaks(msP()); } return msPk; }
  function msBudget() { const pk = msPeaksNow(); const leak = P.mpx.leak && !P.mpx.lp16 ? 0.08 : 0; return M.compositeBudget({ compPk: pk.compPk, mPk: pk.mPk, sPk: pk.sPk, pilot: pilotLocked ? M.PILOT_FRACTION : 0, leak }); }
  function msNoiseNow() { const st = pilotStep(pilotLocked, P.mpx.cnr); pilotLocked = st.locked; return M.msNoise(P.mpx.cnr, pilotLocked); }
  const msBlendEff = (nz) => (P.ms.mono ? 0 : nz.blend);
  function msDescribe() {
    const nz = msNoiseNow(), b = msBudget(), pk = msPeaksNow(), mono = M.msSourceMono(msP()), worst = mono.reduce((a, x) => (x.lossDb < a.lossDb ? x : a), { lossDb: 1 });
    msStatus = `${b.over ? 'OVER-DEVIATION. ' : ''}${P.ms.mono ? 'Mono check on. ' : ''}${nz.blend > 0.98 ? 'Stereo' : nz.blend < 0.02 ? 'Mono (blended)' : 'Blend ' + Math.round(nz.blend * 100) + '%'}`;
    return `Mid/side demo. Deviation budget ${Math.round(b.total * 100)} percent of the limit${b.over ? ', over-deviation' : ''}: M ${Math.round(b.mPart * 100)}, pilot ${Math.round(b.pilot * 100)}, S ${Math.round(b.sPart * 100)} percent. Carrier-to-noise ${P.mpx.cnr} dB: ${nz.blend > 0.98 ? 'stereo' : nz.blend < 0.02 ? 'blended to mono' : 'partly blended'}; left and right SNR ${fmt(nz.lrSnr, 1)} dB against ${fmt(nz.monoSnr, 1)} dB mono, and the S channel alone ${fmt(nz.sSnr, 1)} dB. In mono the ${worst.label ? worst.label.toLowerCase() : 'mix'} loses ${Number.isFinite(worst.lossDb) ? fmt(-worst.lossDb, 1) + ' dB' : 'everything'}. Side processing: high-pass ${P.ms.hp ? P.ms.hp + ' Hz' : 'off'}, width ${P.ms.width} percent, boost ${P.ms.boost} dB.`;
  }
  function buildMsExtra() {
    msx.textContent = '';
    if (P.mode === 'pre') {
      const box = el('div', 'ml-tips'); box.append(el('h3', null, 'A broadcast-style audio chain (generic)'));
      const ol = el('ol'); for (const st of AP.broadcastAudioChain()) { const li = el('li'); li.append(el('strong', null, st.label + ': '), doc.createTextNode(st.explain)); ol.append(li); }
      box.append(ol); msx.append(box); return;
    }
    if (P.mode === 'comp') {
      const box = el('div', 'ml-tips'); box.append(el('h3', null, 'What to look for'));
      const ul = el('ul'); for (const t of ['Compressor and expander are mirror images: the combined line is straight, so the programme comes back unchanged.', 'Channel noise is only reduced where the expander is turned down, i.e. at low signal levels. Loud passages mask the noise; quiet ones are cleaned up.', 'Because the expander gain follows the signal, the noise floor rises and falls with the programme: breathing or pumping, most obvious on decays and with long release times.', 'A mismatched expander gives a level error that grows away from the reference level: the programme is too loud or too quiet, and gets squeezed or stretched.', 'Real wireless-microphone companders are proprietary: only a matched transmitter and receiver are meant to work together.']) ul.append(el('li', null, t));
      box.append(ul); msx.append(box); return;
    }
    if (P.mode !== 'ms') return;
    const mono = M.msSourceMono(msP());
    const tb = el('table', 'ml-table'); tb.append(el('caption', null, P.ms.mono ? 'Check in mono: what disappears when L and R are summed' : 'Mono safety: level change of each source when L and R are summed'));
    const th = el('thead'), hr = el('tr'); for (const h of ['Source', 'Change in mono']) hr.append(el('th', null, h, { scope: 'col' })); th.append(hr); tb.append(th);
    const bd = el('tbody');
    for (const r of mono) { const tr = el('tr'); const bad = r.lossDb < -6; tr.append(el('th', null, r.label, { scope: 'row' }), el('td', bad ? 'ml-bad' : r.lossDb < -0.5 ? '' : 'ml-ok', Number.isFinite(r.lossDb) ? `${fmt(r.lossDb, 1)} dB${bad ? ' (mostly out of phase)' : ''}` : 'disappears')); bd.append(tr); }
    tb.append(bd);
    const w = el('div', 'ml-tablewrap'); w.append(tb);
    const tips = el('div', 'ml-tips'); tips.append(el('h3', null, 'Tips (general engineering practice, not manufacturer-specific)'));
    const ul = el('ul');
    for (const t of ['High-pass the side channel around 100 to 150 Hz: out-of-phase bass uses deviation and vanishes in mono.', 'Keep side dynamics gentle: a light compressor on S protects the shared deviation budget.', 'Narrow the highs at range: S noise is worst at high frequencies, so reduce the width when the signal is weak.', 'Do not boost side highs: it adds to the deviation and to the S noise.', 'Keep content below 15 kHz: material near 19 kHz disturbs the pilot.', 'Check in mono, especially at the edge of coverage.']) ul.append(el('li', null, t));
    tips.append(ul); msx.append(w, tips);
  }
  const nzr = (x, salt) => (M.hash01(Math.floor(x) + Math.floor(time * 30) * 977, salt) - 0.5) * 2;
  function timeMs(ctx, w, h, th) {
    const hh = h / 4, A = hh / 2 - 5, p = msP(), nz = msNoiseNow(), b = msBlendEff(nz), tt = (x) => time + (x / w) * 2;
    const nM = Math.pow(10, -nz.monoSnr / 20), gLR = Math.sqrt(1 + b * b * (Math.pow(10, nz.sGapDb / 10) - 1)), nS = nM * Math.pow(10, nz.sGapDb / 20);
    const mono = P.ms.mono;
    lane(ctx, th, 0, hh, mono ? 'Left (mono check: L and R both play M)' : 'Left at the receiver: M + S', w); lane(ctx, th, hh, hh, mono ? 'Right (mono check)' : 'Right at the receiver: M - S', w);
    lane(ctx, th, 2 * hh, hh, mono ? 'M = (L+R)/2: what a mono receiver plays' : 'M = (L+R)/2 (mid)', w); lane(ctx, th, 3 * hh, hh, mono ? 'S = (L-R)/2: disappears in mono' : 'S = (L-R)/2 (side), dashed = before processing', w);
    const memo = new Map(), sig = (x) => { let o = memo.get(x); if (!o) memo.set(x, (o = M.msSample(tt(x), p))); return o; }, yc = (i) => hh * i + hh / 2;
    const cl = (v) => Math.max(-1.1, Math.min(1.1, v));
    trace(ctx, w, (x) => { const o = sig(x); return yc(0) - A * cl(o.m + b * o.s + nzr(x, 1) * nM * gLR); }, th.blue, 1.6);
    trace(ctx, w, (x) => { const o = sig(x); return yc(1) - A * cl(o.m - b * o.s + nzr(x, 2) * nM * gLR); }, th.mono || th.inkSoft, 1.6);
    trace(ctx, w, (x) => yc(2) - A * cl(sig(x).m + nzr(x, 3) * nM), th.ink, 1.6);
    ctx.setLineDash([4, 3]); trace(ctx, w, (x) => yc(3) - A * cl(sig(x).sRaw), th.inkSoft, 1); ctx.setLineDash([]);
    trace(ctx, w, (x) => yc(3) - A * cl(sig(x).s + nzr(x, 4) * nS), mono ? th.fail : th.blue, 1.6);
  }
  function specMs(ctx, w, h, th) {
    const nz = msNoiseNow(), pk = msPeaksNow(), a = axes(ctx, th, w, h, 0, 64, 'kHz (baseband)', 44, 40, 18), FL = -60, share = 1 - M.PILOT_FRACTION;
    const Y = (db) => a.T + (clamp(db, FL, 0) / FL) * a.ph, db = (v) => 20 * Math.log10(Math.max(v, 1e-4));
    const nzf = (f) => -(P.mpx.cnr + 8) + 20 * Math.log10(Math.max(f, 0.5) / 15);
    ctx.fillStyle = `${th.fail}22`; ctx.beginPath(); ctx.moveTo(a.X(0), a.Y0); for (let f = 0; f <= 64; f += 1) ctx.lineTo(a.X(f), Y(nzf(f))); ctx.lineTo(a.X(64), a.Y0); ctx.fill();
    const mDb = db(pk.mPk * share), sDb = db(pk.sPk * share);
    ctx.fillStyle = `${th.ink}55`; ctx.strokeStyle = th.ink; ctx.lineWidth = 1.5; ctx.fillRect(a.X(0.05), Y(mDb), a.X(15) - a.X(0.05), a.Y0 - Y(mDb)); ctx.strokeRect(a.X(0.05), Y(mDb), a.X(15) - a.X(0.05), a.Y0 - Y(mDb));
    haloText(ctx, th, 'M plain baseband', a.X(7.5), Y(mDb) - 4, { align: 'center', px: 12, color: th.ink });
    // S: DSB-SC around 38 kHz; highs sit at the band edges and are lifted by the boost
    const lvl = (f) => sDb + P.ms.boost * 0.8 * clamp((Math.abs(f - 38) - 3) / 6, 0, 1);
    if (!P.ms.mono || true) { ctx.fillStyle = `${th.blue}55`; ctx.strokeStyle = th.blue; ctx.beginPath(); ctx.moveTo(a.X(23), a.Y0); for (let f = 23; f <= 53; f += 1) ctx.lineTo(a.X(f), Y(lvl(f))); ctx.lineTo(a.X(53), a.Y0); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    haloText(ctx, th, 'S (DSB-SC around 38 kHz)', a.X(38), Y(sDb) - 8, { align: 'center', px: 12, color: th.blue });
    ctx.setLineDash([3, 3]); ctx.strokeStyle = th.inkSoft; ctx.beginPath(); ctx.moveTo(a.X(38), a.Y0 - 34); ctx.lineTo(a.X(38), a.Y0); ctx.stroke(); ctx.setLineDash([]);
    haloText(ctx, th, '38 kHz suppressed', a.X(38) + 4, a.Y0 - 38, { px: 11, color: th.inkSoft });
    if (pilotLocked) { ctx.strokeStyle = th.pass; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a.X(19), a.Y0); ctx.lineTo(a.X(19), Y(db(M.PILOT_FRACTION))); ctx.stroke(); haloText(ctx, th, '19 kHz pilot', a.X(19), Y(db(M.PILOT_FRACTION)) - 5, { align: 'center', px: 12, color: th.pass }); }
    else haloText(ctx, th, 'pilot lost: mono', a.X(19), a.Y0 - 8, { align: 'center', px: 12, weight: '600', color: th.fail });
    if (P.mpx.leak) { const d2 = P.mpx.lp16 ? -62 : -22; ctx.fillStyle = `${th.marginal}88`; ctx.fillRect(a.X(17), Y(d2), a.X(20) - a.X(17), a.Y0 - Y(d2)); haloText(ctx, th, P.mpx.lp16 ? '17-20 kHz (filtered)' : '17-20 kHz leaks into the pilot', a.X(18.5), Y(d2) - 4, { align: 'center', px: 11, color: th.warnText }); }
    haloText(ctx, th, `S noise is about ${fmt(nz.sGapDb, 0)} dB worse than M`, a.X(0.5), a.Y0 - 6, { align: 'left', px: 11, color: th.fail });
    haloText(ctx, th, 'noise rises with frequency', a.X(64) - 4, a.T + 12, { align: 'right', px: 11, color: th.fail });
  }
  function auxMs(ctx, w, h, th) {
    ctx.fillStyle = th.paper; ctx.fillRect(0, 0, w, h);
    const stack = w < 520, cs = stack ? Math.min(w - 20, h * 0.5) : Math.min(h - 16, w * 0.46), cx0 = stack ? w / 2 : 8 + cs / 2, cy0 = stack ? 8 + cs / 2 : h / 2, p = msP();
    const nz = msNoiseNow(), b = msBlendEff(nz), bud = msBudget();
    ctx.strokeStyle = th.gridMajor; ctx.lineWidth = 1; ctx.strokeRect(cx0 - cs / 2, cy0 - cs / 2, cs, cs);
    const R = cs / 2 - 4; ctx.beginPath(); ctx.moveTo(cx0 - R, cy0); ctx.lineTo(cx0 + R, cy0); ctx.moveTo(cx0, cy0 - R); ctx.lineTo(cx0, cy0 + R); ctx.moveTo(cx0 - R * 0.7, cy0 + R * 0.7); ctx.lineTo(cx0 + R * 0.7, cy0 - R * 0.7); ctx.moveTo(cx0 - R * 0.7, cy0 - R * 0.7); ctx.lineTo(cx0 + R * 0.7, cy0 + R * 0.7); ctx.stroke();
    haloText(ctx, th, 'M (mono)', cx0 + 4, cy0 - R + 10, { px: 11, color: th.inkSoft }); haloText(ctx, th, 'S', cx0 + R - 4, cy0 - 4, { align: 'right', px: 11, color: th.inkSoft });
    haloText(ctx, th, 'L', cx0 - R * 0.7 - 2, cy0 - R * 0.7 + 4, { align: 'right', px: 11, color: th.inkSoft }); haloText(ctx, th, 'R', cx0 + R * 0.7 + 2, cy0 - R * 0.7 + 4, { px: 11, color: th.inkSoft });
    const nM = Math.pow(10, -nz.monoSnr / 20) * Math.sqrt(1 + b * b * (Math.pow(10, nz.sGapDb / 10) - 1));
    const N = 160;
    for (let i = N; i >= 0; i--) { const t = time - (i / N) * 1.0, o = M.msSample(t, p), l = o.m + b * o.s + nzr(i, 7) * nM, r = o.m - b * o.s + nzr(i, 8) * nM, g = M.gonioPoint(l, r); ctx.fillStyle = `${th.blue}${Math.round(25 + 200 * (1 - i / N)).toString(16).padStart(2, '0')}`; ctx.beginPath(); ctx.arc(cx0 + g.x * R * 0.95, cy0 - g.y * R * 0.95, i === 0 ? 3.5 : 1.8, 0, 7); ctx.fill(); }
    haloText(ctx, th, 'goniometer: vertical = mono, wide = side', cx0 - cs / 2 + 4, cy0 + cs / 2 - 6, { px: 11, color: th.inkSoft });
    // right / lower column: deviation budget and receiver SNR
    const bx0 = stack ? 12 : cx0 + cs / 2 + 14, bx1 = w - 12, by0 = stack ? cy0 + cs / 2 + 22 : 22;
    if (bx1 - bx0 < 120) return;
    const label = (t, y, c) => haloText(ctx, th, t, bx0, y, { px: 12, color: c || th.inkSoft });
    label('Deviation budget (limit = 100 %)', by0 - 6);
    const scale = 1.3, X = (v) => bx0 + 56 + (v / scale) * (bx1 - bx0 - 60), rows = [['M', bud.mPart, th.ink], ['pilot', bud.pilot, th.pass], ['S', bud.sPart, th.blue]];
    if (bud.leak) rows.push(['stray', bud.leak, th.marginal]);
    rows.push(['total', bud.total, bud.over ? th.fail : th.pass]);
    rows.forEach(([nm, v, c], i) => { const y = by0 + i * 20; ctx.fillStyle = th.ink; setFont(ctx, th, 12); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(nm, bx0, y + 7); ctx.fillStyle = c; ctx.fillRect(X(0), y, X(Math.min(v, scale)) - X(0), 14); });
    const yEnd = by0 + rows.length * 20 - 6; ctx.strokeStyle = th.fail; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(1), by0 - 4); ctx.lineTo(X(1), yEnd + 6); ctx.stroke();
    if (bud.over) { const on = th.reduceMotion || Math.floor(time * 4) % 2 === 0; if (on) { ctx.strokeStyle = th.fail; ctx.lineWidth = 3; ctx.strokeRect(bx0 - 4, by0 - 4, bx1 - bx0 + 8, rows.length * 20 + 6); } haloText(ctx, th, 'OVER-DEVIATION', bx1, by0 - 6, { align: 'right', px: 12, weight: '700', color: th.fail }); }
    else haloText(ctx, th, `headroom ${fmt(bud.headroomDb, 1)} dB`, bx1, by0 - 6, { align: 'right', px: 12, color: th.inkSoft });
    let y = yEnd + 30; label('Receiver output (SNR per channel)', y, th.ink); y += 18;
    const sn = (t, v, c) => { haloText(ctx, th, `${t}  ${fmt(v, 1)} dB`, bx0, y, { px: 12, color: c || th.ink }); y += 17; };
    sn('M (mono receiver)', nz.monoSnr); sn('L at the receiver', b === nz.blend ? nz.lrSnr : nz.monoSnr, nz.penaltyDb > 6 ? th.warnText : th.ink); sn('R at the receiver', b === nz.blend ? nz.lrSnr : nz.monoSnr, nz.penaltyDb > 6 ? th.warnText : th.ink); sn('S channel alone', nz.sSnr, th.fail);
    haloText(ctx, th, P.ms.mono ? 'mono check: L = R = M' : nz.blend > 0.98 ? 'STEREO' : nz.blend < 0.02 ? 'MONO (blended)' : `BLEND ${Math.round(nz.blend * 100)}%`, bx0, y + 4, { px: 13, weight: '700', color: nz.blend > 0.98 ? th.pass : th.warnText });
  }


  // ---- Pre-emphasis ---------------------------------------------------------------------------------------
  let extraStatus = '';
  const preTau = () => +P.pre.tau;
  const rxTauOf = () => (P.pre.brk === 'missing' ? null : P.pre.brk === 'wrong' ? (preTau() === 50 ? 75 : 50) : preTau());
  const preNetDb = (f) => (P.pre.on ? AP.emphasisMagnitudeDb(f, preTau(), 'pre') : 0) + (rxTauOf() ? AP.emphasisMagnitudeDb(f, rxTauOf(), 'de') : 0);
  const PRE_A = { lf: 0.6 };
  const preAHf = () => 0.5 * P.pre.hf / 100;
  function preDev(f) { const d = AP.preEmphasisDeviation({ freqHz: f, levelDb: P.pre.level, tauUs: preTau() }); return P.pre.on ? d.deviationKhz : d.deviationKhz / Math.pow(10, d.boostDb / 20); }
  function preTotals() { const lf = PRE_A.lf * preDev(1000), hf = preAHf() * preDev(10000), total = lf + hf; return { lf, hf, total, over: total > 75 }; }
  function preSnr() { const rx = rxTauOf(), base = audioSnrDb(P.pre.cnr, { stereo: false }); const imp = rx ? AP.deEmphasisNoiseImprovementDb({ tauUs: rx }).improvementDb : 0; return { flat: base, withDe: base + imp, imp }; }
  function preDescribe() {
    const t = preTotals(), n = preSnr(), rx = rxTauOf(), maxErr = Math.max(...[100, 1000, 5000, 10000, 15000].map((f) => Math.abs(preNetDb(f))));
    extraStatus = `${t.over ? 'OVER-DEVIATION. ' : ''}${maxErr < 0.5 ? 'Chain matched' : 'Tonal error up to ' + fmt(maxErr, 1) + ' dB'}`;
    return `Pre-emphasis demo, ${preTau()} microsecond network with corner ${fmt(AP.emphasisCornerHz(preTau()) / 1000, 2)} kHz, pre-emphasis ${P.pre.on ? 'on' : 'off'}, receiver de-emphasis ${rx ? rx + ' microseconds' : 'missing'}. Peak deviation ${fmt(t.total, 0)} kHz against a 75 kHz limit${t.over ? ', over-deviation' : ''}. Audio SNR ${fmt(n.flat, 1)} dB without de-emphasis, ${fmt(n.withDe, 1)} dB with it (a gain of ${fmt(n.imp, 1)} dB). Net tonal error at 10 kHz ${fmt(preNetDb(10000), 1)} dB.`;
  }
  function timePre(ctx, w, h, th) {
    const hh = h / 3, A = hh / 2 - 6, t = preTotals(), tt = (x) => time + (x / w) * 2, aLF = PRE_A.lf, aHF = preAHf();
    lane(ctx, th, 0, hh, 'Programme: low tone (1 kHz) plus highs (10 kHz)', w); lane(ctx, th, hh, hh, P.pre.on ? 'Transmitted deviation (kHz), pre-emphasised' : 'Transmitted deviation (kHz), no pre-emphasis', w); lane(ctx, th, 2 * hh, hh, 'Receiver output (noise drawn 25 dB larger)', w);
    const wave = (x, aL, aH) => aL * Math.cos(2 * Math.PI * 2 * tt(x)) + aH * Math.cos(2 * Math.PI * 17 * tt(x) + 1);
    trace(ctx, w, (x) => hh / 2 - A * 0.8 * wave(x, aLF, aHF), th.blue, 1.4);
    const S = (hh / 2 - 6) / 110;
    ctx.setLineDash([4, 3]); ctx.strokeStyle = th.fail; ctx.lineWidth = 1; ctx.beginPath(); for (const sg of [1, -1]) { ctx.moveTo(0, hh * 1.5 - sg * 75 * S); ctx.lineTo(w, hh * 1.5 - sg * 75 * S); } ctx.stroke(); ctx.setLineDash([]);
    haloText(ctx, th, '+75 limit', w - 4, hh * 1.5 - 75 * S - 3, { align: 'right', px: 11, color: th.fail });
    trace(ctx, w, (x) => hh * 1.5 - clamp(S * wave(x, t.lf / aLF * aLF, t.hf), -1.2 * 110 * S, 1.2 * 110 * S), t.over ? th.fail : th.ink, 1.3);
    const g = (f) => Math.pow(10, preNetDb(f) / 20), snr = preSnr(), rx = rxTauOf();
    const nAmp = Math.pow(10, -(snr.flat + (rx ? snr.imp : 0) - 25) / 20) * 0.5;
    trace(ctx, w, (x) => 2.5 * hh - A * 0.8 * clamp(wave(x, aLF * g(1000), aHF * g(10000)) + nzr(x * 3, 11) * nAmp * (rx ? 0.6 : 1.4), -1.3, 1.3), P.pre.brk === 'ok' && P.pre.on ? th.pass : th.warnText, 1.4);
  }
  function specPre(ctx, w, h, th) {
    const L = 44, B = 40, T = 10, pw = w - L - 10, ph = h - B - T, Y0 = T + ph, ymin = -30, ymax = 30;
    const X = (f) => L + (Math.log10(f / 20) / 3) * pw, Y = (db) => T + ((ymax - clamp(db, ymin, ymax)) / (ymax - ymin)) * ph;
    ctx.fillStyle = th.paper; ctx.fillRect(0, 0, w, h); setFont(ctx, th, 12); ctx.fillStyle = th.inkSoft; ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center'; for (const [f, lb] of [[20, '20'], [100, '100'], [1000, '1k'], [10000, '10k'], [20000, '20k']]) { ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(X(f), T); ctx.lineTo(X(f), Y0); ctx.stroke(); ctx.fillText(lb, clamp(X(f), L + 8, w - 16), Y0 + 16); }
    ctx.textAlign = 'right'; ctx.fillText('Hz', w - 6, h - 6);
    ctx.textAlign = 'right'; for (let d = ymin; d <= ymax; d += 10) { ctx.strokeStyle = d === 0 ? th.gridMajor : th.grid; ctx.beginPath(); ctx.moveTo(L, Y(d)); ctx.lineTo(L + pw, Y(d)); ctx.stroke(); ctx.fillStyle = th.inkSoft; ctx.fillText(String(d), L - 4, Y(d) + 4); }
    const fs = []; for (let i = 0; i <= 160; i++) fs.push(20 * Math.pow(1000, i / 160));
    const rx = rxTauOf(), tau = preTau();
    const flat = fs.map((f) => AP.fmNoiseSpectrumDb(f)), de = fs.map((f) => AP.fmNoiseSpectrumDb(f, { tauUs: rx }));
    if (rx) { ctx.fillStyle = `${th.fail}2a`; ctx.beginPath(); fs.forEach((f, i) => (i ? ctx.lineTo(X(f), Y(flat[i])) : ctx.moveTo(X(f), Y(flat[i])))); for (let i = fs.length - 1; i >= 0; i--) ctx.lineTo(X(fs[i]), Y(de[i])); ctx.closePath(); ctx.fill(); }
    const line = (arr, col, lw, dash) => { ctx.setLineDash(dash || []); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); fs.forEach((f, i) => (i ? ctx.lineTo(X(f), Y(arr[i])) : ctx.moveTo(X(f), Y(arr[i])))); ctx.stroke(); ctx.setLineDash([]); };
    line(flat, th.fail, 1.6); if (rx) line(de, th.fail, 1.6, [5, 3]);
    line(AP.emphasisResponse(fs, tau, 'pre'), th.ink, 2); line(AP.emphasisResponse(fs, rx || tau, 'de'), th.blue, 2);
    line(fs.map(preNetDb), th.pass, 2.6, [2, 3]);
    for (const k of new Set([50, 75])) { const f1 = AP.emphasisCornerHz(k); ctx.strokeStyle = k === tau ? th.inkSoft : th.grid; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(X(f1), T); ctx.lineTo(X(f1), Y0); ctx.stroke(); ctx.setLineDash([]); haloText(ctx, th, `${k} µs: ${fmt(f1 / 1000, 2)} kHz`, X(f1) + 3, T + (k === 50 ? 12 : 26), { px: 11, color: th.inkSoft }); }
    const lg = [['pre-emphasis', th.ink], ['de-emphasis', th.blue], ['net (programme)', th.pass], ['FM noise', th.fail]];
    lg.forEach(([t, c], i) => { haloText(ctx, th, t, L + 8 + (i % 2) * 130, Y0 - 34 + Math.floor(i / 2) * 16, { px: 11, color: c }); });
    haloText(ctx, th, rx ? `de-emphasis cuts the noise by ${fmt(AP.deEmphasisNoiseImprovementDb({ tauUs: rx }).improvementDb, 1)} dB (dashed)` : 'no de-emphasis: the noise keeps the full triangle', L + pw - 4, Y0 - 6, { align: 'right', px: 11, color: th.fail });
    haloText(ctx, th, 'dB, noise relative to 1 kHz', 4, 10, { px: 11, color: th.inkSoft });
  }
  function auxPre(ctx, w, h, th) {
    ctx.fillStyle = th.paper; ctx.fillRect(0, 0, w, h);
    const t = preTotals(), x0 = 12, x1 = w - 12, scale = 150, X = (v) => x0 + 62 + (v / scale) * (x1 - x0 - 66);
    let y = 20; haloText(ctx, th, 'Peak deviation (limit 75 kHz)', x0, y, { px: 12, color: th.inkSoft });
    if (t.over) haloText(ctx, th, 'OVER-DEVIATION', x1, y, { align: 'right', px: 12, weight: '700', color: th.fail }); else haloText(ctx, th, `headroom ${fmt(20 * Math.log10(75 / Math.max(t.total, 1e-6)), 1)} dB`, x1, y, { align: 'right', px: 12, color: th.inkSoft });
    const rows = [['low', t.lf, th.ink], ['highs', t.hf, th.blue], ['total', t.total, t.over ? th.fail : th.pass]], top = y + 10;
    rows.forEach(([nm, v, c], i) => { const yy = top + i * 20; ctx.fillStyle = th.ink; setFont(ctx, th, 12); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(nm, x0, yy + 7); ctx.fillStyle = c; ctx.fillRect(X(0), yy, X(Math.min(v, scale)) - X(0), 14); haloText(ctx, th, fmt(v, 0) + ' kHz', Math.min(X(v) + 4, x1 - 50), yy + 12, { px: 11, color: th.ink }); });
    ctx.strokeStyle = th.fail; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(75), top - 4); ctx.lineTo(X(75), top + 62); ctx.stroke();
    if (t.over) { const on = th.reduceMotion || Math.floor(time * 4) % 2 === 0; if (on) { ctx.lineWidth = 3; ctx.strokeRect(x0 - 4, y - 14, x1 - x0 + 8, 88); } }
    y = top + 90; haloText(ctx, th, 'Output level error versus the programme', x0, y, { px: 12, color: th.ink }); y += 18;
    for (const f of [100, 1000, 5000, 10000, 15000]) { const e = preNetDb(f); haloText(ctx, th, `${f >= 1000 ? f / 1000 + ' kHz' : f + ' Hz'}: ${e >= 0 ? '+' : ''}${fmt(e, 1)} dB${Math.abs(e) < 0.5 ? '' : e > 0 ? ' (too bright)' : ' (dull)'}`, x0, y, { px: 12, color: Math.abs(e) < 0.5 ? th.pass : th.warnText }); y += 16; }
    const n = preSnr(), rx = rxTauOf(); y += 8; haloText(ctx, th, `Audio SNR: ${fmt(n.flat, 1)} dB without de-emphasis`, x0, y, { px: 12, color: th.ink }); y += 16;
    haloText(ctx, th, rx ? `${fmt(n.withDe, 1)} dB with de-emphasis (+${fmt(n.imp, 1)} dB)` : 'no de-emphasis: no noise benefit', x0, y, { px: 12, weight: '600', color: rx ? th.pass : th.fail });
  }

  // ---- Companding -----------------------------------------------------------------------------------------
  let cKey = '', cD = null;
  const cmpP = () => ({ ratio: +P.cmp.ratio, refDb: +P.cmp.ref, attackMs: +P.cmp.attack, releaseMs: +P.cmp.release, hfWeight: P.cmp.hfw ? { cornerHz: 1000, boostDb: 10 } : null });
  const cmpRx = () => (P.cmp.mismatch ? { ...cmpP(), ratio: +P.cmp.ratio + 0.5, refDb: +P.cmp.ref + 6 } : cmpP());
  function dbw(a) { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) { const v = a[i], d = Math.max(0, (20 * Math.log10(Math.abs(v) + 1e-9) + 90) / 90); o[i] = Math.sign(v) * Math.min(1, d); } return o; }
  function compData() {
    const k = JSON.stringify(P.cmp); if (k === cKey && cD) return cD; cKey = k;
    const p = cmpP(), rx = cmpRx();
    const d = AP.companderNoiseDemo({ fs: 8000, toneHz: 250, toneDb: +P.cmp.tone, burstS: 0.6, tailS: 0.6, noiseDb: +P.cmp.noise, seed: 3, ...p, rxParams: rx });
    cD = { d, p, rx, wIn: dbw(d.input), wCh: dbw(d.received), wOut: dbw(d.output), err: AP.companderMismatchErrorDb(+P.cmp.tone, p, rx), N: d.input.length };
    return cD;
  }
  function compDescribe() {
    const c = compData(), st = AP.companderNoiseStatic({ signalDb: +P.cmp.tone, noiseDb: +P.cmp.noise, ...c.p });
    extraStatus = P.cmp.mismatch ? `Mismatched expander: level error ${fmt(c.err, 1)} dB` : 'Matched pair';
    return `Companding demo, ratio ${fmt(P.cmp.ratio, 1)} to 1, reference ${P.cmp.ref} dB, attack ${P.cmp.attack} ms, release ${P.cmp.release} ms${P.cmp.hfw ? ', generic HF-weighted detector' : ''}. A ${P.cmp.tone} dB signal over a ${P.cmp.noise} dB channel noise floor: the expander cuts the noise by ${fmt(st.noiseReductionDb, 1)} dB while the signal plays and by ${fmt(st.silenceReductionDb, 1)} dB in silence; measured on the tail ${fmt(c.d.tailNoiseReductionDb, 1)} dB. ${P.cmp.mismatch ? 'Mismatched expander: the output level is ' + fmt(c.err, 1) + ' dB off at this signal level.' : 'Expander matches the compressor, so the level error is zero.'}`;
  }
  const compRev = () => (P.playing ? Math.min(1, ((time * 0.45) % 1.25)) : 1);
  function timeComp(ctx, w, h, th) {
    const c = compData(), hh = h / 4, rev = compRev(), N = c.N, A = hh / 2 - 5;
    lane(ctx, th, 0, hh, 'Input (amplitude on a dB scale)', w); lane(ctx, th, hh, hh, 'Channel: compressed signal plus noise', w); lane(ctx, th, 2 * hh, hh, P.cmp.mismatch ? 'Output (mismatched expander)' : 'Output (expanded)', w); lane(ctx, th, 3 * hh, hh, 'Gain versus time (dB): compressor and expander', w);
    const cols = (arr, yc, color) => { ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath(); const px = Math.floor(w * rev); for (let x = 0; x < px; x++) { const i0 = Math.floor((x / w) * N), i1 = Math.max(i0 + 1, Math.floor(((x + 1) / w) * N)); let lo = 2, hi = -2; for (let i = i0; i < i1; i++) { const v = arr[i]; if (v < lo) lo = v; if (v > hi) hi = v; } ctx.moveTo(x + 0.5, yc - hi * A); ctx.lineTo(x + 0.5, yc - lo * A); } ctx.stroke(); };
    cols(c.wIn, hh / 2, th.blue); cols(c.wCh, hh * 1.5, th.ink); cols(c.wOut, hh * 2.5, P.cmp.mismatch ? th.warnText : th.pass);
    const gy = (g) => 3 * hh + hh / 2 - ((clamp(g, -50, 20) - -15) / 70) * (hh - 12);
    const line = (arr, color) => { ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath(); const px = Math.floor(w * rev); for (let x = 0; x < px; x++) { const g = arr[Math.floor((x / w) * N)]; if (x === 0) ctx.moveTo(x, gy(g)); else ctx.lineTo(x, gy(g)); } ctx.stroke(); };
    line(c.d.compressGainDb, th.ink); line(c.d.expandGainDb, th.blue);
    haloText(ctx, th, 'compressor', w - 6, 3 * hh + 28, { align: 'right', px: 11, color: th.ink }); haloText(ctx, th, 'expander (the noise floor pumps here)', w - 6, 4 * hh - 6, { align: 'right', px: 11, color: th.blue });
    const bx = (0.6 / 1.2) * w; ctx.setLineDash([3, 4]); ctx.strokeStyle = th.inkSoft; ctx.beginPath(); ctx.moveTo(bx, 0); ctx.lineTo(bx, h); ctx.stroke(); ctx.setLineDash([]); haloText(ctx, th, 'signal stops', bx + 4, 14, { px: 11, color: th.inkSoft });
    if (rev < 1) { ctx.strokeStyle = th.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(w * rev, 0); ctx.lineTo(w * rev, h); ctx.stroke(); }
    haloText(ctx, th, '1.2 s, signal is a 250 Hz tone burst', w - 6, h - 6, { align: 'right', px: 11, color: th.inkSoft });
  }
  function specComp(ctx, w, h, th) {
    const c = compData(), L = 44, B = 40, T = 10, pw = w - L - 10, ph = h - B - T, Y0 = T + ph, lo = -80, hi = 0;
    const X = (v) => L + ((v - lo) / (hi - lo)) * pw, Y = (v) => T + ((hi - clamp(v, lo, hi)) / (hi - lo)) * ph;
    ctx.fillStyle = th.paper; ctx.fillRect(0, 0, w, h); setFont(ctx, th, 12); ctx.fillStyle = th.inkSoft;
    for (let d = lo; d <= hi; d += 20) { ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(X(d), T); ctx.lineTo(X(d), Y0); ctx.moveTo(L, Y(d)); ctx.lineTo(L + pw, Y(d)); ctx.stroke(); ctx.textAlign = 'center'; ctx.fillText(String(d), X(d), Y0 + 16); ctx.textAlign = 'right'; ctx.fillText(String(d), L - 4, Y(d) + 4); }
    ctx.textAlign = 'right'; ctx.fillText('input level (dB re full scale)', w - 6, h - 6);
    const lv = []; for (let v = lo; v <= hi; v += 1) lv.push(v);
    const comp = AP.companderTransferCurve(lv, c.p), exp = AP.companderTransferCurve(lv, c.rx);
    const draw = (vals, col, lw, dash) => { ctx.setLineDash(dash || []); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); lv.forEach((v, i) => { const y = Y(vals[i]); if (i) ctx.lineTo(X(v), y); else ctx.moveTo(X(v), y); }); ctx.stroke(); ctx.setLineDash([]); };
    draw(lv, th.inkSoft, 1, [4, 4]);
    draw(comp.map((p) => p.compressedDb), th.ink, 2); draw(exp.map((p) => p.expandedDb), th.blue, 2);
    draw(lv.map((v) => AP.companderMismatchErrorDb(v, c.p, c.rx) + v), c.p === c.rx || !P.cmp.mismatch ? th.pass : th.warnText, 2.6, [2, 3]);
    ctx.strokeStyle = th.fail; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(X(+P.cmp.ref), T); ctx.lineTo(X(+P.cmp.ref), Y0); ctx.stroke(); ctx.setLineDash([]);
    haloText(ctx, th, 'reference', X(+P.cmp.ref) + 3, T + 12, { px: 11, color: th.fail });
    const tone = +P.cmp.tone; ctx.fillStyle = th.ink; ctx.beginPath(); ctx.arc(X(tone), Y(tone), 4, 0, 7); ctx.fill();
    [['compressor', th.ink], ['expander', th.blue], [P.cmp.mismatch ? 'combined (mismatched)' : 'combined (straight line)', P.cmp.mismatch ? th.warnText : th.pass]].forEach(([t, col], i) => haloText(ctx, th, t, L + 8, Y0 - 50 + i * 16, { px: 11, color: col }));
    haloText(ctx, th, 'output level (dB)', 4, 10, { px: 11, color: th.inkSoft });
    if (P.cmp.mismatch) haloText(ctx, th, `level error ${c.err >= 0 ? '+' : ''}${fmt(c.err, 1)} dB at the signal level`, L + pw - 4, T + 14, { align: 'right', px: 12, weight: '600', color: th.warnText });
  }
  function auxComp(ctx, w, h, th) {
    ctx.fillStyle = th.paper; ctx.fillRect(0, 0, w, h);
    const c = compData(), L = 44, T = 40, B = 150, pw = w - L - 12, ph = Math.max(60, h - T - B), Y0 = T + ph, lo = -90, hi = -30, noise = +P.cmp.noise;
    const X = (v) => L + ((v + 80) / 80) * pw, Y = (v) => T + ((hi - clamp(v, lo, hi)) / (hi - lo)) * ph;
    haloText(ctx, th, 'Noise-floor meter: noise at the output versus signal level', 6, 16, { px: 12, color: th.inkSoft });
    haloText(ctx, th, 'noise out (dB re full scale)', 6, 32, { px: 11, color: th.inkSoft });
    setFont(ctx, th, 11); ctx.fillStyle = th.inkSoft;
    for (let d = -90; d <= -30; d += 20) { ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(L, Y(d)); ctx.lineTo(L + pw, Y(d)); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillText(String(d), L - 4, Y(d) + 4); }
    for (let d = -80; d <= 0; d += 20) { ctx.textAlign = 'center'; ctx.fillText(String(d), X(d), Y0 + 14); }
    ctx.textAlign = 'right'; ctx.fillText('signal level (dB)', w - 6, Y0 + 28);
    ctx.setLineDash([5, 3]); ctx.strokeStyle = th.fail; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(L, Y(noise)); ctx.lineTo(L + pw, Y(noise)); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = th.pass; ctx.lineWidth = 2.2; ctx.beginPath(); for (let v = -80; v <= 0; v += 1) { const st = AP.companderNoiseStatic({ signalDb: v, noiseDb: noise, ...c.p }); if (v === -80) ctx.moveTo(X(v), Y(st.noiseOutDb)); else ctx.lineTo(X(v), Y(st.noiseOutDb)); } ctx.stroke();
    const tone = +P.cmp.tone, cur = AP.companderNoiseStatic({ signalDb: tone, noiseDb: noise, ...c.p });
    ctx.fillStyle = th.ink; ctx.beginPath(); ctx.arc(X(tone), Y(cur.noiseOutDb), 4.5, 0, 7); ctx.fill();
    haloText(ctx, th, 'channel noise, no expander', L + 6, Y(noise) - 5, { px: 11, color: th.fail }); haloText(ctx, th, 'with the expander: rises with the signal', L + 6, Y0 - 6, { px: 11, color: th.pass });
    let y = Y0 + 50; const row = (t, col, wt) => { haloText(ctx, th, t, 10, y, { px: 12, color: col || th.ink, weight: wt || '' }); y += 17; };
    row(`In silence the noise is cut by ${fmt(cur.silenceReductionDb, 1)} dB`, th.pass);
    row(`While this signal plays: ${fmt(cur.noiseReductionDb, 1)} dB`, th.ink);
    row(`Measured on the demo tail: ${fmt(c.d.tailNoiseReductionDb, 1)} dB`, th.ink);
    row('So the noise floor moves with the programme (breathing).', th.inkSoft);
    row(P.cmp.mismatch ? `Mismatched expander: level error ${c.err >= 0 ? '+' : ''}${fmt(c.err, 1)} dB at ${tone} dB` : 'Matched pair: level error 0 dB at every level', P.cmp.mismatch ? th.warnText : th.pass, '600');
    if (P.cmp.mismatch) row(`and ${fmt(AP.companderMismatchErrorDb(-60, c.p, c.rx), 1)} dB at -60 dB, ${fmt(AP.companderMismatchErrorDb(-5, c.p, c.rx), 1)} dB at -5 dB`, th.warnText);
    row('Generic detector: not any manufacturer\'s curve', th.inkSoft);
  }

  // ---- hosts and summaries ----------------------------------------------------------------------------
  const tHost = createCanvasHost(timeCv, drawTime), sHost = createCanvasHost(specCv, drawSpec), auxHost = createCanvasHost(auxCv, drawAux);
  const host = { invalidateAll() { tHost.invalidate(); sHost.invalidate(); auxHost.invalidate(); updateText(); } };
  function describe() {
    const m = P.mode;
    if (m === 'am') { const d = P.am.depth, bw = M.amBandwidthKhz(P.msg, P.am.fm); return `AM, ${M.MESSAGE_LABELS[P.msg].toLowerCase()}, depth ${d} percent, audio ${fmt(P.am.fm, 1)} kHz. Occupied bandwidth ${fmt(bw, 1)} kHz. Sidebands carry ${(M.amSidebandPowerShare(d / 100) * 100).toFixed(0)} percent of the power in the single-tone case.${d > 100 ? ' Over-modulated: the envelope crosses zero and the recovered audio is distorted.' : ''}`; }
    if (m === 'fm') { const { dev, fm } = P.fm, b = M.modIndex(dev, fm), bw = M.carsonBwKhz(dev, fm), f = M.channelFit(bw); return `FM, deviation plus or minus ${fmt(dev, 1)} kHz, modulation ${fmt(fm, 1)} kHz. Modulation index ${fmt(b, 2)}. Carson bandwidth ${fmt(bw, 0)} kHz, ${f.pct} percent of a 200 kHz channel${f.fits ? '' : ', which does not fit'}. Carrier amplitude ${fmt(Math.abs(M.besselJ(0, b)), 2)} of unmodulated${Math.abs(b - M.BESSEL_NULL) < 0.12 ? ' (the carrier null at index 2.405)' : ''}. FM gain about ${fmt(M.fmImprovementDb(dev, 15), 1)} dB for 15 kHz audio.`; }
    if (m === 'digital') { const { mode, snr, rate } = P.dig, cliff = M.snrForBer(mode, 1e-3); return `${mode === '16QAM' ? '16-QAM' : mode}, ${M.bitsPerSymbol(mode)} bit per symbol, SNR ${fmt(snr, 1)} dB. Ideal BER ${M.theoryBer(mode, snr).toExponential(1)}. BER reaches 1e-3 at ${fmt(cliff, 1)} dB, the cliff. Main lobe ${fmt(M.digitalBwKhz(mode, rate), 0)} kHz at ${rate} ksym/s. Simulated symbol errors in the last ${cnt.n} symbols: ${cnt.e}.`; }
    if (m === 'mpx') return `Stereo FM multiplex, carrier-to-noise ${P.mpx.cnr} dB: ${mpxCaption || mpxMode(mpxBlend())}. Baseband holds L plus R to 15 kHz, a 19 kHz pilot, and L minus R around a suppressed 38 kHz carrier from 23 to 53 kHz${P.mpx.rds ? ', and RDS at 57 kHz' : ''}.${P.mpx.leak && !P.mpx.lp16 ? ' Console content at 17 to 20 kHz disturbs the pilot.' : ''}`;
    if (m === 'ms') return msDescribe();
    if (m === 'pre') return preDescribe();
    if (m === 'comp') return compDescribe();
    return `Mic tone-key demo, scenario ${M.GATE_LABELS[P.tone.scenario]}. Tone ${fmt(P.tone.khz, 3)} kHz, not the 19 kHz stereo pilot. Receiver gate is ${gateOpenNow ? 'open' : 'muted'}. Illustrative levels.`;
  }
  let textTick = 0;
  function updateText() {
    const s = describe();
    if (s !== summaryText) { summaryText = s; summary.textContent = s; for (const c of [timeCv, specCv, auxCv]) c.setAttribute('aria-label', `Modulation lab. ${s}`); }
    if (P.mode === 'mpx' || P.mode === 'tone' || P.mode === 'ms' || P.mode === 'pre' || P.mode === 'comp') { const st = P.mode === 'mpx' ? mpxCaption : P.mode === 'ms' ? msStatus : (P.mode === 'pre' || P.mode === 'comp') ? extraStatus : gateOpenNow ? 'Gate open' : 'Gate muted'; if (st && st !== status.dataset.last) { status.dataset.last = st; status.textContent = st; } }
  }

  // ---- loop ----------------------------------------------------------------------------------------
  function frame(ts) {
    raf = 0;
    if (!open || doc.hidden || !P.playing) { last = 0; return; }
    const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0; last = ts; time += dt; sweepPhase += dt; sweepApply();
    tHost.invalidate(); sHost.invalidate(); if (AUX.has(P.mode)) auxHost.invalidate();
    if ((textTick += dt) > 0.25) { textTick = 0; updateText(); }
    raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && open && P.playing) { last = 0; raf = requestAnimationFrame(frame); } }
  doc.addEventListener('visibilitychange', () => { if (!doc.hidden) kick(); });
  if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (mq.matches) { P.playing = false; P.sweep = false; syncSweep(); syncPlay(); } });

  // ---- open / close ---------------------------------------------------------------------------------
  function openLab() {
    if (open) return; open = true; lastFocus = doc.activeElement;
    container.hidden = false; openButton?.setAttribute('aria-expanded', 'true'); doc.body.classList.add('modlab-open');
    syncPlay(); host.invalidateAll(); kick(); closeBtn.focus();
  }
  function closeLab() {
    if (!open) return; open = false; container.hidden = true; openButton?.setAttribute('aria-expanded', 'false'); doc.body.classList.remove('modlab-open');
    if (raf) cancelAnimationFrame(raf); raf = 0; (lastFocus && lastFocus.focus ? lastFocus : openButton)?.focus();
  }
  closeBtn.addEventListener('click', closeLab);
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeLab(); return; }
    if (e.key === ' ' && e.target === timeCv) { e.preventDefault(); playBtn.click(); }
    if (e.key === 'Tab') { // keep focus inside the dialog
      const f = [...container.querySelectorAll('button:not([hidden]), input, select, canvas[tabindex]')].filter((n) => !n.disabled && n.offsetParent !== null);
      if (!f.length) return; const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && doc.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && doc.activeElement === z) { e.preventDefault(); a.focus(); }
    }
  });
  openButton?.addEventListener('click', () => (open ? closeLab() : openLab()));
  doc.addEventListener('rf-theme', () => host.invalidateAll());

  container.hidden = true;
  setMode(P.mode);
  syncPlay();
  return { open: openLab, close: closeLab, isOpen: () => open, state: P, setMode, destroy() { closeLab(); tHost.destroy(); sHost.destroy(); auxHost.destroy(); } };
}
