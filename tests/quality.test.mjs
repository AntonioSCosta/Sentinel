import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { QUALITY, resolveQuality } from '../src/quality.js';
import { createRender } from '../src/render.js';

const stubRenderer = () => ({ shadowMap: {}, ratio: 1, setPixelRatio(r) { this.ratio = r; }, setSize() {}, render() { this.renders = (this.renders || 0) + 1; } });

test('exactly three presets with the agreed values', () => {
  assert.deepEqual(Object.keys(QUALITY), ['low', 'medium', 'high']);
  assert.deepEqual(QUALITY.low, { pixelRatio: .7, shadowMap: 1024, ssao: false, bloom: false, grass: 1500, texRes: '1k' });
  assert.equal(QUALITY.high.ssao, false, 'SSAO custa mais do que mostra debaixo das copas'); assert.equal(QUALITY.medium.bloom, true);
  assert.ok(QUALITY.high.pixelRatio <= 1 && QUALITY.high.shadowMap <= 3072, 'Alta tem de correr num PC normal');
});

test('unknown quality falls back to medium', () => {
  assert.equal(resolveQuality('ultra'), 'medium'); assert.equal(resolveQuality(undefined), 'medium'); assert.equal(resolveQuality('low'), 'low');
});

test('setQuality switches effects, shadows and grass density', async () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const sun = new THREE.DirectionalLight(); const grass = { count: 0 };
  const R = await createRender({ THREE, renderer: stubRenderer(), scene, camera, sun, grass, quality: 'high', devicePixelRatio: 2 });
  assert.equal(R.state.ssao, false); assert.equal(R.state.bloom, true); assert.equal(grass.count, 5500); assert.equal(sun.shadow.mapSize.x, 3072);
  R.setQuality('low');
  assert.equal(R.state.ssao, false); assert.equal(R.state.bloom, false); assert.equal(grass.count, 1500); assert.equal(sun.shadow.mapSize.x, 1024);
  assert.equal(R.state.preset, 'low');
  R.setQuality('nonsense'); assert.equal(R.state.preset, 'medium');
  R.render(); // must not throw without WebGL
});
