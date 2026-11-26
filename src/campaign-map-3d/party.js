import * as THREE from 'three';

// Viriato and three companions on the strategic map, built once per loaded world.
// The figures are the battle characters' Quaternius body (CC0), dressed and reduced in Blender
// (art/blender/guerreiros.blend → assets/map/models/guerreiros.glb): four skinned meshes on one skeleton, driven by the
// Universal Animation Library's Idle_Loop and Walk_Loop. The model is loaded once per session and shared by every world;
// a world only clones the skeletons. Until it arrives (or if it cannot load) the band shows the procedural figures below.
// Either way the formation, terrain following, heading and soft contact shadows are the same, and a pose never creates
// geometry: skeletons, mixers and instance matrices change in place.

// Offsets in map units (x right, z forward). An uneven wedge: Viriato leads slightly off-centre and the rear man trails,
// so the terrain shows between all four. Gait values give each man his own rhythm. `held`: arms that carry the spear
// (right) or the caetra (left) and keep their resting hold while the rest of the body walks.
const outfits = [
  { name: 'viriato', mesh: 'viriato', x: 1.0, z: 7.2, tunic: '#b3a487', cloak: '#ddd2bb', sleeve: '#cfc3aa', hair: '#2f2a25',
    mantle: 'full', shield: false, spear: true, spearLean: 0.3, lean: 0, phase: 0, stride: 1, swing: 0.5, held: ['r'] },
  { name: 'companion-a', mesh: 'a', x: -6.6, z: 0.8, tunic: '#5b4632', cloak: '#2e2722', sleeve: '#5b4632', hair: '#3e3328',
    mantle: 'back', shield: true, spear: true, spearLean: 0.38, lean: -0.05, phase: 2.2, stride: 0.94, swing: 0.44, held: ['l', 'r'] },
  { name: 'companion-b', mesh: 'b', x: 6.1, z: -1.4, tunic: '#4f3f2e', cloak: '#3a2d24', sleeve: '#4f3f2e', hair: '#2a2622',
    mantle: 'back', shield: true, spear: false, spearLean: 0, lean: 0.04, phase: 4.1, stride: 1.05, swing: 0.48, held: ['l'] },
  { name: 'companion-c', mesh: 'c', x: -1.8, z: -7.6, tunic: '#625039', cloak: '#2b2420', sleeve: '#625039', hair: '#4a3b2d',
    mantle: 'back', shield: false, spear: true, spearLean: -0.34, lean: -0.03, phase: 1.1, stride: 0.98, swing: 0.42, held: ['r'] },
];
// CYCLE: map units per full stride (two steps). A day's march shows 45 units in 300 ms; a stride matched to the legs
// (~15 units) would flicker at ~8 Hz, so it is stretched to ~1.25 cycles per day (about 4 Hz): readable steps, some slip.
const CYCLE = 36;
// The scene's key light shines from (-370, 620, -330) (scene.js): shadows fall towards +x, +z.
const LIGHT = new THREE.Vector3(370, 0, 330).normalize(), LIGHT_YAW = Math.atan2(-LIGHT.z, LIGHT.x), SHADOW_SHIFT = 1.7;
const MODEL_HEIGHT = 15;   // map units from the soles to the top of the head, the procedural figures' height
const MODEL_METRES = 1.75; // the Quaternius body from the soles to the top of the hair, in the GLB's metres
const HOLD_TIME = 20 / 24; // Idle_Loop frame where the build script fits spear and caetra to the hands (POSE_FRAME)
const ARM = side => new RegExp(`^(clavicle|upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)(_\\w+)?_${side}$`);

