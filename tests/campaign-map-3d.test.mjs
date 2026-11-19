import assert from 'node:assert/strict';
import test from 'node:test';
import { newCampaign, serialize } from '../src/campaign/state.js';
import { generateWorld } from '../src/campaign/worldgen.js';
import { createCampaignTerrain, createMapProjection, readPrototypeSave } from '../src/campaign-map-3d/terrain.js';

test('strategic coordinates round-trip independently of elevation', () => {
  const world = generateWorld(1);
  const projection = createMapProjection(world);
  for (const point of [...world.settlements, ...world.road, { x: 0, y: 0 }, { x: world.w, y: world.h }]) {
    const scene = projection.toScene(point, 124);
    assert.equal(scene.y, 124);
    const restored = projection.toMap(scene);
    assert.ok(Math.abs(restored.x - point.x) < 1e-10);
    assert.ok(Math.abs(restored.y - point.y) < 1e-10);
  }
});

test('terrain and river are repeatable for the same seed and world', () => {
  const world = generateWorld(42);
  const savedWorld = JSON.stringify(world);
  const first = createCampaignTerrain(42, world);
  const second = createCampaignTerrain(42, JSON.parse(savedWorld));
  assert.deepEqual(first.heights, second.heights);
  assert.deepEqual(first.river, second.river);
  const different = createCampaignTerrain(43, world);
  assert.notDeepEqual(first.heights, different.heights);
  assert.notDeepEqual(first.river, different.river);
  assert.equal(JSON.stringify(world), savedWorld);
});

test('the model keeps road vertices and settlement locations and samples the river in its valley', () => {
  for (const seed of [1, 2, 42]) {
    const world = generateWorld(seed);
    const terrain = createCampaignTerrain(seed, world);
    assert.deepEqual(terrain.settlements.map(({ id, x, y }) => ({ id, x, y })),
      world.settlements.map(({ id, x, y }) => ({ id, x, y })));
    for (const point of world.road) {
      assert.ok(terrain.road.some(vertex => vertex.x === point.x && vertex.y === point.y));
    }
    for (const [i, point] of terrain.road.entries()) {
      if (i > 0) assert.ok(Math.hypot(point.x - terrain.road[i - 1].x, point.y - terrain.road[i - 1].y) <= 2 + 1e-10);
    }
    assert.equal(terrain.river[0].x, 0);
    assert.equal(terrain.river.at(-1).x, world.w);
    for (const place of terrain.settlements) {
      assert.ok(Math.abs(place.y - terrain.riverY(place.x)) >= 24, place.id);
    }
    for (const point of terrain.river.slice(10, -10).filter((_, i) => i % 17 === 0)) {
      const bed = terrain.heightAt(point.x, point.y);
      assert.ok(point.y > 25 && point.y < world.h - 25);
      assert.ok(bed < terrain.heightAt(point.x, point.y - 23));
      assert.ok(bed < terrain.heightAt(point.x, point.y + 23));
    }
  }
});

test('prototype import uses the exact world saved in v1 instead of regenerating it', () => {
  const state = newCampaign(1);
  state.world.settlements[0].name = 'Local guardado';
  state.world.settlements[0].y += 10;
  const raw = serialize(state);
  for (const data of [raw, JSON.stringify({ v: 1, phase: 'mapa', state: JSON.parse(raw) })]) {
    const { seed, world } = readPrototypeSave(data);
    assert.equal(seed, state.seed);
    assert.deepEqual(world, state.world);
    assert.equal(createCampaignTerrain(seed, world).settlements[0].y, state.world.settlements[0].y);
  }
  assert.throws(() => readPrototypeSave('{"v":1,"seed":1,"world":{}}'), /gravação v1/i);
});

test('vegetation is deterministic and stays clear of roads, river and places', async () => {
  const { generateVegetation, TREE_CLEARANCE } = await import('../src/campaign-map-3d/strategic.js');
  const { distanceToLine } = await import('../src/campaign-map-3d/terrain.js');
  const world = generateWorld(1);
  const terrain = createCampaignTerrain(1, world);
  const trees = generateVegetation(1, world, terrain);
  assert.ok(trees.length > 800);
  assert.deepEqual(trees, generateVegetation(1, world, terrain));
  assert.notDeepEqual(trees, generateVegetation(2, world, terrain));
  for (const tree of trees) {
    assert.ok(distanceToLine(tree.x, tree.y, world.road) >= TREE_CLEARANCE.road);
    assert.ok(Math.abs(tree.y - terrain.riverY(tree.x)) >= TREE_CLEARANCE.river);
    assert.ok(world.settlements.every(p => Math.hypot(tree.x - p.x, tree.y - p.y) >= TREE_CLEARANCE.place));
  }
});

