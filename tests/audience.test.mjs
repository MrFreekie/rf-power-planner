// Group (e): audience areas as an assumed body-absorption layer below head height.
import test from 'node:test';
import assert from 'node:assert/strict';
import { audienceChords, audiencePathLoss, audienceDbPerM, AUDIENCE_MAX_LOSS_DB, AUDIENCE_DENSITY_PRESETS, AUDIENCE_MAX } from '../js/model/audience.js';
import { solveLink } from '../js/model/rf.js';
import { audienceScene, EXAMPLES } from '../js/examples.js';
import { createDefaultScene, createAudience, validateScene, migrateScene } from '../js/model/scene.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);
const area = (o = {}) => ({ id: 'a1', x: 0, y: 0, width: 10, depth: 10, kind: 'standing', densityPerM2: 2, ...o });

test('hand values: 6 m chord at density 2 = 0.9 x 2 x 6 = 10.8 dB; above head height 0; capped at 26 dB', () => {
  const sc = { audience: [area()] };
  const c = audienceChords(sc, { x: 2, y: 5, z: 1 }, { x: 8, y: 5, z: 1 });
  near(c[0].lengthM, 6, 1e-9); near(c[0].lossDb, 10.8, 1e-9);
  assert.equal(audienceChords(sc, { x: 2, y: 5, z: 2 }, { x: 8, y: 5, z: 2 }).length, 0); // above 1.75 m heads
  near(audienceChords({ audience: [area({ kind: 'seated' })] }, { x: 2, y: 5, z: 1.5 }, { x: 8, y: 5, z: 1.5 }).length, 0, 0); // seated heads 1.2 m
  near(audiencePathLoss({ audience: [area({ width: 100, densityPerM2: 5 })] }, [{ x: 1, y: 5, z: 1 }, { x: 80, y: 5, z: 1 }]).lossDb, AUDIENCE_MAX_LOSS_DB, 0);
  near(audienceDbPerM({ densityPerM2: 4 }), 3.6, 1e-12);
});

test('a sloping ray is clipped at head height: from z 1.0 to 2.4 over 14 m, only the part below 1.75 m counts (7.5 m)', () => {
  const sc = { audience: [area({ width: 20 })] };
  const c = audienceChords(sc, { x: 0, y: 5, z: 1 }, { x: 14, y: 5, z: 2.4 });
  // 3D length per x metre = sqrt(1 + 0.01) ; z = 1.75 at x = 7.5 (no frequency: hard cut at head height)
  near(c[0].lengthM, 7.5 * Math.sqrt(1.01), 1e-9);
});

test('solveLink: direct-path step and margin, no audience = bit-identical, density monotone', () => {
  const base = audienceScene({ withAudience: false }), withA = audienceScene();
  const a = solveLink(base, base.links[0]), b = solveLink(withA, withA.links[0]);
  assert.equal(a.waterfall.some((w) => /Audience/.test(w.label)), false);
  const st = b.waterfall.find((w) => /^Audience absorption/.test(w.label));
  near(st.deltaDb, -26, 1e-9); // 0.9 x 2 x 20 = 36 dB, capped at 26
  assert.ok(a.marginDb - b.marginDb > 25.9);
  let prev = Infinity;
  for (const d of [0.1, 1, 2, 3.5, 5]) { const s = audienceScene({ densityPerM2: d }); const m = solveLink(s, s.links[0]).marginDb; assert.ok(m <= prev + 1e-9); prev = m; }
  assert.ok(solveLink(audienceScene({ rxZ: 4 }), audienceScene({ rxZ: 4 }).links[0]).marginDb > b.marginDb + 10); // about 2 m above the heads
  // seated heads (1.2 m) are 0.3 m below the ray: inside the clearance ramp, so less loss than standing but not none
  const seated = solveLink(audienceScene({ kind: 'seated' }), audienceScene({ kind: 'seated' }).links[0]).paths[0].audienceLossDb;
  assert.ok(seated > 0 && seated < b.paths[0].audienceLossDb, String(seated));
});

test('example note quotes the model; scene validation and limits', () => {
  const note = EXAMPLES.find((e) => e.id === 'audience-crowd').note;
  const f = (s) => solveLink(s, s.links[0]);
  const n0 = audienceScene({ withAudience: false }), n1 = audienceScene(), n2 = audienceScene({ rxZ: 2.5 }), n4 = audienceScene({ rxZ: 4 });
  for (const v of [f(n1).paths[0].audienceLossDb.toFixed(1), f(n0).marginDb.toFixed(1), f(n1).marginDb.toFixed(1), f(n2).paths[0].audienceLossDb.toFixed(1), f(n4).paths[0].audienceLossDb.toFixed(1)]) assert.ok(note.includes(v), v);
  assert.ok(note.split('. ').length <= 4);
  assert.equal(validateScene(n1).ok, true);
  const s = createDefaultScene(); s.audience = [createAudience()];
  assert.equal(validateScene(s).ok, true, validateScene(s).errors.join(';'));
  for (const bad of [{ densityPerM2: 0 }, { densityPerM2: 5.1 }, { kind: 'lying' }, { width: -1 }, { headM: 9 }, { x: NaN }]) {
    const t = structuredClone(s); Object.assign(t.audience[0], bad); assert.equal(validateScene(t).ok, false, JSON.stringify(bad));
  }
  const many = createDefaultScene(); many.audience = Array.from({ length: AUDIENCE_MAX + 1 }, (_, i) => createAudience({ id: `a${i}` }));
  assert.equal(validateScene(many).ok, false);
  assert.equal(AUDIENCE_DENSITY_PRESETS.every((p) => p.densityPerM2 >= 0.1 && p.densityPerM2 <= 5 && ['U', 'S'].includes(p.flag)), true);
  assert.equal(typeof migrateScene, 'function');
});
