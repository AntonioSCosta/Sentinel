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

import { paintBody } from '../src/rig.js';
test('paintBody: a dress over the body, skin on the head and hands, short tunics leave the shins bare', () => {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.7, 0, 0, 1.2, 0, .7, 1.3, 0, 0, .3, 0], 3));
  const root = new THREE.Group(), m = new THREE.Mesh(g, new THREE.MeshStandardMaterial()); root.add(m);
  paintBody(THREE, root, { dress: 0x0000ff, skin: 0xff0000, long: false });
  const c = i => [0, 1, 2].map(k => m.geometry.attributes.color.array[i * 3 + k]);
  assert.ok(c(0)[0] > c(0)[2], 'head is skin'); assert.ok(c(1)[2] > c(1)[0], 'torso is dress');
  assert.ok(c(2)[0] > c(2)[2], 'hand is skin'); assert.ok(c(3)[0] > c(3)[2], 'short tunic: bare shin');
  assert.ok(m.material.vertexColors); assert.notEqual(m.geometry, g, 'the shared geometry is not repainted');
});

// --- sword arm solved from a hand position and a blade direction ---
import { applyPose } from '../src/rig.js';
function armRig() {
  const root = new THREE.Object3D(), mk = (n, p, x, y, z) => { const b = new THREE.Bone(); b.name = n; b.position.set(x, y, z); p.add(b); return b; };
  const U = mk('upperarm_r', root, -.17, 1.42, 0), L = mk('lowerarm_r', U, 0, -.27, 0), H = mk('hand_r', L, 0, -.25, 0);   // arm hanging; character's right is world −x when facing +z
  const wpn = new THREE.Group(); wpn.name = 'weapon'; H.add(wpn); root.updateMatrixWorld(true);
  return { root, bones: { upperarm_r: U, lowerarm_r: L, hand_r: H }, wpn };
}
const wp = o => o.getWorldPosition(new THREE.Vector3());
const local = v => new THREE.Vector3(-v[0], v[1], v[2]);   // character frame (x = his right) → world for a root facing +z
test('the sword arm reaches the hand target and points the blade where asked', () => {
  const r = armRig(), hand = [.3, 1.5, .35], blade = [0, .6, .8];
  applyPose(THREE, r, { arm: { hand, blade, pole: [.6, -1, 0], w: 1 } });
  assert.ok(wp(r.bones.hand_r).distanceTo(local(hand)) < .01, 'hand on target');
  const b = new THREE.Vector3(0, -1, 0).applyQuaternion(r.wpn.getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(b.dot(local(blade).normalize()) > .999, 'blade along the asked direction');
  assert.ok(wp(r.bones.lowerarm_r).y < 1.5, 'elbow below the hand line (pole points down)');
});
test('an out-of-reach target stretches the arm toward it without breaking', () => {
  const r = armRig(); applyPose(THREE, r, { arm: { hand: [.17, 1.42, 3], blade: [0, 0, 1], pole: [0, -1, 0], w: 1 } });
  const h = wp(r.bones.hand_r); assert.ok(Number.isFinite(h.x + h.y + h.z));
  assert.ok(h.z > .49 && h.z < .53 && Math.abs(h.y - 1.42) < .03, `straight forward (${h.z.toFixed(2)})`);
});
test('weight blends the arm between the base animation and the move; the pose is undone from poseSaved', () => {
  const r = armRig(), q0 = r.bones.upperarm_r.quaternion.clone();
  applyPose(THREE, r, { arm: { hand: [.3, 1.5, .35], blade: [0, 1, 0], pole: [0, -1, 0], w: 0 } });
  assert.ok(r.bones.upperarm_r.quaternion.angleTo(q0) < 1e-6);
  applyPose(THREE, r, { arm: { hand: [.3, 1.5, .35], blade: [0, 1, 0], pole: [0, -1, 0], w: .5 } });
  const half = r.bones.upperarm_r.quaternion.angleTo(q0);
  for (const [b, q] of r.poseSaved) b.quaternion.copy(q);
  applyPose(THREE, r, { arm: { hand: [.3, 1.5, .35], blade: [0, 1, 0], pole: [0, -1, 0], w: 1 } });
  const full = r.bones.upperarm_r.quaternion.angleTo(q0);
  assert.ok(half > .1 && Math.abs(half - full / 2) < .02);
});

test('a civilian build narrows chest and arms but leaves the head its size', async () => {
  const { slimBody } = await import('../src/rig.js');
  const mk = () => ({ scale: { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } } });
  const b = { spine_01: mk(), neck_01: mk(), upperarm_l: mk(), upperarm_r: mk() };
  slimBody(b);
  assert.ok(b.spine_01.scale.x < 1 && b.upperarm_r.scale.x < 1 && b.upperarm_l.scale.z < 1);
  assert.ok(Math.abs(b.spine_01.scale.x * b.neck_01.scale.x - 1) < 1e-9 && Math.abs(b.spine_01.scale.z * b.neck_01.scale.z - 1) < 1e-9);
  assert.equal(b.spine_01.scale.y, 1);
});