/** A flat soft disc for contact shadows: opaque centre fading to a clear rim, in vertex alpha (no texture). */
function shadowDisc(segments = 14) {
  const positions = [0, 0, 0], colors = [0, 0, 0, 1], index = [];
  for (const [radius, alpha] of [[0.55, 0.7], [1, 0]]) {
    for (let i = 0; i < segments; i++) {
      const angle = i / segments * Math.PI * 2;
      positions.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      colors.push(0, 0, 0, alpha);
    }
  }
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments, a = 1 + i, b = 1 + j, c = 1 + segments + i, d = 1 + segments + j;
    index.push(0, b, a, a, b, d, a, d, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(index);
  return geometry;
}

let modelRequest;
/**
 * Load the Blender figures once per session: GLTFLoader, the meshopt decoder and the GLB (as .glb.js, like the roundhouse),
 * not the battle engine. Resolves to { scene, clips } whose geometries and material are marked shared (never disposed
 * with a world).
 */
export function loadWarbandModel() {
  modelRequest ??= Promise.all([
    import('../../vendor/three/addons/loaders/GLTFLoader.js'),
    import('../../vendor/three/addons/libs/meshopt_decoder.module.js'),
    import('../../vendor/three/addons/utils/SkeletonUtils.js'),
    import('../../assets/map/models/guerreiros.glb.js'),
  ]).then(async ([{ GLTFLoader }, { MeshoptDecoder }, SkeletonUtils, { default: encoded }]) => {
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer, '');
    gltf.scene.traverse(object => {
      if (!object.isMesh) return;
      object.geometry.userData.shared = true;
      object.material.userData.shared = true;
    });
    const clips = Object.fromEntries(gltf.animations.map(clip => [clip.name, clip]));
    if (!clips.Idle_Loop || !clips.Walk_Loop) throw new Error('guerreiros.glb sem Idle_Loop/Walk_Loop');
    return { scene: gltf.scene, clips, clone: SkeletonUtils.clone };
  });
  return modelRequest;
}

/** The Blender figures: one skinned mesh per man, its own skeleton and mixer; geometry and material are shared. */
function modelFigures(model) {
  // (A Box3 of the skinned, quantized meshes would not see the skinning: the scale comes from the known body height.)
  const scale = MODEL_HEIGHT / MODEL_METRES;
  const split = (clip, keep) => new THREE.AnimationClip(clip.name, clip.duration,
    clip.tracks.filter(track => keep(track.name.slice(0, track.name.lastIndexOf('.')))));
  return outfits.map(outfit => {
    const held = outfit.held.map(ARM), isHeld = bone => held.some(pattern => pattern.test(bone));
    const figure = model.clone(model.scene);
    figure.scale.setScalar(scale);
    const drop = [];
    figure.traverse(object => {
      if (!object.isMesh) return;
      if (object.name !== `mapa_guerreiro_${outfit.mesh}`) drop.push(object);
      else object.frustumCulled = false;   // the skinned pose moves the mesh away from its bind-pose bounds
    });
    for (const object of drop) object.removeFromParent();
    const mixer = new THREE.AnimationMixer(figure);
    // The rest of the body blends from idle to walk; the arms that carry the spear or caetra keep their idle hold.
    const idle = mixer.clipAction(split(model.clips.Idle_Loop, bone => !isHeld(bone)));
    const walk = mixer.clipAction(split(model.clips.Walk_Loop, bone => !isHeld(bone)));
    const hold = mixer.clipAction(split(model.clips.Idle_Loop, isHeld));
    for (const action of [idle, walk, hold]) action.play();
    const rest = (outfit.phase / (Math.PI * 2)) % 1 * model.clips.Idle_Loop.duration;   // each man stands a little differently
    return { outfit, object: figure, pose({ phase, amplitude }) {
      walk.time = ((phase / (Math.PI * 2)) % 1 + 1) % 1 * walk.getClip().duration;
      idle.time = rest;
      hold.time = HOLD_TIME;
      walk.setEffectiveWeight(amplitude);
      idle.setEffectiveWeight(1 - amplitude);
      hold.setEffectiveWeight(1);
      mixer.update(0);
    }, dispose() { mixer.stopAllAction(); mixer.uncacheRoot(figure); } };
  });
}

/**
 * The procedural fallback (M1.1): one smooth turned body per man, instanced thighs, shins and arms. Only shown when the
 * Blender model is not (yet) available.
 */
