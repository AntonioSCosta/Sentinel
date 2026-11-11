import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attackPose, blockPose, RIGHT_CUT, BLOCK_VS_RIGHT, BLOCK_IN } from '../src/moves.js';

const T = { windup: .5, strike: .3, recovery: .4 };
const close = (a, b, eps = .01) => { for (const k of Object.keys(b)) for (let i = 0; i < 3; i++) assert.ok(Math.abs((a[k]?.[i] ?? 0) - b[k][i]) < eps, `${k}[${i}] ${a[k]?.[i]} vs ${b[k][i]}`); };

test('the right cut starts from the guard and reaches the drawn-back pose at the end of the windup', () => {
  close(attackPose('right', 'windup', 0, T), {});
  for (const k of Object.keys(RIGHT_CUT.windup)) assert.equal(attackPose('right', 'windup', 0, T)[k].every(v => v === 0), true);
  close(attackPose('right', 'windup', T.windup, T), RIGHT_CUT.windup);
});
test('holding a charged blow draws the arm back a little further, but not without limit', () => {
  const held = attackPose('right', 'windup', T.windup + 5, T);
  assert.ok(held.upperarm_r[2] > RIGHT_CUT.windup.upperarm_r[2]);
  assert.ok(held.upperarm_r[2] < RIGHT_CUT.windup.upperarm_r[2] * 1.2);
});
test('no jumps between phases: windup end = strike start, strike end = recovery start, recovery ends at the guard', () => {
  close(attackPose('right', 'strike', 0, T), RIGHT_CUT.windup);
  close(attackPose('right', 'strike', T.strike, T), RIGHT_CUT.follow);
  close(attackPose('right', 'recovery', 0, T), RIGHT_CUT.follow);
  const end = attackPose('right', 'recovery', T.recovery, T);
  for (const k of Object.keys(end)) assert.ok(end[k].every(v => Math.abs(v) < 1e-9), k);
});
test('the body unwinds through the cut: the chest turns from right to left', () => {
  const y = t => attackPose('right', 'strike', t, T).spine[1];
  assert.ok(y(0) < 0 && y(T.strike) > 0 && y(T.strike * .3) > y(0));
});
test('the block comes up within BLOCK_IN and holds', () => {
  close(blockPose('right', BLOCK_IN), BLOCK_VS_RIGHT);
  close(blockPose('right', 2), BLOCK_VS_RIGHT);
  assert.ok(blockPose('right', BLOCK_IN / 2).upperarm_r[1] < BLOCK_VS_RIGHT.upperarm_r[1]);
});
test('directions not yet authored fall back to the clip animation', () => {
  assert.equal(attackPose('up', 'windup', .1, T), null);
  assert.equal(blockPose('up', .1), null);
});
