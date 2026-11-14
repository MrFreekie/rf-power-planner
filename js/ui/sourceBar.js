// Global audio source selector, tone frequency field and the tone / MPX sliders (items 31, 32).
//   mountSourceBar({ host, store, tone }) puts the controls in `host` (the Spectra bar head) and keeps them in step with the scene.
//   buildToneSliders(doc, tone) -> element with the three sliders; the enlarged dialog uses another instance bound to the same state.
import { AUDIO_SOURCE_IDS, AUDIO_SOURCE_LABELS, AUDIO_SOURCES, TONE_HZ_LIMITS, DEFAULT_TONE_HZ, defaultAudioSource } from '../model/audio-source.js';
import { TONE_MPX_LIMITS } from '../model/tone-mpx.js';
import { setAudioSource, setAudioToneHz } from '../actions.js';
import { activeLink } from '../view/util.js';
import { TONE_FIELDS } from './toneState.js';

export const TONE_SOURCE_IDS = Object.freeze(['tone', 'two-tone', 'sweep']);
const mk = (doc, tag, cls, text, attrs) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

/** One-line description of a source id (or the per-link default). */
export function sourceDescription(id, linkKind) {
  const eff = id || defaultAudioSource(linkKind);
  const s = AUDIO_SOURCES[eff];
  return `${id ? '' : `Default for this link: ${AUDIO_SOURCE_LABELS[eff]}. `}${s ? s.note : ''}`.trim();
}

export function buildToneSliders(doc, tone, idp = 'tone') {
  const root = mk(doc, 'div', 'tone-sliders', null, { role: 'group', 'aria-label': 'Tone and MPX settings' });
  const refs = {};
  for (const f of TONE_FIELDS) {
    const id = `${idp}-${f.key}`, [lo, hi] = TONE_MPX_LIMITS[f.key];
    const lab = mk(doc, 'label', 'tone-field', `${f.label} `, { for: id });
    const range = mk(doc, 'input', null, null, { type: 'range', id, min: lo, max: hi, step: f.step, 'aria-label': `${f.label}, ${f.unit}` });
    const out = mk(doc, 'output', null, '', { for: id });
    lab.append(range, out, mk(doc, 'span', 'tone-unit', f.unit));
    range.addEventListener('input', () => tone.set({ [f.key]: +range.value }));
    root.append(lab); refs[f.key] = { range, out };
  }
  const sync = () => { const v = tone.get(); for (const f of TONE_FIELDS) { const r = refs[f.key]; if (+r.range.value !== v[f.key]) r.range.value = v[f.key]; r.out.textContent = String(+v[f.key].toFixed(1)); } };
  sync();
  const off = tone.subscribe(sync);
  return { root, sync, destroy: off };
}

export function mountSourceBar({ host, store, tone, doc = document }) {
  const wrap = mk(doc, 'div', 'source-bar group', null, { role: 'group', 'aria-label': 'Audio source' });
  const sel = mk(doc, 'select', null, null, { id: 'audio-source', 'aria-describedby': 'audio-source-desc' });
  const lab = mk(doc, 'label', null, 'Audio source ', { for: 'audio-source' });
  const opt0 = mk(doc, 'option', null, 'Per-link default', { value: '' }); sel.append(opt0);
  for (const id of AUDIO_SOURCE_IDS) sel.append(mk(doc, 'option', null, AUDIO_SOURCE_LABELS[id], { value: id }));
  lab.append(sel);
  const desc = mk(doc, 'span', 'source-desc', '', { id: 'audio-source-desc' });
  const hzLab = mk(doc, 'label', 'source-hz', 'Tone ', { for: 'audio-tone-hz' });
  const hz = mk(doc, 'input', null, null, { id: 'audio-tone-hz', type: 'number', min: TONE_HZ_LIMITS[0], max: TONE_HZ_LIMITS[1], step: 'any', inputmode: 'decimal', 'aria-label': 'Tone frequency in hertz' });
  hzLab.append(hz, mk(doc, 'span', 'tone-unit', 'Hz'));
  const btn = mk(doc, 'button', null, 'Tone and MPX', { type: 'button', id: 'btn-tone-sliders', 'aria-expanded': 'false', 'aria-controls': 'tone-pop', title: 'Tone level, pilot injection and overload level of the limiter stage' });
  const pop = mk(doc, 'div', 'tone-pop', null, { id: 'tone-pop', role: 'region', 'aria-label': 'Tone and MPX sliders' }); pop.hidden = true;
  const sl = buildToneSliders(doc, tone, 'bar');
  pop.append(sl.root, mk(doc, 'p', 'hint', 'Shown as lines in the MPX and RF spectra while the source is a tone, two-tone or sweep. Stage levels and the nonlinearity are assumed.'));
  wrap.append(lab, desc, hzLab, btn, pop);
  host.append(wrap);

  let linkKind = 'mic';
  function sync(scene) {
    const id = scene && scene.audioSource ? scene.audioSource : '';
    if (sel.value !== id) sel.value = id;
    desc.textContent = sourceDescription(id, linkKind);
    desc.title = desc.textContent;
    const eff = id || defaultAudioSource(linkKind), tonal = TONE_SOURCE_IDS.includes(eff);
    hzLab.hidden = !tonal; btn.hidden = !tonal;
    if (!tonal) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    const f = scene && Number.isFinite(scene.audioToneHz) ? scene.audioToneHz : DEFAULT_TONE_HZ;
    if (doc.activeElement !== hz && +hz.value !== f) hz.value = String(f);
    hz.disabled = eff === 'sweep'; hz.title = eff === 'sweep' ? 'The sweep runs 20 Hz to 20 kHz; this field is used by the tone and two-tone sources' : '';
  }
  sel.addEventListener('change', () => setAudioSource(store, sel.value));
  hz.addEventListener('change', () => { if (!setAudioToneHz(store, hz.value)) hz.value = String(store.getScene().audioToneHz ?? DEFAULT_TONE_HZ); });
  btn.addEventListener('click', () => { pop.hidden = !pop.hidden; if (!pop.hidden) { const r = btn.getBoundingClientRect(); pop.style.right = `${Math.max(8, innerWidth - r.right)}px`; pop.style.bottom = `${Math.max(8, innerHeight - r.top + 4)}px`; } btn.setAttribute('aria-expanded', String(!pop.hidden)); });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { e.stopPropagation(); pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); btn.focus(); } });
  const run = () => { const s = store.getScene(), l = activeLink(s, store.getSelection()); linkKind = l ? l.kind : 'mic'; sync(s); };
  run();
  const unsub = store.subscribe(run);
  return { sync: run, select: sel, hzInput: hz, button: btn, pop, destroy() { unsub(); sl.destroy(); wrap.remove(); } };
}
