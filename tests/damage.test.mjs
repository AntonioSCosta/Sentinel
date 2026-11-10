import test from 'node:test';
import assert from 'node:assert/strict';
import { zoneFromHeight, ZONE_MULT, LEG_SLOW } from '../src/damage.js';

test('impact height maps to head, torso and legs', () => {
  assert.equal(zoneFromHeight(.9), 'head');
  assert.equal(zoneFromHeight(.6), 'torso');
  assert.equal(zoneFromHeight(.2), 'legs');
});
test('zone multipliers and leg slow', () => {
  assert.deepEqual(ZONE_MULT, { head: 2, torso: 1, legs: .7 });
  assert.deepEqual(LEG_SLOW, { factor: .6, time: 3 });
});
