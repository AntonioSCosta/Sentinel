import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { makeParty, makePlanning, disposeGroup } from '../src/campaign-map-3d/overlays.js';
import { ringPoints, tacticalStroke } from '../src/campaign-map-3d/tactical-lines.js';
import { subdivideLine } from '../src/campaign-map-3d/terrain.js';

const terrain = { w: 1000, h: 700, heightAt: (x, y) => 30 + x / 100 + y / 200 };
const projection = { toScene: (p, z) => ({ x: p.x - 500, y: z, z: p.y - 350 }) };
const party = { x: 300, y: 300 };
const other = { x: 330, y: 310 };
// Rotation of limb `slot` relative to its figure: 0 at rest, the swing angle while walking.
function limbAngle(limbs, slot, person) {
  const m = new THREE.Matrix4();
  limbs.getMatrixAt(slot, m);
  m.premultiply(person.matrix.clone().invert());
  return Math.atan2(m.elements[6], m.elements[5]);
}
const vertices = mesh => Array.from(mesh.geometry.getAttribute('position').array.slice(0, mesh.geometry.drawRange.count * 3));

test('four figures, selection ring and shared resources persist across pose updates and dispose on world replacement', () => {
  const visual = makeParty(terrain, projection, party);
  const [ring, warband] = visual.children;
  const ringGeometry = ring.geometry;
  const oldPosition = warband.position.clone();
  const oldResources = new Set();
  visual.traverse(child => { if (child.isMesh) { oldResources.add(child.geometry); oldResources.add(child.material); } });
  const people = warband.children.filter(child => child.isGroup);
  const [legs, arms] = warband.children.filter(child => child.isInstancedMesh);
  const buffers = [legs.instanceMatrix, arms.instanceMatrix, arms.instanceColor];
  assert.equal(people.length, 4);
  assert.deepEqual([legs.count, arms.count], [8, 8], 'one instanced leg and arm pair per man');
  assert.ok(visual.userData.stats.meshes <= 16);
  assert.ok(visual.userData.stats.triangles <= 3000);
  assert.equal(visual.userData.stats.materials, 2);
  assert.equal(limbAngle(legs, 0, people[0]), 0);

  const target = Math.atan2(other.x - party.x, other.y - party.y);
  visual.userData.updateParty(other, 1);
  assert.deepEqual(visual.children, [ring, warband]);
  assert.notDeepEqual(warband.position, oldPosition);
  assert.ok(warband.rotation.y > 0 && warband.rotation.y < target, 'the band turns progressively, not in one frame');
  const stride = limbAngle(legs, 0, people[0]);
  assert.notEqual(stride, 0, 'legs stride while the displayed position moves');
  assert.ok(Math.abs(limbAngle(legs, 1, people[0]) + stride) < 1e-6, 'the two legs swing in opposition');
  assert.ok(Math.sign(limbAngle(arms, 0, people[0])) === -Math.sign(stride), 'the left arm swings against the left leg');
  for (let i = 1; i <= 12; i++) visual.userData.updateParty({ x: other.x + i * 0.5, y: other.y + i * 0.15 }, 1);
  const afterResources = new Set();
  visual.traverse(child => { if (child.isMesh) { afterResources.add(child.geometry); afterResources.add(child.material); } });
  assert.deepEqual(afterResources, oldResources);
  assert.deepEqual([legs.instanceMatrix, arms.instanceMatrix, arms.instanceColor], buffers, 'poses rewrite the same instance buffers');

  const end = { x: other.x + 6, y: other.y + 1.8 };
  visual.userData.updateParty(end, 0);
  assert.ok(Math.abs(warband.rotation.y - Math.atan2(0.5, 0.15)) < 1e-9, 'the march end settles on the last displayed direction');
  assert.equal(limbAngle(legs, 0, people[0]), 0, 'legs rest without changing the march duration');
  assert.equal(ring.geometry, ringGeometry);
  assert.deepEqual(new Set([...oldResources].filter(resource => resource.isBufferGeometry)).size,
    visual.userData.stats.geometries);
  assert.deepEqual(vertices(ring), vertices(tacticalStroke(ringPoints({ ...end, r: 11 }), terrain, projection,
    { color: '#ffea9b', width: 2.4 })));

  // Distance compensation scales the figures and the ring together, in place, up to the ring's buffer limit.
  visual.userData.setScreenScale(1.5);
  assert.equal(warband.scale.x, 1.5);
  assert.deepEqual(vertices(ring), vertices(tacticalStroke(ringPoints({ ...end, r: 16.5 }), terrain, projection,
    { color: '#ffea9b', width: 2.4 })));
  visual.userData.setScreenScale(9);
  assert.equal(warband.scale.x, 2);
  assert.equal(ring.geometry, ringGeometry);

  const released = new Set();
  for (const resource of oldResources)
    resource.addEventListener('dispose', () => released.add(resource));
  disposeGroup(visual);
  assert.equal(released.size, oldResources.size);
});

test('moving planning strokes keep their geometries and match the previous terrain-following route', () => {
  const destination = { x: 620, y: 460 };
  const planning = makePlanning({ party, route: { to: destination }, trail: [party], reach: 20,
    recon: { range: 250, radius: 25 }, focus: null, hover: null }, terrain, projection);
  const children = [...planning.children];
  const geometries = children.map(child => child.geometry);
  planning.userData.updateParty(other);
  assert.deepEqual(planning.children, children);
  assert.deepEqual(children.map(child => child.geometry), geometries);
  const expected = tacticalStroke(subdivideLine([other, destination], 2), terrain, projection,
    { color: '#163b43', width: 5, dash: 7, gap: 4 });
  assert.deepEqual(vertices(children[1]), vertices(expected));
  expected.geometry.dispose(); expected.material.dispose();
  disposeGroup(planning);
});
