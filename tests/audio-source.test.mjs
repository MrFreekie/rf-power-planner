// Global audio source (item 31): catalogue, defaults unchanged, every consumer follows the id, validation, crest factors, stereo pair.
// Golden numbers in the "defaults unchanged" test were produced by the pre-catalogue code (git HEAD 0493c06) and are compared to 1e-9 dB.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_SOURCE_IDS, AUDIO_SOURCES, defaultAudioSource, resolveAudioSource, normalizeAudioSource, clipFraction, clipFractionGaussian, clipFractionSine,
  levelGenerator, modulationTones, sweepHz, sourceSpectrumDb, programmeProfile, resolveToneHz,
} from '../js/model/audio-source.js';
import { createAudioSource, createStereoSource, AUDIO_KINDS } from '../js/model/audio.js';
import { audioSpectrum, monoBasebandSpectrum, clipFractionFromOverdrive, distortionFromLink } from '../js/model/spectrum-views.js';
import { mpxSpectrum } from '../js/model/mpx.js';
import * as M from '../js/model/modulation-demo.js';
import { createDefaultScene, validateScene, serialize, deserialize } from '../js/model/scene.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);
const sum = (a) => a.reduce((s, v) => s + v, 0);

test('catalogue: the twelve ids, each with label, note, level statistics, crest factor and the assumed flag', () => {
  assert.deepEqual([...AUDIO_SOURCE_IDS], ['voice', 'singing', 'music', 'bass-heavy', 'acoustic', 'drums', 'pink', 'white', 'tone', 'two-tone', 'sweep', 'silence']);
  for (const id of AUDIO_SOURCE_IDS) {
    const s = AUDIO_SOURCES[id];
    assert.ok(s.label && s.note, id); assert.equal(s.flag, 'U');
    near(s.crestDb, s.peakDb - s.rmsDb, 1e-12, id);
    assert.ok(s.phrasing.duty >= 0 && s.phrasing.duty <= 1);
  }
  assert.equal(normalizeAudioSource('speech'), 'voice'); assert.equal(normalizeAudioSource('off'), 'silence'); assert.equal(normalizeAudioSource('nope'), null);
});

test('crest factors: tone and sweep 3.01 dB (sine), two-tone 6.02 dB (two equal sines), voice 16, music 14, drums 19', () => {
  near(AUDIO_SOURCES.tone.crestDb, 3.0103, 1e-3); near(AUDIO_SOURCES.sweep.crestDb, 3.0103, 1e-3); near(AUDIO_SOURCES['two-tone'].crestDb, 6.0206, 1e-3);
  assert.equal(AUDIO_SOURCES.voice.crestDb, 16); assert.equal(AUDIO_SOURCES.music.crestDb, 14); assert.equal(AUDIO_SOURCES.drums.crestDb, 19);
  // the source's own meter generator quotes the same figures while active
  near(levelGenerator('tone')(1).peakDb - levelGenerator('tone')(1).rmsDb, 3.0103, 1e-3);
  assert.ok(AUDIO_SOURCES.drums.crestDb > AUDIO_SOURCES['bass-heavy'].crestDb);
});

test('defaults by link kind: mic voice, IEM music; scene.audioSource wins; unknown or absent falls back', () => {
  assert.equal(defaultAudioSource('mic'), 'voice'); assert.equal(defaultAudioSource('iem'), 'music');
  assert.equal(resolveAudioSource({}, { kind: 'iem' }), 'music'); assert.equal(resolveAudioSource({ audioSource: 'drums' }, { kind: 'iem' }), 'drums');
  assert.equal(resolveAudioSource({ audioSource: 'bogus' }, { kind: 'mic' }), 'voice');
  assert.equal(resolveToneHz({}), 1000); assert.equal(resolveToneHz({ audioToneHz: 5 }), 20); assert.equal(resolveToneHz({ audioToneHz: 19000 }), 19000);
});

