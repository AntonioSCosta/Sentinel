import * as THREE from 'three';
import { subdivideLine } from './terrain.js';
import { ringPoints, strokeVertices, tacticalRing, tacticalStroke } from './tactical-lines.js';
import { makeWarband } from './party.js';

const RUMOR = { color: '#ffbc75', width: 1.9, dash: 11, gap: 6 };
const SCOUTED = { color: '#a6e2bf', width: 1.7 };
const ESTIMATED = { color: '#e9c49e', width: 2, dash: 2, gap: 5 };
const ROUTE = { color: '#c2f6ff', width: 2.8, dash: 7, gap: 4 };

/** Batch all trees into one mesh for trunks and one for crowns. */
export function makeForest(trees, projection) {
  const forest = new THREE.Group();
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.57, 0.82, 4, 5),
    new THREE.MeshStandardMaterial({ color: '#66523a', roughness: 1 }), trees.length);
  const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(3.6, 9, 6),
    new THREE.MeshStandardMaterial({ color: '#52664a', roughness: 1, flatShading: true }), trees.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (const [i, tree] of trees.entries()) {
    const { x, y, z } = projection.toScene(tree, tree.height);
    dummy.scale.setScalar(tree.scale);
    dummy.rotation.y = tree.rotation;
    dummy.position.set(x, y + 1.35 * tree.scale, z);
    dummy.updateMatrix();
    trunk.setMatrixAt(i, dummy.matrix);
    dummy.position.y = y + 6.1 * tree.scale;
    dummy.updateMatrix();
    crown.setMatrixAt(i, dummy.matrix);
    color.setScalar(0.68 + 0.4 * (tree.scale - 0.7) / 0.65);
    crown.setColorAt(i, color);
  }
  forest.add(trunk, crown);
  return forest;
}

/** Render intelligence zones and create pick targets exclusively for visible force records. */
export function makeIntelligence({ forces, zones }, terrain, projection) {
  const group = new THREE.Group(), targets = [], annotations = [];
  for (const zone of zones) {
    const recon = zone.src === 'batedores';
    const ring = tacticalRing(zone, terrain, projection, recon ? SCOUTED : RUMOR);
    group.add(ring);
    const center = projection.toScene(zone, terrain.heightAt(zone.x, zone.y));
    annotations.push({
      position: new THREE.Vector3(center.x, center.y, center.z),
      userData: { key: `zone:${zone.id}`, labelKey: recon ? 'map.scouted' : zone.src === 'rumor' ? 'map.rumor' : 'map.approximate',
        className: recon ? 'scouted-zone' : 'rumor-zone', priority: 3, lift: 4.5, ring },
    });
  }
  for (const force of forces) {
    const estimated = force.status === 'estimada';
    if (estimated) group.add(tacticalRing(force, terrain, projection, ESTIMATED));
    const marker = new THREE.Group();
    const point = projection.toScene(force, terrain.heightAt(force.x, force.y));
    marker.position.set(point.x, point.y, point.z);
    const selection = { type: 'force', id: force.id };
    marker.userData = {
      selection, force,
      className: estimated ? 'estimated' : 'confirmed', priority: 6, lift: 21,
    };
    const base = new THREE.Mesh(new THREE.CylinderGeometry(6, 7, 3.5, 8),
      new THREE.MeshStandardMaterial({ color: '#524438' }));
    base.position.y = 1;
    const standard = new THREE.Mesh(new THREE.BoxGeometry(9, 13, 2.8),
      new THREE.MeshStandardMaterial({ color: estimated ? '#a28470' : '#bd544b' }));
    standard.position.y = 10;
    marker.add(base, standard);
    group.add(marker);
    targets.push(marker);
  }
  return { group, targets, annotations };
}

