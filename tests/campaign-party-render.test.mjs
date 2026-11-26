import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { makeParty, makePlanning, disposeGroup } from '../src/campaign-map-3d/overlays.js';
import { loadWarbandModel } from '../src/campaign-map-3d/party.js';
import { ringPoints, tacticalStroke } from '../src/campaign-map-3d/tactical-lines.js';
import { subdivideLine } from '../src/campaign-map-3d/terrain.js';

const terrain = { w: 1000, h: 700, heightAt: (x, y) => 30 + x / 100 + y / 200 };
const projection = { toScene: (p, z) => ({ x: p.x - 500, y: z, z: p.y - 350 }) };
const party = { x: 300, y: 300 };
const other = { x: 330, y: 310 };
// Rotation about x of instance `slot` relative to `parent` (a figure's matrix, or the thigh above a shin).
function limbAngle(limbs, slot, parent) {
  const m = new THREE.Matrix4();
  limbs.getMatrixAt(slot, m);
  m.premultiply(parent.clone().invert());
  return Math.atan2(m.elements[6], m.elements[5]);
}
const matrixAt = (limbs, slot) => { const m = new THREE.Matrix4(); limbs.getMatrixAt(slot, m); return m; };
const vertices = mesh => Array.from(mesh.geometry.getAttribute('position').array.slice(0, mesh.geometry.drawRange.count * 3));

test('four figures, selection ring and shared resources persist across pose updates and dispose on world replacement', () => {
  const visual = makeParty(terrain, projection, party);
  const [ring, warband] = visual.children;
  const ringGeometry = ring.geometry;
  const oldPosition = warband.position.clone();
  const oldResources = new Set();
  visual.traverse(child => { if (child.isMesh) { oldResources.add(child.geometry); oldResources.add(child.material); } });
  const people = warband.children.filter(child => child.isGroup);
  const [thighs, shins, arms, shadows] = ['thighs', 'shins', 'arms', 'shadows'].map(name => warband.getObjectByName(name));
  const buffers = [thighs, shins, arms, shadows].map(limbs => limbs.instanceMatrix).concat(thighs.instanceColor, arms.instanceColor);
  assert.equal(people.length, 4);
  assert.deepEqual([thighs.count, shins.count, arms.count, shadows.count], [8, 8, 8, 4], 'two legs (thigh, shin), two arms and a shadow per man');
  assert.ok(visual.userData.stats.meshes <= 16);
  assert.ok(visual.userData.stats.triangles <= 3000);
  assert.equal(visual.userData.stats.materials, 3, 'figures, contact shadows, ring');
  warband.traverse(child => {
    if (child.isMesh && child.material.isMeshStandardMaterial)
      assert.ok(child.geometry.getAttribute('normal'), 'every lit figure part carries its own (smooth) normals');
  });
  assert.equal(limbAngle(thighs, 0, people[0].matrix), 0);

  const target = Math.atan2(other.x - party.x, other.y - party.y);
  visual.userData.updateParty(other, 1);
  assert.deepEqual(visual.children, [ring, warband]);
  assert.notDeepEqual(warband.position, oldPosition);
  assert.ok(warband.rotation.y > 0 && warband.rotation.y < target, 'the band turns progressively, not in one frame');
  const stride = limbAngle(thighs, 0, people[0].matrix);
  assert.notEqual(stride, 0, 'legs stride while the displayed position moves');
  assert.ok(Math.abs(limbAngle(thighs, 1, people[0].matrix) + stride) < 1e-6, 'the two legs swing in opposition');
  assert.ok(Math.sign(limbAngle(arms, 0, people[0].matrix) + 0.12) === -Math.sign(stride), 'the left arm swings against the left leg');
  let bent = 0;
  for (let i = 1; i <= 12; i++) {
    visual.userData.updateParty({ x: other.x + i * 0.5, y: other.y + i * 0.15 }, 1);
    for (const slot of [0, 1]) {
      const knee = limbAngle(shins, slot, matrixAt(thighs, slot).multiply(new THREE.Matrix4().makeTranslation(0, -3.3, 0)));
      assert.ok(knee >= -1e-9, 'knees only bend backwards');
      bent = Math.max(bent, knee);
    }
  }
  assert.ok(bent > 0.1, 'the knee bends during the swing');
  const afterResources = new Set();
  visual.traverse(child => { if (child.isMesh) { afterResources.add(child.geometry); afterResources.add(child.material); } });
  assert.deepEqual(afterResources, oldResources);
  assert.deepEqual([thighs, shins, arms, shadows].map(limbs => limbs.instanceMatrix).concat(thighs.instanceColor, arms.instanceColor),
    buffers, 'poses rewrite the same instance buffers');

  // The contact shadow lies on the local slope and does not bob with the stride.
  const walkingShadow = matrixAt(shadows, 0);
  const end = { x: other.x + 6, y: other.y + 1.8 };
  visual.userData.updateParty(end, 0);
  assert.ok(Math.abs(warband.rotation.y - Math.atan2(0.5, 0.15)) < 1e-9, 'the march end settles on the last displayed direction');
  assert.equal(limbAngle(thighs, 0, people[0].matrix), 0, 'legs rest without changing the march duration');
  const slope = new THREE.Vector3(-1 / 100, 1, -1 / 200).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), -warband.rotation.y);
  const restShadow = matrixAt(shadows, 0), shadowUp = new THREE.Vector3().setFromMatrixColumn(restShadow, 1).normalize();
  assert.ok(shadowUp.distanceTo(slope) < 1e-6, 'the shadow follows the terrain slope');
  visual.userData.updateParty(end, 1);
  visual.userData.updateParty(end, 0);
  assert.ok(Math.abs(new THREE.Vector3().setFromMatrixPosition(matrixAt(shadows, 0)).y - new THREE.Vector3().setFromMatrixPosition(restShadow).y) < 1e-9);
  assert.notDeepEqual(walkingShadow.elements, restShadow.elements);
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

