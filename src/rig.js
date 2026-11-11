// Skinned characters (Quaternius Universal Base Character, CC0) driven by the Universal Animation Library clips (CC0).
// Three layers so legs, sword arm and shield arm can do different things at once:
//   lo = pelvis and legs (locomotion), up = spine, head and sword arm, sh = shield arm (only for shield-bearers).
// Attack clips are scrubbed from the fighter's phase timer, so the animated blade follows the same timing
// as the swing arcs in swing.js that decide hits.

export const LOWER_RE = /^(root|pelvis|thigh_[lr]|calf_[lr]|foot_[lr]|ball_[lr]|ball_leaf_[lr])$/;
export const LEFT_ARM_RE = /^(clavicle|upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)(_\w+)?_l$/;
export const boneOfTrack = name => name.slice(0, name.lastIndexOf('.'));

/** Which layer a bone belongs to. */
export function layerOf(bone, shielded) {
  if (LOWER_RE.test(bone)) return 'lo';
  if (shielded && LEFT_ARM_RE.test(bone)) return 'sh';
  return 'up';
}

// Attack clips: clip time windows for windup → strike → recovery, chosen from the hand's measured path.
export const ATK = {
  right: { clip: 'Sword_Regular_A', w: [0, .16], s: [.16, .3], r: [.3, .43] },   // cut from the right, rising across
  left: { clip: 'Sword_Regular_B', w: [0, .19], s: [.19, .31], r: [.31, .53] },   // backhand from the left
  up: { clip: 'Sword_Attack', w: [.05, .36], s: [.36, .56], r: [.56, .84] },     // overhead, down on the diagonal
  thrust: { clip: 'Sword_Block', w: [0, .02], s: [.02, .17], r: [.17, .3] },      // arm drives straight forward
};
export const LOCO = { walk: 1.35, jog: 3.3, sprint: 5.6, crouch: 1.1 }; // m/s each loop covers at timeScale 1

/** Pure: clip time for an attack given the fighter state and the combat timings. */
export function attackTime(dir, phase, t, T) {
  const a = ATK[dir]; if (!a) return 0;
  const k = phase === 'windup' ? Math.min(1, t / (T.WINDUP[dir] * .8)) : phase === 'strike' ? Math.min(1, t / T.STRIKE_TIME[dir]) : Math.min(1, t / T.RECOVERY[dir]);
  const [a0, a1] = phase === 'windup' ? a.w : phase === 'strike' ? a.s : a.r;
  return a0 + (a1 - a0) * k;
}

/** Pure: which loop and play rate fit a ground speed (signed: negative = walking backwards). */
export function locomotion(speed, crouch) {
  const s = Math.abs(speed), sg = speed < 0 ? -1 : 1;
  if (crouch) return s < .15 ? { clip: 'Crouch_Idle_Loop', rate: 1 } : { clip: 'Crouch_Fwd_Loop', rate: sg * s / LOCO.crouch };
  if (s < .15) return { clip: 'Idle_Loop', rate: 1 };
  if (s < 2.2) return { clip: 'Walk_Loop', rate: sg * Math.max(.5, s / LOCO.walk) };
  if (s < 4.6) return { clip: 'Jog_Fwd_Loop', rate: sg * s / LOCO.jog };
  return { clip: 'Sprint_Loop', rate: sg * s / LOCO.sprint };
}

/** Split every clip into per-layer sub-clips (shared by all characters with the same shield setting). */
export function splitClips(THREE, clips, shielded) {
  const out = {};
  for (const c of clips) {
    const by = { lo: [], up: [], sh: [] };
    for (const tr of c.tracks) by[layerOf(boneOfTrack(tr.name), shielded)].push(tr);
    out[c.name] = {};
    for (const L of ['lo', 'up', 'sh']) if (by[L].length) out[c.name][L] = new THREE.AnimationClip(c.name + '@' + L, c.duration, by[L]);
  }
  return out;
}

/**
 * Build one character. `assets` = { body (glTF scene), hair: {long, beard, buzzed}, clips: AnimationClip[], textures: {outfit: Texture} }.
 * `cloneSkinned` = SkeletonUtils.clone. Returns { root, mixer, bones, mats, attach(...) }.
 */
