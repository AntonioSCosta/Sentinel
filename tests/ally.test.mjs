import test from 'node:test'; import assert from 'node:assert/strict';
import { followSlot, pickFoe, pickTarget, allyAct } from '../src/ally.js';

test('companions follow in a loose line behind Viriato, each in his own place', () => {
  const p = { x: 10, z: 10 }, fwd = { x: 0, z: -1 };
  const s = [0, 1, 2].map(i => followSlot(i, p, fwd));
  for (const q of s) { assert.ok(q.z > p.z + 1.5, 'behind'); assert.ok(Math.hypot(q.x - p.x, q.z - p.z) < 5); }
  assert.ok(Math.hypot(s[0].x - s[1].x, s[0].z - s[1].z) > 1.4 && Math.hypot(s[1].x - s[2].x, s[1].z - s[2].z) > 1.4);
});
test('a companion only fights Romans who are already fighting, the nearest in range first', () => {
  const me = { x: 0, z: 0 };
  const foes = [{ pos: { x: 3, z: 0 }, state: 'march' }, { pos: { x: 8, z: 0 }, state: 'chase' }, { pos: { x: 5, z: 0 }, state: 'skirmish' }, { pos: { x: 2, z: 0 }, state: 'chase', dead: true }, { pos: { x: 90, z: 0 }, state: 'chase' }];
  assert.equal(pickFoe(me, foes, 22), foes[2]);
  assert.equal(pickFoe(me, [foes[0], foes[4]], 22), null);
});
test('a Roman goes for whoever is nearest, preferring Viriato when it is close', () => {
  const player = { pos: { x: 0, z: 5 } }, a = { pos: { x: 0, z: 2 } }, far = { pos: { x: 0, z: 4.6 } }, dead = { pos: { x: 0, z: .5 }, dead: true };
  assert.equal(pickTarget({ x: 0, z: 0 }, player, [a]).ally, a);
  assert.equal(pickTarget({ x: 0, z: 0 }, player, [far]).ally, null);
  assert.equal(pickTarget({ x: 0, z: 0 }, player, [dead]).ally, null);
  assert.equal(pickTarget({ x: 0, z: 0 }, player, [a]).dist, 2);
});
test('companion choices: guard against a blow being wound up, strike in reach, otherwise close in', () => {
  assert.equal(allyAct({ dist: 1.6, foePhase: 'windup', rng: () => .1 }), 'block');
  assert.equal(allyAct({ dist: 1.6, foePhase: 'idle', rng: () => .1 }), 'attack');
  assert.equal(allyAct({ dist: 1.6, foePhase: 'idle', rng: () => .95 }), 'wait');
  assert.equal(allyAct({ dist: 4, foePhase: 'idle', rng: () => .1 }), 'approach');
});
