import test from 'node:test';
import assert from 'node:assert/strict';
import { createFighter, beginAttack, stagger } from '../src/combat.js';
import { decide } from '../src/ai.js';

const legio = () => ({ kind: 'legio', fighter: createFighter() });
const idle = createFighter();
const ctx = o => ({ dist: 1.5, playerFighter: idle, difficulty: 1, attackersNow: 0, rng: () => .5, ...o });

test('one attacker at a time (two on hard), like a Warband duel: the rest circle', () => {
  assert.equal(decide(legio(), ctx({ attackersNow: 1 })), 'circle');
  assert.match(decide(legio(), ctx({ attackersNow: 1, difficulty: 2 })), /^attack:/);
  assert.equal(decide(legio(), ctx({ attackersNow: 2, difficulty: 2 })), 'circle');
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
  assert.match(decide(legio(), ctx({ playerFighter: pf, dist: 1.5 })), /^attack:(up|left|right|thrust)$/);
});
test('approaches when out of reach and waits while busy', () => {
  assert.equal(decide(legio(), ctx({ dist: 6 })), 'approach');
  const e = legio(); beginAttack(e.fighter, 'up');
  assert.equal(decide(e, ctx()), 'idle');
});

test('only engaged soldiers close in; the rest wait their turn in the ring', () => {
  assert.equal(decide(legio(), ctx({ dist: 3.5, engaged: false })), 'circle');
  assert.equal(decide(legio(), ctx({ dist: 1.5, engaged: false })), 'circle');
  assert.equal(decide(legio(), ctx({ dist: 3.5, engaged: true })), 'approach');
  assert.equal(decide(legio(), ctx({ dist: 9, engaged: false })), 'approach', 'far away: still come closer to the ring');
});

test('a staggered player is still fought one at a time (no pile-on)', () => {
  const stag = { phase: 'staggered' };
  assert.equal(decide(legio(), ctx({ attackersNow: 1, playerFighter: stag })), 'circle');
  assert.match(decide(legio(), ctx({ attackersNow: 0, playerFighter: stag })), /^attack:/);
});

test('a velite who has drawn his sword can parry too', async () => {
  const { decide } = await import('../src/ai.js');
  const act = decide({ kind: 'velite', fighter: { phase: 'idle' } }, { dist: 1, playerFighter: { phase: 'windup' }, difficulty: 2, attackersNow: 0, rng: () => 0 });
  assert.equal(act, 'block');
});
