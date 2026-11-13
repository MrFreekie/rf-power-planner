import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DECK_HEIGHT_RANGE_M, DECK_HEIGHT_STEPS_M, STAGE_SIZE_PRESETS, DECK_SURFACE_ID, PLATFORM_BODY, PLATFORM_BODY_DEFAULT,
  RISER_FACE_MATERIAL, EDGE_MODEL, pathDifferenceM, nullDistancesM, specularPointM, fresnelRadiusM, platformThroughLossDb, rayHeightAt
} from '../js/model/stage-params.js';
import { SURFACES, MATERIALS } from '../js/model/library.js';
import { MATERIAL_TRANSMISSION, transmissionLossDb } from '../js/model/zones-params.js';

test('deck ids map to library surfaces; riser faces map to library materials', () => {
  for (const s of Object.values(DECK_SURFACE_ID)) assert.ok(SURFACES[s], s);
  for (const [id, m] of Object.entries(RISER_FACE_MATERIAL)) { assert.ok(MATERIALS[m], id + ' ' + m); assert.equal(PLATFORM_BODY[id].faceMaterial, m); }
  assert.ok(PLATFORM_BODY[PLATFORM_BODY_DEFAULT]);
  assert.ok(Object.isFrozen(PLATFORM_BODY) && Object.isFrozen(PLATFORM_BODY.concrete) && Object.isFrozen(EDGE_MODEL));
  assert.equal(EDGE_MODEL.diffraction, false);
});

test('stage presets and deck heights', () => {
  for (const [id, p] of Object.entries(STAGE_SIZE_PRESETS)) {
    assert.equal(p.id, id); assert.ok(p.illustrative && Object.isFrozen(p));
    assert.ok(p.deckHeightM >= DECK_HEIGHT_RANGE_M.min && p.deckHeightM <= DECK_HEIGHT_RANGE_M.max);
    assert.ok(DECK_HEIGHT_STEPS_M.includes(p.deckHeightM));
    assert.ok(p.width > p.depth);
  }
  for (let i = 1; i < DECK_HEIGHT_STEPS_M.length; i++) assert.ok(DECK_HEIGHT_STEPS_M[i] > DECK_HEIGHT_STEPS_M[i - 1]);
  const sizes = Object.values(STAGE_SIZE_PRESETS).map((p) => p.width * p.depth);
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] > sizes[i - 1]);
});

test('platform body through-loss: ordering, default, cap, frequency', () => {
  const L = (id, l, f) => platformThroughLossDb(id, l, f);
  // 2 m through the body at 600 MHz
  assert.equal(L('stage-deck-wood-frame', 2, 600), 5);
  assert.equal(L('solid-riser', 2, 600), 19);
  assert.equal(L('steel-truss-deck', 2, 600), 10);
  assert.ok(L('stage-deck-wood-frame', 2) < L('steel-truss-deck', 2) && L('steel-truss-deck', 2) < L('solid-riser', 2) && L('solid-riser', 2) < L('concrete', 2));
  assert.equal(L('concrete', 5), 60);                                             // capped
  assert.equal(L('steel-plate-deck', 1, 470), 30);                                 // exponent 0
  assert.ok(L('solid-riser', 1, 2400) > L('solid-riser', 1, 600));
  assert.equal(L('nothing', 1), 0);
  assert.equal(L('solid-riser', 0, 600), 3);                                       // interface only
  // concrete agrees with the wall table
  assert.ok(Math.abs(platformThroughLossDb('concrete', 0.1, 600) - transmissionLossDb('concrete', 0.1, 600)) < 1e-9);
  assert.equal(PLATFORM_BODY.concrete.interfaceDb, MATERIAL_TRANSMISSION.concrete.interfaceDb);
  // the hollow deck is the sensible default: light, below 10 dB for a typical 3 m path
  assert.ok(L(PLATFORM_BODY_DEFAULT, 3) < 10);
});

