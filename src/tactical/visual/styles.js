// M2 — as quatro representações comparáveis: M1.2 atual, A (geometria simples), B (low-poly articulado),
// C (híbrido). Todas recebem os mesmos soldados, posições e estado de animação; só muda a representação.
import * as THREE from 'three';
import { radius } from '../combat.js';
import {
  P, kitFor, simpleKit, m1Geometry, soldierMatrices, poseMatrices, motionOf, troopBudget,
} from './models.js';

const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const IDENTITY = new THREE.Quaternion();
const ONE = new THREE.Vector3(1, 1, 1);
const MAT = {
  flat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, flatShading: true }),
  smooth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, flatShading: false }),
  ring: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
};
export const TEAM = { romanos: new THREE.Color('#d8483c'), lusitanos: new THREE.Color('#efe0b0') };

/** Escala de cada estilo: os quatro ficam com uma altura efetiva de ≈2,05 m (o protótipo já amplia as figuras). */
const SCALE = { m1: 1.45, a: 1.38, b: 1.12, c: 1.12 };
const EFFECTIVE_HEIGHT = { m1: 2.1, a: 2.06, b: 2.18, c: 2.18 };

export const STYLE_INFO = {
  m1: {
    name: 'Current build (M1.2)', tag: 'Merged role bodies · UI ring',
    desc: 'Exactly the prototype soldier: four merged geometries, one ring per squad. No labels here, so only the soldiers are judged.',
  },
  a: {
    name: 'A · Simple geometry', tag: 'One merged body · colour blocks · whole-body motion',
    desc: 'Cheapest improvement: bigger shields tilted to the camera, faction colours, crest, spear. Animation is only lean, bob and lunge.',
  },
  b: {
    name: 'B · Low-poly characters', tag: 'Articulated limbs · one mesh per part',
    desc: 'Every limb animated, authored-style silhouettes. Stock Three.js cannot instance skinned meshes, so each soldier is a set of draw calls.',
  },
  c: {
    name: 'C · Hybrid', tag: 'Articulated kit · faction equipment · instanced parts',
    desc: 'The same rig and animation as B, but simple geometry, strong equipment (scutum, caetra, signum, sling staff) and instanced rendering.',
  },
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3();

function bodyMatrix(out, x, y, z, yaw, lean = 0) {
  _q.setFromAxisAngle(UP, -yaw);
  _q2.setFromAxisAngle(Z, -lean);
  _q.multiply(_q2);
  _p.set(x, y, z);
  _s.setScalar(1);
  out.compose(_p, _q, _s);
}

/** Comparação de custo de todas as representações, sem construir a cena. */
export function budgetTable(bands) {
  const soldiers = bands.flatMap(b => b.soldiers);
  const rows = {};
  for (const style of ['m1', 'a', 'b', 'c']) {
    const b = troopBudget(style, soldiers);
    rows[style] = {
      triangles: b.triangles,
      drawCalls: b.drawCalls + (style === 'm1' ? 1 : 0),   // + os anéis instanciados
      perSoldier: Math.round(b.triangles / soldiers.length),
      height: EFFECTIVE_HEIGHT[style],
      soldiers: soldiers.length,
    };
  }
  return rows;
}

// --- M1.2: corpos fundidos, um InstancedMesh por papel, anéis por squad ---

function createM1(bands, scene) {
  const capacity = {};
  for (const band of bands) for (const s of band.soldiers) {
    const role = s.role === 'signifer' ? 'legionario' : s.role;
    capacity[role] = (capacity[role] || 0) + 1;
  }
  const meshes = {};
  for (const [role, n] of Object.entries(capacity)) {
    const geo = m1Geometry(role).geometry;
    const mesh = new THREE.InstancedMesh(geo, MAT.flat, n);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);
    meshes[role] = { mesh, n: 0 };
  }
  const squads = bands.flatMap(b => b.squads);
  const ringGeo = new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2);
  const rings = new THREE.InstancedMesh(ringGeo, MAT.ring, Math.max(1, squads.length));
  rings.renderOrder = 20;
  rings.frustumCulled = false;
  scene.add(rings);
  const t = { calls: Object.keys(meshes).length + 1, triangles: 0 };
  for (const [role, m] of Object.entries(meshes)) t.triangles += m1Geometry(role).triangles * m.mesh.instanceMatrix.count;
  return {
    stats: { triangles: t.triangles, drawCalls: t.calls, height: EFFECTIVE_HEIGHT.m1, scale: SCALE.m1 },
    update(time, state) {
      for (const m of Object.values(meshes)) m.n = 0;
      const moving = state === 'march' || state === 'charge' || state === 'rout';
      for (const band of bands) {
        for (const s of band.soldiers) {
          const role = s.role === 'signifer' ? 'legionario' : s.role;
          const box = meshes[role];
          if (!box || box.n >= box.mesh.instanceMatrix.count) continue;
          const bob = moving ? Math.abs(Math.sin(time * 9 + s.phase)) * 0.14 : 0;
          const lunge = state === 'melee' ? Math.max(0, Math.sin(time * 6.5 + s.phase)) * 0.35 : 0;
          _m.compose(
            _p.set(s.x + Math.cos(s.yaw) * lunge, bob, s.z + Math.sin(s.yaw) * lunge),
            _q.setFromAxisAngle(UP, -s.yaw), _s.setScalar(SCALE.m1),
          );
          box.mesh.setMatrixAt(box.n++, _m);
        }
      }
      for (const m of Object.values(meshes)) { m.mesh.count = m.n; m.mesh.instanceMatrix.needsUpdate = true; }
      let i = 0;
      for (const sq of squads) {
        _m.compose(_p.set(sq.x, 0.12, sq.z), IDENTITY, _s.setScalar(radius(Math.max(1, sq.men)) * 1.15 + 0.9));
        rings.setMatrixAt(i, _m);
        rings.setColorAt(i, TEAM[sq.side] || TEAM.lusitanos);
        i++;
      }
      rings.count = i;
      rings.instanceMatrix.needsUpdate = true;
      if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
    },
    dispose() {
      for (const m of Object.values(meshes)) { scene.remove(m.mesh); }
      scene.remove(rings);
    },
  };
}

