import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attackPose, blockPose, RIGHT_CUT, BLOCK_VS_RIGHT, OVERHEAD, BLOCK_VS_UP, LEFT_CUT, BLOCK_VS_LEFT, BLOCK_IN } from '../src/moves.js';

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
  assert.equal(attackPose('thrust', 'windup', .1, T), null);
  assert.equal(blockPose('thrust', .1), null);
});

// OVERHEAD (dir 'up'), proportions taken from the Warband one-handed overswing used as reference:
// sword raised over the right shoulder and laid back behind the head, trunk upright; the cut bends the trunk ~40°
// forward and turns the chest to the left of the hips, the arm finishing long in front at hip height.
test('overhead windup: arm raised high, trunk upright or leaning slightly back', () => {
  const w = attackPose('up', 'windup', T.windup, T);
  close(w, OVERHEAD.windup);
  assert.ok(w.upperarm_r[0] <= -110, 'upper arm swung up past the horizontal');
  assert.ok(w.pelvis[0] + w.spine[0] <= 2, 'no forward lean while drawn');
});
test('overhead strike bends the trunk forward and turns the chest to the left of the hips', () => {
  const f = attackPose('up', 'strike', T.strike, T), w = OVERHEAD.windup;
  const lean = f.pelvis[0] + f.spine[0];
  assert.ok(lean >= 15 && lean <= 30, `lean ${lean}`);   // bent into the blow, not doubled over
  assert.ok((f.pelvis[1] + f.spine[1]) - (w.pelvis[1] + w.spine[1]) >= 25, 'chest turns left through the cut');
  assert.ok(f.upperarm_r[0] > w.upperarm_r[0] + 60, 'the arm comes down a long way');
});
test('overhead phases join without jumps and recover to the guard', () => {
  close(attackPose('up', 'strike', 0, T), OVERHEAD.windup);
  close(attackPose('up', 'recovery', 0, T), OVERHEAD.follow);
  const end = attackPose('up', 'recovery', T.recovery, T);
  for (const k of Object.keys(end)) assert.ok(end[k].every(v => Math.abs(v) < 1e-9), k);
});
test('the block against an overhead raises the sword above the head', () => {
  close(blockPose('up', BLOCK_IN), BLOCK_VS_UP);
  assert.ok(BLOCK_VS_UP.upperarm_r[0] <= -90);
});

test('the left cut is a backhand: chest wound to the left, unwinding to the right through the cut', () => {
  const y = t => { const p = attackPose('left', 'strike', t, T); return p.pelvis[1] + p.spine[1]; };
  close(attackPose('left', 'windup', T.windup, T), LEFT_CUT.windup);
  assert.ok(y(0) > 30 && y(T.strike) < -40);
  close(attackPose('left', 'recovery', 0, T), LEFT_CUT.follow);
  close(blockPose('left', BLOCK_IN), BLOCK_VS_LEFT);
});
