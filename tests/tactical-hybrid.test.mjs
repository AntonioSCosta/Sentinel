import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { hybridAction, hybridSlots } from '../src/tactical/visual/hybrid-troops.js';
import { poseMatrices, soldierMatrices } from '../src/tactical/visual/models.js';

test('hybrid poses follow the existing simulation events and priorities', () => {
  assert.equal(hybridAction({}, false), 'idle');
  assert.equal(hybridAction({ order: { type: 'mover' } }, false), 'march');
  assert.equal(hybridAction({ hidden: true, order: { type: 'mover' } }, true), 'idle');
  assert.equal(hybridAction({ engaged: true, chargeT: 1 }, true), 'charge');
  assert.equal(hybridAction({ engaged: true }, false), 'melee');
  assert.equal(hybridAction({ order: { type: 'retirar' }, engaged: true }, true), 'withdraw');
  assert.equal(hybridAction({ state: 'debandada', order: { type: 'retirar' } }, true), 'rout');
});

test('hybrid layout separates the two visual disciplines without mutating the group', () => {
  const roman = Object.freeze({ x: 10, y: 20, facing: 0, side: 'romanos' });
  const lusitanian = Object.freeze({ ...roman, side: 'lusitanos' });
  const ranks = hybridSlots(6, roman, true), band = hybridSlots(6, lusitanian, true);
  assert.equal(ranks.length, 6);
  assert.equal(new Set(ranks.map(s => s.y)).size, 2);
  assert.equal(new Set(band.map(s => s.y)).size, 6);
  assert.deepEqual(hybridSlots(6, lusitanian, true), band);
});

test('the animated equipment stays attached to the hands, including on impact and falling', () => {
  const m = soldierMatrices();
  const figure = Object.freeze({ x: 13, y: 0, z: 7, yaw: 0.6, role: 'legionario', phase: 1, flash: 0.9 });
  for (const state of ['idle', 'march', 'charge', 'melee', 'withdraw', 'rout']) {
    poseMatrices(figure, m, 4.2, state);
    const offset = (part, arm) => new Vector3().setFromMatrixPosition(part).applyMatrix4(arm.clone().invert());
    assert.ok(offset(m.shield, m.armL).distanceTo(new Vector3(0.08, -0.47, 0.06)) < 1e-10);
    assert.ok(offset(m.weapon, m.armR).distanceTo(new Vector3(0.035, -0.48, -0.045)) < 1e-10);
  }
  poseMatrices({ ...figure, fall: 1 }, m, 4.2, 'idle');
  assert.ok(new Vector3(0, 1, 0).transformDirection(m.root).y < 0.1);
});