// --- A: um corpo fundido por fato, movimento de corpo inteiro ---

function createA(bands, scene) {
  const capacity = new Map();
  for (const band of bands) for (const s of band.soldiers) {
    const key = `${s.faction}:${s.role}`;
    capacity.set(key, (capacity.get(key) || 0) + 1);
  }
  const meshes = new Map();
  for (const [key, n] of capacity) {
    const [faction, role] = key.split(':');
    const mesh = new THREE.InstancedMesh(simpleKit(faction, role).geometry, MAT.flat, n);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);
    meshes.set(key, { mesh, n: 0 });
  }
  return {
    stats: { ...troopBudget('a', bands.flatMap(b => b.soldiers)), drawCalls: meshes.size, height: EFFECTIVE_HEIGHT.a, scale: SCALE.a },
    update(time, state) {
      for (const m of meshes.values()) m.n = 0;
      const moving = state === 'march' || state === 'charge' || state === 'rout';
      for (const band of bands) {
        for (const s of band.soldiers) {
          const box = meshes.get(`${s.faction}:${s.role}`); if (!box) continue;
          const a = motionOf(s, time, state);
          const bob = moving ? Math.abs(Math.sin(time * 9 + s.phase)) * 0.1 : 0;
          const lunge = state === 'melee' ? Math.max(0, Math.sin(time * 6 + s.phase)) * 0.3 : 0;
          _q.setFromAxisAngle(UP, -s.yaw);
          _q2.setFromAxisAngle(Z, -a.lean); _q.multiply(_q2);
          _p.set(s.x + Math.cos(s.yaw) * lunge, bob, s.z + Math.sin(s.yaw) * lunge);
          _s.setScalar(SCALE.a);
          box.mesh.setMatrixAt(box.n++, _m.compose(_p, _q, _s));
        }
      }
      for (const m of meshes.values()) { m.mesh.count = m.n; m.mesh.instanceMatrix.needsUpdate = true; }
    },
    dispose() { for (const m of meshes.values()) scene.remove(m.mesh); },
  };
}

