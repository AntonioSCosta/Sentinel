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
/**
 * Clothes painted straight onto the slender (female) mannequin as vertex colours, by where each vertex sits in the bind pose:
 * skin on head, hands, forearms and (for short tunics) shins; a dress or tunic over the body; a darker girdle; leather on the feet.
 */
export function paintBody(THREE, body, { dress = 0x6b4a2e, skin = 0xc99a78, long = true }) {
  const D = new THREE.Color(dress), S = new THREE.Color(skin), B = new THREE.Color(dress).multiplyScalar(.45), F = new THREE.Color(0x3a2818), c = new THREE.Color();
  body.traverse(o => {
    if (!o.isMesh) return;
    o.geometry = o.geometry.clone(); const P = o.geometry.attributes.position, col = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      const x = Math.abs(P.getX(i)), y = P.getY(i), z = P.getZ(i);
      if (x > .21 && y > .95) c.copy(x < .43 ? D : S);                 // arm: sleeve to the elbow, then bare forearm and hand
      else if (y > 1.56 || (y > 1.49 && x < .1)) c.copy(S);              // head and neck (a high neckline, covered shoulders)
      else if (y < .1) c.copy(F);                                        // feet
      else if (y > .96 && y < 1.02) c.copy(B);                           // girdle
      else if (!long && y < .55) c.copy(S);                              // short tunic: bare shins
      else c.copy(D);
      const n = .9 + .2 * ((Math.sin(i * 12.9898 + y * 78.233) * 43758.5453) % 1 + 1) % 1;   // a little unevenness in dye and skin
      col[i * 3] = c.r * n; col[i * 3 + 1] = c.g * n; col[i * 3 + 2] = c.b * n;
      if (y > 1.53 && x < .1) P.setXYZ(i, P.getX(i) * .6, 1.62 + (y - 1.62) * .6, z * .6);   // the blank head shrinks inside the borrowed face
    }
    o.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    o.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, name: 'painted' });
  });
}
/**
 * The face of the detailed (male) body: its head and neck triangles, eyes and brows, kept skinned to the Head and neck bones
 * so they can be bound onto the slender mannequin's skeleton (same bone names).
 */
export function headParts(maleBody) {
  const parts = [];
  maleBody.traverse(o => {
    if (!o.isSkinnedMesh) return;
    const names = o.skeleton.bones.map(b => b.name), g = o.geometry, si = g.attributes.skinIndex.array, sw = g.attributes.skinWeight.array, P = g.attributes.position;
    const keep = new Set(names.map((n, i) => n === 'Head' || n === 'neck_01' ? i : -1).filter(i => i >= 0)), all = /eye|brow/i.test(o.name);
    const dom = v => { let b = 0, w = -1; for (let k = 0; k < 4; k++) if (sw[v * 4 + k] > w) { w = sw[v * 4 + k]; b = si[v * 4 + k]; } return b; };
    const ok = v => keep.has(dom(v)) && P.getY(v) > 1.47;
    const idx = g.index ? g.index.array : Array.from({ length: P.count }, (_, i) => i), tri = [];
    for (let t = 0; t < idx.length; t += 3) if (all || (ok(idx[t]) && ok(idx[t + 1]) && ok(idx[t + 2]))) tri.push(idx[t], idx[t + 1], idx[t + 2]);
    if (tri.length) { const sub = g.clone(); sub.setIndex(tri); parts.push({ geo: sub, mat: o.material, names, name: o.name }); }
  });
  return parts;
}
/** Bind the borrowed face onto a slender body, moved to where its head sits. */
function addFace(THREE, assets, body) {
  let fsm = null; body.traverse(o => { if (o.isSkinnedMesh && !fsm) fsm = o; }); if (!fsm || !assets.body) return;
  const parts = assets.headParts || (assets.headParts = headParts(assets.body));
  const fnames = fsm.skeleton.bones.map(b => b.name), head = fnames.indexOf('Head');
  for (const p of parts) {
    const geo = p.geo.clone(), si = geo.attributes.skinIndex.clone();
    for (let i = 0; i < si.array.length; i++) { const j = fnames.indexOf(p.names[si.array[i]]); si.array[i] = j >= 0 ? j : head; }
    geo.setAttribute('skinIndex', si); geo.translate(0, -.031, .022);
    const m = new THREE.SkinnedMesh(geo, p.mat); m.name = 'face-' + p.name; m.frustumCulled = false; m.castShadow = true;
    fsm.parent.add(m); m.bind(fsm.skeleton, fsm.bindMatrix);
  }
}
export function makeRig(THREE, cloneSkinned, assets, { outfit = 'roman_red', hair = [], shielded = false, tint = 1, hairColor = 0x3b2a1e, female = false, palette = null } = {}) {
  const root = new THREE.Group(); root.rotation.order = 'YXZ';
  female = female && !!assets.bodyF;
  const body = cloneSkinned(female ? assets.bodyF : assets.body); root.add(body);
  if (female) { paintBody(THREE, body, palette || {}); addFace(THREE, assets, body); }
  const bones = {}, mats = [];
  body.traverse(o => {
    if (o.isBone || o.type === 'Object3D' || o.isGroup) bones[o.name] = bones[o.name] || o;
    if (o.isMesh) {
      o.castShadow = true; o.frustumCulled = false;
      o.material = o.material.clone();
      if (o.material.name === 'MI_Superhero_Male' && assets.textures?.[outfit]) { o.material.map = assets.textures[outfit]; o.material.color.setScalar(tint); }
      o.material.metalness = 0; if (!/Hair/.test(o.material.name)) { o.material.roughness = 1; o.material.roughnessMap = null; }   // matte wool and skin, not a glossy body-suit
      if (/Hair/.test(o.material.name)) o.material.color.setHex(hairColor); mats.push(o.material);
    }
  });
  root.updateMatrixWorld(true);
  for (const h of hair) {           // hair is modelled in place on the bind-pose head: attach keeps that
    const src = assets.hair?.[h]; if (!src) continue;
    const g = src.clone(true);
    if (female) g.position.set(0, -.031, .022);   // the borrowed face sits where the slender body's head is
    if (h === 'hair_long') { g.position.y += .028; g.position.z -= .018; }   // lift the fringe off the brows (it read as huge eyebrows)   // the mannequin's head is a little larger: grow the hair round the head's centre
    g.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.setHex(hairColor); o.castShadow = true; mats.push(o.material); } });
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

