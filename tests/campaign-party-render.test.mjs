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

test('party token, ring and materials persist across pose updates and dispose on scene replacement', () => {
  const visual = makeParty(terrain, projection, party);
  const [ring, token] = visual.children;
  const ringGeometry = ring.geometry, tokenGeometry = token.geometry;
  const ringMaterial = ring.material, tokenMaterial = token.material;
  const oldPosition = token.position.clone();
  visual.userData.updateParty(other);
  assert.deepEqual(visual.children, [ring, token]);
  assert.equal(ring.geometry, ringGeometry);
  assert.equal(token.geometry, tokenGeometry);
  assert.notDeepEqual(token.position, oldPosition);
  assert.deepEqual(vertices(ring), vertices(tacticalStroke(ringPoints({ ...other, r: 11 }), terrain, projection,
    { color: '#ffea9b', width: 2.4 })));
  const released = new Set();
  for (const resource of [ringGeometry, tokenGeometry, ringMaterial, tokenMaterial])
    resource.addEventListener('dispose', () => released.add(resource));
  disposeGroup(visual);
  assert.equal(released.size, 4);
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
