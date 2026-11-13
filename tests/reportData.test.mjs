import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene } from '../js/model/scene.js';
import { buildReportData, DISCLAIMER } from '../js/reportData.js';
import { solveLink } from '../js/model/rf.js';
import { buildExample } from '../js/examples.js';
import { createSquelchTracker } from '../js/squelchTracker.js';
import { createRxTracker } from '../js/rxTracker.js';
import { coverageGrid, zoneStats, zoneRequirement } from '../js/model/coverage.js';
import { analyse } from '../js/imdTracker.js';

const NOW = '2026-11-13T10:00:00Z';

test('default scene: title, date, scenario, assumptions, waterfall rows, margin, disclaimer', () => {
  const s = createDefaultScene();
  const r = buildReportData(s, s.links[0].id, { now: NOW });
  assert.equal(r.title, 'Link budget: Mic 1');
  assert.equal(r.date, '2026-11-13');
  assert.equal(r.disclaimer, DISCLAIMER);
  assert.match(r.disclaimer, /^Planning estimates only/);
  const labels = r.scenario.map((x) => x.label);
  for (const k of ['Link', 'Frequency', 'Transmitter', 'Receiver', 'Distance', 'Stage', 'Chain']) assert.ok(labels.includes(k), k);
  assert.ok(r.assumptions.some((a) => /two-ray/.test(a)));
  assert.ok(r.assumptions.some((a) => /Body loss/.test(a) && /0 dB total/.test(a)));
  assert.ok(r.assumptions.some((a) => /600 MHz/.test(a)));
  const res = solveLink(s, s.links[0]);
  assert.equal(r.waterfall.length, res.waterfall.length);
  assert.equal(r.waterfall[0].label, res.waterfall[0].label);
  assert.ok(typeof r.waterfall[0].valueText === 'string' && typeof r.waterfall[0].deltaText === 'string');
  assert.equal(r.margin.status, res.status);
  assert.equal(r.margin.marginDb, res.marginDb);
  assert.match(r.margin.text, /margin/);
  assert.deepEqual(r.warnings.filter((w) => w.kind === 'margin'), []);
  assert.deepEqual(r.zones, []);
  assert.deepEqual(r.intermod, []);
});

test('units and body loss feed the text; free space is described as such', () => {
  const s = createDefaultScene();
  s.units = { power: 'mW', length: 'ft' };
  s.environment.model = 'free-space';
  s.environment.bodyLossDb = 3;
  s.links[0].rx.bodyLossDb = 2;
  const r = buildReportData(s, s.links[0].id, { now: new Date('2026-01-02T00:00:00Z') });
  assert.ok(r.assumptions.some((a) => /free space/.test(a)));
  assert.ok(r.assumptions.some((a) => /5 dB total/.test(a)));
  assert.ok(r.assumptions.some((a) => /ft/.test(a) && /mW/.test(a)));
  assert.match(r.scenario.find((x) => x.label === 'Distance').value, /ft/);
  assert.equal(r.date, '2026-01-02');
});

test('failing and marginal links raise margin warnings', () => {
  const ex = buildExample('cascade-booster-rack');
  const r = buildReportData(ex.scene, ex.scene.links[0].id, { now: NOW });
  assert.equal(r.margin.status, 'fail');
  assert.ok(r.warnings.some((w) => w.kind === 'margin' && w.severity === 'critical'));
  assert.ok(r.assumptions.some((a) => /system noise figure \+?28\.\d/.test(a)));
  const m = buildExample('long-cable');
  const rm = buildReportData(m.scene, m.scene.links[0].id, { now: NOW });
  assert.ok(rm.warnings.some((w) => w.kind === 'margin' && w.severity === 'warning'));
});

test('warnings from the trackers: squelch, overload, zones, coverage resolution, intermod', () => {
  // overload
  const ov = buildExample('overload-at-antenna');
  const st = createStore(ov.scene);
  const sq = createSquelchTracker(), rx = createRxTracker();
  rx.install(sq); sq.attach(st);
  const id = ov.scene.links[0].id;
  const r1 = buildReportData(ov.scene, id, { rx: rx.get(id), squelch: sq.get(id), now: NOW });
  assert.ok(r1.warnings.some((w) => w.kind === 'overload' && w.severity === 'critical'));
  // zones
  const z = buildExample('wall-thickness');
  const l = z.scene.links[0];
  const g = coverageGrid(z.scene, l.id, { cellM: 0.5, mode: 'power', rxHeight: 1.5 });
  const zones = z.scene.zones.map((zone) => { const rq = zoneRequirement(z.scene, l, zone); return { zoneId: zone.id, stats: zoneStats(g, zone, rq.squelchThresholdDbm, rq.appliedMarginDb), requirement: rq }; });
  const r2 = buildReportData(z.scene, l.id, { coverage: { zones, undersampled: true, fineCoverage: 'zones-only' }, now: NOW });
  assert.equal(r2.zones.length, 2);
  assert.equal(r2.zones[0].name, 'Behind the thin wall');
  assert.equal(r2.zones[0].pass, true);
  assert.equal(r2.zones[1].pass, false);
  assert.ok(r2.warnings.some((w) => w.kind === 'zone' && /thick wall/.test(w.text)));
  assert.ok(r2.warnings.some((w) => w.kind === 'coverage' && /quarter wavelength/.test(w.text)));
  assert.ok(r2.warnings.some((w) => w.kind === 'coverage' && /zones only/.test(w.text)));
  // intermod
  const im = buildExample('imd-too-close');
  const a = analyse(im.scene);
  const r3 = buildReportData(im.scene, im.scene.links[0].id, { imd: a, now: NOW });
  assert.ok(r3.intermod.length > 0);
  assert.ok(r3.intermod.every((x) => typeof x.text === 'string' && typeof x.ciDb === 'number'));
  assert.ok(r3.warnings.some((w) => w.kind === 'intermod' && /noise floor/.test(w.text)));
});

test('never throws: missing link, broken scene, unsolvable link', () => {
  const s = createDefaultScene();
  s.links = [];
  const r = buildReportData(s, 'nope', {});
  assert.equal(r.warnings[0].kind, 'error');
  assert.equal(r.disclaimer, DISCLAIMER);
  const t = createDefaultScene();
  t.links[0].tx.pos = null; // makes the solver throw
  const r2 = buildReportData(t, t.links[0].id, { now: 'not a date' });
  assert.ok(r2.warnings.some((w) => w.kind === 'error'));
  assert.match(r2.date, /^\d{4}-\d{2}-\d{2}$/);
});
