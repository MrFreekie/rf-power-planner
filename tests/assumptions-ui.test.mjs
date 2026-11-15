// Assumptions chip and report block (pure view model).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../js/examples.js';
import { solveLink } from '../js/model/rf.js';
import { confidenceView, chipText, assumptionRows, reportAssumptions } from '../js/ui/assumptionsUi.js';
import { buildReportData } from '../js/reportData.js';

const sc = (id) => EXAMPLES.find((e) => e.id === id).build().scene;

test('booster overload lists the compression and noise figures with flag words, effect and fix', () => {
  const s = sc('booster-overloaded-by-radio'), l = s.links[0], r = solveLink(s, l);
  const v = confidenceView(s, l, r);
  assert.ok(v.items.length >= 1);
  const rows = assumptionRows(v.items, s);
  for (const x of rows) { assert.match(x.flagText, /^[UI]: /); assert.ok(x.effect && x.fix && x.links.length); }
  assert.ok(rows.some((x) => /compression|Noise-source|OP1dB|booster/i.test(x.label)));
  assert.ok(v.chip.length > 0);
});

test('chip wording: unproven body-worn under 10 dB, negative margin, proven', () => {
  assert.equal(chipText({ proven: false, marginDb: 6, bodyWorn: true, sumSensitivityDb: 2, items: [] }), 'Margin unproven: body-worn, under 10 dB');
  assert.match(chipText({ proven: false, marginDb: -3, items: [] }), /does not pass/);
  assert.match(chipText({ proven: false, marginDb: 12, bodyWorn: false, sumSensitivityDb: 15, items: [1] }), /up to 15\.0 dB/);
  assert.match(chipText({ proven: true, marginDb: 30, sumSensitivityDb: 3, items: [1, 2] }), /holds against 2 assumed figures/);
  assert.equal(chipText(null), '');
});

test('report data carries the section: verdict, rows for the whole scene', () => {
  const s = sc('band-four-piece-people'), l = s.links[0], r = solveLink(s, l);
  const a = reportAssumptions(s, l, r);
  assert.ok(a && typeof a.verdict === 'string' && Array.isArray(a.rows));
  const data = buildReportData(s, l.id, { link: r });
  assert.ok(data.assumptionsInUse && data.assumptionsInUse.verdict);
  assert.equal(confidenceView(null, l, r), null);
});
