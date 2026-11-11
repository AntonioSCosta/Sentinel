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

import { attackPose, blockPose, MOVES, BLOCKS } from './moves.js';
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
/**
 * Garment shell lifted off the body itself: the triangles of the trunk, shoulders and upper arms, pushed out a little and
 * smoothed (so the cloth hangs over the muscles instead of showing them), keeping the body's own skin weights and UVs,
 * so it bends exactly with the body and stays joined at the shoulders. Built once and shared.
 */
export function shellGeometry(THREE, bm, { offset = .014, iters = 14 } = {}) {
  const g = bm.geometry, P = g.attributes.position, N = g.attributes.normal, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, UV = g.attributes.uv;
  const names = bm.skeleton.bones.map(b => b.name), M = bm.matrixWorld, Mi = M.clone().invert(), v = new THREE.Vector3(), nv = new THREE.Vector3();
  const nm = new THREE.Matrix3().getNormalMatrix(M);
  const C = (a, i, k) => k === 0 ? a.getX(i) : k === 1 ? a.getY(i) : k === 2 ? a.getZ(i) : a.getW(i);
  const WP = [], WN = [], dom = [];
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i).applyMatrix4(M); WP.push(v.clone()); nv.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); WN.push(nv.clone());
    let b = 0, w = -1; for (let k = 0; k < 4; k++) { const ww = C(SW, i, k); if (ww > w) { w = ww; b = C(SI, i, k); } } dom.push(names[b]);
  }
  const inside = i => { const n = dom[i], y = WP[i].y; return /^spine_0[123]$|^clavicle_/.test(n) || (n === 'pelvis' && y > .95) || (/^upperarm_/.test(n)); };
  const idx = g.index ? g.index.array : Array.from({ length: P.count }, (_, i) => i), tri = [];
  for (let t = 0; t < idx.length; t += 3) if (inside(idx[t]) && inside(idx[t + 1]) && inside(idx[t + 2])) tri.push(idx[t], idx[t + 1], idx[t + 2]);
  // weld seam duplicates so the smoothing treats the surface as one
  const key = p => `${Math.round(p.x * 2000)},${Math.round(p.y * 2000)},${Math.round(p.z * 2000)}`, grp = new Map(), gid = new Int32Array(P.count).fill(-1);
  const used = [...new Set(tri)];
  for (const i of used) { const k = key(WP[i]); if (!grp.has(k)) grp.set(k, grp.size); gid[i] = grp.get(k); }
  const G = grp.size, pos = Array.from({ length: G }, () => new THREE.Vector3()), base = Array.from({ length: G }, () => new THREE.Vector3()), nor = Array.from({ length: G }, () => new THREE.Vector3()), cnt = new Float32Array(G);
  for (const i of used) { const j = gid[i]; base[j].add(WP[i]); nor[j].add(WN[i]); cnt[j]++; }
  for (let j = 0; j < G; j++) { base[j].multiplyScalar(1 / cnt[j]); nor[j].normalize(); pos[j].copy(base[j]).addScaledVector(nor[j], offset); }
  const adj = Array.from({ length: G }, () => new Set());
  for (let t = 0; t < tri.length; t += 3) { const a = gid[tri[t]], b = gid[tri[t + 1]], c = gid[tri[t + 2]]; adj[a].add(b).add(c); adj[b].add(a).add(c); adj[c].add(a).add(b); }
  const tmp = pos.map(p => p.clone()), avg = new THREE.Vector3();
  for (let it = 0; it < iters; it++) {
    for (let j = 0; j < G; j++) { avg.set(0, 0, 0); for (const k of adj[j]) avg.add(pos[k]); avg.multiplyScalar(1 / Math.max(1, adj[j].size)); tmp[j].copy(pos[j]).lerp(avg, .6); }
    for (let j = 0; j < G; j++) {   // never sink under the skin: keep at least `offset` out along the surface normal
      const d = tmp[j].clone().sub(base[j]).dot(nor[j]); if (d < offset) tmp[j].addScaledVector(nor[j], offset - d);
      pos[j].copy(tmp[j]);
    }
  }
  // assemble: only the vertices the shell uses, positions back in the body's own space
  const map = new Map(), outP = [], outUV = [], outSI = [], outSW = [], outI = [];
  for (const i of tri) {
    if (!map.has(i)) { map.set(i, map.size); const p = pos[gid[i]].clone().applyMatrix4(Mi); outP.push(p.x, p.y, p.z); if (UV) outUV.push(UV.getX(i), UV.getY(i));
      for (let k = 0; k < 4; k++) { outSI.push(C(SI, i, k)); outSW.push(C(SW, i, k)); } }
    outI.push(map.get(i));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(outP, 3)); if (UV) out.setAttribute('uv', new THREE.Float32BufferAttribute(outUV, 2));
  out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(outSI, 4)); out.setAttribute('skinWeight', new THREE.Float32BufferAttribute(outSW, 4));
  out.setIndex(outI); out.computeVertexNormals();
  return out;
}
/**
 * An ordinary man's build on the warrior's body: narrower chest and shoulders, thinner arms. Bones run along +y, so
 * x/z scale thins them; the neck is scaled back so the head keeps its size. (The clips carry no scale tracks.)
 */
