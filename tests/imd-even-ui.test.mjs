// Even-order intermod GUI: the scene actions (IIP2/IIP4, bands, filters, harmonics) and their effect on evenOrderImd.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStore } from '../js/store.js';
import { setImdIntercept, setImdFilter, addImdBand, updateImdBand, removeImdBand, setImdHarmonic } from '../js/actionsAreas.js';
import { evenOrderImd } from '../js/model/imd.js';
import { EXAMPLES } from '../js/examples.js';
import { validateScene } from '../js/model/scene.js';

const mk = () => createStore(EXAMPLES.find((e) => e.id === 'even-wideband-booster').build().scene);

test('intercepts: set, clamp, clear, and a higher IIP2 lowers the product levels', () => {
  const st = mk();
  const worst = () => evenOrderImd(st.getScene()).worst.levelDbm;
  const before = worst();
  setImdIntercept(st, 'iip2Dbm', 50); assert.equal(st.getScene().imd.iip2Dbm, 50);
  assert.ok(worst() < before - 15, '2 dB per dB of IIP2');
  setImdIntercept(st, 'iip2Dbm', 999); assert.equal(st.getScene().imd.iip2Dbm, 200);
  setImdIntercept(st, 'iip4Dbm', 60); assert.equal(st.getScene().imd.iip4Dbm, 60);
  setImdIntercept(st, 'iip4Dbm', null); assert.equal(st.getScene().imd.iip4Dbm, undefined);
  assert.equal(setImdIntercept(st, 'bogus', 1), false);
  assert.equal(validateScene(st.getScene()).ok, true);
});

test('bands: add up to 16, edit, remove; products can land in them', () => {
  const st = mk();
  for (let i = 0; i < 20; i++) addImdBand(st, { name: `b${i}`, loMHz: 1000 + i, hiMHz: 1010 + i });
  assert.equal(st.getScene().imd.bands.length, 16);
  assert.equal(addImdBand(st), false, 'the cap is reported');
  updateImdBand(st, 0, { loMHz: 1200, hiMHz: 1100 }); const b = st.getScene().imd.bands[0]; assert.ok(b.hiMHz > b.loMHz);
  updateImdBand(st, 0, { name: 'IEM 1.2 GHz' }); assert.equal(st.getScene().imd.bands[0].name, 'IEM 1.2 GHz');
  removeImdBand(st, 0); assert.equal(st.getScene().imd.bands.length, 15);
  const st2 = mk(); addImdBand(st2, { name: 'x', loMHz: 1190, hiMHz: 1210 });
  assert.equal(evenOrderImd(st2.getScene()).products.length > 0, true);
});

test('filters: a bandpass before or after the stage is set, patched, kept valid and cleared', () => {
  const st = mk();
  setImdFilter(st, 'filterBefore', {}); const f = st.getScene().imd.filterBefore; assert.ok(f.passHiMHz > f.passLoMHz && f.rejectionDb === 40);
  setImdFilter(st, 'filterBefore', { passLoMHz: 500, passHiMHz: 700, rejectionDb: 60 });
  const g = st.getScene().imd.filterBefore; assert.deepEqual([g.passLoMHz, g.passHiMHz, g.rejectionDb], [500, 700, 60]);
  setImdFilter(st, 'filterAfter', { passLoMHz: 800, passHiMHz: 100 }); const a = st.getScene().imd.filterAfter; assert.ok(a.passHiMHz > a.passLoMHz);
  setImdFilter(st, 'filterBefore', null); assert.equal(st.getScene().imd.filterBefore, undefined);
  assert.equal(setImdFilter(st, 'nope', {}), false);
});

test('harmonics: per-transmitter level and filter change the radiated second harmonic', () => {
  const sc = EXAMPLES.find((e) => e.id === 'even-second-harmonic').build().scene, st = createStore(sc), t = sc.imd.transmitters[0];
  const lvl = () => evenOrderImd(st.getScene()).harmonics[0].levelDbm;
  const base = lvl();
  setImdHarmonic(st, t.id, { harmonicFilterDb: 30 }); assert.ok(lvl() < base - 25);
  setImdHarmonic(st, t.id, { h2Dbc: 500 }); assert.equal(st.getScene().imd.transmitters[0].h2Dbc, 200);
  setImdHarmonic(st, t.id, { h2Dbc: null, harmonicFilterDb: null }); assert.equal(st.getScene().imd.transmitters[0].h2Dbc, undefined);
});

test('wiring: the inspector and the IMD panel use the even-order actions and table', () => {
  const insp = fs.readFileSync(new URL('../js/ui/inspector.js', import.meta.url), 'utf8'), view = fs.readFileSync(new URL('../js/view/imd.js', import.meta.url), 'utf8');
  for (const k of ["'imd-iip2'", "'imd-iip4'", "'imd-band-add'", 'imd-${which}-rej', "k('h2')", "k('hf')"]) assert.ok(insp.includes(k), k);
  assert.ok(view.includes('evenOrderImd(scene)') && view.includes('Even-order products'));
});
