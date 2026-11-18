import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createDefaultScene, validateScene } from '../js/model/scene.js';
import { setCeiling, addOverheadPanel, updateOverheadPanel, removeOverheadPanel, setP2pField, setAntennaDesignBand } from '../js/actionsAreas.js';
import { setLinkKind } from '../js/actions.js';
import { findItem, selectableIds } from '../js/view/util.js';
import { farBounds } from '../js/view/planExtent.js';
import { budgetExtras } from '../js/ui/budgetExtras.js';
import { solveLink } from '../js/model/rf.js';

const mk = () => createStore(createDefaultScene());


test('ceiling and overhead panels', () => {
  const s = mk();
  setCeiling(s, { enabled: true, heightM: 999, material: 'concrete' });
  assert.equal(s.getScene().ceiling.heightM, 60); assert.equal(s.getScene().ceiling.material, 'concrete');
  setCeiling(s, { material: 'nope' }); assert.equal(s.getScene().ceiling.material, 'concrete');
  const id = addOverheadPanel(s, { width: 3, heightM: 6 }); updateOverheadPanel(s, id, { heightM: 0 });
  assert.equal(s.getScene().overheadPanels[0].heightM, 1.5);
  assert.equal(validateScene(s.getScene()).ok, true); assert.equal(findItem(s.getScene(), id).type, 'panel');
  removeOverheadPanel(s, id); assert.equal(s.getScene().overheadPanels.length, 0);
  setCeiling(s, null); assert.equal('ceiling' in s.getScene(), false);
});

test('point to point: kind switch, fields, obstacle, far bounds, budget rows', () => {
  const s = mk(); const id = s.getScene().links[0].id;
  assert.equal(setLinkKind(s, id, 'p2p'), true); assert.equal(s.getScene().links[0].kind, 'p2p');
  assert.equal(setP2pField(s, id, 'kFactor', 100), true); assert.equal(s.getScene().links[0].p2p.kFactor, 10);
  setP2pField(s, id, 'obstacleDistanceM', 400); setP2pField(s, id, 'obstacleHeightM', 30);
  assert.deepEqual(s.getScene().links[0].p2p.obstacle, { distanceM: 400, heightM: 30 });
  setP2pField(s, id, 'groundReflection', true); setP2pField(s, id, 'fadeMarginDb', 12);
  assert.equal(validateScene(s.getScene()).ok, true);
  const rows = budgetExtras(solveLink(s.getScene(), s.getScene().links[0]));
  assert.ok(rows.some((r) => r.label === 'Fresnel clearance')); assert.ok(rows.some((r) => r.label === 'Edge loss'));
  setP2pField(s, id, 'obstacleDistanceM', null); assert.equal('obstacle' in s.getScene().links[0].p2p, false);
  assert.ok(farBounds(s.getScene().stage, s.getScene()).x1 > 5000); assert.ok(farBounds(s.getScene().stage, createDefaultScene()).x1 < 1000);
  assert.equal(setP2pField(mk(), 'x', 'kFactor', 1), false);
});

test('antenna design band: id, custom, delete, invalid ignored; mismatch row', () => {
  const s = mk(); const id = s.getScene().links[0].id;
  assert.equal(setAntennaDesignBand(s, id, 'rx', 'uhf-470-520'), true);
  assert.equal(setAntennaDesignBand(s, id, 'rx', 'nope'), false);
  assert.equal(setAntennaDesignBand(s, id, 'rx', { loMHz: 500, hiMHz: 400 }), false);
  assert.equal(setAntennaDesignBand(s, id, 'tx', { loMHz: 500, hiMHz: 600, order: 3 }), true);
  assert.equal(validateScene(s.getScene()).ok, true);
  const rows = budgetExtras(solveLink(s.getScene(), s.getScene().links[0]));
  assert.ok(rows.some((r) => /match/.test(r.label)));
  setAntennaDesignBand(s, id, 'rx', null); assert.equal('designBand' in s.getScene().links[0].rx.antenna, false);
});