/** Draw the UI's current movement and reconnaissance previews without running any orders. */
export function makePlanning(fx, terrain, projection) {
  const group = new THREE.Group();
  const point = (p, lift = 2.8) => {
    const { x, y, z } = projection.toScene(p, terrain.heightAt(p.x, p.y) + lift);
    return new THREE.Vector3(x, y, z);
  };
  const { route, trail, reach, focus, recon, hover } = fx;
  const moving = [];
  if (trail?.length) {
    const geometry = new THREE.BufferGeometry();
    const maxStep = Math.hypot(terrain.w, terrain.h);
    const capacity = 3 * (1 + trail.length * (Math.ceil(maxStep / 3) + 1));
    const position = new THREE.Float32BufferAttribute(new Float32Array(capacity), 3);
    position.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', position);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#afaf7e' }));
    line.frustumCulled = false;
    group.add(line);
    moving.push(party => {
      const points = [...trail, party].flatMap((p, i, all) =>
        i ? subdivideLine([all[i - 1], p], 3).slice(1) : [p]);
      if (points.length * 3 > position.array.length) throw new Error('Map trail exceeds its vertex budget');
      const vertices = points.flatMap(p => { const v = point(p); return [v.x, v.y, v.z]; });
      position.array.set(vertices);
      position.needsUpdate = true;
      geometry.setDrawRange(0, points.length);
    });
  }
  if (route) {
    const capacity = 18 * (Math.ceil(Math.hypot(terrain.w, terrain.h) / 2) + 1);
    for (const style of [{ ...ROUTE, color: '#163b43', width: 5 }, ROUTE]) {
      const stroke = mutableStroke(terrain, projection, style, capacity);
      group.add(stroke.mesh);
      moving.push(party => stroke.update(subdivideLine([party, route.to], 2)));
    }
    group.add(tacticalRing({ ...route.to, r: 6.5 }, terrain, projection, { color: ROUTE.color, width: 2 }));
  }
  if (reach) {
    const stroke = mutableStroke(terrain, projection, { color: '#d7d6ab', width: 0.65, dash: 2, gap: 4 },
      18 * (ringPoints({ x: 0, y: 0, r: reach }).length - 1));
    group.add(stroke.mesh);
    moving.push(party => stroke.update(ringPoints({ ...party, r: reach })));
  }
  if (focus) group.add(tacticalRing({ ...focus, r: Math.max(12, focus.r || 0) }, terrain, projection,
    { color: '#faf0a1', width: 1.3, dash: 2, gap: 5 }));
  if (recon) {
    const stroke = mutableStroke(terrain, projection, { ...SCOUTED, dash: 7, gap: 5 },
      18 * (ringPoints({ x: 0, y: 0, r: recon.range }).length - 1));
    group.add(stroke.mesh);
    moving.push(party => stroke.update(ringPoints({ ...party, r: recon.range })));
    if (hover) group.add(tacticalRing({ ...hover, r: recon.radius }, terrain, projection,
      { ...SCOUTED, color: recon.ok ? SCOUTED.color : '#eea98e' }));
  }
  group.userData.updateParty = party => { for (const update of moving) update(party); };
  group.userData.updateParty(fx.party);
  return group;
}

/** Keep the selection ring and the new four-figure warband alive for the loaded world. */
export function makeParty(terrain, projection, position) {
  const group = new THREE.Group();
  const ring = mutableStroke(terrain, projection, { color: '#ffea9b', width: 2.4 },
    18 * (ringPoints({ x: 0, y: 0, r: 11 }).length - 1));
  group.add(ring.mesh);
  const warband = makeWarband();
  group.add(warband);
  let previous, heading = 0;
  group.userData.updateParty = (party, step = 0) => {
    const dx = party.x - (previous?.x ?? party.x), dy = party.y - (previous?.y ?? party.y);
    if (Math.hypot(dx, dy) > 0.01) heading = Math.atan2(dx, dy);
    previous = { x: party.x, y: party.y };
    group.userData.heading = heading;
    const p = projection.toScene(party, terrain.heightAt(party.x, party.y));
    warband.position.set(p.x, p.y, p.z);
    warband.userData.update(party, heading, step, terrain);
    ring.update(ringPoints({ ...party, r: 11 }));
  };
  group.userData.updateParty(position);
  group.userData.stats = { ...warband.userData.stats, meshes: warband.userData.stats.meshes + 1,
    triangles: warband.userData.stats.triangles + ring.mesh.geometry.drawRange.count / 3,
    materials: warband.userData.stats.materials + 1, geometries: warband.userData.stats.geometries + 1 };
  return group;
}

function mutableStroke(terrain, projection, style, capacity) {
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.Float32BufferAttribute(new Float32Array(capacity), 3);
  position.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', position);
  const mesh = new THREE.Mesh(geometry,
    new THREE.MeshBasicMaterial({ color: style.color, side: THREE.DoubleSide, depthWrite: false }));
  mesh.frustumCulled = false;
  return { mesh, update(points) {
    const vertices = strokeVertices(points, terrain, projection, style);
    if (vertices.length > capacity) throw new Error('Map stroke exceeds its vertex budget');
    position.array.set(vertices);
    position.needsUpdate = true;
    geometry.setDrawRange(0, vertices.length / 3);
  } };
}

/** Dispose the shared and per-instance GPU resources of a removed scene group. */
export function disposeGroup(group) {
  const resources = new Set();
  group.traverse(child => {
    if (child.isMesh || child.isLine) { resources.add(child.geometry); resources.add(child.material); }
    if (child.isInstancedMesh) child.dispose();
  });
  for (const resource of resources) resource.dispose();
}
