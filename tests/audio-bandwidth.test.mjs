// Audio ceiling per link: 15 kHz is for FM stereo only; mono mic/IEM default 18 kHz (assumed), presets with a published figure use it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  audioSpectrum, monoBasebandSpectrum, resolveAudioBandwidthHz, audioBandLabel, monoCaption, FM_AUDIO_LIMIT_HZ, MONO_AUDIO_BANDWIDTH_HZ,
} from '../js/model/spectrum-views.js';
import { createDefaultScene, validateScene } from '../js/model/scene.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);

test('resolveAudioBandwidthHz: link value, preset (G4 mic 18 kHz, PSM 15 kHz), stereo IEM 15 kHz, mono default 18 kHz assumed', () => {
  assert.equal(FM_AUDIO_LIMIT_HZ, 15000);
  assert.equal(MONO_AUDIO_BANDWIDTH_HZ, 18000);
  assert.deepEqual(resolveAudioBandwidthHz({ kind: 'mic' }), { hz: 18000, source: 'assumed-mono', confidence: 'assumed' });
  assert.deepEqual(resolveAudioBandwidthHz({ kind: 'iem', stereo: false }), { hz: 18000, source: 'assumed-mono', confidence: 'assumed' });
  assert.deepEqual(resolveAudioBandwidthHz({ kind: 'iem', stereo: true }), { hz: 15000, source: 'stereo-standard', confidence: 'standard' });
  const g4 = resolveAudioBandwidthHz({ link: { kind: 'mic', tx: { fmPreset: 'sennheiser-skm100g4s' } } });
  assert.equal(g4.hz, 18000); assert.equal(g4.source, 'preset'); assert.equal(g4.confidence, 'sourced');
  const psm = resolveAudioBandwidthHz({ link: { kind: 'iem', tx: { fmPreset: 'shure-p9t' } }, stereo: true });
  assert.equal(psm.hz, 15000); assert.equal(psm.source, 'preset'); assert.equal(psm.confidence, 'sourced');
  assert.equal(resolveAudioBandwidthHz({ link: { kind: 'mic', tx: { audioBandwidthHz: 16000, fmPreset: 'sennheiser-skm100g4s' } } }).hz, 16000);
  assert.equal(resolveAudioBandwidthHz({ link: { kind: 'mic', tx: { audioBandwidthHz: 99999 } } }).hz, 18000); // out of range ignored
});

test('audioSpectrum with audioBandwidthHz: unchanged below the ceiling, steep roll-off above (hand: -(60 log2(f/fc) + 20) dB)', () => {
  const base = audioSpectrum({ kind: 'mic', nBins: 1001, fMaxHz: 20000 });
  const lim = audioSpectrum({ kind: 'mic', nBins: 1001, fMaxHz: 20000, audioBandwidthHz: 18000 });
  base.freqsHz.forEach((f, i) => {
    if (f <= 18000) assert.equal(lim.levelsDb[i], base.levelsDb[i]);
    else near(lim.levelsDb[i], Math.max(-90, base.levelsDb[i] - (60 * Math.log2(f / 18000) + 20)), 1e-9);
  });
  assert.equal(lim.audioBandwidthHz, 18000);
  assert.ok(lim.notes.some((n) => /Audio ceiling 18 kHz/.test(n)));
  assert.equal('audioBandwidthHz' in base, false);
  // stereo IEM keeps the 15 kHz cut unless an explicit higher ceiling is given
  const st = audioSpectrum({ kind: 'iem', stereo: true, nBins: 1001 });
  const st18 = audioSpectrum({ kind: 'iem', stereo: true, nBins: 1001, audioBandwidthHz: 18000 });
  const i16 = st.freqsHz.findIndex((f) => f >= 16000);
  assert.ok(st18.levelsDb[i16] > st.levelsDb[i16] + 10);
});

test('monoBasebandSpectrum: ceiling default 18 kHz for mic and mono IEM, 15 kHz for stereo IEM; gap to the tone key; bands and marker', () => {
  const m = monoBasebandSpectrum({ kind: 'mic' });
  assert.equal(m.audioCeilingKhz, 18);
  assert.deepEqual(m.bands.programme, [0.03, 18]);
  assert.deepEqual(m.bands.gap, [18, 32.768]);
  const tone = m.markers.find((x) => x.name === 'Tone key');
  assert.equal(tone.freqKhz, 32.768);
  assert.ok(m.notes.some((n) => /gap of 14\.8 kHz/.test(n)));
  assert.equal(monoBasebandSpectrum({ kind: 'iem' }).audioCeilingKhz, 18);
  const st = monoBasebandSpectrum({ kind: 'iem', stereo: true });
  assert.equal(st.audioCeilingKhz, 15);
  assert.equal(monoBasebandSpectrum({ kind: 'mic', audioBandwidthHz: 15000 }).audioCeilingKhz, 15);
  assert.equal(monoBasebandSpectrum({ kind: 'mic', audioBandwidthHz: 15000 }).bands.programme[1], 15);
  // programme content exists between 15 and 18 kHz for the 18 kHz mic, not for the 15 kHz one (level near the noise there)
  const idx = (r, f) => r.freqKhz.findIndex((x) => x >= f);
  const m15 = monoBasebandSpectrum({ kind: 'mic', audioBandwidthHz: 15000, nBins: 1024 });
  const m18 = monoBasebandSpectrum({ kind: 'mic', nBins: 1024 });
  const i = idx(m18, 17);
  assert.ok(m18.levelDb[i] > m15.levelDb[i]);
  // no gap marker when the tone is inside the ceiling
  assert.equal('gap' in monoBasebandSpectrum({ kind: 'mic', toneKeyKhz: 17, audioBandwidthHz: 18000 }).bands, false);
});

test('labels and captions come from the ceiling; scene accepts tx.audioBandwidthHz in 1000..22000 only', () => {
  assert.equal(audioBandLabel(18000), 'AUDIO 0-18 kHz');
  assert.equal(audioBandLabel(15000), 'AUDIO 0-15 kHz');
  assert.match(monoCaption(18000), /0 to 18 kHz/);
  const s = createDefaultScene();
  s.links[0].tx.audioBandwidthHz = 18000;
  assert.equal(validateScene(s).ok, true, validateScene(s).errors.join(';'));
  for (const bad of [500, 30000, NaN]) { const t = structuredClone(s); t.links[0].tx.audioBandwidthHz = bad; assert.equal(validateScene(t).ok, false, String(bad)); }
});
