import * as THREE from 'three';
import { subdivideLine } from './terrain.js';
import { tacticalRing, tacticalStroke } from './tactical-lines.js';

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
    group.add(tacticalRing(zone, terrain, projection, recon ? SCOUTED : RUMOR));
    const center = projection.toScene(zone, terrain.heightAt(zone.x, zone.y));
    annotations.push({
      position: new THREE.Vector3(center.x, center.y, center.z),
      userData: { key: `zone:${zone.id}`, labelKey: recon ? 'map.scouted' : zone.src === 'rumor' ? 'map.rumor' : 'map.approximate',
        className: recon ? 'scouted-zone' : 'rumor-zone', priority: 3, lift: 4.5 },
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
  function line(points, color) {
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p => point(p))),
      new THREE.LineBasicMaterial({ color })));
  }
  const { party, route, trail, reach, focus, recon, hover } = fx;
  if (trail?.length) line([...trail, party].flatMap((p, i, points) =>
    i ? subdivideLine([points[i - 1], p], 3).slice(1) : [p]), '#afaf7e');
  if (route) {
    const points = subdivideLine([party, route.to], 2);
    group.add(
      tacticalStroke(points, terrain, projection, { ...ROUTE, color: '#163b43', width: 5 }),
      tacticalStroke(points, terrain, projection, ROUTE),
      tacticalRing({ ...route.to, r: 6.5 }, terrain, projection, { color: ROUTE.color, width: 2 }),
    );
  }
  if (reach) group.add(tacticalRing({ ...party, r: reach }, terrain, projection,
    { color: '#d7d6ab', width: 0.65, dash: 2, gap: 4 }));
  if (focus) group.add(tacticalRing({ ...focus, r: Math.max(12, focus.r || 0) }, terrain, projection,
    { color: '#faf0a1', width: 1.3, dash: 2, gap: 5 }));
  if (recon) {
    group.add(tacticalRing({ ...party, r: recon.range }, terrain, projection, { ...SCOUTED, dash: 7, gap: 5 }));
    if (hover) group.add(tacticalRing({ ...hover, r: recon.radius }, terrain, projection,
      { ...SCOUTED, color: recon.ok ? SCOUTED.color : '#eea98e' }));
  }
  group.add(tacticalRing({ ...party, r: 11 }, terrain, projection, { color: '#ffea9b', width: 2.4 }));
  const token = new THREE.Mesh(new THREE.CylinderGeometry(4, 7.5, 11, 4),
    new THREE.MeshBasicMaterial({ color: '#ffe698' }));
  token.rotation.y = Math.PI / 4;
  token.position.copy(point(party, 9.5));
  group.add(token);
  return group;
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