// Golden values from the pre-catalogue code. No audioSource means exactly the old result for both link kinds.
test('no audioSource: every consumer matches the pre-catalogue results for mic and IEM', () => {
  const golden = {
    audMic: -16888.32004594009, audIem: [-14502.724689253799, -13390.16047541556], monoMic: -9554.549580927684, monoIem: -9795.426862725215,
    clip6: 0.12999438157256116, clip20: 0.761477357607018, mpx: -4555.65199398122,
  };
  near(sum(audioSpectrum({ kind: 'mic', t: 3.7 }).levelsDb), golden.audMic, 1e-6);
  const ai = audioSpectrum({ kind: 'iem', stereo: true, t: 3.7 });
  near(sum(ai.levelsDb), golden.audIem[0], 1e-6); near(sum(ai.levelsDbR), golden.audIem[1], 1e-6);
  near(sum(monoBasebandSpectrum({ kind: 'mic', stereo: false, t: 1.2 }).levelDb), golden.monoMic, 1e-6);
  near(sum(monoBasebandSpectrum({ kind: 'iem', stereo: false, t: 1.2 }).levelDb), golden.monoIem, 1e-6);
  near(clipFractionFromOverdrive(6), golden.clip6, 1e-12); near(clipFractionFromOverdrive(20), golden.clip20, 1e-12);
  near(sum(mpxSpectrum({ cnrDb: 40, blend: 1, pilotLevelDb: -21 }, { points: 256 }).levelDb), golden.mpx, 1e-6);
  const g = createAudioSource({ kind: 'speech', seed: 4 });
  near(g.level(1.3).rmsDb, -45.72787575672919, 1e-9); near(g.level(7.9).peakDb, -27.341190102761175, 1e-9);
  const st = createStereoSource({ kind: 'speech', seed: 4 });
  near(st.l(2).rmsDb, -45.14947637532896, 1e-9); near(st.r(2).peakDb, -35.51228922408336, 1e-9);
  near(M.message('speech', 1.7), -0.36620134536127874, 1e-12); near(M.message('twotone', 0.4), -0.21101387050171533, 1e-12); near(M.message('sine', 0.9), -0.9510565162951535, 1e-12);
  // an explicit default id is the same as no id
  near(sum(audioSpectrum({ kind: 'mic', t: 3.7, source: 'voice' }).levelsDb), golden.audMic, 1e-6);
  near(sum(audioSpectrum({ kind: 'iem', stereo: true, t: 3.7, source: 'music' }).levelsDb), golden.audIem[0], 1e-6);
  near(clipFractionFromOverdrive(6, 'voice') - golden.clip6, clipFractionGaussian(6, 16) - golden.clip6, 1e-12);
});

test('changing the id changes every consumer: audio spectrum, baseband, MPX programme, meters, clip, modulation lab', () => {
  const ids = ['voice', 'music', 'drums', 'white', 'tone'];
  const key = (f) => ids.map((id) => f(id).toFixed(6));
  const distinct = (arr) => assert.equal(new Set(arr).size, arr.length, arr.join(' '));
  distinct(key((id) => sum(audioSpectrum({ kind: 'mic', t: 2, source: id }).levelsDb)));
  distinct(key((id) => sum(monoBasebandSpectrum({ kind: 'mic', t: 2, source: id }).levelDb)));
  distinct(key((id) => sum(mpxSpectrum({ cnrDb: 40, blend: 0, pilotLevelDb: -21 }, { points: 256, programme: { source: id, t: 2 } }).levelDb)));
  distinct(key((id) => levelGenerator(id, 1)(2.1).rmsDb + levelGenerator(id, 1)(2.1).peakDb / 7));
  distinct(key((id) => createAudioSource({ kind: id, seed: 1 }).level(2.1).rmsDb + createAudioSource({ kind: id, seed: 1 }).level(2.1).peakDb / 7));
  distinct(key((id) => clipFractionFromOverdrive(6, id)));
  distinct(key((id) => sum(modulationTones(id).map((o) => o.a * o.f))));
  assert.equal(audioSpectrum({ kind: 'mic', source: 'drums' }).source, 'drums');
  assert.equal(monoBasebandSpectrum({ kind: 'mic', source: 'drums' }).source, 'drums');
  assert.equal(mpxSpectrum({ cnrDb: 40 }, { programme: { source: 'drums' } }).programmeSource, 'drums');
  // silence shows only the floor; a tone shows one line
  const sil = audioSpectrum({ kind: 'mic', source: 'silence' });
  assert.ok(Math.max(...sil.levelsDb) <= -85);
  const tn = audioSpectrum({ kind: 'mic', source: 'tone', toneHz: 2000, nBins: 401, fMaxHz: 20000 });
  near(tn.peakHz, 2000, 50); near(Math.max(...tn.levelsDb), -18 + 1.5, 1.6); // -18 dBFS line, +-1.5 dB fine fluctuation
  // the sweep line moves with time: at t = 0 it is 20 Hz, a decade-per-fifth of the period later 20 * 1000^0.5 Hz
  near(sweepHz(0), 20, 1e-9); near(sweepHz(10), 20 * Math.sqrt(1000), 1e-9); near(sweepHz(20), 20, 1e-9);
  assert.ok(audioSpectrum({ kind: 'mic', source: 'sweep', t: 10, nBins: 801 }).peakHz > 500 && audioSpectrum({ kind: 'mic', source: 'sweep', t: 10, nBins: 801 }).peakHz < 800);
});

test('overload distortion uses the source crest factor: sine clip hand value 2/3 at 6.02 dB, drums clips less than white noise at the same overdrive (higher crest factor)', () => {
  near(clipFractionSine(20 * Math.log10(2)), 1 - (2 / Math.PI) * Math.asin(0.5), 1e-12); // 1 - 1/3 = 2/3
  near(clipFraction('tone', 20 * Math.log10(2)), 2 / 3, 1e-12);
  assert.equal(clipFraction('tone', 0), 0); assert.equal(clipFraction('silence', 12), 0);
  // Gaussian with crest 9.54 dB is the original; a higher crest factor clips less at the same overdrive from the peak
  near(clipFractionGaussian(6), 0.12999438157256116, 1e-12);
  assert.ok(clipFractionGaussian(6, 19) < clipFractionGaussian(6, 9.54));
  assert.ok(clipFraction('drums', 6) < clipFraction('white', 6));
  assert.ok(clipFraction('two-tone', 6) > 0 && clipFraction('two-tone', 6) < 1); assert.equal(clipFraction('two-tone', 0), 0);
  let prev = 0; for (let od = 0; od <= 30; od++) { const c = clipFraction('music', od); assert.ok(c >= prev); prev = c; }
  const a = distortionFromLink({ txOverdriveDb: 6 }), b = distortionFromLink({ txOverdriveDb: 6, audioSource: 'tone' });
  near(a.clipFraction, 0.12999438157256116, 1e-12); near(b.clipFraction, clipFractionSine(6), 1e-12);
  assert.notEqual(a.clipFraction, b.clipFraction); assert.ok(b.notes.some((n) => n.includes('Tone')));
});

