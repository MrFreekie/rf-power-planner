// Group (d): cascaded combiner topology in the IMD engine, antenna-to-antenna coupling, IEM combining examples A / B / C.
import test from 'node:test';
import assert from 'node:assert/strict';
import { iem8Scene, IEM8_PLAN_MHZ, EXAMPLES } from '../js/examples.js';
import { imdSummary, imdTopology, txReverseImd, pimImd, couplingLossDb } from '../js/model/imd.js';
import { checkIntermod } from '../js/model/coordination.js';
import { createDefaultScene, validateScene, SCENE_LIMITS } from '../js/model/scene.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);
const f1 = (x) => x.toFixed(1);
const worst = (sc) => imdSummary(sc).worstProduct.levelDbm;

test('frequency plan is third-order clean with the 400 kHz guard; all scenes validate', () => {
  const c = checkIntermod(IEM8_PLAN_MHZ, { guardKHz: 400 });
  assert.equal(c.ok, true);
  assert.equal(c.conflicts.length, 0);
  for (const sc of [iem8Scene('A'), iem8Scene('B'), iem8Scene('C'), iem8Scene('C', { split: true, noIsolators: true }), iem8Scene('B', { tx8Isolator: true })]) {
    assert.equal(validateScene(sc).ok, true, validateScene(sc).errors.join(';'));
  }
});

test('hand-computed couplings: A 45 dB; C intra 40, cross 3 + 25 + 3 + 20 = 51; B omni 2.5 m in front: 4 + Friis 36.06 - 7 dBi = 33.06 (+/-0.05)', () => {
  const as = iem8Scene('A');
  near(imdTopology(as).pairCouplingDb(as.imd.transmitters[0].id, as.imd.transmitters[1].id), 45, 1e-9);
  const cs = iem8Scene('C');
  const ids = cs.imd.transmitters.map((t) => t.id);
  const C = imdTopology(cs);
  near(C.pairCouplingDb(ids[0], ids[1]), 40, 1e-9);
  near(C.pairCouplingDb(ids[0], ids[4]), 51, 1e-9);
  near(C.pairCouplingDb(ids[4], ids[0]), 51, 1e-9);
  const bs = iem8Scene('B');
  const bid = bs.imd.transmitters.map((t) => t.id);
  const lambda = 299.792458 / IEM8_PLAN_MHZ[0];
  const air = 20 * Math.log10(4 * Math.PI * 2.5 / lambda) - 7; // omni tx8 as seen from tx1's paddle boresight
  near(imdTopology(bs).pairCouplingDb(bid[7], bid[0]), 4 + air, 0.05);
  assert.equal(imdTopology(bs).groupOf(bid[7]), null);
  assert.equal(imdTopology(bs).groupOf(bid[0]), 'g1');
});

test('legacy single shared combiner is unchanged by the topology code (no topology: same numbers as before)', () => {
  const sc = iem8Scene('A');
  const legacy = structuredClone(sc);
  delete legacy.imd.topology; // falls back to imd.combiner { isolated, 45, 4.5 }
  const a = imdSummary(sc), b = imdSummary(legacy);
  near(a.worstProduct.levelDbm, b.worstProduct.levelDbm, 1e-9);
  near(a.worstPairIsolationDb, b.worstPairIsolationDb, 1e-9);
});

test('B is worse than A (omni transmitter unprotected); the gap closes monotonically as the omni moves away; side placement and an isolator both help', () => {
  const wa = worst(iem8Scene('A')), wb = worst(iem8Scene('B'));
  assert.ok(wb > wa + 10, `B ${wb} vs A ${wa}`);
  let prev = Infinity;
  for (const d of [1, 2, 2.5, 4, 6, 8, 10]) {
    const w = worst(iem8Scene('B', { omniDistanceM: d }));
    assert.ok(w <= prev + 1e-9, `d=${d}: ${w} > ${prev}`);
    prev = w;
  }
  assert.ok(worst(iem8Scene('B', { omniAt: 'side' })) < wb - 9);
  assert.ok(worst(iem8Scene('B', { tx8Isolator: true })) < wb - 9);
  // reverse products made in the omni transmitter (f8 pumped by the seven) are the large ones
  const rev = txReverseImd(iem8Scene('B'));
  const top = rev.reduce((w, p) => (p.levelDbm > w.levelDbm ? p : w));
  assert.ok(/^2f8-f\d$/.test(top.label), top.label);
  // PIM: for an omni at the same feed distance the junction sees less of the others; no NaN
  assert.ok(pimImd(iem8Scene('B')).every((p) => Number.isFinite(p.levelDbm)));
});

test('C: loss per channel above A by 2 dB; cross-group isolation drops below A without isolators; with them it is higher; closely spaced pair product lower when clustered', () => {
  const a = imdSummary(iem8Scene('A')), c = imdSummary(iem8Scene('C')), cn = imdSummary(iem8Scene('C', { noIsolators: true }));
  near(c.meanThroughLossDb - a.meanThroughLossDb, 2, 1e-9);
  assert.ok(cn.crossGroupIsolationDb < a.worstPairIsolationDb);
  near(cn.crossGroupIsolationDb, 31, 1e-9);
  near(c.crossGroupIsolationDb, 51, 1e-9);
  assert.ok(cn.worstProduct.levelDbm > a.worstProduct.levelDbm + 10);
  assert.ok(c.worstProduct.levelDbm > a.worstProduct.levelDbm);
  const lvl = (sc, label) => txReverseImd(sc).find((p) => p.label === label).levelDbm;
  const clustered = iem8Scene('C', { noIsolators: true }), split = iem8Scene('C', { noIsolators: true, split: true });
  assert.ok(lvl(clustered, '2f1-f2') < lvl(split, '2f1-f2') - 8.9, 'tight pair 1/2 in one group is 9 dB quieter (40 vs 31 dB)');
});