test('only intelView entries can become selectable forces, with rumours and expired records excluded', async () => {
  const THREE = await import('three');
  const { intelView } = await import('../src/campaign/intel.js');
  const { strategicView } = await import('../src/campaign-map-3d/strategic.js');
  const { makeIntelligence } = await import('../src/campaign-map-3d/overlays.js');
  const { pickStrategicPoint } = await import('../src/campaign-map-3d/interaction.js');
  const world = generateWorld(1), day = 12;
  const state = { world, day, patrols: [{ id: 'secret', x: 700, y: 350 }], intel: {
    n: 1,
    known: {
      seen: { kind: 'patrulha', x: 420, y: 340, day },
      last: { kind: 'pretor', x: 580, y: 300, day: 9 },
      expired: { kind: 'comboio', x: 680, y: 510, day: 1 },
    },
    reports: [{ id: 1, kind: 'patrulha', x: 310, y: 350, r: 55, seen: 11, got: 12, rel: 'fraca', src: 'rumor', fid: 'secret' }],
  } };
  const view = strategicView(state);
  assert.deepEqual(view.forces, intelView(state).forces);
  assert.deepEqual(view.zones, intelView(state).zones);
  assert.deepEqual(strategicView({ ...state, intel: undefined }).forces, []);
  const projection = createMapProjection(world);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(world.w, world.h).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
  const { group, targets, annotations } = makeIntelligence(view, { ...world, heightAt: () => 0 }, projection);
  group.updateMatrixWorld(true);
  assert.deepEqual(targets.map(marker => marker.userData.selection.id), ['seen', 'last']);
  assert.deepEqual(annotations.map(({ userData }) => [userData.labelKey, userData.selection]), [['map.rumor', undefined]]);
  assert.equal(group.children.length, 4);

  const camera = new THREE.OrthographicCamera(-500, 500, 350, -350, 1, 1000);
  camera.position.set(0, 500, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const pick = (x, y, pickTargets = targets) => {
    const scene = projection.toScene({ x, y });
    const point = new THREE.Vector3(scene.x, scene.y, scene.z).project(camera);
    return pickStrategicPoint(camera, point.x, point.y, ground, pickTargets, projection);
  };
  assert.deepEqual(pick(420, 340), { type: 'force', id: 'seen' });
  assert.deepEqual(pick(580, 300), { type: 'force', id: 'last' });
  for (const [x, y] of [[700, 350], [310, 350], [680, 510]]) {
    const result = pick(x, y);
    assert.equal(result.type, 'terrain');
    assert.ok(Math.abs(result.x - x) < 1e-8 && Math.abs(result.y - y) < 1e-8);
  }
  const site = new THREE.Mesh(new THREE.BoxGeometry(15, 12, 15), new THREE.MeshBasicMaterial());
  site.position.set(0, 6, 0);
  site.userData.selection = { type: 'settlement', id: 'aldeia-demo' };
  site.updateMatrixWorld(true);
  assert.deepEqual(pick(500, 350, [...targets, site]), { type: 'settlement', id: 'aldeia-demo' });
  assert.equal(pick(1010, 350), null);
});

test('label packing tries alternative positions and keeps high priority labels clear of panels', async () => {
  const { labelLeader, positionLabels } = await import('../src/campaign-map-3d/interaction.js');
  const candidates = [
    { id: 'village', x: 110, y: 60, w: 82, h: 22, priority: 2 },
    { id: 'confirmed', x: 110, y: 60, w: 90, h: 22, priority: 5 },
    { id: 'outside', x: 300, y: 60, w: 40, h: 22, priority: 10 },
  ];
  const reserved = { x: 0, y: 0, w: 200, h: 34 };
  const layout = positionLabels(candidates, 220, 125, [reserved]);
  assert.equal(layout.has('outside'), false);
  assert.deepEqual(layout.get('confirmed'), { x: 122, y: 49, w: 90, h: 22 });
  assert.deepEqual(layout.get('village'), { x: 16, y: 49, w: 82, h: 22 });
  assert.deepEqual(labelLeader(candidates[0], layout.get('village')), { x: 98, y: 60 });
  assert.equal(labelLeader({ x: 30, y: 76 }, layout.get('village')), null);
});

test('a tactical stroke keeps its dash spacing across terrain sampling segments', async () => {
  const { tacticalStroke } = await import('../src/campaign-map-3d/tactical-lines.js');
  const world = { w: 30, h: 30 };
  const relief = { ...world, heightAt: () => 5 };
  const projection = createMapProjection(world);
  const points = [4, 6, 10, 13, 16].map(x => ({ x, y: 10 }));
  const mesh = tacticalStroke(points, relief, projection, { color: '#abcdef', width: 2, dash: 4, gap: 4 });
  const vertices = mesh.geometry.getAttribute('position');
  const covered = new Set();
  for (let i = 0; i < vertices.count; i += 6) {
    const min = vertices.getX(i) + 15, max = vertices.getX(i + 2) + 15;
    for (let x = min; x < max; x++) covered.add(x);
    assert.equal(vertices.getY(i), 9.5);
    assert.equal(Math.abs(vertices.getZ(i) - vertices.getZ(i + 1)), 2);
  }
  assert.deepEqual([...covered], [4, 5, 6, 7, 12, 13, 14, 15]);
  mesh.geometry.dispose();
  mesh.material.dispose();
});
