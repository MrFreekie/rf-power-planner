// Which spectrum tab each example opens on when the bottom bar shows one spectrum at a time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { exampleSpectrum, SPECTRA } from '../js/view/spectra.js';
import { EXAMPLES, buildExample } from '../js/examples.js';

const ids = new Set(SPECTRA.map((s) => s.id));
const pick = (id) => { const s = buildExample(id).scene; return exampleSpectrum(id, s.links && s.links[0]); };

test('every example opens on a real spectrum tab', () => {
  for (const e of EXAMPLES) assert.ok(ids.has(pick(e.id)), e.id);
});

test('tone, deviation and stereo examples open on the MPX, audio bandwidth on the audio, others on the RF', () => {
  for (const id of ['tone-pilot-products', 'tone-overdeviation', 'fm-deviation-compare', 'iem-stereo-mono']) assert.equal(pick(id), 'mpx', id);
  assert.equal(pick('audio-bandwidth-iem-vs-mic'), 'audio');
  for (const id of ['zones-dead-spot', 'tv-strong-cochannel', 'noise-phone-buzz']) assert.equal(pick(id), 'rf', id);
});

test('a digital link opens on its digital link panel in the MPX slot', () => {
  assert.equal(exampleSpectrum('anything', { modulation: { type: 'digital' } }), 'mpx');
  assert.equal(exampleSpectrum('anything', { modulation: { type: 'fm' } }), 'rf');
});

test('every id in the tab map is a real example', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../js/view/spectra.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('const EXAMPLE_SPECTRUM'), src.indexOf('});', src.indexOf('const EXAMPLE_SPECTRUM')));
  const known = new Set(EXAMPLES.map((e) => e.id));
  for (const m of block.matchAll(/'([a-z0-9-]+)': '(audio|mpx|rf)'/g)) assert.ok(known.has(m[1]), m[1]);
});
