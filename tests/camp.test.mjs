import test from 'node:test';
import assert from 'node:assert/strict';
import { campStart, campGarrison, campPhase, CAMP_MISSIONS, TENTS_TO_BURN } from '../src/camp.js';

const CAMP = { x: 10, z: -135, half: 28 };

test('Viriato begins outside the camp, south of the gate and well clear of the palisade', () => {
  const s = campStart(CAMP);
  assert.ok(s.z > CAMP.z + CAMP.half + 10, 'outside the south wall, not on top of it');
  assert.ok(s.z < CAMP.z + CAMP.half + 40, 'near enough to see it');
  assert.ok(Math.abs(s.x - CAMP.x) < CAMP.half, 'in front of the camp, not round the side');
  assert.ok(s.yaw > Math.PI / 2 && s.yaw < Math.PI * 1.5, 'facing north, towards the camp');
});

test('the garrison holds the gate, the lanes and the praetorium, all inside or at the wall', () => {
  const g = campGarrison(CAMP);
  assert.ok(g.length >= 10 && g.length <= 14, `${g.length} men`);
  for (const m of g) assert.ok(Math.abs(m.x - CAMP.x) <= CAMP.half + 8 && Math.abs(m.z - CAMP.z) <= CAMP.half + 8, 'nobody posted off in the hills');
  assert.ok(g.some(m => m.kind === 'velite'), 'velites among them');
  assert.ok(g.filter(m => m.z > CAMP.z + CAMP.half - 2).length >= 2, 'the gate is watched');
});

test('the camp falls in two steps: burn the stores, then the centurion who comes out', () => {
  assert.equal(TENTS_TO_BURN, 3);
  assert.equal(campPhase(0, false), 'tents');
  assert.equal(campPhase(2, false), 'tents');
  assert.equal(campPhase(3, false), 'centurion');
  assert.equal(campPhase(3, true), 'won');
  assert.equal(campPhase(1, true), 'tents', 'killing him early does not skip the stores');
});

test('both objectives are numbered III and name what to do', () => {
  assert.equal(CAMP_MISSIONS.length, 2);
  for (const m of CAMP_MISSIONS) assert.match(m.m, /^III · /);
  assert.match(CAMP_MISSIONS[0].t(1), /1\/3/);
});