test('stereo pair: music has different L and R spectra and meters; tone is -18 / -24 dBFS; silence is the floor', () => {
  const a = audioSpectrum({ kind: 'iem', stereo: true, source: 'music', t: 1 });
  assert.notEqual(sum(a.levelsDb), sum(a.levelsDbR));
  const st = createStereoSource({ kind: 'music', seed: 2 });
  assert.notEqual(st.l(3).rmsDb, st.r(3).rmsDb);
  const tn = createStereoSource({ kind: 'tone' });
  assert.equal(tn.l(0).rmsDb, -18); assert.equal(tn.r(0).rmsDb, -24);
  assert.equal(createStereoSource({ kind: 'silence' }).l(1).rmsDb, -90);
  for (const k of AUDIO_KINDS) { const s = createStereoSource({ kind: k, seed: 1 }); assert.ok(Number.isFinite(s.l(1).rmsDb) && Number.isFinite(s.r(1).peakDb), k); }
});

test('modulation lab: catalogue ids are message kinds, sine / twotone / speech keep their tones, silence is zero, all peak-normalised', () => {
  assert.deepEqual([...M.MESSAGE_KINDS], ['sine', 'twotone', 'speech']);
  assert.deepEqual(M.messageTones('sine').map((o) => o.a), [1]);
  for (const id of M.MESSAGE_SOURCE_KINDS) {
    let pk = 0; for (let i = 0; i < 5000; i++) pk = Math.max(pk, Math.abs(M.message(id, i * 0.01)));
    assert.ok(pk <= 1.01 && pk > 0.8, `${id} peak ${pk}`);
  }
  assert.equal(M.message('silence', 0.7), 0);
  assert.equal(M.messageKindFor('tone'), 'sine'); assert.equal(M.messageKindFor('voice'), 'speech'); assert.equal(M.messageKindFor('drums'), 'drums');
  assert.equal(M.messageTones('speech').length, modulationTones('voice').length); // speech is the voice list, normalised
});

test('programme profile: peak 0 dB for continuous sources, one line for a tone, two lines 1.5 f apart for two-tone', () => {
  const p = programmeProfile('music', { t: 0 });
  let mx = -Infinity; for (let k = 0; k < 400; k++) mx = Math.max(mx, p.relDb(20 * Math.pow(750, k / 400)));
  near(mx, 0, 0.5);
  assert.equal(programmeProfile('tone', { toneHz: 3000 }).lines[0].fHz, 3000);
  assert.deepEqual(programmeProfile('two-tone', { toneHz: 2000 }).lines.map((l) => l.fHz), [2000, 3000]);
  assert.ok(sourceSpectrumDb('pink', 200) - sourceSpectrumDb('pink', 400) > 2.9 && sourceSpectrumDb('pink', 200) - sourceSpectrumDb('pink', 400) < 3.1); // -3 dB per octave
  assert.equal(sourceSpectrumDb('white', 100), sourceSpectrumDb('white', 10000));
});

test('scene.audioSource: validated, optional, absent for old files, survives a round trip, tone frequency bounded', () => {
  const s = createDefaultScene();
  assert.equal(s.audioSource, undefined); assert.equal(validateScene(s).ok, true);
  for (const id of AUDIO_SOURCE_IDS) { const t = createDefaultScene(); t.audioSource = id; assert.equal(validateScene(t).ok, true, id); }
  for (const bad of ['loud', 5, {}, 'VOICE']) { const t = createDefaultScene(); t.audioSource = bad; assert.equal(validateScene(t).ok, false, String(bad)); }
  const t = createDefaultScene(); t.audioSource = 'tone'; t.audioToneHz = 15000; assert.equal(validateScene(t).ok, true);
  for (const bad of [10, 30000, 'x', NaN]) { const u = createDefaultScene(); u.audioToneHz = bad; assert.equal(validateScene(u).ok, false, String(bad)); }
  const r = deserialize(serialize(t)); assert.equal(r.audioSource, 'tone'); assert.equal(r.audioToneHz, 15000);
  const old = deserialize(serialize(createDefaultScene())); assert.equal(old.audioSource, undefined);
  const lk = createDefaultScene(); lk.links[0].audio = { source: 'drums', gainDb: 0 }; assert.equal(validateScene(lk).ok, true); // meters accept catalogue ids too
});
