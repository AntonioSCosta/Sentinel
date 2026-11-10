import test from 'node:test';
import assert from 'node:assert/strict';
import { createFighter, beginAttack, stagger } from '../src/combat.js';
import { decide } from '../src/ai.js';

const legio = () => ({ kind: 'legio', fighter: createFighter() });
const idle = createFighter();
const ctx = o => ({ dist: 1.8, playerFighter: idle, difficulty: 1, attackersNow: 0, rng: () => .5, ...o });

test('respects the simultaneous attacker limit (2 normal, 3 hard)', () => {
  assert.equal(decide(legio(), ctx({ attackersNow: 2 })), 'circle');
  assert.match(decide(legio(), ctx({ attackersNow: 2, difficulty: 2 })), /^attack:/);
});
test('reads the player windup and blocks', () => {
  const pf = createFighter(); beginAttack(pf, 'left');
  assert.equal(decide(legio(), ctx({ playerFighter: pf, rng: () => 0 })), 'block');
  assert.notEqual(decide(legio(), ctx({ playerFighter: pf, difficulty: 0, rng: () => .9 })), 'block');
});
test('never feints below Hard', () => {
  for (let i = 0; i < 1000; i++) for (const d of [0, 1]) assert.notEqual(decide(legio(), ctx({ difficulty: d, rng: Math.random })), 'feint');
});
test('punishes a staggered player in range', () => {
  const pf = createFighter(); stagger(pf, .8);
  assert.match(decide(legio(), ctx({ playerFighter: pf, dist: 2 })), /^attack:(up|left|right|thrust)$/);
});
test('approaches when out of reach and waits while busy', () => {
  assert.equal(decide(legio(), ctx({ dist: 6 })), 'approach');
  const e = legio(); beginAttack(e.fighter, 'up');
  assert.equal(decide(e, ctx()), 'idle');
});