export function slimBody(bones) {
  const set = (n, x, z) => { if (bones[n]) bones[n].scale.set(x, 1, z); };
  set('spine_01', .92, .9); set('neck_01', 1 / .92, 1 / .9);
  set('upperarm_l', .86, .86); set('upperarm_r', .86, .86);
}
/** A small tiling weave (warp and weft threads with a little unevenness) to give plain cloth some grain. */
export function weaveTexture(THREE) {
  const n = 64, d = new Uint8Array(n * n * 4); let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const over = ((x >> 1) + (y >> 1)) % 2, v = 205 + (over ? 26 : 0) + ((x % 2) ^ (y % 2) ? 8 : 0) + (r() - .5) * 26, i = (y * n + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, v)); d[i + 3] = 255;
  }
  const t = new THREE.DataTexture(d, n, n); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(14, 14); t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}
export function makeRig(THREE, cloneSkinned, assets, { outfit = 'roman_red', hair = [], shielded = false, tint = 1, hairColor = 0x3b2a1e, female = false, palette = null, cloth = null, slim = false } = {}) {
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
  if (!female) {   // a tunic shell over torso, shoulders and upper arms: smooth cloth that moves with the body, no painted muscles
    let bm = null; body.traverse(o => { if (o.isSkinnedMesh && o.material.name === 'MI_Superhero_Male') bm = o; });
    if (bm) {
      const geo = assets.shellGeo || (assets.shellGeo = shellGeometry(THREE, bm));
      // plain woven cloth in the garment's colour — not the body texture, whose painted chest shows through as muscles
      const cm = cloth != null ? new THREE.MeshStandardMaterial({ map: assets.weave || (assets.weave = weaveTexture(THREE)), color: new THREE.Color(cloth).multiplyScalar(tint), roughness: 1, metalness: 0, name: 'tunic' })
        : new THREE.MeshStandardMaterial({ map: bm.material.map, color: bm.material.color.clone(), roughness: 1, metalness: 0, name: 'tunic' });
      const sh = new THREE.SkinnedMesh(geo, cm); sh.name = 'tunic'; sh.castShadow = true; sh.frustumCulled = false;
      bm.parent.add(sh); sh.bind(bm.skeleton, bm.bindMatrix); mats.push(cm);
    }
  }
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
/**
 * Layer a move pose (moves.js) on the posed skeleton: each rotation is about the character's own axes
 * (x = its left, y = up, z = forward in the rig root's frame), applied from the hips out so the arm rides the turning chest.
 * The hips' turn is taken back out of the thighs so the feet stay planted. The touched bones are saved and restored next frame.
 */
const _q = {};
/** A move scaled toward the base animation: body offsets and arm weight times k. */
export function fadePose(p, k) {
  const out = {}; for (const n of ['pelvis', 'spine', 'neck']) if (p[n]) out[n] = p[n].map(v => v * k);
  if (p.arm) out.arm = { ...p.arm, w: p.arm.w * k };
  return out;
}
function charQuat(THREE, rootQ, [pitch, yaw, roll], s = 1) {
  const D = Math.PI / 180, e = _q.e || (_q.e = new THREE.Euler()), q = new THREE.Quaternion().setFromEuler(e.set(pitch * D * s, yaw * D * s, -roll * D * s, 'YXZ'));
  return rootQ.clone().multiply(q).multiply(rootQ.clone().invert());
}
function rotateWorld(THREE, b, Rw) {
  b.parent.updateWorldMatrix(true, false);
  const pq = b.parent.getWorldQuaternion(new THREE.Quaternion());
  b.quaternion.premultiply(pq.clone().invert().multiply(Rw).multiply(pq));
  b.updateMatrixWorld(true);
}
export function applyPose(THREE, rig, pose) {
  const B = rig.bones, saved = [], save = b => { if (b && !saved.some(s => s[0] === b)) saved.push([b, b.quaternion.clone()]); };
  rig.root.updateWorldMatrix(true, false);
  const rootQ = rig.root.getWorldQuaternion(new THREE.Quaternion());
  if (pose.pelvis && B.pelvis) {
    const R = charQuat(THREE, rootQ, pose.pelvis); save(B.pelvis); rotateWorld(THREE, B.pelvis, R);
    const Ri = charQuat(THREE, rootQ, [0, pose.pelvis[1], 0]).invert();
    for (const n of ['thigh_l', 'thigh_r']) if (B[n]) { save(B[n]); rotateWorld(THREE, B[n], Ri); }
  }
  if (pose.spine) for (const n of ['spine_01', 'spine_02', 'spine_03']) if (B[n]) { save(B[n]); rotateWorld(THREE, B[n], charQuat(THREE, rootQ, pose.spine, 1 / 3)); }
  const map = { neck: 'neck_01', clavicle_r: 'clavicle_r', upperarm_r: 'upperarm_r', lowerarm_r: 'lowerarm_r', hand_r: 'hand_r' };
  for (const [k, n] of Object.entries(map)) if (pose[k] && B[n]) { save(B[n]); rotateWorld(THREE, B[n], charQuat(THREE, rootQ, pose[k])); }
  if (pose.arm && pose.arm.w > 0 && B.upperarm_r && B.lowerarm_r && B.hand_r) { for (const n of ['upperarm_r', 'lowerarm_r', 'hand_r']) save(B[n]); solveArm(THREE, rig, pose.arm); }
  rig.poseSaved = saved;
}
/**
 * Put the sword hand at `arm.hand` with the blade along `arm.blade` (character frame: x = his right, y = up, z = forward,
 * origin at the feet). Shoulder and elbow are solved as a two-bone chain bent toward `arm.pole`; each bone is swung by
 * the shortest arc from where the base animation has it, so no twist is added. `arm.w` blends base → solved.
 */
export function solveArm(THREE, rig, arm) {
  const V = THREE.Vector3, Q = THREE.Quaternion, B = rig.bones, U = B.upperarm_r, L = B.lowerarm_r, H = B.hand_r;
  const base = [U, L, H].map(b => b.quaternion.clone());
  const toWorld = v => rig.root.localToWorld(new V(-v[0], v[1], v[2])), o = rig.root.getWorldPosition(new V());
  const dirWorld = v => toWorld(v).sub(o).normalize(), wp = b => b.getWorldPosition(new V());
  U.updateWorldMatrix(true, true);
  const S = wp(U), E = wp(L), W = wp(H), l1 = S.distanceTo(E), l2 = E.distanceTo(W);
  const toT = toWorld(arm.hand).sub(S), d = Math.min(Math.max(toT.length(), Math.abs(l1 - l2) + .02), (l1 + l2) * .995), ax = toT.normalize();
  let pole = dirWorld(arm.pole || [.6, -1, 0]); pole.addScaledVector(ax, -pole.dot(ax));
  if (pole.lengthSq() < 1e-4) { pole = new V(0, -1, 0); pole.addScaledVector(ax, -pole.dot(ax)); if (pole.lengthSq() < 1e-4) pole.set(1, 0, 0); }
  pole.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const elbow = S.clone().addScaledVector(ax, a).addScaledVector(pole, h), hand = S.clone().addScaledVector(ax, d);
  rotateWorld(THREE, U, new Q().setFromUnitVectors(E.sub(S).normalize(), elbow.clone().sub(S).normalize()));
  const E2 = wp(L), W2 = wp(H);
  rotateWorld(THREE, L, new Q().setFromUnitVectors(W2.sub(E2).normalize(), hand.sub(E2).normalize()));
  const wpn = rig.weaponObj || (rig.weaponObj = H.children.find(c => c.name === 'weapon') || null);
  if (wpn && arm.blade) {
    const bT = dirWorld(arm.blade), wq = () => wpn.getWorldQuaternion(new Q());
    rotateWorld(THREE, H, new Q().setFromUnitVectors(new V(0, -1, 0).applyQuaternion(wq()), bT));
    if (arm.edge) {   // roll about the blade so the cutting edge leads the way it travels
      const e0 = new V(rig.edgeSign || 1, 0, 0).applyQuaternion(wq()), eT = dirWorld(arm.edge);
      e0.addScaledVector(bT, -e0.dot(bT)); eT.addScaledVector(bT, -eT.dot(bT));
      if (e0.lengthSq() > 1e-4 && eT.lengthSq() > 1e-4) rotateWorld(THREE, H, new Q().setFromUnitVectors(e0.normalize(), eT.normalize()));
    }
  }
  if (arm.w < 1) [U, L, H].forEach((b, i) => { const q = b.quaternion.clone(); b.quaternion.copy(base[i]).slerp(q, arm.w); });
  U.updateMatrixWorld(true);
}
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
  // authored Warband-style moves (moves.js): the body stays on its guard clip and the move is layered on after the mixer
  const guardClip = rig.shielded && !rig.bareArm ? { Idle_Shield_Loop: { w: 1, time: 1 } } : { Sword_Regular_A: { w: 1, time: 0 } };
  let pose = null;
  const inAttack = f.dir && (f.phase === 'windup' || f.phase === 'strike' || f.phase === 'recovery');
  if (!upper && inAttack && MOVES[f.dir] && s.T) {
    const T = s.T, d = f.dir, tm = { windup: T.WINDUP[d] * (f.tele || 1), strike: T.STRIKE_TIME[d], recovery: T.RECOVERY[d] };
    pose = attackPose(d, f.phase, f.phase === 'recovery' ? tm.recovery - f.t : f.t, tm); upper = guardClip;
  }
  if (!upper && f.blocking === 'sword') { pose = blockPose(BLOCKS[s.blockDir] ? s.blockDir : 'left', f.blockT || 0); upper = guardClip; }
  // reaching down to something on the ground (stripping the fallen): trunk bent over it, right hand going down to it
  if (!pose && !upper && s.reach > 0) pose = { spine: [22 * s.reach, 8 * s.reach, 0], neck: [10 * s.reach, 0, 0], arm: { hand: [.16, .34, .46], pole: [.9, .2, -.4], w: s.reach } };
  // a move cut short (hit, stagger, feint) lets go of the body over a few frames instead of snapping
  if (pose) { rig.lastPose = pose; rig.poseK = 1; }
  else if (rig.lastPose && (rig.poseK = (rig.poseK || 0) - dt / .12) > 0) pose = fadePose(rig.lastPose, rig.poseK);
  else rig.lastPose = null;
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
  if (rig.poseSaved) { for (const [b, q] of rig.poseSaved) b.quaternion.copy(q); rig.poseSaved = null; }   // undo last frame's move layer first
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
  if (pose) applyPose(THREE, rig, pose);
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
