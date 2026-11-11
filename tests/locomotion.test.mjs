import test from 'node:test';
import assert from 'node:assert/strict';
import { steer, footwork } from '../src/locomotion.js';
import { createFighter, beginAttack, releaseAttack, tickFighter } from '../src/combat.js';

test('steer accelerates toward the target velocity, limited by accel·dt (no instant starts/stops)', () => {
  const v = steer({ x: 0, z: 0 }, { x: 4, z: 0 }, 10, .1);
  assert.ok(Math.abs(v.x - 1) < 1e-9 && v.z === 0);
  const w = steer({ x: 4, z: 0 }, { x: 4, z: 0 }, 10, .1);
  assert.equal(w.x, 4);
});

const base = o => ({ dist: 5, sp: 3.9, act: 'approach', strafe: 1, difficulty: 1, rng: () => .5, self: createFighter(), player: createFighter(), ...o });

test('approach at full speed from afar, ease off when arriving at striking distance', () => {
  assert.equal(footwork(base({ dist: 8 })).forward, 3.9);
  const near = footwork(base({ dist: 1.9 }));
  assert.ok(near.forward > 0 && near.forward < 2, 'slows down near reach');
});

test('lunges in during its own windup, steps back after the blow', () => {
  const self = createFighter(); beginAttack(self, 'up');
  assert.ok(footwork(base({ dist: 1.6, self, act: 'idle' })).forward > .5);
  releaseAttack(self); for (let i = 0; i < 60 && self.phase !== 'recovery'; i++) tickFighter(self, 1 / 60);
  assert.ok(footwork(base({ dist: 1.3, self, act: 'idle' })).forward < 0);
});

test('circles at distance when told to wait, and backs off when crowded', () => {
  const c = footwork(base({ dist: 3, act: 'circle', strafe: -1 }));
  assert.ok(c.strafe < -1); assert.ok(Math.abs(c.forward) < .6, 'holds the ring at ~3 m');
  assert.ok(footwork(base({ dist: 1.6, act: 'circle' })).forward < 0, 'a waiting soldier backs out to the ring');
  assert.ok(footwork(base({ dist: .8, act: 'circle' })).forward < 0);
});

test('may dodge back from a visible player windup (not on Easy)', () => {
  const player = createFighter(); beginAttack(player, 'left');
  assert.ok(footwork(base({ dist: 1.4, act: 'idle', player, rng: () => .1 })).forward < 0);
  assert.ok(footwork(base({ dist: 1.4, act: 'idle', player, rng: () => .1, difficulty: 0 })).forward >= 0);
});

import { playerSpeed } from '../src/locomotion.js';
test('player speed: slower backwards and sideways, no sprinting mid-swing, slowed by guard and blows', () => {
  const idle = { phase: 'idle', blocking: null };
  const run = playerSpeed({ fwd: 1, side: 0, f: idle });
  assert.ok(playerSpeed({ fwd: -1, side: 0, f: idle }) < run * .7);
  assert.ok(playerSpeed({ fwd: 0, side: 1, f: idle }) < run);
  assert.ok(playerSpeed({ fwd: 1, side: 0, sprint: true, f: idle }) > run * 1.4);
  assert.equal(playerSpeed({ fwd: 1, side: 0, sprint: true, f: { phase: 'windup' } }), playerSpeed({ fwd: 1, side: 0, f: { phase: 'windup' } }));
  assert.ok(playerSpeed({ fwd: 1, side: 0, f: { phase: 'strike' } }) < run * .7);
  assert.ok(playerSpeed({ fwd: 1, side: 0, f: { phase: 'idle', blocking: 'shield' } }) < run * .65);
  assert.ok(playerSpeed({ fwd: 1, side: 0, crouch: true, f: idle }) < run * .6);
});

import { staminaUse } from '../src/locomotion.js';
test('stamina: standing and walking cost nothing, running costs a little, sprinting a lot', () => {
  assert.equal(staminaUse({ speed: 0, sprint: false }), 0);
  assert.equal(staminaUse({ speed: 2.2, sprint: false }), 0);
  const run = staminaUse({ speed: 4.4, sprint: false }), dash = staminaUse({ speed: 7.6, sprint: true });
  assert.ok(run > 0 && run < 8, `run ${run}`);
  assert.ok(dash >= 3 * run, `sprint ${dash}`);
  // a full bar lasts roughly 5 s of sprinting and well over 15 s of running
  assert.ok(100 / dash > 3.5 && 100 / dash < 7);
  assert.ok(100 / run > 15);
});

test('player speed: a slope slows the sprint hard, plain running a little, downhill not at all', () => {
  const idle = { phase: 'idle' };
  const flatDash = playerSpeed({ fwd: 1, side: 0, sprint: true, f: idle }), flatRun = playerSpeed({ fwd: 1, side: 0, f: idle });
  const upDash = playerSpeed({ fwd: 1, side: 0, sprint: true, f: idle, slope: .4 }), upRun = playerSpeed({ fwd: 1, side: 0, f: idle, slope: .4 });
  assert.ok(upDash < flatDash * .6, `uphill sprint ${upDash}`);
  assert.ok(upRun < flatRun && upRun > flatRun * .6, `uphill run ${upRun}`);
  assert.ok(flatDash / upDash > flatRun / upRun, 'the sprint loses more than the run');
  assert.equal(playerSpeed({ fwd: 1, side: 0, sprint: true, f: idle, slope: -.3 }), flatDash);
});
