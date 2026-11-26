import * as THREE from 'three';

// Small map silhouettes, built once per loaded world. The camera looks down steeply, so the band is read
// mostly from above: dark wool cloaks with terrain showing between them, and Viriato's light mantle at the
// front. Bodies are one baked mesh per figure; the eight legs and eight arms are two instanced meshes whose
// matrices change in place, so a pose never creates geometry.
const material = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true,
  side: THREE.DoubleSide });

function parts() {
  return {
    tunic: new THREE.CylinderGeometry(1.9, 2.6, 6.2, 6),
    cloak: new THREE.CylinderGeometry(2.5, 3.5, 7.2, 7, 1, true, Math.PI * 0.55, Math.PI * 1.25),
    shoulders: new THREE.CylinderGeometry(1.3, 2.75, 1.7, 7),
    head: new THREE.IcosahedronGeometry(1.6, 0),
    hair: new THREE.ConeGeometry(1.75, 1.3, 6),
    belt: new THREE.CylinderGeometry(2.25, 2.25, 0.6, 6),
    shield: new THREE.CylinderGeometry(2.5, 2.5, 0.5, 8),
    boss: new THREE.CylinderGeometry(0.8, 0.8, 0.8, 6),
    spear: new THREE.CylinderGeometry(0.5, 0.5, 15, 4),
    spearhead: new THREE.ConeGeometry(0.85, 2.4, 4),
    leg: new THREE.CylinderGeometry(0.85, 0.75, 4.6, 5),
    shoe: new THREE.BoxGeometry(1.7, 0.8, 2.6),
    arm: new THREE.CylinderGeometry(0.75, 0.65, 4.4, 5),
  };
}