export function makeRig(THREE, cloneSkinned, assets, { outfit = 'roman_red', hair = [], shielded = false, tint = 1, hairColor = 0x3b2a1e } = {}) {
  const root = new THREE.Group(); root.rotation.order = 'YXZ';
  const body = cloneSkinned(assets.body); root.add(body);
  const bones = {}, mats = [];
  body.traverse(o => {
    if (o.isBone || o.type === 'Object3D' || o.isGroup) bones[o.name] = bones[o.name] || o;
    if (o.isMesh) {
      o.castShadow = true; o.frustumCulled = false;
      o.material = o.material.clone();
      if (o.material.name === 'MI_Superhero_Male' && assets.textures?.[outfit]) { o.material.map = assets.textures[outfit]; o.material.color.setScalar(tint); }
      o.material.metalness = 0; if (/Hair/.test(o.material.name)) o.material.color.setHex(hairColor); mats.push(o.material);
    }
  });
  root.updateMatrixWorld(true);
  for (const h of hair) {           // hair is modelled in place on the bind-pose head: attach keeps that
    const src = assets.hair?.[h]; if (!src) continue;
    const g = src.clone(true); g.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.setHex(hairColor); o.castShadow = true; mats.push(o.material); } });
    bones.Head.attach(g);
  }
  const mixer = new THREE.AnimationMixer(body);
  const clips = assets.split?.[shielded ? 1 : 0] || splitClips(THREE, assets.clips, shielded);
  if (assets.split) assets.split[shielded ? 1 : 0] = clips;
  const actions = {};
  const action = (name, L) => {
    const key = name + '@' + L;
    if (!actions[key]) {
      const c = clips[name]?.[L]; if (!c) return null;
      const a = mixer.clipAction(c); a.enabled = true; a.setEffectiveWeight(0); a.play(); actions[key] = a;
    }
    return actions[key];
  };
  const rig = { root, body, mixer, bones, mats, shielded, action, actions, w: { lo: {}, up: {}, sh: {} }, hitSeen: 0, oneShot: null, side: 0 };
  /** Attach `obj`, currently placed in bind-pose model space, to a bone keeping that placement. */
  rig.attach = (boneName, obj) => { root.updateMatrixWorld(true); root.add(obj); obj.updateMatrixWorld(true); bones[boneName].attach(obj); return obj; };
  /** Put the whole body in a clip's pose at time t (matrices updated); used to measure where hands are. */
  rig.poseAt = (clip, t) => {
    const as = ['lo', 'up', 'sh'].map(l => action(clip, l)).filter(Boolean);
    for (const a of as) { a.setEffectiveWeight(1); a.time = t; a.paused = true; }
    mixer.update(0); root.updateMatrixWorld(true);
    for (const a of as) { a.setEffectiveWeight(0); a.paused = false; }
  };
  /** Attach `obj` given in model space for the pose the named clip has at time t (used for the shield). */
  rig.attachInPose = (boneName, obj, clip, t, L = 'sh') => {
    const as = ['lo', 'up', 'sh'].map(l => action(clip, l)).filter(Boolean); if (!as.length) return rig.attach(boneName, obj);
    for (const a of as) { a.setEffectiveWeight(1); a.time = t; a.paused = true; }
    mixer.update(0); root.updateMatrixWorld(true);
    root.add(obj); obj.updateMatrixWorld(true); bones[boneName].attach(obj);
    for (const a of as) { a.setEffectiveWeight(0); a.paused = false; } mixer.update(0); return obj;
  };
  return rig;
}

export const LEG_TWIST_MAX = .5;
/**
 * Pure: how far the legs turn toward the travel direction (radians, + = model's left) and whether to play the walk backwards.
 * Capped and faded in with speed; `wasBackward` gives hysteresis so strafing jitter doesn't flip the legs.
 */
export function legTwist(fwd, side, wasBackward) {
  const sp = Math.hypot(fwd, side);
  const backward = wasBackward ? fwd < .2 * sp : fwd < -.35 * sp;
  if (sp < .5) return { yaw: 0, backward };
  const f = backward ? -fwd : fwd, sd = backward ? -side : side;
  const a = Math.atan2(sd, Math.max(0, f) + 1e-6);
  const fade = Math.min(1, (sp - .5) / .8);
  return { yaw: Math.max(-LEG_TWIST_MAX, Math.min(LEG_TWIST_MAX, a)) * fade, backward };
}

const SMOOTH = 14;
/** Blend one layer toward `target` = { clipName: { w, time?, rate? } }; weights always sum to 1. */
function blendLayer(rig, L, target, dt, snap) {
  const cur = rig.w[L], k = snap ? 1 : Math.min(1, dt * SMOOTH);
  for (const n of Object.keys(target)) if (!(n in cur)) cur[n] = 0;
  let sum = 0;
  for (const n of Object.keys(cur)) { cur[n] += ((target[n]?.w || 0) - cur[n]) * k; if (cur[n] < 1e-3 && !target[n]) delete cur[n]; else sum += cur[n]; }
  for (const n of Object.keys(cur)) {
    const a = rig.action(n, L); if (!a) continue;
    a.setEffectiveWeight(cur[n] / (sum || 1));
    const t = target[n];
    if (t?.time != null) { a.paused = true; a.time = t.time; } else { a.paused = false; a.timeScale = t?.rate ?? a.timeScale; }
  }
  for (const [key, a] of Object.entries(rig.actions)) if (key.endsWith('@' + L) && !(key.slice(0, -L.length - 1) in cur)) a.setEffectiveWeight(0);
}

