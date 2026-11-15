// Frequency plan export. Hand anchors: 606.1 MHz is TV channel 38 in 6 MHz (UK/EU 8 MHz: 606 to 614 is channel 38 as well, see below), 14 dBm = 25.1 mW (10^1.4 = 25.12, 3 s.f.),
// Carson 2 (40 + 15) = 110 kHz, CSV quoting per RFC 4180, formula neutralisation per OWASP. Third-order anchors: 2 f1 - f2 with 606.0 and 606.4 = 605.6 exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene, createDefaultLink } from '../js/model/scene.js';
import { frequencyPlanRows, frequencyPlanCsv, frequencyPlanText, planSummary, coordinationSummary, csvCell, PLAN_COLUMNS } from '../js/model/plan-export.js';
import { digitalProfile, digitalConfigOf } from '../js/model/digital-link.js';
import { tvChannelOf } from '../js/model/spectrum-map.js';

function plan(freqs) {
  const s = createDefaultScene(); s.links = freqs.map((f, i) => { const l = createDefaultLink('mic'); l.name = `Mic ${i + 1}`; l.freqMHz = f; l.id = `L${i}`; return l; });
  return s;
}

test('rows: one per link plus one per IMD transmitter, with the hand-computed figures', () => {
  const s = plan([606.1]); s.links[0].tx.powerDbm = 14; s.imd.transmitters = [{ id: 'T1', name: 'Radio', freqMHz: 610, powerDbm: 20, pos: { x: 0, y: 0, z: 1 } }];
  const rows = frequencyPlanRows(s);
  assert.equal(rows.length, 2);
  const r = rows[0];
  assert.equal(r.role, 'mic'); assert.equal(r.freqMHz, 606.1); assert.equal(r.txPowerMw, 25.1); assert.equal(r.occupiedBwKHz, 110);
  assert.equal(r.tvChannel, tvChannelOf(606.1, 8).n); assert.ok(['pass', 'marginal', 'fail'].includes(r.status)); assert.ok(['proven', 'unproven'].includes(r.assumptionFlag));
  assert.ok(Number.isFinite(r.rxLevelDbm) && Number.isFinite(r.marginDb));
  assert.equal(rows[1].source, 'imd'); assert.equal(rows[1].txPowerMw, 100); assert.equal(rows[1].rxLevelDbm, null); assert.equal(rows[1].role, 'other');
});
test('TV channel follows the scene width: 6 MHz and 8 MHz give different numbers for the same carrier', () => {
  const a = plan([606.1]), b = plan([606.1]); b.tvChannelWidthMHz = 6;
  assert.equal(frequencyPlanRows(a)[0].tvChannel, tvChannelOf(606.1, 8).n); assert.equal(frequencyPlanRows(b)[0].tvChannel, tvChannelOf(606.1, 6).n);
  assert.notEqual(frequencyPlanRows(a)[0].tvChannel, frequencyPlanRows(b)[0].tvChannel);
});
test('digital link reports the preset occupied bandwidth, and a person name is attached', () => {
  const s = plan([606.1, 607]); s.links[1].modulation = { type: 'digital', digital: {} };
  s.people = [{ id: 'p1', name: 'Alex', micLinkId: 'L0' }];
  const rows = frequencyPlanRows(s);
  assert.equal(rows[0].personName, 'Alex'); assert.equal(rows[1].personName, '');
  assert.equal(rows[1].occupiedBwKHz, digitalProfile(digitalConfigOf(s.links[1])).occupiedBwKHz);
});