export const LEG_TWIST_MAX = .45;
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
    if (rig.bareArm) sh[L0.clip] = { w: 1, rate: L0.rate };   // shield put away: the left arm moves with the body
    else sh.Idle_Shield_Loop = { w: 1, time: 1 };
    if (rig.oneShot && /Shield_Break|Knockback|Shield_OneShot/.test(rig.oneShot.clip)) sh[rig.oneShot.clip] = { w: 2, time: rig.oneShot.t };
  }
  blendLayer(rig, 'lo', lo, dt); blendLayer(rig, 'up', up, dt); if (rig.shielded) blendLayer(rig, 'sh', sh, dt);
  // undo last frame's counter-twist first: the mixer skips bones whose animated value did not change
  // (a held guard pose), so a twist left on a bone would add up frame after frame and spin the chest
  const SP = ['spine_01', 'spine_02', 'spine_03'].map(n => rig.bones[n]).filter(Boolean);
  if (rig.spineBase) { SP.forEach((b, i) => b.quaternion.copy(rig.spineBase[i])); rig.spineBase = null; }
  rig.mixer.update(dt);
  // legs turn toward travel; the spine turns back so the chest stays on the target. The turn is shared by
  // all three spine bones (a single bone wrings the waist like a candy wrapper)
  if (Math.abs(rig.side) > .01) {
    rig.body.rotation.y = rig.side;
    if (SP.length) {
      rig.spineBase = SP.map((b, i) => (rig._sb?.[i] || (rig._sb = rig._sb || [], rig._sb[i] = b.quaternion.clone())).copy(b.quaternion));
      SP.forEach(b => twistWorldY(THREE, b, -rig.side / SP.length));
    }
  } else rig.body.rotation.y = 0;
  if (rig.dyn) for (const f of rig.dyn) f();   // cloth that reacts to the pose (skirts)
}

let _tmp = null;
function twistWorldY(THREE, bone, angle) {
  if (!_tmp) _tmp = { q: new THREE.Quaternion(), p: new THREE.Quaternion(), ax: new THREE.Vector3() };
  bone.parent.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(_tmp.p);
  _tmp.ax.set(0, 1, 0).applyQuaternion(_tmp.p.invert());
  bone.quaternion.premultiply(_tmp.q.setFromAxisAngle(_tmp.ax, angle));
}