// --- B: um conjunto de malhas por soldado (sem instancing) ---

function createB(bands, scene) {
  const soldiers = [];
  const counts = new Map();
  for (const band of bands) for (const s of band.soldiers) {
    const kit = kitFor(s.faction, s.role, 'high');
    const mats = soldierMatrices();
    const meshes = [];
    for (const [name, geo] of Object.entries(kit.parts)) {
      const mesh = new THREE.Mesh(geo, MAT.smooth);
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      meshes.push({ name, mesh });
    }
    counts.set(s, { mats, meshes });
    soldiers.push(s);
  }
  let triangles = 0;
  let drawCalls = 0;
  for (const band of bands) for (const s of band.soldiers) {
    const kit = kitFor(s.faction, s.role, 'high');
    triangles += kit.triangles;
    drawCalls += kit.partsCount;
  }
  return {
    stats: { triangles, drawCalls, height: EFFECTIVE_HEIGHT.b, scale: SCALE.b },
    update(time, state) {
      for (const s of soldiers) {
        const { mats, meshes } = counts.get(s);
        poseMatrices(s, mats, time, state);
        for (const { name, mesh } of meshes) {
          mesh.matrix.copy(mats[name]);
          mesh.matrixWorldNeedsUpdate = true;
        }
      }
    },
    dispose() { for (const { meshes } of counts.values()) for (const { mesh } of meshes) scene.remove(mesh); },
  };
}

// --- C: as mesmas peças e poses de B, mas uma InstancedMesh por (fato, peça) ---

function createC(bands, scene) {
  const sets = new Map();
  for (const band of bands) for (const s of band.soldiers) {
    const kit = kitFor(s.faction, s.role, 'low');
    for (const name of Object.keys(kit.parts)) {
      const key = `${s.faction}:${s.role}:${name}`;
      if (!sets.has(key)) sets.set(key, { geo: kit.parts[name], part: name, soldiers: [], mesh: null, n: 0 });
      sets.get(key).soldiers.push(s);
    }
  }
  const soldierData = new Map();
  for (const s of bands.flatMap(b => b.soldiers)) soldierData.set(s, { mats: soldierMatrices() });
  for (const [key, set] of sets) {
    const mesh = new THREE.InstancedMesh(set.geo, MAT.flat, set.soldiers.length);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    set.mesh = mesh;
  }
  let triangles = 0;
  for (const s of bands.flatMap(b => b.soldiers)) triangles += kitFor(s.faction, s.role, 'low').triangles;
  return {
    stats: { triangles, drawCalls: sets.size, height: EFFECTIVE_HEIGHT.c, scale: SCALE.c },
    update(time, state) {
      for (const [s, data] of soldierData) poseMatrices(s, data.mats, time, state);
      for (const set of sets.values()) {
        let n = 0;
        for (const s of set.soldiers) {
          const mats = soldierData.get(s).mats;
          set.mesh.setMatrixAt(n++, mats[set.part] || mats.torso);
        }
        set.mesh.count = n;
        set.mesh.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() { for (const set of sets.values()) scene.remove(set.mesh); },
  };
}

export function createStyle(name, bands, scene) {
  let style;
  if (name === 'm1') style = createM1(bands, scene);
  else if (name === 'a') style = createA(bands, scene);
  else if (name === 'b') style = createB(bands, scene);
  else style = createC(bands, scene);
  style.name = name;
  style.info = STYLE_INFO[name];
  return style;
}