test('the Blender warband: four skinned men on shared geometry, walking knees, held weapons and a world-safe dispose', async () => {
  const model = await loadWarbandModel();
  const visual = makeParty(terrain, projection, party, model);
  const [ring, warband] = visual.children;
  const men = [];
  warband.traverse(child => { if (child.isSkinnedMesh) men.push(child); });
  assert.deepEqual(men.map(man => man.name), ['mapa_guerreiro_viriato', 'mapa_guerreiro_a', 'mapa_guerreiro_b', 'mapa_guerreiro_c']);
  assert.equal(visual.userData.stats.model, 'blender');
  assert.deepEqual([visual.userData.stats.meshes, visual.userData.stats.materials], [6, 3], 'four men, contact shadows, ring');
  assert.ok(men.every(man => man.geometry.userData.shared && man.material.userData.shared), 'the model is shared by every world');
  assert.equal(new Set(men.map(man => man.skeleton)).size, 4, 'each man has his own skeleton');
  const bones = man => Object.fromEntries(man.skeleton.bones.map(bone => [bone.name, bone]));
  const viriato = bones(men[0]);
  const rest = { calf: viriato.calf_l.quaternion.clone(), hand: viriato.hand_r.quaternion.clone(), arm: viriato.upperarm_l.quaternion.clone() };
  const resources = new Set();
  visual.traverse(child => { if (child.isMesh) resources.add(child.geometry).add(child.material); });

  let bent = 0, swung = 0;
  for (let i = 1; i <= 12; i++) {
    visual.userData.updateParty({ x: party.x + i * 2, y: party.y + i * 0.5 }, 1);
    bent = Math.max(bent, viriato.calf_l.quaternion.angleTo(rest.calf));
    swung = Math.max(swung, viriato.upperarm_l.quaternion.angleTo(rest.arm));
    assert.ok(viriato.hand_r.quaternion.angleTo(rest.hand) < 1e-6, 'the spear hand keeps its hold while walking');
  }
  assert.ok(bent > 0.2, `the knee bends while walking (${bent.toFixed(2)} rad)`);
  assert.ok(swung > 0.05, `the free arm swings (${swung.toFixed(2)} rad)`);
  const after = new Set();
  visual.traverse(child => { if (child.isMesh) after.add(child.geometry).add(child.material); });
  assert.deepEqual(after, resources, 'poses create no geometry or material');
  visual.userData.updateParty({ x: party.x + 24, y: party.y + 6 }, 0);
  assert.ok(viriato.calf_l.quaternion.angleTo(rest.calf) < 1e-6, 'the march end returns to the standing pose');

  const released = new Set(), skeletons = new Set();
  for (const resource of resources) resource.addEventListener('dispose', () => released.add(resource));
  for (const man of men) { const dispose = man.skeleton.dispose.bind(man.skeleton); man.skeleton.dispose = () => { skeletons.add(man); dispose(); }; }
  disposeGroup(visual);
  assert.equal(skeletons.size, 4, 'each world frees its skeletons');
  assert.ok(men.every(man => !released.has(man.geometry) && !released.has(man.material)), 'the shared model survives the world');
  assert.ok(released.has(ring.geometry) && released.has(warband.getObjectByName('shadows').geometry));
});

test('the band starts with the simple figures and swaps in the Blender ones once, inside the same group', async () => {
  const model = await loadWarbandModel();
  const visual = makeParty(terrain, projection, party);
  const [ring, simple] = visual.children;
  const released = new Set();
  simple.traverse(child => { if (child.isMesh) for (const r of [child.geometry, child.material]) r.addEventListener('dispose', () => released.add(r)); });
  visual.userData.updateParty(other, 0);
  visual.userData.useModel(model);
  const [ringAfter, blender] = visual.children;
  assert.equal(ringAfter, ring);
  assert.notEqual(blender, simple);
  assert.equal(visual.userData.stats.model, 'blender');
  assert.ok(released.size > 0, 'the simple figures are released');
  assert.deepEqual(blender.position, simple.position, 'the swap keeps the band where it was');
  visual.userData.useModel(model);
  assert.equal(visual.children[1], blender, 'a second load does not rebuild the band');
  disposeGroup(visual);
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
