import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newCampaign } from '../src/campaign/state.js';
import { startBrowser } from './e2e-lib.mjs';

const output = process.argv[2];
const baseline = process.env.SENTINEL_M0_BASELINE;
if (output) await mkdir(output, { recursive: true });
const { url, browser, close } = await startBrowser({ root: baseline, entry: 'index.html?manual=1&map=3d' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error' && !/favicon\.ico/.test(message.location().url)) errors.push(message.text());
});
await page.addInitScript(() => {
  const counters = { created: 0, deleted: 0, draws: 0 };
  window.__m0GL = counters;
  for (const api of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    for (const [method, field] of [['createBuffer', 'created'], ['deleteBuffer', 'deleted'],
      ['drawArrays', 'draws'], ['drawElements', 'draws'], ['drawArraysInstanced', 'draws'],
      ['drawElementsInstanced', 'draws']]) {
      if (!Object.hasOwn(api, method)) continue;
      const original = api[method];
      api[method] = function (...args) {
        counters[field]++;
        return original.apply(this, args);
      };
    }
  }
});
const state = newCampaign(1234);
state.food = 200;
state.done.push('cativos');
await page.addInitScript(save => localStorage.setItem('viriato.campaign', save),
  JSON.stringify({ v: 1, phase: 'mapa', state, battle: null }));

try {
  await page.goto(url);
  await page.locator('#camp-cont:not(.hidden)').click({ timeout: 60000 });
  await page.locator('#campaign-map-3d[data-status=ready]').waitFor({ timeout: 60000 });
  // The Blender figures load once per session and replace the simple ones in the same party group (one swap, not a
  // pose): wait for them so the pose-frame measurements below only see poses.
  await page.waitForFunction(() => window.__game.campaign.mapMetrics?.()?.party?.model === 'blender', null, { timeout: 60000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const sample = () => page.evaluate(() => ({ ...window.__m0GL,
    day: window.__game.campaign.flow.state.day, map: window.__game.campaign.mapMetrics?.() }));
  const start = await sample();
  if (output) for (const [width, height] of [[1440, 900], [1280, 800], [1024, 600], [844, 390]]) {
    await page.setViewportSize({ width, height });
    if (width <= 844 && await page.locator('#mside').isVisible()) await page.locator('#m-side-toggle').click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: join(output, `rest-${width}x${height}.jpg`), type: 'jpeg', quality: 80 });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  const frames = [];
  for (let day = 0; day < 3; day++) {
    await page.evaluate(() => {
      const campaign = window.__game.campaign;
      const p = campaign.flow.state.party;
      campaign.order({ kind: 'marchar', to: { x: p.x + 200, y: p.y } });
    });
    for (let frame = 0; frame < 8; frame++) {
      await page.waitForTimeout(40);
      frames.push(await sample());
      if (day === 0 && frame === 3 && output)
        await page.screenshot({ path: join(output, 'march-1280x800.jpg'), type: 'jpeg', quality: 80 });
    }
  }
  const end = await sample();
  const final = await page.evaluate(() => ({ state: window.__game.campaign.flow.state,
    journal: window.__game.campaign.flow.journal, save: localStorage.getItem('viriato.campaign') }));
  const result = { start, frames, end, final };
  if (output) await writeFile(join(output, 'metrics.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ start, end }));
  if (output) {
    await page.waitForTimeout(1000); // wait for the existing 900 ms march tween before static comparisons
    const village = await page.evaluate(() => window.__game.campaign.flow.state.communities.ribeira.settlement);
    await page.evaluate(id => window.__game.campaign.select(id), village);
    for (const [width, height] of [[1440, 900], [1280, 800], [1024, 600], [844, 390]]) {
      await page.setViewportSize({ width, height });
      if (width <= 844 && await page.locator('#mside').isVisible()) await page.locator('#m-side-toggle').click();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: join(output, `selected-${width}x${height}.jpg`), type: 'jpeg', quality: 80 });
    }
  }
  if (!baseline) {
    assert.equal(start.map.partyBuilds, 1);
    assert.equal(end.map.partyBuilds, 1, 'the party object must survive all march frames');
    assert.ok(end.map.poseUpdates > end.map.planningBuilds);
    for (let day = 0; day < 3; day++) {
      const samples = frames.slice(day * 8, day * 8 + 8);
      assert.ok(samples.at(-1).map.poseUpdates > samples[0].map.poseUpdates,
        'a march must update the pose over several frames');
      for (const frame of samples.slice(1)) {
        assert.equal(frame.created, samples[0].created, 'pose frames must not allocate GPU buffers');
        assert.equal(frame.deleted, samples[0].deleted, 'pose frames must not discard GPU buffers');
        assert.equal(frame.map.planningBuilds, samples[0].map.planningBuilds,
          'pose frames must not rebuild planning');
      }
    }
    const beforeChange = await sample();
    await page.evaluate(() => {
      const campaign = window.__game.campaign;
      campaign.flow.state.communities.souto.posture = 'colabora';
      campaign.render();
    });
    await page.waitForTimeout(100);
    const soutoId = await page.evaluate(() => window.__game.campaign.flow.state.communities.souto.settlement);
    assert.equal(await page.locator(`.map-label[data-id="${soutoId}"]`).getAttribute('data-posture'), 'colabora',
      'an in-place strategic mutation without a new day must reach the map');
    assert.equal((await sample()).map.partyBuilds, beforeChange.map.partyBuilds);
    await page.evaluate(() => {
      const campaign = window.__game.campaign, state = campaign.flow.state;
      state.intel.known['m0-test-patrol'] = { kind: 'patrulha', x: 700, y: 400, day: state.day, men: 6 };
      campaign.render();
    });
    await page.locator('.map-label[data-id="m0-test-patrol"]').waitFor({ state: 'attached' });
    assert.equal((await sample()).map.partyBuilds, beforeChange.map.partyBuilds);
    await page.evaluate(() => window.__game.campaign.fresh(4711));
    await page.locator('#campaign-map-3d[data-status=ready]').waitFor();
    await page.waitForTimeout(100);
    const replaced = await sample();
    assert.equal(replaced.map.party.model, 'blender', 'a new world builds the band straight from the loaded model');
    assert.equal(replaced.map.partyBuilds, 2, 'a new world makes one new party object');
    assert.ok(replaced.map.releasedGroups > end.map.releasedGroups, 'the old scene must be disposed');
    assert.ok(replaced.map.geometries <= end.map.geometries + 3, 'replacing a world must not leak geometries');
    console.log(JSON.stringify({ replaced }));
  }
  assert.deepEqual(errors, []);
} finally {
  await close();
}
