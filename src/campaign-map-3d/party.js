import * as THREE from 'three';

// Small map silhouettes, built once per loaded world. The companions share one material
// and the same low-poly parts, but differ in colour, equipment and stance.
const material = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true,
  side: THREE.DoubleSide });

function parts() {
  return {
    tunic: new THREE.CylinderGeometry(2.3, 3.1, 6.5, 6),
    mantle: new THREE.CylinderGeometry(2.7, 3.9, 8, 7, 1, true, Math.PI / 3, Math.PI * 1.4),
    head: new THREE.IcosahedronGeometry(1.8, 0),
    hair: new THREE.ConeGeometry(2.0, 1.5, 6),
    arm: new THREE.CylinderGeometry(0.8, 0.9, 4.3, 5),
    belt: new THREE.CylinderGeometry(2.9, 2.9, 0.65, 6),
    shield: new THREE.CylinderGeometry(2.6, 2.6, 0.55, 7),
    boss: new THREE.CylinderGeometry(0.85, 0.85, 0.7, 6),
    spear: new THREE.CylinderGeometry(0.28, 0.34, 12, 5),
    spearhead: new THREE.ConeGeometry(0.75, 2.0, 5),
    leg: new THREE.CylinderGeometry(0.85, 0.95, 4.4, 5),
    shoe: new THREE.BoxGeometry(1.8, 0.85, 2.8),
  };
}

/** Bake several coloured primitives into one mesh; only the legs need separate transforms. */
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

const outfits = [
  { name: 'viriato', x: 0, z: 5.2, tunic: '#574b3c', mantle: '#cbbda5', hair: '#38342e',
    leather: '#4a3b2e', shield: false, spear: true, lean: 0 },
  { name: 'companion-a', x: -5.2, z: -1.6, tunic: '#70634c', mantle: null, hair: '#43382d',
    leather: '#52412e', shield: true, spear: true, lean: -0.08 },
  { name: 'companion-b', x: 5.0, z: -2.4, tunic: '#675640', mantle: '#796f57', hair: '#332e29',
    leather: '#4b3d30', shield: true, spear: false, lean: 0.07 },
  { name: 'companion-c', x: -0.4, z: -6.2, tunic: '#777057', mantle: null, hair: '#524133',
    leather: '#52442e', shield: false, spear: true, lean: -0.04 },
];

/** A visual-only warband. x/z are offsets in map units and y follows the local terrain. */
export function makeWarband() {
  const root = new THREE.Group();
  const template = parts(), sharedMaterial = material(), figures = [];
  const legGeometry = sculpt(add => {
    add(template.leg, '#71624a', { y: -2.25 });
    add(template.shoe, '#4d3e30', { y: -4.25, z: 0.45 });
  });
  for (const [index, outfit] of outfits.entries()) {
    const person = new THREE.Group();
    person.name = outfit.name;
    person.position.set(outfit.x, 0, outfit.z);
    person.rotation.z = outfit.lean;
    const bodyGeometry = sculpt(add => {
      add(template.tunic, outfit.tunic, { y: 8.2 });
      if (outfit.mantle) add(template.mantle, outfit.mantle, { y: 8.5 });
      add(template.belt, outfit.leather, { y: 5.7 });
      add(template.head, '#ab8566', { y: 13.6 });
      add(template.hair, outfit.hair, { y: 15.1, sy: index === 2 ? 0.65 : 0.9 });
      add(template.arm, outfit.tunic, { x: -3.0, y: 9.0, rz: -0.25 });
      add(template.arm, outfit.tunic, { x: 3.0, y: 9.0, rz: 0.25 });
      if (outfit.shield) {
        add(template.shield, outfit.leather, { x: -4.1, y: 7.8, z: 1.6, rx: Math.PI / 2 });
        add(template.boss, '#a49370', { x: -4.1, y: 7.8, z: 2.0, rx: Math.PI / 2 });
      }
      if (outfit.spear) {
        add(template.spear, '#755f41', { x: 4.15, y: 9.5, z: 1.0, rz: index === 3 ? -0.13 : 0.08 });
        add(template.spearhead, '#948c78', { x: 4.15, y: 16.3, z: 1.0 });
      }
    });
    const body = new THREE.Mesh(bodyGeometry, sharedMaterial);
    person.add(body);
    const legs = [-1, 1].map(side => {
      const leg = new THREE.Mesh(legGeometry, sharedMaterial);
      leg.position.set(side * 1.5, 5.0, 0);
      person.add(leg);
      return leg;
    });
    root.add(person);
    figures.push({ person, body, legs, outfit, phase: index * 0.8 });
  }
  for (const geometry of Object.values(template)) geometry.dispose();

  function update(position, heading, step, terrain) {
    root.rotation.y = heading;
    const center = terrain.heightAt(position.x, position.y);
    const sin = Math.sin(heading), cos = Math.cos(heading);
    for (const { person, body, legs, outfit, phase } of figures) {
      const x = position.x + outfit.x * cos + outfit.z * sin;
      const y = position.y - outfit.x * sin + outfit.z * cos;
      person.position.y = terrain.heightAt(x, y) - center;
      const stride = step ? Math.sin(step + phase) : 0;
      legs[0].rotation.x = stride * 0.24;
      legs[1].rotation.x = -stride * 0.24;
      body.position.y = step ? Math.abs(stride) * 0.18 : 0;
    }
  }

  const meshes = [];
  root.traverse(object => { if (object.isMesh) meshes.push(object); });
  root.userData.stats = { figures: figures.length, meshes: meshes.length,
    triangles: meshes.reduce((sum, mesh) => sum + mesh.geometry.getAttribute('position').count / 3, 0),
    materials: new Set(meshes.map(mesh => mesh.material)).size,
    geometries: new Set(meshes.map(mesh => mesh.geometry)).size };
  root.userData.update = update;
  return root;
}
