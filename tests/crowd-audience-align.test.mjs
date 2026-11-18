// The two crowd models (scene.audience rectangles and scene.crowds polygons) share one loss rate, cap, head height and clearance ramp,
// and a scene that has both never counts more than one body's worst shadow on a path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene, validateScene, migrateScene } from '../js/model/scene.js';
import { solveLink } from '../js/model/rf.js';
import { audiencePathLoss, audienceChords, audienceHeadM, AUDIENCE_DB_PER_M_PER_PERSON, AUDIENCE_MAX_LOSS_DB, AUDIENCE_DENSITY_PRESETS } from '../js/model/audience.js';
import { crowdPathLoss, CROWD_DENSITY_TO_K, CROWD_MAX_LOSS_DB, CROWD_DEFAULTS } from '../js/model/crowd.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} +/- ${tol}`);
const rect = { x: 0, y: 0, width: 40, depth: 10 };
const poly = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 0, y: 10 }];

// A long, low link through a deep standing crowd: both models alone reach their cap.
function bothScene({ audience = true, crowd = true } = {}) {
  const s = createDefaultScene();
  const l = s.links[0];
  l.tx.pos = { x: 1, y: 5, z: 1.2 }; l.rx.pos = { x: 39, y: 5, z: 1.2 };
  s.audience = audience ? [{ id: 'aud1', name: 'Rectangle', ...rect, kind: 'standing', densityPerM2: 3 }] : [];
  s.crowds = crowd ? [{ id: 'cr1', name: 'Polygon', polygon: poly, mode: 'standing', densityPerM2: 3 }] : [];
  return s;
}

test('the two models share one rate, one cap and one standing head height', () => {
  assert.equal(AUDIENCE_DB_PER_M_PER_PERSON, CROWD_DENSITY_TO_K);
  assert.equal(AUDIENCE_DB_PER_M_PER_PERSON, 0.9);
  assert.equal(AUDIENCE_MAX_LOSS_DB, CROWD_MAX_LOSS_DB);
  assert.equal(AUDIENCE_MAX_LOSS_DB, 26);
  assert.equal(audienceHeadM({ kind: 'standing' }), CROWD_DEFAULTS.standing.headHeightM);
  assert.equal(audienceHeadM({ kind: 'standing' }), 1.75);
  assert.equal(audienceHeadM({ kind: 'seated' }), CROWD_DEFAULTS.seated.headHeightM);
});

test('same crowd as a rectangle or a polygon below the cap gives the same loss (2.7 dB per metre at 3 per m2)', () => {
  const A = { x: 2, y: 5, z: 1 }, B = { x: 6, y: 5, z: 1 }; // 4 m inside, well below the heads
  const sc = { audience: [{ id: 'a', ...rect, kind: 'standing', densityPerM2: 3 }], crowds: [{ id: 'c', polygon: poly, mode: 'standing', densityPerM2: 3, lMaxDb: 26 }] };
  near(audiencePathLoss(sc, [A, B], 600).lossDb, 0.9 * 3 * 4, 1e-9);
  near(crowdPathLoss(sc, [A, B], 600).lossDb, 0.9 * 3 * 4, 1e-9);
});

test('clearance ramp: a ray just above the heads still loses some signal, fading to none at 0.6 F1', () => {
  const sc = { audience: [{ id: 'a', ...rect, kind: 'standing', densityPerM2: 3 }] };
  const at = (z) => audiencePathLoss(sc, [{ x: 0.5, y: 5, z }, { x: 39.5, y: 5, z }], 600).lossDb;
  const f1 = Math.sqrt((299.792458 / 600) * 19.5 * 19.5 / 39); // first Fresnel radius at mid path
  near(at(1.0), 26, 1e-9); // below the heads: capped
  const half = at(1.75 + 0.3 * f1);
  assert.ok(half > 0 && half < 26, String(half)); // inside the ramp: partial
  near(half, Math.min(0.9 * 3 * 39, 26) * 0.5, 1e-6); // s = 0.5 at half the ramp, applied after the cap like crowd.js
  near(at(1.75 + 0.6 * f1 + 0.01), 0, 1e-12); // above the ramp: none
  // without a frequency the rule is the hard cut at head height (older callers)
  assert.equal(audienceChords(sc, { x: 0.5, y: 5, z: 1.8 }, { x: 39.5, y: 5, z: 1.8 }).length, 0);
});

test('a scene with both models stacks them, but never beyond one body worst shadow (26 dB) on a path', () => {
  const only = (o) => { const s = bothScene(o); return solveLink(s, s.links[0]); };
  const a = only({ crowd: false }), c = only({ audience: false }), both = only();
  const step = (r, re) => { const w = r.waterfall.find((x) => re.test(x.label)); return w ? -w.deltaDb : 0; };
  near(step(a, /^Audience absorption/), 26, 1e-9);
  near(step(c, /^Crowd absorption/), 20, 1e-9); // standing L_max default 20 dB
  near(step(both, /^Audience absorption/) + step(both, /^Crowd absorption/), 26, 1e-9); // stacked, jointly capped
  near(a.marginDb - both.marginDb, 0, 1e-9);
  assert.equal(validateScene(bothScene()).ok, true);
});

test('density presets: Green Guide limit 4.0 and observed 4.7 are labelled; ids kept for saved scenes', () => {
  const by = Object.fromEntries(AUDIENCE_DENSITY_PRESETS.map((p) => [p.id, p]));
  for (const id of ['sparse', 'seated', 'standing', 'dense', 'pit', 'max']) assert.ok(by[id], id);
  assert.equal(by['green-guide'].densityPerM2, 4.0); assert.match(by['green-guide'].label, /Green Guide/);
  assert.equal(by.pit.densityPerM2, 4.7); assert.match(by.pit.label, /observed/);
});

test('an older saved scene with an audience rectangle still loads and solves', () => {
  const s = createDefaultScene();
  s.audience = [{ id: 'old', name: 'Old', x: 0, y: 0, width: 12, depth: 8, kind: 'standing', densityPerM2: 2 }];
  const m = migrateScene(JSON.parse(JSON.stringify(s)));
  assert.equal(validateScene(m).ok, true);
  assert.ok(Number.isFinite(solveLink(m, m.links[0]).marginDb));
});