/**
 * Drive a rig from game state. s = { speed (signed, along facing), side (m/s, + = model's left), crouch, combat,
 *   f (fighter), T (combat timings), throwK (0..1 or <0), dead, hit (increments on each hit taken), heavy }.
 */
export function driveRig(THREE, rig, s, dt) {
  const f = s.f || {}, lo = {}, up = {}, sh = {};
  if (s.dead) {
    if (!rig.deadT) { rig.deadT = 1e-6; for (const L of ['lo', 'up', 'sh']) { const a = rig.action('Death01', L); if (a) { a.reset(); a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; a.time = 0; } } }
    rig.deadT += dt;
    for (const [L, o] of [['lo', lo], ['up', up], ['sh', sh]]) o.Death01 = { w: 1, time: Math.min(2.35, rig.deadT * 1.1) };
    blendLayer(rig, 'lo', lo, dt); blendLayer(rig, 'up', up, dt); if (rig.shielded) blendLayer(rig, 'sh', sh, dt);
    rig.mixer.update(0); return;
  }
  // locomotion: legs take the travel direction, the chest keeps facing the foe
  const fwd = s.speed || 0, side = s.side || 0, sp = Math.hypot(fwd, side);
  const lt = legTwist(fwd, side, rig.backward); rig.backward = lt.backward;
  const signed = (lt.backward ? -1 : 1) * sp;
  rig.side += (lt.yaw - rig.side) * Math.min(1, dt * 4);
  const L0 = locomotion(signed, s.crouch);
  lo[L0.clip] = { w: 1, rate: L0.rate };
  // one-shot reactions (hit / knockback) override the upper body for their length
  if ((s.hit || 0) !== rig.hitSeen) { rig.hitSeen = s.hit || 0; rig.oneShot = { clip: s.heavy ? 'Hit_Knockback' : (Math.random() < .5 ? 'Hit_Chest' : 'Hit_Head'), t: 0 }; }
  if (f.phase === 'staggered' && !rig.oneShot) rig.oneShot = { clip: 'Idle_Shield_Break', t: 0 };
  let upper = null;
  if (rig.oneShot) {
    const os = rig.oneShot, dur = rig.action(os.clip, 'up')?.getClip().duration || .5;
    os.t += dt; if (os.t >= dur) rig.oneShot = null; else upper = { [os.clip]: { w: 1, time: os.t } };
    if (os.clip === 'Hit_Knockback' && rig.oneShot) lo[os.clip] = { w: 3, time: os.t };
  }
  if (!upper && f.dir && (f.phase === 'windup' || f.phase === 'strike' || f.phase === 'recovery') && ATK[f.dir]) {
    upper = { [ATK[f.dir].clip]: { w: 1, time: attackTime(f.dir, f.phase, f.t, s.T) } };
    if (sp < .3 && f.phase !== 'windup') lo[ATK[f.dir].clip] = { w: 1.5, time: attackTime(f.dir, f.phase, f.t, s.T) }; // step into it
  }
  if (!upper && s.throwK >= 0) upper = { OverhandThrow: { w: 1, time: .05 + s.throwK * .8 } };
  if (!upper && f.blocking === 'sword') upper = { Sword_Block: { w: 1, time: .32 } };
  if (!upper && s.combat) upper = rig.shielded ? { Idle_Shield_Loop: { w: 1, time: 1 } } : { Sword_Regular_A: { w: 1, time: 0 } }; // guard
  if (!upper) upper = { [L0.clip]: { w: 1, rate: L0.rate } };
  Object.assign(up, upper);
  if (rig.shielded) {
    sh.Idle_Shield_Loop = { w: 1, time: 1 };
    if (rig.oneShot && /Shield_Break|Knockback/.test(rig.oneShot.clip)) sh[rig.oneShot.clip] = { w: 2, time: rig.oneShot.t };
  }
  blendLayer(rig, 'lo', lo, dt); blendLayer(rig, 'up', up, dt); if (rig.shielded) blendLayer(rig, 'sh', sh, dt);
  rig.mixer.update(dt);
  // legs turn toward travel, spine turns back so the chest stays on the target
  if (Math.abs(rig.side) > .01) {
    rig.body.rotation.y = rig.side;
    const sp1 = rig.bones.spine_01; if (sp1) twistWorldY(THREE, sp1, -rig.side);
  } else rig.body.rotation.y = 0;
}

let _tmp = null;
function twistWorldY(THREE, bone, angle) {
  if (!_tmp) _tmp = { q: new THREE.Quaternion(), p: new THREE.Quaternion(), ax: new THREE.Vector3() };
  bone.parent.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(_tmp.p);
  _tmp.ax.set(0, 1, 0).applyQuaternion(_tmp.p.invert());
  bone.quaternion.premultiply(_tmp.q.setFromAxisAngle(_tmp.ax, angle));
}
