import test from 'node:test'; import assert from 'node:assert/strict';
import * as THREE from 'three';
import { layerOf, attackTime, locomotion, splitClips, ATK } from '../src/rig.js';
import * as C from '../src/combat.js';

test('bones go to the right layer', () => {
  assert.equal(layerOf('pelvis', true), 'lo'); assert.equal(layerOf('calf_r', true), 'lo');
  assert.equal(layerOf('spine_02', true), 'up'); assert.equal(layerOf('hand_r', true), 'up');
  assert.equal(layerOf('hand_l', true), 'sh'); assert.equal(layerOf('index_04_leaf_l', true), 'sh');
  assert.equal(layerOf('hand_l', false), 'up'); assert.equal(layerOf('thigh_l', true), 'lo');
});
test('attack clip time runs windup → strike → recovery through the measured windows', () => {
  for (const d of C.DIRS) {
    const a = ATK[d];
    assert.equal(attackTime(d, 'windup', 0, C), a.w[0]);
    assert.ok(Math.abs(attackTime(d, 'windup', 10, C) - a.w[1]) < 1e-9);
    assert.ok(Math.abs(attackTime(d, 'strike', C.STRIKE_TIME[d], C) - a.s[1]) < 1e-9);
    assert.ok(attackTime(d, 'strike', C.STRIKE_TIME[d] / 2, C) > a.s[0]);
    assert.ok(Math.abs(attackTime(d, 'recovery', 99, C) - a.r[1]) < 1e-9);
    assert.equal(a.w[1], a.s[0]); assert.equal(a.s[1], a.r[0]);
  }
});
test('locomotion picks loops by speed and plays backwards when retreating', () => {
  assert.equal(locomotion(0).clip, 'Idle_Loop');
  assert.equal(locomotion(1.4).clip, 'Walk_Loop');
  assert.equal(locomotion(3.5).clip, 'Jog_Fwd_Loop');
  assert.equal(locomotion(6).clip, 'Sprint_Loop');
  assert.ok(locomotion(-1.2).rate < 0);
  assert.equal(locomotion(1, true).clip, 'Crouch_Fwd_Loop');
});
test('clips split into disjoint per-layer sub-clips', () => {
  const q = n => new THREE.QuaternionKeyframeTrack(n + '.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
  const c = new THREE.AnimationClip('X', 1, [q('pelvis'), q('spine_01'), q('hand_r'), q('hand_l'), q('calf_l')]);
  const s = splitClips(THREE, [c], true).X;
  assert.deepEqual(s.lo.tracks.map(t => t.name), ['pelvis.quaternion', 'calf_l.quaternion']);
  assert.deepEqual(s.up.tracks.map(t => t.name), ['spine_01.quaternion', 'hand_r.quaternion']);
  assert.deepEqual(s.sh.tracks.map(t => t.name), ['hand_l.quaternion']);
  assert.equal(splitClips(THREE, [c], false).X.sh, undefined);
});
