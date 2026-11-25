import assert from 'node:assert/strict';
import test from 'node:test';
import { makeParty, makePlanning, disposeGroup } from '../src/campaign-map-3d/overlays.js';
import { ringPoints, tacticalStroke } from '../src/campaign-map-3d/tactical-lines.js';
import { subdivideLine } from '../src/campaign-map-3d/terrain.js';

const terrain = { w: 1000, h: 700, heightAt: (x, y) => 30 + x / 100 + y / 200 };
const projection = { toScene: (p, z) => ({ x: p.x - 500, y: z, z: p.y - 350 }) };
const party = { x: 300, y: 300 };
const other = { x: 330, y: 310 };
const vertices = mesh => Array.from(mesh.geometry.getAttribute('position').array.slice(0, mesh.geometry.drawRange.count * 3));

test('four figures, selection ring and shared resources persist across pose updates and dispose on world replacement', () => {
  const visual = makeParty(terrain, projection, party);
  const [ring, warband] = visual.children;
  const ringGeometry = ring.geometry;
  const oldPosition = warband.position.clone();
  const oldResources = new Set();
  visual.traverse(child => { if (child.isMesh) { oldResources.add(child.geometry); oldResources.add(child.material); } });
  assert.equal(warband.children.length, 4);
  assert.ok(visual.userData.stats.meshes <= 16);
  assert.ok(visual.userData.stats.triangles <= 3000);
  assert.equal(visual.userData.stats.materials, 2);
  visual.userData.updateParty(other, 1);
  assert.deepEqual(visual.children, [ring, warband]);
  assert.notDeepEqual(warband.position, oldPosition);
  assert.equal(warband.rotation.y, Math.atan2(other.x - party.x, other.y - party.y));
  assert.notEqual(warband.children[0].children[1].rotation.x, 0, 'legs stride with the existing tween phase');
  const afterResources = new Set();
  visual.traverse(child => { if (child.isMesh) { afterResources.add(child.geometry); afterResources.add(child.material); } });
  assert.deepEqual(afterResources, oldResources);
  visual.userData.updateParty(other, 0);
  assert.equal(warband.children[0].children[1].rotation.x, 0, 'legs rest without changing the march duration');
  assert.equal(ring.geometry, ringGeometry);
  assert.deepEqual(new Set([...oldResources].filter(resource => resource.isBufferGeometry)).size,
    visual.userData.stats.geometries);
  assert.deepEqual(vertices(ring), vertices(tacticalStroke(ringPoints({ ...other, r: 11 }), terrain, projection,
    { color: '#ffea9b', width: 2.4 })));
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
