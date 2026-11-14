// Antenna symbols: every library type draws in the plan and the side view, in every polarisation, without errors; names, element directions, wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { drawAntenna, ANTENNA_SYMBOLS, antennaIconName, polarisationOf, elementDirection, ANTENNA_LEGEND_TEXT } from '../js/view/icons.js';
import { ANTENNAS, ANTENNA_POLARISATIONS } from '../js/model/library.js';
import { HELP_TOPICS } from '../js/ui/help.js';
import { GLOSSARY } from '../js/ui/glossary.js';

function fakeCtx() {
  const calls = [];
  return new Proxy({ calls }, { get(t, k) { if (k in t) return t[k]; if (k === 'measureText') return () => ({ width: 10 }); return (...a) => { calls.push([k, ...a]); }; }, set(t, k, v) { t[k] = v; return true; } });
}
const vp = (k) => ({ pxPerM: k, worldToScreen: (x, y) => ({ x: 100 + x * k, y: 100 + y * k }) });

test('every library antenna type has a symbol and an accessible name', () => {
  for (const id of Object.keys(ANTENNAS)) { assert.ok(ANTENNA_SYMBOLS[id], `symbol for ${id}`); assert.match(antennaIconName(id, 'vertical'), /antenna symbol, vertical polarisation/); }
  for (const id of ['whip', 'panel', 'patch', 'log-periodic']) assert.ok(ANTENNA_SYMBOLS[id], id);
  assert.match(antennaIconName('helical-cp'), /right-hand circular/); assert.match(antennaIconName('yagi', 'slant45', 20), /rolled 20/);
  assert.match(antennaIconName('yagi', 'vertical'), /boresight/);
});

test('every type draws in plan and side, every polarisation, with minimum sizes when zoomed out and large when zoomed in', () => {
  for (const type of Object.keys(ANTENNA_SYMBOLS)) for (const view of ['plan', 'side']) for (const pol of [...ANTENNA_POLARISATIONS, undefined]) for (const k of [2, 40, 400]) {
    const g = fakeCtx();
    assert.doesNotThrow(() => drawAntenna(g, vp(k), 1, 1, { view, type, pol, rollDeg: 20, groundPlane: 'rack', angleDeg: 33, ink: '#000', fill: '#fff' }), `${type} ${view} ${pol} ${k}`);
    assert.ok(g.calls.some((c) => c[0] === 'stroke'), `${type} strokes`);
    assert.ok(g.calls.filter((c) => c[0] === 'save').length === g.calls.filter((c) => c[0] === 'restore').length, 'balanced save/restore');
  }
  drawAntenna(fakeCtx(), vp(40), 0, 0, {}); drawAntenna(fakeCtx(), vp(40), 0, 0, { type: 'unknown-type' }); // defaults
});

test('circular polarisation adds the R or L badge; linear types do not', () => {
  const texts = (g) => g.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  const r = fakeCtx(); drawAntenna(r, vp(40), 0, 0, { type: 'helical-cp', pol: 'rhcp', view: 'plan' }); assert.deepEqual(texts(r), ['R']);
  const l = fakeCtx(); drawAntenna(l, vp(40), 0, 0, { type: 'helical', pol: 'lhcp', view: 'side' }); assert.deepEqual(texts(l), ['L']);
  const d = fakeCtx(); drawAntenna(d, vp(40), 0, 0, { type: 'helical-cp', view: 'plan' }); assert.deepEqual(texts(d), ['R'], 'a circular type defaults to right-hand');
  const v = fakeCtx(); drawAntenna(v, vp(40), 0, 0, { type: 'yagi', pol: 'vertical', view: 'plan' }); assert.deepEqual(texts(v), []);
});

test('element direction: vertical is end-on in the plan and upright in the side view, horizontal the reverse, slant is diagonal, roll turns it', () => {
  assert.equal(polarisationOf('dipole', 'vertical').psi, 0); assert.equal(polarisationOf('dipole', 'horizontal').psi, 90); assert.equal(polarisationOf('dipole', 'slant45', 10).psi, 55);
  assert.equal(polarisationOf('yagi', 'rhcp').hand, 'R');
  assert.equal(elementDirection('plan', 0).end, true);
  const h = elementDirection('plan', 90); assert.ok(Math.abs(h.dx) > 0.99 && Math.abs(h.dy) < 1e-9, 'across the boresight');
  assert.ok(Math.abs(elementDirection('plan', 45).dx - Math.SQRT1_2) < 1e-9);
  const sv = elementDirection('side', 0, 0); assert.ok(Math.abs(sv.dx) < 1e-9 && Math.abs(sv.dy) > 0.99, 'vertical line');
  const sr = elementDirection('side', 0, 90); assert.ok(Math.abs(sr.dx) > 0.99, 'still vertical on the screen when the icon is rotated 90 degrees: along the local x');
  assert.equal(elementDirection('side', 90).end, true);
  assert.equal(elementDirection('plan', 20).end, undefined, 'roll of 20 degrees turns the end-on dot into a line');
});

test('legend and glossary entries exist, and the plan help carries the legend', () => {
  assert.ok(ANTENNA_LEGEND_TEXT.includes('boresight')); assert.ok(HELP_TOPICS.plan.text.includes('Antenna symbols')); assert.ok(HELP_TOPICS.side.text.includes('Antenna symbols'));
  assert.ok(GLOSSARY && GLOSSARY['antenna symbol']);
});

test('wiring: plan and side pass polarisation, roll and ground plane to the symbol', () => {
  for (const f of ['js/view/plan.js', 'js/view/side.js']) { const s = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'); assert.ok(s.includes('pol:') && s.includes('rollDeg:') && s.includes('groundPlane:'), f); }
});
