import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newCampaign } from '../src/campaign/state.js';
import { startBrowser } from './e2e-lib.mjs';

const output = process.argv[2];
const baseline = process.env.SENTINEL_M1_BASELINE;
if (output) await mkdir(output, { recursive: true });
const { url, browser, close } = await startBrowser({ root: baseline });
const state = newCampaign(1234);
state.food = 200;
state.done.push('cativos');
// Visual test fixture only: a known force near the band to check the map's military readability.
state.intel = { n: 0, known: { 'visual-patrol': { kind: 'patrulha', x: state.party.x + 72,
  y: state.party.y + 58, day: state.day, men: 6 } }, reports: [] };
const save = JSON.stringify({ v: 1, phase: 'mapa', state, battle: null });
const sizes = process.env.SENTINEL_M1_QUICK ? [[1280, 800]] : [[1440, 900], [1280, 800], [1024, 600], [844, 390]];
const results = [];

try {
  for (const [width, height] of sizes) {
    const page = await browser.newPage({ viewport: { width, height }, locale: 'en' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && !/favicon\.ico/.test(message.location().url)) errors.push(message.text());
    });
    await page.addInitScript(value => localStorage.setItem('viriato.campaign', value), save);
    const shot = async name => {
      if (output) await page.screenshot({ path: join(output, `${width}x${height}-${name}.jpg`), type: 'jpeg', quality: 85 });
    };
    try {
      await page.goto(url);
      await page.locator('#camp-cont:not(.hidden)').click({ timeout: 60000 });
      await page.locator('#campaign-map-3d[data-status=ready]').waitFor({ timeout: 60000 });
      if (width <= 844 && await page.locator('#mside').isVisible()) await page.locator('#m-side-toggle').click();
      await shot('normal');
      const first = await page.evaluate(() => window.__game.campaign.mapMetrics());
      if (!baseline) {
        assert.deepEqual([first.party.figures, first.party.meshes, first.party.materials], [4, 13, 2]);
        assert.ok(first.party.triangles <= 3000);
        const beforeSelect = await page.evaluate(() => ({ day: window.__game.campaign.flow.state.day,
          dest: window.__game.campaign.dest }));
        await page.locator('.party-label').click();
        assert.equal(await page.locator('.party-label').evaluate(el => el.classList.contains('selected')), true);
        assert.deepEqual(await page.evaluate(() => ({ day: window.__game.campaign.flow.state.day,
          dest: window.__game.campaign.dest })), beforeSelect, 'selecting the band must not give an order');
        await shot('selected');
      }
      const canvas = page.locator('#m-scene');
      for (let zoom = 0; zoom < 4; zoom++) {
        await page.locator('#campaign-map-3d [data-camera=in]').click();
        const label = await page.locator('.party-label').boundingBox();
        const area = await canvas.boundingBox();
        if (!label) continue;
        const cx = area.x + area.width / 2, cy = area.y + area.height / 2;
        const dx = Math.max(-area.width / 3, Math.min(area.width / 3, cx - label.x - label.width / 2));
        const dy = Math.max(-area.height / 3, Math.min(area.height / 3, cy - label.y - label.height / 2));
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx + dx, cy + dy, { steps: 5 });
        await page.mouse.up();
      }
      await shot('zoom');

      await page.evaluate(() => {
        const campaign = window.__game.campaign, p = campaign.flow.state.party;
        campaign.order({ kind: 'marchar', to: { x: p.x + 45, y: p.y } });
      });
      await page.waitForTimeout(180);
      await shot('march-east');
      await page.waitForTimeout(900);
      const east = await page.evaluate(() => ({ metrics: window.__game.campaign.mapMetrics(),
        state: window.__game.campaign.flow.state, save: localStorage.getItem('viriato.campaign') }));
      if (!baseline) assert.ok(Math.abs(east.metrics.party.heading - Math.PI / 2) < 0.1,
        'the group faces east after the first real march');
      await page.evaluate(() => {
        const campaign = window.__game.campaign, p = campaign.flow.state.party;
        campaign.order({ kind: 'marchar', to: { x: p.x - 45, y: p.y } });
      });
      await page.waitForTimeout(1000);
      await shot('west');
      const west = await page.evaluate(() => ({ metrics: window.__game.campaign.mapMetrics(),
        state: window.__game.campaign.flow.state, save: localStorage.getItem('viriato.campaign') }));
      if (!baseline) {
        assert.ok(Math.abs(west.metrics.party.heading + Math.PI / 2) < 0.1,
          'the group faces west after reversing direction');
        assert.equal(west.metrics.partyBuilds, 1);
        assert.equal(west.metrics.party.meshes, first.party.meshes);
      }
      assert.deepEqual(errors, []);
      results.push({ resolution: `${width}x${height}`, start: first, east: east.metrics, west: west.metrics,
        state: west.state, save: west.save, errors });
    } finally {
      await page.close();
    }
  }
  if (!baseline) {
    const pt = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'pt-PT' });
    try {
      await pt.addInitScript(value => {
        localStorage.setItem('viriato.campaign', value);
        localStorage.setItem('viriato.language', 'pt-PT');
      }, save);
      await pt.goto(url);
      await pt.locator('#camp-cont:not(.hidden)').click({ timeout: 60000 });
      await pt.locator('#campaign-map-3d[data-status=ready]').waitFor({ timeout: 60000 });
      assert.match(await pt.locator('.party-label').textContent(), /Bando/);
      if (output) await pt.screenshot({ path: join(output, '1280x800-pt-PT.jpg'), type: 'jpeg', quality: 85 });
    } finally {
      await pt.close();
    }
  }
  if (output) await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results.map(({ resolution, start, west, errors }) =>
    ({ resolution, start: start.party, end: west.party, errors }))));
} finally {
  await close();
}
