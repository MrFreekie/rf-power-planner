// Compression rows and analogue-vs-digital readout (pure helpers) on the model's contrast examples.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../js/examples.js';
import { solveLink } from '../js/model/rf.js';
import { modeReport } from '../js/model/digital-link.js';
import { compressionRows, modeContrast, budgetExtras } from '../js/ui/budgetExtras.js';
import { chainKindFields } from '../js/ui/chainFields.js';

const ex = (id) => EXAMPLES.find((e) => e.id === id).build().scene;
const solve = (sc) => solveLink(sc, sc.links[0]);

test('overloaded booster: summary warns and every active stage shows input, OP1dB, headroom and a level word', () => {
  const r = solve(ex('booster-overloaded-by-radio'));
  const rows = compressionRows(r.compression);
  assert.match(rows[0].value, /dB less gain/);
  assert.ok(rows.length >= 2);
  assert.ok(rows.slice(1).every((x) => /OP1dB .* headroom .*: (OK|HOT|COMPRESSED)$/.test(x.value)));
  assert.ok(rows.some((x) => /COMPRESSED|HOT/.test(x.value)));
  assert.ok(budgetExtras(r).some((x) => x.label === 'Booster compression'));
  assert.ok(r.warnings.some((w) => /compression|1 dB point/.test(w)));
});

test('filtered booster: no compression, rows say so or are absent', () => {
  const r = solve(ex('booster-filtered-before-radio'));
  const rows = compressionRows(r.compression);
  assert.ok(rows.length === 0 || /none/.test(rows[0].value));
  assert.deepEqual(compressionRows(null), []);
});

test('OP1dB is an editable field on active chain kinds', () => {
  assert.ok(chainKindFields('activesplitter').includes('op1dBDbm'));
});

test('mode contrast: weak analogue is gradual and noisy, digital falls off the cliff', () => {
  for (const [id, wantDigital] of [['analog-fm-weak-gradual', false], ['digital-weak-cliff', true]]) {
    const sc = ex(id), l = sc.links[0], r = solveLink(sc, l);
    const m = modeContrast(modeReport(r.inputPowerDbm, l));
    assert.equal(m.rows.length, 4);
    assert.match(m.rows[1].value, /audio SNR/);
    assert.match(m.rows[2].value, /frame errors/);
    assert.match(m.line, /gradually/);
    assert.match(m.line, /cliff/);
    assert.ok(m.rows.every((x) => x.severity && x.value));
    if (wantDigital) assert.match(m.line, /already fallen off the cliff/);
  }
  assert.equal(modeContrast(null), null);
});