function proceduralFigures(root) {
  const HIP = 6.9, THIGH = 3.3, SHIN = 3.25, SHOULDER = 11.0;
  const PROFILE = [[0.05, 4.9], [2.45, 4.9], [2.2, 6.0], [1.85, 7.2], [1.85, 8.6], [2.15, 10.0], [2.42, 11.0],
    [1.9, 11.9], [0.9, 12.4], [0.5, 12.7]].map(([r, y]) => new THREE.Vector2(r, y));
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const sculpt = build => {
    const positions = [], normals = [], colors = [];
    const point = new THREE.Vector3(), normal = new THREE.Vector3(), local = new THREE.Vector3();
    const matrix = new THREE.Matrix4(), normalMatrix = new THREE.Matrix3(), tint = new THREE.Color();
    build((geometry, color, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) => {
      matrix.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
        new THREE.Vector3(sx, sy, sz));
      normalMatrix.getNormalMatrix(matrix);
      const source = geometry.getAttribute('position'), sourceNormal = geometry.getAttribute('normal');
      const index = geometry.getIndex();
      if (typeof color !== 'function') tint.set(color);
      for (let i = 0; i < (index?.count ?? source.count); i++) {
        const v = index ? index.getX(i) : i;
        local.fromBufferAttribute(source, v);
        point.copy(local).applyMatrix4(matrix);
        normal.fromBufferAttribute(sourceNormal, v).applyMatrix3(normalMatrix).normalize();
        if (typeof color === 'function') tint.set(color(local));
        positions.push(point.x, point.y, point.z);
        normals.push(normal.x, normal.y, normal.z);
        colors.push(tint.r, tint.g, tint.b);
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geometry;
  };
  const bodyColor = outfit => ({ x, y, z }) => {
    const back = z < -0.25 * Math.hypot(x, z) - 0.05;
    if (y > 10.5 || back || (outfit.mantle === 'full' && y > 8.9 && Math.abs(x) > 0.55)) return outfit.cloak;
    if (y > 7.0 && y < 7.5) return '#2c241c';
    return outfit.tunic;
  };
  const body = new THREE.LatheGeometry(PROFILE, 10);
  const head = new THREE.SphereGeometry(1.2, 8, 6);
  const hair = new THREE.SphereGeometry(1.36, 8, 3, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const shield = new THREE.SphereGeometry(2.3, 12, 2, 0, Math.PI * 2, 0, Math.PI * 0.32);
  const boss = new THREE.SphereGeometry(0.55, 6, 2, 0, Math.PI * 2, 0, Math.PI / 2);
  const shaft = new THREE.CylinderGeometry(0.3, 0.34, 15, 6);
  const blade = new THREE.ConeGeometry(0.62, 2.4, 6);
  const thighShape = new THREE.CylinderGeometry(0.62, 0.52, THIGH, 6, 1, true);   // ends hidden by hip and knee
  const shinShape = new THREE.CapsuleGeometry(0.5, SHIN - 0.7, 1, 5);
  const foot = new THREE.SphereGeometry(0.62, 6, 3);
  const armShape = new THREE.CapsuleGeometry(0.5, 3.6, 1, 5);
  // Limbs hang from their pivot (y = 0) downwards. Thighs and sleeves take each man's colour per instance.
  const thighGeometry = sculpt(add => add(thighShape, '#ffffff', { y: -THIGH / 2 }));
  const shinGeometry = sculpt(add => {
    add(shinShape, '#5e4f3c', { y: -SHIN / 2 });
    add(foot, '#2f261e', { y: -SHIN + 0.05, z: 0.35, sx: 0.85, sy: 0.55, sz: 1.45 });
  });
  const armGeometry = sculpt(add => add(armShape, '#ffffff', { y: -2.25 }));
  const count = outfits.length;
  const thighs = new THREE.InstancedMesh(thighGeometry, material, count * 2);
  const shins = new THREE.InstancedMesh(shinGeometry, material, count * 2);
  const arms = new THREE.InstancedMesh(armGeometry, material, count * 2);
  Object.assign(thighs, { name: 'thighs' }); Object.assign(shins, { name: 'shins' }); Object.assign(arms, { name: 'arms' });
  for (const instanced of [thighs, shins, arms]) {
    instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    instanced.frustumCulled = false;   // the instances move every pose; the default sphere would go stale
  }
  const tint = new THREE.Color();
  const m = new THREE.Matrix4(), knee = new THREE.Matrix4(), turn = new THREE.Matrix4();
  /** person · T(pivot) · Rx(angle) */
  const limb = (person, x, y, angle) => m.makeTranslation(x, y, 0).premultiply(person.matrix).multiply(turn.makeRotationX(angle));
  const figures = outfits.map((outfit, index) => {
    const torso = sculpt(add => {
      add(body, bodyColor(outfit), { sz: 0.86 });
      add(head, '#a98466', { y: 13.75, sy: 1.1 });
      add(hair, outfit.hair, { y: 13.9, z: -0.1, sy: 1.02 });
      if (outfit.shield) {
        // The small round caetra on the left forearm, domed and tilted back so its face shows from above.
        add(shield, '#b08a58', { x: -2.75, y: 8.3, z: 1.0, rx: Math.PI / 2 - 0.5, rz: 0.3, sy: 0.55 });
        add(boss, '#e0d3b0', { x: -2.82, y: 8.45, z: 1.62, rx: Math.PI / 2 - 0.5, rz: 0.3 });
      }
      if (outfit.spear) {
        const lean = outfit.spearLean, tip = 8.4;
        add(shaft, '#5e4630', { x: 2.95, y: 9.6, z: 0.9, rz: -lean, rx: 0.12 });
        add(blade, '#d9d3c0', { x: 2.95 + Math.sin(lean) * tip, y: 9.6 + Math.cos(lean) * tip,
          z: 0.9 + Math.sin(0.12) * tip, rz: -lean, rx: 0.12, sx: 0.7 });
      }
    });
    const object = new THREE.Group();
    object.add(new THREE.Mesh(torso, material));
    for (const side of [0, 1]) {
      thighs.setColorAt(index * 2 + side, tint.set(outfit.tunic));
      arms.setColorAt(index * 2 + side, tint.set(outfit.sleeve));
    }
    return { outfit, object, pose({ phase, amplitude: a }, person) {
      const s = Math.sin(phase), c = Math.cos(phase);
      const swing = s * outfit.swing * a;   // + = left leg back (Rx turns the foot towards -z)
      person.position.y += Math.abs(c) * 0.3 * a;
      person.rotation.set(0.06 * a, 0, outfit.lean + s * 0.035 * a);
      person.updateMatrix();
      // Thighs, then shins bent at the knee while that leg swings forward.
      thighs.setMatrixAt(index * 2, limb(person, -0.8, HIP, swing));
      shins.setMatrixAt(index * 2, m.multiply(knee.makeTranslation(0, -THIGH, 0)).multiply(turn.makeRotationX(0.75 * a * Math.max(0, -c))));
      thighs.setMatrixAt(index * 2 + 1, limb(person, 0.8, HIP, -swing));
      shins.setMatrixAt(index * 2 + 1, m.multiply(knee.makeTranslation(0, -THIGH, 0)).multiply(turn.makeRotationX(0.75 * a * Math.max(0, c))));
      // Arms swing against the legs; the shield and spear hands move less. A slight forward bend at rest.
      arms.setMatrixAt(index * 2, limb(person, -2.2, SHOULDER, -0.12 - swing * (outfit.shield ? 0.35 : 0.9)));
      arms.setMatrixAt(index * 2 + 1, limb(person, 2.2, SHOULDER, -0.12 + swing * (outfit.spear ? 0.35 : 0.9)));
    } };
  });
  root.add(thighs, shins, arms);
  for (const geometry of [body, head, hair, shield, boss, shaft, blade, thighShape, shinShape, foot, armShape]) geometry.dispose();
  return { figures, after() { for (const instanced of [thighs, shins, arms]) instanced.instanceMatrix.needsUpdate = true; } };
}

/**
 * A visual-only warband. x/z are offsets in map units and y follows the local terrain. With `model` (from
 * loadWarbandModel) the men are the Blender figures; without it, the procedural fallback.
 */
export function makeWarband(model = null) {
  const root = new THREE.Group();
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: '#1d1711', vertexColors: true, transparent: true,
    opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const shadows = new THREE.InstancedMesh(shadowDisc(), shadowMaterial, outfits.length);
  shadows.name = 'shadows';
  shadows.renderOrder = -1;   // under the men, over the terrain
  shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shadows.frustumCulled = false;
  root.add(shadows);
  const kind = model ? modelFigures(model) : null;
  const procedural = model ? null : proceduralFigures(root);
  const figures = (kind ?? procedural.figures).map(figure => {
    const person = new THREE.Group();
    person.name = figure.outfit.name;
    person.position.set(figure.outfit.x, 0, figure.outfit.z);
    person.add(figure.object);
    root.add(person);
    return { ...figure, person };
  });

  const m = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0), ground = new THREE.Vector3(), tilt = new THREE.Quaternion();
  const spot = new THREE.Vector3(), size3 = new THREE.Vector3(), yaw = new THREE.Quaternion();
  let distance = 0, amplitude = 0;

  /**
   * Pose the band. `travelled` is the displayed distance moved since the last pose (map units) and drives the
   * stride, so the steps keep pace with the ground; `walking` is false once the march tween has ended.
   */
  function update(position, heading, travelled, walking, terrain) {
    root.rotation.y = heading;
    distance += travelled;
    // Stride height follows the displayed speed: the eased tween slows to a stop, so the legs settle with it.
    const target = walking ? Math.min(1, travelled / 0.35) : 0;
    amplitude = walking ? amplitude + (target - amplitude) * 0.35 : 0;
    const center = terrain.heightAt(position.x, position.y), size = root.scale.x;
    const sin = Math.sin(heading) * size, cos = Math.cos(heading) * size;
    for (const [index, { outfit, person, pose }] of figures.entries()) {
      const x = position.x + outfit.x * cos + outfit.z * sin;
      const y = position.y - outfit.x * sin + outfit.z * cos;
      const floor = (terrain.heightAt(x, y) - center) / size;
      const phase = distance / (CYCLE * outfit.stride * size) * Math.PI * 2 + outfit.phase;
      person.position.y = floor;
      person.rotation.set(0, 0, 0);
      person.updateMatrix();
      pose({ phase, amplitude }, person);
      // Contact shadow: flat on the local slope, a little downwind of the scene's key light (from -x, -z) so it
      // shows beside the man instead of hiding under his cloak; it does not bob with him. The rendered terrain is
      // a triangulated grid that can sit slightly above heightAt on slopes, so the shadow is lifted a little.
      const step = 1.5;
      ground.set(-(terrain.heightAt(x + step, y) - terrain.heightAt(x - step, y)) / (2 * step), 1,
        -(terrain.heightAt(x, y + step) - terrain.heightAt(x, y - step)) / (2 * step)).normalize()
        .applyAxisAngle(up, -heading);
      tilt.setFromUnitVectors(up, ground).multiply(yaw.setFromAxisAngle(up, LIGHT_YAW - heading));
      spot.set(LIGHT.x, 0, LIGHT.z).applyAxisAngle(up, -heading).multiplyScalar(SHADOW_SHIFT);
      shadows.setMatrixAt(index, m.compose(spot.add(person.position).setY(floor + 0.6), tilt, size3.set(3.3, 1, 2.5)));
    }
    procedural?.after();
    shadows.instanceMatrix.needsUpdate = true;
  }

  const meshes = [];
  root.traverse(object => { if (object.isMesh) meshes.push(object); });
  root.userData.stats = { model: model ? 'blender' : 'procedural', figures: figures.length, meshes: meshes.length,
    triangles: meshes.reduce((sum, mesh) => sum + (mesh.geometry.index ?? mesh.geometry.getAttribute('position')).count / 3 * (mesh.count ?? 1), 0),
    materials: new Set(meshes.map(mesh => mesh.material)).size,
    geometries: new Set(meshes.map(mesh => mesh.geometry)).size };
  root.userData.update = update;
  root.userData.dispose = () => { for (const figure of figures) figure.dispose?.(); };
  return root;
}
