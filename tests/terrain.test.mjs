import test from 'node:test';
import assert from 'node:assert/strict';
import { addCol, clearColliders, solidAt } from '../src/terrain.js';

test('solidAt finds static obstacles (trees, palisade) for blades bouncing off', () => {
  clearColliders(); addCol(10, 10, .4);
  assert.equal(solidAt(10.2, 10), true);
  assert.equal(solidAt(11, 10), false);
  addCol(20, 20, 1, .5); // a low rock
  assert.equal(solidAt(20, 20, .3), true, 'blade low enough hits the rock');
  assert.equal(solidAt(20, 20, 1.2), false, 'blade passes over a low rock');
  clearColliders();
});
