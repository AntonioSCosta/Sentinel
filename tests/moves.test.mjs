import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attackPose, blockPose, MOVES, READY, BLOCKS, BLOCK_IN } from '../src/moves.js';
import { bladeSegment, bladeDir } from '../src/swing.js';
import { DIRS } from '../src/combat.js';

const T = { windup: .5, strike: .3, recovery: .4 };
const near = (a, b, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);
const xyz = o => [o.x, o.y, o.z];
const zero = p => ['pelvis', 'spine', 'neck'].every(k => !p[k] || p[k].every(v => Math.abs(v) < 1e-9));

test('all four attack directions are authored, in all three phases', () => {
  for (const d of DIRS) for (const ph of ['windup', 'strike', 'recovery']) {
    const p = attackPose(d, ph, .1, T);
    assert.ok(p && p.arm && p.arm.hand.length === 3 && p.arm.blade.length === 3, `${d} ${ph}`);
  }
});
test('windup: the arm goes from the guard (weight 0) to the ready position (weight 1), the body with it', () => {
  for (const d of DIRS) {
    const a = attackPose(d, 'windup', 0, T), b = attackPose(d, 'windup', T.windup, T);
    assert.equal(a.arm.w, 0); assert.ok(zero(a));
    assert.equal(b.arm.w, 1); assert.ok(near(b.arm.hand, READY[d].hand));
    assert.ok(near(b.spine, MOVES[d].windup.spine));
  }
});
test('strike: once under way, the drawn hand and blade are exactly where the damage sweep is', () => {
  for (const d of DIRS) for (const p of [.45, .6, .8, 1]) {
    const a = attackPose(d, 'strike', T.strike * p, T).arm, seg = bladeSegment(d, p);
    assert.ok(near(a.hand, xyz(seg.hand), 1e-6), `${d} hand at ${p}`);
    assert.ok(near(a.blade, xyz(bladeDir(d, p)), 1e-6), `${d} blade at ${p}`);
    assert.equal(a.w, 1);
  }
});
test('no jumps: windup end = strike start, strike end = recovery start, recovery ends on the guard', () => {
  for (const d of DIRS) {
    const w = attackPose(d, 'windup', T.windup, T), s0 = attackPose(d, 'strike', 0, T), s1 = attackPose(d, 'strike', T.strike, T), r0 = attackPose(d, 'recovery', 0, T), r1 = attackPose(d, 'recovery', T.recovery, T);
    assert.ok(near(w.arm.hand, s0.arm.hand) && near(w.arm.blade, s0.arm.blade) && near(w.spine, s0.spine), d + ' windup→strike');
    assert.ok(near(s1.arm.hand, r0.arm.hand) && near(s1.spine, r0.spine) && r0.arm.w === 1, d + ' strike→recovery');
    assert.equal(r1.arm.w, 0); assert.ok(zero(r1), d + ' back on guard');
  }
});
test('the hand travels smoothly through the strike (no teleporting between frames)', () => {
  for (const d of DIRS) { let prev = null;
    for (let i = 0; i <= 60; i++) { const h = attackPose(d, 'strike', T.strike * i / 60, T).arm.hand; if (prev) assert.ok(Math.hypot(h[0] - prev[0], h[1] - prev[1], h[2] - prev[2]) < .09, `${d} step ${i}`); prev = h; } }
});
test('the right arm never has to pass through the chest: on the left side of the body the hand stays in front', () => {
  for (const d of DIRS) for (const ph of ['windup', 'strike']) for (let i = 0; i <= 30; i++) {
    const h = attackPose(d, ph, T[ph] * i / 30, T).arm.hand;
    if (h[0] < .1) assert.ok(h[2] > .12, `${d} ${ph} ${i}: hand at ${h.map(v => v.toFixed(2))}`);
  }
});
test('overhead: drawn with the hand above the head and the blade tipped back, elbow out, not wrenched behind the shoulder', () => {
  const r = READY.up;
  assert.ok(r.hand[1] > 1.7 && r.hand[2] > -.12, 'hand over the head, not behind the back');
  assert.ok(r.blade[2] < -.4 && r.blade[1] > .3, 'blade tipped back and up');
  assert.ok(r.pole[0] > .5, 'elbow out to the right');
});
test('holding a charged blow draws the body back a little further, but not without limit', () => {
  const held = attackPose('right', 'windup', T.windup + 5, T);
  assert.ok(Math.abs(held.spine[1]) > Math.abs(MOVES.right.windup.spine[1]));
  assert.ok(Math.abs(held.spine[1]) < Math.abs(MOVES.right.windup.spine[1]) * 1.2);
});
test('the body unwinds through the cuts: right cut turns the chest right→left, left cut left→right', () => {
  const y = (d, t) => { const p = attackPose(d, 'strike', t, T); return p.pelvis[1] + p.spine[1]; };
  assert.ok(y('right', 0) < -30 && y('right', T.strike) > 30);
  assert.ok(y('left', 0) > 30 && y('left', T.strike) < -30);
});
test('overhead bends the trunk into the blow, not double', () => {
  const f = attackPose('up', 'strike', T.strike, T), lean = f.pelvis[0] + f.spine[0];
  assert.ok(lean >= 15 && lean <= 30, `lean ${lean}`);
});
test('there is a sword block against every direction; it comes up within BLOCK_IN and holds', () => {
  for (const d of DIRS) {
    const b = blockPose(d, BLOCK_IN), half = blockPose(d, BLOCK_IN / 2), held = blockPose(d, 2);
    assert.ok(b && near(b.arm.hand, BLOCKS[d].arm.hand) && b.arm.w === 1, d);
    assert.ok(half.arm.w > 0 && half.arm.w < 1); assert.equal(held.arm.w, 1);
  }
  assert.ok(BLOCKS.up.arm.hand[1] > 1.7 && Math.abs(BLOCKS.up.arm.blade[0]) > .8, 'against an overhead: blade flat above the head');
  assert.ok(BLOCKS.right.arm.hand[0] < .1 && BLOCKS.left.arm.hand[0] > .25, 'side blocks on the side the blow arrives');
});
