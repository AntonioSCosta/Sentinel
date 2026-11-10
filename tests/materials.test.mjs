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
  assert.equal(ok.oak.alphaTest, .5);
  assert.ok(ok.oakDepth && ok.oakDepth.alphaTest === .5, 'shadows respect the leaf cut-out');
  const none = await loadFoliage({ THREE, loader: stubLoader(() => true), document: null });
  assert.deepEqual(['oak', 'shrub', 'pine'].map(k => !!none[k]), [true, true, true]);
});
