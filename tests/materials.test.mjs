import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TEXTURE_SETS, MATERIALS, loadMaterials, terrainMaterial } from '../src/materials.js';

const stubLoader = (reject = () => false) => {
  const calls = [];
  return { calls, loadAsync: async url => { calls.push(url); if (reject(url)) throw new Error('404 ' + url); return new THREE.Texture(); } };
};

test('every CC0 set names its source page and three files', () => {
  for (const [name, s] of Object.entries(TEXTURE_SETS)) {
    assert.match(s.url, /^https:\/\/polyhaven\.com\/a\/[a-z0-9_]+$/, name);
    assert.deepEqual(Object.keys(s.files).sort(), ['color', 'normal', 'rough']);
    assert.ok(MATERIALS[name], `${name} has a material entry`);
  }
});

test('all files present: textured materials get colour, normal and roughness maps', async () => {
  const mats = await loadMaterials({ THREE, loader: stubLoader(), quality: 'high' });
  assert.deepEqual(Object.keys(mats).sort(), Object.keys(MATERIALS).sort());
  for (const name of Object.keys(TEXTURE_SETS)) {
    assert.ok(mats[name].map, name + ' map'); assert.ok(mats[name].normalMap, name + ' normal'); assert.ok(mats[name].roughnessMap, name + ' rough');
  }
});

test('one missing file degrades only that map', async () => {
  const mats = await loadMaterials({ THREE, loader: stubLoader(u => u.includes('terrain_rock/normal')), quality: 'high' });
  assert.ok(mats.terrain_rock.map); assert.equal(mats.terrain_rock.normalMap, null);
});

test('no textures at all: every material still exists (procedural fallback)', async () => {
  const mats = await loadMaterials({ THREE, loader: stubLoader(() => true), quality: 'medium' });
  assert.deepEqual(Object.keys(mats).sort(), Object.keys(MATERIALS).sort());
  for (const m of Object.values(mats)) assert.ok(m.isMaterial);
});

test('no loader (headless): fallback without trying to load', async () => {
  const mats = await loadMaterials({ THREE, loader: null, quality: 'high' });
  assert.equal(Object.keys(mats).length, Object.keys(MATERIALS).length);
});

test('low quality loads colour maps only', async () => {
  const l = stubLoader();
  await loadMaterials({ THREE, loader: l, quality: 'low' });
  assert.ok(l.calls.length > 0);
  assert.ok(l.calls.every(u => u.endsWith('/color.jpg')));
});

test('terrain material is a standard material that accepts the splat attribute', async () => {
  const mats = await loadMaterials({ THREE, loader: null, quality: 'high' });
  const t = terrainMaterial(THREE, mats);
  assert.ok(t.isMeshStandardMaterial); assert.equal(typeof t.onBeforeCompile, 'function');
});

test('foliage: cut-out leaf materials for oak, shrub and pine; still three materials when files are missing', async () => {
  const { loadFoliage } = await import('../src/materials.js');
  const ok = await loadFoliage({ THREE, loader: stubLoader(), document: null });
  for (const k of ['oak', 'shrub', 'pine']) { assert.ok(ok[k].isMeshStandardMaterial, k); assert.equal(ok[k].side, THREE.DoubleSide); }
  assert.ok(ok.oak.map && ok.shrub.map, 'oak and shrub use the CC0 leaf cards');
  assert.equal(ok.oak.alphaTest, .4);
  assert.ok(ok.oakDepth && ok.oakDepth.alphaTest === .4, 'shadows respect the leaf cut-out');
  const none = await loadFoliage({ THREE, loader: stubLoader(() => true), document: null });
  assert.deepEqual(['oak', 'shrub', 'pine'].map(k => !!none[k]), [true, true, true]);
});

test('grass tufts: a cut-out blade texture when a canvas exists, never an opaque square without one', async () => {
  const { makeGrassMaterial } = await import('../src/materials.js');
  const plain = makeGrassMaterial(THREE, null);
  assert.equal(plain.visible, false, 'no texture → tufts hidden rather than drawn as squares');
});

test('foliage: fern and grass photo cards load as cut-outs with their own depth materials', async () => {
  const { loadFoliage } = await import('../src/materials.js');
  const l = stubLoader();
  const ok = await loadFoliage({ THREE, loader: l, document: null });
  assert.ok(l.calls.includes('assets/textures/foliage/fern_leaves.png'), 'fetos');
  assert.ok(l.calls.includes('assets/textures/foliage/grass_tuft.png'), 'ervas');
  for (const k of ['fern', 'grass']) {
    assert.ok(ok[k] && ok[k].isMeshStandardMaterial, k);
    assert.ok(ok[k].map, k + ' usa a carta fotográfica');
    assert.equal(ok[k].side, THREE.DoubleSide, k);
    assert.ok(ok[k + 'Depth'] && ok[k + 'Depth'].alphaTest === ok[k].alphaTest, k + ' sombra recortada');
  }
  const none = await loadFoliage({ THREE, loader: stubLoader(() => true), document: null });
  assert.ok(none.fern && none.grass, 'sem ficheiros continua a haver materiais');
  assert.equal(none.grass.map, null);
});