test('example notes quote the model: every figure in the three notes is recomputed here (1 decimal)', () => {
  const note = (id) => EXAMPLES.find((e) => e.id === id).note;
  const A = imdSummary(iem8Scene('A')), B = imdSummary(iem8Scene('B')), C = imdSummary(iem8Scene('C')), Cn = imdSummary(iem8Scene('C', { noIsolators: true }));
  const Bs = imdSummary(iem8Scene('B', { omniAt: 'side' })), B6 = imdSummary(iem8Scene('B', { omniDistanceM: 6 }));
  const inNote = (id, ...vals) => vals.forEach((v) => assert.ok(note(id).includes(v), `${id} should contain ${v}`));
  inNote('imd-iem-8-combined', f1(A.meanThroughLossDb), f1(A.perTx[0].levelAtRxDbm), f1(A.worstPairIsolationDb), f1(A.worstProduct.levelDbm), f1(A.worstProductDbc));
  inNote('imd-iem-7-plus-1-omni', f1(B.worstPairIsolationDb), f1(B.worstProduct.levelDbm), f1(B.worstProductDbc), f1(B.worstProduct.levelDbm - A.worstProduct.levelDbm),
    f1(B.perTx[7].levelAtRxDbm), f1(B.perTx[0].levelAtRxDbm), f1(Bs.worstPairIsolationDb), f1(Bs.worstProduct.levelDbm), f1(B6.worstProduct.levelDbm));
  inNote('imd-iem-4plus4-combined', f1(C.meanThroughLossDb), f1(C.meanThroughLossDb - A.meanThroughLossDb), f1(C.perTx[0].levelAtRxDbm), f1(C.crossGroupIsolationDb),
    f1(C.worstProduct.levelDbm), f1(C.worstProductDbc), f1(C.worstProduct.levelDbm - A.worstProduct.levelDbm), f1(Cn.crossGroupIsolationDb), f1(Cn.worstProduct.levelDbm));
});

test('summary reports sane structure; couplingLossDb is the antenna-to-antenna Friis term incl. patterns (6 dB per doubling)', () => {
  const s = imdSummary(iem8Scene('A'));
  assert.equal(s.perTx.length, 8);
  assert.ok(s.inChannelCount >= 0 && Number.isFinite(s.riseDb));
  const t = iem8Scene('B').imd.transmitters;
  const mk = (d) => ({ ...t[7], pos: { x: 3 + d, y: 10, z: 1.5 } });
  near(couplingLossDb(t[0], mk(4), 606.1) - couplingLossDb(t[0], mk(2), 606.1), 6.0206, 1e-3);
});

test('scene validation of topology: bounds, ids, group count limit', () => {
  const s = createDefaultScene();
  s.imd.topology = { groups: [{ id: 'g1', members: ['a', 'b'], lossDb: 4, isolationDb: 40, isolatorDb: 20 }], root: { lossDb: 3.5, isolationDb: 25 } };
  assert.equal(validateScene(s).ok, true, validateScene(s).errors.join(';'));
  const bad = (mut) => { const t = structuredClone(s); mut(t.imd.topology); return validateScene(t).ok; };
  assert.equal(bad((t) => { t.groups[0].lossDb = -1; }), false);
  assert.equal(bad((t) => { t.groups[0].id = 'a b'; }), false);
  assert.equal(bad((t) => { t.groups[0].members = 'x'; }), false);
  assert.equal(bad((t) => { t.root.isolationDb = 1e9; }), false);
  assert.equal(bad((t) => { t.groups = Array.from({ length: SCENE_LIMITS.maxImdGroups + 1 }, (_, i) => ({ id: `g${i}`, members: [] })); }), false);
});

test('lesson-author queries: wanted-to-product ratio, in-channel count by order, default splitter loss', async () => {
  const a = imdSummary(iem8Scene('A'));
  // ratio = weakest wanted minus strongest product: independent of a common level shift of the noise floor
  near(a.worstWantedToProductDb, -a.worstProductDbc, 1e-9);
  assert.ok(a.worstWantedToProductDb > 50);
  // every in-channel hit on this third-order-clean plan is fifth order (info severity), none third order
  assert.equal(a.inChannelThirdOrderCount, 0);
  assert.equal(a.inChannelByOrder[5], a.inChannelCount);
  assert.equal(a.criticalCount + a.warningCount, 0);
  const { createChainItem } = await import('../js/model/scene.js');
  const { chainItemLossDb } = await import('../js/model/rf.js');
  // default 4-port splitter: 10log10(4) = 6.02 dB split plus 1 dB excess (was 7 dB excess = 13 dB, wrong)
  near(chainItemLossDb(createChainItem('splitter'), 600), 10 * Math.log10(4) + 1, 1e-9);
});