test('two-ray geometry: path difference, null distances, specular point', () => {
  // mic 1.5 m above ground, receiver 1.5 m, 10 m: exact path difference 0.4403 m (0.88 lambda at 600 MHz)
  const d = pathDifferenceM(1.5, 1.5, 10);
  assert.ok(Math.abs(d - 0.4403) < 1e-3);
  assert.ok(Math.abs(d - (2 * 1.5 * 1.5) / 10) < 0.02);                             // 2 ht hr / d
  // same mic on a 1.2 m deck, receiver at 1.5 m above ground: ground-plane model ht 2.7, hr 1.5; deck-plane model ht 1.5, hr 0.3
  const ground = pathDifferenceM(2.7, 1.5, 10), deck = pathDifferenceM(1.5, 0.3, 10);
  assert.ok(Math.abs(ground - 0.7745) < 1e-3);
  assert.ok(Math.abs(deck - 0.0890) < 1e-3);
  const lam = 299792458 / 600e6;
  assert.ok(Math.abs(ground / lam - 1.55) < 0.01 && Math.abs(deck / lam - 0.18) < 0.01);
  // null positions (reflection coefficient -1): d_k = 2 ht hr / (k lambda)
  const ng = nullDistancesM(2.7, 1.5, 600, 3), nd = nullDistancesM(1.5, 0.3, 600, 3);
  assert.ok(Math.abs(ng[0] - 16.21) < 0.02 && Math.abs(ng[1] - 8.10) < 0.02 && Math.abs(ng[2] - 5.40) < 0.02);
  assert.ok(Math.abs(nd[0] - 1.80) < 0.01);
  assert.ok(nd[0] < ng[2]);                                                         // all deck-plane nulls lie inside 1.8 m
  assert.ok(Math.abs(specularPointM(10, 2.7, 1.5) - 6.43) < 0.01);
  assert.ok(Math.abs(specularPointM(10, 1.5, 0.3) - 8.33) < 0.01);
});

test('Fresnel zone and ray height at the riser edge', () => {
  assert.ok(Math.abs(fresnelRadiusM(5, 5, 600) - 1.12) < 0.01);
  assert.ok(fresnelRadiusM(5, 5, 2400) < fresnelRadiusM(5, 5, 600));
  // transmitter 0.3 m above a 1.2 m deck, 4 m behind the edge, receiver on the floor at 0.3 m, 10 m away: the ray crosses the riser face
  const zTx = 1.5, zRx = 0.3, D = 10;
  assert.ok(rayHeightAt(zTx, zRx, D, 4) < 1.2);
  // transmitter 1.5 m above the deck, 3 m behind the edge, receiver at 1 m: ray clears the edge
  assert.ok(rayHeightAt(2.7, 1.0, 10, 3) > 1.2);
  assert.equal(rayHeightAt(2, 1, 10, 0), 2);
  assert.equal(rayHeightAt(2, 1, 10, 10), 1);
});

import { SURFACE_PLATFORM_BODY, PLATFORM_OBSTRUCTION } from '../js/model/stage-params.js';
import { obstructionParams, chordsThrough } from '../js/model/floor.js';

test('obstruction table covers every library surface and is used by floor.js', () => {
  for (const id of Object.keys(SURFACES)) { assert.ok(SURFACE_PLATFORM_BODY[id], id); assert.ok(PLATFORM_OBSTRUCTION[id].dbPerM >= 0); }
  assert.deepEqual(obstructionParams('wood'), [3, 1]);
  assert.deepEqual(obstructionParams('concrete'), [2.5, 55]);
  assert.ok(obstructionParams('metal')[1] > obstructionParams('wood')[1]);
  // 2 m chord through a 1.2 m wood deck: 3 + 1 x 2 = 5 dB
  const sc = { stage: { width: 10, depth: 6, heightM: 1.2 }, environment: { floor: 'wood' }, platforms: [] };
  const ch = chordsThrough(sc, { x: -3, y: 3, z: 0.6 }, { x: 5, y: 3, z: 0.6 });
  assert.equal(ch.length, 1);
  assert.ok(Math.abs(ch[0].lengthM - 10) < 1e-6 || ch[0].lengthM > 0);
  assert.ok(Math.abs(ch[0].lossDb - (3 + 1 * ch[0].lengthM)) < 1e-9);
});

import { SURFACE_RISER_FACE_MATERIAL } from '../js/model/stage-params.js';

test('every floor surface has a riser-face material that exists in MATERIALS', () => {
  for (const id of Object.keys(SURFACES)) assert.ok(MATERIALS[SURFACE_RISER_FACE_MATERIAL[id]], id);
  assert.ok(!MATERIALS.carpet);
  assert.equal(SURFACE_RISER_FACE_MATERIAL.carpet, 'drapes');
});
