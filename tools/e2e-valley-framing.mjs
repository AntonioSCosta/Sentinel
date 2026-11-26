// Exercise the saved states in the standalone viewer, then read the actual
// WebGL surface with a transparent clear colour to catch gaps and clipping.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startBrowser } from './e2e-lib.mjs';

const captures = process.argv[2];
if (captures) await mkdir(captures, { recursive: true });
const harness = await startBrowser({ entry: 'campaign-map-3d.html?scenario=start' });
try {
  const page = await harness.browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'pt-PT' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(harness.url);
  const selector = page.locator('#comparison-scenario');
  await selector.waitFor();
  for (const [id, known] of [['start', 0], ['rumor', 0], ['old-sighting', 1], ['community', 0]]) {
    await selector.selectOption(id);
    assert.equal(await page.locator('#known-count').textContent(), String(known));
    if (id === 'rumor') assert.equal(await page.locator('.rumor-zone').count(), 1);
    if (id === 'old-sighting') assert.equal(await page.locator('.estimated').count(), 1);
    if (id === 'community') await page.locator('.has-issue').click();
    if (captures) await page.screenshot({ path: join(captures, id + '.jpg'), quality: 82 });
  }
  const failures = await page.evaluate(async () => {
    const THREE = await import('three');
    const { createCampaignTerrain } = await import('/src/campaign-map-3d/terrain.js');
    const { comparisonState } = await import('/tests/fixtures/valley-comparison.js');
    const { createCampaignMapScene } = await import('/src/campaign-map-3d/scene.js');
    const { strategicView } = await import('/src/campaign-map-3d/strategic.js');
    const { createI18n } = await import('/src/i18n/index.js');
    const state = comparisonState('start');
    const canvas = document.createElement('canvas'), labels = document.createElement('div');
    document.body.replaceChildren(canvas, labels);
    const map = createCampaignMapScene(canvas, labels, () => {}, createI18n());
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const failures = [];
    // An RGB-only backbuffer always reads opaque. Set a unique clear colour
    // immediately before each render by intercepting only the clear operation.
    const clear = gl.clear.bind(gl);
    gl.clear = mask => { gl.clearColor(1, 0, 1, 1); clear(mask); };
    map.load(state.seed, state.world, strategicView(state));
    // Project real points with the camera used for this frame, then send
    // them back through the public pick path. Try another azimuth if occluded.
    let camera;
    THREE.Scene.prototype.onBeforeRender = (_renderer, _scene, active) => { camera = active; };
    canvas.style.cssText = 'width:640px;height:420px';
    map.resize();
    const { world } = state, terrain = createCampaignTerrain(state.seed, world);
    const road = [...world.road, ...world.road.slice(1).map((p, i) => ({
      x: (p.x + world.road[i].x) / 2, y: (p.y + world.road[i].y) / 2,
    }))];
    const remaining = new Set([...world.settlements, ...road]);
    for (let i = 0; i < 8 && remaining.size; i++) {
      map.rotate(Math.PI / 4);
      for (const p of remaining) {
        const x = Math.min(world.w - .05, Math.max(.05, p.x));
        const ndc = new THREE.Vector3(x - world.w / 2,
          terrain.heightAt(x, p.y) + (p.id ? 6 : 0), p.y - world.h / 2).project(camera);
        const hit = map.hit((1 + ndc.x) * canvas.clientWidth / 2, (1 - ndc.y) * canvas.clientHeight / 2);
        if (p.id ? hit?.id === p.id : hit?.type === 'terrain' && Math.hypot(hit.x - x, hit.y - p.y) < 1)
          remaining.delete(p);
        // Roadside posts stand on the road and intentionally intercept picks there.
        if (!p.id && hit?.type === 'settlement' && world.settlements.some(place =>
          place.id === hit.id && Math.hypot(place.x - x, place.y - p.y) < 14)) remaining.delete(p);
      }
    }
    for (const p of remaining) failures.push(p.id ?? ['road', p.x, p.y]);
    delete THREE.Scene.prototype.onBeforeRender;
    for (const [w, h] of [[320, 200], [420, 100], [96, 320]]) {
      canvas.style.cssText = 'width:' + w + 'px;height:' + h + 'px';
      map.resize();
      map.reset();
      for (let i = 0; i < 4; i++) {
        map.rotate(Math.PI / 6);
        map.pan(1e6 * (i % 2 ? 1 : -1), 1e6 * (i < 2 ? 1 : -1));
        for (const factor of [100, 0.001]) {
          map.zoomBy(factor);
          const pixels = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          for (let j = 0; j < pixels.length; j += 4) {
            if (pixels[j] === 255 && pixels[j + 1] === 0 && pixels[j + 2] === 255) {
              failures.push([w, h, i, factor]); break;
            }
          }
        }
      }
    }
    return failures;
  });
  assert.deepEqual(failures, []);
  assert.deepEqual(errors, []);
  console.log('Four comparison scenarios and 24 WebGL captures passed.');
} finally {
  await harness.close();
}
