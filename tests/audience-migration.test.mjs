import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultScene, migrateScene, validateScene, createCrowdRect } from '../js/model/scene.js';
import { solveLink } from '../js/model/rf.js';
import { crowdPathLoss } from '../js/model/crowd.js';

const withCrowd = (s, c) => { s.links[0].tx.pos = { x: 10, y: 0, z: 1.5 }; s.links[0].rx.pos = { x: 10, y: 30, z: 1.5 }; s.crowds = [c]; return s; };

test('old audience rectangles load as crowd zones and scene.audience goes away', () => {
  const raw = createDefaultScene();
  raw.audience = [{ id: 'a1', name: 'Pit', x: 4, y: 10, width: 12, depth: 20, kind: 'seated', densityPerM2: 3, headM: 1.3, locked: true }];
  const s = migrateScene(raw);
  assert.equal(s.audience, undefined);
  const c = s.crowds.find((q) => q.id === 'a1');
  assert.deepEqual(c.polygon, [{ x: 4, y: 10 }, { x: 16, y: 10 }, { x: 16, y: 30 }, { x: 4, y: 30 }]);
  assert.equal(c.mode, 'seated'); assert.equal(c.densityPerM2, 3); assert.equal(c.headHeightM, 1.3); assert.equal(c.lMaxDb, 26); assert.equal(c.locked, true);
  assert.equal(validateScene(s).ok, true);
});

test('a converted rectangle absorbs 0.9 dB per metre per person/m2, capped at 26 dB', () => {
  const s = withCrowd(createDefaultScene(), createCrowdRect({ x: 5, y: 8, width: 10, depth: 10, densityPerM2: 1 }));
  const r = crowdPathLoss(s, [s.links[0].tx.pos, s.links[0].rx.pos], 600);
  assert.ok(Math.abs(r.lossDb - 0.9 * 10) < 0.05, String(r.lossDb));
  s.crowds[0].densityPerM2 = 5;
  assert.equal(crowdPathLoss(s, [s.links[0].tx.pos, s.links[0].rx.pos], 600).lossDb, 26);
  assert.ok(solveLink(s, s.links[0]).waterfall.some((w) => /^Crowd absorption/.test(w.label)));
});

test('a ray crossing head height inside the crowd counts the part below the heads', () => {
  const s = withCrowd(createDefaultScene(), createCrowdRect({ x: 5, y: 5, width: 10, depth: 20, densityPerM2: 2 }));
  const P = (z) => [{ x: 10, y: 0, z: 1.5 }, { x: 10, y: 30, z }];
  const low = crowdPathLoss(s, P(1.5), 600).lossDb, climb = crowdPathLoss(s, P(6), 600).lossDb, high = crowdPathLoss(s, P(12), 600).lossDb;
  assert.ok(low > climb && climb > high && high >= 0, [low, climb, high].join(' '));
});