test('csvCell: quoting and escaping', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell('a;b', ';'), '"a;b"'); assert.equal(csvCell('a,b', ';'), 'a,b');
  assert.equal(csvCell(null), ''); assert.equal(csvCell(-45.5), '-45.5'); assert.equal(csvCell(NaN), '');
});
test('csvCell: formula injection is neutralised for = + - @ TAB CR, other text is untouched', () => {
  for (const bad of ['=SUM(A1)', '+1+1', '-2+3', '@cmd', '\tx', '\rx']) assert.ok(csvCell(bad).replace(/^"/, '').startsWith("'"), JSON.stringify(bad));
  assert.equal(csvCell('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`);
  assert.equal(csvCell('Mic = good'), 'Mic = good'); assert.equal(csvCell("'=x"), "'=x");
});
test('frequencyPlanCsv: header, CRLF, BOM, delimiter, hostile names', () => {
  const s = plan([606.1]); s.links[0].name = '=cmd|calc, "x"';
  const rows = frequencyPlanRows(s);
  const csv = frequencyPlanCsv(rows);
  const lines = csv.split('\r\n'); assert.equal(lines.length, 3); assert.equal(lines[2], '');
  assert.equal(lines[0], PLAN_COLUMNS.map((c) => c.label).join(',').replace(/^/, '')); // header labels contain no delimiter
  assert.ok(lines[1].startsWith(`"'=cmd|calc, ""x""",mic,606.1,`), lines[1]);
  assert.ok(frequencyPlanCsv(rows, { bom: true }).startsWith('﻿'));
  const semi = frequencyPlanCsv(rows, { delimiter: ';' }).split('\r\n')[1]; assert.ok(semi.startsWith(`"'=cmd|calc, ""x""";mic;606.1;`), semi);
  assert.equal(frequencyPlanCsv(rows, { delimiter: '"' }).split('\r\n')[0].split(',').length, PLAN_COLUMNS.length, 'a quote delimiter falls back to a comma');
  assert.equal(frequencyPlanCsv([], { header: false }), '\r\n');
});
test('frequencyPlanText: fixed width, every line the same column starts', () => {
  const t = frequencyPlanText(frequencyPlanRows(plan([606.1, 607.5])));
  const lines = t.trimEnd().split('\n'); assert.equal(lines.length, 4);
  const col2 = lines[0].indexOf('Role'); assert.ok(col2 > 0); assert.equal(lines[2].indexOf('mic'), col2); assert.equal(lines[3].indexOf('mic'), col2);
  assert.match(lines[1], /^-+ +-+/);
});

test('planSummary: counts and the passed-in date (never the clock)', () => {
  const s = plan([606.1, 607]); s.links.push(createDefaultLink('iem')); s.tvChannelWidthMHz = 6;
  const h = planSummary(s, { projectName: 'Show\u0007 A', date: '2026-11-15' });
  assert.deepEqual(h, { projectName: 'Show  A', date: '2026-11-15', tvChannelWidthMHz: 6, links: 3, mics: 2, iems: 1, other: 0, imdTransmitters: 0, people: 0 });
});

test('coordinationSummary: 606.0, 606.4, 605.6 MHz has two 2-tone hits and one 3-tone hit, spacing 400 kHz', () => {
  const c = coordinationSummary(plan([606.0, 606.4, 605.6]));
  assert.equal(c.frequencies, 3); assert.equal(c.hits2, 2); assert.equal(c.hits3, 1); assert.equal(c.hitsTotal, 3); assert.equal(c.distinctProducts.length, 3);
  assert.equal(c.minSpacingKHz, 400); assert.equal(c.ok, false);
});
test('coordinationSummary: a clean plan and overlap warnings', () => {
  const clean = coordinationSummary(plan([606.0, 607.3, 609.9]));
  assert.equal(clean.hitsTotal, 0); assert.equal(clean.ok, true); assert.equal(clean.overlapWarnings.length, 0);
  const over = coordinationSummary(plan([606.0, 606.1]));
  assert.equal(over.overlapWarnings.length, 1); assert.equal(over.minSpacingKHz, 100); assert.equal(over.ok, false);
  const one = coordinationSummary(plan([606])); assert.equal(one.minSpacingKHz, null); assert.equal(one.ok, true);
  assert.equal(coordinationSummary(plan([])).frequencies, 0);
});
