import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { presetOptions, presetFlag, FLAG_TEXT } from '../js/ui/chainFields.js';
import { CHAIN_PRESETS, CHAIN_PRESET_IDS } from '../js/model/chain-presets.js';
import { createChainItemFromPreset, validateScene, createDefaultScene } from '../js/model/scene.js';
import { createStore } from '../js/store.js';
import { addChainItem } from '../js/actions.js';
import { solveLink } from '../js/model/rf.js';
import { monoInputs, monoNotes } from '../js/view/spectraMono.js';
import { audioInputs } from '../js/view/spectra.js';

test('preset dropdown lists every preset after a blank prompt', () => {
  const o = presetOptions();
  assert.equal(o[0][0], ''); assert.equal(o.length, CHAIN_PRESET_IDS.length + 1);
  assert.ok(o.every(([v, t]) => typeof t === 'string' && t.length));
});

test('flags come from the preset and are S, I or U', () => {
  for (const id of CHAIN_PRESET_IDS) {
    const it = createChainItemFromPreset(id);
    for (const f of Object.keys(CHAIN_PRESETS[id].flags)) assert.match(presetFlag(it, f), /^[SIU]$/);
  }
  assert.equal(presetFlag({ kind: 'cable' }, 'lossDb'), null);
  assert.ok(FLAG_TEXT.S && FLAG_TEXT.I && FLAG_TEXT.U);
});

test('adding a preset item keeps presetId and validates; DC warnings reach solveLink', () => {
  const s = createStore(createDefaultScene()); const id = s.getScene().links[0].id;
  for (const p of CHAIN_PRESET_IDS) assert.ok(addChainItem(s, id, createChainItemFromPreset(p)), p);
  assert.equal(s.getScene().links[0].chain.some((c) => c.presetId === 'biastee'), true);
  assert.equal(validateScene(s.getScene()).ok, true);
  const r = solveLink(s.getScene(), s.getScene().links[0]);
  assert.ok(Array.isArray(r.warnings));
});

test('mono view uses the model audio band, not a hard-coded 15 kHz', () => {
  const l = createDefaultScene().links[0];
  const inp = monoInputs(l, null, null, 0);
  assert.ok(Number.isFinite(inp.audioBandwidthHz));
  assert.ok(Number.isFinite(audioInputs(l, null, 0).audioBandwidthHz));
  assert.match(monoNotes({ audioBandwidthHz: 12000, notes: [] })[0], /0 to 12 kHz/);
  assert.doesNotMatch(fs.readFileSync(new URL('../js/view/spectraMono.js', import.meta.url), 'utf8'), /AUDIO 0-15 kHz/);
});

test('RF view subcarriers: tone key and data from the mono model, below the carrier, none without a model result', async () => {
  const { rfSubcarriers, monoInputs } = await import('../js/view/spectraMono.js');
  const { monoBasebandSpectrum } = await import('../js/model/spectrum-views.js');
  const l = createDefaultScene().links[0]; l.telemetry = { ...(l.telemetry || {}), enabled: true };
  const m = monoBasebandSpectrum(monoInputs(l, null, null, 0, 120));
  const subs = rfSubcarriers(m, 40, -50);
  assert.ok(subs.some((s) => s.name === 'tone key' && Math.abs(s.offsetKhz - 32.768) < 1e-6));
  assert.ok(subs.some((s) => s.name === 'data'));
  assert.ok(subs.every((s) => s.levelDbm < -50 && Number.isFinite(s.levelDbm)));
  assert.deepEqual(rfSubcarriers(null, 40, -50), []);
  assert.deepEqual(rfSubcarriers(m, NaN, -50), []);
});
