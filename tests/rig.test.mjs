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

import { legTwist, LEG_TWIST_MAX } from '../src/rig.js';
test('legs turn gently toward travel, capped, and do not flip back and forth around sideways motion', () => {
  assert.equal(legTwist(1.5, 0, false).yaw, 0);
  assert.equal(legTwist(.1, .2, false).yaw, 0);                       // shuffling: legs stay put
  const s = legTwist(.05, 1.5, false); assert.ok(s.yaw > 0 && s.yaw <= LEG_TWIST_MAX);
  assert.ok(LEG_TWIST_MAX <= .55);
  // tiny forward/back jitter while strafing keeps the same side (hysteresis)
  let st = legTwist(-.05, 1.5, false); assert.equal(st.backward, false);
  st = legTwist(-.2, 1.5, st.backward); assert.equal(st.backward, false);
  st = legTwist(-1.4, .3, st.backward); assert.equal(st.backward, true);
  st = legTwist(.1, 1.5, st.backward); assert.equal(st.backward, true);
});

import { makeRig, driveRig } from '../src/rig.js';
test('the chest never winds up: guarding while side-stepping keeps the spine twist bounded', () => {
  const bone = n => { const b = new THREE.Bone(); b.name = n; return b; };
  const body = new THREE.Group(), root = bone('root'), pelvis = bone('pelvis'), s1 = bone('spine_01'), s3 = bone('spine_03');
  body.add(root); root.add(pelvis); pelvis.add(s1); s1.add(s3);
  const q = n => new THREE.QuaternionKeyframeTrack(n + '.quaternion', [0, 2], [0, 0, 0, 1, 0, 0, 0, 1]);
  const clips = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Idle_Shield_Loop', 'Sword_Regular_A'].map(n => new THREE.AnimationClip(n, 2, [q('pelvis'), q('spine_01'), q('spine_03')]));
  const rig = makeRig(THREE, o => o.clone(true), { body, clips, split: [null, null] }, { shielded: true });
  const f = new THREE.Vector3(); let worst = 0;
  for (let i = 0; i < 600; i++) {
    driveRig(THREE, rig, { speed: .3, side: 1.6, combat: true, f: { phase: 'idle' }, T: C, throwK: -1 }, 1 / 60);
    rig.root.updateMatrixWorld(true);
    f.set(0, 0, 1).transformDirection(rig.bones.spine_03.matrixWorld);
    worst = Math.max(worst, Math.abs(Math.atan2(f.x, f.z)));
  }
  assert.ok(worst < .15, 'chest stays on the target, got ' + worst.toFixed(2) + ' rad');
});

test('the waist never wrings: the counter-twist is shared by all three spine bones', () => {
  const bone = n => { const b = new THREE.Bone(); b.name = n; return b; };
  const body = new THREE.Group(), root = bone('root'), pelvis = bone('pelvis'), s1 = bone('spine_01'), s2 = bone('spine_02'), s3 = bone('spine_03');
  body.add(root); root.add(pelvis); pelvis.add(s1); s1.add(s2); s2.add(s3);
  const q = n => new THREE.QuaternionKeyframeTrack(n + '.quaternion', [0, 2], [0, 0, 0, 1, 0, 0, 0, 1]);
  const clips = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Idle_Shield_Loop'].map(n => new THREE.AnimationClip(n, 2, ['pelvis', 'spine_01', 'spine_02', 'spine_03'].map(q)));
  const rig = makeRig(THREE, o => o.clone(true), { body, clips, split: [null, null] }, { shielded: true });
  for (let i = 0; i < 120; i++) driveRig(THREE, rig, { speed: .3, side: 1.6, combat: true, f: { phase: 'idle' }, T: C, throwK: -1 }, 1 / 60);
  const yaw = b => 2 * Math.asin(Math.abs(b.quaternion.y));
  const a = [rig.bones.spine_01, rig.bones.spine_02, rig.bones.spine_03].map(yaw), tot = a[0] + a[1] + a[2];
  assert.ok(tot > .1, 'there is a counter-twist to share (' + tot.toFixed(2) + ')');
  assert.ok(Math.max(...a) < tot * .45, 'no single bone takes the whole twist: ' + a.map(x => x.toFixed(2)));
});