/** Bake several coloured primitives into one geometry. */
function sculpt(build) {
  const positions = [], colors = [];
  const point = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const tint = new THREE.Color();
  function add(geometry, color, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0,
    sx = 1, sy = 1, sz = 1 } = {}) {
    matrix.compose(new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    tint.set(color);
    const source = geometry.getAttribute('position'), index = geometry.getIndex();
    for (let i = 0; i < (index?.count ?? source.count); i++) {
      point.fromBufferAttribute(source, index ? index.getX(i) : i).applyMatrix4(matrix);
      positions.push(point.x, point.y, point.z);
      colors.push(tint.r, tint.g, tint.b);
    }
  }
  build(add);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// Offsets in map units (x right, z forward). An uneven wedge: Viriato leads slightly off-centre and the
// rear man trails, so the terrain shows between all four. Gait values give each man his own rhythm.
const outfits = [
  { name: 'viriato', x: 1.0, z: 7.2, tunic: '#5a4a38', cloak: '#ddd2bb', sleeve: '#cfc3aa', hair: '#2f2a25',
    shield: false, spear: true, spearLean: 0.32, lean: 0, phase: 0, stride: 1, swing: 0.7 },
  { name: 'companion-a', x: -6.6, z: 0.8, tunic: '#5b4632', cloak: '#2e2722', sleeve: '#5b4632', hair: '#3e3328',
    shield: true, spear: true, spearLean: 0.4, lean: -0.06, phase: 2.2, stride: 0.94, swing: 0.62 },
  { name: 'companion-b', x: 6.1, z: -1.4, tunic: '#4f3f2e', cloak: '#3a2d24', sleeve: '#4f3f2e', hair: '#2a2622',
    shield: true, spear: false, spearLean: 0, lean: 0.05, phase: 4.1, stride: 1.05, swing: 0.66 },
  { name: 'companion-c', x: -1.8, z: -7.6, tunic: '#625039', cloak: '#2b2420', sleeve: '#625039', hair: '#4a3b2d',
    shield: false, spear: true, spearLean: -0.36, lean: -0.03, phase: 1.1, stride: 0.98, swing: 0.58 },
];
// CYCLE: map units per full stride. A day's march shows 45 units in 300 ms; a stride matched to the legs (~8 units)
// would flicker at ~17 Hz, so the stride is stretched to ~1.25 cycles per day (about 4 Hz): readable steps, some slip.
const HIP = 4.6, SHOULDER = 10.2, CYCLE = 36;

/** A visual-only warband. x/z are offsets in map units and y follows the local terrain. */
export function makeWarband() {
  const root = new THREE.Group();
  const template = parts(), sharedMaterial = material(), figures = [];
  const legGeometry = sculpt(add => {
    add(template.leg, '#5e4f3c', { y: -2.3 });
    add(template.shoe, '#2f261e', { y: -4.4, z: 0.4 });
  });
  // White sleeves take each man's colour from the instance.
  const armGeometry = sculpt(add => add(template.arm, '#ffffff', { y: -2.1 }));
  const legs = new THREE.InstancedMesh(legGeometry, sharedMaterial, outfits.length * 2);
  const arms = new THREE.InstancedMesh(armGeometry, sharedMaterial, outfits.length * 2);
  for (const limbs of [legs, arms]) {
    limbs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    limbs.frustumCulled = false;   // the instances move every pose; the default sphere would go stale
  }
  const tint = new THREE.Color();
  for (const [index, outfit] of outfits.entries()) {
    const person = new THREE.Group();
    person.name = outfit.name;
    person.position.set(outfit.x, 0, outfit.z);
    person.rotation.z = outfit.lean;
    const bodyGeometry = sculpt(add => {
      add(template.tunic, outfit.tunic, { y: 7.6 });
      add(template.cloak, outfit.cloak, { y: 8.1 });
      add(template.shoulders, outfit.cloak, { y: 10.9 });
      add(template.belt, '#2c241c', { y: 5.5 });
      add(template.head, '#a98466', { y: 13.0 });
      add(template.hair, outfit.hair, { y: 14.35, sy: index === 2 ? 0.7 : 1 });
      if (outfit.shield) {
        // The small round caetra on the left forearm, tilted back so its face shows from the map camera.
        add(template.shield, '#b08a58', { x: -3.0, y: 7.8, z: 2.2, rx: Math.PI / 2 - 0.55, rz: 0.35 });
        add(template.boss, '#e0d3b0', { x: -3.15, y: 8.05, z: 2.55, rx: Math.PI / 2 - 0.55, rz: 0.35 });
      }
      if (outfit.spear) {
        add(template.spear, '#5e4630', { x: 3.4, y: 9.8, z: 0.8, rz: -outfit.spearLean, rx: 0.12 });
        add(template.spearhead, '#d9d3c0', { x: 3.4 + Math.sin(outfit.spearLean) * 8.4, y: 9.8 + Math.cos(outfit.spearLean) * 8.4,
          z: 0.8 + Math.sin(0.12) * 8.4, rz: -outfit.spearLean, rx: 0.12 });
      }
    });
    const body = new THREE.Mesh(bodyGeometry, sharedMaterial);
    person.add(body);
    root.add(person);
    arms.setColorAt(index * 2, tint.set(outfit.sleeve));
    arms.setColorAt(index * 2 + 1, tint);
    figures.push({ person, outfit, index });
  }
  root.add(legs, arms);
  for (const geometry of Object.values(template)) geometry.dispose();

  const limb = new THREE.Matrix4(), turn = new THREE.Matrix4(), pivot = new THREE.Vector3();
  let distance = 0, amplitude = 0;
  function place(mesh, slot, person, x, y, angle) {
    limb.makeTranslation(pivot.set(x, y, 0));
    mesh.setMatrixAt(slot, limb.premultiply(person.matrix).multiply(turn.makeRotationX(angle)));
  }

  /**
   * Pose the band. `travelled` is the displayed distance moved since the last pose (map units) and drives the
   * stride, so feet keep pace with the ground; `walking` is false once the march tween has ended.
   */
  function update(position, heading, travelled, walking, terrain) {
    root.rotation.y = heading;
    distance += travelled;
    // Stride height follows the displayed speed: the eased tween slows to a stop, so the legs settle with it.
    const target = walking ? Math.min(1, travelled / 0.35) : 0;
    amplitude = walking ? amplitude + (target - amplitude) * 0.35 : 0;
    const center = terrain.heightAt(position.x, position.y), size = root.scale.x;
    const sin = Math.sin(heading) * size, cos = Math.cos(heading) * size;
    for (const { person, outfit, index } of figures) {
      const x = position.x + outfit.x * cos + outfit.z * sin;
      const y = position.y - outfit.x * sin + outfit.z * cos;
      const phase = distance / (CYCLE * outfit.stride * size) * Math.PI * 2 + outfit.phase;
      const swing = Math.sin(phase) * outfit.swing * amplitude;
      const bob = Math.abs(Math.cos(phase)) * 0.45 * amplitude;
      person.position.y = (terrain.heightAt(x, y) - center) / size + bob;
      person.rotation.x = 0.07 * amplitude;   // lean into the march
      person.updateMatrix();
      place(legs, index * 2, person, -1.1, HIP, swing);
      place(legs, index * 2 + 1, person, 1.1, HIP, -swing);
      place(arms, index * 2, person, -2.6, SHOULDER, -swing * 0.85);
      place(arms, index * 2 + 1, person, 2.6, SHOULDER, outfit.spear ? swing * 0.3 : swing * 0.85);
    }
    legs.instanceMatrix.needsUpdate = true;
    arms.instanceMatrix.needsUpdate = true;
  }

  const meshes = [];
  root.traverse(object => { if (object.isMesh) meshes.push(object); });
  root.userData.stats = { figures: figures.length, meshes: meshes.length,
    triangles: meshes.reduce((sum, mesh) => sum + mesh.geometry.getAttribute('position').count / 3 * (mesh.count ?? 1), 0),
    materials: new Set(meshes.map(mesh => mesh.material)).size,
    geometries: new Set(meshes.map(mesh => mesh.geometry)).size };
  root.userData.update = update;
  return root;
}
