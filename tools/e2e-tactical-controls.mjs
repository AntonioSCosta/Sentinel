// Complementa tools/e2e-tactical-proto.mjs com desenho, input real e relógio controlado.
import assert from 'node:assert/strict';
import { startBrowser } from './e2e-lib.mjs';

const { url, browser, close } = await startBrowser({
  root: process.env.SENTINEL_PROTO_ROOT,
  entry: 'tactical-proto.html',
});

try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 720 }, locale: 'en-GB' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });

  const time = new Date('2026-01-01T12:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(+time + 1000));
  const response = await page.goto(url);
  assert.equal(response.status(), 200);
  await page.clock.runFor(160);

  const canvas = page.locator('#view');
  const scene = await page.evaluate(() => ({
    stats: window.__proto?.info(),
    groups: window.__proto?.ui.placement.filter(group => window.__proto.view.where(group.id)).length,
    labels: [...document.querySelectorAll('#labels .lbl:not(.rom)')].filter(label => label.getClientRects().length).length,
  }));
  assert.ok(scene.stats?.calls > 0 && scene.stats.triangles > 0, 'Three.js drew the scene');
  assert.equal(scene.groups, 4, 'the four groups reached the renderer');
  assert.equal(scene.labels, 4, 'the four unit labels are visible');
  console.log('ok   Cena Three.js desenhada e quatro grupos visíveis');

  // The canvas picks on y=0, so project the same plane when aiming the input.
  async function fieldPoint(x, y) {
    const point = await page.evaluate(async ({ x, y }) => {
      const { heightAt } = await import('/src/tactical/proto/view.js');
      return window.__proto.view.project(x, y, -heightAt(x, y));
    }, { x, y });
    const bounds = await canvas.boundingBox();
    assert.ok(point.visible && bounds && point.x > 0 && point.x < bounds.width && point.y > 0 && point.y < bounds.height);
    return { x: bounds.x + point.x, y: bounds.y + point.y };
  }

  // Coordinates produce trusted events without waiting for real rAF while the clock is paused.
  async function click(selector) {
    const bounds = await page.locator(selector).boundingBox();
    assert.ok(bounds, `${selector} is visible`);
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  }

  // Move the camera north so the initial placement is clear of the preparation panels.
  await page.keyboard.down('KeyW');
  await page.clock.runFor(240);
  await page.keyboard.up('KeyW');
  const origin = await page.evaluate(() => window.__proto.view.where('corvos'));
  const group = await fieldPoint(origin.x, origin.y);
  const woods = await fieldPoint(82, 35);
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, group), 'view', 'the group can receive canvas input');
  await page.mouse.move(group.x, group.y);
  await page.mouse.down();
  await page.mouse.move(woods.x, woods.y, { steps: 4 });
  await page.mouse.up();
  await page.clock.runFor(160);
  const ravens = page.locator('#cards [data-id="corvos"]');
  assert.equal(await ravens.evaluate(element => element.classList.contains('sel')), true);
  assert.equal(await ravens.locator('.state').textContent(), 'Hidden');
  const placement = await page.evaluate(() => window.__proto.ui.placement.find(g => g.id === 'corvos'));
  assert.ok(Math.hypot(placement.x - 82, placement.y - 35) < 1, 'drag placed the selected group in the woods');
  console.log('ok   Seleção no terreno e arrasto para o bosque');

  await click('#start');
  await click('#pause');
  await page.clock.runFor(320);
  const battleTime = () => page.evaluate(() => window.__proto.ui.session.battle.t);
  assert.equal(await battleTime(), 0, 'paused battle has not advanced');

  const target = await fieldPoint(93, 34);
  await page.mouse.click(target.x, target.y, { button: 'right' });
  const order = await page.evaluate(() => window.__proto.ui.session.battle.groups.find(g => g.id === 'corvos').order);
  assert.equal(order.type, 'atacar');
  assert.ok(Math.hypot(order.x - 93, order.y - 34) < 1, 'right click issued a ground order to the selected group');

  await page.keyboard.press('KeyP');
  await page.clock.runFor(320);
  assert.ok(await battleTime() > 0, 'keyboard resume advanced the simulation');
  await click('#pause');
  const pausedAt = await battleTime();
  await page.clock.runFor(320);
  assert.equal(await battleTime(), pausedAt, 'pausing again froze simulation time');
  assert.deepEqual(errors, []);
  console.log('ok   Ordem pelo rato, pausa e retoma sem erros JavaScript');
} finally {
  await close();
}
