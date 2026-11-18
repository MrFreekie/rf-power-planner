// Side-of-stage IEM versus mic receiver examples: coupling, receiver level, desense. Receiver figures are the illustrative preset (assumed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sosScene, sosReport, EXAMPLES } from '../js/examples.js';
import { validateScene } from '../js/model/scene.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);
const f1 = (x) => x.toFixed(1);
const R = Object.fromEntries(['too-close', 'crossed-pol', 'best'].map((id) => [id, sosReport(sosScene(id))]));
const note = (id) => EXAMPLES.find((e) => e.id === id).note;

test('hand check: 0.5 m, two 7 dBi paddles facing each other, 614 MHz: FSPL 21.9 dB - 14 dBi = 7.9 dB (tol 0.6 for the pattern shape)', () => {
  const fspl = 20 * Math.log10((4 * Math.PI * 0.5) / (299792458 / 614e6));
  near(R['too-close'].antennas[0].couplingDb, fspl - 14, 0.6);
});

test('too close: receiver input far above P1dB and max input, overload, desense at its cap, margin collapses', () => {
  const a = R['too-close'].antennas[0];
  assert.equal(a.level, 'overload');
  near(a.atRxInputDbm, 20 - a.couplingDb + 12 - 1.5, 1.5); // booster +12, cable loss about 1 dB
  assert.ok(a.headroomDb < -30);
  assert.ok(a.desenseDb >= 39.9);
  assert.ok(a.wantedMarginDb - a.marginAfterDesenseDb >= 39.9);
  assert.ok(R['too-close'].worstProductDbm > 0);
});

test('crossed polarisation, off-axis and rack: tens of dB more isolation, receiver ok, no desense', () => {
  const a = R['crossed-pol'].antennas[0], b = R['too-close'].antennas[0];
  assert.ok(a.couplingDb - b.couplingDb > 35); // 100 degree paddles: about 39 dB
  assert.equal(a.level, 'ok'); assert.equal(a.desenseDb, 0);
  assert.ok(a.headroomDb > 10);
  // the wanted-mic antenna is slant 45 (3 dB to the vertical transmitter); a horizontal one would add about 15 dB of isolation
  const s = sosScene('crossed-pol'); s.links[0].rx.antenna.polarisation = 'horizontal';
  near(sosReport(s).antennas[0].couplingDb - R['crossed-pol'].antennas[0].couplingDb, 14.9, 0.5);
});

test('best practice: lowest power, filter rejects the IEM channel by 40 dB, IEM link still has margin, wanted margin intact', () => {
  const r = R.best;
  assert.equal(r.iemPowerDbm, 10);
  assert.ok(r.iemMarginDb > 20);
  r.antennas.forEach((a) => { assert.equal(a.level, 'ok'); assert.equal(a.desenseDb, 0); assert.ok(a.wantedMarginDb > 20); assert.ok(a.atRxInputDbm < R['crossed-pol'].antennas[0].atRxInputDbm - 30); });
  const s = sosScene('best'); const filt = s.links[0].chain.find((c) => c.kind === 'filter');
  const without = sosReport((() => { const t = sosScene('best'); t.links[0].chain = t.links[0].chain.filter((c) => c.kind !== 'filter'); return t; })());
  near(without.antennas[0].atRxInputDbm - r.antennas[0].atRxInputDbm, filt.rejectionDb + filt.lossDb, 1e-6);
});

test('all three validate and the notes quote the model', () => {
  for (const id of ['too-close', 'crossed-pol', 'best']) { const v = validateScene(sosScene(id)); assert.equal(v.ok, true, v.errors.join(';')); }
  const a = R['too-close'].antennas[0];
  for (const v of [f1(a.couplingDb), f1(a.atRxInputDbm), f1(-a.headroomDb), f1(a.wantedMarginDb), f1(a.marginAfterDesenseDb), f1(R['too-close'].worstProductDbm)]) assert.ok(note('sos-iem-too-close').includes(v), v);
  const b = R['crossed-pol'].antennas[0];
  for (const v of [f1(b.couplingDb), f1(b.atRxInputDbm), f1(b.headroomDb), f1(b.wantedMarginDb)]) assert.ok(note('sos-iem-crossed-pol').includes(v), v);
  const c = R.best.antennas[0];
  for (const v of [f1(R.best.iemMarginDb), f1(c.distanceM), f1(c.couplingDb), f1(c.atRxInputDbm), f1(c.headroomDb), f1(c.wantedMarginDb)]) assert.ok(note('sos-iem-best-practice').includes(v), v);
  for (const id of ['sos-iem-too-close', 'sos-iem-crossed-pol', 'sos-iem-best-practice']) assert.ok(note(id).split('. ').length <= 4, id);
});
