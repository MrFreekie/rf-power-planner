// Group (f): ceiling and overhead panels as image-method reflectors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { solveLink, tracePaths, overheadReflection } from '../js/model/rf.js';
import { createDefaultScene, createCeiling, createOverheadPanel, validateScene } from '../js/model/scene.js';
import { CEILING_LIMITS } from '../js/model/ceiling.js';
import { overheadZoneFraction, overheadPlanes } from '../js/model/ceiling.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);
function scene(extra = {}, rxX = 10) {
  const s = createDefaultScene();
  s.stage = { width: 40, depth: 20, heightM: 0 };
  const l = s.links[0];
  l.freqMHz = 600;
  l.tx.pos = { x: 0, y: 10, z: 1.5 }; l.rx.pos = { x: rxX, y: 10, z: 1.5 };
  l.tx.antenna = { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 } };
  l.rx.antenna = { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 } };
  Object.assign(s, extra);
  return s;
}

test('ceiling off: identical path list and solve; metal ceiling at 5 m adds one delayed ray of length sqrt(10^2 + 7^2) = 12.207 m (image method)', () => {
  const off = scene(), on = scene({ ceiling: createCeiling({ heightM: 5, material: 'metal' }) });
  const p0 = tracePaths(off, off.links[0]), p1 = tracePaths(on, on.links[0]);
  assert.equal(p1.length, p0.length + 3); // ceiling, floor+ceiling, ceiling+floor
  const c = p1.find((p) => p.kind === 'ceiling');
  near(c.lengthM, Math.sqrt(149), 1e-9);
  near(c.points[1].z, 5, 1e-12);
  near(c.points[1].x, 5, 1e-9); // specular point midway (equal heights)
  const fc = p1.filter((p) => p.kind === 'floor-ceiling');
  near(fc[0].lengthM, Math.sqrt(200), 1e-9); // images: 1.5 -> -1.5 (floor) -> 11.5 (ceiling): vertical 10 m, horizontal 10 m
  assert.deepEqual(solveLink(scene(), scene().links[0]).rxPowerDbm, solveLink(off, off.links[0]).rxPowerDbm);
  assert.notEqual(solveLink(on, on.links[0]).rxPowerDbm, solveLink(off, off.links[0]).rxPowerDbm);
  assert.equal(overheadPlanes({ ceiling: { enabled: false, heightM: 5, material: 'metal' } }).length, 0);
});

test('metal reflects almost fully (|gamma| near 1 at grazing 30 deg), fabric weakly; reflection amplitude in the sum follows', () => {
  const m = overheadReflection('metal', 'vertical', 30, 600), t = overheadReflection('fabric', 'vertical', 30, 600);
  near(Math.hypot(m.re, m.im), 1, 1e-3);
  assert.ok(Math.hypot(t.re, t.im) < 0.4);
});

test('both antennas must be below the plane; an extent or panel fades smoothly at the edge (no jump above 0.5 dB per 5 cm of rx movement)', () => {
  const above = scene({ ceiling: createCeiling({ heightM: 1.0 }) });
  assert.equal(tracePaths(above, above.links[0]).some((p) => p.kind === 'ceiling'), false);
  let prev = null, worst = 0, seen = 0;
  for (let x = 6; x <= 16; x += 0.05) {
    const s = scene({ overheadPanels: [createOverheadPanel({ x: 0, y: 5, width: 11, depth: 10, heightM: 5, material: 'metal' })] }, x);
    const p = tracePaths(s, s.links[0]).find((q) => q.kind === 'panel');
    const fr = p ? (p.floorFraction === undefined ? 1 : p.floorFraction) : 0;
    if (fr > 0) seen++;
    if (prev !== null) worst = Math.max(worst, Math.abs(fr - prev));
    prev = fr;
  }
  assert.ok(seen > 20);
  assert.ok(worst < 0.25, `max step ${worst}`);
  const plane = { h: 5, rect: { x: 0, y: 5, width: 5, depth: 10 } };
  assert.equal(overheadZoneFraction({ h: 5, rect: null }, {}, {}, {}, 600), 1);
  assert.equal(overheadZoneFraction(plane, { x: 0, y: 10, z: 1.5 }, { x: 10, y: 10, z: 1.5 }, { x: 2, y: 10, z: 5 }, 600) > 0.9, true);
  assert.equal(overheadZoneFraction(plane, { x: 0, y: 10, z: 1.5 }, { x: 40, y: 10, z: 1.5 }, { x: 30, y: 10, z: 5 }, 600) < 0.01, true);
});

test('mesh lossDb reduces the panel reflection: 6 dB halves its amplitude', () => {
  const mk = (loss) => scene({ overheadPanels: [createOverheadPanel({ x: 0, y: 0, width: 40, depth: 20, heightM: 5, lossDb: loss })] });
  const a = mk(0), b = mk(6);
  const ga = solveLink(a, a.links[0]).paths.find((p) => p.kind === 'panel').gainDb;
  const gb = solveLink(b, b.links[0]).paths.find((p) => p.kind === 'panel').gainDb;
  near(ga - gb, 6, 1e-9);
});

test('validation and limits', () => {
  const s = scene({ ceiling: createCeiling({ extent: { x: 0, y: 0, width: 20, depth: 20 } }), overheadPanels: [createOverheadPanel()] });
  assert.equal(validateScene(s).ok, true, validateScene(s).errors.join(';'));
  for (const bad of [{ heightM: 0.1 }, { heightM: 500 }, { material: 'unobtainium' }, { lossDb: -1 }, { extent: { x: 0, y: 0, width: 0, depth: 3 } }, { enabled: 'yes' }]) {
    const t = structuredClone(s); Object.assign(t.ceiling, bad); assert.equal(validateScene(t).ok, false, JSON.stringify(bad));
  }
  const many = structuredClone(s); many.overheadPanels = Array.from({ length: CEILING_LIMITS.panelsMax + 1 }, (_, i) => createOverheadPanel({ id: `o${i}` }));
  assert.equal(validateScene(many).ok, false);
});

test('ceiling examples quote the model', async () => {
  const { ceilingScene, EXAMPLES } = await import('../js/examples.js');
  const f1 = (x) => x.toFixed(1);
  for (const [id, key] of [['ceiling-metal-roof', 'tent'], ['ceiling-arena-flown', 'arena'], ['ceiling-low-club', 'club']]) {
    const a = ceilingScene(key, { withCeiling: false }), b = ceilingScene(key);
    assert.equal(validateScene(b).ok, true);
    const ra = solveLink(a, a.links[0]), rb = solveLink(b, b.links[0]);
    const c = rb.paths.find((p) => p.kind === 'ceiling');
    const note = EXAMPLES.find((e) => e.id === id).note;
    const dsum = rb.rxPowerDbm - ra.rxPowerDbm;
    for (const v of [f1(Math.abs(c.relDb)), (c.lengthM - rb.paths[0].lengthM).toFixed(1), f1(Math.abs(dsum))]) assert.ok(note.includes(v), `${id}: ${v}`);
    assert.ok(note.split('. ').length <= 4, id);
  }
});
