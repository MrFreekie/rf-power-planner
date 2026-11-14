import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene } from '../js/model/scene.js';
import { txPresetOptions, powerOptionChoices, currentPowerOption, lowIntermodAvailable, txFigures, rxFigures, tuningHint, rxPresetChoices, isFmRxPreset, LOW_IM_LABEL } from '../js/ui/fmui.js';
import { setTxFmPreset, setTxPowerOption, setTxLowIntermod, setRxFmPreset, setImdTransmitterFm, addImdTransmitter } from '../js/actions.js';
import { lookup } from '../js/ui/glossary.js';
import { validateScene } from '../js/model/scene.js';

const mk = () => createStore(createDefaultScene());

test('fmui: picker lists None plus tx presets only; rx presets listed in receiver choices', () => {
  const o = txPresetOptions();
  assert.deepEqual(o[0], ['', 'None (custom)']);
  assert.ok(o.some(([id]) => id === 'sennheiser-skm5200ii'));
  assert.ok(!o.some(([id]) => id === 'shure-ur4d'));
  const r = rxPresetChoices();
  const fm = r.find(([id]) => id === 'shure-ur4d');
  assert.match(fm[1], /Shure UR4D/);
  assert.match(fm[1], /published specs/);
  assert.ok(isFmRxPreset('shure-ur4d') && !isFmRxPreset('mic-receiver-typical'));
});

test('fmui: SKM power options include the 10 mW low-intermod mode; low-intermod availability', () => {
  const c = powerOptionChoices('sennheiser-skm5200ii');
  assert.ok(c.some(([id, t]) => id === 'loi-10mw' && /low-intermod/.test(t)));
  assert.equal(lowIntermodAvailable('sennheiser-skm5200ii'), true);
  assert.equal(lowIntermodAvailable('nope'), false);
  assert.match(LOW_IM_LABEL, /assumed 6 dB benefit.*~30% more channels/);
});

test('fmui: figures carry a text confidence word', () => {
  const f = txFigures('shure-ur2');
  assert.ok(f.length >= 5);
  for (const x of f) assert.ok(x.word === 'assumed' || x.word === 'sourced');
  assert.ok(f.some((x) => x.assumed) );
  const r = rxFigures('shure-ur4d');
  assert.ok(r.some((x) => /Sensitivity/.test(x.label)));
  assert.ok(r.some((x) => x.assumed));
  assert.deepEqual(txFigures('shure-ur4d'), []);
});

test('fmui: tuning hint warns outside window and off grid, never throws', () => {
  assert.equal(tuningHint('sennheiser-skm5200ii', NaN), null);
  assert.equal(tuningHint('nope', 600), null);
  assert.equal(tuningHint('shure-ur2', 700).warn, false);
  assert.equal(tuningHint('shure-ur2', 100).warn, true);
  assert.match(tuningHint('sennheiser-skm5200ii', 600.003).text, /grid/);
});

test('actions: applying a Tx preset is one undo step; power option and low-intermod work; null clears', () => {
  const s = mk(); const id = s.getScene().links[0].id;
  const base = s.getScene().links[0].tx.powerDbm;
  assert.ok(setTxFmPreset(s, id, 'sennheiser-skm5200ii', { powerOptionId: 'loi-10mw' }) !== false);
  let tx = s.getScene().links[0].tx;
  assert.equal(tx.fmPreset, 'sennheiser-skm5200ii');
  assert.equal(tx.powerDbm, 10);
  assert.equal(currentPowerOption(s.getScene().links[0]), 'loi-10mw');
  assert.equal(validateScene(s.getScene()).ok ?? true, true);
  s.undo();
  assert.equal(s.getScene().links[0].tx.fmPreset, undefined);
  assert.equal(s.getScene().links[0].tx.powerDbm, base);
  s.redo();
  setTxPowerOption(s, id, 'hi-50mw');
  assert.ok(Math.abs(s.getScene().links[0].tx.powerDbm - 17) < 0.05);
  setTxLowIntermod(s, id, true);
  assert.equal(s.getScene().links[0].tx.lowIntermod, true);
  setTxFmPreset(s, id, null);
  tx = s.getScene().links[0].tx;
  assert.ok(!('fmPreset' in tx) && !('lowIntermod' in tx));
  assert.equal(setTxFmPreset(s, id, 'bogus'), setTxFmPreset(s, id, 'bogus'));
  assert.ok(!('fmPreset' in s.getScene().links[0].tx));
});

test('actions: FM rx preset sets rxPreset, sensitivity and squelch in one step', () => {
  const s = mk(); const id = s.getScene().links[0].id;
  setRxFmPreset(s, id, 'shure-ur4d');
  const rx = s.getScene().links[0].rx;
  assert.equal(rx.rxPreset, 'shure-ur4d');
  assert.equal(typeof rx.sensitivityDbm, 'number');
  assert.equal(rx.squelch.enabled, true);
  s.undo();
  assert.notEqual(s.getScene().links[0].rx.rxPreset, 'shure-ur4d');
});

test('actions: intermod transmitter preset and low-intermod flag', () => {
  const s = mk();
  const tid = addImdTransmitter(s);
  setImdTransmitterFm(s, tid, { fmPreset: 'sennheiser-skm5200ii', powerOptionId: 'loi-10mw' });
  let t = s.getScene().imd.transmitters.find((x) => x.id === tid);
  assert.equal(t.fmPreset, 'sennheiser-skm5200ii');
  assert.equal(t.powerDbm, 10);
  setImdTransmitterFm(s, tid, { lowIntermod: false });
  t = s.getScene().imd.transmitters.find((x) => x.id === tid);
  assert.equal(t.lowIntermod, false);
  setImdTransmitterFm(s, tid, { fmPreset: '' });
  t = s.getScene().imd.transmitters.find((x) => x.id === tid);
  assert.ok(!('fmPreset' in t));
});

test('glossary: FM terms are documented', () => {
  for (const k of ['SINAD', 'HiDyn', 'Tonekey', 'FM deviation', 'low-intermod']) assert.ok(lookup(k), k);
  assert.match(lookup('Tonekey').meaning, /32\.768/);
  assert.match(lookup('Tonekey').meaning, /19 kHz/);
});
